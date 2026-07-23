/**
 * LiveKit Server Webhook — AI Meeting Recording trigger
 * ─────────────────────────────────────────────────────────
 * Receives room/track/egress lifecycle events from LiveKit Cloud and drives the
 * recording pipeline server-side (survives page refresh/crash — not dependent
 * on client-side JS in dashboard/meeting.html running correctly).
 *
 * Configure this URL in the LiveKit Cloud project settings: {BASE_URL}/webhook/livekit
 *
 * Flow: room_started → start room-composite egress (CRM playback file)
 *       track_published (audio) → start that participant's audio-only track egress
 *       room_finished → stop any still-active egresses for the room
 *       egress_ended → record the finished file; once composite + all tracks are
 *                      done, flip status to 'ready' for transcriptionProcessor.js
 */
const express = require('express');
const router = express.Router();
const { WebhookReceiver, TrackType } = require('livekit-server-sdk');
const cfg = require('../config');
const logger = require('../logger');
const supabase = require('../db/supabase');
const MeetingRecording = require('../models/MeetingRecording');
const egressSvc = require('../services/egressService');

const receiver = new WebhookReceiver(cfg.livekit.apiKey, cfg.livekit.apiSecret);

router.post('/', async (req, res) => {
  let event;
  try {
    // req.rawBody is captured by the verify() callback on the global express.json()
    // middleware in src/index.js — WebhookReceiver needs the exact raw bytes to check
    // the signature, not the re-serialized parsed object.
    const body = req.rawBody || JSON.stringify(req.body || {});
    event = await receiver.receive(body, req.get('Authorization'));
  } catch (err) {
    logger.warn('LiveKit webhook: signature verification failed', { msg: err.message });
    return res.status(401).end();
  }

  // Ack immediately — LiveKit retries on timeout/non-2xx; do the real work after responding.
  res.status(200).end();

  try {
    await handleEvent(event);
  } catch (err) {
    logger.error('LiveKit webhook: handler error', { event: event?.event, msg: err.message });
  }
});

async function handleEvent(event) {
  switch (event.event) {
    case 'room_started':    return onRoomStarted(event);
    case 'track_published': return onTrackPublished(event);
    case 'room_finished':   return onRoomFinished(event);
    case 'egress_ended':    return onEgressEnded(event);
    default: return;
  }
}

async function onRoomStarted(event) {
  const roomName = event.room?.name;
  if (!roomName) return;

  const { data: meeting } = await supabase.from('meetings').select('*')
    .eq('room_name', roomName).order('created_at', { ascending: false }).limit(1).maybeSingle();
  if (!meeting) {
    logger.warn(`LiveKit webhook: room_started for unrecognized room "${roomName}" — no meeting record, skipping recording.`);
    return;
  }

  const already = await MeetingRecording.findOne({ roomName });
  if (already) return; // duplicate room_started (e.g. reconnect) — already recording

  const rec = await MeetingRecording.create({ meetingId: meeting.id, leadId: meeting.lead_id, roomName, status: 'recording' });

  try {
    const { egressId, storagePath } = await egressSvc.startRoomComposite(roomName);
    await MeetingRecording.findByIdAndUpdate(rec._id, { egressId, storagePath });
  } catch (err) {
    logger.error('LiveKit webhook: failed to start room composite egress', { roomName, msg: err.message });
    await MeetingRecording.findByIdAndUpdate(rec._id, { status: 'failed' });
  }
}

async function onTrackPublished(event) {
  const roomName = event.room?.name;
  const track = event.track;
  const participant = event.participant;
  if (!roomName || !track || !participant) return;
  if (track.type !== TrackType.AUDIO) return; // only care about mic audio, not video/screenshare

  const rec = await MeetingRecording.findOne({ roomName });
  if (!rec) return; // room_started didn't recognize this room — nothing to attach to

  const tracks = Array.isArray(rec.participantTracks) ? rec.participantTracks : [];
  if (tracks.some(t => t.trackSid === track.sid)) return; // already handled

  try {
    const { egressId, storagePath } = await egressSvc.startParticipantAudioTrack(roomName, track.sid, participant.identity);
    tracks.push({
      identity: participant.identity,
      name: participant.name || participant.identity,
      trackSid: track.sid,
      egressId,
      storagePath,
      status: 'recording',
    });
    await MeetingRecording.findByIdAndUpdate(rec._id, { participantTracks: tracks });
  } catch (err) {
    logger.error('LiveKit webhook: failed to start participant track egress', { roomName, identity: participant.identity, msg: err.message });
  }
}

async function onRoomFinished(event) {
  const roomName = event.room?.name;
  if (!roomName) return;
  await egressSvc.stopEgress((await MeetingRecording.findOne({ roomName }))?.egressId);
  const rec = await MeetingRecording.findOne({ roomName });
  if (!rec) return;
  for (const t of (rec.participantTracks || [])) {
    if (t.egressId) await egressSvc.stopEgress(t.egressId);
  }
  if (rec.status === 'recording') {
    await MeetingRecording.findByIdAndUpdate(rec._id, { status: 'processing' });
  }
}

async function onEgressEnded(event) {
  const info = event.egressInfo;
  if (!info) return;
  const fileResult = (info.fileResults || [])[0];
  const durationSeconds = fileResult ? Math.round(Number(fileResult.duration || 0n) / 1e9) : 0;
  const location = fileResult?.location || '';

  const { data: rec } = await supabase.from('meeting_recordings').select('*')
    .eq('room_name', info.roomName).maybeSingle();
  if (!rec) return;

  if (rec.egress_id === info.egressId) {
    // Composite (playback) egress finished
    await MeetingRecording.findByIdAndUpdate(rec.id, { fileUrl: location, durationSeconds, status: 'processing' });
  } else {
    // A participant's audio-track egress finished
    const tracks = Array.isArray(rec.participant_tracks) ? rec.participant_tracks : [];
    let changed = false;
    for (const t of tracks) {
      if (t.egressId === info.egressId) {
        t.fileUrl = location;
        t.status = 'ready';
        changed = true;
      }
    }
    if (changed) await MeetingRecording.findByIdAndUpdate(rec.id, { participantTracks: tracks });
  }

  await maybeMarkReady(rec.id);
}

/** Once the composite + every participant track have finished, flip to 'ready' for transcriptionProcessor.js. */
async function maybeMarkReady(recordingId) {
  const rec = await MeetingRecording.findById(recordingId);
  if (!rec || rec.status === 'ready' || rec.status === 'transcribed' || rec.status === 'failed') return;
  const tracks = rec.participantTracks || [];
  const compositeDone = !!rec.fileUrl;
  const tracksDone = tracks.length > 0 && tracks.every(t => t.status === 'ready');
  if (compositeDone && tracksDone) {
    await MeetingRecording.findByIdAndUpdate(rec._id, { status: 'ready' });
    logger.info(`Meeting recording ready | meetingId=${rec.meetingId} | roomName=${rec.roomName}`);
  }
}

module.exports = router;

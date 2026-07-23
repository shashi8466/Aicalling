/**
 * LiveKit Egress Service — AI Meeting Recording
 * ─────────────────────────────────────────────────────────
 * Wraps LiveKit Cloud's hosted Egress API to record every consultation meeting.
 *
 * Two egress jobs run per meeting:
 *   • Room Composite (video+audio mixed)  → the file used for CRM playback/download.
 *   • One audio-only Track Egress per participant → used only internally by
 *     transcriptionService to produce an exact, speaker-labeled transcript
 *     without needing acoustic diarization.
 *
 * Both are uploaded directly to the same Supabase Storage bucket (S3-compatible),
 * configured via cfg.supabaseStorage.
 */
const { EgressClient, EncodedFileOutput, DirectFileOutput, S3Upload, EncodedFileType } = require('livekit-server-sdk');
const cfg    = require('../config');
const logger = require('../logger');

let _client = null;
function getEgressClient() {
  if (_client) return _client;
  if (!cfg.livekit.apiKey || !cfg.livekit.apiSecret || !cfg.livekit.url) {
    throw new Error('LiveKit not configured — set LIVEKIT_URL/LIVEKIT_API_KEY/LIVEKIT_API_SECRET.');
  }
  // EgressClient needs an http(s) host; LIVEKIT_URL is the wss:// client-connect URL.
  const host = cfg.livekit.url.replace(/^ws/, 'http');
  _client = new EgressClient(host, cfg.livekit.apiKey, cfg.livekit.apiSecret);
  return _client;
}

function buildS3Upload() {
  const s3 = cfg.supabaseStorage;
  if (!s3.endpoint || !s3.accessKey || !s3.secretKey) {
    throw new Error('Supabase Storage S3 credentials not configured — set SUPABASE_S3_ENDPOINT/ACCESS_KEY/SECRET_KEY.');
  }
  return new S3Upload({
    accessKey: s3.accessKey,
    secret: s3.secretKey,
    bucket: s3.bucket,
    region: s3.region,
    endpoint: s3.endpoint,
    forcePathStyle: true, // required by Supabase Storage's S3-compatible endpoint
  });
}

/**
 * Starts a mixed video+audio recording of the whole room — this becomes the
 * file played back/downloaded from the CRM.
 * @returns {Promise<{egressId: string, storagePath: string}>}
 */
async function startRoomComposite(roomName) {
  const storagePath = `${roomName}/composite-${Date.now()}.mp4`;
  const output = new EncodedFileOutput({
    fileType: EncodedFileType.MP4,
    filepath: storagePath,
    output: { case: 's3', value: buildS3Upload() },
  });
  const info = await getEgressClient().startRoomCompositeEgress(roomName, { file: output }, { audioOnly: false });
  logger.info(`Egress: started room composite | room=${roomName} | egressId=${info.egressId}`);
  return { egressId: info.egressId, storagePath };
}

/**
 * Starts an audio-only recording of a single participant's microphone track —
 * transcribed separately so speaker attribution is exact (no diarization needed).
 * @returns {Promise<{egressId: string, storagePath: string}>}
 */
async function startParticipantAudioTrack(roomName, trackId, participantIdentity) {
  const storagePath = `${roomName}/track-${participantIdentity}-${Date.now()}`;
  const output = new DirectFileOutput({
    filepath: storagePath,
    output: { case: 's3', value: buildS3Upload() },
  });
  const info = await getEgressClient().startTrackEgress(roomName, output, trackId);
  logger.info(`Egress: started participant track | room=${roomName} | identity=${participantIdentity} | egressId=${info.egressId}`);
  return { egressId: info.egressId, storagePath };
}

async function stopEgress(egressId) {
  if (!egressId) return null;
  try {
    return await getEgressClient().stopEgress(egressId);
  } catch (err) {
    // Egress may have already stopped on its own (e.g. room composite auto-stops
    // when the room empties) — not a real failure.
    logger.warn('Egress: stopEgress failed (may already be stopped)', { egressId, msg: err.message });
    return null;
  }
}

module.exports = { startRoomComposite, startParticipantAudioTrack, stopEgress };

/**
 * Transcription Processor Job — AI Meeting Transcription + Intelligence (Phase 2)
 * Polls meeting_recordings for rows whose composite + all participant audio
 * tracks have finished uploading (status='ready'), transcribes each participant's
 * track via Whisper, merges them into one speaker-labeled transcript, saves it,
 * then immediately runs the Phase 2 AI analysis (summary/action items/sentiment/
 * conversation intelligence) on that same transcript.
 */
const MeetingRecording = require('../models/MeetingRecording');
const MeetingTranscript = require('../models/MeetingTranscript');
const MeetingAnalysis = require('../models/MeetingAnalysis');
const Lead = require('../models/Lead');
const transcriptionSvc = require('../services/transcriptionService');
const intelligenceSvc = require('../services/meetingIntelligenceService');
const logger = require('../logger');

let isRunning = false;

async function processReadyRecordings() {
  if (isRunning) return;
  isRunning = true;
  try {
    const ready = await MeetingRecording.find({ status: 'ready' }, { limit: 20 });
    if (!ready.length) return;

    logger.info(`transcriptionProcessor: Processing ${ready.length} ready recording(s).`);

    for (const rec of ready) {
      try {
        const tracks = (rec.participantTracks || []).map(t => ({ name: t.name, identity: t.identity, storagePath: t.storagePath }));
        if (!tracks.length) {
          logger.warn(`transcriptionProcessor: recording ${rec._id} has no participant tracks — marking failed.`);
          await MeetingRecording.findByIdAndUpdate(rec._id, { status: 'failed' });
          continue;
        }

        const { fullText, segments, language } = await transcriptionSvc.transcribeMeeting(tracks);

        await MeetingTranscript.create({
          meetingId: rec.meetingId,
          leadId: rec.leadId,
          fullText,
          segments,
          language,
        });

        await MeetingRecording.findByIdAndUpdate(rec._id, { status: 'transcribed' });
        logger.info(`transcriptionProcessor: transcribed meeting recording ${rec._id} (${segments.length} segments)`);

        // Phase 2 — run AI analysis on the transcript we just produced.
        if (fullText) {
          try {
            const lead = await Lead.findById(rec.leadId);
            const durationMs = (rec.durationSeconds || 0) * 1000 || (segments[segments.length - 1]?.endMs || 0);
            const { summary, actionItems, sentimentTimeline, intelligence } =
              await intelligenceSvc.analyzeMeeting(fullText, segments, durationMs, lead || {});

            await MeetingAnalysis.create({
              meetingId: rec.meetingId,
              leadId: rec.leadId,
              summary,
              actionItems,
              sentimentTimeline,
              intelligence,
            });
            logger.info(`transcriptionProcessor: AI analysis complete for meeting recording ${rec._id}`);
          } catch (analysisErr) {
            // Recording + transcript already saved successfully — don't let analysis
            // failure re-flag the whole recording as failed.
            logger.error(`transcriptionProcessor: AI analysis failed for recording ${rec._id}`, { msg: analysisErr.message });
          }
        }
      } catch (err) {
        logger.error(`transcriptionProcessor: failed to transcribe recording ${rec._id}`, { msg: err.message });
        await MeetingRecording.findByIdAndUpdate(rec._id, { status: 'failed' }).catch(() => {});
      }
    }
  } catch (err) {
    logger.error('Error in transcriptionProcessor lifecycle', { msg: err.message });
  } finally {
    isRunning = false;
  }
}

function start() {
  // Check every 1 minute — matches meetingReminderPoller/billingPoller's cadence.
  setInterval(processReadyRecordings, 60_000);
  logger.info('Transcription Processor job started');
}

module.exports = { start, processReadyRecordings };

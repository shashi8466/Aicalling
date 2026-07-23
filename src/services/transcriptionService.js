/**
 * Meeting Transcription Service — AI Meeting Transcription
 * ─────────────────────────────────────────────────────────
 * Downloads each participant's audio-track recording from Supabase Storage and
 * transcribes it separately via OpenAI Whisper. Transcribing per-participant
 * (rather than the mixed composite) is what gives exact speaker attribution
 * without needing acoustic diarization — each track is single-speaker audio.
 */
const fs   = require('fs');
const os   = require('os');
const path = require('path');
const OpenAI = require('openai');
const supabase = require('../db/supabase');
const cfg    = require('../config');
const logger = require('../logger');

const openai = new OpenAI({ apiKey: cfg.openai.apiKey });

/** Downloads a file from the meeting-recordings bucket to a local temp path. */
async function downloadToTemp(storagePath) {
  const { data, error } = await supabase.storage.from(cfg.supabaseStorage.bucket).download(storagePath);
  if (error) throw new Error(`Storage download failed for ${storagePath}: ${error.message}`);
  const buffer = Buffer.from(await data.arrayBuffer());
  const tmpPath = path.join(os.tmpdir(), `meeting-track-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  fs.writeFileSync(tmpPath, buffer);
  return tmpPath;
}

/**
 * Transcribes a single audio file via Whisper, returning timestamped segments.
 * @returns {Promise<{language: string, segments: Array<{text:string, startMs:number, endMs:number}>}>}
 */
async function transcribeAudioFile(tmpPath) {
  const resp = await openai.audio.transcriptions.create({
    file: fs.createReadStream(tmpPath),
    model: 'whisper-1',
    response_format: 'verbose_json',
    timestamp_granularities: ['segment'],
  });
  const segments = (resp.segments || []).map(s => ({
    text: (s.text || '').trim(),
    startMs: Math.round((s.start || 0) * 1000),
    endMs: Math.round((s.end || 0) * 1000),
  })).filter(s => s.text);
  return { language: resp.language || '', segments };
}

/**
 * Transcribes every participant's audio track for a meeting and merges them
 * chronologically into one speaker-labeled transcript.
 * @param {Array<{name: string, storagePath: string}>} participantTracks
 * @returns {Promise<{fullText: string, segments: Array, language: string}>}
 */
async function transcribeMeeting(participantTracks) {
  const allSegments = [];
  let language = '';

  for (const p of participantTracks) {
    if (!p.storagePath) continue;
    let tmpPath;
    try {
      tmpPath = await downloadToTemp(p.storagePath);
      const { language: lang, segments } = await transcribeAudioFile(tmpPath);
      language = language || lang;
      for (const seg of segments) {
        allSegments.push({ speaker: p.name || 'Participant', text: seg.text, startMs: seg.startMs, endMs: seg.endMs });
      }
    } catch (err) {
      logger.error('transcribeMeeting: failed for participant track', { identity: p.identity, msg: err.message });
    } finally {
      if (tmpPath) { try { fs.unlinkSync(tmpPath); } catch (_) { /* best effort cleanup */ } }
    }
  }

  allSegments.sort((a, b) => a.startMs - b.startMs);
  const fullText = allSegments.map(s => `${s.speaker}: ${s.text}`).join('\n');

  return { fullText, segments: allSegments, language };
}

module.exports = { transcribeMeeting };

const express = require('express');
const router = express.Router();
const axios = require('axios');
const xml2js = require('xml2js');
const logger = require('../logger');
const qs = require('querystring');

const TELNYX_API_KEY = process.env.TELNYX_API_KEY;

async function telnyxPost(path, payload) {
  try {
    const res = await axios.post(`https://api.telnyx.com/v2${path}`, payload, {
      headers: { 
        'Authorization': `Bearer ${TELNYX_API_KEY}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      }
    });
    return res;
  } catch (err) {
    const status = err.response?.status;
    const errorData = err.response?.data;
    logger.error(`[CALL] TTS/Telnyx API Error [${path}]: HTTP ${status || 'N/A'}`);
    if (errorData) {
      logger.error(`[CALL] Telnyx error payload: ${JSON.stringify(errorData)}`);
    } else {
      logger.error(`[CALL] Telnyx error message: ${err.message}`);
    }
    throw err;
  }
}

// In-memory state to track Call Control mapping to Lead ID and Campaign info
const activeCalls = new Map();
// Sessions that already hung up — stops late events from resurrecting state.
const endedCalls = new Set();

router.post('/', async (req, res) => {
  res.sendStatus(200); // Always ack Telnyx Webhook quickly
  const event = req.body?.data;
  if (!event) return;

  const eventType = event.event_type;
  const payload = event.payload;
  const callControlId = payload.call_control_id;
  const callSessionId = payload.call_session_id;

  try {
    // Telnyx echoes client_state on every event, so state can be rebuilt if
    // call.initiated was missed (e.g. server restarted mid-call).
    if (endedCalls.has(callSessionId)) return;
    if (!activeCalls.has(callSessionId) && payload.client_state) {
      try {
        const state = JSON.parse(Buffer.from(payload.client_state, 'base64').toString('utf8'));
        activeCalls.set(callSessionId, state);
      } catch (e) {
        logger.warn(`[CALL] Could not decode client_state: ${e.message}`);
      }
    }

    const state = activeCalls.get(callSessionId);
    if (!state) return;

    if (eventType === 'call.answered') {
      state.answered = true;
      logger.info(`[CALL] call.answered received for call_control_id=${callControlId}`);
      logger.info(`[CALL] campaign_type = ${state.params?.campaignId ? 'campaign' : 'custom'}`);
      logger.info(`[CALL] starting TTS via Twilio Flow`);
      
      // Start background speech transcription
      telnyxPost(`/calls/${callControlId}/actions/transcription_start`, {
        language: 'en'
      }).catch(e => logger.error(`[CALL] Failed to start transcription: ${e.message}`));

      // Trigger the start of the Twilio webhook flow
      await driveTwilioFlow(callControlId, state, `/webhook/call/start`);

    } else if (eventType === 'call.speak.started' || eventType === 'call.playback.started') {
      logger.info(`[CALL] TTS started for call_control_id=${callControlId}`);
    } else if (eventType === 'call.speak.ended' || eventType === 'call.playback.ended') {
      logger.info(`[CALL] TTS completed for call_control_id=${callControlId}`);
      
      if (state.isGathering) {
        // Wait for 5 seconds of silence before assuming they didn't speak
        state.gatherTimeout = setTimeout(() => {
          if (state.isGathering) {
            state.isGathering = false;
            logger.info(`[CALL] Silence timeout reached, sending empty speech`);
            driveTwilioFlow(callControlId, state, state.nextActionUrl, { SpeechResult: '' });
          }
        }, 5000);
      } else if (state.redirectUrl) {
        await driveTwilioFlow(callControlId, state, state.redirectUrl);
      } else if (state.hangupAfterSpeak) {
        logger.info(`[CALL] Hanging up after speak as requested by TwiML`);
        await hangupCall(callControlId);
      }
    } else if (eventType === 'call.transcription') {
      const isFinal = payload.transcription_data?.is_final;
      const transcript = payload.transcription_data?.transcript?.trim();
      
      if (isFinal && transcript && state.isGathering) {
        clearTimeout(state.gatherTimeout);
        state.isGathering = false;
        logger.info(`[CALL] Transcription received: "${transcript}"`);
        await driveTwilioFlow(callControlId, state, state.nextActionUrl, { SpeechResult: transcript });
      }
    } else if (eventType === 'call.hangup' || eventType === 'call.completed') {
      activeCalls.delete(callSessionId);
      endedCalls.add(callSessionId);
      setTimeout(() => endedCalls.delete(callSessionId), 10 * 60 * 1000);
      if (state.gatherTimeout) clearTimeout(state.gatherTimeout);
      state.isGathering = false;
      state.ended = true;

      const callStatus = mapHangupStatus(payload.hangup_cause, state.answered);
      const start = Date.parse(payload.start_time);
      const end = Date.parse(payload.end_time);
      const duration = start && end && end > start ? Math.round((end - start) / 1000) : 0;
      logger.info(`[CALL] Call ended for call_control_id=${callControlId} cause=${payload.hangup_cause || 'n/a'} → ${callStatus}`);

      await driveTwilioFlow(callControlId, state, `/webhook/call/status`, {
        CallStatus: callStatus,
        CallDuration: String(duration),
      });
    }
  } catch (err) {
    logger.error('Telnyx Bridge error:', err);
  }
});

// A hangup can race with the caller hanging up first — Telnyx then rejects the
// command, which is harmless.
async function hangupCall(callControlId) {
  try {
    await telnyxPost(`/calls/${callControlId}/actions/hangup`, {});
  } catch (_) { /* call already ended */ }
}

// Translate Telnyx hangup_cause into the Twilio-style CallStatus that
// /webhook/call/status understands.
function mapHangupStatus(cause, answered) {
  if (answered) return 'completed';
  switch (cause) {
    case 'user_busy':
    case 'call_rejected':
      return 'busy';
    case 'timeout':
    case 'no_answer':
      return 'no-answer';
    case 'originator_cancel':
      return 'canceled';
    default:
      return 'failed';
  }
}

// Wrap text in SSML so acronyms are spelled out letter by letter — "SAT" is
// spoken "ess-ay-tee", never the word "sat". Upstream text may already have
// been rewritten to "S-A-T" / "S.A.T.", so all spellings are normalised.
function toSsml(text) {
  const escaped = text.trim()
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  const spelled = escaped.replace(/\bS-A-T\b|\bS\.A\.T\b\.?|\bSAT\b/g,
    '<say-as interpret-as="characters">SAT</say-as>');
  return `<speak>${spelled}</speak>`;
}

async function driveTwilioFlow(callControlId, state, urlPath, twilioBody = {}) {
  // Once the call is gone, only the final status callback may still run.
  if (state.ended && !urlPath.startsWith('/webhook/call/status')) return;
  try {
    const port = process.env.PORT || 3000;
    
    // Add query parameters to the URL
    let fullUrl = `http://127.0.0.1:${port}${urlPath}`;
    if (!fullUrl.includes('?') && state.params) {
      const q = qs.stringify(state.params);
      if (q) fullUrl += `?${q}`;
    }

    const formData = qs.stringify({
      CallSid: callControlId,
      From: state.toPhone,
      To: process.env.TELNYX_PHONE_NUMBER,
      ...twilioBody
    });

    const res = await axios.post(fullUrl, formData, {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
    });

    const twiml = res.data;
    
    // Some routes return 200 OK without XML, just ignore
    if (!twiml || typeof twiml !== 'string' || !twiml.trim().startsWith('<')) {
      return;
    }

    const parser = new xml2js.Parser({ explicitArray: false });
    const parsed = await parser.parseStringPromise(twiml);
    const responseNode = parsed.Response || {};

    let sayText = '';
    let gatherNode = null;
    let redirectUrl = null;
    let hangup = false;

    const extractText = (node) => {
      if (!node) return '';
      if (typeof node === 'string') return node;
      let text = '';
      if (node._) text += node._ + ' ';
      for (const [key, value] of Object.entries(node)) {
        if (key === '$' || key === '_') continue;
        if (Array.isArray(value)) {
          value.forEach(v => text += extractText(v) + ' ');
        } else {
          text += extractText(value) + ' ';
        }
      }
      return text.trim();
    };

    logger.info(`[CALL] Parsed TwiML Response`);

    let sayVoice = 'Polly.Joanna-Neural';
    let sayLanguage = 'en-US';

    if (responseNode.Say) {
      if (Array.isArray(responseNode.Say)) {
        sayText += responseNode.Say.map(extractText).join(' ');
        sayVoice = responseNode.Say[0]?.$?.voice || sayVoice;
      } else {
        sayText += extractText(responseNode.Say);
        sayVoice = responseNode.Say.$?.voice || sayVoice;
      }
    }
    
    if (responseNode.Gather) {
      gatherNode = responseNode.Gather;
      if (gatherNode.Say) {
        sayText += ' ' + extractText(gatherNode.Say);
        sayVoice = gatherNode.Say.$?.voice || sayVoice;
      }
    }
    
    sayText = sayText.trim();
    logger.info(`[CALL] Extracted speak payload: "${sayText}" with voice: ${sayVoice}`);

    if (responseNode.Redirect) {
      redirectUrl = typeof responseNode.Redirect === 'string' ? responseNode.Redirect : responseNode.Redirect._;
    }

    if (responseNode.Hangup !== undefined) {
      hangup = true;
    }

    state.nextActionUrl = gatherNode?.$?.action || null;
    state.redirectUrl = redirectUrl || null;
    state.isGathering = !!gatherNode;
    // If the XML wants to hang up after speaking, save that to state so we know to hang up on speak.ended
    state.hangupAfterSpeak = hangup && !gatherNode;

    if (sayText) {
      try {
        await telnyxPost(`/calls/${callControlId}/actions/speak`, {
          payload: toSsml(sayText),
          payload_type: 'ssml',
          voice: sayVoice,
          language: sayLanguage
        });
      } catch (e) {
        // SSML rejected — fall back to plain text so the call still speaks.
        await telnyxPost(`/calls/${callControlId}/actions/speak`, {
          payload: sayText.trim(),
          voice: sayVoice,
          language: sayLanguage
        });
      }
    } else if (hangup) {
      await hangupCall(callControlId);
    }
  } catch (err) {
    logger.error('driveTwilioFlow error:', err);
  }
}

module.exports = router;

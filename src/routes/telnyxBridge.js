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

router.post('/', async (req, res) => {
  res.sendStatus(200); // Always ack Telnyx Webhook quickly
  const event = req.body?.data;
  if (!event) return;

  const eventType = event.event_type;
  const payload = event.payload;
  const callControlId = payload.call_control_id;
  const callSessionId = payload.call_session_id;

  try {
    if (eventType === 'call.initiated') {
      const clientStateStr = payload.client_state;
      if (clientStateStr) {
        const state = JSON.parse(Buffer.from(clientStateStr, 'base64').toString('utf8'));
        activeCalls.set(callSessionId, state);
      }
    }

    const state = activeCalls.get(callSessionId);
    if (!state) return;

    if (eventType === 'call.answered') {
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
        await telnyxPost(`/calls/${callControlId}/actions/hangup`, {});
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
      logger.info(`[CALL] Call ended for call_control_id=${callControlId}`);
      if (state.gatherTimeout) clearTimeout(state.gatherTimeout);
      activeCalls.delete(callSessionId);
      await driveTwilioFlow(callControlId, state, `/webhook/call/status`, { CallStatus: 'completed' });
    }
  } catch (err) {
    logger.error('Telnyx Bridge error:', err);
  }
});

async function driveTwilioFlow(callControlId, state, urlPath, twilioBody = {}) {
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
      await telnyxPost(`/calls/${callControlId}/actions/speak`, {
        payload: sayText.trim(),
        voice: sayVoice,
        language: sayLanguage
      });
    } else if (hangup) {
      await telnyxPost(`/calls/${callControlId}/actions/hangup`, {});
    }
  } catch (err) {
    logger.error('driveTwilioFlow error:', err);
  }
}

module.exports = router;

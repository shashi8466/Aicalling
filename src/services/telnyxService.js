/**
 * Telnyx Voice Service
 * ────────────────────────────────────────────────────────────────────────
 * Replaces Twilio for outbound AI calling.
 * Mirrors the same interface as twilioService.js so all existing callers
 * (api.js, webhook.js, followUpEngine.js, poller.js, etc.) work unchanged.
 *
 * Call flow:
 *  1. telnyxSvc.call(lead, baseUrl, campaignId, campaignVars)
 *     → POST /v2/calls  (Telnyx API)
 *     → Telnyx dials the lead and hits /webhook/call/start when connected
 *  2. Webhook turns use twimlStart / twimlRespond — but Telnyx uses TeXML,
 *     which is 100% compatible with TwiML.  No changes needed in webhooks.
 *  3. endCall(callControlId) terminates an in-progress call.
 */

const axios  = require('axios');
const cfg    = require('../config');
const logger = require('../logger');

// ── Telnyx config (from .env) ──────────────────────────────────────────
const TELNYX_API_KEY     = process.env.TELNYX_API_KEY      || '';
const TELNYX_PHONE       = process.env.TELNYX_PHONE_NUMBER || '';
const TELNYX_APP_ID      = process.env.TELNYX_APP_ID       || '';   // optional: TeXML Application ID
const TELNYX_CONNECTION  = process.env.TELNYX_CONNECTION_ID || '';  // optional: outbound voice profile id
const CALLER_NAME        = process.env.TELNYX_CALLER_NAME || 'Test Prep Pundit'; // display name; carriers may ignore it
const TELNYX_BASE        = 'https://api.telnyx.com/v2';

// Telnyx TeXML is fully TwiML-compatible — we reuse the same VoiceResponse builder
const twilio = require('twilio');
const VR     = twilio.twiml.VoiceResponse;

const VOICE  = 'Polly.Joanna-Neural';
const LANG   = 'en-US';

// ── HTTP client ────────────────────────────────────────────────────────
function telnyxPost(path, payload) {
  return axios.post(`${TELNYX_BASE}${path}`, payload, {
    headers: {
      'Authorization': `Bearer ${TELNYX_API_KEY}`,
      'Content-Type':  'application/json',
      'Accept': 'application/json'
    },
  }).catch(err => {
    const details = err.response?.data;
    const msg = details ? JSON.stringify(details) : err.message;
    throw new Error(`Telnyx API Error: ${msg}`);
  });
}

// ── Validate at call-time (not at startup) ─────────────────────────────
function validateConfig() {
  if (!TELNYX_API_KEY) throw new Error('TELNYX_API_KEY is not set in environment');
  if (!TELNYX_PHONE)   throw new Error('TELNYX_PHONE_NUMBER is not set in environment');
}

class TelnyxService {

  // ── Outbound call ────────────────────────────────────────────────────
  async call(lead, baseUrl, campaignId, campaignVars = null) {
    validateConfig();

    const leadId = (lead._id || lead.id).toString();
    const paramObj = { leadId };
    if (campaignId) paramObj.campaignId = campaignId;
    if (campaignVars) Object.assign(paramObj, campaignVars);

    const clientStateObj = {
      phone: lead.phone,
      params: paramObj
    };

    const payload = {
      to:   lead.phone,
      from: TELNYX_PHONE,
      from_display_name: CALLER_NAME,
      connection_id: TELNYX_APP_ID,
      client_state: Buffer.from(JSON.stringify(clientStateObj)).toString('base64'),
      answering_machine_detection: 'premium'
    };

    const response = await telnyxPost('/calls', payload);
    const callData = response.data?.data || {};
    const callControlId = callData.call_control_id || callData.id;
    const callSid  = callControlId;

    logger.info(`[CALL] Outbound call created`);
    logger.info(`[CALL] call_control_id = ${callControlId}`);
    logger.info(`[Telnyx] Outbound call placed → ${lead.phone}  SID=${callSid}`);
    return { callSid, callControlId, status: 'initiated' };
  }

  // ── Follow-up call ────────────────────────────────────────────────────
  async callFollowUp(lead, baseUrl) {
    validateConfig();

    const leadId = (lead._id || lead.id).toString();
    const clientStateObj = {
      phone: lead.phone,
      params: { leadId, followUp: '1' }
    };

    const payload = {
      to:   lead.phone,
      from: TELNYX_PHONE,
      from_display_name: CALLER_NAME,
      connection_id: TELNYX_APP_ID,
      client_state: Buffer.from(JSON.stringify(clientStateObj)).toString('base64'),
      answering_machine_detection: 'premium'
    };

    const response = await telnyxPost('/calls', payload);
    const callData = response.data?.data || {};
    const callControlId = callData.call_control_id || callData.id;
    const callSid  = callControlId;

    logger.info(`[CALL] Follow-up call created`);
    logger.info(`[CALL] call_control_id = ${callControlId}`);
    logger.info(`[Telnyx] Follow-up call placed → ${lead.phone}  SID=${callSid}`);
    return { callSid, callControlId: callSid, status: 'initiated' };
  }

  // ── End call (admin stop) ─────────────────────────────────────────────
  async endCall(callSid) {
    if (!callSid) throw new Error('No callSid provided');
    validateConfig();
    
    // Update call status to completed
    await telnyxPost(`/calls/${callSid}/actions/hangup`, {});
    logger.info(`[Telnyx] Hung up call ${callSid}`);
  }

  // ── Expose "client" shim — used by webhook AMD hangup ─────────────────
  _client() {
    // Return a minimal shim that mirrors the Twilio client interface used in webhook.js
    return {
      calls: (sid) => ({
        update: async ({ status }) => {
          if (status === 'completed') {
            await this.endCall(sid);
          }
        },
      }),
    };
  }


  // ════════════════════════════════════════════════════════════════════════
  //  TeXML / TwiML builders — Telnyx supports TwiML (TeXML) natively,
  //  so these are identical to twilioService.js.
  // ════════════════════════════════════════════════════════════════════════

  _speak(parent, text) {
    const spokenText = String(text).replace(/\b(SAT|Sat|S\.A\.T\.)\b/g, 'S-A-T');
    const say = parent.say({ voice: VOICE, language: LANG });
    const parts = spokenText.split(/(?<=\?)\s+/).filter(Boolean);
    parts.forEach((p, i) => {
      say.prosody({ rate: '92%' }, p);
      if (i < parts.length - 1) say.break({ strength: 'strong', time: '600ms' });
    });
    return say;
  }

  twimlStart(text, gatherUrl, opts = {}) {
    const r = new VR();
    if (opts.bargeIn) {
      const g = r.gather({
        input: 'speech', action: gatherUrl, method: 'POST',
        speechTimeout: '1', enhanced: 'true', speechModel: 'phone_call',
        language: LANG, timeout: 5,
      });
      this._speak(g, text);
      r.redirect({ method: 'POST' }, gatherUrl + '&noSpeech=1');
      return r.toString();
    }
    this._speak(r, text);
    r.gather({
      input: 'speech', action: gatherUrl, method: 'POST',
      speechTimeout: '1', enhanced: 'true', speechModel: 'phone_call',
      language: LANG, timeout: 5,
    });
    r.redirect({ method: 'POST' }, gatherUrl + '&noSpeech=1');
    return r.toString();
  }

  twimlRespond(text, gatherUrl, opts = {}) {
    return this.twimlStart(text, gatherUrl, opts);
  }

  twimlListen(gatherUrl) {
    const r = new VR();
    r.gather({
      input: 'speech', action: gatherUrl, method: 'POST',
      speechTimeout: '1', enhanced: 'true', speechModel: 'phone_call',
      language: LANG, timeout: 5,
    });
    r.redirect({ method: 'POST' }, gatherUrl + '&noSpeech=1');
    return r.toString();
  }

  twimlOfferSlots(intro, slots, bookUrl) {
    const r = new VR();
    const optionWords = ['Option one', 'Option two', 'Option three', 'Option four'];
    const slotSpeech = slots.map((s, i) => `${optionWords[i] || `Option ${i + 1}`}: ${s.displayTime}`).join('. ');
    const choiceWords = slots.length === 4 ? 'option one, option two, option three, or option four'
      : slots.length === 3 ? 'option one, option two, or option three'
      : 'option one or option two';
    const fullText = `${intro} I currently have the following available times. ${slotSpeech}. Which works best for you? You can say ${choiceWords}.`;
    this._speak(r, fullText);
    r.gather({
      input: 'speech', action: bookUrl, method: 'POST',
      speechTimeout: '1', speechModel: 'phone_call', language: LANG, timeout: 8,
    });
    r.redirect({ method: 'POST' }, bookUrl + '&noSpeech=1');
    return r.toString();
  }

  twimlBookingConfirm(text) {
    const r = new VR();
    this._speak(r, text);
    r.hangup();
    return r.toString();
  }

  twimlVoicemail(lead) {
    const r = new VR();
    this._speak(r,
      `Hi, this is Annie, your AI Assistant from Test Prep Pundits. ` +
      `I'm calling for ${lead.fullName} to follow up on your recent demo test with us. ` +
      `Please call us back at ${cfg.company.counselorPhone} or visit ${cfg.company.website}. ` +
      `We look forward to helping you achieve your target score. Have a great day!`
    );
    r.hangup();
    return r.toString();
  }

  twimlHangup(text = 'Thank you for your time. Have a wonderful day! Goodbye.') {
    const r = new VR();
    this._speak(r, text);
    r.hangup();
    return r.toString();
  }
}

module.exports = new TelnyxService();

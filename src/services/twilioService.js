/**
 * Twilio Voice Service
 * – Initiates outbound calls
 * – Builds TwiML responses for conversation turns
 * – Voicemail detection
 */
const twilio = require('twilio');
const cfg    = require('../config');
const logger = require('../logger');

const client = twilio(cfg.twilio.accountSid, cfg.twilio.authToken);
const VR     = twilio.twiml.VoiceResponse;

const VOICE  = 'Polly.Matthew-Neural';  // natural US English male voice
const LANG   = 'en-US';

class TwilioService {

  /** Place an outbound call to `lead.phone` */
  async call(lead, baseUrl, campaignId) {
    const leadId = lead._id.toString();
    const params = new URLSearchParams({ leadId });
    if (campaignId) params.set('campaignId', campaignId);

    const call = await client.calls.create({
      to:   lead.phone,
      from: cfg.twilio.phoneNumber,

      // TwiML entry point — fires IMMEDIATELY when human answers
      url:    `${baseUrl}/webhook/call/start?${params}`,
      method: 'POST',

      // Status updates
      statusCallback:        `${baseUrl}/webhook/call/status?${params}`,
      statusCallbackMethod:  'POST',
      statusCallbackEvent:   ['initiated','ringing','answered','completed'],

      // Recording
      record:                        true,
      recordingStatusCallback:       `${baseUrl}/webhook/call/recording?${params}`,
      recordingStatusCallbackMethod: 'POST',

      // Async AMD — webhook fires immediately on connect, AMD runs in background.
      // If machine detected, /webhook/call/amd receives the result and leaves voicemail.
      machineDetection:              'Enable',
      asyncAmd:                      'true',
      asyncAmdStatusCallback:        `${baseUrl}/webhook/call/amd?${params}`,
      asyncAmdStatusCallbackMethod:  'POST',

      timeout: 30,
    });

    logger.info(`Outbound call placed → ${lead.phone}  SID=${call.sid}`);
    return { callSid: call.sid, status: call.status };
  }


  // ── TwiML builders ──────────────────────────────────────────────────

  /**
   * Speak text with natural voice settings:
   *  – 92% speaking rate (recommended 0.92x)
   *  – 600ms pause after each question (recommended 500–800ms)
   * Uses Twilio's SSML helper API (raw XML strings would be escaped).
   */
  _speak(parent, text) {
    const say = parent.say({ voice: VOICE, language: LANG });
    // Split on question marks so we can insert a natural pause after each question
    const parts = String(text).split(/(?<=\?)\s+/).filter(Boolean);
    parts.forEach((p, i) => {
      say.prosody({ rate: '92%' }, p);
      if (i < parts.length - 1) say.break({ strength: 'strong', time: '600ms' });
    });
    return say;
  }

  /**
   * Say text then listen — <Say> is OUTSIDE <Gather> so it can never be
   * cut off by barge-in (student pickup noise, background sound, etc.).
   * Twilio only starts listening after the agent has finished speaking.
   */
  twimlStart(text, gatherUrl) {
    const r = new VR();

    // 1. Speak fully — not interruptible
    this._speak(r, text);

    // 2. Now listen for their response immediately
    r.gather({
      input:         'speech',
      action:        gatherUrl,
      method:        'POST',
      speechTimeout: '1',
      speechModel:   'phone_call',
      language:      LANG,
      timeout:       5,       // wait up to 5s for them to start speaking
    });

    // 3. Fallback if no speech at all
    r.redirect({ method: 'POST' }, gatherUrl + '&noSpeech=1');
    return r.toString();
  }

  /** Mid-conversation turn — same non-interruptible pattern */
  twimlRespond(text, gatherUrl) {
    return this.twimlStart(text, gatherUrl);
  }

  /** Offer meeting slots – announce real date + time, gather slot choice */
  twimlOfferSlots(intro, slots, bookUrl) {
    const r = new VR();

    // Build a natural spoken slot list
    const optionWords = ['Option one', 'Option two', 'Option three', 'Option four'];
    const slotSpeech = slots
      .map((s, i) => `${optionWords[i] || `Option ${i+1}`}: ${s.displayTime}`)
      .join('. ');
    const choiceWords = slots.length === 4 ? 'option one, option two, option three, or option four'
                      : slots.length === 3 ? 'option one, option two, or option three'
                      : 'option one or option two';

    const fullText = `${intro} I currently have the following available times. ${slotSpeech}. Which works best for you? You can say ${choiceWords}.`;

    // Speak slot options fully — not interruptible
    this._speak(r, fullText);

    // Then listen for their slot choice immediately
    r.gather({
      input:         'speech',
      action:        bookUrl,
      method:        'POST',
      speechTimeout: '1',
      speechModel:   'phone_call',
      language:      LANG,
      timeout:       8,
    });
    r.redirect({ method: 'POST' }, bookUrl + '&noSpeech=1');
    return r.toString();
  }

  /** Meeting booked confirmation then hangup */
  twimlBookingConfirm(text) {
    const r = new VR();
    this._speak(r, text);
    r.hangup();
    return r.toString();
  }

  /** Voicemail – say message then hang up */
  twimlVoicemail(lead) {
    const r = new VR();
    this._speak(r,
      `Hello, this is Shashi from Aiprep365. ` +
      `I'm calling for ${lead.fullName} to follow up on your recent demo test with us. ` +
      `Please call us back at ${cfg.company.counselorPhone} or visit ${cfg.company.website}. ` +
      `We look forward to helping you achieve your target score. Have a great day!`
    );
    r.hangup();
    return r.toString();
  }

  /** Place a follow-up call (Day 3 AI re-engagement) */
  async callFollowUp(lead, baseUrl) {
    const leadId = lead._id.toString();
    const params = new URLSearchParams({ leadId, followUp: '1' });

    const call = await client.calls.create({
      to:   lead.phone,
      from: cfg.twilio.phoneNumber,
      url:    `${baseUrl}/webhook/call/start?${params}`,
      method: 'POST',
      statusCallback:        `${baseUrl}/webhook/call/status?${params}`,
      statusCallbackMethod:  'POST',
      statusCallbackEvent:   ['initiated','ringing','answered','completed'],
      record:                        true,
      recordingStatusCallback:       `${baseUrl}/webhook/call/recording?${params}`,
      recordingStatusCallbackMethod: 'POST',
      machineDetection:             'Enable',
      asyncAmd:                     'true',
      asyncAmdStatusCallback:       `${baseUrl}/webhook/call/amd?${params}`,
      asyncAmdStatusCallbackMethod: 'POST',
      timeout: 30,
    });

    logger.info(`Follow-up call placed → ${lead.phone}  SID=${call.sid}`);
    return { callSid: call.sid, status: call.status };
  }

  /** Expose client for AMD hangup */
  _client() { return client; }

  /** Forcefully end an in-progress call by SID (admin Stop Call) */
  async endCall(callSid) {
    if (!callSid) throw new Error('No callSid provided');
    return client.calls(callSid).update({ status: 'completed' });
  }

  /** End call gracefully */
  twimlHangup(text = 'Thank you for your time. Have a wonderful day! Goodbye.') {
    const r = new VR();
    this._speak(r, text);
    r.hangup();
    return r.toString();
  }
}

module.exports = new TwilioService();



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
  async call(lead, baseUrl) {
    const leadId = lead._id.toString();
    const params = new URLSearchParams({ leadId });

    const call = await client.calls.create({
      to:   lead.phone,
      from: cfg.twilio.phoneNumber,

      // TwiML entry point
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

      // Answering machine detection
      machineDetection:        'DetectMessageEnd',
      machineDetectionTimeout: 6000,

      timeout: 30,   // ring for 30 s before giving up
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

  /** Opening greeting – gathers first response */
  twimlStart(text, gatherUrl) {
    const r = new VR();
    const g = r.gather({
      input:        'speech',
      action:       gatherUrl,
      method:       'POST',
      speechTimeout:'auto',
      language:     LANG,
      timeout:      5,
    });
    this._speak(g, text);
    // Fallback if no speech detected
    r.redirect({ method: 'POST' }, gatherUrl + '&noSpeech=1');
    return r.toString();
  }

  /** Mid-conversation turn – say AI reply then gather next input */
  twimlRespond(text, gatherUrl) {
    return this.twimlStart(text, gatherUrl);   // same structure
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

    const g = r.gather({
      input:        'speech',
      action:       bookUrl,
      method:       'POST',
      speechTimeout:'auto',
      language:     LANG,
      timeout:      12,
    });
    this._speak(g, fullText);
    r.redirect({ method: 'POST' }, bookUrl + '&noSpeech=1');
    return r.toString();
  }

  /** Meeting booked confirmation then hangup */
  twimlBookingConfirm(text) {
    const r = new VR();
    this._speak(r, text);
    r.pause({ length: 1 });
    r.hangup();
    return r.toString();
  }

  /** Voicemail – say message then hang up */
  twimlVoicemail(lead) {
    const r = new VR();
    this._speak(r,
      `Hello, this is Shashi from Test Prep Pundits. ` +
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
      machineDetection:        'DetectMessageEnd',
      machineDetectionTimeout: 6000,
      timeout: 30,
    });

    logger.info(`Follow-up call placed → ${lead.phone}  SID=${call.sid}`);
    return { callSid: call.sid, status: call.status };
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

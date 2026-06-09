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

  /** Opening greeting – gathers first response */
  twimlStart(text, gatherUrl) {
    const r = new VR();
    const g = r.gather({
      input:        'speech',
      action:       gatherUrl,
      method:       'POST',
      speechTimeout:'auto',
      speechModel:  'phone_call',
      enhanced:     'true',
      language:     LANG,
      timeout:      5,
    });
    g.say({ voice: VOICE, language: LANG }, text);
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

    // Build a natural spoken slot list with clear date AND time
    const slotSpeech = slots.map((s, i) => {
      const label = i === 0 ? 'Option one' : i === 1 ? 'Option two' : 'Option three';
      return `${label}: ${s.displayTime}`;
    }).join('. ');

    const fullText = `${intro} I currently have these available times. ${slotSpeech}. Which option works best for you? You can say option one, option two, or option three.`;

    const g = r.gather({
      input:        'speech',
      action:       bookUrl,
      method:       'POST',
      speechTimeout:'auto',
      speechModel:  'phone_call',
      enhanced:     'true',
      language:     LANG,
      timeout:      10,
    });
    g.say({ voice: VOICE, language: LANG }, fullText);
    r.redirect({ method: 'POST' }, bookUrl + '&noSpeech=1');
    return r.toString();
  }

  /** Meeting booked confirmation then hangup */
  twimlBookingConfirm(text) {
    const r = new VR();
    r.say({ voice: VOICE, language: LANG }, text);
    r.pause({ length: 1 });
    r.hangup();
    return r.toString();
  }

  /** Voicemail – say message then hang up */
  twimlVoicemail(lead) {
    const r = new VR();
    r.say({ voice: VOICE, language: LANG },
      `Hello, this is Shashi from Test Prep Pundits. ` +
      `I'm calling for ${lead.fullName} to follow up on your recent demo test with us. ` +
      `Please call us back at ${cfg.company.counselorPhone} or visit ${cfg.company.website}. ` +
      `We look forward to helping you achieve your target score. Have a great day!`
    );
    r.hangup();
    return r.toString();
  }

  /** End call gracefully */
  twimlHangup(text = 'Thank you for your time. Have a wonderful day! Goodbye.') {
    const r = new VR();
    r.say({ voice: VOICE, language: LANG }, text);
    r.hangup();
    return r.toString();
  }
}

module.exports = new TwilioService();

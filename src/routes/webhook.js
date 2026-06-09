/**
 * Twilio Webhook Routes
 * ─────────────────────────────────────────────────────────
 * POST /webhook/call/start      – called when call connects
 * POST /webhook/call/respond    – every conversation turn
 * POST /webhook/call/slots      – offer available meeting slots
 * POST /webhook/call/book       – confirm slot choice & book
 * POST /webhook/call/status     – call lifecycle events
 * POST /webhook/call/recording  – recording ready
 */
const express        = require('express');
const router         = express.Router();
const Lead           = require('../models/Lead');
const twilioSvc      = require('../services/twilioService');
const aiSvc          = require('../services/aiService');
const calendarSvc    = require('../services/calendarService');
const emailSvc       = require('../services/emailService');
const sheetsSvc      = require('../services/sheetsService');
const { scoreLead, detectSentiment } = require('../services/leadScoring');
const logger         = require('../logger');
const cfg            = require('../config');

// In-memory conversation store  { leadId → { history, slots } }
const sessions = new Map();

// ── Helper to build the per-turn respond URL ──────────────────────────────────
function respondUrl(baseUrl, leadId) {
  return `${baseUrl}/webhook/call/respond?leadId=${leadId}`;
}
function slotsUrl(baseUrl, leadId) {
  return `${baseUrl}/webhook/call/slots?leadId=${leadId}`;
}
function bookUrl(baseUrl, leadId) {
  return `${baseUrl}/webhook/call/book?leadId=${leadId}`;
}

// ── STEP 1 – Call connects ─────────────────────────────────────────────────────
router.post('/call/start', async (req, res) => {
  const { leadId }     = req.query;
  const { AnsweredBy } = req.body;
  res.type('text/xml');

  try {
    const lead = await Lead.findById(leadId);
    if (!lead) return res.send(twilioSvc.twimlHangup());

    // Answering machine → leave voicemail
    if (AnsweredBy && AnsweredBy.startsWith('machine')) {
      await _markAttempt(lead, req.body.CallSid, 'voicemail');
      await emailSvc.sendNoAnswer(lead);
      return res.send(twilioSvc.twimlVoicemail(lead));
    }

    // Human answered
    sessions.set(leadId, { history: [], turnCount: 0 });

    const hour   = new Date().getHours();
    const greet  = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
    const who    = lead.parentName || lead.fullName;
    const studentFirst = lead.fullName.split(' ')[0];
    const opener = `Hello, this is Shashi from Test Prep Pundits. Am I speaking with ${studentFirst}?`;

    res.send(twilioSvc.twimlStart(opener, respondUrl(cfg.server.baseUrl, leadId)));
  } catch (err) {
    logger.error('webhook/start error', { msg: err.message });
    res.send(twilioSvc.twimlHangup());
  }
});

// ── STEP 2 – Conversation loop ─────────────────────────────────────────────────
router.post('/call/respond', async (req, res) => {
  const { leadId, noSpeech } = req.query;
  const speech = (req.body.SpeechResult || '').trim();
  res.type('text/xml');

  try {
    const lead    = await Lead.findById(leadId);
    if (!lead) return res.send(twilioSvc.twimlHangup());

    const session = sessions.get(leadId) || { history: [], turnCount: 0 };

    // No speech detected
    if (!speech || noSpeech) {
      session.turnCount++;
      if (session.turnCount > 3) {
        return res.send(twilioSvc.twimlHangup(
          `It seems like we may have lost you. No worries! I'll send you an email with our program details. Have a great day, ${lead.fullName}!`
        ));
      }
      sessions.set(leadId, session);
      return res.send(twilioSvc.twimlRespond(
        "I'm sorry, I didn't catch that. Could you say that again?",
        respondUrl(cfg.server.baseUrl, leadId)
      ));
    }

    // Detect end-call intent
    const endPhrases = ['goodbye','bye','hang up','not interested','stop calling','remove me','do not call','not right now and i mean it'];
    if (endPhrases.some(p => speech.toLowerCase().includes(p))) {
      await _finaliseCall(lead, session, req.body.CallSid, 'ended-by-caller');
      return res.send(twilioSvc.twimlHangup(
        `Thank you for your time, ${lead.fullName}. If you'd like to reconnect in the future, just visit ${cfg.company.website}. Have a wonderful day!`
      ));
    }

    // Add user turn to history
    session.history.push({ role: 'user', content: speech });
    session.turnCount++;

    // Get AI response
    const aiReply = await aiSvc.chat({ lead, history: session.history.slice(-12), userMessage: speech });

    // Add AI turn
    session.history.push({ role: 'assistant', content: aiReply });
    sessions.set(leadId, session);

    // Check for special tokens
    if (aiReply.includes('[OFFER_MEETING]')) {
      const clean = aiReply.replace('[OFFER_MEETING]', '').trim();
      // Transition to slot-offering step (handled in /slots)
      return res.send(twilioSvc.twimlStart(
        clean + ' Let me pull up our available times for a quick consultation.',
        slotsUrl(cfg.server.baseUrl, leadId)
      ));
    }

    if (aiReply.includes('[END_CALL]')) {
      const clean = aiReply.replace('[END_CALL]', '').trim();
      await _finaliseCall(lead, session, req.body.CallSid, 'completed');
      return res.send(twilioSvc.twimlHangup(clean || 'Thank you for your time. Have a wonderful day!'));
    }

    res.send(twilioSvc.twimlRespond(aiReply, respondUrl(cfg.server.baseUrl, leadId)));
  } catch (err) {
    logger.error('webhook/respond error', { msg: err.message });
    res.send(twilioSvc.twimlRespond(
      "I'm sorry, I had a brief issue. Could you say that one more time?",
      respondUrl(cfg.server.baseUrl, leadId)
    ));
  }
});

// ── STEP 3 – Offer available meeting slots ─────────────────────────────────────
router.post('/call/slots', async (req, res) => {
  const { leadId } = req.query;
  res.type('text/xml');

  try {
    const lead  = await Lead.findById(leadId);
    if (!lead) return res.send(twilioSvc.twimlHangup());

    const slots = await calendarSvc.getAvailableSlots(3);
    if (!slots.length) {
      return res.send(twilioSvc.twimlRespond(
        "I'm having trouble accessing our calendar right now. I'll have a counselor follow up with available times. Is email or a text message better for you?",
        respondUrl(cfg.server.baseUrl, leadId)
      ));
    }

    // Store slots in session for the booking step
    const session = sessions.get(leadId) || { history: [], turnCount: 0 };
    session.slots = slots;
    sessions.set(leadId, session);

    const bUrl = bookUrl(cfg.server.baseUrl, leadId);
    const studentFirst = lead.fullName.split(' ')[0];
    return res.send(twilioSvc.twimlOfferSlots(
      `Great! I'm pulling up the next available slots for ${studentFirst}'s free 10 to 15 minute consultation.`,
      slots,
      bUrl
    ));
  } catch (err) {
    logger.error('webhook/slots error', { msg: err.message });
    res.send(twilioSvc.twimlHangup("I'm having a technical issue. We'll follow up by email shortly."));
  }
});

// ── STEP 4 – Book the chosen slot ─────────────────────────────────────────────
router.post('/call/book', async (req, res) => {
  const { leadId, noSpeech } = req.query;
  const speech = (req.body.SpeechResult || '').toLowerCase();
  res.type('text/xml');

  try {
    const lead    = await Lead.findById(leadId);
    const session = sessions.get(leadId) || {};
    const slots   = session.slots || [];

    if (!lead || !slots.length) return res.send(twilioSvc.twimlHangup());

    // Determine which slot was chosen
    let chosen = null;
    if (speech.includes('first') || speech.includes('one') || speech.includes('1') || speech.includes('earlier') || speech.includes('sooner')) {
      chosen = slots[0];
    } else if (speech.includes('second') || speech.includes('two') || speech.includes('2') || speech.includes('later') || speech.includes('other')) {
      chosen = slots[1] || slots[0];
    } else if (speech.includes('third') || speech.includes('three') || speech.includes('3') || speech.includes('last')) {
      chosen = slots[2] || slots[0];
    } else if (speech.includes('yes') || speech.includes('sure') || speech.includes('ok') || speech.includes('works') || speech.includes('good')) {
      chosen = slots[0];
    }

    if (!chosen) {
      return res.send(twilioSvc.twimlStart(
        `I'm sorry, I didn't catch which time you preferred. Please say "first", "second", or "third" to choose your slot.`,
        bookUrl(cfg.server.baseUrl, leadId)
      ));
    }

    // Book it
    const booking = await calendarSvc.bookMeeting(lead, chosen);

    lead.meeting = {
      googleEventId: booking.googleEventId,
      meetLink:      booking.meetLink,
      scheduledAt:   booking.scheduledAt,
      status:        'scheduled',
    };
    lead.status      = 'meeting-scheduled';
    lead.isQualified = true;

    // Score update
    const { score, category, breakdown } = scoreLead(lead);
    lead.leadScore    = score;
    lead.leadCategory = category;
    await lead.save();

    // ── Post-call async tasks ──────────────────────────────────────
    setImmediate(async () => {
      try {
        // 1. Sheet update
        await sheetsSvc.updateRow(lead.sheetRowIndex, {
          status:  'Meeting Scheduled',
          score,
          summary: `Meeting booked: ${booking.scheduledAt.toLocaleString()}. Score: ${score}/100.`,
        });
        // 2. Email confirmation
        await emailSvc.sendMeetingConfirmation(lead);
      } catch (e) {
        logger.error('Post-booking tasks failed', { msg: e.message });
      }
    });

    const studentFirst = lead.fullName.split(' ')[0];
    const confirmMsg =
      `Perfect! I've scheduled ${studentFirst}'s free consultation for ${chosen.displayTime}. ` +
      `You'll receive a confirmation email with the Google Meet link and all details shortly. ` +
      `We're really looking forward to working with ${studentFirst}. Have a wonderful day!`;

    return res.send(twilioSvc.twimlBookingConfirm(confirmMsg));
  } catch (err) {
    logger.error('webhook/book error', { msg: err.message });
    res.send(twilioSvc.twimlHangup(
      "I'm sorry, I had a problem booking that slot. Our team will follow up by email to confirm a time. Thank you!"
    ));
  }
});

// ── Call status updates ────────────────────────────────────────────────────────
router.post('/call/status', async (req, res) => {
  const { leadId } = req.query;
  const { CallStatus, CallDuration, CallSid } = req.body;
  res.sendStatus(200);

  try {
    const lead = await Lead.findById(leadId);
    if (!lead) return;

    const attempt = lead.callAttempts.find(a => a.callSid === CallSid);
    if (attempt) {
      attempt.status   = CallStatus;
      attempt.duration = parseInt(CallDuration) || 0;
      attempt.endTime  = new Date();
    }

    if (CallStatus === 'completed') {
      const session = sessions.get(leadId);
      if (session) {
        await _finaliseCall(lead, session, CallSid, 'completed');
        sessions.delete(leadId);
      }
    }

    if (['no-answer','busy','failed'].includes(CallStatus)) {
      lead.status = 'queued';

      // Schedule retry if attempts remain
      if (lead.totalCallAttempts < cfg.call.maxAttempts) {
        const retryMs = cfg.call.retryDelayMinutes * 60 * 1000;
        lead.nextRetryAt = new Date(Date.now() + retryMs);
      } else {
        lead.status = 'lost';
      }

      await lead.save();

      // Send no-answer email
      setImmediate(() => emailSvc.sendNoAnswer(lead).catch(() => {}));

      // Update sheet
      setImmediate(() => sheetsSvc.updateRow(lead.sheetRowIndex, {
        status:  CallStatus === 'no-answer' ? 'No Answer' : 'Failed',
        score:   lead.leadScore,
        summary: `Call ${CallStatus} on attempt ${lead.totalCallAttempts}.`,
      }).catch(() => {}));
    }
  } catch (err) {
    logger.error('webhook/status error', { msg: err.message });
  }
});

// ── Recording ready ────────────────────────────────────────────────────────────
router.post('/call/recording', async (req, res) => {
  const { leadId } = req.query;
  const { RecordingUrl, RecordingSid } = req.body;
  res.sendStatus(200);

  try {
    const lead = await Lead.findById(leadId);
    if (!lead) return;
    const attempt = lead.callAttempts[lead.callAttempts.length - 1];
    if (attempt) {
      attempt.recordingUrl = `${RecordingUrl}.mp3`;
    }
    await lead.save();
    logger.info(`Recording saved for ${lead.fullName}: ${RecordingUrl}`);
  } catch (err) {
    logger.error('webhook/recording error', { msg: err.message });
  }
});

// ── Internal: finalise a completed call ───────────────────────────────────────
async function _finaliseCall(lead, session, callSid, reason) {
  try {
    const transcript = (session.history || [])
      .map(m => `${m.role === 'user' ? 'Caller' : 'Shashi Kumar'}: ${m.content}`)
      .join('\n');

    const sentiment  = detectSentiment(transcript);
    const aiSummary  = transcript.length > 80
      ? await aiSvc.summariseCall(transcript, lead)
      : `Call ${reason}. No significant transcript.`;

    // Extract qualification data from transcript
    if (transcript.length > 80) {
      const qual = await aiSvc.extractQualification(transcript);
      lead.qualification = { ...(lead.qualification || {}), ...qual };
    }

    // Update or create call attempt record
    let attempt = callSid ? lead.callAttempts.find(a => a.callSid === callSid) : null;
    if (!attempt && lead.callAttempts.length) attempt = lead.callAttempts[lead.callAttempts.length - 1];
    if (attempt) {
      attempt.transcript = transcript;
      attempt.sentiment  = sentiment;
      attempt.aiSummary  = aiSummary;
      attempt.status     = 'completed';
    }

    // Recalculate score
    const { score, category } = scoreLead(lead);
    lead.leadScore    = score;
    lead.leadCategory = category;

    if (lead.status === 'calling') lead.status = 'contacted';
    await lead.save();

    // Update sheet
    await sheetsSvc.updateRow(lead.sheetRowIndex, {
      status:  lead.status,
      score,
      summary: aiSummary.slice(0, 500),
    });

    logger.info(`Call finalised for ${lead.fullName} | score=${score} | sentiment=${sentiment}`);
  } catch (err) {
    logger.error('_finaliseCall error', { msg: err.message });
  }
}

async function _markAttempt(lead, callSid, status) {
  lead.totalCallAttempts += 1;
  lead.callAttempts.push({
    attemptNumber: lead.totalCallAttempts,
    callSid,
    startTime: new Date(),
    endTime:   new Date(),
    status,
  });
  lead.lastCallAt = new Date();
  await lead.save();
}

module.exports = router;

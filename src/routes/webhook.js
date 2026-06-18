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
const OpenAI         = require('openai');
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

/**
 * Deterministically checks whether the caller's first reply confirms their identity.
 * Matches all accepted confirmation phrases regardless of case or minor punctuation.
 * @param {string} lowSpeech  - caller speech already lowercased
 * @param {string} firstName  - student's first name already lowercased
 * @returns {boolean}
 */
function isIdentityConfirmed(lowSpeech, firstName) {
  // Generic affirmations
  const genericOk = /^(yes|yeah|yep|yup|correct|speaking|sure|absolutely|of course|that'?s? me|that is me)[\.!,]?$/.test(lowSpeech.trim());
  if (genericOk) return true;

  // Name-based confirmations
  const namePatterns = [
    `yes i'?m ${firstName}`,
    `i am ${firstName}`,
    `this is ${firstName}`,
    `you'?re speaking with ${firstName}`,
    `you are speaking with ${firstName}`,
    `${firstName} speaking`,
    `${firstName} here`,
    `speaking with ${firstName}`,
    `it'?s ${firstName}`,
    `it is ${firstName}`,
    `kumar speaking`,  // covers counselor-name variant from rules
  ];
  return namePatterns.some(p => lowSpeech.includes(p));
}

/**
 * Detects program intent from caller speech.
 * Returns the detected program or null if not recognized.
 */
function detectProgramIntent(lowSpeech) {
  const s = lowSpeech.trim();
  // Match SAT, ACT, AP, College Admissions in any case/form
  if (/\bsat\b/.test(s)) return 'SAT';
  if (/\bact\b/.test(s)) return 'ACT';
  if (/\bap\b/.test(s)) return 'AP';
  if (/\b(college|admissions)\b/.test(s)) return 'College Admissions';
  return null;
}

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

// ── STEP 1 – Call connects → speak immediately ────────────────────────────────
// With asyncAmd, this webhook fires the moment a human (or machine) answers.
// We don't wait for AMD — we start speaking right away.
// Machine detection result arrives separately at /webhook/call/amd.
router.post('/call/start', async (req, res) => {
  const { leadId } = req.query;
  res.type('text/xml');

  try {
    const lead = await Lead.findById(leadId);
    if (!lead) return res.send(twilioSvc.twimlHangup());

    const isFollowUp = req.query.followUp === '1';
    sessions.set(leadId, { history: [], turnCount: 0, isFollowUp });

    const studentFirst = lead.fullName.split(' ')[0];
    const opener = isFollowUp
      ? `Hello, this is Shashi from Test Prep Pundits. May I please speak with ${studentFirst} or their parent?`
      : `Hello, this is Shashi from Test Prep Pundits. Am I speaking with ${studentFirst}?`;

    res.send(twilioSvc.twimlStart(opener, respondUrl(cfg.server.baseUrl, leadId)));
  } catch (err) {
    logger.error('webhook/start error', { msg: err.message });
    res.send(twilioSvc.twimlHangup());
  }
});

// ── ASYNC AMD CALLBACK – fires after machine detection completes ───────────────
// If it's a machine, hang up the live call and leave voicemail via a separate call.
router.post('/call/amd', async (req, res) => {
  res.sendStatus(200);
  const { leadId } = req.query;
  const { AnsweredBy, CallSid } = req.body;

  if (!AnsweredBy || !AnsweredBy.startsWith('machine')) return; // human — nothing to do

  try {
    const lead = await Lead.findById(leadId);
    if (!lead) return;

    logger.info(`AMD detected machine for ${lead.fullName} — hanging up live call`);

    // Hang up the in-progress call
    await require('../services/twilioService')._client()
      .calls(CallSid)
      .update({ status: 'completed' })
      .catch(() => {});

    await _markAttempt(lead, CallSid, 'voicemail');
    await emailSvc.sendNoAnswer(lead).catch(() => {});
  } catch (err) {
    logger.error('AMD callback error', { msg: err.message });
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

    // No speech detected — rephrase, then push to meeting slots. NEVER hang up on silence alone.
    if (!speech || noSpeech) {
      session.silenceCount = (session.silenceCount || 0) + 1;
      sessions.set(leadId, session);

      if (session.silenceCount === 1) {
        return res.send(twilioSvc.twimlRespond(
          "I'm sorry, I didn't quite catch that. Could you please repeat that?",
          respondUrl(cfg.server.baseUrl, leadId)
        ));
      }
      if (session.silenceCount === 2) {
        return res.send(twilioSvc.twimlRespond(
          "I apologize, the connection may not be clear. Could you please say that one more time?",
          respondUrl(cfg.server.baseUrl, leadId)
        ));
      }
      if (session.silenceCount === 3) {
        return res.send(twilioSvc.twimlRespond(
          "No problem. I'd love to help you learn more about our programs. We offer a free 10 to 15 minute consultation with one of our academic advisors who can answer all your questions and recommend the best study plan for you. Would you like me to schedule a free consultation for you?",
          respondUrl(cfg.server.baseUrl, leadId)
        ));
      }
      // 4th+ silence — offer slots directly instead of hanging up
      return res.send(twilioSvc.twimlStart(
        `I may be having trouble hearing you. Let me share some available times for a free consultation — I'll read them out and you can say the one that works for you.`,
        slotsUrl(cfg.server.baseUrl, leadId)
      ));
    }

    // Speech received — reset silence counter
    session.silenceCount = 0;
    const lowSpeech = speech.toLowerCase();

    // ── IDENTITY CONFIRMATION (Turn 0 only) — deterministic, no LLM needed ────
    // On the very first caller reply, check for any confirmed-identity phrase.
    // If matched, immediately deliver the scripted follow-up line.
    // If NOT matched, ask them to confirm identity before proceeding.
    if (session.turnCount === 0) {
      const studentFirst = lead.fullName.split(' ')[0].toLowerCase();
      const confirmed = isIdentityConfirmed(lowSpeech, studentFirst);
      if (confirmed) {
        session.history.push({ role: 'user', content: speech });
        const followUp =
          `Great! I noticed that you recently completed a demo test with Test Prep Pundits. ` +
          `I'm calling to help you learn more about our SAT, ACT, AP, and College Admissions programs. ` +
          `Which program are you interested in?`;
        session.history.push({ role: 'assistant', content: followUp });
        session.turnCount++;
        sessions.set(leadId, session);
        return res.send(twilioSvc.twimlRespond(followUp, respondUrl(cfg.server.baseUrl, leadId)));
      } else {
        // Identity not confirmed on first turn — ask them to clarify who they are
        session.identityConfirmAttempt = (session.identityConfirmAttempt || 0) + 1;
        sessions.set(leadId, session);
        if (session.identityConfirmAttempt === 1) {
          return res.send(twilioSvc.twimlRespond(
            `I'm sorry, I didn't quite catch that. Could you please confirm — am I speaking with ${lead.fullName.split(' ')[0]}?`,
            respondUrl(cfg.server.baseUrl, leadId)
          ));
        } else if (session.identityConfirmAttempt === 2) {
          return res.send(twilioSvc.twimlRespond(
            `I apologize for the confusion. Just to confirm — is this ${lead.fullName}?`,
            respondUrl(cfg.server.baseUrl, leadId)
          ));
        } else {
          // After 3 failed attempts, move forward anyway
          session.history.push({ role: 'user', content: speech });
          const followUp =
            `I understand. I'm calling to help you learn more about our SAT, ACT, AP, and College Admissions programs. Which program are you interested in?`;
          session.history.push({ role: 'assistant', content: followUp });
          session.turnCount++;
          sessions.set(leadId, session);
          return res.send(twilioSvc.twimlRespond(followUp, respondUrl(cfg.server.baseUrl, leadId)));
        }
      }
    }

    // Detect ONLY explicit decline — never end the call on weak signals.
    // The caller must clearly and unambiguously refuse.
    // Soft signals ("maybe", "let me think") are intentionally NOT here — we keep trying.
    const explicitDecline = [
      'not interested',
      'remove me',
      'do not call',
      "don't call",
      'stop calling',
      'never call',
      'take me off',
      "i'm not interested",
      "i am not interested",
    ];
    const meetingBooked = !!session.meetingBooked;

    // Allow goodbye/bye to end ONLY if meeting is already booked
    if (meetingBooked && /\b(goodbye|bye|thanks bye|all done|that's it|nothing else|no questions)\b/.test(lowSpeech)) {
      await _finaliseCall(lead, session, req.body.CallSid, 'completed-after-booking');
      const studentFirst = lead.fullName.split(' ')[0];
      return res.send(twilioSvc.twimlHangup(
        `Thank you for choosing Test Prep Pundits. We look forward to helping ${studentFirst} achieve their goals. Have a wonderful day!`
      ));
    }

    // Explicit decline — try to rescue with meeting offer before accepting.
    // Only hang up after 2 hard declines WITH meeting already offered.
    if (explicitDecline.some(p => lowSpeech.includes(p))) {
      session.declineCount = (session.declineCount || 0) + 1;
      sessions.set(leadId, session);

      if (session.declineCount === 1) {
        // First decline → try to reframe and offer a no-obligation slot
        const studentFirst = lead.fullName.split(' ')[0];
        return res.send(twilioSvc.twimlStart(
          `I completely understand — and there's absolutely no pressure. Before I let you go, could I just share one or two available times for a completely free 10-minute chat? It's zero commitment and might answer a question or two you hadn't thought of.`,
          slotsUrl(cfg.server.baseUrl, leadId)
        ));
      }

      if (session.declineCount === 2) {
        // Second decline → one last gentle try
        return res.send(twilioSvc.twimlRespond(
          `I respect that completely. Just one last thought — if ${lead.fullName.split(' ')[0]}'s situation ever changes, we're always here. Could we at least send you some program information by email so you have it when the time is right?`,
          respondUrl(cfg.server.baseUrl, leadId)
        ));
      }

      // Third hard decline → accept and end gracefully
      await _finaliseCall(lead, session, req.body.CallSid, 'ended-by-caller-decline');
      return res.send(twilioSvc.twimlHangup(
        `Absolutely no problem. Thank you so much for your time and have a wonderful day!`
      ));
    }

    // Callback request — FIRST attempt converts to a slot offer; if they insist again, accept.
    // Skip if a meeting is already booked (then it's just chit-chat, let the AI handle it).
    const callbackPhrases = [
      'call me back', 'call back', 'callback', 'call me later', 'call later',
      'another time', 'some other time', 'reach me later', 'contact me later',
      'try me later', 'call again later',
    ];
    if (!meetingBooked && callbackPhrases.some(p => lowSpeech.includes(p))) {
      session.callbackCount = (session.callbackCount || 0) + 1;
      sessions.set(leadId, session);

      if (session.callbackCount === 1) {
        // First callback → make one attempt to lock in a slot now
        return res.send(twilioSvc.twimlStart(
          `Of course! Let me find a time that works so it's confirmed in both our calendars — that way you won't miss it.`,
          slotsUrl(cfg.server.baseUrl, leadId)
        ));
      }

      // Second+ callback after a scheduling attempt → accept gracefully and end
      await _finaliseCall(lead, session, req.body.CallSid, 'ended-callback-requested');
      return res.send(twilioSvc.twimlHangup(
        `Absolutely, I'll make a note to call you back. Thank you so much for your time, and have a wonderful day!`
      ));
    }

    // Detect program intent on turn 1 (after identity confirmation, when answering program question)
    if (session.turnCount === 1) {
      const detectedProgram = detectProgramIntent(lowSpeech);
      if (detectedProgram) {
        logger.info(`Program intent detected: "${detectedProgram}" from speech: "${speech}"`);
      }
    }

    // Add user turn to history
    session.history.push({ role: 'user', content: speech });
    session.turnCount++;

    // If meeting NOT booked AND we've had many turns, proactively offer slots
    const hasTimeMention = /\b(morning|afternoon|evening|monday|tuesday|wednesday|thursday|friday|saturday|sunday|am|pm|o'clock|tomorrow|today|weekend|weekday|next week)\b/i.test(speech);
    if (!session.meetingBooked && hasTimeMention && session.turnCount > 2) {
      logger.info(`Caller mentioned time — proactively offering slots`);
      return res.send(twilioSvc.twimlStart(
        `Great, let me pull up some times that work.`,
        slotsUrl(cfg.server.baseUrl, leadId)
      ));
    }

    // Safety net: too many turns without booking — escalate to slot offering
    if (!session.meetingBooked && session.turnCount >= 12) {
      logger.warn(`Reached turn ${session.turnCount} without booking. Forcing slot offering.`);
      return res.send(twilioSvc.twimlStart(
        `Let me share some times that would work for a quick 10-minute chat — that way ${lead.fullName.split(' ')[0]} doesn't lose any momentum.`,
        slotsUrl(cfg.server.baseUrl, leadId)
      ));
    }

    // Get AI response — use follow-up script if this is a Day-3 follow-up call
    let aiReply;
    if (session.isFollowUp) {
      const { buildFollowUpSystem } = aiSvc;
      const _openai = new OpenAI({ apiKey: cfg.openai.apiKey });
      const sysPrompt = buildFollowUpSystem(lead);
      const msgs = [...session.history.slice(-12), { role: 'user', content: speech }];
      const r = await _openai.chat.completions.create({
        model: 'gpt-4o-mini', max_tokens: 250, temperature: 0.65,
        messages: [{ role: 'system', content: sysPrompt }, ...msgs],
      });
      aiReply = r.choices[0].message.content.trim();
    } else {
      aiReply = await aiSvc.chat({ lead, history: session.history.slice(-12), userMessage: speech });
    }

    // Add AI turn
    session.history.push({ role: 'assistant', content: aiReply });
    sessions.set(leadId, session);

    // Check for special tokens
    if (aiReply.includes('[OFFER_MEETING]')) {
      const clean = aiReply.replace('[OFFER_MEETING]', '').trim();
      // Transition to slot-offering step (handled in /slots)
      // /slots announces: "I currently have the following available times…"
      return res.send(twilioSvc.twimlStart(
        clean || 'Perfect.',
        slotsUrl(cfg.server.baseUrl, leadId)
      ));
    }

    if (aiReply.includes('[END_CALL]')) {
      const clean = aiReply.replace('[END_CALL]', '').trim();

      // GOLDEN RULE: only allow [END_CALL] if meeting is booked OR they explicitly declined
      if (session.meetingBooked) {
        await _finaliseCall(lead, session, req.body.CallSid, 'completed-after-booking');
        return res.send(twilioSvc.twimlHangup(clean || 'Thank you for your time. Have a wonderful day!'));
      }

      // No meeting yet — override the AI and PUSH for one instead of hanging up
      logger.warn(`[END_CALL] suppressed — meeting not booked for ${lead.fullName}. Forcing slot offering.`);
      const studentFirst = lead.fullName.split(' ')[0];
      return res.send(twilioSvc.twimlStart(
        `Before we wrap up, I'd really hate for ${studentFirst} to miss out on this opportunity. Let me find a time that works for you.`,
        slotsUrl(cfg.server.baseUrl, leadId)
      ));
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
      ``,
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

    // Determine which slot was chosen (supports up to 4 options + natural variants)
    let chosen = null;
    const s = ' ' + speech + ' '; // pad for word boundary detection
    if      (/\b(first|one|1|earlier|sooner)\b/.test(s))      chosen = slots[0];
    else if (/\b(second|two|2|later)\b/.test(s))              chosen = slots[1] || slots[0];
    else if (/\b(third|three|3)\b/.test(s))                   chosen = slots[2] || slots[0];
    else if (/\b(fourth|four|4|last)\b/.test(s))              chosen = slots[3] || slots[slots.length - 1];
    else if (/\b(today)\b/.test(s)) chosen = slots.find(sl => sl.displayTime.toLowerCase().includes('today'));
    else if (/\b(tomorrow)\b/.test(s)) chosen = slots.find(sl => sl.displayTime.toLowerCase().includes('tomorrow'));
    else if (/\b(yes|sure|ok|okay|works|good|sounds great|perfect)\b/.test(s)) chosen = slots[0];

    // ── If caller says they want DIFFERENT times, offer fresh slots ───────
    const wantsDifferent = /\b(different|other|another|else|next|later than|earlier than|change|reschedule)\b/.test(s);
    if (!chosen && wantsDifferent) {
      // Fetch a NEW set of slots — skip the ones already offered, pull from later in the week
      const newSlots = await calendarSvc.getAvailableSlots(8);
      const offered  = new Set(slots.map(sl => sl.start));
      const fresh    = newSlots.filter(sl => !offered.has(sl.start)).slice(0, 4);

      if (fresh.length) {
        session.slots = fresh;
        sessions.set(leadId, session);
        return res.send(twilioSvc.twimlOfferSlots(
          `Of course! Let me find some different options for you.`,
          fresh,
          bookUrl(cfg.server.baseUrl, leadId)
        ));
      }
    }

    // ── If caller hesitates ("maybe", "I'll think") — keep pressing gently ──
    const isHesitant = /\b(maybe|think about|not sure|let me check|i'll get back|i need to)\b/.test(s);
    if (!chosen && isHesitant) {
      // Increment hesitation counter
      session.hesitationCount = (session.hesitationCount || 0) + 1;
      sessions.set(leadId, session);

      if (session.hesitationCount === 1) {
        return res.send(twilioSvc.twimlOfferSlots(
          `Totally understand. These are just tentative — you can always reschedule. Here are the options again.`,
          slots,
          bookUrl(cfg.server.baseUrl, leadId)
        ));
      }
      if (session.hesitationCount === 2) {
        // Offer to find any time at all
        return res.send(twilioSvc.twimlStart(
          `No worries. Just tell me roughly when works for you — morning, afternoon, or evening — and what day, and I'll find a slot.`,
          respondUrl(cfg.server.baseUrl, leadId)
        ));
      }
      // After 3+ hesitations, last-resort: just book the first slot tentatively
      chosen = slots[0];
    }

    // ── Still no choice → ask again WITHOUT hanging up ─────────────────
    if (!chosen) {
      const attempts = (session.slotAttempts || 0) + 1;
      session.slotAttempts = attempts;
      sessions.set(leadId, session);

      // On attempt 1: gentle re-ask with the same slots
      if (attempts <= 2) {
        return res.send(twilioSvc.twimlOfferSlots(
          `I'm sorry, I didn't quite catch that. Could you just say option one, option two, or option three?`,
          slots,
          bookUrl(cfg.server.baseUrl, leadId)
        ));
      }

      // On attempt 3+: ask them to describe the time they want in their own words
      if (attempts === 3) {
        return res.send(twilioSvc.twimlStart(
          `No worries — when would you like to chat? Just tell me a day and time that works, like "Friday afternoon" or "Tuesday morning".`,
          respondUrl(cfg.server.baseUrl, leadId)
        ));
      }

      // On attempt 4+: tentatively book the first slot, with permission to change
      chosen = slots[0];
      session.tentativeBooking = true;
    }

    // Book it — try calendar, but never crash the call if it fails
    let booking = null;
    let bookingError = null;
    try {
      booking = await calendarSvc.bookMeeting(lead, chosen);
      logger.info(`✅ Meeting booked for ${lead.fullName}: ${booking.scheduledAt} (calendar: ${booking.calendarUsed})`);
    } catch (err) {
      bookingError = err.message;
      logger.error(`❌ Meeting booking FAILED for ${lead.fullName}`, { msg: err.message });
    }

    const studentFirst = lead.fullName.split(' ')[0];

    if (booking) {
      // ── Booking succeeded ──
      lead.meeting = {
        googleEventId: booking.googleEventId,
        meetLink:      booking.meetLink,
        scheduledAt:   booking.scheduledAt,
        status:        'scheduled',
      };
      lead.status      = 'meeting-scheduled';
      lead.isQualified = true;

      const { score, category } = scoreLead(lead);
      lead.leadScore    = score;
      lead.leadCategory = category;
      await lead.save();

      // 🔑 GOLDEN RULE: mark session so future turns know meeting is booked
      session.meetingBooked = true;
      sessions.set(leadId, session);

      setImmediate(async () => {
        try {
          const moment = require('moment-timezone');
          const scheduledET = moment(booking.scheduledAt).tz('America/New_York');
          await sheetsSvc.updateRow(lead.sheetRowIndex, {
            status:      'Meeting Scheduled',
            score,
            summary:     `Meeting booked for ${scheduledET.format('MMM Do [at] h:mm A z')}. Lead qualified.`,
            meetingDate: scheduledET.format('YYYY-MM-DD'),
            meetingTime: scheduledET.format('h:mm A z'),
            meetLink:    booking.meetLink || '',
          });
          await emailSvc.sendMeetingConfirmation(lead);
        } catch (e) {
          logger.error('Post-booking tasks failed', { msg: e.message });
        }
      });

      const confirmMsg =
        `Great! Your consultation has been scheduled for ${chosen.displayTime}. ` +
        `You will receive a meeting confirmation, a Google Meet link, program details, and a follow-up email shortly. ` +
        `Is there anything else you'd like to know before we end the call?`;
      // Use respond TwiML so we can hear their reply, not hang up immediately
      return res.send(twilioSvc.twimlRespond(
        confirmMsg,
        respondUrl(cfg.server.baseUrl, leadId)
      ));
    }

    // ── Booking failed but we still want a graceful call end ──
    // Save lead with intent-to-book status; counselor follows up manually
    lead.meeting = {
      scheduledAt: new Date(chosen.start),
      status:      'pending-manual',
    };
    lead.status      = 'qualified';
    lead.isQualified = true;
    const { score, category } = scoreLead(lead);
    lead.leadScore    = score;
    lead.leadCategory = category;
    await lead.save();

    // Mark session so call can end gracefully after this confirmation
    session.meetingBooked = true;
    sessions.set(leadId, session);

    setImmediate(async () => {
      try {
        await sheetsSvc.updateRow(lead.sheetRowIndex, {
          status:  'Pending Booking',
          score,
          summary: `Caller agreed to ${chosen.displayTime} — booking pending manual confirmation. Reason: ${bookingError}`,
        });
        // Send manual-follow-up email
        await emailSvc.sendMeetingConfirmation(lead).catch(() => {});
      } catch (e) {
        logger.error('Manual-booking sheet update failed', { msg: e.message });
      }
    });

    const fallbackMsg =
      `Wonderful! I've noted down ${chosen.displayTime} for ${studentFirst}'s consultation. ` +
      `Our team will send you the confirmation email with the Google Meet link within the next few minutes. ` +
      `Thanks so much, and have a great day!`;
    return res.send(twilioSvc.twimlBookingConfirm(fallbackMsg));

  } catch (err) {
    logger.error('webhook/book error', { msg: err.message, stack: err.stack?.split('\n').slice(0,3) });
    res.send(twilioSvc.twimlHangup(
      "Thank you so much! Our team will follow up shortly by email to confirm your consultation time. Have a great day!"
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
      } else {
        // No active session (server restarted, AMD hangup, or call ended
        // before any conversation turn). Still clear the "calling" status so
        // the lead never gets stuck — and persist the attempt update above.
        if (lead.status === 'calling') lead.status = 'contacted';
        await lead.save();
        logger.info(`Call completed for ${lead.fullName} with no active session — status reset to contacted`);
      }
    }

    if (CallStatus === 'canceled') {
      if (lead.status === 'calling') lead.status = 'contacted';
      sessions.delete(leadId);
      await lead.save();
    }

    if (['no-answer','busy','failed'].includes(CallStatus)) {
      sessions.delete(leadId);
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
      .map(m => `${m.role === 'user' ? 'Caller' : 'AGENT'}: ${m.content}`)
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

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
const CallbackRequest = require('../models/CallbackRequest');
const twilioSvc      = require('../services/twilioService');
const aiSvc          = require('../services/aiService');
const { detectMeetingFromTranscript } = aiSvc;
const calendarSvc    = require('../services/calendarService');
const livekitSvc     = require('../services/livekitService');
const emailSvc       = require('../services/emailService');
const sheetsSvc      = require('../services/sheetsService');
const { scoreLead, detectSentiment } = require('../services/leadScoring');
const campaignSvc    = require('../services/campaignService');
const campaignReg    = require('../campaigns/registry');
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
  const s = lowSpeech.trim();

  // 1. Pure generic affirmations (exact or with light punctuation)
  if (/^(yes|yeah|yep|yup|correct|speaking|sure|absolutely|of course|that'?s? me|that is me|i am|it is|it'?s me)[\.!,]?$/.test(s)) return true;

  // 2. Affirmation word at the start followed by anything
  //    e.g. "yes, this is Kumar", "yes speaking", "yeah that's me"
  if (/^(yes|yeah|yep|yup|sure|absolutely|of course)\b/.test(s)) return true;

  // 3. Caller says ONLY their first name (very common: caller just says "Kumar")
  if (s === firstName || s === firstName + '.') return true;

  // 4. "I am" followed optionally by their name or nothing else significant
  if (/^i am\b/.test(s)) return true;

  // 5. "This is <name>" / "It's <name>" / "<name> speaking" patterns
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
  ];
  return namePatterns.some(p => s.includes(p));
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
  // Use a relative path so Twilio automatically resolves it against the current hostname
  return `/webhook/call/respond?leadId=${leadId}`;
}
function slotsUrl(baseUrl, leadId) {
  return `/webhook/call/slots?leadId=${leadId}`;
}
function bookUrl(baseUrl, leadId) {
  return `/webhook/call/book?leadId=${leadId}`;
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

    // ── Campaign resolution — 3-tier priority ──────────────────────────────────
    // 1. Query param set by dashboard when placing the call (works without DB)
    // 2. Lead's stored campaignId → DB lookup (works after SQL schema is applied)
    // 3. Registry default (Demo Test Follow-up) — always safe
    let campaignType = campaignReg.DEFAULT_TYPE;
    let campaignRow = null;
    let campaign = null;
    
    const qCampaignId = req.query.campaignId || null;
    if (qCampaignId) {
      campaignRow = await campaignSvc.getById(qCampaignId);
      if (campaignRow) campaignType = campaignRow.type;
    } else if (lead.campaignId) {
      campaignRow = await campaignSvc.getById(lead.campaignId);
      if (campaignRow) campaignType = campaignRow.type;
    }

    campaign = campaignReg.getCampaign(campaignType, campaignRow);
    logger.info(`Campaign resolved from DB: ${campaignType} for lead ${lead.fullName}`);
    

    const sessionObj = { history: [], turnCount: 0, isFollowUp, campaignType: campaign.type, campaign };
    sessions.set(leadId, sessionObj);

    // Asynchronously fetch available slots so the AI has them for scheduling.
    calendarSvc.getAvailableSlots(4, 30, 10).then(slots => {
      const activeSession = sessions.get(leadId);
      if (activeSession) {
        activeSession.slots = slots;
        sessions.set(leadId, activeSession);
      }
    }).catch(err => logger.error('Failed to pre-fetch slots', err));

    const studentFirst = lead.fullName.split(' ')[0];
    
    // Check if the campaign has a custom opener defined
    let opener = '';
    if (campaign.opener) {
      opener = campaign.opener(lead, isFollowUp);
    } else {
      opener = isFollowUp
        ? `Hello, this is Shashi calling from Test Prep Pundits. May I please speak with ${studentFirst} or their parent?`
        : `Hello, this is Shashi calling from Test Prep Pundits. Am I speaking with ${studentFirst}?`;
    }

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
      const campaign  = session.campaign || campaignReg.getCampaign(campaignReg.DEFAULT_TYPE);
      if (confirmed) {
        session.history.push({ role: 'user', content: speech });
        // Campaign-specific opening line (Demo Test Follow-up = original wording).
        const followUp = campaign.turn0Line(lead);
        session.history.push({ role: 'assistant', content: followUp });
        session.turnCount++;
        sessions.set(leadId, session);
        // The business pitch is long (~30s). Enable barge-in so a "yes" spoken
        // during the pitch is captured instead of lost (which caused the
        // "I had a breath issue / say one more time" loop). Other campaigns
        // keep the original non-interruptible behavior.
        const bargeOpts = campaign?.type === 'business-partner' ? { bargeIn: true } : {};
        return res.send(twilioSvc.twimlRespond(followUp, respondUrl(cfg.server.baseUrl, leadId), bargeOpts));
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
          const followUp = (session.campaignType && session.campaignType !== campaignReg.DEFAULT_TYPE)
            ? `I understand. ${campaign.turn0Line(lead)}`
            : `I understand. I'm calling to help you learn more about our SAT, ACT, AP, and College Admissions programs. Which program are you interested in?`;
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
    let meetingBooked = !!session.meetingBooked || lead.meetingStatus === 'Booked' || lead.status === 'meeting-scheduled' || !!(lead.meeting?.scheduledAt);
    const lastAssistantMsg = [...(session.history || [])].reverse().find(m => m.role === 'assistant')?.content?.toLowerCase() || '';
    const askedFinalQuestion = lastAssistantMsg.includes('any other questions') || lastAssistantMsg.includes('questions for me today') || lastAssistantMsg.includes('questions i can help you with');
    if (askedFinalQuestion) {
      meetingBooked = true;
    }

    // Allow call to end when meeting is booked AND caller signals they have no more questions.
    // This catches all natural "nothing else" phrases so the AI never falls back to [OFFER_MEETING].
    const noMoreQuestions = [
      'no', 'nope', 'nothing', 'nothing else', "that's all", 'no thanks',
      "i'm good", "i'm all set", "no, that's it", "that's okay", "no questions",
      'everything is clear', 'all good', 'all set', 'goodbye', 'bye',
      'thanks bye', 'all done', 'that is all', 'no more questions',
      'no more', 'i am good', 'i am all set', 'no thank you', 'no questions thank you',
      'no other questions', 'i do not have any other questions', 'no that is correct',
      'no i do not', "no i don't", 'no i dont', 'i dont have any', 'i do not have any',
      "that's it", 'thats it', 'none', 'no other', 'i don\'t have any other questions',
      'i dont have any other questions', 'no i am good', 'no i am fine', 'no im fine',
      'no im good', 'no i\'m fine', 'no i\'m good', 'no thanks goodbye', 'no thank you goodbye'
    ];
    const cleanSpeech = lowSpeech.trim().replace(/[.,\/#!$%\^&\*;:{}=\-_`~()]/g,"");
    const isNo = noMoreQuestions.some(p => {
      const cleanP = p.replace(/[.,\/#!$%\^&\*;:{}=\-_`~()]/g,"");
      return cleanSpeech === cleanP || 
             cleanSpeech.startsWith(cleanP + ' ') || 
             cleanSpeech.endsWith(' ' + cleanP) ||
             cleanSpeech.includes('no other questions') ||
             cleanSpeech.includes('dont have any') ||
             cleanSpeech.includes('do not have any') ||
             cleanSpeech === 'no' ||
             cleanSpeech === 'nope';
    });

    if (meetingBooked && isNo) {
      _finaliseCall(lead, session, req.body.CallSid, 'completed-after-booking').catch(err => {
        logger.error('Error finalising call in background:', err);
      });
      return res.send(twilioSvc.twimlHangup(
        `Thank you for your time. Have a wonderful day. Goodbye.`
      ));
    }

    // Explicit decline — try to rescue with meeting offer before accepting.
    // Only hang up after 2 hard declines WITH meeting already offered.
    if (explicitDecline.some(p => lowSpeech.includes(p))) {
      // Business Partner campaign: per the approved script, do NOT push —
      // thank the caller politely and end the call on the first clear decline.
      const isBusinessCampaign = session.campaignType === 'business-partner' || session.campaign?.type === 'business-partner';
      if (isBusinessCampaign && !meetingBooked) {
        _finaliseCall(lead, session, req.body.CallSid, 'ended-by-caller-decline').catch(err => {
          logger.error('Error finalising call in background (business decline):', err);
        });
        return res.send(twilioSvc.twimlHangup(
          `I completely understand. Thank you so much for your time. Have a great day!`
        ));
      }

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
      _finaliseCall(lead, session, req.body.CallSid, 'ended-by-caller-decline').catch(err => {
        logger.error('Error finalising call in background (decline):', err);
      });
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
      _finaliseCall(lead, session, req.body.CallSid, 'ended-callback-requested').catch(err => {
        logger.error('Error finalising call in background (callback):', err);
      });
      return res.send(twilioSvc.twimlHangup(
        `Absolutely, I'll make a note to call you back. Thank you so much for your time, and have a wonderful day!`
      ));
    }

    // ── Caller asked us to repeat / said they couldn't hear ──────────────────
    // Without this, "can you say that again?" is sent to the LLM, which (per its
    // unclear-response rules) often ALSO asks to repeat → agent↔caller deadlock.
    // We instead re-speak our last real line, and after 2 such requests we stop
    // re-explaining and move the call forward to slot selection.
    const repeatRequest = /\b(repeat|say (that|it|this) again|again please|one more time|once more|come again|didn'?t (hear|catch|get)|couldn'?t hear|can you (say|repeat)|please (say|repeat)|pardon|what did you say|breath|broke up|cut(ting)? out|not clear)\b/i.test(lowSpeech);
    if (repeatRequest) {
      session.repeatCount = (session.repeatCount || 0) + 1;
      sessions.set(leadId, session);

      // After 2 repeat requests, stop parroting and push toward booking a slot.
      if (session.repeatCount >= 2 && !meetingBooked) {
        return res.send(twilioSvc.twimlStart(
          `No problem at all. Let me just share a couple of available times for a quick free consultation, and you can pick whatever works best for you.`,
          slotsUrl(cfg.server.baseUrl, leadId)
        ));
      }

      // Re-speak the last substantive agent line (stripping special tokens).
      const lastMeaningful = [...(session.history || [])].reverse()
        .find(m => m.role === 'assistant' && m.content && m.content.replace(/\[.*?\]/g, '').trim().length > 0);
      const repeatText = (lastMeaningful ? lastMeaningful.content.replace(/\[.*?\]/g, '').trim() : '') ||
        `Of course, no problem. Would you like to schedule a free consultation to learn more?`;
      return res.send(twilioSvc.twimlRespond(
        `Sure, let me repeat that. ${repeatText}`,
        respondUrl(cfg.server.baseUrl, leadId)
      ));
    }

    // Detect program intent on turn 1 (after identity confirmation, when answering program question)
    if (session.turnCount === 1) {
      const detectedProgram = detectProgramIntent(lowSpeech);
      if (detectedProgram) {
        logger.info(`Program intent detected: "${detectedProgram}" from speech: "${speech}"`);
      }
    }

    // ── Intercept affirmative responses immediately to schedule ─────────────
    const isAffirmative = /\b(yes|yeah|sure|okay|absolutely|sounds good|i'd like to|let's do it|i do|yep|yup|please|ok)\b/i.test(speech);
    if (!meetingBooked && isAffirmative) {
      const askedToSchedule = lastAssistantMsg.includes('schedule') || 
                              lastAssistantMsg.includes('consultation') ||
                              lastAssistantMsg.includes('time') ||
                              lastAssistantMsg.includes('learn more');
      if (askedToSchedule) {
        session.history.push({ role: 'user', content: speech });
        session.history.push({ role: 'assistant', content: '[OFFER_MEETING]' });
        session.turnCount++;
        sessions.set(leadId, session);
        const r = new (require('twilio').twiml.VoiceResponse)();
        r.redirect({ method: 'POST' }, slotsUrl(cfg.server.baseUrl, leadId));
        return res.send(r.toString());
      }
    }

    // Add user turn to history
    session.history.push({ role: 'user', content: speech });
    session.turnCount++;

    // Get AI response — stream response for low latency
    let stream;
    let baseSys = session.isFollowUp ? aiSvc.buildFollowUpSystem(lead) : aiSvc.buildSystem(lead, session.campaign);
    
    if (!session.meetingBooked && session.slots && session.slots.length) {
      const slotStrings = session.slots.map(s => `- ${s.displayTime}`).join('\n');
      baseSys += `\n\n[AVAILABLE SCHEDULING SLOTS]\nThese are the ONLY available times for a consultation. Do NOT propose or accept any other times. If they suggest another time, politely correct them and offer these options instead:\n${slotStrings}\nOnce they agree to one of these exact times, confirm it clearly and then immediately append [END_CALL]. Do NOT use [OFFER_MEETING].`;
    }

    stream = aiSvc.streamChat({
      lead,
      history: session.history.slice(-12),
      userMessage: speech,
      systemOverride: baseSys
    });

    session.activeStream = stream;
    sessions.set(leadId, session);

    // Redirect immediately to continue endpoint to fetch and speak the first sentence
    const r = new (require('twilio').twiml.VoiceResponse)();
    r.redirect({ method: 'POST' }, `/webhook/call/continue?leadId=${leadId}&sentenceIndex=0`);
    return res.send(r.toString());
  } catch (err) {
    logger.error('webhook/respond error', { msg: err.message });
    // Cap the error loop — repeated failures must never turn into an endless
    // "could you say that one more time?" cycle. After 2 errors, move to slots.
    const s = sessions.get(leadId) || {};
    s.errorCount = (s.errorCount || 0) + 1;
    sessions.set(leadId, s);
    if (s.errorCount >= 2 && !s.meetingBooked) {
      return res.send(twilioSvc.twimlStart(
        `I'm so sorry for the trouble. Let me share a couple of available times for a quick free consultation so we don't keep you waiting.`,
        slotsUrl(cfg.server.baseUrl, leadId)
      ));
    }
    res.send(twilioSvc.twimlRespond(
      "I'm sorry, I had a brief issue. Could you say that one more time?",
      respondUrl(cfg.server.baseUrl, leadId)
    ));
  }
});

// ── STEP 2.5 – Fetch and speak next sentence from stream (Low Latency) ───────
router.post('/call/continue', async (req, res) => {
  const { leadId, sentenceIndex } = req.query;
  res.type('text/xml');

  try {
    const lead = await Lead.findById(leadId);
    if (!lead) return res.send(twilioSvc.twimlHangup());

    const session = sessions.get(leadId);
    if (!session || !session.activeStream) {
      // Fallback: if no active stream, just listen
      return res.send(twilioSvc.twimlListen(respondUrl(cfg.server.baseUrl, leadId)));
    }

    const idx = parseInt(sentenceIndex, 10) || 0;
    const sentence = await session.activeStream.getSentence(idx);

    if (sentence) {
      // Clean special tokens
      let cleanSentence = sentence;
      const hasOffer = cleanSentence.includes('[OFFER_MEETING]');
      const hasEnd = cleanSentence.includes('[END_CALL]');
      cleanSentence = cleanSentence.replace('[OFFER_MEETING]', '').replace('[END_CALL]', '').trim();

      const r = new (require('twilio').twiml.VoiceResponse)();
      if (cleanSentence) {
        // Speak the clean sentence
        twilioSvc._speak(r, cleanSentence);
      }

      if (hasOffer) {
        // Clear stream, save history, transition to slots
        const fullText = session.activeStream.fullText.trim();
        session.history.push({ role: 'assistant', content: fullText });
        delete session.activeStream;
        sessions.set(leadId, session);

        // CRITICAL: If meeting is already booked, NEVER offer slots again.
        if (session.meetingBooked) {
          logger.warn(`[OFFER_MEETING] suppressed during stream — meeting already booked for ${lead.fullName}.`);
          r.redirect({ method: 'POST' }, `/webhook/call/continue?leadId=${leadId}&sentenceIndex=${idx + 1}`);
        } else {
          r.redirect({ method: 'POST' }, slotsUrl(cfg.server.baseUrl, leadId));
        }
        return res.send(r.toString());
      }

      if (hasEnd) {
        // Clear stream, finalize call, hang up (only if allowed)
        const fullText = session.activeStream.fullText.trim();
        session.history.push({ role: 'assistant', content: fullText });
        delete session.activeStream;
        sessions.set(leadId, session);

        if (session.meetingBooked) {
          _finaliseCall(lead, session, req.body.CallSid, 'completed-after-booking').catch(err => {
            logger.error('Error finalising call in background (continue):', err);
          });
          r.hangup();
        } else {
          // Suppress [END_CALL] if no meeting yet — override and force slot offer
          logger.warn(`[END_CALL] suppressed during stream — meeting not booked for ${lead.fullName}. Forcing slot offering.`);
          r.redirect({ method: 'POST' }, slotsUrl(cfg.server.baseUrl, leadId));
        }
        return res.send(r.toString());
      }

      // Otherwise, redirect to the next sentence
      r.redirect({ method: 'POST' }, `/webhook/call/continue?leadId=${leadId}&sentenceIndex=${idx + 1}`);
      return res.send(r.toString());
    } else {
      // Stream finished! Save full reply to history
      const fullReply = session.activeStream.fullText.trim();
      session.history.push({ role: 'assistant', content: fullReply });
      delete session.activeStream;
      sessions.set(leadId, session);

      // Now listen for their next response
      return res.send(twilioSvc.twimlListen(respondUrl(cfg.server.baseUrl, leadId)));
    }
  } catch (err) {
    logger.error('continue endpoint error', err);
    return res.send(twilioSvc.twimlHangup());
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
      const meetingService = require('../services/meetingService');
      await meetingService.createMeetingAndReminders(lead, {
        googleEventId: booking.googleEventId,
        meetLink:      booking.meetLink,
        hostMeetLink:  booking.hostMeetLink,
        roomName:      booking.roomName,
        scheduledAt:   booking.scheduledAt,
      });

      const { score } = scoreLead(lead);

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
          await emailSvc.sendMeetingConfirmation(lead, session.campaignType);
        } catch (e) {
          logger.error('Post-booking tasks failed', { msg: e.message });
        }
      });

      // ── MEETING_BOOKED state: send a hardcoded confirmation — do NOT route through AI ──
      // This ensures the AI never falls back to [OFFER_MEETING] on this turn.
      // Wording is campaign-aware so it matches each campaign's approved script.
      const isBusinessCampaign = session.campaignType === 'business-partner' || session.campaign?.type === 'business-partner';
      const confirmMsg = isBusinessCampaign
        ? `Your Business Partnership consultation has been successfully scheduled. ` +
          `You'll receive a confirmation email shortly. ` +
          `Do you have any other questions for me today?`
        : `Your meeting has been successfully scheduled. ` +
          `You'll receive the meeting details by email shortly. ` +
          `Do you have any other questions I can help you with today?`;
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
        await emailSvc.sendMeetingConfirmation(lead, session.campaignType).catch(() => {});
      } catch (e) {
        logger.error('Manual-booking sheet update failed', { msg: e.message });
      }
    });

    const fallbackMsg =
      `Got it! Let's lock in ${chosen.displayTime}. ` +
      `Our team will send you the confirmation email with the meeting link within the next few minutes. ` +
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

    // Callback Request specific status management
    const cb = await CallbackRequest.findOne({ leadId: lead._id, status: 'Calling' });
    if (cb) {
      if (CallStatus === 'completed') {
        cb.status = 'Completed';
        cb.notes = `Call completed successfully. Duration: ${CallDuration}s.`;
        await cb.save();
      } else if (CallStatus === 'canceled') {
        cb.status = 'Cancelled';
        cb.notes = 'Call cancelled.';
        await cb.save();
      } else if (['no-answer', 'busy', 'failed'].includes(CallStatus)) {
        if (cb.retryCount === 1) {
          cb.status = 'Scheduled';
          cb.scheduledAt = new Date(Date.now() + 15 * 60 * 1000);
          lead.nextScheduledCall = cb.scheduledAt;
          cb.notes = 'First attempt unanswered. Retry scheduled in 15 minutes.';
          await cb.save();
          await lead.save();
        } else if (cb.retryCount === 2) {
          cb.status = 'Scheduled';
          cb.scheduledAt = new Date(Date.now() + 2 * 3600 * 1000);
          lead.nextScheduledCall = cb.scheduledAt;
          cb.notes = 'Second attempt unanswered. Retry scheduled in 2 hours.';
          await cb.save();
          await lead.save();
        } else {
          cb.status = 'No Answer';
          lead.nextScheduledCall = null;
          cb.notes = 'Third attempt unanswered. Callback request marked as No Answer.';
          await cb.save();
          await lead.save();

          // Send admin notification
          const subject = `⚠️ Missed Callback Request: ${lead.fullName}`;
          const content = `Callback request for student ${lead.fullName} (${lead.phone}) went unanswered 3 times and is now marked as No Answer (Missed).`;
          emailSvc.sendAdminNotification(subject, content).catch(() => {});
        }
      }
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
  const { RecordingUrl, RecordingSid, RecordingStatus, ErrorCode } = req.body;
  res.sendStatus(200);

  try {
    const lead = await Lead.findById(leadId);
    if (!lead) return;
    const attempt = lead.callAttempts[lead.callAttempts.length - 1];
    if (attempt) {
      if (RecordingStatus === 'failed' || RecordingStatus === 'absent') {
        attempt.recordingUrl = 'FAILED';
        attempt.recordingError = ErrorCode || 'Unknown Twilio Error';
        logger.error(`Recording failed for ${lead.fullName} (Status: ${RecordingStatus}, Error: ${ErrorCode})`);
      } else if (RecordingUrl) {
        attempt.recordingUrl = `${RecordingUrl}.mp3`;
        logger.info(`Recording saved for ${lead.fullName}: ${RecordingUrl}`);
      }
    }
    await lead.save();
  } catch (err) {
    logger.error('webhook/recording error', { msg: err.message });
  }
});

// ── Internal: parse a verbally confirmed meeting time into a Date ────────────
/**
 * Given AI-extracted scheduledTime ("HH:MM") and scheduledDate ("today"/"tomorrow"/day name),
 * returns a Date object in ET, defaulting gracefully when parts are missing.
 */
function _parseMeetingTime(scheduledTime, scheduledDate) {
  const moment = require('moment-timezone');
  const TZ = 'America/New_York';
  const now = moment().tz(TZ);

  // Resolve the date part
  let base;
  if (!scheduledDate || scheduledDate === 'today') {
    base = now.clone();
  } else if (scheduledDate === 'tomorrow') {
    base = now.clone().add(1, 'day');
  } else {
    // Try to match a day name ("Monday", "Tuesday", etc.)
    const dayNames = ['sunday','monday','tuesday','wednesday','thursday','friday','saturday'];
    const targetDay = dayNames.indexOf(scheduledDate.toLowerCase());
    if (targetDay !== -1) {
      base = now.clone();
      const diff = (targetDay - now.day() + 7) % 7 || 7; // always future
      base.add(diff, 'days');
    } else {
      base = now.clone().add(1, 'day'); // safe fallback
    }
  }

  // Resolve the time part
  if (scheduledTime) {
    const timeMatch = scheduledTime.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i);
    if (timeMatch) {
      let hh = parseInt(timeMatch[1], 10);
      const mm = parseInt(timeMatch[2] || '0', 10);
      const ampm = (timeMatch[3] || '').toLowerCase();
      if (ampm === 'pm' && hh < 12) hh += 12;
      if (ampm === 'am' && hh === 12) hh = 0;
      base.hour(hh).minute(mm).second(0).millisecond(0);
    } else {
      // Fallback if parsing fails
      base.hour(11).minute(0).second(0).millisecond(0);
    }
  } else {
    // No time extracted — default to 11:00 AM
    base.hour(11).minute(0).second(0).millisecond(0);
  }

  // If the resolved time is in the past, push to the same time tomorrow
  if (base.isBefore(now)) {
    base.add(1, 'day');
  }

  return base.toDate();
}

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

    // ── POST-CALL MEETING RESCUE ──────────────────────────────────────────────
    // If the AI verbally confirmed a consultation during the call but the formal
    // /slots → /book pipeline was never triggered, the meeting record is missing.
    // We detect this and retroactively create the full meeting record here.
    const supabase = require('../db/supabase');
    const { data: sqlMeetings } = await supabase
      .from('meetings')
      .select('id, scheduled_at')
      .eq('lead_id', lead._id);

    // A meeting is already saved ONLY if there is an upcoming scheduled meeting in the meetings table
    const hasFutureSqlMeeting = sqlMeetings && sqlMeetings.some(m => new Date(m.scheduled_at) > new Date());
    const meetingAlreadySaved = !!hasFutureSqlMeeting;

    const lowerTranscript = transcript.toLowerCase();
    const hasConfirmationPhrase = 
      lowerTranscript.includes('successfully scheduled') ||
      lowerTranscript.includes('confirmed for') ||
      lowerTranscript.includes('booked you in') ||
      lowerTranscript.includes('all set for') ||
      lowerTranscript.includes('scheduled your free') ||
      lowerTranscript.includes('meeting has been successfully scheduled');

    if (!meetingAlreadySaved && (transcript.length > 80 || hasConfirmationPhrase)) {
      try {
        const campaign = session?.campaign || campaignReg.getCampaign(lead.campaignId, lead);
        const detection = await detectMeetingFromTranscript(transcript, lead, campaign);
        if (detection.booked || hasConfirmationPhrase) {
          logger.info(`✅ Post-call meeting rescue triggered for ${lead.fullName} — time: ${detection.rawTime || 'pre-existing'}`);

          // Parse the verbally confirmed time into a real Date (only reuse if it is in the future)
          let scheduledAt = (lead.meeting?.scheduledAt && new Date(lead.meeting.scheduledAt) > new Date())
            ? new Date(lead.meeting.scheduledAt) 
            : _parseMeetingTime(detection.scheduledTime, detection.scheduledDate);

          // Verify availability before booking (if busy, find next available)
          try {
            const calendarSvc = require('../services/calendarService');
            const moment = require('moment-timezone');
            const checkStart = moment(scheduledAt).tz('America/New_York');
            const checkEnd = checkStart.clone().add(30, 'minutes');
            
            const busy = await calendarSvc._getBusy(checkStart, checkEnd);
            const isBusy = busy.some(b => moment(b.start).isBefore(checkEnd) && moment(b.end).isAfter(checkStart));
            
            if (isBusy) {
              logger.warn(`Slot ${scheduledAt.toISOString()} was busy! Automatically finding the next available slot.`);
              const nextSlots = await calendarSvc.getAvailableSlots(1, 30, 10);
              if (nextSlots && nextSlots.length) {
                scheduledAt = new Date(nextSlots[0].start);
                logger.info(`Next available slot found: ${scheduledAt.toISOString()}`);
              }
            }
          } catch (e) {
            logger.error('Error verifying slot availability in rescue', e);
          }

          // Generate a unique LiveKit room name and meeting URL
          const roomName = (lead.meeting?.scheduledAt && new Date(lead.meeting.scheduledAt) > new Date())
            ? (lead.meeting.roomName || livekitSvc.generateRoomName(lead))
            : livekitSvc.generateRoomName(lead);

          const jitsiUrl = (lead.meeting?.scheduledAt && new Date(lead.meeting.scheduledAt) > new Date())
            ? (lead.meeting.meetLink || livekitSvc.generateMeetingUrl(roomName))
            : livekitSvc.generateMeetingUrl(roomName);

          // Save meeting on the lead and schedule reminders
          const meetingService = require('../services/meetingService');
          await meetingService.createMeetingAndReminders(lead, {
            meetLink:    jitsiUrl,
            roomName:    roomName,
            scheduledAt: scheduledAt,
          });

          logger.info(`📅 Meeting rescue: scheduled at ${scheduledAt.toISOString()} | link: ${jitsiUrl}`);

          // Fire post-booking tasks asynchronously — never crash _finaliseCall
          setImmediate(async () => {
            try {
              const moment = require('moment-timezone');
              const scheduledET = moment(scheduledAt).tz('America/New_York');
              await sheetsSvc.updateRow(lead.sheetRowIndex, {
                status:      'Meeting Scheduled',
                score:       lead.leadScore,
                summary:     `[Auto-rescued] Meeting confirmed for ${scheduledET.format('MMM Do [at] h:mm A z')}.`,
                meetingDate: scheduledET.format('YYYY-MM-DD'),
                meetingTime: scheduledET.format('h:mm A z'),
                meetLink:    jitsiUrl,
              });
              await emailSvc.sendMeetingConfirmation(lead, campaign?.type);
              logger.info(`✅ Post-call rescue tasks complete for ${lead.fullName}`);
            } catch (e) {
              logger.error('Post-call meeting rescue tasks failed', { msg: e.message });
            }
          });
        }
      } catch (rescueErr) {
        logger.error('Post-call meeting rescue error', { msg: rescueErr.message });
      }
    }
    // ── END POST-CALL MEETING RESCUE ──────────────────────────────────────────

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

    // --- PREVENT RACE CONDITION OVERWRITE ---
    // The /book endpoint might have run concurrently and saved the meeting.
    // We must fetch the latest DB state to ensure we don't erase the meeting.
    const freshLead = await Lead.findById(lead._id);
    const nowTime = new Date();
    const hasMeeting = (lead.meeting?.scheduledAt && new Date(lead.meeting.scheduledAt) > nowTime) || 
                       (freshLead?.meeting?.scheduledAt && new Date(freshLead.meeting.scheduledAt) > nowTime);

    if (hasMeeting) {
      lead.status = 'meeting-scheduled';
      lead.meetingStatus = 'Booked';
      lead.isQualified = true;
      if (freshLead && freshLead.meeting) {
        lead.meeting = freshLead.meeting;
      }
      
      // Notify dashboards immediately
      try {
        const crmRouter = require('./crm');
        if (crmRouter.broadcastUpdate) {
          crmRouter.broadcastUpdate('meeting-booked', { leadId: lead._id });
        }
      } catch (sseErr) {
        logger.error('SSE update broadcast failed', sseErr);
      }
    } else if (lead.status === 'calling' || lead.status === 'contacted') {
      if (lead.status === 'calling') lead.status = 'contacted';
    }
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



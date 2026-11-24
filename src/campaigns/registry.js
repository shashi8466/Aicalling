/**
 * Campaign Script Registry
 * ─────────────────────────────────────────────────────────────────────────
 * Canonical outbound-call scripts keyed by campaign TYPE.
 *
 * Every campaign type defines two pieces used by the live-call pipeline:
 *   • turn0Line(lead)      → the line spoken right after the caller confirms
 *                            their identity (webhook turn 0).
 *   • systemContext(lead)  → an extra framing block prepended to the AI system
 *                            prompt so the model steers the conversation toward
 *                            this campaign's goal.
 *
 * IMPORTANT — BACKWARD COMPATIBILITY:
 * The default campaign, `demo-test-followup`, returns the EXACT strings that
 * were previously hard-coded in the webhook + an EMPTY system context. This
 * guarantees the existing Demo Test Follow-up flow is byte-for-byte unchanged.
 * Any lead with no campaign (or an unknown type) falls back to this default.
 */

const DEFAULT_TYPE = 'demo-test-followup';

function firstName(lead) {
  return (lead.fullName || 'there').split(' ')[0];
}

// Custom scripts are pasted from emails/flyers — strip emoji and collapse line
// breaks so TTS reads the text cleanly, without changing the words.
function speakableScript(script) {
  return String(script || '')
    .replace(/[\p{Extended_Pictographic}\u{1F1E6}-\u{1F1FF}️‍]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// A custom script is a one-way announcement unless it ENDS by asking the
// caller something — only then does the call stay open for a reply.
// Rhetorical questions mid-script ("Why wait?") don't count.
function customScriptExpectsReply(script) {
  return /\?["'”’)\s]*$/.test(speakableScript(script));
}

function getPrep365PendingPoints(lead, isParent = false) {
  const points = lead.qualification?.prep365TalkingPoints || lead.notes || '';
  const subj = isParent ? (lead.qualification?.prep365StudentName || lead.fullName || 'they') : 'you';
  const has = isParent ? 'has' : 'have';

  const items = [];
  if (/not taken a practice test in (\d+) days/i.test(points)) {
    const days = points.match(/not taken a practice test in (\d+) days/i)[1];
    items.push(`${subj} ${has}n't taken a practice test in ${days} days`);
  }
  if (/Custom Prep plan for (.+?) is (\d+%) done/i.test(points)) {
    const m = points.match(/Custom Prep plan for (.+?) is (\d+%) done/i);
    items.push(`${isParent ? `${subj}'s` : 'your'} Custom Prep plan for ${m[1]} is ${m[2]} done`);
  } else if (/Custom Prep plan is behind schedule/i.test(points)) {
    items.push(`${isParent ? `${subj}'s` : 'your'} Custom Prep plan is currently behind schedule`);
  }
  if (items.length === 0 && /unfinished assigned work/i.test(points)) {
    items.push(`${subj} ${has} unfinished study topics`);
  }

  if (items.length === 0) {
    return isParent
      ? `I noticed ${subj} ${has} pending study tasks and ${has}n't taken a practice test recently.`
      : `I noticed you have pending study tasks and haven't taken a practice test recently.`;
  }
  return `I noticed ${items.join(', and ')}.`;
}

// ── Campaign definitions ────────────────────────────────────────────────────
const CAMPAIGNS = {
  'prep365-retention': {
    type: 'prep365-retention',
    name: 'Prep365 Study Plan Check-in',
    program: 'Prep365',
    isPrep365: true,
    opener: (lead) => {
      const isParent = lead.qualification?.prep365RecipientType === 'parent';
      const studentFirst = (lead.qualification?.prep365StudentName || lead.fullName || 'there').split(' ')[0];
      const parentName = lead.parentName || lead.fullName || 'there';
      if (isParent) {
        return `Hi, this is Annie from Prep365. Am I speaking with ${parentName}, parent of ${studentFirst}?`;
      }
      return `Hi, this is Annie from Prep365. Am I speaking with ${studentFirst}?`;
    },
    turn0Line: (lead) => {
      const isParent = lead.qualification?.prep365RecipientType === 'parent';
      const studentFirst = (lead.qualification?.prep365StudentName || lead.fullName || 'there').split(' ')[0];
      const pendingText = getPrep365PendingPoints(lead, isParent);
      if (isParent) {
        return `Great! I'm calling for a quick check-in on ${studentFirst}'s SAT prep. ${pendingText} We want to help ${studentFirst} stay on track — could you encourage them to log in to Prep365 today to complete a topic or test? Also, is anything blocking their study right now?`;
      }
      return `Great! I'm calling for a quick check-in on your SAT prep. ${pendingText} We want to help you stay on track — could you log in to Prep365 today to complete a topic or test? Also, is anything blocking your study right now?`;
    },
    systemContext: (lead) => {
      const points = lead.qualification?.prep365TalkingPoints || lead.notes || '';
      return `━━━ CAMPAIGN: PREP365 STUDY PLAN CHECK-IN ━━━
You are Annie from Prep365.
NEVER mention Test Prep Pundits. Prep365 is an independent learning platform.
Student Name: ${lead.fullName}
Context & Talking Points:
${points}

INSTRUCTIONS:
- This is an existing student check-in, NOT an admissions sales pitch.
- NEVER offer admissions consultations, demo tests, or sales packages.
- Target under 60 seconds total. Keep answers under 2 sentences.
- Be encouraging, polite, and warmly sign off with a goodbye.`;
    }
  },

  'custom-script': {
    type: 'custom-script',
    name: 'Custom Campaign',
    program: 'Multiple',
    skipIdentityCheck: true,
    // Speak the script verbatim and hang up the moment it finishes — no AI
    // turn afterwards. Only a script that asks a question keeps the call open.
    hangupAfterOpener: (vars) => !customScriptExpectsReply(vars?.customScript),
    opener: (lead, isFollowUp, vars) => speakableScript(vars?.customScript) || 'Hello.',
    voicemail: (lead, vars) => speakableScript(vars?.customScript) || 'Hello.',
    turn0Line: () => '',
    systemContext: (lead, vars) => {
      const script = vars?.customScript || '';
      return `━━━ CAMPAIGN: CUSTOM CAMPAIGN ━━━
You are an AI Assistant calling from Test Prep Pundits.
This is a custom campaign. The following is the exact script/instructions provided for this call:
"${script}"

INSTRUCTIONS:
- You have already spoken the script as the opening line, and it asked the caller a question.
- The script is the COMPLETE call. Only do what it explicitly instructs — no sales pitch, no extra questions, no unrelated information.
- Do NOT offer or book a consultation unless the script explicitly instructs you to; only then may you use [OFFER_MEETING].
- IMPORTANT: Once the script's instructions are fully completed, or if the user declines, you MUST append [END_CALL] to your response to hang up the call immediately. Do not leave the call hanging.
- Follow the tone and instructions provided in the custom script.`;
    }
  },

  // 1) EXISTING FLOW — must stay identical to prior hard-coded behaviour.
  'demo-test-followup': {
    type: 'demo-test-followup',
    name: 'Demo Test Follow-up',
    program: 'Multiple',
    turn0Line: (lead) =>
      `Great! I noticed that you recently completed a demo test with Test Prep Pundits. ` +
      `I'm calling to help you learn more about our SAT, ACT, AP, and College Admissions programs. ` +
      `Which program are you interested in?`,
    // Empty on purpose → AI system prompt is unchanged from the original.
    systemContext: () => '',
  },

  // 2) SAT Batch Promotion
  'sat-batch': {
    type: 'sat-batch',
    name: 'SAT Batch Promotion',
    program: 'SAT',
    turn0Line: (lead) =>
      `We're excited to let you know that we've launched a new SAT Preparation Batch, and for a limited time we're offering an exclusive 40% discount on enrollment. ` +
      `We're proud to have helped over 2,000 families and earned more than 300 five-star reviews from students and parents. ` +
      `Would you like to learn more about our SAT Preparation Program?`,
    systemContext: (lead) =>
`━━━ CAMPAIGN: SAT BATCH PROMOTION ━━━
This is an OUTREACH call inviting ${firstName(lead)} to join Test Prep Pundits's newly launched SAT Preparation Batch.

OPENING INTENT (already delivered): Announced the new SAT Batch with a 40% discount, cited 2,000+ families helped and 300+ five-star reviews, and asked if they'd like to learn more about the SAT Preparation Program.

If they say YES:
Say: "That's wonderful! I'd be happy to schedule a FREE 10–15 minute consultation with one of our SAT advisors. During the consultation, we'll explain the complete program, answer your questions, and help you create the right SAT preparation plan. When would you like to schedule this?" then [OFFER_MEETING]

After the meeting is booked, say:
"Perfect! Your consultation has been successfully scheduled. You'll receive the meeting details by email shortly. You can also visit www.testpreppundits.com to learn more."
Then follow the global post-booking instructions to ask if they have any questions.

GOAL: book a FREE 10–15 minute consultation with an SAT advisor.`
  },

  // 3) ACT Batch Promotion
  'act-batch': {
    type: 'act-batch',
    name: 'ACT Batch Promotion',
    program: 'ACT',
    turn0Line: (lead) =>
      `We're excited to let you know that we've launched a new ACT Preparation Batch, and for a limited time we're offering an exclusive 40% discount on enrollment. ` +
      `We're proud to have helped over 2,000 families and earned more than 300 five-star reviews from students and parents. ` +
      `Would you like to learn more about our ACT Preparation Program?`,
    systemContext: (lead) =>
`━━━ CAMPAIGN: ACT BATCH PROMOTION ━━━
This is an OUTREACH call inviting ${firstName(lead)} to join Test Prep Pundits's new ACT Preparation Batch.

OPENING INTENT (already delivered): Announced the new ACT Batch with a 40% discount, cited 2,000+ families helped and 300+ five-star reviews, and asked if they'd like to learn more about the ACT Preparation Program.

If they say YES:
Say: "That's wonderful! I'd be happy to schedule a FREE 10–15 minute consultation with one of our ACT advisors. During the consultation, we'll explain the complete program, answer your questions, and help you create the right ACT preparation plan. When would you like to schedule this?" then [OFFER_MEETING]

After the meeting is booked, say:
"Perfect! Your consultation has been successfully scheduled. You'll receive your meeting details by email shortly. For more information, visit www.testpreppundits.com."
Then follow the global post-booking instructions to ask if they have any questions.

GOAL: book a FREE 10–15 minute consultation with an ACT advisor.`
  },

  // 4) AP Course Promotion
  'ap-course': {
    type: 'ap-course',
    name: 'AP Course Promotion',
    program: 'AP',
    turn0Line: (lead) =>
      `We're excited to let you know that we've launched our new AP Preparation Program, and for a limited time we're offering an exclusive 40% discount on enrollment. ` +
      `We're proud to have helped over 2,000 families and earned more than 300 five-star reviews from students and parents. ` +
      `Would you like to learn more about our AP Preparation Program?`,
    systemContext: (lead) =>
`━━━ CAMPAIGN: AP COURSE PROMOTION ━━━
This is an OUTREACH call inviting ${firstName(lead)} to Test Prep Pundits's new AP Preparation Program.

OPENING INTENT (already delivered): Announced the new AP Program with a 40% discount, cited 2,000+ families helped and 300+ five-star reviews, and asked if they'd like to learn more about the AP Preparation Program.

If they say YES:
Say: "That's wonderful! I'd be happy to schedule a FREE 10–15 minute consultation with one of our AP advisors. During the consultation, we'll explain the complete program, answer your questions, and help you choose the right AP subjects and preparation plan. When would you like to schedule this?" then [OFFER_MEETING]

After the meeting is booked, say:
"Perfect! Your consultation has been successfully scheduled. You'll receive the meeting details by email shortly. You can also visit www.testpreppundits.com for more information."
Then follow the global post-booking instructions to ask if they have any questions.

GOAL: book a FREE 10–15 minute consultation with an AP advisor.`
  },

  // 5) College Admissions Counseling
  'college-admissions': {
    type: 'college-admissions',
    name: 'College Admissions Counseling',
    program: 'College Admissions',
    turn0Line: (lead) =>
      `We are currently offering personalized College Admissions Counseling for students planning to apply to universities. ` +
      `Our counseling includes university selection guidance, profile evaluation, application planning, ` +
      `essay guidance, scholarship advice, visa and admissions support, and one-on-one counseling. ` +
      `Would you like to learn more about our College Admissions Counseling program?`,
    systemContext: (lead) =>
`━━━ CAMPAIGN: COLLEGE ADMISSIONS COUNSELING ━━━
This is an OUTREACH call inviting ${firstName(lead)} to Test Prep Pundits's personalized College Admissions Counseling.
The student may NOT have interacted with Test Prep Pundits before — never assume prior contact or a demo test.

OPENING INTENT (already delivered): Introduced the counseling program and asked if they'd like to learn more.

If they say YES or show any interest:
Say: "Excellent! I'd be happy to schedule a FREE 10–15 minute consultation with one of our admissions counselors." then [OFFER_MEETING]

After the meeting is booked, say EXACTLY:
"Thank you! Your consultation has been successfully scheduled. You'll receive the meeting details shortly by email. Have a wonderful day!" then [END_CALL]

Highlight naturally (never as a list, one idea per turn):
university selection guidance, profile evaluation, application planning,
essay guidance, scholarship advice, visa and admissions support, and one-on-one counseling.

GOAL: book a FREE 10–15 minute consultation with an admissions counselor.
Frame EVERY meeting offer as a college admissions consultation.`,
  },

  // 6) Scholarship Webinar
  'scholarship-webinar': {
    type: 'scholarship-webinar',
    name: 'Scholarship Webinar',
    program: 'Scholarships',
    turn0Line: (lead) =>
      `Great! I'm calling to invite you to Test Prep Pundits's free Scholarship Webinar — ` +
      `we'll cover how to find and win scholarships to lower college costs. ` +
      `Would you like to learn more?`,
    systemContext: (lead) =>
`━━━ CAMPAIGN: SCHOLARSHIP WEBINAR INVITATION ━━━
This is an OUTREACH call inviting ${firstName(lead)} (and their parents) to Test Prep Pundits's free Scholarship Webinar.
Highlight naturally: finding scholarships, eligibility, application tips, and reducing college costs.
GOAL: get them to register and book a FREE consultation. Frame the meeting as a scholarship-planning consultation.`,
  },

  // 7) Free Mock Test
  'free-mock-test': {
    type: 'free-mock-test',
    name: 'Free Mock Test',
    program: 'Mock Test',
    turn0Line: (lead) =>
      `Great! I'm calling to offer you a free full-length mock test from Test Prep Pundits, ` +
      `followed by a detailed score analysis with one of our advisors. ` +
      `Would you like to learn more?`,
    systemContext: (lead) =>
`━━━ CAMPAIGN: FREE MOCK TEST INVITATION ━━━
This is an OUTREACH call offering ${firstName(lead)} a free full-length mock test (SAT/ACT/AP as relevant).
Highlight naturally: realistic exam experience, detailed score report, and a one-on-one results review.
GOAL: book a FREE consultation to review results / schedule the mock test. Frame the meeting accordingly.`,
  },

  // 8) Parent Counseling Session
  'parent-counseling': {
    type: 'parent-counseling',
    name: 'Parent Counseling Session',
    program: 'Parent Counseling',
    turn0Line: (lead) =>
      `Great! I'm calling to invite you to a free parent counseling session with Test Prep Pundits, ` +
      `where we'll discuss your child's academic goals and the best prep pathway. ` +
      `Would you like to learn more?`,
    systemContext: (lead) =>
`━━━ CAMPAIGN: PARENT COUNSELING SESSION ━━━
This is an OUTREACH call inviting the PARENT of ${firstName(lead)} to a free counseling session.
Speak to the parent respectfully; focus on the student's goals, timelines, and recommended prep pathway.
GOAL: book a FREE consultation with a counselor. Frame every meeting offer as a parent counseling session.`,
  },

  // 9) Absent Campaign
  'parent-absent': {
    type: 'parent-absent',
    name: 'Absent Campaign',
    program: 'Student Outreach',
    skipIdentityCheck: true,
    opener: (lead, isFollowUp, vars) => {
      const className = vars?.className || 'class';
      return `Hi, this is Annie, your AI Assistant from Test Prep Pundits. ` +
        `We're calling regarding an important update. ` +
        `Your child was absent from today's ${className} class. ` +
        `If you have already informed Test Prep Pundits about the absence, please disregard this call. ` +
        `Otherwise, please make sure to post your child's absence in the WhatsApp group so our support team can properly track attendance. ` +
        `Do you have any questions today?`;
    },
    systemContext: (lead, vars) => {
      const studentFirst = lead.fullName.split(' ')[0];
      const className = vars?.className || 'class';
      return `━━━ CAMPAIGN: ABSENT CAMPAIGN (PARENT CALL) ━━━
You are Annie, an AI Admissions Assistant calling from Test Prep Pundits on a live phone call with a parent of ${studentFirst}.

EXACT SCRIPT ALREADY DELIVERED:
Opener (already spoken): "Hi, this is Annie, your AI Assistant from Test Prep Pundits. We're calling regarding an important update. Your child was absent from today's ${className} class. If you have already informed Test Prep Pundits about the absence, please disregard this call. Otherwise, please make sure to post your child's absence in the WhatsApp group so our support team can properly track attendance. Do you have any questions today?"

SPEAKING RULES:
• Speak naturally and warmly — you are speaking to a parent.
• Keep responses SHORT — maximum 2 sentences per reply.
• Never use bullet points, numbers, or markdown — spoken words only.
• Never re-introduce yourself after the opening.
• NEVER offer meetings, consultations, or any sales pitch on this call.
• Respond immediately (within 1-2 seconds) when the parent speaks.

IF the parent says "No" or "No questions" or any sign-off ("goodbye", "thanks", "that's all", "okay thank you", etc.):
Say EXACTLY: "Thank you for your time. Have a wonderful day. Goodbye." then [END_CALL]

IF the parent asks a question:
Answer briefly and clearly, then ask: "Do you have any other questions today?"
If they say no or any sign-off: Say EXACTLY: "Thank you for your time. Have a wonderful day. Goodbye." then [END_CALL]

GOAL: Politely inform the parent about the absence, answer any questions, then end the call gracefully.
DO NOT offer [OFFER_MEETING]. DO NOT try to schedule anything. DO NOT do any sales pitch.`;
    },
  },

  // 10) Homework Campaign
  'parent-homework': {
    type: 'parent-homework',
    name: 'Homework Campaign',
    program: 'Student Outreach',
    skipIdentityCheck: true,
    opener: (lead, isFollowUp, vars) => {
      const topic = vars?.homeworkTopic || 'today\'s assigned topic';
      return `Hi, this is Annie, your AI Assistant from Test Prep Pundits. ` +
        `We're calling regarding an important update. ` +
        `Your child has not completed today's homework assignment on ${topic}. ` +
        `Please ask your child to complete the ${topic} homework as soon as possible, even if it is already past the due time. ` +
        `If you need any assistance, please post in the WhatsApp group, and our support team will be happy to help. ` +
        `Do you have any questions today?`;
    },
    systemContext: (lead, vars) => {
      const studentFirst = lead.fullName.split(' ')[0];
      const topic = vars?.homeworkTopic || 'today\'s assigned topic';
      return `━━━ CAMPAIGN: HOMEWORK CAMPAIGN (STUDENT CALL) ━━━
You are Annie, an AI Admissions Assistant calling from Test Prep Pundits on a live phone call with a parent of ${studentFirst}.

EXACT SCRIPT ALREADY DELIVERED:
Opener (already spoken): "Hi, this is Annie, your AI Assistant from Test Prep Pundits. We're calling regarding an important update. Your child has not completed today's homework assignment on ${topic}. Please ask your child to complete the ${topic} homework as soon as possible, even if it is already past the due time. If you need any assistance, please post in the WhatsApp group, and our support team will be happy to help. Do you have any questions today?"

SPEAKING RULES:
• Speak naturally and warmly — you are speaking to a parent.
• Keep responses SHORT — maximum 2 sentences per reply.
• Never use bullet points, numbers, or markdown — spoken words only.
• Never re-introduce yourself after the opening.
• NEVER offer meetings, consultations, or any sales pitch on this call.
• Respond immediately (within 1-2 seconds) when the parent speaks.

IF the parent says "No" or "No questions" or any sign-off ("goodbye", "thanks", "that's all", "okay thank you", etc.):
Say EXACTLY: "Thank you for your time. Have a wonderful day. Goodbye." then [END_CALL]

IF the parent asks a question:
Answer briefly and clearly, then ask: "Do you have any other questions today?"
If they say no or any sign-off: Say EXACTLY: "Thank you for your time. Have a wonderful day. Goodbye." then [END_CALL]

GOAL: Politely inform the parent about the incomplete homework, answer any questions, then end the call gracefully.
DO NOT offer [OFFER_MEETING]. DO NOT try to schedule anything. DO NOT do any sales pitch.`;
    },
  },

  'parent-flt': {
    type: 'parent-flt',
    name: 'Full Length Test Campaign',
    program: 'Student Outreach',
    skipIdentityCheck: true,
    opener: (lead, isFollowUp, vars) => {
      const testName = vars?.testName || 'the Full-Length Test';
      return `Hi, this is Annie, your AI Assistant from Test Prep Pundits. ` +
        `We're calling regarding an important update. ` +
        `Your child has not completed ${testName}. ` +
        `If you have already informed Test Prep Pundits, please disregard this call. ` +
        `Otherwise, please ask your child to complete ${testName} as soon as possible. ` +
        `If you need any help, please post in the WhatsApp group, and our support team will be happy to assist you. ` +
        `Do you have any questions today?`;
    },
    systemContext: (lead, vars) => {
      const studentFirst = lead.fullName.split(' ')[0];
      const testName = vars?.testName || 'the Full-Length Test';
      return `━━━ CAMPAIGN: FULL LENGTH TEST CAMPAIGN (PARENT CALL) ━━━
You are Annie, an AI Admissions Assistant calling from Test Prep Pundits on a live phone call with a parent of ${studentFirst}.

EXACT SCRIPT ALREADY DELIVERED:
Opener (already spoken): "Hi, this is Annie, your AI Assistant from Test Prep Pundits. We're calling regarding an important update. Your child has not completed ${testName}. If you have already informed Test Prep Pundits, please disregard this call. Otherwise, please ask your child to complete ${testName} as soon as possible. If you need any help, please post in the WhatsApp group, and our support team will be happy to assist you. Do you have any questions today?"

SPEAKING RULES:
• Speak naturally and warmly — you are speaking to a parent.
• Keep responses SHORT — maximum 2 sentences per reply.
• Never use bullet points, numbers, or markdown — spoken words only.
• Never re-introduce yourself after the opening.
• NEVER offer meetings, consultations, or any sales pitch on this call.
• Respond immediately (within 1-2 seconds) when the parent speaks.

IF the parent says "No" or "No questions" or any sign-off ("goodbye", "thanks", "that's all", "okay thank you", etc.):
Say EXACTLY: "Thank you for your time. Have a wonderful day. Goodbye." then [END_CALL]

IF the parent asks a question:
Answer briefly and clearly, then ask: "Do you have any other questions today?"
If they say no or any sign-off: Say EXACTLY: "Thank you for your time. Have a wonderful day. Goodbye." then [END_CALL]

GOAL: Politely inform the parent about the incomplete Full Length Test, answer any questions, then end the call gracefully.
DO NOT offer [OFFER_MEETING]. DO NOT try to schedule anything. DO NOT do any sales pitch.`;
    },
  },

  // Separate, student-facing sibling of 'parent-flt' — announces that the test link
  // has already been POSTED (encouraging tone), vs. parent-flt's "not completed yet"
  // reminder tone to the PARENT. Does not touch or share config with parent-flt.
  //
  // This is a ONE-WAY announcement: a standard AI self-introduction, followed by
  // the exact script content verbatim (no "do you have any questions" prompt added),
  // then the call hangs up immediately — no Gather, no waiting for a reply.
  // `hangupAfterOpener: true` is read by src/routes/webhook.js's /call/start
  // handler to route this campaign through twilioSvc.twimlHangup() instead of
  // the normal twimlStart() + <Gather> flow every other campaign uses.
  'student-flt-posted': {
    type: 'student-flt-posted',
    name: 'Full Length Test Announcement (Student)',
    program: 'Student Outreach',
    skipIdentityCheck: true,
    hangupAfterOpener: true,
    opener: (lead, isFollowUp, vars) => {
      const testName = vars?.testName || 'the Full-Length Test';
      return `Hi, this is Annie, your AI Assistant from Test Prep Pundits. ` +
        `Hello Everyone! This is a quick update for all of you. ` +
        `I have posted ${testName} link in your WhatsApp group. You can take the test at your convenient time. ` +
        `Please make sure to complete it as soon as possible. This is an important part of your preparation. ` +
        `If you have any issues accessing the test, feel free to reach out. ` +
        `All the best! Thanks, Team Test Prep Pundits.`;
    },
    // Not used in normal operation — the call ends right after the opener above
    // (see hangupAfterOpener). Kept only so this campaign has the same shape as
    // every other registry entry, in case something ever calls it unconditionally.
    systemContext: (lead, vars) => {
      const testName = vars?.testName || 'the Full-Length Test';
      return `━━━ CAMPAIGN: FULL LENGTH TEST ANNOUNCEMENT (STUDENT CALL) ━━━
This is a one-way announcement call — the opener below is read verbatim, then the
call ends immediately (hangupAfterOpener: true). This system prompt is not used
in normal operation since no reply is ever gathered.

Opener (already spoken, then call ends): "Hi, this is Annie, your AI Assistant from Test Prep Pundits. Hello Everyone! This is a quick update for all of you. I have posted ${testName} link in your WhatsApp group. You can take the test at your convenient time. Please make sure to complete it as soon as possible. This is an important part of your preparation. If you have any issues accessing the test, feel free to reach out. All the best! Thanks, Team Test Prep Pundits."

DO NOT offer [OFFER_MEETING]. DO NOT try to schedule anything. DO NOT do any sales pitch.`;
    },
  },

  'business-partner': {
    type: 'business-partner',
    name: 'Business Partner Opportunity',
    program: 'Business Partner',
    opener: (lead, isFollowUp) =>
      `Hello, may I speak with ${lead.fullName}?`,
    turn0Line: (lead) => {
      const firstName = lead.fullName.split(' ')[0];
      return `Hi ${firstName}, this is Ravi Gunishetty from HGI. ` +
        `We're currently looking for Business Partners to join our growing network. ` +
        `The best part is, there is no financial investment required. All you need to invest is your time and commitment. ` +
        `Some of our business partners are already earning $100,000+ per year after around three years of consistent hard work and dedication. Individual results vary depending on each partner's effort and performance. ` +
        `Would you like to schedule a free consultation to learn more about this business opportunity?`;
    },
    systemContext: (lead) => {
      const firstName = lead.fullName.split(' ')[0];
      return `━━━ CAMPAIGN: BUSINESS PARTNER OPPORTUNITY ━━━
You are Ravi Gunishetty calling on behalf of HGI on a live phone call with ${lead.fullName} (first name: ${firstName}).

SCRIPT FLOW:
1. The opener "Hello, may I speak with ${lead.fullName}?" has already been spoken.
2. The caller has confirmed their identity.
3. You have already delivered the intro: "Hi ${firstName}, this is Ravi Gunishetty from HGI. We're currently looking for Business Partners..."

SPEAKING RULES:
• Speak naturally like a real human — warm, concise, never robotic.
• Maximum 2 sentences per response. One idea at a time.
• Use ${firstName}'s name naturally in conversation.
• Never re-introduce yourself ("this is Ravi") after the opening.
• Never use bullet points, numbers, or markdown — spoken words only.

If they say YES or express interest:
- Schedule the Business Partnership consultation — offer available time slots and let them pick. Then append [OFFER_MEETING].
- Confirm the meeting date and time clearly.
- Update the CRM and dashboard (handled automatically when you schedule).
- Send the confirmation email (handled automatically when you schedule).

If they say NO or NOT INTERESTED at any point:
- Do NOT push more than once. Simply say: "I completely understand. Thank you so much for your time. Have a great day!" then [END_CALL].

MEETING_BOOKED FINAL STATE:
Once the meeting is confirmed, you are in a LOCKED final state.
- Say EXACTLY: "Your Business Partnership consultation has been successfully scheduled. You'll receive a confirmation email shortly. Do you have any other questions for me today?"
- If they ask a question: answer briefly, then ask again: "Do you have any other questions for me today?"
- If they say "no", "nothing else", "nope", "no thank you", or any sign-off:
  Say EXACTLY: "Thank you for your time. Have a wonderful day. Goodbye." then [END_CALL].
- CRITICAL: NEVER offer another time slot, ask about scheduling, or emit [OFFER_MEETING] after the meeting is already confirmed.`;
    },
  },

  // 12) SAT Summer Digital Challenge
  'sat-summer-challenge': {
    type: 'sat-summer-challenge',
    name: 'SAT Summer Digital Challenge',
    program: 'SAT',
    skipIdentityCheck: true,
    opener: (lead, isFollowUp, vars) =>
      `Hello, this is Annie, your AI Assistant from Test Prep Pundits. ` +
      `We're excited to announce our SAT Summer Digital Challenge! ` +
      `TURN YOUR SUMMER BREAK INTO SAT SUCCESS! ` +
      `Complete the entire SAT syllabus with: ` +
      `70% or higher accuracy, and at least 5 hours of video lessons watched. ` +
      `Complete the challenge by August 9, 2026, and you'll win a $10 Visa Gift Card! ` +
      `Would you like to participate in the SAT Summer Digital Challenge, or do you have any questions about it today?`,
    systemContext: (lead, vars) => {
      const studentFirst = lead.fullName ? lead.fullName.split(' ')[0] : 'there';
      return `━━━ CAMPAIGN: SAT SUMMER DIGITAL CHALLENGE ━━━
You are Annie, an AI Assistant calling from Test Prep Pundits on a live phone call with ${studentFirst}.

PROMOTIONAL CAMPAIGN ONLY — STRICT INSTRUCTION:
This campaign is purely an informational/promotional announcement about the SAT Summer Digital Challenge.
It must NEVER automatically or manually transition into consultation booking, meeting scheduling, or sales pitches.
DO NOT offer [OFFER_MEETING] under any circumstances.

EXACT SCRIPT ALREADY DELIVERED:
Opener (already spoken): "Hello, this is Annie, your AI Assistant from Test Prep Pundits. We're excited to announce our SAT Summer Digital Challenge! TURN YOUR SUMMER BREAK INTO SAT SUCCESS! Complete the entire SAT syllabus with: 70% or higher accuracy, and at least 5 hours of video lessons watched. Complete the challenge by August 9, 2026, and you'll win a $10 Visa Gift Card! Would you like to participate in the SAT Summer Digital Challenge, or do you have any questions about it today?"

SPEAKING RULES:
• Speak naturally and warmly.
• Keep responses SHORT — maximum 2 sentences per reply.
• Never use bullet points, numbers, or markdown — spoken words only.
• Never re-introduce yourself after the opening.
• PRONUNCIATION RULE: Always speak SAT letter-by-letter as "S-A-T" (never pronounce it as the word "sat").
• PROMOTIONAL ONLY: NEVER offer meetings, consultations, booking, or any sales pitch on this call.
• Respond immediately when the student speaks.

IF the student says "No", "No questions", or declines/shows no interest:
Say EXACTLY: "Thank you for your time. Have a wonderful day. Goodbye." then [END_CALL]

IF the student says YES, wants to participate, or asks a question:
Answer briefly and clearly (explain how to log in/participate or answer their question), then ask: "Do you have any other questions today?"
If they say no or any sign-off: Say EXACTLY: "Thank you for your time. Have a wonderful day. Goodbye." then [END_CALL]

GOAL: Politely inform the student about the SAT Summer Digital Challenge, assist with participation info or questions, then end the call gracefully.
NEVER transition into consultation booking. DO NOT offer [OFFER_MEETING]. DO NOT try to schedule anything. DO NOT do any sales pitch.`;
    },
  },
};

// ── Admin-edited scripts ────────────────────────────────────────────────────
// Stored per campaign in campaigns.script (JSONB):
//   { callType: 'announcement'|'information'|'booking',
//     opener, message, instructions }   (all strings, all optional)
// An empty object means "use the built-in script" — behaviour is unchanged.
const CALL_TYPES = ['announcement', 'information', 'booking'];
const PLACEHOLDERS = ['firstName', 'fullName', 'studentName', 'className', 'testName', 'homeworkTopic', 'talkingPoints', 'pendingSummary'];
// Prep365-only placeholders, filled from each student's synced data.
const PREP365_PLACEHOLDERS = ['reasons', 'daysInactive', 'daysSinceTest', 'customPrepPercent', 'customPrepExpected', 'planName', 'missedTopics', 'scoreChange'];

/** Per-student Prep365 facts (second person for the student, third person for a parent). */
function prep365Facts(lead) {
  const q = lead.qualification || {};
  const isParent = q.prep365RecipientType === 'parent';
  const snap = q.prep365Snapshot || {};
  const act = snap.activity || {};
  const plan = (snap.customPrep || [])[0] || {};
  const reasons = Array.isArray(q.prep365Reasons) ? q.prep365Reasons : [];
  const byCode = Object.fromEntries(reasons.map(r => [r.code || r, r]));
  const who = speakName((q.prep365StudentName || lead.fullName || 'your child').split(' ')[0]);

  const missedMatch = /(\d+)\s+Custom Prep topic/i.exec(byCode.MISSED_ASSIGNED_TOPICS?.detail || '');
  const scoreMatch = /is\s+([\d.]+%)[^\d]+([\d.]+%)/i.exec(byCode.DECLINING_PERFORMANCE?.detail || '');
  const facts = {
    daysInactive: act.daysInactive ?? '',
    daysSinceTest: act.daysSinceLastTest ?? '',
    customPrepPercent: plan.percentComplete !== undefined ? `${Math.round(plan.percentComplete)}%` : '',
    customPrepExpected: plan.expectedPercentByNow !== undefined ? `${Math.round(plan.expectedPercentByNow)}%` : '',
    planName: plan.planName || 'Custom Prep plan',
    missedTopics: missedMatch ? missedMatch[1] : (Array.isArray(plan.missedTopics) ? plan.missedTopics.length : ''),
    scoreChange: scoreMatch ? `from ${scoreMatch[2]} to ${scoreMatch[1]}` : '',
  };

  // One short spoken phrase per reason Prep365 flagged for this student.
  const S = isParent
    ? { havent: `${who} hasn't`, have: `${who} has`, your: `${who}'s` }
    : { havent: "you haven't", have: 'you have', your: 'your' };
  const phrases = [];
  if (byCode.INACTIVE) phrases.push(facts.daysInactive ? `${S.havent} logged in to Prep365 for ${facts.daysInactive} days` : `${S.havent} logged in to Prep365 recently`);
  if (byCode.NO_RECENT_TESTS) phrases.push(facts.daysSinceTest ? `${S.havent} taken a practice test in ${facts.daysSinceTest} days` : `${S.havent} taken a practice test recently`);
  if (byCode.CUSTOM_PREP_BEHIND) phrases.push(facts.customPrepPercent && facts.customPrepExpected
    ? `${S.your} Custom Prep plan is ${facts.customPrepPercent} done when it should be about ${facts.customPrepExpected} by now`
    : `${S.your} Custom Prep plan is behind schedule`);
  if (byCode.MISSED_ASSIGNED_TOPICS) phrases.push(facts.missedTopics ? `${S.have} ${facts.missedTopics} assigned topics still unfinished` : `${S.have} missed some assigned daily or weekly topics`);
  if (byCode.DECLINING_PERFORMANCE) phrases.push(facts.scoreChange ? `${S.your} recent test average dropped ${facts.scoreChange}` : `${S.your} recent test scores have dropped`);
  facts.reasons = phrases.length <= 1 ? (phrases[0] || `${S.have} some pending study tasks`)
    : `${phrases.slice(0, -1).join(', ')}, and ${phrases[phrases.length - 1]}`;
  return facts;
}

function hasScriptOverride(script) {
  return !!script && typeof script === 'object' &&
    ['opener', 'message', 'instructions'].some(k => String(script[k] || '').trim()) ||
    (!!script && CALL_TYPES.includes(script.callType));
}

// "ANBAZHAGAN" → "Anbazhagan" so text-to-speech says the name instead of spelling it.
function speakName(n) {
  const s = String(n || '').trim();
  return s && s === s.toUpperCase() ? s.toLowerCase().replace(/\b\p{L}/gu, c => c.toUpperCase()) : s;
}

/** Fill {placeholders} for one call. Unknown placeholders are left as-is. */
function fillPlaceholders(text, lead = {}, vars = {}) {
  const isParent = lead.qualification?.prep365RecipientType === 'parent';
  const studentName = speakName(lead.qualification?.prep365StudentName || lead.fullName || '');
  const values = {
    firstName: speakName((lead.fullName || 'there').split(' ')[0]),
    fullName: speakName(lead.fullName || ''),
    studentName,
    className: vars?.className || 'class',
    testName: vars?.testName || 'the Full-Length Test',
    homeworkTopic: vars?.homeworkTopic || "today's assigned topic",
    talkingPoints: lead.qualification?.prep365TalkingPoints || lead.notes || '',
    pendingSummary: lead.qualification ? getPrep365PendingPoints(lead, isParent) : '',
    ...prep365Facts(lead),
  };
  return String(text || '').replace(/\{(\w+)\}/g, (m, k) => (k in values ? values[k] : m));
}

const CALL_TYPE_RULES = {
  announcement: 'This is a ONE-WAY announcement. The message has been fully delivered and the call ends. Do not offer meetings.',
  information: `This is an INFORMATION call. Answer questions briefly (max 2 sentences), then ask "Do you have any other questions today?".
If they say no or sign off, say "Thank you for your time. Have a wonderful day. Goodbye." then [END_CALL].
NEVER offer or book a meeting/consultation and NEVER use [OFFER_MEETING]. No sales pitch.`,
  booking: `GOAL: book a FREE consultation. If they show interest, offer to schedule it, then use [OFFER_MEETING].
If they decline, do not push more than once: say "I completely understand. Thank you so much for your time. Have a great day!" then [END_CALL].`,
};

/** Layer an admin-edited script over a campaign definition. */
function applyScriptOverride(base, script, name) {
  if (!hasScriptOverride(script)) return base;
  const callType = CALL_TYPES.includes(script.callType) ? script.callType : 'booking';
  const opener = String(script.opener || '').trim();
  const message = String(script.message || '').trim();
  const instructions = String(script.instructions || '').trim();
  const out = { ...base, scriptOverride: { callType, opener, message, instructions } };

  if (callType === 'announcement') {
    // Speak opener + message immediately, then hang up. No identity check.
    out.skipIdentityCheck = true;
    out.hangupAfterOpener = true;
    out.opener = (lead, isFollowUp, vars) => fillPlaceholders([opener, message].filter(Boolean).join(' '), lead, vars)
      || (base.opener ? base.opener(lead, isFollowUp, vars) : 'Hello.');
    out.voicemail = (lead, vars) => fillPlaceholders([opener, message].filter(Boolean).join(' '), lead, vars);
    out.turn0Line = () => '';
  } else {
    // Information / booking: opening line → caller replies → main message.
    out.hangupAfterOpener = false;
    if (message) {
      out.skipIdentityCheck = false;
      out.turn0Line = (lead, vars) => fillPlaceholders(message, lead, vars);
      out.opener = opener
        ? (lead, isFollowUp, vars) => fillPlaceholders(opener, lead, vars)
        : (base.isPrep365 && base.opener)
          ? base.opener
          : (lead) => `Hi, this is Annie, your AI Assistant from Test Prep Pundits. Am I speaking with ${firstName(lead)}?`;
    } else if (opener) {
      out.opener = (lead, isFollowUp, vars) => fillPlaceholders(opener, lead, vars);
    }
  }

  out.systemContext = (lead, vars) => {
    const parts = [`━━━ CAMPAIGN: ${(name || base.name || 'CAMPAIGN').toUpperCase()} (ADMIN SCRIPT) ━━━`];
    if (opener) parts.push(`Opening line (already spoken): "${fillPlaceholders(opener, lead, vars)}"`);
    if (message) parts.push(`Main message (deliver/delivered after the caller confirms): "${fillPlaceholders(message, lead, vars)}"`);
    parts.push(CALL_TYPE_RULES[callType]);
    if (instructions) parts.push('ADDITIONAL INSTRUCTIONS FROM ADMIN:\n' + fillPlaceholders(instructions, lead, vars));
    if (base.isPrep365) parts.push('NEVER mention Test Prep Pundits. You are calling from Prep365.');
    return parts.join('\n\n');
  };
  return out;
}

/**
 * Look up a campaign script by type. Unknown/empty types fall back to the
 * default Demo Test Follow-up campaign, preserving the original behaviour.
 * An admin-edited script (campaign row `script`) is layered on top when present.
 * @param {string} [type]
 * @param {object} [overrides]  Optional campaign row (name/program/script)
 */
function getCampaign(type, overrides = null) {
  const base = CAMPAIGNS[type];
  if (base) return applyScriptOverride(base, overrides?.script, overrides?.name);
  if (overrides && hasScriptOverride(overrides.script) && (overrides.script.callType || overrides.script.message || overrides.script.opener)) {
    const generic = { type: type || 'custom', name: overrides.name || 'Campaign', program: overrides.program || '' };
    return applyScriptOverride(generic, overrides.script, overrides.name);
  }

  // Custom / unknown campaign — build a generic invitation from the DB row.
  if (overrides && (type === 'custom' || !base)) {
    const name    = overrides.name || 'Test Prep Pundits Program';
    const program = overrides.program || 'our programs';
    const custom  = overrides.script || {};
    return {
      type: type || 'custom',
      name,
      program,
      turn0Line: (lead) =>
        custom.turn0Line ||
        `Great! I'm calling from Test Prep Pundits about our ${program} — ${name}. ` +
        `Would you like to learn more?`,
      systemContext: (lead) =>
        custom.systemContext ||
`━━━ CAMPAIGN: ${name.toUpperCase()} ━━━
This is an OUTREACH call about Test Prep Pundits's "${name}" (${program}).
GOAL: book a FREE consultation. Frame every meeting offer around this campaign.`,
    };
  }

  return CAMPAIGNS[DEFAULT_TYPE];
}

/** Ordered list of the built-in campaign types (for seeding / UI order). */
function defaultTypes() {
  return Object.keys(CAMPAIGNS);
}

module.exports = { getCampaign, defaultTypes, fillPlaceholders, hasScriptOverride, prep365Facts, DEFAULT_TYPE, CAMPAIGNS, CALL_TYPES, PLACEHOLDERS, PREP365_PLACEHOLDERS };

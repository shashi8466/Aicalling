/**
 * Ready-made scripts shown in the admin script editor, grouped by call type.
 * Picking one fills the editor fields; the admin can still change any word.
 *
 * Placeholders ({firstName}, {reasons}, {daysSinceTest}, …) are filled per call
 * by registry.fillPlaceholders — see registry.PLACEHOLDERS / PREP365_PLACEHOLDERS.
 */

const PREP365_INSTRUCTIONS_INFO =
  'This is a friendly study check-in, not a sales call. Listen to what is blocking them and suggest ONE small next step ' +
  '(log in today, finish one topic, or take one practice test). Be warm and encouraging. Keep the whole call under 60 seconds.';
const PREP365_INSTRUCTIONS_BOOK =
  'Be warm and encouraging. If they agree, book a free 15-minute session with a Prep365 coach. ' +
  'If they are busy, suggest they log in today and complete one topic instead. Never push more than once.';

function prep365Templates() {
  const hi = 'Hi {firstName}, this is Annie from Prep365.';
  return [
    // ── Announcements: speak and hang up ─────────────────────────────────
    { id: 'p-ann-all', callType: 'announcement', title: 'Study reminder — all reasons (recommended)',
      description: 'Mentions exactly what applies to each student.',
      opener: hi,
      message: 'This is a quick reminder about your study plan: {reasons}. Please log in to Prep365 today and complete at least one topic or practice test. You can do this — have a great day!' },
    { id: 'p-ann-inactive', callType: 'announcement', title: 'Inactive on Prep365',
      description: 'Best with the "Inactive on Prep365" filter.',
      opener: hi,
      message: "We noticed you haven't logged in to Prep365 for {daysInactive} days. Your study plan is waiting for you — please log in today and pick up where you left off. Have a great day!" },
    { id: 'p-ann-tests', callType: 'announcement', title: 'No tests attempted recently',
      description: 'Best with the "No Tests Attempted Recently" filter.',
      opener: hi,
      message: "It's been {daysSinceTest} days since your last practice test. Taking one this week will show you exactly where to focus. Please log in to Prep365 and take a practice test today. Good luck!" },
    { id: 'p-ann-customprep', callType: 'announcement', title: 'Custom Prep plan behind schedule',
      description: 'Best with the "Custom Prep Plan Incomplete" filter.',
      opener: hi,
      message: 'Your {planName} is {customPrepPercent} done, and it should be about {customPrepExpected} by now. Completing just one topic today will help you catch up. Please log in to Prep365 when you can. Have a great day!' },
    { id: 'p-ann-missed', callType: 'announcement', title: 'Missed assigned topics',
      description: 'Best with the "Missed Assigned Daily/Weekly Topics" filter.',
      opener: hi,
      message: 'You have {missedTopics} assigned topics that are still unfinished. Please log in to Prep365 and complete your daily and weekly topics so you stay on track. Have a great day!' },
    { id: 'p-ann-declining', callType: 'announcement', title: 'Declining test performance',
      description: 'Best with the "Declining Test Performance" filter.',
      opener: hi,
      message: 'Your recent test average dropped {scoreChange}. That happens, and a little focused practice will turn it around. Please log in to Prep365 and review your last test today. We believe in you!' },

    // ── Information: identity check, message, answer questions ───────────
    { id: 'p-info-all', callType: 'information', title: 'Study check-in — all reasons (recommended)',
      description: 'Asks what is getting in the way and suggests a next step.',
      opener: 'Hi, this is Annie from Prep365. Am I speaking with {firstName}?',
      message: "Great! I'm calling for a quick check-in on your study plan. I noticed {reasons}. Is anything making it hard to study right now?",
      instructions: PREP365_INSTRUCTIONS_INFO },
    { id: 'p-info-inactive', callType: 'information', title: 'Inactive check-in',
      description: 'Asks why they have not logged in.',
      opener: 'Hi, this is Annie from Prep365. Am I speaking with {firstName}?',
      message: "Great! I noticed you haven't logged in to Prep365 for {daysInactive} days, and we want to make sure everything is okay. Is something getting in the way of your studying?",
      instructions: PREP365_INSTRUCTIONS_INFO },
    { id: 'p-info-tests', callType: 'information', title: 'Practice test check-in',
      description: 'Encourages taking a practice test.',
      opener: 'Hi, this is Annie from Prep365. Am I speaking with {firstName}?',
      message: "Great! It's been {daysSinceTest} days since your last practice test. Could you take one this week? Is there anything stopping you?",
      instructions: PREP365_INSTRUCTIONS_INFO },
    { id: 'p-info-parent', callType: 'information', title: 'Parent update',
      description: 'For parents — talks about their child by name.',
      opener: 'Hi, this is Annie from Prep365. Am I speaking with {firstName}?',
      message: "Thank you! I'm calling with a quick update on {studentName}'s SAT prep: {reasons}. Could you encourage {studentName} to log in to Prep365 today? Do you have any questions for me?",
      instructions: PREP365_INSTRUCTIONS_INFO },

    // ── Meeting booking ───────────────────────────────────────────────────
    { id: 'p-book-all', callType: 'booking', title: 'Book a coaching session — all reasons',
      description: 'Offers a free session with a Prep365 coach.',
      opener: 'Hi, this is Annie from Prep365. Am I speaking with {firstName}?',
      message: "Great! I noticed {reasons}. We'd love to help you get back on track. Would you like to book a free 15-minute session with a Prep365 coach?",
      instructions: PREP365_INSTRUCTIONS_BOOK },
    { id: 'p-book-declining', callType: 'booking', title: 'Book a score review',
      description: 'Best with the "Declining Test Performance" filter.',
      opener: 'Hi, this is Annie from Prep365. Am I speaking with {firstName}?',
      message: 'Great! Your recent test average dropped {scoreChange}. A coach can go through your last test with you and build a plan to bring it back up. Would you like to book a free 15-minute score review?',
      instructions: PREP365_INSTRUCTIONS_BOOK },
  ];
}

/** Turn a built-in message into a one-way announcement (no trailing question). */
function asAnnouncement(message) {
  const m = String(message || '').replace(/^(Great!|Thank you!)\s*/i, '').trim();
  const noQuestion = m.replace(/\s*[^.!?]*\?\s*$/, '').trim();
  return (noQuestion || m) + ' To learn more, visit www.testpreppundits.com. Have a great day!';
}

function genericTemplates(row, defaults) {
  const name = row.name || 'our program';
  const builtIn = String(defaults.message || '').trim();
  const intro = 'Hi {firstName}, this is Annie, your AI Assistant from Test Prep Pundits.';
  const ask = 'Hi, this is Annie, your AI Assistant from Test Prep Pundits. Am I speaking with {firstName}?';
  const list = [];

  if (defaults.callType === 'announcement') {
    list.push({ id: 'g-ann-builtin', callType: 'announcement', title: 'Built-in announcement', description: 'The current script for this campaign.',
      opener: '', message: [defaults.opener, builtIn].filter(Boolean).join(' ') });
  } else if (builtIn) {
    list.push({ id: 'g-ann-builtin', callType: 'announcement', title: `${name} — announcement`,
      description: 'Built-in message, read out without waiting for a reply.', opener: intro, message: asAnnouncement(builtIn) });
  }
  list.push({ id: 'g-ann-general', callType: 'announcement', title: 'General announcement',
    description: 'Short update — replace the bracketed part.', opener: intro,
    message: `We have an important update about ${name}: [write your update here]. Have a great day!` });

  if (builtIn) {
    list.push({ id: 'g-info-builtin', callType: 'information', title: `${name} — information`,
      description: 'Built-in message; answers questions, never books.', opener: ask, message: builtIn });
    list.push({ id: 'g-book-builtin', callType: 'booking', title: `${name} — book a consultation`,
      description: 'Built-in message; offers a free consultation.', opener: ask,
      message: /consult|schedul|book/i.test(builtIn) ? builtIn
        : builtIn.replace(/\s*[^.!?]*\?\s*$/, '').trim() + ' Would you like to book a free 15-minute consultation with one of our advisors?' });
  }
  list.push({ id: 'g-info-general', callType: 'information', title: 'General information call',
    description: 'Shares an update and answers questions.', opener: ask,
    message: `Great! I'm calling with a quick update about ${name}: [write your update here]. Do you have any questions for me?` });
  list.push({ id: 'g-book-general', callType: 'booking', title: 'General consultation booking',
    description: 'Invites them to a free consultation.', opener: ask,
    message: `Great! I'm calling about ${name}. We'd love to help you plan your next steps — would you like to book a free 15-minute consultation with one of our advisors?` });
  return list;
}

/** Templates for one campaign row, given its built-in defaults (campaignService.previewDefaults). */
function templatesFor(row, defaults) {
  if (row.type === 'prep365-retention') return prep365Templates();
  return genericTemplates(row, defaults);
}

module.exports = { templatesFor };

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

// ── Campaign definitions ────────────────────────────────────────────────────
const CAMPAIGNS = {
  // 1) EXISTING FLOW — must stay identical to prior hard-coded behaviour.
  'demo-test-followup': {
    type: 'demo-test-followup',
    name: 'Demo Test Follow-up',
    program: 'Multiple',
    turn0Line: (lead) =>
      `Great! I noticed that you recently completed a demo test with Aiprep365. ` +
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
      `May I take a minute to tell you about the program?`,
    systemContext: (lead) =>
`━━━ CAMPAIGN: SAT BATCH PROMOTION ━━━
This is an OUTREACH call inviting ${firstName(lead)} to join Test Prep Pundits's newly launched SAT Preparation Batch.

OPENING INTENT (already delivered): Announced the new SAT Batch with a 40% discount and asked if we can take a minute to tell them about the program.

If they say YES to the opening:
Say: "Our SAT Preparation Program includes a personalized SAT study plan, live expert classes, full-length SAT practice tests, one-on-one mentoring, college admissions guidance, and regular progress tracking. We're proud to have helped 2,000+ happy families and earned 300+ five-star reviews from students and parents. Would you like to learn more about our SAT Preparation Program?"

If they say YES to learning more:
Say: "That's wonderful! I'd be happy to schedule a FREE 10–15 minute consultation with one of our SAT advisors. During the consultation, we'll explain the complete program, answer your questions, and help you create the right SAT preparation plan." then [OFFER_MEETING]

After the meeting is booked, say EXACTLY:
"Perfect! Your consultation has been successfully scheduled. You'll receive the meeting details by email shortly. You can also visit www.testpreppundits.com to learn more. Thank you, and have a wonderful day!" then [END_CALL]

GOAL: book a FREE 10–15 minute consultation with an SAT advisor.`
  },

  // 3) ACT Batch Promotion
  'act-batch': {
    type: 'act-batch',
    name: 'ACT Batch Promotion',
    program: 'ACT',
    turn0Line: (lead) =>
      `We're excited to announce our new ACT Preparation Batch, and we're currently offering an exclusive 40% discount for a limited time. ` +
      `May I take a minute to tell you about the program?`,
    systemContext: (lead) =>
`━━━ CAMPAIGN: ACT BATCH PROMOTION ━━━
This is an OUTREACH call inviting ${firstName(lead)} to join Test Prep Pundits's new ACT Preparation Batch.

OPENING INTENT (already delivered): Announced the new ACT Batch with a 40% discount and asked if we can take a minute to tell them about the program.

If they say YES to the opening:
Say: "Our ACT Preparation Program includes a personalized ACT study plan, live expert classes, full-length ACT practice exams, one-on-one mentoring, college admissions guidance, and weekly progress tracking. We've helped 2,000+ happy families and have received 300+ five-star reviews. Would you like to learn more about our ACT Preparation Program?"

If they say YES to learning more:
Say: "Fantastic! I'd be happy to schedule a FREE 10–15 minute consultation with one of our ACT advisors. They'll explain the program, answer your questions, and help you prepare for the ACT." then [OFFER_MEETING]

After the meeting is booked, say EXACTLY:
"Perfect! Your consultation has been successfully scheduled. You'll receive your meeting details by email shortly. For more information, visit www.testpreppundits.com. Thank you, and have a great day!" then [END_CALL]

GOAL: book a FREE 10–15 minute consultation with an ACT advisor.`
  },

  // 4) AP Course Promotion
  'ap-course': {
    type: 'ap-course',
    name: 'AP Course Promotion',
    program: 'AP',
    turn0Line: (lead) =>
      `We're excited to announce our new Advanced Placement (AP) Preparation Program, and we're offering an exclusive 40% discount for a limited time. ` +
      `May I take a minute to tell you about the program?`,
    systemContext: (lead) =>
`━━━ CAMPAIGN: AP COURSE PROMOTION ━━━
This is an OUTREACH call inviting ${firstName(lead)} to Test Prep Pundits's new AP Preparation Program.

OPENING INTENT (already delivered): Announced the new AP Program with a 40% discount and asked if we can take a minute to tell them about the program.

If they say YES to the opening:
Say: "Our AP Preparation Program includes subject-specific AP preparation, live expert instructors, practice tests and assignments, personalized study plans, one-on-one academic mentoring, and progress tracking. We've proudly helped 2,000+ happy families and earned 300+ five-star reviews. Would you like to learn more about our AP Preparation Program?"

If they say YES to learning more:
Say: "Excellent! I'd be happy to schedule a FREE 10–15 minute consultation with one of our AP advisors. They'll explain the program, answer your questions, and help you choose the right AP courses." then [OFFER_MEETING]

After the meeting is booked, say EXACTLY:
"Perfect! Your consultation has been successfully scheduled. You'll receive the meeting details by email shortly. You can also visit www.testpreppundits.com for more information. Thank you, and have a wonderful day!" then [END_CALL]

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
This is an OUTREACH call inviting ${firstName(lead)} to Aiprep365's personalized College Admissions Counseling.
The student may NOT have interacted with Aiprep365 before — never assume prior contact or a demo test.

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
      `Great! I'm calling to invite you to Aiprep365's free Scholarship Webinar — ` +
      `we'll cover how to find and win scholarships to lower college costs. ` +
      `Would you like to learn more?`,
    systemContext: (lead) =>
`━━━ CAMPAIGN: SCHOLARSHIP WEBINAR INVITATION ━━━
This is an OUTREACH call inviting ${firstName(lead)} (and their parents) to Aiprep365's free Scholarship Webinar.
Highlight naturally: finding scholarships, eligibility, application tips, and reducing college costs.
GOAL: get them to register and book a FREE consultation. Frame the meeting as a scholarship-planning consultation.`,
  },

  // 7) Free Mock Test
  'free-mock-test': {
    type: 'free-mock-test',
    name: 'Free Mock Test',
    program: 'Mock Test',
    turn0Line: (lead) =>
      `Great! I'm calling to offer you a free full-length mock test from Aiprep365, ` +
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
      `Great! I'm calling to invite you to a free parent counseling session with Aiprep365, ` +
      `where we'll discuss your child's academic goals and the best prep pathway. ` +
      `Would you like to learn more?`,
    systemContext: (lead) =>
`━━━ CAMPAIGN: PARENT COUNSELING SESSION ━━━
This is an OUTREACH call inviting the PARENT of ${firstName(lead)} to a free counseling session.
Speak to the parent respectfully; focus on the student's goals, timelines, and recommended prep pathway.
GOAL: book a FREE consultation with a counselor. Frame every meeting offer as a parent counseling session.`,
  },

  // 9) Business Partner Opportunity
  'business-partner': {
    type: 'business-partner',
    name: 'Business Partner Opportunity',
    program: 'Business Partner',
    opener: (lead, isFollowUp) => 
      `Hello, this is Ravi Gunishetty calling from HGI. Am I speaking with ${firstName(lead)}?`,
    turn0Line: (lead) =>
      `I hope you're doing well. We are currently looking for a few motivated business partners to join our growing network. ` +
      `The good news is that this opportunity does not require any financial investment. The only investment is your time and commitment. ` +
      `Many of our partners have built successful businesses with us. Some of them are now earning over ₹100,000 per month after approximately three years of consistent effort and hard work. ` +
      `We provide personal mentorship, step-by-step guidance, growth opportunities, and a supportive business community. ` +
      `Would you be interested in learning more about this business opportunity?`,
    systemContext: (lead) =>
`━━━ CAMPAIGN: BUSINESS PARTNER OPPORTUNITY ━━━
This is an OUTREACH call inviting ${firstName(lead)} to learn about the HGI business partnership opportunity.

OPENING INTENT (already delivered): Introduced the HGI business opportunity, mentioning no financial investment, earning potential (₹100,000/month after 3 years), and asked if they are interested.

If they say YES to learning more:
Say: "That's wonderful! I'd be happy to schedule a FREE 15-minute introductory meeting where one of our business advisors will explain how the business works, the income opportunities, the growth plan, and the training process, and answer any questions you might have." then [OFFER_MEETING]

After the meeting is booked, say EXACTLY:
"Excellent! Your meeting has been successfully scheduled. You'll receive the meeting link and confirmation shortly. Thank you for your time, and we look forward to speaking with you. Have a wonderful day!" then [END_CALL]

If they say NO or NOT INTERESTED at any point:
Say EXACTLY: "No problem at all. Thank you for your time today. If you ever wish to learn more in the future, we'd be happy to help. Have a great day!" then [END_CALL]

GOAL: book a FREE 15-minute introductory meeting with a business advisor.`
  },
};

/**
 * Look up a campaign script by type. Unknown/empty types fall back to the
 * default Demo Test Follow-up campaign, preserving the original behaviour.
 * @param {string} [type]
 * @param {object} [overrides]  Optional campaign row fields (name/program/script)
 *                              used by user-created "custom" campaigns.
 */
function getCampaign(type, overrides = null) {
  const base = CAMPAIGNS[type];
  if (base) return base;

  // Custom / unknown campaign — build a generic invitation from the DB row.
  if (overrides && (type === 'custom' || !base)) {
    const name    = overrides.name || 'Aiprep365 Program';
    const program = overrides.program || 'our programs';
    const custom  = overrides.script || {};
    return {
      type: type || 'custom',
      name,
      program,
      turn0Line: (lead) =>
        custom.turn0Line ||
        `Great! I'm calling from Aiprep365 about our ${program} — ${name}. ` +
        `Would you like to learn more?`,
      systemContext: (lead) =>
        custom.systemContext ||
`━━━ CAMPAIGN: ${name.toUpperCase()} ━━━
This is an OUTREACH call about Aiprep365's "${name}" (${program}).
GOAL: book a FREE consultation. Frame every meeting offer around this campaign.`,
    };
  }

  return CAMPAIGNS[DEFAULT_TYPE];
}

/** Ordered list of the built-in campaign types (for seeding / UI order). */
function defaultTypes() {
  return Object.keys(CAMPAIGNS);
}

module.exports = { getCampaign, defaultTypes, DEFAULT_TYPE, CAMPAIGNS };

/**
 * AI Conversation Service
 * Drives Shashi Kumar's voice via OpenAI or Claude.
 * Used inside the Twilio webhook loop.
 */
const OpenAI    = require('openai');
const Anthropic = require('@anthropic-ai/sdk');
const cfg       = require('../config');
const logger    = require('../logger');
const { getKnowledge } = require('../knowledge/kb');

const openai    = new OpenAI({ apiKey: cfg.openai.apiKey });
const anthropic = cfg.anthropic?.apiKey ? new Anthropic({ apiKey: cfg.anthropic.apiKey }) : null;

// ─── System prompt ────────────────────────────────────────────────────────────
function buildSystem(lead) {
  const program = (lead.courseInterest || lead.qualification?.interestedProgram || '').toLowerCase();
  const isSAT   = program.includes('sat');
  const isACT   = program.includes('act');
  const isAP    = program.includes('ap');

  const studentFirst = lead.fullName.split(' ')[0];

  return `You are Shashi, a friendly and professional male admissions counselor at Test Prep Pundits. You are on a live phone call.

━━━ CORE RULES ━━━
• Speak EXACTLY like a real human on a phone call — warm, natural, never robotic.
• Maximum 2 sentences per response. One idea at a time.
• Ask only ONE question per turn. Wait for the answer before moving on.
• If they ask you something, answer it first, then continue the script.
• Never use bullet points, numbers, or markdown — only spoken words.
• Use the student's first name (${studentFirst}) naturally in conversation.

🚨 THE GOLDEN RULE 🚨
DO NOT END THE CALL until ONE of these two things has happened:
  (A) A meeting has been successfully booked, OR
  (B) The caller has CLEARLY and EXPLICITLY refused a meeting
      (e.g. "I'm not interested", "no thanks", "remove me from your list", "stop calling")

If the caller is interested but undecided about timing, KEEP OFFERING SLOTS.
If they say "I need to check my schedule" — don't hang up; offer to wait or suggest specific times.
If they say "maybe later" — try once more with a different angle, then propose a concrete time.
NEVER append [END_CALL] just because they hesitate or seem unsure.

━━━ LEAD INFO ━━━
Student: ${lead.fullName} (call them "${studentFirst}")
Parent:  ${lead.parentName || 'not provided'}
Grade:   ${lead.grade || 'not provided'}
Program: ${lead.courseInterest || 'not yet confirmed'}
Known qualification data: ${JSON.stringify(lead.qualification || {})}

━━━ EXACT CALL FLOW ━━━

[STEP 1 — IDENTITY CONFIRMED]
The call just opened with: "Hello, this is Shashi from Test Prep Pundits. Am I speaking with ${studentFirst}?"
Now WAIT for them to confirm (yes / I'm their parent / this is ${studentFirst} / etc.)
Once they confirm who they are, say EXACTLY:
"Great! I noticed that ${studentFirst} recently completed a demo test with Test Prep Pundits, and I wanted to follow up to see how we can help."

[STEP 2 — FIND THE PROGRAM]
Then ask: "Are you interested in learning more about SAT, ACT, or AP courses?"
Wait for their answer.

[STEP 3A — SAT PATH]
If they say SAT:
Say: "Great choice! The SAT evaluates Reading, Writing, and Math. A strong score can really boost college admissions and scholarship opportunities."
Then collect these ONE AT A TIME — wait for each answer before the next:
  → "May I ask what ${studentFirst}'s current SAT score is?"
  → "And what is your target SAT score?"
  → "When are you planning to take the SAT exam?"
After all 3: "Based on your goals, our advisors can create a personalized study plan for ${studentFirst}. Would you like to schedule a free 10 to 15 minute consultation to discuss the best approach?"

[STEP 3B — ACT PATH]
If they say ACT:
Say: "Excellent! The ACT covers English, Math, Reading, and Science, and it's accepted by every US college."
Collect ONE AT A TIME:
  → "What is ${studentFirst}'s current ACT composite score?"
  → "What score are you aiming to reach?"
  → "When is the planned exam date?"
After all 3: "Our ACT specialists can build a targeted prep plan around those goals. Would you like a free 10 to 15 minute consultation to map out the strategy?"

[STEP 3C — AP PATH]
If they say AP:
Say: "We support all major AP subjects and our students consistently score 4s and 5s."
Ask: "Which AP course or courses is ${studentFirst} preparing for?"
After answer: "Our AP advisors can walk you through the best preparation approach. Would you like a free 10 to 15 minute call with one of our specialists?"

[STEP 4 — OFFER MEETING — if they haven't been asked yet]
If program is unclear, ask first. Once program is known and basic info collected:
Say: "I'd love to schedule a FREE 10 to 15 minute consultation for you. It's quick and completely no obligation. Would that work for you?"

[STEP 5 — THEY SAY YES OR ARE INTERESTED]
Say: "Wonderful! Let me pull up the next available slots for you."
Then append exactly: [OFFER_MEETING]

[STEP 5b — THEY HESITATE OR SAY MAYBE]
Do NOT give up. Try one of these gently:
  • "Totally understand — most parents find even a 10 minute chat clarifies things. Would mornings or evenings work better?"
  • "I can find a slot that fits ${studentFirst}'s schedule perfectly. Are weekdays or weekends easier?"
  • "How about we just lock in a tentative time? You can always reschedule if needed."
Then append [OFFER_MEETING] to surface slots.

[STEP 6 — THEY EXPLICITLY DECLINE] (must be unambiguous: "not interested", "no thank you", "stop calling", "remove me")
Say: "Absolutely no pressure at all. If ${studentFirst} ever wants to explore options, we're always here to help. Thank you so much for your time and have a great day!"
Then append exactly: [END_CALL]

[STEP 7 — AFTER MEETING IS SUCCESSFULLY BOOKED]
The system will say "Do you have any questions before we finish?"
• If they have a question: answer it briefly, then ask "anything else?"
• If they say "no" / "all good" / "that's it": Say "Thank you so much! Have a wonderful day, and we look forward to helping ${studentFirst} achieve their goals!" then append [END_CALL]

⚠️ IMPORTANT — DON'T HANG UP UNTIL:
- A meeting is booked (system will tell you), OR
- The caller clearly refuses (Step 6)
If they say things like "let me think", "I'll get back to you", "send me info" — KEEP TRYING to book a meeting. Suggest specific times. Offer flexibility. Don't give up after one "maybe".

━━━ OBJECTION RESPONSES ━━━
"Too expensive":
→ "I completely understand. We have group class options starting at just $599 and flexible payment plans. Would it help if I shared more details on those?"

"Already have a tutor":
→ "That's great! Our program works well alongside existing prep too. Would you be open to a quick 10-minute call just to compare approaches?"

"Not ready yet":
→ "No worries at all. Starting early actually gives ${studentFirst} the most flexibility. Could we even just do a quick 10-minute call to map out a timeline?"

"Need to ask parent / spouse":
→ "Of course, that makes total sense. Would it be possible to get them on a quick call together? I can find a time that works for everyone."

"Busy right now":
→ "Absolutely, I won't keep you. Could I call back at a better time — maybe tomorrow morning or evening?"

━━━ KNOWLEDGE BASE ANSWERS ━━━
Use only provided knowledge snippets to answer pricing or program questions.
If you don't know something: "That's a great question — let me have one of our senior advisors confirm the exact details and get back to you."

━━━ SPECIAL TOKENS ━━━
Append [OFFER_MEETING] when caller agrees to schedule → triggers calendar slot offering
Append [END_CALL]      when caller ends the call or is clearly not interested`;
}

// ─── Main entry ───────────────────────────────────────────────────────────────
async function chat({ lead, history, userMessage }) {
  // Retrieve relevant knowledge snippets
  const snippets = getKnowledge(userMessage);
  const knowledge = snippets.length
    ? `\n\nKNOWLEDGE BASE (use this to answer questions):\n${snippets.join('\n---\n')}`
    : '';

  const system = buildSystem(lead) + knowledge;

  try {
    if (cfg.llm.provider === 'anthropic') {
      return await _callClaude(system, history, userMessage);
    }
    return await _callOpenAI(system, history, userMessage);
  } catch (err) {
    logger.error('AI chat error', { msg: err.message });
    return "I'm sorry, I had a brief technical issue. Could you repeat that?";
  }
}

async function _callOpenAI(system, history, userMessage) {
  const messages = [
    ...history,
    { role: 'user', content: userMessage },
  ];
  const res = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    max_tokens: 250,
    temperature: 0.65,
    messages: [{ role: 'system', content: system }, ...messages],
  });
  return res.choices[0].message.content.trim();
}

async function _callClaude(system, history, userMessage) {
  const messages = [
    ...history,
    { role: 'user', content: userMessage },
  ];
  const res = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 200,
    system,
    messages,
  });
  return res.content[0].text.trim();
}

// ─── Extraction: pull qualification fields from transcript ────────────────────
async function extractQualification(transcript) {
  const prompt = `Extract qualification data from this admissions call transcript.
Return ONLY valid JSON with these keys (use null if not mentioned):
studentGrade, interestedProgram, currentScore, targetScore, targetExamDate,
preferredFormat, parentInvolvement, budgetRange, availability, objections (array), sentiment

Transcript:
${transcript}`;

  try {
    let raw;
    if (cfg.llm.provider === 'anthropic') {
      const r = await anthropic.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 400,
        messages: [{ role: 'user', content: prompt }],
      });
      raw = r.content[0].text;
    } else {
      const r = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        max_tokens: 400,
        response_format: { type: 'json_object' },
        messages: [{ role: 'user', content: prompt }],
      });
      raw = r.choices[0].message.content;
    }
    return JSON.parse(raw.match(/\{[\s\S]*\}/)?.[0] || '{}');
  } catch (err) {
    logger.error('extractQualification error', { msg: err.message });
    return {};
  }
}

// ─── Summary generator ────────────────────────────────────────────────────────
async function summariseCall(transcript, lead) {
  const prompt = `Summarise this admissions call in 3-5 bullet points.

IMPORTANT:
- The student's name is "${lead.fullName}" (Grade ${lead.grade || 'unknown'}).
- The parent's name is "${lead.parentName || 'unknown'}".
- The interested program is "${lead.courseInterest || 'unknown'}".
- "AGENT" in the transcript is the AI admissions counselor (Shashi from Test Prep Pundits) — NOT the student.
- "Caller" in the transcript is whoever answered the phone (likely ${lead.fullName} or their parent).
- Do NOT confuse the agent's name with the student's name.

Focus on:
• Student details (use the name "${lead.fullName}")
• Program interest, current and target scores
• Exam date if mentioned
• Caller concerns or objections
• Outcome (meeting booked / not interested / follow-up needed)

Transcript:
${transcript}`;

  try {
    if (cfg.llm.provider === 'anthropic') {
      const r = await anthropic.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 300,
        messages: [{ role: 'user', content: prompt }],
      });
      return r.content[0].text.trim();
    }
    const r = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      max_tokens: 300,
      messages: [{ role: 'user', content: prompt }],
    });
    return r.choices[0].message.content.trim();
  } catch {
    return 'Summary unavailable.';
  }
}

module.exports = { chat, extractQualification, summariseCall };

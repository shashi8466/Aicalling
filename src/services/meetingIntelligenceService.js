/**
 * Meeting Intelligence Service — Phase 2
 * ─────────────────────────────────────────────────────────
 * Generates AI executive summary, action items, sentiment timeline, and
 * conversation-intelligence metrics from a meeting transcript. Clones the
 * dual-provider (OpenAI/Anthropic) prompt pattern already used in aiService.js
 * (summariseCall/extractQualification) rather than inventing a new convention.
 *
 * Talk time / questions-asked / avg response time are computed deterministically
 * from the transcript's own segment timestamps — never LLM-estimated.
 */
const OpenAI    = require('openai');
const Anthropic = require('@anthropic-ai/sdk');
const cfg    = require('../config');
const logger = require('../logger');

const openai    = new OpenAI({ apiKey: cfg.openai.apiKey });
const anthropic = cfg.anthropic?.apiKey ? new Anthropic({ apiKey: cfg.anthropic.apiKey }) : null;

async function _completeText(prompt, maxTokens) {
  try {
    if (cfg.llm.provider === 'anthropic' && anthropic) {
      const r = await anthropic.messages.create({ model: 'claude-haiku-4-5-20251001', max_tokens: maxTokens, messages: [{ role: 'user', content: prompt }] });
      return r.content[0].text.trim();
    }
    const r = await openai.chat.completions.create({ model: 'gpt-4o-mini', max_tokens: maxTokens, messages: [{ role: 'user', content: prompt }] });
    return r.choices[0].message.content.trim();
  } catch (err) {
    logger.error('meetingIntelligenceService: text completion failed', { msg: err.message });
    return '';
  }
}

async function _completeJSON(prompt, maxTokens) {
  try {
    let raw;
    if (cfg.llm.provider === 'anthropic' && anthropic) {
      const r = await anthropic.messages.create({ model: 'claude-haiku-4-5-20251001', max_tokens: maxTokens, messages: [{ role: 'user', content: prompt }] });
      raw = r.content[0].text;
    } else {
      const r = await openai.chat.completions.create({ model: 'gpt-4o-mini', max_tokens: maxTokens, response_format: { type: 'json_object' }, messages: [{ role: 'user', content: prompt }] });
      raw = r.choices[0].message.content;
    }
    return JSON.parse(raw.match(/\{[\s\S]*\}/)?.[0] || '{}');
  } catch (err) {
    logger.error('meetingIntelligenceService: JSON completion failed', { msg: err.message });
    return {};
  }
}

// ─── AI Meeting Summary ────────────────────────────────────────────────────
async function summariseMeeting(fullText, lead) {
  const prompt = `Summarise this video consultation meeting transcript in 3-6 bullet points.

IMPORTANT:
- The student's name is "${lead.fullName}" (Grade ${lead.grade || 'unknown'}).
- The parent's name is "${lead.parentName || 'unknown'}".
- The interested program is "${lead.courseInterest || 'unknown'}".
- Each transcript line is prefixed with the speaker's own display name (not a fixed
  role) — infer from context who is the counselor vs. the student/parent.

Focus on:
• What was discussed (program, pricing, batch timing, scholarships, etc.)
• Questions or concerns raised
• Any commitments made (enrollment, next steps, follow-up call)
• Overall outcome of the meeting

Transcript:
${fullText}`;
  const text = await _completeText(prompt, 350);
  return text || 'Summary unavailable.';
}

// ─── AI Action Items ───────────────────────────────────────────────────────
async function extractActionItems(fullText) {
  const prompt = `Extract action items from this consultation meeting transcript.
Return ONLY valid JSON: { "counselorTasks": ["..."], "studentTasks": ["..."] }
Each task should be a short, concrete to-do a CRM could show as a checklist item
(e.g. "Send SAT Brochure", "Share Pricing", "Send Scholarship Details",
"Schedule Demo Class", "Review Course", "Discuss with Parents", "Complete Registration").
If nothing is mentioned for a category, return an empty array for it.

Transcript:
${fullText}`;
  const json = await _completeJSON(prompt, 300);
  const counselorTasks = Array.isArray(json.counselorTasks) ? json.counselorTasks : [];
  const studentTasks = Array.isArray(json.studentTasks) ? json.studentTasks : [];
  return [
    ...counselorTasks.map(task => ({ assignee: 'counselor', task, done: false })),
    ...studentTasks.map(task => ({ assignee: 'student', task, done: false })),
  ];
}

// ─── AI Sentiment Timeline ─────────────────────────────────────────────────
const SENTIMENTS = ['Positive', 'Neutral', 'Confused', 'Interested', 'Excited', 'Concerned', 'Frustrated', 'Hesitant'];

async function analyzeSentimentTimeline(fullText, durationMs) {
  const minutes = Math.max(1, Math.round(durationMs / 60000));
  const prompt = `Read this consultation meeting transcript (each line "Speaker: text", chronological, spanning about ${minutes} minute(s)).
Track how the student's (or parent's, if they are the primary speaker) sentiment/interest
changed over the course of the call.
Return ONLY valid JSON: { "timeline": [ {"atMs": number, "sentiment": string}, ... ] }
"sentiment" must be exactly one of: ${SENTIMENTS.join(', ')}.
Produce 5-10 points spread across 0 to ${durationMs} ms, reflecting genuine shifts in tone —
do not just repeat the same value.

Transcript:
${fullText}`;
  const json = await _completeJSON(prompt, 400);
  const timeline = Array.isArray(json.timeline) ? json.timeline : [];
  return timeline
    .filter(p => p && typeof p.atMs === 'number' && SENTIMENTS.includes(p.sentiment))
    .sort((a, b) => a.atMs - b.atMs);
}

// ─── Deterministic conversation statistics (NOT LLM-estimated) ────────────
function computeStats(segments) {
  const talkTimeMs = {};
  let questionsAsked = 0;
  for (const seg of segments) {
    const dur = Math.max(0, (seg.endMs || 0) - (seg.startMs || 0));
    talkTimeMs[seg.speaker] = (talkTimeMs[seg.speaker] || 0) + dur;
    if ((seg.text || '').includes('?')) questionsAsked++;
  }
  const gaps = [];
  for (let i = 1; i < segments.length; i++) {
    if (segments[i].speaker !== segments[i - 1].speaker) {
      const gap = segments[i].startMs - segments[i - 1].endMs;
      if (gap >= 0 && gap < 30000) gaps.push(gap); // ignore long pauses — not a real "response"
    }
  }
  const avgResponseTimeMs = gaps.length ? Math.round(gaps.reduce((a, b) => a + b, 0) / gaps.length) : 0;
  return { talkTimeMs, questionsAsked, avgResponseTimeMs };
}

// ─── AI Conversation Intelligence Dashboard ────────────────────────────────
async function computeConversationIntelligence(fullText, segments) {
  const prompt = `Analyze this consultation meeting transcript and return ONLY valid JSON with these exact keys:
{
  "interestScore": number (0-100, how interested the student/parent seems in enrolling),
  "enrollmentProbability": number (0-100, likelihood they actually enroll),
  "buyingIntent": "Low" | "Medium" | "High",
  "confidenceLevel": "Low" | "Medium" | "High" | "Very High" (your confidence in this analysis),
  "detectedTopics": ["..."] (short labels, e.g. "SAT", "Scholarships", "Batch Timing", "Pricing"),
  "commonQuestions": ["..."] (short summaries of questions the caller asked),
  "objections": ["..."] (short summaries of hesitations/objections raised)
}

Transcript:
${fullText}`;
  const json = await _completeJSON(prompt, 500);
  const stats = computeStats(segments);

  return {
    interestScore: typeof json.interestScore === 'number' ? json.interestScore : null,
    enrollmentProbability: typeof json.enrollmentProbability === 'number' ? json.enrollmentProbability : null,
    buyingIntent: json.buyingIntent || null,
    confidenceLevel: json.confidenceLevel || null,
    detectedTopics: Array.isArray(json.detectedTopics) ? json.detectedTopics : [],
    commonQuestions: Array.isArray(json.commonQuestions) ? json.commonQuestions : [],
    objections: Array.isArray(json.objections) ? json.objections : [],
    ...stats,
  };
}

/** Runs all four analyses for one meeting transcript. */
async function analyzeMeeting(fullText, segments, durationMs, lead) {
  const [summary, actionItems, sentimentTimeline, intelligence] = await Promise.all([
    summariseMeeting(fullText, lead),
    extractActionItems(fullText),
    analyzeSentimentTimeline(fullText, durationMs),
    computeConversationIntelligence(fullText, segments),
  ]);
  return { summary, actionItems, sentimentTimeline, intelligence };
}

module.exports = {
  summariseMeeting,
  extractActionItems,
  analyzeSentimentTimeline,
  computeConversationIntelligence,
  analyzeMeeting,
};

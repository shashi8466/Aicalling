/**
 * Lead Scoring Engine — 0 to 100
 *   70+  → Hot
 *   40–69 → Warm
 *   <40   → Cold
 */

function scoreLead(lead) {
  const q    = lead.qualification || {};
  const grade = (lead.grade || q.studentGrade || '').toString().toLowerCase();
  const program = (lead.courseInterest || q.interestedProgram || '').toLowerCase();

  // 1. Grade (0–20)
  const gradeMap = { '9':8,'9th':8,'freshman':8,'10':12,'10th':12,'sophomore':12,'11':20,'11th':20,'junior':20,'12':16,'12th':16,'senior':16 };
  const gradeScore = gradeMap[grade] || 6;

  // 2. Program interest (0–18)
  const progMap = [
    [['college counseling','admissions counseling'], 18],
    [['sat','act','digital sat'], 15],
    [['ap calculus','ap physics','ap chemistry'], 12],
    [['ap biology','ap computer','ap statistics','ap english'], 10],
    [['tutoring','test prep','ap '], 8],
  ];
  let programScore = 6;
  for (const [kws, s] of progMap) {
    if (kws.some(k => program.includes(k))) { programScore = s; break; }
  }

  // 3. Score gap (0–20)
  let scoreGap = 0;
  const cur = parseInt(q.currentScore);
  const tgt = parseInt(q.targetScore);
  if (cur && tgt && tgt > cur) {
    const gap = tgt - cur;
    if (cur > 36) {  // SAT
      scoreGap = gap >= 300 ? 20 : gap >= 200 ? 16 : gap >= 100 ? 12 : 6;
    } else {         // ACT
      scoreGap = gap >= 8 ? 20 : gap >= 5 ? 16 : gap >= 3 ? 12 : 6;
    }
  }

  // 4. Urgency – exam date (0–20)
  let urgency = 6;
  if (q.targetExamDate) {
    const months = (new Date(q.targetExamDate) - new Date()) / (1000 * 60 * 60 * 24 * 30);
    urgency = months <= 2 ? 20 : months <= 4 ? 16 : months <= 6 ? 12 : months <= 12 ? 8 : 4;
  } else {
    // Fall back to grade
    urgency = ['11','11th','junior','12','12th','senior'].includes(grade) ? 12 : 6;
  }

  // 5. Parent engagement (0–12)
  let parentScore = 4;
  if (q.parentInvolvement === 'high')        parentScore = 12;
  else if (q.parentInvolvement === 'medium') parentScore = 8;
  else if (q.parentInvolvement === 'low')    parentScore = 4;
  else if (lead.parentEmail || lead.parentName) parentScore = 8;

  // 6. Sentiment from last call (0–10)
  let sentimentScore = 0;
  const lastCall = lead.callAttempts?.[lead.callAttempts.length - 1];
  if (lastCall?.sentiment === 'positive')    sentimentScore = 10;
  else if (lastCall?.sentiment === 'neutral') sentimentScore = 5;
  else if (lastCall?.sentiment === 'negative') sentimentScore = 1;

  const total    = Math.min(100, gradeScore + programScore + scoreGap + urgency + parentScore + sentimentScore);
  const category = total >= 70 ? 'hot' : total >= 40 ? 'warm' : 'cold';

  return {
    score: total, category,
    breakdown: { gradeScore, programScore, scoreGap, urgency, parentScore, sentimentScore },
  };
}

function detectSentiment(transcript = '') {
  const t = transcript.toLowerCase();
  const pos = ['yes','great','interested','sounds good','definitely','absolutely','perfect','wonderful','love to','excited','book','schedule','sign up','enroll'];
  const neg = ['not interested','no thank you','stop calling','remove me','too expensive','busy','not now','maybe later','hang up'];

  let p = 0, n = 0;
  pos.forEach(w => { if (t.includes(w)) p++; });
  neg.forEach(w => { if (t.includes(w)) n++; });

  if (n > p)         return 'negative';
  if (p > n + 1)     return 'positive';
  return 'neutral';
}

module.exports = { scoreLead, detectSentiment };

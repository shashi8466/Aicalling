/**
 * Compact, keyword-indexed knowledge base for Test Prep Pundits.
 * getKnowledge(query) returns the 1-3 most relevant snippets.
 */

const KB = [
  // ── SAT ──────────────────────────────────────────────────────────────
  {
    keys: ['sat','digital sat','reading writing','math section','adaptive','1600'],
    text: `DIGITAL SAT (2024 format)
Structure: 2h 14m total | Reading & Writing (2 modules, 27 Qs each) + Math (2 modules, 22 Qs each)
Scoring: 400–1600 | Adaptive: module 2 difficulty adjusts based on module 1
Benchmarks: Avg ~1050 | Top 25% = 1200+ | Top 10% = 1350+ | Top 1% = 1550+
No wrong-answer penalty. Calculator allowed for all Math questions.`,
  },
  {
    keys: ['sat program','sat tutoring','sat class','sat price','sat cost','sat prep'],
    text: `SAT PROGRAMS – Test Prep Pundits
• One-on-One Private Tutoring – from $150/hr (avg +150–200 pts)
• Group Classes (8 wks, 6–10 students) – $599
• SAT Boot Camp (4-wk intensive) – $799
• Practice Test Package (6 full tests + analysis) – $199
• Self-Paced Online Course (200+ videos) – $299 lifetime
Payment plans available. Average improvement: 150–200 points.`,
  },

  // ── ACT ──────────────────────────────────────────────────────────────
  {
    keys: ['act','science section','composite','english section','act score'],
    text: `ACT OVERVIEW
4 sections: English (75 Qs, 45 min) | Math (60 Qs, 60 min) | Reading (40 Qs, 35 min) | Science (40 Qs, 35 min)
Optional Writing (40 min). Composite: average of 4 sections (1–36).
Avg ~21 | Competitive = 27+ | Strong = 30+ | Excellent = 34+
Key differences vs SAT: ACT has Science; SAT Math goes deeper; ACT is faster-paced.`,
  },
  {
    keys: ['act program','act tutoring','act class','act price','act cost','act prep'],
    text: `ACT PROGRAMS – Test Prep Pundits
• One-on-One Tutoring – from $150/hr
• Group ACT Prep (8 wks) – $599
• ACT Boot Camp (4-wk intensive) – $799
• Science Section Mastery (4 sessions) – $349
• Practice Test Pack (6 tests) – $199
Average improvement: 4–6 composite points.`,
  },

  // ── SAT vs ACT ───────────────────────────────────────────────────────
  {
    keys: ['sat vs act','which test','sat or act','difference between'],
    text: `SAT vs ACT – Which to take?
Both accepted equally by all US colleges. Choose SAT if: stronger in reading/evidence-based skills; prefer fewer questions with more time; shorter test (2h14 vs 2h55).
Choose ACT if: strong in science reasoning; comfortable with faster pace; want optional Writing.
Best approach: take a free diagnostic of both — most students score better on one. We offer free diagnostics.`,
  },

  // ── AP Courses ───────────────────────────────────────────────────────
  {
    keys: ['ap calc','calculus','ap calculus'],
    text: `AP CALCULUS
AB (Grade 11–12, $899 / 12 wks): Limits, derivatives, integrals, FTC.
BC (Grade 11–12, $1,099 / 16 wks): All AB + series, parametric, polar.
Exam: 3h 15m | Score 3+ = college credit at most schools.`,
  },
  {
    keys: ['ap physics','physics'],
    text: `AP PHYSICS
Physics 1 Algebra-Based (Grade 10–12, $849 / 12 wks): Kinematics, forces, energy, waves.
Physics C Mechanics & E&M (Grade 11–12, $1,099 / 16 wks): Requires Calculus.`,
  },
  {
    keys: ['ap chemistry','chemistry','chem'],
    text: `AP CHEMISTRY (Grade 10–12, $999 / 14 wks)
Topics: atomic structure, bonding, thermo, kinetics, equilibrium, electrochemistry.
Exam: 3h 15m. Lab-focused problem solving approach.`,
  },
  {
    keys: ['ap biology','biology','bio'],
    text: `AP BIOLOGY (Grade 10–12, $849 / 12 wks)
Topics: evolution, cellular processes, genetics, ecology. Exam: 3h.`,
  },
  {
    keys: ['ap cs','computer science','ap computer'],
    text: `AP COMPUTER SCIENCE A – Java (Grade 10–12, $799 / 10 wks)
Topics: OOP, arrays, inheritance, recursion, algorithms.`,
  },
  {
    keys: ['ap stats','statistics','ap statistics'],
    text: `AP STATISTICS (Grade 11–12, $749 / 10 wks)
Topics: exploring data, sampling, probability, inference.`,
  },
  {
    keys: ['ap english','english lit','english lang'],
    text: `AP ENGLISH
Language & Composition (Grade 11, $749 / 10 wks): Rhetorical analysis, argumentation, synthesis.
Literature & Composition (Grade 12, $749 / 10 wks): Literary analysis, poetry, prose, drama.`,
  },

  // ── College Counseling ───────────────────────────────────────────────
  {
    keys: ['college','admissions','essay','application','counseling','scholarship','interview'],
    text: `COLLEGE ADMISSIONS COUNSELING
• Profile Building – $499
• College Selection Strategy (15–20 school list) – $699
• Essay Package (personal statement + all supplements, unlimited revisions) – $999
• Full Application Review – $1,499
• Interview Prep (3 mock sessions + recording feedback) – $399
• Scholarship Guidance – $599
• Complete Package (all above) – $2,999
Counselors: former admissions officers + Ivy League graduates. 92% acceptance rate to at least one reach school.`,
  },

  // ── Pricing / General ────────────────────────────────────────────────
  {
    keys: ['price','cost','how much','fee','payment','afford','expensive'],
    text: `PRICING OVERVIEW
SAT/ACT private tutoring from $150/hr | Group classes $599 (8 wks) | Boot camps $799
AP courses $749–$1,099 | College counseling $399–$2,999
Payment plans: 3–6 monthly installments, 0% interest.
Discounts: 10% sibling discount | 15% early enrollment (8+ wks before start).
Refund: 100% within 7 days | 50% within 14 days | Credit after 14 days.`,
  },

  // ── Tutors ───────────────────────────────────────────────────────────
  {
    keys: ['tutor','teacher','instructor','qualified','credential','who teaches'],
    text: `OUR TUTORS
All tutors scored 99th percentile on SAT/ACT. Minimum Bachelor's degree (most hold Master's/PhD).
2+ years tutoring experience. Background-checked. Trained in our proprietary methodology.
College counselors: former admissions officers from top-25 universities, avg 8+ yrs experience.
Students work with the same tutor throughout their program for continuity.`,
  },

  // ── Scheduling ───────────────────────────────────────────────────────
  {
    keys: ['schedule','timing','availability','hours','evening','weekend','when'],
    text: `SCHEDULING OPTIONS
One-on-one: 7 days/week, 7 AM–10 PM. 60–90 min sessions. Online (Zoom/Meet) or in-person.
Group classes: Weekday evenings 6–8 PM | Saturday 9 AM–12 PM | Sunday intensives.
Makeup sessions available for missed classes. All sessions recorded for review.`,
  },

  // ── Online vs In-Person ──────────────────────────────────────────────
  {
    keys: ['online','in-person','virtual','zoom','remote','hybrid'],
    text: `ONLINE vs IN-PERSON
Online: flexible scheduling, no commute, auto-recorded, shared whiteboard, nationwide.
In-person: available in select locations, physical whiteboard, better for hands-on science.
Results are equivalent. We recommend in-person for students who struggle with online focus.`,
  },

  // ── Results / Success ────────────────────────────────────────────────
  {
    keys: ['result','improvement','success','score','testimonial','story'],
    text: `STUDENT SUCCESS
SAT avg improvement: 150–200 points | ACT avg: +4–6 composite
AP: 85% of students score 4 or 5 | College Counseling: 92% admitted to a reach school
Examples: Aisha M. 1120→1480 SAT | James T. 22→31 ACT | Priya K. accepted Penn/Duke/Vanderbilt.`,
  },

  // ── Objections ───────────────────────────────────────────────────────
  {
    keys: ['expensive','can\'t afford','too much','budget','price too high'],
    text: `OBJECTION – Cost
Acknowledge and offer: (1) 3–6 month payment plans, no interest. (2) Group classes start at $599 — great value. (3) ROI: a 200-pt SAT gain often unlocks $20k–$50k in merit scholarships. (4) Free diagnostic first — no commitment needed.`,
  },
  {
    keys: ['parent','discuss','ask my','not my decision','need to talk'],
    text: `OBJECTION – Need parent approval
Offer to set up a 3-way call or a meeting that includes both the student and parent together. "I'd love to answer all questions for the whole family at once — no obligation."`,
  },
  {
    keys: ['other tutor','already have','using someone','already enrolled'],
    text: `OBJECTION – Already has a tutor
Ask: "Are you seeing the score improvements you're hoping for?" Offer a free diagnostic to benchmark current progress. Position as complementary or a second opinion, not replacement.`,
  },
  {
    keys: ['not ready','maybe later','not sure','think about it'],
    text: `OBJECTION – Not ready
Validate: "Timing is everything." Ask what would need to change. Note that earlier prep = more time for retakes = higher scores. Offer to send materials and follow up later.`,
  },
];

/**
 * Returns up to 3 relevant knowledge snippets for the given query.
 */
function getKnowledge(query = '') {
  const q = query.toLowerCase();
  const scored = KB.map(entry => {
    const hits = entry.keys.filter(k => q.includes(k)).length;
    return { hits, text: entry.text };
  }).filter(e => e.hits > 0)
    .sort((a, b) => b.hits - a.hits)
    .slice(0, 3);

  return scored.map(s => s.text);
}

module.exports = { getKnowledge, KB };

/**
 * CRM Routes — Meeting Outcomes, Objections, Enrollments, Payments, Revenue
 * All under /api/crm/*
 */
const express       = require('express');
const router        = express.Router();
const Lead          = require('../models/Lead');
const MeetingOutcome= require('../models/MeetingOutcome');
const FollowUp      = require('../models/FollowUp');
const LeadObjection = require('../models/LeadObjection');
const Enrollment    = require('../models/Enrollment');
const Payment       = require('../models/Payment');
const logger        = require('../logger');

// ═══════════════════════════════════════════════════════════════════════
//   MEETING OUTCOMES
// ═══════════════════════════════════════════════════════════════════════
router.get('/meeting-outcomes', async (req, res) => {
  try {
    const { leadId } = req.query;
    const q = leadId ? { leadId } : {};
    const outcomes = await MeetingOutcome.find(q)
      .sort({ createdAt: -1 })
      .limit(200)
      .populate('leadId', 'fullName email grade courseInterest _id');
    res.json({ outcomes, total: outcomes.length });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.post('/meeting-outcomes', async (req, res) => {
  try {
    const { leadId, meetingId, outcome, notes, counselorId } = req.body;
    if (!leadId || !outcome) return res.status(400).json({ error: 'leadId and outcome required' });

    const doc = await MeetingOutcome.create({ leadId, meetingId, outcome, notes, counselorId });

    // Auto-update lead status based on outcome
    const statusMap = {
      'ready-to-enroll':        'enrollment-pending',
      'interested':             'proposal-sent',
      'need-follow-up':         'meeting-completed',
      'parent-wants-discussion':'meeting-completed',
      'not-interested':         'lost',
    };
    const newStatus = statusMap[outcome];
    if (newStatus) {
      await Lead.findByIdAndUpdate(leadId, { status: newStatus });
    }

    // Schedule follow-ups for non-enrolled leads
    if (outcome !== 'not-interested') {
      await scheduleFollowUps(leadId);
    }

    res.status(201).json(doc);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.get('/meeting-outcomes/:id', async (req, res) => {
  try {
    const doc = await MeetingOutcome.findById(req.params.id);
    if (!doc) return res.status(404).json({ error: 'Not found' });
    res.json(doc);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ═══════════════════════════════════════════════════════════════════════
//   FOLLOW-UPS
// ═══════════════════════════════════════════════════════════════════════
router.get('/follow-ups', async (req, res) => {
  try {
    const { leadId, completed } = req.query;
    const q = {};
    if (leadId) q.leadId = leadId;
    if (completed !== undefined) q.completed = completed === 'true';
    const docs = await FollowUp.find(q).sort({ scheduledDate: 1 }).limit(500);
    res.json(docs);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.get('/follow-ups/pending', async (req, res) => {
  try {
    const now = new Date();
    const docs = await FollowUp.find({ completed: false, scheduledDate: { $lte: now } })
      .sort({ scheduledDate: 1 })
      .limit(100);
    res.json(docs);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.patch('/follow-ups/:id/complete', async (req, res) => {
  try {
    const { notes, result } = req.body;
    const doc = await FollowUp.findByIdAndUpdate(
      req.params.id,
      { completed: true, completedAt: new Date(), notes: notes || '', result: result || '' },
      { new: true }
    );
    if (!doc) return res.status(404).json({ error: 'Not found' });
    res.json(doc);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.post('/follow-ups/schedule/:leadId', async (req, res) => {
  try {
    const docs = await scheduleFollowUps(req.params.leadId);
    res.json({ ok: true, count: docs.length, followUps: docs });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ═══════════════════════════════════════════════════════════════════════
//   LEAD OBJECTIONS
// ═══════════════════════════════════════════════════════════════════════
router.get('/objections', async (req, res) => {
  try {
    const { leadId } = req.query;
    const q = leadId ? { leadId } : {};
    const docs = await LeadObjection.find(q).sort({ createdAt: -1 }).limit(200);
    res.json(docs);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.post('/objections', async (req, res) => {
  try {
    const { leadId, objectionType, notes } = req.body;
    if (!leadId || !objectionType) return res.status(400).json({ error: 'leadId and objectionType required' });
    const doc = await LeadObjection.create({ leadId, objectionType, notes });
    res.status(201).json(doc);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.patch('/objections/:id/resolve', async (req, res) => {
  try {
    const { resolvedNote } = req.body;
    const doc = await LeadObjection.findByIdAndUpdate(
      req.params.id,
      { resolved: true, resolvedAt: new Date(), resolvedNote: resolvedNote || '' },
      { new: true }
    );
    if (!doc) return res.status(404).json({ error: 'Not found' });
    res.json(doc);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.get('/objections/stats', async (req, res) => {
  try {
    const stats = await LeadObjection.aggregate([
      { $group: { _id: '$objectionType', count: { $sum: 1 }, resolved: { $sum: { $cond: ['$resolved', 1, 0] } } } },
      { $sort: { count: -1 } },
    ]);
    res.json(stats);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ═══════════════════════════════════════════════════════════════════════
//   ENROLLMENT PIPELINE
// ═══════════════════════════════════════════════════════════════════════
router.get('/enrollments', async (req, res) => {
  try {
    const { status, program } = req.query;
    const q = {};
    if (status)  q.enrollmentStatus = status;
    if (program) q.program = program;
    const docs = await Enrollment.find(q).sort({ createdAt: -1 }).limit(200);
    res.json(docs);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.get('/enrollments/:id', async (req, res) => {
  try {
    const doc = await Enrollment.findById(req.params.id);
    if (!doc) return res.status(404).json({ error: 'Not found' });
    const payments = await Payment.find({ enrollmentId: doc._id }).sort({ createdAt: -1 });
    res.json({ enrollment: doc, payments });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.post('/enrollments', async (req, res) => {
  try {
    const {
      leadId, studentName, grade, parentName, parentEmail, parentPhone,
      program, examDate, learningMode, paymentPlan, programFee, notes,
    } = req.body;
    if (!studentName || !program) return res.status(400).json({ error: 'studentName and program required' });

    const doc = await Enrollment.create({
      leadId, studentName, grade, parentName, parentEmail, parentPhone,
      program, examDate: examDate ? new Date(examDate) : undefined,
      learningMode, paymentPlan, programFee: Number(programFee) || 0, notes,
    });

    // Update lead status to enrolled
    if (leadId) {
      await Lead.findByIdAndUpdate(leadId, { status: 'enrolled' });
    }

    // Create initial payment record
    if (programFee && Number(programFee) > 0) {
      await Payment.create({
        enrollmentId: doc._id,
        leadId,
        amount: Number(programFee),
        amountPaid: 0,
        paymentStatus: 'pending',
        program,
      });
    }

    res.status(201).json(doc);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.patch('/enrollments/:id', async (req, res) => {
  try {
    const allowed = ['enrollmentStatus','grade','parentName','parentEmail','parentPhone',
                     'examDate','learningMode','paymentPlan','programFee','notes'];
    const update = {};
    allowed.forEach(k => { if (req.body[k] !== undefined) update[k] = req.body[k]; });
    const doc = await Enrollment.findByIdAndUpdate(req.params.id, update, { new: true });
    if (!doc) return res.status(404).json({ error: 'Not found' });
    res.json(doc);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ═══════════════════════════════════════════════════════════════════════
//   PAYMENTS
// ═══════════════════════════════════════════════════════════════════════
router.get('/payments', async (req, res) => {
  try {
    const { enrollmentId, status } = req.query;
    const q = {};
    if (enrollmentId) q.enrollmentId = enrollmentId;
    if (status)       q.paymentStatus = status;
    const docs = await Payment.find(q).sort({ createdAt: -1 }).limit(200);
    res.json(docs);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.post('/payments', async (req, res) => {
  try {
    const { enrollmentId, leadId, amount, amountPaid, paymentDate, paymentMethod, transactionId, notes, program } = req.body;
    if (!enrollmentId || !amount) return res.status(400).json({ error: 'enrollmentId and amount required' });

    const paid = Number(amountPaid) || 0;
    const total = Number(amount);
    let paymentStatus = 'pending';
    if (paid >= total) paymentStatus = 'paid';
    else if (paid > 0) paymentStatus = 'partial-paid';

    const doc = await Payment.create({
      enrollmentId, leadId, amount: total, amountPaid: paid,
      paymentStatus, paymentDate: paymentDate ? new Date(paymentDate) : undefined,
      paymentMethod: paymentMethod || '', transactionId: transactionId || '',
      notes: notes || '', program: program || '',
    });

    // Update enrollment status if fully paid
    if (paymentStatus === 'paid') {
      await Enrollment.findByIdAndUpdate(enrollmentId, { enrollmentStatus: 'confirmed' });
    }

    res.status(201).json(doc);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.patch('/payments/:id', async (req, res) => {
  try {
    const doc = await Payment.findById(req.params.id);
    if (!doc) return res.status(404).json({ error: 'Not found' });

    const allowed = ['amountPaid','paymentStatus','paymentDate','paymentMethod','transactionId','notes'];
    allowed.forEach(k => { if (req.body[k] !== undefined) doc[k] = req.body[k]; });

    // Auto-update status
    if (doc.amountPaid >= doc.amount) doc.paymentStatus = 'paid';
    else if (doc.amountPaid > 0)      doc.paymentStatus = 'partial-paid';
    else                              doc.paymentStatus = 'pending';

    await doc.save();
    res.json(doc);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ═══════════════════════════════════════════════════════════════════════
//   REVENUE DASHBOARD
// ═══════════════════════════════════════════════════════════════════════
router.get('/revenue', async (req, res) => {
  try {
    const { range = '30' } = req.query;
    const days = parseInt(range) || 30;
    const since = new Date(Date.now() - days * 86400000);

    // Pipeline counts
    const [totalLeads, qualifiedLeads, meetingsScheduled, meetingsCompleted, enrolled] = await Promise.all([
      Lead.countDocuments({}),
      Lead.countDocuments({ isQualified: true }),
      Lead.countDocuments({ status: { $in: ['meeting-scheduled','meeting-completed','proposal-sent','interested','enrollment-pending','payment-pending','enrolled'] } }),
      Lead.countDocuments({ status: { $in: ['meeting-completed','proposal-sent','interested','enrollment-pending','payment-pending','enrolled'] } }),
      Lead.countDocuments({ status: 'enrolled' }),
    ]);

    // Revenue by program
    const revByProgram = await Payment.aggregate([
      { $match: { paymentStatus: { $in: ['paid', 'partial-paid'] } } },
      { $group: { _id: '$program', revenue: { $sum: '$amountPaid' }, count: { $sum: 1 } } },
      { $sort: { revenue: -1 } },
    ]);

    // Total revenue
    const revTotalAgg = await Payment.aggregate([
      { $match: { paymentStatus: { $in: ['paid', 'partial-paid'] } } },
      { $group: { _id: null, total: { $sum: '$amountPaid' }, pending: { $sum: { $subtract: ['$amount', '$amountPaid'] } } } },
    ]);
    const totalRevenue  = revTotalAgg[0]?.total   || 0;
    const pendingRevenue= revTotalAgg[0]?.pending  || 0;

    // Revenue trend (daily, last N days)
    const revTrend = await Payment.aggregate([
      { $match: { paymentDate: { $gte: since }, paymentStatus: { $in: ['paid','partial-paid'] } } },
      { $group: {
        _id: { $dateToString: { format: '%Y-%m-%d', date: '$paymentDate' } },
        revenue: { $sum: '$amountPaid' },
      }},
      { $sort: { _id: 1 } },
    ]);

    // Monthly enrollments
    const monthlyEnrollments = await Enrollment.aggregate([
      { $match: { createdAt: { $gte: since } } },
      { $group: {
        _id: { $dateToString: { format: '%Y-%m', date: '$createdAt' } },
        count: { $sum: 1 },
      }},
      { $sort: { _id: 1 } },
    ]);

    // Conversion metrics
    const leadToMeeting   = totalLeads ? ((meetingsScheduled / totalLeads) * 100).toFixed(1) : '0.0';
    const meetingToEnroll = meetingsCompleted ? ((enrolled / meetingsCompleted) * 100).toFixed(1) : '0.0';
    const overallConversion = totalLeads ? ((enrolled / totalLeads) * 100).toFixed(1) : '0.0';

    // Enrollments by program
    const enrollByProgram = await Enrollment.aggregate([
      { $group: { _id: '$program', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
    ]);

    // Counselor pipeline stats
    const pipeline = {
      new:              await Lead.countDocuments({ status: 'new' }),
      contacted:        await Lead.countDocuments({ status: 'contacted' }),
      qualified:        await Lead.countDocuments({ status: 'qualified' }),
      meetingScheduled: meetingsScheduled,
      meetingCompleted: meetingsCompleted,
      proposalSent:     await Lead.countDocuments({ status: 'proposal-sent' }),
      interested:       await Lead.countDocuments({ status: 'interested' }),
      enrollmentPending:await Lead.countDocuments({ status: 'enrollment-pending' }),
      paymentPending:   await Lead.countDocuments({ status: 'payment-pending' }),
      enrolled,
      lost:             await Lead.countDocuments({ status: 'lost' }),
    };

    res.json({
      pipeline,
      totalRevenue, pendingRevenue,
      revByProgram, revTrend,
      monthlyEnrollments, enrollByProgram,
      metrics: { totalLeads, qualifiedLeads, meetingsScheduled, meetingsCompleted, enrolled },
      conversion: { leadToMeeting, meetingToEnroll, overallConversion },
    });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ═══════════════════════════════════════════════════════════════════════
//   COUNSELOR DASHBOARD WIDGETS
// ═══════════════════════════════════════════════════════════════════════
router.get('/counselor-dashboard', async (req, res) => {
  try {
    const { range = 'today' } = req.query;
    let since;
    const now = new Date();
    if (range === 'today') {
      since = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    } else if (range === 'week') {
      since = new Date(now.getTime() - 7 * 86400000);
    } else {
      since = new Date(now.getFullYear(), now.getMonth(), 1); // start of month
    }

    // Meetings today/this period
    const meetingsInRange = await Lead.countDocuments({
      'meeting.scheduledAt': { $gte: since, $lte: new Date(since.getTime() + (range === 'today' ? 86400000 : range === 'week' ? 7*86400000 : 31*86400000)) },
    });

    // Hot leads
    const hotLeads = await Lead.find({ leadCategory: 'hot', status: { $nin: ['enrolled','lost','do-not-call'] } })
      .sort({ leadScore: -1 }).limit(10)
      .select('fullName phone email grade courseInterest leadScore status meeting');

    // Enrollment pending
    const enrollmentPending = await Lead.find({ status: { $in: ['enrollment-pending','payment-pending','proposal-sent'] } })
      .sort({ updatedAt: -1 }).limit(10)
      .select('fullName phone email courseInterest leadScore status');

    // Recent follow-ups due
    const pendingFollowUps = await FollowUp.find({
      completed: false,
      scheduledDate: { $lte: new Date(Date.now() + 24 * 3600000) }, // due within 24h
    }).sort({ scheduledDate: 1 }).limit(10);

    // Revenue pipeline (total pending payments)
    const revPipeline = await Payment.aggregate([
      { $match: { paymentStatus: { $in: ['pending', 'partial-paid'] } } },
      { $group: { _id: null, total: { $sum: { $subtract: ['$amount', '$amountPaid'] } } } },
    ]);

    // Today's meetings
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const todayEnd   = new Date(todayStart.getTime() + 86400000);
    const todayMeetings = await Lead.find({
      'meeting.scheduledAt': { $gte: todayStart, $lt: todayEnd },
    }).select('fullName phone email meeting courseInterest grade').sort({ 'meeting.scheduledAt': 1 });

    res.json({
      meetingsInRange,
      hotLeads,
      enrollmentPending,
      pendingFollowUps,
      revenuePipeline: revPipeline[0]?.total || 0,
      todayMeetings,
    });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ═══════════════════════════════════════════════════════════════════════
//   PIPELINE BOARD (Kanban-style counts)
// ═══════════════════════════════════════════════════════════════════════
router.get('/pipeline', async (req, res) => {
  try {
    const allStatuses = [
      'new','contacted','qualified','meeting-scheduled','meeting-completed',
      'proposal-sent','interested','enrollment-pending','payment-pending','enrolled','lost',
    ];
    const counts = await Promise.all(allStatuses.map(s => Lead.countDocuments({ status: s })));
    const leads  = await Lead.find({ status: { $in: allStatuses } })
      .sort({ leadScore: -1, updatedAt: -1 })
      .limit(500)
      .select('fullName grade email phone courseInterest leadScore leadCategory status meeting createdAt updatedAt');

    const pipeline = {};
    allStatuses.forEach((s, i) => {
      pipeline[s] = {
        count: counts[i],
        leads: leads.filter(l => l.status === s),
      };
    });

    res.json(pipeline);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ═══════════════════════════════════════════════════════════════════════
//   HELPER: schedule follow-up sequence for a lead
// ═══════════════════════════════════════════════════════════════════════
async function scheduleFollowUps(leadId) {
  const now = new Date();
  const days = d => new Date(now.getTime() + d * 86400000);

  // Full Week 1–4 plan + ongoing monthly cadence
  // No WhatsApp — removed from automation
  // One Success Stories email per week guaranteed
  const plan = [
    // ── Week 1 ──────────────────────────────────────────────────────────
    { type: 'email-day1',              at: days(1)  },
    { type: 'ai-call-day2',            at: days(2)  },
    { type: 'success-stories-day3',    at: days(3)  },  // Week 1 success story
    { type: 'ai-call-day4',            at: days(4)  },
    { type: 'email-day5',              at: days(5)  },
    { type: 'ai-call-day6',            at: days(6)  },
    { type: 'counselor-reminder-day7', at: days(7)  },
    // ── Week 2 ──────────────────────────────────────────────────────────
    { type: 'email-day8',              at: days(8)  },
    { type: 'success-stories-day9',    at: days(9)  },  // Week 2 success story
    { type: 'ai-call-day10',           at: days(10) },
    { type: 'email-day12',             at: days(12) },
    { type: 'counselor-reminder-day14',at: days(14) },
    // ── Week 3 ──────────────────────────────────────────────────────────
    { type: 'ai-call-week3',           at: days(17) },
    { type: 'success-stories-week3',   at: days(18) },  // Week 3 success story
    { type: 'parent-discussion-week3', at: days(19) },
    { type: 'enrollment-reminder-week3',at: days(21) },
    // ── Week 4 ──────────────────────────────────────────────────────────
    { type: 'ai-call-week4',           at: days(24) },
    { type: 'success-stories-week4',   at: days(25) },  // Week 4 success story
    { type: 'program-benefits-week4',  at: days(26) },
    { type: 'limited-seat-week4',      at: days(27) },
    { type: 'counselor-reminder-week4',at: days(28) },
    // ── Ongoing cadence starts at Day 30 — success stories every 7 days ─
    { type: 'nurture-ai-call',            at: days(30), cycle: 1 },
    { type: 'nurture-email',              at: days(33), cycle: 1 },
    { type: 'nurture-success-stories',    at: days(37), cycle: 1 },  // every 7d
    { type: 'nurture-counselor-reminder', at: days(44), cycle: 1 },
    { type: 'nurture-lead-review',        at: days(60), cycle: 1 },
  ];

  const docs = [];
  for (const p of plan) {
    const existing = await FollowUp.findOne({ leadId, followupType: p.type, completed: false });
    if (!existing) {
      const doc = await FollowUp.create({
        leadId,
        followupType: p.type,
        scheduledDate: p.at,
        cycle: p.cycle || 0,
      });
      docs.push(doc);
    }
  }
  return docs;
}

module.exports = router;

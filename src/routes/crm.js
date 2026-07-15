/**
 * CRM Routes — Meeting Outcomes, Objections, Enrollments, Payments, Revenue
 * All under /api/crm/*
 */
const express        = require('express');
const router         = express.Router();
const supabase       = require('../db/supabase');
const Lead           = require('../models/Lead');
const MeetingOutcome = require('../models/MeetingOutcome');
const FollowUp       = require('../models/FollowUp');
const LeadObjection  = require('../models/LeadObjection');
const Enrollment     = require('../models/Enrollment');
const Payment        = require('../models/Payment');
const logger         = require('../logger');

// ═══════════════════════════════════════════════════════════════════════
//   MEETING OUTCOMES
// ═══════════════════════════════════════════════════════════════════════
router.get('/meeting-outcomes', async (req, res) => {
  try {
    const { leadId } = req.query;
    const filter = leadId ? { leadId } : {};
    const outcomes = await MeetingOutcome.find(filter, { limit: 200 });

    // Manual join: enrich each outcome with lead fields
    const leadIds = [...new Set(outcomes.map(o => o.leadId).filter(Boolean))];
    const leadMap = {};
    if (leadIds.length) {
      const { data: lRows } = await supabase
        .from('leads')
        .select('id, full_name, email, grade, course_interest')
        .in('id', leadIds);
      (lRows || []).forEach(r => {
        leadMap[r.id] = { _id: r.id, id: r.id, fullName: r.full_name, email: r.email,
                          grade: r.grade, courseInterest: r.course_interest };
      });
    }
    const enriched = outcomes.map(o => ({ ...o, leadId: leadMap[o.leadId] || o.leadId }));
    res.json({ outcomes: enriched, total: enriched.length });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.post('/meeting-outcomes', async (req, res) => {
  try {
    const { leadId, meetingId, outcome, notes, counselorId } = req.body;
    if (!leadId || !outcome) return res.status(400).json({ error: 'leadId and outcome required' });

    const doc = await MeetingOutcome.create({ leadId, meetingId, outcome, notes, counselorId });

    const statusMap = {
      'ready-to-enroll':        'enrollment-pending',
      'interested':             'proposal-sent',
      'need-follow-up':         'meeting-completed',
      'parent-wants-discussion':'meeting-completed',
      'not-interested':         'lost',
    };
    const newStatus = statusMap[outcome];
    if (newStatus) await Lead.findByIdAndUpdate(leadId, { status: newStatus });
    if (outcome !== 'not-interested') await scheduleFollowUps(leadId);

    // Automatically resolve pending counselor reminders or meeting-related follow-ups
    const pendingFUs = await FollowUp.find({ leadId, completed: false });
    for (const fu of pendingFUs) {
      if (fu.followupType.includes('counselor') || fu.followupType.includes('meeting') || fu.followupType.includes('parent')) {
        await FollowUp.findByIdAndUpdate(fu._id, { completed: true, completedAt: new Date(), result: 'completed-from-meeting' });
      }
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

router.patch('/meeting-outcomes/:id', async (req, res) => {
  try {
    const { outcome, notes } = req.body;
    const doc = await MeetingOutcome.findById(req.params.id);
    if (!doc) return res.status(404).json({ ok: false, error: 'Outcome not found' });

    const outcomeChanged = outcome && outcome !== doc.outcome;
    if (outcome !== undefined) doc.outcome = outcome;
    if (notes   !== undefined) doc.notes   = notes;
    await doc.save();

    if (outcomeChanged) {
      const statusMap = {
        'ready-to-enroll':        'enrollment-pending',
        'interested':             'proposal-sent',
        'need-follow-up':         'meeting-completed',
        'parent-wants-discussion':'meeting-completed',
        'not-interested':         'lost',
      };
      const newStatus = statusMap[doc.outcome];
      if (newStatus) await Lead.findByIdAndUpdate(doc.leadId, { status: newStatus });
      if (doc.outcome !== 'not-interested') await scheduleFollowUps(doc.leadId);
    }

    res.json({ ok: true, outcome: doc });
  } catch(e) { res.status(500).json({ ok: false, error: e.message }); }
});

router.delete('/meeting-outcomes/:id', async (req, res) => {
  try {
    const doc = await MeetingOutcome.findByIdAndDelete(req.params.id);
    if (!doc) return res.status(404).json({ ok: false, error: 'Outcome not found' });
    res.json({ ok: true, message: 'Meeting outcome deleted' });
  } catch(e) { res.status(500).json({ ok: false, error: e.message }); }
});

// ═══════════════════════════════════════════════════════════════════════
//   FOLLOW-UPS
// ═══════════════════════════════════════════════════════════════════════
router.get('/follow-ups', async (req, res) => {
  try {
    const { leadId, completed } = req.query;
    const filter = {};
    if (leadId)            filter.leadId    = leadId;
    if (completed !== undefined) filter.completed = completed === 'true';
    const docs = await FollowUp.find(filter, { sort: { scheduledDate: 1 }, limit: 500 });
    res.json(docs);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.get('/follow-ups/pending', async (req, res) => {
  try {
    const docs = await FollowUp.find(
      { completed: false, scheduledDate: { $lte: new Date() } },
      { sort: { scheduledDate: 1 }, limit: 100 }
    );
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

router.post('/follow-ups/:id/retry', async (req, res) => {
  try {
    const doc = await FollowUp.findByIdAndUpdate(
      req.params.id,
      { result: null },
      { new: true }
    );
    if (!doc) return res.status(404).json({ error: 'Not found' });
    res.json({ ok: true, doc });
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
    const filter = leadId ? { leadId } : {};
    const docs = await LeadObjection.find(filter, { limit: 200 });
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

// JS aggregation replacing MongoDB $group pipeline
router.get('/objections/stats', async (req, res) => {
  try {
    const allObjs = await LeadObjection.find({}, { limit: 2000 });
    const statsMap = {};
    allObjs.forEach(o => {
      const k = o.objectionType || 'unknown';
      if (!statsMap[k]) statsMap[k] = { _id: k, count: 0, resolved: 0 };
      statsMap[k].count++;
      if (o.resolved) statsMap[k].resolved++;
    });
    const stats = Object.values(statsMap).sort((a, b) => b.count - a.count);
    res.json(stats);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ═══════════════════════════════════════════════════════════════════════
//   ENROLLMENT PIPELINE
// ═══════════════════════════════════════════════════════════════════════
router.get('/enrollments', async (req, res) => {
  try {
    const { status, program } = req.query;
    const filter = {};
    if (status)  filter.enrollmentStatus = status;
    if (program) filter.program          = program;
    const docs = await Enrollment.find(filter, { sort: { createdAt: -1 }, limit: 200 });
    res.json(docs);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.get('/enrollments/:id', async (req, res) => {
  try {
    const doc = await Enrollment.findById(req.params.id);
    if (!doc) return res.status(404).json({ error: 'Not found' });
    const payments = await Payment.find({ enrollmentId: doc._id }, { sort: { createdAt: -1 } });
    res.json({ enrollment: doc, payments });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.post('/enrollments', async (req, res) => {
  try {
    const { leadId, studentName, grade, parentName, parentEmail, parentPhone,
            program, examDate, learningMode, paymentPlan, programFee, notes } = req.body;
    if (!studentName || !program) return res.status(400).json({ error: 'studentName and program required' });

    const doc = await Enrollment.create({
      leadId, studentName, grade, parentName, parentEmail, parentPhone,
      program, examDate: examDate ? new Date(examDate) : undefined,
      learningMode, paymentPlan, programFee: Number(programFee) || 0, notes,
    });

    if (leadId) await Lead.findByIdAndUpdate(leadId, { status: 'enrolled' });

    if (programFee && Number(programFee) > 0) {
      await Payment.create({
        enrollmentId: doc._id, leadId,
        amount: Number(programFee), amountPaid: 0,
        paymentStatus: 'pending', program,
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
    const filter = {};
    if (enrollmentId) filter.enrollmentId  = enrollmentId;
    if (status)       filter.paymentStatus = status;
    const docs = await Payment.find(filter, { sort: { createdAt: -1 }, limit: 200 });
    res.json(docs);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.post('/payments', async (req, res) => {
  try {
    const { enrollmentId, leadId, amount, amountPaid, paymentDate,
            paymentMethod, transactionId, notes, program } = req.body;
    if (!enrollmentId || !amount) return res.status(400).json({ error: 'enrollmentId and amount required' });

    const paid  = Number(amountPaid) || 0;
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

    if      (doc.amountPaid >= doc.amount) doc.paymentStatus = 'paid';
    else if (doc.amountPaid > 0)           doc.paymentStatus = 'partial-paid';
    else                                   doc.paymentStatus = 'pending';

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
    const days  = parseInt(range) || 30;
    const since = new Date(Date.now() - days * 86400000);

    // Lead funnel counts
    const [totalLeads, qualifiedLeads, meetingsScheduled, meetingsCompleted, enrolled] = await Promise.all([
      Lead.countDocuments({}),
      Lead.countDocuments({ isQualified: true }),
      Lead.countDocuments({ status: { $in: ['meeting-scheduled','meeting-completed','proposal-sent','interested','enrollment-pending','payment-pending','enrolled'] } }),
      Lead.countDocuments({ status: { $in: ['meeting-completed','proposal-sent','interested','enrollment-pending','payment-pending','enrolled'] } }),
      Lead.countDocuments({ status: 'enrolled' }),
    ]);

    // All payment rows for JS aggregation
    const { data: allPmts } = await supabase
      .from('payments')
      .select('amount, amount_paid, payment_status, program, payment_date');
    const pmts = allPmts || [];
    const paidPmts = pmts.filter(p => ['paid','partial-paid'].includes(p.payment_status));

    const totalRevenue   = paidPmts.reduce((s, p) => s + (p.amount_paid || 0), 0);
    const pendingRevenue = pmts.reduce((s, p) => s + Math.max(0, (p.amount || 0) - (p.amount_paid || 0)), 0);

    // revByProgram
    const progMap = {};
    paidPmts.forEach(p => {
      const k = p.program || 'unknown';
      if (!progMap[k]) progMap[k] = { _id: k, revenue: 0, count: 0 };
      progMap[k].revenue += p.amount_paid || 0;
      progMap[k].count++;
    });
    const revByProgram = Object.values(progMap).sort((a, b) => b.revenue - a.revenue);

    // revTrend (daily, last N days)
    const trendMap = {};
    paidPmts
      .filter(p => p.payment_date && new Date(p.payment_date) >= since)
      .forEach(p => {
        const day = String(p.payment_date).slice(0, 10);
        trendMap[day] = (trendMap[day] || 0) + (p.amount_paid || 0);
      });
    const revTrend = Object.entries(trendMap)
      .map(([_id, revenue]) => ({ _id, revenue }))
      .sort((a, b) => a._id.localeCompare(b._id));

    // Monthly enrollments and by-program
    const { data: allEnrolls } = await supabase
      .from('enrollments')
      .select('program, created_at');
    const enrollRows = allEnrolls || [];

    const enrollProgMap = {};
    enrollRows.forEach(e => {
      const k = e.program || 'unknown';
      if (!enrollProgMap[k]) enrollProgMap[k] = { _id: k, count: 0 };
      enrollProgMap[k].count++;
    });
    const enrollByProgram = Object.values(enrollProgMap).sort((a, b) => b.count - a.count);

    const monthMap = {};
    enrollRows
      .filter(e => new Date(e.created_at) >= since)
      .forEach(e => {
        const month = String(e.created_at).slice(0, 7);
        monthMap[month] = (monthMap[month] || 0) + 1;
      });
    const monthlyEnrollments = Object.entries(monthMap)
      .map(([_id, count]) => ({ _id, count }))
      .sort((a, b) => a._id.localeCompare(b._id));

    // Conversion metrics
    const leadToMeeting    = totalLeads ? ((meetingsScheduled / totalLeads) * 100).toFixed(1) : '0.0';
    const meetingToEnroll  = meetingsCompleted ? ((enrolled / meetingsCompleted) * 100).toFixed(1) : '0.0';
    const overallConversion= totalLeads ? ((enrolled / totalLeads) * 100).toFixed(1) : '0.0';

    // Pipeline counts (sequential is fine here — all in parallel below)
    const pipelineStatuses = ['new','contacted','qualified','meeting-scheduled','meeting-completed',
      'proposal-sent','interested','enrollment-pending','payment-pending','enrolled','lost'];
    const pipelineCounts = await Promise.all(pipelineStatuses.map(s => Lead.countDocuments({ status: s })));
    const pipeline = {};
    pipelineStatuses.forEach((s, i) => { pipeline[s] = pipelineCounts[i]; });

    res.json({
      pipeline: {
        new:               pipeline['new'],
        contacted:         pipeline['contacted'],
        qualified:         pipeline['qualified'],
        meetingScheduled:  meetingsScheduled,
        meetingCompleted:  meetingsCompleted,
        proposalSent:      pipeline['proposal-sent'],
        interested:        pipeline['interested'],
        enrollmentPending: pipeline['enrollment-pending'],
        paymentPending:    pipeline['payment-pending'],
        enrolled,
        lost:              pipeline['lost'],
      },
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
    const now = new Date();
    let since;
    if (range === 'today') {
      since = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    } else if (range === 'week') {
      since = new Date(now.getTime() - 7 * 86400000);
    } else {
      since = new Date(now.getFullYear(), now.getMonth(), 1);
    }

    const rangeMs = range === 'today' ? 86400000 : range === 'week' ? 7 * 86400000 : 31 * 86400000;
    const rangeEnd = new Date(since.getTime() + rangeMs);

    // Fetch meeting column only for JSONB path counts
    const { data: meetingLeads } = await supabase
      .from('leads')
      .select('id, full_name, phone, email, meeting, course_interest, grade')
      .not('meeting', 'is', null);
    const meetingRows = (meetingLeads || []).filter(r => r.meeting?.scheduledAt);

    const meetingsInRange = meetingRows.filter(r => {
      const at = new Date(r.meeting.scheduledAt);
      return at >= since && at < rangeEnd;
    }).length;

    // Hot leads
    const hotLeads = await Lead.find(
      { leadCategory: 'hot', status: { $nin: ['enrolled','lost','do-not-call'] } },
      { sort: { leadScore: -1 }, limit: 10 }
    );

    // Enrollment pending
    const enrollmentPending = await Lead.find(
      { status: { $in: ['enrollment-pending','payment-pending','proposal-sent'] } },
      { sort: { updatedAt: -1 }, limit: 10 }
    );

    // Pending follow-ups due within 24 h
    const pendingFollowUps = await FollowUp.find(
      { completed: false, scheduledDate: { $lte: new Date(Date.now() + 24 * 3600000) } },
      { sort: { scheduledDate: 1 }, limit: 10 }
    );

    // Revenue pipeline (pending payments) — JS aggregation
    const { data: pendingPmts } = await supabase
      .from('payments')
      .select('amount, amount_paid, payment_status')
      .in('payment_status', ['pending', 'partial-paid']);
    const revenuePipeline = (pendingPmts || [])
      .reduce((s, p) => s + Math.max(0, (p.amount || 0) - (p.amount_paid || 0)), 0);

    // Today's meetings (with full lead data)
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const todayEnd   = new Date(todayStart.getTime() + 86400000);
    const todayMeetings = meetingRows
      .filter(r => {
        const at = new Date(r.meeting.scheduledAt);
        return at >= todayStart && at < todayEnd;
      })
      .sort((a, b) => new Date(a.meeting.scheduledAt) - new Date(b.meeting.scheduledAt))
      .map(r => ({
        _id: r.id, id: r.id,
        fullName: r.full_name, phone: r.phone, email: r.email,
        meeting: r.meeting, courseInterest: r.course_interest, grade: r.grade,
      }));

    // Recently completed follow-ups for Activity Feed
    const completedFollowUps = await FollowUp.find(
      { completed: true, completedAt: { $gte: since } },
      { sort: { completedAt: -1 }, limit: 20 }
    );

    res.json({ meetingsInRange, hotLeads, enrollmentPending, pendingFollowUps, completedFollowUps, revenuePipeline, todayMeetings });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ═══════════════════════════════════════════════════════════════════════
//   PIPELINE BOARD (Kanban-style counts + lead cards)
// ═══════════════════════════════════════════════════════════════════════
router.get('/pipeline', async (req, res) => {
  try {
    const allStatuses = [
      'new','contacted','qualified','meeting-scheduled','meeting-completed',
      'proposal-sent','interested','enrollment-pending','payment-pending','enrolled','lost',
    ];

    const [counts, leads] = await Promise.all([
      Promise.all(allStatuses.map(s => Lead.countDocuments({ status: s }))),
      Lead.find(
        { status: { $in: allStatuses } },
        { sort: { leadScore: -1, updatedAt: -1 }, limit: 500 }
      ),
    ]);

    const pipeline = {};
    allStatuses.forEach((s, i) => {
      pipeline[s] = { count: counts[i], leads: leads.filter(l => l.status === s) };
    });

    res.json(pipeline);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ═══════════════════════════════════════════════════════════════════════
//   HELPER: schedule follow-up sequence for a lead
// ═══════════════════════════════════════════════════════════════════════
async function scheduleFollowUps(leadId) {
  const now  = new Date();
  const days = d => new Date(now.getTime() + d * 86400000);

  const plan = [
    { type: 'email-day1',               at: days(1)  },
    { type: 'ai-call-day2',             at: days(2)  },
    { type: 'success-stories-day3',     at: days(3)  },
    { type: 'ai-call-day4',             at: days(4)  },
    { type: 'email-day5',               at: days(5)  },
    { type: 'ai-call-day6',             at: days(6)  },
    { type: 'counselor-reminder-day7',  at: days(7)  },
    { type: 'email-day8',               at: days(8)  },
    { type: 'success-stories-day9',     at: days(9)  },
    { type: 'ai-call-day10',            at: days(10) },
    { type: 'email-day12',              at: days(12) },
    { type: 'counselor-reminder-day14', at: days(14) },
    { type: 'ai-call-week3',            at: days(17) },
    { type: 'success-stories-week3',    at: days(18) },
    { type: 'parent-discussion-week3',  at: days(19) },
    { type: 'enrollment-reminder-week3',at: days(21) },
    { type: 'ai-call-week4',            at: days(24) },
    { type: 'success-stories-week4',    at: days(25) },
    { type: 'program-benefits-week4',   at: days(26) },
    { type: 'limited-seat-week4',       at: days(27) },
    { type: 'counselor-reminder-week4', at: days(28) },
    { type: 'nurture-ai-call',            at: days(30), cycle: 1 },
    { type: 'nurture-email',              at: days(33), cycle: 1 },
    { type: 'nurture-success-stories',    at: days(37), cycle: 1 },
    { type: 'nurture-counselor-reminder', at: days(44), cycle: 1 },
    { type: 'nurture-lead-review',        at: days(60), cycle: 1 },
  ];

  const existingFollowups = await FollowUp.find({ leadId, completed: false });
  const existingTypes = new Set(existingFollowups.map(f => f.followupType));

  const toCreate = [];
  for (const p of plan) {
    if (!existingTypes.has(p.type)) {
      toCreate.push({
        leadId,
        followupType:  p.type,
        scheduledDate: p.at,
        cycle:         p.cycle || 0,
      });
    }
  }

  if (toCreate.length > 0) {
    const docs = await FollowUp.insertMany(toCreate);
    return docs;
  }
  return [];
}

// ═══════════════════════════════════════════════════════════════════════
//   CALLBACK REQUESTS
// ═══════════════════════════════════════════════════════════════════════
router.get('/callbacks', async (req, res) => {
  try {
    const CallbackRequest = require('../models/CallbackRequest');
    const docs = await CallbackRequest.find({}, { sort: { scheduledAt: -1 }, limit: 200 });
    res.json(docs);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/callbacks/mock-receive', async (req, res) => {
  try {
    const { subject, body, fromEmail, fromName } = req.body;
    if (!body || !fromEmail) {
      return res.status(400).json({ error: 'body and fromEmail are required' });
    }
    const poller = require('../jobs/emailCallbackPoller');
    const request = await poller.processEmail(subject || 'Callback Request', body, fromEmail, fromName || 'Unknown Student');
    res.status(201).json({ ok: true, request });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════
//   REAL-TIME UPDATES (SSE)
// ═══════════════════════════════════════════════════════════════════════
let updateClients = [];

router.get('/updates/stream', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  updateClients.push(res);

  req.on('close', () => {
    updateClients = updateClients.filter(c => c !== res);
  });
});

function broadcastUpdate(type, data = {}) {
  updateClients.forEach(c => {
    try {
      c.write(`data: ${JSON.stringify({ type, ...data })}\n\n`);
    } catch (err) {
      // client connection might be broken
    }
  });
}

module.exports = router;
module.exports.broadcastUpdate = broadcastUpdate;

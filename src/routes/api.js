/**
 * Dashboard API Routes
 * All endpoints under /api/*
 */
const express   = require('express');
const router    = express.Router();
const axios     = require('axios');
const Lead      = require('../models/Lead');
const poller    = require('../jobs/poller');
const twilioSvc = require('../services/twilioService');
const sheetsSvc = require('../services/sheetsService');
const emailSvc  = require('../services/emailService');
const cfg       = require('../config');
const logger    = require('../logger');

// ═══════════════════════════════════════════════════════════════════════
//   STATS
// ═══════════════════════════════════════════════════════════════════════
router.get('/stats', async (req, res) => {
  try {
    const [
      total, newLeads, queued, calling, contacted, qualified,
      meetingsScheduled, meetingsCompleted, enrolled, lost,
      hot, warm, cold,
    ] = await Promise.all([
      Lead.countDocuments({}),
      Lead.countDocuments({ status: 'new' }),
      Lead.countDocuments({ status: 'queued' }),
      Lead.countDocuments({ status: 'calling' }),
      Lead.countDocuments({ status: 'contacted' }),
      Lead.countDocuments({ status: 'qualified' }),
      Lead.countDocuments({ status: 'meeting-scheduled' }),
      Lead.countDocuments({ status: 'meeting-completed' }),
      Lead.countDocuments({ status: 'enrolled' }),
      Lead.countDocuments({ status: 'lost' }),
      Lead.countDocuments({ leadCategory: 'hot' }),
      Lead.countDocuments({ leadCategory: 'warm' }),
      Lead.countDocuments({ leadCategory: 'cold' }),
    ]);

    // Calls completed (sum across all leads)
    const callsAgg = await Lead.aggregate([
      { $unwind: '$callAttempts' },
      { $match: { 'callAttempts.status': 'completed' } },
      { $count: 'count' },
    ]);
    const callsCompleted = callsAgg[0]?.count || 0;

    const avgScoreAgg = await Lead.aggregate([
      { $group: { _id: null, avg: { $avg: '$leadScore' } } },
    ]);
    const avgScore = Math.round(avgScoreAgg[0]?.avg || 0);

    // Conversion rate = enrolled / total
    const conversionRate = total ? ((enrolled / total) * 100).toFixed(1) : '0.0';
    // Meeting rate = meetingsScheduled / contacted
    const meetingRate = contacted ? ((meetingsScheduled / (contacted + meetingsScheduled)) * 100).toFixed(1) : '0.0';

    res.json({
      total, new: newLeads, queued, calling, contacted, qualified,
      meetingsScheduled, meetingsCompleted, enrolled, lost,
      hot, warm, cold, callsCompleted, avgScore,
      conversionRate, meetingRate,
    });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════
//   ANALYTICS — distributions & time series
// ═══════════════════════════════════════════════════════════════════════
router.get('/analytics', async (req, res) => {
  try {
    // Lead count by source
    const bySource = await Lead.aggregate([
      { $group: { _id: '$source', count: { $sum: 1 } } },
    ]);

    // Lead count by program (top 6)
    const byProgram = await Lead.aggregate([
      { $match: { courseInterest: { $exists: true, $ne: '' } } },
      { $group: { _id: '$courseInterest', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 6 },
    ]);

    // Daily new leads — last 30 days
    const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000);
    const dailyLeads = await Lead.aggregate([
      { $match: { createdAt: { $gte: thirtyDaysAgo } } },
      { $group: {
        _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
        count: { $sum: 1 },
      }},
      { $sort: { _id: 1 } },
    ]);

    // Sentiment breakdown
    const sentiment = await Lead.aggregate([
      { $unwind: '$callAttempts' },
      { $match: { 'callAttempts.sentiment': { $exists: true, $ne: null } } },
      { $group: { _id: '$callAttempts.sentiment', count: { $sum: 1 } } },
    ]);

    res.json({ bySource, byProgram, dailyLeads, sentiment });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════
//   LEADS
// ═══════════════════════════════════════════════════════════════════════
router.get('/leads', async (req, res) => {
  try {
    const { status, category, search, limit = 200 } = req.query;
    const query = {};
    if (status)   query.status = status;
    if (category) query.leadCategory = category;
    if (search) {
      query.$or = [
        { fullName: new RegExp(search, 'i') },
        { email:    new RegExp(search, 'i') },
        { phone:    new RegExp(search, 'i') },
      ];
    }
    const leads = await Lead.find(query)
      .sort({ leadScore: -1, createdAt: -1 })
      .limit(parseInt(limit))
      .select('-callAttempts.transcript');
    res.json(leads);
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/leads/export', async (req, res) => {
  try {
    const leads = await Lead.find({}).sort({ createdAt: -1 });
    const headers = ['Full Name','Grade','Email','Phone','Parent Name','Parent Email','Course','Status','Lead Score','Category','Call Attempts','Last Call','Meeting Date','Meet Link','Created'];
    const rows = leads.map(l => [
      l.fullName, l.grade, l.email, l.phone, l.parentName || '', l.parentEmail || '',
      l.courseInterest || '', l.status, l.leadScore, l.leadCategory,
      l.totalCallAttempts || 0,
      l.lastCallAt ? new Date(l.lastCallAt).toISOString() : '',
      l.meeting?.scheduledAt ? new Date(l.meeting.scheduledAt).toISOString() : '',
      l.meeting?.meetLink || '',
      new Date(l.createdAt).toISOString(),
    ]);
    const csv = [headers, ...rows].map(r => r.map(c => `"${String(c).replace(/"/g,'""')}"`).join(',')).join('\n');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="leads-${new Date().toISOString().slice(0,10)}.csv"`);
    res.send(csv);
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/leads/:id', async (req, res) => {
  try {
    const lead = await Lead.findById(req.params.id);
    if (!lead) return res.status(404).json({ error: 'Lead not found' });
    res.json(lead);
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/leads/:id/recording/:attemptIdx', async (req, res) => {
  try {
    const lead = await Lead.findById(req.params.id);
    if (!lead) return res.status(404).type('text/plain').send('Lead not found');

    const attempt = lead.callAttempts[parseInt(req.params.attemptIdx)];
    if (!attempt?.recordingUrl) {
      // No recording yet — return 204 No Content instead of 404 so the browser
      // doesn't log a scary error in the console.
      return res.status(204).end();
    }

    const auth = Buffer.from(`${cfg.twilio.accountSid}:${cfg.twilio.authToken}`).toString('base64');
    const stream = await axios.get(attempt.recordingUrl, {
      headers: { Authorization: `Basic ${auth}` },
      responseType: 'stream',
      validateStatus: () => true,
    });

    if (stream.status !== 200) {
      // Twilio doesn't have the recording (yet or ever) — return 204
      return res.status(204).end();
    }

    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Cache-Control', 'public, max-age=3600');
    stream.data.pipe(res);
  } catch(e) {
    logger.error('Recording stream error', { msg: e.message });
    res.status(204).end();    // graceful empty — no console noise
  }
});

router.post('/leads/:id/call', async (req, res) => {
  try {
    const lead = await Lead.findById(req.params.id);
    if (!lead) return res.status(404).json({ error: 'Lead not found' });

    if (!lead.phone || !/^\+[1-9]\d{6,14}$/.test(lead.phone)) {
      return res.status(400).json({ error: `Invalid phone number "${lead.phone}". Must be E.164 (e.g. +14155551234).` });
    }

    // Use the LIVE tunnel URL (not the possibly-stale cached one)
    const { getCurrentUrl } = require('../utils/tunnel');
    const baseUrl = getCurrentUrl() || cfg.server.baseUrl;
    if (!baseUrl || baseUrl.includes('localhost') || baseUrl.includes('your-ngrok')) {
      return res.status(503).json({ error: 'Public tunnel is not active. Cannot place call — Twilio webhooks would fail.' });
    }

    lead.status = 'calling';
    lead.totalCallAttempts += 1;
    lead.lastCallAt = new Date();
    lead.callAttempts.push({
      attemptNumber: lead.totalCallAttempts,
      startTime: new Date(),
      status: 'initiated',
    });
    await lead.save();

    logger.info(`Manual call requested → ${lead.fullName} ${lead.phone} via ${baseUrl}`);

    let callSid;
    try {
      const result = await twilioSvc.call(lead, baseUrl);
      callSid = result.callSid;
    } catch (twilioErr) {
      // Roll back lead status if Twilio rejects the call
      lead.status = 'queued';
      lead.totalCallAttempts -= 1;
      lead.callAttempts.pop();
      await lead.save();
      logger.error('Twilio call rejected:', twilioErr.message);
      return res.status(502).json({ error: `Twilio error: ${twilioErr.message}` });
    }

    lead.callAttempts[lead.callAttempts.length - 1].callSid = callSid;
    await lead.save();

    res.json({ ok: true, callSid, message: `Calling ${lead.fullName} at ${lead.phone}` });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/leads/:id/email', async (req, res) => {
  try {
    const { type } = req.body;
    const lead = await Lead.findById(req.params.id);
    if (!lead) return res.status(404).json({ error: 'Lead not found' });
    if (!type) return res.status(400).json({ error: 'Email type required (welcome, confirmation, reminder, noAnswer, enrollment)' });

    const map = {
      welcome:      () => emailSvc.sendNewLeadWelcome(lead),
      confirmation: () => emailSvc.sendMeetingConfirmation(lead),
      reminder:     () => emailSvc.sendMeetingReminder(lead),
      noAnswer:     () => emailSvc.sendNoAnswer(lead),
      enrollment:   () => emailSvc.sendEnrollmentFollowup(lead),
    };
    if (!map[type]) return res.status(400).json({ error: `Invalid email type "${type}". Must be one of: welcome, confirmation, reminder, noAnswer, enrollment` });

    const result = await map[type]();
    if (result.ok) {
      lead.emailsSent.push({ type, sentAt: new Date() });
      await lead.save();
    } else if (result.error) {
      logger.warn(`Email send failed (not critical)`, { leadId: req.params.id, type, error: result.error });
    }
    res.json(result);
  } catch(e) {
    logger.error('Email endpoint error', { leadId: req.params.id, type: req.body.type, msg: e.message, stack: e.stack?.split('\n').slice(0,5) });
    res.status(500).json({ error: `Email service error: ${e.message}` });
  }
});

router.patch('/leads/:id', async (req, res) => {
  try {
    const allowed = ['status','leadCategory','notes'];
    const update = {};
    allowed.forEach(k => { if (req.body[k] !== undefined) update[k] = req.body[k]; });
    const lead = await Lead.findByIdAndUpdate(req.params.id, update, { new: true });
    if (!lead) return res.status(404).json({ error: 'Lead not found' });
    res.json(lead);
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════
//   MEETINGS
// ═══════════════════════════════════════════════════════════════════════
router.get('/meetings', async (req, res) => {
  try {
    const now = new Date();
    const leads = await Lead.find({
      'meeting.scheduledAt': { $exists: true, $ne: null },
    })
    .sort({ 'meeting.scheduledAt': 1 })
    .select('fullName email phone parentName parentEmail meeting leadScore courseInterest grade');

    // Split upcoming vs past
    const upcoming = leads.filter(l => new Date(l.meeting.scheduledAt) >= now);
    const past     = leads.filter(l => new Date(l.meeting.scheduledAt) <  now);
    res.json({ upcoming, past, total: leads.length });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════
//   CALLS
// ═══════════════════════════════════════════════════════════════════════
router.get('/calls', async (req, res) => {
  try {
    const leads = await Lead.find({ 'callAttempts.0': { $exists: true } })
      .sort({ lastCallAt: -1 })
      .select('fullName email phone callAttempts leadScore status');

    // Flatten into per-call records
    const calls = [];
    leads.forEach(l => {
      l.callAttempts.forEach((c, idx) => {
        calls.push({
          leadId: l._id,
          leadName: l.fullName,
          leadPhone: l.phone,
          leadScore: l.leadScore,
          leadStatus: l.status,
          attemptIdx: idx,
          attemptNumber: c.attemptNumber,
          callSid: c.callSid,
          startTime: c.startTime,
          duration: c.duration,
          status: c.status,
          recordingUrl: c.recordingUrl,
          aiSummary: c.aiSummary,
          sentiment: c.sentiment,
          hasTranscript: !!c.transcript,
        });
      });
    });
    calls.sort((a, b) => new Date(b.startTime || 0) - new Date(a.startTime || 0));
    res.json(calls);
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════
//   ACTIONS
// ═══════════════════════════════════════════════════════════════════════
router.post('/poll', async (req, res) => {
  try {
    await poller.pollOnce();
    res.json({ ok: true, message: 'Sheets polled' });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/system', (req, res) => {
  const { getCurrentUrl } = require('../utils/tunnel');
  const tunnelUrl = getCurrentUrl() || cfg.server.baseUrl;
  res.json({
    baseUrl:       cfg.server.baseUrl,
    tunnelUrl,
    twilioPhone:   cfg.twilio.phoneNumber,
    counselorName: cfg.company.counselorName,
    pollInterval:  cfg.sheets.pollIntervalSeconds,
    uptime:        Math.round(process.uptime()),
    env:           cfg.server.env,
    timestamp:     new Date().toISOString(),
  });
});

module.exports = router;

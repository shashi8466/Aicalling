/**
 * Dashboard API Routes — Supabase-backed
 * All endpoints under /api/*  (same surface as before)
 */
const express   = require('express');
const router    = express.Router();
const axios     = require('axios');
const supabase  = require('../db/supabase');
const Lead      = require('../models/Lead');
const poller    = require('../jobs/poller');
const twilioSvc = require('../services/twilioService');
const sheetsSvc = require('../services/sheetsService');
const emailSvc  = require('../services/emailService');
const cfg       = require('../config');
const logger    = require('../logger');

// ── JS aggregation helpers ────────────────────────────────────────────────────
function groupBy(arr, key) {
  const m = {};
  for (const item of arr) {
    const k = item[key] ?? 'unknown';
    m[k] = (m[k] || 0) + 1;
  }
  return Object.entries(m).map(([_id, count]) => ({ _id, count }));
}

// ═══════════════════════════════════════════════════════════════════════
//   STATS
// ═══════════════════════════════════════════════════════════════════════
router.get('/stats', async (req, res) => {
  try {
    // Parallel count queries via Supabase
    const statuses = [
      'new','queued','calling','contacted','qualified',
      'meeting-scheduled','meeting-completed','enrolled','lost',
    ];

    const countQ = async (filter) => Lead.countDocuments(filter);

    const [
      total,
      newLeads, queued, calling, contacted, qualified,
      meetingsScheduled, meetingsCompleted, enrolled, lost,
      hot, warm, cold,
    ] = await Promise.all([
      countQ({}),
      countQ({ status: 'new' }),
      countQ({ status: 'queued' }),
      countQ({ status: 'calling' }),
      countQ({ status: 'contacted' }),
      countQ({ status: 'qualified' }),
      countQ({ status: 'meeting-scheduled' }),
      countQ({ status: 'meeting-completed' }),
      countQ({ status: 'enrolled' }),
      countQ({ status: 'lost' }),
      countQ({ leadCategory: 'hot' }),
      countQ({ leadCategory: 'warm' }),
      countQ({ leadCategory: 'cold' }),
    ]);

    // Fetch call_attempts + lead_score columns only for aggregation
    const { data: leadsForAgg } = await supabase
      .from('leads')
      .select('call_attempts, lead_score');

    const rows = leadsForAgg || [];
    const callsCompleted = rows.reduce((sum, r) =>
      sum + (r.call_attempts || []).filter(a => a.status === 'completed').length, 0);
    const avgScore = rows.length
      ? Math.round(rows.reduce((s, r) => s + (r.lead_score || 0), 0) / rows.length)
      : 0;

    const conversionRate = total ? ((enrolled / total) * 100).toFixed(1) : '0.0';
    const meetingRate    = contacted
      ? ((meetingsScheduled / (contacted + meetingsScheduled)) * 100).toFixed(1)
      : '0.0';

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
//   ANALYTICS
// ═══════════════════════════════════════════════════════════════════════
router.get('/analytics', async (req, res) => {
  try {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000);

    const { data: allLeads } = await supabase
      .from('leads')
      .select('source, course_interest, call_attempts, created_at');

    const rows = allLeads || [];

    // By source
    const bySource = groupBy(rows, 'source');

    // By program (top 6, non-empty)
    const byProgram = Object.entries(
      rows
        .filter(r => r.course_interest)
        .reduce((m, r) => { m[r.course_interest] = (m[r.course_interest] || 0) + 1; return m; }, {})
    )
      .map(([_id, count]) => ({ _id, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 6);

    // Daily new leads (last 30 days)
    const recentLeads = rows.filter(r => new Date(r.created_at) >= thirtyDaysAgo);
    const dailyMap = {};
    recentLeads.forEach(r => {
      const day = new Date(r.created_at).toISOString().slice(0, 10);
      dailyMap[day] = (dailyMap[day] || 0) + 1;
    });
    const dailyLeads = Object.entries(dailyMap)
      .map(([_id, count]) => ({ _id, count }))
      .sort((a, b) => a._id.localeCompare(b._id));

    // Sentiment breakdown from callAttempts
    const sentimentMap = {};
    rows.forEach(r => {
      (r.call_attempts || []).forEach(ca => {
        if (ca.sentiment) sentimentMap[ca.sentiment] = (sentimentMap[ca.sentiment] || 0) + 1;
      });
    });
    const sentiment = Object.entries(sentimentMap).map(([_id, count]) => ({ _id, count }));

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
    const { status, category, search, campaignId, limit = 500 } = req.query;
    const filter = {};
    if (status)   filter.status       = status;
    if (category) filter.leadCategory = category;
    if (search) {
      filter.$or = [
        { fullName: new RegExp(search, 'i') },
        { email:    new RegExp(search, 'i') },
        { phone:    new RegExp(search, 'i') },
      ];
    }
    // Campaign filter: '__none__' = leads with no campaign, uuid = specific campaign
    if (campaignId === '__none__') {
      filter.campaignId = null;
    } else if (campaignId) {
      filter.campaignId = campaignId;
    }
    const leads = await Lead.find(filter, {
      sort:   { leadScore: -1, createdAt: -1 },
      limit:  parseInt(limit),
      select: '-callAttempts.transcript',
    });
    res.json(leads);
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});


router.get('/leads/export', async (req, res) => {
  try {
    const leads = await Lead.find({}, { sort: { createdAt: -1 }, limit: 5000 });
    const headers = ['Full Name','Grade','Email','Phone','Parent Name','Parent Email',
      'Course','Status','Lead Score','Category','Call Attempts','Last Call',
      'Meeting Date','Meet Link','Created'];
    const rows = leads.map(l => [
      l.fullName, l.grade, l.email, l.phone,
      l.parentName || '', l.parentEmail || '', l.courseInterest || '',
      l.status, l.leadScore, l.leadCategory,
      l.totalCallAttempts || 0,
      l.lastCallAt ? new Date(l.lastCallAt).toISOString() : '',
      l.meeting?.scheduledAt ? new Date(l.meeting.scheduledAt).toISOString() : '',
      l.meeting?.meetLink || '',
      new Date(l.createdAt).toISOString(),
    ]);
    const csv = [headers, ...rows]
      .map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(','))
      .join('\n');
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

    const attempt = (lead.callAttempts || [])[parseInt(req.params.attemptIdx)];
    if (!attempt?.recordingUrl) return res.status(204).end();

    const auth = Buffer.from(`${cfg.twilio.accountSid}:${cfg.twilio.authToken}`).toString('base64');
    const stream = await axios.get(attempt.recordingUrl, {
      headers: { Authorization: `Basic ${auth}` },
      responseType: 'stream',
      validateStatus: () => true,
    });
    if (stream.status !== 200) return res.status(204).end();

    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Cache-Control', 'public, max-age=3600');
    stream.data.pipe(res);
  } catch(e) {
    logger.error('Recording stream error', { msg: e.message });
    res.status(204).end();
  }
});

router.post('/leads/:id/call', async (req, res) => {
  try {
    const lead = await Lead.findById(req.params.id);
    if (!lead) return res.status(404).json({ error: 'Lead not found' });

    if (!lead.phone || !/^\+[1-9]\d{6,14}$/.test(lead.phone)) {
      return res.status(400).json({ error: `Invalid phone number "${lead.phone}". Must be E.164 (e.g. +14155551234).` });
    }

    const { getCurrentUrl } = require('../utils/tunnel');
    const baseUrl = getCurrentUrl() || cfg.server.baseUrl;
    if (!baseUrl || baseUrl.includes('localhost') || baseUrl.includes('your-ngrok')) {
      return res.status(503).json({ error: 'Public tunnel is not active. Cannot place call — Twilio webhooks would fail.' });
    }

    // Accept a campaignType hint from the dashboard (e.g. 'sat-batch').
    // This lets the webhook pick the right script even before the campaigns table exists.
    // Falls back to the lead's own campaignId → DB lookup → demo default.
    const campaignSvc = require('../services/campaignService');
    const campaignReg = require('../campaigns/registry');
    let campaignId = (req.body && req.body.campaignId) || null;
    // If not supplied by caller, try to resolve from the lead's stored campaignId
    if (!campaignId && lead.campaignId) {
      campaignId = lead.campaignId;
    }

    lead.status = 'calling';
    lead.totalCallAttempts = (lead.totalCallAttempts || 0) + 1;
    lead.lastCallAt = new Date().toISOString();
    lead.callAttempts = lead.callAttempts || [];
    lead.callAttempts.push({
      attemptNumber: lead.totalCallAttempts,
      startTime:     new Date().toISOString(),
      status:        'initiated',
    });
    await lead.save();

    logger.info(`Manual call requested → ${lead.fullName} ${lead.phone} via ${baseUrl}` +
      (campaignId ? ` [campaignId: ${campaignId}]` : ''));

    let callSid;
    try {
      const result = await twilioSvc.call(lead, baseUrl, campaignId);
      callSid = result.callSid;
    } catch (twilioErr) {
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


router.post('/leads/:id/stop-call', async (req, res) => {
  try {
    const lead = await Lead.findById(req.params.id);
    if (!lead) return res.status(404).json({ ok: false, error: 'Lead not found' });

    const lastAttempt = [...(lead.callAttempts || [])].reverse()
      .find(a => a.callSid && !['completed','canceled','failed','no-answer','busy'].includes(a.status));
    const callSid = lastAttempt?.callSid;

    let hungUp = false;
    if (callSid) {
      try {
        await twilioSvc.endCall(callSid);
        hungUp = true;
        logger.info(`Admin stopped call ${callSid} for ${lead.fullName}`);
      } catch (e) {
        logger.warn(`Stop-call: Twilio hangup failed: ${e.message}`);
      }
    }

    if (lead.status === 'calling') lead.status = 'contacted';
    if (lastAttempt && !['completed','canceled'].includes(lastAttempt.status)) {
      lastAttempt.status  = 'canceled';
      lastAttempt.endTime = new Date().toISOString();
    }
    lead.nextRetryAt = null;
    await lead.save();

    res.json({
      ok: true, hungUp,
      message: hungUp
        ? `Call stopped for ${lead.fullName}.`
        : `No active call found — status reset for ${lead.fullName}.`,
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

router.post('/leads/:id/email', async (req, res) => {
  const { type } = req.body || {};
  const leadId = req.params.id;
  try {
    const cfg2 = require('../config');
    if (!cfg2.brevo.apiKey)    return res.status(200).json({ ok: false, error: 'Email service not configured: BREVO_API_KEY missing.' });
    if (!cfg2.brevo.fromEmail) return res.status(200).json({ ok: false, error: 'Email service not configured: BREVO_FROM_EMAIL missing.' });
    if (!type) return res.status(400).json({ ok: false, error: 'Email type required.' });

    const lead = await Lead.findById(leadId);
    if (!lead) return res.status(404).json({ ok: false, error: 'Lead not found' });
    if (!lead.email) return res.status(200).json({ ok: false, error: `Lead "${lead.fullName}" has no email address on file` });

    const map = {
      welcome:           () => emailSvc.sendNewLeadWelcome(lead),
      confirmation:      () => emailSvc.sendMeetingConfirmation(lead),
      reminder:          () => emailSvc.sendMeetingReminder(lead),
      noAnswer:          () => emailSvc.sendNoAnswer(lead),
      enrollment:        () => emailSvc.sendEnrollmentFollowup(lead),
      'success-stories': () => emailSvc.sendSuccessStories(lead),
    };
    if (!map[type]) return res.status(400).json({ ok: false, error: `Unknown email type "${type}".` });

    logger.info(`Sending "${type}" email to ${lead.email}`, { leadId });
    const result = await map[type]();

    if (result.ok) {
      try {
        lead.emailsSent = lead.emailsSent || [];
        lead.emailsSent.push({ type, sentAt: new Date().toISOString() });
        await lead.save();
      } catch(saveErr) {
        logger.warn('Could not save emailsSent', { leadId, err: saveErr.message });
      }
    }
    return res.status(200).json(result);
  } catch(e) {
    logger.error('Email endpoint error', { leadId, type, msg: e.message });
    return res.status(200).json({ ok: false, error: `Unexpected error: ${e.message}` });
  }
});

// Create lead manually
router.post('/leads', async (req, res) => {
  try {
    const { fullName, email, phone, grade, courseInterest, parentName, parentEmail, status, notes, campaignId } = req.body;
    if (!fullName?.trim()) return res.status(400).json({ error: 'Full name is required' });
    if (!email?.trim())    return res.status(400).json({ error: 'Email is required' });
    if (!phone?.trim())    return res.status(400).json({ error: 'Phone is required' });

    const query = { email: email.trim().toLowerCase() };
    if (campaignId) {
      query.campaignId = campaignId;
    } else {
      query.campaignId = null;
    }

    const existing = await Lead.findOne(query);
    if (existing) return res.status(409).json({ error: `A lead with email "${email}" already exists in this campaign` });

    const lead = await Lead.create({
      fullName: fullName.trim(),
      email:    email.trim().toLowerCase(),
      phone:    phone.trim(),
      grade:    grade?.trim() || '',
      courseInterest: courseInterest?.trim() || '',
      parentName:     parentName?.trim() || '',
      parentEmail:    parentEmail?.trim() || '',
      status:  status || 'new',
      notes:   notes?.trim() || '',
      source:  'manual',
      ...(campaignId ? { campaignId } : {}),
    });
    logger.info(`Lead created manually: ${lead.fullName} <${lead.email}>`);
    res.status(201).json(lead);
  } catch(e) {
    if (e.message?.includes('unique') || e.message?.includes('duplicate')) {
      return res.status(409).json({ error: 'A lead with this email already exists in the database. You must drop the unique email constraint in your Supabase SQL Editor.' });
    }
    res.status(500).json({ error: e.message });
  }
});

// Update lead
router.patch('/leads/:id', async (req, res) => {
  try {
    const allowed = ['status','leadCategory','notes','fullName','email','phone',
                     'grade','courseInterest','parentName','parentEmail','meeting.status','campaignId',
                     'countryCode','country','state','timeZone','meetingStatus','lastMorningCall','lastEveningCall','nextScheduledCall'];
    const update = {};
    allowed.forEach(k => { if (req.body[k] !== undefined) update[k] = req.body[k]; });
    const lead = await Lead.findByIdAndUpdate(req.params.id, update, { new: true });
    if (!lead) return res.status(404).json({ error: 'Lead not found' });
    res.json(lead);
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

// Delete lead
router.delete('/leads/:id', async (req, res) => {
  try {
    const lead = await Lead.findByIdAndDelete(req.params.id);
    if (!lead) return res.status(404).json({ error: 'Lead not found' });
    logger.info(`Lead deleted: ${lead.fullName} <${lead.email}>`);
    res.json({ ok: true, message: `Lead "${lead.fullName}" deleted successfully` });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

// Delete a single call attempt
router.delete('/leads/:id/calls/:callId', async (req, res) => {
  try {
    const lead = await Lead.findById(req.params.id);
    if (!lead) return res.status(404).json({ error: 'Lead not found' });

    const before = (lead.callAttempts || []).length;
    lead.callAttempts = (lead.callAttempts || []).filter(
      c => String(c._id) !== req.params.callId
    );
    if (lead.callAttempts.length === before) {
      return res.status(404).json({ error: 'Call record not found' });
    }

    lead.totalCallAttempts = lead.callAttempts.length;
    lead.lastCallAt = lead.callAttempts.length
      ? lead.callAttempts[lead.callAttempts.length - 1].startTime
      : null;
    await lead.save();

    logger.info(`Call deleted: leadId=${req.params.id} callId=${req.params.callId}`);
    res.json({ ok: true, message: 'Call record deleted' });
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
    // Fetch leads that have a meeting.scheduledAt set (JSONB filter in JS)
    const { data: rows } = await supabase
      .from('leads')
      .select('id, full_name, email, phone, parent_name, parent_email, meeting, lead_score, course_interest, grade')
      .not('meeting', 'eq', '{}')
      .not('meeting', 'is', null)
      .order('created_at', { ascending: false })
      .limit(1000);

    const leads = (rows || [])
      .filter(r => r.meeting?.scheduledAt)
      .map(r => ({
        _id: r.id, id: r.id,
        fullName: r.full_name, email: r.email, phone: r.phone,
        parentName: r.parent_name, parentEmail: r.parent_email,
        meeting: r.meeting, leadScore: r.lead_score,
        courseInterest: r.course_interest, grade: r.grade,
      }));

    leads.sort((a, b) => new Date(a.meeting.scheduledAt) - new Date(b.meeting.scheduledAt));

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
    const { data: rows } = await supabase
      .from('leads')
      .select('id, full_name, email, phone, call_attempts, lead_score, status, last_call_at')
      .not('call_attempts', 'eq', '[]')
      .order('last_call_at', { ascending: false, nullsFirst: false })
      .limit(500);

    const calls = [];
    (rows || []).forEach(r => {
      (r.call_attempts || []).forEach((c, idx) => {
        calls.push({
          leadId:        r.id,
          leadName:      r.full_name,
          leadPhone:     r.phone,
          leadScore:     r.lead_score,
          leadStatus:    r.status,
          callId:        c._id,
          attemptIdx:    idx,
          attemptNumber: c.attemptNumber,
          callSid:       c.callSid,
          startTime:     c.startTime,
          duration:      c.duration,
          status:        c.status,
          recordingUrl:  c.recordingUrl,
          aiSummary:     c.aiSummary,
          sentiment:     c.sentiment,
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
//   SYSTEM
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

router.get('/config-check', (req, res) => {
  const check = val => val ? '✅ Set' : '❌ MISSING';
  res.json({
    info: 'Shows which environment variables are configured. No secret values are returned.',
    environment: cfg.server.env,
    email: {
      BREVO_API_KEY:    check(cfg.brevo.apiKey),
      BREVO_FROM_EMAIL: check(cfg.brevo.fromEmail),
      BREVO_FROM_NAME:  check(cfg.brevo.fromName),
    },
    twilio: {
      TWILIO_ACCOUNT_SID:  check(cfg.twilio.accountSid),
      TWILIO_AUTH_TOKEN:   check(cfg.twilio.authToken),
      TWILIO_PHONE_NUMBER: cfg.twilio.phoneNumber || '❌ MISSING',
    },
    ai: {
      OPENAI_API_KEY: check(cfg.openai.apiKey),
      LLM_PROVIDER:   cfg.llm.provider,
    },
    google: {
      GOOGLE_CLIENT_EMAIL: check(cfg.google.clientEmail),
      GOOGLE_PRIVATE_KEY:  check(cfg.google.privateKey),
      GOOGLE_SHEETS_ID:    check(cfg.google.sheetsId),
    },
    supabase: {
      SUPABASE_URL:              check(cfg.supabase.url),
      SUPABASE_SERVICE_ROLE_KEY: check(cfg.supabase.serviceRoleKey),
    },
    server: {
      BASE_URL: cfg.server.baseUrl,
      PORT:     cfg.server.port,
    },
  });
});

module.exports = router;



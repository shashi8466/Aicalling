/**
 * Counselor Management Routes  —  /api/counselors/*
 * All routes require Admin role (enforced in index.js via requireAdmin)
 */
const express  = require('express');
const router   = express.Router();
const supabase = require('../db/supabase');
const logger   = require('../logger');

// ── GET /api/counselors ── list all counselors (+ admin)
router.get('/', async (req, res) => {
  try {
    const { search, active } = req.query;

    let q = supabase.from('profiles').select('*').order('created_at', { ascending: false });

    if (active !== undefined) q = q.eq('is_active', active === 'true');
    if (search) q = q.ilike('full_name', `%${search}%`);

    const { data, error } = await q;
    if (error) return res.status(500).json({ error: error.message });

    // Attach lead counts
    const ids = (data || []).map(p => p.id);
    let leadCounts = {};
    if (ids.length) {
      const { data: lcRows } = await supabase
        .from('leads')
        .select('assigned_counselor_id')
        .in('assigned_counselor_id', ids);
      (lcRows || []).forEach(r => {
        leadCounts[r.assigned_counselor_id] = (leadCounts[r.assigned_counselor_id] || 0) + 1;
      });
    }

    const counselors = (data || []).map(p => ({
      id:         p.id,
      fullName:   p.full_name,
      email:      p.email,
      role:       p.role,
      phone:      p.phone,
      isActive:   p.is_active,
      leadsCount: leadCounts[p.id] || 0,
      createdAt:  p.created_at,
    }));

    res.json(counselors);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── GET /api/counselors/:id ── single counselor
router.get('/:id', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', req.params.id)
      .single();
    if (error || !data) return res.status(404).json({ error: 'Counselor not found' });
    res.json({ id: data.id, fullName: data.full_name, email: data.email,
               role: data.role, phone: data.phone, isActive: data.is_active, createdAt: data.created_at });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── POST /api/counselors ── create new counselor (creates Supabase auth user)
router.post('/', async (req, res) => {
  try {
    const { fullName, email, password, phone, role = 'counselor' } = req.body;
    if (!fullName?.trim()) return res.status(400).json({ error: 'Full name is required' });
    if (!email?.trim())    return res.status(400).json({ error: 'Email is required' });
    if (!password || password.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters' });
    }
    if (!['admin','counselor'].includes(role)) {
      return res.status(400).json({ error: 'Role must be admin or counselor' });
    }

    // Create Supabase auth user
    const { data: authData, error: authErr } = await supabase.auth.admin.createUser({
      email:          email.trim().toLowerCase(),
      password,
      email_confirm:  true,
      user_metadata:  { full_name: fullName.trim(), role },
    });
    if (authErr) {
      if (authErr.message?.includes('already registered')) {
        return res.status(409).json({ error: 'A user with this email already exists' });
      }
      return res.status(500).json({ error: authErr.message });
    }

    // Upsert profile (the trigger may have already created it)
    const { data: profile, error: profErr } = await supabase
      .from('profiles')
      .upsert({
        id:        authData.user.id,
        full_name: fullName.trim(),
        email:     email.trim().toLowerCase(),
        role,
        phone:     (phone || '').trim(),
      }, { onConflict: 'id' })
      .select()
      .single();

    if (profErr) return res.status(500).json({ error: profErr.message });

    logger.info(`Counselor created: ${email} (${role})`);
    res.status(201).json({
      id:       profile.id,
      fullName: profile.full_name,
      email:    profile.email,
      role:     profile.role,
      phone:    profile.phone,
      isActive: profile.is_active,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── PATCH /api/counselors/:id ── update name/phone/role/active
router.patch('/:id', async (req, res) => {
  try {
    const allowed = ['fullName','phone','role','isActive'];
    const update  = {};
    if (req.body.fullName  !== undefined) update.full_name  = req.body.fullName.trim();
    if (req.body.phone     !== undefined) update.phone      = (req.body.phone || '').trim();
    if (req.body.role      !== undefined) {
      if (!['admin','counselor'].includes(req.body.role)) {
        return res.status(400).json({ error: 'Invalid role' });
      }
      update.role = req.body.role;
    }
    if (req.body.isActive  !== undefined) update.is_active  = Boolean(req.body.isActive);
    update.updated_at = new Date().toISOString();

    const { data, error } = await supabase
      .from('profiles')
      .update(update)
      .eq('id', req.params.id)
      .select()
      .single();

    if (error || !data) return res.status(404).json({ error: 'Counselor not found' });

    logger.info(`Counselor updated: ${data.email}`);
    res.json({ id: data.id, fullName: data.full_name, email: data.email,
               role: data.role, phone: data.phone, isActive: data.is_active });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── DELETE /api/counselors/:id ── remove auth user (cascades to profile)
router.delete('/:id', async (req, res) => {
  try {
    // Prevent deleting self
    if (req.params.id === req.user?.id) {
      return res.status(400).json({ error: 'You cannot delete your own account' });
    }

    const { error } = await supabase.auth.admin.deleteUser(req.params.id);
    if (error) return res.status(500).json({ error: error.message });

    logger.info(`Counselor deleted: ${req.params.id}`);
    res.json({ ok: true, message: 'Counselor deleted' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── GET /api/counselors/:id/stats ── performance metrics
router.get('/:id/stats', async (req, res) => {
  try {
    const cid = req.params.id;

    // Fetch all leads assigned to this counselor
    const { data: leads } = await supabase
      .from('leads')
      .select('id, status, lead_category, call_attempts, meeting, lead_score, created_at')
      .eq('assigned_counselor_id', cid);

    const rows = leads || [];
    const totalLeads     = rows.length;
    const hotLeads       = rows.filter(r => r.lead_category === 'hot').length;
    const qualifiedLeads = rows.filter(r => ['qualified','meeting-scheduled','meeting-completed','enrolled'].includes(r.status)).length;
    const enrolled       = rows.filter(r => r.status === 'enrolled').length;
    const meetingsBooked = rows.filter(r => r.meeting?.scheduledAt).length;
    const callsMade      = rows.reduce((s, r) => s + (r.call_attempts || []).length, 0);
    const avgScore       = totalLeads
      ? Math.round(rows.reduce((s, r) => s + (r.lead_score || 0), 0) / totalLeads)
      : 0;

    // Enrollment + payment totals
    const leadIds = rows.map(r => r.id);
    let totalRevenue = 0;
    if (leadIds.length) {
      const { data: pmts } = await supabase
        .from('payments')
        .select('amount_paid, payment_status')
        .in('lead_id', leadIds)
        .in('payment_status', ['paid','partial-paid']);
      totalRevenue = (pmts || []).reduce((s, p) => s + (p.amount_paid || 0), 0);
    }

    // Recent activity (last 5 leads)
    const recentLeads = [...rows]
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
      .slice(0, 5)
      .map(r => ({
        id: r.id, status: r.status, leadCategory: r.lead_category,
        leadScore: r.lead_score, createdAt: r.created_at,
      }));

    res.json({
      totalLeads, hotLeads, qualifiedLeads, enrolled,
      meetingsBooked, callsMade, avgScore, totalRevenue, recentLeads,
      conversionRate: totalLeads ? ((enrolled / totalLeads) * 100).toFixed(1) : '0.0',
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── GET /api/counselors/:id/leads ── leads assigned to this counselor
router.get('/:id/leads', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('leads')
      .select('id, full_name, email, phone, status, lead_category, lead_score, meeting, last_call_at, call_attempts, created_at')
      .eq('assigned_counselor_id', req.params.id)
      .order('created_at', { ascending: false })
      .limit(200);

    if (error) return res.status(500).json({ error: error.message });

    res.json((data || []).map(r => ({
      id:           r.id, _id: r.id,
      fullName:     r.full_name, email: r.email, phone: r.phone,
      status:       r.status, leadCategory: r.lead_category, leadScore: r.lead_score,
      meeting:      r.meeting, lastCallAt: r.last_call_at, callAttempts: r.call_attempts || [], createdAt: r.created_at,
    })));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── POST /api/counselors/:id/assign ── assign leads to this counselor
router.post('/:id/assign', async (req, res) => {
  try {
    const { leadIds } = req.body;
    if (!Array.isArray(leadIds) || !leadIds.length) {
      return res.status(400).json({ error: 'leadIds array is required' });
    }

    const { error } = await supabase
      .from('leads')
      .update({ assigned_counselor_id: req.params.id, updated_at: new Date().toISOString() })
      .in('id', leadIds);

    if (error) return res.status(500).json({ error: error.message });

    logger.info(`Assigned ${leadIds.length} leads to counselor ${req.params.id}`);
    res.json({ ok: true, assigned: leadIds.length });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── GET /api/counselors/:id/enrollments ── enrollments for leads assigned to counselor
router.get('/:id/enrollments', async (req, res) => {
  try {
    const { data: leads } = await supabase
      .from('leads')
      .select('id')
      .eq('assigned_counselor_id', req.params.id);
    const leadIds = (leads || []).map(l => l.id);
    if (!leadIds.length) return res.json([]);

    const { data: enrollments, error } = await supabase
      .from('enrollments')
      .select('*')
      .in('lead_id', leadIds)
      .order('created_at', { ascending: false });

    if (error) return res.status(500).json({ error: error.message });

    res.json((enrollments || []).map(e => ({
      id: e.id,
      _id: e.id,
      leadId: e.lead_id,
      studentName: e.student_name,
      grade: e.grade,
      program: e.program,
      learningMode: e.learning_mode,
      paymentPlan: e.payment_plan,
      programFee: e.program_fee,
      enrollmentStatus: e.enrollment_status,
      notes: e.notes,
      createdAt: e.created_at,
    })));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── GET /api/counselors/:id/followups ── follow-up tasks for leads assigned to counselor
router.get('/:id/followups', async (req, res) => {
  try {
    const { data: leads } = await supabase
      .from('leads')
      .select('id')
      .eq('assigned_counselor_id', req.params.id);
    const leadIds = (leads || []).map(l => l.id);
    if (!leadIds.length) return res.json([]);

    const { data: followups, error } = await supabase
      .from('follow_ups')
      .select('*')
      .in('lead_id', leadIds)
      .order('scheduled_date', { ascending: true });

    if (error) return res.status(500).json({ error: error.message });

    // Enrich with lead name
    const { data: leadNames } = await supabase
      .from('leads')
      .select('id, full_name, email, status')
      .in('id', leadIds);
    const leadMap = {};
    (leadNames || []).forEach(l => { leadMap[l.id] = l; });

    res.json((followups || []).map(f => ({
      ...f,
      leadName: leadMap[f.lead_id]?.full_name || 'Unknown',
      leadEmail: leadMap[f.lead_id]?.email || '',
      leadStatus: leadMap[f.lead_id]?.status || '',
    })));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;


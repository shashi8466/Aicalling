/**
 * Auth Routes  —  /auth/*
 * /auth/config  is PUBLIC (no token needed — bootstraps the frontend client)
 * All other routes require a valid Supabase JWT.
 */
const express  = require('express');
const router   = express.Router();
const supabase = require('../db/supabase');
const { requireAuth } = require('../middleware/auth');
const logger   = require('../logger');

// ── Public: return Supabase URL + anon key so the frontend can init the client
router.get('/config', (_req, res) => {
  res.json({
    supabaseUrl:     process.env.SUPABASE_URL     || '',
    supabaseAnonKey: process.env.SUPABASE_ANON_KEY || '',
  });
});

// ── POST /auth/signup ── Public registration
router.post('/signup', async (req, res) => {
  try {
    const { fullName, email, password, phone, role = 'admin' } = req.body;
    if (!fullName?.trim()) return res.status(400).json({ error: 'Full name is required' });
    if (!email?.trim())    return res.status(400).json({ error: 'Email is required' });
    if (!password || password.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters' });
    }

    // Create Supabase auth user using service role key (auto-confirm email)
    const { data: authData, error: authErr } = await supabase.auth.admin.createUser({
      email:          email.trim().toLowerCase(),
      password,
      email_confirm:  true,
      user_metadata:  { full_name: fullName.trim(), role },
    });

    if (authErr) {
      if (authErr.message?.includes('already registered') || authErr.message?.includes('already exists')) {
        return res.status(409).json({ error: 'A user with this email already exists' });
      }
      return res.status(500).json({ error: authErr.message });
    }

    // Upsert profile (the trigger may have already created it, but ensure all fields are set)
    const { data: profile, error: profErr } = await supabase
      .from('profiles')
      .upsert({
        id:        authData.user.id,
        full_name: fullName.trim(),
        email:     email.trim().toLowerCase(),
        role,
        phone:     (phone || '').trim(),
        is_active: role !== 'admin', // New admins start as inactive/unapproved
      }, { onConflict: 'id' })
      .select()
      .single();

    if (profErr) return res.status(500).json({ error: profErr.message });

    logger.info(`User registered publicly: ${email} (${role})`);
    res.status(201).json({
      id:       profile.id,
      fullName: profile.full_name,
      email:    profile.email,
      role:     profile.role,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── POST /auth/bootstrap ── Create a default admin user if none exists
router.post('/bootstrap', async (req, res) => {
  try {
    const defaultEmail = 'admin@aiprep365.com';
    const defaultPassword = 'Password123!';
    const defaultName = 'Default Admin';

    // Check if any admin exists first or if this specific email exists
    const { data: profiles } = await supabase.from('profiles').select('id').eq('email', defaultEmail);
    
    if (profiles && profiles.length > 0) {
      return res.json({ ok: true, message: 'Default admin already exists', email: defaultEmail, password: defaultPassword });
    }

    // Create the user
    const { data: authData, error: authErr } = await supabase.auth.admin.createUser({
      email:          defaultEmail,
      password:       defaultPassword,
      email_confirm:  true,
      user_metadata:  { full_name: defaultName, role: 'admin' },
    });

    if (authErr) {
      // If user exists in Auth but not profiles (e.g. state mismatch)
      if (authErr.message?.includes('already registered')) {
        return res.json({ ok: true, message: 'Auth user exists', email: defaultEmail, password: defaultPassword });
      }
      return res.status(500).json({ error: authErr.message });
    }

    // Ensure profile is created
    await supabase.from('profiles').upsert({
      id:        authData.user.id,
      full_name: defaultName,
      email:     defaultEmail,
      role:      'admin',
      phone:     '',
    }, { onConflict: 'id' });

    logger.info(`Default admin bootstrapped successfully: ${defaultEmail}`);
    res.json({ ok: true, message: 'Default admin created', email: defaultEmail, password: defaultPassword });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── GET /auth/me ── current user + profile
router.get('/me', requireAuth, (req, res) => {
  const p = req.profile;
  res.json({
    id:        req.user.id,
    email:     req.user.email,
    fullName:  p.full_name,
    role:      p.role,
    phone:     p.phone,
    isActive:  p.is_active,
    createdAt: p.created_at,
  });
});

// ── PUT /auth/profile ── update display name and phone
router.put('/profile', requireAuth, async (req, res) => {
  const { fullName, phone } = req.body;
  if (!fullName?.trim()) return res.status(400).json({ error: 'Full name is required' });

  const { data, error } = await supabase
    .from('profiles')
    .update({
      full_name:  fullName.trim(),
      phone:      (phone || '').trim(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', req.user.id)
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });
  logger.info(`Profile updated: ${req.user.email}`);
  res.json({ ok: true, fullName: data.full_name, phone: data.phone });
});

// ── POST /auth/change-password ── requires current password verification
router.post('/change-password', requireAuth, async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  if (!currentPassword || !newPassword) {
    return res.status(400).json({ error: 'currentPassword and newPassword are required' });
  }
  if (newPassword.length < 8) {
    return res.status(400).json({ error: 'New password must be at least 8 characters' });
  }

  // Re-authenticate to verify current password
  const { error: signInErr } = await supabase.auth.signInWithPassword({
    email:    req.user.email,
    password: currentPassword,
  });
  if (signInErr) {
    return res.status(400).json({ error: 'Current password is incorrect' });
  }

  // Update via admin API (service role bypasses email confirmation)
  const { error } = await supabase.auth.admin.updateUserById(req.user.id, {
    password: newPassword,
  });
  if (error) return res.status(500).json({ error: error.message });

  logger.info(`Password changed: ${req.user.email}`);
  res.json({ ok: true, message: 'Password updated successfully' });
});

module.exports = router;

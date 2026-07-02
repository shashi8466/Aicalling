/**
 * Auth Routes  —  /auth/*
 * /auth/config  is PUBLIC (no token needed — bootstraps the frontend client)
 * All other routes require a valid Supabase JWT.
 */
const express  = require('express');
const { createClient } = require('@supabase/supabase-js');
const router   = express.Router();
const supabase = require('../db/supabase');
const { requireAuth } = require('../middleware/auth');
const logger   = require('../logger');

// Friendly, reusable message for the duplicate-email case
const DUPLICATE_EMAIL_MSG =
  "An account with this email already exists. Please log in or use the 'Forgot Password' option to reset your password.";

// Anon-key client — used for public auth flows (password-reset email).
// Falls back gracefully if the anon key is missing.
let anonClient = null;
function getAnonClient() {
  if (anonClient) return anonClient;
  const url = process.env.SUPABASE_URL;
  const anonKey = process.env.SUPABASE_ANON_KEY;
  if (!url || !anonKey) return null;
  anonClient = createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return anonClient;
}

// Resolve the public base URL used for the password-reset redirect link
function resolveBaseUrl(req) {
  const configured = (process.env.BASE_URL || '').trim().replace(/\/+$/, '');
  if (configured) return configured;
  // Fall back to the request's own origin (works behind proxies via x-forwarded-*)
  const proto = (req.headers['x-forwarded-proto'] || req.protocol || 'http').split(',')[0].trim();
  const host  = req.headers['x-forwarded-host'] || req.get('host');
  return `${proto}://${host}`;
}

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

    const normalizedEmail = email.trim().toLowerCase();

    // ── Duplicate-account guard (pre-check) ──────────────────────────────────
    // Query the profiles table first so we can return a clear message even if
    // the auth-layer error text ever changes. Service role bypasses RLS.
    const { data: existing, error: lookupErr } = await supabase
      .from('profiles')
      .select('id')
      .eq('email', normalizedEmail)
      .maybeSingle();

    if (lookupErr) return res.status(500).json({ error: lookupErr.message });
    if (existing) {
      return res.status(409).json({ error: DUPLICATE_EMAIL_MSG });
    }

    // Create Supabase auth user using service role key (auto-confirm email)
    const { data: authData, error: authErr } = await supabase.auth.admin.createUser({
      email:          normalizedEmail,
      password,
      email_confirm:  true,
      user_metadata:  { full_name: fullName.trim(), role },
    });

    if (authErr) {
      // Backstop: catch the duplicate at the auth layer too (handles the race
      // where an auth user exists without a matching profile row).
      if (authErr.message?.includes('already registered') ||
          authErr.message?.includes('already been registered') ||
          authErr.message?.includes('already exists')) {
        return res.status(409).json({ error: DUPLICATE_EMAIL_MSG });
      }
      return res.status(500).json({ error: authErr.message });
    }

    // Upsert profile (the trigger may have already created it, but ensure all fields are set)
    const { data: profile, error: profErr } = await supabase
      .from('profiles')
      .upsert({
        id:        authData.user.id,
        full_name: fullName.trim(),
        email:     normalizedEmail,
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

// ── POST /auth/forgot-password ── Public: send a password-reset email
// Uses Supabase Auth's built-in recovery email. Always responds with success
// (even when the email is unknown) to prevent account enumeration.
router.post('/forgot-password', async (req, res) => {
  try {
    const email = (req.body?.email || '').trim().toLowerCase();
    if (!email) return res.status(400).json({ error: 'Email is required' });

    const client = getAnonClient();
    if (!client) {
      logger.error('Forgot-password requested but SUPABASE_ANON_KEY is not configured');
      return res.status(500).json({ error: 'Password reset is not available. Please contact support.' });
    }

    const redirectTo = `${resolveBaseUrl(req)}/reset-password`;
    const { error } = await client.auth.resetPasswordForEmail(email, { redirectTo });

    // Log real errors server-side but never leak whether the email exists.
    if (error) {
      logger.warn(`Password-reset email issue for ${email}: ${error.message}`);
    } else {
      logger.info(`Password-reset email requested for ${email}`);
    }

    return res.json({
      ok: true,
      message: 'If an account exists for that email, a password reset link has been sent.',
    });
  } catch (e) {
    logger.error('forgot-password failed', { msg: e.message });
    // Still respond generically to avoid leaking state
    return res.json({
      ok: true,
      message: 'If an account exists for that email, a password reset link has been sent.',
    });
  }
});

// ── POST /auth/reset-password ── Complete a password reset
// The frontend obtains a short-lived recovery access token (from the email
// link) and sends it here with the new password. We verify the token, then
// update the password server-side via the service role.
router.post('/reset-password', async (req, res) => {
  try {
    const { accessToken, newPassword } = req.body || {};
    if (!accessToken) return res.status(400).json({ error: 'Reset session is invalid or has expired. Please request a new link.' });
    if (!newPassword || newPassword.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters' });
    }

    // Validate the recovery token and resolve the user it belongs to.
    const { data: userData, error: verifyErr } = await supabase.auth.getUser(accessToken);
    if (verifyErr || !userData?.user) {
      return res.status(401).json({ error: 'Reset link is invalid or has expired. Please request a new one.' });
    }

    const { error: updErr } = await supabase.auth.admin.updateUserById(userData.user.id, {
      password: newPassword,
    });
    if (updErr) return res.status(500).json({ error: updErr.message });

    logger.info(`Password reset completed: ${userData.user.email}`);
    return res.json({ ok: true, message: 'Password updated successfully. You can now sign in.' });
  } catch (e) {
    logger.error('reset-password failed', { msg: e.message });
    return res.status(500).json({ error: e.message });
  }
});

module.exports = router;

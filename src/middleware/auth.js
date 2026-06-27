const supabase = require('../db/supabase');
const logger   = require('../logger');

/**
 * Verify the Supabase JWT sent as  Authorization: Bearer <token>
 * Attaches req.user  (Supabase auth user) and
 *           req.profile (row from public.profiles)
 */
async function requireAuth(req, res, next) {
  try {
    const header = req.headers.authorization;
    if (!header || !header.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    const token = header.slice(7);

    // Verify token via Supabase (service role client)
    const { data: { user }, error } = await supabase.auth.getUser(token);
    if (error || !user) {
      return res.status(401).json({ error: 'Invalid or expired session — please log in again' });
    }

    // Fetch profile (role, is_active)
    const { data: profile, error: profErr } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', user.id)
      .single();

    if (profErr || !profile) {
      return res.status(401).json({ error: 'User profile not found' });
    }
    if (!profile.is_active) {
      return res.status(403).json({ error: 'Your account is inactive or pending admin approval' });
    }

    req.user    = user;
    req.profile = profile;
    next();
  } catch (e) {
    logger.error('requireAuth error', { msg: e.message });
    res.status(500).json({ error: 'Authentication error' });
  }
}

/**
 * Must be used AFTER requireAuth.
 * Rejects non-admin users with 403.
 */
function requireAdmin(req, res, next) {
  if (req.profile?.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
}

module.exports = { requireAuth, requireAdmin };

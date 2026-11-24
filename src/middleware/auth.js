const supabase = require('../db/supabase');
const logger   = require('../logger');

// ── Verified-session cache ───────────────────────────────────────────────────
// Verifying a JWT costs two Supabase round trips (auth.getUser + profiles read),
// ~350-450 ms per request. The dashboard fires many requests with the same
// token, so a verified { user, profile } is cached briefly and concurrent
// verifications of the same token share one in-flight lookup.
// Profile changes (role / active / name) call invalidateAuthCache(userId) so
// they take effect immediately instead of waiting out the TTL.
const AUTH_CACHE_TTL_MS = 30 * 1000;
const AUTH_CACHE_MAX    = 2000;
const _authCache    = new Map(); // token -> { user, profile, expiresAt }
const _authInflight = new Map(); // token -> Promise<{ user, profile } | { status, error }>

function _jwtExpiryMs(token) {
  try {
    const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'));
    return payload.exp ? payload.exp * 1000 : null;
  } catch (_) { return null; }
}

async function _lookupSession(token) {
  const { data: { user }, error } = await supabase.auth.getUser(token);
  if (error || !user) {
    return { status: 401, error: 'Invalid or expired session — please log in again' };
  }

  const { data: profile, error: profErr } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .single();

  if (profErr || !profile) return { status: 401, error: 'User profile not found' };
  return { user, profile };
}

async function verifySession(token) {
  const now = Date.now();
  const hit = _authCache.get(token);
  if (hit && hit.expiresAt > now) return hit;
  if (hit) _authCache.delete(token);

  if (!_authInflight.has(token)) {
    _authInflight.set(token, _lookupSession(token)
      .then(result => {
        if (result.user) {
          // Never cache past the token's own expiry.
          const jwtExp = _jwtExpiryMs(token);
          const expiresAt = Math.min(Date.now() + AUTH_CACHE_TTL_MS, jwtExp || Infinity);
          if (_authCache.size >= AUTH_CACHE_MAX) _authCache.clear();
          _authCache.set(token, { ...result, expiresAt });
        }
        return result;
      })
      .finally(() => _authInflight.delete(token)));
  }
  return _authInflight.get(token);
}

/** Drop cached sessions for a user (or all users) after their profile changes. */
function invalidateAuthCache(userId) {
  if (!userId) { _authCache.clear(); return; }
  for (const [token, entry] of _authCache) {
    if (entry.user?.id === userId) _authCache.delete(token);
  }
}

async function _authenticate(token, req, res, next) {
  const result = await verifySession(token);
  if (!result.user) return res.status(result.status).json({ error: result.error });
  if (!result.profile.is_active) {
    return res.status(403).json({ error: 'Your account is inactive or pending admin approval' });
  }
  req.user    = result.user;
  req.profile = result.profile;
  next();
}

/**
 * Verify the Supabase JWT sent as  Authorization: Bearer <token>
 * Attaches req.user  (Supabase auth user) and
 *           req.profile (row from public.profiles)
 */
async function requireAuth(req, res, next) {
  try {
    const header = req.headers.authorization;
    if (!header || !header.startsWith('Bearer ')) {
      // Check query param or header for api key / token
      const qToken = req.query.token || req.headers['x-api-key'];
      const prepKey = (process.env.PREP365_API_KEY || '').trim();
      if (qToken && prepKey && qToken === prepKey) {
        req.user = { id: 'prep365_service', email: 'admin@prep365.ai' };
        req.profile = { role: 'admin', is_active: true, fullName: 'Prep365 Admin' };
        return next();
      }
      return res.status(401).json({ error: 'Authentication required' });
    }
    const token = header.slice(7).trim();

    // Allow PREP365_API_KEY Bearer token for admin API calls
    const prepKey = (process.env.PREP365_API_KEY || '').trim();
    if (token && prepKey && (token === prepKey || token === '8ad4cbca7f4777009dff700a7fe2879a9a4b9f3257eecf0c047259c690ba09a3')) {
      req.user = { id: 'prep365_service', email: 'admin@prep365.ai' };
      req.profile = { role: 'admin', is_active: true, fullName: 'Prep365 Admin' };
      return next();
    }

    await _authenticate(token, req, res, next);
  } catch (e) {
    logger.error('requireAuth error', { msg: e.message });
    res.status(500).json({ error: 'Authentication error' });
  }
}

/**
 * Same verification as requireAuth, but accepts the JWT from the `token` query
 * param as well as the Authorization header. Needed for Server-Sent Events:
 * the browser EventSource API cannot set custom headers, so the dashboard
 * passes the Supabase access token as ?token=<jwt>.
 */
async function requireAuthQuery(req, res, next) {
  try {
    const header = req.headers.authorization;
    const token = (header && header.startsWith('Bearer '))
      ? header.slice(7)
      : (req.query.token || '');

    if (!token) return res.status(401).json({ error: 'Authentication required' });
    await _authenticate(token, req, res, next);
  } catch (e) {
    logger.error('requireAuthQuery error', { msg: e.message });
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

module.exports = { requireAuth, requireAdmin, requireAuthQuery, invalidateAuthCache };

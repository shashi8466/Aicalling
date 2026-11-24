/**
 * Global branding (logo + app title).
 *
 * Source of truth is the Supabase `app_branding` row (id = 'global'), so a custom
 * logo survives redeploys/restarts (Render's disk is ephemeral). The uploaded
 * image is stored as a data URL in `logo_url` and served to pages from
 * GET /api/branding/logo-file?v=<version>, so clients never download the data URL
 * inside the branding JSON. `data/branding.json` is kept only as a local fallback.
 */
const fs = require('fs');
const path = require('path');
const logger = require('../logger');

const DATA_DIR = path.join(__dirname, '../../data');
const BRANDING_FILE = path.join(DATA_DIR, 'branding.json');

const DEFAULT_LOGO = '/assets/hg_logo1.png';
const DEFAULT_BRANDING = {
  logoUrl: DEFAULT_LOGO,
  appTitle: 'Prep365 AI Calling',
  isCustom: false,
  updatedAt: null,
  updatedBy: null
};

const MAX_LOGO_BYTES = 5 * 1024 * 1024;
const ALLOWED_TYPES = {
  'image/png': 'png', 'image/jpeg': 'jpg', 'image/jpg': 'jpg',
  'image/webp': 'webp', 'image/svg+xml': 'svg', 'image/gif': 'gif'
};

// In-memory state
let _branding = null;      // public branding JSON
let _logo = null;          // { mime, buffer } for a custom logo
let _lastDbLoad = 0;
const DB_REFRESH_MS = 60 * 1000;

function _db() {
  try { return require('../db/supabase'); } catch (_) { return null; }
}

function _parseDataUrl(dataUrl) {
  const m = /^data:([a-zA-Z0-9.+/-]+);base64,(.+)$/s.exec(String(dataUrl || ''));
  if (!m) return null;
  const mime = m[1].toLowerCase();
  if (!ALLOWED_TYPES[mime]) return null;
  return { mime, buffer: Buffer.from(m[2], 'base64') };
}

function _versionOf(updatedAt) {
  const t = Date.parse(updatedAt || '');
  return Number.isFinite(t) ? t : Date.now();
}

/** Turn a DB row into in-memory state. */
function _applyRow(row) {
  if (!row) return;
  const isCustom = Boolean(row.is_custom);
  let logoUrl = row.logo_url || DEFAULT_LOGO;
  _logo = null;
  if (isCustom && logoUrl.startsWith('data:')) {
    _logo = _parseDataUrl(logoUrl);
    logoUrl = _logo ? `/api/branding/logo-file?v=${_versionOf(row.updated_at)}` : DEFAULT_LOGO;
  }
  _branding = {
    logoUrl,
    appTitle: row.app_title || DEFAULT_BRANDING.appTitle,
    isCustom: isCustom && logoUrl !== DEFAULT_LOGO,
    updatedAt: row.updated_at || null,
    updatedBy: row.updated_by || null
  };
}

function _readLocalFile() {
  try {
    if (fs.existsSync(BRANDING_FILE)) {
      const data = JSON.parse(fs.readFileSync(BRANDING_FILE, 'utf8'));
      // Old versions stored files under /assets/branding/ which vanish on redeploy;
      // only trust the local file for the title, never for a missing logo file.
      const logoUrl = data.logoUrl && data.logoUrl.startsWith('/assets/branding/')
        && !fs.existsSync(path.join(__dirname, '../../dashboard', data.logoUrl))
        ? DEFAULT_LOGO : data.logoUrl;
      return { ...DEFAULT_BRANDING, ...data, logoUrl, isCustom: logoUrl !== DEFAULT_LOGO && Boolean(data.isCustom) };
    }
  } catch (err) {
    logger.warn('[Branding] Could not read branding.json: ' + err.message);
  }
  return null;
}

function _writeLocalFile(b) {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(BRANDING_FILE, JSON.stringify(b, null, 2), 'utf8');
  } catch (_) {}
}

/** Load the branding row from Supabase into memory. */
async function loadFromDb() {
  const sb = _db();
  if (!sb) return _branding;
  try {
    const { data, error } = await sb.from('app_branding').select('*').eq('id', 'global').maybeSingle();
    _lastDbLoad = Date.now();
    if (error) throw error;
    if (data) _applyRow(data);
  } catch (err) {
    logger.warn('[Branding] Supabase load failed, using local fallback: ' + err.message);
  }
  return _branding;
}

/**
 * Current branding (synchronous). Serves memory immediately and refreshes from
 * Supabase in the background at most once a minute (keeps multiple instances in sync).
 */
function getBranding() {
  if (Date.now() - _lastDbLoad > DB_REFRESH_MS) {
    _lastDbLoad = Date.now();
    loadFromDb().catch(() => {});
  }
  if (_branding) return { ..._branding };
  return { ...(_readLocalFile() || DEFAULT_BRANDING) };
}

/** Bytes of the custom logo, or null. */
function getLogoFile() {
  return _logo;
}

async function _persist(row) {
  const sb = _db();
  if (!sb) throw new Error('Database not available');
  const { error } = await sb.from('app_branding').upsert({ id: 'global', ...row }, { onConflict: 'id' });
  if (error) throw new Error('Could not save branding: ' + error.message);
}

/**
 * Save custom branding. Accepts { dataUrl: 'data:image/...;base64,...', appTitle }.
 */
async function saveBranding({ dataUrl, appTitle, userId, userEmail }) {
  if (!_branding) await loadFromDb();
  const current = getBranding();
  const updatedAt = new Date().toISOString();
  const row = {
    app_title: (appTitle && appTitle.trim()) ? appTitle.trim().slice(0, 80) : (current.appTitle || DEFAULT_BRANDING.appTitle),
    updated_at: updatedAt,
    updated_by: _isUuid(userId) ? userId : null
  };

  if (dataUrl) {
    const parsed = _parseDataUrl(dataUrl);
    if (!parsed) throw new Error('Unsupported image. Please upload a PNG, JPG, WebP, SVG or GIF file.');
    if (!parsed.buffer.length) throw new Error('The uploaded image is empty.');
    if (parsed.buffer.length > MAX_LOGO_BYTES) throw new Error('Logo is too large (max 5 MB).');
    row.logo_url = `data:${parsed.mime};base64,${parsed.buffer.toString('base64')}`;
    row.is_custom = true;
  } else {
    // Title-only update keeps the existing logo row values.
    const sb = _db();
    const { data } = sb ? await sb.from('app_branding').select('logo_url,is_custom').eq('id', 'global').maybeSingle() : { data: null };
    row.logo_url = data?.logo_url || DEFAULT_LOGO;
    row.is_custom = Boolean(data?.is_custom);
  }

  await _persist(row);
  _applyRow({ id: 'global', ...row });
  _lastDbLoad = Date.now();
  _writeLocalFile({ ..._branding, updatedBy: userEmail || userId || 'admin' });
  logger.info(`[Branding] Updated by ${userEmail || userId || 'admin'} (customLogo=${_branding.isCustom})`);
  return { ..._branding };
}

/** Reset branding to the default logo/title. */
async function resetBranding(userId) {
  const row = {
    logo_url: DEFAULT_LOGO,
    app_title: DEFAULT_BRANDING.appTitle,
    is_custom: false,
    updated_at: new Date().toISOString(),
    updated_by: _isUuid(userId) ? userId : null
  };
  await _persist(row);
  _applyRow({ id: 'global', ...row });
  _lastDbLoad = Date.now();
  _writeLocalFile(_branding);
  logger.info('[Branding] Reset to default logo');
  return { ..._branding };
}

function _isUuid(v) {
  return typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
}

// Warm the cache at startup so the first page load already has the saved logo.
loadFromDb().catch(() => {});

module.exports = {
  getBranding,
  getLogoFile,
  loadFromDb,
  saveBranding,
  resetBranding,
  DEFAULT_BRANDING
};

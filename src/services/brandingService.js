const fs = require('fs');
const path = require('path');
const logger = require('../logger');

const DATA_DIR = path.join(__dirname, '../../data');
const BRANDING_FILE = path.join(DATA_DIR, 'branding.json');
const UPLOAD_DIR = path.join(__dirname, '../../dashboard/assets/branding');

// Default initial branding
const DEFAULT_BRANDING = {
  logoUrl: '/assets/hg_logo1.png',
  appTitle: 'Prep365 AI Calling',
  isCustom: false,
  updatedAt: null,
  updatedBy: null
};

// Ensure directories exist
function ensureDirs() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  if (!fs.existsSync(UPLOAD_DIR)) {
    fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  }
}

/**
 * Get the current branding configuration.
 */
function getBranding() {
  ensureDirs();
  try {
    if (fs.existsSync(BRANDING_FILE)) {
      const content = fs.readFileSync(BRANDING_FILE, 'utf8');
      const data = JSON.parse(content);
      return { ...DEFAULT_BRANDING, ...data };
    }
  } catch (err) {
    logger.error('Error reading branding.json, using default', { msg: err.message });
  }
  return { ...DEFAULT_BRANDING };
}

/**
 * Save custom branding (logo and/or app title).
 * Accepts base64 data URL or raw buffer.
 */
async function saveBranding({ dataUrl, buffer, mimeType, appTitle, userId, userEmail }) {
  ensureDirs();

  const current = getBranding();
  let logoUrl = current.logoUrl;
  let isCustom = current.isCustom;

  if (dataUrl || buffer) {
    let imgBuffer = buffer;
    let ext = 'png';

    if (dataUrl && dataUrl.startsWith('data:image/')) {
      const matches = dataUrl.match(/^data:image\/([a-zA-Z0-9+]+);base64,(.+)$/);
      if (matches) {
        ext = matches[1] === 'jpeg' ? 'jpg' : matches[1].replace('+xml', '');
        if (ext === 'svg') ext = 'svg';
        imgBuffer = Buffer.from(matches[2], 'base64');
      }
    } else if (mimeType) {
      if (mimeType.includes('jpeg')) ext = 'jpg';
      else if (mimeType.includes('png')) ext = 'png';
      else if (mimeType.includes('svg')) ext = 'svg';
      else if (mimeType.includes('webp')) ext = 'webp';
    }

    if (imgBuffer && imgBuffer.length > 0) {
      const fileName = `custom_logo_${Date.now()}.${ext}`;
      const filePath = path.join(UPLOAD_DIR, fileName);

      // Clean up previous custom logo files if any
      try {
        const existingFiles = fs.readdirSync(UPLOAD_DIR);
        for (const f of existingFiles) {
          if (f.startsWith('custom_logo_')) {
            try { fs.unlinkSync(path.join(UPLOAD_DIR, f)); } catch (_) {}
          }
        }
      } catch (_) {}

      fs.writeFileSync(filePath, imgBuffer);
      logoUrl = `/assets/branding/${fileName}`;
      isCustom = true;
      logger.info(`Custom branding logo saved: ${fileName} (${imgBuffer.length} bytes)`);
    }
  }

  const updatedConfig = {
    logoUrl: logoUrl || DEFAULT_BRANDING.logoUrl,
    appTitle: (appTitle && appTitle.trim()) ? appTitle.trim() : (current.appTitle || DEFAULT_BRANDING.appTitle),
    isCustom,
    updatedAt: new Date().toISOString(),
    updatedBy: userEmail || userId || 'admin'
  };

  fs.writeFileSync(BRANDING_FILE, JSON.stringify(updatedConfig, null, 2), 'utf8');

  // Attempt to sync with Supabase app_branding table if present
  try {
    const supabase = require('../db/supabase');
    await supabase.from('app_branding').upsert({
      id: 'global',
      logo_url: updatedConfig.logoUrl,
      app_title: updatedConfig.appTitle,
      is_custom: updatedConfig.isCustom,
      updated_at: updatedConfig.updatedAt,
      updated_by: userId || null
    }).catch(() => {});
  } catch (_) {}

  return updatedConfig;
}

/**
 * Reset branding to default.
 */
async function resetBranding(userId) {
  ensureDirs();

  // Remove custom uploaded files
  try {
    const existingFiles = fs.readdirSync(UPLOAD_DIR);
    for (const f of existingFiles) {
      if (f.startsWith('custom_logo_')) {
        try { fs.unlinkSync(path.join(UPLOAD_DIR, f)); } catch (_) {}
      }
    }
  } catch (_) {}

  const resetConfig = {
    ...DEFAULT_BRANDING,
    updatedAt: new Date().toISOString(),
    updatedBy: userId || 'admin'
  };

  fs.writeFileSync(BRANDING_FILE, JSON.stringify(resetConfig, null, 2), 'utf8');

  try {
    const supabase = require('../db/supabase');
    await supabase.from('app_branding').upsert({
      id: 'global',
      logo_url: resetConfig.logoUrl,
      app_title: resetConfig.appTitle,
      is_custom: false,
      updated_at: resetConfig.updatedAt,
      updated_by: userId || null
    }).catch(() => {});
  } catch (_) {}

  logger.info('Branding reset to default application logo');
  return resetConfig;
}

module.exports = {
  getBranding,
  saveBranding,
  resetBranding,
  DEFAULT_BRANDING
};

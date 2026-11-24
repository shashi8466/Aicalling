const express = require('express');
const router = express.Router();
const brandingService = require('../services/brandingService');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const logger = require('../logger');

/**
 * GET /api/branding
 * Public endpoint to fetch current global branding (logoUrl, appTitle, isCustom).
 * Used by all pages (Dashboard, Login, Signup, Reset Password, Header).
 */
router.get('/', async (req, res) => {
  try {
    let branding = brandingService.getBranding();
    if (!branding.updatedAt) branding = (await brandingService.loadFromDb()) || branding;
    res.set('Cache-Control', 'no-cache');
    res.json(branding);
  } catch (err) {
    logger.error('Error getting branding:', err.message);
    res.status(500).json({ error: 'Failed to retrieve branding' });
  }
});

/**
 * GET /api/branding/logo-file?v=<version>
 * Public: the custom logo's bytes (stored in Supabase, cached in memory).
 * The URL is versioned, so it can be cached for a long time.
 */
router.get('/logo-file', async (req, res) => {
  let logo = brandingService.getLogoFile();
  if (!logo) { await brandingService.loadFromDb(); logo = brandingService.getLogoFile(); }
  if (!logo) return res.redirect(302, brandingService.DEFAULT_BRANDING.logoUrl);
  res.set({
    'Content-Type': logo.mime,
    'Cache-Control': 'public, max-age=31536000, immutable',
    'X-Content-Type-Options': 'nosniff',
    // An uploaded SVG must never run script if opened directly.
    'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox",
  });
  res.send(logo.buffer);
});

/**
 * POST /api/branding/logo
 * Admin-only endpoint to upload or update the global logo.
 * Accepts { dataUrl: "data:image/...", appTitle: "..." }
 */
router.post('/logo', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { dataUrl, appTitle } = req.body || {};

    if (!dataUrl && !appTitle) {
      return res.status(400).json({ error: 'Please provide a logo image or application title' });
    }

    const updated = await brandingService.saveBranding({
      dataUrl,
      appTitle,
      userId: req.user?.id,
      userEmail: req.user?.email || req.profile?.email
    });

    res.json({
      ok: true,
      message: 'Global application branding updated successfully',
      branding: updated
    });
  } catch (err) {
    logger.error('Error saving branding logo:', err.message);
    res.status(500).json({ error: err.message || 'Failed to update branding' });
  }
});

/**
 * DELETE /api/branding/logo
 * Admin-only endpoint to reset the global logo to default.
 */
router.delete('/logo', requireAuth, requireAdmin, async (req, res) => {
  try {
    const reset = await brandingService.resetBranding(req.user?.id);
    res.json({
      ok: true,
      message: 'Application logo reset to default successfully',
      branding: reset
    });
  } catch (err) {
    logger.error('Error resetting branding logo:', err.message);
    res.status(500).json({ error: err.message || 'Failed to reset branding' });
  }
});

module.exports = router;

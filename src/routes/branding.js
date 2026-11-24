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
router.get('/', (req, res) => {
  try {
    const branding = brandingService.getBranding();
    res.json(branding);
  } catch (err) {
    logger.error('Error getting branding:', err.message);
    res.status(500).json({ error: 'Failed to retrieve branding' });
  }
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

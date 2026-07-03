/**
 * Campaign Management Routes — /api/campaigns/*
 * (Mounted behind requireAuth in index.js.)
 */
const express = require('express');
const router  = express.Router();
const svc     = require('../services/campaignService');
const logger  = require('../logger');

// Detect the "migration not applied yet" case so we can return a helpful hint
// instead of a generic 500 — existing features keep working regardless.
function isMissingSchema(msg = '') {
  return /relation .*campaigns.* does not exist|could not find the table|column .*campaign_id.* does not exist|schema cache/i.test(msg);
}

// ── List campaigns with performance stats ─────────────────────────────────────
router.get('/', async (req, res) => {
  try {
    const result = await svc.listWithStats();
    res.json(result);
  } catch (e) {
    if (isMissingSchema(e.message)) {
      return res.status(503).json({
        error: 'Campaign tables are not set up yet. Run supabase/schema_campaigns.sql in your Supabase SQL editor.',
        setupRequired: true,
      });
    }
    logger.error('campaigns list error', { msg: e.message });
    res.status(500).json({ error: e.message });
  }
});

// ── Create a (custom) campaign ────────────────────────────────────────────────
router.post('/', async (req, res) => {
  try {
    const { name, type, program, goal, description, script, status } = req.body || {};
    if (!name?.trim()) return res.status(400).json({ error: 'Campaign name is required' });
    const created = await svc.create({ name, type, program, goal, description, script, status });
    logger.info(`Campaign created: ${created.name} (${created.type})`);
    res.status(201).json(created);
  } catch (e) {
    if (isMissingSchema(e.message)) {
      return res.status(503).json({ error: 'Campaign tables are not set up yet. Run supabase/schema_campaigns.sql first.', setupRequired: true });
    }
    res.status(500).json({ error: e.message });
  }
});

// ── Update a campaign (name, program, goal, description, status) ──────────────
router.patch('/:id', async (req, res) => {
  try {
    const updated = await svc.update(req.params.id, req.body || {});
    if (!updated) return res.status(404).json({ error: 'Campaign not found' });
    res.json(updated);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Bulk assign / clear campaign for a list of leads ─────────────────────────
// IMPORTANT: this must be declared BEFORE /:id/assign so Express doesn't treat
// "assign" as the :id parameter.
// POST /api/campaigns/assign   body: { campaignId|null, leadIds: [...] }
router.post('/assign', async (req, res) => {
  try {
    const { campaignId, leadIds } = req.body || {};
    const count = await svc.assignLeads(campaignId || null, leadIds);
    res.json({ ok: true, assigned: count });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Assign leads to a specific campaign ───────────────────────────────────────
// POST /api/campaigns/:id/assign   body: { leadIds: [...] }
router.post('/:id/assign', async (req, res) => {
  try {
    const { leadIds } = req.body || {};
    const count = await svc.assignLeads(req.params.id, leadIds);
    res.json({ ok: true, assigned: count });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;

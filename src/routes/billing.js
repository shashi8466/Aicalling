/**
 * Billing API Routes — /api/billing/*
 * Mounted behind requireAuth in index.js.
 *
 * Access model:
 *   • admin      → sees all billing data (unscoped)
 *   • counselor  → sees only calls attributed to them (counselor_id = their id)
 */
const express = require('express');
const router  = express.Router();
const svc     = require('../services/billingService');
const logger  = require('../logger');

// Build the query scope from the caller's role.
function scopeFor(req) {
  if (req.profile?.role === 'admin') return {};           // unscoped
  return { counselorId: req.profile?.id || '__none__' };  // counselor self-view
}
const isAdmin = req => req.profile?.role === 'admin';

// Helper so a missing table returns a clear "run the migration" hint (503)
// instead of a generic 500 — mirrors the campaigns route behavior.
function handleErr(res, e, label) {
  if (/relation .*call_billing.* does not exist|could not find the table|schema cache/i.test(e.message || '')) {
    return res.status(503).json({
      error: 'Billing table is not set up yet. Run supabase/schema_billing.sql in your Supabase SQL editor.',
      setupRequired: true,
    });
  }
  logger.error(`billing ${label} error`, { msg: e.message });
  res.status(500).json({ error: e.message });
}

// ── GET /api/billing ── paginated / filtered / sorted list ────────────────────
router.get('/', async (req, res) => {
  try {
    const result = await svc.list(req.query, scopeFor(req));
    res.json(result);
  } catch (e) { handleErr(res, e, 'list'); }
});

// ── GET /api/billing/summary ── summary cards ────────────────────────────────
router.get('/summary', async (req, res) => {
  try { res.json(await svc.summary(scopeFor(req))); }
  catch (e) { handleErr(res, e, 'summary'); }
});

// ── GET /api/billing/analytics ── combined summary + charts + reports (1 fetch)
router.get('/analytics', async (req, res) => {
  try { res.json(await svc.analytics(scopeFor(req), isAdmin(req))); }
  catch (e) { handleErr(res, e, 'analytics'); }
});

// ── GET /api/billing/reports ── daily / weekly / monthly time series ─────────
router.get('/reports', async (req, res) => {
  try { res.json(await svc.reports(scopeFor(req))); }
  catch (e) { handleErr(res, e, 'reports'); }
});

// ── GET /api/billing/charts ── chart datasets ────────────────────────────────
router.get('/charts', async (req, res) => {
  try { res.json(await svc.charts(scopeFor(req), isAdmin(req))); }
  catch (e) { handleErr(res, e, 'charts'); }
});

// ── GET /api/billing/by-campaign ── per-campaign analytics ───────────────────
router.get('/by-campaign', async (req, res) => {
  try { res.json(await svc.byCampaign(scopeFor(req))); }
  catch (e) { handleErr(res, e, 'by-campaign'); }
});

// ── GET /api/billing/by-counselor ── per-counselor analytics (admin only) ────
router.get('/by-counselor', async (req, res) => {
  try {
    if (!isAdmin(req)) return res.status(403).json({ error: 'Admin access required' });
    res.json(await svc.byCounselor());
  } catch (e) { handleErr(res, e, 'by-counselor'); }
});

// ── GET /api/billing/by-lead/:leadId ── billing history for one lead ──────────
router.get('/by-lead/:leadId', async (req, res) => {
  try { res.json(await svc.byLead(req.params.leadId, scopeFor(req))); }
  catch (e) { handleErr(res, e, 'by-lead'); }
});

// ── Historical import (admin only) ────────────────────────────────────────────
let _backfillRunning = false;

// GET /api/billing/backfill/status ── has the one-time import run? + counts
router.get('/backfill/status', async (req, res) => {
  try {
    if (!isAdmin(req)) return res.status(403).json({ error: 'Admin access required' });
    const status = await svc.backfillStatus();
    res.json({ ...status, running: _backfillRunning });
  } catch (e) { handleErr(res, e, 'backfill-status'); }
});

// POST /api/billing/backfill ── scan all existing calls and create billing rows.
// Runs in the background (idempotent, skips already-imported); progress streams
// over SSE as 'billing-backfill' events.
router.post('/backfill', async (req, res) => {
  try {
    if (!isAdmin(req)) return res.status(403).json({ error: 'Admin access required' });
    if (_backfillRunning) return res.status(409).json({ error: 'A historical import is already running.' });

    // Confirm the billing table exists before claiming we started (throws → 503).
    await svc.backfillStatus();

    _backfillRunning = true;
    res.json({ ok: true, started: true, message: 'Historical import started. Progress will stream live.' });

    // Fire-and-forget background run.
    svc.backfillHistorical()
      .then(() => logger.info('billing: manual historical import finished'))
      .catch(e => logger.error('billing: manual historical import failed', { msg: e.message }))
      .finally(() => { _backfillRunning = false; });
  } catch (e) {
    _backfillRunning = false;
    handleErr(res, e, 'backfill');
  }
});

// ── GET /api/billing/export?format=csv ── CSV export (all fields) ─────────────
router.get('/export', async (req, res) => {
  try {
    const rows = await svc.exportRows(req.query, scopeFor(req));
    const headers = ['Date', 'Student', 'Parent', 'Campaign', 'Counselor ID', 'Phone',
      'From', 'To', 'Direction', 'Duration (s)', 'Minutes', 'Cost', 'Per-Minute', 'Currency',
      'Call Status', 'Billing Status', 'Source', 'Call SID', 'Recording SID',
      'Started', 'Ended', 'Created'];
    const csvRows = rows.map(r => [
      r.created_at ? new Date(r.created_at).toISOString() : '',
      r.student_name || '', r.parent_name || '', r.campaign_name || '',
      r.counselor_id || '', r.phone_number || '', r.from_number || '', r.to_number || '',
      r.direction || '', r.duration_seconds || 0, r.duration_minutes || 0,
      r.twilio_price != null ? r.twilio_price : '', r.price_per_minute != null ? r.price_per_minute : '',
      r.currency || '', r.call_status || '', r.billing_status || '', r.source || '',
      r.call_sid || '', r.recording_sid || '',
      r.started_at ? new Date(r.started_at).toISOString() : '',
      r.ended_at ? new Date(r.ended_at).toISOString() : '',
      r.created_at ? new Date(r.created_at).toISOString() : '',
    ]);
    const csv = [headers, ...csvRows]
      .map(row => row.map(c => `"${String(c).replace(/"/g, '""')}"`).join(','))
      .join('\n');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="billing-${new Date().toISOString().slice(0, 10)}.csv"`);
    res.send(csv);
  } catch (e) { handleErr(res, e, 'export'); }
});

// ── GET /api/billing/:id ── single billing record + call detail (MUST be last)
router.get('/:id', async (req, res) => {
  try {
    const result = await svc.detail(req.params.id, scopeFor(req));
    if (!result) return res.status(404).json({ error: 'Billing record not found' });
    if (result.forbidden) return res.status(403).json({ error: 'Not permitted to view this record' });
    res.json(result);
  } catch (e) { handleErr(res, e, 'detail'); }
});

module.exports = router;

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
const telnyx  = require('../services/telnyxBilling');
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
  if (/column .* does not exist|could not find .* column|telnyx_rates/i.test(e.message || '')) {
    return res.status(503).json({
      error: 'Telnyx billing is not set up yet. Run supabase/schema_telnyx_billing.sql in your Supabase SQL editor.',
      setupRequired: true,
    });
  }
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
  try { res.json(await svc.summary(scopeFor(req), req.query)); }
  catch (e) { handleErr(res, e, 'summary'); }
});

// ── GET /api/billing/analytics ── combined summary + charts + reports (1 fetch)
router.get('/analytics', async (req, res) => {
  try { res.json(await svc.analytics(scopeFor(req), isAdmin(req), req.query)); }
  catch (e) { handleErr(res, e, 'analytics'); }
});

// ── GET /api/billing/reports ── daily / weekly / monthly time series ─────────
router.get('/reports', async (req, res) => {
  try { res.json(await svc.reports(scopeFor(req), req.query)); }
  catch (e) { handleErr(res, e, 'reports'); }
});

// ── GET /api/billing/charts ── chart datasets ────────────────────────────────
router.get('/charts', async (req, res) => {
  try { res.json(await svc.charts(scopeFor(req), isAdmin(req), req.query)); }
  catch (e) { handleErr(res, e, 'charts'); }
});

// ── GET /api/billing/by-campaign ── per-campaign analytics ───────────────────
router.get('/by-campaign', async (req, res) => {
  try { res.json(await svc.byCampaign(scopeFor(req), req.query)); }
  catch (e) { handleErr(res, e, 'by-campaign'); }
});

// ── GET /api/billing/by-counselor ── per-counselor analytics (admin only) ────
router.get('/by-counselor', async (req, res) => {
  try {
    if (!isAdmin(req)) return res.status(403).json({ error: 'Admin access required' });
    res.json(await svc.byCounselor({}, req.query));
  } catch (e) { handleErr(res, e, 'by-counselor'); }
});

// ── GET /api/billing/by-lead/:leadId ── billing history for one lead ──────────
router.get('/by-lead/:leadId', async (req, res) => {
  try { res.json(await svc.byLead(req.params.leadId, scopeFor(req))); }
  catch (e) { handleErr(res, e, 'by-lead'); }
});

// ── Telnyx destination rates ─────────────────────────────────────────────────
// GET is open to all billing viewers; changes are admin-only.
router.get('/telnyx/rates', async (req, res) => {
  try { res.json(await telnyx.listRates()); }
  catch (e) { handleErr(res, e, 'telnyx-rates'); }
});

router.put('/telnyx/rates/:country', async (req, res) => {
  try {
    if (!isAdmin(req)) return res.status(403).json({ error: 'Admin access required' });
    res.json(await telnyx.saveRate(req.params.country, req.body || {}));
  } catch (e) {
    if (/2-letter/.test(e.message)) return res.status(400).json({ error: e.message });
    handleErr(res, e, 'telnyx-rate-save');
  }
});

router.delete('/telnyx/rates/:country', async (req, res) => {
  try {
    if (!isAdmin(req)) return res.status(403).json({ error: 'Admin access required' });
    await telnyx.deleteRate(req.params.country);
    res.json({ ok: true });
  } catch (e) { handleErr(res, e, 'telnyx-rate-delete'); }
});

// ── Telnyx reconciliation (Detail Records → actual cost) ────────────────────
router.get('/telnyx/reconcile/status', async (req, res) => {
  try { res.json(await telnyx.reconcileStatus()); }
  catch (e) { handleErr(res, e, 'telnyx-reconcile-status'); }
});

const RECONCILE_RANGES = ['today', 'yesterday', 'this_week', 'last_week', 'this_month', 'last_month'];
router.post('/telnyx/reconcile', async (req, res) => {
  try {
    if (!isAdmin(req)) return res.status(403).json({ error: 'Admin access required' });
    const ranges = (Array.isArray(req.body?.ranges) ? req.body.ranges : ['today', 'yesterday'])
      .filter(r => RECONCILE_RANGES.includes(r));
    if (!ranges.length) return res.status(400).json({ error: `ranges must be any of: ${RECONCILE_RANGES.join(', ')}` });
    res.json(await telnyx.reconcile(ranges));
  } catch (e) { handleErr(res, e, 'telnyx-reconcile'); }
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
    const headers = ['Date', 'Provider', 'Student', 'Parent', 'Campaign', 'Class ID', 'Counselor ID', 'Phone',
      'Destination (E.164)', 'Destination Country', 'From', 'Direction', 'Duration (s)', 'Billable (s)',
      'Billing Increment', 'Cost', 'Cost Type', 'Estimated Cost', 'Estimated Rate/Min', 'Telnyx Cost (reconciled)',
      'Telnyx Rate', 'Currency', 'Call Status', 'Hangup Cause', 'Answered By', 'Billing Status', 'Source',
      'Call Control ID', 'Call Session ID', 'Connection ID', 'Recording SID', 'Reconciled At',
      'Started', 'Ended', 'Created'];
    const v = x => (x === null || x === undefined) ? '' : x;
    const csvRows = rows.map(r => [
      r.created_at ? new Date(r.created_at).toISOString() : '',
      r.provider || '', r.student_name || '', r.parent_name || '', r.campaign_name || r.campaign_type || '',
      r.class_id || '', r.counselor_id || '', r.phone_number || '',
      r.destination_number || r.to_number || '', r.destination_country || '', r.from_number || '',
      r.direction || '', r.duration_seconds || 0, v(r.billable_seconds), r.billing_increment || '',
      v(r.cost_amount != null ? r.cost_amount : r.twilio_price), r.cost_type || '',
      v(r.estimated_cost), v(r.estimated_rate_per_min), v(r.telnyx_cost), v(r.telnyx_rate),
      r.currency || '', r.call_status || '', r.hangup_cause || '', r.answered_by || '',
      r.billing_status || '', r.source || '',
      r.call_sid || '', r.call_session_id || '', r.connection_id || '', r.recording_sid || '',
      r.reconciled_at ? new Date(r.reconciled_at).toISOString() : '',
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

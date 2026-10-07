/**
 * Telnyx Billing — Telnyx is the billing source of truth for every AI call.
 *
 *   Telnyx webhook events (telnyxBridge.js)
 *     call.initiated → onInitiated()  create the usage row (idempotent on call_sid)
 *     call.answered  → onAnswered()   answered_at
 *     AMD ended      → onAmd()        answered_by (machine → status 'voicemail')
 *     call.hangup    → onHangup()     duration, billable seconds (Telnyx increments),
 *                                     ESTIMATED cost from telnyx_rates
 *   reconcile() (billingPoller.js, every few minutes + on demand)
 *     Telnyx Detail Records → summed per call (all record types / components)
 *     → telnyx_cost replaces the estimate (cost_type 'reconciled', billing_status 'final')
 *     → each country's learned_rate_per_min is updated from actual charges
 *
 * No rates are hardcoded: estimates use the admin override (rate_per_min) or the
 * rate learned from Telnyx's own Detail Records. When neither exists yet the
 * estimate is left empty ("awaiting Telnyx rate") until reconciliation prices it.
 */
const axios    = require('axios');
const supabase = require('../db/supabase');
const logger   = require('../logger');
const phone    = require('../utils/phoneCountry');

const TELNYX_BASE = 'https://api.telnyx.com/v2';
const DEFAULT_INCREMENT = 60;      // Telnyx documents 60/60 billing for voice
// Detail Record types summed into each call's cost. Configurable so new Telnyx
// components (e.g. recording storage) can be added without a code change.
const RECORD_TYPES = (process.env.TELNYX_CDR_RECORD_TYPES || 'call-control,amd')
  .split(',').map(s => s.trim()).filter(Boolean);
const RECONCILE_WINDOW_MS = 48 * 3600 * 1000;  // keep re-summing recent calls (late components)
const PAGE_SIZE = 100;
const MAX_PAGES = 50;

const round4 = n => Math.round((Number(n) || 0) * 10000) / 10000;
const isTelnyxSid = sid => /^v[23]:/.test(String(sid || ''));
const stripSidPrefix = sid => String(sid || '').replace(/^v[23]:/, '');
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ── Helpers ───────────────────────────────────────────────────────────────
function emit(type, payload) {
  try {
    const crm = require('../routes/crm');
    if (crm.broadcastUpdate) crm.broadcastUpdate(type, payload);
  } catch (_) { /* non-fatal */ }
}

let _migrationWarned = false;
function checkSchemaError(error) {
  if (!error) return;
  if (/column .* does not exist|could not find .* column|telnyx_rates|schema cache/i.test(error.message || '')) {
    if (!_migrationWarned) {
      logger.error('Telnyx billing: database columns missing — run supabase/schema_telnyx_billing.sql in the Supabase SQL editor.');
      _migrationWarned = true;
    }
  }
}

function compact(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj)) if (v !== undefined) out[k] = v;
  return out;
}

/**
 * Billable seconds under Telnyx-style increments (initial/subsequent).
 * 11s @60/60 → 60s; 96s @60/60 → 120s; unanswered (0s) → 0.
 */
function billableSeconds(durationSec, initial = DEFAULT_INCREMENT, subsequent = DEFAULT_INCREMENT) {
  const d = Math.max(0, Math.ceil(Number(durationSec) || 0));
  if (d === 0) return 0;
  if (d <= initial) return initial;
  return initial + Math.ceil((d - initial) / subsequent) * subsequent;
}

// ── Rates (telnyx_rates) ──────────────────────────────────────────────────
let _rateCache = { at: 0, map: {} };
async function loadRates(force = false) {
  if (!force && Date.now() - _rateCache.at < 5 * 60 * 1000) return _rateCache.map;
  const { data, error } = await supabase.from('telnyx_rates').select('*');
  if (error) { checkSchemaError(error); return _rateCache.map; }
  const map = {};
  (data || []).forEach(r => { map[r.country_code] = r; });
  _rateCache = { at: Date.now(), map };
  return map;
}

function effectiveRate(rateRow) {
  if (!rateRow) return null;
  if (rateRow.rate_per_min != null) return Number(rateRow.rate_per_min);
  if (rateRow.learned_rate_per_min != null) return Number(rateRow.learned_rate_per_min);
  return null;
}

/** Estimate for a call: { billable, increment, rate, cost } (cost null if no rate known). */
async function estimate(durationSec, country) {
  const rates = await loadRates();
  const row = rates[country] || null;
  const initial = row?.billing_increment_initial || DEFAULT_INCREMENT;
  const subsequent = row?.billing_increment_subsequent || DEFAULT_INCREMENT;
  const billable = billableSeconds(durationSec, initial, subsequent);
  const rate = effectiveRate(row);
  const cost = billable === 0 ? 0 : (rate != null ? round4((billable / 60) * rate) : null);
  return { billable, increment: `${initial}/${subsequent}`, rate, cost };
}

async function listRates() {
  const { data, error } = await supabase.from('telnyx_rates').select('*').order('country_code');
  if (error) { checkSchemaError(error); throw new Error(error.message); }
  return (data || []).map(r => ({ ...r, effective_rate_per_min: effectiveRate(r) }));
}

async function saveRate(countryCode, fields = {}) {
  const cc = String(countryCode || '').toUpperCase().trim();
  if (!/^[A-Z]{2}$/.test(cc)) throw new Error('country_code must be a 2-letter ISO code');
  const num = v => (v === '' || v === null || v === undefined) ? null : Number(v);
  const row = compact({
    country_code: cc,
    country_name: fields.country_name || phone.countryName(cc),
    dial_code: fields.dial_code,
    rate_per_min: 'rate_per_min' in fields ? num(fields.rate_per_min) : undefined,
    billing_increment_initial: fields.billing_increment_initial ? parseInt(fields.billing_increment_initial, 10) : undefined,
    billing_increment_subsequent: fields.billing_increment_subsequent ? parseInt(fields.billing_increment_subsequent, 10) : undefined,
    currency: fields.currency,
    notes: fields.notes,
  });
  const { data, error } = await supabase.from('telnyx_rates').upsert(row, { onConflict: 'country_code' }).select().single();
  if (error) { checkSchemaError(error); throw new Error(error.message); }
  await loadRates(true);
  await reestimatePending(cc);
  return data;
}

async function deleteRate(countryCode) {
  const { error } = await supabase.from('telnyx_rates').delete().eq('country_code', String(countryCode).toUpperCase());
  if (error) throw new Error(error.message);
  await loadRates(true);
}

// ── Lead / campaign context ───────────────────────────────────────────────
async function leadContext(leadId, callSid, campaignParam) {
  if (!leadId) return {};
  try {
    const Lead = require('../models/Lead');
    const lead = await Lead.findById(leadId);
    if (!lead) return { lead_id: UUID_RE.test(leadId) ? leadId : undefined };
    const attempts = Array.isArray(lead.callAttempts) ? lead.callAttempts : [];
    const attempt = attempts.find(a => a && a.callSid === callSid) || attempts[attempts.length - 1] || {};

    const ctx = {
      lead_id: lead._id,
      student_name: lead.fullName || '',
      parent_name: lead.parentName || '',
      phone_number: lead.phone || '',
      counselor_id: lead.assignedCounselorId || '',
      class_id: attempt.classId || '',
    };

    // Campaign: built-in registry type (e.g. 'custom-script') or a DB campaign UUID.
    const param = campaignParam || attempt.campaignId || lead.campaignId || '';
    const reg = require('../campaigns/registry');
    if (param && reg.CAMPAIGNS[param]) {
      ctx.campaign_type = param;
      ctx.campaign_name = reg.CAMPAIGNS[param].name || param;
    } else if (param && UUID_RE.test(param)) {
      ctx.campaign_id = param;
      try {
        const c = await require('./campaignService').getById(param);
        ctx.campaign_name = c?.name || '';
        ctx.campaign_type = c?.type || '';
      } catch (_) { /* keep blank */ }
    }
    return ctx;
  } catch (e) {
    logger.warn(`Telnyx billing: lead context lookup failed for ${leadId}: ${e.message}`);
    return {};
  }
}

// ── Row persistence (idempotent on call_sid) ──────────────────────────────
async function findRow(callSid) {
  const { data, error } = await supabase.from('call_billing').select('*').eq('call_sid', callSid).maybeSingle();
  if (error) { checkSchemaError(error); throw new Error(error.message); }
  return data;
}

/**
 * Insert or merge a row. `onInsertOnly` fields are written only when the row is
 * new (e.g. the initial status), so out-of-order or duplicate webhook events
 * never regress a call's state. One Telnyx call → exactly one row.
 */
async function mergeRow(callSid, fields, onInsertOnly = {}) {
  const existing = await findRow(callSid);
  if (!existing) {
    const row = compact({ call_sid: callSid, provider: 'telnyx', source: 'live',
      billing_status: 'pending', cost_type: 'estimated', ...onInsertOnly, ...fields });
    const { data, error } = await supabase.from('call_billing').insert(row).select().single();
    if (!error) return data;
    if (!/duplicate|unique/i.test(error.message)) { checkSchemaError(error); throw new Error(error.message); }
    // Lost an insert race with a concurrent event — fall through to update.
  }
  const row = compact(fields);
  if (!Object.keys(row).length) return existing;
  const { data, error } = await supabase.from('call_billing').update(row).eq('call_sid', callSid).select().single();
  if (error) { checkSchemaError(error); throw new Error(error.message); }
  return data;
}

function destinationFields(number, payloadCountry) {
  const d = phone.lookup(number);
  return {
    destination_number: d.e164 || undefined,
    destination_country: d.country || payloadCountry || undefined,
    destination_prefix: d.dialCode || undefined,
  };
}

// ── Webhook event handlers ────────────────────────────────────────────────
async function onInitiated({ callControlId, payload = {}, occurredAt, state = {} }) {
  try {
    const ctx = await leadContext(state.params?.leadId, callControlId, state.params?.campaignId);
    await mergeRow(callControlId, {
      call_session_id: payload.call_session_id,
      call_leg_id: payload.call_leg_id,
      connection_id: payload.connection_id || '',
      from_number: payload.from || '',
      to_number: payload.to || '',
      direction: payload.direction || 'outgoing',
      ...destinationFields(payload.to || state.phone),
      ...ctx,
      phone_number: ctx.phone_number || payload.to || '',
    }, {
      call_status: 'initiated',
      started_at: occurredAt || new Date().toISOString(),
    });
    emit('billing-updated', { callSid: callControlId, billingStatus: 'pending' });
  } catch (e) {
    logger.error('Telnyx billing onInitiated failed', { callControlId, msg: e.message });
  }
}

async function onAnswered({ callControlId, occurredAt }) {
  try {
    await mergeRow(callControlId, { answered_at: occurredAt || new Date().toISOString(), call_status: 'in-progress' });
  } catch (e) {
    logger.error('Telnyx billing onAnswered failed', { callControlId, msg: e.message });
  }
}

async function onAmd({ callControlId, result }) {
  try { await mergeRow(callControlId, { answered_by: result || '' }); }
  catch (e) { logger.error('Telnyx billing onAmd failed', { callControlId, msg: e.message }); }
}

/**
 * Finalize the call's usage: duration from answer → hangup, billable seconds
 * under Telnyx increments, and an estimate. Re-delivered hangups recompute the
 * same values (idempotent).
 */
async function onHangup({ callControlId, payload = {}, occurredAt, state = {}, callStatus }) {
  try {
    const endedAt = payload.end_time || occurredAt || new Date().toISOString();
    // Only answered calls accrue talk time; no-answer/busy/failed bill 0s.
    const answeredAt = callStatus === 'completed'
      ? (state.answeredAt || (state.answered ? payload.start_time : null))
      : null;
    const durationSec = answeredAt
      ? Math.max(0, Math.round((Date.parse(endedAt) - Date.parse(answeredAt)) / 1000)) || 0
      : 0;

    const existing = await findRow(callControlId);
    const dest = destinationFields(payload.to || existing?.to_number || state.phone);
    const country = dest.destination_country || existing?.destination_country || '';
    const est = await estimate(durationSec, country);

    const machine = /machine|fax/i.test(state.amdResult || existing?.answered_by || '');
    const status = callStatus === 'completed' && machine ? 'voicemail' : callStatus;

    const fields = {
      ...dest,
      call_session_id: payload.call_session_id,
      connection_id: payload.connection_id,
      hangup_cause: payload.hangup_cause || '',
      call_status: status,
      ended_at: endedAt,
      duration_seconds: durationSec,
      duration_minutes: est.billable / 60,
      billable_seconds: est.billable,
      billing_increment: est.increment,
      estimated_rate_per_min: est.rate,
      estimated_cost: est.cost,
    };
    if (existing?.cost_type !== 'reconciled') {
      fields.cost_amount = est.cost;
      fields.cost_type = 'estimated';
    }

    // Fill in lead context if the initiated event was missed.
    let ctx = {};
    if (!existing || !existing.lead_id) {
      ctx = await leadContext(state.params?.leadId, callControlId, state.params?.campaignId);
    }
    await mergeRow(callControlId, { ...ctx, ...fields }, { started_at: payload.start_time || endedAt });

    logger.info(`[BILLING] Telnyx call ${callControlId} → ${status}, ${durationSec}s (billable ${est.billable}s), ` +
      (est.cost != null ? `est. $${est.cost}` : `awaiting Telnyx rate for ${country || 'unknown destination'}`));
    emit('billing-updated', { callSid: callControlId, billingStatus: 'pending' });
  } catch (e) {
    logger.error('Telnyx billing onHangup failed', { callControlId, msg: e.message });
  }
}

/**
 * Called from billingService.captureFromCall for Telnyx call ids (webhook
 * status route, AMD route, historical import). Never touches telephony fields
 * the bridge owns — only creates the row if missing and fills lead context.
 */
async function ensureRow(callSid, ctx = {}) {
  try {
    const existing = await findRow(callSid);
    const lc = existing?.lead_id ? {} : await leadContext(ctx.leadId || ctx.lead?._id, callSid, ctx.campaignId);
    const lead = ctx.lead || {};
    const fill = compact({
      ...lc,
      student_name: lc.student_name || lead.fullName || ctx.studentName,
      parent_name: lc.parent_name || lead.parentName || ctx.parentName,
      phone_number: lc.phone_number || lead.phone || ctx.phoneNumber,
    });
    if (existing) {
      // Only fill blanks.
      const blanks = {};
      for (const [k, v] of Object.entries(fill)) if (!existing[k] && v) blanks[k] = v;
      return Object.keys(blanks).length ? mergeRow(callSid, blanks) : existing;
    }
    return mergeRow(callSid, {
      ...fill,
      ...destinationFields(fill.phone_number),
    }, {
      call_status: ctx.callStatus || '',
      source: ctx.source || 'live',
      started_at: new Date().toISOString(),
    });
  } catch (e) {
    logger.error('Telnyx billing ensureRow failed', { callSid, msg: e.message });
    return null;
  }
}

// ── Re-estimate pending rows once a rate becomes known ────────────────────
async function reestimatePending(country) {
  const { data, error } = await supabase.from('call_billing')
    .select('id, duration_seconds, cost_type')
    .eq('provider', 'telnyx').eq('destination_country', country)
    .neq('cost_type', 'reconciled').not('ended_at', 'is', null)
    .limit(1000);
  if (error) { checkSchemaError(error); return 0; }
  let n = 0;
  for (const r of data || []) {
    const est = await estimate(r.duration_seconds, country);
    await supabase.from('call_billing').update({
      billable_seconds: est.billable, billing_increment: est.increment,
      estimated_rate_per_min: est.rate, estimated_cost: est.cost,
      cost_amount: est.cost, cost_type: 'estimated',
    }).eq('id', r.id);
    n++;
  }
  return n;
}

// ═══════════════════════════════════════════════════════════════════════════
//   RECONCILIATION — Telnyx Detail Records → per-call actual cost
// ═══════════════════════════════════════════════════════════════════════════
async function fetchDetailRecords(recordType, dateRange) {
  const key = process.env.TELNYX_API_KEY;
  if (!key) throw new Error('TELNYX_API_KEY is not set');
  const out = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const res = await axios.get(`${TELNYX_BASE}/detail_records`, {
      headers: { Authorization: `Bearer ${key}`, Accept: 'application/json' },
      params: {
        'filter[record_type]': recordType,
        'filter[date_range]': dateRange,
        'page[number]': page,
        'page[size]': PAGE_SIZE,
      },
      timeout: 30000,
    });
    const data = res.data?.data || [];
    out.push(...data);
    const totalPages = res.data?.meta?.total_pages;
    if (data.length < PAGE_SIZE || (totalPages && page >= totalPages)) break;
  }
  return out;
}

function normRecord(r, recordType) {
  const num = v => (v === null || v === undefined || v === '') ? null : Number(v);
  const cc = String(r.country_code || '').toUpperCase();
  return {
    type: r.record_type || recordType,
    sessionId: r.telnyx_session_id || r.call_session_id || r.session_id || '',
    ccid: stripSidPrefix(r.telnyx_call_control_id || r.call_control_id || ''),
    cost: num(r.cost) != null ? Math.abs(num(r.cost)) : null,
    rate: num(r.rate),
    billedSec: num(r.billed_sec),
    currency: r.currency || 'USD',
    country: /^[A-Z]{2}$/.test(cc) ? cc : '',
  };
}

let _reconciling = false;

/**
 * Pull Telnyx Detail Records for the given date ranges, sum every component per
 * call, and write the actual Telnyx cost onto matching rows. Records that match
 * no app call are reported (unmatched) rather than silently dropped.
 * @param {string[]} ranges Telnyx filter[date_range] values, e.g. ['today','yesterday']
 */
async function reconcile(ranges = ['today', 'yesterday']) {
  if (_reconciling) return { skipped: true, reason: 'already running' };
  _reconciling = true;
  const summary = {
    at: new Date().toISOString(), ranges, recordTypes: RECORD_TYPES,
    recordsFetched: 0, telnyxCalls: 0, telnyxTotal: 0,
    matchedCalls: 0, updatedRows: 0, unmatchedCalls: 0, unmatchedCost: 0,
    ratesLearned: 0, errors: [],
  };
  try {
    // 1. Fetch + group Detail Records by call.
    const groups = new Map();   // key → { sessionId, ccid, records[] }
    for (const range of ranges) {
      for (const type of RECORD_TYPES) {
        let recs = [];
        try { recs = await fetchDetailRecords(type, range); }
        catch (e) {
          const msg = e.response?.data?.errors?.[0]?.detail || e.message;
          summary.errors.push(`${type}/${range}: ${msg}`);
          continue;
        }
        summary.recordsFetched += recs.length;
        for (const raw of recs) {
          const r = normRecord(raw, type);
          const key = r.sessionId || r.ccid;
          if (!key) continue;
          if (!groups.has(key)) groups.set(key, { sessionId: r.sessionId, ccid: r.ccid, records: [], ids: new Set() });
          const g = groups.get(key);
          // Same record can appear in overlapping ranges — dedupe on its id.
          const rid = raw.id || raw.uuid || `${r.type}:${raw.started_at}:${r.cost}`;
          if (g.ids.has(rid)) continue;
          g.ids.add(rid);
          g.records.push(r);
          if (!g.ccid && r.ccid) g.ccid = r.ccid;
        }
      }
    }
    summary.telnyxCalls = groups.size;

    // 2. Candidate app rows: Telnyx calls not yet reconciled, or reconciled
    //    recently (late-arriving components are re-summed).
    const days = ranges.some(r => /month/.test(r)) ? 70 : ranges.some(r => /week/.test(r)) ? 16 : 3;
    const since = new Date(Date.now() - days * 24 * 3600 * 1000).toISOString();
    const { data: rows, error } = await supabase.from('call_billing')
      .select('id, call_sid, call_session_id, destination_country, telnyx_cost, reconciled_at, billable_seconds')
      .eq('provider', 'telnyx').gte('created_at', since).limit(10000);
    if (error) { checkSchemaError(error); throw new Error(error.message); }
    const bySession = new Map(), byCcid = new Map();
    for (const row of rows || []) {
      if (row.call_session_id) bySession.set(row.call_session_id, row);
      byCcid.set(stripSidPrefix(row.call_sid), row);
    }

    const rates = await loadRates(true);
    const learned = {};   // country → [effectiveRate...]

    // 3. Match + write.
    for (const g of groups.values()) {
      const total = round4(g.records.reduce((s, r) => s + (r.cost || 0), 0));
      summary.telnyxTotal += total;
      const row = (g.sessionId && bySession.get(g.sessionId)) || (g.ccid && byCcid.get(g.ccid));
      if (!row) { summary.unmatchedCalls++; summary.unmatchedCost += total; continue; }
      summary.matchedCalls++;

      const fresh = row.telnyx_cost == null;
      if (!fresh && row.reconciled_at && Date.now() - Date.parse(row.reconciled_at) > RECONCILE_WINDOW_MS) continue;
      if (!fresh && round4(row.telnyx_cost) === total) continue;  // nothing new

      const breakdown = {};
      for (const r of g.records) breakdown[r.type] = round4((breakdown[r.type] || 0) + (r.cost || 0));
      const voice = g.records.filter(r => r.billedSec != null).sort((a, b) => b.billedSec - a.billedSec)[0];
      const country = g.records.find(r => r.country)?.country || row.destination_country || '';

      const update = {
        telnyx_cost: total,
        telnyx_rate: voice?.rate ?? null,
        telnyx_billed_seconds: voice?.billedSec ?? null,
        telnyx_cost_breakdown: breakdown,
        reconciled_at: new Date().toISOString(),
        cost_amount: total,
        cost_type: 'reconciled',
        billing_status: 'final',
        currency: g.records[0]?.currency || 'USD',
      };
      if (voice?.billedSec != null) {
        update.billable_seconds = voice.billedSec;
        update.duration_minutes = voice.billedSec / 60;
      }
      if (country) update.destination_country = country;
      if (g.sessionId) update.call_session_id = g.sessionId;

      const { error: upErr } = await supabase.from('call_billing').update(update).eq('id', row.id);
      if (upErr) { summary.errors.push(`update ${row.call_sid}: ${upErr.message}`); continue; }
      summary.updatedRows++;

      // Learn the all-in effective rate for this destination (first reconcile only).
      const billed = voice?.billedSec || row.billable_seconds || 0;
      if (fresh && country && billed > 0 && total > 0) {
        (learned[country] = learned[country] || []).push(total / (billed / 60));
      }
    }

    // 4. Update learned destination rates (running average, capped weight).
    for (const [cc, samples] of Object.entries(learned)) {
      const prev = rates[cc];
      const n0 = Math.min(prev?.learned_samples || 0, 100);
      const avg0 = prev?.learned_rate_per_min != null ? Number(prev.learned_rate_per_min) : 0;
      const sum = avg0 * n0 + samples.reduce((s, v) => s + v, 0);
      const n = n0 + samples.length;
      const { error: rErr } = await supabase.from('telnyx_rates').upsert({
        country_code: cc,
        country_name: prev?.country_name || phone.countryName(cc),
        learned_rate_per_min: Math.round((sum / n) * 1e6) / 1e6,
        learned_samples: (prev?.learned_samples || 0) + samples.length,
        learned_at: new Date().toISOString(),
      }, { onConflict: 'country_code' });
      if (rErr) { summary.errors.push(`rate ${cc}: ${rErr.message}`); continue; }
      summary.ratesLearned++;
    }
    if (summary.ratesLearned) {
      await loadRates(true);
      for (const cc of Object.keys(learned)) await reestimatePending(cc);
    }

    summary.telnyxTotal = round4(summary.telnyxTotal);
    summary.unmatchedCost = round4(summary.unmatchedCost);
    await setMeta('telnyx_reconcile_last', JSON.stringify(summary));
    if (summary.updatedRows) emit('billing-updated', { reconciled: summary.updatedRows });
    logger.info(`[BILLING] Telnyx reconcile: ${summary.recordsFetched} records, ${summary.matchedCalls} matched, ` +
      `${summary.updatedRows} updated, ${summary.unmatchedCalls} unmatched` +
      (summary.errors.length ? `, errors: ${summary.errors.join(' | ')}` : ''));
    return summary;
  } catch (e) {
    summary.errors.push(e.message);
    logger.error('Telnyx reconcile failed', { msg: e.message });
    try { await setMeta('telnyx_reconcile_last', JSON.stringify(summary)); } catch (_) {}
    return summary;
  } finally {
    _reconciling = false;
  }
}

/** Run reconcile only when there are Telnyx calls that could still change. */
async function reconcileIfNeeded() {
  const since = new Date(Date.now() - RECONCILE_WINDOW_MS).toISOString();
  const { count, error } = await supabase.from('call_billing')
    .select('id', { count: 'exact', head: true })
    .eq('provider', 'telnyx').gte('created_at', since);
  if (error) { checkSchemaError(error); return null; }
  if (!count) return null;
  return reconcile(['today', 'yesterday']);
}

async function setMeta(key, value) {
  await supabase.from('billing_meta')
    .upsert({ key, value: String(value), updated_at: new Date().toISOString() }, { onConflict: 'key' });
}

async function reconcileStatus() {
  const { data } = await supabase.from('billing_meta').select('value').eq('key', 'telnyx_reconcile_last').maybeSingle();
  let last = null;
  try { last = data?.value ? JSON.parse(data.value) : null; } catch (_) {}
  return { last, running: _reconciling, recordTypes: RECORD_TYPES };
}

module.exports = {
  isTelnyxSid,
  billableSeconds,
  estimate,
  onInitiated,
  onAnswered,
  onAmd,
  onHangup,
  ensureRow,
  reconcile,
  reconcileIfNeeded,
  reconcileStatus,
  listRates,
  saveRate,
  deleteRate,
};

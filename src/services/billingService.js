/**
 * Billing Service — reporting over call_billing + capture entry points.
 *
 * Telnyx is the billing provider for all current calls: usage rows, estimates
 * and reconciliation against Telnyx Detail Records live in telnyxBilling.js.
 * The Twilio capture/finalize code below remains only for pre-Telnyx
 * (provider='historical') records.
 */
const supabase   = require('../db/supabase');
const twilioSvc   = require('./twilioService');
const campaignSvc = require('./campaignService');
const CallBilling = require('../models/CallBilling');
const telnyxBilling = require('./telnyxBilling');
const logger      = require('../logger');

const MAX_FETCH_ATTEMPTS = 15;     // ~22 min at the 90s poll interval
const AGG_ROW_CAP        = 50000;  // safety cap for JS-side aggregation fetches

const round4 = n => Math.round((Number(n) || 0) * 10000) / 10000;
const round2 = n => Math.round((Number(n) || 0) * 100) / 100;

// Per-minute rate = actual cost / billed minutes (derived, not an estimate of the charge).
function perMinute(price, minutes) {
  if (price == null) return null;
  return minutes > 0 ? round4(price / minutes) : round4(price);
}

// Extract the Recording SID (RE…) from a Twilio recording URL, if present.
function extractRecordingSid(url) {
  const m = /\/(RE[0-9a-f]{16,})/i.exec(String(url || ''));
  return m ? m[1] : '';
}

// ── Twilio Call → normalized fields ────────────────────────────────────────
function mapTwilioCall(tw) {
  const rawPrice = tw.price;
  const twilioPrice = (rawPrice !== null && rawPrice !== undefined && rawPrice !== '')
    ? round4(Math.abs(parseFloat(rawPrice)))
    : null;
  const durationSeconds = parseInt(tw.duration, 10) || 0;
  return {
    fromNumber:      tw.from || tw.fromFormatted || '',
    toNumber:        tw.to   || tw.toFormatted   || '',
    direction:       tw.direction || '',
    durationSeconds,
    durationMinutes: durationSeconds > 0 ? Math.ceil(durationSeconds / 60) : 0,
    twilioPrice,
    currency:        tw.priceUnit || 'USD',
    status:          tw.status || '',
    startedAt:       tw.startTime ? new Date(tw.startTime).toISOString() : null,
    endedAt:         tw.endTime   ? new Date(tw.endTime).toISOString()   : null,
  };
}

async function fetchTwilioCall(callSid) {
  return twilioSvc._client().calls(callSid).fetch();
}

// Emit a real-time SSE event (safe if the SSE module isn't ready).
function emit(type, payload) {
  try {
    const crm = require('../routes/crm');
    if (crm.broadcastUpdate) crm.broadcastUpdate(type, payload);
  } catch (_) { /* non-fatal */ }
}
function broadcast(payload) { emit('billing-updated', payload); }

// ═══════════════════════════════════════════════════════════════════════════
//   CAPTURE (called from the Twilio webhook on terminal call statuses)
// ═══════════════════════════════════════════════════════════════════════════
/**
 * Create or refresh the billing row for a completed call.
 * @param {string} callSid
 * @param {object} ctx  { lead, callStatus, campaignId, campaignName, counselorId }
 */
async function captureFromCall(callSid, ctx = {}) {
  if (!callSid) return null;
  // Telnyx calls are captured from Telnyx's own webhook events (telnyxBridge);
  // here we only make sure the row exists and carries lead context.
  if (telnyxBilling.isTelnyxSid(callSid)) return telnyxBilling.ensureRow(callSid, ctx);
  try {
    const tw = await fetchTwilioCall(callSid);
    const m  = mapTwilioCall(tw);
    const lead = ctx.lead || {};

    // Resolve campaign name once (cheap; skipped if we already have it).
    let campaignId   = ctx.campaignId   || lead.campaignId || null;
    let campaignName = ctx.campaignName || '';
    if (campaignId && !campaignName) {
      try { const c = await campaignSvc.getById(campaignId); campaignName = c?.name || ''; }
      catch (_) { /* keep blank */ }
    }

    // Recording (from the lead's matching call attempt, if already available).
    let recordingUrl = ctx.recordingUrl || '';
    if (!recordingUrl && Array.isArray(lead.callAttempts)) {
      const at = lead.callAttempts.find(a => a && a.callSid === callSid);
      if (at && at.recordingUrl && at.recordingUrl !== 'FAILED') recordingUrl = at.recordingUrl;
    }

    const fields = {
      callSid,
      leadId:        lead._id || ctx.leadId || null,
      campaignId,
      campaignName,
      counselorId:   ctx.counselorId || lead.assignedCounselorId || '',
      studentName:   lead.fullName   || ctx.studentName || '',
      parentName:    lead.parentName || ctx.parentName || '',
      phoneNumber:   lead.phone      || ctx.phoneNumber || m.toNumber || '',
      fromNumber:    m.fromNumber,
      toNumber:      m.toNumber,
      direction:     m.direction,
      durationSeconds: m.durationSeconds,
      durationMinutes: m.durationMinutes,
      twilioPrice:   m.twilioPrice,
      pricePerMinute: perMinute(m.twilioPrice, m.durationMinutes),
      currency:      m.currency,
      callStatus:    ctx.callStatus || m.status || '',
      recordingUrl,
      recordingSid:  extractRecordingSid(recordingUrl),
      source:        ctx.source || 'live',
      billingStatus: m.twilioPrice != null ? 'final' : 'pending',
      startedAt:     m.startedAt,
      endedAt:       m.endedAt,
    };

    const doc = await CallBilling.upsertBySid(fields);
    logger.info(`Billing captured for ${callSid} → ${fields.billingStatus}` +
      (m.twilioPrice != null ? ` (${m.twilioPrice} ${m.currency})` : ' (price pending)'));
    if (!ctx.noBroadcast) broadcast({ callSid, billingStatus: fields.billingStatus });

    // If Twilio hasn't priced the call yet, start a fast per-call finalizer so
    // the actual amount lands within ~20s (rather than waiting up to a full
    // 90s global-poller tick). The poller remains the durable safety net.
    // Historical imports skip this — the global poller handles any pending rows.
    if (fields.billingStatus === 'pending' && ctx.source !== 'historical-import') {
      scheduleFastFinalize(callSid);
    }
    return doc;
  } catch (err) {
    logger.error('billingService.captureFromCall failed', { callSid, msg: err.message });
    return null;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
//   FINALIZE (fetch the real price and lock the row to 'final')
// ═══════════════════════════════════════════════════════════════════════════
/**
 * Re-fetch a call from Twilio and update its billing row. Sets 'final' once the
 * real price is present, or 'unavailable' after MAX_FETCH_ATTEMPTS. Never
 * overwrites call_status — the webhook set the authoritative value (e.g.
 * 'voicemail', which Twilio itself would report only as 'completed').
 * @returns {{finalized:boolean, stillPending:boolean}}
 */
async function _applyFinalize(row) {
  const tw = await fetchTwilioCall(row.call_sid);
  const m  = mapTwilioCall(tw);
  const attempts = (row.fetch_attempts || 0) + 1;

  const update = {
    fetch_attempts:   attempts,
    duration_seconds: m.durationSeconds,
    duration_minutes: m.durationMinutes,
  };
  if (m.startedAt) update.started_at = m.startedAt;
  if (m.endedAt)   update.ended_at   = m.endedAt;

  let finalized = false;
  if (m.twilioPrice != null) {
    update.twilio_price     = m.twilioPrice;
    update.price_per_minute = perMinute(m.twilioPrice, m.durationMinutes);
    update.currency         = m.currency;
    update.billing_status   = 'final';
    finalized = true;
  } else if (attempts >= MAX_FETCH_ATTEMPTS) {
    update.billing_status = 'unavailable';
  }

  await supabase.from('call_billing').update(update).eq('id', row.id);
  if (update.billing_status) broadcast({ callSid: row.call_sid, billingStatus: update.billing_status });
  return { finalized, stillPending: !update.billing_status };
}

// Finalize a single row by call SID (used by the fast per-call finalizer).
async function _finalizeCallSid(callSid) {
  const { data: row } = await supabase
    .from('call_billing')
    .select('id, call_sid, fetch_attempts, billing_status')
    .eq('call_sid', callSid)
    .maybeSingle();
  if (!row || row.billing_status === 'final') return { done: true, finalized: false, stillPending: false };
  const r = await _applyFinalize(row);
  return { done: !r.stillPending, ...r };
}

// In-process fast finalizer: re-checks a specific call a few times shortly
// after it completes, so the real price appears within seconds. Idempotent per
// SID; hands off to the 90s poller if Twilio is still slow.
const FAST_DELAYS = [20000, 25000, 45000, 60000, 120000]; // ms between attempts
const _fastPending = new Set();
function scheduleFastFinalize(callSid) {
  if (!callSid || _fastPending.has(callSid)) return;
  _fastPending.add(callSid);
  let i = 0;
  const tick = async () => {
    try {
      const r = await _finalizeCallSid(callSid);
      if (r.done) { _fastPending.delete(callSid); return; }
    } catch (_) { /* transient — keep trying */ }
    if (i < FAST_DELAYS.length) setTimeout(tick, FAST_DELAYS[i++]);
    else _fastPending.delete(callSid); // give up fast path; global poller continues
  };
  setTimeout(tick, FAST_DELAYS[i++]);
}

// ═══════════════════════════════════════════════════════════════════════════
//   BACKFILL (poller — finalizes pending rows once Twilio has a price)
// ═══════════════════════════════════════════════════════════════════════════
async function backfillPending() {
  try {
    const cutoff = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
    const { data: pending, error } = await supabase
      .from('call_billing')
      .select('id, call_sid, fetch_attempts')
      .eq('billing_status', 'pending')
      .not('call_sid', 'like', 'v2:%')     // Telnyx rows are reconciled separately
      .not('call_sid', 'like', 'v3:%')
      .gte('created_at', cutoff)
      .lt('fetch_attempts', MAX_FETCH_ATTEMPTS)
      .limit(200);

    if (error) { logger.error('billing backfill query failed', { msg: error.message }); return; }
    if (!pending || !pending.length) return;

    logger.info(`billingPoller: checking ${pending.length} pending billing row(s)`);
    let finalized = 0;

    for (const row of pending) {
      try {
        const r = await _applyFinalize(row);
        if (r.finalized) finalized++;
      } catch (e) {
        logger.warn(`billing backfill: fetch failed for ${row.call_sid}: ${e.message}`);
        await supabase.from('call_billing')
          .update({ fetch_attempts: (row.fetch_attempts || 0) + 1 })
          .eq('id', row.id);
      }
    }

    if (finalized) logger.info(`billingPoller: finalized ${finalized} billing row(s)`);
  } catch (err) {
    logger.error('billingService.backfillPending error', { msg: err.message });
  }
}

// ═══════════════════════════════════════════════════════════════════════════
//   HISTORICAL BACKFILL (one-time import of every pre-existing call)
// ═══════════════════════════════════════════════════════════════════════════
// key/value marker so the automatic import runs only once
async function getMeta(key) {
  const { data } = await supabase.from('billing_meta').select('value').eq('key', key).maybeSingle();
  return data ? data.value : null;
}
async function setMeta(key, value) {
  await supabase.from('billing_meta')
    .upsert({ key, value: String(value), updated_at: new Date().toISOString() }, { onConflict: 'key' });
}

/**
 * Scan every existing call (stored in leads.call_attempts), fetch each one's
 * ACTUAL Twilio price, and create a billing row marked source='historical-import'.
 * Idempotent: skips any call_sid already present. Throttled with limited
 * concurrency to respect Twilio rate limits. Returns a summary.
 */
async function backfillHistorical({ concurrency = 5 } = {}) {
  const summary = { scanned: 0, created: 0, finalized: 0, pending: 0, skipped: 0, errors: 0 };

  // 1. Existing billing SIDs → skip set (paged).
  const existing = new Set();
  for (let off = 0; ; off += 1000) {
    const { data, error } = await supabase.from('call_billing').select('call_sid').range(off, off + 999);
    if (error) throw new Error(error.message);
    (data || []).forEach(r => existing.add(r.call_sid));
    if (!data || data.length < 1000) break;
  }

  // 2. Campaign id → name map (avoids per-call lookups).
  const campMap = {};
  try {
    const { data } = await supabase.from('campaigns').select('id, name');
    (data || []).forEach(c => { campMap[c.id] = c.name; });
  } catch (_) { /* campaigns optional */ }

  // 3. Collect every call attempt with a SID from all leads (paged).
  const tasks = [];
  for (let off = 0; ; off += 500) {
    const { data: leads, error } = await supabase
      .from('leads')
      .select('id, full_name, parent_name, phone, campaign_id, assigned_counselor_id, call_attempts')
      .range(off, off + 499);
    if (error) throw new Error(error.message);
    if (!leads || !leads.length) break;
    for (const lead of leads) {
      for (const a of (lead.call_attempts || [])) {
        if (!a || !a.callSid) continue;
        summary.scanned++;
        if (existing.has(a.callSid)) { summary.skipped++; continue; }
        existing.add(a.callSid); // guard against duplicate SIDs across attempts
        tasks.push({
          callSid: a.callSid,
          ctx: {
            leadId:       lead.id,
            campaignId:   lead.campaign_id || null,
            campaignName: lead.campaign_id ? (campMap[lead.campaign_id] || '') : '',
            counselorId:  lead.assigned_counselor_id || '',
            studentName:  lead.full_name || '',
            parentName:   lead.parent_name || '',
            phoneNumber:  lead.phone || '',
            callStatus:   a.status || '',
            recordingUrl: (a.recordingUrl && a.recordingUrl !== 'FAILED') ? a.recordingUrl : '',
            source:       'historical-import',
            noBroadcast:  true,   // avoid an SSE storm; we emit progress instead
          },
        });
      }
    }
    if (leads.length < 500) break;
  }

  logger.info(`billing historical import: ${tasks.length} new call(s) to import (${summary.skipped} already present)`);
  emit('billing-backfill', { done: false, total: tasks.length, processed: 0, ...summary });

  // 4. Process with limited concurrency; emit progress periodically.
  let idx = 0;
  async function worker() {
    while (idx < tasks.length) {
      const t = tasks[idx++];
      try {
        const doc = await captureFromCall(t.callSid, t.ctx);
        if (doc) {
          summary.created++;
          if (doc.billingStatus === 'final') summary.finalized++; else summary.pending++;
        } else {
          summary.errors++;
        }
      } catch (_) { summary.errors++; }
      if (summary.created % 10 === 0) {
        emit('billing-backfill', { done: false, total: tasks.length, processed: idx, ...summary });
      }
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, concurrency) }, worker));

  emit('billing-backfill', { done: true, total: tasks.length, processed: tasks.length, ...summary });
  logger.info(`billing historical import complete: ${JSON.stringify(summary)}`);
  return summary;
}

/** Run the historical import exactly once (guarded by the billing_meta marker). */
async function autoBackfillOnce() {
  try {
    const done = await getMeta('historical_import_done'); // throws if the table doesn't exist yet
    if (done === 'true') return;
    logger.info('billing: starting one-time historical import…');
    const summary = await backfillHistorical();
    await setMeta('historical_import_done', 'true');
    await setMeta('historical_import_summary', JSON.stringify(summary));
  } catch (e) {
    // Table not created yet, or transient error — will retry on next boot.
    logger.warn(`billing: auto historical import skipped: ${e.message}`);
  }
}

/** Status for the dashboard: whether the one-time import ran + counts. */
async function backfillStatus() {
  // Probe with a normal select so a missing table reliably errors (a head-count
  // request does not) — lets callers return the 503 "run the migration" hint.
  const probe = await supabase.from('call_billing').select('id').limit(1);
  if (probe.error) throw new Error(probe.error.message);

  const { count: total } = await supabase
    .from('call_billing').select('id', { count: 'exact', head: true });
  const { count: historical } = await supabase.from('call_billing')
    .select('id', { count: 'exact', head: true }).eq('source', 'historical-import');

  const done = await getMeta('historical_import_done');
  const summaryRaw = await getMeta('historical_import_summary');
  let summary = null;
  try { summary = summaryRaw ? JSON.parse(summaryRaw) : null; } catch (_) {}

  return { done: done === 'true', summary, totalRecords: total || 0, historicalRecords: historical || 0 };
}

// ═══════════════════════════════════════════════════════════════════════════
//   QUERY + AGGREGATION HELPERS
// ═══════════════════════════════════════════════════════════════════════════
// Every report aggregates `cost_amount`: the reconciled Telnyx cost when known,
// otherwise the Telnyx estimate, or the stored price for historical rows.
const AGG_COLUMNS = 'id, provider, cost_amount, cost_type, twilio_price, duration_seconds, duration_minutes, ' +
  'billable_seconds, call_status, billing_status, currency, created_at, campaign_id, campaign_type, ' +
  'campaign_name, counselor_id, lead_id, student_name, destination_country, class_id, ended_at';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function costOf(r) {
  if (r.cost_amount != null) return Number(r.cost_amount);
  if (r.provider !== 'telnyx' && r.twilio_price != null) return Number(r.twilio_price);
  return null;
}
function billableSecOf(r) {
  if (r.billable_seconds != null) return Number(r.billable_seconds) || 0;
  return Math.round((Number(r.duration_minutes) || 0) * 60);
}

/**
 * Apply dashboard filters to a call_billing query. Provider defaults to
 * 'telnyx' so historical (pre-Telnyx) records are never mixed in unless asked
 * for ('all' or 'historical').
 */
function applyFilters(q, query = {}, scope = {}) {
  const provider = query.provider === undefined ? 'telnyx' : String(query.provider);
  if (provider && provider !== 'all') q = q.eq('provider', provider);
  if (scope.counselorId) q = q.eq('counselor_id', scope.counselorId);
  if (query.counselorId && !scope.counselorId) q = q.eq('counselor_id', query.counselorId);
  if (query.campaignId) {
    q = UUID_RE.test(query.campaignId) ? q.eq('campaign_id', query.campaignId) : q.eq('campaign_type', query.campaignId);
  }
  if (query.country)     q = q.eq('destination_country', String(query.country).toUpperCase());
  if (query.classId)     q = q.eq('class_id', query.classId);
  if (query.leadId)      q = q.eq('lead_id', query.leadId);
  if (query.status)      q = q.eq('call_status', query.status);
  if (query.billingStatus) q = q.eq('billing_status', query.billingStatus);
  if (query.costType)    q = q.eq('cost_type', query.costType);
  if (query.dateFrom)    q = q.gte('created_at', new Date(query.dateFrom).toISOString());
  if (query.dateTo)      q = q.lte('created_at', new Date(query.dateTo).toISOString());
  if (query.costMin !== undefined && query.costMin !== '') q = q.gte('cost_amount', Number(query.costMin));
  if (query.costMax !== undefined && query.costMax !== '') q = q.lte('cost_amount', Number(query.costMax));
  if (query.search) {
    const s = String(query.search).replace(/[%,()*]/g, '');
    q = q.or(`student_name.ilike.%${s}%,parent_name.ilike.%${s}%,phone_number.ilike.%${s}%,` +
             `destination_number.ilike.%${s}%,call_sid.ilike.%${s}%`);
  }
  return q;
}

// Fetch filtered + scoped rows for JS aggregation (minimal columns).
async function fetchRows(scope = {}, query = {}) {
  let q = applyFilters(supabase.from('call_billing').select(AGG_COLUMNS), query, scope);
  const { data, error } = await q.order('created_at', { ascending: false }).range(0, AGG_ROW_CAP - 1);
  if (error) throw new Error(error.message);
  if ((data || []).length >= AGG_ROW_CAP) {
    logger.warn(`billing aggregation hit the ${AGG_ROW_CAP}-row cap — totals may be truncated`);
  }
  return data || [];
}

// Call outcome buckets.
const STATUS_BUCKET = {
  completed: 'answered', voicemail: 'voicemail', 'no-answer': 'noAnswer',
  busy: 'busy', failed: 'failed', canceled: 'canceled',
  initiated: 'inProgress', 'in-progress': 'inProgress', ringing: 'inProgress',
};

function tallyRows(rows) {
  let cost = 0, billableSec = 0, seconds = 0, billableCalls = 0;
  let reconciledCost = 0, estimatedCost = 0, reconciledCalls = 0, estimatedCalls = 0, unpricedCalls = 0;
  const counts = { answered: 0, voicemail: 0, noAnswer: 0, busy: 0, failed: 0, canceled: 0, inProgress: 0 };
  for (const r of rows) {
    const c = costOf(r);
    const b = billableSecOf(r);
    if (c != null) cost += c;
    if (r.cost_type === 'reconciled') { reconciledCost += c || 0; reconciledCalls++; }
    else if (r.cost_type === 'estimated' && c != null) { estimatedCost += c; estimatedCalls++; }
    if (c == null && b > 0) unpricedCalls++;
    billableSec += b;
    if (b > 0) billableCalls++;
    seconds += Number(r.duration_seconds) || 0;
    const bucket = STATUS_BUCKET[r.call_status];
    if (bucket) counts[bucket]++;
  }
  const calls = rows.length;
  const billableMinutes = billableSec / 60;
  return {
    totalCalls: calls,
    answeredCalls: counts.answered,
    voicemailCalls: counts.voicemail,
    noAnswerCalls: counts.noAnswer,
    busyCalls: counts.busy,
    failedCalls: counts.failed,
    canceledCalls: counts.canceled,
    inProgressCalls: counts.inProgress,
    totalCost: round4(cost),
    reconciledCost: round4(reconciledCost),
    estimatedCost: round4(estimatedCost),
    reconciledCalls,
    estimatedCalls,
    unpricedCalls,
    billableCalls,
    billableMinutes: round2(billableMinutes),
    totalMinutes: round2(billableMinutes),   // legacy alias
    totalSeconds: seconds,
    avgCostPerCall:   round4(billableCalls   ? cost / billableCalls   : 0),
    avgCostPerMinute: round4(billableMinutes ? cost / billableMinutes : 0),
    avgDurationSeconds: calls ? Math.round(seconds / calls) : 0,
    currency: rows.find(r => r.currency)?.currency || 'USD',
  };
}

// ── Date bucket keys (in the viewer's time zone) ─────────────────────────
// tzOffset = minutes from Date#getTimezoneOffset() in the browser (UTC − local).
function tzTools(tzOffset) {
  const off = (Number.isFinite(Number(tzOffset)) ? Number(tzOffset) : 0) * 60000;
  const local = d => new Date(new Date(d).getTime() - off);          // shifted; read with UTC getters
  const fromLocal = d => new Date(d.getTime() + off);
  const dayKey   = d => local(d).toISOString().slice(0, 10);
  const monthKey = d => local(d).toISOString().slice(0, 7);
  const weekKey  = d => {
    const dt = local(d);
    dt.setUTCDate(dt.getUTCDate() - ((dt.getUTCDay() + 6) % 7));     // Monday
    return dt.toISOString().slice(0, 10);
  };
  const now = local(Date.now());
  const sod = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const sow = new Date(sod); sow.setUTCDate(sod.getUTCDate() - ((sod.getUTCDay() + 6) % 7));
  const som = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const soy = new Date(Date.UTC(now.getUTCFullYear(), 0, 1));
  return {
    dayKey, weekKey, monthKey,
    startOfDay: fromLocal(sod), startOfWeek: fromLocal(sow),
    startOfMonth: fromLocal(som), startOfYear: fromLocal(soy),
  };
}

function bucketBy(rows, keyFn) {
  const map = {};
  for (const r of rows) {
    const k = keyFn(r.created_at);
    if (!map[k]) map[k] = { label: k, calls: 0, cost: 0, minutes: 0 };
    map[k].calls++;
    map[k].cost    += costOf(r) || 0;
    map[k].minutes += billableSecOf(r) / 60;
  }
  return Object.values(map)
    .map(b => ({ ...b, cost: round4(b.cost), minutes: round2(b.minutes) }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

function groupCost(rows, keyFn, labelFn) {
  const map = {};
  for (const r of rows) {
    const key = keyFn(r) || '__none__';
    if (!map[key]) map[key] = { key, label: labelFn(r) || '', calls: 0, billableCalls: 0, cost: 0, billSec: 0, seconds: 0 };
    const g = map[key];
    const b = billableSecOf(r);
    g.calls++;
    if (b > 0) g.billableCalls++;
    g.cost    += costOf(r) || 0;
    g.billSec += b;
    g.seconds += Number(r.duration_seconds) || 0;
    if (!g.label) g.label = labelFn(r) || '';
  }
  return Object.values(map).map(g => ({
    key: g.key === '__none__' ? null : g.key,
    label: g.label,
    totalCalls: g.calls,
    billableMinutes: round2(g.billSec / 60),
    totalMinutes: round2(g.billSec / 60),
    totalCost: round4(g.cost),
    avgDuration: g.calls ? Math.round(g.seconds / g.calls) : 0,
    avgCostPerCall:   round4(g.billableCalls ? g.cost / g.billableCalls : 0),
    avgCostPerMinute: round4(g.billSec ? g.cost / (g.billSec / 60) : 0),
  })).sort((a, b) => b.totalCost - a.totalCost || b.totalCalls - a.totalCalls);
}

const campaignKey   = r => r.campaign_id || r.campaign_type || null;
const campaignLabel = r => r.campaign_name || (r.campaign_type ? r.campaign_type : '');

function byCampaignFrom(rows) {
  return groupCost(rows, campaignKey, campaignLabel)
    .map(g => ({ ...g, label: g.label || (g.key ? g.key : 'Unassigned / Demo') }));
}
async function byCounselorFrom(rows) {
  const grouped = groupCost(rows, r => r.counselor_id, () => '');
  const names = await counselorNames(grouped.map(g => g.key));
  return grouped.map(g => ({ ...g, label: g.key ? (names[g.key] || 'Unknown') : 'Unassigned' }));
}
function byCountryFrom(rows) {
  const { countryName } = require('../utils/phoneCountry');
  return groupCost(rows, r => r.destination_country, r => r.destination_country ? countryName(r.destination_country) : '')
    .map(g => ({ ...g, label: g.label || 'Unknown' }));
}

// Resolve profile display names for a set of counselor ids.
async function counselorNames(ids) {
  const clean = [...new Set(ids.filter(Boolean))];
  const names = {};
  if (!clean.length) return names;
  const { data } = await supabase.from('profiles').select('id, full_name, email').in('id', clean);
  (data || []).forEach(p => { names[p.id] = p.full_name || p.email || p.id; });
  return names;
}

function summaryFrom(rows, tz) {
  const all = tallyRows(rows);
  const costSince = since => round4(rows
    .filter(r => new Date(r.created_at) >= since)
    .reduce((s, r) => s + (costOf(r) || 0), 0));
  return {
    ...all,
    costToday:  costSince(tz.startOfDay),
    costWeek:   costSince(tz.startOfWeek),
    costMonth:  costSince(tz.startOfMonth),
    costYear:   costSince(tz.startOfYear),
    lifetimeCost: all.totalCost,
    pendingCount: rows.filter(r => r.billing_status === 'pending').length,
  };
}

// ── Summary cards ──────────────────────────────────────────────────────────
async function summary(scope = {}, query = {}) {
  const rows = await fetchRows(scope, query);
  return summaryFrom(rows, tzTools(query.tzOffset));
}

async function byCampaign(scope = {}, query = {}) {
  return byCampaignFrom(await fetchRows(scope, query));
}

async function byCounselor(scope = {}, query = {}) {
  return byCounselorFrom(await fetchRows(scope, query));
}

async function byLead(leadId, scope = {}) {
  // Full rows (with call_sid) for the lead's billing history table — all providers.
  let q = supabase.from('call_billing').select('*').eq('lead_id', leadId);
  if (scope.counselorId) q = q.eq('counselor_id', scope.counselorId);
  const { data } = await q.order('created_at', { ascending: false }).limit(500);
  const rows = data || [];
  const totals = tallyRows(rows);
  return { rows, totals };
}

// ── Time-series reports ─────────────────────────────────────────────────────
async function reports(scope = {}, query = {}) {
  const rows = await fetchRows(scope, query);
  const tz = tzTools(query.tzOffset);
  return {
    daily:   bucketBy(rows, tz.dayKey).slice(-60),
    weekly:  bucketBy(rows, tz.weekKey).slice(-26),
    monthly: bucketBy(rows, tz.monthKey).slice(-24),
  };
}

function chartsFrom(rows, tz, costByCampaign, costByCounselor) {
  const daily   = bucketBy(rows, tz.dayKey);
  const weekly  = bucketBy(rows, tz.weekKey);
  const monthly = bucketBy(rows, tz.monthKey);
  const costByLead = groupCost(rows, r => r.lead_id, r => r.student_name)
    .map(g => ({ ...g, label: g.label || 'Unknown' }));
  // Scatter: each priced call as (durationSeconds, cost)
  const costVsDuration = rows.filter(r => costOf(r) != null)
    .map(r => ({ x: Number(r.duration_seconds) || 0, y: round4(costOf(r)) })).slice(0, 2000);
  return {
    daily: daily.slice(-30), weekly: weekly.slice(-12), monthly: monthly.slice(-12),
    costByCampaign: costByCampaign.slice(0, 12),
    costByCounselor: costByCounselor.slice(0, 12),
    costByLead: costByLead.slice(0, 15),
    costVsDuration,
    callsVsCost: daily.slice(-30).map(b => ({ label: b.label, calls: b.calls, cost: b.cost })),
    avgCostPerCall: daily.slice(-30).map(b => ({ label: b.label, value: round4(b.calls ? b.cost / b.calls : 0) })),
    _all: { daily, weekly, monthly },
  };
}

// ── Chart datasets ───────────────────────────────────────────────────────────
async function charts(scope = {}, isAdmin = true, query = {}) {
  const rows = await fetchRows(scope, query);
  const c = chartsFrom(rows, tzTools(query.tzOffset), byCampaignFrom(rows), isAdmin ? await byCounselorFrom(rows) : []);
  delete c._all;
  return c;
}

// ── Combined analytics (single fetch — used by the dashboard load) ───────────
async function analytics(scope = {}, isAdmin = true, query = {}) {
  const rows = await fetchRows(scope, query);
  const tz = tzTools(query.tzOffset);
  const costByCampaign  = byCampaignFrom(rows);
  const costByCounselor = isAdmin ? await byCounselorFrom(rows) : [];
  const c = chartsFrom(rows, tz, costByCampaign, costByCounselor);
  const { daily, weekly, monthly } = c._all;
  delete c._all;
  return {
    summary: summaryFrom(rows, tz),
    charts: c,
    reports: { daily: daily.slice(-60), weekly: weekly.slice(-26), monthly: monthly.slice(-24) },
    byCampaign: costByCampaign,
    byCounselor: costByCounselor,
    byCountry: byCountryFrom(rows),
  };
}

// ── Paginated / filtered list ────────────────────────────────────────────────
async function list(query = {}, scope = {}) {
  const page     = Math.max(1, parseInt(query.page)     || 1);
  const pageSize = Math.min(200, Math.max(1, parseInt(query.pageSize) || 25));
  const from = (page - 1) * pageSize;
  const to   = from + pageSize - 1;

  const sortMap = {
    date: 'created_at', cost: 'cost_amount', duration: 'duration_seconds',
    billable: 'billable_seconds', student: 'student_name', campaign: 'campaign_name',
    status: 'call_status', country: 'destination_country',
  };
  const sortCol = sortMap[query.sortBy] || 'created_at';
  const ascending = String(query.sortDir).toLowerCase() === 'asc';

  let q = applyFilters(supabase.from('call_billing').select('*', { count: 'exact' }), query, scope);
  q = q.order(sortCol, { ascending, nullsFirst: false }).range(from, to);

  const { data, error, count } = await q;
  if (error) throw new Error(error.message);
  return { rows: data || [], total: count || 0, page, pageSize };
}

// Rows for export (respects filters + scope, no pagination — pulls everything matching).
async function exportRows(query = {}, scope = {}) {
  let q = applyFilters(supabase.from('call_billing').select('*'), query, scope);
  const { data, error } = await q.order('created_at', { ascending: false }).range(0, AGG_ROW_CAP - 1);
  if (error) throw new Error(error.message);
  return data || [];
}

// ── Single record detail (joins transcript/recording/summary from the lead) ──
async function detail(id, scope = {}) {
  const { data: row, error } = await supabase.from('call_billing').select('*').eq('id', id).single();
  if (error || !row) return null;
  if (scope.counselorId && row.counselor_id !== scope.counselorId) return { forbidden: true };

  let attempt = null;
  let attemptIndex = null;
  if (row.lead_id) {
    const { data: lead } = await supabase
      .from('leads').select('call_attempts').eq('id', row.lead_id).maybeSingle();
    const attempts = (lead && lead.call_attempts) || [];
    const idx = attempts.findIndex(a => a.callSid === row.call_sid);
    if (idx !== -1) { attempt = attempts[idx]; attemptIndex = idx; }
  }

  const timeline = [
    row.started_at && { at: row.started_at, event: 'Call started' },
    attempt?.recordingUrl && attempt.recordingUrl !== 'FAILED' && { at: row.ended_at || row.started_at, event: 'Recording captured' },
    row.ended_at && { at: row.ended_at, event: `Call ended (${row.call_status || 'completed'})` },
    row.provider === 'telnyx' && row.estimated_cost != null && row.ended_at && { at: row.ended_at, event: `Estimated ${row.estimated_cost} ${row.currency || 'USD'} (${row.billable_seconds || 0}s billable)` },
    row.provider === 'telnyx' && row.reconciled_at && { at: row.reconciled_at, event: `Reconciled with Telnyx: ${row.telnyx_cost} ${row.currency || 'USD'}` },
    row.provider !== 'telnyx' && row.billing_status === 'final' && { at: row.updated_at, event: `Billed ${row.twilio_price} ${row.currency}` },
  ].filter(Boolean);

  return {
    billing: row,
    transcript: attempt?.transcript || '',
    recordingUrl: attempt?.recordingUrl || '',
    aiSummary: attempt?.aiSummary || '',
    sentiment: attempt?.sentiment || '',
    leadId: row.lead_id || null,
    attemptIndex,   // index into the lead's call_attempts for the recording endpoint
    timeline,
  };
}

module.exports = {
  captureFromCall,
  backfillPending,
  backfillHistorical,
  autoBackfillOnce,
  backfillStatus,
  list,
  exportRows,
  detail,
  summary,
  byCampaign,
  byCounselor,
  byLead,
  reports,
  charts,
  analytics,
  MAX_FETCH_ATTEMPTS,
};

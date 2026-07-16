/**
 * Billing Service — captures the ACTUAL Twilio price for every AI call.
 *
 * Twilio does not return `price` in the call-status webhook; it lands on the
 * Call resource seconds-to-minutes later. So:
 *   1. On call completion we create/refresh a billing row (billing_status=pending).
 *   2. billingPoller.backfillPending() re-fetches the Call resource until Twilio
 *      returns a real price, then flips the row to 'final'.
 * The stored amount is always Twilio's own figure — never estimated.
 */
const supabase   = require('../db/supabase');
const twilioSvc   = require('./twilioService');
const campaignSvc = require('./campaignService');
const CallBilling = require('../models/CallBilling');
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
const AGG_COLUMNS = 'id, twilio_price, duration_seconds, duration_minutes, call_status, ' +
  'billing_status, currency, created_at, campaign_id, campaign_name, counselor_id, lead_id, student_name';

// Fetch scoped rows for JS aggregation (minimal columns).
async function fetchRows(scope = {}, { dateFrom, dateTo } = {}) {
  let q = supabase.from('call_billing').select(AGG_COLUMNS);
  if (scope.counselorId) q = q.eq('counselor_id', scope.counselorId);
  if (dateFrom) q = q.gte('created_at', dateFrom);
  if (dateTo)   q = q.lte('created_at', dateTo);
  const { data, error } = await q.order('created_at', { ascending: false }).range(0, AGG_ROW_CAP - 1);
  if (error) throw new Error(error.message);
  if ((data || []).length >= AGG_ROW_CAP) {
    logger.warn(`billing aggregation hit the ${AGG_ROW_CAP}-row cap — totals may be truncated`);
  }
  return data || [];
}

// Classify a call row into answered / failed / voicemail buckets.
const isAnswered  = s => s === 'completed';
const isFailed    = s => ['no-answer', 'busy', 'failed'].includes(s);
const isVoicemail = s => s === 'voicemail';

function tallyRows(rows) {
  let cost = 0, minutes = 0, seconds = 0, priced = 0;
  let answered = 0, failed = 0, voicemail = 0;
  for (const r of rows) {
    const price = r.twilio_price != null ? Number(r.twilio_price) : null;
    if (price != null) { cost += price; priced++; }
    minutes += Number(r.duration_minutes) || 0;
    seconds += Number(r.duration_seconds) || 0;
    if (isAnswered(r.call_status))  answered++;
    if (isFailed(r.call_status))    failed++;
    if (isVoicemail(r.call_status)) voicemail++;
  }
  const calls = rows.length;
  return {
    totalCalls: calls,
    answeredCalls: answered,
    failedCalls: failed,
    voicemailCalls: voicemail,
    totalCost: round4(cost),
    pricedCalls: priced,
    totalMinutes: round2(minutes),
    totalSeconds: seconds,
    avgCostPerCall:   round4(calls    ? cost / calls   : 0),
    avgCostPerMinute: round4(minutes  ? cost / minutes : 0),
    avgDurationSeconds: calls ? Math.round(seconds / calls) : 0,
    currency: rows.find(r => r.currency)?.currency || 'USD',
  };
}

// ── Date bucket keys ──────────────────────────────────────────────────────
const dayKey   = d => new Date(d).toISOString().slice(0, 10);
const monthKey = d => new Date(d).toISOString().slice(0, 7);
function weekKey(d) {
  const dt = new Date(d);
  const dow = (dt.getUTCDay() + 6) % 7; // Monday = 0
  dt.setUTCDate(dt.getUTCDate() - dow);
  return dt.toISOString().slice(0, 10);
}

function bucketBy(rows, keyFn) {
  const map = {};
  for (const r of rows) {
    const k = keyFn(r.created_at);
    if (!map[k]) map[k] = { label: k, calls: 0, cost: 0, minutes: 0 };
    map[k].calls++;
    map[k].cost    += r.twilio_price != null ? Number(r.twilio_price) : 0;
    map[k].minutes += Number(r.duration_minutes) || 0;
  }
  return Object.values(map)
    .map(b => ({ ...b, cost: round4(b.cost), minutes: round2(b.minutes) }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

function groupCost(rows, keyField, labelField) {
  const map = {};
  for (const r of rows) {
    const key = r[keyField] || '__none__';
    if (!map[key]) map[key] = { key, label: r[labelField] || '', calls: 0, cost: 0, minutes: 0, seconds: 0 };
    map[key].calls++;
    map[key].cost    += r.twilio_price != null ? Number(r.twilio_price) : 0;
    map[key].minutes += Number(r.duration_minutes) || 0;
    map[key].seconds += Number(r.duration_seconds) || 0;
  }
  return Object.values(map).map(g => ({
    key: g.key === '__none__' ? null : g.key,
    label: g.label,
    totalCalls: g.calls,
    totalMinutes: round2(g.minutes),
    totalCost: round4(g.cost),
    avgDuration: g.calls ? Math.round(g.seconds / g.calls) : 0,
    avgCostPerCall:   round4(g.calls   ? g.cost / g.calls   : 0),
    avgCostPerMinute: round4(g.minutes ? g.cost / g.minutes : 0),
  })).sort((a, b) => b.totalCost - a.totalCost);
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

// ── Summary cards ──────────────────────────────────────────────────────────
async function summary(scope = {}) {
  const rows = await fetchRows(scope);
  const now = new Date();
  const startOfDay   = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startOfWeek  = new Date(startOfDay); startOfWeek.setDate(startOfDay.getDate() - ((startOfDay.getDay() + 6) % 7));
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const startOfYear  = new Date(now.getFullYear(), 0, 1);

  const costSince = since => round4(rows
    .filter(r => r.twilio_price != null && new Date(r.created_at) >= since)
    .reduce((s, r) => s + Number(r.twilio_price), 0));

  const all = tallyRows(rows);
  return {
    costToday:  costSince(startOfDay),
    costWeek:   costSince(startOfWeek),
    costMonth:  costSince(startOfMonth),
    costYear:   costSince(startOfYear),
    lifetimeCost: all.totalCost,
    avgCostPerCall:   all.avgCostPerCall,
    avgCostPerMinute: all.avgCostPerMinute,
    totalMinutes: all.totalMinutes,
    totalCalls:   all.totalCalls,
    answeredCalls: all.answeredCalls,
    failedCalls:   all.failedCalls,
    voicemailCalls: all.voicemailCalls,
    pendingCount: rows.filter(r => r.billing_status === 'pending').length,
    currency: all.currency,
  };
}

async function byCampaign(scope = {}) {
  const rows = await fetchRows(scope);
  return groupCost(rows, 'campaign_id', 'campaign_name')
    .map(g => ({ ...g, label: g.label || (g.key ? g.key : 'Unassigned / Demo') }));
}

async function byCounselor(scope = {}) {
  const rows = await fetchRows(scope);
  const grouped = groupCost(rows, 'counselor_id', 'label');
  const names = await counselorNames(grouped.map(g => g.key));
  return grouped.map(g => ({ ...g, label: g.key ? (names[g.key] || 'Unknown') : 'Unassigned' }));
}

async function byLead(leadId, scope = {}) {
  // Full rows (with call_sid) for the lead's billing history table
  let q = supabase.from('call_billing').select('*').eq('lead_id', leadId);
  if (scope.counselorId) q = q.eq('counselor_id', scope.counselorId);
  const { data } = await q.order('created_at', { ascending: false }).limit(500);
  const rows = data || [];
  const totals = tallyRows(rows);
  return { rows, totals };
}

// ── Time-series reports ─────────────────────────────────────────────────────
async function reports(scope = {}) {
  const rows = await fetchRows(scope);
  return {
    daily:   bucketBy(rows, dayKey).slice(-60),
    weekly:  bucketBy(rows, weekKey).slice(-26),
    monthly: bucketBy(rows, monthKey).slice(-24),
  };
}

// ── Chart datasets ───────────────────────────────────────────────────────────
async function charts(scope = {}, isAdmin = true) {
  const rows = await fetchRows(scope);

  const daily   = bucketBy(rows, dayKey).slice(-30);
  const weekly  = bucketBy(rows, weekKey).slice(-12);
  const monthly = bucketBy(rows, monthKey).slice(-12);

  const costByCampaign  = (await byCampaignFrom(rows)).slice(0, 12);
  const costByCounselor = isAdmin ? (await byCounselorFrom(rows)).slice(0, 12) : [];
  const costByLead      = groupCost(rows, 'lead_id', 'student_name')
    .map(g => ({ ...g, label: g.label || 'Unknown' })).slice(0, 15);

  // Scatter: each priced call as (durationSeconds, price)
  const costVsDuration = rows
    .filter(r => r.twilio_price != null)
    .map(r => ({ x: Number(r.duration_seconds) || 0, y: round4(r.twilio_price) }))
    .slice(0, 2000);

  // Calls vs cost + avg cost/call per day (derived from the daily buckets)
  const callsVsCost   = daily.map(b => ({ label: b.label, calls: b.calls, cost: b.cost }));
  const avgCostPerCall = daily.map(b => ({ label: b.label, value: round4(b.calls ? b.cost / b.calls : 0) }));

  return { daily, weekly, monthly, costByCampaign, costByCounselor, costByLead,
           costVsDuration, callsVsCost, avgCostPerCall };
}

// helpers reused by charts (aggregate from already-fetched rows)
function byCampaignFrom(rows) {
  return Promise.resolve(groupCost(rows, 'campaign_id', 'campaign_name')
    .map(g => ({ ...g, label: g.label || (g.key ? g.key : 'Unassigned / Demo') })));
}
async function byCounselorFrom(rows) {
  const grouped = groupCost(rows, 'counselor_id', 'label');
  const names = await counselorNames(grouped.map(g => g.key));
  return grouped.map(g => ({ ...g, label: g.key ? (names[g.key] || 'Unknown') : 'Unassigned' }));
}

// ── Combined analytics (single fetch — used by the dashboard load) ───────────
async function analytics(scope = {}, isAdmin = true) {
  const rows = await fetchRows(scope);
  const all = tallyRows(rows);
  const now = new Date();
  const startOfDay   = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startOfWeek  = new Date(startOfDay); startOfWeek.setDate(startOfDay.getDate() - ((startOfDay.getDay() + 6) % 7));
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const startOfYear  = new Date(now.getFullYear(), 0, 1);
  const costSince = since => round4(rows
    .filter(r => r.twilio_price != null && new Date(r.created_at) >= since)
    .reduce((s, r) => s + Number(r.twilio_price), 0));

  const daily   = bucketBy(rows, dayKey);
  const weekly  = bucketBy(rows, weekKey);
  const monthly = bucketBy(rows, monthKey);
  const costByCampaign  = (await byCampaignFrom(rows));
  const costByCounselor = isAdmin ? (await byCounselorFrom(rows)) : [];
  const costByLead      = groupCost(rows, 'lead_id', 'student_name')
    .map(g => ({ ...g, label: g.label || 'Unknown' }));
  const costVsDuration = rows.filter(r => r.twilio_price != null)
    .map(r => ({ x: Number(r.duration_seconds) || 0, y: round4(r.twilio_price) })).slice(0, 2000);

  return {
    summary: {
      costToday: costSince(startOfDay), costWeek: costSince(startOfWeek),
      costMonth: costSince(startOfMonth), costYear: costSince(startOfYear),
      lifetimeCost: all.totalCost, avgCostPerCall: all.avgCostPerCall,
      avgCostPerMinute: all.avgCostPerMinute, totalMinutes: all.totalMinutes,
      totalCalls: all.totalCalls, answeredCalls: all.answeredCalls,
      failedCalls: all.failedCalls, voicemailCalls: all.voicemailCalls,
      pendingCount: rows.filter(r => r.billing_status === 'pending').length,
      currency: all.currency,
    },
    charts: {
      daily: daily.slice(-30), weekly: weekly.slice(-12), monthly: monthly.slice(-12),
      costByCampaign: costByCampaign.slice(0, 12),
      costByCounselor: costByCounselor.slice(0, 12),
      costByLead: costByLead.slice(0, 15),
      costVsDuration,
      callsVsCost: daily.slice(-30).map(b => ({ label: b.label, calls: b.calls, cost: b.cost })),
      avgCostPerCall: daily.slice(-30).map(b => ({ label: b.label, value: round4(b.calls ? b.cost / b.calls : 0) })),
    },
    reports: { daily: daily.slice(-60), weekly: weekly.slice(-26), monthly: monthly.slice(-24) },
    byCampaign: costByCampaign,
    byCounselor: costByCounselor,
  };
}

// ── Paginated / filtered list ────────────────────────────────────────────────
async function list(query = {}, scope = {}) {
  const page     = Math.max(1, parseInt(query.page)     || 1);
  const pageSize = Math.min(200, Math.max(1, parseInt(query.pageSize) || 25));
  const from = (page - 1) * pageSize;
  const to   = from + pageSize - 1;

  const sortMap = {
    date: 'created_at', cost: 'twilio_price', duration: 'duration_seconds',
    student: 'student_name', campaign: 'campaign_name', status: 'call_status',
  };
  const sortCol = sortMap[query.sortBy] || 'created_at';
  const ascending = String(query.sortDir).toLowerCase() === 'asc';

  let q = supabase.from('call_billing').select('*', { count: 'exact' });
  if (scope.counselorId) q = q.eq('counselor_id', scope.counselorId);
  if (query.campaignId)  q = q.eq('campaign_id', query.campaignId);
  if (query.counselorId && !scope.counselorId) q = q.eq('counselor_id', query.counselorId);
  if (query.leadId)      q = q.eq('lead_id', query.leadId);
  if (query.status)      q = q.eq('call_status', query.status);
  if (query.billingStatus) q = q.eq('billing_status', query.billingStatus);
  if (query.dateFrom)    q = q.gte('created_at', new Date(query.dateFrom).toISOString());
  if (query.dateTo)      q = q.lte('created_at', new Date(query.dateTo).toISOString());
  if (query.costMin !== undefined && query.costMin !== '') q = q.gte('twilio_price', Number(query.costMin));
  if (query.costMax !== undefined && query.costMax !== '') q = q.lte('twilio_price', Number(query.costMax));
  if (query.search) {
    const s = String(query.search).replace(/[%,()*]/g, '');
    q = q.or(`student_name.ilike.%${s}%,parent_name.ilike.%${s}%,phone_number.ilike.%${s}%,call_sid.ilike.%${s}%`);
  }

  q = q.order(sortCol, { ascending, nullsFirst: false }).range(from, to);

  const { data, error, count } = await q;
  if (error) throw new Error(error.message);
  return { rows: data || [], total: count || 0, page, pageSize };
}

// Rows for export (respects filters + scope, no pagination — pulls everything matching).
async function exportRows(query = {}, scope = {}) {
  let q = supabase.from('call_billing').select('*');
  if (scope.counselorId) q = q.eq('counselor_id', scope.counselorId);
  if (query.campaignId)  q = q.eq('campaign_id', query.campaignId);
  if (query.counselorId && !scope.counselorId) q = q.eq('counselor_id', query.counselorId);
  if (query.leadId)      q = q.eq('lead_id', query.leadId);
  if (query.status)      q = q.eq('call_status', query.status);
  if (query.dateFrom)    q = q.gte('created_at', new Date(query.dateFrom).toISOString());
  if (query.dateTo)      q = q.lte('created_at', new Date(query.dateTo).toISOString());
  if (query.search) {
    const s = String(query.search).replace(/[%,()*]/g, '');
    q = q.or(`student_name.ilike.%${s}%,parent_name.ilike.%${s}%,phone_number.ilike.%${s}%,call_sid.ilike.%${s}%`);
  }
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
    row.billing_status === 'final' && { at: row.updated_at, event: `Billed ${row.twilio_price} ${row.currency}` },
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

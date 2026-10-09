/**
 * Bulk Call Queue — the single dispatcher behind every bulk-calling entry
 * point (Leads → Start Bulk AI Calls, Classes → Entire Class / Selected,
 * custom campaigns). All of them hit POST /api/leads/bulk-call → enqueue().
 *
 * Event-driven: a call is dialed the moment a slot is free. The Telnyx status
 * webhook (/webhook/call/status) calls onCallEnded(), which frees the slot and
 * dispatches the next student immediately — no polling loop, no fixed gaps.
 *
 * Capacity is account-wide (Telnyx counts every live call), so the limit is
 * global across runs: BULK_CALL_CONCURRENCY (default 1).
 *
 * Unanswered calls hang up after BULK_CALL_RING_TIMEOUT_SECS (default 24s ≈
 * 4 rings at the US 6-second ring cadence); Telnyx then reports
 * hangup_cause=timeout, which the bridge maps to no-answer.
 *
 * Jobs are mirrored to the call_jobs table (supabase/schema_call_queue.sql)
 * so a run resumes after a restart. If the table doesn't exist the queue still
 * works, in memory only.
 */
const crypto   = require('crypto');
const supabase = require('../db/supabase');
const callSvc  = require('./twilioService'); // shim → telnyxService
const logger   = require('../logger');

const CONCURRENCY       = Math.max(1, parseInt(process.env.BULK_CALL_CONCURRENCY) || 1);
const RING_TIMEOUT_SECS = Math.max(5, parseInt(process.env.BULK_CALL_RING_TIMEOUT_SECS) || 24);
const MAX_CAPACITY_RETRIES = 4;          // provider capacity/rate-limit rejections only
const DIALING_STALE_MS  = 90 * 1000;     // Telnyx request never returned
const ACTIVE_CHECK_MS   = 3 * 60 * 1000; // ask Telnyx if a call is still alive after this
const KEEP_FINISHED_MS  = 6 * 3600 * 1000;

const LIVE     = new Set(['queued', 'dialing', 'active']);
const TERMINAL = new Set(['completed', 'no-answer', 'failed', 'skipped', 'canceled']);

const runs      = new Map(); // runId → run
const jobsBySid = new Map(); // Telnyx call_control_id → job
let persist = true;          // flips off once we learn call_jobs is missing
let lastEndedAt = null;      // most recent terminal event, for the end→next-dial gap
let watchdogTimer = null;

// ── Helpers ─────────────────────────────────────────────────────────────

const iso = d => (d ? new Date(d).toISOString() : null);

function normalisePhone(raw) {
  let p = String(raw || '').replace(/[^\d+]/g, '');
  if (/^\d{10}$/.test(p)) p = '+1' + p;
  else if (/^1\d{10}$/.test(p)) p = '+' + p;
  else if (p.startsWith('00')) p = '+' + p.substring(2);
  else if (!p.startsWith('+') && /^\d+$/.test(p)) p = '+' + p;
  return /^\+[1-9]\d{6,14}$/.test(p) ? p : null;
}

// Telnyx rejects with 429 or a channel/concurrency error when the account is at
// capacity — worth retrying. Anything else (bad number, auth, config) is permanent.
function isCapacityError(err) {
  if (err.status === 429) return true;
  const text = `${err.message} ${JSON.stringify(err.providerErrors || [])}`;
  return /channel limit|concurren|too many|rate limit|capacity/i.test(text);
}

function broadcast(type, data) {
  try {
    const crm = require('../routes/crm');
    if (crm.broadcastUpdate) crm.broadcastUpdate(type, data);
  } catch (_) { /* dashboards just miss one tick */ }
}

function activeCount() {
  let n = 0;
  for (const run of runs.values()) for (const j of run.jobs) if (j.state === 'dialing' || j.state === 'active') n++;
  return n;
}

// ── Persistence (fire-and-forget — never blocks dispatch) ──────────────

function toRow(job) {
  return {
    id: job.id, run_id: job.runId, lead_id: job.leadId, position: job.position,
    state: job.state, destination: job.destination || '', call_sid: job.callSid || null,
    attempts: job.attempts, outcome: job.outcome || '', error: job.error || '',
    run_meta: job.run ? job.run.meta : null,
    enqueued_at: iso(job.enqueuedAt), dequeued_at: iso(job.dequeuedAt),
    request_started_at: iso(job.requestStartedAt), accepted_at: iso(job.acceptedAt),
    ended_at: iso(job.endedAt), next_attempt_at: iso(job.nextAttemptAt),
    updated_at: new Date().toISOString(),
  };
}

function persistError(error) {
  if (/call_jobs|PGRST205|42P01|does not exist|schema cache/i.test(`${error.code} ${error.message}`)) {
    persist = false;
    logger.warn('[BULK] call_jobs table missing — queue runs in memory only. Run supabase/schema_call_queue.sql to enable restart recovery.');
  } else {
    logger.warn('[BULK] call_jobs write failed', { msg: error.message });
  }
}

function persistJobs(jobs) {
  if (!persist || !jobs.length) return;
  supabase.from('call_jobs').upsert(jobs.map(toRow))
    .then(({ error }) => { if (error) persistError(error); })
    .catch(e => persistError(e));
}

// ── Progress ────────────────────────────────────────────────────────────

function summary(run) {
  const c = { queued: 0, calling: 0, completed: 0, noAnswer: 0, failed: 0, skipped: 0, canceled: 0 };
  for (const j of run.jobs) {
    if (j.state === 'queued' || j.state === 'dialing') c.queued++;
    else if (j.state === 'active') c.calling++;
    else if (j.state === 'no-answer') c.noAnswer++;
    else c[j.state]++;
  }
  const end = run.finishedAt || Date.now();
  return {
    runId: run.id,
    label: run.meta.label || run.meta.campaignId || 'Bulk AI Calls',
    campaignId: run.meta.campaignId || null,
    classId: run.meta.classId || null,
    total: run.jobs.length,
    ...c,
    processed: c.completed + c.noAnswer + c.failed + c.skipped + c.canceled,
    activeCalls: activeCount(),
    concurrency: CONCURRENCY,
    startedAt: iso(run.createdAt),
    finishedAt: iso(run.finishedAt),
    elapsedSec: Math.round((end - run.createdAt) / 1000),
    stopped: run.stopped,
    done: !!run.finishedAt,
  };
}

function emitProgress(run, leadId) {
  broadcast('bulk-call-progress', { run: summary(run), ...(leadId ? { leadId } : {}) });
}

// ── Run lifecycle ───────────────────────────────────────────────────────

/**
 * Queue a bulk run and start dialing immediately.
 * @returns {object} run summary plus skipped details
 */
async function enqueue({ leadIds, campaignId = null, campaignVars = null, classId = null, counselor = 'system', label = '' }) {
  const unique = [...new Set((leadIds || []).map(String))];
  if (!unique.length) throw new Error('No students to call');

  // A student already waiting or on a call in another run is not queued twice.
  const busy = new Set();
  for (const r of runs.values()) for (const j of r.jobs) if (LIVE.has(j.state)) busy.add(j.leadId);

  const { data: leads, error } = await supabase
    .from('leads').select('id, full_name, phone, status, call_attempts').in('id', unique);
  if (error) throw new Error(error.message);
  const byId = new Map((leads || []).map(l => [String(l.id), l]));

  const run = {
    id: crypto.randomUUID(),
    meta: { campaignId, campaignVars, classId, counselor, label },
    createdAt: Date.now(),
    finishedAt: null,
    stopped: false,
    jobs: [],
  };

  const now = Date.now();
  unique.forEach((leadId, i) => {
    const lead = byId.get(leadId);
    const job = {
      id: crypto.randomUUID(), runId: run.id, run, leadId, position: i,
      name: lead?.full_name || '', prevStatus: lead?.status || null,
      destination: normalisePhone(lead?.phone) || (lead?.phone || ''),
      state: 'queued', attempts: 0, callSid: null, outcome: '', error: '',
      enqueuedAt: now, dequeuedAt: null, requestStartedAt: null, acceptedAt: null,
      endedAt: null, nextAttemptAt: null, gapMs: null,
    };
    if (!lead) { job.state = 'skipped'; job.error = 'lead-not-found'; job.endedAt = now; }
    else if (busy.has(leadId)) { job.state = 'skipped'; job.error = 'already-in-another-bulk-run'; job.endedAt = now; }
    else if (!normalisePhone(lead.phone)) { job.state = 'failed'; job.error = `invalid-phone:${lead.phone || 'missing'}`; job.endedAt = now; }
    run.jobs.push(job);
  });
  runs.set(run.id, run);

  for (const job of run.jobs.filter(j => j.state === 'failed')) {
    await recordFailedLead(job, byId.get(job.leadId)?.call_attempts);
  }

  const queuedIds = run.jobs.filter(j => j.state === 'queued').map(j => j.leadId);
  if (queuedIds.length) {
    const { error: qErr } = await supabase.from('leads').update({ status: 'queued' }).in('id', queuedIds);
    if (qErr) logger.error(`[BULK] could not mark leads queued: ${qErr.message}`);
  }
  persistJobs(run.jobs);

  const s = summary(run);
  logger.info(`[BULK] run=${run.id} enqueued total=${s.total} queued=${s.queued} skipped=${s.skipped} ` +
    `campaign=${campaignId || 'default'} class=${classId || '-'} concurrency=${CONCURRENCY} ringTimeout=${RING_TIMEOUT_SECS}s`);
  for (const j of run.jobs.filter(j => j.state === 'skipped' || j.state === 'failed')) {
    logger.warn(`[BULK] run=${run.id} job=${j.id} lead=${j.leadId} ${j.state}: ${j.error}`);
  }

  emitProgress(run);
  checkRunDone(run);
  pump();
  return { ...s, skippedDetails: run.jobs.filter(j => j.state === 'skipped' || j.state === 'failed')
    .map(j => ({ leadId: j.leadId, name: j.name, reason: j.error })) };
}

// A student we can't dial (bad number) shows Failed, with the reason in their
// call history — no call is placed, so nothing is billed.
async function recordFailedLead(job, existingAttempts) {
  const nowIso = new Date().toISOString();
  const attempts = Array.isArray(existingAttempts) ? [...existingAttempts] : [];
  const { campaignId, classId, counselor } = job.run.meta;
  attempts.push({
    attemptNumber: attempts.length + 1, startTime: nowIso, endTime: nowIso,
    status: 'failed', error: job.error, campaignId, classId: classId || null, counselor, bulkRunId: job.runId,
  });
  const { error } = await supabase.from('leads').update({ status: 'failed', call_attempts: attempts }).eq('id', job.leadId);
  if (error) logger.error(`[BULK] could not record failure for lead ${job.leadId}: ${error.message}`);
  broadcast('lead-updated', { leadId: job.leadId });
}

// Fill every free slot with the oldest eligible queued job (across runs, FIFO).
function pump() {
  let free = CONCURRENCY - activeCount();
  if (free <= 0) return;
  const now = Date.now();
  const ordered = [...runs.values()].filter(r => !r.stopped).sort((a, b) => a.createdAt - b.createdAt);
  for (const run of ordered) {
    for (const job of run.jobs) {
      if (free <= 0) return;
      if (job.state !== 'queued' || (job.nextAttemptAt && job.nextAttemptAt > now)) continue;
      job.state = 'dialing';               // claimed synchronously — no double dispatch
      job.dequeuedAt = now;
      free--;
      dial(job).catch(err => {
        logger.error(`[BULK] dial crashed job=${job.id}: ${err.message}`);
        finish(job, 'failed', `internal:${err.message}`);
      });
    }
  }
}

async function dial(job) {
  const run = job.run;
  const { campaignId, campaignVars, classId, counselor } = run.meta;
  job.attempts++;

  const { data: lead, error } = await supabase.from('leads').select('*').eq('id', job.leadId).single();
  if (error || !lead) return finish(job, 'skipped', 'lead-not-found');
  const phone = normalisePhone(lead.phone);
  if (!phone) {
    job.error = `invalid-phone:${lead.phone || 'missing'}`;
    await recordFailedLead(job, lead.call_attempts);
    return finish(job, 'failed', job.error);
  }

  const startedIso = new Date().toISOString();
  const totalAttempts = (lead.total_call_attempts || 0) + 1;
  const callAttempts = Array.isArray(lead.call_attempts) ? [...lead.call_attempts] : [];
  callAttempts.push({
    attemptNumber: totalAttempts,
    startTime:     startedIso,
    status:        'initiated',
    campaignId:    campaignId || lead.campaign_id,
    campaignVars,
    classId:       classId || null,
    counselor,
    bulkRunId:     run.id,
  });
  await supabase.from('leads').update({
    status: 'calling', phone, total_call_attempts: totalAttempts,
    last_call_at: startedIso, call_attempts: callAttempts,
  }).eq('id', job.leadId);
  broadcast('lead-updated', { leadId: job.leadId });

  job.requestStartedAt = Date.now();
  if (lastEndedAt && lastEndedAt >= run.createdAt) job.gapMs = job.requestStartedAt - lastEndedAt;

  let result;
  try {
    result = await callSvc.call({ ...lead, _id: lead.id, phone }, null, campaignId || lead.campaign_id, campaignVars,
      { ringTimeoutSecs: RING_TIMEOUT_SECS });
  } catch (err) {
    const capacity = isCapacityError(err);
    const retry = capacity && job.attempts < MAX_CAPACITY_RETRIES && !run.stopped;
    // Roll back (retry) or record (permanent) the attempt we just added.
    const { data: fresh } = await supabase.from('leads').select('call_attempts, total_call_attempts').eq('id', job.leadId).single();
    const attempts = Array.isArray(fresh?.call_attempts) ? [...fresh.call_attempts] : callAttempts;
    const idx = attempts.findIndex(a => a.startTime === startedIso);
    if (retry) {
      if (idx >= 0) attempts.splice(idx, 1);
      await supabase.from('leads').update({
        status: 'queued', call_attempts: attempts,
        total_call_attempts: Math.max(0, (fresh?.total_call_attempts || totalAttempts) - 1),
      }).eq('id', job.leadId);
      const backoff = 5000 * 2 ** (job.attempts - 1); // 5s, 10s, 20s
      job.state = 'queued';
      job.error = err.message;
      job.nextAttemptAt = Date.now() + backoff;
      persistJobs([job]);
      logger.warn(`[BULK] run=${run.id} job=${job.id} lead=${job.leadId} provider at capacity (attempt ${job.attempts}) — retry in ${backoff / 1000}s: ${err.message}`);
      // No immediate pump: the account is at capacity, so the next student
      // would be rejected too. Resume after the backoff.
      setTimeout(pump, backoff + 50);
      emitProgress(run, job.leadId);
      return;
    }
    if (idx >= 0) Object.assign(attempts[idx], { status: 'failed', error: err.message, endTime: new Date().toISOString() });
    await supabase.from('leads').update({ status: 'failed', call_attempts: attempts }).eq('id', job.leadId);
    broadcast('lead-updated', { leadId: job.leadId });
    return finish(job, 'failed', `provider-rejected:${err.message}`);
  }

  job.callSid = result.callSid;
  job.acceptedAt = Date.now();
  jobsBySid.set(job.callSid, job);

  // Stopped (or timed out by the watchdog) while the request was in flight.
  if (job.state !== 'dialing') {
    callSvc.endCall(job.callSid).catch(() => {});
    return;
  }
  job.state = 'active';

  // Attach the call ID to the attempt (re-read: webhooks may have touched the row).
  const { data: fresh } = await supabase.from('leads').select('call_attempts').eq('id', job.leadId).single();
  const attempts = Array.isArray(fresh?.call_attempts) ? [...fresh.call_attempts] : callAttempts;
  const att = attempts.find(a => a.startTime === startedIso);
  if (att && !att.callSid) {
    att.callSid = job.callSid;
    await supabase.from('leads').update({ call_attempts: attempts }).eq('id', job.leadId);
  }
  persistJobs([job]);
  emitProgress(run, job.leadId);
}

// Map the webhook's CallStatus to a job state.
function stateFor(callStatus) {
  if (callStatus === 'completed') return 'completed';
  if (callStatus === 'no-answer' || callStatus === 'busy') return 'no-answer';
  if (callStatus === 'canceled') return 'canceled';
  return 'failed';
}

/**
 * Called by /webhook/call/status for every terminal status. Idempotent:
 * duplicate or late events for a finished job are ignored, so a slot is never
 * released twice and nobody is dialed twice.
 */
function onCallEnded(callSid, callStatus) {
  const job = jobsBySid.get(callSid);
  if (!job || TERMINAL.has(job.state)) return false;
  finish(job, stateFor(callStatus), '', callStatus);
  return true;
}

function finish(job, state, error = '', outcome = '') {
  if (TERMINAL.has(job.state)) return;
  job.state = state;
  job.error = error;
  job.outcome = outcome || job.outcome;
  job.endedAt = Date.now();
  if (state !== 'skipped') lastEndedAt = job.endedAt;
  persistJobs([job]);
  logJob(job);
  emitProgress(job.run, job.leadId);
  checkRunDone(job.run);
  setImmediate(pump); // next student goes out now
}

function logJob(j) {
  const ms = (a, b) => (a && b ? b - a : null);
  logger.info(`[BULK] run=${j.runId} job=${j.id} lead=${j.leadId} to=${j.destination} state=${j.state}` +
    ` outcome=${j.outcome || '-'} sid=${j.callSid || '-'} attempts=${j.attempts}` +
    ` enqueued=${iso(j.enqueuedAt)} dequeued=${iso(j.dequeuedAt)} requestStarted=${iso(j.requestStartedAt)}` +
    ` accepted=${iso(j.acceptedAt)} ended=${iso(j.endedAt)}` +
    ` queueWaitMs=${ms(j.enqueuedAt, j.dequeuedAt)} providerMs=${ms(j.requestStartedAt, j.acceptedAt)}` +
    ` callMs=${ms(j.acceptedAt, j.endedAt)} gapAfterPrevEndMs=${j.gapMs ?? '-'}` +
    (j.error ? ` error=${j.error}` : ''));
}

function checkRunDone(run) {
  if (run.finishedAt || run.jobs.some(j => LIVE.has(j.state))) return;
  run.finishedAt = Date.now();
  const s = summary(run);
  const dialed = run.jobs.filter(j => j.requestStartedAt);
  const avg = arr => (arr.length ? Math.round(arr.reduce((a, b) => a + b, 0) / arr.length) : null);
  const gaps = dialed.map(j => j.gapMs).filter(g => g != null);
  const mins = (run.finishedAt - run.createdAt) / 60000;
  logger.info(`[BULK] run=${run.id} finished in ${mins.toFixed(1)} min — total=${s.total} completed=${s.completed}` +
    ` noAnswer=${s.noAnswer} failed=${s.failed} skipped=${s.skipped} canceled=${s.canceled}` +
    ` throughput=${dialed.length ? (dialed.length / Math.max(mins, 1 / 60) * 60).toFixed(0) : 0}/hr` +
    ` avgQueueWaitMs=${avg(dialed.map(j => j.dequeuedAt - j.enqueuedAt))}` +
    ` avgGapAfterPrevEndMs=${avg(gaps)} maxGapMs=${gaps.length ? Math.max(...gaps) : '-'}`);
  emitProgress(run);
  setTimeout(() => runs.delete(run.id), KEEP_FINISHED_MS).unref?.();
}

// ── Stop ────────────────────────────────────────────────────────────────

// Stop a run: nobody else is dialed, waiting students go back to their previous
// status, and live calls are hung up (same as the per-student Stop Call).
async function stopRun(runId) {
  const run = runs.get(runId);
  if (!run) return null;
  run.stopped = true;
  const restore = [];
  for (const job of run.jobs) {
    if (job.state === 'queued') {
      restore.push(job);
      finish(job, 'canceled', 'campaign-stopped');
    } else if (job.state === 'dialing' || job.state === 'active') {
      if (job.callSid) callSvc.endCall(job.callSid).catch(() => {});
      finish(job, 'canceled', 'campaign-stopped');
    }
  }
  await restoreStatuses(restore);
  logger.info(`[BULK] run=${runId} stopped by user`);
  emitProgress(run);
  return summary(run);
}

// Per-student Stop on a student still waiting in the queue: drop them from it.
// Returns true if the student was queued (not yet dialed).
async function cancelLead(leadId) {
  let removed = false;
  for (const run of runs.values()) {
    for (const job of run.jobs) {
      if (job.leadId !== String(leadId)) continue;
      if (job.state === 'queued') {
        finish(job, 'canceled', 'stopped-by-user');
        await restoreStatuses([job]);
        removed = true;
      }
    }
  }
  return removed;
}

async function restoreStatuses(jobs) {
  for (const job of jobs) {
    const back = job.prevStatus && !['queued', 'calling'].includes(job.prevStatus) ? job.prevStatus : 'contacted';
    await supabase.from('leads').update({ status: back }).eq('id', job.leadId).eq('status', 'queued');
    broadcast('lead-updated', { leadId: job.leadId });
  }
}

// ── Watchdog: recover from missed webhooks / hung requests ─────────────

async function watchdog() {
  const now = Date.now();
  for (const run of runs.values()) {
    for (const job of run.jobs) {
      try {
        if (job.state === 'dialing' && job.requestStartedAt && now - job.requestStartedAt > DIALING_STALE_MS) {
          logger.warn(`[BULK] watchdog: Telnyx request hung for job=${job.id} lead=${job.leadId}`);
          finish(job, 'failed', 'provider-request-timeout');
          await markLeadEnded(job.leadId, 'failed', 'provider-request-timeout');
        } else if (job.state === 'active' && job.callSid && now - job.acceptedAt > ACTIVE_CHECK_MS) {
          const status = await callSvc.getCallStatus(job.callSid);
          if (!status || !status.alive) {
            logger.warn(`[BULK] watchdog: call ${job.callSid} ended without a status webhook — releasing slot`);
            finish(job, 'failed', 'status-webhook-missed');
            await markLeadEnded(job.leadId, 'unknown', 'status-webhook-missed', job.callSid);
          } else {
            job.acceptedAt = now; // still talking — check again later
          }
        }
      } catch (e) {
        logger.warn(`[BULK] watchdog check failed for job=${job.id}: ${e.message}`);
      }
    }
  }
  pump();
}

// Clear a lead stuck in "calling" when its end event never arrived.
async function markLeadEnded(leadId, attemptStatus, reason, callSid = null) {
  const { data: lead } = await supabase.from('leads').select('status, call_attempts').eq('id', leadId).single();
  if (!lead) return;
  const attempts = Array.isArray(lead.call_attempts) ? [...lead.call_attempts] : [];
  const att = callSid ? attempts.find(a => a.callSid === callSid) : attempts[attempts.length - 1];
  if (att && ['initiated', 'ringing', 'in-progress'].includes(att.status)) {
    Object.assign(att, { status: attemptStatus, error: reason, endTime: new Date().toISOString() });
  }
  await supabase.from('leads').update({
    status: lead.status === 'calling' ? 'contacted' : lead.status,
    call_attempts: attempts,
  }).eq('id', leadId);
  broadcast('lead-updated', { leadId });
}

// ── Startup: resume runs that were in progress when the server stopped ──

async function start() {
  if (watchdogTimer) return;
  watchdogTimer = setInterval(() => watchdog().catch(() => {}), 30 * 1000);
  logger.info(`[BULK] queue started — concurrency=${CONCURRENCY}, ring timeout=${RING_TIMEOUT_SECS}s`);

  try {
    const { data, error } = await supabase.from('call_jobs').select('*').in('state', [...LIVE]).order('position');
    if (error) return persistError(error);
    if (!data?.length) return;

    for (const row of data) {
      let run = runs.get(row.run_id);
      if (!run) {
        run = { id: row.run_id, meta: row.run_meta || {}, createdAt: Date.parse(row.enqueued_at) || Date.now(),
                finishedAt: null, stopped: false, jobs: [] };
        runs.set(run.id, run);
      }
      const job = {
        id: row.id, runId: row.run_id, run, leadId: String(row.lead_id), position: row.position,
        name: '', prevStatus: null, destination: row.destination, state: row.state,
        attempts: row.attempts, callSid: row.call_sid, outcome: row.outcome, error: row.error,
        enqueuedAt: Date.parse(row.enqueued_at), dequeuedAt: Date.parse(row.dequeued_at) || null,
        requestStartedAt: Date.parse(row.request_started_at) || null,
        acceptedAt: Date.parse(row.accepted_at) || null, endedAt: null, nextAttemptAt: null, gapMs: null,
      };
      if (job.state === 'dialing' && job.callSid) job.state = 'active';
      if (job.callSid) { jobsBySid.set(job.callSid, job); job.acceptedAt = 0; } // watchdog verifies on next tick
      run.jobs.push(job);
      if (job.state === 'dialing') {
        // Unknown whether Telnyx placed it — never risk dialing the student twice.
        finish(job, 'failed', 'interrupted-by-restart');
      }
    }
    logger.info(`[BULK] resumed ${data.length} unfinished job(s) across ${new Set(data.map(r => r.run_id)).size} run(s)`);
    for (const run of runs.values()) emitProgress(run);
    pump();
  } catch (e) {
    logger.warn(`[BULK] resume failed: ${e.message}`);
  }
}

function list() {
  return [...runs.values()].sort((a, b) => b.createdAt - a.createdAt).map(summary);
}

function getRun(runId) {
  const run = runs.get(runId);
  if (!run) return null;
  return {
    ...summary(run),
    jobs: run.jobs.map(j => ({
      jobId: j.id, leadId: j.leadId, name: j.name, destination: j.destination, state: j.state,
      outcome: j.outcome, callSid: j.callSid, attempts: j.attempts, error: j.error,
      enqueuedAt: iso(j.enqueuedAt), dequeuedAt: iso(j.dequeuedAt), requestStartedAt: iso(j.requestStartedAt),
      acceptedAt: iso(j.acceptedAt), endedAt: iso(j.endedAt), gapAfterPrevEndMs: j.gapMs,
    })),
  };
}

module.exports = { enqueue, onCallEnded, stopRun, cancelLead, start, list, getRun, RING_TIMEOUT_SECS, CONCURRENCY };

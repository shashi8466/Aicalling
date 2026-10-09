-- ═══════════════════════════════════════════════════════════════════════
--  Bulk call queue — one row per student per bulk-call campaign run.
--  Lets an in-progress run resume after a server restart/redeploy and keeps
--  per-call timing diagnostics. Idempotent (safe to re-run).
--
--  Job lifecycle:  queued → dialing → active → completed | no-answer | failed
--                  queued → skipped   (no/invalid phone)
--                  queued|dialing|active → canceled  (campaign stopped)
-- ═══════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS call_jobs (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id             TEXT NOT NULL,             -- one bulk launch
  lead_id            TEXT NOT NULL,
  position           INTEGER NOT NULL DEFAULT 0, -- dial order within the run
  state              TEXT NOT NULL DEFAULT 'queued',
  destination        TEXT DEFAULT '',
  call_sid           TEXT,                      -- Telnyx call_control_id
  attempts           INTEGER NOT NULL DEFAULT 0,
  outcome            TEXT DEFAULT '',           -- provider CallStatus
  error              TEXT DEFAULT '',
  run_meta           JSONB,                     -- campaignId, campaignVars, classId, counselor (repeated per row)
  enqueued_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  dequeued_at        TIMESTAMPTZ,
  request_started_at TIMESTAMPTZ,
  accepted_at        TIMESTAMPTZ,
  ended_at           TIMESTAMPTZ,
  next_attempt_at    TIMESTAMPTZ,
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_call_jobs_run      ON call_jobs(run_id);
CREATE INDEX IF NOT EXISTS idx_call_jobs_state    ON call_jobs(state);
CREATE INDEX IF NOT EXISTS idx_call_jobs_call_sid ON call_jobs(call_sid);

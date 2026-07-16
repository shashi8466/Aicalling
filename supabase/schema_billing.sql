-- ═══════════════════════════════════════════════════════════════════════
--  Aiprep365 — Real-Time Twilio Billing Schema
--  Run AFTER schema.sql and schema_campaigns.sql. Idempotent (safe to re-run).
--
--  Stores the ACTUAL Twilio price for every AI call. Twilio does not return
--  `price` in the call-status webhook — it appears on the Call resource a few
--  seconds to minutes later — so rows are created with billing_status='pending'
--  and a background poller (src/jobs/billingPoller.js) fetches the real price
--  and flips them to 'final'. Fields are denormalized so reports need no joins.
-- ═══════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS call_billing (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Twilio call identity (unique → dedup + safe concurrent upserts)
  call_sid          TEXT UNIQUE NOT NULL,

  -- Relationships (denormalized copies kept below for join-free reporting)
  lead_id           UUID REFERENCES leads(id) ON DELETE SET NULL,
  -- campaign_id FK is added in a guarded block below so this migration is safe
  -- regardless of whether the campaigns table has been created yet.
  campaign_id       UUID,
  campaign_name     TEXT DEFAULT '',
  counselor_id      TEXT DEFAULT '',              -- profiles.id (as text) or ''

  -- Denormalized lead context
  student_name      TEXT DEFAULT '',
  parent_name       TEXT DEFAULT '',
  phone_number      TEXT DEFAULT '',              -- lead phone (the person called)

  -- Twilio call metadata
  from_number       TEXT DEFAULT '',
  to_number         TEXT DEFAULT '',
  direction         TEXT DEFAULT '',
  duration_seconds  INTEGER DEFAULT 0,
  duration_minutes  NUMERIC DEFAULT 0,            -- ceil(seconds / 60) = billed minutes

  -- Actual Twilio billing (NEVER estimated)
  twilio_price      NUMERIC,                      -- absolute value; NULL while pending
  price_per_minute  NUMERIC,                      -- twilio_price / billed minutes (derived)
  currency          TEXT DEFAULT 'USD',
  call_status       TEXT DEFAULT '',              -- completed | no-answer | busy | failed | canceled | voicemail

  -- Recording (SID + playback URL, when Twilio captured audio)
  recording_sid     TEXT DEFAULT '',
  recording_url     TEXT DEFAULT '',

  -- Provenance: 'live' (captured in real time) or 'historical-import' (backfill)
  source            TEXT NOT NULL DEFAULT 'live',

  -- Billing lifecycle
  billing_status    TEXT NOT NULL DEFAULT 'pending'  -- pending | final | unavailable
                    CHECK (billing_status IN ('pending','final','unavailable')),
  fetch_attempts    INTEGER DEFAULT 0,

  started_at        TIMESTAMPTZ,
  ended_at          TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Forward-compat: add the newer columns if an earlier version of this table
-- already exists (idempotent — safe to re-run).
ALTER TABLE call_billing ADD COLUMN IF NOT EXISTS price_per_minute NUMERIC;
ALTER TABLE call_billing ADD COLUMN IF NOT EXISTS recording_sid TEXT DEFAULT '';
ALTER TABLE call_billing ADD COLUMN IF NOT EXISTS recording_url TEXT DEFAULT '';
ALTER TABLE call_billing ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'live';

-- Key/value marker table so the one-time historical import runs only once.
CREATE TABLE IF NOT EXISTS billing_meta (
  key        TEXT PRIMARY KEY,
  value      TEXT DEFAULT '',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for scale (thousands of calls) + the poller's pending scan
CREATE INDEX IF NOT EXISTS idx_billing_lead        ON call_billing(lead_id);
CREATE INDEX IF NOT EXISTS idx_billing_campaign     ON call_billing(campaign_id);
CREATE INDEX IF NOT EXISTS idx_billing_counselor    ON call_billing(counselor_id);
CREATE INDEX IF NOT EXISTS idx_billing_created      ON call_billing(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_billing_status       ON call_billing(billing_status);
CREATE INDEX IF NOT EXISTS idx_billing_call_status  ON call_billing(call_status);
CREATE INDEX IF NOT EXISTS idx_billing_source       ON call_billing(source);
-- Partial index the backfill poller uses to find rows still awaiting a price
CREATE INDEX IF NOT EXISTS idx_billing_pending
  ON call_billing(created_at) WHERE billing_status = 'pending';

-- Keep updated_at fresh (reuses set_updated_at() created in schema.sql)
DROP TRIGGER IF EXISTS trg_billing_updated_at ON call_billing;
CREATE TRIGGER trg_billing_updated_at
  BEFORE UPDATE ON call_billing
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Add the campaign FK only if the campaigns table exists and the constraint
-- isn't already present. Order-independent + idempotent (safe to re-run).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'campaigns')
     AND NOT EXISTS (
       SELECT 1 FROM information_schema.table_constraints
       WHERE constraint_name = 'fk_call_billing_campaign' AND table_name = 'call_billing')
  THEN
    ALTER TABLE call_billing
      ADD CONSTRAINT fk_call_billing_campaign
      FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE SET NULL;
  END IF;
END $$;

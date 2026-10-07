-- ═══════════════════════════════════════════════════════════════════════
--  Telnyx Billing — makes Telnyx the billing source of truth.
--  Run AFTER schema_billing.sql. Idempotent (safe to re-run).
--
--  Lifecycle of a Telnyx call row in call_billing:
--    1. call.initiated  → row created (provider='telnyx', call_status='initiated')
--    2. call.answered   → answered_at set
--    3. call.hangup     → duration, billable_seconds (Telnyx increments) and an
--                         ESTIMATED cost from telnyx_rates  (cost_type='estimated')
--    4. reconciliation  → Telnyx Detail Records summed per call; cost replaced by
--                         Telnyx's own figure (cost_type='reconciled',
--                         billing_status='final')
--  Pre-Telnyx rows are tagged provider='historical' and never mixed in by default.
-- ═══════════════════════════════════════════════════════════════════════

-- ── New columns on call_billing ─────────────────────────────────────────
ALTER TABLE call_billing ADD COLUMN IF NOT EXISTS provider              TEXT NOT NULL DEFAULT 'historical';
ALTER TABLE call_billing ADD COLUMN IF NOT EXISTS call_session_id       TEXT;
ALTER TABLE call_billing ADD COLUMN IF NOT EXISTS call_leg_id           TEXT;
ALTER TABLE call_billing ADD COLUMN IF NOT EXISTS connection_id         TEXT DEFAULT '';
ALTER TABLE call_billing ADD COLUMN IF NOT EXISTS campaign_type         TEXT DEFAULT '';
ALTER TABLE call_billing ADD COLUMN IF NOT EXISTS class_id              TEXT DEFAULT '';
ALTER TABLE call_billing ADD COLUMN IF NOT EXISTS destination_number    TEXT DEFAULT '';   -- E.164
ALTER TABLE call_billing ADD COLUMN IF NOT EXISTS destination_country   TEXT DEFAULT '';   -- ISO-3166 alpha-2
ALTER TABLE call_billing ADD COLUMN IF NOT EXISTS destination_prefix    TEXT DEFAULT '';   -- country dialing code, e.g. '1', '91'
ALTER TABLE call_billing ADD COLUMN IF NOT EXISTS hangup_cause          TEXT DEFAULT '';
ALTER TABLE call_billing ADD COLUMN IF NOT EXISTS answered_by           TEXT DEFAULT '';   -- AMD result
ALTER TABLE call_billing ADD COLUMN IF NOT EXISTS answered_at           TIMESTAMPTZ;
ALTER TABLE call_billing ADD COLUMN IF NOT EXISTS billable_seconds      INTEGER;
ALTER TABLE call_billing ADD COLUMN IF NOT EXISTS billing_increment     TEXT DEFAULT '';   -- e.g. '60/60'
ALTER TABLE call_billing ADD COLUMN IF NOT EXISTS estimated_rate_per_min NUMERIC;
ALTER TABLE call_billing ADD COLUMN IF NOT EXISTS estimated_cost        NUMERIC;
ALTER TABLE call_billing ADD COLUMN IF NOT EXISTS telnyx_cost           NUMERIC;           -- reconciled (Telnyx Detail Records)
ALTER TABLE call_billing ADD COLUMN IF NOT EXISTS telnyx_rate           NUMERIC;
ALTER TABLE call_billing ADD COLUMN IF NOT EXISTS telnyx_billed_seconds INTEGER;
ALTER TABLE call_billing ADD COLUMN IF NOT EXISTS telnyx_cost_breakdown JSONB;             -- { record_type: cost }
ALTER TABLE call_billing ADD COLUMN IF NOT EXISTS reconciled_at         TIMESTAMPTZ;
-- The single amount every report aggregates: reconciled Telnyx cost when known,
-- otherwise the estimate (Telnyx) or the stored price (historical).
ALTER TABLE call_billing ADD COLUMN IF NOT EXISTS cost_amount           NUMERIC;
ALTER TABLE call_billing ADD COLUMN IF NOT EXISTS cost_type             TEXT DEFAULT 'historical'; -- estimated | reconciled | historical

-- ── Backfill provider / cost fields for existing rows ──────────────────
-- Telnyx call_control_ids start with 'v2:' / 'v3:'; everything else predates Telnyx.
UPDATE call_billing SET provider = 'telnyx'
 WHERE (call_sid LIKE 'v2:%' OR call_sid LIKE 'v3:%') AND provider <> 'telnyx';

UPDATE call_billing
   SET cost_amount = twilio_price, cost_type = 'historical'
 WHERE provider = 'historical' AND cost_amount IS NULL;

-- Old Telnyx rows were stored with a placeholder (no price, zero duration) and
-- often marked 'unavailable'. Reset them so reconciliation can price them.
UPDATE call_billing
   SET billing_status = 'pending', cost_type = 'estimated', twilio_price = NULL
 WHERE provider = 'telnyx' AND telnyx_cost IS NULL AND billing_status <> 'final';

CREATE INDEX IF NOT EXISTS idx_billing_provider     ON call_billing(provider);
CREATE INDEX IF NOT EXISTS idx_billing_session      ON call_billing(call_session_id);
CREATE INDEX IF NOT EXISTS idx_billing_dest_country ON call_billing(destination_country);
CREATE INDEX IF NOT EXISTS idx_billing_campaign_type ON call_billing(campaign_type);

-- ── Destination rates ──────────────────────────────────────────────────
-- One row per destination country (ISO-3166 alpha-2, from the E.164 number;
-- +1 numbers are split into US / CA / Caribbean by area code). No rates are hardcoded:
--   • learned_rate_per_min is filled automatically from reconciled Telnyx
--     Detail Records (actual cost ÷ billable minutes, all components);
--   • rate_per_min is an optional admin override (all-in $/billable minute).
-- Estimates use rate_per_min if set, otherwise learned_rate_per_min.
CREATE TABLE IF NOT EXISTS telnyx_rates (
  country_code                 TEXT PRIMARY KEY,          -- ISO alpha-2, e.g. 'US', 'IN'
  dial_code                    TEXT DEFAULT '',           -- informational, e.g. '1', '91'
  country_name                 TEXT DEFAULT '',
  rate_per_min                 NUMERIC,                   -- manual override
  learned_rate_per_min         NUMERIC,                   -- from Telnyx Detail Records
  learned_samples              INTEGER DEFAULT 0,
  learned_at                   TIMESTAMPTZ,
  billing_increment_initial    INTEGER NOT NULL DEFAULT 60,
  billing_increment_subsequent INTEGER NOT NULL DEFAULT 60,
  currency                     TEXT DEFAULT 'USD',
  notes                        TEXT DEFAULT '',
  updated_at                   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DROP TRIGGER IF EXISTS trg_telnyx_rates_updated_at ON telnyx_rates;
CREATE TRIGGER trg_telnyx_rates_updated_at
  BEFORE UPDATE ON telnyx_rates
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

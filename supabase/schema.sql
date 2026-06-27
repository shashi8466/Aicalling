-- ============================================================
--  Aiprep365 — Supabase PostgreSQL Schema
--  Run this once in the Supabase SQL editor to create all tables.
-- ============================================================

-- ── Leads ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS leads (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name           TEXT NOT NULL,
  grade               TEXT DEFAULT '',
  email               TEXT UNIQUE,
  phone               TEXT DEFAULT '',
  parent_name         TEXT DEFAULT '',
  parent_email        TEXT DEFAULT '',
  course_interest     TEXT DEFAULT '',
  submission_date     TIMESTAMPTZ,
  sheet_row_index     INTEGER,
  source              TEXT DEFAULT 'google-sheets',
  status              TEXT DEFAULT 'new',
  lead_score          INTEGER DEFAULT 0,
  lead_category       TEXT DEFAULT 'cold',
  is_qualified        BOOLEAN DEFAULT FALSE,
  total_call_attempts INTEGER DEFAULT 0,
  last_call_at        TIMESTAMPTZ,
  next_retry_at       TIMESTAMPTZ,
  notes               TEXT DEFAULT '',
  -- JSONB columns preserve exact camelCase structure used by the app
  call_attempts       JSONB DEFAULT '[]'::jsonb,
  qualification       JSONB DEFAULT '{}'::jsonb,
  meeting             JSONB DEFAULT '{}'::jsonb,
  emails_sent         JSONB DEFAULT '[]'::jsonb,
  whatsapp_sent       JSONB DEFAULT '[]'::jsonb,
  created_at          TIMESTAMPTZ DEFAULT NOW(),
  updated_at          TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_leads_email         ON leads(email);
CREATE INDEX IF NOT EXISTS idx_leads_phone         ON leads(phone);
CREATE INDEX IF NOT EXISTS idx_leads_status        ON leads(status);
CREATE INDEX IF NOT EXISTS idx_leads_score         ON leads(lead_score DESC);
CREATE INDEX IF NOT EXISTS idx_leads_retry         ON leads(next_retry_at);
CREATE INDEX IF NOT EXISTS idx_leads_category      ON leads(lead_category);
CREATE INDEX IF NOT EXISTS idx_leads_last_call     ON leads(last_call_at);
CREATE INDEX IF NOT EXISTS idx_leads_sheet_row     ON leads(sheet_row_index);

-- ── Follow-ups ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS follow_ups (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id        UUID REFERENCES leads(id) ON DELETE CASCADE,
  followup_type  TEXT,
  cycle          INTEGER DEFAULT 0,
  scheduled_date TIMESTAMPTZ,
  completed      BOOLEAN DEFAULT FALSE,
  completed_at   TIMESTAMPTZ,
  notes          TEXT DEFAULT '',
  result         TEXT DEFAULT '',
  created_at     TIMESTAMPTZ DEFAULT NOW(),
  updated_at     TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_fu_lead      ON follow_ups(lead_id);
CREATE INDEX IF NOT EXISTS idx_fu_scheduled ON follow_ups(scheduled_date);
CREATE INDEX IF NOT EXISTS idx_fu_pending   ON follow_ups(completed, scheduled_date) WHERE completed = false;

-- ── Enrollments ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS enrollments (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id           UUID REFERENCES leads(id),
  student_name      TEXT,
  grade             TEXT DEFAULT '',
  parent_name       TEXT DEFAULT '',
  parent_email      TEXT DEFAULT '',
  parent_phone      TEXT DEFAULT '',
  program           TEXT,
  exam_date         TIMESTAMPTZ,
  learning_mode     TEXT DEFAULT 'online',
  payment_plan      TEXT DEFAULT 'full',
  program_fee       NUMERIC DEFAULT 0,
  enrollment_status TEXT DEFAULT 'pending',
  counselor_id      TEXT DEFAULT 'shashi-kumar',
  notes             TEXT DEFAULT '',
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  updated_at        TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_enroll_status  ON enrollments(enrollment_status);
CREATE INDEX IF NOT EXISTS idx_enroll_program ON enrollments(program);
CREATE INDEX IF NOT EXISTS idx_enroll_lead    ON enrollments(lead_id);

-- ── Payments ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS payments (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  enrollment_id  UUID REFERENCES enrollments(id),
  lead_id        UUID REFERENCES leads(id),
  amount         NUMERIC DEFAULT 0,
  amount_paid    NUMERIC DEFAULT 0,
  payment_status TEXT DEFAULT 'pending',
  payment_date   TIMESTAMPTZ,
  due_date       TIMESTAMPTZ,
  payment_method TEXT DEFAULT '',
  transaction_id TEXT DEFAULT '',
  program        TEXT DEFAULT '',
  notes          TEXT DEFAULT '',
  created_at     TIMESTAMPTZ DEFAULT NOW(),
  updated_at     TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pay_status      ON payments(payment_status);
CREATE INDEX IF NOT EXISTS idx_pay_enrollment  ON payments(enrollment_id);
CREATE INDEX IF NOT EXISTS idx_pay_lead        ON payments(lead_id);
CREATE INDEX IF NOT EXISTS idx_pay_date        ON payments(payment_date);

-- ── Meeting Outcomes ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS meeting_outcomes (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id      UUID REFERENCES leads(id),
  meeting_id   TEXT DEFAULT '',
  outcome      TEXT,
  notes        TEXT DEFAULT '',
  counselor_id TEXT DEFAULT 'shashi-kumar',
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  updated_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_mo_lead ON meeting_outcomes(lead_id);

-- ── Lead Objections ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS lead_objections (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id         UUID REFERENCES leads(id),
  objection_type  TEXT,
  notes           TEXT DEFAULT '',
  resolved        BOOLEAN DEFAULT FALSE,
  resolved_at     TIMESTAMPTZ,
  resolved_note   TEXT DEFAULT '',
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_obj_lead ON lead_objections(lead_id);
CREATE INDEX IF NOT EXISTS idx_obj_type ON lead_objections(objection_type);

-- ── Automatic updated_at trigger ────────────────────────────
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
DECLARE
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['leads','follow_ups','enrollments','payments','meeting_outcomes','lead_objections']
  LOOP
    EXECUTE format('
      DROP TRIGGER IF EXISTS trg_updated_at ON %I;
      CREATE TRIGGER trg_updated_at
        BEFORE UPDATE ON %I
        FOR EACH ROW EXECUTE FUNCTION set_updated_at();
    ', t, t);
  END LOOP;
END $$;

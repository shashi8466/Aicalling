-- ═══════════════════════════════════════════════════════════════════════
--  Aiprep365 — Campaign Management Schema
--  Run AFTER schema.sql. Safe to run multiple times (idempotent).
--
--  Adds outbound-calling CAMPAIGNS. Every lead may be assigned to a campaign;
--  the AI agent uses the matching conversation script during outbound calls.
--  Leads with a NULL campaign_id are treated as the default "Demo Test
--  Follow-up" campaign — i.e. the exact behaviour that existed before.
-- ═══════════════════════════════════════════════════════════════════════

-- 1. Campaigns table
CREATE TABLE IF NOT EXISTS campaigns (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL,
  type        TEXT NOT NULL,                 -- script key: demo-test-followup, sat-batch, …, custom
  program     TEXT DEFAULT '',               -- SAT / ACT / AP / College Admissions / …
  goal        TEXT DEFAULT '',
  description TEXT DEFAULT '',
  script      JSONB DEFAULT '{}'::jsonb,      -- optional overrides for custom campaigns
  status      TEXT NOT NULL DEFAULT 'active'  -- active | paused | completed
              CHECK (status IN ('active','paused','completed')),
  is_default  BOOLEAN NOT NULL DEFAULT FALSE, -- true for the 8 built-in campaigns
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- One built-in campaign per type (lets us upsert defaults safely).
CREATE UNIQUE INDEX IF NOT EXISTS uq_campaigns_default_type
  ON campaigns(type) WHERE is_default;

CREATE INDEX IF NOT EXISTS idx_campaigns_status ON campaigns(status);
CREATE INDEX IF NOT EXISTS idx_campaigns_type   ON campaigns(type);

-- Keep updated_at fresh (reuses the function created in schema.sql)
DROP TRIGGER IF EXISTS trg_campaigns_updated_at ON campaigns;
CREATE TRIGGER trg_campaigns_updated_at
  BEFORE UPDATE ON campaigns
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- 2. Assign leads to a campaign (nullable — existing leads stay unassigned = default)
ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS campaign_id UUID REFERENCES campaigns(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_leads_campaign ON leads(campaign_id);

-- 3. Seed the built-in campaigns (idempotent via the unique default-type index)
INSERT INTO campaigns (name, type, program, goal, description, status, is_default) VALUES
  ('Demo Test Follow-up',        'demo-test-followup',  'Multiple',           'Follow up on the demo test, understand interests, and schedule a free consultation.', 'Existing flow: students who already completed a demo test.', 'active', TRUE),
  ('SAT Batch Promotion',        'sat-batch',           'SAT',                'Invite students to the new SAT preparation batch and schedule a free counseling session.', 'New-audience outreach for the SAT Preparation Program.', 'active', TRUE),
  ('ACT Batch Promotion',        'act-batch',           'ACT',                'Invite students to the new ACT preparation batch and schedule a free counseling session.', 'New-audience outreach for the ACT Preparation Program.', 'active', TRUE),
  ('AP Course Promotion',        'ap-course',           'AP',                 'Invite students interested in AP courses and schedule a free counseling session.', 'New-audience outreach for AP courses.', 'active', TRUE),
  ('College Admissions Counseling','college-admissions','College Admissions', 'Invite students seeking undergraduate admissions guidance and schedule a free consultation.', 'Outreach for college admissions counseling.', 'active', TRUE),
  ('Scholarship Webinar',        'scholarship-webinar', 'Scholarships',       'Invite students and parents to the scholarship webinar and schedule a follow-up consultation.', 'Promote the scholarship webinar.', 'active', TRUE),
  ('Free Mock Test',             'free-mock-test',      'Mock Test',          'Invite students to take a free mock test and schedule a results-review consultation.', 'Promote the free mock test.', 'active', TRUE),
  ('Parent Counseling Session',  'parent-counseling',   'Parent Counseling',  'Invite parents to a counseling session and schedule a free consultation.', 'Parent-focused counseling outreach.', 'active', TRUE)
ON CONFLICT (type) WHERE is_default DO NOTHING;

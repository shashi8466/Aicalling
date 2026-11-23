-- ============================================================
--  Prep365 Students Schema
--  Run this in the Supabase SQL editor to create the students table.
-- ============================================================

CREATE TABLE IF NOT EXISTS prep365_students (
  id             TEXT PRIMARY KEY,
  student_name   TEXT NOT NULL,
  student_email  TEXT DEFAULT '',
  phone          TEXT DEFAULT '',
  grade          TEXT DEFAULT '',
  reasons        JSONB DEFAULT '[]'::jsonb,
  activity       JSONB DEFAULT '{}'::jsonb,
  tests          JSONB DEFAULT '{}'::jsonb,
  custom_prep    JSONB DEFAULT '[]'::jsonb,
  parents        JSONB DEFAULT '[]'::jsonb,
  talking_points TEXT DEFAULT '',
  priority       INTEGER DEFAULT 0,
  call_status    JSONB DEFAULT '{}'::jsonb,
  raw_data       JSONB DEFAULT '{}'::jsonb,
  updated_at     TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_prep365_students_priority ON prep365_students(priority DESC);
CREATE INDEX IF NOT EXISTS idx_prep365_students_email ON prep365_students(student_email);
CREATE INDEX IF NOT EXISTS idx_prep365_students_phone ON prep365_students(phone);

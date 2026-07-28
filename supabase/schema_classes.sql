-- ═══════════════════════════════════════════════════════════════════════
--  Aiprep365 — Classes / Groups Schema
--  Run AFTER schema.sql.
-- ═══════════════════════════════════════════════════════════════════════

-- 1. Classes table
CREATE TABLE IF NOT EXISTS classes (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_classes_name ON classes(name);

-- Keep updated_at fresh
DROP TRIGGER IF EXISTS trg_classes_updated_at ON classes;
CREATE TRIGGER trg_classes_updated_at
  BEFORE UPDATE ON classes
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- 2. Class Students join table (Many-to-Many)
CREATE TABLE IF NOT EXISTS class_students (
  class_id    UUID REFERENCES classes(id) ON DELETE CASCADE,
  lead_id     UUID REFERENCES leads(id) ON DELETE CASCADE,
  PRIMARY KEY (class_id, lead_id)
);

CREATE INDEX IF NOT EXISTS idx_class_students_lead_id ON class_students(lead_id);

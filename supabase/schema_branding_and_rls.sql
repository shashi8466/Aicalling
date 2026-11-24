-- ====================================================================
-- AIPrep365 Calling Application: Dynamic Branding & Role-Based RLS
-- ====================================================================

-- 1. Ensure lead ownership and counselor isolation columns exist
ALTER TABLE leads ADD COLUMN IF NOT EXISTS counselor_id UUID REFERENCES profiles(id) ON DELETE SET NULL;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS assigned_counselor_id UUID REFERENCES profiles(id) ON DELETE SET NULL;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES profiles(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_leads_assigned_counselor_id ON leads(assigned_counselor_id);
CREATE INDEX IF NOT EXISTS idx_leads_created_by ON leads(created_by);
CREATE INDEX IF NOT EXISTS idx_leads_counselor_id ON leads(counselor_id);

-- 2. Global Branding Table
CREATE TABLE IF NOT EXISTS app_branding (
  id TEXT PRIMARY KEY DEFAULT 'global',
  logo_url TEXT NOT NULL DEFAULT '/assets/hg_logo1.png',
  app_title TEXT NOT NULL DEFAULT 'Prep365 AI Calling',
  is_custom BOOLEAN NOT NULL DEFAULT FALSE,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  updated_by UUID REFERENCES profiles(id) ON DELETE SET NULL
);

-- Insert default row if empty
INSERT INTO app_branding (id, logo_url, app_title, is_custom, updated_at)
VALUES ('global', '/assets/hg_logo1.png', 'Prep365 AI Calling', FALSE, NOW())
ON CONFLICT (id) DO NOTHING;

-- 3. Row Level Security for Branding
ALTER TABLE app_branding ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public can view branding" ON app_branding;
CREATE POLICY "Public can view branding" ON app_branding
  FOR SELECT USING (true);

DROP POLICY IF EXISTS "Only admin can update branding" ON app_branding;
CREATE POLICY "Only admin can update branding" ON app_branding
  FOR ALL USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
  );

-- 4. Enhanced RLS for Leads Table supporting assigned_counselor_id and created_by
ALTER TABLE leads ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Counselor own leads select" ON leads;
CREATE POLICY "Counselor own leads select" ON leads
  FOR SELECT USING (
    counselor_id = auth.uid() OR
    assigned_counselor_id = auth.uid() OR
    created_by = auth.uid() OR
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
  );

DROP POLICY IF EXISTS "Counselor own leads update" ON leads;
CREATE POLICY "Counselor own leads update" ON leads
  FOR UPDATE USING (
    counselor_id = auth.uid() OR
    assigned_counselor_id = auth.uid() OR
    created_by = auth.uid() OR
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
  );

DROP POLICY IF EXISTS "Counselor own leads insert" ON leads;
CREATE POLICY "Counselor own leads insert" ON leads
  FOR INSERT WITH CHECK (
    counselor_id = auth.uid() OR
    assigned_counselor_id = auth.uid() OR
    created_by = auth.uid() OR
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
  );

DROP POLICY IF EXISTS "Counselor own leads delete" ON leads;
CREATE POLICY "Counselor own leads delete" ON leads
  FOR DELETE USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
  );

-- 5. RLS for Meetings supporting counselor isolation
ALTER TABLE meetings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Counselor own meetings select" ON meetings;
CREATE POLICY "Counselor own meetings select" ON meetings
  FOR SELECT USING (
    counselor_id = auth.uid() OR
    lead_id IN (
      SELECT id FROM leads
      WHERE counselor_id = auth.uid() OR assigned_counselor_id = auth.uid() OR created_by = auth.uid()
    ) OR
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
  );

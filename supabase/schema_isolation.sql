-- ====================================================================
-- Counselor Lead Isolation & RLS Migration
-- Run this script in the Supabase SQL Editor.
-- ====================================================================

-- 1. Add counselor_id to leads
ALTER TABLE leads ADD COLUMN IF NOT EXISTS counselor_id UUID REFERENCES profiles(id) ON DELETE SET NULL;

-- 2. Add counselor_id to meetings
ALTER TABLE meetings ADD COLUMN IF NOT EXISTS counselor_id UUID REFERENCES profiles(id) ON DELETE SET NULL;

-- 3. Add counselor_id to meeting_recordings
ALTER TABLE meeting_recordings ADD COLUMN IF NOT EXISTS counselor_id UUID REFERENCES profiles(id) ON DELETE SET NULL;

-- 4. Add counselor_id to meeting_transcripts
ALTER TABLE meeting_transcripts ADD COLUMN IF NOT EXISTS counselor_id UUID REFERENCES profiles(id) ON DELETE SET NULL;

-- 5. Add counselor_id to meeting_ai_analysis
ALTER TABLE meeting_ai_analysis ADD COLUMN IF NOT EXISTS counselor_id UUID REFERENCES profiles(id) ON DELETE SET NULL;

-- 6. Add indexes for performance (fixing application load performance)
CREATE INDEX IF NOT EXISTS idx_leads_counselor_id ON leads(counselor_id);
CREATE INDEX IF NOT EXISTS idx_meetings_counselor_id ON meetings(counselor_id);
CREATE INDEX IF NOT EXISTS idx_mr_counselor_id ON meeting_recordings(counselor_id);
CREATE INDEX IF NOT EXISTS idx_mt_counselor_id ON meeting_transcripts(counselor_id);
CREATE INDEX IF NOT EXISTS idx_maa_counselor_id ON meeting_ai_analysis(counselor_id);

-- Add missing performance indexes based on query patterns
CREATE INDEX IF NOT EXISTS idx_leads_created_at ON leads(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_meetings_scheduled_at ON meetings(scheduled_at DESC);

-- 7. Enable RLS on Leads and related tables
ALTER TABLE leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE meetings ENABLE ROW LEVEL SECURITY;
ALTER TABLE follow_ups ENABLE ROW LEVEL SECURITY;
ALTER TABLE enrollments ENABLE ROW LEVEL SECURITY;
ALTER TABLE payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE meeting_outcomes ENABLE ROW LEVEL SECURITY;
ALTER TABLE lead_objections ENABLE ROW LEVEL SECURITY;
ALTER TABLE meeting_recordings ENABLE ROW LEVEL SECURITY;
ALTER TABLE meeting_transcripts ENABLE ROW LEVEL SECURITY;
ALTER TABLE meeting_ai_analysis ENABLE ROW LEVEL SECURITY;

-- 8. Create Admin checking function
CREATE OR REPLACE FUNCTION auth.is_admin() RETURNS BOOLEAN AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND role = 'admin'
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 9. RLS Policies for Leads
-- Counselors can read/update their own leads. Admins can read/update all.
DROP POLICY IF EXISTS "Counselor own leads select" ON leads;
CREATE POLICY "Counselor own leads select" ON leads FOR SELECT USING (counselor_id = auth.uid() OR auth.is_admin());

DROP POLICY IF EXISTS "Counselor own leads update" ON leads;
CREATE POLICY "Counselor own leads update" ON leads FOR UPDATE USING (counselor_id = auth.uid() OR auth.is_admin());

DROP POLICY IF EXISTS "Counselor own leads insert" ON leads;
CREATE POLICY "Counselor own leads insert" ON leads FOR INSERT WITH CHECK (counselor_id = auth.uid() OR auth.is_admin());

DROP POLICY IF EXISTS "Counselor own leads delete" ON leads;
CREATE POLICY "Counselor own leads delete" ON leads FOR DELETE USING (counselor_id = auth.uid() OR auth.is_admin());

-- 10. RLS Policies for Meetings
DROP POLICY IF EXISTS "Counselor own meetings select" ON meetings;
CREATE POLICY "Counselor own meetings select" ON meetings FOR SELECT USING (
  counselor_id = auth.uid() OR auth.is_admin() OR 
  lead_id IN (SELECT id FROM leads WHERE counselor_id = auth.uid())
);

DROP POLICY IF EXISTS "Counselor own meetings insert" ON meetings;
CREATE POLICY "Counselor own meetings insert" ON meetings FOR INSERT WITH CHECK (
  counselor_id = auth.uid() OR auth.is_admin() OR 
  lead_id IN (SELECT id FROM leads WHERE counselor_id = auth.uid())
);

DROP POLICY IF EXISTS "Counselor own meetings update" ON meetings;
CREATE POLICY "Counselor own meetings update" ON meetings FOR UPDATE USING (
  counselor_id = auth.uid() OR auth.is_admin() OR 
  lead_id IN (SELECT id FROM leads WHERE counselor_id = auth.uid())
);

DROP POLICY IF EXISTS "Counselor own meetings delete" ON meetings;
CREATE POLICY "Counselor own meetings delete" ON meetings FOR DELETE USING (
  counselor_id = auth.uid() OR auth.is_admin() OR 
  lead_id IN (SELECT id FROM leads WHERE counselor_id = auth.uid())
);

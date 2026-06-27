-- ═══════════════════════════════════════════════════════════════════════
--  Aiprep365 — Auth Schema
--  Run AFTER schema.sql (which creates the leads/enrollments/etc tables)
-- ═══════════════════════════════════════════════════════════════════════

-- 1. Profiles — one row per Supabase auth.users entry
CREATE TABLE IF NOT EXISTS profiles (
  id          UUID        PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name   TEXT        NOT NULL DEFAULT '',
  email       TEXT        UNIQUE,
  role        TEXT        NOT NULL DEFAULT 'counselor'
                          CHECK (role IN ('admin', 'counselor')),
  is_active   BOOLEAN     NOT NULL DEFAULT true,
  phone       TEXT        NOT NULL DEFAULT '',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Auto-set updated_at
CREATE TRIGGER set_profiles_updated_at
  BEFORE UPDATE ON profiles
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- 2. Auto-create a profile row when a new Supabase auth user is created
CREATE OR REPLACE FUNCTION handle_new_auth_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name, email, role)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', split_part(NEW.email, '@', 1)),
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'role', 'counselor')
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_auth_user();

-- 3. Add counselor-assignment column to leads
ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS assigned_counselor_id UUID REFERENCES profiles(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_leads_assigned_counselor
  ON leads(assigned_counselor_id);

-- 4. RLS policies — turn on RLS so anon key cannot read profiles
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

-- Service role bypasses RLS; authenticated users can only read their own profile
CREATE POLICY "Users can view own profile"
  ON profiles FOR SELECT
  USING (auth.uid() = id);

CREATE POLICY "Users can update own profile"
  ON profiles FOR UPDATE
  USING (auth.uid() = id);

-- Service role key (used server-side) bypasses all RLS automatically

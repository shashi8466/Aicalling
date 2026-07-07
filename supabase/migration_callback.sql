-- Migration to create callback_requests table
CREATE TABLE IF NOT EXISTS callback_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id UUID REFERENCES leads(id) ON DELETE SET NULL,
  student_name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT DEFAULT '',
  requested_time TEXT NOT NULL,
  timezone TEXT DEFAULT 'CST',
  scheduled_at TIMESTAMPTZ NOT NULL,
  status TEXT DEFAULT 'Pending',
  retry_count INT DEFAULT 0,
  last_attempt_at TIMESTAMPTZ,
  notes TEXT DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

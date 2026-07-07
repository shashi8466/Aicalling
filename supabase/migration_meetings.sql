-- Migration to create meetings and meeting_reminders tables
CREATE TABLE IF NOT EXISTS meetings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id UUID REFERENCES leads(id) ON DELETE CASCADE,
  campaign_id UUID REFERENCES campaigns(id) ON DELETE SET NULL,
  scheduled_at TIMESTAMPTZ NOT NULL,
  date TEXT NOT NULL,
  time TEXT NOT NULL,
  timezone TEXT DEFAULT 'America/New_York',
  room_name TEXT NOT NULL,
  meet_link TEXT NOT NULL,
  status TEXT DEFAULT 'Scheduled',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS meeting_reminders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  meeting_id UUID REFERENCES meetings(id) ON DELETE CASCADE,
  lead_id UUID REFERENCES leads(id) ON DELETE CASCADE,
  reminder_type TEXT NOT NULL, -- '24h', '1h', '10m'
  scheduled_at TIMESTAMPTZ NOT NULL,
  sent BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

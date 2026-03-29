-- WebIntel Supabase Schema
-- Run this in your Supabase SQL editor: https://supabase.com/dashboard

-- Reports table
CREATE TABLE IF NOT EXISTS reports (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id  text UNIQUE NOT NULL,
  query       text NOT NULL,
  mode        text NOT NULL,
  query_type  text NOT NULL,
  report      jsonb NOT NULL,
  overall_confidence float8 DEFAULT 0,
  created_at  timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_reports_session ON reports(session_id);
CREATE INDEX IF NOT EXISTS idx_reports_created ON reports(created_at DESC);

-- Monitors table (scheduled recurring queries)
CREATE TABLE IF NOT EXISTS monitors (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  query          text NOT NULL,
  mode           text NOT NULL DEFAULT 'research',
  interval_hours integer NOT NULL DEFAULT 24,
  last_run       timestamptz,
  next_run       timestamptz,
  active         boolean DEFAULT true,
  created_at     timestamptz DEFAULT now()
);

-- Diffs table (track mode comparison results)
CREATE TABLE IF NOT EXISTS diffs (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  monitor_id     uuid REFERENCES monitors(id),
  old_session_id text,
  new_session_id text,
  diff           jsonb NOT NULL,
  created_at     timestamptz DEFAULT now()
);

-- Enable Row Level Security (optional for production)
-- ALTER TABLE reports ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE monitors ENABLE ROW LEVEL SECURITY;

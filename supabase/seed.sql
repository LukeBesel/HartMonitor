-- supabase/seed.sql
-- Demo data for development/staging only.
-- NEVER run in production — this inserts known credentials.
--
-- Usage:
--   psql $DATABASE_URL < supabase/seed.sql
-- or paste into the Supabase SQL editor.

-- Demo organization
INSERT INTO organizations (id, name, slug)
VALUES ('00000000-0000-0000-0000-000000000001', 'Demo Manufacturing Co.', 'demo-mfg')
ON CONFLICT (id) DO NOTHING;

-- Demo org settings
INSERT INTO org_settings (company_id, key, value) VALUES
  ('00000000-0000-0000-0000-000000000001', 'company_name',     'Demo Manufacturing Co.'),
  ('00000000-0000-0000-0000-000000000001', 'timezone',         'America/New_York'),
  ('00000000-0000-0000-0000-000000000001', 'date_format',      'MM/DD/YYYY'),
  ('00000000-0000-0000-0000-000000000001', 'currency',         'USD')
ON CONFLICT (company_id, key) DO NOTHING;

-- Demo plan (free tier)
INSERT INTO plan (tier, app_limit, dashboard_limit, company_id)
VALUES ('free', 5, 2, '00000000-0000-0000-0000-000000000001')
ON CONFLICT DO NOTHING;

-- Demo primary site
INSERT INTO sites (id, company_id, name, code, is_primary)
VALUES ('00000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-000000000001', 'Main Site', 'MAIN', TRUE)
ON CONFLICT (id) DO NOTHING;

-- Demo users
-- Passwords below use the same scrypt format as the app (salt:hash).
-- Replace the password_hash values with real hashes before use,
-- or let the app's seedUsers() / ensureDemoUsers() functions generate them.
INSERT INTO users (id, email, display_name, password_hash, role, company_id, is_active) VALUES
  (
    '00000000-0000-0000-0000-000000000100',
    'admin@demo.local',
    'Demo Admin',
    -- password: Demo123! — CHANGE BEFORE USE
    'changeme:changeme',
    'developer',
    '00000000-0000-0000-0000-000000000001',
    TRUE
  ),
  (
    '00000000-0000-0000-0000-000000000101',
    'operator@demo.local',
    'Demo Operator',
    -- password: Operator1 — CHANGE BEFORE USE
    'changeme:changeme',
    'operator',
    '00000000-0000-0000-0000-000000000001',
    TRUE
  )
ON CONFLICT (email) DO NOTHING;

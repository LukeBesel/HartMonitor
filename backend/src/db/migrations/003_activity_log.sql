-- Ensure activity_log table exists with all columns.
-- The base table already exists in db.js; this adds columns that may be missing.
CREATE TABLE IF NOT EXISTS activity_log (
  id          TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  company_id  TEXT,
  user_id     TEXT,
  user_email  TEXT,
  action      TEXT NOT NULL,
  entity_type TEXT,
  entity_id   TEXT,
  metadata    TEXT DEFAULT '{}',
  ip_address  TEXT,
  created_at  TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_activity_log_company_created ON activity_log(company_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_activity_log_entity ON activity_log(entity_type, entity_id);
ALTER TABLE activity_log ADD COLUMN user_id TEXT;
ALTER TABLE activity_log ADD COLUMN user_email TEXT;
ALTER TABLE activity_log ADD COLUMN metadata TEXT DEFAULT '{}';
ALTER TABLE activity_log ADD COLUMN ip_address TEXT;

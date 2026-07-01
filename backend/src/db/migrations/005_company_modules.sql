-- ─── Composable MES: per-company module toggles ──────────────────────────────
-- Each company composes exactly the MES it needs by turning modules on/off.
-- Absence of a row means the module is ENABLED (default-on), so existing
-- customers see no change when this ships. Core modules (production,
-- analytics) can never be disabled — enforced at the API layer.
--
-- Applied idempotently at startup by backend/src/routes/modules.js.

CREATE TABLE IF NOT EXISTS company_modules (
  company_id TEXT NOT NULL,
  module_key TEXT NOT NULL,
  enabled    INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT DEFAULT (datetime('now')),
  PRIMARY KEY (company_id, module_key)
);

CREATE INDEX IF NOT EXISTS idx_company_modules_company ON company_modules(company_id);

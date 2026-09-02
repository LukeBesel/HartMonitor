-- ─── A published app is a numbered revision ──────────────────────────────────
-- 010 / workstream: app-revisions-and-approval
--
-- apps.status only ever held 'draft' or 'published', and publishing was a bare
-- UPDATE. Editing a published app therefore silently changed what every
-- historical run had been measured against, and nothing anywhere recorded which
-- instructions an operator actually saw. The product ships a demo CAPA about an
-- SOP revised without change control; this is that hole in its own engine.
--
-- app_revisions is an IMMUTABLE snapshot of the app's executable definition at
-- the moment somebody published it: the four columns the player reads (steps,
-- variables, step_groups, schema_version — read off the live apps table, not
-- the stale CREATE in db.js), the change note the publisher had to type, who
-- published it and, when the app requires approval, who signed it off. Rows are
-- written once and never updated; editing the app writes the draft in `apps`
-- and leaves every revision alone.
--
-- apps.current_revision is the number of the revision that is live (0 = never
-- published under change control — every app that exists today). Runs stamp
-- completions.app_revision_id at start, server-side; a NULL there means "this
-- run predates revisions", which the UI must say rather than guess a Rev 1.
--
-- Nothing is backdated: existing runs keep their NULL forever, because nobody
-- knows what the app looked like when they ran.

CREATE TABLE IF NOT EXISTS app_revisions (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL,
  app_id TEXT NOT NULL,
  revision INTEGER NOT NULL,
  steps TEXT NOT NULL DEFAULT '[]',
  variables TEXT NOT NULL DEFAULT '[]',
  step_groups TEXT NOT NULL DEFAULT '[]',
  schema_version INTEGER,
  change_note TEXT NOT NULL DEFAULT '',
  published_by_user_id TEXT,
  approved_by_user_id TEXT,
  effective_at TEXT NOT NULL DEFAULT (datetime('now')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(company_id, app_id, revision)
);

CREATE INDEX IF NOT EXISTS idx_app_revisions_app
  ON app_revisions(company_id, app_id, revision DESC);

ALTER TABLE apps ADD COLUMN current_revision INTEGER NOT NULL DEFAULT 0;
ALTER TABLE apps ADD COLUMN requires_approval INTEGER NOT NULL DEFAULT 0;

ALTER TABLE completions ADD COLUMN app_revision_id TEXT;

CREATE INDEX IF NOT EXISTS idx_completions_app_revision
  ON completions(company_id, app_revision_id);

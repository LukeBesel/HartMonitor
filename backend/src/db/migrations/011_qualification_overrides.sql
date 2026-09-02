-- ─── Qualified people only, and a permanent record of every exception ────────
-- 011 / workstream: run-start-gated-and-one-tap
--
-- training_records have existed since the training module shipped, and nothing
-- has ever read them at run start. Showing an auditor a skills matrix and then
-- admitting the software never checks it is worse than not having the matrix.
--
-- Two things land here.
--
-- 1. `qualification_overrides` — the permanent, attributable record of a run
--    that started WITHOUT the certification the plant asked for. A supervisor's
--    PIN is what mints one, and both people are named on it: the operator who
--    could not start, and the supervisor who said start anyway. It is written
--    the moment the override is consumed, so an override that is granted and
--    then not used still leaves a trace; `completion_id` is filled in once the
--    run it permitted actually books its row.
--
-- 2. `completions.qualification_state` — what was true of the operator at the
--    moment the run started, frozen onto the run. It is NOT derived later: a
--    certificate that lapses next month must not retroactively rewrite what
--    last week's run was.
--
--    Values come from vocab.QUALIFICATION_STATE ('certified','override',
--    'none','expired') or the empty string, which means NOT MEASURED — the
--    company had enforcement off, or the app asks for no certification at all.
--    There is deliberately NO CHECK constraint: '' is not a vocabulary value
--    and would have to be smuggled into the frozen list to be allowed, and
--    unlike a status word this vocabulary is expected to grow (a "provisional"
--    or "supervised" state is a plausible next step) — a CHECK here could not
--    be altered later without rebuilding the completions table on live customer
--    data. backend/src/qualification.js validates the value in JS instead, at
--    the one place that writes it.
--
-- The ENFORCEMENT MODE itself is not a column: it is an `org_settings` row,
-- key `training_enforcement`, value from vocab.TRAINING_ENFORCEMENT, absent
-- meaning 'off'. Absent is the whole point — every existing customer keeps
-- starting runs exactly as they do today until a manager chooses otherwise.

CREATE TABLE IF NOT EXISTS qualification_overrides (
  id                   TEXT PRIMARY KEY,
  company_id           TEXT NOT NULL,
  completion_id        TEXT,
  app_id               TEXT NOT NULL,
  user_id              TEXT,
  operator_name        TEXT NOT NULL DEFAULT '',
  approved_by_user_id  TEXT NOT NULL,
  approved_by_name     TEXT NOT NULL DEFAULT '',
  reason               TEXT NOT NULL DEFAULT '',
  created_at           TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_qualification_overrides_company
  ON qualification_overrides(company_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_qualification_overrides_app
  ON qualification_overrides(company_id, app_id);

ALTER TABLE completions ADD COLUMN qualification_state TEXT NOT NULL DEFAULT '';

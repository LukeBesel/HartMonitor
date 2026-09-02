-- ─── Andon escalation + one coded reason list per company ────────────────────
-- 007 / workstream: calls-escalate-and-pm-raises-jobs
--
-- Two things a help call never had: a CLOCK and a NEXT PERSON. A call that
-- nobody acknowledged sat open forever with nothing chasing it — routing
-- resolved the recipients once and stopped caring. `respond_by` is the target
-- the call is measured against, and `escalation_level` is how many tiers it has
-- climbed (0, 1 or 2).
--
-- Escalation is a LEVEL, not a new status word. andon_calls.status is already
-- constrained to its three original words and SQLite cannot alter a constraint
-- in place, so adding an "escalated" status would mean rebuilding the table on
-- live customer data. An escalated call is therefore still open — which is also
-- the truth: nobody has answered it.
--
-- reason_codes is the ONE coded list a company keeps for the three streams that
-- capture a reason (scrap, rework, downtime). Its constrained word lists below
-- are quoted verbatim from backend/src/vocab.js (REASON_KIND and LOSS_BUCKET);
-- a test compares this file's lists to that module so the two cannot drift.
-- loss_bucket carries '' for a reason that maps to no OEE loss (every scrap
-- reason, for instance), which is why '' leads the list.

ALTER TABLE andon_calls ADD COLUMN escalation_level INTEGER NOT NULL DEFAULT 0;
ALTER TABLE andon_calls ADD COLUMN escalated_at TEXT;
ALTER TABLE andon_calls ADD COLUMN respond_by TEXT;
ALTER TABLE andon_calls ADD COLUMN escalated_to_user_id TEXT;

CREATE INDEX IF NOT EXISTS idx_andon_calls_respond_by
  ON andon_calls(status, respond_by);

-- Response/escalation targets, per team and priority. A company gets a seeded
-- default set on the first read; managers edit them from the Andon board.
CREATE TABLE IF NOT EXISTS andon_targets (
  id               TEXT PRIMARY KEY,
  company_id       TEXT NOT NULL,
  team             TEXT NOT NULL,
  priority         TEXT NOT NULL,
  respond_minutes  INTEGER NOT NULL,
  escalate_minutes INTEGER NOT NULL,
  escalate_to_team TEXT,
  UNIQUE(company_id, team, priority)
);

CREATE INDEX IF NOT EXISTS idx_andon_targets_company ON andon_targets(company_id);

CREATE TABLE IF NOT EXISTS reason_codes (
  id          TEXT PRIMARY KEY,
  company_id  TEXT NOT NULL,
  kind        TEXT NOT NULL CHECK(kind IN ('scrap','rework','downtime')),
  code        TEXT NOT NULL,
  label       TEXT NOT NULL,
  loss_bucket TEXT NOT NULL DEFAULT '' CHECK(loss_bucket IN ('','breakdown','setup_adjustment','minor_stop','speed_loss','startup_reject','process_reject')),
  is_active   INTEGER NOT NULL DEFAULT 1,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(company_id, kind, code)
);

CREATE INDEX IF NOT EXISTS idx_reason_codes_lookup
  ON reason_codes(company_id, kind, is_active, sort_order);

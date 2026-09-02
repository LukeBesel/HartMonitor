-- ─── Scrap, rework and coded downtime ────────────────────────────────────────
-- 012 / workstream: scrap-rework-and-coded-downtime
--
-- A finished run recorded ONE fact about quantity: that it happened. Everything
-- downstream therefore treated every completion as one good piece. First-pass
-- yield could not be computed, scrap by part did not exist, and the only
-- plant-wide scrap number in the product was whatever a supervisor typed into a
-- shift note by hand. The OEE quality factor was a string match for 'Pass' /
-- 'Fail' inside the run's JSON blob, so a plant that inspects nothing had no
-- quality figure at all.
--
-- The five columns on `completions` are the missing counts, plus the coded
-- reason that has to accompany scrap and the operation the units book against.
-- The one column on `machine_events` is the coded reason a stop now carries, so
-- a downtime Pareto and the six big losses are arithmetic rather than a
-- free-text word cloud.
--
-- EVERY COLUMN HERE IS NULLABLE AND CARRIES NO DEFAULT VALUE, deliberately.
-- NULL means "nobody counted", and a zero means "somebody counted, and the
-- answer was zero". Those are different facts and the difference is the whole
-- point: a run finished before this migration, or by an operator who never
-- touched the units control, must not read as a run that produced nothing.
-- Defaulting these to zero would silently turn every historic run into a
-- measurement that never happened, and first-pass yield would be computed over
-- a denominator the plant never provided.
--
-- Nothing backfills. Every row that already exists keeps NULL in all six
-- columns and behaves exactly as it did.
--
-- scrap_reason_code_id and reason_code_id point at reason_codes(id) from 007 —
-- the ONE coded list a company keeps. They are plain TEXT columns rather than
-- declared foreign keys because SQLite has no ALTER TABLE ADD CONSTRAINT: a key
-- can only be declared inside a CREATE TABLE, and `completions` and
-- `machine_events` were created long before this file. Ownership is therefore
-- checked in the routes that write them, which is also where the tenant check
-- has to live in any case: machine_events has no company_id column at all, so a
-- stop's reason code is resolved through stations.company_id.

ALTER TABLE completions ADD COLUMN quantity_good INTEGER;
ALTER TABLE completions ADD COLUMN quantity_scrap INTEGER;
ALTER TABLE completions ADD COLUMN quantity_rework INTEGER;
ALTER TABLE completions ADD COLUMN scrap_reason_code_id TEXT;
ALTER TABLE completions ADD COLUMN work_order_operation_id TEXT;

ALTER TABLE machine_events ADD COLUMN reason_code_id TEXT;

-- The yield read: "the counts this company recorded, newest first". Partial so
-- it stays small — the overwhelming majority of rows record no counts at all,
-- and those are exactly the rows every scrap query wants to skip.
CREATE INDEX IF NOT EXISTS idx_completions_counts
  ON completions(company_id, completed_at)
  WHERE quantity_good IS NOT NULL OR quantity_scrap IS NOT NULL OR quantity_rework IS NOT NULL;

-- The Pareto read: "every stop on this station in this window".
CREATE INDEX IF NOT EXISTS idx_machine_events_station_type
  ON machine_events(station_id, event_type, started_at);

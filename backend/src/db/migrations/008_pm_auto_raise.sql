-- ─── A PM that raises its own job ────────────────────────────────────────────
-- 008 / workstream: calls-escalate-and-pm-raises-jobs
--
-- pm_schedules only ever moved when a human clicked Complete, so a PM that came
-- due was a row nothing acted on: no work order, no assignee, no queue. These
-- columns let a schedule raise exactly one preventive work order when it falls
-- due (auto_create_wo, lead_days), and remember which one it raised
-- (last_raised_wo_id, last_raised_at) so the sweeper never raises a second.
--
-- The work order carries the link back — pm_schedule_id, so the job can say
-- "Raised automatically from PM: 500-hour service" and completing it can re-arm
-- the schedule — plus raised_by ('system' for the sweeper, '' for a job a
-- person typed in).

ALTER TABLE pm_schedules ADD COLUMN auto_create_wo INTEGER NOT NULL DEFAULT 1;
ALTER TABLE pm_schedules ADD COLUMN lead_days INTEGER NOT NULL DEFAULT 0;
ALTER TABLE pm_schedules ADD COLUMN last_raised_wo_id TEXT;
ALTER TABLE pm_schedules ADD COLUMN last_raised_at TEXT;

ALTER TABLE maintenance_work_orders ADD COLUMN pm_schedule_id TEXT;
ALTER TABLE maintenance_work_orders ADD COLUMN raised_by TEXT NOT NULL DEFAULT '';

CREATE INDEX IF NOT EXISTS idx_mwo_pm_schedule
  ON maintenance_work_orders(company_id, pm_schedule_id, status);

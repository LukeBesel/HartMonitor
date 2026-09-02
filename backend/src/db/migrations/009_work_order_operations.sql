-- ─── A work order carries operations ─────────────────────────────────────────
-- 009 / workstream: work-orders-carry-operations
--
-- A work order was welded to ONE app and ONE department, so a seven-operation
-- job had to be typed in as seven unrelated work orders: no shared number, no
-- sequence, no roll-up, and a Routings screen that described an execution model
-- the database could not hold. product_routings/routing_steps existed and were
-- editable; work_orders.routing_id existed and was written by the ERP import;
-- nothing ever read either one.
--
-- work_order_operations is the missing row. Releasing a work order against a
-- routing copies its steps into this table once — a SNAPSHOT, not a live join,
-- because editing a routing next month must not rewrite a job the floor is
-- halfway through. Each operation owns its own app, department, station,
-- standard time and quantities, so "op 3 of 7" is a fact rather than a caption.
--
-- The status vocabulary is quoted verbatim from backend/src/vocab.js
-- (OPERATION_STATUS); backend/test/wo-operations.test.js compares the two, so
-- they cannot drift. Note there is no 'hold' STATUS: a job on hold keeps the
-- operation status it had and carries work_orders.hold_reason, because a status
-- word cannot say why.
--
-- quantity_rework rides alongside quantity_scrapped: workOrderOperations.advance()
-- takes { good, scrap, rework } from today, and wave 4's coded scrap/rework
-- screens will be writing all three. A count with nowhere to be stored is a
-- count that gets rounded into "good", which is the one thing scrap reporting
-- must never do.
--
-- Nothing here backfills. A work order that existed before this migration has
-- released_at NULL and zero operation rows, and behaves exactly as it did.

CREATE TABLE IF NOT EXISTS work_order_operations (
  id                 TEXT PRIMARY KEY,
  company_id         TEXT NOT NULL,
  work_order_id      TEXT NOT NULL,
  routing_step_id    TEXT,
  sequence           INTEGER NOT NULL,
  name               TEXT NOT NULL DEFAULT '',
  app_id             TEXT,
  department_id      TEXT,
  station_id         TEXT,
  standard_seconds   REAL NOT NULL DEFAULT 0,
  quantity_required  INTEGER NOT NULL DEFAULT 0,
  quantity_completed INTEGER NOT NULL DEFAULT 0,
  quantity_scrapped  INTEGER NOT NULL DEFAULT 0,
  quantity_rework    INTEGER NOT NULL DEFAULT 0,
  status             TEXT NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','ready','running','complete','skipped','on_hold')),
  started_at         TEXT,
  completed_at       TEXT,
  created_at         TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at         TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(work_order_id, sequence)
);

-- The dispatch read: "what is ready in this department, in order".
CREATE INDEX IF NOT EXISTS idx_woo_company_status
  ON work_order_operations(company_id, status, department_id, sequence);

-- The job read: "the operations of this work order, in sequence".
CREATE INDEX IF NOT EXISTS idx_woo_work_order
  ON work_order_operations(work_order_id, sequence);

-- Where the job is, when it was released, and why it is stopped. hold_reason is
-- a COLUMN and not a status word: work_orders.status is frozen behind a CHECK
-- that cannot be altered in place, and "on hold" without a reason is a job
-- nobody can un-stick.
ALTER TABLE work_orders ADD COLUMN current_operation_id TEXT;
ALTER TABLE work_orders ADD COLUMN released_at TEXT;
ALTER TABLE work_orders ADD COLUMN hold_reason TEXT;

-- A routing step may name the station it runs on, so a released operation
-- arrives already pointed at a machine. routing_steps had app_id and
-- department_id but never this.
ALTER TABLE routing_steps ADD COLUMN station_id TEXT;

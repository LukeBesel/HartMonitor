-- 006_work_order_import_fields.sql — erp-door
--
-- Three columns a work order needs before an ERP can own it:
--
--   due_date     the date the customer needs it (YYYY-MM-DD, date only — a
--                shop's due date is a day, not an instant, and scheduled_end
--                already carries the planned finish time).
--   customer_ref the customer / sales-order reference the planner reads off
--                the paperwork.
--   external_id  the ERP's own id for the row. This is the match key: a
--                re-import of the same file updates the same work orders
--                instead of duplicating every job.
--
-- No DEFAULT on any of them. NULL means nobody has said, and the screens print
-- that as "—" rather than inventing a date.
--
-- The partial unique index is what makes the import idempotent: one work order
-- per (company, external_id), while the many rows typed in by hand — which
-- have no external_id at all — stay unconstrained. SQLite treats every NULL as
-- distinct in a unique index, so the NULL case would already be safe; the
-- WHERE clause is there for the empty string, which is NOT distinct and would
-- otherwise let exactly one blank-external_id row exist per company.
ALTER TABLE work_orders ADD COLUMN due_date TEXT;
ALTER TABLE work_orders ADD COLUMN customer_ref TEXT;
ALTER TABLE work_orders ADD COLUMN external_id TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_work_orders_external
  ON work_orders(company_id, external_id)
  WHERE external_id IS NOT NULL AND external_id <> '';

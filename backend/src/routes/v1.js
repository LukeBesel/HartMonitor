// ─── Public API v1 (Enterprise) ─────────────────────────────────────────────────
// Read-only JSON endpoints for ERP / integration partners, authenticated with an
// API key generated under Settings > Developer. All data is scoped to the
// company that owns the key (apiKeyAuth sets req.companyId).

const express = require('express');
const db = require('../db');
const { runSecondsSQL } = require('../cycleTime');
const { validateAndUpsertRows, readImportBody } = require('./workorders');

const router = express.Router();

// ─── GET /work-orders ─────────────────────────────────────────────────────────

router.get('/work-orders', (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 100, 500);
  const rows = db.prepare(`
    SELECT wo.id, wo.work_order_number, wo.external_id, wo.part_number, wo.part_name,
           wo.quantity, wo.quantity_completed,
           wo.status, wo.priority, wo.due_date, wo.customer_ref,
           wo.scheduled_start, wo.scheduled_end,
           d.name as department, a.name as app_name, wo.created_at, wo.updated_at
    FROM work_orders wo
    LEFT JOIN departments d ON d.id = wo.department_id
    LEFT JOIN apps a ON a.id = wo.app_id
    WHERE wo.company_id = ?
    ORDER BY wo.created_at DESC LIMIT ?
  `).all(req.companyId, limit);
  res.json(rows);
});

// ─── POST /work-orders — create or update, idempotently ───────────────────────
//
// The write half of the ERP door. Accepts a single work order, an array of
// them, or { rows: [...] } / { csv: "..." } — whichever shape the sending
// system finds easiest — and answers with one verdict per row, so a partner
// that sent 200 jobs and got 199 in knows exactly which line to fix.
//
// external_id is the match key: POST the same payload twice and the second
// call reports "updated" for every row rather than duplicating the schedule.
// company_id comes from the API key (apiKeyAuth set it); a row cannot name a
// company, so a key for one tenant can never write into another.
//
// Always 200 for a batch we were able to read — a mixed result is a normal
// outcome, not an HTTP error. Only an unreadable body (400) or one past the
// row limit (413) fails outright.

router.post('/work-orders', (req, res) => {
  const { rows, error } = readImportBody(req.body);
  if (error) return res.status(error.status).json(error.body);
  const out = validateAndUpsertRows(req.companyId, rows, {
    dryRun: false,
    actor: `API key: ${req.apiKey?.name || 'unnamed'}`,
  });
  res.json(out);
});

// ─── PATCH /work-orders/:external_id — update one job the ERP already owns ────
//
// 404 when this company has no work order under that external_id: PATCH updates,
// it does not create, so a typo must not quietly open a second job. The path id
// always wins over anything in the body.

router.patch('/work-orders/:external_id', (req, res) => {
  const externalId = String(req.params.external_id || '').trim();
  const existing = db.prepare('SELECT id FROM work_orders WHERE company_id = ? AND external_id = ?')
    .get(req.companyId, externalId);
  if (!existing) {
    return res.status(404).json({ error: 'not_found', message: `No work order with external_id "${externalId}"` });
  }
  const body = (req.body && typeof req.body === 'object' && !Array.isArray(req.body)) ? req.body : {};
  const out = validateAndUpsertRows(req.companyId, [{ ...body, external_id: externalId }], {
    dryRun: false,
    actor: `API key: ${req.apiKey?.name || 'unnamed'}`,
  });
  const result = out.results[0];
  if (result.result === 'rejected') return res.status(400).json(result);
  res.json(result);
});

// ─── GET /completions ─────────────────────────────────────────────────────────

router.get('/completions', (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 100, 500);
  const rows = db.prepare(`
    SELECT c.id, c.app_name, s.name as station_name, c.operator_name,
           c.started_at, c.completed_at, c.status,
           ROUND(${runSecondsSQL('c')} / 60.0, 1) as cycle_time_minutes,
           ROUND(${runSecondsSQL('c')}, 3) as cycle_time_seconds,
           wo.work_order_number
    FROM completions c
    LEFT JOIN stations s ON s.id = c.station_id
    LEFT JOIN work_orders wo ON wo.id = c.work_order_id
    WHERE c.company_id = ?
    ORDER BY c.started_at DESC LIMIT ?
  `).all(req.companyId, limit);
  res.json(rows);
});

// ─── GET /inventory ───────────────────────────────────────────────────────────

router.get('/inventory', (req, res) => {
  const rows = db.prepare(`
    SELECT i.id, i.sku, i.name, i.description, i.category, i.unit_of_measure,
           i.unit_cost, COALESCE(SUM(sl.quantity),0) as total_quantity,
           i.reorder_point, i.reorder_qty, i.lead_time_days
    FROM items i LEFT JOIN stock_levels sl ON sl.item_id = i.id
    WHERE i.is_active = 1 AND i.company_id = ?
    GROUP BY i.id ORDER BY i.category, i.name
  `).all(req.companyId);
  res.json(rows);
});

module.exports = router;

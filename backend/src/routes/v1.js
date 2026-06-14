// ─── Public API v1 (Enterprise) ─────────────────────────────────────────────────
// Read-only JSON endpoints for ERP / integration partners, authenticated with an
// API key generated under Settings > Developer. All data is scoped to the
// company that owns the key (apiKeyAuth sets req.companyId).

const express = require('express');
const db = require('../db');

const router = express.Router();

// ─── GET /work-orders ─────────────────────────────────────────────────────────

router.get('/work-orders', (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 100, 500);
  const rows = db.prepare(`
    SELECT wo.id, wo.work_order_number, wo.part_number, wo.part_name, wo.quantity, wo.quantity_completed,
           wo.status, wo.priority, wo.scheduled_start, wo.scheduled_end,
           d.name as department, a.name as app_name, wo.created_at, wo.updated_at
    FROM work_orders wo
    LEFT JOIN departments d ON d.id = wo.department_id
    LEFT JOIN apps a ON a.id = wo.app_id
    WHERE wo.company_id = ?
    ORDER BY wo.created_at DESC LIMIT ?
  `).all(req.companyId, limit);
  res.json(rows);
});

// ─── GET /completions ─────────────────────────────────────────────────────────

router.get('/completions', (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 100, 500);
  const rows = db.prepare(`
    SELECT c.id, c.app_name, s.name as station_name, c.operator_name,
           c.started_at, c.completed_at, c.status,
           ROUND((julianday(c.completed_at)-julianday(c.started_at))*1440, 1) as cycle_time_minutes,
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

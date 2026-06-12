const express = require('express');
const { v4: uuidv4 } = require('uuid');
const db = require('../db');

const router = express.Router();

// ─── Schedule status helper ───────────────────────────────────────────────────

function calcScheduleStatus(wo) {
  if (wo.status === 'completed') return 'completed';
  const now   = new Date();
  const start = new Date(wo.scheduled_start);
  const end   = new Date(wo.scheduled_end);
  if (now < start) return 'not_started';
  if (now > end && wo.quantity_completed < wo.quantity) return 'overdue';
  const totalMs    = end - start;
  const elapsedMs  = Math.min(now - start, totalMs);
  const pctTime    = elapsedMs / totalMs;
  const expectedQty = Math.ceil(pctTime * wo.quantity);
  if (wo.quantity_completed >= expectedQty * 0.95) return 'on_track';
  if (wo.quantity_completed >= expectedQty * 0.75) return 'at_risk';
  return 'behind';
}

function enrichWorkOrder(wo) {
  return {
    ...wo,
    schedule_status: calcScheduleStatus(wo),
    completion_pct: wo.quantity > 0 ? Math.round((wo.quantity_completed / wo.quantity) * 100) : 0,
  };
}

// ─── Generate next work order number ─────────────────────────────────────────

function nextWorkOrderNumber() {
  const year   = new Date().getFullYear();
  const prefix = `WO-${year}-`;
  const latest = db.prepare(
    `SELECT work_order_number FROM work_orders WHERE work_order_number LIKE ? ORDER BY work_order_number DESC LIMIT 1`
  ).get(prefix + '%');
  if (!latest) return `${prefix}001`;
  const seq = parseInt(latest.work_order_number.replace(prefix, ''), 10);
  return `${prefix}${String(seq + 1).padStart(3, '0')}`;
}

// ─── Reusable enriched-fetch query ───────────────────────────────────────────

const ENRICHED_SELECT = `
  SELECT wo.*, d.name AS department_name, d.color AS department_color, a.name AS app_name
  FROM work_orders wo
  LEFT JOIN departments d ON d.id = wo.department_id
  LEFT JOIN apps        a ON a.id = wo.app_id
`;

// ─── GET / - list all work orders ────────────────────────────────────────────

router.get('/', (req, res) => {
  const { status, department_id, priority } = req.query;

  let query = ENRICHED_SELECT;
  const conditions = [];
  const params     = [];

  if (status)        { conditions.push('wo.status = ?');        params.push(status); }
  if (department_id) { conditions.push('wo.department_id = ?'); params.push(department_id); }
  if (priority)      { conditions.push('wo.priority = ?');      params.push(priority); }

  if (conditions.length) query += ' WHERE ' + conditions.join(' AND ');
  query += ' ORDER BY wo.created_at DESC';

  const rows = db.prepare(query).all(...params);
  res.json(rows.map(enrichWorkOrder));
});

// ─── POST / - create work order ──────────────────────────────────────────────

router.post('/', (req, res) => {
  const {
    part_number,
    part_name,
    quantity,
    app_id,
    department_id,
    scheduled_start,
    scheduled_end,
    takt_time_minutes = 0,
    status            = 'pending',
    priority          = 'medium',
    notes             = '',
    work_order_number,
  } = req.body;

  if (!part_number)              return res.status(400).json({ error: 'part_number is required' });
  if (!part_name)                return res.status(400).json({ error: 'part_name is required' });
  if (!quantity || quantity < 1) return res.status(400).json({ error: 'quantity must be a positive integer' });

  const id       = uuidv4();
  const woNumber = work_order_number || nextWorkOrderNumber();

  db.prepare(`
    INSERT INTO work_orders
      (id, work_order_number, part_number, part_name, quantity, quantity_completed,
       app_id, department_id, scheduled_start, scheduled_end, takt_time_minutes,
       status, priority, notes, updated_at)
    VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
  `).run(
    id, woNumber, part_number, part_name, quantity,
    app_id || null, department_id || null,
    scheduled_start || null, scheduled_end || null,
    takt_time_minutes, status, priority, notes
  );

  const wo = db.prepare(ENRICHED_SELECT + ' WHERE wo.id = ?').get(id);
  res.status(201).json(enrichWorkOrder(wo));
});

// ─── GET /:id - single work order with completion history count ───────────────

router.get('/:id', (req, res) => {
  const wo = db.prepare(ENRICHED_SELECT + ' WHERE wo.id = ?').get(req.params.id);
  if (!wo) return res.status(404).json({ error: 'Work order not found' });

  const historyCount = db.prepare(
    `SELECT COUNT(*) as c FROM completions WHERE work_order_id = ? AND status = 'completed'`
  ).get(req.params.id).c;

  res.json({ ...enrichWorkOrder(wo), completion_history_count: historyCount });
});

// ─── PUT /:id - update work order ────────────────────────────────────────────

router.put('/:id', (req, res) => {
  const wo = db.prepare('SELECT * FROM work_orders WHERE id = ?').get(req.params.id);
  if (!wo) return res.status(404).json({ error: 'Work order not found' });

  const fields = [
    'part_number', 'part_name', 'quantity', 'quantity_completed',
    'app_id', 'department_id', 'scheduled_start', 'scheduled_end',
    'takt_time_minutes', 'status', 'priority', 'notes', 'work_order_number',
  ];

  const updates = {};
  for (const f of fields) {
    updates[f] = req.body[f] !== undefined ? req.body[f] : wo[f];
  }

  db.prepare(`
    UPDATE work_orders SET
      part_number=?, part_name=?, quantity=?, quantity_completed=?,
      app_id=?, department_id=?, scheduled_start=?, scheduled_end=?,
      takt_time_minutes=?, status=?, priority=?, notes=?, work_order_number=?,
      updated_at=datetime('now')
    WHERE id=?
  `).run(
    updates.part_number, updates.part_name, updates.quantity, updates.quantity_completed,
    updates.app_id, updates.department_id, updates.scheduled_start, updates.scheduled_end,
    updates.takt_time_minutes, updates.status, updates.priority, updates.notes,
    updates.work_order_number, req.params.id
  );

  const updated = db.prepare(ENRICHED_SELECT + ' WHERE wo.id = ?').get(req.params.id);
  res.json(enrichWorkOrder(updated));
});

// ─── PUT /:id/complete - mark work order as completed ────────────────────────

router.put('/:id/complete', (req, res) => {
  const wo = db.prepare('SELECT * FROM work_orders WHERE id = ?').get(req.params.id);
  if (!wo) return res.status(404).json({ error: 'Work order not found' });

  db.prepare(`
    UPDATE work_orders
    SET status='completed', quantity_completed=quantity, updated_at=datetime('now')
    WHERE id=?
  `).run(req.params.id);

  const updated = db.prepare(ENRICHED_SELECT + ' WHERE wo.id = ?').get(req.params.id);
  res.json(enrichWorkOrder(updated));
});

// ─── POST /:id/increment - increment quantity_completed by 1 ─────────────────

router.post('/:id/increment', (req, res) => {
  const wo = db.prepare('SELECT * FROM work_orders WHERE id = ?').get(req.params.id);
  if (!wo) return res.status(404).json({ error: 'Work order not found' });

  const newQty    = Math.min(wo.quantity_completed + 1, wo.quantity);
  const newStatus = newQty >= wo.quantity
    ? 'completed'
    : (wo.status === 'pending' ? 'in_progress' : wo.status);

  db.prepare(`
    UPDATE work_orders
    SET quantity_completed=?, status=?, updated_at=datetime('now')
    WHERE id=?
  `).run(newQty, newStatus, req.params.id);

  const updated = db.prepare(ENRICHED_SELECT + ' WHERE wo.id = ?').get(req.params.id);
  res.json(enrichWorkOrder(updated));
});

// ─── DELETE /:id ──────────────────────────────────────────────────────────────

router.delete('/:id', (req, res) => {
  const wo = db.prepare('SELECT id FROM work_orders WHERE id = ?').get(req.params.id);
  if (!wo) return res.status(404).json({ error: 'Work order not found' });
  db.prepare('DELETE FROM work_orders WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

module.exports = { router, calcScheduleStatus };

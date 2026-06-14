const express = require('express');
const { v4: uuidv4 } = require('uuid');
const db = require('../db');
const { logActivity } = require('../activity');
const { notify } = require('../notifications');
const { deliverWebhooks } = require('../webhooks');

const router = express.Router();

const STATUS_LABELS = {
  pending: 'Pending', in_progress: 'In Progress', completed: 'Completed',
  overdue: 'Overdue', cancelled: 'Cancelled',
};
const PRIORITY_LABELS = { low: 'Low', medium: 'Medium', high: 'High', critical: 'Critical' };

function departmentName(id) {
  if (!id) return 'None';
  return db.prepare('SELECT name FROM departments WHERE id = ?').get(id)?.name || 'Unknown';
}

function fmtDate(iso) {
  if (!iso) return 'Not set';
  return new Date(iso).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

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

// ─── Generate next work order number (per-company sequence) ───────────────────

function nextWorkOrderNumber(companyId) {
  const year   = new Date().getFullYear();
  const prefix = `WO-${year}-`;
  const latest = db.prepare(
    `SELECT work_order_number FROM work_orders WHERE company_id = ? AND work_order_number LIKE ? ORDER BY work_order_number DESC LIMIT 1`
  ).get(companyId, prefix + '%');
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
  const { status, department_id, priority, site_id } = req.query;

  let query = ENRICHED_SELECT;
  const conditions = ['wo.company_id = ?'];
  const params     = [req.companyId];

  if (status)        { conditions.push('wo.status = ?');        params.push(status); }
  if (department_id) { conditions.push('wo.department_id = ?'); params.push(department_id); }
  if (priority)      { conditions.push('wo.priority = ?');      params.push(priority); }
  if (site_id)       { conditions.push('wo.site_id = ?');       params.push(site_id); }

  query += ' WHERE ' + conditions.join(' AND ');
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
    site_id           = null,
  } = req.body;

  if (!part_number)              return res.status(400).json({ error: 'part_number is required' });
  if (!part_name)                return res.status(400).json({ error: 'part_name is required' });
  if (!quantity || quantity < 1) return res.status(400).json({ error: 'quantity must be a positive integer' });

  const id       = uuidv4();
  const woNumber = work_order_number || nextWorkOrderNumber(req.companyId);

  db.prepare(`
    INSERT INTO work_orders
      (id, work_order_number, part_number, part_name, quantity, quantity_completed,
       app_id, department_id, scheduled_start, scheduled_end, takt_time_minutes,
       status, priority, notes, company_id, site_id, updated_at)
    VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
  `).run(
    id, woNumber, part_number, part_name, quantity,
    app_id || null, department_id || null,
    scheduled_start || null, scheduled_end || null,
    takt_time_minutes, status, priority, notes, req.companyId, site_id || null
  );

  const wo = db.prepare(ENRICHED_SELECT + ' WHERE wo.id = ?').get(id);
  logActivity(req.companyId, 'work_order', id, 'Work order created', req.user?.display_name);
  res.status(201).json(enrichWorkOrder(wo));
});

// ─── GET /:id - single work order with completion history count ───────────────

router.get('/:id', (req, res) => {
  const wo = db.prepare(ENRICHED_SELECT + ' WHERE wo.id = ? AND wo.company_id = ?').get(req.params.id, req.companyId);
  if (!wo) return res.status(404).json({ error: 'Work order not found' });

  const historyCount = db.prepare(
    `SELECT COUNT(*) as c FROM completions WHERE work_order_id = ? AND status = 'completed'`
  ).get(req.params.id).c;

  res.json({ ...enrichWorkOrder(wo), completion_history_count: historyCount });
});

// ─── PUT /:id - update work order ────────────────────────────────────────────

router.put('/:id', (req, res) => {
  const wo = db.prepare('SELECT * FROM work_orders WHERE id = ? AND company_id = ?').get(req.params.id, req.companyId);
  if (!wo) return res.status(404).json({ error: 'Work order not found' });

  const fields = [
    'part_number', 'part_name', 'quantity', 'quantity_completed',
    'app_id', 'department_id', 'scheduled_start', 'scheduled_end',
    'takt_time_minutes', 'status', 'priority', 'notes', 'work_order_number',
    'site_id',
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
      site_id=?, updated_at=datetime('now')
    WHERE id=?
  `).run(
    updates.part_number, updates.part_name, updates.quantity, updates.quantity_completed,
    updates.app_id, updates.department_id, updates.scheduled_start, updates.scheduled_end,
    updates.takt_time_minutes, updates.status, updates.priority, updates.notes,
    updates.work_order_number, updates.site_id, req.params.id
  );

  // ─── Activity log: describe what changed ──────────────────────────────────
  const changes = [];
  if (updates.status !== wo.status) {
    changes.push(`Status changed from ${STATUS_LABELS[wo.status] || wo.status} to ${STATUS_LABELS[updates.status] || updates.status}`);
  }
  if (updates.priority !== wo.priority) {
    changes.push(`Priority changed from ${PRIORITY_LABELS[wo.priority] || wo.priority} to ${PRIORITY_LABELS[updates.priority] || updates.priority}`);
  }
  if (updates.department_id !== wo.department_id) {
    changes.push(`Department changed from ${departmentName(wo.department_id)} to ${departmentName(updates.department_id)}`);
  }
  if (updates.scheduled_start !== wo.scheduled_start || updates.scheduled_end !== wo.scheduled_end) {
    changes.push(`Schedule changed to ${fmtDate(updates.scheduled_start)} – ${fmtDate(updates.scheduled_end)}`);
  }
  if (updates.quantity !== wo.quantity) {
    changes.push(`Quantity changed from ${wo.quantity} to ${updates.quantity}`);
  }
  for (const change of changes) {
    logActivity(req.companyId, 'work_order', req.params.id, change, req.user?.display_name);
  }

  const updated = db.prepare(ENRICHED_SELECT + ' WHERE wo.id = ?').get(req.params.id);
  const enriched = enrichWorkOrder(updated);

  if (updates.scheduled_start !== wo.scheduled_start || updates.scheduled_end !== wo.scheduled_end) {
    notify(req.companyId, 'workorder.schedule_changed', {
      body: `Work order ${updated.work_order_number} rescheduled to ${fmtDate(updates.scheduled_start)} – ${fmtDate(updates.scheduled_end)}.`,
    });
    deliverWebhooks(req.companyId, 'workorder.schedule_changed', enriched);
  }
  if (updates.status === 'overdue' && wo.status !== 'overdue') {
    notify(req.companyId, 'workorder.overdue', {
      body: `Work order ${updated.work_order_number} (${updated.part_name || updated.part_number}) is now overdue.`,
    });
    deliverWebhooks(req.companyId, 'workorder.overdue', enriched);
  }

  res.json(enriched);
});

// ─── PUT /:id/complete - mark work order as completed ────────────────────────

router.put('/:id/complete', (req, res) => {
  const wo = db.prepare('SELECT * FROM work_orders WHERE id = ? AND company_id = ?').get(req.params.id, req.companyId);
  if (!wo) return res.status(404).json({ error: 'Work order not found' });

  db.prepare(`
    UPDATE work_orders
    SET status='completed', quantity_completed=quantity, updated_at=datetime('now')
    WHERE id=?
  `).run(req.params.id);

  if (wo.status !== 'completed') {
    logActivity(req.companyId, 'work_order', req.params.id, 'Marked as completed', req.user?.display_name);
  }

  const updated = db.prepare(ENRICHED_SELECT + ' WHERE wo.id = ?').get(req.params.id);
  res.json(enrichWorkOrder(updated));
});

// ─── POST /:id/increment - increment quantity_completed by 1 ─────────────────

router.post('/:id/increment', (req, res) => {
  const wo = db.prepare('SELECT * FROM work_orders WHERE id = ? AND company_id = ?').get(req.params.id, req.companyId);
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

  if (newStatus !== wo.status) {
    logActivity(req.companyId, 'work_order', req.params.id, `Status changed from ${STATUS_LABELS[wo.status] || wo.status} to ${STATUS_LABELS[newStatus] || newStatus}`, req.user?.display_name);
  }

  const updated = db.prepare(ENRICHED_SELECT + ' WHERE wo.id = ?').get(req.params.id);
  res.json(enrichWorkOrder(updated));
});

// ─── DELETE /:id ──────────────────────────────────────────────────────────────

router.delete('/:id', (req, res) => {
  const wo = db.prepare('SELECT id FROM work_orders WHERE id = ? AND company_id = ?').get(req.params.id, req.companyId);
  if (!wo) return res.status(404).json({ error: 'Work order not found' });
  db.prepare('DELETE FROM work_orders WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

module.exports = { router, calcScheduleStatus };

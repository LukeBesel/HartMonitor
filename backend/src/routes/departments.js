const express = require('express');
const { v4: uuidv4 } = require('uuid');
const db = require('../db');

const router = express.Router();

// ─── GET / - list departments with work order and completion counts ────────────

router.get('/', (req, res) => {
  const depts = db.prepare('SELECT * FROM departments ORDER BY name').all();

  const enriched = depts.map(dept => {
    const woCount = db.prepare(
      `SELECT COUNT(*) as c FROM work_orders WHERE department_id = ? AND status != 'cancelled'`
    ).get(dept.id).c;

    const completionCount = db.prepare(`
      SELECT COUNT(*) as c
      FROM completions c
      JOIN work_orders wo ON wo.id = c.work_order_id
      WHERE wo.department_id = ? AND c.status = 'completed'
    `).get(dept.id).c;

    const activeCount = db.prepare(
      `SELECT COUNT(*) as c FROM work_orders WHERE department_id = ? AND status = 'in_progress'`
    ).get(dept.id).c;

    return {
      ...dept,
      work_order_count:  woCount,
      completion_count:  completionCount,
      active_work_orders: activeCount,
    };
  });

  res.json(enriched);
});

// ─── POST / - create department ──────────────────────────────────────────────

router.post('/', (req, res) => {
  const {
    name,
    description   = '',
    manager_name  = '',
    color         = '#3b82f6',
  } = req.body;

  if (!name) return res.status(400).json({ error: 'name is required' });

  const id = uuidv4();
  db.prepare(`INSERT INTO departments (id, name, description, manager_name, color) VALUES (?, ?, ?, ?, ?)`)
    .run(id, name, description, manager_name, color);

  const dept = db.prepare('SELECT * FROM departments WHERE id = ?').get(id);
  res.status(201).json({ ...dept, work_order_count: 0, completion_count: 0, active_work_orders: 0 });
});

// ─── PUT /:id - update department ────────────────────────────────────────────

router.put('/:id', (req, res) => {
  const dept = db.prepare('SELECT * FROM departments WHERE id = ?').get(req.params.id);
  if (!dept) return res.status(404).json({ error: 'Department not found' });

  const updates = {
    name:         req.body.name         !== undefined ? req.body.name         : dept.name,
    description:  req.body.description  !== undefined ? req.body.description  : dept.description,
    manager_name: req.body.manager_name !== undefined ? req.body.manager_name : dept.manager_name,
    color:        req.body.color        !== undefined ? req.body.color        : dept.color,
  };

  db.prepare(`UPDATE departments SET name=?, description=?, manager_name=?, color=? WHERE id=?`)
    .run(updates.name, updates.description, updates.manager_name, updates.color, req.params.id);

  const updated = db.prepare('SELECT * FROM departments WHERE id = ?').get(req.params.id);

  const woCount = db.prepare(
    `SELECT COUNT(*) as c FROM work_orders WHERE department_id = ? AND status != 'cancelled'`
  ).get(req.params.id).c;

  const completionCount = db.prepare(`
    SELECT COUNT(*) as c
    FROM completions c
    JOIN work_orders wo ON wo.id = c.work_order_id
    WHERE wo.department_id = ? AND c.status = 'completed'
  `).get(req.params.id).c;

  const activeCount = db.prepare(
    `SELECT COUNT(*) as c FROM work_orders WHERE department_id = ? AND status = 'in_progress'`
  ).get(req.params.id).c;

  res.json({
    ...updated,
    work_order_count:   woCount,
    completion_count:   completionCount,
    active_work_orders: activeCount,
  });
});

// ─── DELETE /:id ──────────────────────────────────────────────────────────────

router.delete('/:id', (req, res) => {
  const dept = db.prepare('SELECT id FROM departments WHERE id = ?').get(req.params.id);
  if (!dept) return res.status(404).json({ error: 'Department not found' });
  db.prepare('DELETE FROM departments WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

module.exports = router;

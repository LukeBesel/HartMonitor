const express = require('express');
const { v4: uuidv4 } = require('uuid');
const db = require('../db');

const router = express.Router();

function deptCounts(deptId) {
  const woCount = db.prepare(
    `SELECT COUNT(*) as c FROM work_orders WHERE department_id = ? AND status != 'cancelled'`
  ).get(deptId).c;

  const completionCount = db.prepare(`
    SELECT COUNT(*) as c
    FROM completions c
    JOIN work_orders wo ON wo.id = c.work_order_id
    WHERE wo.department_id = ? AND c.status = 'completed'
  `).get(deptId).c;

  const activeCount = db.prepare(
    `SELECT COUNT(*) as c FROM work_orders WHERE department_id = ? AND status = 'in_progress'`
  ).get(deptId).c;

  return { work_order_count: woCount, completion_count: completionCount, active_work_orders: activeCount };
}

// ─── GET / - list departments with work order and completion counts ────────────

router.get('/', (req, res) => {
  let sql = 'SELECT * FROM departments WHERE company_id = ?';
  const params = [req.companyId];
  if (req.query.site_id) { sql += ' AND site_id = ?'; params.push(req.query.site_id); }
  sql += ' ORDER BY name';
  const depts = db.prepare(sql).all(...params);
  res.json(depts.map(dept => ({ ...dept, ...deptCounts(dept.id) })));
});

// ─── POST / - create department ──────────────────────────────────────────────

router.post('/', (req, res) => {
  const {
    name,
    description   = '',
    manager_name  = '',
    color         = '#3b82f6',
    headcount     = 0,
    site_id       = null,
  } = req.body;

  if (!name) return res.status(400).json({ error: 'name is required' });

  const id = uuidv4();
  db.prepare(`INSERT INTO departments (id, name, description, manager_name, color, headcount, site_id, company_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(id, name, description, manager_name, color, Math.max(0, parseInt(headcount) || 0), site_id || null, req.companyId);

  const dept = db.prepare('SELECT * FROM departments WHERE id = ?').get(id);
  res.status(201).json({ ...dept, work_order_count: 0, completion_count: 0, active_work_orders: 0 });
});

// ─── PUT /:id - update department ────────────────────────────────────────────

router.put('/:id', (req, res) => {
  const dept = db.prepare('SELECT * FROM departments WHERE id = ? AND company_id = ?').get(req.params.id, req.companyId);
  if (!dept) return res.status(404).json({ error: 'Department not found' });

  const updates = {
    name:         req.body.name         !== undefined ? req.body.name         : dept.name,
    description:  req.body.description  !== undefined ? req.body.description  : dept.description,
    manager_name: req.body.manager_name !== undefined ? req.body.manager_name : dept.manager_name,
    color:        req.body.color        !== undefined ? req.body.color        : dept.color,
    headcount:    req.body.headcount    !== undefined ? Math.max(0, parseInt(req.body.headcount) || 0) : (dept.headcount || 0),
    site_id:      req.body.site_id      !== undefined ? (req.body.site_id || null) : dept.site_id,
  };

  db.prepare(`UPDATE departments SET name=?, description=?, manager_name=?, color=?, headcount=?, site_id=? WHERE id=?`)
    .run(updates.name, updates.description, updates.manager_name, updates.color, updates.headcount, updates.site_id, req.params.id);

  const updated = db.prepare('SELECT * FROM departments WHERE id = ?').get(req.params.id);
  res.json({ ...updated, ...deptCounts(req.params.id) });
});

// ─── DELETE /:id ──────────────────────────────────────────────────────────────

router.delete('/:id', (req, res) => {
  const dept = db.prepare('SELECT id FROM departments WHERE id = ? AND company_id = ?').get(req.params.id, req.companyId);
  if (!dept) return res.status(404).json({ error: 'Department not found' });
  db.prepare('DELETE FROM departments WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

module.exports = router;

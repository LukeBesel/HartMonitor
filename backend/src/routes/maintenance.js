const express = require('express');
const { v4: uuidv4 } = require('uuid');
const db = require('../db');
const { logActivity } = require('../activity');

const router = express.Router();

function nextWONumber(companyId) {
  const year = new Date().getFullYear();
  const row = db.prepare(`SELECT wo_number FROM maintenance_work_orders WHERE company_id = ? AND wo_number LIKE 'MWO-${year}-%' ORDER BY wo_number DESC LIMIT 1`).get(companyId);
  if (!row) return `MWO-${year}-001`;
  const last = parseInt(row.wo_number.split('-')[2]) || 0;
  return `MWO-${year}-${String(last + 1).padStart(3, '0')}`;
}

function ownedAsset(req) {
  return db.prepare('SELECT * FROM assets WHERE id = ? AND company_id = ?').get(req.params.id, req.companyId) || null;
}

function ownedWO(req) {
  return db.prepare('SELECT * FROM maintenance_work_orders WHERE id = ? AND company_id = ?').get(req.params.id, req.companyId) || null;
}

function computeNextDue(lastCompleted, frequencyType, frequencyValue) {
  if (!lastCompleted) return null;
  const d = new Date(lastCompleted);
  if (frequencyType === 'days') d.setDate(d.getDate() + frequencyValue);
  else if (frequencyType === 'weeks') d.setDate(d.getDate() + frequencyValue * 7);
  else if (frequencyType === 'months') d.setMonth(d.getMonth() + frequencyValue);
  else return null;
  return d.toISOString();
}

// ─── Assets ───────────────────────────────────────────────────────────────────

router.get('/assets', (req, res) => {
  const { department_id, status, search } = req.query;
  let sql = `
    SELECT a.*, d.name as department_name
    FROM assets a
    LEFT JOIN departments d ON d.id = a.department_id
    WHERE a.company_id = ?
  `;
  const params = [req.companyId];
  if (department_id) { sql += ' AND a.department_id = ?'; params.push(department_id); }
  if (status) { sql += ' AND a.status = ?'; params.push(status); }
  if (search) { sql += ' AND (a.name LIKE ? OR a.asset_number LIKE ?)'; params.push(`%${search}%`, `%${search}%`); }
  sql += ' ORDER BY a.name ASC';
  res.json(db.prepare(sql).all(...params));
});

router.post('/assets', (req, res) => {
  const { asset_number, name, description = '', type = '', make = '', model = '', serial_number = '', department_id, location = '', status = 'active', install_date, purchase_cost = 0, notes = '' } = req.body;
  if (!asset_number?.trim() || !name?.trim()) return res.status(400).json({ error: 'asset_number and name required' });
  const id = uuidv4();
  const now = new Date().toISOString();
  db.prepare(`INSERT INTO assets (id, company_id, asset_number, name, description, type, make, model, serial_number, department_id, location, status, install_date, purchase_cost, notes, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(id, req.companyId, asset_number.trim(), name.trim(), description, type, make, model, serial_number, department_id || null, location, status, install_date || null, purchase_cost, notes, now, now);
  logActivity(req.companyId, 'asset', id, `Asset created: ${name}`, req.user?.display_name);
  res.status(201).json(db.prepare('SELECT a.*, d.name as department_name FROM assets a LEFT JOIN departments d ON d.id = a.department_id WHERE a.id = ?').get(id));
});

router.put('/assets/:id', (req, res) => {
  if (!ownedAsset(req)) return res.status(404).json({ error: 'Not found' });
  const { asset_number, name, description, type, make, model, serial_number, department_id, location, status, install_date, purchase_cost, notes } = req.body;
  db.prepare(`UPDATE assets SET asset_number = COALESCE(?, asset_number), name = COALESCE(?, name), description = COALESCE(?, description), type = COALESCE(?, type), make = COALESCE(?, make), model = COALESCE(?, model), serial_number = COALESCE(?, serial_number), department_id = COALESCE(?, department_id), location = COALESCE(?, location), status = COALESCE(?, status), install_date = COALESCE(?, install_date), purchase_cost = COALESCE(?, purchase_cost), notes = COALESCE(?, notes), updated_at = datetime('now') WHERE id = ?`)
    .run(asset_number, name, description, type, make, model, serial_number, department_id, location, status, install_date, purchase_cost, notes, req.params.id);
  res.json(db.prepare('SELECT a.*, d.name as department_name FROM assets a LEFT JOIN departments d ON d.id = a.department_id WHERE a.id = ?').get(req.params.id));
});

router.delete('/assets/:id', (req, res) => {
  if (!ownedAsset(req)) return res.status(404).json({ error: 'Not found' });
  db.prepare('DELETE FROM assets WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// ─── PM Schedules ─────────────────────────────────────────────────────────────

router.get('/pm', (req, res) => {
  const { asset_id, overdue } = req.query;
  const today = new Date().toISOString().slice(0, 10);
  let sql = `
    SELECT p.*, a.name as asset_name, a.asset_number
    FROM pm_schedules p
    LEFT JOIN assets a ON a.id = p.asset_id
    WHERE p.company_id = ?
  `;
  const params = [req.companyId];
  if (asset_id) { sql += ' AND p.asset_id = ?'; params.push(asset_id); }
  if (overdue === 'true') { sql += ' AND p.next_due_at <= ?'; params.push(today); }
  sql += ' ORDER BY p.next_due_at ASC NULLS LAST';
  res.json(db.prepare(sql).all(...params));
});

router.post('/pm', (req, res) => {
  const { asset_id, title, description = '', frequency_type = 'days', frequency_value = 30, assigned_to = '', estimated_hours = 0 } = req.body;
  if (!asset_id || !title?.trim()) return res.status(400).json({ error: 'asset_id and title required' });
  // Verify asset belongs to company
  if (!db.prepare('SELECT id FROM assets WHERE id = ? AND company_id = ?').get(asset_id, req.companyId)) {
    return res.status(404).json({ error: 'Asset not found' });
  }
  const id = uuidv4();
  const next_due_at = computeNextDue(new Date().toISOString(), frequency_type, frequency_value);
  db.prepare(`INSERT INTO pm_schedules (id, company_id, asset_id, title, description, frequency_type, frequency_value, next_due_at, assigned_to, estimated_hours) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(id, req.companyId, asset_id, title.trim(), description, frequency_type, frequency_value, next_due_at, assigned_to, estimated_hours);
  res.status(201).json(db.prepare('SELECT p.*, a.name as asset_name, a.asset_number FROM pm_schedules p LEFT JOIN assets a ON a.id = p.asset_id WHERE p.id = ?').get(id));
});

router.put('/pm/:id', (req, res) => {
  const pm = db.prepare('SELECT * FROM pm_schedules WHERE id = ? AND company_id = ?').get(req.params.id, req.companyId);
  if (!pm) return res.status(404).json({ error: 'Not found' });
  const { title, description, frequency_type, frequency_value, assigned_to, estimated_hours } = req.body;
  db.prepare(`UPDATE pm_schedules SET title = COALESCE(?, title), description = COALESCE(?, description), frequency_type = COALESCE(?, frequency_type), frequency_value = COALESCE(?, frequency_value), assigned_to = COALESCE(?, assigned_to), estimated_hours = COALESCE(?, estimated_hours) WHERE id = ?`)
    .run(title, description, frequency_type, frequency_value, assigned_to, estimated_hours, req.params.id);
  res.json(db.prepare('SELECT p.*, a.name as asset_name, a.asset_number FROM pm_schedules p LEFT JOIN assets a ON a.id = p.asset_id WHERE p.id = ?').get(req.params.id));
});

router.post('/pm/:id/complete', (req, res) => {
  const pm = db.prepare('SELECT * FROM pm_schedules WHERE id = ? AND company_id = ?').get(req.params.id, req.companyId);
  if (!pm) return res.status(404).json({ error: 'Not found' });
  const now = new Date().toISOString();
  const next = computeNextDue(now, pm.frequency_type, pm.frequency_value);
  db.prepare('UPDATE pm_schedules SET last_completed_at = ?, next_due_at = ? WHERE id = ?').run(now, next, req.params.id);
  logActivity(req.companyId, 'pm', req.params.id, `PM completed: ${pm.title}`, req.user?.display_name);
  res.json(db.prepare('SELECT p.*, a.name as asset_name, a.asset_number FROM pm_schedules p LEFT JOIN assets a ON a.id = p.asset_id WHERE p.id = ?').get(req.params.id));
});

// ─── Maintenance Work Orders ───────────────────────────────────────────────────

router.get('/work-orders', (req, res) => {
  const { status, asset_id, type, priority } = req.query;
  let sql = `
    SELECT m.*, a.name as asset_name, a.asset_number
    FROM maintenance_work_orders m
    LEFT JOIN assets a ON a.id = m.asset_id
    WHERE m.company_id = ?
  `;
  const params = [req.companyId];
  if (status) { sql += ' AND m.status = ?'; params.push(status); }
  if (asset_id) { sql += ' AND m.asset_id = ?'; params.push(asset_id); }
  if (type) { sql += ' AND m.type = ?'; params.push(type); }
  if (priority) { sql += ' AND m.priority = ?'; params.push(priority); }
  sql += ' ORDER BY CASE m.priority WHEN \'critical\' THEN 0 WHEN \'high\' THEN 1 WHEN \'normal\' THEN 2 ELSE 3 END, m.created_at DESC';
  res.json(db.prepare(sql).all(...params));
});

router.post('/work-orders', (req, res) => {
  const { asset_id, type = 'corrective', title, description = '', priority = 'normal', assigned_to = '', requested_by = '', department_id, due_date, scheduled_date, notes = '' } = req.body;
  if (!title?.trim()) return res.status(400).json({ error: 'title required' });
  const id = uuidv4();
  const wo_number = nextWONumber(req.companyId);
  const now = new Date().toISOString();
  db.prepare(`INSERT INTO maintenance_work_orders (id, company_id, wo_number, asset_id, type, title, description, priority, assigned_to, requested_by, department_id, due_date, scheduled_date, notes, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(id, req.companyId, wo_number, asset_id || null, type, title.trim(), description, priority, assigned_to, requested_by, department_id || null, due_date || null, scheduled_date || null, notes, now, now);
  logActivity(req.companyId, 'maintenance', id, `WO ${wo_number} created: ${title}`, req.user?.display_name);
  res.status(201).json(db.prepare('SELECT m.*, a.name as asset_name FROM maintenance_work_orders m LEFT JOIN assets a ON a.id = m.asset_id WHERE m.id = ?').get(id));
});

router.put('/work-orders/:id', (req, res) => {
  if (!ownedWO(req)) return res.status(404).json({ error: 'Not found' });
  const prev = ownedWO(req);
  const { status, type, title, description, priority, assigned_to, due_date, actual_hours, parts_cost, labor_cost, notes, resolution } = req.body;
  const now = new Date().toISOString();
  const completed_at = status === 'complete' && prev.status !== 'complete' ? now : prev.completed_at;
  const started_at = status === 'in_progress' && !prev.started_at ? now : prev.started_at;
  db.prepare(`UPDATE maintenance_work_orders SET status = COALESCE(?, status), type = COALESCE(?, type), title = COALESCE(?, title), description = COALESCE(?, description), priority = COALESCE(?, priority), assigned_to = COALESCE(?, assigned_to), due_date = COALESCE(?, due_date), actual_hours = COALESCE(?, actual_hours), parts_cost = COALESCE(?, parts_cost), labor_cost = COALESCE(?, labor_cost), notes = COALESCE(?, notes), resolution = COALESCE(?, resolution), completed_at = ?, started_at = COALESCE(?, started_at), updated_at = ? WHERE id = ?`)
    .run(status, type, title, description, priority, assigned_to, due_date, actual_hours, parts_cost, labor_cost, notes, resolution, completed_at, started_at, now, req.params.id);
  res.json(db.prepare('SELECT m.*, a.name as asset_name FROM maintenance_work_orders m LEFT JOIN assets a ON a.id = m.asset_id WHERE m.id = ?').get(req.params.id));
});

router.delete('/work-orders/:id', (req, res) => {
  if (!ownedWO(req)) return res.status(404).json({ error: 'Not found' });
  db.prepare('DELETE FROM maintenance_work_orders WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// ─── Summary ──────────────────────────────────────────────────────────────────

router.get('/summary', (req, res) => {
  const today = new Date().toISOString().slice(0, 10);
  const open_wos = db.prepare("SELECT COUNT(*) as n FROM maintenance_work_orders WHERE company_id = ? AND status NOT IN ('complete','cancelled')").get(req.companyId).n;
  const critical_wos = db.prepare("SELECT COUNT(*) as n FROM maintenance_work_orders WHERE company_id = ? AND priority = 'critical' AND status NOT IN ('complete','cancelled')").get(req.companyId).n;
  const overdue_pms = db.prepare('SELECT COUNT(*) as n FROM pm_schedules WHERE company_id = ? AND next_due_at <= ?').get(req.companyId, today).n;
  const assets_count = db.prepare("SELECT COUNT(*) as n FROM assets WHERE company_id = ? AND status = 'active'").get(req.companyId).n;
  const completed_today = db.prepare("SELECT COUNT(*) as n FROM maintenance_work_orders WHERE company_id = ? AND status = 'complete' AND date(completed_at) = ?").get(req.companyId, today).n;
  res.json({ open_wos, critical_wos, overdue_pms, assets_count, completed_today });
});

module.exports = router;

const express = require('express');
const { v4: uuidv4 } = require('uuid');
const db = require('../db');
const { logActivity } = require('../activity');

const router = express.Router();

function ownedCall(req) {
  return db.prepare('SELECT * FROM andon_calls WHERE id = ? AND company_id = ?')
    .get(req.params.id, req.companyId) || null;
}

function callWithDept(id, companyId) {
  return db.prepare(`
    SELECT a.*, d.name as department_name
    FROM andon_calls a
    LEFT JOIN departments d ON d.id = a.department_id
    WHERE a.id = ? AND a.company_id = ?
  `).get(id, companyId);
}

// ─── GET /andon ────────────────────────────────────────────────────────────────

router.get('/', (req, res) => {
  const { status, department_id, type, limit = 100 } = req.query;
  let sql = `
    SELECT a.*, d.name as department_name
    FROM andon_calls a
    LEFT JOIN departments d ON d.id = a.department_id
    WHERE a.company_id = ?
  `;
  const params = [req.companyId];
  if (status) { sql += ' AND a.status = ?'; params.push(status); }
  if (department_id) { sql += ' AND a.department_id = ?'; params.push(department_id); }
  if (type) { sql += ' AND a.type = ?'; params.push(type); }
  sql += ' ORDER BY CASE a.priority WHEN \'critical\' THEN 0 WHEN \'high\' THEN 1 WHEN \'normal\' THEN 2 ELSE 3 END, a.created_at DESC LIMIT ?';
  params.push(Number(limit));
  res.json(db.prepare(sql).all(...params));
});

// ─── GET /andon/summary ────────────────────────────────────────────────────────

router.get('/summary', (req, res) => {
  const today = new Date().toISOString().slice(0, 10);
  const open = db.prepare("SELECT COUNT(*) as n FROM andon_calls WHERE company_id = ? AND status = 'open'").get(req.companyId).n;
  const critical = db.prepare("SELECT COUNT(*) as n FROM andon_calls WHERE company_id = ? AND status = 'open' AND priority = 'critical'").get(req.companyId).n;
  const acknowledged = db.prepare("SELECT COUNT(*) as n FROM andon_calls WHERE company_id = ? AND status = 'acknowledged'").get(req.companyId).n;
  const resolved_today = db.prepare("SELECT COUNT(*) as n FROM andon_calls WHERE company_id = ? AND status = 'resolved' AND date(resolved_at) = ?").get(req.companyId, today).n;
  const byType = db.prepare("SELECT type, COUNT(*) as n FROM andon_calls WHERE company_id = ? AND status != 'resolved' GROUP BY type").all(req.companyId);
  const by_type = Object.fromEntries(byType.map(r => [r.type, r.n]));
  res.json({ open, critical, acknowledged, resolved_today, by_type });
});

// ─── POST /andon ───────────────────────────────────────────────────────────────

router.post('/', (req, res) => {
  const { type = 'help', priority = 'normal', title = '', message = '', department_id, station_id, created_by } = req.body;
  if (!title.trim()) return res.status(400).json({ error: 'title required' });
  const id = uuidv4();
  db.prepare(`
    INSERT INTO andon_calls (id, company_id, type, priority, title, message, department_id, station_id, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, req.companyId, type, priority, title.trim(), message || '', department_id || null, station_id || null, created_by || req.user?.display_name || '');
  logActivity(req.companyId, 'andon', id, `${type.toUpperCase()} call raised: ${title}`, req.user?.display_name);
  res.status(201).json(callWithDept(id, req.companyId));
});

// ─── PUT /andon/:id/acknowledge ────────────────────────────────────────────────

router.put('/:id/acknowledge', (req, res) => {
  const call = ownedCall(req);
  if (!call) return res.status(404).json({ error: 'Not found' });
  if (call.status !== 'open') return res.status(409).json({ error: 'Call is not open' });
  const now = new Date().toISOString();
  db.prepare("UPDATE andon_calls SET status = 'acknowledged', assigned_to = ?, acknowledged_at = ? WHERE id = ?")
    .run(req.user?.display_name || '', now, req.params.id);
  logActivity(req.companyId, 'andon', req.params.id, `Call acknowledged`, req.user?.display_name);
  res.json(callWithDept(req.params.id, req.companyId));
});

// ─── PUT /andon/:id/resolve ────────────────────────────────────────────────────

router.put('/:id/resolve', (req, res) => {
  const call = ownedCall(req);
  if (!call) return res.status(404).json({ error: 'Not found' });
  if (call.status === 'resolved') return res.status(409).json({ error: 'Already resolved' });
  const now = new Date().toISOString();
  const { resolution = '' } = req.body;
  db.prepare("UPDATE andon_calls SET status = 'resolved', resolution = ?, resolved_at = ? WHERE id = ?")
    .run(resolution, now, req.params.id);
  logActivity(req.companyId, 'andon', req.params.id, `Call resolved`, req.user?.display_name);
  res.json(callWithDept(req.params.id, req.companyId));
});

// ─── DELETE /andon/:id ─────────────────────────────────────────────────────────

router.delete('/:id', (req, res) => {
  const call = ownedCall(req);
  if (!call) return res.status(404).json({ error: 'Not found' });
  db.prepare('DELETE FROM andon_calls WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

module.exports = router;

const express = require('express');
const { v4: uuidv4 } = require('uuid');
const db = require('../db');
const { logActivity } = require('../activity');

const router = express.Router();

function nextCAPANumber(companyId) {
  const year = new Date().getFullYear();
  const row = db.prepare(`SELECT number FROM capa_items WHERE company_id = ? AND number LIKE 'CAPA-${year}-%' ORDER BY number DESC LIMIT 1`).get(companyId);
  if (!row) return `CAPA-${year}-001`;
  const last = parseInt(row.number.split('-')[2]) || 0;
  return `CAPA-${year}-${String(last + 1).padStart(3, '0')}`;
}

function capaWithDetails(id, companyId) {
  const capa = db.prepare(`
    SELECT c.*, d.name as department_name
    FROM capa_items c
    LEFT JOIN departments d ON d.id = c.department_id
    WHERE c.id = ? AND c.company_id = ?
  `).get(id, companyId);
  if (!capa) return null;
  const actions = db.prepare('SELECT * FROM capa_actions WHERE capa_id = ? ORDER BY created_at ASC').all(id);
  return { ...capa, actions };
}

function ownedCAPA(req) {
  return db.prepare('SELECT * FROM capa_items WHERE id = ? AND company_id = ?')
    .get(req.params.id, req.companyId) || null;
}

// ─── GET /capa ────────────────────────────────────────────────────────────────

router.get('/', (req, res) => {
  const { status, priority, department_id, search } = req.query;
  let sql = `
    SELECT c.*, d.name as department_name
    FROM capa_items c
    LEFT JOIN departments d ON d.id = c.department_id
    WHERE c.company_id = ?
  `;
  const params = [req.companyId];
  if (status) { sql += ' AND c.status = ?'; params.push(status); }
  if (priority) { sql += ' AND c.priority = ?'; params.push(priority); }
  if (department_id) { sql += ' AND c.department_id = ?'; params.push(department_id); }
  if (search) { sql += ' AND (c.title LIKE ? OR c.number LIKE ?)'; params.push(`%${search}%`, `%${search}%`); }
  sql += ' ORDER BY c.created_at DESC';
  res.json(db.prepare(sql).all(...params));
});

// ─── GET /capa/summary ────────────────────────────────────────────────────────

router.get('/summary', (req, res) => {
  const today = new Date().toISOString().slice(0, 10);
  const monthStart = today.slice(0, 7) + '-01';
  const open = db.prepare("SELECT COUNT(*) as n FROM capa_items WHERE company_id = ? AND status != 'closed'").get(req.companyId).n;
  const overdue = db.prepare("SELECT COUNT(*) as n FROM capa_items WHERE company_id = ? AND status != 'closed' AND due_date < ?").get(req.companyId, today).n;
  const closed_this_month = db.prepare("SELECT COUNT(*) as n FROM capa_items WHERE company_id = ? AND status = 'closed' AND closed_at >= ?").get(req.companyId, monthStart).n;

  const byStatus = db.prepare('SELECT status, COUNT(*) as n FROM capa_items WHERE company_id = ? GROUP BY status').all(req.companyId);
  const by_status = Object.fromEntries(byStatus.map(r => [r.status, r.n]));
  const byPriority = db.prepare('SELECT priority, COUNT(*) as n FROM capa_items WHERE company_id = ? GROUP BY priority').all(req.companyId);
  const by_priority = Object.fromEntries(byPriority.map(r => [r.priority, r.n]));

  const avgRow = db.prepare("SELECT AVG(CAST((julianday(closed_at) - julianday(created_at)) AS REAL)) as avg_days FROM capa_items WHERE company_id = ? AND status = 'closed' AND closed_at IS NOT NULL").get(req.companyId);
  res.json({ open, overdue, closed_this_month, avg_days_to_close: Math.round(avgRow.avg_days || 0), by_status, by_priority });
});

// ─── GET /capa/:id ────────────────────────────────────────────────────────────

router.get('/:id', (req, res) => {
  const capa = capaWithDetails(req.params.id, req.companyId);
  if (!capa) return res.status(404).json({ error: 'Not found' });
  res.json(capa);
});

// ─── POST /capa ───────────────────────────────────────────────────────────────

router.post('/', (req, res) => {
  const { title, description = '', source = 'manual', source_ref = '', type = 'corrective', priority = 'medium', department_id, owner_name = '', due_date } = req.body;
  if (!title?.trim()) return res.status(400).json({ error: 'title required' });
  const id = uuidv4();
  const number = nextCAPANumber(req.companyId);
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO capa_items (id, company_id, number, title, description, source, source_ref, type, priority, department_id, owner_name, due_date, created_by, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, req.companyId, number, title.trim(), description, source, source_ref, type, priority, department_id || null, owner_name, due_date || null, req.user?.display_name || '', now, now);
  logActivity(req.companyId, 'capa', id, `CAPA ${number} created: ${title}`, req.user?.display_name);
  res.status(201).json(capaWithDetails(id, req.companyId));
});

// ─── PUT /capa/:id ────────────────────────────────────────────────────────────

router.put('/:id', (req, res) => {
  const capa = ownedCAPA(req);
  if (!capa) return res.status(404).json({ error: 'Not found' });
  const { title, description, source, type, priority, status, department_id, owner_name, due_date, root_cause_analysis, containment_action, corrective_action, preventive_action, verified_by } = req.body;

  const now = new Date().toISOString();
  let closed_at = capa.closed_at;
  let verified_at = capa.verified_at;
  if (status === 'closed' && capa.status !== 'closed') closed_at = now;
  if (status === 'verification' && capa.status !== 'verification') verified_at = now;

  db.prepare(`
    UPDATE capa_items SET
      title = COALESCE(?, title), description = COALESCE(?, description),
      source = COALESCE(?, source), type = COALESCE(?, type),
      priority = COALESCE(?, priority), status = COALESCE(?, status),
      department_id = COALESCE(?, department_id), owner_name = COALESCE(?, owner_name),
      due_date = COALESCE(?, due_date),
      root_cause_analysis = COALESCE(?, root_cause_analysis),
      containment_action = COALESCE(?, containment_action),
      corrective_action = COALESCE(?, corrective_action),
      preventive_action = COALESCE(?, preventive_action),
      verified_by = COALESCE(?, verified_by),
      verified_at = COALESCE(?, verified_at),
      closed_at = ?,
      updated_at = ?
    WHERE id = ?
  `).run(title, description, source, type, priority, status, department_id, owner_name, due_date, root_cause_analysis, containment_action, corrective_action, preventive_action, verified_by, verified_at, closed_at, now, req.params.id);

  if (status && status !== capa.status) {
    logActivity(req.companyId, 'capa', req.params.id, `Status changed to ${status}`, req.user?.display_name);
  }
  res.json(capaWithDetails(req.params.id, req.companyId));
});

// ─── DELETE /capa/:id ─────────────────────────────────────────────────────────

router.delete('/:id', (req, res) => {
  const capa = ownedCAPA(req);
  if (!capa) return res.status(404).json({ error: 'Not found' });
  db.prepare('DELETE FROM capa_items WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// ─── GET /capa/:id/actions ─────────────────────────────────────────────────────

router.get('/:id/actions', (req, res) => {
  if (!ownedCAPA(req)) return res.status(404).json({ error: 'Not found' });
  res.json(db.prepare('SELECT * FROM capa_actions WHERE capa_id = ? ORDER BY created_at ASC').all(req.params.id));
});

// ─── POST /capa/:id/actions ────────────────────────────────────────────────────

router.post('/:id/actions', (req, res) => {
  if (!ownedCAPA(req)) return res.status(404).json({ error: 'Not found' });
  const { description, owner_name = '', due_date, notes = '' } = req.body;
  if (!description?.trim()) return res.status(400).json({ error: 'description required' });
  const id = uuidv4();
  db.prepare(`INSERT INTO capa_actions (id, capa_id, description, owner_name, due_date, notes) VALUES (?, ?, ?, ?, ?, ?)`)
    .run(id, req.params.id, description.trim(), owner_name, due_date || null, notes);
  res.status(201).json(db.prepare('SELECT * FROM capa_actions WHERE id = ?').get(id));
});

// ─── PUT /capa/:capaId/actions/:actionId ──────────────────────────────────────

router.put('/:id/actions/:actionId', (req, res) => {
  if (!ownedCAPA(req)) return res.status(404).json({ error: 'Not found' });
  const action = db.prepare('SELECT * FROM capa_actions WHERE id = ? AND capa_id = ?').get(req.params.actionId, req.params.id);
  if (!action) return res.status(404).json({ error: 'Action not found' });
  const { status, description, owner_name, due_date, notes } = req.body;
  const completed_at = status === 'complete' && action.status !== 'complete' ? new Date().toISOString() : action.completed_at;
  db.prepare(`UPDATE capa_actions SET status = COALESCE(?, status), description = COALESCE(?, description), owner_name = COALESCE(?, owner_name), due_date = COALESCE(?, due_date), notes = COALESCE(?, notes), completed_at = ? WHERE id = ?`)
    .run(status, description, owner_name, due_date, notes, completed_at, req.params.actionId);
  res.json(db.prepare('SELECT * FROM capa_actions WHERE id = ?').get(req.params.actionId));
});

module.exports = router;

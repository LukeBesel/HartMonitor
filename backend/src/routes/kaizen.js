const express = require('express');
const { v4: uuidv4 } = require('uuid');
const db = require('../db');
const { logActivity } = require('../activity');

const router = express.Router();

function nextIdeaNumber(companyId) {
  const year = new Date().getFullYear();
  const row = db.prepare(`SELECT idea_number FROM kaizen_ideas WHERE company_id = ? AND idea_number LIKE 'KZN-${year}-%' ORDER BY idea_number DESC LIMIT 1`).get(companyId);
  if (!row) return `KZN-${year}-001`;
  const last = parseInt(row.idea_number.split('-')[2]) || 0;
  return `KZN-${year}-${String(last + 1).padStart(3, '0')}`;
}

function ownedIdea(req) {
  return db.prepare('SELECT * FROM kaizen_ideas WHERE id = ? AND company_id = ?').get(req.params.id, req.companyId) || null;
}

function ideaWithDept(id, companyId) {
  return db.prepare(`
    SELECT k.*, d.name as department_name
    FROM kaizen_ideas k
    LEFT JOIN departments d ON d.id = k.department_id
    WHERE k.id = ? AND k.company_id = ?
  `).get(id, companyId);
}

// ─── GET /kaizen ──────────────────────────────────────────────────────────────

router.get('/', (req, res) => {
  const { status, category, department_id, search } = req.query;
  let sql = `
    SELECT k.*, d.name as department_name
    FROM kaizen_ideas k
    LEFT JOIN departments d ON d.id = k.department_id
    WHERE k.company_id = ?
  `;
  const params = [req.companyId];
  if (status) { sql += ' AND k.status = ?'; params.push(status); }
  if (category) { sql += ' AND k.category = ?'; params.push(category); }
  if (department_id) { sql += ' AND k.department_id = ?'; params.push(department_id); }
  if (search) { sql += ' AND (k.title LIKE ? OR k.idea_number LIKE ?)'; params.push(`%${search}%`, `%${search}%`); }
  sql += ' ORDER BY k.created_at DESC';
  res.json(db.prepare(sql).all(...params));
});

// ─── GET /kaizen/summary ──────────────────────────────────────────────────────

router.get('/summary', (req, res) => {
  const monthStart = new Date().toISOString().slice(0, 7) + '-01';
  const total = db.prepare('SELECT COUNT(*) as n FROM kaizen_ideas WHERE company_id = ?').get(req.companyId).n;
  const implemented = db.prepare("SELECT COUNT(*) as n FROM kaizen_ideas WHERE company_id = ? AND status = 'implemented'").get(req.companyId).n;
  const in_progress = db.prepare("SELECT COUNT(*) as n FROM kaizen_ideas WHERE company_id = ? AND status IN ('approved','in_progress')").get(req.companyId).n;
  const submitted_this_month = db.prepare('SELECT COUNT(*) as n FROM kaizen_ideas WHERE company_id = ? AND created_at >= ?').get(req.companyId, monthStart).n;
  const savingsRow = db.prepare("SELECT SUM(actual_savings) as total FROM kaizen_ideas WHERE company_id = ? AND status = 'implemented'").get(req.companyId);
  res.json({ total, implemented, in_progress, submitted_this_month, total_savings: savingsRow.total || 0 });
});

// ─── GET /kaizen/:id ──────────────────────────────────────────────────────────

router.get('/:id', (req, res) => {
  const idea = ideaWithDept(req.params.id, req.companyId);
  if (!idea) return res.status(404).json({ error: 'Not found' });
  res.json(idea);
});

// ─── POST /kaizen ─────────────────────────────────────────────────────────────

router.post('/', (req, res) => {
  const { title, description = '', category = 'cost', type = 'improvement', department_id, submitter_name = '', estimated_savings = 0, estimated_hours = 0, target_date, before_description = '' } = req.body;
  if (!title?.trim()) return res.status(400).json({ error: 'title required' });
  const id = uuidv4();
  const idea_number = nextIdeaNumber(req.companyId);
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO kaizen_ideas (id, company_id, idea_number, title, description, category, type, department_id, submitter_id, submitter_name, estimated_savings, estimated_hours, target_date, before_description, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, req.companyId, idea_number, title.trim(), description, category, type, department_id || null, req.user?.id || null, submitter_name || req.user?.display_name || '', estimated_savings, estimated_hours, target_date || null, before_description, now, now);
  logActivity(req.companyId, 'kaizen', id, `Idea ${idea_number} submitted: ${title}`, req.user?.display_name);
  res.status(201).json(ideaWithDept(id, req.companyId));
});

// ─── PUT /kaizen/:id ──────────────────────────────────────────────────────────

router.put('/:id', (req, res) => {
  const idea = ownedIdea(req);
  if (!idea) return res.status(404).json({ error: 'Not found' });
  const { title, description, category, type, status, department_id, champion_name, estimated_savings, actual_savings, estimated_hours, actual_hours, target_date, rejection_reason, before_description, after_description } = req.body;
  const now = new Date().toISOString();
  const completed_at = status === 'implemented' && idea.status !== 'implemented' ? now : idea.completed_at;
  db.prepare(`
    UPDATE kaizen_ideas SET
      title = COALESCE(?, title), description = COALESCE(?, description),
      category = COALESCE(?, category), type = COALESCE(?, type),
      status = COALESCE(?, status), department_id = COALESCE(?, department_id),
      champion_name = COALESCE(?, champion_name),
      estimated_savings = COALESCE(?, estimated_savings),
      actual_savings = COALESCE(?, actual_savings),
      estimated_hours = COALESCE(?, estimated_hours),
      actual_hours = COALESCE(?, actual_hours),
      target_date = COALESCE(?, target_date),
      rejection_reason = COALESCE(?, rejection_reason),
      before_description = COALESCE(?, before_description),
      after_description = COALESCE(?, after_description),
      completed_at = ?,
      updated_at = ?
    WHERE id = ?
  `).run(title, description, category, type, status, department_id, champion_name, estimated_savings, actual_savings, estimated_hours, actual_hours, target_date, rejection_reason, before_description, after_description, completed_at, now, req.params.id);
  if (status && status !== idea.status) {
    logActivity(req.companyId, 'kaizen', req.params.id, `Idea status → ${status}`, req.user?.display_name);
  }
  res.json(ideaWithDept(req.params.id, req.companyId));
});

// ─── DELETE /kaizen/:id ───────────────────────────────────────────────────────

router.delete('/:id', (req, res) => {
  if (!ownedIdea(req)) return res.status(404).json({ error: 'Not found' });
  db.prepare('DELETE FROM kaizen_ideas WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

module.exports = router;

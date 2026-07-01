const express = require('express');
const { v4: uuidv4 } = require('uuid');
const db = require('../db');
const { logActivity } = require('../activity');

const router = express.Router();

function ownedNote(req) {
  return db.prepare('SELECT * FROM shift_notes WHERE id = ? AND company_id = ?').get(req.params.id, req.companyId) || null;
}

function noteWithDept(id, companyId) {
  return db.prepare(`
    SELECT s.*, d.name as department_name
    FROM shift_notes s
    LEFT JOIN departments d ON d.id = s.department_id
    WHERE s.id = ? AND s.company_id = ?
  `).get(id, companyId);
}

// ─── GET /shifts ──────────────────────────────────────────────────────────────

router.get('/', (req, res) => {
  const { department_id, date, shift_name } = req.query;
  let sql = `
    SELECT s.*, d.name as department_name
    FROM shift_notes s
    LEFT JOIN departments d ON d.id = s.department_id
    WHERE s.company_id = ?
  `;
  const params = [req.companyId];
  if (department_id) { sql += ' AND s.department_id = ?'; params.push(department_id); }
  if (date) { sql += ' AND s.shift_date = ?'; params.push(date); }
  if (shift_name) { sql += ' AND s.shift_name = ?'; params.push(shift_name); }
  sql += ' ORDER BY s.shift_date DESC, CASE s.shift_name WHEN \'day\' THEN 0 WHEN \'afternoon\' THEN 1 WHEN \'night\' THEN 2 ELSE 3 END LIMIT 200';
  res.json(db.prepare(sql).all(...params));
});

// ─── GET /shifts/:id ──────────────────────────────────────────────────────────

router.get('/:id', (req, res) => {
  const note = noteWithDept(req.params.id, req.companyId);
  if (!note) return res.status(404).json({ error: 'Not found' });
  res.json(note);
});

// ─── POST /shifts ─────────────────────────────────────────────────────────────

router.post('/', (req, res) => {
  const { department_id, shift_date, shift_name = 'day', shift_label = '', author_name = '', good_count = 0, scrap_count = 0, downtime_minutes = 0, attendance_count = 0, safety_incidents = 0, notes = '', issues = '[]' } = req.body;
  if (!shift_date) return res.status(400).json({ error: 'shift_date required' });
  const id = uuidv4();
  const now = new Date().toISOString();
  const issuesStr = typeof issues === 'string' ? issues : JSON.stringify(issues);
  db.prepare(`
    INSERT INTO shift_notes (id, company_id, department_id, shift_date, shift_name, shift_label, author_id, author_name, good_count, scrap_count, downtime_minutes, attendance_count, safety_incidents, notes, issues, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, req.companyId, department_id || null, shift_date, shift_name, shift_label, req.user?.id || null, author_name || req.user?.display_name || '', good_count, scrap_count, downtime_minutes, attendance_count, safety_incidents, notes, issuesStr, now, now);
  logActivity(req.companyId, 'shift', id, `Shift note created (${shift_name} ${shift_date})`, req.user?.display_name);
  res.status(201).json(noteWithDept(id, req.companyId));
});

// ─── PUT /shifts/:id ──────────────────────────────────────────────────────────

router.put('/:id', (req, res) => {
  const note = ownedNote(req);
  if (!note) return res.status(404).json({ error: 'Not found' });
  const { good_count, scrap_count, downtime_minutes, attendance_count, safety_incidents, notes, issues, shift_label, author_name } = req.body;
  const issuesStr = issues !== undefined ? (typeof issues === 'string' ? issues : JSON.stringify(issues)) : note.issues;
  db.prepare(`
    UPDATE shift_notes SET
      good_count = COALESCE(?, good_count),
      scrap_count = COALESCE(?, scrap_count),
      downtime_minutes = COALESCE(?, downtime_minutes),
      attendance_count = COALESCE(?, attendance_count),
      safety_incidents = COALESCE(?, safety_incidents),
      notes = COALESCE(?, notes),
      issues = ?,
      shift_label = COALESCE(?, shift_label),
      author_name = COALESCE(?, author_name),
      updated_at = datetime('now')
    WHERE id = ?
  `).run(good_count, scrap_count, downtime_minutes, attendance_count, safety_incidents, notes, issuesStr, shift_label, author_name, req.params.id);
  res.json(noteWithDept(req.params.id, req.companyId));
});

// ─── POST /shifts/:id/submit ───────────────────────────────────────────────────

router.post('/:id/submit', (req, res) => {
  const note = ownedNote(req);
  if (!note) return res.status(404).json({ error: 'Not found' });
  db.prepare("UPDATE shift_notes SET status = 'submitted', updated_at = datetime('now') WHERE id = ?").run(req.params.id);
  logActivity(req.companyId, 'shift', req.params.id, `Shift note submitted`, req.user?.display_name);
  res.json(noteWithDept(req.params.id, req.companyId));
});

// ─── POST /shifts/:id/handoff ──────────────────────────────────────────────────

router.post('/:id/handoff', (req, res) => {
  const note = ownedNote(req);
  if (!note) return res.status(404).json({ error: 'Not found' });
  const { handoff_notes = '', handed_off_to = '' } = req.body;
  const now = new Date().toISOString();
  db.prepare("UPDATE shift_notes SET status = 'handed_off', handoff_notes = ?, handed_off_to = ?, handed_off_at = ?, updated_at = ? WHERE id = ?")
    .run(handoff_notes, handed_off_to, now, now, req.params.id);
  logActivity(req.companyId, 'shift', req.params.id, `Shift handed off to ${handed_off_to}`, req.user?.display_name);
  res.json(noteWithDept(req.params.id, req.companyId));
});

// ─── DELETE /shifts/:id ────────────────────────────────────────────────────────

router.delete('/:id', (req, res) => {
  if (!ownedNote(req)) return res.status(404).json({ error: 'Not found' });
  db.prepare('DELETE FROM shift_notes WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

module.exports = router;

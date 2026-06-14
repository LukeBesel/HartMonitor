const express = require('express');
const { v4: uuidv4 } = require('uuid');
const db = require('../db');
const { requireRole } = require('../middleware/auth');
const { broadcast } = require('../ws');

const router = express.Router();

const SEVERITIES = ['info', 'warning', 'urgent'];

// ─── GET / - recent broadcast messages for the org ────────────────────────────

router.get('/', (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 50, 200);
  const rows = db.prepare(`
    SELECT id, sender_id, sender_name, sender_role, body, severity, created_at
    FROM messages WHERE company_id = ?
    ORDER BY created_at DESC LIMIT ?
  `).all(req.companyId, limit);
  res.json(rows);
});

// ─── POST / - broadcast a new message (supervisor+) ───────────────────────────

router.post('/', requireRole('supervisor'), (req, res) => {
  const body = (req.body.body || '').trim();
  const severity = SEVERITIES.includes(req.body.severity) ? req.body.severity : 'info';
  if (!body) return res.status(400).json({ error: 'Message body is required' });

  const id = uuidv4();
  db.prepare(`
    INSERT INTO messages (id, company_id, sender_id, sender_name, sender_role, body, severity)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(id, req.companyId, req.user.id, req.user.display_name, req.user.role, body, severity);

  const message = db.prepare(`
    SELECT id, sender_id, sender_name, sender_role, body, severity, created_at FROM messages WHERE id = ?
  `).get(id);

  broadcast(req.companyId, { type: 'message', message });
  res.status(201).json(message);
});

module.exports = router;

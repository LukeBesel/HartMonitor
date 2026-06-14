const express = require('express');
const { v4: uuidv4 } = require('uuid');
const db = require('../db');
const { requireRole } = require('../middleware/auth');
const { broadcast, sendToUsers } = require('../ws');

const router = express.Router();

const SEVERITIES = ['info', 'warning', 'urgent'];

const SELECT_MESSAGE = `
  SELECT m.id, m.sender_id, m.sender_name, m.sender_role, m.body, m.severity,
         m.created_at, m.recipient_id, r.display_name AS recipient_name
  FROM messages m
  LEFT JOIN users r ON r.id = m.recipient_id
`;

// ─── GET / - recent messages visible to the current user ──────────────────────
// Shows company-wide broadcasts plus any direct messages sent to or by the user.

router.get('/', (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 50, 200);
  const rows = db.prepare(`
    ${SELECT_MESSAGE}
    WHERE m.company_id = ?
      AND (m.recipient_id IS NULL OR m.recipient_id = ? OR m.sender_id = ?)
    ORDER BY m.created_at DESC LIMIT ?
  `).all(req.companyId, req.user.id, req.user.id, limit);
  res.json(rows);
});

// ─── POST / - send a message: company-wide, or direct to one user (supervisor+) ─

router.post('/', requireRole('supervisor'), (req, res) => {
  const body = (req.body.body || '').trim();
  const severity = SEVERITIES.includes(req.body.severity) ? req.body.severity : 'info';
  if (!body) return res.status(400).json({ error: 'Message body is required' });

  // Optional direct recipient — must be a teammate in the same company.
  let recipientId = req.body.recipient_id || null;
  if (recipientId) {
    const recipient = db.prepare('SELECT id FROM users WHERE id = ? AND company_id = ?')
      .get(recipientId, req.companyId);
    if (!recipient) return res.status(400).json({ error: 'Unknown recipient' });
  }

  const id = uuidv4();
  db.prepare(`
    INSERT INTO messages (id, company_id, sender_id, sender_name, sender_role, body, severity, recipient_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, req.companyId, req.user.id, req.user.display_name, req.user.role, body, severity, recipientId);

  const message = db.prepare(`${SELECT_MESSAGE} WHERE m.id = ?`).get(id);

  if (recipientId) {
    // Private: only push to the recipient and the sender.
    sendToUsers(req.companyId, [recipientId, req.user.id], { type: 'message', message });
  } else {
    broadcast(req.companyId, { type: 'message', message });
  }
  res.status(201).json(message);
});

module.exports = router;

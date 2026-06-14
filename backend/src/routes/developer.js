const express = require('express');
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const db = require('../db');
const { requireRole } = require('../middleware/auth');
const { getPlanRow } = require('./config');
const { sendTestDelivery } = require('../webhooks');
const { EVENTS } = require('../notifications');

const router = express.Router();

function requireEnterprise(req, res, next) {
  const plan = getPlanRow(req.companyId);
  if (plan.tier !== 'enterprise') {
    return res.status(403).json({ error: 'not_available', message: 'API access and webhooks are an Enterprise feature. Upgrade your plan to enable them.' });
  }
  next();
}

function hashKey(key) {
  return crypto.createHash('sha256').update(key).digest('hex');
}

// Webhook event keys customers can subscribe to, plus '*' for everything.
const WEBHOOK_EVENTS = ['*', ...Object.keys(EVENTS)];

// ─── GET /availability — does this org have API/webhook access? ───────────────

router.get('/availability', (req, res) => {
  const plan = getPlanRow(req.companyId);
  res.json({ available: plan.tier === 'enterprise', events: WEBHOOK_EVENTS });
});

// ─── API Keys ──────────────────────────────────────────────────────────────────

// GET /api-keys — list keys (never returns the secret) (manager+)
router.get('/api-keys', requireRole('manager'), requireEnterprise, (req, res) => {
  const rows = db.prepare(`
    SELECT id, name, key_prefix, last_used_at, created_at FROM api_keys
    WHERE company_id = ? ORDER BY created_at DESC
  `).all(req.companyId);
  res.json(rows);
});

// POST /api-keys — generate a new key (manager+). The full key is returned
// exactly once — only the prefix and a hash are stored.
router.post('/api-keys', requireRole('manager'), requireEnterprise, (req, res) => {
  const name = (req.body.name || '').trim() || 'API Key';
  const secret = crypto.randomBytes(24).toString('hex');
  const key = `hm_live_${secret}`;
  const prefix = key.slice(0, 12);

  const id = uuidv4();
  db.prepare(`
    INSERT INTO api_keys (id, company_id, name, key_prefix, key_hash, created_by) VALUES (?, ?, ?, ?, ?, ?)
  `).run(id, req.companyId, name, prefix, hashKey(key), req.user.id);

  res.status(201).json({ id, name, key_prefix: prefix, key, created_at: new Date().toISOString() });
});

// DELETE /api-keys/:id — revoke a key (manager+)
router.delete('/api-keys/:id', requireRole('manager'), requireEnterprise, (req, res) => {
  const row = db.prepare('SELECT id FROM api_keys WHERE id = ? AND company_id = ?').get(req.params.id, req.companyId);
  if (!row) return res.status(404).json({ error: 'API key not found' });
  db.prepare('DELETE FROM api_keys WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

// ─── Webhooks ──────────────────────────────────────────────────────────────────

// GET /webhooks — list webhooks (secret omitted) (manager+)
router.get('/webhooks', requireRole('manager'), requireEnterprise, (req, res) => {
  const rows = db.prepare('SELECT id, url, events, is_active, created_at FROM webhooks WHERE company_id = ? ORDER BY created_at DESC').all(req.companyId);
  res.json(rows.map(r => ({ ...r, events: JSON.parse(r.events || '[]') })));
});

// POST /webhooks — register a new webhook endpoint (manager+)
router.post('/webhooks', requireRole('manager'), requireEnterprise, (req, res) => {
  const { url, events = [] } = req.body;
  if (!url || !/^https?:\/\//.test(url)) return res.status(400).json({ error: 'A valid http(s) url is required' });
  const validEvents = (Array.isArray(events) ? events : []).filter(e => WEBHOOK_EVENTS.includes(e));

  const id = uuidv4();
  const secret = crypto.randomBytes(24).toString('hex');
  db.prepare(`INSERT INTO webhooks (id, company_id, url, events, secret, is_active) VALUES (?, ?, ?, ?, ?, 1)`)
    .run(id, req.companyId, url, JSON.stringify(validEvents), secret);

  const row = db.prepare('SELECT id, url, events, secret, is_active, created_at FROM webhooks WHERE id = ?').get(id);
  res.status(201).json({ ...row, events: JSON.parse(row.events || '[]') });
});

// PUT /webhooks/:id — update url/events/active state (manager+)
router.put('/webhooks/:id', requireRole('manager'), requireEnterprise, (req, res) => {
  const hook = db.prepare('SELECT * FROM webhooks WHERE id = ? AND company_id = ?').get(req.params.id, req.companyId);
  if (!hook) return res.status(404).json({ error: 'Webhook not found' });

  const url = req.body.url !== undefined ? req.body.url : hook.url;
  if (!/^https?:\/\//.test(url)) return res.status(400).json({ error: 'A valid http(s) url is required' });
  const events = req.body.events !== undefined
    ? (Array.isArray(req.body.events) ? req.body.events.filter(e => WEBHOOK_EVENTS.includes(e)) : [])
    : JSON.parse(hook.events || '[]');
  const is_active = req.body.is_active !== undefined ? (req.body.is_active ? 1 : 0) : hook.is_active;

  db.prepare('UPDATE webhooks SET url=?, events=?, is_active=? WHERE id=?').run(url, JSON.stringify(events), is_active, req.params.id);

  const row = db.prepare('SELECT id, url, events, secret, is_active, created_at FROM webhooks WHERE id = ?').get(req.params.id);
  res.json({ ...row, events: JSON.parse(row.events || '[]') });
});

// DELETE /webhooks/:id (manager+)
router.delete('/webhooks/:id', requireRole('manager'), requireEnterprise, (req, res) => {
  const hook = db.prepare('SELECT id FROM webhooks WHERE id = ? AND company_id = ?').get(req.params.id, req.companyId);
  if (!hook) return res.status(404).json({ error: 'Webhook not found' });
  db.prepare('DELETE FROM webhooks WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

// GET /webhooks/:id/deliveries — recent delivery attempts (manager+)
router.get('/webhooks/:id/deliveries', requireRole('manager'), requireEnterprise, (req, res) => {
  const hook = db.prepare('SELECT id FROM webhooks WHERE id = ? AND company_id = ?').get(req.params.id, req.companyId);
  if (!hook) return res.status(404).json({ error: 'Webhook not found' });
  const rows = db.prepare('SELECT id, event, status_code, success, error, created_at FROM webhook_deliveries WHERE webhook_id = ? ORDER BY created_at DESC LIMIT 50').all(req.params.id);
  res.json(rows);
});

// POST /webhooks/:id/test — send a test delivery (manager+)
router.post('/webhooks/:id/test', requireRole('manager'), requireEnterprise, (req, res) => {
  const hook = db.prepare('SELECT * FROM webhooks WHERE id = ? AND company_id = ?').get(req.params.id, req.companyId);
  if (!hook) return res.status(404).json({ error: 'Webhook not found' });
  sendTestDelivery(hook);
  res.json({ success: true });
});

module.exports = router;

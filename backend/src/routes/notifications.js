const express = require('express');
const db = require('../db');
const { requireRole } = require('../middleware/auth');
const { getPrefs, setPrefs, notify, EVENTS, smtpConfigured, twilioConfigured } = require('../notifications');

const router = express.Router();

// ─── GET / - notification preferences + provider status ───────────────────────

router.get('/', (req, res) => {
  res.json({
    ...getPrefs(req.companyId),
    available_events: EVENTS,
    email_configured: smtpConfigured(),
    sms_configured: twilioConfigured(),
  });
});

// ─── PUT / - update notification preferences (manager+) ───────────────────────

router.put('/', requireRole('manager'), (req, res) => {
  const { email_enabled, email_to, sms_enabled, sms_to, events } = req.body;
  const prefs = setPrefs(req.companyId, { email_enabled, email_to, sms_enabled, sms_to, events });
  res.json({
    ...prefs,
    available_events: EVENTS,
    email_configured: smtpConfigured(),
    sms_configured: twilioConfigured(),
  });
});

// ─── GET /log - recent notification delivery log (manager+) ───────────────────

router.get('/log', requireRole('manager'), (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 50, 200);
  const rows = db.prepare(`
    SELECT id, channel, event, recipient, subject, status, created_at FROM notification_log
    WHERE company_id = ? ORDER BY created_at DESC LIMIT ?
  `).all(req.companyId, limit);
  res.json(rows);
});

// ─── POST /test - send a test notification through configured channels (manager+) ─

router.post('/test', requireRole('manager'), (req, res) => {
  const prefs = getPrefs(req.companyId);
  if (!prefs.email_enabled && !prefs.sms_enabled) {
    return res.status(400).json({ error: 'Enable email or SMS alerts and add a recipient first' });
  }
  if (prefs.email_enabled && !prefs.email_to) return res.status(400).json({ error: 'Add an email recipient first' });
  if (prefs.sms_enabled && !prefs.sms_to) return res.status(400).json({ error: 'Add an SMS recipient first' });

  notify(req.companyId, 'test.notification', {
    subject: 'HartMonitor test notification',
    body: `This is a test notification from HartMonitor, triggered by ${req.user.display_name}.`,
    force: true,
  });

  res.json({ success: true });
});

module.exports = router;

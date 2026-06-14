// ─── Notifications (email / SMS alerts) ───────────────────────────────────────
// Demo-mode by default: every notification is recorded in notification_log so
// the Settings > Notifications screen has something to show. The moment SMTP
// (for email) or Twilio (for SMS) credentials are present in the environment,
// the exact same calls start sending real messages.
//
// Email — set SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS (and optionally
//         SMTP_FROM, SMTP_SECURE).
// SMS   — set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM_NUMBER.
//         Uses Twilio's plain REST API via fetch — no SDK dependency required.

const { v4: uuidv4 } = require('uuid');
const db = require('./db');

const EVENTS = {
  'ncr.created':              'New NCR raised',
  'inventory.low_stock':      'Item fell below its reorder point',
  'workorder.overdue':        'Work order marked overdue',
  'workorder.schedule_changed': 'Work order schedule changed',
  'station.down':             'Station marked down',
};

function smtpConfigured() {
  return !!(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);
}

function twilioConfigured() {
  return !!(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_FROM_NUMBER);
}

let transporter;
function getTransporter() {
  if (!smtpConfigured()) return null;
  if (transporter === undefined) transporter = null;
  if (!transporter) {
    const nodemailer = require('nodemailer');
    transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT || 587),
      secure: process.env.SMTP_SECURE === 'true',
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    });
  }
  return transporter;
}

// ─── Preferences (stored in org_settings) ─────────────────────────────────────

function getPrefs(companyId) {
  const rows = db.prepare("SELECT key, value FROM org_settings WHERE company_id = ? AND key LIKE 'notif\\_%' ESCAPE '\\'").all(companyId);
  const raw = {};
  for (const r of rows) raw[r.key] = r.value;
  let events = [];
  try { events = JSON.parse(raw.notif_events || '[]'); } catch { /* ignore */ }
  return {
    email_enabled: raw.notif_email_enabled === 'true',
    email_to: raw.notif_email_to || '',
    sms_enabled: raw.notif_sms_enabled === 'true',
    sms_to: raw.notif_sms_to || '',
    events,
  };
}

function setPrefs(companyId, prefs) {
  const ins = db.prepare(`INSERT INTO org_settings (company_id, key, value, updated_at) VALUES (?, ?, ?, datetime('now')) ON CONFLICT(company_id, key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`);
  if (prefs.email_enabled !== undefined) ins.run(companyId, 'notif_email_enabled', String(!!prefs.email_enabled));
  if (prefs.email_to !== undefined)      ins.run(companyId, 'notif_email_to', String(prefs.email_to || ''));
  if (prefs.sms_enabled !== undefined)   ins.run(companyId, 'notif_sms_enabled', String(!!prefs.sms_enabled));
  if (prefs.sms_to !== undefined)        ins.run(companyId, 'notif_sms_to', String(prefs.sms_to || ''));
  if (prefs.events !== undefined)        ins.run(companyId, 'notif_events', JSON.stringify(prefs.events || []));
  return getPrefs(companyId);
}

// ─── Sending ───────────────────────────────────────────────────────────────────

function logNotification(companyId, channel, event, recipient, subject, body, status) {
  db.prepare(`INSERT INTO notification_log (id, company_id, channel, event, recipient, subject, body, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(uuidv4(), companyId, channel, event, recipient, subject, body, status);
}

async function sendEmail(companyId, event, to, subject, body) {
  let status = 'simulated';
  const t = getTransporter();
  if (t) {
    try {
      await t.sendMail({ from: process.env.SMTP_FROM || process.env.SMTP_USER, to, subject, text: body });
      status = 'sent';
    } catch (e) {
      console.error('[notifications] email send failed:', e.message);
      status = 'failed';
    }
  }
  logNotification(companyId, 'email', event, to, subject, body, status);
}

async function sendSMS(companyId, event, to, body) {
  let status = 'simulated';
  if (twilioConfigured()) {
    try {
      const sid = process.env.TWILIO_ACCOUNT_SID;
      const auth = Buffer.from(`${sid}:${process.env.TWILIO_AUTH_TOKEN}`).toString('base64');
      const params = new URLSearchParams({ To: to, From: process.env.TWILIO_FROM_NUMBER, Body: body });
      const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
        method: 'POST',
        headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded' },
        body: params,
        signal: AbortSignal.timeout(8000),
      });
      status = res.ok ? 'sent' : 'failed';
    } catch (e) {
      console.error('[notifications] sms send failed:', e.message);
      status = 'failed';
    }
  }
  logNotification(companyId, 'sms', event, to, '', body, status);
}

// Fire-and-forget — never throws back to the caller's request handler.
// Pass force: true to bypass the subscribed-events check (used for test sends).
function notify(companyId, event, { subject = '', body, force = false }) {
  try {
    const prefs = getPrefs(companyId);
    if (!force && !prefs.events.includes(event)) return;
    if (prefs.email_enabled && prefs.email_to) sendEmail(companyId, event, prefs.email_to, subject || EVENTS[event] || event, body).catch(() => {});
    if (prefs.sms_enabled && prefs.sms_to) sendSMS(companyId, event, prefs.sms_to, body).catch(() => {});
  } catch (e) {
    console.error('[notifications] notify error:', e.message);
  }
}

module.exports = { notify, getPrefs, setPrefs, EVENTS, smtpConfigured, twilioConfigured };

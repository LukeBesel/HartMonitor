// ─── Webhooks (Enterprise integration) ─────────────────────────────────────────
// Delivers JSON event payloads to customer-registered endpoints. Every delivery
// attempt — success or failure — is logged to webhook_deliveries so the
// Developer settings screen can show a history.
//
// Payloads are signed with HMAC-SHA256 (hex digest of the JSON body, using the
// webhook's secret) in the X-HartMonitor-Signature header, so receivers can
// verify authenticity.

const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const db = require('./db');

function logDelivery(webhookId, event, statusCode, success, error) {
  db.prepare(`
    INSERT INTO webhook_deliveries (id, webhook_id, event, status_code, success, error)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(uuidv4(), webhookId, event, statusCode, success ? 1 : 0, error || null);
}

// Fire-and-forget — never throws back to the caller's request handler.
function deliverWebhooks(companyId, event, payload) {
  try {
    const hooks = db.prepare(`SELECT * FROM webhooks WHERE company_id = ? AND is_active = 1`).all(companyId);
    if (!hooks.length) return;

    const body = JSON.stringify({ event, data: payload, sent_at: new Date().toISOString() });

    for (const hook of hooks) {
      let events = [];
      try { events = JSON.parse(hook.events || '[]'); } catch { /* ignore */ }
      if (!events.includes(event) && !events.includes('*')) continue;

      const signature = crypto.createHmac('sha256', hook.secret || '').update(body).digest('hex');

      fetch(hook.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-HartMonitor-Event': event,
          'X-HartMonitor-Signature': signature,
        },
        body,
        signal: AbortSignal.timeout(8000),
      }).then(res => {
        logDelivery(hook.id, event, res.status, res.ok, res.ok ? null : `HTTP ${res.status}`);
      }).catch(e => {
        logDelivery(hook.id, event, 0, false, e.message);
      });
    }
  } catch (e) {
    console.error('[webhooks] deliverWebhooks error:', e.message);
  }
}

// Sends a single test delivery to one webhook, ignoring its event subscriptions.
function sendTestDelivery(webhook) {
  try {
    const body = JSON.stringify({ event: 'test.ping', data: { message: 'This is a test delivery from HartMonitor.' }, sent_at: new Date().toISOString() });
    const signature = crypto.createHmac('sha256', webhook.secret || '').update(body).digest('hex');

    fetch(webhook.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-HartMonitor-Event': 'test.ping',
        'X-HartMonitor-Signature': signature,
      },
      body,
      signal: AbortSignal.timeout(8000),
    }).then(res => {
      logDelivery(webhook.id, 'test.ping', res.status, res.ok, res.ok ? null : `HTTP ${res.status}`);
    }).catch(e => {
      logDelivery(webhook.id, 'test.ping', 0, false, e.message);
    });
  } catch (e) {
    console.error('[webhooks] sendTestDelivery error:', e.message);
  }
}

module.exports = { deliverWebhooks, sendTestDelivery };

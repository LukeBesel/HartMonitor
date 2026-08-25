// ─── Webhooks (Enterprise integration) ─────────────────────────────────────────
// Delivers JSON event payloads to customer-registered endpoints. Every delivery
// attempt — success or failure — is logged to webhook_deliveries so the
// Developer settings screen can show a history.
//
// Payloads are signed with HMAC-SHA256 (hex digest of the JSON body, using the
// webhook's secret) in the X-HartMonitor-Signature header, so receivers can
// verify authenticity.

const crypto = require('crypto');
const dns = require('dns').promises;
const net = require('net');
const { v4: uuidv4 } = require('uuid');
const db = require('./db');

// ─── SSRF guard ────────────────────────────────────────────────────────────────
// A webhook URL is customer-supplied and fetched server-side, so without a guard
// a tenant could point it at an internal address (127.0.0.1, an RFC-1918 host,
// the cloud metadata service at 169.254.169.254) and read the response back
// through the delivery log. We reject any URL whose host is — or resolves to — a
// non-public address. Literal IPs are checked directly; hostnames are resolved
// first, so an internal DNS name can't slip a private IP through.

function isBlockedIp(ip) {
  const v = net.isIP(ip);
  if (v === 4) {
    const [a, b] = ip.split('.').map(Number);
    if (a === 127) return true;                          // loopback
    if (a === 10) return true;                           // private
    if (a === 172 && b >= 16 && b <= 31) return true;    // private
    if (a === 192 && b === 168) return true;             // private
    if (a === 169 && b === 254) return true;             // link-local + metadata
    if (a === 100 && b >= 64 && b <= 127) return true;   // CGNAT
    if (a === 0) return true;                            // unspecified/this-network
    return false;
  }
  if (v === 6) {
    const lo = ip.toLowerCase();
    if (lo === '::1' || lo === '::') return true;         // loopback / unspecified
    if (lo.startsWith('fe80')) return true;              // link-local
    if (lo.startsWith('fc') || lo.startsWith('fd')) return true; // unique-local
    if (lo.startsWith('::ffff:')) return isBlockedIp(lo.slice(7)); // v4-mapped
    return false;
  }
  return false; // not an IP literal — caller resolves the hostname
}

/** Resolve, then reject any webhook target that is not a public http(s) host. */
async function assertSafeWebhookUrl(rawUrl) {
  let u;
  try { u = new URL(rawUrl); } catch { throw new Error('invalid URL'); }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error('only http(s) URLs are allowed');
  const host = u.hostname;
  if (!host) throw new Error('missing host');
  if (net.isIP(host)) {
    if (isBlockedIp(host)) throw new Error('URL points at a private or reserved address');
    return;
  }
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.internal')) {
    throw new Error('URL points at a private or reserved host');
  }
  let addrs;
  try { addrs = await dns.lookup(host, { all: true }); } catch { throw new Error('host did not resolve'); }
  if (!addrs.length || addrs.some(a => isBlockedIp(a.address))) {
    throw new Error('URL resolves to a private or reserved address');
  }
}

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

      (async () => {
        try {
          await assertSafeWebhookUrl(hook.url);
        } catch (e) {
          logDelivery(hook.id, event, 0, false, `blocked: ${e.message}`);
          return;
        }
        try {
          const res = await fetch(hook.url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-HartMonitor-Event': event, 'X-HartMonitor-Signature': signature },
            body,
            signal: AbortSignal.timeout(8000),
          });
          logDelivery(hook.id, event, res.status, res.ok, res.ok ? null : `HTTP ${res.status}`);
        } catch (e) {
          logDelivery(hook.id, event, 0, false, e.message);
        }
      })();
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

    (async () => {
      try {
        await assertSafeWebhookUrl(webhook.url);
      } catch (e) {
        logDelivery(webhook.id, 'test.ping', 0, false, `blocked: ${e.message}`);
        return;
      }
      try {
        const res = await fetch(webhook.url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-HartMonitor-Event': 'test.ping', 'X-HartMonitor-Signature': signature },
          body,
          signal: AbortSignal.timeout(8000),
        });
        logDelivery(webhook.id, 'test.ping', res.status, res.ok, res.ok ? null : `HTTP ${res.status}`);
      } catch (e) {
        logDelivery(webhook.id, 'test.ping', 0, false, e.message);
      }
    })();
  } catch (e) {
    console.error('[webhooks] sendTestDelivery error:', e.message);
  }
}

module.exports = { deliverWebhooks, sendTestDelivery, assertSafeWebhookUrl };

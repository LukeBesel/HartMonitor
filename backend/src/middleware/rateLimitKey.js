const crypto = require('crypto');
const { ipKeyGenerator } = require('express-rate-limit');
const db = require('../db');

// ─── Rate-limit keying ────────────────────────────────────────────────────────
// A factory is one public IP. Every tablet, kiosk and desk machine on the shop
// floor leaves the building through the same NAT gateway, so an IP-keyed budget
// is not a per-user budget at all — it is a budget for the entire site, and the
// first few people to open a dashboard spend it for everybody else. The failure
// that follows is not cosmetic: a 429 on POST /api/completions is an operator
// whose job refuses to start.
//
// So an authenticated request is counted against the person who made it. The
// only identity accepted for that is a session token that actually resolves to a
// live session — never a header the caller can simply assert. Inventing tokens
// buys nothing: one that resolves to no session falls straight back to IP
// keying, so made-up identities all share the one bucket rather than each
// minting a fresh one.

// Statements are prepared on first use so requiring this module never races the
// migrations that create the tables they read.
let sessionStmt = null;
let apiKeyStmt = null;

function bearerToken(req) {
  const header = req.headers?.authorization;
  return typeof header === 'string' && header.startsWith('Bearer ') ? header.slice(7) : null;
}

/** The user id behind this request, or null when it isn't a live session. */
function sessionUserId(req) {
  const token = req.cookies?.hm_token || bearerToken(req);
  if (!token || typeof token !== 'string') return null;
  try {
    if (!sessionStmt) {
      sessionStmt = db.prepare(`
        SELECT s.user_id
        FROM sessions s JOIN users u ON u.id = s.user_id
        WHERE s.token = ? AND s.expires_at > datetime('now') AND u.is_active = 1
      `);
    }
    return sessionStmt.get(token)?.user_id ?? null;
  } catch {
    // A database hiccup must never take the API down — fall back to IP keying.
    return null;
  }
}

/**
 * Bucket key for the general API limiter: the signed-in user when there is one,
 * otherwise the client IP (normalised, so an IPv6 client can't walk its own /64
 * to get a new bucket per request).
 */
function apiRateKey(req) {
  const userId = sessionUserId(req);
  return userId ? `u:${userId}` : `ip:${ipKeyGenerator(req.ip)}`;
}

/** True when apiRateKey resolved a real session for this request. */
function isSessionKey(key) {
  return typeof key === 'string' && key.startsWith('u:');
}

/**
 * Bucket key for the enterprise /api/v1 surface — the same reasoning one layer
 * out. A customer's integrations all call from their corporate egress address,
 * so keying on the IP pools every integration a company runs into one budget.
 * An unrecognised key falls back to IP, for the same reason as above.
 */
function apiKeyRateKey(req) {
  const header = req.headers?.authorization || '';
  const key = header.startsWith('Bearer ') ? header.slice(7) : (req.headers?.['x-api-key'] || '');
  if (key && typeof key === 'string') {
    try {
      if (!apiKeyStmt) apiKeyStmt = db.prepare('SELECT id FROM api_keys WHERE key_hash = ?');
      const row = apiKeyStmt.get(crypto.createHash('sha256').update(key).digest('hex'));
      if (row) return `k:${row.id}`;
    } catch { /* fall through to IP keying */ }
  }
  return `ip:${ipKeyGenerator(req.ip)}`;
}

module.exports = { apiRateKey, apiKeyRateKey, isSessionKey, sessionUserId };

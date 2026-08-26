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

/**
 * Bucket key for the credential endpoints: the ACCOUNT being attempted.
 *
 * Guessing a password is an attack on one account, so the ceiling that stops it
 * has to be counted per account — not per IP. A factory leaves the building
 * through one NAT gateway, so an IP-keyed credential budget is a budget for the
 * whole site: twenty people signing in at 6am with a couple of typos between
 * them spent it, and everyone still standing at a tablet waited fifteen minutes.
 * Meanwhile it did nothing extra against the actual threat, because one attacker
 * with twenty addresses had twenty budgets.
 *
 * The account is taken from the submitted email, normalised the same way the
 * login route normalises it (lowercase, trimmed) so `Bob@x.test` and
 * `bob@x.test ` cannot be alternated for a fresh budget, and hashed so the store
 * never holds a list of the addresses people are trying.
 *
 * change-password carries no email — it is authenticated — so the live session's
 * user is the account there. Anything with neither falls back to the IP, which
 * is the only handle left.
 */
function credentialRateKey(req) {
  const email = req.body?.email;
  if (typeof email === 'string' && email.trim()) {
    return `acct:${crypto.createHash('sha256').update(email.toLowerCase().trim()).digest('hex').slice(0, 32)}`;
  }
  const userId = sessionUserId(req);
  if (userId) return `acct-u:${userId}`;
  return `ip:${ipKeyGenerator(req.ip)}`;
}

/** Bucket key for the per-site credential ceiling: always the client address. */
function credentialIpKey(req) {
  return `ip:${ipKeyGenerator(req.ip)}`;
}

module.exports = {
  apiRateKey, apiKeyRateKey, isSessionKey, sessionUserId,
  credentialRateKey, credentialIpKey,
};

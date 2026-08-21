'use strict';

// ─── Supervisor authorization grants ─────────────────────────────────────────
//
// The problem this solves: an in-run NCR carries "authorized by <supervisor>".
// If the server simply trusts `authorized_by` / `authorized_by_user_id` on the
// request body, then ANY authenticated client (including the operator whose
// work is being rejected) can POST straight to /api/quality/ncrs, skip the PIN
// prompt entirely, and stamp any same-company supervisor's name on the record.
// The sign-off would be theatre and the audit trail would be false.
//
// So authorization is a two-step, server-mediated exchange:
//   1. POST /api/operators/verify-authorizer  { pin }
//        → PIN is checked against the roster; the role gate is applied;
//          a single-use grant row is written; the id comes back to the client.
//   2. POST /api/quality/ncrs  { ..., authorization_id }
//        → the grant is redeemed inside the NCR's transaction. Authorizer name
//          and user id are copied FROM THE GRANT. Client-supplied values are
//          ignored entirely.
//
// A grant is company-scoped, expires, and can be redeemed exactly once.

const crypto = require('crypto');
const db = require('./db');

// Generous TTL on purpose: the player queues NCRs while the tablet is offline
// and replays them on reconnect, sometimes hours later. Single-use redemption
// (not a short clock) is what stops replay.
const GRANT_TTL_MS = 12 * 60 * 60 * 1000;

/** Writes a grant and returns its opaque id. */
function issueGrant({ companyId, user, purpose = 'ncr' }) {
  const id = crypto.randomBytes(24).toString('hex');
  db.prepare(`
    INSERT INTO authorization_grants (id, company_id, user_id, display_name, role, purpose, expires_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(id, companyId, user.id, user.display_name || '', user.role || '', purpose,
         new Date(Date.now() + GRANT_TTL_MS).toISOString());
  // Opportunistic housekeeping — grants are tiny and short-lived.
  db.prepare(`DELETE FROM authorization_grants WHERE expires_at < datetime('now', '-7 days')`).run();
  return id;
}

/**
 * Redeems a grant. Returns the authorizer { user_id, display_name, role } on
 * success, or null when the id is unknown, belongs to another company, has
 * expired, or was already used. Marks the row used in the same statement, so
 * two concurrent redemptions cannot both win.
 */
function redeemGrant(grantId, companyId, usedFor = '') {
  if (!grantId || typeof grantId !== 'string') return null;
  const claimed = db.prepare(`
    UPDATE authorization_grants
       SET used_at = datetime('now'), used_for = ?
     WHERE id = ? AND company_id = ? AND used_at IS NULL AND expires_at > datetime('now')
  `).run(String(usedFor).slice(0, 120), grantId, companyId);
  if (claimed.changes !== 1) return null;
  const row = db.prepare('SELECT user_id, display_name, role FROM authorization_grants WHERE id = ?').get(grantId);
  return row || null;
}

module.exports = { issueGrant, redeemGrant, GRANT_TTL_MS };

// ─── Operator floor-identity routes ──────────────────────────────────────────
// Mounted at /api/operators behind requireAuth. Powers the Operator Portal's
// "who are you" clock-in step: a roster of operators plus PIN / badge
// verification so floor work is attributed to a verified identity.
//
// NOTE: This file is fleshed out by the Operator-Identity work. The stub below
// keeps the server booting; real handlers are added there.

const express = require('express');
const db = require('../db');
const { verifyPassword, ROLE_LEVELS } = require('../middleware/auth');
const { issueGrant } = require('../authorization');

const router = express.Router();

// ─── PIN brute-force lockout ─────────────────────────────────────────────────
// The PIN endpoints compare a submitted PIN against every active user's hash, so
// without a limiter a 4-digit space is exhaustible in hours. We track failed
// attempts per company+IP: after LOCK_THRESHOLD failures within LOCK_WINDOW_MS,
// that source is locked out for the rest of the window. Keyed by IP so one
// attacker can't lock out a whole company's legitimate tablets, and cleared on
// the first success. In-memory (best-effort across a single process); it sits on
// top of the global rate limiter, not instead of it.
const LOCK_THRESHOLD = 10;
const LOCK_WINDOW_MS = 15 * 60 * 1000;
const pinFails = new Map(); // key -> { count, first }

function pinKey(req) { return `${req.companyId}:${req.ip || req.socket?.remoteAddress || 'unknown'}`; }
function pinLocked(req) {
  const e = pinFails.get(pinKey(req));
  if (!e) return false;
  if (Date.now() - e.first > LOCK_WINDOW_MS) { pinFails.delete(pinKey(req)); return false; }
  return e.count >= LOCK_THRESHOLD;
}
function pinFail(req) {
  const key = pinKey(req);
  const e = pinFails.get(key);
  if (!e || Date.now() - e.first > LOCK_WINDOW_MS) pinFails.set(key, { count: 1, first: Date.now() });
  else e.count += 1;
}
function pinSuccess(req) { pinFails.delete(pinKey(req)); }

// GET /api/operators/roster — active operators in this company for the portal picker.
router.get('/roster', (req, res) => {
  const rows = db.prepare(`
    SELECT id, display_name, job_title,
           CASE WHEN pin_hash != '' THEN 1 ELSE 0 END AS has_pin,
           CASE WHEN badge_code != '' THEN 1 ELSE 0 END AS has_badge
    FROM users
    WHERE company_id = ? AND is_active = 1 AND role = 'operator'
    ORDER BY display_name
  `).all(req.companyId);
  res.json(rows);
});

// POST /api/operators/verify — confirm a floor identity via badge or PIN.
// Body: { badge_code } OR { user_id, pin }. Scoped to the tablet's company.
// Returns { id, display_name } on success so work is attributed to a real user.
router.post('/verify', (req, res) => {
  const { user_id, pin, badge_code } = req.body || {};

  // Badge scan — match a non-empty badge_code exactly within this company.
  if (badge_code && String(badge_code).trim()) {
    const user = db.prepare(`
      SELECT id, display_name FROM users
      WHERE company_id = ? AND is_active = 1 AND role = 'operator'
        AND badge_code != '' AND badge_code = ?
    `).get(req.companyId, String(badge_code).trim());
    if (!user) return res.status(401).json({ error: 'Badge not recognized' });
    return res.json({ id: user.id, display_name: user.display_name });
  }

  // PIN — verify against the selected operator's stored hash.
  if (user_id && pin) {
    const user = db.prepare(`
      SELECT id, display_name, pin_hash FROM users
      WHERE id = ? AND company_id = ? AND is_active = 1 AND role = 'operator'
    `).get(user_id, req.companyId);
    if (!user || !user.pin_hash || !verifyPassword(String(pin), user.pin_hash)) {
      return res.status(401).json({ error: 'Invalid PIN' });
    }
    return res.json({ id: user.id, display_name: user.display_name });
  }

  res.status(400).json({ error: 'Provide a badge code, or a user and PIN' });
});

// POST /api/operators/badge-login — player attribution at run start.
// Body: { badge_code } OR { pin } (optionally { user_id, pin } to disambiguate).
// Returns { user_id, display_name } so the player can attach a verified
// operator identity (completions.operator_user_id) instead of free text.
// Scoped to the tablet's company; any active member may badge in (supervisors
// run apps too), matching the pin/badge columns on users.
router.post('/badge-login', (req, res) => {
  const { badge_code, pin, user_id } = req.body || {};

  if (badge_code && String(badge_code).trim()) {
    const user = db.prepare(`
      SELECT id, display_name FROM users
      WHERE company_id = ? AND is_active = 1 AND badge_code != '' AND badge_code = ?
    `).get(req.companyId, String(badge_code).trim());
    if (!user) return res.status(401).json({ error: 'Badge not recognized' });
    return res.json({ user_id: user.id, display_name: user.display_name });
  }

  if (pin !== undefined && pin !== null && String(pin) !== '') {
    if (pinLocked(req)) return res.status(429).json({ error: 'Too many failed PIN attempts — try again in a few minutes' });
    // With a user_id we verify one specific hash; without one we check the
    // company's active users that have a PIN set (rosters are small).
    const candidates = user_id
      ? db.prepare(`SELECT id, display_name, pin_hash FROM users WHERE id = ? AND company_id = ? AND is_active = 1 AND pin_hash != ''`)
          .all(user_id, req.companyId)
      : db.prepare(`SELECT id, display_name, pin_hash FROM users WHERE company_id = ? AND is_active = 1 AND pin_hash != ''`)
          .all(req.companyId);
    for (const u of candidates) {
      if (verifyPassword(String(pin), u.pin_hash)) {
        pinSuccess(req);
        return res.json({ user_id: u.id, display_name: u.display_name });
      }
    }
    pinFail(req);
    return res.status(401).json({ error: 'Invalid PIN' });
  }

  res.status(400).json({ error: 'Provide badge_code or pin' });
});

// POST /api/operators/verify-authorizer — supervisor sign-off for in-run actions
// (e.g. filing an NCR from the player). Body: { pin }. Matches an ACTIVE user in
// THIS company whose operator PIN verifies (same scrypt compare as badge-login)
// AND whose role is supervisor or above. Lower roles and bad PINs both return
// 403 with a clear message so the player can show why authorization failed.
router.post('/verify-authorizer', (req, res) => {
  // The caller must already be on the floor (operator+). A viewer has no reason
  // to fish for a supervisor's PIN, so don't even let them try.
  if ((ROLE_LEVELS[req.user?.role] ?? 0) < ROLE_LEVELS.operator) {
    return res.status(403).json({ error: 'Not permitted' });
  }
  if (pinLocked(req)) return res.status(429).json({ error: 'Too many failed attempts — try again in a few minutes' });
  const { pin } = req.body || {};
  if (pin === undefined || pin === null || String(pin) === '') {
    return res.status(400).json({ error: 'pin required' });
  }
  // Rosters are small — check every active user with a PIN set (badge-login pattern).
  const candidates = db.prepare(`
    SELECT id, display_name, role, pin_hash FROM users
    WHERE company_id = ? AND is_active = 1 AND pin_hash != ''
  `).all(req.companyId);
  const matches = candidates.filter(u => verifyPassword(String(pin), u.pin_hash));
  if (matches.length === 0) {
    pinFail(req);
    return res.status(403).json({ error: 'PIN not recognized' });
  }
  // A PIN shared across roles (unlikely) authorizes if ANY match qualifies.
  const authorizer = matches.find(u => (ROLE_LEVELS[u.role] ?? 0) >= ROLE_LEVELS.supervisor);
  if (!authorizer) {
    return res.status(403).json({ error: 'Authorization requires a supervisor or above' });
  }
  pinSuccess(req); // a real supervisor PIN cleared — reset the failure counter
  // Mint a single-use, expiring grant. The endpoint that needs the sign-off
  // redeems this id and takes the authorizer identity FROM the grant, so a
  // client can't skip the PIN check and name any supervisor it likes.
  const grantId = issueGrant({
    companyId: req.companyId,
    user: authorizer,
    purpose: String(req.body?.purpose || 'ncr'),
  });
  res.json({
    authorization_id: grantId,
    user_id: authorizer.id,
    display_name: authorizer.display_name,
    role: authorizer.role,
  });
});

module.exports = router;

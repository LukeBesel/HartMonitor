// ─── Operator floor-identity routes ──────────────────────────────────────────
// Mounted at /api/operators behind requireAuth. Powers the Operator Portal's
// "who are you" clock-in step: a roster of operators plus PIN / badge
// verification so floor work is attributed to a verified identity.
//
// NOTE: This file is fleshed out by the Operator-Identity work. The stub below
// keeps the server booting; real handlers are added there.

const express = require('express');
const db = require('../db');
const { verifyPassword } = require('../middleware/auth');

const router = express.Router();

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

module.exports = router;

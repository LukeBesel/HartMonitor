// ─── Operator floor-identity routes ──────────────────────────────────────────
// Mounted at /api/operators behind requireAuth. Powers the Operator Portal's
// "who are you" clock-in step: a roster of operators plus PIN / badge
// verification so floor work is attributed to a verified identity.
//
// NOTE: This file is fleshed out by the Operator-Identity work. The stub below
// keeps the server booting; real handlers are added there.

const express = require('express');
const db = require('../db');

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

module.exports = router;

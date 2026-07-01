const express = require('express');
const db = require('../db');

const router = express.Router();

// All routes in this file are mounted at /api/admin which requires the developer
// role at the mount point in index.js.

// Helper: detect whether SMTP / transactional email is configured.
function smtpConfigured() {
  return !!(process.env.SMTP_HOST && process.env.SMTP_USER);
}

// ─── GET /pending-resets ──────────────────────────────────────────────────────
// Returns unused password reset tokens so the admin can manually share the link
// with the user when SMTP is not configured.
// Only returns results when SMTP is NOT configured (otherwise email handles it).

router.get('/pending-resets', (req, res) => {
  // When SMTP is configured, emails go out automatically — no need to expose links here.
  if (smtpConfigured()) {
    return res.json([]);
  }

  const rows = db.prepare(`
    SELECT prt.id, u.email as user_email, prt.reset_url, prt.expires_at, prt.created_at
    FROM password_reset_tokens prt
    JOIN users u ON u.id = prt.user_id
    WHERE prt.used_at IS NULL
      AND prt.expires_at > datetime('now')
      AND prt.reset_url IS NOT NULL
      AND prt.reset_url != ''
      AND u.company_id = ?
    ORDER BY prt.created_at DESC
  `).all(req.companyId);

  const result = rows.map(r => ({
    id: r.id,
    user_email: r.user_email,
    reset_url: r.reset_url,
    expires_at: r.expires_at,
    created_at: r.created_at,
  }));

  res.json(result);
});

module.exports = router;

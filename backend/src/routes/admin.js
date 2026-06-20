const express = require('express');
const db = require('../db');

const router = express.Router();

// All routes in this file are mounted at /api/admin which requires the developer
// role at the mount point in index.js.

// Helper: detect whether SMTP / transactional email is configured.
function smtpConfigured() {
  return !!(process.env.SMTP_HOST || process.env.SENDGRID_API_KEY || process.env.RESEND_API_KEY);
}

// Base URL for building reset URLs.
function appUrl(req) {
  if (process.env.APP_URL) return process.env.APP_URL.replace(/\/$/, '');
  const proto = req.headers['x-forwarded-proto'] || req.protocol || 'http';
  return `${proto}://${req.get('host')}`;
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

  const base = appUrl(req);
  const rows = db.prepare(`
    SELECT prt.id, u.email as user_email, prt.token, prt.expires_at, prt.created_at
    FROM password_reset_tokens prt
    JOIN users u ON u.id = prt.user_id
    WHERE prt.used_at IS NULL
      AND prt.expires_at > datetime('now')
      AND u.company_id = ?
    ORDER BY prt.created_at DESC
  `).all(req.companyId);

  const result = rows.map(r => ({
    id: r.id,
    user_email: r.user_email,
    reset_url: `${base}/reset-password?token=${r.token}`,
    expires_at: r.expires_at,
    created_at: r.created_at,
  }));

  res.json(result);
});

module.exports = router;

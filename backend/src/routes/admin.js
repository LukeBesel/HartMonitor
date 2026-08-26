const express = require('express');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const db = require('../db');
const { config } = require('../config');
const { PRICING } = require('../pricing');
const { requirePlatformStaff, requireRole } = require('../middleware/auth');
const { logActivity } = require('../activity');

const router = express.Router();

// ─── Who this router is for ───────────────────────────────────────────────────
// This is the HartMonitor operator console, and it is the one place in the API
// that deliberately reads ACROSS tenants: counting customers, listing every
// workspace, changing a plan on someone's behalf. Nothing here is a customer
// feature.
//
// The mount in index.js asks for the 'developer' role, which is not enough on
// its own: 'developer' is the role handed to the first user of every new
// signup, so that gate alone would open this console to every customer owner
// who ever created an account. requirePlatformStaff is the real gate — it
// checks users.is_platform_staff, a column no API path can set, and answers
// 404 so a customer never learns this tooling exists.

// Helper: detect whether SMTP / transactional email is configured.
function smtpConfigured() {
  return !!process.env.RESEND_API_KEY || !!(process.env.SMTP_HOST && process.env.SMTP_USER);
}

// ─── GET /pending-resets — the one customer-facing route here ────────────────
// Deliberately registered ABOVE requirePlatformStaff, and it is the only route
// in this file that is. It carries the 'developer' role gate itself, because
// the mount in index.js deliberately has none: a role gate there would answer
// 403 for the whole console and tell a customer it exists. Self-hosted deployments often run without SMTP, and
// then the only way a locked-out user gets back in is for their own company's
// admin to read the reset link and hand it over. That is a customer's job, not
// HartMonitor's, and the query is scoped to req.companyId like every other
// tenant query — it never shows one company another company's resets.

router.get('/pending-resets', requireRole('developer'), (req, res) => {
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

// ─── Everything below this line is HartMonitor staff only ────────────────────

router.use(requirePlatformStaff);

// Sandbox orgs are throwaway demo workspaces that delete themselves after 24
// hours. Counting them as customers would inflate every number on this page, so
// every query below excludes them and the overview reports them on their own.
const REAL_ORGS = 'COALESCE(o.is_sandbox, 0) = 0';

function clampLimit(raw, fallback, max) {
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(n, max);
}

// ─── GET /stats — platform-wide totals ────────────────────────────────────────

router.get('/stats', (_req, res) => {
  const orgs = db.prepare(`
    SELECT COUNT(*) AS total,
           SUM(CASE WHEN o.created_at >= datetime('now', 'start of month') THEN 1 ELSE 0 END) AS this_month
      FROM organizations o
     WHERE ${REAL_ORGS}
  `).get();

  const users = db.prepare(`
    SELECT COUNT(*) AS total,
           SUM(CASE WHEN u.created_at >= datetime('now', 'start of month') THEN 1 ELSE 0 END) AS this_month
      FROM users u
      JOIN organizations o ON o.id = u.company_id
     WHERE ${REAL_ORGS}
  `).get();

  const completions = db.prepare(`
    SELECT COUNT(*) AS total FROM completions c
      JOIN organizations o ON o.id = c.company_id
     WHERE ${REAL_ORGS}
  `).get();

  const workOrders = db.prepare(`
    SELECT COUNT(*) AS total FROM work_orders w
      JOIN organizations o ON o.id = w.company_id
     WHERE ${REAL_ORGS}
  `).get();

  const billing = db.prepare(`
    SELECT SUM(CASE WHEN p.trial_ends_at IS NOT NULL AND p.trial_ends_at != ''
                     AND p.trial_ends_at > datetime('now') THEN 1 ELSE 0 END) AS active_trials,
           SUM(CASE WHEN p.subscription_status = 'past_due' THEN 1 ELSE 0 END)  AS past_due_count
      FROM plan p
      JOIN organizations o ON o.id = p.company_id
     WHERE ${REAL_ORGS}
  `).get();

  const sandboxes = db.prepare(
    'SELECT COUNT(*) AS total FROM organizations WHERE COALESCE(is_sandbox, 0) = 1'
  ).get();

  res.json({
    total_companies:      orgs.total || 0,
    total_users:          users.total || 0,
    total_completions:    completions.total || 0,
    total_work_orders:    workOrders.total || 0,
    companies_this_month: orgs.this_month || 0,
    users_this_month:     users.this_month || 0,
    active_trials:        billing?.active_trials || 0,
    past_due_count:       billing?.past_due_count || 0,
    active_sandboxes:     sandboxes.total || 0,
  });
});

// ─── GET /companies — every customer workspace ────────────────────────────────

const COMPANY_SELECT = `
  SELECT o.id, o.name, o.slug, o.created_at,
         p.tier AS plan, p.subscription_status,
         (SELECT COUNT(*) FROM users u WHERE u.company_id = o.id) AS user_count,
         (SELECT u2.email FROM users u2 WHERE u2.company_id = o.id
           ORDER BY u2.created_at ASC LIMIT 1) AS owner_email,
         (SELECT COUNT(*) FROM completions c
           WHERE c.company_id = o.id
             AND c.started_at >= datetime('now', '-30 days')) AS monthly_completions
    FROM organizations o
    LEFT JOIN plan p ON p.company_id = o.id
`;

router.get('/companies', (req, res) => {
  const where = [REAL_ORGS];
  const params = [];

  const search = String(req.query.search || '').trim();
  if (search) {
    where.push('(o.name LIKE ? OR o.slug LIKE ?)');
    params.push(`%${search}%`, `%${search}%`);
  }
  const plan = String(req.query.plan || '').trim();
  if (plan) {
    where.push('p.tier = ?');
    params.push(plan);
  }

  const limit = clampLimit(req.query.limit, 100, 500);
  const offset = Math.max(0, Number.parseInt(req.query.offset, 10) || 0);

  const rows = db.prepare(`
    ${COMPANY_SELECT}
    WHERE ${where.join(' AND ')}
    ORDER BY o.created_at DESC
    LIMIT ? OFFSET ?
  `).all(...params, limit, offset);

  res.json(rows);
});

// ─── GET /companies/:id — one workspace ───────────────────────────────────────

router.get('/companies/:id', (req, res) => {
  const row = db.prepare(`${COMPANY_SELECT} WHERE o.id = ?`).get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Not found' });
  res.json(row);
});

// ─── PUT /companies/:id/plan — operator-assisted plan change ──────────────────
// Support and sales need to move a customer between tiers (a comped account, a
// failed migration, a refund). The limits come from the pricing catalog rather
// than the request, so an operator cannot hand out capacity no tier defines,
// and the change is written to that company's own billing history and activity
// log — the customer can see that it happened and who did it.

router.put('/companies/:id/plan', (req, res) => {
  const { tier, note } = req.body || {};
  const def = PRICING.tiers[tier];
  if (!def) {
    return res.status(400).json({ error: `tier must be one of: ${Object.keys(PRICING.tiers).join(', ')}` });
  }

  const org = db.prepare('SELECT id, name FROM organizations WHERE id = ?').get(req.params.id);
  if (!org) return res.status(404).json({ error: 'Not found' });

  const current = db.prepare('SELECT tier FROM plan WHERE company_id = ?').get(org.id);
  const trimmedNote = String(note || '').trim().slice(0, 500);
  const price = def.monthly_price ?? 0;

  const apply = db.transaction(() => {
    if (current) {
      db.prepare(`UPDATE plan SET tier = ?, app_limit = ?, dashboard_limit = ?, updated_at = datetime('now')
                   WHERE company_id = ?`)
        .run(tier, def.app_limit, def.dashboard_limit, org.id);
    } else {
      db.prepare('INSERT INTO plan (tier, app_limit, dashboard_limit, company_id) VALUES (?, ?, ?, ?)')
        .run(tier, def.app_limit, def.dashboard_limit, org.id);
    }
    db.prepare(`INSERT INTO billing_history (id, type, description, quantity, unit_price, amount, company_id)
                VALUES (?, 'tier_change', ?, 1, ?, ?, ?)`)
      .run(uuidv4(), `Plan set to ${def.name} by HartMonitor support${trimmedNote ? ` — ${trimmedNote}` : ''}`,
           price, price, org.id);
  });
  apply();

  logActivity(
    org.id, 'plan', org.id,
    `Plan changed from ${current?.tier || 'none'} to ${tier} by HartMonitor support${trimmedNote ? ` — ${trimmedNote}` : ''}`,
    req.user.display_name || req.user.email,
  );

  res.json(db.prepare(`${COMPANY_SELECT} WHERE o.id = ?`).get(org.id));
});

// ─── GET /users — every user, with the workspace they belong to ───────────────

router.get('/users', (req, res) => {
  const where = [REAL_ORGS];
  const params = [];

  const search = String(req.query.search || '').trim();
  if (search) {
    where.push('(u.email LIKE ? OR u.display_name LIKE ?)');
    params.push(`%${search}%`, `%${search}%`);
  }
  const role = String(req.query.role || '').trim();
  if (role) { where.push('u.role = ?'); params.push(role); }

  const companyId = String(req.query.company_id || '').trim();
  if (companyId) { where.push('u.company_id = ?'); params.push(companyId); }

  const limit = clampLimit(req.query.limit, 200, 1000);

  const rows = db.prepare(`
    SELECT u.id, u.email, u.display_name, u.role, u.is_active,
           u.last_login, u.created_at, o.name AS company_name
      FROM users u
      JOIN organizations o ON o.id = u.company_id
     WHERE ${where.join(' AND ')}
     ORDER BY u.created_at DESC
     LIMIT ?
  `).all(...params, limit);

  res.json(rows);
});

// ─── GET /activity — the platform-wide activity feed ──────────────────────────

router.get('/activity', (req, res) => {
  const where = [REAL_ORGS];
  const params = [];

  const companyId = String(req.query.company_id || '').trim();
  if (companyId) { where.push('a.company_id = ?'); params.push(companyId); }

  const limit = clampLimit(req.query.limit, 100, 500);

  const rows = db.prepare(`
    SELECT a.id, a.company_id, a.entity_type, a.entity_id, a.action, a.actor,
           a.created_at, o.name AS company_name
      FROM activity_log a
      JOIN organizations o ON o.id = a.company_id
     WHERE ${where.join(' AND ')}
     ORDER BY a.created_at DESC
     LIMIT ?
  `).all(...params, limit);

  res.json(rows);
});

// ─── GET /health — this process and its database ──────────────────────────────
// Every field here is measured, never estimated. db_size_mb counts the main
// file plus the WAL, which is where recent writes actually live; when the file
// cannot be stat'd (a path the process can no longer read) it comes back null
// so the console can show "—" instead of claiming an empty database.

router.get('/health', (_req, res) => {
  let dbSizeMb = null;
  try {
    const main = fs.statSync(config.databasePath).size;
    let wal = 0;
    try { wal = fs.statSync(`${config.databasePath}-wal`).size; } catch { /* no WAL right now */ }
    dbSizeMb = Number(((main + wal) / (1024 * 1024)).toFixed(2));
  } catch { /* leave null — an unknown size is not zero */ }

  res.json({
    uptime_seconds: Math.round(process.uptime()),
    memory_mb: Number((process.memoryUsage().rss / (1024 * 1024)).toFixed(1)),
    db_size_mb: dbSizeMb,
    node_version: process.version,
    smtp_configured: smtpConfigured(),
    timestamp: new Date().toISOString(),
  });
});

module.exports = router;

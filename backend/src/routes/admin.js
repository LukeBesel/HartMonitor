const router = require('express').Router();
const db = require('../db');
const fs = require('fs');

// All routes require developer role — enforced in index.js at mount time.

// GET /api/admin/stats
router.get('/stats', (req, res) => {
  try {
    const total_companies = db.prepare('SELECT COUNT(*) as c FROM organizations').get().c;
    const total_users = db.prepare('SELECT COUNT(*) as c FROM users').get().c;
    const total_completions = db.prepare("SELECT COUNT(*) as c FROM completions WHERE status = 'completed'").get().c;
    const total_work_orders = db.prepare('SELECT COUNT(*) as c FROM work_orders').get().c;

    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);
    const monthIso = startOfMonth.toISOString();

    const companies_this_month = db.prepare(
      "SELECT COUNT(*) as c FROM organizations WHERE created_at >= ?"
    ).get(monthIso).c;

    const users_this_month = db.prepare(
      "SELECT COUNT(*) as c FROM users WHERE created_at >= ?"
    ).get(monthIso).c;

    const active_trials = db.prepare(
      "SELECT COUNT(*) as c FROM plan WHERE tier = 'free' AND subscription_status = 'trialing'"
    ).get().c;

    const past_due_count = db.prepare(
      "SELECT COUNT(*) as c FROM plan WHERE subscription_status = 'past_due'"
    ).get().c;

    res.json({
      total_companies,
      total_users,
      total_completions,
      total_work_orders,
      companies_this_month,
      users_this_month,
      active_trials,
      past_due_count,
    });
  } catch (err) {
    console.error('[admin/stats]', err);
    res.status(500).json({ error: 'Failed to load stats' });
  }
});

// GET /api/admin/companies
router.get('/companies', (req, res) => {
  try {
    const { search, plan: planFilter, status, limit = 50, offset = 0 } = req.query;

    let where = 'WHERE 1=1';
    const params = [];

    if (search) {
      where += ' AND (o.name LIKE ? OR o.slug LIKE ?)';
      params.push(`%${search}%`, `%${search}%`);
    }
    if (planFilter) {
      where += ' AND p.tier = ?';
      params.push(planFilter);
    }
    if (status) {
      where += ' AND p.subscription_status = ?';
      params.push(status);
    }

    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

    const rows = db.prepare(`
      SELECT
        o.id,
        o.name,
        o.slug,
        o.created_at,
        p.tier AS plan,
        p.subscription_status,
        (SELECT COUNT(*) FROM users u WHERE u.company_id = o.id AND u.is_active = 1) AS user_count,
        (SELECT u2.email FROM users u2 WHERE u2.company_id = o.id ORDER BY u2.created_at ASC LIMIT 1) AS owner_email,
        (SELECT COUNT(*) FROM completions c WHERE c.company_id = o.id AND c.status = 'completed' AND c.completed_at >= ?) AS monthly_completions
      FROM organizations o
      LEFT JOIN plan p ON p.company_id = o.id
      ${where}
      ORDER BY o.created_at DESC
      LIMIT ? OFFSET ?
    `).all([thirtyDaysAgo, ...params, Number(limit), Number(offset)]);

    res.json(rows);
  } catch (err) {
    console.error('[admin/companies]', err);
    res.status(500).json({ error: 'Failed to load companies' });
  }
});

// GET /api/admin/companies/:id
router.get('/companies/:id', (req, res) => {
  try {
    const { id } = req.params;

    const company = db.prepare(`
      SELECT o.*, p.tier AS plan_tier, p.subscription_status, p.app_limit,
             p.dashboard_limit, p.extra_app_slots, p.extra_dashboard_slots,
             p.billing_email, p.stripe_customer_id, p.stripe_subscription_id
      FROM organizations o
      LEFT JOIN plan p ON p.company_id = o.id
      WHERE o.id = ?
    `).get(id);

    if (!company) return res.status(404).json({ error: 'Company not found' });

    const users = db.prepare(`
      SELECT id, email, display_name, role, is_active, last_login, created_at
      FROM users WHERE company_id = ? ORDER BY created_at ASC
    `).all(id);

    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

    const activity = db.prepare(`
      SELECT a.id, a.entity_type, a.action, a.actor, a.created_at
      FROM activity_log a
      WHERE a.company_id = ?
      ORDER BY a.created_at DESC
      LIMIT 20
    `).all(id);

    const stats = {
      total_apps: db.prepare("SELECT COUNT(*) as c FROM apps WHERE company_id = ?").get(id).c,
      total_completions: db.prepare("SELECT COUNT(*) as c FROM completions WHERE company_id = ? AND status = 'completed'").get(id).c,
      completions_30d: db.prepare("SELECT COUNT(*) as c FROM completions WHERE company_id = ? AND status = 'completed' AND completed_at >= ?").get(id, thirtyDaysAgo).c,
      total_work_orders: db.prepare("SELECT COUNT(*) as c FROM work_orders WHERE company_id = ?").get(id).c,
    };

    res.json({ ...company, users, activity, stats });
  } catch (err) {
    console.error('[admin/companies/:id]', err);
    res.status(500).json({ error: 'Failed to load company' });
  }
});

// PUT /api/admin/companies/:id/plan
router.put('/companies/:id/plan', (req, res) => {
  try {
    const { id } = req.params;
    const { tier, note } = req.body;

    if (!tier) return res.status(400).json({ error: 'tier is required' });

    const validTiers = ['free', 'pro', 'enterprise'];
    if (!validTiers.includes(tier)) {
      return res.status(400).json({ error: `tier must be one of: ${validTiers.join(', ')}` });
    }

    const planExists = db.prepare('SELECT id FROM plan WHERE company_id = ?').get(id);

    const tierLimits = {
      free:       { app_limit: 5,   dashboard_limit: 2 },
      pro:        { app_limit: 25,  dashboard_limit: 10 },
      enterprise: { app_limit: 999, dashboard_limit: 999 },
    };
    const { app_limit, dashboard_limit } = tierLimits[tier];

    if (planExists) {
      db.prepare(`
        UPDATE plan
        SET tier = ?, app_limit = ?, dashboard_limit = ?, updated_at = datetime('now')
        WHERE company_id = ?
      `).run(tier, app_limit, dashboard_limit, id);
    } else {
      db.prepare(`
        INSERT INTO plan (company_id, tier, app_limit, dashboard_limit)
        VALUES (?, ?, ?, ?)
      `).run(id, tier, app_limit, dashboard_limit);
    }

    const { v4: uuidv4 } = require('uuid');
    db.prepare(`
      INSERT INTO activity_log (id, company_id, entity_type, entity_id, action, actor, created_at)
      VALUES (?, ?, 'plan', ?, ?, ?, datetime('now'))
    `).run(uuidv4(), id, id, `Plan changed to ${tier}${note ? `: ${note}` : ''}`, req.user.email);

    const updated = db.prepare('SELECT * FROM plan WHERE company_id = ?').get(id);
    res.json({ ok: true, plan: updated });
  } catch (err) {
    console.error('[admin/companies/:id/plan]', err);
    res.status(500).json({ error: 'Failed to update plan' });
  }
});

// GET /api/admin/users
router.get('/users', (req, res) => {
  try {
    const { search, role, company_id, limit = 50, offset = 0 } = req.query;

    let where = 'WHERE 1=1';
    const params = [];

    if (search) {
      where += ' AND (u.email LIKE ? OR u.display_name LIKE ?)';
      params.push(`%${search}%`, `%${search}%`);
    }
    if (role) {
      where += ' AND u.role = ?';
      params.push(role);
    }
    if (company_id) {
      where += ' AND u.company_id = ?';
      params.push(company_id);
    }

    const rows = db.prepare(`
      SELECT u.id, u.email, u.display_name, u.role, u.is_active,
             u.last_login, u.created_at,
             o.name AS company_name
      FROM users u
      LEFT JOIN organizations o ON o.id = u.company_id
      ${where}
      ORDER BY u.created_at DESC
      LIMIT ? OFFSET ?
    `).all([...params, Number(limit), Number(offset)]);

    res.json(rows);
  } catch (err) {
    console.error('[admin/users]', err);
    res.status(500).json({ error: 'Failed to load users' });
  }
});

// GET /api/admin/activity
router.get('/activity', (req, res) => {
  try {
    const { limit = 100, company_id } = req.query;

    let where = 'WHERE 1=1';
    const params = [];

    if (company_id) {
      where += ' AND a.company_id = ?';
      params.push(company_id);
    }

    const rows = db.prepare(`
      SELECT a.id, a.company_id, a.entity_type, a.entity_id, a.action,
             a.actor, a.created_at,
             o.name AS company_name
      FROM activity_log a
      LEFT JOIN organizations o ON o.id = a.company_id
      ${where}
      ORDER BY a.created_at DESC
      LIMIT ?
    `).all([...params, Number(limit)]);

    res.json(rows);
  } catch (err) {
    console.error('[admin/activity]', err);
    res.status(500).json({ error: 'Failed to load activity' });
  }
});

// GET /api/admin/health
router.get('/health', (req, res) => {
  const { config } = require('../config');
  const dbPath = config.databasePath || process.env.DATABASE_PATH || './mes.db';
  let dbSizeMb = 0;
  try { dbSizeMb = Number((fs.statSync(dbPath).size / 1024 / 1024).toFixed(1)); } catch {}

  res.json({
    uptime_seconds: Math.floor(process.uptime()),
    memory_mb: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
    db_size_mb: dbSizeMb,
    node_version: process.version,
    timestamp: new Date().toISOString(),
  });
});

module.exports = router;

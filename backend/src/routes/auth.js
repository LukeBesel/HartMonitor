const express = require('express');
const { v4: uuidv4 } = require('uuid');
const db = require('../db');
const { hashPassword, verifyPassword, generateToken, requireAuth } = require('../middleware/auth');

const router = express.Router();

// ─── POST /login ──────────────────────────────────────────────────────────────

router.post('/login', (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'email and password required' });

  const user = db.prepare('SELECT * FROM users WHERE email = ? AND is_active = 1').get(email.toLowerCase().trim());
  if (!user || !verifyPassword(password, user.password_hash)) {
    return res.status(401).json({ error: 'Invalid email or password' });
  }

  const token = generateToken();
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(); // 30 days
  db.prepare(`INSERT INTO sessions (id, user_id, token, expires_at) VALUES (?, ?, ?, ?)`)
    .run(uuidv4(), user.id, token, expiresAt);
  db.prepare(`UPDATE users SET last_login = datetime('now'), updated_at = datetime('now') WHERE id = ?`).run(user.id);

  res.json({
    token,
    user: { id: user.id, email: user.email, display_name: user.display_name, role: user.role },
  });
});

// ─── POST /signup — create a new organization + first user (public) ──────────

router.post('/signup', (req, res) => {
  const { company_name, email, password, display_name } = req.body;
  if (!company_name || !email || !password || !display_name) {
    return res.status(400).json({ error: 'company_name, email, password, and display_name required' });
  }
  if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });

  const normalizedEmail = email.toLowerCase().trim();
  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(normalizedEmail);
  if (existing) return res.status(409).json({ error: 'A user with that email already exists' });

  const orgId  = uuidv4();
  const userId = uuidv4();
  const token  = generateToken();
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(); // 30 days

  let slug = company_name.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'org';
  if (db.prepare('SELECT id FROM organizations WHERE slug = ?').get(slug)) {
    slug = `${slug}-${orgId.slice(0, 8)}`;
  }

  const signup = db.transaction(() => {
    db.prepare(`INSERT INTO organizations (id, name, slug) VALUES (?, ?, ?)`)
      .run(orgId, company_name.trim(), slug);
    db.prepare(`INSERT INTO users (id, email, display_name, password_hash, role, company_id) VALUES (?, ?, ?, ?, 'developer', ?)`)
      .run(userId, normalizedEmail, display_name.trim(), hashPassword(password), orgId);
    db.prepare(`INSERT INTO plan (tier, app_limit, dashboard_limit, company_id) VALUES ('free', 5, 2, ?)`)
      .run(orgId);

    const defaults = [
      ['company_name', company_name.trim()],
      ['timezone',     'America/New_York'],
      ['date_format',  'MM/DD/YYYY'],
      ['currency',     'USD'],
    ];
    const insSetting = db.prepare(`INSERT OR IGNORE INTO org_settings (company_id, key, value) VALUES (?, ?, ?)`);
    for (const [k, v] of defaults) insSetting.run(orgId, k, v);

    db.prepare(`INSERT INTO sessions (id, user_id, token, expires_at) VALUES (?, ?, ?, ?)`)
      .run(uuidv4(), userId, token, expiresAt);
    db.prepare(`UPDATE users SET last_login = datetime('now'), updated_at = datetime('now') WHERE id = ?`).run(userId);
  });
  signup();

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
  res.status(201).json({
    token,
    user: { id: user.id, email: user.email, display_name: user.display_name, role: user.role },
  });
});

// ─── POST /logout ─────────────────────────────────────────────────────────────

router.post('/logout', requireAuth, (req, res) => {
  db.prepare('DELETE FROM sessions WHERE id = ?').run(req.user.session_id);
  res.json({ success: true });
});

// ─── GET /me ──────────────────────────────────────────────────────────────────

router.get('/me', requireAuth, (req, res) => {
  const user = db.prepare('SELECT id, email, display_name, role, company_id, last_login, created_at FROM users WHERE id = ?').get(req.user.id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  const company = db.prepare("SELECT value FROM org_settings WHERE company_id = ? AND key = 'company_name'").get(req.companyId);
  res.json({ ...user, company_name: company?.value || 'HartMonitor' });
});

// ─── PUT /change-password ─────────────────────────────────────────────────────

router.put('/change-password', requireAuth, (req, res) => {
  const { current_password, new_password } = req.body;
  if (!current_password || !new_password) return res.status(400).json({ error: 'current_password and new_password required' });
  if (new_password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  if (!verifyPassword(current_password, user.password_hash)) {
    return res.status(401).json({ error: 'Current password is incorrect' });
  }
  db.prepare("UPDATE users SET password_hash = ?, updated_at = datetime('now') WHERE id = ?")
    .run(hashPassword(new_password), req.user.id);

  // Invalidate all other sessions
  db.prepare('DELETE FROM sessions WHERE user_id = ? AND id != ?').run(req.user.id, req.user.session_id);
  res.json({ success: true });
});

module.exports = router;

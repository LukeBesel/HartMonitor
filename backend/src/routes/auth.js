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

// ─── POST /logout ─────────────────────────────────────────────────────────────

router.post('/logout', requireAuth, (req, res) => {
  db.prepare('DELETE FROM sessions WHERE id = ?').run(req.user.session_id);
  res.json({ success: true });
});

// ─── GET /me ──────────────────────────────────────────────────────────────────

router.get('/me', requireAuth, (req, res) => {
  const user = db.prepare('SELECT id, email, display_name, role, last_login, created_at FROM users WHERE id = ?').get(req.user.id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  const company = db.prepare("SELECT value FROM company_settings WHERE key = 'company_name'").get();
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

const express = require('express');
const { v4: uuidv4 } = require('uuid');
const db = require('../db');
const { requireAuth, requireRole, hashPassword } = require('../middleware/auth');
const { logActivity } = require('../activity');

const router = express.Router();

const VALID_ROLES = ['developer', 'manager', 'supervisor', 'operator', 'viewer'];

// All user management requires developer role
router.use(requireAuth, requireRole('manager'));

// ─── GET / — list users ───────────────────────────────────────────────────────

router.get('/', (req, res) => {
  const users = db.prepare(`
    SELECT id, email, display_name, role, is_active, last_login, created_at, updated_at,
           department_id, job_title
    FROM users WHERE company_id = ? ORDER BY CASE role
      WHEN 'developer' THEN 1 WHEN 'manager' THEN 2 WHEN 'supervisor' THEN 3
      WHEN 'operator' THEN 4 ELSE 5 END, display_name
  `).all(req.companyId);
  res.json(users);
});

// ─── POST / — create user ─────────────────────────────────────────────────────

router.post('/', requireRole('developer'), (req, res) => {
  const { email, display_name, password, role = 'viewer' } = req.body;
  if (!email || !display_name || !password) return res.status(400).json({ error: 'email, display_name, and password required' });
  if (!VALID_ROLES.includes(role)) return res.status(400).json({ error: `role must be one of: ${VALID_ROLES.join(', ')}` });
  if (password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });

  // Emails stay globally unique — login has no org discriminator
  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email.toLowerCase().trim());
  if (existing) return res.status(409).json({ error: 'A user with that email already exists' });

  const id = uuidv4();
  db.prepare(`INSERT INTO users (id, email, display_name, password_hash, role, company_id) VALUES (?, ?, ?, ?, ?, ?)`)
    .run(id, email.toLowerCase().trim(), display_name, hashPassword(password), role, req.companyId);
  logActivity(req.companyId, 'user', id, `User "${display_name}" created with role ${role}`, req.user.display_name);
  const user = db.prepare('SELECT id, email, display_name, role, is_active, created_at FROM users WHERE id = ?').get(id);
  res.status(201).json(user);
});

// ─── GET /:id — get user ──────────────────────────────────────────────────────

router.get('/:id', (req, res) => {
  const user = db.prepare(`
    SELECT id, email, display_name, role, is_active, last_login, created_at, department_id, job_title
    FROM users WHERE id = ? AND company_id = ?
  `).get(req.params.id, req.companyId);
  if (!user) return res.status(404).json({ error: 'Not found' });
  res.json(user);
});

// ─── PUT /:id — update user ───────────────────────────────────────────────────

router.put('/:id', requireRole('developer'), (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE id = ? AND company_id = ?').get(req.params.id, req.companyId);
  if (!user) return res.status(404).json({ error: 'Not found' });

  const { email, display_name, role, is_active, password, department_id, job_title } = req.body;
  if (role && !VALID_ROLES.includes(role)) return res.status(400).json({ error: `role must be one of: ${VALID_ROLES.join(', ')}` });

  const updates = {
    email: email ? email.toLowerCase().trim() : user.email,
    display_name: display_name ?? user.display_name,
    role: role ?? user.role,
    is_active: is_active !== undefined ? (is_active ? 1 : 0) : user.is_active,
    password_hash: password ? hashPassword(password) : user.password_hash,
    department_id: department_id !== undefined ? (department_id || null) : user.department_id,
    job_title: job_title !== undefined ? job_title : (user.job_title ?? ''),
  };

  // Can't deactivate the last developer in the organization
  if (updates.is_active === 0 || (updates.role !== 'developer' && user.role === 'developer')) {
    const devCount = db.prepare("SELECT COUNT(*) as c FROM users WHERE role = 'developer' AND is_active = 1 AND company_id = ? AND id != ?")
      .get(req.companyId, req.params.id).c;
    if (devCount === 0) return res.status(409).json({ error: 'Cannot deactivate the last developer account' });
  }

  db.prepare(`UPDATE users SET email=?, display_name=?, role=?, is_active=?, password_hash=?, department_id=?, job_title=?, updated_at=datetime('now') WHERE id=?`)
    .run(updates.email, updates.display_name, updates.role, updates.is_active, updates.password_hash, updates.department_id, updates.job_title, req.params.id);

  if (password) db.prepare('DELETE FROM sessions WHERE user_id = ?').run(req.params.id);

  if (updates.role !== user.role) {
    logActivity(req.companyId, 'user', req.params.id, `Role changed from ${user.role} to ${updates.role} for "${updates.display_name}"`, req.user.display_name);
  }
  if (updates.is_active !== user.is_active) {
    logActivity(req.companyId, 'user', req.params.id, `User "${updates.display_name}" ${updates.is_active ? 'activated' : 'deactivated'}`, req.user.display_name);
  }

  res.json(db.prepare('SELECT id, email, display_name, role, is_active, last_login, created_at, updated_at, department_id, job_title FROM users WHERE id = ?').get(req.params.id));
});

// ─── DELETE /:id — delete user ────────────────────────────────────────────────

router.delete('/:id', requireRole('developer'), (req, res) => {
  if (req.params.id === req.user.id) return res.status(409).json({ error: 'Cannot delete your own account' });
  const user = db.prepare('SELECT role FROM users WHERE id = ? AND company_id = ?').get(req.params.id, req.companyId);
  if (!user) return res.status(404).json({ error: 'Not found' });
  if (user.role === 'developer') {
    const devCount = db.prepare("SELECT COUNT(*) as c FROM users WHERE role = 'developer' AND is_active = 1 AND company_id = ?").get(req.companyId).c;
    if (devCount <= 1) return res.status(409).json({ error: 'Cannot delete the last developer account' });
  }
  db.prepare('DELETE FROM sessions WHERE user_id = ?').run(req.params.id);
  db.prepare('DELETE FROM users WHERE id = ?').run(req.params.id);
  logActivity(req.companyId, 'user', req.params.id, `User deleted`, req.user.display_name);
  res.json({ success: true });
});

module.exports = router;

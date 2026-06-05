const crypto = require('crypto');
const db = require('../db');

// ─── Password helpers ─────────────────────────────────────────────────────────

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  try {
    const [salt, hash] = stored.split(':');
    const attempt = crypto.scryptSync(password, salt, 64).toString('hex');
    return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(attempt, 'hex'));
  } catch {
    return false;
  }
}

// ─── Token helpers ────────────────────────────────────────────────────────────

function generateToken() {
  return crypto.randomBytes(32).toString('hex');
}

// ─── Auth middleware ──────────────────────────────────────────────────────────

function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Not authenticated', code: 'NO_TOKEN' });
  }
  const token = authHeader.slice(7);
  const row = db.prepare(`
    SELECT s.id as session_id, s.user_id, s.expires_at,
           u.email, u.display_name, u.role, u.is_active
    FROM sessions s JOIN users u ON u.id = s.user_id
    WHERE s.token = ? AND s.expires_at > datetime('now') AND u.is_active = 1
  `).get(token);

  if (!row) {
    return res.status(401).json({ error: 'Invalid or expired session', code: 'INVALID_TOKEN' });
  }

  req.user = {
    id: row.user_id, email: row.email, display_name: row.display_name,
    role: row.role, session_id: row.session_id,
  };
  next();
}

// ─── Role guard middleware factory ────────────────────────────────────────────

const ROLE_LEVELS = { developer: 5, manager: 4, supervisor: 3, operator: 2, viewer: 1 };

function requireRole(minRole) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Not authenticated' });
    const userLevel = ROLE_LEVELS[req.user.role] ?? 0;
    const requiredLevel = ROLE_LEVELS[minRole] ?? 99;
    if (userLevel < requiredLevel) {
      return res.status(403).json({ error: `Requires ${minRole} role or higher`, code: 'FORBIDDEN' });
    }
    next();
  };
}

module.exports = { requireAuth, requireRole, hashPassword, verifyPassword, generateToken, ROLE_LEVELS };

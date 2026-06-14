const crypto = require('crypto');
const db = require('../db');

function hashKey(key) {
  return crypto.createHash('sha256').update(key).digest('hex');
}

// Authenticates requests to the public /api/v1 surface using a long-lived
// API key (Authorization: Bearer hm_live_... or X-API-Key header).
function apiKeyAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const key = header.startsWith('Bearer ') ? header.slice(7) : (req.headers['x-api-key'] || '');
  if (!key) return res.status(401).json({ error: 'Missing API key' });

  const row = db.prepare('SELECT * FROM api_keys WHERE key_hash = ?').get(hashKey(key));
  if (!row) return res.status(401).json({ error: 'Invalid API key' });

  db.prepare(`UPDATE api_keys SET last_used_at = datetime('now') WHERE id = ?`).run(row.id);

  req.companyId = row.company_id;
  req.apiKey = { id: row.id, name: row.name };
  next();
}

module.exports = { apiKeyAuth };

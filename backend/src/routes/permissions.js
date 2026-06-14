const express = require('express');
const db = require('../db');
const { requireRole } = require('../middleware/auth');

const router = express.Router();

const VALID_ROLES = ['viewer', 'operator', 'supervisor', 'manager'];

// ─── GET / - current nav permission overrides for the org ─────────────────────
// Returns { [role]: { [nav_key]: 0 | 1 } } — any authenticated user can read
// this (it's used to compute their own navigation), but only the overrides
// for roles at or below their own are meaningful to them.

router.get('/', (req, res) => {
  const rows = db.prepare('SELECT role, nav_key, visible FROM role_permissions WHERE company_id = ?').all(req.companyId);
  const out = {};
  for (const r of rows) {
    if (!out[r.role]) out[r.role] = {};
    out[r.role][r.nav_key] = r.visible;
  }
  res.json(out);
});

// ─── PUT / - set nav permission overrides (manager+) ───────────────────────────
// Body: { overrides: [{ role, nav_key, visible }] }
// visible: 0 or 1 to set an override, null to clear it (revert to default).

router.put('/', requireRole('manager'), (req, res) => {
  const overrides = Array.isArray(req.body.overrides) ? req.body.overrides : [];

  const upsert = db.prepare(`
    INSERT INTO role_permissions (company_id, role, nav_key, visible) VALUES (?, ?, ?, ?)
    ON CONFLICT(company_id, role, nav_key) DO UPDATE SET visible = excluded.visible
  `);
  const clear = db.prepare('DELETE FROM role_permissions WHERE company_id = ? AND role = ? AND nav_key = ?');

  const apply = db.transaction((entries) => {
    for (const o of entries) {
      if (!o || !VALID_ROLES.includes(o.role) || !o.nav_key) continue;
      if (o.visible === null || o.visible === undefined) {
        clear.run(req.companyId, o.role, o.nav_key);
      } else {
        upsert.run(req.companyId, o.role, o.nav_key, o.visible ? 1 : 0);
      }
    }
  });
  apply(overrides);

  const rows = db.prepare('SELECT role, nav_key, visible FROM role_permissions WHERE company_id = ?').all(req.companyId);
  const out = {};
  for (const r of rows) {
    if (!out[r.role]) out[r.role] = {};
    out[r.role][r.nav_key] = r.visible;
  }
  res.json(out);
});

// ─── DELETE /reset - clear all overrides for the org (manager+) ────────────────

router.delete('/reset', requireRole('manager'), (req, res) => {
  db.prepare('DELETE FROM role_permissions WHERE company_id = ?').run(req.companyId);
  res.json({});
});

module.exports = router;

const express = require('express');
const { v4: uuidv4 } = require('uuid');
const db = require('../db');
const { requireRole } = require('../middleware/auth');
const { logActivity } = require('../activity');

const router = express.Router();

// ─── GET / - list sites for the org ────────────────────────────────────────────

router.get('/', (req, res) => {
  const sites = db.prepare(`
    SELECT s.*,
      (SELECT COUNT(*) FROM stations    WHERE site_id = s.id) as station_count,
      (SELECT COUNT(*) FROM departments WHERE site_id = s.id) as department_count,
      (SELECT COUNT(*) FROM work_orders WHERE site_id = s.id AND status != 'cancelled') as work_order_count,
      (SELECT COUNT(*) FROM locations   WHERE site_id = s.id) as location_count
    FROM sites s WHERE s.company_id = ?
    ORDER BY s.is_primary DESC, s.name
  `).all(req.companyId);
  res.json(sites);
});

// ─── POST / - create a site (manager+) ─────────────────────────────────────────

router.post('/', requireRole('manager'), (req, res) => {
  const { name, code, address = '', timezone = '' } = req.body;
  if (!name) return res.status(400).json({ error: 'name is required' });
  if (!code) return res.status(400).json({ error: 'code is required' });

  const existing = db.prepare('SELECT id FROM sites WHERE company_id = ? AND code = ?').get(req.companyId, code);
  if (existing) return res.status(409).json({ error: 'A site with that code already exists' });

  const id = uuidv4();
  db.prepare(`INSERT INTO sites (id, company_id, name, code, address, timezone, is_primary) VALUES (?, ?, ?, ?, ?, ?, 0)`)
    .run(id, req.companyId, name, code, address, timezone);

  logActivity(req.companyId, 'site', id, `Site "${name}" created`, req.user.display_name);

  const site = db.prepare('SELECT * FROM sites WHERE id = ?').get(id);
  res.status(201).json({ ...site, station_count: 0, department_count: 0, work_order_count: 0, location_count: 0 });
});

// ─── PUT /:id - update a site (manager+) ───────────────────────────────────────

router.put('/:id', requireRole('manager'), (req, res) => {
  const site = db.prepare('SELECT * FROM sites WHERE id = ? AND company_id = ?').get(req.params.id, req.companyId);
  if (!site) return res.status(404).json({ error: 'Site not found' });

  if (req.body.code !== undefined && req.body.code !== site.code) {
    const existing = db.prepare('SELECT id FROM sites WHERE company_id = ? AND code = ? AND id != ?').get(req.companyId, req.body.code, req.params.id);
    if (existing) return res.status(409).json({ error: 'A site with that code already exists' });
  }

  const updates = {
    name:     req.body.name     !== undefined ? req.body.name     : site.name,
    code:     req.body.code     !== undefined ? req.body.code     : site.code,
    address:  req.body.address  !== undefined ? req.body.address  : site.address,
    timezone: req.body.timezone !== undefined ? req.body.timezone : site.timezone,
  };

  db.prepare(`UPDATE sites SET name=?, code=?, address=?, timezone=? WHERE id=?`)
    .run(updates.name, updates.code, updates.address, updates.timezone, req.params.id);

  // Promote to primary — demote any other primary site for this org.
  if (req.body.is_primary === true && !site.is_primary) {
    db.prepare('UPDATE sites SET is_primary = 0 WHERE company_id = ?').run(req.companyId);
    db.prepare('UPDATE sites SET is_primary = 1 WHERE id = ?').run(req.params.id);
  }

  logActivity(req.companyId, 'site', req.params.id, `Site "${updates.name}" updated`, req.user.display_name);

  const updated = db.prepare('SELECT * FROM sites WHERE id = ?').get(req.params.id);
  res.json(updated);
});

// ─── DELETE /:id - delete a site (manager+) ────────────────────────────────────
// Records assigned to this site fall back to unassigned (site_id = NULL).

router.delete('/:id', requireRole('manager'), (req, res) => {
  const site = db.prepare('SELECT * FROM sites WHERE id = ? AND company_id = ?').get(req.params.id, req.companyId);
  if (!site) return res.status(404).json({ error: 'Site not found' });
  if (site.is_primary) return res.status(409).json({ error: 'Cannot delete the primary site' });

  for (const t of ['stations', 'departments', 'work_orders', 'locations']) {
    db.prepare(`UPDATE ${t} SET site_id = NULL WHERE site_id = ?`).run(req.params.id);
  }
  db.prepare('DELETE FROM sites WHERE id = ?').run(req.params.id);

  logActivity(req.companyId, 'site', req.params.id, `Site "${site.name}" deleted`, req.user.display_name);
  res.json({ success: true });
});

module.exports = router;

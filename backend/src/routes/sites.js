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

  const dupName = db.prepare('SELECT id FROM sites WHERE company_id = ? AND LOWER(name) = LOWER(?)').get(req.companyId, name);
  if (dupName) return res.status(409).json({ error: 'duplicate_name', message: `A site named "${name}" already exists` });

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

  if (req.body.name !== undefined && req.body.name !== site.name) {
    const dupName = db.prepare('SELECT id FROM sites WHERE company_id = ? AND LOWER(name) = LOWER(?) AND id != ?').get(req.companyId, req.body.name, req.params.id);
    if (dupName) return res.status(409).json({ error: 'duplicate_name', message: `A site named "${req.body.name}" already exists` });
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

// ─── Facility shifts (site_shifts) ────────────────────────────────────────────
// Per-facility shift builder: name + HH:MM start/end (overnight spans where
// ends_at < starts_at roll into the next day) + active days of week + color.
// All routes are tenant + site-ownership scoped; writes require supervisor+.

const SHIFT_TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

function ownedSite(req) {
  return db.prepare('SELECT * FROM sites WHERE id = ? AND company_id = ?').get(req.params.siteId, req.companyId) || null;
}

// Normalizes/validates the days-of-week payload. Returns a sorted, deduped
// array of integers 0-6, or null when the input is invalid.
function normalizeDays(days) {
  if (days === undefined) return [0, 1, 2, 3, 4, 5, 6];
  if (!Array.isArray(days) || days.length === 0) return null;
  const out = [...new Set(days)].sort((a, b) => a - b);
  if (out.some(d => !Number.isInteger(d) || d < 0 || d > 6)) return null;
  return out;
}

function shiftJson(row) {
  let days;
  try { days = JSON.parse(row.days || '[]'); } catch { days = []; }
  return { ...row, days };
}

// Validates the writable shift fields. `current` is the existing row for PUT
// (fields fall back to it); null for POST. Returns { error } or { values }.
function validateShiftBody(body, current) {
  const name = body.name !== undefined ? body.name : current?.name;
  const starts_at = body.starts_at !== undefined ? body.starts_at : current?.starts_at;
  const ends_at = body.ends_at !== undefined ? body.ends_at : current?.ends_at;
  const days = body.days !== undefined || !current ? normalizeDays(body.days) : JSON.parse(current.days || '[]');
  const color = body.color !== undefined ? String(body.color || '') : (current?.color || '');
  const sort_order = body.sort_order !== undefined ? parseInt(body.sort_order, 10) : (current?.sort_order ?? 0);

  if (!name || typeof name !== 'string' || !name.trim()) return { error: 'name is required' };
  if (typeof starts_at !== 'string' || !SHIFT_TIME_RE.test(starts_at)) return { error: 'starts_at must be HH:MM (24h)' };
  if (typeof ends_at !== 'string' || !SHIFT_TIME_RE.test(ends_at)) return { error: 'ends_at must be HH:MM (24h)' };
  if (starts_at === ends_at) return { error: 'ends_at must differ from starts_at' };
  if (!days) return { error: 'days must be a non-empty array of weekday numbers 0-6' };
  if (!Number.isFinite(sort_order)) return { error: 'sort_order must be a number' };

  return { values: { name: name.trim(), starts_at, ends_at, days, color, sort_order } };
}

// ─── GET /:siteId/shifts - list shifts for a facility ─────────────────────────

router.get('/:siteId/shifts', (req, res) => {
  if (!ownedSite(req)) return res.status(404).json({ error: 'Site not found' });
  const rows = db.prepare('SELECT * FROM site_shifts WHERE site_id = ? AND company_id = ? ORDER BY sort_order, starts_at, name')
    .all(req.params.siteId, req.companyId);
  res.json(rows.map(shiftJson));
});

// ─── POST /:siteId/shifts - create a shift (supervisor+) ──────────────────────

router.post('/:siteId/shifts', requireRole('supervisor'), (req, res) => {
  const site = ownedSite(req);
  if (!site) return res.status(404).json({ error: 'Site not found' });

  const { error, values } = validateShiftBody(req.body, null);
  if (error) return res.status(400).json({ error });

  const dup = db.prepare('SELECT id FROM site_shifts WHERE site_id = ? AND company_id = ? AND LOWER(name) = LOWER(?)')
    .get(req.params.siteId, req.companyId, values.name);
  if (dup) return res.status(409).json({ error: 'duplicate_name', message: `A shift named "${values.name}" already exists for this facility` });

  const id = uuidv4();
  db.prepare(`INSERT INTO site_shifts (id, company_id, site_id, name, starts_at, ends_at, days, color, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(id, req.companyId, req.params.siteId, values.name, values.starts_at, values.ends_at, JSON.stringify(values.days), values.color, values.sort_order);

  logActivity(req.companyId, 'site', req.params.siteId, `Shift "${values.name}" created at ${site.name}`, req.user.display_name);
  res.status(201).json(shiftJson(db.prepare('SELECT * FROM site_shifts WHERE id = ?').get(id)));
});

// ─── PUT /:siteId/shifts/:shiftId - update a shift (supervisor+) ──────────────

router.put('/:siteId/shifts/:shiftId', requireRole('supervisor'), (req, res) => {
  if (!ownedSite(req)) return res.status(404).json({ error: 'Site not found' });
  const shift = db.prepare('SELECT * FROM site_shifts WHERE id = ? AND site_id = ? AND company_id = ?')
    .get(req.params.shiftId, req.params.siteId, req.companyId);
  if (!shift) return res.status(404).json({ error: 'Shift not found' });

  const { error, values } = validateShiftBody(req.body, shift);
  if (error) return res.status(400).json({ error });

  if (values.name.toLowerCase() !== shift.name.toLowerCase()) {
    const dup = db.prepare('SELECT id FROM site_shifts WHERE site_id = ? AND company_id = ? AND LOWER(name) = LOWER(?) AND id != ?')
      .get(req.params.siteId, req.companyId, values.name, req.params.shiftId);
    if (dup) return res.status(409).json({ error: 'duplicate_name', message: `A shift named "${values.name}" already exists for this facility` });
  }

  db.prepare(`UPDATE site_shifts SET name = ?, starts_at = ?, ends_at = ?, days = ?, color = ?, sort_order = ? WHERE id = ?`)
    .run(values.name, values.starts_at, values.ends_at, JSON.stringify(values.days), values.color, values.sort_order, req.params.shiftId);

  logActivity(req.companyId, 'site', req.params.siteId, `Shift "${values.name}" updated`, req.user.display_name);
  res.json(shiftJson(db.prepare('SELECT * FROM site_shifts WHERE id = ?').get(req.params.shiftId)));
});

// ─── DELETE /:siteId/shifts/:shiftId - delete a shift (supervisor+) ───────────

router.delete('/:siteId/shifts/:shiftId', requireRole('supervisor'), (req, res) => {
  if (!ownedSite(req)) return res.status(404).json({ error: 'Site not found' });
  const shift = db.prepare('SELECT * FROM site_shifts WHERE id = ? AND site_id = ? AND company_id = ?')
    .get(req.params.shiftId, req.params.siteId, req.companyId);
  if (!shift) return res.status(404).json({ error: 'Shift not found' });

  db.prepare('DELETE FROM site_shifts WHERE id = ?').run(req.params.shiftId);
  logActivity(req.companyId, 'site', req.params.siteId, `Shift "${shift.name}" deleted`, req.user.display_name);
  res.json({ success: true });
});

module.exports = router;

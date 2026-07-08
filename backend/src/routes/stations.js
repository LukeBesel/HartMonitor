const express = require('express');
const { v4: uuidv4 } = require('uuid');
const db = require('../db');
const { logActivity } = require('../activity');

const router = express.Router();

const STATION_SELECT = `
  SELECT s.*, d.name AS department_name, d.color AS department_color
  FROM stations s
  LEFT JOIN departments d ON d.id = s.department_id
`;

function withCount(station) {
  return {
    ...station,
    completion_count: db.prepare('SELECT COUNT(*) as c FROM completions WHERE station_id = ?').get(station.id).c,
  };
}

// Returns the id if the row exists in this company, else null. Prevents linking
// a station to another tenant's department/site/app (whose names would then
// leak through the enriched JOINs).
function ownedOrNull(table, id, companyId) {
  if (!id) return null;
  const row = db.prepare(`SELECT id FROM ${table} WHERE id = ? AND company_id = ?`).get(id, companyId);
  return row ? id : null;
}

router.get('/', (req, res) => {
  let sql = STATION_SELECT + ' WHERE s.company_id = ?';
  const params = [req.companyId];
  if (req.query.site_id) { sql += ' AND s.site_id = ?'; params.push(req.query.site_id); }
  if (req.query.department_id) { sql += ' AND s.department_id = ?'; params.push(req.query.department_id); }
  sql += ' ORDER BY s.name';
  const stations = db.prepare(sql).all(...params);
  res.json(stations.map(withCount));
});

router.post('/', (req, res) => {
  const { name, description = '', location = '', department_id = null, site_id = null } = req.body;
  if (!name) return res.status(400).json({ error: 'name required' });
  const id = uuidv4();
  const safeDeptId = ownedOrNull('departments', department_id, req.companyId);
  const safeSiteId = ownedOrNull('sites', site_id, req.companyId);
  db.prepare('INSERT INTO stations (id, name, description, location, department_id, site_id, company_id) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(id, name, description, location, safeDeptId, safeSiteId, req.companyId);
  logActivity(req.companyId, 'station', id, `Station "${name}" created`, req.user?.display_name, { department_id: safeDeptId, station_id: id });
  const station = db.prepare(STATION_SELECT + ' WHERE s.id = ?').get(id);
  res.status(201).json({ ...station, completion_count: 0 });
});

router.put('/:id', (req, res) => {
  const { name, description, location, status, current_app_id, department_id, site_id } = req.body;
  const station = db.prepare('SELECT * FROM stations WHERE id = ? AND company_id = ?').get(req.params.id, req.companyId);
  if (!station) return res.status(404).json({ error: 'Not found' });
  const updates = {
    name: name ?? station.name,
    description: description ?? station.description,
    location: location ?? station.location,
    status: status ?? station.status,
    current_app_id: current_app_id !== undefined ? ownedOrNull('apps', current_app_id, req.companyId) : station.current_app_id,
    department_id: department_id !== undefined ? ownedOrNull('departments', department_id, req.companyId) : station.department_id,
    site_id: site_id !== undefined ? ownedOrNull('sites', site_id, req.companyId) : station.site_id,
  };
  db.prepare('UPDATE stations SET name=?, description=?, location=?, status=?, current_app_id=?, department_id=?, site_id=? WHERE id=?')
    .run(updates.name, updates.description, updates.location, updates.status, updates.current_app_id, updates.department_id, updates.site_id, req.params.id);

  if (updates.status !== station.status) {
    logActivity(req.companyId, 'station', req.params.id, `Status changed from ${station.status} to ${updates.status}`, req.user?.display_name, { department_id: updates.department_id || null, station_id: req.params.id });
  }

  const updated = db.prepare(STATION_SELECT + ' WHERE s.id = ?').get(req.params.id);
  res.json(withCount(updated));
});

router.delete('/:id', (req, res) => {
  const station = db.prepare('SELECT * FROM stations WHERE id = ? AND company_id = ?').get(req.params.id, req.companyId);
  if (!station) return res.status(404).json({ error: 'Not found' });
  db.prepare('DELETE FROM stations WHERE id = ? AND company_id = ?').run(req.params.id, req.companyId);
  logActivity(req.companyId, 'station', req.params.id, `Station "${station.name}" deleted`, req.user?.display_name, { department_id: station.department_id || null, station_id: req.params.id });
  res.json({ success: true });
});

module.exports = router;

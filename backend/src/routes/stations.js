const express = require('express');
const { v4: uuidv4 } = require('uuid');
const db = require('../db');

const router = express.Router();

router.get('/', (req, res) => {
  const stations = db.prepare('SELECT * FROM stations ORDER BY name').all();
  res.json(stations.map(s => ({
    ...s,
    completion_count: db.prepare('SELECT COUNT(*) as c FROM completions WHERE station_id = ?').get(s.id).c
  })));
});

router.post('/', (req, res) => {
  const { name, description = '', location = '' } = req.body;
  if (!name) return res.status(400).json({ error: 'name required' });
  const id = uuidv4();
  db.prepare('INSERT INTO stations (id, name, description, location) VALUES (?, ?, ?, ?)').run(id, name, description, location);
  const station = db.prepare('SELECT * FROM stations WHERE id = ?').get(id);
  res.status(201).json({ ...station, completion_count: 0 });
});

router.put('/:id', (req, res) => {
  const { name, description, location, status, current_app_id } = req.body;
  const station = db.prepare('SELECT * FROM stations WHERE id = ?').get(req.params.id);
  if (!station) return res.status(404).json({ error: 'Not found' });
  const updates = {
    name: name ?? station.name,
    description: description ?? station.description,
    location: location ?? station.location,
    status: status ?? station.status,
    current_app_id: current_app_id !== undefined ? current_app_id : station.current_app_id,
  };
  db.prepare('UPDATE stations SET name=?, description=?, location=?, status=?, current_app_id=? WHERE id=?')
    .run(updates.name, updates.description, updates.location, updates.status, updates.current_app_id, req.params.id);
  const updated = db.prepare('SELECT * FROM stations WHERE id = ?').get(req.params.id);
  res.json({ ...updated, completion_count: db.prepare('SELECT COUNT(*) as c FROM completions WHERE station_id = ?').get(req.params.id).c });
});

router.delete('/:id', (req, res) => {
  db.prepare('DELETE FROM stations WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

module.exports = router;

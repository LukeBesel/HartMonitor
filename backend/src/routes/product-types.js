const express = require('express');
const { v4: uuidv4 } = require('uuid');
const db = require('../db');

const router = express.Router();

function parseType(pt) {
  return { ...pt, takt_overrides: JSON.parse(pt.takt_overrides || '{}') };
}

router.get('/', (req, res) => {
  const { app_id } = req.query;
  let query = 'SELECT * FROM product_types';
  const params = [];
  if (app_id) { query += ' WHERE app_id = ?'; params.push(app_id); }
  query += ' ORDER BY name ASC';
  res.json(db.prepare(query).all(...params).map(parseType));
});

router.post('/', (req, res) => {
  const { app_id, name, description = '', takt_overrides = {} } = req.body;
  if (!app_id || !name) return res.status(400).json({ error: 'app_id and name required' });
  const app = db.prepare('SELECT id FROM apps WHERE id = ?').get(app_id);
  if (!app) return res.status(404).json({ error: 'App not found' });
  const id = uuidv4();
  db.prepare('INSERT INTO product_types (id, app_id, name, description, takt_overrides) VALUES (?, ?, ?, ?, ?)')
    .run(id, app_id, name, description, JSON.stringify(takt_overrides));
  res.status(201).json(parseType(db.prepare('SELECT * FROM product_types WHERE id = ?').get(id)));
});

router.put('/:id', (req, res) => {
  const pt = db.prepare('SELECT * FROM product_types WHERE id = ?').get(req.params.id);
  if (!pt) return res.status(404).json({ error: 'Not found' });
  const { name, description, takt_overrides } = req.body;
  db.prepare(`UPDATE product_types SET name=?, description=?, takt_overrides=?, updated_at=datetime('now') WHERE id=?`)
    .run(
      name ?? pt.name,
      description ?? pt.description,
      takt_overrides !== undefined ? JSON.stringify(takt_overrides) : pt.takt_overrides,
      req.params.id
    );
  res.json(parseType(db.prepare('SELECT * FROM product_types WHERE id = ?').get(req.params.id)));
});

router.delete('/:id', (req, res) => {
  const pt = db.prepare('SELECT id FROM product_types WHERE id = ?').get(req.params.id);
  if (!pt) return res.status(404).json({ error: 'Not found' });
  db.prepare('DELETE FROM product_types WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

module.exports = router;

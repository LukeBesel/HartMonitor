const express = require('express');
const { v4: uuidv4 } = require('uuid');
const db = require('../db');

const router = express.Router();

router.get('/', (req, res) => {
  const apps = db.prepare('SELECT * FROM apps ORDER BY updated_at DESC').all();
  res.json(apps.map(a => ({ ...a, steps: JSON.parse(a.steps), variables: JSON.parse(a.variables) })));
});

router.post('/', (req, res) => {
  const { name, description = '' } = req.body;
  if (!name) return res.status(400).json({ error: 'name required' });
  const id = uuidv4();
  const defaultStep = [{ id: uuidv4(), name: 'Step 1', order: 0, widgets: [] }];
  db.prepare('INSERT INTO apps (id, name, description, steps) VALUES (?, ?, ?, ?)').run(id, name, description, JSON.stringify(defaultStep));
  const app = db.prepare('SELECT * FROM apps WHERE id = ?').get(id);
  res.status(201).json({ ...app, steps: JSON.parse(app.steps), variables: JSON.parse(app.variables) });
});

router.get('/:id', (req, res) => {
  const app = db.prepare('SELECT * FROM apps WHERE id = ?').get(req.params.id);
  if (!app) return res.status(404).json({ error: 'Not found' });
  res.json({ ...app, steps: JSON.parse(app.steps), variables: JSON.parse(app.variables) });
});

router.put('/:id', (req, res) => {
  const { name, description, steps, variables, status } = req.body;
  const app = db.prepare('SELECT * FROM apps WHERE id = ?').get(req.params.id);
  if (!app) return res.status(404).json({ error: 'Not found' });

  const updates = {
    name: name ?? app.name,
    description: description ?? app.description,
    steps: steps !== undefined ? JSON.stringify(steps) : app.steps,
    variables: variables !== undefined ? JSON.stringify(variables) : app.variables,
    status: status ?? app.status,
  };

  db.prepare(`UPDATE apps SET name=?, description=?, steps=?, variables=?, status=?, updated_at=datetime('now') WHERE id=?`)
    .run(updates.name, updates.description, updates.steps, updates.variables, updates.status, req.params.id);

  const updated = db.prepare('SELECT * FROM apps WHERE id = ?').get(req.params.id);
  res.json({ ...updated, steps: JSON.parse(updated.steps), variables: JSON.parse(updated.variables) });
});

router.post('/:id/publish', (req, res) => {
  const app = db.prepare('SELECT * FROM apps WHERE id = ?').get(req.params.id);
  if (!app) return res.status(404).json({ error: 'Not found' });
  db.prepare(`UPDATE apps SET status='published', updated_at=datetime('now') WHERE id=?`).run(req.params.id);
  const updated = db.prepare('SELECT * FROM apps WHERE id = ?').get(req.params.id);
  res.json({ ...updated, steps: JSON.parse(updated.steps), variables: JSON.parse(updated.variables) });
});

router.delete('/:id', (req, res) => {
  db.prepare('DELETE FROM apps WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

router.get('/:id/completions', (req, res) => {
  const completions = db.prepare('SELECT * FROM completions WHERE app_id = ? ORDER BY started_at DESC LIMIT 100').all(req.params.id);
  res.json(completions.map(c => ({ ...c, data: JSON.parse(c.data), step_times: JSON.parse(c.step_times) })));
});

module.exports = router;

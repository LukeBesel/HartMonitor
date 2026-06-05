const express = require('express');
const { v4: uuidv4 } = require('uuid');
const db = require('../db');

const router = express.Router();

router.get('/', (req, res) => {
  const tables = db.prepare('SELECT * FROM tables ORDER BY name').all();
  res.json(tables.map(t => ({
    ...t,
    fields: JSON.parse(t.fields),
    record_count: db.prepare('SELECT COUNT(*) as c FROM table_records WHERE table_id = ?').get(t.id).c
  })));
});

router.post('/', (req, res) => {
  const { name, description = '', fields = [] } = req.body;
  if (!name) return res.status(400).json({ error: 'name required' });
  const id = uuidv4();
  db.prepare('INSERT INTO tables (id, name, description, fields) VALUES (?, ?, ?, ?)').run(id, name, description, JSON.stringify(fields));
  const table = db.prepare('SELECT * FROM tables WHERE id = ?').get(id);
  res.status(201).json({ ...table, fields: JSON.parse(table.fields), record_count: 0 });
});

router.get('/:id', (req, res) => {
  const table = db.prepare('SELECT * FROM tables WHERE id = ?').get(req.params.id);
  if (!table) return res.status(404).json({ error: 'Not found' });
  res.json({ ...table, fields: JSON.parse(table.fields) });
});

router.put('/:id', (req, res) => {
  const { name, description, fields } = req.body;
  const table = db.prepare('SELECT * FROM tables WHERE id = ?').get(req.params.id);
  if (!table) return res.status(404).json({ error: 'Not found' });
  const updates = {
    name: name ?? table.name,
    description: description ?? table.description,
    fields: fields !== undefined ? JSON.stringify(fields) : table.fields,
  };
  db.prepare(`UPDATE tables SET name=?, description=?, fields=?, updated_at=datetime('now') WHERE id=?`)
    .run(updates.name, updates.description, updates.fields, req.params.id);
  const updated = db.prepare('SELECT * FROM tables WHERE id = ?').get(req.params.id);
  res.json({ ...updated, fields: JSON.parse(updated.fields) });
});

router.delete('/:id', (req, res) => {
  db.prepare('DELETE FROM tables WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

router.get('/:id/records', (req, res) => {
  const records = db.prepare('SELECT * FROM table_records WHERE table_id = ? ORDER BY created_at DESC').all(req.params.id);
  res.json(records.map(r => ({ ...r, data: JSON.parse(r.data) })));
});

router.post('/:id/records', (req, res) => {
  const { data = {} } = req.body;
  const table = db.prepare('SELECT * FROM tables WHERE id = ?').get(req.params.id);
  if (!table) return res.status(404).json({ error: 'Table not found' });
  const id = uuidv4();
  db.prepare('INSERT INTO table_records (id, table_id, data) VALUES (?, ?, ?)').run(id, req.params.id, JSON.stringify(data));
  const record = db.prepare('SELECT * FROM table_records WHERE id = ?').get(id);
  res.status(201).json({ ...record, data: JSON.parse(record.data) });
});

router.put('/:id/records/:recordId', (req, res) => {
  const { data } = req.body;
  const record = db.prepare('SELECT * FROM table_records WHERE id = ? AND table_id = ?').get(req.params.recordId, req.params.id);
  if (!record) return res.status(404).json({ error: 'Not found' });
  db.prepare(`UPDATE table_records SET data=?, updated_at=datetime('now') WHERE id=?`).run(JSON.stringify(data), req.params.recordId);
  const updated = db.prepare('SELECT * FROM table_records WHERE id = ?').get(req.params.recordId);
  res.json({ ...updated, data: JSON.parse(updated.data) });
});

router.delete('/:id/records/:recordId', (req, res) => {
  db.prepare('DELETE FROM table_records WHERE id = ? AND table_id = ?').run(req.params.recordId, req.params.id);
  res.json({ success: true });
});

module.exports = router;

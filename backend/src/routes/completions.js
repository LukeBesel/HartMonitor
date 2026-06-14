const express = require('express');
const { v4: uuidv4 } = require('uuid');
const db = require('../db');

const router = express.Router();

router.get('/', (req, res) => {
  const { limit = 50, status, operator_name } = req.query;
  let query = 'SELECT * FROM completions WHERE company_id = ?';
  const params = [req.companyId];
  if (status) { query += ' AND status = ?'; params.push(status); }
  if (operator_name) { query += ' AND operator_name = ?'; params.push(operator_name); }
  query += ' ORDER BY started_at DESC LIMIT ?';
  params.push(parseInt(limit));
  const completions = db.prepare(query).all(...params);
  res.json(completions.map(c => ({ ...c, data: JSON.parse(c.data), step_times: JSON.parse(c.step_times) })));
});

router.post('/', (req, res) => {
  const { app_id, station_id, operator_name = 'Unknown', work_order_id, product_type_id } = req.body;
  if (!app_id) return res.status(400).json({ error: 'app_id required' });
  const app = db.prepare('SELECT name FROM apps WHERE id = ? AND company_id = ?').get(app_id, req.companyId);
  if (!app) return res.status(404).json({ error: 'App not found' });
  const id = uuidv4();
  db.prepare('INSERT INTO completions (id, app_id, app_name, station_id, operator_name, work_order_id, product_type_id, company_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(id, app_id, app.name, station_id || null, operator_name, work_order_id || null, product_type_id || null, req.companyId);
  const completion = db.prepare('SELECT * FROM completions WHERE id = ?').get(id);
  res.status(201).json({ ...completion, data: JSON.parse(completion.data), step_times: JSON.parse(completion.step_times) });
});

router.put('/:id', (req, res) => {
  const { status, data, step_times, takt_exceeded_steps } = req.body;
  const completion = db.prepare('SELECT * FROM completions WHERE id = ? AND company_id = ?').get(req.params.id, req.companyId);
  if (!completion) return res.status(404).json({ error: 'Not found' });

  const updates = {
    status: status ?? completion.status,
    data: data !== undefined ? JSON.stringify(data) : completion.data,
    step_times: step_times !== undefined ? JSON.stringify(step_times) : completion.step_times,
    takt_exceeded_steps: takt_exceeded_steps !== undefined ? JSON.stringify(takt_exceeded_steps) : completion.takt_exceeded_steps,
    completed_at: status === 'completed' ? new Date().toISOString() : completion.completed_at,
  };

  db.prepare('UPDATE completions SET status=?, data=?, step_times=?, takt_exceeded_steps=?, completed_at=? WHERE id=?')
    .run(updates.status, updates.data, updates.step_times, updates.takt_exceeded_steps, updates.completed_at, req.params.id);

  // Completing a run counts one unit against its work order
  if (status === 'completed' && completion.status !== 'completed' && completion.work_order_id) {
    const wo = db.prepare('SELECT * FROM work_orders WHERE id = ? AND company_id = ?').get(completion.work_order_id, req.companyId);
    if (wo) {
      const newQty    = Math.min(wo.quantity_completed + 1, wo.quantity);
      const newStatus = newQty >= wo.quantity
        ? 'completed'
        : (wo.status === 'pending' ? 'in_progress' : wo.status);
      db.prepare(`UPDATE work_orders SET quantity_completed=?, status=?, updated_at=datetime('now') WHERE id=?`)
        .run(newQty, newStatus, wo.id);
    }
  }

  const updated = db.prepare('SELECT * FROM completions WHERE id = ?').get(req.params.id);
  res.json({ ...updated, data: JSON.parse(updated.data), step_times: JSON.parse(updated.step_times) });
});

module.exports = router;

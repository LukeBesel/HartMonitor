const express = require('express');
const { v4: uuidv4 } = require('uuid');
const db = require('../db');
const { requireRole } = require('../middleware/auth');

const router = express.Router();

// Returns the id if the row exists in this company, else null. Step app/dept
// references outside the tenant would leak the other tenant's names through
// the step JOINs (app_name / department_name).
function ownedOrNull(table, id, companyId) {
  if (!id) return null;
  const row = db.prepare(`SELECT id FROM ${table} WHERE id = ? AND company_id = ?`).get(id, companyId);
  return row ? id : null;
}

// ─── GET / — list all routings with step count ────────────────────────────────

router.get('/', (req, res) => {
  const rows = db.prepare(`
    SELECT pr.*,
           COUNT(rs.id) AS step_count
    FROM product_routings pr
    LEFT JOIN routing_steps rs ON rs.routing_id = pr.id
    WHERE pr.company_id = ?
    GROUP BY pr.id
    ORDER BY pr.name ASC
  `).all(req.companyId);
  res.json(rows);
});

// ─── GET /:id — get routing with all steps ────────────────────────────────────

router.get('/:id', (req, res) => {
  const routing = db.prepare(
    'SELECT * FROM product_routings WHERE id = ? AND company_id = ?'
  ).get(req.params.id, req.companyId);
  if (!routing) return res.status(404).json({ error: 'Routing not found' });

  const steps = db.prepare(`
    SELECT rs.*,
           a.name  AS app_name,
           d.name  AS department_name
    FROM routing_steps rs
    LEFT JOIN apps        a ON a.id = rs.app_id
    LEFT JOIN departments d ON d.id = rs.department_id
    WHERE rs.routing_id = ?
    ORDER BY rs.step_number ASC
  `).all(req.params.id);

  res.json({ ...routing, steps });
});

// ─── POST / — create routing (with optional initial steps) ───────────────────

router.post('/', requireRole('supervisor'), (req, res) => {
  const { name, description = '', steps = [] } = req.body;
  if (!name) return res.status(400).json({ error: 'name is required' });

  const id = uuidv4();
  db.prepare(`
    INSERT INTO product_routings (id, company_id, name, description)
    VALUES (?, ?, ?, ?)
  `).run(id, req.companyId, name, description);

  if (Array.isArray(steps) && steps.length > 0) {
    const insStep = db.prepare(`
      INSERT INTO routing_steps
        (id, routing_id, company_id, step_number, name, description, app_id, department_id, estimated_cycle_seconds)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const [i, step] of steps.entries()) {
      insStep.run(
        uuidv4(), id, req.companyId,
        step.step_number ?? i + 1,
        step.name || `Step ${i + 1}`,
        step.description || '',
        ownedOrNull('apps', step.app_id, req.companyId),
        ownedOrNull('departments', step.department_id, req.companyId),
        step.estimated_cycle_seconds ?? 0,
      );
    }
  }

  const routing = db.prepare('SELECT * FROM product_routings WHERE id = ?').get(id);
  const createdSteps = db.prepare(`
    SELECT rs.*, a.name AS app_name, d.name AS department_name
    FROM routing_steps rs
    LEFT JOIN apps        a ON a.id = rs.app_id
    LEFT JOIN departments d ON d.id = rs.department_id
    WHERE rs.routing_id = ?
    ORDER BY rs.step_number ASC
  `).all(id);

  res.status(201).json({ ...routing, steps: createdSteps });
});

// ─── PUT /:id — update routing name/description ───────────────────────────────

router.put('/:id', requireRole('supervisor'), (req, res) => {
  const routing = db.prepare(
    'SELECT * FROM product_routings WHERE id = ? AND company_id = ?'
  ).get(req.params.id, req.companyId);
  if (!routing) return res.status(404).json({ error: 'Routing not found' });

  const name        = req.body.name        ?? routing.name;
  const description = req.body.description ?? routing.description;

  db.prepare(`
    UPDATE product_routings SET name = ?, description = ?, updated_at = datetime('now')
    WHERE id = ?
  `).run(name, description, req.params.id);

  res.json(db.prepare('SELECT * FROM product_routings WHERE id = ?').get(req.params.id));
});

// ─── DELETE /:id — delete routing (steps cascade) ────────────────────────────

router.delete('/:id', requireRole('supervisor'), (req, res) => {
  const routing = db.prepare(
    'SELECT id FROM product_routings WHERE id = ? AND company_id = ?'
  ).get(req.params.id, req.companyId);
  if (!routing) return res.status(404).json({ error: 'Routing not found' });

  db.prepare('DELETE FROM product_routings WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

// ─── GET /:id/steps — list steps for a routing ────────────────────────────────

router.get('/:id/steps', (req, res) => {
  const routing = db.prepare(
    'SELECT id FROM product_routings WHERE id = ? AND company_id = ?'
  ).get(req.params.id, req.companyId);
  if (!routing) return res.status(404).json({ error: 'Routing not found' });

  const steps = db.prepare(`
    SELECT rs.*, a.name AS app_name, d.name AS department_name
    FROM routing_steps rs
    LEFT JOIN apps        a ON a.id = rs.app_id
    LEFT JOIN departments d ON d.id = rs.department_id
    WHERE rs.routing_id = ?
    ORDER BY rs.step_number ASC
  `).all(req.params.id);

  res.json(steps);
});

// ─── POST /:id/steps — add a step ────────────────────────────────────────────

router.post('/:id/steps', requireRole('supervisor'), (req, res) => {
  const routing = db.prepare(
    'SELECT id FROM product_routings WHERE id = ? AND company_id = ?'
  ).get(req.params.id, req.companyId);
  if (!routing) return res.status(404).json({ error: 'Routing not found' });

  const { name, description = '', app_id, department_id, estimated_cycle_seconds = 0 } = req.body;
  if (!name) return res.status(400).json({ error: 'name is required' });

  // Auto-assign next step_number if not provided
  let step_number = req.body.step_number;
  if (step_number === undefined) {
    const maxRow = db.prepare(
      'SELECT MAX(step_number) AS m FROM routing_steps WHERE routing_id = ?'
    ).get(req.params.id);
    step_number = (maxRow.m ?? 0) + 1;
  }

  const stepId = uuidv4();
  db.prepare(`
    INSERT INTO routing_steps
      (id, routing_id, company_id, step_number, name, description, app_id, department_id, estimated_cycle_seconds)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(stepId, req.params.id, req.companyId, step_number, name, description,
         ownedOrNull('apps', app_id, req.companyId),
         ownedOrNull('departments', department_id, req.companyId),
         estimated_cycle_seconds);

  // Touch the parent routing's updated_at
  db.prepare("UPDATE product_routings SET updated_at = datetime('now') WHERE id = ?").run(req.params.id);

  const step = db.prepare(`
    SELECT rs.*, a.name AS app_name, d.name AS department_name
    FROM routing_steps rs
    LEFT JOIN apps        a ON a.id = rs.app_id
    LEFT JOIN departments d ON d.id = rs.department_id
    WHERE rs.id = ?
  `).get(stepId);

  res.status(201).json(step);
});

// ─── PUT /:id/steps/reorder — reorder steps ──────────────────────────────────
// Must be registered BEFORE /:id/steps/:stepId to avoid "reorder" being caught
// as a stepId parameter.

router.put('/:id/steps/reorder', requireRole('supervisor'), (req, res) => {
  const routing = db.prepare(
    'SELECT id FROM product_routings WHERE id = ? AND company_id = ?'
  ).get(req.params.id, req.companyId);
  if (!routing) return res.status(404).json({ error: 'Routing not found' });

  const items = req.body;
  if (!Array.isArray(items)) return res.status(400).json({ error: 'Body must be an array of {id, step_number}' });

  const upd = db.prepare('UPDATE routing_steps SET step_number = ? WHERE id = ? AND routing_id = ?');
  const reorderAll = db.transaction(() => {
    for (const item of items) {
      if (!item.id || item.step_number === undefined) continue;
      upd.run(item.step_number, item.id, req.params.id);
    }
  });
  reorderAll();

  db.prepare("UPDATE product_routings SET updated_at = datetime('now') WHERE id = ?").run(req.params.id);

  const steps = db.prepare(`
    SELECT rs.*, a.name AS app_name, d.name AS department_name
    FROM routing_steps rs
    LEFT JOIN apps        a ON a.id = rs.app_id
    LEFT JOIN departments d ON d.id = rs.department_id
    WHERE rs.routing_id = ?
    ORDER BY rs.step_number ASC
  `).all(req.params.id);

  res.json(steps);
});

// ─── PUT /:id/steps/:stepId — update a step ──────────────────────────────────

router.put('/:id/steps/:stepId', requireRole('supervisor'), (req, res) => {
  const routing = db.prepare(
    'SELECT id FROM product_routings WHERE id = ? AND company_id = ?'
  ).get(req.params.id, req.companyId);
  if (!routing) return res.status(404).json({ error: 'Routing not found' });

  const step = db.prepare(
    'SELECT * FROM routing_steps WHERE id = ? AND routing_id = ?'
  ).get(req.params.stepId, req.params.id);
  if (!step) return res.status(404).json({ error: 'Step not found' });

  const name                    = req.body.name                    ?? step.name;
  const description             = req.body.description             ?? step.description;
  const step_number             = req.body.step_number             ?? step.step_number;
  const app_id                  = req.body.app_id                  !== undefined ? ownedOrNull('apps', req.body.app_id, req.companyId)               : step.app_id;
  const department_id           = req.body.department_id           !== undefined ? ownedOrNull('departments', req.body.department_id, req.companyId) : step.department_id;
  const estimated_cycle_seconds = req.body.estimated_cycle_seconds ?? step.estimated_cycle_seconds;

  db.prepare(`
    UPDATE routing_steps
    SET step_number = ?, name = ?, description = ?, app_id = ?, department_id = ?, estimated_cycle_seconds = ?
    WHERE id = ?
  `).run(step_number, name, description, app_id, department_id, estimated_cycle_seconds, req.params.stepId);

  db.prepare("UPDATE product_routings SET updated_at = datetime('now') WHERE id = ?").run(req.params.id);

  const updated = db.prepare(`
    SELECT rs.*, a.name AS app_name, d.name AS department_name
    FROM routing_steps rs
    LEFT JOIN apps        a ON a.id = rs.app_id
    LEFT JOIN departments d ON d.id = rs.department_id
    WHERE rs.id = ?
  `).get(req.params.stepId);

  res.json(updated);
});

// ─── DELETE /:id/steps/:stepId — delete a step ───────────────────────────────

router.delete('/:id/steps/:stepId', requireRole('supervisor'), (req, res) => {
  const routing = db.prepare(
    'SELECT id FROM product_routings WHERE id = ? AND company_id = ?'
  ).get(req.params.id, req.companyId);
  if (!routing) return res.status(404).json({ error: 'Routing not found' });

  const step = db.prepare(
    'SELECT id FROM routing_steps WHERE id = ? AND routing_id = ?'
  ).get(req.params.stepId, req.params.id);
  if (!step) return res.status(404).json({ error: 'Step not found' });

  db.prepare('DELETE FROM routing_steps WHERE id = ?').run(req.params.stepId);
  db.prepare("UPDATE product_routings SET updated_at = datetime('now') WHERE id = ?").run(req.params.id);

  res.json({ success: true });
});

module.exports = router;

const express = require('express');
const { v4: uuidv4 } = require('uuid');
const db = require('../db');
const { requireRole } = require('../middleware/auth');
const ops = require('../workOrderOperations');

const router = express.Router();

// ─── One step-shaped answer ──────────────────────────────────────────────────
// Every step response goes through this, so the six places that used to spell
// the JOIN out by hand cannot drift. Two things ride along:
//
//   • standard_seconds — an ALIAS of estimated_cycle_seconds, not a second
//     column. A released operation carries standard_seconds, so a routing step
//     and the operation it becomes now answer to the same word. The original
//     name stays in the payload; nothing that reads it breaks.
//   • station_id / station_name — a step may name the machine it runs on, so a
//     released operation arrives already pointed at one.
const STEP_SELECT = `
  SELECT rs.*,
         rs.estimated_cycle_seconds AS standard_seconds,
         a.name AS app_name,
         d.name AS department_name,
         st.name AS station_name
  FROM routing_steps rs
  LEFT JOIN apps        a  ON a.id = rs.app_id
  LEFT JOIN departments d  ON d.id = rs.department_id
  LEFT JOIN stations    st ON st.id = rs.station_id
`;

// Returns the id if the row exists in this company, else null. Step app/dept
// references outside the tenant would leak the other tenant's names through
// the step JOINs (app_name / department_name).
function ownedOrNull(table, id, companyId) {
  if (!id) return null;
  const row = db.prepare(`SELECT id FROM ${table} WHERE id = ? AND company_id = ?`).get(id, companyId);
  return row ? id : null;
}

// A step's standard time, whichever of the two names the caller used.
// `standard_seconds` is what an operation calls it and what the step responses
// answer with, so a client that reads a step and posts it back must not lose
// the number to a name change.
function cycleSeconds(body, fallback) {
  const v = body.estimated_cycle_seconds ?? body.standard_seconds;
  if (v === undefined || v === null || v === '') return fallback;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

// ─── GET / — list all routings with step count ────────────────────────────────
// Optional ?department_id= narrows the list to routings that have at least one
// step in that department (a routing has no department of its own — the
// department lives on each routing_steps row). The step_count stays the full
// count so the list still reads as the whole routing, not the filtered slice.

router.get('/', (req, res) => {
  const { department_id } = req.query;
  const params = [req.companyId];
  let deptClause = '';
  if (department_id) {
    // company_id-scoped EXISTS: a department id from another tenant is never
    // referenced by this company's steps, so it filters everything away.
    deptClause = `
      AND EXISTS (
        SELECT 1 FROM routing_steps rs2
        WHERE rs2.routing_id = pr.id AND rs2.department_id = ? AND rs2.company_id = ?
      )`;
    params.push(department_id, req.companyId);
  }
  const rows = db.prepare(`
    SELECT pr.*,
           COUNT(rs.id) AS step_count
    FROM product_routings pr
    LEFT JOIN routing_steps rs ON rs.routing_id = pr.id
    WHERE pr.company_id = ?${deptClause}
    GROUP BY pr.id
    ORDER BY pr.name ASC
  `).all(...params);
  // What actually runs on each routing today. Without this the Routings screen
  // describes a sequence and never says whether anything is following it — the
  // page implies an execution model and shows no evidence of one. A routing
  // nothing runs on gets 0 here and the screen prints "—", not a fake number.
  const openCounts = ops.openCountsByRouting(req.companyId);
  res.json(rows.map(r => ({ ...r, open_work_orders: openCounts[r.id] || 0 })));
});

// ─── GET /:id — get routing with all steps ────────────────────────────────────

router.get('/:id', (req, res) => {
  const routing = db.prepare(
    'SELECT * FROM product_routings WHERE id = ? AND company_id = ?'
  ).get(req.params.id, req.companyId);
  if (!routing) return res.status(404).json({ error: 'Routing not found' });

  const steps = db.prepare(`${STEP_SELECT} WHERE rs.routing_id = ? AND rs.company_id = ? ORDER BY rs.step_number ASC`)
    .all(req.params.id, req.companyId);

  res.json({ ...routing, steps });
});

// ─── GET /:id/usage — which live jobs run on this routing ────────────────────
// The answer that makes the screen true. Every OPEN work order released against
// this routing, each with the operation it is standing on right now, so a
// planner editing a routing can see what they are about to affect.
//
// A completed or cancelled job is not "using" a routing any more, so it is not
// counted — the number on the list and the rows here come from the same rule.

router.get('/:id/usage', (req, res) => {
  const routing = db.prepare(
    'SELECT id, name FROM product_routings WHERE id = ? AND company_id = ?'
  ).get(req.params.id, req.companyId);
  if (!routing) return res.status(404).json({ error: 'Routing not found' });

  const workOrders = ops.openWorkOrdersOnRouting(req.companyId, routing.id);
  res.json({
    routing_id: routing.id,
    routing_name: routing.name,
    open_work_orders: workOrders.length,
    work_orders: workOrders,
  });
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
        (id, routing_id, company_id, step_number, name, description, app_id, department_id, station_id, estimated_cycle_seconds)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const [i, step] of steps.entries()) {
      insStep.run(
        uuidv4(), id, req.companyId,
        step.step_number ?? i + 1,
        step.name || `Step ${i + 1}`,
        step.description || '',
        ownedOrNull('apps', step.app_id, req.companyId),
        ownedOrNull('departments', step.department_id, req.companyId),
        ownedOrNull('stations', step.station_id, req.companyId),
        cycleSeconds(step, 0),
      );
    }
  }

  const routing = db.prepare('SELECT * FROM product_routings WHERE id = ?').get(id);
  const createdSteps = db.prepare(`${STEP_SELECT} WHERE rs.routing_id = ? AND rs.company_id = ? ORDER BY rs.step_number ASC`)
    .all(id, req.companyId);

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

  const steps = db.prepare(`${STEP_SELECT} WHERE rs.routing_id = ? AND rs.company_id = ? ORDER BY rs.step_number ASC`)
    .all(req.params.id, req.companyId);

  res.json(steps);
});

// ─── POST /:id/steps — add a step ────────────────────────────────────────────

router.post('/:id/steps', requireRole('supervisor'), (req, res) => {
  const routing = db.prepare(
    'SELECT id FROM product_routings WHERE id = ? AND company_id = ?'
  ).get(req.params.id, req.companyId);
  if (!routing) return res.status(404).json({ error: 'Routing not found' });

  const { name, description = '', app_id, department_id, station_id } = req.body;
  if (!name) return res.status(400).json({ error: 'name is required' });
  const estimated_cycle_seconds = cycleSeconds(req.body, 0);

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
      (id, routing_id, company_id, step_number, name, description, app_id, department_id, station_id, estimated_cycle_seconds)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(stepId, req.params.id, req.companyId, step_number, name, description,
         ownedOrNull('apps', app_id, req.companyId),
         ownedOrNull('departments', department_id, req.companyId),
         ownedOrNull('stations', station_id, req.companyId),
         estimated_cycle_seconds);

  // Touch the parent routing's updated_at
  db.prepare("UPDATE product_routings SET updated_at = datetime('now') WHERE id = ?").run(req.params.id);

  const step = db.prepare(`${STEP_SELECT} WHERE rs.id = ? AND rs.company_id = ?`).get(stepId, req.companyId);

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

  const steps = db.prepare(`${STEP_SELECT} WHERE rs.routing_id = ? AND rs.company_id = ? ORDER BY rs.step_number ASC`)
    .all(req.params.id, req.companyId);

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
  const station_id              = req.body.station_id              !== undefined ? ownedOrNull('stations', req.body.station_id, req.companyId)       : step.station_id;
  const estimated_cycle_seconds = cycleSeconds(req.body, step.estimated_cycle_seconds);

  db.prepare(`
    UPDATE routing_steps
    SET step_number = ?, name = ?, description = ?, app_id = ?, department_id = ?, station_id = ?, estimated_cycle_seconds = ?
    WHERE id = ?
  `).run(step_number, name, description, app_id, department_id, station_id, estimated_cycle_seconds, req.params.stepId);

  db.prepare("UPDATE product_routings SET updated_at = datetime('now') WHERE id = ?").run(req.params.id);

  const updated = db.prepare(`${STEP_SELECT} WHERE rs.id = ? AND rs.company_id = ?`).get(req.params.stepId, req.companyId);

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

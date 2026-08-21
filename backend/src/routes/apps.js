const express = require('express');
const { v4: uuidv4 } = require('uuid');
const db = require('../db');
const { logActivity } = require('../activity');

const router = express.Router();

// ─── Server-side trigger / v2-blob validation ────────────────────────────────
// The steps blob is authored client-side, but the server whitelists trigger
// events, condition operators and action types (and enforces sane sizes) so a
// malformed or malicious blob can never reach the player. Legacy v1 blobs carry
// no `triggers` arrays and pass through untouched.

const MAX_STEPS_BYTES = 2 * 1024 * 1024; // 2MB cap on the serialized steps blob

const TRIGGER_EVENTS = ['button_press', 'step_enter', 'step_exit', 'input_change', 'timer_done', 'scan'];
const TRIGGER_OPS = ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'contains', 'is_blank', 'not_blank', 'kit_complete', 'kit_has_short'];
const ACTION_TYPES = ['go_to_step', 'next_step', 'prev_step', 'set_variable', 'save_record',
  'require_photo', 'show_message', 'block_with_error', 'complete_app', 'create_ncr'];
const NAVIGATION_ACTIONS = ['go_to_step', 'next_step', 'prev_step', 'complete_app'];
const VALUE_REF_KINDS = ['static', 'variable', 'widget', 'app_info'];
const MAX_STRING = 4000; // generous per-string cap inside triggers

function validateTrigger(trigger, stepIds, path) {
  const fail = (msg, subPath) => ({ error: msg, path: subPath || path });
  if (!trigger || typeof trigger !== 'object' || Array.isArray(trigger)) return fail('trigger must be an object');
  if (!TRIGGER_EVENTS.includes(trigger.event)) return fail(`event must be one of: ${TRIGGER_EVENTS.join(', ')}`, `${path}.event`);
  if (trigger.match !== undefined && trigger.match !== 'all' && trigger.match !== 'any') {
    return fail("match must be 'all' or 'any'", `${path}.match`);
  }
  if (trigger.name !== undefined && (typeof trigger.name !== 'string' || trigger.name.length > MAX_STRING)) {
    return fail('name must be a string within length limits', `${path}.name`);
  }

  const conditions = trigger.conditions ?? [];
  if (!Array.isArray(conditions)) return fail('conditions must be an array', `${path}.conditions`);
  for (let i = 0; i < conditions.length; i++) {
    const c = conditions[i];
    const cPath = `${path}.conditions[${i}]`;
    if (!c || typeof c !== 'object') return fail('condition must be an object', cPath);
    if (!TRIGGER_OPS.includes(c.op)) return fail(`op must be one of: ${TRIGGER_OPS.join(', ')}`, `${cPath}.op`);
    for (const side of ['left', 'right']) {
      const ref = c[side];
      if (ref === undefined) continue;
      if (!ref || typeof ref !== 'object') return fail(`${side} must be a ValueRef object`, `${cPath}.${side}`);
      if (!VALUE_REF_KINDS.includes(ref.kind)) return fail(`kind must be one of: ${VALUE_REF_KINDS.join(', ')}`, `${cPath}.${side}.kind`);
      if (ref.name !== undefined && (typeof ref.name !== 'string' || ref.name.length > MAX_STRING)) {
        return fail('name must be a string within length limits', `${cPath}.${side}.name`);
      }
    }
  }

  const actions = trigger.actions ?? [];
  if (!Array.isArray(actions)) return fail('actions must be an array', `${path}.actions`);
  let navCount = 0;
  for (let i = 0; i < actions.length; i++) {
    const a = actions[i];
    const aPath = `${path}.actions[${i}]`;
    if (!a || typeof a !== 'object') return fail('action must be an object', aPath);
    if (!ACTION_TYPES.includes(a.type)) return fail(`action type must be one of: ${ACTION_TYPES.join(', ')}`, `${aPath}.type`);
    if (NAVIGATION_ACTIONS.includes(a.type)) navCount++;
    if (navCount > 1) return fail('at most one navigation/complete action is allowed per trigger', aPath);
    if (a.type === 'go_to_step') {
      if (typeof a.stepId !== 'string' || !stepIds.has(a.stepId)) {
        return fail('go_to_step target step does not exist', `${aPath}.stepId`);
      }
    }
    for (const field of ['text', 'title', 'description', 'message', 'name', 'tableId']) {
      if (a[field] !== undefined && (typeof a[field] !== 'string' || a[field].length > MAX_STRING)) {
        return fail(`${field} must be a string within length limits`, `${aPath}.${field}`);
      }
    }
  }
  return null;
}

// Returns null when valid, or { error, path } describing the first problem.
function validateStepsBlob(steps, stepGroups) {
  if (!Array.isArray(steps)) return { error: 'steps must be an array', path: 'steps' };
  if (stepGroups !== undefined && !Array.isArray(stepGroups)) {
    return { error: 'step_groups must be an array', path: 'step_groups' };
  }

  const stepIds = new Set(steps.map(s => s && s.id).filter(Boolean));
  for (let s = 0; s < steps.length; s++) {
    const step = steps[s];
    if (!step || typeof step !== 'object') return { error: 'step must be an object', path: `steps[${s}]` };
    if (step.triggers !== undefined) {
      if (!Array.isArray(step.triggers)) return { error: 'triggers must be an array', path: `steps[${s}].triggers` };
      for (let t = 0; t < step.triggers.length; t++) {
        const problem = validateTrigger(step.triggers[t], stepIds, `steps[${s}].triggers[${t}]`);
        if (problem) return problem;
      }
    }
    const widgets = step.widgets ?? [];
    if (!Array.isArray(widgets)) return { error: 'widgets must be an array', path: `steps[${s}].widgets` };
    for (let w = 0; w < widgets.length; w++) {
      const widget = widgets[w];
      if (!widget || typeof widget !== 'object') return { error: 'widget must be an object', path: `steps[${s}].widgets[${w}]` };
      if (widget.triggers !== undefined) {
        if (!Array.isArray(widget.triggers)) return { error: 'triggers must be an array', path: `steps[${s}].widgets[${w}].triggers` };
        for (let t = 0; t < widget.triggers.length; t++) {
          const problem = validateTrigger(widget.triggers[t], stepIds, `steps[${s}].widgets[${w}].triggers[${t}]`);
          if (problem) return problem;
        }
      }
    }
  }
  return null;
}

router.get('/', (req, res) => {
  const { department_id, site_id } = req.query;
  const conditions = ['company_id = ?'];
  const params = [req.companyId];

  if (department_id) { conditions.push('department_id = ?'); params.push(department_id); }
  if (site_id)       { conditions.push('site_id = ?');       params.push(site_id); }

  const apps = db.prepare(
    `SELECT * FROM apps WHERE ${conditions.join(' AND ')} ORDER BY updated_at DESC`
  ).all(...params);
  res.json(apps.map(a => ({ ...a, steps: JSON.parse(a.steps), variables: JSON.parse(a.variables), step_groups: JSON.parse(a.step_groups || '[]') })));
});

router.post('/', (req, res) => {
  const { name, description = '', department_id, site_id, station_id, show_takt_warnings } = req.body;
  if (!name) return res.status(400).json({ error: 'name required' });

  // Plan limit check — base tier limit plus purchased add-on slots
  // (skipped entirely during early access — no limits while EARLY_ACCESS is on)
  const { config: appCfg } = require('../config');
  const { getPlanRow } = require('./config');
  const plan = getPlanRow(req.companyId);
  if (!appCfg.earlyAccess && plan && plan.app_limit >= 0) {
    const effectiveLimit = plan.app_limit + (plan.extra_app_slots || 0);
    const appCount = db.prepare('SELECT COUNT(*) as c FROM apps WHERE company_id = ?').get(req.companyId).c;
    if (appCount >= effectiveLimit) {
      return res.status(402).json({
        error: 'plan_limit',
        message: `Your plan is limited to ${effectiveLimit} apps. Upgrade to Pro for unlimited apps, or purchase an extra app slot.`,
        limit: effectiveLimit, current: appCount,
      });
    }
  }

  const id = uuidv4();
  const defaultStep = [{ id: uuidv4(), name: 'Step 1', order: 0, widgets: [] }];
  db.prepare('INSERT INTO apps (id, name, description, steps, company_id, department_id, site_id, station_id, show_takt_warnings) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(id, name, description, JSON.stringify(defaultStep), req.companyId, department_id || null, site_id || null, station_id || null, show_takt_warnings === undefined ? 1 : (show_takt_warnings ? 1 : 0));
  logActivity(req.companyId, 'app', id, `App "${name}" created`, req.user?.display_name);
  const app = db.prepare('SELECT * FROM apps WHERE id = ?').get(id);
  res.status(201).json({ ...app, steps: JSON.parse(app.steps), variables: JSON.parse(app.variables), step_groups: JSON.parse(app.step_groups || '[]') });
});

router.get('/:id', (req, res) => {
  const app = db.prepare('SELECT * FROM apps WHERE id = ? AND company_id = ?').get(req.params.id, req.companyId);
  if (!app) return res.status(404).json({ error: 'Not found' });
  res.json({ ...app, steps: JSON.parse(app.steps), variables: JSON.parse(app.variables), step_groups: JSON.parse(app.step_groups || '[]') });
});

router.put('/:id', (req, res) => {
  const { name, description, steps, variables, status, department_id, site_id, station_id, show_takt_warnings, step_groups, schema_version } = req.body;
  const app = db.prepare('SELECT * FROM apps WHERE id = ? AND company_id = ?').get(req.params.id, req.companyId);
  if (!app) return res.status(404).json({ error: 'Not found' });

  if (steps !== undefined) {
    if (JSON.stringify(steps).length > MAX_STEPS_BYTES) {
      return res.status(400).json({ error: 'steps blob exceeds the 2MB limit', code: 'STEPS_TOO_LARGE' });
    }
    const problem = validateStepsBlob(steps, step_groups);
    if (problem) return res.status(400).json({ error: problem.error, code: 'INVALID_TRIGGER', path: problem.path });
  } else if (step_groups !== undefined && !Array.isArray(step_groups)) {
    return res.status(400).json({ error: 'step_groups must be an array', code: 'INVALID_TRIGGER', path: 'step_groups' });
  }
  if (schema_version !== undefined && ![1, 2].includes(schema_version)) {
    return res.status(400).json({ error: 'schema_version must be 1 or 2', code: 'INVALID_TRIGGER', path: 'schema_version' });
  }

  const updates = {
    name: name ?? app.name,
    description: description ?? app.description,
    steps: steps !== undefined ? JSON.stringify(steps) : app.steps,
    variables: variables !== undefined ? JSON.stringify(variables) : app.variables,
    status: status ?? app.status,
    department_id: department_id !== undefined ? (department_id || null) : app.department_id,
    site_id: site_id !== undefined ? (site_id || null) : app.site_id,
    station_id: station_id !== undefined ? (station_id || null) : app.station_id,
    show_takt_warnings: show_takt_warnings !== undefined ? (show_takt_warnings ? 1 : 0) : app.show_takt_warnings,
    step_groups: step_groups !== undefined ? JSON.stringify(step_groups) : (app.step_groups ?? '[]'),
    schema_version: schema_version !== undefined ? schema_version : (app.schema_version ?? 1),
  };

  db.prepare(`UPDATE apps SET name=?, description=?, steps=?, variables=?, status=?, department_id=?, site_id=?, station_id=?, show_takt_warnings=?, step_groups=?, schema_version=?, updated_at=datetime('now') WHERE id=?`)
    .run(updates.name, updates.description, updates.steps, updates.variables, updates.status, updates.department_id, updates.site_id, updates.station_id, updates.show_takt_warnings, updates.step_groups, updates.schema_version, req.params.id);

  const updated = db.prepare('SELECT * FROM apps WHERE id = ?').get(req.params.id);
  res.json({ ...updated, steps: JSON.parse(updated.steps), variables: JSON.parse(updated.variables), step_groups: JSON.parse(updated.step_groups || '[]') });
});

router.post('/:id/publish', (req, res) => {
  const app = db.prepare('SELECT * FROM apps WHERE id = ? AND company_id = ?').get(req.params.id, req.companyId);
  if (!app) return res.status(404).json({ error: 'Not found' });
  db.prepare(`UPDATE apps SET status='published', updated_at=datetime('now') WHERE id=?`).run(req.params.id);
  logActivity(req.companyId, 'app', req.params.id, `App "${app.name}" published`, req.user?.display_name);
  const updated = db.prepare('SELECT * FROM apps WHERE id = ?').get(req.params.id);
  res.json({ ...updated, steps: JSON.parse(updated.steps), variables: JSON.parse(updated.variables), step_groups: JSON.parse(updated.step_groups || '[]') });
});

router.delete('/:id', (req, res) => {
  const app = db.prepare('SELECT * FROM apps WHERE id = ? AND company_id = ?').get(req.params.id, req.companyId);
  if (!app) return res.status(404).json({ error: 'Not found' });
  db.prepare('DELETE FROM apps WHERE id = ? AND company_id = ?').run(req.params.id, req.companyId);
  logActivity(req.companyId, 'app', req.params.id, `App "${app.name}" deleted`, req.user?.display_name);
  res.json({ success: true });
});

router.get('/:id/completions', (req, res) => {
  const completions = db.prepare('SELECT * FROM completions WHERE app_id = ? AND company_id = ? ORDER BY started_at DESC LIMIT 100')
    .all(req.params.id, req.companyId);
  res.json(completions.map(c => ({ ...c, data: JSON.parse(c.data), step_times: JSON.parse(c.step_times) })));
});

module.exports = router;

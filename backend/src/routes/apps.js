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

// Plan limit check — base tier limit plus purchased add-on slots (skipped
// entirely during early access — no limits while EARLY_ACCESS is on).
// Returns a 402 payload when the company is at its app limit, else null.
function appLimitError(companyId) {
  const { config: appCfg } = require('../config');
  const { getPlanRow } = require('./config');
  const plan = getPlanRow(companyId);
  if (!appCfg.earlyAccess && plan && plan.app_limit >= 0) {
    const effectiveLimit = plan.app_limit + (plan.extra_app_slots || 0);
    const appCount = db.prepare('SELECT COUNT(*) as c FROM apps WHERE company_id = ?').get(companyId).c;
    if (appCount >= effectiveLimit) {
      return {
        error: 'plan_limit',
        message: `Your plan is limited to ${effectiveLimit} apps. Upgrade to Pro for unlimited apps, or purchase an extra app slot.`,
        limit: effectiveLimit, current: appCount,
      };
    }
  }
  return null;
}

router.post('/', (req, res) => {
  const { name, description = '', department_id, site_id, station_id, show_takt_warnings } = req.body;
  if (!name) return res.status(400).json({ error: 'name required' });

  const limitErr = appLimitError(req.companyId);
  if (limitErr) return res.status(402).json(limitErr);

  const id = uuidv4();
  const defaultStep = [{ id: uuidv4(), name: 'Step 1', order: 0, widgets: [] }];
  db.prepare('INSERT INTO apps (id, name, description, steps, company_id, department_id, site_id, station_id, show_takt_warnings) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(id, name, description, JSON.stringify(defaultStep), req.companyId, department_id || null, site_id || null, station_id || null, show_takt_warnings === undefined ? 1 : (show_takt_warnings ? 1 : 0));
  logActivity(req.companyId, 'app', id, `App "${name}" created`, req.user?.display_name);
  const app = db.prepare('SELECT * FROM apps WHERE id = ?').get(id);
  res.status(201).json({ ...app, steps: JSON.parse(app.steps), variables: JSON.parse(app.variables), step_groups: JSON.parse(app.step_groups || '[]') });
});

// ─── App templates ────────────────────────────────────────────────────────────
// Users can snapshot any app as a reusable template, and HartMonitor's built-in
// "model" templates (defined in code below) always appear as starters.
// ROUTE ORDER MATTERS: /templates and /from-template are registered BEFORE the
// /:id routes so Express never captures "templates" / "from-template" as an id.

// Built-in model templates. Ids inside the blobs are stable strings — every
// instantiation regenerates them (see regenerateIds), so collisions with apps
// created from the same template are impossible.
const MODEL_TEMPLATES = [
  {
    key: 'bracket-assembly',
    name: 'Bracket Assembly',
    description: 'A guided 3-step work instruction: safety prep, torque-controlled assembly with photo evidence, and a pass/fail final inspection.',
    steps: [
      {
        id: 'ba-step-1', name: 'Safety & Prep', order: 0, takt_time: 90,
        widgets: [
          { id: 'ba-w-11', type: 'instruction', order: 0, label: 'Before You Start', config: { content: 'Put on safety glasses and gloves. Confirm the fixture is clamped and the torque driver is calibrated (cal sticker in date).', backgroundColor: '#fef3c7' } },
          { id: 'ba-w-12', type: 'checkbox', order: 1, label: 'PPE On (glasses + gloves)', config: { required: true, variableName: 'ppe_on' } },
          { id: 'ba-w-13', type: 'checkbox', order: 2, label: 'Torque Driver In Cal', config: { required: true, variableName: 'driver_in_cal' } },
          { id: 'ba-w-14', type: 'button', order: 3, label: '', config: { buttonText: 'Start Assembly', buttonType: 'next', buttonColor: '#22c55e' } },
        ],
      },
      {
        id: 'ba-step-2', name: 'Assemble Bracket', order: 1, takt_time: 300,
        widgets: [
          { id: 'ba-w-21', type: 'instruction', order: 0, label: 'Assembly Sequence', config: { content: '1. Seat the bracket on the two locating pins\n2. Start all four M6 bolts by hand\n3. Torque in a cross pattern to 15 Nm\n4. Record the final torque reading below', backgroundColor: '#eff6ff' } },
          { id: 'ba-w-22', type: 'number-input', order: 1, label: 'Final Torque (Nm)', config: { required: true, variableName: 'final_torque', min: 14, max: 16, enforceRange: true, placeholder: '15' } },
          { id: 'ba-w-23', type: 'photo-capture', order: 2, label: 'Photo of Torqued Joints', config: { required: true, variableName: 'joint_photo', maxPhotos: 2 } },
          { id: 'ba-w-24', type: 'button', order: 3, label: '', config: { buttonText: 'Assembly Done', buttonType: 'next', buttonColor: '#3b82f6' } },
        ],
      },
      {
        id: 'ba-step-3', name: 'Final Inspection', order: 2, takt_time: 120,
        widgets: [
          { id: 'ba-w-31', type: 'pass-fail', order: 0, label: 'Visual Inspection (no burrs, scratches, or gaps)', config: { required: true, variableName: 'visual_ok' } },
          { id: 'ba-w-32', type: 'pass-fail', order: 1, label: 'Fit Check on Gauge', config: { required: true, variableName: 'fit_ok' } },
          { id: 'ba-w-33', type: 'text-input', order: 2, label: 'Inspector Notes', config: { variableName: 'inspector_notes', placeholder: 'Anything worth recording…' } },
          { id: 'ba-w-34', type: 'button', order: 3, label: '', config: { buttonText: 'Complete', buttonType: 'complete', buttonColor: '#22c55e' } },
        ],
      },
    ],
    variables: [
      { id: 'ba-v-1', name: 'ppe_on', type: 'boolean' },
      { id: 'ba-v-2', name: 'driver_in_cal', type: 'boolean' },
      { id: 'ba-v-3', name: 'final_torque', type: 'number' },
      { id: 'ba-v-4', name: 'visual_ok', type: 'boolean' },
      { id: 'ba-v-5', name: 'fit_ok', type: 'boolean' },
      { id: 'ba-v-6', name: 'inspector_notes', type: 'text' },
    ],
  },
  {
    key: 'quality-inspection',
    name: 'Quality Inspection',
    description: 'A simple pass/fail inspection checklist with photo evidence — a quick starting point for incoming or final QC.',
    steps: [
      {
        id: 'qi-step-1', name: 'Inspection Checklist', order: 0,
        widgets: [
          { id: 'qi-w-11', type: 'instruction', order: 0, label: 'How To Inspect', config: { content: 'Work top to bottom. Mark each check pass or fail; photograph anything you fail.', backgroundColor: '#eff6ff' } },
          { id: 'qi-w-12', type: 'pass-fail', order: 1, label: 'Labels correct and legible', config: { required: true, variableName: 'labels_ok' } },
          { id: 'qi-w-13', type: 'pass-fail', order: 2, label: 'No visible damage', config: { required: true, variableName: 'no_damage' } },
          { id: 'qi-w-14', type: 'pass-fail', order: 3, label: 'Dimensions within spec', config: { required: true, variableName: 'dims_ok' } },
          { id: 'qi-w-15', type: 'photo-capture', order: 4, label: 'Evidence Photo (required on any fail)', config: { variableName: 'evidence_photo', maxPhotos: 3 } },
          { id: 'qi-w-16', type: 'text-input', order: 5, label: 'Notes', config: { variableName: 'qc_notes', placeholder: 'Defects found, lot numbers…' } },
          { id: 'qi-w-17', type: 'button', order: 6, label: '', config: { buttonText: 'Finish Inspection', buttonType: 'complete', buttonColor: '#22c55e' } },
        ],
      },
    ],
    variables: [
      { id: 'qi-v-1', name: 'labels_ok', type: 'boolean' },
      { id: 'qi-v-2', name: 'no_damage', type: 'boolean' },
      { id: 'qi-v-3', name: 'dims_ok', type: 'boolean' },
      { id: 'qi-v-4', name: 'qc_notes', type: 'text' },
    ],
  },
];

// Deep-remaps every id in a copied steps/step_groups blob so an app created
// from a template never shares step, widget, group, or trigger ids with the
// source. go_to_step targets and step.group_id references are remapped through
// the same maps; dangling references are left untouched.
function regenerateIds(steps, stepGroups) {
  const stepIdMap = new Map();
  const groupIdMap = new Map();
  const srcSteps = Array.isArray(steps) ? steps : [];
  const srcGroups = Array.isArray(stepGroups) ? stepGroups : [];
  for (const s of srcSteps) if (s && typeof s === 'object' && s.id) stepIdMap.set(s.id, uuidv4());
  for (const g of srcGroups) if (g && typeof g === 'object' && g.id) groupIdMap.set(g.id, uuidv4());

  const mapTriggers = triggers => triggers.map(t => {
    if (!t || typeof t !== 'object') return t;
    const out = { ...t };
    if (out.id !== undefined) out.id = uuidv4();
    if (Array.isArray(out.actions)) {
      out.actions = out.actions.map(a =>
        (a && typeof a === 'object' && a.type === 'go_to_step' && stepIdMap.has(a.stepId))
          ? { ...a, stepId: stepIdMap.get(a.stepId) }
          : a
      );
    }
    return out;
  });

  const newSteps = srcSteps.map(s => {
    if (!s || typeof s !== 'object') return s;
    const out = { ...s, id: stepIdMap.get(s.id) || uuidv4() };
    if (out.group_id && groupIdMap.has(out.group_id)) out.group_id = groupIdMap.get(out.group_id);
    if (Array.isArray(out.triggers)) out.triggers = mapTriggers(out.triggers);
    if (Array.isArray(out.widgets)) {
      out.widgets = out.widgets.map(w => {
        if (!w || typeof w !== 'object') return w;
        const nw = { ...w, id: uuidv4() };
        if (Array.isArray(nw.triggers)) nw.triggers = mapTriggers(nw.triggers);
        return nw;
      });
    }
    return out;
  });

  const newGroups = srcGroups.map(g =>
    (g && typeof g === 'object') ? { ...g, id: groupIdMap.get(g.id) || uuidv4() } : g
  );

  return { steps: newSteps, step_groups: newGroups };
}

const templateSummary = row => ({
  id: row.id,
  name: row.name,
  description: row.description,
  step_count: (() => { try { return JSON.parse(row.steps).length; } catch { return 0; } })(),
  created_at: row.created_at,
});

// GET /api/apps/templates — built-in model templates plus this company's own.
router.get('/templates', (req, res) => {
  const mine = db.prepare('SELECT * FROM app_templates WHERE company_id = ? ORDER BY created_at DESC')
    .all(req.companyId);
  res.json({
    built_in: MODEL_TEMPLATES.map(t => ({ key: t.key, name: t.name, description: t.description, step_count: t.steps.length })),
    mine: mine.map(templateSummary),
  });
});

// DELETE /api/apps/templates/:id — own company only (cross-tenant rows are invisible).
router.delete('/templates/:id', (req, res) => {
  const row = db.prepare('SELECT id, name FROM app_templates WHERE id = ? AND company_id = ?')
    .get(req.params.id, req.companyId);
  if (!row) return res.status(404).json({ error: 'Not found' });
  db.prepare('DELETE FROM app_templates WHERE id = ? AND company_id = ?').run(req.params.id, req.companyId);
  logActivity(req.companyId, 'app', req.params.id, `App template "${row.name}" deleted`, req.user?.display_name);
  res.json({ success: true });
});

// POST /api/apps/from-template { built_in_key | template_id, name }
// Creates a new draft app from the snapshot with every id regenerated.
router.post('/from-template', (req, res) => {
  const { built_in_key, template_id, name } = req.body || {};
  if (!name || typeof name !== 'string' || !name.trim()) {
    return res.status(400).json({ error: 'name required' });
  }
  if ((built_in_key && template_id) || (!built_in_key && !template_id)) {
    return res.status(400).json({ error: 'exactly one of built_in_key or template_id is required' });
  }

  let snapshot; // { steps, variables, step_groups, description, sourceLabel }
  if (built_in_key) {
    const t = MODEL_TEMPLATES.find(m => m.key === built_in_key);
    if (!t) return res.status(404).json({ error: 'Unknown built-in template' });
    snapshot = { steps: t.steps, variables: t.variables, step_groups: [], description: t.description, sourceLabel: t.name };
  } else {
    const row = db.prepare('SELECT * FROM app_templates WHERE id = ? AND company_id = ?')
      .get(template_id, req.companyId);
    if (!row) return res.status(404).json({ error: 'Not found' });
    try {
      snapshot = {
        steps: JSON.parse(row.steps),
        variables: JSON.parse(row.variables),
        step_groups: JSON.parse(row.step_groups || '[]'),
        description: row.description,
        sourceLabel: row.name,
      };
    } catch {
      return res.status(500).json({ error: 'Template snapshot is corrupted' });
    }
  }

  const limitErr = appLimitError(req.companyId);
  if (limitErr) return res.status(402).json(limitErr);

  const { steps, step_groups } = regenerateIds(snapshot.steps, snapshot.step_groups);
  const id = uuidv4();
  db.prepare(`INSERT INTO apps (id, name, description, status, steps, variables, step_groups, company_id)
              VALUES (?, ?, ?, 'draft', ?, ?, ?, ?)`)
    .run(id, name.trim(), snapshot.description || '',
      JSON.stringify(steps), JSON.stringify(Array.isArray(snapshot.variables) ? snapshot.variables : []),
      JSON.stringify(step_groups), req.companyId);
  logActivity(req.companyId, 'app', id, `App "${name.trim()}" created from template "${snapshot.sourceLabel}"`, req.user?.display_name);
  const app = db.prepare('SELECT * FROM apps WHERE id = ?').get(id);
  res.status(201).json({ ...app, steps: JSON.parse(app.steps), variables: JSON.parse(app.variables), step_groups: JSON.parse(app.step_groups || '[]') });
});

// POST /api/apps/:id/save-as-template — supervisor+ (enforced by the router
// mount's writeRole('supervisor')). Snapshots the app's authoring blob.
router.post('/:id/save-as-template', (req, res) => {
  const app = db.prepare('SELECT * FROM apps WHERE id = ? AND company_id = ?').get(req.params.id, req.companyId);
  if (!app) return res.status(404).json({ error: 'Not found' });

  const { name, description } = req.body || {};
  if (name !== undefined && (typeof name !== 'string' || !name.trim())) {
    return res.status(400).json({ error: 'name must be a non-empty string' });
  }

  const id = uuidv4();
  db.prepare(`INSERT INTO app_templates (id, company_id, name, description, steps, variables, step_groups, created_by)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(id, req.companyId,
      (name && name.trim()) || app.name,
      typeof description === 'string' ? description : (app.description || ''),
      app.steps || '[]', app.variables || '[]', app.step_groups || '[]',
      req.user?.display_name || '');
  logActivity(req.companyId, 'app', app.id, `App "${app.name}" saved as template`, req.user?.display_name);
  const row = db.prepare('SELECT * FROM app_templates WHERE id = ?').get(id);
  res.status(201).json(templateSummary(row));
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
module.exports.MODEL_TEMPLATES = MODEL_TEMPLATES;

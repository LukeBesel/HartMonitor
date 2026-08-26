const express = require('express');
const {
  roundSeconds, runSecondsSQL, runBasisSQL, avgRunSecondsSQL, avgRunBasisSQL,
  handsOnSecondsSQL, elapsedSecondsSQL, elapsedSoFarSecondsSQL,
} = require('../cycleTime');
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
  // Apps with no site assigned belong to the whole company (see departments.js).
  if (site_id)       { conditions.push('(site_id = ? OR site_id IS NULL)'); params.push(site_id); }

  const apps = db.prepare(
    `SELECT * FROM apps WHERE ${conditions.join(' AND ')} ORDER BY updated_at DESC`
  ).all(...params);
  res.json(apps.map(a => ({ ...a, steps: JSON.parse(a.steps), variables: JSON.parse(a.variables), step_groups: JSON.parse(a.step_groups || '[]') })));
});

// ─── GET /stats — run counters for the App Library cards ─────────────────────
// One row per app: lifetime runs, runs in the last 7 days, currently-open runs
// and the last time anybody ran it. `company_has_completions` answers "has this
// company ever run anything?" — the honest signal a brand-new account uses to
// land on Apps instead of an empty Command Center.
// ROUTE ORDER: registered before the /:id routes so "stats" is never read as an id.
router.get('/stats', (req, res) => {
  const rows = db.prepare(`
    SELECT a.id AS app_id,
           COUNT(c.id) AS runs_total,
           SUM(CASE WHEN c.started_at >= datetime('now', '-7 days') THEN 1 ELSE 0 END) AS runs_7d,
           SUM(CASE WHEN c.status = 'in_progress' THEN 1 ELSE 0 END) AS in_progress,
           MAX(c.started_at) AS last_run_at
    FROM apps a
    LEFT JOIN completions c ON c.app_id = a.id AND c.company_id = a.company_id
    WHERE a.company_id = ?
    GROUP BY a.id
  `).all(req.companyId);

  const any = db.prepare('SELECT 1 AS x FROM completions WHERE company_id = ? LIMIT 1').get(req.companyId);

  res.json({
    company_has_completions: !!any,
    apps: rows.map(r => ({
      app_id: r.app_id,
      runs_total: r.runs_total || 0,
      runs_7d: r.runs_7d || 0,
      in_progress: r.in_progress || 0,
      last_run_at: r.last_run_at || null,
    })),
  });
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

  const dup = db.prepare('SELECT id FROM apps WHERE company_id = ? AND LOWER(name) = LOWER(?)').get(req.companyId, name);
  if (dup) return res.status(409).json({ error: 'duplicate_name', message: `An app named "${name}" already exists` });

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
        // Five seconds on purpose — see sandbox.js. A new customer's very first
        // app should show them the takt countdown expiring, not just mention it.
        id: 'ba-step-1', name: 'Safety & Prep', order: 0, takt_time_seconds: 5,
        widgets: [
          { id: 'ba-w-11', type: 'instruction', order: 0, label: 'Before You Start', config: { content: 'Put on safety glasses and gloves. Confirm the fixture is clamped and the torque driver is calibrated (cal sticker in date).', backgroundColor: '#fef3c7' } },
          { id: 'ba-w-12', type: 'checkbox', order: 1, label: 'PPE On (glasses + gloves)', config: { required: true, variableName: 'ppe_on' } },
          { id: 'ba-w-13', type: 'checkbox', order: 2, label: 'Torque Driver In Cal', config: { required: true, variableName: 'driver_in_cal' } },
          { id: 'ba-w-14', type: 'button', order: 3, label: '', config: { buttonText: 'Start Assembly', buttonType: 'next', buttonColor: '#4ade80' } },
        ],
      },
      {
        id: 'ba-step-2', name: 'Assemble Bracket', order: 1, takt_time_seconds: 300,
        widgets: [
          { id: 'ba-w-21', type: 'instruction', order: 0, label: 'Assembly Sequence', config: { content: '1. Seat the bracket on the two locating pins\n2. Start all four M6 bolts by hand\n3. Torque in a cross pattern to 15 Nm\n4. Record the final torque reading below', backgroundColor: '#eff6ff' } },
          { id: 'ba-w-22', type: 'number-input', order: 1, label: 'Final Torque (Nm)', config: { required: true, variableName: 'final_torque', min: 14, max: 16, enforceRange: true, placeholder: '15' } },
          { id: 'ba-w-23', type: 'photo-capture', order: 2, label: 'Photo of Torqued Joints', config: { required: true, variableName: 'joint_photo', maxPhotos: 2 } },
          { id: 'ba-w-24', type: 'button', order: 3, label: '', config: { buttonText: 'Assembly Done', buttonType: 'next', buttonColor: '#60a5fa' } },
        ],
      },
      {
        id: 'ba-step-3', name: 'Final Inspection', order: 2, takt_time_seconds: 120,
        widgets: [
          { id: 'ba-w-31', type: 'pass-fail', order: 0, label: 'Visual Inspection (no burrs, scratches, or gaps)', config: { required: true, variableName: 'visual_ok' } },
          { id: 'ba-w-32', type: 'pass-fail', order: 1, label: 'Fit Check on Gauge', config: { required: true, variableName: 'fit_ok' } },
          { id: 'ba-w-33', type: 'text-input', order: 2, label: 'Inspector Notes', config: { variableName: 'inspector_notes', placeholder: 'Anything worth recording…' } },
          { id: 'ba-w-34', type: 'button', order: 3, label: '', config: { buttonText: 'Complete', buttonType: 'complete', buttonColor: '#4ade80' } },
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
        id: 'qi-step-1', name: 'Inspection Checklist', order: 0, takt_time_seconds: 5,
        widgets: [
          { id: 'qi-w-11', type: 'instruction', order: 0, label: 'How To Inspect', config: { content: 'Work top to bottom. Mark each check pass or fail; photograph anything you fail.', backgroundColor: '#eff6ff' } },
          { id: 'qi-w-12', type: 'pass-fail', order: 1, label: 'Labels correct and legible', config: { required: true, variableName: 'labels_ok' } },
          { id: 'qi-w-13', type: 'pass-fail', order: 2, label: 'No visible damage', config: { required: true, variableName: 'no_damage' } },
          { id: 'qi-w-14', type: 'pass-fail', order: 3, label: 'Dimensions within spec', config: { required: true, variableName: 'dims_ok' } },
          { id: 'qi-w-15', type: 'photo-capture', order: 4, label: 'Evidence Photo (required on any fail)', config: { variableName: 'evidence_photo', maxPhotos: 3 } },
          { id: 'qi-w-16', type: 'text-input', order: 5, label: 'Notes', config: { variableName: 'qc_notes', placeholder: 'Defects found, lot numbers…' } },
          { id: 'qi-w-17', type: 'button', order: 6, label: '', config: { buttonText: 'Finish Inspection', buttonType: 'complete', buttonColor: '#4ade80' } },
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

// POST /:id/duplicate { name? } — copy an app into a new draft. Uses the same
// id regeneration as templates so the copy never shares step/widget/trigger ids
// with the original, and picks a free "(copy)" name when none is supplied.
router.post('/:id/duplicate', (req, res) => {
  const app = db.prepare('SELECT * FROM apps WHERE id = ? AND company_id = ?')
    .get(req.params.id, req.companyId);
  if (!app) return res.status(404).json({ error: 'Not found' });

  const requested = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
  const nameTaken = candidate => !!db
    .prepare('SELECT id FROM apps WHERE company_id = ? AND LOWER(name) = LOWER(?)')
    .get(req.companyId, candidate);

  let name = requested;
  if (name) {
    if (nameTaken(name)) {
      return res.status(409).json({ error: 'duplicate_name', message: `An app named "${name}" already exists` });
    }
  } else {
    name = `${app.name} (copy)`;
    for (let n = 2; nameTaken(name) && n < 100; n++) name = `${app.name} (copy ${n})`;
  }

  const limitErr = appLimitError(req.companyId);
  if (limitErr) return res.status(402).json(limitErr);

  let parsedSteps = [];
  let parsedGroups = [];
  try {
    parsedSteps = JSON.parse(app.steps || '[]');
    parsedGroups = JSON.parse(app.step_groups || '[]');
  } catch {
    return res.status(500).json({ error: 'This app\'s steps are corrupted and cannot be copied' });
  }
  const { steps, step_groups } = regenerateIds(parsedSteps, parsedGroups);

  const id = uuidv4();
  db.prepare(`INSERT INTO apps (id, name, description, status, steps, variables, step_groups, company_id,
              department_id, site_id, station_id, show_takt_warnings, schema_version)
              VALUES (?, ?, ?, 'draft', ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(id, name, app.description || '', JSON.stringify(steps), app.variables || '[]',
      JSON.stringify(step_groups), req.companyId,
      app.department_id || null, app.site_id || null, app.station_id || null,
      app.show_takt_warnings === undefined ? 1 : app.show_takt_warnings,
      app.schema_version ?? 1);
  logActivity(req.companyId, 'app', id, `App "${name}" duplicated from "${app.name}"`, req.user?.display_name);
  const created = db.prepare('SELECT * FROM apps WHERE id = ?').get(id);
  res.status(201).json({
    ...created,
    steps: JSON.parse(created.steps),
    variables: JSON.parse(created.variables),
    step_groups: JSON.parse(created.step_groups || '[]'),
  });
});

router.get('/:id', (req, res) => {
  const app = db.prepare('SELECT * FROM apps WHERE id = ? AND company_id = ?').get(req.params.id, req.companyId);
  if (!app) return res.status(404).json({ error: 'Not found' });
  res.json({ ...app, steps: JSON.parse(app.steps), variables: JSON.parse(app.variables), step_groups: JSON.parse(app.step_groups || '[]') });
});

// ─── GET /:id/detail — everything the in-depth app page needs, in one call ────
// Read-only and tenant-scoped (app ownership is checked first → cross-tenant
// requests 404 before any other query runs). Nothing here is invented: every
// number comes from this company's completions, and every binding is a real row
// that points at this app.
router.get('/:id/detail', (req, res) => {
  const app = db.prepare('SELECT * FROM apps WHERE id = ? AND company_id = ?')
    .get(req.params.id, req.companyId);
  if (!app) return res.status(404).json({ error: 'Not found' });

  const args = [req.params.id, req.companyId];

  // ── Where this app is bound ──
  const department = app.department_id
    ? db.prepare('SELECT id, name, color FROM departments WHERE id = ? AND company_id = ?')
        .get(app.department_id, req.companyId) || null
    : null;
  const site = app.site_id
    ? db.prepare('SELECT id, name, code FROM sites WHERE id = ? AND company_id = ?')
        .get(app.site_id, req.companyId) || null
    : null;
  const defaultStation = app.station_id
    ? db.prepare('SELECT id, name, location, status FROM stations WHERE id = ? AND company_id = ?')
        .get(app.station_id, req.companyId) || null
    : null;

  // Stations currently running this app (stations.current_app_id), plus the
  // app's own default station so the page shows the full picture.
  const assignedStations = db.prepare(`
    SELECT id, name, location, status FROM stations
    WHERE company_id = ? AND current_app_id = ? ORDER BY name LIMIT 50
  `).all(req.companyId, req.params.id);
  const stations = [...assignedStations];
  if (defaultStation && !stations.some(s => s.id === defaultStation.id)) stations.unshift(defaultStation);

  const productTypes = db.prepare(`
    SELECT id, name, description FROM product_types
    WHERE app_id = ? AND company_id = ? ORDER BY name LIMIT 100
  `).all(...args);

  const routings = db.prepare(`
    SELECT r.id AS routing_id, r.name AS routing_name, rs.name AS step_name, rs.step_number
    FROM routing_steps rs JOIN product_routings r ON r.id = rs.routing_id
    WHERE rs.app_id = ? AND rs.company_id = ? ORDER BY r.name, rs.step_number LIMIT 50
  `).all(...args);

  const workOrders = db.prepare(`
    SELECT id, work_order_number, part_number, part_name, status, quantity, quantity_completed
    FROM work_orders WHERE app_id = ? AND company_id = ?
    ORDER BY CASE status WHEN 'in_progress' THEN 0 WHEN 'overdue' THEN 1 WHEN 'pending' THEN 2 ELSE 3 END,
             created_at DESC
    LIMIT 10
  `).all(...args);
  const workOrderCount = db.prepare('SELECT COUNT(*) AS c FROM work_orders WHERE app_id = ? AND company_id = ?')
    .get(...args).c;

  // ── Run stats: lifetime counters plus a 30-day window ──
  const lifetime = db.prepare(`
    SELECT COUNT(*) AS runs,
           SUM(CASE WHEN c.status = 'completed' THEN 1 ELSE 0 END) AS completed,
           SUM(CASE WHEN c.status = 'abandoned' THEN 1 ELSE 0 END) AS abandoned,
           SUM(CASE WHEN c.status = 'in_progress' THEN 1 ELSE 0 END) AS in_progress,
           MAX(c.started_at) AS last_run_at,
           MIN(c.started_at) AS first_run_at,
           ${AVG_DURATION_S} AS avg_duration_s,
           ${AVG_BASIS}      AS avg_duration_basis
    FROM completions c WHERE c.app_id = ? AND c.company_id = ?
  `).get(...args);

  const win = db.prepare(`
    SELECT COUNT(*) AS runs,
           SUM(CASE WHEN c.status = 'completed' THEN 1 ELSE 0 END) AS completed,
           ${AVG_DURATION_S} AS avg_duration_s
    FROM completions c
    WHERE c.app_id = ? AND c.company_id = ? AND c.started_at >= datetime('now', '-30 days')
  `).get(...args);

  const runs7d = db.prepare(`
    SELECT COUNT(*) AS c FROM completions
    WHERE app_id = ? AND company_id = ? AND started_at >= datetime('now', '-7 days')
  `).get(...args).c;

  // First-pass yield over all time: of the runs that recorded any pass/fail
  // check, the share with no failures. Null when the app captures none.
  const fpy = db.prepare(`
    SELECT COUNT(*) AS total, SUM(CASE WHEN has_fail = 0 THEN 1 ELSE 0 END) AS passed
    FROM (
      SELECT c.id, MAX(CASE WHEN v.value_text = 'fail' THEN 1 ELSE 0 END) AS has_fail
      FROM completions c
      JOIN completion_values v ON v.completion_id = c.id AND v.value_type = 'pass_fail'
      WHERE c.app_id = ? AND c.company_id = ?
      GROUP BY c.id
    )
  `).get(...args);

  // Who has actually worked this app. Grouping on completions.operator_name
  // alone credits only whoever STARTED each run, so an operator who picked up a
  // half-finished job never appeared here at all — and knowing that more than
  // one person was on a job is the whole point of tracking handoffs. Sessions
  // are unioned in, and `joined_runs` says how many of a person's runs they
  // came into rather than started, so the two are still distinguishable.
  const operators = db.prepare(`
    WITH worked AS (
      SELECT c.id AS completion_id, c.operator_name, 1 AS started
      FROM completions c
      WHERE c.app_id = ? AND c.company_id = ? AND COALESCE(c.operator_name, '') != ''
      UNION
      SELECT c.id AS completion_id, s.operator_name, 0 AS started
      FROM completion_sessions s
      JOIN completions c ON c.id = s.completion_id
      WHERE c.app_id = ? AND c.company_id = ? AND s.company_id = c.company_id
        AND COALESCE(s.operator_name, '') != ''
        AND s.operator_name != COALESCE(c.operator_name, '')
    )
    SELECT w.operator_name,
           COUNT(DISTINCT w.completion_id) AS runs,
           SUM(CASE WHEN c.status = 'completed' AND w.started = 1 THEN 1 ELSE 0 END) AS completed,
           SUM(CASE WHEN w.started = 0 THEN 1 ELSE 0 END) AS joined_runs,
           MAX(c.started_at) AS last_run_at,
           ${AVG_DURATION_S} AS avg_duration_s
    FROM worked w
    JOIN completions c ON c.id = w.completion_id
    GROUP BY w.operator_name ORDER BY runs DESC, w.operator_name LIMIT 25
  `).all(...args, ...args).map(o => ({ ...o, avg_duration_s: roundSeconds(o.avg_duration_s) }));

  const recentRuns = db.prepare(`
    SELECT c.id, c.started_at, c.completed_at, c.status, c.operator_name,
           ${DURATION_S}                 AS duration_s,
           ${runBasisSQL('c')}           AS duration_basis,
           ${handsOnSecondsSQL('c')}     AS hands_on_seconds,
           ${elapsedSecondsSQL('c')}     AS elapsed_seconds,
           ${elapsedSoFarSecondsSQL('c')} AS elapsed_so_far_seconds,
           wo.work_order_number, pt.name AS product_type_name, st.name AS station_name
    FROM completions c
    LEFT JOIN work_orders wo ON wo.id = c.work_order_id
    LEFT JOIN product_types pt ON pt.id = c.product_type_id
    LEFT JOIN stations st ON st.id = c.station_id
    WHERE c.app_id = ? AND c.company_id = ?
    ORDER BY c.started_at DESC LIMIT 10
  `).all(...args);

  res.json({
    app: {
      ...app,
      steps: JSON.parse(app.steps || '[]'),
      variables: JSON.parse(app.variables || '[]'),
      step_groups: JSON.parse(app.step_groups || '[]'),
    },
    bindings: {
      department,
      site,
      default_station: defaultStation,
      stations,
      product_types: productTypes,
      routings,
      work_orders: workOrders,
      work_order_count: workOrderCount,
    },
    stats: {
      runs_total: lifetime.runs || 0,
      completed: lifetime.completed || 0,
      abandoned: lifetime.abandoned || 0,
      in_progress: lifetime.in_progress || 0,
      runs_7d: runs7d || 0,
      runs_30d: win.runs || 0,
      completed_30d: win.completed || 0,
      // Rounded once, here, on the way out — and null, never 0, when no run in
      // scope carries a measurement.
      avg_duration_s: roundSeconds(lifetime.avg_duration_s),
      /** 'hands_on' | 'elapsed' | 'mixed' | null — the label the tile must carry. */
      avg_duration_basis: lifetime.avg_duration_basis ?? null,
      avg_duration_30d_s: roundSeconds(win.avg_duration_s),
      first_run_at: lifetime.first_run_at || null,
      last_run_at: lifetime.last_run_at || null,
      first_pass_yield: fpy.total > 0 ? Math.round(((fpy.passed || 0) / fpy.total) * 1000) / 10 : null,
      operator_count: operators.length,
    },
    operators,
    recent_runs: recentRuns.map(shapeRunRow),
  });
});

router.put('/:id', (req, res) => {
  const { name, description, steps, variables, status, department_id, site_id, station_id, show_takt_warnings, step_groups, schema_version, require_run_context } = req.body;
  const app = db.prepare('SELECT * FROM apps WHERE id = ? AND company_id = ?').get(req.params.id, req.companyId);
  if (!app) return res.status(404).json({ error: 'Not found' });

  if (name !== undefined && name !== app.name) {
    const dup = db.prepare('SELECT id FROM apps WHERE company_id = ? AND LOWER(name) = LOWER(?) AND id != ?').get(req.companyId, name, req.params.id);
    if (dup) return res.status(409).json({ error: 'duplicate_name', message: `An app named "${name}" already exists` });
  }

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
    require_run_context: require_run_context !== undefined ? (require_run_context ? 1 : 0) : app.require_run_context,
    step_groups: step_groups !== undefined ? JSON.stringify(step_groups) : (app.step_groups ?? '[]'),
    schema_version: schema_version !== undefined ? schema_version : (app.schema_version ?? 1),
  };

  db.prepare(`UPDATE apps SET name=?, description=?, steps=?, variables=?, status=?, department_id=?, site_id=?, station_id=?, show_takt_warnings=?, require_run_context=?, step_groups=?, schema_version=?, updated_at=datetime('now') WHERE id=?`)
    .run(updates.name, updates.description, updates.steps, updates.variables, updates.status, updates.department_id, updates.site_id, updates.station_id, updates.show_takt_warnings, updates.require_run_context ?? null, updates.step_groups, updates.schema_version, req.params.id);

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

// ─── App analytics + per-app CSV export ──────────────────────────────────────
// Read-only aggregates over completions + completion_values for one app,
// powering the /apps/:id/analytics dashboard and its CSV download. All SQL is
// tenant-scoped (app ownership checked first → cross-tenant requests 404).

// How long a run took is decided in backend/src/cycleTime.js and nowhere else.
// These are that module's expressions under the names this file already used.
//
// `AVG_DURATION_S` used to average raw wall clock with no honesty guard, so an
// app whose runs are all sub-second averaged to a fraction and printed "0s" on
// App Detail, App Analytics and the Apps Dashboard — right beside the honest
// form of the same gap ("— First-pass yield · no pass/fail check recorded") —
// while App History, reading the same runs through a stricter rule, said the
// app had never been timed at all. One definition now feeds all four.
const DURATION_S     = runSecondsSQL('c');
const AVG_DURATION_S = avgRunSecondsSQL('c');
const AVG_BASIS      = avgRunBasisSQL('c');

/**
 * One run's row as every "recent runs" table receives it. `duration_s` is the
 * canonical run duration and `duration_basis` names the measurement behind it,
 * so the table can label the column instead of leaving a customer to work out
 * why the same run reads differently elsewhere. A run still open has no
 * duration at all — only an elapsed-so-far, which is kept in its own field.
 */
function shapeRunRow(r) {
  return {
    ...r,
    duration_s: roundSeconds(r.duration_s),
    duration_basis: r.duration_basis ?? null,
    hands_on_seconds: roundSeconds(r.hands_on_seconds),
    elapsed_seconds: roundSeconds(r.elapsed_seconds),
    elapsed_so_far_seconds: roundSeconds(r.elapsed_so_far_seconds),
  };
}

// Shared filter builder for both endpoints: ?days= (clamped 1..365, default 30),
// ?operator=, ?work_order_id=, ?product_type_id=. Returns a WHERE fragment over
// alias `c` (completions) plus its bind params.
function buildCompletionFilters(req) {
  const days = Math.min(Math.max(parseInt(req.query.days, 10) || 30, 1), 365);
  const conds = ['c.app_id = ?', 'c.company_id = ?', `c.started_at >= datetime('now', ?)`];
  const params = [req.params.id, req.companyId, `-${days} days`];
  if (req.query.operator)        { conds.push('c.operator_name = ?');   params.push(req.query.operator); }
  if (req.query.work_order_id)   { conds.push('c.work_order_id = ?');   params.push(req.query.work_order_id); }
  if (req.query.product_type_id) { conds.push('c.product_type_id = ?'); params.push(req.query.product_type_id); }
  return { days, where: conds.join(' AND '), params };
}

// Capture-widget metadata from the app's steps blob: widget_id → { label, type,
// step_name, order } for every widget type the player stores values for.
const CAPTURE_WIDGET_TYPES = new Set([
  'text-input', 'number-input', 'select-input', 'checkbox', 'pass-fail',
  'signature', 'scan-input', 'photo-capture', 'counter', 'timer',
]);

function captureWidgetMap(app) {
  const map = new Map();
  let order = 0;
  let steps = [];
  try { steps = JSON.parse(app.steps || '[]'); } catch { steps = []; }
  for (const step of Array.isArray(steps) ? steps : []) {
    for (const w of Array.isArray(step?.widgets) ? step.widgets : []) {
      if (!w || !w.id || !CAPTURE_WIDGET_TYPES.has(w.type)) continue;
      map.set(String(w.id), {
        label: (w.label || w.config?.label || w.config?.variableName || '').trim() || String(w.id),
        type: w.type,
        step_name: step.name || '',
        order: order++,
      });
    }
  }
  return map;
}

// value_type → analytics kind
function kindOf(valueType) {
  if (valueType === 'number' || valueType === 'timer') return 'number';
  if (valueType === 'boolean' || valueType === 'pass_fail') return 'boolean';
  if (valueType === 'select') return 'option';
  return 'text';
}

router.get('/:id/analytics', (req, res) => {
  const app = db.prepare('SELECT id, name, steps FROM apps WHERE id = ? AND company_id = ?')
    .get(req.params.id, req.companyId);
  if (!app) return res.status(404).json({ error: 'Not found' });

  const { days, where, params } = buildCompletionFilters(req);

  // ── Totals ──
  const totalsRow = db.prepare(`
    SELECT COUNT(*) AS runs,
           SUM(CASE WHEN c.status = 'completed' THEN 1 ELSE 0 END) AS completed,
           SUM(CASE WHEN c.status = 'abandoned' THEN 1 ELSE 0 END) AS abandoned,
           ${AVG_DURATION_S} AS avg_duration_s,
           ${AVG_BASIS}      AS avg_duration_basis,
           AVG(${handsOnSecondsSQL('c')}) AS avg_hands_on_seconds,
           AVG(${elapsedSecondsSQL('c')}) AS avg_elapsed_seconds
    FROM completions c WHERE ${where}
  `).get(...params);

  // First-pass yield: among filtered runs that recorded at least one pass/fail
  // check, the share whose checks all passed. Null when no pass/fail data.
  const fpy = db.prepare(`
    SELECT COUNT(*) AS total, SUM(CASE WHEN has_fail = 0 THEN 1 ELSE 0 END) AS passed
    FROM (
      SELECT c.id, MAX(CASE WHEN v.value_text = 'fail' THEN 1 ELSE 0 END) AS has_fail
      FROM completions c
      JOIN completion_values v ON v.completion_id = c.id AND v.value_type = 'pass_fail'
      WHERE ${where}
      GROUP BY c.id
    )
  `).get(...params);

  // ── Daily series ──
  const series = db.prepare(`
    SELECT date(c.started_at) AS date,
           SUM(CASE WHEN c.status = 'completed' THEN 1 ELSE 0 END) AS completed,
           ${AVG_DURATION_S} AS avg_duration_s
    FROM completions c WHERE ${where}
    GROUP BY date(c.started_at) ORDER BY date ASC LIMIT 366
  `).all(...params).map(r => ({ ...r, avg_duration_s: roundSeconds(r.avg_duration_s) }));

  // ── Per-operator ──
  const byOperator = db.prepare(`
    SELECT c.operator_name, COUNT(*) AS runs, ${AVG_DURATION_S} AS avg_duration_s
    FROM completions c WHERE ${where}
    GROUP BY c.operator_name ORDER BY runs DESC LIMIT 50
  `).all(...params).map(o => ({ ...o, avg_duration_s: roundSeconds(o.avg_duration_s) }));

  // ── Per-field stats over completion_values ──
  // Completed runs only. An abandoned or in-progress run may have captured a
  // value or two before it stopped; folding those into the per-field average
  // and count made the field stats (e.g. count=11) disagree with totals.completed
  // (=10) and avg_duration_s on the same payload, which only count finished runs.
  const vJoin = `FROM completion_values v JOIN completions c ON c.id = v.completion_id WHERE ${where} AND c.status = 'completed'`;

  const numberRows = db.prepare(`
    SELECT v.widget_id, v.value_type, COUNT(v.value_number) AS count,
           ROUND(AVG(v.value_number), 3) AS avg,
           MIN(v.value_number) AS min, MAX(v.value_number) AS max
    ${vJoin} AND v.value_type IN ('number', 'timer') AND v.value_number IS NOT NULL
    GROUP BY v.widget_id LIMIT 100
  `).all(...params);

  const numberTrends = db.prepare(`
    SELECT v.widget_id, date(c.started_at) AS date, ROUND(AVG(v.value_number), 3) AS avg
    ${vJoin} AND v.value_type IN ('number', 'timer') AND v.value_number IS NOT NULL
    GROUP BY v.widget_id, date(c.started_at) ORDER BY date ASC LIMIT 5000
  `).all(...params);

  const boolRows = db.prepare(`
    SELECT v.widget_id, v.value_type,
           SUM(CASE WHEN v.value_text = 'pass' OR v.value_number = 1 THEN 1 ELSE 0 END) AS pass,
           SUM(CASE WHEN v.value_text = 'fail' OR v.value_number = 0 THEN 1 ELSE 0 END) AS fail
    ${vJoin} AND v.value_type IN ('pass_fail', 'boolean')
    GROUP BY v.widget_id LIMIT 100
  `).all(...params);

  const optionRows = db.prepare(`
    SELECT v.widget_id, v.value_text AS value, COUNT(*) AS count
    ${vJoin} AND v.value_type = 'select' AND v.value_text IS NOT NULL
    GROUP BY v.widget_id, v.value_text ORDER BY count DESC LIMIT 500
  `).all(...params);

  const textRows = db.prepare(`
    SELECT v.widget_id, v.value_type, COUNT(*) AS count
    ${vJoin} AND v.value_type IN ('text', 'photo', 'signature', 'scan')
    GROUP BY v.widget_id LIMIT 100
  `).all(...params);

  const widgetMeta = captureWidgetMap(app);
  const meta = (id, fallbackType) => widgetMeta.get(id)
    || { label: id, type: fallbackType, step_name: '', order: Number.MAX_SAFE_INTEGER };

  const fields = [];
  const trendByWidget = new Map();
  for (const t of numberTrends) {
    if (!trendByWidget.has(t.widget_id)) trendByWidget.set(t.widget_id, []);
    trendByWidget.get(t.widget_id).push({ date: t.date, avg: t.avg });
  }
  for (const r of numberRows) {
    const m = meta(r.widget_id, r.value_type);
    fields.push({
      widget_id: r.widget_id, label: m.label, type: m.type, step_name: m.step_name, kind: 'number',
      _order: m.order,
      stats: { avg: r.avg, min: r.min, max: r.max, count: r.count },
      trend: trendByWidget.get(r.widget_id) || [],
    });
  }
  for (const r of boolRows) {
    const m = meta(r.widget_id, r.value_type);
    const total = r.pass + r.fail;
    fields.push({
      widget_id: r.widget_id, label: m.label, type: m.type, step_name: m.step_name, kind: 'boolean',
      _order: m.order,
      stats: { pass: r.pass, fail: r.fail, yield_pct: total > 0 ? Math.round((r.pass / total) * 1000) / 10 : null },
    });
  }
  const optionsByWidget = new Map();
  for (const r of optionRows) {
    if (!optionsByWidget.has(r.widget_id)) optionsByWidget.set(r.widget_id, []);
    optionsByWidget.get(r.widget_id).push({ value: r.value, count: r.count });
  }
  for (const [widgetId, options] of optionsByWidget) {
    const m = meta(widgetId, 'select');
    fields.push({
      widget_id: widgetId, label: m.label, type: m.type, step_name: m.step_name, kind: 'option',
      _order: m.order,
      stats: { options, count: options.reduce((s, o) => s + o.count, 0) },
    });
  }
  for (const r of textRows) {
    const m = meta(r.widget_id, r.value_type);
    fields.push({
      widget_id: r.widget_id, label: m.label, type: m.type, step_name: m.step_name, kind: 'text',
      _order: m.order,
      stats: { count: r.count },
    });
  }
  fields.sort((a, b) => a._order - b._order || a.widget_id.localeCompare(b.widget_id));
  for (const f of fields) delete f._order;

  // ── Filter options (all-time for this app, so selects stay stable) ──
  const filterOptions = {
    operators: db.prepare(`
      SELECT DISTINCT operator_name FROM completions
      WHERE app_id = ? AND company_id = ? AND operator_name IS NOT NULL AND operator_name != ''
      ORDER BY operator_name LIMIT 100
    `).all(req.params.id, req.companyId).map(r => r.operator_name),
    work_orders: db.prepare(`
      SELECT DISTINCT wo.id, wo.work_order_number
      FROM completions c JOIN work_orders wo ON wo.id = c.work_order_id
      WHERE c.app_id = ? AND c.company_id = ? ORDER BY wo.work_order_number LIMIT 200
    `).all(req.params.id, req.companyId),
    product_types: db.prepare(`
      SELECT DISTINCT pt.id, pt.name
      FROM completions c JOIN product_types pt ON pt.id = c.product_type_id
      WHERE c.app_id = ? AND c.company_id = ? ORDER BY pt.name LIMIT 200
    `).all(req.params.id, req.companyId),
  };

  // ── Recent runs (for the dashboard's table) ──
  const recent = db.prepare(`
    SELECT c.id, c.started_at, c.completed_at, c.status, c.operator_name,
           ${DURATION_S}                 AS duration_s,
           ${runBasisSQL('c')}           AS duration_basis,
           ${handsOnSecondsSQL('c')}     AS hands_on_seconds,
           ${elapsedSecondsSQL('c')}     AS elapsed_seconds,
           ${elapsedSoFarSecondsSQL('c')} AS elapsed_so_far_seconds,
           wo.work_order_number, pt.name AS product_type_name
    FROM completions c
    LEFT JOIN work_orders wo ON wo.id = c.work_order_id
    LEFT JOIN product_types pt ON pt.id = c.product_type_id
    WHERE ${where} ORDER BY c.started_at DESC LIMIT 25
  `).all(...params);

  res.json({
    app_id: app.id,
    app_name: app.name,
    days,
    totals: {
      runs: totalsRow.runs || 0,
      completed: totalsRow.completed || 0,
      abandoned: totalsRow.abandoned || 0,
      avg_duration_s: roundSeconds(totalsRow.avg_duration_s),
      /** 'hands_on' | 'elapsed' | 'mixed' | null — the label the tile must carry. */
      avg_duration_basis: totalsRow.avg_duration_basis ?? null,
      /** Both measurements, so the tile can name the gap instead of hiding it. */
      avg_hands_on_seconds: roundSeconds(totalsRow.avg_hands_on_seconds),
      avg_elapsed_seconds: roundSeconds(totalsRow.avg_elapsed_seconds),
      first_pass_yield: fpy.total > 0 ? Math.round(((fpy.passed || 0) / fpy.total) * 1000) / 10 : null,
    },
    series,
    by_operator: byOperator,
    fields,
    filter_options: filterOptions,
    recent_runs: recent.map(shapeRunRow),
  });
});

// ─── GET /:id/export.csv — flattened per-run CSV with one column per widget ───

const { escapeCSV } = require('../csv');

// The CSV row query and the value query MUST agree on how many runs they cover,
// or the export ships rows with silently blank widget columns.
const EXPORT_ROW_LIMIT = 10000;

router.get('/:id/export.csv', (req, res) => {
  const app = db.prepare('SELECT id, name, steps FROM apps WHERE id = ? AND company_id = ?')
    .get(req.params.id, req.companyId);
  if (!app) return res.status(404).json({ error: 'Not found' });

  const { where, params } = buildCompletionFilters(req);

  const rows = db.prepare(`
    SELECT c.id, c.started_at, c.completed_at, c.status, c.operator_name,
           ${DURATION_S} AS duration_s,
           wo.work_order_number, pt.name AS product_type_name
    FROM completions c
    LEFT JOIN work_orders wo ON wo.id = c.work_order_id
    LEFT JOIN product_types pt ON pt.id = c.product_type_id
    WHERE ${where} ORDER BY c.started_at DESC LIMIT ${EXPORT_ROW_LIMIT}
  `).all(...params);

  // Values are scoped to EXACTLY the completions the rows above selected.
  // (The previous independent `LIMIT 200000` silently dropped an arbitrary,
  // unordered subset once an app accumulated enough captured fields, leaving
  // exported rows with blank widget columns.)
  const values = db.prepare(`
    SELECT v.completion_id, v.widget_id, v.variable_name, v.value_type, v.value_text, v.value_number
    FROM completion_values v
    WHERE v.completion_id IN (
      SELECT c.id FROM completions c
      WHERE ${where} ORDER BY c.started_at DESC LIMIT ${EXPORT_ROW_LIMIT}
    )
  `).all(...params);

  // Widget columns: blob order first, then any captured widget no longer in the
  // blob (deleted since) appended so its data still exports.
  const widgetMeta = captureWidgetMap(app);
  const columnIds = [...widgetMeta.keys()];
  const extraIds = new Set();
  for (const v of values) if (!widgetMeta.has(v.widget_id)) extraIds.add(v.widget_id);
  for (const id of extraIds) columnIds.push(id);

  // Unique human header per widget column (duplicate labels get a numeric suffix).
  const usedHeaders = new Set(['id', 'started', 'completed', 'duration_s', 'operator', 'work_order', 'product_type', 'status']);
  const headerFor = new Map();
  for (const id of columnIds) {
    const base = widgetMeta.get(id)?.label
      || values.find(v => v.widget_id === id && v.variable_name)?.variable_name
      || id;
    let header = base, n = 2;
    while (usedHeaders.has(header)) header = `${base} (${n++})`;
    usedHeaders.add(header);
    headerFor.set(id, header);
  }

  // Pivot values: completion_id → widget_id → display value.
  const byCompletion = new Map();
  for (const v of values) {
    if (!byCompletion.has(v.completion_id)) byCompletion.set(v.completion_id, new Map());
    let display;
    if (v.value_type === 'boolean') display = v.value_number === 1 ? 'true' : 'false';
    else if (v.value_text !== null && v.value_text !== undefined) display = v.value_text;
    else display = v.value_number;
    byCompletion.get(v.completion_id).set(v.widget_id, display);
  }

  const fixedCols = ['id', 'started', 'completed', 'duration_s', 'operator', 'work_order', 'product_type', 'status'];
  const header = [...fixedCols, ...columnIds.map(id => headerFor.get(id))].map(escapeCSV).join(',');
  const lines = rows.map(r => {
    const vals = byCompletion.get(r.id) || new Map();
    // An export cell for a run nobody timed stays empty; a 0 there would be
    // read as a measurement by every spreadsheet that opens it.
    const fixed = [r.id, r.started_at, r.completed_at, roundSeconds(r.duration_s) ?? '',
                   r.operator_name, r.work_order_number, r.product_type_name, r.status];
    return [...fixed, ...columnIds.map(id => vals.get(id))].map(escapeCSV).join(',');
  });
  const csv = [header, ...lines].join('\n') + '\n';

  const safeName = app.name.replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '').toLowerCase() || 'app';
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${safeName}-analytics-${new Date().toISOString().slice(0, 10)}.csv"`);
  res.send('﻿' + csv); // BOM for Excel UTF-8 compatibility
});

router.get('/:id/completions', (req, res) => {
  const completions = db.prepare('SELECT * FROM completions WHERE app_id = ? AND company_id = ? ORDER BY started_at DESC LIMIT 100')
    .all(req.params.id, req.companyId);
  res.json(completions.map(c => ({ ...c, data: JSON.parse(c.data), step_times: JSON.parse(c.step_times) })));
});

module.exports = router;
module.exports.MODEL_TEMPLATES = MODEL_TEMPLATES;

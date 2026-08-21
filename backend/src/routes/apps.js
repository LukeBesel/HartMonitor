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

// ─── App analytics + per-app CSV export ──────────────────────────────────────
// Read-only aggregates over completions + completion_values for one app,
// powering the /apps/:id/analytics dashboard and its CSV download. All SQL is
// tenant-scoped (app ownership checked first → cross-tenant requests 404).

const DURATION_S = `(julianday(c.completed_at) - julianday(c.started_at)) * 86400`;
const AVG_DURATION_S = `ROUND(AVG(CASE WHEN c.status = 'completed' AND c.completed_at IS NOT NULL THEN ${DURATION_S} END), 1)`;

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
           ${AVG_DURATION_S} AS avg_duration_s
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
  `).all(...params);

  // ── Per-operator ──
  const byOperator = db.prepare(`
    SELECT c.operator_name, COUNT(*) AS runs, ${AVG_DURATION_S} AS avg_duration_s
    FROM completions c WHERE ${where}
    GROUP BY c.operator_name ORDER BY runs DESC LIMIT 50
  `).all(...params);

  // ── Per-field stats over completion_values ──
  const vJoin = `FROM completion_values v JOIN completions c ON c.id = v.completion_id WHERE ${where}`;

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
           CASE WHEN c.completed_at IS NOT NULL THEN CAST(ROUND(${DURATION_S}) AS INTEGER) END AS duration_s,
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
      avg_duration_s: totalsRow.avg_duration_s ?? null,
      first_pass_yield: fpy.total > 0 ? Math.round(((fpy.passed || 0) / fpy.total) * 1000) / 10 : null,
    },
    series,
    by_operator: byOperator,
    fields,
    filter_options: filterOptions,
    recent_runs: recent,
  });
});

// ─── GET /:id/export.csv — flattened per-run CSV with one column per widget ───

// Same escaping conventions as backend/src/routes/export.js.
function escapeCSV(val) {
  if (val === null || val === undefined) return '';
  const s = String(val);
  if (s.includes(',') || s.includes('"') || s.includes('\n')) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

router.get('/:id/export.csv', (req, res) => {
  const app = db.prepare('SELECT id, name, steps FROM apps WHERE id = ? AND company_id = ?')
    .get(req.params.id, req.companyId);
  if (!app) return res.status(404).json({ error: 'Not found' });

  const { where, params } = buildCompletionFilters(req);

  const rows = db.prepare(`
    SELECT c.id, c.started_at, c.completed_at, c.status, c.operator_name,
           CASE WHEN c.completed_at IS NOT NULL THEN CAST(ROUND(${DURATION_S}) AS INTEGER) END AS duration_s,
           wo.work_order_number, pt.name AS product_type_name
    FROM completions c
    LEFT JOIN work_orders wo ON wo.id = c.work_order_id
    LEFT JOIN product_types pt ON pt.id = c.product_type_id
    WHERE ${where} ORDER BY c.started_at DESC LIMIT 10000
  `).all(...params);

  const values = db.prepare(`
    SELECT v.completion_id, v.widget_id, v.variable_name, v.value_type, v.value_text, v.value_number
    FROM completion_values v JOIN completions c ON c.id = v.completion_id
    WHERE ${where} LIMIT 200000
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
    const fixed = [r.id, r.started_at, r.completed_at, r.duration_s, r.operator_name, r.work_order_number, r.product_type_name, r.status];
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

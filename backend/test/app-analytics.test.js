// ─── App analytics + per-app CSV export tests ─────────────────────────────────
// Spawns the real server against a throwaway database and exercises:
//   • GET /api/apps/:id/analytics — totals / series / by_operator / per-field
//     stats (number, pass_fail, select, text kinds) computed in SQL over
//     completions + completion_values,
//   • filter params (operator, work_order_id, product_type_id, days clamp),
//   • GET /api/apps/:id/export.csv — one row per run, one column per captured
//     widget, CSV escaping of commas/quotes in labels,
//   • tenant isolation (company B gets 404 on both endpoints).
// Run with: npm test — uses only Node built-ins (node:test + global fetch).

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const PORT = 3190; // unique per test file
const BASE = `http://localhost:${PORT}`;
const DB_PATH = path.join(os.tmpdir(), `mes-app-analytics-test-${Date.now()}.db`);

let server;

function startServer() {
  return new Promise((resolve, reject) => {
    server = spawn('node', [path.join(__dirname, '..', 'src', 'index.js')], {
      env: {
        ...process.env,
        NODE_ENV: 'test',
        PORT: String(PORT),
        DATABASE_PATH: DB_PATH,
        SEED_DEMO_DATA: 'false',
        EARLY_ACCESS: 'false',
        BACKUP_DIR: '',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    server.stderr.on('data', d => process.stderr.write(`[server] ${d}`));
    const deadline = Date.now() + 15000;
    (async function poll() {
      try {
        const r = await fetch(`${BASE}/api/health`);
        if (r.ok) return resolve();
      } catch { /* not up yet */ }
      if (Date.now() > deadline) return reject(new Error('server did not start in time'));
      setTimeout(poll, 200);
    })();
  });
}

async function api(method, pathname, { token, body } = {}) {
  const res = await fetch(`${BASE}${pathname}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  let json = null;
  try { json = await res.json(); } catch { /* no body */ }
  return { status: res.status, json };
}

async function apiText(pathname, token) {
  const res = await fetch(`${BASE}${pathname}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  return { status: res.status, text: await res.text(), headers: res.headers };
}

let tokenA;   // Widget Co
let tokenB;   // Gadget Co
let appId;
let workOrderId;
let productTypeId;

// Widget ids in the fixture app. Labels deliberately contain a comma and quotes
// to exercise CSV escaping in the export header.
const W_NUM  = 'w-torque';
const W_PF   = 'w-visual';
const W_SEL  = 'w-defect';
const W_TXT  = 'w-notes';
const NUM_LABEL = 'Torque, Nm';
const PF_LABEL  = 'Visual "QC" Check';

function fixtureSteps() {
  return [{
    id: 'step-1', name: 'Inspect', order: 0,
    widgets: [
      { id: W_NUM, type: 'number-input', order: 0, label: NUM_LABEL, config: { variableName: 'torque' } },
      { id: W_PF,  type: 'pass-fail',    order: 1, label: PF_LABEL,  config: { variableName: 'visual_ok' } },
      { id: W_SEL, type: 'select-input', order: 2, label: 'Defect Type', config: { variableName: 'defect' } },
      { id: W_TXT, type: 'text-input',   order: 3, label: 'Notes', config: { variableName: 'notes' } },
    ],
  }];
}

// One run: start → flush values → complete (or abandon).
async function run({ operator, torque, visual, defect, notes, status = 'completed', work_order_id, product_type_id }) {
  const start = await api('POST', '/api/completions', {
    token: tokenA,
    body: { app_id: appId, operator_name: operator, work_order_id, product_type_id },
  });
  assert.equal(start.status, 201);
  const values = [];
  if (torque !== undefined) values.push({ step_id: 'step-1', widget_id: W_NUM, variable_name: 'torque', value_type: 'number', value_number: torque });
  if (visual !== undefined) values.push({ step_id: 'step-1', widget_id: W_PF, variable_name: 'visual_ok', value_type: 'pass_fail', value_text: visual });
  if (defect !== undefined) values.push({ step_id: 'step-1', widget_id: W_SEL, variable_name: 'defect', value_type: 'select', value_text: defect });
  if (notes !== undefined) values.push({ step_id: 'step-1', widget_id: W_TXT, variable_name: 'notes', value_type: 'text', value_text: notes });
  const put = await api('PUT', `/api/completions/${start.json.id}`, {
    token: tokenA, body: { status, values },
  });
  assert.equal(put.status, 200);
  return start.json.id;
}

before(async () => {
  await startServer();

  const a = await api('POST', '/api/auth/signup', {
    body: { company_name: 'Widget Co', email: 'owner@widget-aa.test', password: 'supersecret1', display_name: 'Widget Owner' },
  });
  assert.equal(a.status, 201);
  tokenA = a.json.token;

  const b = await api('POST', '/api/auth/signup', {
    body: { company_name: 'Gadget Co', email: 'owner@gadget-aa.test', password: 'supersecret1', display_name: 'Gadget Owner' },
  });
  assert.equal(b.status, 201);
  tokenB = b.json.token;

  const app = await api('POST', '/api/apps', { token: tokenA, body: { name: 'Final Inspection' } });
  assert.equal(app.status, 201);
  appId = app.json.id;
  assert.equal((await api('PUT', `/api/apps/${appId}`, { token: tokenA, body: { steps: fixtureSteps() } })).status, 200);

  const pt = await api('POST', '/api/product-types', { token: tokenA, body: { app_id: appId, name: 'Blue Variant' } });
  assert.equal(pt.status, 201);
  productTypeId = pt.json.id;

  const wo = await api('POST', '/api/work-orders', {
    token: tokenA,
    body: { part_number: 'FI-1', part_name: 'Inspected Part', quantity: 10, app_id: appId },
  });
  assert.equal(wo.status, 201);
  workOrderId = wo.json.id;

  // Seed: 2 operators × several runs with values.
  // Alice: 3 completed — torque 5/7/9, visual pass/pass/fail, defects Scratch/Scratch/Dent
  await run({ operator: 'Alice', torque: 5, visual: 'pass', defect: 'Scratch', notes: 'first unit' });
  await run({ operator: 'Alice', torque: 7, visual: 'pass', defect: 'Scratch', work_order_id: workOrderId });
  await run({ operator: 'Alice', torque: 9, visual: 'fail', defect: 'Dent', notes: 'burr, see photo "A"', product_type_id: productTypeId });
  // Bob: 1 completed (torque 7, pass), 1 abandoned (no values flushed)
  await run({ operator: 'Bob', torque: 7, visual: 'pass' });
  await run({ operator: 'Bob', status: 'abandoned' });
});

after(() => {
  if (server) server.kill('SIGTERM');
  for (const ext of ['', '-shm', '-wal']) { try { fs.unlinkSync(DB_PATH + ext); } catch { /* ignore */ } }
});

// ─── Analytics aggregates ─────────────────────────────────────────────────────

test('GET /api/apps/:id/analytics returns correct totals, series and by_operator', async () => {
  const r = await api('GET', `/api/apps/${appId}/analytics?days=30`, { token: tokenA });
  assert.equal(r.status, 200);
  assert.equal(r.json.app_name, 'Final Inspection');
  assert.equal(r.json.days, 30);

  assert.equal(r.json.totals.runs, 5);
  assert.equal(r.json.totals.completed, 4);
  assert.equal(r.json.totals.abandoned, 1);
  assert.equal(typeof r.json.totals.avg_duration_s, 'number', 'avg duration computed over completed runs');
  // 4 runs recorded a pass/fail check; 3 had no fail → 75%
  assert.equal(r.json.totals.first_pass_yield, 75);

  // All runs happened "now" → a single daily bucket with 4 completed.
  assert.equal(r.json.series.length, 1);
  assert.equal(r.json.series[0].completed, 4);
  assert.ok(r.json.series[0].date, 'series rows carry a date');

  const alice = r.json.by_operator.find(o => o.operator_name === 'Alice');
  const bob = r.json.by_operator.find(o => o.operator_name === 'Bob');
  assert.equal(alice.runs, 3);
  assert.equal(bob.runs, 2);
  assert.equal(r.json.by_operator[0].operator_name, 'Alice', 'sorted by runs desc');
});

test('per-field stats: number / boolean / option / text kinds', async () => {
  const r = await api('GET', `/api/apps/${appId}/analytics`, { token: tokenA });
  assert.equal(r.status, 200);
  const byWidget = Object.fromEntries(r.json.fields.map(f => [f.widget_id, f]));

  const num = byWidget[W_NUM];
  assert.equal(num.kind, 'number');
  assert.equal(num.label, NUM_LABEL);
  assert.equal(num.type, 'number-input');
  assert.equal(num.stats.count, 4);
  assert.equal(num.stats.avg, 7);       // (5+7+9+7)/4
  assert.equal(num.stats.min, 5);
  assert.equal(num.stats.max, 9);
  assert.ok(Array.isArray(num.trend) && num.trend.length === 1, 'numbers carry a daily trend');
  assert.equal(num.trend[0].avg, 7);

  const pf = byWidget[W_PF];
  assert.equal(pf.kind, 'boolean');
  assert.equal(pf.label, PF_LABEL);
  assert.equal(pf.stats.pass, 3);
  assert.equal(pf.stats.fail, 1);
  assert.equal(pf.stats.yield_pct, 75);

  const sel = byWidget[W_SEL];
  assert.equal(sel.kind, 'option');
  assert.equal(sel.stats.count, 3);
  const scratch = sel.stats.options.find(o => o.value === 'Scratch');
  const dent = sel.stats.options.find(o => o.value === 'Dent');
  assert.equal(scratch.count, 2);
  assert.equal(dent.count, 1);

  const txt = byWidget[W_TXT];
  assert.equal(txt.kind, 'text');
  assert.deepEqual(txt.stats, { count: 2 });

  // Fields come back in widget order from the steps blob.
  assert.deepEqual(r.json.fields.map(f => f.widget_id), [W_NUM, W_PF, W_SEL, W_TXT]);
});

test('filters: operator, work_order_id, product_type_id narrow the aggregates', async () => {
  const alice = await api('GET', `/api/apps/${appId}/analytics?operator=Alice`, { token: tokenA });
  assert.equal(alice.json.totals.runs, 3);
  assert.equal(alice.json.totals.abandoned, 0);
  assert.equal(alice.json.by_operator.length, 1);
  const aliceNum = alice.json.fields.find(f => f.widget_id === W_NUM);
  assert.equal(aliceNum.stats.count, 3);
  assert.equal(aliceNum.stats.avg, 7); // (5+7+9)/3

  const wo = await api('GET', `/api/apps/${appId}/analytics?work_order_id=${workOrderId}`, { token: tokenA });
  assert.equal(wo.json.totals.runs, 1);
  assert.equal(wo.json.fields.find(f => f.widget_id === W_NUM).stats.avg, 7);

  const pt = await api('GET', `/api/apps/${appId}/analytics?product_type_id=${productTypeId}`, { token: tokenA });
  assert.equal(pt.json.totals.runs, 1);
  assert.equal(pt.json.totals.first_pass_yield, 0, 'the product-type run failed its check');

  const nobody = await api('GET', `/api/apps/${appId}/analytics?operator=Nobody`, { token: tokenA });
  assert.equal(nobody.json.totals.runs, 0);
  assert.equal(nobody.json.totals.first_pass_yield, null);
  assert.deepEqual(nobody.json.fields, []);
});

test('days is clamped to 365 and filter_options are populated', async () => {
  const r = await api('GET', `/api/apps/${appId}/analytics?days=99999`, { token: tokenA });
  assert.equal(r.status, 200);
  assert.equal(r.json.days, 365);

  assert.deepEqual(r.json.filter_options.operators, ['Alice', 'Bob']);
  assert.equal(r.json.filter_options.work_orders.length, 1);
  assert.equal(r.json.filter_options.work_orders[0].id, workOrderId);
  assert.equal(r.json.filter_options.product_types.length, 1);
  assert.equal(r.json.filter_options.product_types[0].name, 'Blue Variant');

  assert.equal(r.json.recent_runs.length, 5);
  assert.ok(r.json.recent_runs[0].id, 'recent runs carry completion ids');
});

// ─── CSV export ───────────────────────────────────────────────────────────────

test('GET /api/apps/:id/export.csv returns one row per run with widget columns', async () => {
  const r = await apiText(`/api/apps/${appId}/export.csv`, tokenA);
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-type'), /text\/csv/);
  assert.match(r.headers.get('content-disposition'), /attachment; filename="final-inspection-analytics-.*\.csv"/);

  const body = r.text.replace(/^﻿/, '');
  const lines = body.trim().split('\n');
  assert.equal(lines.length, 1 + 5, 'header + 5 runs');

  // Header: fixed columns then widget labels — comma/quote labels escaped.
  assert.ok(lines[0].startsWith('id,started,completed,duration_s,operator,work_order,product_type,status,'));
  assert.ok(lines[0].includes('"Torque, Nm"'), 'comma label quoted');
  assert.ok(lines[0].includes('"Visual ""QC"" Check"'), 'quotes doubled');
  assert.ok(lines[0].includes('Defect Type'));
  assert.ok(lines[0].includes('Notes'));

  // The abandoned run belongs to Bob and carries no widget values (rows started
  // in the same second tie on started_at, so row order among them is not asserted).
  const abandonedRow = lines.find(l => l.includes('abandoned'));
  assert.ok(abandonedRow, 'abandoned run exported');
  assert.equal(abandonedRow.split(',')[4], 'Bob');

  // Alice's fail run flattens its values into the widget columns.
  const failRow = lines.find(l => l.includes('Dent'));
  assert.ok(failRow, 'select value exported');
  assert.ok(failRow.includes('fail'), 'pass_fail value exported');
  assert.ok(failRow.includes('9'), 'number value exported');
  assert.ok(failRow.includes('"burr, see photo ""A"""'), 'text value with comma+quotes escaped');
});

test('export.csv honors the same filters', async () => {
  const r = await apiText(`/api/apps/${appId}/export.csv?operator=Bob`, tokenA);
  assert.equal(r.status, 200);
  const lines = r.text.replace(/^﻿/, '').trim().split('\n');
  assert.equal(lines.length, 1 + 2, 'header + Bob\'s 2 runs');
  assert.ok(lines.slice(1).every(l => l.includes('Bob')));
});

// ─── Tenant isolation ─────────────────────────────────────────────────────────

test('cross-tenant analytics and export are invisible (404)', async () => {
  assert.equal((await api('GET', `/api/apps/${appId}/analytics`, { token: tokenB })).status, 404);
  assert.equal((await apiText(`/api/apps/${appId}/export.csv`, tokenB)).status, 404);
  assert.equal((await api('GET', '/api/apps/nope/analytics', { token: tokenA })).status, 404);
});

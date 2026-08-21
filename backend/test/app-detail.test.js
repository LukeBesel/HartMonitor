// ─── Apps-first endpoints: library stats, in-depth detail, duplicate ─────────
// Spawns the real server against a throwaway database and exercises:
//   • GET /api/apps/stats — per-app run counters (total / 7d / in-progress /
//     last run) plus `company_has_completions`, the signal a brand-new account
//     uses to land on Apps instead of an empty Command Center,
//   • GET /api/apps/:id/detail — the in-depth page payload: the parsed steps
//     blob, every binding pointing at the app (department, site, stations,
//     product types, routings, work orders), run stats, operators, recent runs,
//   • POST /api/apps/:id/duplicate — copies an app as a draft with freshly
//     generated step/widget ids, auto-names collisions, 409s an explicit clash,
//   • tenant isolation on all three (company B sees nothing of company A).
// Run with: npm test — uses only Node built-ins (node:test + global fetch).

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const PORT = 3181; // unique per test file
const BASE = `http://localhost:${PORT}`;
const DB_PATH = path.join(os.tmpdir(), `mes-app-detail-test-${Date.now()}.db`);

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
        EARLY_ACCESS: 'true', // no plan gating noise — these are read paths
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

let tokenA;      // Widget Co
let tokenB;      // Gadget Co
let appId;       // the fully-wired app under test
let quietAppId;  // a second app nobody ever runs
let deptId, siteId, stationId, productTypeId, workOrderId, routingId;

const STEP_1 = 'ad-step-1';
const STEP_2 = 'ad-step-2';
const W_TORQUE = 'ad-w-torque';
const W_VISUAL = 'ad-w-visual';

function fixtureSteps() {
  return [
    {
      id: STEP_1, name: 'Prep', order: 0, takt_time_seconds: 60,
      triggers: [{
        id: 'ad-t-1', event: 'step_enter', match: 'all', conditions: [],
        actions: [{ type: 'show_message', message: 'Grab your torque driver' }],
      }],
      widgets: [
        { id: 'ad-w-note', type: 'instruction', order: 0, label: 'Read me', config: { content: 'Clamp the fixture.' } },
      ],
    },
    {
      id: STEP_2, name: 'Torque & check', order: 1,
      widgets: [
        { id: W_TORQUE, type: 'number-input', order: 0, label: 'Torque (Nm)', config: { variableName: 'torque' } },
        {
          id: W_VISUAL, type: 'pass-fail', order: 1, label: 'Visual check', config: { variableName: 'visual_ok' },
          triggers: [{
            id: 'ad-t-2', event: 'input_change', match: 'all',
            conditions: [{ op: 'eq', left: { kind: 'widget', name: W_VISUAL }, right: { kind: 'static', name: 'fail' } }],
            actions: [{ type: 'block_with_error', message: 'Failed visual — call your supervisor' }],
          }],
        },
      ],
    },
  ];
}

// One run: start → flush values → finish with the requested status.
async function run({ operator, torque, visual, status = 'completed', work_order_id, product_type_id, station_id }) {
  const start = await api('POST', '/api/completions', {
    token: tokenA,
    body: { app_id: appId, operator_name: operator, work_order_id, product_type_id, station_id },
  });
  assert.equal(start.status, 201);
  if (status === 'in_progress') return start.json.id;

  const values = [];
  if (torque !== undefined) values.push({ step_id: STEP_2, widget_id: W_TORQUE, variable_name: 'torque', value_type: 'number', value_number: torque });
  if (visual !== undefined) values.push({ step_id: STEP_2, widget_id: W_VISUAL, variable_name: 'visual_ok', value_type: 'pass_fail', value_text: visual });
  const put = await api('PUT', `/api/completions/${start.json.id}`, { token: tokenA, body: { status, values } });
  assert.equal(put.status, 200);
  return start.json.id;
}

before(async () => {
  await startServer();

  const a = await api('POST', '/api/auth/signup', {
    body: { company_name: 'Widget Co', email: 'owner@widget-ad.test', password: 'supersecret1', display_name: 'Widget Owner' },
  });
  assert.equal(a.status, 201);
  tokenA = a.json.token;

  const b = await api('POST', '/api/auth/signup', {
    body: { company_name: 'Gadget Co', email: 'owner@gadget-ad.test', password: 'supersecret1', display_name: 'Gadget Owner' },
  });
  assert.equal(b.status, 201);
  tokenB = b.json.token;

  // A department, a site and a station to bind the app to.
  const dept = await api('POST', '/api/departments', { token: tokenA, body: { name: 'Assembly', color: '#22c55e' } });
  assert.equal(dept.status, 201);
  deptId = dept.json.id;

  const sites = await api('GET', '/api/sites', { token: tokenA });
  assert.equal(sites.status, 200);
  siteId = sites.json[0]?.id ?? null;
  assert.ok(siteId, 'signup provisions a primary site');

  const station = await api('POST', '/api/stations', { token: tokenA, body: { name: 'Bench 1', location: 'Bay A' } });
  assert.equal(station.status, 201);
  stationId = station.json.id;

  const app = await api('POST', '/api/apps', {
    token: tokenA,
    body: { name: 'Bracket Assembly', description: 'Torque and inspect a bracket', department_id: deptId, site_id: siteId },
  });
  assert.equal(app.status, 201);
  appId = app.json.id;
  assert.equal((await api('PUT', `/api/apps/${appId}`, {
    token: tokenA, body: { steps: fixtureSteps(), status: 'published' },
  })).status, 200);

  // Point the station at the app so it shows under "where this app runs".
  assert.equal((await api('PUT', `/api/stations/${stationId}`, {
    token: tokenA, body: { current_app_id: appId },
  })).status, 200);

  const pt = await api('POST', '/api/product-types', { token: tokenA, body: { app_id: appId, name: 'Blue Variant' } });
  assert.equal(pt.status, 201);
  productTypeId = pt.json.id;

  const wo = await api('POST', '/api/work-orders', {
    token: tokenA,
    body: { part_number: 'BR-100', part_name: 'Bracket', quantity: 25, app_id: appId, department_id: deptId },
  });
  assert.equal(wo.status, 201);
  workOrderId = wo.json.id;

  const routing = await api('POST', '/api/routings', {
    token: tokenA,
    body: { name: 'Bracket route', steps: [{ step_number: 1, name: 'Assemble', app_id: appId, department_id: deptId }] },
  });
  assert.equal(routing.status, 201);
  routingId = routing.json.id;

  // A second app that nobody runs — proves the stats row still exists at zero.
  const quiet = await api('POST', '/api/apps', { token: tokenA, body: { name: 'Never Run' } });
  assert.equal(quiet.status, 201);
  quietAppId = quiet.json.id;

  // Runs: Alice ×3 (2 pass, 1 fail), Bob ×1 completed + 1 abandoned + 1 open.
  await run({ operator: 'Alice', torque: 15, visual: 'pass', work_order_id: workOrderId });
  await run({ operator: 'Alice', torque: 14, visual: 'pass', product_type_id: productTypeId });
  await run({ operator: 'Alice', torque: 21, visual: 'fail', station_id: stationId });
  await run({ operator: 'Bob', torque: 15, visual: 'pass' });
  await run({ operator: 'Bob', status: 'abandoned' });
  await run({ operator: 'Bob', status: 'in_progress' });
});

after(() => {
  if (server) server.kill('SIGTERM');
  for (const ext of ['', '-shm', '-wal']) { try { fs.unlinkSync(DB_PATH + ext); } catch { /* ignore */ } }
});

// ─── GET /api/apps/stats ─────────────────────────────────────────────────────

test('GET /api/apps/stats counts runs per app and flags that the company has run something', async () => {
  const r = await api('GET', '/api/apps/stats', { token: tokenA });
  assert.equal(r.status, 200);
  assert.equal(r.json.company_has_completions, true);

  const byApp = Object.fromEntries(r.json.apps.map(a => [a.app_id, a]));
  assert.equal(Object.keys(byApp).length, 2, 'one row per app, including the app nobody ran');

  const busy = byApp[appId];
  assert.equal(busy.runs_total, 6);
  assert.equal(busy.runs_7d, 6, 'every fixture run happened just now');
  assert.equal(busy.in_progress, 1);
  assert.ok(busy.last_run_at, 'last_run_at is set once the app has been run');

  const quiet = byApp[quietAppId];
  assert.equal(quiet.runs_total, 0);
  assert.equal(quiet.runs_7d, 0);
  assert.equal(quiet.in_progress, 0);
  assert.equal(quiet.last_run_at, null);
});

test('GET /api/apps/stats reports no completions for a company that has never run anything', async () => {
  const r = await api('GET', '/api/apps/stats', { token: tokenB });
  assert.equal(r.status, 200);
  assert.equal(r.json.company_has_completions, false, 'the brand-new-account signal');
  assert.deepEqual(r.json.apps, [], "company B cannot see company A's apps");
});

// ─── GET /api/apps/:id/detail ────────────────────────────────────────────────

test('GET /api/apps/:id/detail returns the parsed authoring blob', async () => {
  const r = await api('GET', `/api/apps/${appId}/detail`, { token: tokenA });
  assert.equal(r.status, 200);
  assert.equal(r.json.app.id, appId);
  assert.equal(r.json.app.name, 'Bracket Assembly');
  assert.equal(r.json.app.status, 'published');
  assert.ok(Array.isArray(r.json.app.steps), 'steps come back parsed, not as a JSON string');
  assert.equal(r.json.app.steps.length, 2);
  assert.equal(r.json.app.steps[1].widgets.length, 2);
  assert.equal(r.json.app.steps[1].widgets[0].label, 'Torque (Nm)');
  assert.ok(Array.isArray(r.json.app.variables));
  assert.ok(Array.isArray(r.json.app.step_groups));
});

test('GET /api/apps/:id/detail lists every binding that points at the app', async () => {
  const r = await api('GET', `/api/apps/${appId}/detail`, { token: tokenA });
  assert.equal(r.status, 200);
  const b = r.json.bindings;

  assert.equal(b.department.id, deptId);
  assert.equal(b.department.name, 'Assembly');
  assert.equal(b.site.id, siteId);

  assert.equal(b.stations.length, 1, 'the station whose current app is this one');
  assert.equal(b.stations[0].id, stationId);
  assert.equal(b.stations[0].name, 'Bench 1');

  assert.equal(b.product_types.length, 1);
  assert.equal(b.product_types[0].id, productTypeId);

  assert.equal(b.routings.length, 1);
  assert.equal(b.routings[0].routing_id, routingId);
  assert.equal(b.routings[0].step_name, 'Assemble');
  assert.equal(b.routings[0].step_number, 1);

  assert.equal(b.work_order_count, 1);
  assert.equal(b.work_orders[0].id, workOrderId);
  assert.equal(b.work_orders[0].part_number, 'BR-100');
});

test('GET /api/apps/:id/detail computes run stats, operators and recent runs from completions', async () => {
  const r = await api('GET', `/api/apps/${appId}/detail`, { token: tokenA });
  assert.equal(r.status, 200);
  const s = r.json.stats;

  assert.equal(s.runs_total, 6);
  assert.equal(s.completed, 4);
  assert.equal(s.abandoned, 1);
  assert.equal(s.in_progress, 1);
  assert.equal(s.runs_7d, 6);
  assert.equal(s.runs_30d, 6);
  assert.equal(s.completed_30d, 4);
  assert.equal(typeof s.avg_duration_s, 'number', 'averaged over completed runs only');
  // 4 runs recorded a pass/fail check; 3 of them had no fail → 75%.
  assert.equal(s.first_pass_yield, 75);
  assert.equal(s.operator_count, 2);
  assert.ok(s.first_run_at && s.last_run_at);

  const alice = r.json.operators.find(o => o.operator_name === 'Alice');
  const bob = r.json.operators.find(o => o.operator_name === 'Bob');
  assert.equal(alice.runs, 3);
  assert.equal(alice.completed, 3);
  assert.equal(bob.runs, 3);
  assert.equal(bob.completed, 1);
  assert.equal(r.json.operators[0].operator_name, 'Alice', 'sorted by runs desc');

  assert.equal(r.json.recent_runs.length, 6);
  // Newest first. (Every fixture run lands in the same second, so assert the
  // ordering property rather than a specific row.)
  const starts = r.json.recent_runs.map(x => x.started_at);
  assert.deepEqual(starts, [...starts].sort().reverse(), 'ordered by started_at desc');
  assert.ok(r.json.recent_runs.some(x => x.status === 'in_progress'), 'open runs are included');
  assert.ok(r.json.recent_runs.some(x => x.status === 'abandoned'), 'abandoned runs are included');
  assert.ok(r.json.recent_runs.some(x => typeof x.duration_s === 'number'), 'completed runs carry a duration');
  const withWo = r.json.recent_runs.find(x => x.work_order_number);
  assert.ok(withWo, 'run context is joined in');
  const withPt = r.json.recent_runs.find(x => x.product_type_name === 'Blue Variant');
  assert.ok(withPt);
  const withStation = r.json.recent_runs.find(x => x.station_name === 'Bench 1');
  assert.ok(withStation);
});

test('GET /api/apps/:id/detail is honest about an app nobody has run', async () => {
  const r = await api('GET', `/api/apps/${quietAppId}/detail`, { token: tokenA });
  assert.equal(r.status, 200);
  assert.equal(r.json.stats.runs_total, 0);
  assert.equal(r.json.stats.avg_duration_s, null);
  assert.equal(r.json.stats.first_pass_yield, null, 'no pass/fail data → null, never a made-up 100%');
  assert.equal(r.json.stats.last_run_at, null);
  assert.deepEqual(r.json.operators, []);
  assert.deepEqual(r.json.recent_runs, []);
  assert.equal(r.json.bindings.department, null);
  assert.equal(r.json.bindings.work_order_count, 0);
});

test('GET /api/apps/:id/detail is tenant-scoped', async () => {
  const r = await api('GET', `/api/apps/${appId}/detail`, { token: tokenB });
  assert.equal(r.status, 404, "company B cannot read company A's app");
  const missing = await api('GET', '/api/apps/does-not-exist/detail', { token: tokenA });
  assert.equal(missing.status, 404);
});

// ─── POST /api/apps/:id/duplicate ────────────────────────────────────────────

test('POST /api/apps/:id/duplicate copies the app as a draft with fresh ids', async () => {
  const r = await api('POST', `/api/apps/${appId}/duplicate`, { token: tokenA, body: {} });
  assert.equal(r.status, 201);
  assert.equal(r.json.name, 'Bracket Assembly (copy)');
  assert.equal(r.json.status, 'draft', 'a copy is never live until you publish it');
  assert.notEqual(r.json.id, appId);
  assert.equal(r.json.department_id, deptId, 'bindings carry over');
  assert.equal(r.json.description, 'Torque and inspect a bracket');

  assert.equal(r.json.steps.length, 2);
  const copiedStepIds = r.json.steps.map(s => s.id);
  assert.ok(!copiedStepIds.includes(STEP_1), 'step ids are regenerated');
  assert.ok(!copiedStepIds.includes(STEP_2));
  const copiedWidgetIds = r.json.steps.flatMap(s => s.widgets.map(w => w.id));
  assert.ok(!copiedWidgetIds.includes(W_TORQUE), 'widget ids are regenerated');
  assert.ok(!copiedWidgetIds.includes(W_VISUAL));
  // Content survives the id remap.
  assert.equal(r.json.steps[1].widgets[0].label, 'Torque (Nm)');
  assert.equal(r.json.steps[1].widgets[1].triggers.length, 1);
  assert.equal(r.json.steps[0].triggers.length, 1);

  // The copy starts with no runs of its own.
  const detail = await api('GET', `/api/apps/${r.json.id}/detail`, { token: tokenA });
  assert.equal(detail.status, 200);
  assert.equal(detail.json.stats.runs_total, 0);
});

test('POST /api/apps/:id/duplicate keeps picking a free name, and 409s an explicit clash', async () => {
  const second = await api('POST', `/api/apps/${appId}/duplicate`, { token: tokenA, body: {} });
  assert.equal(second.status, 201);
  assert.equal(second.json.name, 'Bracket Assembly (copy 2)');

  const named = await api('POST', `/api/apps/${appId}/duplicate`, { token: tokenA, body: { name: 'Bracket Assembly v2' } });
  assert.equal(named.status, 201);
  assert.equal(named.json.name, 'Bracket Assembly v2');

  const clash = await api('POST', `/api/apps/${appId}/duplicate`, { token: tokenA, body: { name: 'Bracket Assembly v2' } });
  assert.equal(clash.status, 409);
  assert.equal(clash.json.error, 'duplicate_name');
});

test('POST /api/apps/:id/duplicate is tenant-scoped', async () => {
  const r = await api('POST', `/api/apps/${appId}/duplicate`, { token: tokenB, body: {} });
  assert.equal(r.status, 404);
});

test('the /stats and /templates routes are never captured as app ids', async () => {
  // Route-order regression guard: GET /api/apps/stats must not fall through to
  // GET /api/apps/:id and 404 as "app 'stats' not found".
  const stats = await api('GET', '/api/apps/stats', { token: tokenA });
  assert.equal(stats.status, 200);
  assert.ok(Array.isArray(stats.json.apps));
  const templates = await api('GET', '/api/apps/templates', { token: tokenA });
  assert.equal(templates.status, 200);
  assert.ok(Array.isArray(templates.json.built_in));
});

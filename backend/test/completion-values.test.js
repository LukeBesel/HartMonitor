// ─── Structured completion capture + v2 app-blob validation tests ─────────────
// Spawns the real server against a throwaway database and exercises:
//   • PUT /api/apps/:id server-side trigger validation (whitelists, ≤1 nav
//     action, go_to_step target existence, 2MB steps cap) + step_groups /
//     schema_version round-trip,
//   • POST /api/operators/badge-login (badge + PIN attribution),
//   • POST /api/completions with operator_user_id and kit auto-attach,
//   • PUT /api/completions/:id `values` upsert (idempotent per widget) with
//     `partial` autosave semantics and byte-identical legacy data dual-write,
//   • GET /api/completions/:id/values, all with cross-tenant 404s.
// Run with: npm test — uses only Node built-ins (node:test + global fetch).

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const PORT = 3192; // unique per test file — 3195-3199 are taken by the other suites
const BASE = `http://localhost:${PORT}`;
const DB_PATH = path.join(os.tmpdir(), `mes-completion-values-test-${Date.now()}.db`);

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

let tokenA;   // Widget Co (developer)
let tokenB;   // Gadget Co (developer)
let appId;
let stepIds;  // [stepA, stepB]
let operatorId;   // verified floor operator in company A
let foreignUserId; // a company B user

before(async () => {
  await startServer();

  const a = await api('POST', '/api/auth/signup', {
    body: { company_name: 'Widget Co', email: 'owner@widget-cv.test', password: 'supersecret1', display_name: 'Widget Owner' },
  });
  assert.equal(a.status, 201);
  tokenA = a.json.token;

  const b = await api('POST', '/api/auth/signup', {
    body: { company_name: 'Gadget Co', email: 'owner@gadget-cv.test', password: 'supersecret1', display_name: 'Gadget Owner' },
  });
  assert.equal(b.status, 201);
  tokenB = b.json.token;
  foreignUserId = b.json.user.id;

  const app = await api('POST', '/api/apps', { token: tokenA, body: { name: 'Capture App' } });
  assert.equal(app.status, 201);
  appId = app.json.id;

  // A verified floor operator with a badge and a PIN.
  const created = await api('POST', '/api/users', {
    token: tokenA,
    body: { email: 'op@widget-cv.test', display_name: 'Badge Op', password: 'supersecret1', role: 'operator' },
  });
  assert.equal(created.status, 201);
  operatorId = created.json.id;
  const pinSet = await api('PUT', `/api/users/${operatorId}/pin`, {
    token: tokenA, body: { pin: '4321', badge_code: 'BADGE-777' },
  });
  assert.equal(pinSet.status, 200);
});

after(() => {
  if (server) server.kill('SIGTERM');
  for (const ext of ['', '-shm', '-wal']) { try { fs.unlinkSync(DB_PATH + ext); } catch { /* ignore */ } }
});

// ─── App v2 blob save + trigger validation ────────────────────────────────────

function v2Steps() {
  const stepA = 'step-aaa';
  const stepB = 'step-bbb';
  return [
    {
      id: stepA, name: 'Inspect', order: 0,
      triggers: [{
        id: 'trg-step-1', event: 'step_exit', match: 'all',
        conditions: [{ left: { kind: 'variable', name: 'qty_ok' }, op: 'eq', right: { kind: 'static', value: true } }],
        actions: [{ type: 'show_message', level: 'info', text: 'Nice work {{operator}}' }],
      }],
      widgets: [
        {
          id: 'w-btn-1', type: 'button', order: 0, label: '', config: { buttonText: 'Fail path' },
          triggers: [{
            id: 'trg-w-1', event: 'button_press', match: 'any',
            conditions: [{ op: 'kit_has_short' }],
            actions: [
              { type: 'set_variable', name: 'flagged', value: { kind: 'static', value: true } },
              { type: 'go_to_step', stepId: stepB },
            ],
          }],
        },
        { id: 'w-num-1', type: 'number-input', order: 1, label: 'Torque', config: { variableName: 'torque', min: 1, max: 9 } },
      ],
    },
    { id: stepB, name: 'Rework', order: 1, widgets: [] },
  ];
}

test('PUT /api/apps/:id accepts a valid v2 blob with step_groups and schema_version', async () => {
  const steps = v2Steps();
  stepIds = steps.map(s => s.id);
  const groups = [{ id: 'grp-1', name: 'Quality', order: 0 }];
  const put = await api('PUT', `/api/apps/${appId}`, {
    token: tokenA,
    body: { steps, step_groups: groups, schema_version: 2, variables: [{ id: 'v1', name: 'torque', type: 'number' }] },
  });
  assert.equal(put.status, 200);
  assert.equal(put.json.schema_version, 2);
  assert.deepEqual(put.json.step_groups, groups);

  const fresh = await api('GET', `/api/apps/${appId}`, { token: tokenA });
  assert.equal(fresh.json.schema_version, 2, 'schema_version persists');
  assert.deepEqual(fresh.json.step_groups, groups, 'step_groups round-trips');
  assert.equal(fresh.json.steps[0].triggers.length, 1, 'triggers stored inside the steps blob');
});

test('a legacy v1 blob (no triggers) still saves untouched', async () => {
  const legacyApp = await api('POST', '/api/apps', { token: tokenA, body: { name: 'Legacy App' } });
  const legacySteps = [{ id: 'ls-1', name: 'Old Step', order: 0, widgets: [{ id: 'lw-1', type: 'button', order: 0, label: '', config: { buttonType: 'next' } }] }];
  const put = await api('PUT', `/api/apps/${legacyApp.json.id}`, { token: tokenA, body: { steps: legacySteps } });
  assert.equal(put.status, 200);
  assert.equal(put.json.schema_version, 1, 'schema_version stays 1 until the new builder saves');
  assert.deepEqual(put.json.steps, legacySteps);
});

test('malformed trigger blobs are rejected with 400 INVALID_TRIGGER and a path', async () => {
  const base = v2Steps();

  const cases = [
    { mutate: s => { s[0].triggers[0].event = 'teleport'; },                          pathPart: 'triggers[0].event' },
    { mutate: s => { s[0].triggers[0].conditions[0].op = 'resembles'; },              pathPart: 'conditions[0].op' },
    { mutate: s => { s[0].widgets[0].triggers[0].actions[0].type = 'rm_rf'; },        pathPart: 'actions[0].type' },
    { mutate: s => { s[0].widgets[0].triggers[0].actions.push({ type: 'next_step' }); }, pathPart: 'actions' }, // 2nd navigation
    { mutate: s => { s[0].widgets[0].triggers[0].actions[1].stepId = 'nope'; },       pathPart: 'stepId' },     // unknown go_to_step target
    { mutate: s => { s[0].triggers[0].match = 'some'; },                              pathPart: 'match' },
    { mutate: s => { s[0].triggers = { not: 'an array' }; },                          pathPart: 'triggers' },
  ];

  for (const c of cases) {
    const steps = JSON.parse(JSON.stringify(base));
    c.mutate(steps);
    const put = await api('PUT', `/api/apps/${appId}`, { token: tokenA, body: { steps } });
    assert.equal(put.status, 400, `rejected: ${c.pathPart}`);
    assert.equal(put.json.code, 'INVALID_TRIGGER');
    assert.ok(String(put.json.path).includes(c.pathPart), `path "${put.json.path}" names ${c.pathPart}`);
  }

  // The stored blob is untouched by rejected saves.
  const fresh = await api('GET', `/api/apps/${appId}`, { token: tokenA });
  assert.equal(fresh.json.steps[0].triggers[0].event, 'step_exit');
});

test('a steps blob over 2MB is rejected', async () => {
  const steps = v2Steps();
  steps[1].description = 'x'.repeat(2 * 1024 * 1024 + 100);
  const put = await api('PUT', `/api/apps/${appId}`, { token: tokenA, body: { steps } });
  assert.equal(put.status, 400);
  assert.equal(put.json.code, 'STEPS_TOO_LARGE');
});

// ─── Badge / PIN login ────────────────────────────────────────────────────────

test('badge-login resolves a badge code to a verified identity', async () => {
  const ok = await api('POST', '/api/operators/badge-login', { token: tokenA, body: { badge_code: 'BADGE-777' } });
  assert.equal(ok.status, 200);
  assert.equal(ok.json.user_id, operatorId);
  assert.equal(ok.json.display_name, 'Badge Op');

  const bad = await api('POST', '/api/operators/badge-login', { token: tokenA, body: { badge_code: 'WRONG' } });
  assert.equal(bad.status, 401);

  // Badges never cross tenants.
  const foreign = await api('POST', '/api/operators/badge-login', { token: tokenB, body: { badge_code: 'BADGE-777' } });
  assert.equal(foreign.status, 401);
});

test('badge-login accepts a PIN (with or without user_id)', async () => {
  const ok = await api('POST', '/api/operators/badge-login', { token: tokenA, body: { pin: '4321' } });
  assert.equal(ok.status, 200);
  assert.equal(ok.json.user_id, operatorId);

  const scoped = await api('POST', '/api/operators/badge-login', { token: tokenA, body: { user_id: operatorId, pin: '4321' } });
  assert.equal(scoped.status, 200);

  const wrong = await api('POST', '/api/operators/badge-login', { token: tokenA, body: { pin: '9999' } });
  assert.equal(wrong.status, 401);

  const empty = await api('POST', '/api/operators/badge-login', { token: tokenA, body: {} });
  assert.equal(empty.status, 400);
});

// ─── Completions: verified identity + kit auto-attach ─────────────────────────

let completionId;

test('POST /api/completions stores a company-owned operator_user_id', async () => {
  const start = await api('POST', '/api/completions', {
    token: tokenA,
    body: { app_id: appId, operator_name: 'Badge Op', operator_user_id: operatorId },
  });
  assert.equal(start.status, 201);
  assert.equal(start.json.operator_user_id, operatorId);
  assert.equal(start.json.kit_id, null, 'no work order → no kit');
  completionId = start.json.id;
});

test('a cross-tenant operator_user_id is silently dropped', async () => {
  const start = await api('POST', '/api/completions', {
    token: tokenA,
    body: { app_id: appId, operator_name: 'Spoof', operator_user_id: foreignUserId },
  });
  assert.equal(start.status, 201);
  assert.equal(start.json.operator_user_id, null);
});

test('starting a run against a kitted work order auto-attaches kit_id', async () => {
  // Minimal BOM/kit chain: pro plan → item → product type → active BOM → WO → kit.
  assert.equal((await api('PUT', '/api/config/plan', { token: tokenA, body: { tier: 'pro' } })).status, 200);
  const item = await api('POST', '/api/inventory/items', { token: tokenA, body: { sku: 'BOLT-1', name: 'Bolt' } });
  assert.equal(item.status, 201);
  const pt = await api('POST', '/api/product-types', { token: tokenA, body: { app_id: appId, name: 'Kitted PT' } });
  assert.equal(pt.status, 201);
  const bom = await api('POST', '/api/boms', { token: tokenA, body: { product_type_id: pt.json.id } });
  assert.equal(bom.status, 201);
  assert.equal((await api('PUT', `/api/boms/${bom.json.id}`, { token: tokenA, body: { lines: [{ item_id: item.json.id, qty_per: 4 }] } })).status, 200);
  assert.equal((await api('POST', `/api/boms/${bom.json.id}/activate`, { token: tokenA })).status, 200);

  const wo = await api('POST', '/api/work-orders', {
    token: tokenA,
    body: { part_number: 'KP-1', part_name: 'Kitted Part', quantity: 3, app_id: appId, product_type_id: pt.json.id },
  });
  assert.equal(wo.status, 201);
  const kit = await api('POST', '/api/kits/generate', { token: tokenA, body: { work_order_id: wo.json.id } });
  assert.equal(kit.status, 201);
  assert.equal(kit.json.lines[0].qty_required, 12, '3 units × qty_per 4');

  const start = await api('POST', '/api/completions', {
    token: tokenA, body: { app_id: appId, operator_name: 'Badge Op', work_order_id: wo.json.id },
  });
  assert.equal(start.status, 201);
  assert.equal(start.json.kit_id, kit.json.id, 'the WO\'s kit is attached for genealogy');
});

// ─── PUT values upsert + partial autosave + legacy dual-write ─────────────────

test('PUT /:id with values upserts completion_values while writing legacy data byte-identically', async () => {
  const legacyData = { torque: 7.5, ppe_worn: true, notes: 'first unit' };
  const stepTimes = { [stepIds[0]]: 42 };

  const put = await api('PUT', `/api/completions/${completionId}`, {
    token: tokenA,
    body: {
      partial: true,
      data: legacyData,
      step_times: stepTimes,
      values: [
        { step_id: stepIds[0], widget_id: 'w-num-1', variable_name: 'torque', value_type: 'number', value_number: 7.5 },
        { step_id: stepIds[0], widget_id: 'w-photo-1', variable_name: 'evidence', value_type: 'photo', value_text: '/uploads/p1.jpg' },
      ],
    },
  });
  assert.equal(put.status, 200);
  assert.deepEqual(put.json.data, legacyData, 'legacy data blob written exactly as sent');
  assert.deepEqual(put.json.step_times, stepTimes, 'legacy step_times written exactly as sent');
  assert.equal(put.json.status, 'in_progress', 'partial flush never changes status');
  assert.equal(put.json.completed_at, null);

  const values = await api('GET', `/api/completions/${completionId}/values`, { token: tokenA });
  assert.equal(values.status, 200);
  assert.equal(values.json.length, 2);
  const torque = values.json.find(v => v.widget_id === 'w-num-1');
  assert.equal(torque.value_type, 'number');
  assert.equal(torque.value_number, 7.5);
  assert.equal(torque.variable_name, 'torque');
  assert.equal(torque.app_id, appId);
  assert.equal(torque.step_id, stepIds[0]);
});

test('re-sending the same widget updates in place (idempotent autosave)', async () => {
  const put = await api('PUT', `/api/completions/${completionId}`, {
    token: tokenA,
    body: {
      partial: true,
      values: [{ step_id: stepIds[0], widget_id: 'w-num-1', variable_name: 'torque', value_type: 'number', value_number: 8.25 }],
    },
  });
  assert.equal(put.status, 200);

  const values = await api('GET', `/api/completions/${completionId}/values`, { token: tokenA });
  assert.equal(values.json.length, 2, 'still two rows — no duplicates');
  const torque = values.json.find(v => v.widget_id === 'w-num-1');
  assert.equal(torque.value_number, 8.25, 'latest value wins');
});

test('partial:true ignores an accidental status flip; a final PUT completes the run', async () => {
  const sneaky = await api('PUT', `/api/completions/${completionId}`, {
    token: tokenA, body: { partial: true, status: 'completed' },
  });
  assert.equal(sneaky.status, 200);
  assert.equal(sneaky.json.status, 'in_progress', 'autosave cannot complete a run');

  const done = await api('PUT', `/api/completions/${completionId}`, {
    token: tokenA,
    body: {
      status: 'completed',
      values: [{ step_id: stepIds[1], widget_id: 'w-timer-1', variable_name: '', value_type: 'timer', value_number: 91 }],
    },
  });
  assert.equal(done.status, 200);
  assert.equal(done.json.status, 'completed');
  assert.ok(done.json.completed_at, 'completed_at stamped');

  const values = await api('GET', `/api/completions/${completionId}/values`, { token: tokenA });
  assert.equal(values.json.length, 3, 'final flush values recorded too');
});

test('bad values payloads are rejected atomically', async () => {
  const badType = await api('PUT', `/api/completions/${completionId}`, {
    token: tokenA, body: { values: [{ widget_id: 'w-x', value_type: 'hologram' }] },
  });
  assert.equal(badType.status, 400);

  const noWidget = await api('PUT', `/api/completions/${completionId}`, {
    token: tokenA, body: { values: [{ value_type: 'text', value_text: 'orphan' }] },
  });
  assert.equal(noWidget.status, 400);

  const notArray = await api('PUT', `/api/completions/${completionId}`, {
    token: tokenA, body: { values: { widget_id: 'w-x' } },
  });
  assert.equal(notArray.status, 400);

  const values = await api('GET', `/api/completions/${completionId}/values`, { token: tokenA });
  assert.equal(values.json.length, 3, 'rejected payloads wrote nothing');
});

test('cross-tenant completions and values are invisible (404)', async () => {
  assert.equal((await api('PUT', `/api/completions/${completionId}`, { token: tokenB, body: { data: { stolen: true } } })).status, 404);
  assert.equal((await api('GET', `/api/completions/${completionId}/values`, { token: tokenB })).status, 404);
  assert.equal((await api('GET', '/api/completions/does-not-exist/values', { token: tokenA })).status, 404);
});

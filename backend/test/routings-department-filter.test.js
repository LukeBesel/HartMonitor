// ─── Routings list department filter ──────────────────────────────────────────
// GET /api/routings?department_id= narrows the list to routings that have at
// least one step in that department (the department lives on routing_steps, not
// on the routing itself). Verifies: a routing whose only step is in Welding
// appears under Welding and is absent under Paint; the step_count stays the full
// count; and a department id from another tenant filters everything away.
//
// Uses only Node built-ins (node:test + global fetch). Run with: npm test

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const PORT = 3233; // unique per test file — no other suite uses 3233
const BASE = `http://localhost:${PORT}`;
const DB_PATH = path.join(os.tmpdir(), `mes-routings-dept-test-${Date.now()}.db`);

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

let tokenA;      // Widget Co (pro — routings are pro-gated)
let tokenB;      // Gadget Co
let weldingId, paintId;   // company A departments
let foreignDeptId;        // company B department
let weldRoutingId, paintRoutingId, mixedRoutingId;

before(async () => {
  await startServer();

  const a = await api('POST', '/api/auth/signup', {
    body: { company_name: 'Widget Co', email: 'owner@widget-rd.test', password: 'supersecret1', display_name: 'Widget Owner' },
  });
  assert.equal(a.status, 201);
  tokenA = a.json.token;

  const b = await api('POST', '/api/auth/signup', {
    body: { company_name: 'Gadget Co', email: 'owner@gadget-rd.test', password: 'supersecret1', display_name: 'Gadget Owner' },
  });
  assert.equal(b.status, 201);
  tokenB = b.json.token;

  // Routings are Pro-gated.
  const plan = await api('PUT', '/api/config/plan', { token: tokenA, body: { tier: 'pro' } });
  assert.equal(plan.status, 200);

  // Company A departments.
  const weld = await api('POST', '/api/departments', { token: tokenA, body: { name: 'Welding' } });
  assert.equal(weld.status, 201);
  weldingId = weld.json.id;

  const paint = await api('POST', '/api/departments', { token: tokenA, body: { name: 'Paint' } });
  assert.equal(paint.status, 201);
  paintId = paint.json.id;

  // Company B department — its id must never match a company A routing.
  const foreign = await api('POST', '/api/departments', { token: tokenB, body: { name: 'Welding' } });
  assert.equal(foreign.status, 201);
  foreignDeptId = foreign.json.id;
  assert.notEqual(foreignDeptId, weldingId);

  // Routing whose ONLY step is in Welding.
  const weldRouting = await api('POST', '/api/routings', {
    token: tokenA,
    body: { name: 'Weld Only', steps: [{ name: 'Weld seam', department_id: weldingId }] },
  });
  assert.equal(weldRouting.status, 201);
  weldRoutingId = weldRouting.json.id;

  // Routing whose only step is in Paint.
  const paintRouting = await api('POST', '/api/routings', {
    token: tokenA,
    body: { name: 'Paint Only', steps: [{ name: 'Spray coat', department_id: paintId }] },
  });
  assert.equal(paintRouting.status, 201);
  paintRoutingId = paintRouting.json.id;

  // Routing with steps in BOTH Welding and Paint (plus one with no department).
  const mixed = await api('POST', '/api/routings', {
    token: tokenA,
    body: {
      name: 'Weld then Paint',
      steps: [
        { name: 'Weld', department_id: weldingId },
        { name: 'Paint', department_id: paintId },
        { name: 'Inspect', department_id: null },
      ],
    },
  });
  assert.equal(mixed.status, 201);
  mixedRoutingId = mixed.json.id;
});

after(() => {
  if (server) server.kill('SIGTERM');
  for (const ext of ['', '-shm', '-wal']) { try { fs.unlinkSync(DB_PATH + ext); } catch { /* ignore */ } }
});

const names = rows => rows.map(r => r.name).sort();

test('unfiltered list returns every routing with the full step count', async () => {
  const res = await api('GET', '/api/routings', { token: tokenA });
  assert.equal(res.status, 200);
  assert.deepEqual(names(res.json), ['Paint Only', 'Weld Only', 'Weld then Paint']);
  const mixed = res.json.find(r => r.id === mixedRoutingId);
  assert.equal(mixed.step_count, 3, 'step_count is the full count, not the filtered slice');
});

test('department_id=Welding includes routings with a Welding step, excludes Paint-only', async () => {
  const res = await api('GET', `/api/routings?department_id=${weldingId}`, { token: tokenA });
  assert.equal(res.status, 200);
  assert.deepEqual(names(res.json), ['Weld Only', 'Weld then Paint']);
  assert.ok(!res.json.some(r => r.id === paintRoutingId), 'Paint-only routing is absent under Welding');
  // The mixed routing appears under Welding but still reports all 3 steps.
  const mixed = res.json.find(r => r.id === mixedRoutingId);
  assert.equal(mixed.step_count, 3);
});

test('department_id=Paint includes Paint-only and the mixed routing, excludes Weld-only', async () => {
  const res = await api('GET', `/api/routings?department_id=${paintId}`, { token: tokenA });
  assert.equal(res.status, 200);
  assert.deepEqual(names(res.json), ['Paint Only', 'Weld then Paint']);
  assert.ok(!res.json.some(r => r.id === weldRoutingId), 'Weld-only routing is absent under Paint');
});

test('a department id from another tenant filters everything away', async () => {
  const res = await api('GET', `/api/routings?department_id=${foreignDeptId}`, { token: tokenA });
  assert.equal(res.status, 200);
  assert.deepEqual(res.json, [], 'cross-tenant department id matches no company A routing');
});

test('the filter is company-scoped — company B sees none of company A\'s routings', async () => {
  // Company B is on the free tier; routings are pro-gated, so it is blocked
  // outright. Upgrade so we exercise the query itself, then confirm isolation.
  await api('PUT', '/api/config/plan', { token: tokenB, body: { tier: 'pro' } });
  const all = await api('GET', '/api/routings', { token: tokenB });
  assert.equal(all.status, 200);
  assert.deepEqual(all.json, [], 'company B has no routings of its own');
  // Company A's Welding id, queried by company B, still returns nothing.
  const byWeld = await api('GET', `/api/routings?department_id=${weldingId}`, { token: tokenB });
  assert.equal(byWeld.status, 200);
  assert.deepEqual(byWeld.json, []);
});

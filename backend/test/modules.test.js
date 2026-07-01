// ─── Composable MES module tests ──────────────────────────────────────────────
// Spawns the real server against a throwaway database and exercises the
// per-company module toggles: default-on behaviour, toggling, core-module
// protection, role gating, and tenant isolation. Run with: npm test
//
// Uses only Node built-ins (node:test + global fetch) — no extra dependencies.

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const PORT = 3198;
const BASE = `http://localhost:${PORT}`;
const DB_PATH = path.join(os.tmpdir(), `mes-modules-test-${Date.now()}.db`);

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

let tokenA;   // Widget Co (developer = manager+)
let tokenB;   // Gadget Co

before(async () => {
  await startServer();
  const a = await api('POST', '/api/auth/signup', {
    body: { company_name: 'Widget Co', email: 'owner@widget.test', password: 'supersecret1', display_name: 'Widget Owner' },
  });
  assert.equal(a.status, 201);
  tokenA = a.json.token;

  const b = await api('POST', '/api/auth/signup', {
    body: { company_name: 'Gadget Co', email: 'owner@gadget.test', password: 'supersecret1', display_name: 'Gadget Owner' },
  });
  assert.equal(b.status, 201);
  tokenB = b.json.token;
});

after(() => {
  if (server) server.kill('SIGTERM');
  for (const ext of ['', '-shm', '-wal']) { try { fs.unlinkSync(DB_PATH + ext); } catch { /* ignore */ } }
});

const EXPECTED_KEYS = [
  'production', 'quality', 'inventory', 'maintenance', 'andon',
  'kaizen', 'training', 'shifts', 'analytics', 'apps',
];

test('modules require authentication', async () => {
  const { status } = await api('GET', '/api/modules');
  assert.equal(status, 401);
});

test('every module is enabled by default (absence of a row = enabled)', async () => {
  const { status, json } = await api('GET', '/api/modules', { token: tokenA });
  assert.equal(status, 200);
  assert.ok(Array.isArray(json), 'returns an array');
  assert.deepEqual(json.map(m => m.key).sort(), [...EXPECTED_KEYS].sort(), 'full registry is returned');
  for (const m of json) {
    assert.equal(m.enabled, true, `${m.key} is enabled by default`);
    assert.ok(typeof m.name === 'string' && m.name.length > 0, `${m.key} has a name`);
    assert.ok(typeof m.description === 'string', `${m.key} has a description`);
    assert.ok(typeof m.icon === 'string', `${m.key} has an icon`);
    assert.ok(typeof m.includedInPlan === 'boolean', `${m.key} reports plan inclusion`);
  }
  const cores = json.filter(m => m.core).map(m => m.key).sort();
  assert.deepEqual(cores, ['analytics', 'production'], 'production and analytics are core');
});

test('a manager can disable and re-enable a non-core module', async () => {
  const off = await api('PUT', '/api/modules/quality', { token: tokenA, body: { enabled: false } });
  assert.equal(off.status, 200);
  assert.equal(off.json.key, 'quality');
  assert.equal(off.json.enabled, false);

  let list = (await api('GET', '/api/modules', { token: tokenA })).json;
  assert.equal(list.find(m => m.key === 'quality').enabled, false, 'quality shows disabled');
  assert.equal(list.find(m => m.key === 'inventory').enabled, true, 'other modules untouched');

  const on = await api('PUT', '/api/modules/quality', { token: tokenA, body: { enabled: true } });
  assert.equal(on.status, 200);
  assert.equal(on.json.enabled, true);

  list = (await api('GET', '/api/modules', { token: tokenA })).json;
  assert.equal(list.find(m => m.key === 'quality').enabled, true, 'quality re-enabled');
});

test('core modules cannot be disabled', async () => {
  for (const key of ['production', 'analytics']) {
    const { status, json } = await api('PUT', `/api/modules/${key}`, { token: tokenA, body: { enabled: false } });
    assert.equal(status, 400, `${key} disable is rejected`);
    assert.equal(json.code, 'CORE_MODULE');
  }
  const list = (await api('GET', '/api/modules', { token: tokenA })).json;
  assert.equal(list.find(m => m.key === 'production').enabled, true);
  assert.equal(list.find(m => m.key === 'analytics').enabled, true);
});

test('unknown module keys and bad bodies are rejected', async () => {
  const unknown = await api('PUT', '/api/modules/warp-drive', { token: tokenA, body: { enabled: false } });
  assert.equal(unknown.status, 404);

  const badBody = await api('PUT', '/api/modules/kaizen', { token: tokenA, body: { enabled: 'nope' } });
  assert.equal(badBody.status, 400);
});

test('toggling requires manager or above', async () => {
  // Company A's developer creates a plain operator, who must not be able to toggle.
  const created = await api('POST', '/api/users', {
    token: tokenA,
    body: { email: 'op@widget.test', display_name: 'Op', password: 'supersecret1', role: 'operator' },
  });
  assert.equal(created.status, 201);
  const login = await api('POST', '/api/auth/login', {
    body: { email: 'op@widget.test', password: 'supersecret1' },
  });
  assert.equal(login.status, 200);

  const read = await api('GET', '/api/modules', { token: login.json.token });
  assert.equal(read.status, 200, 'any authenticated user can read modules');

  const write = await api('PUT', '/api/modules/kaizen', { token: login.json.token, body: { enabled: false } });
  assert.equal(write.status, 403, 'operators cannot toggle modules');
});

test('tenant isolation: company A toggles do not affect company B', async () => {
  const off = await api('PUT', '/api/modules/inventory', { token: tokenA, body: { enabled: false } });
  assert.equal(off.status, 200);

  const bList = (await api('GET', '/api/modules', { token: tokenB })).json;
  assert.equal(bList.find(m => m.key === 'inventory').enabled, true, 'company B still has inventory enabled');

  const aList = (await api('GET', '/api/modules', { token: tokenA })).json;
  assert.equal(aList.find(m => m.key === 'inventory').enabled, false, 'company A sees its own toggle');

  // Clean up so ordering never matters for other assertions.
  await api('PUT', '/api/modules/inventory', { token: tokenA, body: { enabled: true } });
});

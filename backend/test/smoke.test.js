// ─── Smoke tests ──────────────────────────────────────────────────────────────
// Spawns the real server against a throwaway database and exercises the paths
// that matter most for a multi-tenant SaaS: auth, tenant isolation, access
// control, and brute-force protection. Run with: npm test
//
// Uses only Node built-ins (node:test + global fetch) — no extra dependencies.

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const PORT = 3199;
const BASE = `http://localhost:${PORT}`;
const DB_PATH = path.join(os.tmpdir(), `mes-test-${Date.now()}.db`);

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

before(async () => { await startServer(); });
after(() => {
  if (server) server.kill('SIGTERM');
  for (const ext of ['', '-shm', '-wal']) { try { fs.unlinkSync(DB_PATH + ext); } catch { /* ignore */ } }
});

test('health check responds ok', async () => {
  const { status, json } = await api('GET', '/api/health');
  assert.equal(status, 200);
  assert.equal(json.status, 'ok');
});

test('protected routes reject unauthenticated requests', async () => {
  const { status } = await api('GET', '/api/work-orders');
  assert.equal(status, 401);
});

test('signup creates an organization, session, and a Main Site', async () => {
  const { status, json } = await api('POST', '/api/auth/signup', {
    body: { company_name: 'Acme Mfg', email: 'owner@acme.test', password: 'supersecret1', display_name: 'Acme Owner' },
  });
  assert.equal(status, 201);
  assert.ok(json.token, 'returns a session token');
  assert.equal(json.user.role, 'developer', 'first user is a developer/admin');

  const me = await api('GET', '/api/auth/me', { token: json.token });
  assert.equal(me.status, 200);
  assert.equal(me.json.email, 'owner@acme.test');

  const sites = await api('GET', '/api/sites', { token: json.token });
  assert.equal(sites.status, 200);
  assert.equal(sites.json.length, 1, 'new org has exactly one site');
  assert.equal(sites.json[0].is_primary, 1);
});

test('signup rejects weak passwords and duplicate emails', async () => {
  const weak = await api('POST', '/api/auth/signup', {
    body: { company_name: 'X', email: 'weak@x.test', password: 'short', display_name: 'X' },
  });
  assert.equal(weak.status, 400);

  const dupe = await api('POST', '/api/auth/signup', {
    body: { company_name: 'Acme Two', email: 'owner@acme.test', password: 'supersecret1', display_name: 'Dupe' },
  });
  assert.equal(dupe.status, 409);
});

test('tenant isolation: one company cannot see another company data', async () => {
  // Company A creates a work order.
  const a = await api('POST', '/api/auth/signup', {
    body: { company_name: 'Alpha Co', email: 'a@alpha.test', password: 'supersecret1', display_name: 'A' },
  });
  const aWo = await api('POST', '/api/work-orders', {
    token: a.json.token,
    body: { part_number: 'A-PART', part_name: 'Alpha Part', quantity: 10 },
  });
  assert.equal(aWo.status, 201);

  // Company B should see none of Company A's work orders.
  const b = await api('POST', '/api/auth/signup', {
    body: { company_name: 'Beta Co', email: 'b@beta.test', password: 'supersecret1', display_name: 'B' },
  });
  const bList = await api('GET', '/api/work-orders', { token: b.json.token });
  assert.equal(bList.status, 200);
  assert.equal(bList.json.length, 0, 'Company B sees zero work orders');

  // And Company A still sees its own.
  const aList = await api('GET', '/api/work-orders', { token: a.json.token });
  assert.equal(aList.json.length, 1);
});

test('login throttles brute-force attempts', async () => {
  let sawRateLimit = false;
  for (let i = 0; i < 30; i++) {
    const { status } = await api('POST', '/api/auth/login', {
      body: { email: 'nobody@nowhere.test', password: 'wrong' },
    });
    if (status === 429) { sawRateLimit = true; break; }
  }
  assert.ok(sawRateLimit, 'repeated failed logins eventually return 429');
});

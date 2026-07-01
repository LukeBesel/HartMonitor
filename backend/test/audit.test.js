// ─── Security / bug-fix regression tests ────────────────────────────────────
// Covers the fixes made during the paid backend audit: cross-tenant reference
// leaks, enum validation, mass-assignment, NaN pagination crashes, duplicate
// email handling, and stored-XSS via SVG upload.
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
const DB_PATH = path.join(os.tmpdir(), `mes-audit-${Date.now()}.db`);

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

let tokenA, tokenB, deptB;

before(async () => {
  await startServer();
  const a = await api('POST', '/api/auth/signup', {
    body: { company_name: 'Audit Alpha', email: 'a@audit.test', password: 'supersecret1', display_name: 'A' },
  });
  tokenA = a.json.token;
  const b = await api('POST', '/api/auth/signup', {
    body: { company_name: 'Audit Beta', email: 'b@audit.test', password: 'supersecret1', display_name: 'B' },
  });
  tokenB = b.json.token;
  const dept = await api('POST', '/api/departments', { token: tokenB, body: { name: 'Beta Dept' } });
  deptB = dept.json.id;
});

after(() => {
  if (server) server.kill('SIGTERM');
  for (const ext of ['', '-shm', '-wal']) { try { fs.unlinkSync(DB_PATH + ext); } catch { /* ignore */ } }
});

test('work order cannot reference another tenant department (cross-tenant leak)', async () => {
  const wo = await api('POST', '/api/work-orders', {
    token: tokenA,
    body: { part_number: 'P1', part_name: 'Part 1', quantity: 5, department_id: deptB },
  });
  assert.equal(wo.status, 201);
  // The foreign department must be dropped, not silently stored.
  assert.equal(wo.json.department_id, null, 'cross-tenant department_id is nulled out');
  assert.notEqual(wo.json.department_name, 'Beta Dept', 'no cross-tenant name leaked');
});

test('work order rejects invalid status/priority enums', async () => {
  const bad = await api('POST', '/api/work-orders', {
    token: tokenA,
    body: { part_number: 'P2', part_name: 'Part 2', quantity: 1, status: 'bogus' },
  });
  assert.equal(bad.status, 400);

  const badPr = await api('POST', '/api/work-orders', {
    token: tokenA,
    body: { part_number: 'P3', part_name: 'Part 3', quantity: 1, priority: 'ultra' },
  });
  assert.equal(badPr.status, 400);
});

test('work order PUT cannot repoint department to another tenant', async () => {
  const wo = await api('POST', '/api/work-orders', {
    token: tokenA,
    body: { part_number: 'P4', part_name: 'Part 4', quantity: 2 },
  });
  const upd = await api('PUT', `/api/work-orders/${wo.json.id}`, {
    token: tokenA,
    body: { department_id: deptB },
  });
  assert.equal(upd.status, 200);
  assert.equal(upd.json.department_id, null, 'cross-tenant department_id nulled on update');
});

test('completions pagination survives a non-numeric limit (no crash)', async () => {
  const r = await api('GET', '/api/completions?limit=not-a-number', { token: tokenA });
  assert.equal(r.status, 200, 'NaN limit does not 500');
  assert.ok(Array.isArray(r.json));
});

test('user update surfaces duplicate email as 409, not 500', async () => {
  // Create a second user in company A, then try to rename them to the owner email.
  const created = await api('POST', '/api/users', {
    token: tokenA,
    body: { email: 'second@audit.test', display_name: 'Second', password: 'supersecret1', role: 'viewer' },
  });
  assert.equal(created.status, 201);
  const dup = await api('PUT', `/api/users/${created.json.id}`, {
    token: tokenA,
    body: { email: 'a@audit.test' },
  });
  assert.equal(dup.status, 409, 'duplicate email returns 409');
});

test('upload rejects SVG containing script (stored XSS guard)', async () => {
  const evil = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>').toString('base64');
  const r = await api('POST', '/api/upload/image', {
    token: tokenA,
    body: { data: evil, mimeType: 'image/svg+xml', filename: 'x.svg' },
  });
  assert.equal(r.status, 400, 'malicious SVG rejected');
});

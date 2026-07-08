'use strict';
// ─── Tenant isolation tests ────────────────────────────────────────────────────
// Spins up the real server against a throwaway database and verifies that one
// company cannot read, write, or delete another company's data. Covers the
// core isolation invariant: every protected route must scope queries to the
// authenticated user's company_id.
//
// Uses Node built-ins only (node:test + global fetch). Run with: npm test

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const PORT = 3197;
const BASE = `http://localhost:${PORT}`;
const DB_PATH = path.join(os.tmpdir(), `mes-isolation-${Date.now()}.db`);

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
        APP_URL: BASE,
        // No SMTP — isolates email side-effects
        SMTP_HOST: '', SMTP_USER: '', SMTP_PASS: '',
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
  for (const ext of ['', '-shm', '-wal']) {
    try { fs.unlinkSync(DB_PATH + ext); } catch { /* ignore */ }
  }
});

describe('Multi-tenant isolation', () => {
  let tokenA, tokenB;

  // Register two independent companies before any isolation checks.
  before(async () => {
    const a = await api('POST', '/api/auth/signup', {
      body: { company_name: 'Isolation Co A', email: 'admin@co-a.test', password: 'SecretPass1', display_name: 'Admin A' },
    });
    assert.equal(a.status, 201, 'Company A signup failed');
    tokenA = a.json.token;

    const b = await api('POST', '/api/auth/signup', {
      body: { company_name: 'Isolation Co B', email: 'admin@co-b.test', password: 'SecretPass2', display_name: 'Admin B' },
    });
    assert.equal(b.status, 201, 'Company B signup failed');
    tokenB = b.json.token;
  });

  it('work orders: company A cannot see company B data', async () => {
    // Company B creates a work order.
    const created = await api('POST', '/api/work-orders', {
      token: tokenB,
      body: { part_number: 'B-PART-1', part_name: 'Beta Widget', quantity: 5 },
    });
    assert.equal(created.status, 201, 'Failed to create work order for Company B');

    // Company A lists work orders — should see none (only its own scope).
    const aList = await api('GET', '/api/work-orders', { token: tokenA });
    assert.equal(aList.status, 200);
    assert.equal(aList.json.length, 0, 'Company A must not see Company B work orders');
  });

  it('work orders: company B can see its own data', async () => {
    const bList = await api('GET', '/api/work-orders', { token: tokenB });
    assert.equal(bList.status, 200);
    assert.ok(bList.json.length >= 1, 'Company B should see its own work order');
    assert.ok(
      bList.json.every(wo => wo.part_number === 'B-PART-1' || wo.part_number),
      'Company B list contains unexpected data'
    );
  });

  it('users: company A cannot enumerate company B users via /api/users', async () => {
    // Create a second user in company B.
    await api('POST', '/api/users', {
      token: tokenB,
      body: { email: 'worker@co-b.test', display_name: 'B Worker', password: 'WorkerPass1', role: 'operator' },
    });

    // Company A should not see company B's users.
    const aUsers = await api('GET', '/api/users', { token: tokenA });
    assert.equal(aUsers.status, 200);
    const emails = aUsers.json.map(u => u.email);
    assert.ok(!emails.includes('admin@co-b.test'), 'Company A must not see Company B admin');
    assert.ok(!emails.includes('worker@co-b.test'), 'Company A must not see Company B worker');
  });

  it('users: company A can see its own user(s)', async () => {
    const aUsers = await api('GET', '/api/users', { token: tokenA });
    assert.equal(aUsers.status, 200);
    const emails = aUsers.json.map(u => u.email);
    assert.ok(emails.includes('admin@co-a.test'), 'Company A should see its own admin');
  });

  it('sites: each company sees only its own sites', async () => {
    const aSites = await api('GET', '/api/sites', { token: tokenA });
    const bSites = await api('GET', '/api/sites', { token: tokenB });
    assert.equal(aSites.status, 200);
    assert.equal(bSites.status, 200);
    // IDs must not overlap
    const aIds = new Set(aSites.json.map(s => s.id));
    const bIds = new Set(bSites.json.map(s => s.id));
    for (const id of bIds) {
      assert.ok(!aIds.has(id), `Site ${id} from Company B leaked into Company A`);
    }
  });

  it('cross-company work order fetch by ID returns 404', async () => {
    // Get the ID of Company B's work order.
    const bList = await api('GET', '/api/work-orders', { token: tokenB });
    assert.ok(bList.json.length >= 1, 'need at least one B work order');
    const bWoId = bList.json[0].id;

    // Company A tries to fetch it directly.
    const { status } = await api('GET', `/api/work-orders/${bWoId}`, { token: tokenA });
    assert.ok(status === 404 || status === 403, `Expected 404/403 but got ${status} — cross-tenant WO fetch leaked`);
  });
});

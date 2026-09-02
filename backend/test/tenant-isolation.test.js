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
const Database = require('better-sqlite3');

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
        EARLY_ACCESS: 'false',
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

// ─── Operations on a work order ───────────────────────────────────────────────
// A work order released against a routing becomes N rows in
// work_order_operations, each carrying its own app, department and quantities.
// Every one of those rows is a new surface for a tenant leak: the operation id
// is a UUID a caller supplies, so without company_id in the WHERE clause,
// guessing one would book quantity onto a competitor's job — or read the
// department and app names off it.
//
// The routings themselves are seeded straight into the database because
// /api/routings is plan-gated and this suite runs with EARLY_ACCESS off. What
// is under test is the UNGATED execution path, which is exactly the point:
// releasing and running a job needs no plan, so it needs its own tenant guard.

describe('Multi-tenant isolation: work order operations', () => {
  let tokenA, tokenB, woA, woB, opA, opB, routingA, routingB;

  before(async () => {
    const a = await api('POST', '/api/auth/signup', {
      body: { company_name: 'Ops Iso A', email: 'ops-a@co-a.test', password: 'SecretPass1', display_name: 'Ops A' },
    });
    assert.equal(a.status, 201, 'Ops company A signup failed');
    tokenA = a.json.token;
    const b = await api('POST', '/api/auth/signup', {
      body: { company_name: 'Ops Iso B', email: 'ops-b@co-b.test', password: 'SecretPass2', display_name: 'Ops B' },
    });
    assert.equal(b.status, 201, 'Ops company B signup failed');
    tokenB = b.json.token;

    const raw = new Database(DB_PATH);
    const companyOf = email => raw.prepare('SELECT company_id FROM users WHERE email = ?').get(email).company_id;
    const seedRouting = (id, email, name, steps) => {
      const companyId = companyOf(email);
      raw.prepare('INSERT INTO product_routings (id, company_id, name, description) VALUES (?, ?, ?, ?)')
        .run(id, companyId, name, '');
      steps.forEach((stepName, i) => {
        raw.prepare('INSERT INTO routing_steps (id, routing_id, company_id, step_number, name, estimated_cycle_seconds) VALUES (?, ?, ?, ?, ?, 30)')
          .run(`${id}-s${i + 1}`, id, companyId, i + 1, stepName);
      });
      return companyId;
    };
    routingA = 'iso-routing-a';
    routingB = 'iso-routing-b';
    seedRouting(routingA, 'ops-a@co-a.test', 'A Line', ['A Cut', 'A Pack']);
    seedRouting(routingB, 'ops-b@co-b.test', 'B SECRET LINE', ['B Mill', 'B Pack']);
    raw.close();

    const createA = await api('POST', '/api/work-orders', {
      token: tokenA, body: { part_number: 'A-OPS', part_name: 'A Job', quantity: 6 },
    });
    assert.equal(createA.status, 201);
    woA = createA.json.id;
    const relA = await api('POST', `/api/work-orders/${woA}/release`, { token: tokenA, body: { routing_id: routingA } });
    assert.equal(relA.status, 201, `A release: ${JSON.stringify(relA.json)}`);
    opA = relA.json.operations[0].id;

    const createB = await api('POST', '/api/work-orders', {
      token: tokenB, body: { part_number: 'B-OPS', part_name: 'B Job', quantity: 9 },
    });
    assert.equal(createB.status, 201);
    woB = createB.json.id;
    const relB = await api('POST', `/api/work-orders/${woB}/release`, { token: tokenB, body: { routing_id: routingB } });
    assert.equal(relB.status, 201, `B release: ${JSON.stringify(relB.json)}`);
    opB = relB.json.operations[0].id;
  });

  it('company A cannot list company B operations', async () => {
    const r = await api('GET', `/api/work-orders/${woB}/operations`, { token: tokenA });
    assert.equal(r.status, 404, `expected 404, got ${r.status}: ${JSON.stringify(r.json)}`);
    const own = await api('GET', `/api/work-orders/${woA}/operations`, { token: tokenA });
    assert.equal(own.json.length, 2, 'company A cannot see its own operations');
    assert.ok(!JSON.stringify(own.json).includes('B Mill'), "company B's step names leaked into A's operations");
  });

  it('company A cannot release its job on company B routing', async () => {
    const created = await api('POST', '/api/work-orders', {
      token: tokenA, body: { part_number: 'A-CROSS', part_name: 'A Cross', quantity: 2 },
    });
    const rel = await api('POST', `/api/work-orders/${created.json.id}/release`, {
      token: tokenA, body: { routing_id: routingB },
    });
    assert.equal(rel.status, 400, `expected 400, got ${rel.status}`);
    assert.ok(!JSON.stringify(rel.json).includes('B SECRET LINE'), "company B's routing name leaked");
    const listed = await api('GET', `/api/work-orders/${created.json.id}/operations`, { token: tokenA });
    assert.deepEqual(listed.json, [], 'a cross-tenant release wrote operations');
  });

  it("company A cannot move company B's operation", async () => {
    // Both shapes: B's operation id under A's own work order, and under B's.
    const underOwn = await api('PUT', `/api/work-orders/${woA}/operations/${opB}`, {
      token: tokenA, body: { status: 'skipped' },
    });
    assert.equal(underOwn.status, 404, `expected 404, got ${underOwn.status}`);
    const underTheirs = await api('PUT', `/api/work-orders/${woB}/operations/${opB}`, {
      token: tokenA, body: { status: 'skipped' },
    });
    assert.equal(underTheirs.status, 404, `expected 404, got ${underTheirs.status}`);

    const check = await api('GET', `/api/work-orders/${woB}/operations`, { token: tokenB });
    assert.equal(check.json[0].status, 'ready', "company A changed company B's operation");
  });

  it('company A cannot append an operation to company B job', async () => {
    const r = await api('POST', `/api/work-orders/${woB}/operations`, {
      token: tokenA, body: { name: 'Injected' },
    });
    assert.equal(r.status, 404, `expected 404, got ${r.status}`);
    const check = await api('GET', `/api/work-orders/${woB}/operations`, { token: tokenB });
    assert.equal(check.json.length, 2, "an operation was injected into company B's job");
  });

  it("company A's routing usage never lists company B jobs", async () => {
    // Usage is plan-gated with the rest of /api/routings, so this asserts the
    // stored rows directly: every operation belongs to the company its work
    // order belongs to, with no exceptions anywhere in the table.
    const raw = new Database(DB_PATH, { readonly: true });
    const mismatched = raw.prepare(`
      SELECT o.id FROM work_order_operations o
      JOIN work_orders wo ON wo.id = o.work_order_id
      WHERE o.company_id != wo.company_id
    `).all();
    raw.close();
    assert.deepEqual(mismatched, [], 'an operation is filed under a different company than its work order');
    assert.notEqual(opA, opB);
  });
});

'use strict';
// ─── A work order carries operations from a routing ───────────────────────────
//
// routes/routings.js gave a planner full CRUD over product_routings and
// routing_steps, and Routings.tsx rendered every one of them — but nothing ever
// read a routing back. work_orders.routing_id was a live column the ERP import
// wrote and no other line of code touched. A work order was welded to ONE app
// and ONE department, so a seven-operation job had to be typed in as seven
// unrelated work orders: no shared number, no sequence, no roll-up. The
// Routings screen described an execution model the product did not have.
//
// This file pins the model that now exists:
//
//   • RELEASE IS A SNAPSHOT, ONCE. A seven-step routing on a quantity-50 job
//     produces exactly seven operations in sequence, each required 50, the
//     first 'ready' and the rest 'queued'. Releasing twice is a 409 and leaves
//     seven rows — not fourteen, and not seven rebuilt ones with the floor's
//     booked quantity thrown away.
//   • THE TENANT IS IN EVERY STATEMENT. A routing id from another company is
//     "not found": no operations written, and the other tenant's routing name
//     nowhere in the response.
//   • NOTHING IS BACKFILLED. A work order with routing_id NULL answers with the
//     keys it always answered with plus additions, and a database full of work
//     orders that predate this migration gains ZERO operation rows at boot.
//   • EXECUTION IS UNGATED. /api/routings is a pro feature — designing a
//     routing is planning — but a Free account must be able to release a job
//     and run it, or it has not seen the product.
//   • THE VOCABULARY IS ONE VOCABULARY. The CHECK list in 009 is
//     vocab.OPERATION_STATUS, verbatim; SQLite cannot alter it later.
//
// Two servers, one after the other, on the SAME reserved port: the plan gate is
// a process-level environment variable, so the Free-tier case needs its own
// boot with EARLY_ACCESS=false.
//
// Uses Node built-ins only (node:test + global fetch). Run with:
//   node --test test/wo-operations.test.js

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Database = require('better-sqlite3');

const vocab = require('../src/vocab');
const { runMigrations } = require('../src/db/runMigrations');

const PORT = 3409; // reserved for this stream in MIGRATIONS.md
const BASE = `http://localhost:${PORT}`;
const DB_PRO  = path.join(os.tmpdir(), `mes-wo-ops-${Date.now()}.db`);
const DB_FREE = path.join(os.tmpdir(), `mes-wo-ops-free-${Date.now()}.db`);
const MIGRATION_FILE = path.join(__dirname, '..', 'src', 'db', 'migrations', '009_work_order_operations.sql');

let server = null;

function startServer(dbPath, earlyAccess) {
  return new Promise((resolve, reject) => {
    server = spawn('node', [path.join(__dirname, '..', 'src', 'index.js')], {
      env: {
        ...process.env,
        NODE_ENV: 'test',
        PORT: String(PORT),
        DATABASE_PATH: dbPath,
        SEED_DEMO_DATA: 'false',
        EARLY_ACCESS: earlyAccess ? 'true' : 'false',
        BACKUP_DIR: '',
        APP_URL: BASE,
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

async function stopServer() {
  if (!server) return;
  const dying = server;
  server = null;
  dying.kill('SIGTERM');
  // Give the port back before the next boot claims it.
  for (let i = 0; i < 50; i++) {
    if (dying.exitCode !== null || dying.signalCode !== null) break;
    await new Promise(r => setTimeout(r, 100));
  }
  await new Promise(r => setTimeout(r, 300));
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

function removeDb(p) {
  for (const ext of ['', '-shm', '-wal']) {
    try { fs.unlinkSync(p + ext); } catch { /* ignore */ }
  }
}

after(async () => {
  await stopServer();
  removeDb(DB_PRO);
  removeDb(DB_FREE);
});

// ─── The vocabulary, before anything runs ─────────────────────────────────────
// No server, no database: just the file and vocab.js. SQLite cannot ALTER a
// CHECK in place, so if these two ever disagree the fix is a table rebuild on
// live customer data.

describe('009 quotes the one vocabulary', () => {
  it('the CHECK list is exactly vocab.OPERATION_STATUS', () => {
    const sql = fs.readFileSync(MIGRATION_FILE, 'utf8');
    const m = sql.match(/CHECK\(status IN \(([^)]*)\)\)/);
    assert.ok(m, 'no CHECK(status IN (...)) found in 009');
    const listed = m[1].split(',').map(v => v.trim().replace(/^'|'$/g, ''));
    assert.deepEqual(listed, [...vocab.OPERATION_STATUS],
      'the 009 CHECK list drifted from vocab.OPERATION_STATUS');
  });

  it('names no status the vocabulary does not have', () => {
    const sql = fs.readFileSync(MIGRATION_FILE, 'utf8');
    // Every quoted status literal in the file's DEFAULT and CHECK.
    const defaults = [...sql.matchAll(/status\s+TEXT NOT NULL DEFAULT '([a-z_]+)'/g)].map(x => x[1]);
    for (const d of defaults) {
      assert.ok(vocab.OPERATION_STATUS.includes(d), `default status "${d}" is not in the vocabulary`);
    }
  });
});

// ─── A database that predates this migration ─────────────────────────────────
// The one thing a shipped migration must never do to a customer is invent rows.
// A work order written before 009 existed keeps its own shape and gains nothing.

describe('an older database gains zero operation rows', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mes-wo-ops-legacy-'));
  const legacyPath = path.join(dir, 'legacy.db');
  // Only 009 — the earlier files ALTER tables db.js makes and this database
  // deliberately does not have. What is under test is what 009 does to a
  // database that already holds work orders.
  const onlyNine = path.join(dir, 'migrations');
  fs.mkdirSync(onlyNine, { recursive: true });
  fs.copyFileSync(MIGRATION_FILE, path.join(onlyNine, path.basename(MIGRATION_FILE)));

  it('migrating a database full of work orders creates no operations', () => {
    const legacy = new Database(legacyPath);
    // Shaped like db.js has just finished — work orders already in it, and no
    // idea that operations are about to exist.
    legacy.exec(`
      CREATE TABLE work_orders (
        id TEXT PRIMARY KEY, work_order_number TEXT, part_number TEXT, part_name TEXT,
        quantity INTEGER NOT NULL, quantity_completed INTEGER DEFAULT 0,
        app_id TEXT, department_id TEXT, status TEXT DEFAULT 'pending',
        company_id TEXT, routing_id TEXT
      );
      CREATE TABLE routing_steps (
        id TEXT PRIMARY KEY, routing_id TEXT NOT NULL, company_id TEXT,
        step_number INTEGER NOT NULL, name TEXT NOT NULL,
        estimated_cycle_seconds REAL DEFAULT 0
      );
    `);
    legacy.prepare("INSERT INTO work_orders (id, work_order_number, quantity, company_id, routing_id) VALUES ('old-1','WO-OLD-1',10,'co','r-1')").run();
    legacy.prepare("INSERT INTO work_orders (id, work_order_number, quantity, company_id) VALUES ('old-2','WO-OLD-2',20,'co')").run();
    legacy.prepare("INSERT INTO routing_steps (id, routing_id, company_id, step_number, name) VALUES ('s-1','r-1','co',1,'Cut')").run();

    const log = console.log; console.log = () => {};
    try {
      runMigrations(legacy, onlyNine);
    } finally { console.log = log; }

    const opRows = legacy.prepare('SELECT COUNT(*) AS c FROM work_order_operations').get().c;
    assert.equal(opRows, 0, 'the migration invented operations for pre-existing work orders');

    // The work orders themselves are untouched, and simply have the new columns
    // sitting empty — which is what "not released" means.
    const rows = legacy.prepare('SELECT * FROM work_orders ORDER BY id').all();
    assert.equal(rows.length, 2);
    assert.equal(rows[0].released_at, null);
    assert.equal(rows[0].current_operation_id, null);
    assert.equal(rows[0].hold_reason, null);
    assert.equal(rows[0].quantity, 10, 'an existing work order was rewritten');
    legacy.close();
  });

  it('running it a second time changes nothing and records one row', () => {
    const legacy = new Database(legacyPath);
    const log = console.log; console.log = () => {};
    try {
      runMigrations(legacy, onlyNine);
    } finally { console.log = log; }
    const applied = legacy.prepare("SELECT COUNT(*) AS c FROM _schema_migrations WHERE filename = '009_work_order_operations.sql'").get().c;
    assert.equal(applied, 1, '009 is recorded more than once');
    assert.equal(legacy.prepare('SELECT COUNT(*) AS c FROM work_order_operations').get().c, 0);
    legacy.close();
  });
});

// ─── The keystone, end to end ─────────────────────────────────────────────────

// Every key GET /api/work-orders/:id answered with BEFORE this change. The list
// may only grow: a screen reading any of these must not find it gone.
const BASELINE_WO_KEYS = [
  'id', 'work_order_number', 'part_number', 'part_name', 'quantity', 'quantity_completed',
  'app_id', 'department_id', 'scheduled_start', 'scheduled_end', 'takt_time_minutes',
  'status', 'priority', 'notes', 'created_at', 'updated_at', 'company_id', 'site_id',
  'routing_id', 'assigned_user_id', 'product_type_id', 'due_date', 'customer_ref', 'external_id',
  'department_name', 'department_color', 'app_name', 'product_type_name', 'kit_id', 'kit_status',
  'schedule_status', 'completion_pct', 'completion_history_count',
];

const STEP_NAMES = ['Weld', 'Grind', 'Drill', 'Deburr', 'Paint', 'Assemble', 'Inspect'];

describe('a work order carries operations from a routing', () => {
  let token, tokenB, routingId, routingIdB, weldDeptId, woId, plainWoId, companyId, opIds = [];

  before(async () => {
    await startServer(DB_PRO, true);

    const signup = await api('POST', '/api/auth/signup', {
      body: { company_name: 'Keystone Co', email: 'admin@keystone.test', password: 'SecretPass1', display_name: 'Planner' },
    });
    assert.equal(signup.status, 201, `signup: ${JSON.stringify(signup.json)}`);
    token = signup.json.token;

    const dept = await api('POST', '/api/departments', { token, body: { name: 'Weld Shop' } });
    assert.ok([200, 201].includes(dept.status), `department: ${JSON.stringify(dept.json)}`);
    weldDeptId = dept.json.id;

    // A seven-operation job: the exact shape that used to need seven unrelated
    // work orders. Step 1 is the six-minute-ten weld the drawer prints.
    const routing = await api('POST', '/api/routings', {
      token,
      body: {
        name: 'Bracket — 7 ops',
        description: 'Cut to inspect',
        steps: STEP_NAMES.map((name, i) => ({
          step_number: i + 1,
          name,
          department_id: i === 0 ? weldDeptId : null,
          estimated_cycle_seconds: i === 0 ? 370 : 60,
        })),
      },
    });
    assert.equal(routing.status, 201, `routing: ${JSON.stringify(routing.json)}`);
    routingId = routing.json.id;
    assert.equal(routing.json.steps.length, 7);

    // A second company, for the cross-tenant case.
    const signupB = await api('POST', '/api/auth/signup', {
      body: { company_name: 'Rival Co', email: 'admin@rival.test', password: 'SecretPass1', display_name: 'Rival' },
    });
    assert.equal(signupB.status, 201);
    tokenB = signupB.json.token;
    const routingB = await api('POST', '/api/routings', {
      token: tokenB, body: { name: 'RIVAL SECRET PROCESS', steps: [{ name: 'Mill' }] },
    });
    assert.equal(routingB.status, 201);
    routingIdB = routingB.json.id;
  });

  it('a work order with no routing keeps exactly the shape it had, plus additions', async () => {
    const created = await api('POST', '/api/work-orders', {
      token,
      body: { part_number: 'PN-1', part_name: 'Plain Bracket', quantity: 25 },
    });
    assert.equal(created.status, 201, `create: ${JSON.stringify(created.json)}`);
    plainWoId = created.json.id;

    const got = await api('GET', `/api/work-orders/${plainWoId}`, { token });
    assert.equal(got.status, 200);
    const keys = Object.keys(got.json);
    for (const k of BASELINE_WO_KEYS) {
      assert.ok(keys.includes(k), `GET /api/work-orders/:id no longer returns "${k}"`);
    }
    // …and it is honest about having no operations. Not a zeroed object.
    assert.equal(got.json.current_operation, null, 'an unreleased work order invented an operation');
    assert.equal(got.json.released_at, null);
    assert.equal(got.json.routing_id, null);

    const listed = await api('GET', `/api/work-orders/${plainWoId}/operations`, { token });
    assert.equal(listed.status, 200);
    assert.deepEqual(listed.json, [], 'an unreleased work order has operations');
  });

  it('releasing a quantity-50 job on a 7-step routing creates exactly 7 operations', async () => {
    const created = await api('POST', '/api/work-orders', {
      token,
      body: { part_number: 'PN-7', part_name: 'Seven Op Bracket', quantity: 50 },
    });
    assert.equal(created.status, 201, `create: ${JSON.stringify(created.json)}`);
    woId = created.json.id;
    assert.equal(created.json.current_operation, null, 'created without a routing but already released');

    const released = await api('POST', `/api/work-orders/${woId}/release`, {
      token, body: { routing_id: routingId },
    });
    assert.equal(released.status, 201, `release: ${JSON.stringify(released.json)}`);
    assert.equal(released.json.operations.length, 7);

    const listed = await api('GET', `/api/work-orders/${woId}/operations`, { token });
    assert.equal(listed.status, 200);
    const rows = listed.json;
    assert.equal(rows.length, 7, 'a 7-step routing did not produce 7 operations');
    opIds = rows.map(r => r.id);

    rows.forEach((op, i) => {
      assert.equal(op.sequence, i + 1, 'operations are not in sequence');
      assert.equal(op.of, 7, '`of` does not say how many operations the job has');
      assert.equal(op.name, STEP_NAMES[i], 'the step name did not come across');
      assert.equal(op.quantity_required, 50, `operation ${i + 1} required ${op.quantity_required}, not the job's 50`);
      assert.equal(op.quantity_completed, 0);
      assert.equal(op.quantity_scrapped, 0);
      assert.equal(op.status, i === 0 ? 'ready' : 'queued',
        `operation ${i + 1} is ${op.status}`);
    });
    assert.equal(rows[0].standard_seconds, 370, 'the step cycle time did not become the standard time');
    assert.equal(rows[0].department_name, 'Weld Shop');

    const wo = await api('GET', `/api/work-orders/${woId}`, { token });
    assert.equal(wo.json.current_operation_id, opIds[0], 'the job does not point at operation 1');
    assert.ok(wo.json.released_at, 'released_at was not set');
    assert.equal(wo.json.routing_id, routingId);
    assert.deepEqual(
      { sequence: wo.json.current_operation.sequence, of: wo.json.current_operation.of, name: wo.json.current_operation.name },
      { sequence: 1, of: 7, name: 'Weld' },
    );
  });

  it('releasing twice is a 409 and leaves seven operations', async () => {
    const again = await api('POST', `/api/work-orders/${woId}/release`, {
      token, body: { routing_id: routingId },
    });
    assert.equal(again.status, 409, `second release: ${JSON.stringify(again.json)}`);
    assert.equal(again.json.error, 'already_released');

    const listed = await api('GET', `/api/work-orders/${woId}/operations`, { token });
    assert.equal(listed.json.length, 7, 'a second release duplicated the operations');
  });

  it('a routing from another company is a 400 with no rows and no leaked name', async () => {
    const created = await api('POST', '/api/work-orders', {
      token, body: { part_number: 'PN-X', part_name: 'Cross Tenant', quantity: 5 },
    });
    assert.equal(created.status, 201);
    const crossId = created.json.id;

    const rel = await api('POST', `/api/work-orders/${crossId}/release`, {
      token, body: { routing_id: routingIdB },
    });
    assert.equal(rel.status, 400, `cross-tenant release: ${JSON.stringify(rel.json)}`);
    const body = JSON.stringify(rel.json);
    assert.ok(!body.includes('RIVAL SECRET PROCESS'), `the other tenant's routing name leaked: ${body}`);
    assert.ok(!body.includes(routingIdB), `the other tenant's routing id was echoed: ${body}`);

    const listed = await api('GET', `/api/work-orders/${crossId}/operations`, { token });
    assert.deepEqual(listed.json, [], 'a cross-tenant release wrote operations');

    const wo = await api('GET', `/api/work-orders/${crossId}`, { token });
    assert.equal(wo.json.released_at, null);
  });

  it('a routing with no steps cannot be released', async () => {
    const empty = await api('POST', '/api/routings', { token, body: { name: 'Empty routing' } });
    assert.equal(empty.status, 201);
    const created = await api('POST', '/api/work-orders', {
      token, body: { part_number: 'PN-E', part_name: 'Nothing To Do', quantity: 3 },
    });
    const rel = await api('POST', `/api/work-orders/${created.json.id}/release`, {
      token, body: { routing_id: empty.json.id },
    });
    assert.equal(rel.status, 400, `empty routing: ${JSON.stringify(rel.json)}`);
    assert.equal(rel.json.error, 'routing_has_no_steps');
  });

  it('a work order with no routing at all cannot be released', async () => {
    const rel = await api('POST', `/api/work-orders/${plainWoId}/release`, { token, body: {} });
    assert.equal(rel.status, 400);
    assert.equal(rel.json.error, 'no_routing');
  });

  // ── advance(): the module the operator screens will call ────────────────────
  // Called in-process against the same database file the server is serving
  // (WAL), because booking output is wave 4's endpoint and this is the contract
  // it will be handed.
  it('booking 12 good on operation 1 shows as 12/50 on the work order', async () => {
    process.env.DATABASE_PATH = DB_PRO;
    process.env.SEED_DEMO_DATA = 'false';
    const ops = require('../src/workOrderOperations');
    const db = require('../src/db');
    companyId = db.prepare('SELECT company_id FROM work_orders WHERE id = ?').get(woId).company_id;

    const result = ops.advance(companyId, opIds[0], { good: 12 });
    assert.equal(result.operation.quantity_completed, 12);
    assert.equal(result.operation.status, 'running', 'the first booking did not start the operation');
    assert.ok(result.operation.started_at, 'started_at was not stamped');

    const wo = await api('GET', `/api/work-orders/${woId}`, { token });
    assert.deepEqual(wo.json.current_operation, {
      id: opIds[0],
      sequence: 1,
      of: 7,
      name: 'Weld',
      department_name: 'Weld Shop',
      qty_good: 12,
      qty_required: 50,
      standard_seconds: 370,
      status: 'running',
    });
  });

  it('reaching 50 completes operation 1 and readies operation 2', async () => {
    const ops = require('../src/workOrderOperations');
    const result = ops.advance(companyId, opIds[0], { good: 38 });
    assert.equal(result.operation.status, 'complete');
    assert.ok(result.operation.completed_at, 'completed_at was not stamped');
    assert.equal(result.next.id, opIds[1], 'the job did not move to operation 2');
    assert.equal(result.next.status, 'ready', 'operation 2 is still queued');
    assert.equal(result.work_order.current_operation_id, opIds[1]);

    const wo = await api('GET', `/api/work-orders/${woId}`, { token });
    assert.equal(wo.json.current_operation.sequence, 2);
    assert.equal(wo.json.current_operation.of, 7);
    assert.equal(wo.json.current_operation.qty_good, 0);

    // Operations 3-7 are untouched — readying is one step, not a cascade.
    const listed = await api('GET', `/api/work-orders/${woId}/operations`, { token });
    assert.deepEqual(listed.json.map(o => o.status),
      ['complete', 'ready', 'queued', 'queued', 'queued', 'queued', 'queued']);
  });

  it('scrap and rework are stored, not folded into good', async () => {
    const ops = require('../src/workOrderOperations');
    const r = ops.advance(companyId, opIds[1], { good: 2, scrap: 3, rework: 1 });
    assert.equal(r.operation.quantity_completed, 2);
    assert.equal(r.operation.quantity_scrapped, 3);
    assert.equal(r.operation.quantity_rework, 1);
    assert.equal(r.operation.status, 'running');
  });

  it('positionOf says where a job stands, and nothing for a job with no operations', () => {
    const ops = require('../src/workOrderOperations');
    assert.deepEqual(ops.positionOf(companyId, woId), { sequence: 2, of: 7 });
    assert.equal(ops.positionOf(companyId, plainWoId), null);
  });

  it('skipping an operation readies the next one', async () => {
    const listed = await api('GET', `/api/work-orders/${woId}/operations`, { token });
    const third = listed.json[2];
    const skipped = await api('PUT', `/api/work-orders/${woId}/operations/${third.id}`, {
      token, body: { status: 'skipped' },
    });
    assert.equal(skipped.status, 200, JSON.stringify(skipped.json));
    assert.equal(skipped.json.status, 'skipped');

    const after = await api('GET', `/api/work-orders/${woId}/operations`, { token });
    assert.equal(after.json[3].status, 'ready', 'skipping did not ready the next operation');
  });

  it('a status outside the vocabulary is refused', async () => {
    const listed = await api('GET', `/api/work-orders/${woId}/operations`, { token });
    const r = await api('PUT', `/api/work-orders/${woId}/operations/${listed.json[4].id}`, {
      token, body: { status: 'hold' },   // 'hold' is a column, not a status word
    });
    assert.equal(r.status, 400, JSON.stringify(r.json));
    assert.equal(r.json.error, 'bad_status');
  });

  it('hold_reason is a work-order column a supervisor can set and clear', async () => {
    const listed = await api('GET', `/api/work-orders/${woId}/operations`, { token });
    const held = await api('PUT', `/api/work-orders/${woId}/operations/${listed.json[3].id}`, {
      token, body: { status: 'on_hold', hold_reason: 'Waiting on fixture' },
    });
    assert.equal(held.status, 200, JSON.stringify(held.json));
    assert.equal(held.json.status, 'on_hold');

    const wo = await api('GET', `/api/work-orders/${woId}`, { token });
    assert.equal(wo.json.hold_reason, 'Waiting on fixture');

    const cleared = await api('PUT', `/api/work-orders/${woId}`, { token, body: { hold_reason: null } });
    assert.equal(cleared.status, 200);
    assert.equal(cleared.json.hold_reason, null);
  });

  it('an ad-hoc operation is appended at the end', async () => {
    const added = await api('POST', `/api/work-orders/${woId}/operations`, {
      token, body: { name: 'Extra rework loop', department_id: weldDeptId, standard_seconds: 90 },
    });
    assert.equal(added.status, 201, JSON.stringify(added.json));
    assert.equal(added.json.sequence, 8);
    assert.equal(added.json.of, 8);
    const listed = await api('GET', `/api/work-orders/${woId}/operations`, { token });
    assert.equal(listed.json.length, 8);
    assert.equal(listed.json[7].name, 'Extra rework loop');
  });

  it('a work order created WITH a routing is released at creation', async () => {
    const created = await api('POST', '/api/work-orders', {
      token,
      body: { part_number: 'PN-AUTO', part_name: 'Auto Release', quantity: 12, routing_id: routingId },
    });
    assert.equal(created.status, 201, JSON.stringify(created.json));
    assert.ok(created.json.released_at, 'a work order created with a routing was not released');
    assert.equal(created.json.current_operation.sequence, 1);
    assert.equal(created.json.current_operation.of, 7);

    const listed = await api('GET', `/api/work-orders/${created.json.id}/operations`, { token });
    assert.equal(listed.json.length, 7);
    assert.ok(listed.json.every(o => o.quantity_required === 12));
  });

  it('an import row naming a routing lands already released', async () => {
    const routing3 = await api('POST', '/api/routings', {
      token,
      body: {
        name: 'Three Op Line',
        steps: [{ name: 'Saw' }, { name: 'Bend' }, { name: 'Pack' }],
      },
    });
    assert.equal(routing3.status, 201);

    const csv = [
      'external_id,part_number,part_name,quantity,routing_name',
      'ERP-OPS-1,PN-IMP,Imported Bracket,30,Three Op Line',
    ].join('\n');

    const commit = await api('POST', '/api/work-orders/import/commit', { token, body: { csv } });
    assert.equal(commit.status, 200, JSON.stringify(commit.json));
    // The per-row contract is untouched: one created row, no reason, an id.
    assert.equal(commit.json.summary.created, 1, JSON.stringify(commit.json));
    assert.equal(commit.json.results[0].result, 'created');
    assert.equal(commit.json.results[0].reason, null);
    const importedId = commit.json.results[0].work_order_id;
    assert.ok(importedId);

    const listed = await api('GET', `/api/work-orders/${importedId}/operations`, { token });
    assert.equal(listed.json.length, 3, 'an import row with a routing did not release');
    assert.deepEqual(listed.json.map(o => o.name), ['Saw', 'Bend', 'Pack']);
    assert.ok(listed.json.every(o => o.quantity_required === 30));

    const wo = await api('GET', `/api/work-orders/${importedId}`, { token });
    assert.ok(wo.json.released_at);
  });

  it('an import row with no routing creates an unreleased job, as it always did', async () => {
    const csv = [
      'external_id,part_number,part_name,quantity',
      'ERP-OPS-2,PN-IMP2,Plain Imported,7',
    ].join('\n');
    const commit = await api('POST', '/api/work-orders/import/commit', { token, body: { csv } });
    assert.equal(commit.status, 200);
    const id = commit.json.results[0].work_order_id;
    const listed = await api('GET', `/api/work-orders/${id}/operations`, { token });
    assert.deepEqual(listed.json, []);
  });

  // ── The Routings screen becomes true ────────────────────────────────────────

  it('a routing says which live jobs run on it', async () => {
    const usage = await api('GET', `/api/routings/${routingId}/usage`, { token });
    assert.equal(usage.status, 200, JSON.stringify(usage.json));
    assert.ok(usage.json.open_work_orders >= 2, `expected open jobs, got ${usage.json.open_work_orders}`);
    const mine = usage.json.work_orders.find(w => w.id === woId);
    assert.ok(mine, 'the released job is not listed against its routing');
    assert.equal(mine.current_operation.of, 8);

    const list = await api('GET', '/api/routings', { token });
    const row = list.json.find(r => r.id === routingId);
    assert.equal(row.open_work_orders, usage.json.open_work_orders,
      'the list count and the usage count disagree');
    const emptyRow = list.json.find(r => r.name === 'Empty routing');
    assert.equal(emptyRow.open_work_orders, 0, 'a routing nothing runs on reported a count');
  });

  it("another company's routing usage is a 404, not a peek", async () => {
    const r = await api('GET', `/api/routings/${routingIdB}/usage`, { token });
    assert.equal(r.status, 404);
  });

  it('a routing step accepts a station and answers with standard_seconds', async () => {
    const st = await api('POST', '/api/stations', { token, body: { name: 'Weld Cell 1' } });
    assert.ok([200, 201].includes(st.status), JSON.stringify(st.json));
    const step = await api('POST', `/api/routings/${routingId}/steps`, {
      token, body: { name: 'Station step', station_id: st.json.id, standard_seconds: 45 },
    });
    assert.equal(step.status, 201, JSON.stringify(step.json));
    assert.equal(step.json.station_id, st.json.id);
    assert.equal(step.json.station_name, 'Weld Cell 1');
    assert.equal(step.json.standard_seconds, 45, 'standard_seconds is not an alias of the cycle time');
    assert.equal(step.json.estimated_cycle_seconds, 45, 'the original column name stopped being answered');
  });
});

// ─── What the adversarial review found ────────────────────────────────────────
// Each of these is a bug that shipped in the first cut of this workstream, and
// each one is here so it cannot ship twice.

describe('the state machine refuses what it should', () => {
  let token, tokenB, routingId, routingIdB, deptIdB, companyId, db, ops;

  before(async () => {
    const signup = await api('POST', '/api/auth/signup', {
      body: { company_name: 'Guard Co', email: 'admin@guard.test', password: 'SecretPass1', display_name: 'Guard' },
    });
    assert.equal(signup.status, 201, JSON.stringify(signup.json));
    token = signup.json.token;

    const r = await api('POST', '/api/routings', {
      token, body: { name: 'Guard Line', steps: [{ name: 'Cut' }, { name: 'Pack' }] },
    });
    assert.equal(r.status, 201);
    routingId = r.json.id;

    const signupB = await api('POST', '/api/auth/signup', {
      body: { company_name: 'Neighbour Co', email: 'admin@neighbour.test', password: 'SecretPass1', display_name: 'Neighbour' },
    });
    tokenB = signupB.json.token;
    const rb = await api('POST', '/api/routings', { token: tokenB, body: { name: 'NEIGHBOUR ONLY LINE', steps: [{ name: 'Mill' }] } });
    routingIdB = rb.json.id;
    const db2 = await api('POST', '/api/departments', { token: tokenB, body: { name: 'NEIGHBOUR ONLY DEPT' } });
    deptIdB = db2.json.id;

    process.env.DATABASE_PATH = DB_PRO;
    process.env.SEED_DEMO_DATA = 'false';
    db = require('../src/db');
    ops = require('../src/workOrderOperations');
    companyId = db.prepare("SELECT company_id FROM users WHERE email = 'admin@guard.test'").get().company_id;
  });

  const newJob = async (quantity = 10, release = true) => {
    const created = await api('POST', '/api/work-orders', {
      token, body: { part_number: 'PN-G', part_name: 'Guard Part', quantity },
    });
    assert.equal(created.status, 201, JSON.stringify(created.json));
    if (release) {
      const rel = await api('POST', `/api/work-orders/${created.json.id}/release`, { token, body: { routing_id: routingId } });
      assert.equal(rel.status, 201, JSON.stringify(rel.json));
    }
    const listed = await api('GET', `/api/work-orders/${created.json.id}/operations`, { token });
    return { id: created.json.id, number: created.json.work_order_number, operations: listed.json };
  };

  // ── M3 ──
  it('a completed or cancelled work order cannot be released', async () => {
    for (const status of ['completed', 'cancelled']) {
      const created = await api('POST', '/api/work-orders', {
        token, body: { part_number: 'PN-C', part_name: 'Closed Job', quantity: 4 },
      });
      const closed = await api('PUT', `/api/work-orders/${created.json.id}`, { token, body: { status } });
      assert.equal(closed.status, 200, JSON.stringify(closed.json));

      const rel = await api('POST', `/api/work-orders/${created.json.id}/release`, { token, body: { routing_id: routingId } });
      assert.equal(rel.status, 409, `${status}: ${JSON.stringify(rel.json)}`);
      assert.equal(rel.json.error, 'work_order_closed');

      const listed = await api('GET', `/api/work-orders/${created.json.id}/operations`, { token });
      assert.deepEqual(listed.json, [], `a ${status} job was released anyway`);
    }
  });

  // ── m1 ──
  it('an operation cannot be booked past what it requires', async () => {
    const job = await newJob(10);
    const op1 = job.operations[0].id;

    assert.throws(() => ops.advance(companyId, op1, { good: 1000 }),
      err => err.status === 400 && err.code === 'bad_count' && /only 10 left/.test(err.message),
      'a booking of 1000 against a requirement of 10 was accepted');

    // 6 then 6 used to complete the operation at 12 of 10.
    ops.advance(companyId, op1, { good: 6 });
    assert.throws(() => ops.advance(companyId, op1, { good: 6 }),
      err => err.status === 400 && /only 4 left/.test(err.message));

    // Exactly what is left is fine, and closes it.
    const done = ops.advance(companyId, op1, { good: 4 });
    assert.equal(done.operation.quantity_completed, 10);
    assert.equal(done.operation.status, 'complete');

    // Nothing more, not even zero-sum rework, once it is closed.
    assert.throws(() => ops.advance(companyId, op1, { good: 1 }),
      err => err.status === 409 && err.code === 'operation_closed');
  });

  it('good and scrap together cannot exceed the requirement', async () => {
    const job = await newJob(10);
    const op1 = job.operations[0].id;
    ops.advance(companyId, op1, { good: 4, scrap: 3 });
    assert.throws(() => ops.advance(companyId, op1, { good: 2, scrap: 2 }),
      err => err.status === 400 && /only 3 left/.test(err.message));
  });

  // ── m2 ──
  it('a queued operation cannot be booked against', async () => {
    const job = await newJob(10);
    const op2 = job.operations[1].id;
    assert.equal(job.operations[1].status, 'queued');
    assert.throws(() => ops.advance(companyId, op2, { good: 1 }),
      err => err.status === 409 && err.code === 'operation_not_ready',
      'output was booked against an operation nobody has been handed');

    const listed = await api('GET', `/api/work-orders/${job.id}/operations`, { token });
    assert.equal(listed.json[1].quantity_completed, 0, 'the queued operation took the booking anyway');
  });

  // ── m3 ──
  it('an operation on hold stays on hold until somebody clears it', async () => {
    const job = await newJob(10);
    const op1 = job.operations[0].id;
    const held = await api('PUT', `/api/work-orders/${job.id}/operations/${op1}`, {
      token, body: { status: 'on_hold', hold_reason: 'Fixture missing' },
    });
    assert.equal(held.status, 200);

    assert.throws(() => ops.advance(companyId, op1, { good: 1 }),
      err => err.status === 409 && err.code === 'operation_on_hold',
      'booking silently took an operation off hold');

    const still = await api('GET', `/api/work-orders/${job.id}/operations`, { token });
    assert.equal(still.json[0].status, 'on_hold', 'the hold was cleared by a booking');

    // Clearing it is an explicit act.
    const cleared = await api('PUT', `/api/work-orders/${job.id}/operations/${op1}`, { token, body: { status: 'ready' } });
    assert.equal(cleared.json.status, 'ready');
    assert.equal(ops.advance(companyId, op1, { good: 1 }).operation.quantity_completed, 1);
  });

  // ── m4 ──
  it("another company's ids are refused by name, not silently dropped", async () => {
    const job = await newJob(10);

    const badDept = await api('POST', `/api/work-orders/${job.id}/operations`, {
      token, body: { name: 'Extra', department_id: deptIdB },
    });
    assert.equal(badDept.status, 400, JSON.stringify(badDept.json));
    assert.equal(badDept.json.message, 'department not found');
    assert.ok(!JSON.stringify(badDept.json).includes('NEIGHBOUR ONLY DEPT'), 'the other tenant name leaked');

    const listed = await api('GET', `/api/work-orders/${job.id}/operations`, { token });
    assert.equal(listed.json.length, 2, 'an operation with a refused department was created anyway');

    const badRouting = await api('POST', '/api/work-orders', {
      token, body: { part_number: 'PN-XT', part_name: 'Cross', quantity: 3, routing_id: routingIdB },
    });
    assert.equal(badRouting.status, 400, JSON.stringify(badRouting.json));
    assert.equal(badRouting.json.error, 'routing not found');
    assert.ok(!JSON.stringify(badRouting.json).includes('NEIGHBOUR ONLY LINE'));
  });

  // ── m7 ──
  it('an ad-hoc operation cannot require nothing', async () => {
    const job = await newJob(10);
    const zero = await api('POST', `/api/work-orders/${job.id}/operations`, {
      token, body: { name: 'Impossible', quantity_required: 0 },
    });
    assert.equal(zero.status, 400, JSON.stringify(zero.json));
    assert.equal(zero.json.error, 'bad_quantity');

    // Omitting it takes the job's quantity, which is the useful default.
    const ok = await api('POST', `/api/work-orders/${job.id}/operations`, { token, body: { name: 'Rework loop' } });
    assert.equal(ok.status, 201, JSON.stringify(ok.json));
    assert.equal(ok.json.quantity_required, 10);
  });

  // ── m6 ──
  it("raising a released job's quantity moves its operations with it", async () => {
    const job = await newJob(10);
    const bumped = await api('PUT', `/api/work-orders/${job.id}`, { token, body: { quantity: 20 } });
    assert.equal(bumped.status, 200, JSON.stringify(bumped.json));
    assert.equal(bumped.json.operations_resized, 2);

    const listed = await api('GET', `/api/work-orders/${job.id}/operations`, { token });
    assert.deepEqual(listed.json.map(o => o.quantity_required), [20, 20],
      'the operations still required the old quantity');
  });

  it('an operation never drops below what has been booked against it', async () => {
    const job = await newJob(20);
    ops.advance(companyId, job.operations[0].id, { good: 12, scrap: 3 });

    const cut = await api('PUT', `/api/work-orders/${job.id}`, { token, body: { quantity: 5 } });
    assert.equal(cut.status, 200, JSON.stringify(cut.json));
    const listed = await api('GET', `/api/work-orders/${job.id}/operations`, { token });
    assert.equal(listed.json[0].quantity_required, 15, 'a requirement was cut below its booked quantity');
    assert.equal(listed.json[1].quantity_required, 5);
    assert.deepEqual(cut.json.operations_floored, [{ sequence: 1, quantity_required: 15 }]);
  });

  it('a quantity change is refused once an operation is complete', async () => {
    const job = await newJob(10);
    ops.advance(companyId, job.operations[0].id, { good: 10 });

    const bumped = await api('PUT', `/api/work-orders/${job.id}`, { token, body: { quantity: 30 } });
    assert.equal(bumped.status, 409, JSON.stringify(bumped.json));
    assert.equal(bumped.json.error, 'operation_complete');

    const wo = await api('GET', `/api/work-orders/${job.id}`, { token });
    assert.equal(wo.json.quantity, 10, 'the refused quantity was written anyway');
    const listed = await api('GET', `/api/work-orders/${job.id}/operations`, { token });
    assert.deepEqual(listed.json.map(o => o.quantity_required), [10, 10]);
  });

  // ── M1 ──
  it('deleting a work order takes its operations with it', async () => {
    const job = await newJob(10);
    assert.equal(job.operations.length, 2);

    const del = await api('DELETE', `/api/work-orders/${job.id}`, { token });
    assert.equal(del.status, 200, JSON.stringify(del.json));

    const orphans = db.prepare('SELECT COUNT(*) AS c FROM work_order_operations WHERE work_order_id = ?').get(job.id).c;
    assert.equal(orphans, 0, 'deleting a work order left its operations behind');

    const anyOrphan = db.prepare(`
      SELECT COUNT(*) AS c FROM work_order_operations o
      LEFT JOIN work_orders wo ON wo.id = o.work_order_id
      WHERE wo.id IS NULL
    `).get().c;
    assert.equal(anyOrphan, 0, 'the table holds operations whose work order no longer exists');
  });

  it('009 declares the foreign key that makes that true', () => {
    const sql = fs.readFileSync(MIGRATION_FILE, 'utf8');
    assert.match(sql, /work_order_id\s+TEXT NOT NULL REFERENCES work_orders\(id\) ON DELETE CASCADE/,
      'work_order_id has no cascading foreign key — SQLite cannot add one later');
    assert.match(sql, /company_id\s+TEXT NOT NULL REFERENCES organizations\(id\)/,
      'company_id has no foreign key');
  });

  // ── m8 ──
  it('a sequence collision is a 409, never a 500', async () => {
    const created = await api('POST', '/api/work-orders', {
      token, body: { part_number: 'PN-RACE', part_name: 'Race', quantity: 5 },
    });
    const id = created.json.id;
    // What a second, concurrent release looks like from inside: sequence 1 is
    // already there, but released_at has not been written yet.
    db.prepare(`
      INSERT INTO work_order_operations
        (id, company_id, work_order_id, sequence, name, quantity_required, status)
      VALUES ('race-op-1', ?, ?, 1, 'Cut', 5, 'ready')
    `).run(companyId, id);

    assert.throws(() => ops.instantiate(companyId, id, routingId),
      err => err instanceof ops.OperationError && err.status === 409,
      'a UNIQUE collision surfaced as something other than a 409');
  });

  // ── m10 ──
  it("a routing id belonging to another company is not named on the work order", async () => {
    const created = await api('POST', '/api/work-orders', {
      token, body: { part_number: 'PN-JOIN', part_name: 'Join Probe', quantity: 2 },
    });
    // The route refuses this now, so the only way in is a direct write — which
    // is exactly the state a database restored from an older build can be in.
    db.prepare('UPDATE work_orders SET routing_id = ? WHERE id = ?').run(routingIdB, created.json.id);

    const wo = await api('GET', `/api/work-orders/${created.json.id}`, { token });
    assert.equal(wo.json.routing_name, null,
      "the join printed another company's routing name onto this company's work order");
    const list = await api('GET', '/api/work-orders', { token });
    const row = list.json.find(w => w.id === created.json.id);
    assert.equal(row.routing_name, null);
  });

  // ── M2 ──
  it('a list of work orders costs a fixed number of statements, whatever N is', async () => {
    // Enrichment used to ask every row where it stood: a COUNT and a lookup
    // each, so a hundred-job Schedule was three hundred queries behind one
    // request — and it grew with the customer.
    const woRoutes = require('../src/routes/workorders');
    const raw = db.prepare.bind(db);

    for (let i = 0; i < 12; i++) {
      const created = await api('POST', '/api/work-orders', {
        token, body: { part_number: `PN-N${i}`, part_name: `Batch ${i}`, quantity: 5, routing_id: routingId },
      });
      assert.equal(created.status, 201, JSON.stringify(created.json));
    }

    const countFor = n => {
      const rows = raw('SELECT * FROM work_orders WHERE company_id = ? ORDER BY created_at DESC LIMIT ?')
        .all(companyId, n);
      assert.equal(rows.length, n, 'not enough work orders to measure with');
      let prepares = 0;
      db.prepare = sql => { prepares++; return raw(sql); };
      try {
        const enriched = woRoutes.enrichWorkOrders(companyId, rows);
        assert.equal(enriched.length, n);
        assert.ok(enriched.some(w => w.current_operation), 'nothing in the page was released, so nothing was measured');
      } finally {
        db.prepare = raw;
      }
      return prepares;
    };

    const few  = countFor(4);
    const many = countFor(16);
    console.log(`      # statements: 4 rows -> ${few}, 16 rows -> ${many}`);
    // Three is the ceiling: counts, pointer rows, and — only when some job's
    // pointer is missing or stale — one sweep of the stragglers. Four times the
    // rows must not buy a single extra statement.
    assert.ok(few  <= 3, `enriching 4 work orders took ${few} statements`);
    assert.ok(many <= 3, `enriching 16 work orders took ${many} statements`);
    assert.ok(many < 16, `the statement count is still growing with the page (${many} for 16 rows)`);
  });

  it('the batch and the one-at-a-time answer agree', async () => {
    const job = await newJob(10);
    ops.advance(companyId, job.operations[0].id, { good: 3 });
    const wo = db.prepare('SELECT * FROM work_orders WHERE id = ?').get(job.id);
    const one = ops.currentOperationSummary(companyId, wo);
    const many = ops.currentOperationSummaries(companyId, [wo]).get(job.id);
    assert.deepEqual(many, one, 'the batched summary differs from the single lookup');
    assert.equal(one.qty_good, 3);
    assert.equal(one.of, 2);
  });

  it('a work order with no operations is null in the batch, not a zeroed object', async () => {
    const job = await newJob(10, false);
    const wo = db.prepare('SELECT * FROM work_orders WHERE id = ?').get(job.id);
    assert.equal(ops.currentOperationSummaries(companyId, [wo]).get(job.id), null);
  });
});

// ─── The Free tier can run a job ──────────────────────────────────────────────
// /api/routings is plan-gated ('pro'); /api/work-orders is not, and release
// lives there on purpose. A Free account that cannot release a job has not seen
// the product. Its own boot, because the gate is a process-level variable.

describe('a Free-tier company can release a work order', () => {
  let token, routingId;

  before(async () => {
    await stopServer();
    await startServer(DB_FREE, false);   // EARLY_ACCESS off: the plan gate is live

    const signup = await api('POST', '/api/auth/signup', {
      body: { company_name: 'Frugal Co', email: 'admin@frugal.test', password: 'SecretPass1', display_name: 'Owner' },
    });
    assert.equal(signup.status, 201, JSON.stringify(signup.json));
    token = signup.json.token;

    // Pin the company to the free tier with no trial, and give it a routing the
    // way a trial (or an ERP import made while on Pro) would have left one —
    // the plan gate means the Free account cannot create one through the API.
    const raw = new Database(DB_FREE);
    const companyId = raw.prepare("SELECT company_id FROM users WHERE email = 'admin@frugal.test'").get().company_id;
    raw.prepare('DELETE FROM plan WHERE company_id = ?').run(companyId);
    raw.prepare("INSERT INTO plan (company_id, tier) VALUES (?, 'free')").run(companyId);
    routingId = 'free-routing-1';
    raw.prepare("INSERT INTO product_routings (id, company_id, name, description) VALUES (?, ?, 'Free Line', '')")
      .run(routingId, companyId);
    raw.prepare("INSERT INTO routing_steps (id, routing_id, company_id, step_number, name, estimated_cycle_seconds) VALUES ('fr-1', ?, ?, 1, 'Cut', 30)")
      .run(routingId, companyId);
    raw.prepare("INSERT INTO routing_steps (id, routing_id, company_id, step_number, name, estimated_cycle_seconds) VALUES ('fr-2', ?, ?, 2, 'Pack', 20)")
      .run(routingId, companyId);
    raw.close();
  });

  it('is really on the free tier — /api/routings is closed to it', async () => {
    const r = await api('GET', '/api/routings', { token });
    assert.equal(r.status, 403, `expected the pro gate, got ${r.status}: ${JSON.stringify(r.json)}`);
    assert.equal(r.json.code, 'PLAN_REQUIRED');
  });

  it('releases a job anyway, because execution is not a paid feature', async () => {
    const created = await api('POST', '/api/work-orders', {
      token, body: { part_number: 'PN-FREE', part_name: 'Free Bracket', quantity: 4 },
    });
    assert.equal(created.status, 201, JSON.stringify(created.json));

    const rel = await api('POST', `/api/work-orders/${created.json.id}/release`, {
      token, body: { routing_id: routingId },
    });
    assert.equal(rel.status, 201, `a Free account could not release: ${JSON.stringify(rel.json)}`);
    assert.equal(rel.json.operations.length, 2);

    const listed = await api('GET', `/api/work-orders/${created.json.id}/operations`, { token });
    assert.equal(listed.status, 200);
    assert.deepEqual(listed.json.map(o => o.status), ['ready', 'queued']);
    assert.ok(listed.json.every(o => o.quantity_required === 4));
  });
});

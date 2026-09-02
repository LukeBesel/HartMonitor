'use strict';
// ─── A finished run says how many were good, how many were scrap ─────────────
//
// Production quantity used to be good-only: a completion existed, therefore one
// good piece existed. First-pass yield, scrap by part and the cost of poor
// quality were uncomputable, and the only plant-wide scrap figure in the whole
// product was whatever a supervisor typed into a shift note by hand.
//
// What has to hold now:
//
//   • a run finishing with counts books them against the work order's CURRENT
//     OPERATION — good toward quantity_completed, scrap toward quantity_scrapped
//     — and only the good units advance the work order;
//   • a run that records nothing stores NULL in all five columns and advances
//     by one, exactly as every run did before this existed (NULL is "nobody
//     counted", 0 is "counted, and the answer was zero");
//   • scrap with no coded reason is refused, naming the field;
//   • a reason code from another company, or one that explains something other
//     than scrap, is refused and NOTHING is stored;
//   • an operation belonging to another work order is refused;
//   • more pieces than the operation has left are refused, in plain words;
//   • re-sending the finishing PUT does not book the units twice;
//   • yieldFor() reports null with a reason when nothing was counted, never a
//     flattering 100%.
//
// Runs with EARLY_ACCESS=true: this suite is about the arithmetic, not the plan
// gate.
//
// Uses Node built-ins plus better-sqlite3 (to read raw columns the API shapes).
// Run with: node --test test/scrap-yield.test.js

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Database = require('better-sqlite3');
const { randomUUID } = require('node:crypto');

const PORT = 3412; // reserved for scrap-rework-and-coded-downtime (MIGRATIONS.md)
const BASE = `http://localhost:${PORT}`;
const DB_PATH = path.join(os.tmpdir(), `mes-scrap-yield-${Date.now()}.db`);
// A second, server-less database for the module-level assertions about
// scrap.js itself. Set before anything requires src/db.js.
const DB_MODEL = path.join(os.tmpdir(), `mes-scrap-model-${Date.now()}.db`);

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
        EARLY_ACCESS: 'true',
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

/** The raw row, straight out of SQLite — the only way to see a NULL that the
 *  API would otherwise hand back as `null` indistinguishably from a 0. */
function rawCompletion(id) {
  const db = new Database(DB_PATH, { readonly: true });
  try {
    return db.prepare(`SELECT quantity_good, quantity_scrap, quantity_rework,
                              scrap_reason_code_id, work_order_operation_id, status
                       FROM completions WHERE id = ?`).get(id);
  } finally { db.close(); }
}

before(async () => { await startServer(); });
after(() => {
  if (server) server.kill('SIGTERM');
  for (const p of [DB_PATH, DB_MODEL]) {
    for (const ext of ['', '-shm', '-wal']) {
      try { fs.unlinkSync(p + ext); } catch { /* ignore */ }
    }
  }
});

describe('units this run book against the work order operation', () => {
  let token, tokenB, appId, stationId, woId, woId2, opId, op2Id, otherWoOpId;
  let scrapCode, downtimeCode, foreignScrapCode;

  before(async () => {
    const signup = await api('POST', '/api/auth/signup', {
      body: { company_name: 'Yield Co', email: 'admin@yield.test', password: 'SecretPass1', display_name: 'Admin' },
    });
    assert.equal(signup.status, 201, `signup: ${JSON.stringify(signup.json)}`);
    token = signup.json.token;

    const app = await api('POST', '/api/apps', { token, body: { name: 'Weld' } });
    assert.equal(app.status, 201, `app: ${JSON.stringify(app.json)}`);
    appId = app.json.id;

    const st = await api('POST', '/api/stations', { token, body: { name: 'Weld 1' } });
    assert.ok([200, 201].includes(st.status), `station: ${JSON.stringify(st.json)}`);
    stationId = st.json.id;

    // A two-operation routing, so "the operation the units book to" is a real
    // choice and not the only row there is.
    const routing = await api('POST', '/api/routings', {
      token,
      body: {
        name: 'Bracket — weld then inspect',
        steps: [
          { step_number: 1, name: 'Weld', estimated_cycle_seconds: 120 },
          { step_number: 2, name: 'Inspect', estimated_cycle_seconds: 60 },
        ],
      },
    });
    assert.equal(routing.status, 201, `routing: ${JSON.stringify(routing.json)}`);

    const wo = await api('POST', '/api/work-orders', {
      token, body: { part_number: 'PN-SCRAP', part_name: 'Scrap Bracket', quantity: 10, app_id: appId },
    });
    assert.equal(wo.status, 201, `work order: ${JSON.stringify(wo.json)}`);
    woId = wo.json.id;
    const released = await api('POST', `/api/work-orders/${woId}/release`, {
      token, body: { routing_id: routing.json.id },
    });
    assert.equal(released.status, 201, `release: ${JSON.stringify(released.json)}`);
    const ops = await api('GET', `/api/work-orders/${woId}/operations`, { token });
    opId = ops.json[0].id;
    op2Id = ops.json[1].id;
    assert.equal(ops.json[0].quantity_required, 10);

    // A second released job, so "an operation of another work order" is a real
    // id rather than a made-up one.
    const wo2 = await api('POST', '/api/work-orders', {
      token, body: { part_number: 'PN-OTHER', part_name: 'Other Bracket', quantity: 5, app_id: appId },
    });
    woId2 = wo2.json.id;
    await api('POST', `/api/work-orders/${woId2}/release`, { token, body: { routing_id: routing.json.id } });
    const ops2 = await api('GET', `/api/work-orders/${woId2}/operations`, { token });
    otherWoOpId = ops2.json[0].id;

    // The company's coded reason lists (seeded on first read, from wave 2).
    const scraps = await api('GET', '/api/andon/reason-codes?kind=scrap', { token });
    assert.equal(scraps.status, 200, `reason codes: ${JSON.stringify(scraps.json)}`);
    scrapCode = scraps.json.find(r => r.code === 'weld_porosity') || scraps.json[0];
    assert.ok(scrapCode, 'no scrap reason codes were seeded');
    const downs = await api('GET', '/api/andon/reason-codes?kind=downtime', { token });
    downtimeCode = downs.json[0];
    assert.ok(downtimeCode, 'no downtime reason codes were seeded');

    // Another tenant, with its own list.
    const signupB = await api('POST', '/api/auth/signup', {
      body: { company_name: 'Rival Co', email: 'admin@rival-scrap.test', password: 'SecretPass1', display_name: 'Rival' },
    });
    assert.equal(signupB.status, 201);
    tokenB = signupB.json.token;
    const scrapsB = await api('GET', '/api/andon/reason-codes?kind=scrap', { token: tokenB });
    foreignScrapCode = scrapsB.json[0];
    assert.ok(foreignScrapCode);
    assert.notEqual(foreignScrapCode.id, scrapCode.id);
  });

  /** Start a run against the job, optionally booked to an operation. */
  async function startRun(body = {}) {
    const created = await api('POST', '/api/completions', {
      token,
      body: {
        app_id: appId, station_id: stationId, operator_name: 'Ada',
        work_order_id: woId, work_order_operation_id: opId,
        ...body,
      },
    });
    return created;
  }

  it('4 good and 1 scrap advance the operation by 4 and 1, and the job by 4', async () => {
    const run = await startRun();
    assert.equal(run.status, 201, `start: ${JSON.stringify(run.json)}`);
    assert.equal(run.json.work_order_operation_id, opId, 'the run did not remember its operation');

    const done = await api('PUT', `/api/completions/${run.json.id}`, {
      token,
      body: {
        status: 'completed',
        quantity_good: 4, quantity_scrap: 1, scrap_reason_code_id: scrapCode.id,
      },
    });
    assert.equal(done.status, 200, `finish: ${JSON.stringify(done.json)}`);

    const ops = await api('GET', `/api/work-orders/${woId}/operations`, { token });
    const op = ops.json.find(o => o.id === opId);
    assert.equal(op.quantity_completed, 4, 'good units did not reach the operation');
    assert.equal(op.quantity_scrapped, 1, 'scrap did not reach the operation');
    assert.equal(op.quantity_rework, 0);

    const wo = await api('GET', `/api/work-orders/${woId}`, { token });
    assert.equal(wo.json.quantity_completed, 4, 'the work order counted scrap as production');

    const raw = rawCompletion(run.json.id);
    assert.equal(raw.quantity_good, 4);
    assert.equal(raw.quantity_scrap, 1);
    assert.equal(raw.scrap_reason_code_id, scrapCode.id);
  });

  it('re-sending the finishing PUT does not book the units a second time', async () => {
    const run = await startRun();
    const body = {
      status: 'completed', quantity_good: 1, quantity_scrap: 0, quantity_rework: 0,
    };
    const first = await api('PUT', `/api/completions/${run.json.id}`, { token, body });
    assert.equal(first.status, 200, JSON.stringify(first.json));
    const after1 = await api('GET', `/api/work-orders/${woId}/operations`, { token });
    const op1 = after1.json.find(o => o.id === opId);

    const second = await api('PUT', `/api/completions/${run.json.id}`, { token, body });
    assert.equal(second.status, 200, JSON.stringify(second.json));
    const after2 = await api('GET', `/api/work-orders/${woId}/operations`, { token });
    const op2 = after2.json.find(o => o.id === opId);
    assert.equal(op2.quantity_completed, op1.quantity_completed,
      're-PUTting a finished run booked its units twice');
    assert.equal(op2.quantity_scrapped, op1.quantity_scrapped);
  });

  it('a run that counts nothing stores NULLs and advances by one, exactly as before', async () => {
    const before = await api('GET', `/api/work-orders/${woId}/operations`, { token });
    const opBefore = before.json.find(o => o.id === opId);
    const woBefore = await api('GET', `/api/work-orders/${woId}`, { token });

    const run = await startRun();
    const done = await api('PUT', `/api/completions/${run.json.id}`, {
      token, body: { status: 'completed', data: { note: 'nothing counted' } },
    });
    assert.equal(done.status, 200, JSON.stringify(done.json));

    const raw = rawCompletion(run.json.id);
    assert.strictEqual(raw.quantity_good, null, 'a run nobody counted was written as a zero');
    assert.strictEqual(raw.quantity_scrap, null);
    assert.strictEqual(raw.quantity_rework, null);
    assert.strictEqual(raw.scrap_reason_code_id, null);

    const after = await api('GET', `/api/work-orders/${woId}/operations`, { token });
    const opAfter = after.json.find(o => o.id === opId);
    assert.equal(opAfter.quantity_completed, opBefore.quantity_completed + 1,
      'a run with no counts must still advance the operation by one');
    assert.equal(opAfter.quantity_scrapped, opBefore.quantity_scrapped, 'it invented scrap');
    const woAfter = await api('GET', `/api/work-orders/${woId}`, { token });
    assert.equal(woAfter.json.quantity_completed, woBefore.json.quantity_completed + 1);
  });

  it('scrap with no coded reason is refused, naming the field', async () => {
    const run = await startRun();
    const done = await api('PUT', `/api/completions/${run.json.id}`, {
      token, body: { status: 'completed', quantity_good: 1, quantity_scrap: 2 },
    });
    assert.equal(done.status, 400, `expected a refusal, got ${JSON.stringify(done.json)}`);
    assert.match(JSON.stringify(done.json), /scrap_reason_code_id/,
      'the refusal must name the field the operator has to fill in');

    const raw = rawCompletion(run.json.id);
    assert.strictEqual(raw.quantity_scrap, null, 'a refused run stored its counts anyway');
    assert.equal(raw.status, 'in_progress', 'a refused run was closed anyway');
  });

  it("another company's reason code is refused and nothing is stored", async () => {
    const run = await startRun();
    const done = await api('PUT', `/api/completions/${run.json.id}`, {
      token,
      body: { status: 'completed', quantity_good: 1, quantity_scrap: 1, scrap_reason_code_id: foreignScrapCode.id },
    });
    assert.equal(done.status, 400, `expected a refusal, got ${JSON.stringify(done.json)}`);
    const raw = rawCompletion(run.json.id);
    assert.strictEqual(raw.scrap_reason_code_id, null, "another tenant's code was stored");
    assert.strictEqual(raw.quantity_scrap, null);
    assert.equal(raw.status, 'in_progress');
  });

  it('a downtime code cannot explain scrap', async () => {
    const run = await startRun();
    const done = await api('PUT', `/api/completions/${run.json.id}`, {
      token,
      body: { status: 'completed', quantity_good: 1, quantity_scrap: 1, scrap_reason_code_id: downtimeCode.id },
    });
    assert.equal(done.status, 400, `expected a refusal, got ${JSON.stringify(done.json)}`);
    const raw = rawCompletion(run.json.id);
    assert.strictEqual(raw.scrap_reason_code_id, null);
  });

  it('an operation belonging to another work order is refused, on start and on finish', async () => {
    const bad = await api('POST', '/api/completions', {
      token,
      body: {
        app_id: appId, station_id: stationId, operator_name: 'Ada',
        work_order_id: woId, work_order_operation_id: otherWoOpId,
      },
    });
    assert.equal(bad.status, 400, `expected a refusal, got ${JSON.stringify(bad.json)}`);
    assert.match(JSON.stringify(bad.json), /work_order_operation_id/);

    const run = await startRun({ work_order_operation_id: undefined });
    const done = await api('PUT', `/api/completions/${run.json.id}`, {
      token, body: { status: 'completed', work_order_operation_id: otherWoOpId, quantity_good: 1 },
    });
    assert.equal(done.status, 400, `expected a refusal, got ${JSON.stringify(done.json)}`);
    assert.match(JSON.stringify(done.json), /work_order_operation_id/);
  });

  it('more pieces than the operation has left are refused in plain words', async () => {
    const ops = await api('GET', `/api/work-orders/${woId}/operations`, { token });
    const op = ops.json.find(o => o.id === opId);
    const left = op.quantity_required - op.quantity_completed - op.quantity_scrapped;
    assert.ok(left > 0, `the fixture left nothing to book (${JSON.stringify(op)})`);

    const run = await startRun();
    const done = await api('PUT', `/api/completions/${run.json.id}`, {
      token, body: { status: 'completed', quantity_good: left + 1 },
    });
    assert.equal(done.status, 400, `expected a refusal, got ${JSON.stringify(done.json)}`);
    assert.equal(done.json.error, `only ${left} left on this operation`,
      'the refusal has to be readable by the person holding the tablet');

    const raw = rawCompletion(run.json.id);
    assert.equal(raw.status, 'in_progress', 'a run refused by the operation was closed anyway');
  });

  it('finishes the operation and readies the next one when the counts fill it', async () => {
    const ops = await api('GET', `/api/work-orders/${woId}/operations`, { token });
    const op = ops.json.find(o => o.id === opId);
    const left = op.quantity_required - op.quantity_completed - op.quantity_scrapped;

    const run = await startRun();
    const done = await api('PUT', `/api/completions/${run.json.id}`, {
      token, body: { status: 'completed', quantity_good: left } });
    assert.equal(done.status, 200, JSON.stringify(done.json));

    const after = await api('GET', `/api/work-orders/${woId}/operations`, { token });
    assert.equal(after.json.find(o => o.id === opId).status, 'complete');
    assert.equal(after.json.find(o => o.id === op2Id).status, 'ready',
      'the next operation was not handed the job');
  });

  it('reports scrap grouped by the part number of the job it came off', async () => {
    const byPart = await api('GET', '/api/completions/scrap?days=1', { token });
    assert.equal(byPart.status, 200, JSON.stringify(byPart.json));
    const group = byPart.json.parts.find(p => p.part_number === 'PN-SCRAP');
    assert.ok(group, `PN-SCRAP missing from ${JSON.stringify(byPart.json.parts)}`);
    assert.equal(group.scrap, 1, 'the scrapped piece is not against its part number');
    assert.ok(group.good >= 4, `expected the good units too, got ${group.good}`);
    assert.ok(group.reasons.some(r => r.reason_code_id === scrapCode.id),
      `the coded reason is missing: ${JSON.stringify(group.reasons)}`);
    // The same arithmetic behind the pro-gated OEE door.
    const viaOee = await api('GET', '/api/oee/scrap?days=1', { token });
    assert.equal(viaOee.status, 200, JSON.stringify(viaOee.json));
    assert.deepEqual(
      viaOee.json.parts.map(p => [p.part_number, p.scrap]),
      byPart.json.parts.map(p => [p.part_number, p.scrap]),
      'two doors onto the same numbers disagreed',
    );
  });
});

// ─── scrap.js itself ─────────────────────────────────────────────────────────
// A server-less database, so the rows under test are exactly the rows written
// here and nothing else.
describe('yieldFor and scrapByPart', () => {
  let scrapModel, db;
  const COMPANY = 'co-model';
  const OTHER = 'co-other';

  before(() => {
    process.env.NODE_ENV = 'test';
    process.env.DATABASE_PATH = DB_MODEL;
    process.env.SEED_DEMO_DATA = 'false';
    process.env.BACKUP_DIR = '';
    db = require('../src/db');
    scrapModel = require('../src/scrap');

    // The two tenants and the two apps the rows below hang off — completions
    // and work_orders both carry a real foreign key to organizations.
    const org = db.prepare('INSERT INTO organizations (id, name, slug) VALUES (?, ?, ?)');
    org.run(COMPANY, 'Model Co', 'model-co');
    org.run(OTHER, 'Other Co', 'other-co');
    const app = db.prepare('INSERT INTO apps (id, name, company_id) VALUES (?, ?, ?)');
    app.run('app-1', 'Weld', COMPANY);
    app.run('app-2', 'Pack', COMPANY);
    app.run('app-3', 'Rival', OTHER);

    const wo = db.prepare(`INSERT INTO work_orders (id, work_order_number, part_number, part_name, quantity, company_id)
                           VALUES (?, ?, ?, ?, ?, ?)`);
    wo.run('wo-a', 'WO-A', 'PN-A', 'Bracket A', 100, COMPANY);
    wo.run('wo-b', 'WO-B', 'PN-B', 'Bracket B', 100, COMPANY);

    const rc = db.prepare(`INSERT INTO reason_codes (id, company_id, kind, code, label) VALUES (?, ?, 'scrap', ?, ?)`);
    rc.run('rc-porosity', COMPANY, 'weld_porosity', 'Weld porosity');

    const ins = db.prepare(`INSERT INTO completions
      (id, app_id, app_name, company_id, work_order_id, status, completed_at,
       quantity_good, quantity_scrap, quantity_rework, scrap_reason_code_id)
      VALUES (?, 'app-1', 'Weld', ?, ?, 'completed', ?, ?, ?, ?, ?)`);
    const now = new Date().toISOString();
    // Ten good and two scrap on PN-A, spread over two runs.
    ins.run(randomUUID(), COMPANY, 'wo-a', now, 6, 1, 0, 'rc-porosity');
    ins.run(randomUUID(), COMPANY, 'wo-a', now, 4, 1, 1, 'rc-porosity');
    // A run nobody counted: all five columns NULL.
    db.prepare(`INSERT INTO completions (id, app_id, app_name, company_id, work_order_id, status, completed_at)
                VALUES (?, 'app-2', 'Pack', ?, ?, 'completed', ?)`)
      .run(randomUUID(), COMPANY, 'wo-b', now);
    // Another tenant's scrap, which must never appear in this company's totals.
    db.prepare(`INSERT INTO completions
      (id, app_id, app_name, company_id, status, completed_at, quantity_good, quantity_scrap, quantity_rework)
      VALUES (?, 'app-3', 'Rival', ?, 'completed', ?, ?, ?, ?)`)
      .run(randomUUID(), OTHER, now, 1, 99, 0);
  });

  it('reports first-pass yield as good over good-plus-scrap', () => {
    const y = scrapModel.yieldFor({ companyId: COMPANY, workOrderId: 'wo-a', days: 1 });
    assert.equal(y.good, 10);
    assert.equal(y.scrap, 2);
    assert.equal(y.rework, 1);
    assert.equal(y.sample, 2, 'only the runs that recorded counts are in the sample');
    assert.ok(Math.abs(y.fpy - 10 / 12) < 1e-9, `expected 10/12, got ${y.fpy}`);
    assert.equal(y.fpy_pct, 83);
    assert.equal(y.fpy_reason, null);
  });

  it('reports null with a reason — never 0% or 100% — when nothing was counted', () => {
    const y = scrapModel.yieldFor({ companyId: COMPANY, workOrderId: 'wo-b', days: 1 });
    assert.strictEqual(y.fpy, null, 'a run nobody counted produced a yield figure');
    assert.strictEqual(y.fpy_pct, null);
    assert.equal(y.sample, 0);
    assert.ok(y.fpy_reason && y.fpy_reason.length > 0, 'a missing number must travel with its reason');
    assert.equal(y.good, 0);
  });

  it('never reaches into another tenant', () => {
    const y = scrapModel.yieldFor({ companyId: COMPANY, days: 1 });
    assert.equal(y.scrap, 2, "another company's scrap leaked into this one's total");
  });

  it('groups scrap by the part number of the work order', () => {
    const { parts } = scrapModel.scrapByPart({ companyId: COMPANY, days: 1 });
    const a = parts.find(p => p.part_number === 'PN-A');
    const b = parts.find(p => p.part_number === 'PN-B');
    assert.ok(a, `PN-A missing from ${JSON.stringify(parts)}`);
    assert.equal(a.good, 10);
    assert.equal(a.scrap, 2);
    assert.equal(a.reasons.length, 1);
    assert.equal(a.reasons[0].label, 'Weld porosity');
    assert.equal(a.reasons[0].scrap, 2);
    // PN-B's only run counted nothing, so it has no yield — not a zero one.
    assert.ok(!b || b.fpy === null, 'a part nobody counted was given a yield');
    assert.equal(parts[0].part_number, 'PN-A', 'the worst part is not first');
  });
});

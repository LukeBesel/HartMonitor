'use strict';
// ─── Dispatch: what to run next here, and where WO-1042 is ────────────────────
//
// After wave 3 the data existed and no screen showed it. Releasing a work order
// wrote ordered operations — each with its own app, department, station and
// quantities — and the only way to read one was to open the Schedule, find the
// row, open the drawer and count. "Where is WO-1042?", the question a supervisor
// asks twenty times a day, had no home; and the Operator Portal listed WORK
// ORDERS, so a published app attached to no job ('Final QC Inspection') was
// unreachable from the tablet that was supposed to run it.
//
// What this file pins:
//
//   1. /dispatch lists READY and RUNNING operations only — never 'queued'
//      (ordered, not startable) and never 'complete' — plus the published apps
//      that need no work order at all.
//   2. The order is priority → due date (nulls last) → sequence, on a fixture
//      where EACH of the three keys is the only thing separating a pair.
//   3. A station filter narrows to that station's work: the operations that
//      name it, plus the ones that name no station and belong to its
//      department. An operation explicitly assigned elsewhere is excluded.
//   4. /wip answers in one sentence, for 'WO-2026-042', 'wo-2026-042', the
//      number without its prefix and the part number — and answers "not
//      released" for a job nobody released, rather than "operation 0 of 0".
//   5. Another company's work order is not findable, and a foreign
//      department id empties the scope instead of widening it.
//   6. finished_today_for_operator counts the PLANT's day: a run finished at
//      22:00 in Detroit is today's there and tomorrow's in UTC.
//   7. /wip-summary reports good/scrap as null WITH A REASON until the columns
//      that carry them exist and something has been counted into them.
//
// Runs with EARLY_ACCESS=true: designing a routing is a Pro feature and this
// suite is about dispatch, not the plan gate.
//
// Uses Node built-ins only (node:test + global fetch).
//   cd backend && node --test test/dispatch.test.js

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Database = require('better-sqlite3');

const PORT = 3414; // reserved for this workstream — a collision cancels a suite
const BASE = `http://localhost:${PORT}`;
const DB_PATH = path.join(os.tmpdir(), `mes-dispatch-${Date.now()}.db`);
const ZONE = 'America/Detroit';

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

async function ok(method, pathname, opts, label) {
  const res = await api(method, pathname, opts);
  assert.ok(res.status >= 200 && res.status < 300, `${label}: ${res.status} ${JSON.stringify(res.json)}`);
  return res.json;
}

const get = (token, pathname) => ok('GET', pathname, { token }, `GET ${pathname}`);

/** 'YYYY-MM-DD' in a zone, computed the way a person reads a wall clock. */
function localDate(zone, at) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(at);
}

/** SQLite's own stamp shape: 'YYYY-MM-DD HH:MM:SS', UTC, no zone marker. */
function toSqlite(d) {
  return d.toISOString().slice(0, 19).replace('T', ' ');
}

before(async () => { await startServer(); });
after(() => {
  if (server) server.kill('SIGTERM');
  for (const ext of ['', '-shm', '-wal']) {
    try { fs.unlinkSync(DB_PATH + ext); } catch { /* ignore */ }
  }
});

describe('dispatch: what to run next here', () => {
  const A = {};   // Dispatch Works — the fixture
  const B = {};   // Rival Fabrication — the tenant that must stay invisible

  before(async () => {
    // ── Company A, in Detroit ────────────────────────────────────────────────
    const signup = await ok('POST', '/api/auth/signup', {
      body: {
        company_name: 'Dispatch Works', email: 'admin@dispatchworks.test',
        password: 'SecretPass1', display_name: 'Admin', timezone: ZONE,
      },
    }, 'signup A');
    A.token = signup.token;

    A.weld  = (await ok('POST', '/api/departments', { token: A.token, body: { name: 'Weld' } }, 'weld dept')).id;
    A.paint = (await ok('POST', '/api/departments', { token: A.token, body: { name: 'Paint' } }, 'paint dept')).id;

    A.cellA = (await ok('POST', '/api/stations', { token: A.token, body: { name: 'Weld Cell A', department_id: A.weld } }, 'cell A')).id;
    A.cellB = (await ok('POST', '/api/stations', { token: A.token, body: { name: 'Weld Cell B', department_id: A.weld } }, 'cell B')).id;

    // Three published apps. Two need a work order (they are routing steps); the
    // third is the standing job the portal could never list.
    async function publishedApp(name, { departmentId, requiresWorkOrder, stationId }) {
      const app = await ok('POST', '/api/apps', { token: A.token, body: { name, department_id: departmentId } }, `app ${name}`);
      await ok('PUT', `/api/apps/${app.id}`, {
        token: A.token,
        body: { department_id: departmentId, station_id: stationId ?? null, require_run_context: requiresWorkOrder },
      }, `configure ${name}`);
      await ok('POST', `/api/apps/${app.id}/publish`, { token: A.token, body: { change_note: 'first publish' } }, `publish ${name}`);
      return app.id;
    }
    A.weldApp  = await publishedApp('Weld Cell',           { departmentId: A.weld,  requiresWorkOrder: true });
    A.qcApp    = await publishedApp('Final QC Inspection', { departmentId: A.weld,  requiresWorkOrder: false });
    A.paintApp = await publishedApp('Paint Booth Check',   { departmentId: A.paint, requiresWorkOrder: false });
    A.auditApp = await publishedApp('Paint Line Audit',    { departmentId: A.paint, requiresWorkOrder: false });

    // A seven-step routing through Weld — the shape "op 3 of 7" describes.
    const routing = await ok('POST', '/api/routings', {
      token: A.token,
      body: {
        name: 'Bracket — 7 operations',
        steps: [1, 2, 3, 4, 5, 6, 7].map(n => ({
          step_number: n,
          name: n === 3 ? 'Weld' : `Step ${n}`,
          app_id: A.weldApp,
          department_id: A.weld,
          estimated_cycle_seconds: 60,
        })),
      },
    }, 'routing');
    A.routing = routing.id;

    // A two-step routing, so the ordering fixture has a job whose sequence
    // matters against itself.
    const shortRouting = await ok('POST', '/api/routings', {
      token: A.token,
      body: {
        name: 'Bracket — short',
        steps: [1, 2, 3, 4].map(n => ({
          step_number: n, name: `Op ${n}`, app_id: A.weldApp, department_id: A.weld,
        })),
      },
    }, 'short routing');
    A.shortRouting = shortRouting.id;

    // Paint's own routing — a Paint job released against a Weld routing would
    // put Paint operations in Weld, which is a fixture bug that reads exactly
    // like the scoping bug this suite is here to catch.
    const paintRouting = await ok('POST', '/api/routings', {
      token: A.token,
      body: {
        name: 'Panel — paint',
        steps: [1, 2].map(n => ({ step_number: n, name: `Paint ${n}`, app_id: A.paintApp, department_id: A.paint })),
      },
    }, 'paint routing');
    A.paintRouting = paintRouting.id;

    // A routing whose steps name no department at all — the shape that used to
    // vanish from the WIP strip entirely.
    const noDept = await ok('POST', '/api/routings', {
      token: A.token,
      body: { name: 'Unfiled', steps: [{ step_number: 1, name: 'Do it', app_id: A.weldApp }] },
    }, 'department-less routing');
    A.noDeptRouting = noDept.id;

    async function workOrder(body) {
      return ok('POST', '/api/work-orders', { token: A.token, body }, `work order ${body.work_order_number}`);
    }

    // ── The ordering fixture. Each key decides exactly one pair. ─────────────
    // A: critical, due LATEST of all — priority alone puts it first.
    A.woA = await workOrder({
      work_order_number: 'WO-2026-042', part_number: 'PN-BRACKET-9', part_name: 'Bracket',
      quantity: 50, priority: 'critical', due_date: '2026-12-31', department_id: A.weld,
    });
    // B: high, due EARLY — beats C, which is high with no due date at all.
    A.woB = await workOrder({
      work_order_number: 'WO-2026-043', part_number: 'PN-SHARED', part_name: 'Plate',
      quantity: 10, priority: 'high', due_date: '2026-01-05', department_id: A.weld,
    });
    // C: high, no due date — last of the three, because nulls sort last.
    A.woC = await workOrder({
      work_order_number: 'WO-2026-044', part_number: 'PN-SHARED', part_name: 'Plate',
      quantity: 10, priority: 'high', department_id: A.weld,
    });
    // D: in Paint — must never appear under a Weld filter.
    A.woD = await workOrder({
      work_order_number: 'WO-2026-045', part_number: 'PN-PAINT', part_name: 'Panel',
      quantity: 5, priority: 'critical', department_id: A.paint,
    });
    // E: released against nothing — the "not released" answer.
    A.woE = await workOrder({
      work_order_number: 'WO-2026-046', part_number: 'PN-UNRELEASED', part_name: 'Shaft',
      quantity: 8, priority: 'low', department_id: A.weld,
    });

    // ── Release, through the API, exactly as the Schedule does ───────────────
    A.opsA = (await ok('POST', `/api/work-orders/${A.woA.id}/release`, { token: A.token, body: { routing_id: A.routing } }, 'release A')).operations;
    A.opsB = (await ok('POST', `/api/work-orders/${A.woB.id}/release`, { token: A.token, body: { routing_id: A.shortRouting } }, 'release B')).operations;
    A.opsC = (await ok('POST', `/api/work-orders/${A.woC.id}/release`, { token: A.token, body: { routing_id: A.shortRouting } }, 'release C')).operations;
    A.opsD = (await ok('POST', `/api/work-orders/${A.woD.id}/release`, { token: A.token, body: { routing_id: A.paintRouting } }, 'release D')).operations;
    assert.equal(A.opsA.length, 7, 'the seven-step routing releases seven operations');

    // Walk WO-2026-042 to its third operation, through the API: 1 and 2 are
    // complete, and release readies the next one behind them.
    for (const seq of [1, 2]) {
      const op = A.opsA.find(o => o.sequence === seq);
      await ok('PUT', `/api/work-orders/${A.woA.id}/operations/${op.id}`, {
        token: A.token, body: { status: 'complete' },
      }, `complete op ${seq}`);
    }
    // A second ready operation on WO-2026-043, at sequence 4 and pinned to one
    // welder: same priority, same due date as its own sequence-1 sibling, so
    // SEQUENCE is the only thing that can separate them.
    const b4 = A.opsB.find(o => o.sequence === 4);
    await ok('PUT', `/api/work-orders/${A.woB.id}/operations/${b4.id}`, {
      token: A.token, body: { status: 'ready', station_id: A.cellB },
    }, 'ready op B4');
    A.opB4 = b4.id;

    // ── Company B — the tenant that must stay invisible ──────────────────────
    const rival = await ok('POST', '/api/auth/signup', {
      body: {
        company_name: 'Rival Fabrication', email: 'admin@rivalfab.test',
        password: 'SecretPass1', display_name: 'Rival Admin',
      },
    }, 'signup B');
    B.token = rival.token;
    B.dept = (await ok('POST', '/api/departments', { token: B.token, body: { name: 'Weld' } }, 'rival dept')).id;
    await ok('POST', '/api/work-orders', {
      token: B.token,
      body: {
        work_order_number: 'WO-2026-042', part_number: 'PN-BRACKET-9', part_name: 'Rival Bracket',
        quantity: 99, priority: 'critical', department_id: B.dept,
      },
    }, 'rival work order');

    // ── The quantities and the operator's day the API does not set ───────────
    const raw = new Database(DB_PATH);
    // 12 of 50 booked on operation 3 of 7 — the sentence the search box prints.
    const opA3 = A.opsA.find(o => o.sequence === 3);
    raw.prepare('UPDATE work_order_operations SET quantity_completed = 12 WHERE id = ?').run(opA3.id);
    A.opA3 = opA3.id;

    A.companyId = raw.prepare('SELECT id FROM organizations WHERE name = ?').get('Dispatch Works').id;
    raw.close();

    // The per-unit good/scrap columns arrive with the scrap workstream this
    // wave. The strip has to be right the day they land, so the fixture adds
    // them here and the assertions below cover both sides of that line: null
    // with a reason while nothing is counted, and a total that loses nothing
    // once something is.
    const withCounts = new Database(DB_PATH);
    for (const col of ['quantity_good', 'quantity_scrap']) {
      const has = withCounts.prepare('PRAGMA table_info(completions)').all().some(c => c.name === col);
      if (!has) withCounts.exec(`ALTER TABLE completions ADD COLUMN ${col} INTEGER`);
    }
    withCounts.close();

    // Somebody who has run something, once, but not today — a measured zero,
    // as against a name nobody has ever seen.
    A.idleOperator = 'Hedy Lamarr';
    const old = await ok('POST', '/api/completions', {
      token: A.token, body: { app_id: A.qcApp, operator_name: A.idleOperator },
    }, 'idle operator run');
    await ok('PUT', `/api/completions/${old.id}`, {
      token: A.token, body: { status: 'completed', data: {} },
    }, 'finish idle run');
    const stale = new Database(DB_PATH);
    stale.prepare('UPDATE completions SET started_at = ?, completed_at = ? WHERE id = ?').run(
      toSqlite(new Date(Date.now() - 40 * 3600000)),
      toSqlite(new Date(Date.now() - 39 * 3600000)),
      old.id,
    );
    stale.close();

    // A finished run, stamped at 22:00 on the plant's own day in Detroit. In
    // UTC that is the small hours of TOMORROW — which is precisely the reading
    // the portal used to take off the tablet's clock.
    const started = await ok('POST', '/api/completions', {
      token: A.token, body: { app_id: A.qcApp, operator_name: 'Ada Lovelace' },
    }, 'start operator run');
    await ok('PUT', `/api/completions/${started.id}`, {
      token: A.token, body: { status: 'completed', data: {} },
    }, 'finish operator run');

    process.env.DATABASE_PATH = DB_PATH;
    process.env.SEED_DEMO_DATA = 'false';
    const { offsetMinutes, plantToday } = require('../src/plantDay');
    A.plantDate = plantToday(A.companyId);
    // The UTC instant whose Detroit wall clock reads 22:00 on the plant's day.
    const naive = new Date(`${A.plantDate}T22:00:00Z`);
    A.eveningStamp = new Date(naive.getTime() - offsetMinutes(ZONE, naive) * 60000);

    const raw2 = new Database(DB_PATH);
    raw2.prepare('UPDATE completions SET started_at = ?, completed_at = ? WHERE id = ?')
      .run(toSqlite(new Date(A.eveningStamp.getTime() - 300000)), toSqlite(A.eveningStamp), started.id);
    raw2.close();
  });

  // ── 1. Only what can actually be started ──────────────────────────────────

  it('lists ready and running operations, never queued and never complete', async () => {
    const res = await get(A.token, `/api/floor/dispatch?department_id=${A.weld}`);

    assert.deepEqual(res.statuses, ['ready', 'running'], 'the payload names the statuses it drew from');
    const ops = res.rows.filter(r => r.kind === 'operation');
    assert.ok(ops.length > 0, 'the fixture released work into Weld');

    for (const row of ops) {
      assert.ok(['ready', 'running'].includes(row.status),
        `a ${row.status} operation has no business on a dispatch list: ${JSON.stringify(row)}`);
    }
    // WO-2026-042's finished operations, and its four queued ones, are absent.
    const seqsOnA = ops.filter(r => r.work_order_id === A.woA.id).map(r => r.operation_sequence);
    assert.deepEqual(seqsOnA, [3],
      'only the operation the job is standing on is startable — 1 and 2 are complete, 4-7 are queued');

    // Every operation carries where it is and how far through it is.
    const opA3 = ops.find(r => r.work_order_operation_id === A.opA3);
    assert.equal(opA3.work_order_number, 'WO-2026-042');
    assert.equal(opA3.part_number, 'PN-BRACKET-9');
    assert.equal(opA3.operation_sequence, 3);
    assert.equal(opA3.operation_count, 7);
    assert.equal(opA3.operation_name, 'Weld');
    assert.equal(opA3.department_name, 'Weld');
    assert.equal(opA3.priority, 'critical');
    assert.equal(opA3.due_date, '2026-12-31');
    assert.equal(opA3.quantity_completed, 12);
    assert.equal(opA3.quantity_required, 50);
    assert.equal(opA3.app_id, A.weldApp);
    assert.equal(opA3.app_name, 'Weld Cell');
    assert.equal(opA3.app_reason, null);
    assert.equal(opA3.no_work_order, false);

    // Paint's work is Paint's.
    assert.equal(ops.filter(r => r.work_order_id === A.woD.id).length, 0,
      'a Weld filter never shows a Paint job');
  });

  it('lists the published apps that need no work order at all', async () => {
    const res = await get(A.token, `/api/floor/dispatch?department_id=${A.weld}`);
    const standing = res.rows.filter(r => r.no_work_order);

    assert.deepEqual(standing.map(r => r.app_name), ['Final QC Inspection'],
      "the app the portal could never list — published, runnable, attached to no job");
    const qc = standing[0];
    assert.equal(qc.kind, 'app');
    assert.equal(qc.app_id, A.qcApp);
    assert.equal(qc.work_order_id, null);
    assert.equal(qc.operation_sequence, null);
    // No job means no ordered quantity — null, never a 0 reading as "none done".
    assert.equal(qc.quantity_required, null);
    assert.equal(qc.quantity_completed, null);
    assert.match(qc.reason, /no work order/i);

    // And the app that needs one does not turn up as a standing job.
    assert.equal(standing.some(r => r.app_id === A.weldApp), false,
      'an app that requires run context is only reachable through a job');
    // Paint's standing app belongs to Paint.
    assert.equal(standing.some(r => r.app_id === A.auditApp), false);
    const paint = await get(A.token, `/api/floor/dispatch?department_id=${A.paint}`);
    assert.equal(paint.rows.some(r => r.app_id === A.auditApp && r.no_work_order), true,
      'the Paint app on no routing is a standing job for Paint');

    // ── M2 ──
    // An app can be BOTH a routing step and a standing job, and they are two
    // different pieces of work. 'Paint Booth Check' is operation 1 of the Paint
    // job AND a gate anybody may run on nothing in particular; an earlier
    // version dropped the standing row the moment the operation existed, so a
    // floor lost the standing job exactly when it got busy.
    assert.equal(paint.rows.some(r => r.app_id === A.paintApp && r.kind === 'operation'), true,
      'it is somebody\'s operation');
    assert.equal(paint.rows.some(r => r.app_id === A.paintApp && r.no_work_order), true,
      'and it is still runnable with no work order at all — two rows, two pieces of work');

    // The order still holds: jobs first, standing rows after them.
    const kinds = paint.rows.map(r => r.kind);
    assert.deepEqual([...kinds].sort().reverse(), kinds,
      'operations before apps — "operation" sorts after "app", so reversed-sorted equals as-is');
  });

  // ── 2. The order, with each key decisive ──────────────────────────────────

  it('orders by priority, then due date (nulls last), then sequence', async () => {
    const res = await get(A.token, `/api/floor/dispatch?department_id=${A.weld}`);
    const ops = res.rows.filter(r => r.kind === 'operation');
    const key = r => `${r.work_order_number}#${r.operation_sequence}`;

    assert.deepEqual(ops.map(key), [
      'WO-2026-042#3',   // critical — priority alone beats an earlier due date
      'WO-2026-043#1',   // high, due 2026-01-05 …
      'WO-2026-043#4',   // … same job, same due date: sequence separates them
      'WO-2026-044#1',   // high, NO due date — nulls sort last
    ], 'priority → due date (nulls last) → sequence');

    // Each key stated as the pair it decides, so a reordering cannot pass by
    // accident of the fixture.
    const at = n => ops[n];
    assert.equal(at(0).priority, 'critical');
    assert.equal(at(1).priority, 'high');
    assert.ok(at(0).due_date > at(1).due_date,
      'the critical job is due LATER — only priority can put it first');
    assert.equal(at(1).due_date, '2026-01-05');
    assert.equal(at(3).due_date, null);
    assert.equal(at(1).priority, at(3).priority,
      'same priority — only the due date can separate these two');
    assert.equal(at(1).work_order_id, at(2).work_order_id);
    assert.equal(at(1).due_date, at(2).due_date);
    assert.ok(at(1).operation_sequence < at(2).operation_sequence,
      'same job, same priority, same due date — sequence is the only key left');

    // The standing apps come after the jobs the plant promised somebody.
    const firstApp = res.rows.findIndex(r => r.no_work_order);
    assert.equal(firstApp, ops.length, 'jobs first, standing apps after them');
  });

  // ── 3. The station rule ───────────────────────────────────────────────────

  it('narrows to a station: its own work, plus its department\'s unassigned work', async () => {
    const a = await get(A.token, `/api/floor/dispatch?station_id=${A.cellA}`);
    const b = await get(A.token, `/api/floor/dispatch?station_id=${A.cellB}`);

    const idsA = a.rows.filter(r => r.kind === 'operation').map(r => r.work_order_operation_id);
    const idsB = b.rows.filter(r => r.kind === 'operation').map(r => r.work_order_operation_id);

    // The operation pinned to Cell B is Cell B's, and only Cell B's.
    assert.equal(idsB.includes(A.opB4), true, 'Cell B sees the operation assigned to it');
    assert.equal(idsA.includes(A.opB4), false, 'Cell A never sees work assigned to Cell B');

    // Work that names no station is the DEPARTMENT's, so both welders see it —
    // the alternative empties the screen for every shop that routes by
    // department, which is most of them.
    assert.equal(idsA.includes(A.opA3), true);
    assert.equal(idsB.includes(A.opA3), true);

    // A station's scope is its department's, so Paint's work is not on it.
    assert.equal(a.rows.some(r => r.work_order_id === A.woD.id), false);
  });

  // ── 4. Where is WO-1042? ──────────────────────────────────────────────────

  it('answers a work-order number, however it is typed', async () => {
    for (const q of ['WO-2026-042', 'wo-2026-042', '2026-042']) {
      const res = await get(A.token, `/api/floor/wip?q=${encodeURIComponent(q)}`);
      assert.equal(res.match, 'work_order', `"${q}" should resolve to the job`);
      const r = res.result;
      assert.equal(r.work_order_id, A.woA.id);
      assert.equal(r.work_order_number, 'WO-2026-042');
      assert.equal(r.part_number, 'PN-BRACKET-9');
      assert.equal(r.operation_sequence, 3);
      assert.equal(r.operation_count, 7);
      assert.equal(r.operation_name, 'Weld');
      assert.equal(r.department_name, 'Weld');
      assert.equal(r.quantity_completed, 12);
      assert.equal(r.quantity_required, 50);
      assert.equal(r.status, 'ready');
      assert.equal(r.released, true);
      assert.equal(res.answer, 'WO-2026-042 is at operation 3 of 7 (Weld), 12 of 50 done',
        'one sentence, the way a supervisor would say it');
    }
  });

  it('answers a part number, and lists them all when several jobs share one', async () => {
    const one = await get(A.token, '/api/floor/wip?q=PN-BRACKET-9');
    assert.equal(one.match, 'part_number');
    assert.equal(one.result.work_order_number, 'WO-2026-042');
    assert.equal(one.result.operation_sequence, 3);
    assert.equal(one.result.operation_count, 7);
    assert.equal(one.result.quantity_completed, 12);
    assert.equal(one.result.quantity_required, 50);

    const many = await get(A.token, '/api/floor/wip?q=pn-shared');
    assert.equal(many.match, 'part_number');
    assert.equal(many.result, null, 'two jobs carry that part — picking one would be a guess');
    assert.deepEqual(many.results.map(r => r.work_order_number).sort(), ['WO-2026-043', 'WO-2026-044']);
    assert.match(many.answer, /2 work orders carry part/i);
  });

  it('says a job is not released rather than inventing "operation 0 of 0"', async () => {
    const res = await get(A.token, '/api/floor/wip?q=WO-2026-046');
    assert.equal(res.match, 'work_order');
    assert.equal(res.result.released, false);
    assert.equal(res.result.operation_sequence, null);
    assert.equal(res.result.operation_count, 0);
    assert.equal(res.answer, 'WO-2026-046 is not released: at pending');
  });

  it('finds nothing at all rather than another company\'s job', async () => {
    // Company B owns a work order with the SAME number and the SAME part.
    const res = await get(B.token, '/api/floor/wip?q=WO-2026-042');
    assert.equal(res.match, 'work_order');
    assert.equal(res.result.part_name, 'Rival Bracket', 'B sees its own job');
    assert.notEqual(res.result.work_order_id, A.woA.id);

    // And a number only A owns is simply not there for B.
    const missing = await get(B.token, '/api/floor/wip?q=WO-2026-044');
    assert.equal(missing.match, 'none');
    assert.equal(missing.result, null);
    assert.deepEqual(missing.results, []);
    assert.match(missing.reason, /no work order or part number matches/i);

    // A's dispatch list is A's alone.
    const bDispatch = await get(B.token, '/api/floor/dispatch');
    assert.equal(bDispatch.rows.some(r => r.work_order_id === A.woA.id), false);
    assert.equal(bDispatch.rows.some(r => r.app_id === A.qcApp), false);
  });

  it('empties the scope for a foreign department instead of widening it', async () => {
    const res = await get(A.token, `/api/floor/dispatch?department_id=${B.dept}`);
    assert.equal(res.scope.valid, false, 'the server says the id resolved to nothing');
    assert.deepEqual(res.rows, [], 'and answers with no rows, not with everything');
  });

  // ── 5. One operator's own day, on the plant's calendar ────────────────────

  it('counts an operator\'s finished runs on the plant\'s day, not Greenwich\'s', async () => {
    const res = await get(A.token, '/api/floor/snapshot?operator_name=Ada%20Lovelace');

    assert.equal(res.timezone, ZONE);
    assert.equal(res.plant_date, A.plantDate);
    assert.equal(res.finished_today_for_operator, 1,
      `a run finished at 22:00 in Detroit belongs to ${A.plantDate}; `
      + `in UTC that stamp reads ${localDate('UTC', A.eveningStamp)}`);
    assert.equal(res.finished_today_for_operator_reason, null);
    // The whole point of measuring it server-side: the UTC calendar disagrees.
    assert.notEqual(localDate('UTC', A.eveningStamp), A.plantDate,
      'the fixture is pointless unless 22:00 Detroit is a different UTC date');

    // A name is not a key: case and stray spaces are the same person.
    for (const spelling of ['ada%20lovelace', '%20Ada%20Lovelace%20', 'ADA%20LOVELACE']) {
      const same = await get(A.token, `/api/floor/snapshot?operator_name=${spelling}`);
      assert.equal(same.finished_today_for_operator, 1,
        `"${decodeURIComponent(spelling)}" is the same operator`);
    }
  });

  it('says nothing rather than zero about a name it has never seen', async () => {
    // ── MINOR (b) ──
    // "You finished nothing today" and "we have never heard of you" are
    // different statements, and a misspelled name printing 0 reads as a bad
    // shift rather than a typo.
    const unknown = await get(A.token, '/api/floor/snapshot?operator_name=Grace%20Hopper');
    assert.equal(unknown.finished_today_for_operator, null);
    assert.match(unknown.finished_today_for_operator_reason, /no run has ever been recorded under that name/i);

    // Somebody who HAS run something, but not today, is a measured zero.
    const idle = await get(A.token, `/api/floor/snapshot?operator_name=${encodeURIComponent(A.idleOperator)}`);
    assert.equal(idle.finished_today_for_operator, 0,
      'zero is a measurement here — this operator ran something once, just not today');
    assert.equal(idle.finished_today_for_operator_reason, null);
  });

  it('says nothing rather than zero when nobody said who is asking', async () => {
    const res = await get(A.token, '/api/floor/snapshot');
    assert.equal(res.finished_today_for_operator, null, 'null, never a 0 reading as "you did nothing"');
    assert.match(res.finished_today_for_operator_reason, /no operator/i);
  });

  it('does not resolve an operator id belonging to another company', async () => {
    const rivalUser = await get(B.token, '/api/auth/me');
    const res = await get(A.token, `/api/floor/snapshot?operator_user_id=${rivalUser.user?.id ?? rivalUser.id}`);
    assert.equal(res.finished_today_for_operator, null);
    assert.match(res.finished_today_for_operator_reason, /roster/i);
  });

  // ── 6. WIP by operation ───────────────────────────────────────────────────

  it('summarises running and queued work per department', async () => {
    const res = await get(A.token, '/api/floor/wip-summary');
    const weld = res.departments.find(d => d.department_name === 'Weld');
    assert.ok(weld, 'Weld is on the strip');

    // Weld's open operations: WO-042 has 1 ready + 4 queued (2 complete),
    // WO-043 has 3 ready/queued + 1 ready at sequence 4, WO-044 has 4.
    assert.equal(weld.running, 0, 'nothing has been started on the bench');
    assert.ok(weld.queued > 0, 'plenty is waiting');
    assert.equal(weld.queued_basis, 'ready + queued operations',
      'the payload names what it counted, so the strip cannot re-word it');

    const totals = res.totals;
    assert.equal(totals.queued, res.departments.reduce((n, d) => n + d.queued, 0));
  });

  it('reports good and scrap as null WITH A REASON until they are counted', async () => {
    const res = await get(A.token, '/api/floor/wip-summary');
    for (const dept of res.departments) {
      assert.equal(dept.good_today, null, 'a plant that has counted nothing has not made zero good');
      assert.equal(dept.scrap_today, null, 'and it certainly has not made zero scrap');
      assert.equal(dept.good_today_reason, 'not counted yet');
      assert.equal(dept.scrap_today_reason, 'not counted yet');
      assert.equal(dept.good_today_sample, 0);
    }
    assert.equal(res.totals.good_today, null);
    assert.equal(res.totals.scrap_today, null);
    assert.match(res.totals.scrap_today_reason, /not counted yet/);
  });


  // ── 7. A job that is over is not "at" anywhere ────────────────────────────

  it('says a cancelled job was cancelled, and a finished one is finished', async () => {
    // ── M6 ──
    // "WO-2026-047 is at operation 3 of 7, 12 of 50 done" about a job somebody
    // cancelled last week sends a supervisor to a machine to look for work
    // nobody is ever going to do.
    const cancelled = await ok('POST', '/api/work-orders', {
      token: A.token,
      body: {
        work_order_number: 'WO-2026-047', part_number: 'PN-OVER', part_name: 'Lever',
        quantity: 4, priority: 'low', department_id: A.weld,
      },
    }, 'cancelled job');
    await ok('POST', `/api/work-orders/${cancelled.id}/release`, { token: A.token, body: { routing_id: A.shortRouting } }, 'release cancelled');

    const done = await ok('POST', '/api/work-orders', {
      token: A.token,
      body: {
        work_order_number: 'WO-2026-048', part_number: 'PN-OVER', part_name: 'Lever',
        quantity: 4, priority: 'low', department_id: A.weld,
      },
    }, 'finished job');
    const doneOps = (await ok('POST', `/api/work-orders/${done.id}/release`, { token: A.token, body: { routing_id: A.shortRouting } }, 'release finished')).operations;

    const raw = new Database(DB_PATH);
    raw.prepare("UPDATE work_orders SET status = 'cancelled' WHERE id = ?").run(cancelled.id);
    raw.prepare("UPDATE work_orders SET status = 'completed', quantity_completed = 4 WHERE id = ?").run(done.id);
    raw.close();

    const wasCancelled = await get(A.token, '/api/floor/wip?q=WO-2026-047');
    assert.equal(wasCancelled.answer, 'WO-2026-047 was cancelled');
    assert.equal(wasCancelled.result.work_order_status, 'cancelled');
    assert.equal(wasCancelled.result.operation_sequence, null,
      'a cancelled job is not standing at an operation');

    const isDone = await get(A.token, '/api/floor/wip?q=WO-2026-048');
    assert.equal(isDone.answer, `WO-2026-048 is complete: ${doneOps.length} of ${doneOps.length} operations`);
    assert.equal(isDone.result.work_order_status, 'completed');

    // …and a part search is "where is my WIP", so neither of them is in it.
    const byPart = await get(A.token, '/api/floor/wip?q=PN-OVER');
    assert.equal(byPart.match, 'none',
      'both jobs on this part are over, so the part has no work in progress');
    assert.match(byPart.reason, /no work order or part number matches/i);
  });

  it('says a held operation is held, and why', async () => {
    // ── MINOR ──
    // A job stopped on purpose is not "in progress at operation 1". Somebody is
    // waiting for an answer, and the reason lives on the work order because a
    // status word cannot carry one.
    const op = A.opsC.find(o => o.sequence === 1);
    const held = await api('PUT', `/api/work-orders/${A.woC.id}/operations/${op.id}`, {
      token: A.token, body: { status: 'on_hold', hold_reason: 'waiting on material' },
    });
    assert.ok(held.status < 300, `holding: ${JSON.stringify(held.json)}`);

    const res = await get(A.token, '/api/floor/wip?q=WO-2026-044');
    assert.match(res.answer, /on hold/i, `expected an on-hold sentence, got: ${res.answer}`);
    assert.equal(res.result.status, 'on_hold');

    // Put it back — the ordering fixture above depends on it being ready.
    await ok('PUT', `/api/work-orders/${A.woC.id}/operations/${op.id}`, {
      token: A.token, body: { status: 'ready' },
    }, 'un-hold');
  });

  it('lists them all rather than picking one when a NUMBER is ambiguous', async () => {
    // ── MINOR (a) ──
    // "2026-042" is a real thing a floor types, and it matches this plant's
    // WO-2026-042 as well as an imported job whose number carries no prefix at
    // all. Two jobs answering to what somebody typed is a fact they have to
    // see; printing results[0] as THE answer sends them to one machine with
    // total confidence and a 50% chance.
    const bare = await ok('POST', '/api/work-orders', {
      token: A.token,
      body: {
        work_order_number: '2026-042', part_number: 'PN-IMPORTED', part_name: 'Imported',
        quantity: 6, priority: 'low', department_id: A.weld,
      },
    }, 'prefix-less job');

    const res = await get(A.token, '/api/floor/wip?q=2026-042');
    assert.equal(res.match, 'work_order');
    assert.equal(res.result, null, 'no silent pick');
    assert.equal(res.results.length, 2, 'both jobs answer to what was typed');
    assert.deepEqual(
      res.results.map(r => r.work_order_number).sort(),
      ['2026-042', 'WO-2026-042'],
    );
    assert.match(res.answer, /2 work orders answer to "2026-042"/);

    // Spelling the prefix out does not disambiguate, and must not pretend to:
    // the candidate rule exists precisely because "WO-2026-042" and "2026-042"
    // are the same thing said two ways, so while both jobs exist BOTH answers
    // are honest ones and the searcher gets to choose.
    const spelled = await get(A.token, '/api/floor/wip?q=WO-2026-042');
    assert.equal(spelled.results.length, 2);
    assert.equal(spelled.result, null);

    // Clear the twin away — the fixture is shared, and a second job answering
    // to "2026-042" is not what the earlier assertions expect.
    await ok('DELETE', `/api/work-orders/${bare.id}`, { token: A.token }, 'remove prefix-less job');

    const alone = await get(A.token, '/api/floor/wip?q=WO-2026-042');
    assert.equal(alone.results.length, 1, 'one job, one sentence, no list');
    assert.equal(alone.result.work_order_id, A.woA.id);
    assert.equal(alone.answer, 'WO-2026-042 is at operation 3 of 7 (Weld), 12 of 50 done');
  });

  // ── 8. A keystroke is not a hundred queries ───────────────────────────────

  it('answers a part with sixty jobs on it in a fixed number of statements', async () => {
    // ── M5 ──
    // This box is typed into. The version this replaces asked
    // currentOperationFor per matching row — two statements each, 122 for sixty
    // jobs — on every keystroke, on two screens.
    const many = 60;
    for (let i = 0; i < many; i++) {
      const wo = await ok('POST', '/api/work-orders', {
        token: A.token,
        body: {
          work_order_number: `WO-2026-9${String(i).padStart(2, '0')}`,
          part_number: 'PN-CROWD', part_name: 'Crowd', quantity: 3,
          priority: 'medium', department_id: A.weld,
        },
      }, `crowd ${i}`);
      await ok('POST', `/api/work-orders/${wo.id}/release`, { token: A.token, body: { routing_id: A.shortRouting } }, `release crowd ${i}`);
    }

    // Measured in THIS process, against the same database file, the way
    // test/wo-operations.test.js measures the work-order list.
    process.env.DATABASE_PATH = DB_PATH;
    process.env.SEED_DEMO_DATA = 'false';
    const db = require('../src/db');
    const { wipSearch, plantContext, WIP_PART_LIMIT } = require('../src/plantTruth');
    const rawPrepare = db.prepare.bind(db);

    // The route resolves the plant day ONCE per request and hands the context
    // in (that read is one statement, and it is the request's, not this
    // search's), so measure what the route actually costs here.
    const ctx = plantContext(A.companyId);

    let statements = 0;
    db.prepare = sql => { statements++; return rawPrepare(sql); };
    let answer;
    try {
      answer = wipSearch(ctx, 'PN-CROWD');
    } finally {
      db.prepare = rawPrepare;
    }

    console.log(`      # statements for ${many} matching jobs: ${statements}`);
    // Four: one pass that answers both questions and carries the group totals,
    // two for workOrderOperations' own "where does each job stand" (a count and
    // a pointer lookup), and one for the start stamps. A job whose pointer is
    // stale costs ONE more sweep for the whole page — still fixed, still not
    // per row.
    assert.ok(statements <= 4,
      `answering about ${many} jobs took ${statements} statements`);
    assert.ok(statements < many, 'the cost is still growing with the number of jobs');

    // …and the page is capped, and SAYS it is capped, so nobody reads 25 as all.
    assert.equal(answer.results.length, WIP_PART_LIMIT);
    assert.equal(answer.total_matches, many);
    assert.equal(answer.truncated, true);
    assert.match(answer.truncated_note, new RegExp(`first ${WIP_PART_LIMIT} of ${many}`));
    assert.match(answer.answer, new RegExp(`^${many} work orders carry part PN-CROWD$`));
  });

  // ── 9. Nothing is counted nowhere ─────────────────────────────────────────

  it('counts work that belongs to no department, in its own bucket and in the totals', async () => {
    // ── M1 ──
    // The strip grouped by department and summed the ROWS, so a standing-app
    // run (no work order, no station, therefore no department) and a work order
    // nobody filed under one were dropped from both. The plant counted 12 good
    // and the screen said 7, and nothing on it said which five went.
    const inWeld = await ok('POST', '/api/completions', {
      token: A.token, body: { app_id: A.weldApp, work_order_id: A.woA.id, operator_name: 'Ada Lovelace' },
    }, 'counted run in Weld');
    const orphanRun = await ok('POST', '/api/completions', {
      token: A.token, body: { app_id: A.qcApp, operator_name: 'Ada Lovelace' },
    }, 'standing-app run, no department');
    for (const id of [inWeld.id, orphanRun.id]) {
      await ok('PUT', `/api/completions/${id}`, { token: A.token, body: { status: 'completed', data: {} } }, 'finish');
    }

    // A released job filed under no department at all — its operations belong
    // nowhere either.
    const homeless = await ok('POST', '/api/work-orders', {
      token: A.token,
      body: {
        work_order_number: 'WO-2026-049', part_number: 'PN-NOWHERE', part_name: 'Orphan',
        quantity: 2, priority: 'low',
      },
    }, 'department-less job');
    await ok('POST', `/api/work-orders/${homeless.id}/release`, { token: A.token, body: { routing_id: A.noDeptRouting } }, 'release homeless');

    const raw = new Database(DB_PATH);
    const stamp = raw.prepare('UPDATE completions SET quantity_good = ?, quantity_scrap = ?, completed_at = ? WHERE id = ?');
    const nowish = toSqlite(new Date());
    stamp.run(7, 2, nowish, inWeld.id);      // counted, in Weld
    stamp.run(5, 1, nowish, orphanRun.id);   // counted, in no department at all
    raw.close();

    const res = await get(A.token, '/api/floor/wip-summary');

    const weld = res.departments.find(d => d.department_name === 'Weld');
    assert.equal(weld.good_today, 7, 'Weld counted seven');
    assert.equal(weld.scrap_today, 2);

    const nowhere = res.departments.find(d => d.department_name === 'No department');
    assert.ok(nowhere, 'the work that belongs to no department has a row of its own');
    assert.equal(nowhere.department_id, null);
    assert.equal(nowhere.good_today, 5, 'and the five nobody could file are in it');
    assert.equal(nowhere.scrap_today, 1);
    assert.ok(nowhere.queued > 0, "…as are the department-less job's operations");

    // The totals are the PLANT's, taken ungrouped — never the sum of the rows,
    // which is exactly how the five went missing.
    assert.equal(res.totals.good_today, 12, 'the plant counted twelve good');
    assert.equal(res.totals.scrap_today, 3, 'and three scrap');
    assert.equal(res.totals.good_today_sample, 2);
    assert.match(res.totals.basis, /department or not/);

    const summed = res.departments.reduce((n, d) => n + (d.good_today ?? 0), 0);
    assert.equal(summed, res.totals.good_today,
      'with the bucket present the rows now add up to the total — that is the point of it');

    // A department filter is a department's scope: no orphan bucket there.
    const scoped = await get(A.token, `/api/floor/wip-summary?department_id=${A.weld}`);
    assert.equal(scoped.departments.some(d => d.department_name === 'No department'), false);
    assert.equal(scoped.totals.good_today, 7, 'and the total is that department\'s');
  });

  it('is bound to the plant\'s day like every other floor number', async () => {
    const res = await get(A.token, '/api/floor/wip-summary');
    assert.equal(res.plant_date, A.plantDate);
    assert.equal(res.timezone, ZONE);
    const dispatch = await get(A.token, '/api/floor/dispatch');
    assert.equal(dispatch.plant_date, A.plantDate);
    assert.equal(dispatch.timezone, ZONE);
  });
});

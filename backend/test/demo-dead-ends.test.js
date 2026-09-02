'use strict';
// ─── The demo's dead ends ─────────────────────────────────────────────────────
// A GO/NO-GO audit of the finished five-wave program walked the public demo the
// way a prospect does and kept hitting walls that no suite was watching:
//
//   • the floor search box answered "not found" about the job on the screen
//     behind it, because the sandbox minted 'ABC123-WO-1001' and printed
//     'WO-1001' (B1),
//   • the training block could not be cleared, because the only two people at
//     supervisor rank had no PIN (B3),
//   • every run read "ran against Rev 1, published today" (M7),
//   • the operator portal at the one station with runs said "All caught up",
//     because the routed operations were pinned to a different station (M10),
//   • a refusal told a plant manager they needed a "developer" role (M13),
//   • no PM had ever raised its own job (M14),
//   • the demo's PINs were nowhere on screen (N28),
//   • "vs 7-day average" divided by seven whatever the plant's age (N20),
//   • /analytics/overview widened a foreign filter to the whole plant (N21),
//   • the Pareto stuttered "Breakdown · Breakdown" (N24),
//   • /api/oee answered 200 to ?days=abc (N30).
//
// Each test below is one of those walls. Uses Node built-ins only. Run with:
//   node --test test/demo-dead-ends.test.js

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const PORT = 3416; // reserved for this stream (demo dead ends)
const BASE = `http://localhost:${PORT}`;
const DB_PATH = path.join(os.tmpdir(), `mes-demo-dead-ends-${Date.now()}.db`);

process.env.DATABASE_PATH = DB_PATH;
process.env.SEED_DEMO_DATA = 'false';

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

// The sandbox a visitor gets, and a REAL company signed up alongside it — every
// "…and a real company does not" assertion needs both in one process.
let token, orgId, db;
let realToken, realOrgId, realDeptId;

before(async () => {
  await startServer();

  const demo = await api('POST', '/api/auth/demo');
  assert.equal(demo.status, 201, `demo login: ${JSON.stringify(demo.json)}`);
  token = demo.json.token;

  db = require('../src/db');
  orgId = db.prepare('SELECT company_id FROM users WHERE id = ?').get(demo.json.user.id).company_id;

  const signup = await api('POST', '/api/auth/signup', {
    body: {
      company_name: 'Tagged Numbers Co', email: `owner-${Date.now()}@dead-ends.test`,
      password: 'SecretPass1', display_name: 'Owner Person',
    },
  });
  assert.equal(signup.status, 201, `signup: ${JSON.stringify(signup.json)}`);
  realToken = signup.json.token;
  realOrgId = db.prepare('SELECT company_id FROM users WHERE id = ?').get(signup.json.user.id).company_id;

  const dept = await api('POST', '/api/departments', { token: realToken, body: { name: 'Assembly' } });
  assert.equal(dept.status, 201, `department: ${JSON.stringify(dept.json)}`);
  realDeptId = dept.json.id;
});

after(() => {
  if (server) server.kill('SIGTERM');
  for (const ext of ['', '-shm', '-wal']) { try { fs.unlinkSync(DB_PATH + ext); } catch { /* ignore */ } }
});

// ─── B1 (a): a number is found however its prefix is spelled ─────────────────

test('B1a: a tag-prefixed work order answers to the number the screen prints', async () => {
  const created = await api('POST', '/api/work-orders', {
    token: realToken,
    body: {
      work_order_number: 'ABC123-WO-1001', part_number: 'ABC123-BRKT-100',
      part_name: 'Standard Bracket', quantity: 25, priority: 'high',
      department_id: realDeptId,
    },
  });
  assert.equal(created.status, 201, `work order: ${JSON.stringify(created.json)}`);

  // The three spellings a floor actually uses: what is printed, what is typed
  // in a hurry, and the bare sequence off a traveller.
  for (const q of ['WO-1001', 'wo-1001', '1001', 'ABC123-WO-1001']) {
    const res = await api('GET', `/api/floor/wip?q=${encodeURIComponent(q)}`, { token: realToken });
    assert.equal(res.status, 200);
    assert.equal(res.json.match, 'work_order', `"${q}" must resolve to the job (got ${res.json.reason})`);
    assert.equal(res.json.result.work_order_number, 'ABC123-WO-1001');
    assert.ok(res.json.answer.startsWith('ABC123-WO-1001'), res.json.answer);
  }

  // The part number the same way — the SKU on the screen has no tag on it.
  const byPart = await api('GET', '/api/floor/wip?q=BRKT-100', { token: realToken });
  assert.equal(byPart.json.match, 'part_number', `part search: ${byPart.json.reason}`);
  assert.equal(byPart.json.result.part_number, 'ABC123-BRKT-100');

  // And still nothing at all for a number nobody owns.
  const missing = await api('GET', '/api/floor/wip?q=WO-9999', { token: realToken });
  assert.equal(missing.json.match, 'none');
  assert.match(missing.json.reason, /no work order or part number matches/i);
});

// ─── B1 (b): the sandbox itself mints numbers a human can read ───────────────

test('B1b: the sandbox seeds human numbers, not tagged ones', () => {
  const tagged = /^[0-9A-F]{6}-/;
  const check = (rows, column, label) => {
    assert.ok(rows.length > 0, `${label} seeded`);
    for (const row of rows) {
      assert.ok(!tagged.test(row[column]), `${label} '${row[column]}' still carries a company tag`);
    }
  };
  check(db.prepare('SELECT work_order_number FROM work_orders WHERE company_id = ?').all(orgId), 'work_order_number', 'work order');
  check(db.prepare('SELECT ncr_number FROM ncrs WHERE company_id = ?').all(orgId), 'ncr_number', 'NCR');
  check(db.prepare('SELECT po_number FROM purchase_orders WHERE company_id = ?').all(orgId), 'po_number', 'purchase order');
  check(db.prepare('SELECT sku FROM items WHERE company_id = ?').all(orgId), 'sku', 'item SKU');
  check(db.prepare('SELECT wo_number FROM maintenance_work_orders WHERE company_id = ?').all(orgId), 'wo_number', 'maintenance work order');
  check(db.prepare('SELECT code FROM vendors WHERE company_id = ?').all(orgId), 'code', 'vendor code');
  check(db.prepare('SELECT code FROM locations WHERE company_id = ?').all(orgId), 'code', 'location code');

  // The numbers the audit walked the demo by, by name.
  const numbers = db.prepare('SELECT work_order_number FROM work_orders WHERE company_id = ?')
    .all(orgId).map(r => r.work_order_number);
  for (const n of ['WO-1001', 'WO-3001']) assert.ok(numbers.includes(n), `${n} is seeded verbatim (got ${numbers.join(', ')})`);

  // The search box answers about it in the sandbox too.
  assert.ok(numbers.includes('WO-1001'));
});

test('B1b: the sandbox is still deletable with its untagged rows', () => {
  // deleteSandboxOrg is proven against the demo org in demo-seed-truth.test.js;
  // here it only has to survive a SECOND sandbox in the same database, which is
  // what untagged numbering makes possible in the first place.
  const { createSandbox, deleteSandboxOrg } = require('../src/sandbox');
  const crypto = require('node:crypto');
  const second = createSandbox(() => crypto.randomBytes(32).toString('hex'));
  assert.notEqual(second.orgId, orgId, 'two sandboxes coexist with the same numbers');
  assert.equal(
    db.prepare("SELECT COUNT(*) c FROM work_orders WHERE work_order_number = 'WO-1001'").get().c, 2,
    'both sandboxes minted the same plain number — company-scoped uniqueness allows it',
  );
  deleteSandboxOrg(second.orgId);
  assert.equal(db.prepare('SELECT COUNT(*) c FROM organizations WHERE id = ?').get(second.orgId).c, 0);
});

// ─── B3: the training block can actually be cleared ─────────────────────────

test('B3: the sandbox supervisor and manager carry PINs an authorizer prompt accepts', async () => {
  const sup = await api('POST', '/api/operators/verify-authorizer', { token, body: { pin: '2468' } });
  assert.equal(sup.status, 200, `supervisor PIN: ${JSON.stringify(sup.json)}`);
  assert.equal(sup.json.role, 'supervisor');
  assert.equal(sup.json.display_name, 'Jamie Torres');
  assert.ok(sup.json.authorization_id, 'a single-use grant is minted');

  const mgr = await api('POST', '/api/operators/verify-authorizer', { token, body: { pin: '1357' } });
  assert.equal(mgr.status, 200, `manager PIN: ${JSON.stringify(mgr.json)}`);
  assert.equal(mgr.json.role, 'manager');

  // The operator PIN is a real PIN and still not an authorization: the refusal
  // has to be "not senior enough", never "PIN not recognized".
  const op = await api('POST', '/api/operators/verify-authorizer', { token, body: { pin: '1234' } });
  assert.equal(op.status, 403);
  assert.match(op.json.error, /supervisor or above/i);
});

// ─── M7: no run was measured against instructions that did not exist yet ────

test('M7: every stamped run started after the revision it is stamped with', () => {
  const early = db.prepare(`
    SELECT c.id, c.started_at, r.revision, r.effective_at
    FROM completions c JOIN app_revisions r ON r.id = c.app_revision_id
    WHERE c.company_id = ? AND julianday(c.started_at) < julianday(r.effective_at)
  `).all(orgId);
  assert.deepEqual(early, [], 'a run stamped with a revision published after it');
});

test('M7: the flagship app is under change control, and its runs say which revision', () => {
  const app = db.prepare("SELECT id, current_revision FROM apps WHERE company_id = ? AND name = 'Bracket Assembly'").get(orgId);
  assert.ok(app, 'Bracket Assembly is seeded');
  assert.ok(app.current_revision >= 1, `current_revision >= 1 (got ${app.current_revision})`);

  const rev1 = db.prepare('SELECT * FROM app_revisions WHERE company_id = ? AND app_id = ? AND revision = 1').get(orgId, app.id);
  assert.ok(rev1, 'Rev 1 exists');
  assert.equal(rev1.change_note, 'First release');
  assert.ok(rev1.published_by_user_id, 'a named publisher');
  assert.ok(rev1.approved_by_user_id, 'a named approver');
  assert.notEqual(rev1.published_by_user_id, rev1.approved_by_user_id, 'one pair of hands writes, another signs off');
  const approver = db.prepare('SELECT role FROM users WHERE id = ?').get(rev1.approved_by_user_id);
  assert.equal(approver.role, 'manager');

  const unstamped = db.prepare(
    'SELECT COUNT(*) c FROM completions WHERE company_id = ? AND app_id = ? AND app_revision_id IS NULL'
  ).get(orgId, app.id).c;
  assert.equal(unstamped, 0, 'every Bracket Assembly run carries the revision it ran against');
});

// ─── M10: the portal at the station with the runs has work on it ────────────

test('M10: Station 1 dispatch lists the released operations', async () => {
  const st1 = db.prepare("SELECT id FROM stations WHERE company_id = ? AND name = 'Station 1'").get(orgId);
  assert.ok(st1, 'Station 1 is seeded');

  const res = await api('GET', `/api/floor/dispatch?station_id=${st1.id}`, { token });
  assert.equal(res.status, 200);
  assert.equal(res.json.scope.valid, true);
  assert.ok(res.json.rows.length > 0, 'the portal at Station 1 is not "All caught up"');
  const ops = res.json.rows.filter(r => r.kind === 'operation');
  assert.ok(ops.length > 0, `a released operation reaches Station 1 (got ${JSON.stringify(res.json.rows.map(r => r.kind))})`);
  assert.ok(ops.some(o => o.work_order_number === 'WO-3001'), 'the job standing on Weld is one of them');
});

// ─── M11: operator-visible copy names no part of the product's plumbing ─────

test('M11: the seeded app description is written for the floor', () => {
  const app = db.prepare("SELECT description FROM apps WHERE company_id = ? AND name = 'Bracket Assembly'").get(orgId);
  assert.equal(app.description, 'Sample work instruction for the bracket line. Tap Start to run it.');

  // No developer vocabulary anywhere an operator can read it.
  const rows = db.prepare('SELECT name, description, steps FROM apps WHERE company_id = ?').all(orgId);
  for (const row of rows) {
    const visible = [row.name, row.description];
    for (const step of JSON.parse(row.steps || '[]')) {
      visible.push(step.name);
      for (const w of step.widgets || []) {
        visible.push(w.label || '');
        visible.push((w.config && w.config.content) || '');
        visible.push((w.config && w.config.buttonText) || '');
        visible.push((w.config && w.config.placeholder) || '');
      }
    }
    for (const text of visible) {
      assert.doesNotMatch(String(text), /\b(widget|canvas|player|app builder)\b/i,
        `operator-visible copy names product plumbing: ${JSON.stringify(text)}`);
    }
  }
});

// ─── M13: a refusal calls a role what the product calls it ──────────────────

test('M13: the role guard says "Owner", not "developer"', async () => {
  // The sandbox visitor is a manager — one rung below the account owner.
  const me = await api('GET', '/api/auth/me', { token });
  assert.equal(me.json.role, 'manager');

  const res = await api('POST', '/api/users', {
    token,
    body: { email: 'nope@example.test', display_name: 'Nope', password: 'SecretPass1' },
  });
  assert.equal(res.status, 403);
  assert.equal(res.json.error, 'Requires Owner role or higher');
  assert.doesNotMatch(res.json.error, /developer/i);
});

// ─── M14: a PM that put a job on the board by itself ────────────────────────

test('M14: the demo has a maintenance job the PM sweeper raised', () => {
  const raised = db.prepare(`
    SELECT * FROM maintenance_work_orders
    WHERE company_id = ? AND pm_schedule_id IS NOT NULL AND raised_by = 'system'
  `).all(orgId);
  assert.equal(raised.length, 1, 'exactly one PM-raised job — the sweeper never raises two for one schedule');
  const job = raised[0];
  assert.equal(job.type, 'preventive');
  assert.match(job.description, /Raised automatically from PM/i);
  assert.ok(job.wo_number, 'it carries the scheduler\'s own numbering');

  const schedule = db.prepare('SELECT * FROM pm_schedules WHERE id = ? AND company_id = ?').get(job.pm_schedule_id, orgId);
  assert.ok(schedule, 'the schedule it came from is still there');
  assert.equal(schedule.last_raised_wo_id, job.id, 'the schedule remembers the job, so no second one is raised');

  const line = db.prepare(
    "SELECT action FROM activity_log WHERE company_id = ? AND entity_id = ? AND entity_type = 'maintenance'"
  ).get(orgId, job.id);
  assert.ok(line && /raised automatically from PM/i.test(line.action), 'the activity trail says who raised it');
});

// ─── N20: "vs 7-day average" divides by the days the plant ran ──────────────

test('N20: the 7-day baseline counts days with output, and says how many', async () => {
  const brief = await api('GET', '/api/analytics/daily-brief', { token });
  assert.equal(brief.status, 200);
  assert.ok(brief.json.kpis.vs_7day_sample_days >= 2,
    `the demo has several days of history (got ${brief.json.kpis.vs_7day_sample_days})`);
  assert.equal(typeof brief.json.kpis.vs_7day_avg_pct, 'number');
  assert.equal(brief.json.kpis.vs_7day_reason, null);
  assert.equal(brief.json.week_avg_basis, 'days with any completion in the last 7');

  // A company with no history has no average — and says so, rather than
  // dividing one day's work by seven and printing a percentage.
  const fresh = await api('GET', '/api/analytics/daily-brief', { token: realToken });
  assert.equal(fresh.status, 200);
  assert.equal(fresh.json.kpis.vs_7day_sample_days, 0);
  assert.strictEqual(fresh.json.kpis.vs_7day_avg_pct, null);
  assert.ok(fresh.json.kpis.vs_7day_reason, 'a null number carries its reason');
});

// ─── N21: a filter this company does not own narrows to nothing ─────────────

test('N21: /analytics/overview echoes scope_valid: false for a foreign id', async () => {
  const good = await api('GET', '/api/analytics/overview', { token });
  assert.equal(good.status, 200);
  assert.equal(good.json.scope_valid, true);
  assert.ok(good.json.totalCompletions > 0);

  const foreignApp = db.prepare("SELECT id FROM apps WHERE company_id = ?").get(realOrgId);
  for (const qs of [
    'app_id=00000000-0000-4000-8000-000000000000',
    'department_id=00000000-0000-4000-8000-000000000000',
    'site_id=00000000-0000-4000-8000-000000000000',
    ...(foreignApp ? [`app_id=${foreignApp.id}`] : []),
  ]) {
    const res = await api('GET', `/api/analytics/overview?${qs}`, { token });
    assert.equal(res.status, 200, qs);
    assert.equal(res.json.scope_valid, false, `${qs} must not widen to the whole plant`);
    assert.equal(res.json.totalCompletions, 0, qs);
    assert.equal(res.json.todayCompletions, 0, qs);
    assert.strictEqual(res.json.passRate, null, qs);
    assert.ok(res.json.pass_rate_reason, `${qs} says why the number is missing`);
  }
});

// ─── N24: the Pareto does not stutter ───────────────────────────────────────

test('N24: a reason whose label IS its bucket carries no bucket label', async () => {
  const res = await api('GET', '/api/oee/losses?days=7', { token });
  assert.equal(res.status, 200);
  const rows = res.json.pareto;
  assert.ok(rows.length >= 2, 'the demo Pareto has named bars');

  const breakdown = rows.find(r => r.label === 'Breakdown');
  assert.ok(breakdown, `a 'Breakdown' bar exists (got ${rows.map(r => r.label).join(', ')})`);
  assert.strictEqual(breakdown.bucket_label, null, "'Breakdown · Breakdown' is one word said twice");
  assert.equal(breakdown.loss_bucket, 'breakdown', 'the bucket itself is still reported');

  const jam = rows.find(r => r.label === 'Jam');
  assert.ok(jam, 'a Jam bar exists');
  assert.equal(jam.bucket_label, 'Minor stop', 'a bucket that adds something is still printed');
});

// ─── N28: the demo tells a visitor its own PINs — and only the demo ─────────

test('N28: /auth/me carries demo_hints on a sandbox and nowhere else', async () => {
  const me = await api('GET', '/api/auth/me', { token });
  assert.equal(me.status, 200);
  assert.deepEqual(me.json.demo_hints, {
    operator_pin: '1234',
    supervisor_pin: '2468',
    manager_pin: '1357',
  });

  const real = await api('GET', '/api/auth/me', { token: realToken });
  assert.equal(real.status, 200);
  assert.equal(real.json.demo_hints, undefined, 'a real company is never handed PINs');
  assert.ok(!('demo_hints' in real.json), 'the key is absent, not null');
});

// ─── N30: a window this endpoint cannot honour is refused ───────────────────

test('N30: /api/oee refuses a bad ?days instead of answering 200', async () => {
  for (const bad of ['-1', 'abc', '0', '3.5', '400']) {
    const res = await api('GET', `/api/oee?days=${bad}`, { token });
    assert.equal(res.status, 400, `?days=${bad} must be refused`);
    assert.equal(res.json.error, 'days must be a whole number between 1 and 365');
    assert.equal(res.json.field, 'days');
  }
  const ok = await api('GET', '/api/oee', { token });
  assert.equal(ok.status, 200);
  assert.ok(Array.isArray(ok.json));

  // The single-station view answers the same way.
  const st1 = db.prepare("SELECT id FROM stations WHERE company_id = ? AND name = 'Station 1'").get(orgId);
  const one = await api('GET', `/api/oee/${st1.id}?days=abc`, { token });
  assert.equal(one.status, 400);
});

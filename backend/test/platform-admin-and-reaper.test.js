'use strict';
// ─── Platform-staff gate + stale-run reaper ───────────────────────────────────
//
// Two launch blockers, one server:
//
//  B1 — /api/admin/* is HartMonitor's own cross-tenant operator console, but the
//       first user of every new signup is given role 'developer', which used to
//       be the only thing guarding it. These tests pin down that a brand-new
//       customer cannot reach a single one of those endpoints, that the ONLY
//       way in is the deployment's PLATFORM_STAFF_EMAILS allowlist, and that a
//       real staff account gets real numbers back.
//
//  S8 — runs left open by a dead tablet used to sit at 'in_progress' forever.
//       These tests pin the reaper's threshold on BOTH sides of the boundary,
//       that it preserves whatever the operator had entered, that a reaped run
//       is distinguishable from an operator-abandoned one, and that it is both
//       idempotent and tenant-safe.
//
// Node built-ins only (node:test + global fetch). Run with: npm test

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { v4: uuidv4 } = require('uuid');

const PORT = 3252;
const BASE = `http://localhost:${PORT}`;
const DB_PATH = path.join(os.tmpdir(), `mes-platform-admin-${Date.now()}.db`);

const STAFF_EMAIL = 'ops@hartmonitor-staff.test';

// The reaper's own module, driven directly against the same database file the
// server writes to. Sweeping on the hourly timer would make these tests take an
// hour; the logic under test is the same function the timer calls.
process.env.DATABASE_PATH = DB_PATH;
// Left unset on purpose: db.js only rewrites the staff roster when this is
// present, so requiring it here must not disturb what the server granted.
delete process.env.PLATFORM_STAFF_EMAILS;

let server;
let db;
let reapStaleRuns;
let STALE_AFTER_HOURS;

function startServer(extraEnv = {}) {
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
        SMTP_HOST: '', SMTP_USER: '', SMTP_PASS: '',
        ...extraEnv,
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

function stopServer() {
  return new Promise(resolve => {
    if (!server) return resolve();
    const dead = server;
    server = null;
    dead.once('exit', () => resolve());
    dead.kill('SIGTERM');
    setTimeout(resolve, 5000);
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

// Every cross-tenant route on the console. /pending-resets is deliberately
// absent — it is company-scoped self-hosted password recovery, not platform
// tooling, and it stays available to a customer's own admin.
const PLATFORM_ROUTES = [
  ['GET', '/api/admin/stats'],
  ['GET', '/api/admin/companies'],
  ['GET', '/api/admin/users'],
  ['GET', '/api/admin/activity'],
  ['GET', '/api/admin/health'],
];

let ownerA, ownerB, staffToken, companyA, companyB, appA, appB;

before(async () => {
  await startServer();

  const a = await api('POST', '/api/auth/signup', {
    body: { company_name: 'Reaper Co A', email: 'owner@reaper-a.test', password: 'SecretPass1', display_name: 'Owner A' },
  });
  assert.equal(a.status, 201);
  ownerA = a.json.token;

  const b = await api('POST', '/api/auth/signup', {
    body: { company_name: 'Reaper Co B', email: 'owner@reaper-b.test', password: 'SecretPass2', display_name: 'Owner B' },
  });
  assert.equal(b.status, 201);
  ownerB = b.json.token;

  // A would-be staff member signs up exactly like any other customer. Nothing
  // about this signup may grant platform access.
  const s = await api('POST', '/api/auth/signup', {
    body: { company_name: 'HartMonitor Ops', email: STAFF_EMAIL, password: 'SecretPass3', display_name: 'Ops Person' },
  });
  assert.equal(s.status, 201);

  db = require('better-sqlite3')(DB_PATH);
  ({ reapStaleRuns, STALE_AFTER_HOURS } = require('../src/runReaper'));

  companyA = db.prepare('SELECT company_id AS id FROM users WHERE email = ?').get('owner@reaper-a.test').id;
  companyB = db.prepare('SELECT company_id AS id FROM users WHERE email = ?').get('owner@reaper-b.test').id;

  // Runs hang off a real app row (completions.app_id is a foreign key), so each
  // company needs one before the reaper tests can open runs against it.
  appA = (await api('POST', '/api/apps', { token: ownerA, body: { name: 'Reaper Fixture A' } })).json.id;
  appB = (await api('POST', '/api/apps', { token: ownerB, body: { name: 'Reaper Fixture B' } })).json.id;
  assert.ok(appA && appB);
});

after(async () => {
  if (db) { try { db.close(); } catch { /* ignore */ } }
  await stopServer();
  for (const ext of ['', '-shm', '-wal']) {
    try { fs.unlinkSync(DB_PATH + ext); } catch { /* ignore */ }
  }
});

// ─── B1: the platform console is not a customer feature ──────────────────────

describe('Platform admin console access', () => {
  it('a brand-new signup cannot reach ANY /api/admin platform endpoint', async () => {
    const me = await api('GET', '/api/auth/me', { token: ownerA });
    assert.equal(me.status, 200);
    assert.equal(me.json.role, 'developer', 'signup still makes the first user a developer in their own company');
    assert.equal(me.json.is_platform_staff, false, 'signup must never grant platform staff');

    for (const [method, route] of PLATFORM_ROUTES) {
      const res = await api(method, route, { token: ownerA });
      assert.equal(res.status, 404, `${method} ${route} must be unreachable for a new customer, got ${res.status}`);
    }
  });

  it('the plan-change route refuses a customer too — it is not a read-only leak', async () => {
    const res = await api('PUT', `/api/admin/companies/${companyB}/plan`, {
      token: ownerA, body: { tier: 'enterprise' },
    });
    assert.equal(res.status, 404);
    const plan = db.prepare('SELECT tier FROM plan WHERE company_id = ?').get(companyB);
    assert.notEqual(plan.tier, 'enterprise', 'company B must not have been upgraded by company A');
  });

  it('an account with no session is refused before any of this matters', async () => {
    const res = await api('GET', '/api/admin/stats');
    assert.equal(res.status, 401);
  });

  it('self-hosted password recovery stays available to a company admin', async () => {
    const res = await api('GET', '/api/admin/pending-resets', { token: ownerA });
    assert.equal(res.status, 200, 'pending-resets is company-scoped recovery, not platform tooling');
    assert.ok(Array.isArray(res.json));
  });

  it('the flag cannot be set through the API', async () => {
    // The obvious attempts: hand it to the user-update route, and hand it to
    // signup. Neither may move the column.
    const created = await api('POST', '/api/users', {
      token: ownerA,
      body: { email: 'sneaky@reaper-a.test', display_name: 'Sneaky', password: 'SecretPass9', role: 'manager', is_platform_staff: 1 },
    });
    assert.equal(created.status, 201);
    const row = db.prepare('SELECT is_platform_staff FROM users WHERE email = ?').get('sneaky@reaper-a.test');
    assert.equal(row.is_platform_staff, 0, 'POST /api/users must not be able to grant platform staff');

    const signedUp = await api('POST', '/api/auth/signup', {
      body: {
        company_name: 'Sneaky Co', email: 'sneaky2@reaper.test', password: 'SecretPass8',
        display_name: 'Sneaky Two', is_platform_staff: 1, role: 'developer',
      },
    });
    assert.equal(signedUp.status, 201);
    const row2 = db.prepare('SELECT is_platform_staff FROM users WHERE email = ?').get('sneaky2@reaper.test');
    assert.equal(row2.is_platform_staff, 0, 'signup must not be able to grant platform staff');
  });
});

describe('Platform admin console, granted through the deployment allowlist', () => {
  before(async () => {
    // The deployment's own environment is the only way in. Restarting with the
    // allowlist set is exactly what an operator does.
    await stopServer();
    await startServer({ PLATFORM_STAFF_EMAILS: STAFF_EMAIL });
    const login = await api('POST', '/api/auth/login', { body: { email: STAFF_EMAIL, password: 'SecretPass3' } });
    assert.equal(login.status, 200);
    staffToken = login.json.token;
  });

  it('the allowlist grants the flag at boot and /auth/me reports it', async () => {
    const me = await api('GET', '/api/auth/me', { token: staffToken });
    assert.equal(me.status, 200);
    assert.equal(me.json.is_platform_staff, true);
  });

  it('customers are STILL refused after staff exist', async () => {
    for (const [method, route] of PLATFORM_ROUTES) {
      const res = await api(method, route, { token: ownerA });
      assert.equal(res.status, 404, `${method} ${route} must stay closed to customers`);
    }
  });

  it('stats are real counts, not placeholders', async () => {
    const res = await api('GET', '/api/admin/stats', { token: staffToken });
    assert.equal(res.status, 200);

    const orgs = db.prepare('SELECT COUNT(*) AS n FROM organizations WHERE COALESCE(is_sandbox, 0) = 0').get().n;
    const users = db.prepare(`
      SELECT COUNT(*) AS n FROM users u JOIN organizations o ON o.id = u.company_id
       WHERE COALESCE(o.is_sandbox, 0) = 0
    `).get().n;
    assert.equal(res.json.total_companies, orgs, 'total_companies must match the database');
    assert.equal(res.json.total_users, users, 'total_users must match the database');
    assert.equal(typeof res.json.total_completions, 'number');
    assert.equal(typeof res.json.total_work_orders, 'number');
  });

  it('companies and users list every tenant, with filters that work', async () => {
    const all = await api('GET', '/api/admin/companies', { token: staffToken });
    assert.equal(all.status, 200);
    const ids = all.json.map(c => c.id);
    assert.ok(ids.includes(companyA) && ids.includes(companyB), 'the console sees every tenant by design');

    const rowA = all.json.find(c => c.id === companyA);
    assert.equal(rowA.owner_email, 'owner@reaper-a.test');
    assert.ok(rowA.user_count >= 1);

    const filtered = await api('GET', '/api/admin/companies?search=Reaper%20Co%20B', { token: staffToken });
    assert.equal(filtered.status, 200);
    assert.deepEqual(filtered.json.map(c => c.id), [companyB]);

    const byRole = await api('GET', '/api/admin/users?role=manager', { token: staffToken });
    assert.equal(byRole.status, 200);
    assert.ok(byRole.json.every(u => u.role === 'manager'), 'the role filter must actually filter');
  });

  it('health reports measured values, and an unmeasurable size is not zero', async () => {
    const res = await api('GET', '/api/admin/health', { token: staffToken });
    assert.equal(res.status, 200);
    assert.ok(res.json.uptime_seconds >= 0);
    assert.ok(res.json.memory_mb > 0);
    assert.ok(res.json.node_version.startsWith('v'));
    // The file exists in this test, so it must be a real measurement — the null
    // case is what the UI renders as "—", never a fabricated 0.
    assert.equal(typeof res.json.db_size_mb, 'number');
    assert.ok(res.json.db_size_mb > 0);
  });

  it('a plan change by staff is recorded in the customer\'s own history', async () => {
    const res = await api('PUT', `/api/admin/companies/${companyB}/plan`, {
      token: staffToken, body: { tier: 'pro', note: 'comped for migration' },
    });
    assert.equal(res.status, 200);
    assert.equal(res.json.plan, 'pro');

    const history = db.prepare(
      `SELECT description FROM billing_history WHERE company_id = ? ORDER BY created_at DESC LIMIT 1`
    ).get(companyB);
    assert.match(history.description, /support/i, 'the customer can see who changed their plan');

    const leaked = db.prepare(
      `SELECT COUNT(*) AS n FROM billing_history WHERE company_id = ? AND description LIKE '%comped for migration%'`
    ).get(companyA).n;
    assert.equal(leaked, 0, 'the change must land on company B only');

    const bogus = await api('PUT', `/api/admin/companies/${companyB}/plan`, {
      token: staffToken, body: { tier: 'unlimited-everything' },
    });
    assert.equal(bogus.status, 400, 'a tier that does not exist is rejected, not invented');
  });
});

// ─── S8: the stale-run reaper ────────────────────────────────────────────────

describe('Stale-run reaper', () => {
  // Creates an in_progress run directly, with its last activity backdated by
  // `hoursAgo`. Direct insert so the clock can be placed exactly on either side
  // of the boundary — the API path is covered separately below.
  function openRun(companyId, hoursAgo, { data = '{}', operator = 'Test Operator' } = {}) {
    const id = uuidv4();
    db.prepare(`
      INSERT INTO completions (id, app_id, app_name, operator_name, company_id, status,
                               started_at, last_activity_at, data, step_times)
      VALUES (?, ?, 'Reaper Test App', ?, ?, 'in_progress',
              datetime('now', ?), datetime('now', ?), ?, '{}')
    `).run(id, companyId === companyA ? appA : appB, operator, companyId,
           `-${hoursAgo} hours`, `-${hoursAgo} hours`, data);
    return id;
  }

  const get = id => db.prepare('SELECT * FROM completions WHERE id = ?').get(id);

  it('leaves a run alone just inside the threshold and closes one just outside', () => {
    const fresh = openRun(companyA, STALE_AFTER_HOURS - 1);
    const stale = openRun(companyA, STALE_AFTER_HOURS + 1);

    reapStaleRuns();

    assert.equal(get(fresh).status, 'in_progress',
      `a run silent for ${STALE_AFTER_HOURS - 1}h is still someone's job`);
    assert.equal(get(stale).status, 'abandoned',
      `a run silent for ${STALE_AFTER_HOURS + 1}h must not still count as active`);
  });

  it('a run interrupted and picked back up minutes later is never touched', () => {
    // Started long ago, last touched five minutes ago — exactly the 2pm/2:05pm
    // case. The clock runs on silence, not on age.
    const id = openRun(companyA, 48);
    db.prepare("UPDATE completions SET last_activity_at = datetime('now', '-5 minutes') WHERE id = ?").run(id);

    reapStaleRuns();

    assert.equal(get(id).status, 'in_progress');
  });

  it('preserves everything the operator had already entered', () => {
    const partial = JSON.stringify({ torque_nm: 42, serial: 'SN-1007', _operators: ['Maria Lopez'] });
    const id = openRun(companyA, STALE_AFTER_HOURS + 2, { data: partial });

    reapStaleRuns();

    const row = get(id);
    assert.equal(row.status, 'abandoned');
    assert.deepEqual(JSON.parse(row.data), { torque_nm: 42, serial: 'SN-1007', _operators: ['Maria Lopez'] },
      'banked partial work must survive being reaped');
    assert.ok(row.started_at, 'the start time is untouched');
    assert.equal(row.completed_at, null, 'a reaped run was never completed');
  });

  it('a reaped run is distinguishable from one an operator abandoned', async () => {
    const reaped = openRun(companyA, STALE_AFTER_HOURS + 3);
    reapStaleRuns();
    assert.equal(get(reaped).abandoned_reason, 'stale_timeout');

    // Now the operator route: create and abandon a run through the API.
    const app = await api('POST', '/api/apps', { token: ownerA, body: { name: 'Abandon Test App' } });
    assert.equal(app.status, 201);
    const run = await api('POST', '/api/completions', {
      token: ownerA, body: { app_id: app.json.id, operator_name: 'Walker' },
    });
    assert.equal(run.status, 201);
    const abandoned = await api('PUT', `/api/completions/${run.json.id}`, {
      token: ownerA, body: { status: 'abandoned' },
    });
    assert.equal(abandoned.status, 200);
    assert.equal(get(run.json.id).abandoned_reason, 'operator');
  });

  it('running twice changes nothing the second time', () => {
    openRun(companyA, STALE_AFTER_HOURS + 4);
    const first = reapStaleRuns();
    assert.ok(first >= 1);
    const second = reapStaleRuns();
    assert.equal(second, 0, 'the sweep must be idempotent');
  });

  it('closes stale runs in every tenant without mixing them up', () => {
    const inA = openRun(companyA, STALE_AFTER_HOURS + 5, { operator: 'Operator A' });
    const inB = openRun(companyB, STALE_AFTER_HOURS + 5, { operator: 'Operator B' });
    const liveB = openRun(companyB, 1, { operator: 'Operator B' });

    reapStaleRuns();

    assert.equal(get(inA).status, 'abandoned');
    assert.equal(get(inB).status, 'abandoned');
    assert.equal(get(liveB).status, 'in_progress');
    assert.equal(get(inA).company_id, companyA, 'the row never changed hands');
    assert.equal(get(inB).company_id, companyB);

    // Each closure is logged against its own company, never the other's.
    const loggedForA = db.prepare(
      'SELECT company_id FROM activity_log WHERE entity_id = ?'
    ).all(inA);
    assert.ok(loggedForA.length >= 1, 'the closure is auditable');
    assert.ok(loggedForA.every(r => r.company_id === companyA));

    const crossed = db.prepare(
      'SELECT COUNT(*) AS n FROM activity_log WHERE entity_id = ? AND company_id = ?'
    ).get(inB, companyA).n;
    assert.equal(crossed, 0, 'company A must not be told about company B runs');
  });

  it('closes any operator stint left open on a reaped run', async () => {
    const app = await api('POST', '/api/apps', { token: ownerA, body: { name: 'Session Test App' } });
    const run = await api('POST', '/api/completions', {
      token: ownerA, body: { app_id: app.json.id, operator_name: 'Ghost' },
    });
    const session = await api('POST', `/api/completions/${run.json.id}/sessions`, {
      token: ownerA, body: { operator_name: 'Ghost' },
    });
    assert.equal(session.status, 201);

    db.prepare("UPDATE completions SET last_activity_at = datetime('now', ?) WHERE id = ?")
      .run(`-${STALE_AFTER_HOURS + 6} hours`, run.json.id);

    reapStaleRuns();

    assert.equal(get(run.json.id).status, 'abandoned');
    const open = db.prepare(
      'SELECT COUNT(*) AS n FROM completion_sessions WHERE completion_id = ? AND ended_at IS NULL'
    ).get(run.json.id).n;
    assert.equal(open, 0, 'nobody should still look like they are on the job');
  });

  it('an autosave flush resets the clock, which is what keeps live runs alive', async () => {
    const app = await api('POST', '/api/apps', { token: ownerA, body: { name: 'Flush Test App' } });
    const run = await api('POST', '/api/completions', {
      token: ownerA, body: { app_id: app.json.id, operator_name: 'Busy' },
    });
    // Age the run well past the threshold, then send the same partial flush the
    // player sends on autosave / pagehide.
    db.prepare("UPDATE completions SET started_at = datetime('now', '-30 hours'), last_activity_at = datetime('now', ?) WHERE id = ?")
      .run(`-${STALE_AFTER_HOURS + 7} hours`, run.json.id);

    const flush = await api('PUT', `/api/completions/${run.json.id}`, {
      token: ownerA, body: { data: { torque_nm: 7 }, step_times: {}, values: [], partial: true },
    });
    assert.equal(flush.status, 200);

    reapStaleRuns();

    assert.equal(get(run.json.id).status, 'in_progress',
      'a run that just flushed is being worked, however old it is');
  });

  it('does not resurrect or re-stamp a run that is already finished', async () => {
    const app = await api('POST', '/api/apps', { token: ownerA, body: { name: 'Finished Test App' } });
    const run = await api('POST', '/api/completions', {
      token: ownerA, body: { app_id: app.json.id, operator_name: 'Finisher' },
    });
    await api('PUT', `/api/completions/${run.json.id}`, { token: ownerA, body: { status: 'completed' } });
    const before = get(run.json.id);
    db.prepare("UPDATE completions SET last_activity_at = datetime('now', ?) WHERE id = ?")
      .run(`-${STALE_AFTER_HOURS + 8} hours`, run.json.id);

    reapStaleRuns();

    const after = get(run.json.id);
    assert.equal(after.status, 'completed');
    assert.equal(after.completed_at, before.completed_at, 'the finish time is never rewritten');
    assert.equal(after.abandoned_reason, '');
  });
});

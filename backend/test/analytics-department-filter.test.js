'use strict';
// ─── Department scoping for the Analytics page and the Andon board ────────────
// The defect these tests lock down: every endpoint behind the Analytics page
// takes its filter from completionFilter(), which read only app_id and
// product_type_id. The page's department dropdown sent ?department_id=…, the
// page reloaded, and the server returned identical plant-wide numbers — a
// filter that looked like it worked and changed nothing.
//
// They also cover GET /andon/summary, which counted the whole company whatever
// the Andon board was scoped to.
//
// The site-scoping cases for GET /analytics/manager-view went with the endpoint:
// no screen had called it since the four floor screens became one, and a route
// nobody reads is a second answer waiting to disagree with /plant-view.
//
// A completion has no department column: it belongs to its work order's
// department, falling back to its station's department when the work order has
// none (or there is no work order). A run with neither has no department at all
// and must never be folded into whichever department is on screen. The seed
// below deliberately contains one of each of those shapes.
//
// Uses Node built-ins only (node:test + global fetch). Run with: npm test

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const PORT = 3194; // unique per test file — every other port in 3180-3199 is taken
const BASE = `http://localhost:${PORT}`;
const DB_PATH = path.join(os.tmpdir(), `mes-analytics-dept-${Date.now()}.db`);

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

/** POST that asserts a 2xx and returns the created row. */
async function create(token, pathname, body) {
  const r = await api('POST', pathname, { token, body });
  assert.ok(r.status === 200 || r.status === 201, `POST ${pathname} → ${r.status} ${JSON.stringify(r.json)}`);
  return r.json;
}

/** GET that asserts a 200 and returns the body. */
async function get(token, pathname) {
  const r = await api('GET', pathname, { token });
  assert.equal(r.status, 200, `GET ${pathname} → ${r.status} ${JSON.stringify(r.json)}`);
  return r.json;
}

function qs(params) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v != null) p.set(k, v);
  const s = p.toString();
  return s ? `?${s}` : '';
}

before(async () => { await startServer(); });
after(() => {
  if (server) server.kill('SIGTERM');
  for (const ext of ['', '-shm', '-wal']) {
    try { fs.unlinkSync(DB_PATH + ext); } catch { /* ignore */ }
  }
});

describe('Analytics department filter', () => {
  const A = {};   // company A fixtures
  const B = {};   // company B — used only to prove a foreign id cannot widen

  /** Finish a run so it lands in `completions` as completed today. */
  async function runJob(token, { app_id, station_id, work_order_id, operator_name, fail = false }) {
    const c = await create(token, '/api/completions', { app_id, station_id, work_order_id, operator_name });
    const upd = await api('PUT', `/api/completions/${c.id}`, {
      token,
      body: { status: 'completed', data: { qc: fail ? 'Fail' : 'Pass' } },
    });
    assert.equal(upd.status, 200, `completing run failed: ${JSON.stringify(upd.json)}`);
    return c;
  }

  const sum = (rows, key) => rows.reduce((s, r) => s + (r[key] ?? 0), 0);

  before(async () => {
    const signupA = await api('POST', '/api/auth/signup', {
      body: { company_name: 'Dept Filter Co', email: 'admin@deptfilter.test', password: 'SecretPass1', display_name: 'Admin A' },
    });
    assert.equal(signupA.status, 201);
    A.token = signupA.token = signupA.json.token;
    A.token = signupA.json.token;

    const sites = await api('GET', '/api/sites', { token: A.token });
    A.site1 = sites.json[0];                                    // primary, auto-created
    A.site2 = await create(A.token, '/api/sites', { name: 'North Plant', code: 'NORTH' });

    A.weld  = await create(A.token, '/api/departments', { name: 'Welding', site_id: A.site1.id });
    A.paint = await create(A.token, '/api/departments', { name: 'Paint',   site_id: A.site2.id });

    A.appW = await create(A.token, '/api/apps', { name: 'Weld Check',  status: 'published' });
    A.appP = await create(A.token, '/api/apps', { name: 'Paint Check', status: 'published' });

    A.stW    = await create(A.token, '/api/stations', { name: 'Weld Cell',   department_id: A.weld.id,  site_id: A.site1.id });
    A.stP    = await create(A.token, '/api/stations', { name: 'Paint Booth', department_id: A.paint.id, site_id: A.site2.id });
    A.stFree = await create(A.token, '/api/stations', { name: 'Rework Bench' });   // no department

    A.woW = await create(A.token, '/api/work-orders', {
      part_number: 'W-1', part_name: 'Weldment', quantity: 10,
      app_id: A.appW.id, department_id: A.weld.id, site_id: A.site1.id, status: 'in_progress',
    });
    A.woP = await create(A.token, '/api/work-orders', {
      part_number: 'P-1', part_name: 'Painted Frame', quantity: 5,
      app_id: A.appP.id, department_id: A.paint.id, site_id: A.site2.id,
    });
    // A work order with no department of its own: its runs must fall back to the
    // station's department, exactly like COALESCE(wo.department_id, st.department_id).
    A.woNone = await create(A.token, '/api/work-orders', {
      part_number: 'X-1', part_name: 'Odd Job', quantity: 2, app_id: A.appP.id,
    });

    // ── Welding: 3 runs through its work order …
    for (const op of ['Ana', 'Ana', 'Ben']) {
      await runJob(A.token, { app_id: A.appW.id, station_id: A.stW.id, work_order_id: A.woW.id, operator_name: op });
    }
    // … plus 1 ad-hoc run with no work order, attributed through the station.
    await runJob(A.token, { app_id: A.appW.id, station_id: A.stW.id, operator_name: 'Dee' });

    // ── Paint: 1 run through its work order (a QC fail) …
    await runJob(A.token, { app_id: A.appP.id, station_id: A.stP.id, work_order_id: A.woP.id, operator_name: 'Cleo', fail: true });
    // … plus 1 run whose work order carries no department, so the station decides.
    await runJob(A.token, { app_id: A.appP.id, station_id: A.stP.id, work_order_id: A.woNone.id, operator_name: 'Eve' });

    // ── Belongs to no department at all: no work order, no station.
    await runJob(A.token, { app_id: A.appW.id, operator_name: 'Zed' });
    // … and one on a station that has no department either.
    await runJob(A.token, { app_id: A.appW.id, station_id: A.stFree.id, operator_name: 'Yan' });

    // One run still in progress, in Welding.
    await create(A.token, '/api/completions', {
      app_id: A.appW.id, station_id: A.stW.id, work_order_id: A.woW.id, operator_name: 'Ana',
    });

    // ── Company B: its own plant, so a cross-tenant id can be tried against A.
    const signupB = await api('POST', '/api/auth/signup', {
      body: { company_name: 'Other Co', email: 'admin@othercorp.test', password: 'SecretPass2', display_name: 'Admin B' },
    });
    assert.equal(signupB.status, 201);
    B.token = signupB.json.token;
    B.dept = await create(B.token, '/api/departments', { name: 'B Assembly' });
    B.app = await create(B.token, '/api/apps', { name: 'B App', status: 'published' });
    B.station = await create(B.token, '/api/stations', { name: 'B Station', department_id: B.dept.id });
    await runJob(B.token, { app_id: B.app.id, station_id: B.station.id, operator_name: 'Bravo' });
  });

  // Hand-counted from the seed above:
  //   Welding  4 completed  (Ana, Ana, Ben via the work order + Dee via the station)
  //   Paint    2 completed  (Cleo via the work order + Eve via the station, her WO
  //                          having no department)
  //   nobody's 2 completed  (Zed: no WO and no station; Yan: station has no dept)
  //   ───────────────────────
  //   total    8 completed, plus 1 in-progress Welding run.

  it('returns the whole plant when no department is named', async () => {
    const ov = await get(A.token, '/api/analytics/overview');
    assert.equal(ov.totalCompletions, 8, 'every completed run in the company');
    assert.equal(ov.inProgress, 1);

    const ops = await get(A.token, '/api/analytics/operator-performance');
    assert.deepEqual(ops.map(o => o.operator_name).sort(), ['Ana', 'Ben', 'Cleo', 'Dee', 'Eve', 'Yan', 'Zed']);
  });

  it('department_id actually changes the numbers — they are no longer plant-wide', async () => {
    const all   = await get(A.token, '/api/analytics/overview');
    const weld  = await get(A.token, `/api/analytics/overview${qs({ department_id: A.weld.id })}`);
    const paint = await get(A.token, `/api/analytics/overview${qs({ department_id: A.paint.id })}`);

    // The regression itself: before the fix all three of these were equal.
    assert.notEqual(weld.totalCompletions, all.totalCompletions, 'a department filter must not return plant-wide totals');
    assert.notEqual(paint.totalCompletions, all.totalCompletions);

    assert.equal(weld.totalCompletions, 4, 'Welding: 3 through its work order + 1 through its station');
    assert.equal(paint.totalCompletions, 2, 'Paint: 1 through its work order + 1 through its station');
    assert.equal(all.totalCompletions, 8);

    assert.equal(weld.todayCompletions, 4);
    assert.equal(paint.todayCompletions, 2);
    assert.equal(weld.inProgress, 1, 'the in-progress run is a Welding run');
    assert.equal(paint.inProgress, 0);

    // Quality follows the same scope: only Paint recorded a fail.
    assert.equal(weld.passRate, 100, 'all four Welding runs passed');
    assert.equal(weld.qcSampleSize, 4);
    assert.equal(paint.passRate, 50, 'Cleo failed, Eve passed');
    assert.equal(paint.qcSampleSize, 2);
  });

  it('scopes every endpoint behind the Analytics page, not just the KPI cards', async () => {
    const weldQS  = qs({ department_id: A.weld.id });
    const paintQS = qs({ department_id: A.paint.id });

    // operator-performance — the second symptom reported from the live server.
    const opsAll   = await get(A.token, '/api/analytics/operator-performance');
    const opsWeld  = await get(A.token, `/api/analytics/operator-performance${weldQS}`);
    const opsPaint = await get(A.token, `/api/analytics/operator-performance${paintQS}`);
    assert.deepEqual(opsWeld.map(o => o.operator_name).sort(), ['Ana', 'Ben', 'Dee']);
    assert.deepEqual(opsPaint.map(o => o.operator_name).sort(), ['Cleo', 'Eve']);
    assert.ok(opsWeld.length < opsAll.length, 'the operator list narrows');
    assert.equal(sum(opsWeld, 'completions'), 4);
    assert.equal(sum(opsPaint, 'completions'), 2);

    // throughput
    assert.equal(sum(await get(A.token, `/api/analytics/throughput?days=30`), 'count'), 8);
    assert.equal(sum(await get(A.token, `/api/analytics/throughput?days=30&department_id=${A.weld.id}`), 'count'), 4);
    assert.equal(sum(await get(A.token, `/api/analytics/throughput?days=30&department_id=${A.paint.id}`), 'count'), 2);

    // cycle-times — one bucket per day, so assert it computes and stays scoped
    const ctWeld = await get(A.token, `/api/analytics/cycle-times?days=30&department_id=${A.weld.id}`);
    assert.ok(Array.isArray(ctWeld) && ctWeld.length >= 1, 'cycle times still compute under a department filter');
    assert.ok(ctWeld.every(r => typeof r.avg_minutes === 'number'));

    // quality (pass/fail per day)
    const qAll   = await get(A.token, `/api/analytics/quality?days=30`);
    const qWeld  = await get(A.token, `/api/analytics/quality?days=30&department_id=${A.weld.id}`);
    const qPaint = await get(A.token, `/api/analytics/quality?days=30&department_id=${A.paint.id}`);
    assert.equal(sum(qAll, 'pass') + sum(qAll, 'fail'), 8);
    assert.equal(sum(qWeld, 'pass'), 4);
    assert.equal(sum(qWeld, 'fail'), 0);
    assert.equal(sum(qPaint, 'pass'), 1);
    assert.equal(sum(qPaint, 'fail'), 1);

    // app-performance counts every run, in progress included
    const apAll  = await get(A.token, '/api/analytics/app-performance');
    const apWeld = await get(A.token, `/api/analytics/app-performance${weldQS}`);
    assert.equal(sum(apAll, 'completions'), 9, '8 completed + 1 in progress');
    assert.equal(sum(apWeld, 'completions'), 5, '4 completed + the in-progress Welding run');
  });

  it('never files a run with no department under a department', async () => {
    // Zed (no work order, no station) and Yan (station with no department) are
    // in the plant-wide total and in neither department. 4 + 2 + 2 = 8.
    const all   = await get(A.token, '/api/analytics/overview');
    const weld  = await get(A.token, `/api/analytics/overview${qs({ department_id: A.weld.id })}`);
    const paint = await get(A.token, `/api/analytics/overview${qs({ department_id: A.paint.id })}`);
    assert.equal(weld.totalCompletions + paint.totalCompletions + 2, all.totalCompletions);

    for (const deptId of [A.weld.id, A.paint.id]) {
      const ops = await get(A.token, `/api/analytics/operator-performance${qs({ department_id: deptId })}`);
      assert.ok(!ops.some(o => o.operator_name === 'Zed'), 'a run with no work order and no station has no department');
      assert.ok(!ops.some(o => o.operator_name === 'Yan'), 'a run on a station with no department has no department');
    }
  });

  it('composes with the app filter instead of replacing it', async () => {
    const weldAppW = await get(A.token, `/api/analytics/overview${qs({ department_id: A.weld.id, app_id: A.appW.id })}`);
    assert.equal(weldAppW.totalCompletions, 4, 'all four Welding runs are Weld Check runs');

    const weldAppP = await get(A.token, `/api/analytics/overview${qs({ department_id: A.weld.id, app_id: A.appP.id })}`);
    assert.equal(weldAppP.totalCompletions, 0, 'no Paint Check run happened in Welding');

    const paintAppP = await get(A.token, `/api/analytics/overview${qs({ department_id: A.paint.id, app_id: A.appP.id })}`);
    assert.equal(paintAppP.totalCompletions, 2);
  });

  it('a department id from another company narrows to nothing — it can never widen', async () => {
    const foreign = await get(A.token, `/api/analytics/overview${qs({ department_id: B.dept.id })}`);
    assert.equal(foreign.totalCompletions, 0, "another tenant's department matches none of our runs");
    assert.equal(foreign.inProgress, 0);

    const unknown = await get(A.token, `/api/analytics/overview${qs({ department_id: 'no-such-department' })}`);
    assert.equal(unknown.totalCompletions, 0);

    // And company B never sees company A's runs through its own department.
    const bOwn = await get(B.token, `/api/analytics/overview${qs({ department_id: B.dept.id })}`);
    assert.equal(bOwn.totalCompletions, 1, 'B sees exactly its own single run');
  });

  it('every filtered endpoint answers 200 — the clause is valid in each query', async () => {
    const paths = [
      '/api/analytics/overview',
      '/api/analytics/throughput?days=30',
      '/api/analytics/cycle-times?days=30',
      '/api/analytics/operator-performance',
      '/api/analytics/app-performance',
      '/api/analytics/quality?days=30',
    ];
    for (const p of paths) {
      const sep = p.includes('?') ? '&' : '?';
      const r = await api('GET', `${p}${sep}department_id=${A.weld.id}&app_id=${A.appW.id}`, { token: A.token });
      assert.equal(r.status, 200, `${p} under a department filter → ${r.status} ${JSON.stringify(r.json)}`);
    }
  });
});

describe('Andon summary department scoping', () => {
  const A = {};

  before(async () => {
    const signup = await api('POST', '/api/auth/signup', {
      body: { company_name: 'Andon Scope Co', email: 'admin@andonscope.test', password: 'SecretPass3', display_name: 'Admin' },
    });
    assert.equal(signup.status, 201);
    A.token = signup.json.token;

    A.weld  = await create(A.token, '/api/departments', { name: 'Welding' });
    A.paint = await create(A.token, '/api/departments', { name: 'Paint' });

    // Welding: one open quality call, one acknowledged maintenance call, one resolved.
    A.weldOpen = await create(A.token, '/api/andon', { team: 'quality', department_id: A.weld.id, title: 'Weld QC' });
    A.weldAck  = await create(A.token, '/api/andon', { team: 'maintenance', department_id: A.weld.id, title: 'Weld fixture' });
    A.weldDone = await create(A.token, '/api/andon', { team: 'supervisor', department_id: A.weld.id, title: 'Weld cover' });
    // Paint: one open quality call.
    A.paintOpen = await create(A.token, '/api/andon', { team: 'quality', department_id: A.paint.id, title: 'Paint QC' });
    // No department at all.
    A.floating = await create(A.token, '/api/andon', { team: 'materials', title: 'Stock out' });

    assert.equal((await api('PUT', `/api/andon/${A.weldAck.id}/acknowledge`, { token: A.token, body: { responder: 'Mo' } })).status, 200);
    assert.equal((await api('PUT', `/api/andon/${A.weldDone.id}/resolve`, { token: A.token, body: { resolution: 'done' } })).status, 200);

    // A second company, so a foreign department id can be tried.
    const signupB = await api('POST', '/api/auth/signup', {
      body: { company_name: 'Andon Other Co', email: 'admin@andonother.test', password: 'SecretPass4', display_name: 'Admin B' },
    });
    A.otherToken = signupB.json.token;
    A.otherDept = await create(A.otherToken, '/api/departments', { name: 'Their Dept' });
  });

  it('counts the whole company when no department is named', async () => {
    const s = await get(A.token, '/api/andon/summary');
    assert.equal(s.open, 3, 'two open Welding/Paint calls + the floating one');
    assert.equal(s.acknowledged, 1);
    assert.equal(s.resolved_today, 1);
    assert.equal(s.by_team.quality, 2);
    assert.equal(s.by_team.maintenance, 1);
    assert.equal(s.by_team.materials, 1);
    assert.equal(s.by_team.supervisor, 0, 'the supervisor call was resolved');
    assert.equal(s.responded_today, 1);
    assert.equal(s.department_id, null);
  });

  it('scopes the KPI cards and the by_team tallies to one department', async () => {
    const weld = await get(A.token, `/api/andon/summary${qs({ department_id: A.weld.id })}`);
    assert.equal(weld.open, 1, 'only the open Welding call');
    assert.equal(weld.acknowledged, 1);
    assert.equal(weld.resolved_today, 1);
    assert.equal(weld.by_team.quality, 1, 'Paint\'s quality call is not Welding\'s');
    assert.equal(weld.by_team.maintenance, 1);
    assert.equal(weld.by_team.materials, 0, 'the floating call belongs to no department');
    assert.equal(weld.department_id, A.weld.id);
    assert.equal(weld.responded_today, 1);
    assert.ok(typeof weld.avg_response_seconds_today === 'number');

    const paint = await get(A.token, `/api/andon/summary${qs({ department_id: A.paint.id })}`);
    assert.equal(paint.open, 1);
    assert.equal(paint.acknowledged, 0);
    assert.equal(paint.resolved_today, 0);
    assert.equal(paint.by_team.quality, 1);
    assert.equal(paint.by_team.maintenance, 0);
    // Nothing was answered in Paint today: report null, never a made-up average.
    assert.equal(paint.avg_response_seconds_today, null);
    assert.equal(paint.responded_today, 0);

    // The summary and the list agree about what is open in this department.
    const paintCalls = await get(A.token, `/api/andon${qs({ department_id: A.paint.id, status: 'open' })}`);
    assert.equal(paintCalls.length, paint.open);
  });

  it("another tenant's department id counts nothing", async () => {
    const s = await get(A.token, `/api/andon/summary${qs({ department_id: A.otherDept.id })}`);
    assert.equal(s.open, 0);
    assert.equal(s.acknowledged, 0);
    assert.equal(s.resolved_today, 0);
    assert.equal(Object.values(s.by_team).reduce((a, b) => a + b, 0), 0);
  });
});

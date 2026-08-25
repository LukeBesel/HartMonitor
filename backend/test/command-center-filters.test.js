'use strict';
// ─── Command Center page scope (department + app) ─────────────────────────────
// The Command Center now carries the same department / app filter bar as the
// workspace Reports pages. The defect this file exists to prevent is the one
// that has shipped on this product twice already: a filter that narrows ONE
// card while the headline tiles stay plant-wide, so a manager reads a
// company-wide number as their department's.
//
// So these tests do not just check that "a parameter is accepted". For each of
// /analytics/daily-brief and /analytics/plant-view they check EVERY section the
// Command Center renders — KPI tiles, Needs Attention, due-soon, 7-day output,
// department performance, hourly throughput, active alerts and recent
// completions — against a hand-counted seed, and check that a department WITH
// runs and a department WITHOUT them return different numbers.
//
// They also cover the two ways a filter can lie quietly:
//   * a metric that cannot be computed for the scope must come back null (the
//     UI renders '—' with a reason) rather than 0, which reads as "we measured
//     it and it was nothing";
//   * an alert with no department and no app at all must be SET ASIDE and
//     counted in attention_plant_wide_hidden, never filed under whichever
//     department happens to be on screen.
//
// Uses Node built-ins only (node:test + global fetch). Run with: npm test

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const PORT = 3242; // unique per test file — a shared port silently cancels a suite
const BASE = `http://localhost:${PORT}`;
const DB_PATH = path.join(os.tmpdir(), `mes-command-center-${Date.now()}.db`);

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

async function create(token, pathname, body) {
  const r = await api('POST', pathname, { token, body });
  assert.ok(r.status === 200 || r.status === 201, `POST ${pathname} → ${r.status} ${JSON.stringify(r.json)}`);
  return r.json;
}

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

const iso = hoursFromNow => new Date(Date.now() + hoursFromNow * 3600000).toISOString();

before(async () => { await startServer(); });
after(() => {
  if (server) server.kill('SIGTERM');
  for (const ext of ['', '-shm', '-wal']) {
    try { fs.unlinkSync(DB_PATH + ext); } catch { /* ignore */ }
  }
});

describe('Command Center department + app scope', () => {
  const A = {};
  const B = {};

  async function runJob(token, { app_id, station_id, work_order_id, operator_name, fail = false, leaveOpen = false }) {
    const c = await create(token, '/api/completions', { app_id, station_id, work_order_id, operator_name });
    if (leaveOpen) return c;
    const upd = await api('PUT', `/api/completions/${c.id}`, {
      token,
      body: { status: 'completed', data: { qc: fail ? 'Fail' : 'Pass' } },
    });
    assert.equal(upd.status, 200, `completing run failed: ${JSON.stringify(upd.json)}`);
    return c;
  }

  before(async () => {
    const signupA = await api('POST', '/api/auth/signup', {
      body: { company_name: 'Command Co', email: 'admin@commandco.test', password: 'SecretPass1', display_name: 'Admin A' },
    });
    assert.equal(signupA.status, 201);
    A.token = signupA.json.token;

    A.weld  = await create(A.token, '/api/departments', { name: 'Welding' });
    A.paint = await create(A.token, '/api/departments', { name: 'Paint' });
    // A real department that nothing has ever run through — the control case
    // for "a department with runs vs one without returns different numbers".
    A.ship  = await create(A.token, '/api/departments', { name: 'Shipping' });

    A.appW = await create(A.token, '/api/apps', { name: 'Weld Check',  status: 'published' });
    A.appP = await create(A.token, '/api/apps', { name: 'Paint Check', status: 'published' });

    A.stW    = await create(A.token, '/api/stations', { name: 'Weld Cell',   department_id: A.weld.id });
    A.stP    = await create(A.token, '/api/stations', { name: 'Paint Booth', department_id: A.paint.id });
    A.stFree = await create(A.token, '/api/stations', { name: 'Rework Bench' });   // no department

    // Welding: one already-overdue work order and one not yet started.
    A.woW1 = await create(A.token, '/api/work-orders', {
      part_number: 'W-1', part_name: 'Weldment', quantity: 10,
      app_id: A.appW.id, department_id: A.weld.id,
      scheduled_start: iso(-48), scheduled_end: iso(-24), status: 'in_progress',
    });
    A.woW2 = await create(A.token, '/api/work-orders', {
      part_number: 'W-2', part_name: 'Bracket', quantity: 4,
      app_id: A.appW.id, department_id: A.weld.id,
      scheduled_start: iso(24), scheduled_end: iso(48),
    });
    A.woP1 = await create(A.token, '/api/work-orders', {
      part_number: 'P-1', part_name: 'Painted Frame', quantity: 5,
      app_id: A.appP.id, department_id: A.paint.id,
      scheduled_start: iso(-48), scheduled_end: iso(-24),
    });
    // Belongs to no department: it must never be folded into Welding or Paint.
    A.woNone = await create(A.token, '/api/work-orders', {
      part_number: 'X-1', part_name: 'Odd Job', quantity: 2,
      scheduled_start: iso(-48), scheduled_end: iso(-24),
    });

    // ── Welding: 2 runs through its work order + 1 ad-hoc run on its station.
    await runJob(A.token, { app_id: A.appW.id, station_id: A.stW.id, work_order_id: A.woW1.id, operator_name: 'Ana' });
    await runJob(A.token, { app_id: A.appW.id, station_id: A.stW.id, work_order_id: A.woW1.id, operator_name: 'Ben' });
    await runJob(A.token, { app_id: A.appW.id, station_id: A.stW.id, operator_name: 'Dee' });
    // … and one still running, so `active_now` has a department too.
    await runJob(A.token, { app_id: A.appW.id, station_id: A.stW.id, work_order_id: A.woW1.id, operator_name: 'Ana', leaveOpen: true });

    // ── Paint: 1 run, a QC fail, so pass rate differs between departments.
    await runJob(A.token, { app_id: A.appP.id, station_id: A.stP.id, work_order_id: A.woP1.id, operator_name: 'Cleo', fail: true });

    // ── No department at all: no work order, no station.
    await runJob(A.token, { app_id: A.appW.id, operator_name: 'Zed' });

    // Help requests: one routed to Welding, one to a function team with no
    // department and no station — the latter has no department dimension at all.
    A.callWeld = await create(A.token, '/api/andon', {
      target_type: 'department', department_id: A.weld.id, station_id: A.stW.id, type: 'help',
    });
    A.callFree = await create(A.token, '/api/andon', { team: 'maintenance', title: 'Compressor noise' });

    // Two down stations: one in Welding, one that belongs to no department.
    await create(A.token, `/api/oee/${A.stW.id}/event`, { event_type: 'down', reason: 'tip change' });
    await create(A.token, `/api/oee/${A.stFree.id}/event`, { event_type: 'down', reason: 'unknown' });

    // ── Company B, so a foreign id can be tried against A.
    const signupB = await api('POST', '/api/auth/signup', {
      body: { company_name: 'Other Co', email: 'admin@othercommand.test', password: 'SecretPass2', display_name: 'Admin B' },
    });
    assert.equal(signupB.status, 201);
    B.token = signupB.json.token;
    B.dept = await create(B.token, '/api/departments', { name: 'B Assembly' });
    B.app = await create(B.token, '/api/apps', { name: 'B App', status: 'published' });
    B.station = await create(B.token, '/api/stations', { name: 'B Station', department_id: B.dept.id });
    await runJob(B.token, { app_id: B.app.id, station_id: B.station.id, operator_name: 'Bravo' });
  });

  // Hand-counted from the seed:
  //   Welding  3 completed today (Ana, Ben via WO-W1 + Dee via the station) + 1 running
  //   Paint    1 completed today (Cleo, a QC fail)
  //   Shipping 0 — nothing has ever run through it
  //   nobody's 1 completed today (Zed: no work order, no station)
  //   ─────────────────────────────────────────────────────────────────────────
  //   plant    5 completed today, 1 running
  //   By app:  Weld Check 4 (3 Welding + Zed), Paint Check 1

  const brief = (scope = {}) => get(A.token, `/api/analytics/daily-brief${qs(scope)}`);
  const plant = (scope = {}) => get(A.token, `/api/analytics/plant-view${qs(scope)}`);

  it('daily-brief: the KPI tiles are not plant-wide once a department is chosen', async () => {
    const all   = await brief();
    const weld  = await brief({ department_id: A.weld.id });
    const paint = await brief({ department_id: A.paint.id });

    assert.equal(all.kpis.completed_today, 5, 'every completed run in the company today');
    assert.equal(all.kpis.active_now, 1);

    // The regression itself: before the fix all three of these were equal.
    assert.notEqual(weld.kpis.completed_today, all.kpis.completed_today);
    assert.notEqual(paint.kpis.completed_today, all.kpis.completed_today);

    assert.equal(weld.kpis.completed_today, 3);
    assert.equal(paint.kpis.completed_today, 1);
    assert.equal(weld.kpis.active_now, 1, 'the running job is a Welding job');
    assert.equal(paint.kpis.active_now, 0);

    // Quality follows the same scope: only Paint recorded a fail.
    assert.equal(weld.kpis.pass_rate_7d, 100);
    assert.equal(paint.kpis.pass_rate_7d, 0);

    // Open work orders are scoped too — the tile that reads "N of M".
    assert.equal(all.kpis.work_orders_total, 4);
    assert.equal(weld.kpis.work_orders_total, 2);
    assert.equal(paint.kpis.work_orders_total, 1);
  });

  it('daily-brief: a department with runs and one without return different numbers', async () => {
    const weld = await brief({ department_id: A.weld.id });
    const ship = await brief({ department_id: A.ship.id });

    assert.equal(ship.kpis.completed_today, 0);
    assert.equal(ship.kpis.active_now, 0);
    assert.equal(ship.kpis.work_orders_total, 0);
    assert.notEqual(ship.kpis.completed_today, weld.kpis.completed_today);

    // Not computable for this scope ⇒ null, so the page can render '—' with a
    // reason. A 0 here would read as "we measured it and it was zero".
    assert.strictEqual(ship.kpis.pass_rate_7d, null, 'no QC results in Shipping');
    assert.strictEqual(ship.kpis.schedule_adherence, null, 'no open work orders in Shipping');
    assert.strictEqual(ship.kpis.vs_7day_avg_pct, null);

    assert.deepEqual(ship.attention, [], 'nothing in Shipping needs attention');
    assert.deepEqual(ship.due_soon, []);
    assert.equal(ship.throughput_7d.reduce((s, d) => s + d.count, 0), 0);
  });

  it('daily-brief: Needs Attention, due-soon and the 7-day chart all follow the scope', async () => {
    const all   = await brief();
    const weld  = await brief({ department_id: A.weld.id });
    const paint = await brief({ department_id: A.paint.id });

    // Attention: Welding sees its own late WO, its own help request and its own
    // down station — and nothing belonging to Paint or to nobody.
    const labels = b => b.attention.map(i => i.label);
    assert.ok(labels(all).some(l => l.includes('Odd Job')), 'the unassigned late WO is plant-wide news');
    assert.ok(!labels(weld).some(l => l.includes('Odd Job')), 'an unassigned work order is not evidence about Welding');
    assert.ok(!labels(weld).some(l => l.includes('Painted Frame')));
    assert.ok(labels(weld).some(l => l.includes('Weldment')));
    assert.ok(labels(weld).some(l => l === 'Weld Cell is down'));
    assert.ok(!labels(weld).some(l => l === 'Rework Bench is down'), 'that station has no department');
    assert.ok(labels(paint).some(l => l.includes('Painted Frame')));
    assert.ok(!labels(paint).some(l => l.includes('Weldment')));

    // Help requests: the department-targeted one only, not the loose team call.
    const calls = b => b.attention.filter(i => i.type === 'andon_call');
    assert.equal(calls(all).length, 2);
    assert.equal(calls(weld).length, 1);
    assert.equal(calls(paint).length, 0);

    // Due in the next 48 hours.
    const dueNums = b => b.due_soon.map(w => w.work_order_number).sort();
    assert.equal(dueNums(all).length, 4);
    assert.deepEqual(dueNums(weld), [A.woW1.work_order_number, A.woW2.work_order_number].sort());
    assert.deepEqual(dueNums(paint), [A.woP1.work_order_number]);

    // Output — Last 7 Days.
    const total = b => b.throughput_7d.reduce((s, d) => s + d.count, 0);
    assert.equal(total(all), 5);
    assert.equal(total(weld), 3);
    assert.equal(total(paint), 1);
    assert.equal(all.week_avg_per_day >= 0, true);
  });

  it('daily-brief: alerts with no department are set aside and counted, never re-filed', async () => {
    const all  = await brief();
    const weld = await brief({ department_id: A.weld.id });

    assert.equal(all.attention_plant_wide_hidden, 0, 'nothing is hidden at plant scope');
    // Welding sets aside: the unassigned late work order, the loose team call
    // and the down station that belongs to no department.
    assert.equal(weld.attention_plant_wide_hidden, 3);
    assert.deepEqual(weld.attention_plant_wide_kinds.sort(), [
      'stations with no department', 'unassigned work orders', 'unrouted help requests',
    ]);
  });

  it('daily-brief: app_id scopes every figure too, and combines with department_id', async () => {
    const all    = await brief();
    const weldCk = await brief({ app_id: A.appW.id });
    const paintCk = await brief({ app_id: A.appP.id });

    assert.notEqual(weldCk.kpis.completed_today, all.kpis.completed_today);
    assert.equal(weldCk.kpis.completed_today, 4, '3 Welding runs + the run that belongs to no department');
    assert.equal(paintCk.kpis.completed_today, 1);
    assert.equal(weldCk.kpis.work_orders_total, 2, 'both Weld Check work orders');
    assert.equal(paintCk.kpis.work_orders_total, 1, 'the unassigned WO has no app');

    // Both dimensions at once, and a combination that genuinely has nothing.
    const weldAndPaintApp = await brief({ department_id: A.weld.id, app_id: A.appP.id });
    assert.equal(weldAndPaintApp.kpis.completed_today, 0);
    assert.equal(weldAndPaintApp.kpis.work_orders_total, 0);
    assert.strictEqual(weldAndPaintApp.kpis.pass_rate_7d, null);

    const weldAndWeldApp = await brief({ department_id: A.weld.id, app_id: A.appW.id });
    assert.equal(weldAndWeldApp.kpis.completed_today, 3);
  });

  it('daily-brief: echoes the scope it applied, and a foreign id narrows to nothing', async () => {
    const weld = await brief({ department_id: A.weld.id, app_id: A.appW.id });
    assert.deepEqual(weld.scope, { department_id: A.weld.id, app_id: A.appW.id });

    const foreign = await brief({ department_id: B.dept.id });
    assert.equal(foreign.kpis.completed_today, 0, 'another tenant’s department must not widen the result');
    assert.equal(foreign.kpis.work_orders_total, 0);
    assert.deepEqual(foreign.attention.filter(i => i.type !== 'more'), []);
  });

  it('plant-view: every section of the Live Floor View follows the scope', async () => {
    const all   = await plant();
    const weld  = await plant({ department_id: A.weld.id });
    const paint = await plant({ department_id: A.paint.id });

    // KPI strip
    assert.equal(all.kpis.total_completed_today, 5);
    assert.equal(weld.kpis.total_completed_today, 3);
    assert.equal(paint.kpis.total_completed_today, 1);
    assert.notEqual(weld.kpis.total_completed_today, all.kpis.total_completed_today);
    assert.equal(weld.kpis.active_now, 1);
    assert.equal(paint.kpis.active_now, 0);
    assert.equal(all.kpis.work_orders_total, 4);
    assert.equal(weld.kpis.work_orders_total, 2);

    // Department performance narrows to the chosen department — six cards under
    // a one-department scope would contradict every other number on the page.
    assert.equal(all.department_performance.length, 3);
    assert.deepEqual(weld.department_performance.map(d => d.department), ['Welding']);
    assert.equal(weld.department_performance[0].completion_count, 3);
    assert.deepEqual(paint.department_performance.map(d => d.department), ['Paint']);
    assert.equal(paint.department_performance[0].completion_count, 1);

    // Hourly throughput
    const hourly = p => p.hourly_throughput.reduce((s, h) => s + h.count, 0);
    assert.equal(hourly(all), 5);
    assert.equal(hourly(weld), 3);
    assert.equal(hourly(paint), 1);

    // Active alerts (behind / overdue work orders)
    assert.deepEqual(weld.active_alerts.map(a => a.work_order_number), [A.woW1.work_order_number]);
    assert.deepEqual(paint.active_alerts.map(a => a.work_order_number), [A.woP1.work_order_number]);
    assert.ok(all.active_alerts.length > weld.active_alerts.length);

    // Recent completions
    assert.equal(all.recent_completions.length, 6, '5 completed + 1 running');
    assert.equal(weld.recent_completions.length, 4, '3 completed + 1 running');
    assert.ok(weld.recent_completions.every(c => c.department === 'Welding'));
    assert.equal(paint.recent_completions.length, 1);
    assert.ok(paint.recent_completions.every(c => c.department === 'Paint'));

    assert.deepEqual(weld.scope, { site_id: null, department_id: A.weld.id, app_id: null });
  });

  it('plant-view: a department with nothing in it reports null, not zero', async () => {
    const weld = await plant({ department_id: A.weld.id });
    const ship = await plant({ department_id: A.ship.id });

    assert.equal(ship.kpis.total_completed_today, 0);
    assert.notEqual(ship.kpis.total_completed_today, weld.kpis.total_completed_today);
    assert.strictEqual(ship.kpis.avg_cycle_time, null, 'no completed runs ⇒ no average, not 0m');
    assert.strictEqual(ship.kpis.pass_rate, null);
    assert.strictEqual(ship.kpis.schedule_adherence, null);
    assert.equal(ship.kpis.work_orders_total, 0);
    assert.deepEqual(ship.active_alerts, []);
    assert.deepEqual(ship.recent_completions, []);
    assert.deepEqual(ship.hourly_throughput, []);
    assert.deepEqual(ship.department_performance.map(d => d.department), ['Shipping']);
    assert.equal(ship.department_performance[0].status, 'idle');
  });

  it('plant-view: app_id scopes it, and app_id + site_id together still answers', async () => {
    const all    = await plant();
    const weldCk = await plant({ app_id: A.appW.id });
    assert.notEqual(weldCk.kpis.total_completed_today, all.kpis.total_completed_today);
    assert.equal(weldCk.kpis.total_completed_today, 4);
    assert.equal(weldCk.recent_completions.length, 5, '4 completed + 1 running Weld Check run');
    assert.equal(weldCk.kpis.work_orders_total, 2);

    // Regression guard: the site filter joins `work_orders`, which has an
    // `app_id` of its own. An unqualified `app_id = ?` here is an "ambiguous
    // column name" 500 on the plant manager's home page.
    const sites = await get(A.token, '/api/sites');
    const r = await api('GET', `/api/analytics/plant-view${qs({ site_id: sites[0].id, app_id: A.appW.id, department_id: A.weld.id })}`, { token: A.token });
    assert.equal(r.status, 200, `site + app + department together → ${r.status} ${JSON.stringify(r.json)}`);
    assert.equal(r.json.kpis.total_completed_today, 3);
  });

  it('the unfiltered Command Center is unchanged — the filter is additive', async () => {
    const b = await brief();
    const p = await plant();
    assert.deepEqual(b.scope, { department_id: null, app_id: null });
    assert.equal(b.attention_plant_wide_hidden, 0);
    assert.equal(b.kpis.completed_today, 5);
    assert.equal(p.kpis.total_completed_today, 5);
    assert.equal(p.department_performance.length, 3);
  });
});

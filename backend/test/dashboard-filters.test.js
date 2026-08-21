'use strict';
// ─── Dashboard & report filters ───────────────────────────────────────────────
// GET /api/dashboards/:id/data accepts optional department_id / app_id / site_id.
// These tests build a two-department, two-site, two-app plant for one company
// (plus a second company to prove isolation) and assert, per card type, that
// each filter narrows exactly the cards it is meaningful for — and that an
// unknown or cross-tenant id is ignored instead of 500ing or leaking.
//
// Uses Node built-ins only (node:test + global fetch). Run with: npm test

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const PORT = 3182;
const BASE = `http://localhost:${PORT}`;
const DB_PATH = path.join(os.tmpdir(), `mes-dashboard-filters-${Date.now()}.db`);

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

function qs(filters) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(filters)) if (v != null) p.set(k, v);
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

describe('Dashboard card filters (department / app / site)', () => {
  const A = {};   // company A fixtures
  const B = {};   // company B fixtures

  /** All six card types, one card each, so a single fetch exercises the engine. */
  const CARDS = [
    { id: 'c-total',   type: 'metric',       title: 'Total Completions', metric_key: 'total_completions' },
    { id: 'c-today',   type: 'metric',       title: 'Today',             metric_key: 'today_completions' },
    { id: 'c-active',  type: 'metric',       title: 'Active',            metric_key: 'active_runs' },
    { id: 'c-cycle',   type: 'metric',       title: 'Avg Cycle',         metric_key: 'avg_cycle' },
    { id: 'c-period',  type: 'metric',       title: 'Period',            metric_key: 'period_completions', period_days: 30 },
    { id: 'c-ncrs',    type: 'metric',       title: 'Open NCRs',         metric_key: 'open_ncrs' },
    { id: 'c-train',   type: 'metric',       title: 'Training',          metric_key: 'training_coverage' },
    { id: 'c-lowstock',type: 'metric',       title: 'Low Stock',         metric_key: 'low_stock_items' },
    { id: 'c-tput',    type: 'time_series',  title: 'Throughput',        series: 'throughput', period_days: 30 },
    { id: 'c-ncrtrend',type: 'time_series',  title: 'NCR Trend',         series: 'ncr_trend', period_days: 30 },
    { id: 'c-oper',    type: 'distribution', title: 'By Operator',       group_by: 'operator' },
    { id: 'c-dept',    type: 'distribution', title: 'By Department',     group_by: 'department' },
    { id: 'c-station', type: 'distribution', title: 'Station Status',    group_by: 'station_status' },
    { id: 'c-kaizen',  type: 'distribution', title: 'Kaizen',            group_by: 'kaizen_status' },
    { id: 'c-lead',    type: 'leaderboard',  title: 'Top Operators',     leaderboard_metric: 'completions', limit: 10 },
    { id: 'c-wo',      type: 'wo_status',    title: 'WO Status' },
    { id: 'c-table',   type: 'table',        title: 'Recent Runs',       limit: 50 },
  ];

  /** Work orders in scope, regardless of which status bucket they landed in. */
  const woTotal = counts => Object.values(counts).reduce((s, n) => s + n, 0);

  /** Map card_id → data for one filter combination. */
  async function cardData(token, dashboardId, filters = {}) {
    const r = await api('GET', `/api/dashboards/${dashboardId}/data${qs(filters)}`, { token });
    assert.equal(r.status, 200, `data fetch failed: ${JSON.stringify(r.json)}`);
    const byId = {};
    for (const c of r.json.cards) {
      assert.ok(!c.error, `card ${c.card_id} errored: ${c.error}`);
      byId[c.card_id] = c.data;
    }
    return { byId, body: r.json };
  }

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

  before(async () => {
    // ── Company A: 2 sites × 2 departments × 2 apps ─────────────────────────
    const signupA = await api('POST', '/api/auth/signup', {
      body: { company_name: 'Filter Co A', email: 'admin@filter-a.test', password: 'SecretPass1', display_name: 'Admin A' },
    });
    assert.equal(signupA.status, 201);
    A.token = signupA.json.token;

    const sites = await api('GET', '/api/sites', { token: A.token });
    A.site1 = sites.json[0];                                   // primary, auto-created
    A.site2 = await create(A.token, '/api/sites', { name: 'North Plant', code: 'NORTH' });

    A.weld = await create(A.token, '/api/departments', { name: 'Weld', site_id: A.site1.id });
    A.paint = await create(A.token, '/api/departments', { name: 'Paint', site_id: A.site2.id });

    A.appW = await create(A.token, '/api/apps', { name: 'Weld Check', status: 'published' });
    A.appP = await create(A.token, '/api/apps', { name: 'Paint Check', status: 'published' });

    A.stW = await create(A.token, '/api/stations', { name: 'Weld Cell 1', department_id: A.weld.id, site_id: A.site1.id });
    A.stP = await create(A.token, '/api/stations', { name: 'Paint Booth', department_id: A.paint.id, site_id: A.site2.id });
    // Stations start 'idle'; log a machine event so station_status has two buckets.
    await create(A.token, `/api/oee/${A.stW.id}/event`, { event_type: 'running' });

    A.woW = await create(A.token, '/api/work-orders', {
      part_number: 'W-1', part_name: 'Weldment', quantity: 10,
      app_id: A.appW.id, department_id: A.weld.id, site_id: A.site1.id, status: 'in_progress',
    });
    A.woP = await create(A.token, '/api/work-orders', {
      part_number: 'P-1', part_name: 'Painted Frame', quantity: 5,
      app_id: A.appP.id, department_id: A.paint.id, site_id: A.site2.id, status: 'pending',
    });

    // 3 completed weld runs, 1 completed paint run, 1 still in progress (weld).
    for (const op of ['Ana', 'Ana', 'Ben']) {
      await runJob(A.token, { app_id: A.appW.id, station_id: A.stW.id, work_order_id: A.woW.id, operator_name: op });
    }
    await runJob(A.token, { app_id: A.appP.id, station_id: A.stP.id, work_order_id: A.woP.id, operator_name: 'Cleo', fail: true });
    await create(A.token, '/api/completions', {
      app_id: A.appW.id, station_id: A.stW.id, work_order_id: A.woW.id, operator_name: 'Ana',
    });

    // NCRs: one on each work order (so department/site resolve through the WO).
    await create(A.token, '/api/quality/ncrs', { title: 'Weld porosity', work_order_id: A.woW.id, app_id: A.appW.id });
    await create(A.token, '/api/quality/ncrs', { title: 'Paint run', work_order_id: A.woP.id, app_id: A.appP.id });

    // NOTE: no kaizen ideas are seeded — POST /api/kaizen is broken on this
    // lineage (the route writes `idea_number`, the table has `number`), a
    // pre-existing defect outside this change. The kaizen_status card stays on
    // the dashboard so filtered fetches still prove it computes without error.

    A.dashboard = await create(A.token, '/api/dashboards', { name: 'Ops', cards: CARDS });

    // ── Company B: its own plant, used only to prove isolation ───────────────
    const signupB = await api('POST', '/api/auth/signup', {
      body: { company_name: 'Filter Co B', email: 'admin@filter-b.test', password: 'SecretPass2', display_name: 'Admin B' },
    });
    assert.equal(signupB.status, 201);
    B.token = signupB.json.token;

    const sitesB = await api('GET', '/api/sites', { token: B.token });
    B.site = sitesB.json[0];
    B.dept = await create(B.token, '/api/departments', { name: 'B Assembly', site_id: B.site.id });
    B.app = await create(B.token, '/api/apps', { name: 'B App', status: 'published' });
    B.station = await create(B.token, '/api/stations', { name: 'B Station', department_id: B.dept.id, site_id: B.site.id });
    B.wo = await create(B.token, '/api/work-orders', {
      part_number: 'B-1', part_name: 'B Part', quantity: 4,
      app_id: B.app.id, department_id: B.dept.id, site_id: B.site.id,
    });
    for (let i = 0; i < 4; i++) {
      await runJob(B.token, { app_id: B.app.id, station_id: B.station.id, work_order_id: B.wo.id, operator_name: 'Bravo' });
    }
    B.dashboard = await create(B.token, '/api/dashboards', { name: 'B Ops', cards: CARDS });
  });

  it('returns the full picture when no filters are supplied', async () => {
    const { byId, body } = await cardData(A.token, A.dashboard.id);
    assert.deepEqual(body.filters, {}, 'no filters applied');
    assert.deepEqual(body.ignored_filters, []);
    assert.equal(byId['c-total'].value, 4, '4 completed runs across both departments');
    assert.equal(byId['c-active'].value, 1, '1 run still in progress');
    assert.equal(woTotal(byId['c-wo'].counts), 2, 'both work orders');
    assert.equal(byId['c-oper'].data.length, 3, 'Ana, Ben, Cleo');
    assert.equal(byId['c-station'].data.reduce((s, r) => s + r.value, 0), 2, 'both stations');
  });

  it('department_id narrows every completion-derived card type', async () => {
    const { byId, body } = await cardData(A.token, A.dashboard.id, { department_id: A.weld.id });
    assert.deepEqual(body.filters, { department_id: A.weld.id });

    // metric
    assert.equal(byId['c-total'].value, 3, 'only the 3 weld runs');
    assert.equal(byId['c-today'].value, 3);
    assert.equal(byId['c-period'].value, 3);
    assert.equal(byId['c-active'].value, 1, 'the in-progress run is a weld run');
    // time_series
    const tput = byId['c-tput'].series[0].data.reduce((s, p) => s + p.value, 0);
    assert.equal(tput, 3, 'throughput series only counts weld runs');
    // distribution
    assert.equal(byId['c-oper'].data.length, 2, 'Ana + Ben, no Cleo');
    assert.ok(!byId['c-oper'].data.some(r => r.label === 'Cleo'));
    assert.deepEqual(byId['c-dept'].data.map(r => r.label), ['Weld']);
    assert.deepEqual(byId['c-station'].data, [{ label: 'running', value: 1 }], 'only the weld station');
    assert.ok(Array.isArray(byId['c-kaizen'].data), 'kaizen card still computes under a department filter');
    // leaderboard
    assert.equal(byId['c-lead'].rows.reduce((s, r) => s + r.value, 0), 3);
    // wo_status
    assert.equal(woTotal(byId['c-wo'].counts), 1, 'the paint WO is filtered out');
    assert.equal(byId['c-wo'].counts.in_progress, 1);
    // table
    assert.equal(byId['c-table'].rows.length, 4, '3 completed + 1 in-progress weld run');
    assert.ok(byId['c-table'].rows.every(r => r.app_name === 'Weld Check'));
    // NCRs resolve their department through the work order
    assert.equal(byId['c-ncrs'].value, 1);
    assert.equal(byId['c-ncrtrend'].series[0].data.reduce((s, p) => s + p.value, 0), 1);
  });

  it('app_id narrows app-scoped cards and leaves the rest whole', async () => {
    const { byId } = await cardData(A.token, A.dashboard.id, { app_id: A.appP.id });
    assert.equal(byId['c-total'].value, 1, 'only the paint run');
    assert.deepEqual(byId['c-oper'].data.map(r => r.label), ['Cleo']);
    assert.equal(woTotal(byId['c-wo'].counts), 1, 'only the paint work order');
    assert.equal(byId['c-ncrs'].value, 1, 'the paint NCR carries app_id');
    assert.equal(byId['c-table'].rows.length, 1);
    // Cards with no app dimension stay whole rather than reporting zero.
    assert.equal(byId['c-station'].data.reduce((s, r) => s + r.value, 0), 2);
    assert.equal(byId['c-lowstock'].value, 0, 'inventory metric ignores app entirely');
  });

  it('site_id narrows site-scoped cards', async () => {
    const { byId } = await cardData(A.token, A.dashboard.id, { site_id: A.site2.id });
    assert.equal(byId['c-total'].value, 1, 'the paint run is the only North Plant run');
    assert.deepEqual(byId['c-station'].data, [{ label: 'idle', value: 1 }], 'only the paint booth');
    assert.equal(woTotal(byId['c-wo'].counts), 1, 'only the North Plant work order');
    assert.equal(byId['c-ncrs'].value, 1);
  });

  it('combines filters as an intersection', async () => {
    // Weld department + paint app = nothing.
    const { byId } = await cardData(A.token, A.dashboard.id, { department_id: A.weld.id, app_id: A.appP.id });
    assert.equal(byId['c-total'].value, 0);
    assert.equal(byId['c-table'].rows.length, 0);
    assert.deepEqual(byId['c-oper'].data, []);

    // Weld department + weld site = the weld runs.
    const both = await cardData(A.token, A.dashboard.id, { department_id: A.weld.id, site_id: A.site1.id });
    assert.equal(both.byId['c-total'].value, 3);
  });

  it("a card pinned to one app plus a page filter for another yields nothing, not everything", async () => {
    const pinned = await create(A.token, '/api/dashboards', {
      name: 'Pinned',
      cards: [{ id: 'p1', type: 'metric', title: 'Weld only', metric_key: 'total_completions', app_id: A.appW.id }],
    });
    const same = await cardData(A.token, pinned.id, { app_id: A.appW.id });
    assert.equal(same.byId.p1.value, 3, 'matching page filter keeps the card intact');

    const conflicting = await cardData(A.token, pinned.id, { app_id: A.appP.id });
    assert.equal(conflicting.byId.p1.value, 0, 'conflicting filters intersect to nothing');
  });

  it('ignores unknown filter ids instead of erroring', async () => {
    const unfiltered = await cardData(A.token, A.dashboard.id);
    const { byId, body } = await cardData(A.token, A.dashboard.id, {
      department_id: 'does-not-exist',
      app_id: '00000000-0000-0000-0000-000000000000',
      site_id: 'nope',
    });
    assert.deepEqual(body.filters, {}, 'nothing applied');
    assert.deepEqual(body.ignored_filters.sort(), ['app_id', 'department_id', 'site_id']);
    assert.equal(byId['c-total'].value, unfiltered.byId['c-total'].value, 'data is unchanged');
  });

  it('survives hostile filter values without a 500', async () => {
    const hostile = [
      "' OR 1=1 --",
      '%00',
      'a'.repeat(5000),
      '../../etc/passwd',
      '1; DROP TABLE completions;',
    ];
    for (const value of hostile) {
      for (const key of ['department_id', 'app_id', 'site_id']) {
        const r = await api('GET', `/api/dashboards/${A.dashboard.id}/data${qs({ [key]: value })}`, { token: A.token });
        assert.equal(r.status, 200, `${key}=${value.slice(0, 20)} should be ignored, got ${r.status}`);
        assert.deepEqual(r.json.filters, {});
        for (const c of r.json.cards) assert.ok(!c.error, `card ${c.card_id} errored: ${c.error}`);
      }
    }
    // The table is still there.
    const after = await cardData(A.token, A.dashboard.id);
    assert.equal(after.byId['c-total'].value, 4);
  });

  it('treats empty filter params as absent', async () => {
    const r = await api('GET', `/api/dashboards/${A.dashboard.id}/data?department_id=&app_id=%20&site_id=`, { token: A.token });
    assert.equal(r.status, 200);
    assert.deepEqual(r.json.filters, {});
    assert.deepEqual(r.json.ignored_filters, []);
  });

  it('is tenant-isolated: another company\'s filter ids are ignored, never applied', async () => {
    const baseline = await cardData(A.token, A.dashboard.id);
    const { byId, body } = await cardData(A.token, A.dashboard.id, {
      department_id: B.dept.id,
      app_id: B.app.id,
      site_id: B.site.id,
    });
    assert.deepEqual(body.filters, {}, 'company B ids must not be accepted');
    assert.deepEqual(body.ignored_filters.sort(), ['app_id', 'department_id', 'site_id']);
    assert.equal(byId['c-total'].value, baseline.byId['c-total'].value);
    assert.equal(byId['c-total'].value, 4, "company B's 4 runs are not mixed in");
    assert.ok(!byId['c-oper'].data.some(r => r.label === 'Bravo'), "company B's operator must not appear");
    assert.ok(!byId['c-table'].rows.some(r => r.app_name === 'B App'));
  });

  it('is tenant-isolated: filtering company B never reveals company A', async () => {
    const { byId } = await cardData(B.token, B.dashboard.id, { department_id: B.dept.id });
    assert.equal(byId['c-total'].value, 4, 'only company B runs');
    assert.deepEqual(byId['c-oper'].data.map(r => r.label), ['Bravo']);
    assert.ok(!byId['c-table'].rows.some(r => r.app_name.includes('Weld')));

    // And company B cannot read company A's dashboard at all, filtered or not.
    const leak = await api('GET', `/api/dashboards/${A.dashboard.id}/data${qs({ department_id: B.dept.id })}`, { token: B.token });
    assert.equal(leak.status, 404);
  });

  it('keeps the category Reports dashboards filterable too', async () => {
    const reports = await api('GET', '/api/dashboards/category/production', { token: A.token });
    assert.equal(reports.status, 200);
    const filtered = await api('GET', `/api/dashboards/${reports.json.id}/data${qs({ department_id: A.weld.id })}`, { token: A.token });
    assert.equal(filtered.status, 200);
    assert.deepEqual(filtered.json.filters, { department_id: A.weld.id });
    for (const c of filtered.json.cards) {
      assert.ok(!c.error, `report card ${c.card_id} errored: ${c.error}`);
      assert.ok(c.data !== null && c.data !== undefined);
    }
    const stationCard = reports.json.cards.find(c => c.group_by === 'station_status');
    const stationData = filtered.json.cards.find(c => c.card_id === stationCard.id).data;
    assert.deepEqual(stationData.data, [{ label: 'running', value: 1 }], 'station status honours the department filter');
  });

  it('still requires authentication', async () => {
    const r = await api('GET', `/api/dashboards/${A.dashboard.id}/data${qs({ department_id: A.weld.id })}`, {});
    assert.equal(r.status, 401);
  });
});

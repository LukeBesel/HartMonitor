'use strict';
// ─── Site scope on the Command Center ─────────────────────────────────────────
// The Command Center renders the daily brief and the plant view on one page,
// under one site selector. The brief accepted ?site_id and silently ignored it,
// so a manager at a two-site company read the OTHER site's late work orders and
// down stations directly above this site's floor numbers.
//
// The rule site follows is deliberately NOT the rule department and app follow,
// and this file pins both halves of it:
//
//   * a record belonging to a DIFFERENT site is excluded;
//   * a record with NO site stays visible under every site, because a company
//     that has never used sites must not have its page emptied by selecting the
//     auto-created primary one.
//
// Uses Node built-ins only (node:test + global fetch). Run with: npm test

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const PORT = 3256; // unique per test file — a shared port silently cancels a suite
const BASE = `http://localhost:${PORT}`;
const DB_PATH = path.join(os.tmpdir(), `mes-site-scope-${Date.now()}.db`);

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

const iso = hoursFromNow => new Date(Date.now() + hoursFromNow * 3600000).toISOString();

/** Labels of every Needs-Attention row the brief returned. */
const labels = brief => (brief.attention || []).map(a => a.label);

before(async () => { await startServer(); });
after(() => {
  if (server) server.kill('SIGTERM');
  for (const ext of ['', '-shm', '-wal']) {
    try { fs.unlinkSync(DB_PATH + ext); } catch { /* ignore */ }
  }
});

describe('daily brief honours the site selector', () => {
  const T = {};

  before(async () => {
    const signup = await api('POST', '/api/auth/signup', {
      body: { company_name: 'Two Plant Co', email: 'admin@twoplant.test', password: 'SecretPass1', display_name: 'Admin' },
    });
    assert.equal(signup.status, 201);
    T.token = signup.json.token;

    T.north = await create(T.token, '/api/sites', { name: 'North Plant', code: 'NTH' });
    T.south = await create(T.token, '/api/sites', { name: 'South Plant', code: 'STH' });

    T.dept = await create(T.token, '/api/departments', { name: 'Assembly' });
    T.app  = await create(T.token, '/api/apps', { name: 'Assembly Check', status: 'published' });

    // One down station per site, plus one belonging to no site at all.
    T.stNorth = await create(T.token, '/api/stations', { name: 'North Cell', department_id: T.dept.id, site_id: T.north.id });
    T.stSouth = await create(T.token, '/api/stations', { name: 'South Cell', department_id: T.dept.id, site_id: T.south.id });
    T.stNone  = await create(T.token, '/api/stations', { name: 'Shared Bench', department_id: T.dept.id });
    // A station goes down by logging a machine event, not by writing `status` —
    // that column is the station's lifecycle (active/inactive/maintenance) and
    // its CHECK does not accept 'down'. The live floor state is current_status.
    // A stop needs a coded reason (wave 4); the company's defaults seed on first read.
    const downCodes = await api('GET', '/api/andon/reason-codes?kind=downtime', { token: T.token });
    const downCode = downCodes.json[0].id;
    for (const st of [T.stNorth, T.stSouth, T.stNone]) {
      const r = await api('POST', `/api/oee/${st.id}/event`, {
        token: T.token, body: { event_type: 'down', reason: 'test outage', reason_code_id: downCode },
      });
      assert.equal(r.status, 200, `marking ${st.name} down → ${r.status} ${JSON.stringify(r.json)}`);
    }

    // One overdue work order per site, plus one with no site.
    const overdue = extra => ({
      quantity: 5, app_id: T.app.id, department_id: T.dept.id,
      scheduled_start: iso(-48), scheduled_end: iso(-24), status: 'in_progress',
      ...extra,
    });
    T.woNorth = await create(T.token, '/api/work-orders', overdue({ part_number: 'N-1', part_name: 'North Part', site_id: T.north.id }));
    T.woSouth = await create(T.token, '/api/work-orders', overdue({ part_number: 'S-1', part_name: 'South Part', site_id: T.south.id }));
    T.woNone  = await create(T.token, '/api/work-orders', overdue({ part_number: 'U-1', part_name: 'Unsited Part' }));

    // A completed run at each site, so the KPI tiles have something to divide.
    for (const [station, wo] of [[T.stNorth, T.woNorth], [T.stSouth, T.woSouth]]) {
      const c = await create(T.token, '/api/completions', {
        app_id: T.app.id, station_id: station.id, work_order_id: wo.id, operator_name: 'Sam',
      });
      const upd = await api('PUT', `/api/completions/${c.id}`, {
        token: T.token, body: { status: 'completed', data: { qc: 'Pass' } },
      });
      assert.equal(upd.status, 200, `completing run failed: ${JSON.stringify(upd.json)}`);
    }
  });

  it('shows only the selected site\'s late work orders, plus the unsited one', async () => {
    const north = await get(T.token, `/api/analytics/daily-brief?site_id=${T.north.id}`);
    const found = labels(north).join(' | ');
    assert.ok(found.includes('North Part'), `North Plant brief should list its own late work order — got: ${found}`);
    assert.ok(!found.includes('South Part'), `North Plant brief must not list South Plant's late work order — got: ${found}`);
    assert.ok(found.includes('Unsited Part'), `a work order with no site belongs to every site — got: ${found}`);
  });

  it('shows only the selected site\'s down stations, plus the unsited one', async () => {
    const south = await get(T.token, `/api/analytics/daily-brief?site_id=${T.south.id}`);
    const found = labels(south).join(' | ');
    assert.ok(found.includes('South Cell is down'), `South Plant brief should list its own down station — got: ${found}`);
    assert.ok(!found.includes('North Cell is down'), `South Plant brief must not list North Plant's down station — got: ${found}`);
    assert.ok(found.includes('Shared Bench is down'), `a station with no site belongs to every site — got: ${found}`);
  });

  it('counts each site\'s runs separately, and the whole plant when unscoped', async () => {
    const north = await get(T.token, `/api/analytics/daily-brief?site_id=${T.north.id}`);
    const south = await get(T.token, `/api/analytics/daily-brief?site_id=${T.south.id}`);
    const all   = await get(T.token, '/api/analytics/daily-brief');

    assert.equal(north.kpis.completed_today, 1, 'North Plant ran one job today');
    assert.equal(south.kpis.completed_today, 1, 'South Plant ran one job today');
    assert.equal(all.kpis.completed_today, 2, 'the plant-wide view is the sum of both');
  });

  it('a site id from another company narrows to nothing rather than widening', async () => {
    const other = await api('POST', '/api/auth/signup', {
      body: { company_name: 'Rival Co', email: 'admin@rivalco.test', password: 'SecretPass1', display_name: 'Rival' },
    });
    assert.equal(other.status, 201);
    const rivalSite = await create(other.json.token, '/api/sites', { name: 'Rival Plant', code: 'RVL' });

    const brief = await get(T.token, `/api/analytics/daily-brief?site_id=${rivalSite.id}`);
    const found = labels(brief).join(' | ');
    assert.ok(!found.includes('North Part'), `another company's site id must not surface North Plant — got: ${found}`);
    assert.ok(!found.includes('South Part'), `another company's site id must not surface South Plant — got: ${found}`);
    // The unsited rows still show: they belong to the whole company, and the
    // company is still this one. What must never happen is the rival's data.
    assert.ok(!found.includes('Rival'), `no row from the other company may appear — got: ${found}`);
  });

  it('leaves the brief and the plant view telling the same story', async () => {
    // The bug this file exists for was the two halves of one page disagreeing.
    const brief = await get(T.token, `/api/analytics/daily-brief?site_id=${T.north.id}`);
    const plant = await get(T.token, `/api/analytics/plant-view?site_id=${T.north.id}`);
    const briefDown = labels(brief).filter(l => l.endsWith('is down'));
    assert.ok(briefDown.includes('North Cell is down'));
    assert.ok(!briefDown.includes('South Cell is down'));
    // The plant view was already site-scoped; confirm it agrees rather than
    // assuming it does.
    const plantStations = JSON.stringify(plant);
    assert.ok(!plantStations.includes('South Cell'), 'plant view leaked the other site');
  });
});

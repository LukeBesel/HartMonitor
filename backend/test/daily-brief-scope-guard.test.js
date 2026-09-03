'use strict';
// ─── /analytics/daily-brief refuses a scope it cannot honour ──────────────────
// Every other analytics route answers a bad or foreign scope with an explicitly
// EMPTY payload and `scope_valid: false`, so a page can never print plant-wide
// numbers under a department's name (see /overview and /plant-view). The brief
// validated nothing: it spliced the raw ids into its WHERE clauses and trusted
// that "matches nothing" and "means nothing" were the same answer.
//
// They are not. A site clause deliberately keeps the records that belong to no
// site — they belong to every one — so a site id from ANOTHER company came back
// as a brief full of this company's unsited work orders, its 7-day chart and its
// week average, under a filter the server had silently thrown away. A department
// or app id that does not exist narrowed to nothing but still said nothing about
// it, so the Command Center printed the empty payload as if it were a measured
// zero.
//
// So: the same guard, the same shape, on all four of the brief's scope
// parameters. Product type is one of them: the completion filter has always
// honoured `?product_type_id`, so guarding only the other three would leave the
// same never-measured zero behind one parameter instead of three.
//
// Uses Node built-ins only (node:test + global fetch).
// Run with: node --test test/daily-brief-scope-guard.test.js

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const PORT = 3417; // reserved for this workstream in MIGRATIONS.md — a shared port silently cancels a suite
const BASE = `http://localhost:${PORT}`;
const DB_PATH = path.join(os.tmpdir(), `mes-brief-scope-${Date.now()}.db`);

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

before(async () => { await startServer(); });
after(() => {
  if (server) server.kill('SIGTERM');
  for (const ext of ['', '-shm', '-wal']) {
    try { fs.unlinkSync(DB_PATH + ext); } catch { /* ignore */ }
  }
});

describe('daily-brief scope guard', () => {
  const A = {};
  const B = {};

  /** Every figure and every list the brief carries, empty. */
  function assertEmptyBrief(brief, why) {
    assert.equal(brief.scope_valid, false, `${why}: scope_valid must say the filter was refused`);
    assert.deepEqual(brief.scope, { department_id: null, app_id: null },
      `${why}: an id the company does not own is never echoed back`);
    assert.deepEqual(brief.attention, [], `${why}: nothing needs attention in a scope that does not exist`);
    assert.equal(brief.attention_plant_wide_hidden, 0, `${why}: nothing was set aside — nothing was read`);
    assert.deepEqual(brief.due_soon, [], `${why}: no work order is due in a scope that does not exist`);
    assert.equal(brief.kpis.completed_today, 0, why);
    assert.equal(brief.kpis.active_now, 0, why);
    assert.strictEqual(brief.kpis.pass_rate_7d, null, `${why}: unmeasurable is null, never 0%`);
    assert.strictEqual(brief.kpis.schedule_adherence, null, `${why}: unmeasurable is null, never 0%`);
    assert.strictEqual(brief.kpis.vs_7day_avg_pct, null, `${why}: unmeasurable is null, never 0%`);
    assert.equal(brief.kpis.work_orders_total, 0, why);
    assert.equal(brief.week_avg_per_day, 0, why);
    assert.equal(brief.throughput_7d.reduce((n, d) => n + d.count, 0), 0,
      `${why}: the 7-day chart is part of the answer too`);
  }

  before(async () => {
    const signupA = await api('POST', '/api/auth/signup', {
      body: { company_name: 'Guarded Co', email: 'admin@guardedco.test', password: 'SecretPass1', display_name: 'Admin A' },
    });
    assert.equal(signupA.status, 201);
    A.token = signupA.json.token;

    A.site = await create(A.token, '/api/sites', { name: 'North Plant', code: 'NRTH' });
    A.weld = await create(A.token, '/api/departments', { name: 'Welding' });
    A.app  = await create(A.token, '/api/apps', { name: 'Weld Check', status: 'published' });
    A.stW  = await create(A.token, '/api/stations', { name: 'Weld Cell', department_id: A.weld.id, site_id: A.site.id });
    A.brkt = await create(A.token, '/api/product-types', { app_id: A.app.id, name: 'Bracket' });
    A.hinge = await create(A.token, '/api/product-types', { app_id: A.app.id, name: 'Hinge' });

    // Overdue, and belonging to no site at all — the row a foreign site id used
    // to surface, because "no site" belongs to every site.
    A.woNone = await create(A.token, '/api/work-orders', {
      part_number: 'X-1', part_name: 'Unsited Part', quantity: 2,
      scheduled_start: iso(-48), scheduled_end: iso(-24),
    });
    A.woWeld = await create(A.token, '/api/work-orders', {
      part_number: 'W-1', part_name: 'Weldment', quantity: 10,
      app_id: A.app.id, department_id: A.weld.id, site_id: A.site.id,
      product_type_id: A.brkt.id,
      scheduled_start: iso(-48), scheduled_end: iso(-24), status: 'in_progress',
    });

    // One finished run, so every figure has something to be non-zero about.
    // It is a Bracket, so a Hinge filter has a real, owned id to narrow with.
    const c = await create(A.token, '/api/completions', {
      app_id: A.app.id, station_id: A.stW.id, work_order_id: A.woWeld.id, operator_name: 'Ana',
      product_type_id: A.brkt.id,
    });
    const upd = await api('PUT', `/api/completions/${c.id}`, {
      token: A.token, body: { status: 'completed', data: { qc: 'Pass' } },
    });
    assert.equal(upd.status, 200, `completing run failed: ${JSON.stringify(upd.json)}`);

    // A second company, so a genuinely foreign id can be tried against A.
    const signupB = await api('POST', '/api/auth/signup', {
      body: { company_name: 'Rival Co', email: 'admin@rivalguard.test', password: 'SecretPass2', display_name: 'Admin B' },
    });
    assert.equal(signupB.status, 201);
    B.token = signupB.json.token;
    B.dept = await create(B.token, '/api/departments', { name: 'B Assembly' });
    B.app  = await create(B.token, '/api/apps', { name: 'B App', status: 'published' });
    B.site = await create(B.token, '/api/sites', { name: 'Rival Plant', code: 'RVL2' });
    B.type = await create(B.token, '/api/product-types', { app_id: B.app.id, name: 'B Widget Type' });
  });

  it('a valid department is answered, and says the filter was honoured', async () => {
    const brief = await get(A.token, `/api/analytics/daily-brief?department_id=${A.weld.id}`);
    assert.equal(brief.scope_valid, true, 'a department this company owns is a scope the server can answer');
    assert.deepEqual(brief.scope, { department_id: A.weld.id, app_id: null });
    assert.equal(brief.kpis.completed_today, 1, 'Welding finished one run today');
    assert.ok(brief.attention.some(i => i.label.includes('Weldment')),
      `the department's own late work order is still listed — got ${JSON.stringify(brief.attention.map(i => i.label))}`);
  });

  it("another company's department id empties the brief instead of widening it", async () => {
    assertEmptyBrief(
      await get(A.token, `/api/analytics/daily-brief?department_id=${B.dept.id}`),
      "a foreign department id",
    );
  });

  it('a department id that does not exist at all empties the brief', async () => {
    assertEmptyBrief(
      await get(A.token, '/api/analytics/daily-brief?department_id=no-such-department'),
      'a nonexistent department id',
    );
  });

  it('the guard covers site_id and app_id too, not just department_id', async () => {
    // site_id is the one that leaked. Its clause keeps the records that belong
    // to no site — correct for a real site, a hole for one from another tenant:
    // the unsited work order, the week's runs and the 7-day chart all came back
    // under a filter the server had thrown away.
    const foreignSite = await get(A.token, `/api/analytics/daily-brief?site_id=${B.site.id}`);
    assertEmptyBrief(foreignSite, 'a foreign site id');
    assert.ok(!JSON.stringify(foreignSite).includes('Unsited Part'),
      'a site id this company does not own must not surface its unsited work orders');

    assertEmptyBrief(await get(A.token, '/api/analytics/daily-brief?site_id=no-such-site'), 'a nonexistent site id');
    assertEmptyBrief(await get(A.token, `/api/analytics/daily-brief?app_id=${B.app.id}`), 'a foreign app id');
    assertEmptyBrief(await get(A.token, '/api/analytics/daily-brief?app_id=no-such-app'), 'a nonexistent app id');

    // One good id does not rescue a bad one: the page asked for both, and half
    // an answer under a two-part filter is the lie this guard exists to stop.
    assertEmptyBrief(
      await get(A.token, `/api/analytics/daily-brief?department_id=${A.weld.id}&app_id=${B.app.id}`),
      'a valid department beside a foreign app',
    );
  });

  it('the figures are filtered on the ids the guard resolved, not on the query string again', async () => {
    // A query string can carry the same parameter twice, and Express hands that
    // over as an ARRAY. The guard reads it through plantTruth, which takes the
    // first id and checks it; the completion filter behind the five headline
    // figures used to go back to `req.query` for itself and bind the array to a
    // `= ?` placeholder — so the guard and the numbers under it were reading two
    // different things, and the brief answered a supported filter with a 500.
    // Both read the resolved scope now.
    const dup = `department_id=${A.weld.id}&department_id=${A.weld.id}`;
    const brief = await get(A.token, `/api/analytics/daily-brief?${dup}`);
    assert.equal(brief.scope_valid, true, 'a department this company owns, named twice, is still that department');
    assert.equal(brief.scope.department_id, A.weld.id, 'the guard resolved one department');
    assert.equal(brief.kpis.completed_today, 1,
      'and the KPI counted that same department, not the raw parameter beside it');
  });

  it('the guard covers product_type_id, the fourth parameter the brief filters on', async () => {
    // The completion filter has always applied ?product_type_id to the five
    // headline figures. Left outside the guard, a product type from another
    // tenant sailed through, narrowed every one of them to nothing, and came
    // back beside scope_valid: true — a quiet morning nobody measured.
    assertEmptyBrief(
      await get(A.token, `/api/analytics/daily-brief?product_type_id=${B.type.id}`),
      'a foreign product type id',
    );
    assertEmptyBrief(
      await get(A.token, '/api/analytics/daily-brief?product_type_id=no-such-product-type'),
      'a nonexistent product type id',
    );
  });

  it('a product type this company owns narrows the brief, and the echo says so', async () => {
    // The guard and the filter have to agree about which ids are in play, so
    // the two owned product types must give different answers: the run was a
    // Bracket, and the work order behind it is a Bracket order.
    const bracket = await get(A.token, `/api/analytics/daily-brief?product_type_id=${A.brkt.id}`);
    assert.equal(bracket.scope_valid, true, 'a product type this company owns is answerable');
    // The echo carries department and app only — a shape another workstream's
    // suite pins — so what proves the product type was applied is the numbers.
    assert.equal(bracket.kpis.completed_today, 1, "the Bracket run is this scope's own");
    assert.ok(bracket.attention.some(i => i.label.includes('Weldment')),
      `the Bracket work order is late and belongs to this scope — got ${JSON.stringify(bracket.attention.map(i => i.label))}`);

    const hinge = await get(A.token, `/api/analytics/daily-brief?product_type_id=${A.hinge.id}`);
    assert.equal(hinge.scope_valid, true, 'an owned product type with no output is still answerable');
    assert.equal(hinge.kpis.completed_today, 0, 'no Hinge ran today');
    assert.ok(!hinge.attention.some(i => i.label.includes('Weldment')),
      `a Bracket work order is not the Hinge scope's late work — got ${JSON.stringify(hinge.attention.map(i => i.label))}`);
    assert.ok(!hinge.attention.some(i => i.label.includes('Unsited Part')),
      'a work order with no product type is set aside under a product-type filter, not shown under it');
    assert.ok(hinge.attention_plant_wide_hidden > 0,
      'and the page is told how many rows had no product type to be filed under');
  });
});

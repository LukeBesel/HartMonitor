'use strict';
// ─── One definition of today ──────────────────────────────────────────────────
// The same company, read at the same minute, reported three different plants:
// the Command Center said "62 finished today / 67% on track", Manager View said
// "1 active / 33% on track", and the department drill-down said "2 of 3". Five
// numbers — finished today, running now, average cycle, pass rate, on track —
// were each re-derived on about a dozen screens, and one of them counted the day
// off the tablet's own browser clock.
//
// src/plantTruth.js is now the only place any of them is computed, and
// GET /api/floor/snapshot is the plant asking itself. This file pins the four
// things that have to hold for that to be worth anything:
//
//   1. The day is the PLANT'S day. A run stamped 03:30 UTC belongs to the
//      previous day in Detroit, and every screen must agree about that. The
//      fixture computes what Detroit's calendar says at that instant rather than
//      hard-coding an answer that is only right for part of the day.
//   2. Unknown is null, never 0, and the sample beside each number says which it
//      is. Nothing here ever accepts 0 as "we did not measure".
//   3. Five endpoints, one answer: the floor snapshot, the per-department
//      listing, the department drill-down, the leaderboard board and the OEE
//      tiles report the SAME finished-today and the same on-track pair.
//   4. A scope from another tenant empties the answer and leaks no name.
//
// It also pins the two smaller promises: the floor endpoints work on a FREE plan
// (knowing what your own floor is doing is the product, not an upsell), and the
// leaderboard's department-less runs are a "No department" bucket after the
// ranked list — never a department called "Unassigned" sitting at #1.
//
// Uses Node built-ins only (node:test + global fetch), plus a direct
// better-sqlite3 connection to plant timestamps the API always stamps as "now".
// Run with: node --test test/plant-truth.test.js

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Database = require('better-sqlite3');

const PORT = 3402; // unique per test file — a collision silently cancels a suite
const BASE = `http://localhost:${PORT}`;
const DB_PATH = path.join(os.tmpdir(), `mes-plant-truth-${process.pid}-${Date.now()}.db`);

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
        // Deliberately OFF: the floor endpoints must answer on a free plan, and
        // this suite proves it. OEE is pro, so the one company that needs it is
        // given a pro plan row below.
        EARLY_ACCESS: 'false',
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

/** The calendar date in `tz` at `at`, 'YYYY-MM-DD'. This is plantToday's rule. */
function localDate(tz, at) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' })
      .formatToParts(at).map(p => [p.type, p.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}`;
}

/** SQLite's own stamp format: 'YYYY-MM-DD HH:MM:SS', UTC, no zone marker. */
function toSqlite(date) {
  return date.toISOString().slice(0, 19).replace('T', ' ');
}

const hoursFromNow = h => new Date(Date.now() + h * 3600000).toISOString();

before(async () => { await startServer(); });
after(() => {
  if (server) server.kill('SIGTERM');
  for (const ext of ['', '-shm', '-wal']) {
    try { fs.unlinkSync(DB_PATH + ext); } catch { /* ignore */ }
  }
});

describe('one definition of today', () => {
  const A = {};   // Detroit Tool — the plant-day fixture
  const B = {};   // Quiet Co — nothing measured yet
  const C = {};   // Mixed Co — some runs belong to no department

  // 03:30 UTC on today's UTC date. In Detroit that is 22:30 or 23:30 the
  // PREVIOUS evening — so a screen counting Greenwich's day and a screen
  // counting the plant's day give different answers for this one run whenever
  // the two calendars disagree. Which of them is right is not a matter of
  // opinion: the plant's day is the one the crew is working.
  const edgeStamp = new Date(`${localDate('UTC', new Date())}T03:30:00Z`);
  let edgeIsPlantToday;
  let finishedTodayExpected;

  // The 03:30Z run lands on whichever side of the boundary the hour of the run
  // puts it, so on its own it only exercises one branch per part of the day.
  // This one is unambiguous at every hour: 26 hours back is the previous
  // calendar day in any zone, DST included. It must never be counted as today,
  // and it must still be there in the all-time total — "not today" and "not
  // there" are different facts.
  const yesterdayStamp = new Date(Date.now() - 26 * 3600000);

  const RUNS_NOW = 2;   // finished moments ago — today on any clock

  before(async () => {
    // ── Company A: the plant-day fixture, in Detroit ─────────────────────────
    const signupA = await api('POST', '/api/auth/signup', {
      body: {
        company_name: 'Detroit Tool', email: 'admin@detroittool.test',
        password: 'SecretPass1', display_name: 'Admin', timezone: ZONE,
      },
    });
    assert.equal(signupA.status, 201, `signup A: ${JSON.stringify(signupA.json)}`);
    A.token = signupA.json.token;

    const cfg = await get(A.token, '/api/config');
    assert.equal(cfg.timezone, ZONE, 'the company was created in the zone signup was told about');

    A.dept = await create(A.token, '/api/departments', { name: 'Assembly' });
    A.station = await create(A.token, '/api/stations', { name: 'Bench 1', department_id: A.dept.id });
    A.app = await create(A.token, '/api/apps', { name: 'Press Check' });
    // The leaderboard only ranks runs of a PUBLISHED app.
    const published = await api('POST', `/api/apps/${A.app.id}/publish`, { token: A.token });
    assert.equal(published.status, 200, `publish: ${JSON.stringify(published.json)}`);

    /** A finished, inspected run on the department's station. Returns its id. */
    async function run(operator, { leaveOpen = false, verdict = 'Pass' } = {}) {
      const started = await create(A.token, '/api/completions', {
        app_id: A.app.id, station_id: A.station.id, operator_name: operator,
      });
      if (leaveOpen) return started.id;
      const done = await api('PUT', `/api/completions/${started.id}`, {
        token: A.token, body: { status: 'completed', data: { qc: verdict } },
      });
      assert.equal(done.status, 200, `completing: ${JSON.stringify(done.json)}`);
      return started.id;
    }

    const nowIds = [];
    for (let i = 0; i < RUNS_NOW; i++) nowIds.push(await run(`Ada ${i}`));
    const edgeId = await run('Ben');
    const yesterdayId = await run('Dan');
    await run('Cleo', { leaveOpen: true });          // running_now = 1

    // Three work orders, so "on track" has something to be a share of:
    //   half the schedule gone and all of it built  → on_track
    //   half the schedule gone and none of it built → behind
    //   already finished                            → not open at all
    const woBody = extra => ({
      part_number: 'P-1', part_name: 'Bracket', quantity: 10,
      app_id: A.app.id, department_id: A.dept.id,
      scheduled_start: hoursFromNow(-2), scheduled_end: hoursFromNow(2),
      status: 'in_progress', ...extra,
    });
    A.woOnTrack = await create(A.token, '/api/work-orders', woBody({ part_number: 'P-ONTRACK' }));
    A.woBehind  = await create(A.token, '/api/work-orders', woBody({ part_number: 'P-BEHIND' }));
    A.woDone    = await create(A.token, '/api/work-orders', woBody({ part_number: 'P-DONE' }));

    // ── Company B: a company that has measured nothing yet ───────────────────
    const signupB = await api('POST', '/api/auth/signup', {
      body: { company_name: 'Quiet Co', email: 'admin@quietco.test', password: 'SecretPass2', display_name: 'Admin B' },
    });
    assert.equal(signupB.status, 201, `signup B: ${JSON.stringify(signupB.json)}`);
    B.token = signupB.json.token;
    B.app = await create(B.token, '/api/apps', { name: 'B Press' });
    B.open = await create(B.token, '/api/completions', { app_id: B.app.id, operator_name: 'Nobody' });

    // ── Company C: runs in a department, and runs belonging to none ──────────
    const signupC = await api('POST', '/api/auth/signup', {
      body: { company_name: 'Mixed Co', email: 'admin@mixedco.test', password: 'SecretPass3', display_name: 'Admin C' },
    });
    assert.equal(signupC.status, 201, `signup C: ${JSON.stringify(signupC.json)}`);
    C.token = signupC.json.token;
    C.dept = await create(C.token, '/api/departments', { name: 'Finishing' });
    C.station = await create(C.token, '/api/stations', { name: 'Booth 1', department_id: C.dept.id });
    C.app = await create(C.token, '/api/apps', { name: 'Coat' });
    await api('POST', `/api/apps/${C.app.id}/publish`, { token: C.token });

    async function runC(body) {
      const started = await create(C.token, '/api/completions', { app_id: C.app.id, ...body });
      const done = await api('PUT', `/api/completions/${started.id}`, {
        token: C.token, body: { status: 'completed', data: { qc: 'Pass' } },
      });
      assert.equal(done.status, 200, `completing C: ${JSON.stringify(done.json)}`);
      return started.id;
    }
    // Two in the department…
    await runC({ station_id: C.station.id, operator_name: 'Dee' });
    await runC({ station_id: C.station.id, operator_name: 'Eve' });
    // …and three that belong to no department at all: no work order, no station.
    // Sorted on output alone these would take #1 on a board of departments.
    await runC({ operator_name: 'Zed 1' });
    await runC({ operator_name: 'Zed 2' });
    await runC({ operator_name: 'Zed 3' });

    // ── Timestamps and plan tier the API will not set for us ─────────────────
    const raw = new Database(DB_PATH);
    const stamp = raw.prepare('UPDATE completions SET started_at = ?, completed_at = ? WHERE id = ?');
    // The edge run: five minutes of work ending at 03:30 UTC.
    stamp.run(toSqlite(new Date(edgeStamp.getTime() - 5 * 60000)), toSqlite(edgeStamp), edgeId);
    stamp.run(toSqlite(new Date(yesterdayStamp.getTime() - 5 * 60000)), toSqlite(yesterdayStamp), yesterdayId);
    // The control runs are pinned too, rather than drifting with the clock while
    // the suite runs — a minute ago is today in Detroit whatever the hour.
    const control = new Date(Date.now() - 60000);
    for (const id of nowIds) {
      stamp.run(toSqlite(new Date(control.getTime() - 5 * 60000)), toSqlite(control), id);
    }
    // Build progress the work-order API does not accept on create.
    raw.prepare('UPDATE work_orders SET quantity_completed = 10 WHERE id = ?').run(A.woOnTrack.id);
    raw.prepare('UPDATE work_orders SET quantity_completed = 0 WHERE id = ?').run(A.woBehind.id);
    raw.prepare("UPDATE work_orders SET status = 'completed', quantity_completed = 10 WHERE id = ?").run(A.woDone.id);

    A.companyId = raw.prepare('SELECT id FROM organizations WHERE name = ?').get('Detroit Tool').id;
    // OEE is a pro feature and this suite compares its count with the others.
    // Company B stays free on purpose — see the plan-gate test below.
    raw.prepare("UPDATE plan SET tier = 'pro' WHERE company_id = ?").run(A.companyId);
    raw.close();

    edgeIsPlantToday = localDate(ZONE, edgeStamp) === localDate(ZONE, new Date());
    finishedTodayExpected = RUNS_NOW + (edgeIsPlantToday ? 1 : 0);
  });

  // ── 1. The plant's day ─────────────────────────────────────────────────────

  it('counts the plant\'s day, not Greenwich\'s, and says which day that is', async () => {
    const snap = await get(A.token, '/api/floor/snapshot');

    assert.equal(snap.timezone, ZONE);
    assert.equal(snap.plant_date, localDate(ZONE, new Date()),
      'the snapshot reports the day the plant is having');

    // …and that is exactly plantToday(companyId), read from the module itself
    // rather than from a second implementation of the same idea.
    process.env.DATABASE_PATH = DB_PATH;
    process.env.SEED_DEMO_DATA = 'false';
    const { plantToday, plantDayShift } = require('../src/plantDay');
    assert.equal(snap.plant_date, plantToday(A.companyId),
      'plant_date is plantToday(companyId), not a second opinion about it');

    // The per-request context resolves the day ONCE and threads it through every
    // query. It must be the same day plantDay.js would have handed each of them
    // individually — resolving once is an optimisation, never a second rule.
    const { plantContext } = require('../src/plantTruth');
    const ctx = plantContext(A.companyId);
    assert.equal(ctx.day, plantDayShift(A.companyId), 'the context binds plantDay\'s modifier');
    assert.equal(ctx.plant_date, plantToday(A.companyId), 'and plantDay\'s date');
    assert.equal(ctx.timezone, ZONE);

    const detail =
      `${ZONE} says it is ${localDate(ZONE, new Date())}, UTC says ${localDate('UTC', new Date())}; ` +
      `the 03:30Z run falls on ${localDate(ZONE, edgeStamp)} in Detroit, ` +
      `${localDate('UTC', edgeStamp)} in UTC`;

    assert.equal(snap.finished_today, finishedTodayExpected,
      `finished_today counts the plant's day — ${detail}`);

    if (!edgeIsPlantToday) {
      // The whole point: a screen still on Greenwich's day would say one more.
      assert.notEqual(snap.finished_today, RUNS_NOW + 1,
        `a run at 03:30Z is yesterday in Detroit and must not be counted — ${detail}`);
    }

    assert.equal(snap.running_now, 1, 'one run is still open on the bench');

    // The unambiguous half of the fixture, live at every hour of the day: a run
    // that finished 26 hours ago is not today's, whatever the clock says.
    assert.notEqual(localDate(ZONE, yesterdayStamp), snap.plant_date,
      'the fixture is broken if 26 hours ago is still today');
    const overview = await get(A.token, '/api/analytics/overview');
    assert.equal(overview.totalCompletions, 4,
      'all four finished runs exist — two now, one at 03:30Z, one yesterday');
    assert.equal(overview.todayCompletions, finishedTodayExpected,
      'and the overview counts the same day the snapshot does');
    assert.ok(overview.totalCompletions > snap.finished_today,
      'yesterday\'s run is real, it is simply not today\'s');
  });

  // ── 2. Unknown is null, never 0 ────────────────────────────────────────────

  it('reports null with a reason — never 0 — for what nobody has measured', async () => {
    // Company B has one run OPEN and nothing finished at all.
    const before = await get(B.token, '/api/floor/snapshot');
    assert.strictEqual(before.avg_cycle_seconds, null, 'no completed run ⇒ no average, not 0s');
    assert.strictEqual(before.avg_cycle_sample, 0);
    assert.equal(typeof before.avg_cycle_reason, 'string');
    assert.ok(before.avg_cycle_reason.length > 0, 'a null number says why it is null');
    assert.strictEqual(before.avg_cycle_basis, null);
    // A count is a measurement: zero runs finished is a fact, not a gap.
    assert.strictEqual(before.finished_today, 0);
    assert.strictEqual(before.running_now, 1);
    // No open work orders ⇒ no on-track share. 0% would read as "all late".
    assert.strictEqual(before.on_track_pct, null);
    assert.equal(typeof before.on_track_reason, 'string');

    // Now finish a run that nobody inspected: it HAS a duration and has NO
    // verdict, and the two facts must not contaminate each other.
    const done = await api('PUT', `/api/completions/${B.open.id}`, {
      token: B.token, body: { status: 'completed', data: { note: 'no inspection step' } },
    });
    assert.equal(done.status, 200, `completing: ${JSON.stringify(done.json)}`);

    const after = await get(B.token, '/api/floor/snapshot');
    assert.strictEqual(after.pass_rate, null, 'no pass/fail recorded ⇒ no pass rate, not 0%');
    assert.strictEqual(after.pass_rate_sample, 0, 'and the sample says so');
    assert.equal(typeof after.pass_rate_reason, 'string');
    assert.strictEqual(after.finished_today, 1, 'the run still counts as finished');
    assert.ok(after.avg_cycle_sample >= 1, 'and it still has a duration');
  });

  it('names the window every measured number was taken over', async () => {
    const snap = await get(A.token, '/api/floor/snapshot');
    assert.equal(snap.avg_cycle_window, 'today', 'the floor snapshot is today, and says so');
    assert.equal(snap.pass_rate_window, 'today');

    // The screens that deliberately ask a WIDER question say which one, so the
    // difference between two tiles is a stated question rather than a suspected
    // bug. These windows are unchanged from before the consolidation.
    const plant = await get(A.token, '/api/analytics/plant-view');
    assert.equal(plant.kpis.avg_cycle_window, 'all');
    assert.equal(plant.kpis.pass_rate_window, '7d');
    const overview = await get(A.token, '/api/analytics/overview');
    assert.equal(overview.avg_cycle_window, 'all');
    assert.equal(overview.pass_rate_window, 'all');
    const drill = await get(A.token, `/api/analytics/department/${A.dept.id}`);
    assert.equal(drill.kpis.avg_cycle_window, 'all');
    assert.equal(drill.kpis.pass_rate_window, '7d');
    const listed = (await get(A.token, '/api/floor/departments')).departments[0];
    assert.equal(listed.avg_cycle_window, 'today');
    assert.equal(listed.pass_rate_window, 'today');
  });

  it('gives a measured pass rate its sample, and never confuses 0% with unmeasured', async () => {
    const snap = await get(A.token, '/api/floor/snapshot');
    assert.ok(snap.pass_rate_sample >= RUNS_NOW, `inspected runs are counted, got ${snap.pass_rate_sample}`);
    assert.equal(typeof snap.pass_rate, 'number');
    assert.strictEqual(snap.pass_rate_reason, null, 'a measured number carries no excuse');
    assert.equal(snap.pass_rate, 100, 'every inspected run today passed');
  });

  // ── 3. Five endpoints, one answer ──────────────────────────────────────────

  it('the floor, the department listing, the drill-down, the board and OEE agree', async () => {
    const dept = A.dept.id;
    const [snapshot, listing, drilldown, board, oee] = await Promise.all([
      get(A.token, `/api/floor/snapshot?department_id=${dept}`),
      get(A.token, '/api/floor/departments'),
      get(A.token, `/api/analytics/department/${dept}`),
      get(A.token, '/api/leaderboard/departments?period=today'),
      get(A.token, '/api/oee'),
    ]);

    const listed = listing.departments.find(d => d.department_id === dept);
    assert.ok(listed, 'the department is in the per-department listing');
    const ranked = board.departments.find(d => d.department_id === dept);
    assert.ok(ranked, 'the department is on the leaderboard');
    const stations = oee.filter(s => s.id === A.station.id);
    assert.equal(stations.length, 1, 'the department has exactly one station in this fixture');

    // Finished today: one number, five places.
    const finished = {
      'floor snapshot':      snapshot.finished_today,
      'floor departments':   listed.finished_today,
      'department drilldown': drilldown.kpis.finished_today,
      'leaderboard board':   ranked.finished_today,
      'OEE station tile':    stations[0].oee.completions_today,
    };
    assert.deepStrictEqual(finished, {
      'floor snapshot':      finishedTodayExpected,
      'floor departments':   finishedTodayExpected,
      'department drilldown': finishedTodayExpected,
      'leaderboard board':   finishedTodayExpected,
      'OEE station tile':    finishedTodayExpected,
    }, `five screens, one department, one instant: ${JSON.stringify(finished)}`);

    // The drill-down's legacy tile still shows what it always showed — today's
    // count — and now shows it from the same source.
    assert.strictEqual(drilldown.kpis.completed_today, finishedTodayExpected);

    // On track out of OPEN work orders: one pair, three places. The fixture has
    // one order on track, one behind and one already finished.
    const pair = s => ({ on_track: s.on_track, open_work_orders: s.open_work_orders });
    const expectedPair = { on_track: 1, open_work_orders: 2 };
    assert.deepStrictEqual(pair(snapshot), expectedPair);
    assert.deepStrictEqual(pair(listed), expectedPair);
    assert.deepStrictEqual(pair(drilldown.kpis), expectedPair);
    assert.deepStrictEqual(pair(ranked), expectedPair);
    assert.deepStrictEqual(
      [pair(snapshot), pair(listed), pair(drilldown.kpis), pair(ranked)],
      [expectedPair, expectedPair, expectedPair, expectedPair],
      'the same pair, or the department page and the Command Center are describing different plants',
    );

    // Every count that is a share names what it is a share OF.
    assert.equal(snapshot.on_track_basis, 'open_work_orders');
    assert.equal(drilldown.kpis.on_track_basis, 'open_work_orders');
    assert.equal(snapshot.behind, 1, 'the un-built order is behind schedule');
    assert.equal(snapshot.completed_work_orders, 1);
    assert.equal(snapshot.total_work_orders, 3);
    assert.equal(snapshot.on_track_pct, 50, 'one of the two open orders is on track');
  });

  it('agrees with the Command Center about the plant as a whole', async () => {
    const [snapshot, plant] = await Promise.all([
      get(A.token, '/api/floor/snapshot'),
      get(A.token, '/api/analytics/plant-view'),
    ]);
    assert.deepStrictEqual(
      { today: plant.kpis.total_completed_today, running: plant.kpis.active_now },
      { today: snapshot.finished_today, running: snapshot.running_now },
    );
    assert.deepStrictEqual(
      { on_track: plant.kpis.on_track, open: plant.kpis.open_work_orders },
      { on_track: snapshot.on_track, open: snapshot.open_work_orders },
    );
    assert.equal(plant.plant_date, snapshot.plant_date);
  });

  // ── 4. Another tenant's id empties the scope ───────────────────────────────

  it('a department from another company yields an empty scope and leaks no name', async () => {
    const r = await api('GET', `/api/floor/snapshot?department_id=${A.dept.id}`, { token: B.token });
    assert.equal(r.status, 200, `foreign scope should answer, emptily: ${JSON.stringify(r.json)}`);
    const snap = r.json;

    assert.strictEqual(snap.scope.valid, false, 'the server says the scope matched nothing it owns');
    assert.strictEqual(snap.scope.department_id, null, 'and does not echo the id back as if it were real');
    assert.strictEqual(snap.finished_today, 0);
    assert.strictEqual(snap.running_now, 0);
    assert.strictEqual(snap.total_work_orders, 0);
    assert.strictEqual(snap.avg_cycle_seconds, null);
    assert.strictEqual(snap.pass_rate, null);
    assert.ok(!JSON.stringify(snap).includes('Assembly'),
      'no name from the other tenant may appear anywhere in the answer');

    // Same for the per-department listing under a foreign site.
    const sitesA = await get(A.token, '/api/sites');
    const listing = await get(B.token, `/api/floor/departments?site_id=${sitesA[0].id}`);
    assert.deepStrictEqual(listing.departments, []);
    assert.strictEqual(listing.scope.valid, false);
    assert.ok(!JSON.stringify(listing).includes('Assembly'));
  });

  it('empties EVERY section of the Command Center for a foreign site, not just the tiles', async () => {
    // The half-empty page is the dangerous one: "0 completed today" printed
    // above a list of six completions reads as a real answer about a real
    // department. The KPI strip used to narrow through the resolved scope while
    // the charts and tables kept using the raw parameter.
    const sitesA = await get(A.token, '/api/sites');
    const plant = await get(B.token, `/api/analytics/plant-view?site_id=${sitesA[0].id}`);

    assert.strictEqual(plant.scope_valid, false, 'the server says the scope matched nothing it owns');
    assert.strictEqual(plant.kpis.total_completed_today, 0);
    assert.strictEqual(plant.kpis.active_now, 0);
    assert.strictEqual(plant.kpis.avg_cycle_seconds, null);
    assert.strictEqual(plant.kpis.pass_rate, null);
    assert.strictEqual(plant.kpis.work_orders_total, 0);
    assert.deepStrictEqual(plant.department_performance, []);
    assert.deepStrictEqual(plant.hourly_throughput, []);
    assert.deepStrictEqual(plant.active_alerts, []);
    assert.deepStrictEqual(plant.recent_completions, []);
    assert.deepStrictEqual(plant.work_order_summary,
      { on_track: 0, at_risk: 0, behind: 0, not_started: 0, completed: 0 });

    // A department listing under a foreign site empties too, rows and all.
    const list = await get(B.token, `/api/departments?site_id=${sitesA[0].id}`);
    assert.deepStrictEqual(list, []);
  });

  it('every department row carries the canonical fields, even with no snapshot', async () => {
    // A row that simply drops the fields makes the client branch on their
    // absence, and a client that branches eventually renders undefined as 0.
    const rows = await get(C.token, '/api/departments');
    assert.ok(rows.length >= 1);
    for (const row of rows) {
      for (const key of ['plant_date', 'finished_today', 'running_now', 'avg_cycle_seconds',
        'avg_cycle_sample', 'avg_cycle_reason', 'avg_cycle_window', 'pass_rate', 'pass_rate_sample',
        'pass_rate_window', 'on_track', 'open_work_orders', 'on_track_pct', 'on_track_basis']) {
        assert.ok(key in row, `department row is missing ${key}`);
      }
      assert.equal(typeof row.finished_today, 'number');
    }
    // A department created a moment ago answers with the same keys and honest
    // values rather than six queries' worth of zeroes.
    const created = await create(C.token, '/api/departments', { name: 'Brand New' });
    assert.strictEqual(created.finished_today, 0);
    assert.strictEqual(created.avg_cycle_seconds, null);
    assert.strictEqual(created.avg_cycle_sample, 0);
    assert.strictEqual(created.pass_rate, null);
    assert.strictEqual(created.on_track_pct, null);
    assert.equal(typeof created.on_track_reason, 'string');
  });

  it('a repeated query parameter is a bad request, never a 500', async () => {
    // ?site_id=1&site_id=2 arrives as an array. Bound straight into a statement
    // it is "Too many parameter values" — a crash any visitor can trigger from
    // the address bar.
    for (const path of [
      '/api/floor/snapshot?site_id=a&site_id=b',
      '/api/floor/snapshot?department_id=a&department_id=b',
      '/api/floor/snapshot?app_id=a&app_id=b&station_id=c&station_id=d',
      '/api/floor/departments?site_id=a&site_id=b',
    ]) {
      const r = await api('GET', path, { token: A.token });
      assert.ok(r.status < 500, `${path} → ${r.status} ${JSON.stringify(r.json)}`);
      assert.equal(r.status, 200, `${path} answers, emptily`);
      assert.strictEqual(r.json.scope ? r.json.scope.valid : r.json.scope_valid, false);
    }
  });

  it('a product type from another company narrows to nothing', async () => {
    const r = await api('GET', `/api/floor/snapshot?product_type_id=${A.dept.id}`, { token: A.token });
    assert.equal(r.status, 200);
    assert.strictEqual(r.json.scope.valid, false, 'an id that is not one of this company\'s product types');
    assert.strictEqual(r.json.finished_today, 0);
  });

  // ── 5. The floor is not an upsell ──────────────────────────────────────────

  it('answers on a free plan — the floor view is the product, not a feature', async () => {
    // Company B is on the free tier: OEE is refused, the floor is not.
    const gated = await api('GET', '/api/oee', { token: B.token });
    assert.equal(gated.status, 403, 'the fixture only means something if OEE is really gated');
    assert.equal(gated.json.code, 'PLAN_REQUIRED');

    const snapshot = await api('GET', '/api/floor/snapshot', { token: B.token });
    assert.equal(snapshot.status, 200, 'a free account can read its own floor');
    const listing = await api('GET', '/api/floor/departments', { token: B.token });
    assert.equal(listing.status, 200);
  });

  it('needs a session — the floor is not public', async () => {
    const r = await api('GET', '/api/floor/snapshot');
    assert.ok(r.status === 401 || r.status === 403, `unauthenticated read → ${r.status}`);
  });

  // ── 6. Department-less runs are a bucket, not a champion ───────────────────

  it('files department-less runs under "No department", last and unranked', async () => {
    const board = await get(C.token, '/api/leaderboard/departments?period=today');
    const names = board.departments.map(d => d.department_name);

    assert.ok(board.departments.length >= 2, `expected a real department and a bucket, got ${JSON.stringify(names)}`);
    assert.ok(!names.includes('Unassigned'), `"Unassigned" reads as a department nobody can find: ${names}`);

    const bucketIndex = board.departments.findIndex(d => d.department_id === null);
    assert.ok(bucketIndex > 0, `the bucket must not be first, it was at index ${bucketIndex} of ${names}`);
    assert.equal(bucketIndex, board.departments.length - 1, 'and it comes after the whole ranked list');

    const bucket = board.departments[bucketIndex];
    assert.equal(bucket.department_name, 'No department');
    assert.strictEqual(bucket.rank, null, 'a pile of runs is not ranked against places');
    assert.equal(bucket.completions, 3, 'it still reports what it holds');
    // It has more runs than the real department, which is exactly why sorting it
    // into the ranking put it at #1 and called it a department.
    assert.ok(bucket.completions > board.departments[0].completions);

    assert.equal(board.departments[0].department_name, 'Finishing');
    assert.strictEqual(board.departments[0].rank, 1);
    // The type the page renders allows null, and the page prints "Unranked"
    // rather than a bare '#'. Anything that is NOT null must be a real number.
    for (const row of board.departments) {
      assert.ok(row.rank === null || Number.isInteger(row.rank),
        `rank must be an integer or null, got ${JSON.stringify(row.rank)}`);
    }
    for (const row of board.departments.filter(d => d.department_id !== null)) {
      assert.equal(typeof row.rank, 'number', 'every real department is ranked');
    }
  });
});

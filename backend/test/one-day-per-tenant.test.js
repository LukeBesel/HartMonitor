'use strict';
// ─── One tenant, one day ──────────────────────────────────────────────────────
// An audit found four screens of the SAME department, read at the same instant,
// reporting four different numbers: the Command Center said 60 done today, the
// department page said 60, the department TV board bolted to the wall said 6,
// and the leaderboard's "Today" showed 7 qualifying runs. Three of those
// screens were right and one — the one everybody on the floor actually looks
// at — was still counting Greenwich's day, because sqdc.js compared
// `date(completed_at)` against a UTC date string and leaderboard.js opened its
// window at `datetime('now', 'start of day')`.
//
// A shared count is not a matter of each query being individually defensible.
// If the four disagree, at least three of them are lying to somebody, and no
// screen says which. So this file fixes one tenant, one instant, one set of
// runs, and demands one number from all four.
//
// It is built to bite at every hour of the day. The tenant's zone is chosen at
// runtime so that its calendar date differs from UTC's right now, and the runs
// are planted at an instant that one clock calls today and the other does not —
// so a screen still on UTC cannot agree with a screen on the plant clock by
// coincidence.
//
// Spawns a server on port 3308.

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Database = require('better-sqlite3');

const PORT = 3308; // unique per test file — a collision silently cancels a suite
const BASE = `http://localhost:${PORT}`;
// pid as well as the clock: two checkouts of this repo running the same suite
// in the same millisecond would otherwise share one database file.
const DB_PATH = path.join(os.tmpdir(), `mes-one-day-${process.pid}-${Date.now()}.db`);

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

/** The wall-clock date in `tz` at `at`, as 'YYYY-MM-DD'. */
function localDate(tz, at) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' })
      .formatToParts(at).map(x => [x.type, x.value]),
  );
  return `${p.year}-${p.month}-${p.day}`;
}

const toSqlite = d => d.toISOString().replace('T', ' ').slice(0, 19);

before(async () => { await startServer(); });
after(() => {
  if (server) server.kill('SIGTERM');
  for (const ext of ['', '-shm', '-wal']) {
    try { fs.unlinkSync(DB_PATH + ext); } catch { /* ignore */ }
  }
});

describe('every screen of one tenant reports the same day', () => {
  const CONTROL_RUNS = 3;   // finished moments ago — today on any clock
  const EDGE_RUNS = 2;      // planted where the two clocks disagree

  let token, deptId, appId, tz, expected, edgeIsPlantToday;

  before(async () => {
    const now = new Date();

    // A real zone whose calendar date differs from UTC's right now. One always
    // exists (offsets run from -12 to +14) but WHICH one depends on the hour,
    // so it is picked at runtime rather than hard-coded into a suite that would
    // then only be meaningful for part of the day.
    const candidates = [
      'Pacific/Kiritimati', 'Pacific/Auckland', 'Asia/Tokyo', 'Asia/Kolkata',
      'Europe/Berlin', 'America/New_York', 'America/Los_Angeles', 'Pacific/Honolulu',
    ];
    tz = candidates.find(z => localDate(z, now) !== localDate('UTC', now));
    assert.ok(tz, 'no candidate zone disagreed with UTC — the fixture is broken, not the code');

    // An instant in the past that ONE of the two clocks calls today and the
    // other does not. Walking back in quarter hours finds it whatever the hour;
    // which of the two directions is available depends on the sign of the
    // offset, and either one is enough to separate a plant-day screen from a
    // UTC one.
    const utcToday = localDate('UTC', now);
    const plantToday = localDate(tz, now);
    let edge = null;
    for (let minutes = 15; minutes <= 48 * 60 && !edge; minutes += 15) {
      const at = new Date(now.getTime() - minutes * 60000);
      const isPlantToday = localDate(tz, at) === plantToday;
      const isUtcToday = localDate('UTC', at) === utcToday;
      if (isPlantToday !== isUtcToday) { edge = at; edgeIsPlantToday = isPlantToday; }
    }
    assert.ok(edge, 'no past instant separated the plant day from the UTC day');

    // What the plant's own clock says the answer is. A screen still reading
    // Greenwich's day would land on the other number, which is the whole point.
    expected = CONTROL_RUNS + (edgeIsPlantToday ? EDGE_RUNS : 0);
    const utcAnswer = CONTROL_RUNS + (edgeIsPlantToday ? 0 : EDGE_RUNS);
    assert.notEqual(expected, utcAnswer, 'the fixture must be able to tell the two apart');

    // ── The tenant, in that zone ──────────────────────────────────────────────
    const signup = await api('POST', '/api/auth/signup', {
      body: {
        company_name: 'One Day Co', email: 'admin@oneday.test',
        password: 'SecretPass1', display_name: 'Admin', timezone: tz,
      },
    });
    assert.equal(signup.status, 201, `signup: ${JSON.stringify(signup.json)}`);
    token = signup.json.token;

    // Signup must store the zone it was handed rather than stamping every new
    // company US Eastern — otherwise a Berlin shop's day rolls over at 06:00
    // local and none of the counts below mean what they say.
    const settings = await api('GET', '/api/config', { token });
    assert.equal(settings.json.timezone, tz,
      'the company was created in the zone signup was told about');

    // ── One department, one station, one published app ────────────────────────
    const dept = await api('POST', '/api/departments', { token, body: { name: 'Assembly' } });
    assert.ok([200, 201].includes(dept.status), `department: ${JSON.stringify(dept.json)}`);
    deptId = dept.json.id;

    const station = await api('POST', '/api/stations', {
      token, body: { name: 'Bench 1', department_id: deptId },
    });
    assert.ok([200, 201].includes(station.status), `station: ${JSON.stringify(station.json)}`);

    const app = await api('POST', '/api/apps', { token, body: { name: 'Press Check' } });
    assert.ok([200, 201].includes(app.status), `app: ${JSON.stringify(app.json)}`);
    appId = app.json.id;
    // The leaderboard only counts runs of a PUBLISHED app.
    const published = await api('POST', `/api/apps/${app.json.id}/publish`, { token });
    assert.equal(published.status, 200, `publish: ${JSON.stringify(published.json)}`);

    /** A finished, inspected run on the department's station. Returns its id. */
    async function run(operator) {
      const started = await api('POST', '/api/completions', {
        token,
        body: { app_id: app.json.id, station_id: station.json.id, operator_name: operator },
      });
      assert.ok([200, 201].includes(started.status), `starting: ${JSON.stringify(started.json)}`);
      const done = await api('PUT', `/api/completions/${started.json.id}`, {
        token, body: { status: 'completed', data: { qc: 'Pass' } },
      });
      assert.equal(done.status, 200, `completing: ${JSON.stringify(done.json)}`);
      return started.json.id;
    }

    const controlIds = [];
    for (let i = 0; i < CONTROL_RUNS; i++) controlIds.push(await run(`Ada ${i}`));
    const edgeIds = [];
    for (let i = 0; i < EDGE_RUNS; i++) edgeIds.push(await run(`Ben ${i}`));

    // The API always stamps "now", so the timestamps that matter go in directly.
    // Every run gets a five-minute cycle so the leaderboard has a duration to
    // rank, and the control runs are pinned too rather than left drifting with
    // the clock while the suite runs.
    const raw = new Database(DB_PATH);
    const stamp = raw.prepare('UPDATE completions SET started_at = ?, completed_at = ? WHERE id = ?');
    const control = new Date(now.getTime() - 60000);
    for (const id of controlIds) {
      stamp.run(toSqlite(new Date(control.getTime() - 5 * 60000)), toSqlite(control), id);
    }
    for (const id of edgeIds) {
      stamp.run(toSqlite(new Date(edge.getTime() - 5 * 60000)), toSqlite(edge), id);
    }
    raw.close();
  });

  it('the four screens agree, and agree with the plant clock', async () => {
    const [plant, department, tv, board] = await Promise.all([
      api('GET', '/api/analytics/plant-view', { token }),
      api('GET', `/api/analytics/department/${deptId}`, { token }),
      api('GET', `/api/sqdc/department/${deptId}`, { token }),
      api('GET', '/api/leaderboard/departments?period=today', { token }),
    ]);

    for (const [name, r] of [['plant-view', plant], ['department', department], ['TV board', tv], ['leaderboard', board]]) {
      assert.equal(r.status, 200, `${name}: ${JSON.stringify(r.json)}`);
    }

    const readings = {
      'Command Center':    plant.json.kpis.total_completed_today,
      'department page':   department.json.kpis.completed_today,
      'department TV':     tv.json.status.completed_today,
      'leaderboard Today': board.json.departments.find(d => d.department_id === deptId)?.completions ?? 0,
    };

    const detail =
      `${tz} says it is ${localDate(tz, new Date())}, UTC says ${localDate('UTC', new Date())}; ` +
      `${EDGE_RUNS} runs sit on the ${edgeIsPlantToday ? 'plant' : 'UTC'} side of the boundary. ` +
      `readings: ${JSON.stringify(readings)}`;

    const distinct = new Set(Object.values(readings));
    assert.equal(distinct.size, 1, `four screens, one tenant, one instant — ${detail}`);

    for (const [screen, value] of Object.entries(readings)) {
      assert.equal(value, expected, `${screen} counts the plant's day — ${detail}`);
    }
  });

  it('the TV board defaults to the plant\'s date, not Greenwich\'s', async () => {
    // The board on the wall is opened with no ?date= at all, so its default is
    // the thing a whole shift reads. If that default is the UTC date the board
    // shows a blank (or yesterday's) day for hours at a time.
    const tv = await api('GET', `/api/sqdc/department/${deptId}`, { token });
    assert.equal(tv.status, 200);
    assert.equal(tv.json.date, localDate(tz, new Date()),
      'the board opens on the day the plant is having');
  });

  it('the leaderboard binds its parameters in every window and drill-down', async () => {
    // The day filter is now a bound parameter rather than a literal, and each
    // window carries a different number of placeholders. A mismatch is not a
    // wrong number, it is a 500 — so every shape the page can ask for is walked
    // here rather than only the one the assertion above happens to use.
    for (const period of ['today', 'week', 'month', 'all']) {
      for (const query of [
        `/api/leaderboard/departments?period=${period}`,
        `/api/leaderboard?period=${period}`,
        `/api/leaderboard?period=${period}&department_id=${deptId}`,
        `/api/leaderboard?period=${period}&app_id=${appId}`,
        `/api/leaderboard?period=${period}&department_id=${deptId}&app_id=${appId}`,
      ]) {
        const r = await api('GET', query, { token });
        assert.equal(r.status, 200, `${query}: ${JSON.stringify(r.json)}`);
      }
    }

    // And the drill-down agrees with the board it was opened from.
    const drill = await api('GET', `/api/leaderboard?period=today&department_id=${deptId}`, { token });
    const qualifying = drill.json.boards.reduce((n, b) => n + b.qualifying_count, 0);
    assert.equal(qualifying, expected,
      'drilling into the department shows the same day as the board above it');
  });

  it('the SQDC board itself counts the same runs', async () => {
    // Same data, the company-wide board rather than the per-department one:
    // cost.units_produced is the count of runs finished on the day.
    const sqdc = await api('GET', `/api/sqdc?department_id=${deptId}`, { token });
    assert.equal(sqdc.status, 200);
    assert.equal(sqdc.json.date, localDate(tz, new Date()));
    assert.equal(sqdc.json.cost.units_produced, expected,
      'the SQDC board measures the plant\'s day too');
  });
});

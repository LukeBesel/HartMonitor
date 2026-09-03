'use strict';
// ─── The department TV reports takt in SECONDS ────────────────────────────────
// GET /api/sqdc/department/:id feeds the wall board's behind-takt banner. It
// used to hand the board a tenth of a MINUTE — `Math.round(takt * 10) / 10`,
// same for the overrun — so the board could only ever render a number that had
// already been rounded once, in six-second steps.
//
// The takt this route reads is the WORK ORDER's (`work_orders.takt_time_minutes`),
// not an app step's, and the demo seeds it at 365 seconds — 6.0833 min, which
// left here as 6.1 and put a "6m 6s" takt on the wall for a job whose takt is
// 6m 5s. Overruns had the same grid under them: a job 63 s past its takt was
// reported as 1.1 min and read out as "1m 6s".
//
// Seconds are the unit the rest of the system carries (src/cycleTime.js), and
// the unit the board's own formatter takes, so seconds are what this route
// sends — and the minutes fields are gone rather than kept beside them, because
// two units for one measurement is how they drift apart.
//
// Uses Node built-ins only (node:test + global fetch).
// Run with: node --test test/department-tv-takt.test.js

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Database = require('better-sqlite3');

const PORT = 3418; // reserved for this workstream in MIGRATIONS.md — a shared port silently cancels a suite
const BASE = `http://localhost:${PORT}`;
const DB_PATH = path.join(os.tmpdir(), `mes-tv-takt-${Date.now()}.db`);

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

/** A Date as SQLite stores it — the same shape the server writes. */
const toSqlite = d => d.toISOString().replace('T', ' ').slice(0, 19);

before(async () => { await startServer(); });
after(() => {
  if (server) server.kill('SIGTERM');
  for (const ext of ['', '-shm', '-wal']) {
    try { fs.unlinkSync(DB_PATH + ext); } catch { /* ignore */ }
  }
});

describe('department TV behind-takt', () => {
  const T = {};

  before(async () => {
    const signup = await api('POST', '/api/auth/signup', {
      body: { company_name: 'Takt Co', email: 'admin@taktco.test', password: 'SecretPass1', display_name: 'Admin' },
    });
    assert.equal(signup.status, 201);
    T.token = signup.json.token;

    T.dept = await create(T.token, '/api/departments', { name: 'Assembly' });
    T.app  = await create(T.token, '/api/apps', { name: 'Assemble', status: 'published' });
    T.st   = await create(T.token, '/api/stations', { name: 'Cell 1', department_id: T.dept.id });

    // The takt the demo actually seeds on a work order: 365 seconds, stored the
    // way work orders store takt — in minutes, 6.0833 of them. That is the value
    // that used to round to 6.1 and reach the wall board as a "6m 6s" takt.
    T.demo = await create(T.token, '/api/work-orders', {
      part_number: 'D-1', part_name: 'Demo Part', quantity: 10,
      app_id: T.app.id, department_id: T.dept.id, takt_time_minutes: 365 / 60,
    });
    // A synthetic boundary, not a value the product can reach: the work-order
    // takt input is capped at 0.1 min. It pins the low end of the conversion —
    // a takt below the old rounding step must survive as itself.
    T.fast = await create(T.token, '/api/work-orders', {
      part_number: 'F-1', part_name: 'Fast Part', quantity: 10,
      app_id: T.app.id, department_id: T.dept.id, takt_time_minutes: 5 / 60,
    });
    // A second job, far further behind, so the banner's order can be checked.
    T.slow = await create(T.token, '/api/work-orders', {
      part_number: 'S-1', part_name: 'Slow Part', quantity: 10,
      app_id: T.app.id, department_id: T.dept.id, takt_time_minutes: 1,
    });

    // One run per work order, both left in progress and both started well
    // before now, so both are over their takt by a knowable amount. `started_at`
    // is not something the API lets a client set — a run starts when it starts —
    // so the clock is moved in the file, the way one-day-per-tenant does it.
    const started = [];
    for (const [wo, operator, secondsAgo] of [[T.demo, 'Dee', 428], [T.fast, 'Ana', 65], [T.slow, 'Bo', 600]]) {
      const c = await create(T.token, '/api/completions', {
        app_id: T.app.id, station_id: T.st.id, work_order_id: wo.id, operator_name: operator,
      });
      started.push([c.id, secondsAgo]);
    }
    // And one FINISHED run on the same 365-second takt, whose two stamps are set
    // 428 seconds apart. A finished run's overrun is arithmetic on two recorded
    // times rather than a reading off the wall clock, so this one is exact: 63
    // seconds over, which the old tenth-of-a-minute field could only carry as
    // 1.1 min — "1m 6s" on the board.
    const finished = await create(T.token, '/api/completions', {
      app_id: T.app.id, station_id: T.st.id, work_order_id: T.demo.id, operator_name: 'Cal',
    });
    const done = await api('PUT', `/api/completions/${finished.id}`, {
      token: T.token, body: { status: 'completed', data: {} },
    });
    assert.equal(done.status, 200, `completing run failed: ${JSON.stringify(done.json)}`);

    const raw = new Database(DB_PATH);
    const stamp = raw.prepare('UPDATE completions SET started_at = ? WHERE id = ?');
    for (const [id, secondsAgo] of started) {
      stamp.run(toSqlite(new Date(Date.now() - secondsAgo * 1000)), id);
    }
    const endedAt = new Date(Date.now() - 30 * 1000);
    raw.prepare('UPDATE completions SET started_at = ?, completed_at = ? WHERE id = ?')
      .run(toSqlite(new Date(endedAt.getTime() - 428 * 1000)), toSqlite(endedAt), finished.id);
    raw.close();
  });

  const board = async () => {
    const r = await api('GET', `/api/sqdc/department/${T.dept.id}`, { token: T.token });
    assert.equal(r.status, 200, `GET board → ${r.status} ${JSON.stringify(r.json)}`);
    return r.json;
  };

  it("sends the demo work order's 365-second takt as 365, not as 6.1 minutes", async () => {
    const rows = (await board()).behind_takt;
    const demo = rows.find(r => r.operator_name === 'Dee');
    assert.ok(demo, `the demo job is behind its takt — got ${JSON.stringify(rows)}`);
    assert.equal(demo.takt_seconds, 365,
      'the takt the demo seeds reaches the board as 365s; pre-rounded to a tenth of a minute it was 6.1, which the board reads out as "6m 6s"');
    assert.notEqual(demo.takt_seconds, 366, 'a takt nobody measured must not reach the wall');
    // ~63s past a 365s takt. Bounded rather than exact: the overrun is measured
    // against the wall clock at the moment of the request. The point of the
    // window is that it is finer than the six seconds the old field could carry.
    assert.ok(demo.over_by_seconds > 58 && demo.over_by_seconds < 68,
      `over_by_seconds should be about 63 — got ${demo.over_by_seconds}`);
  });

  it('reports an overrun to the second, not on a six-second grid', async () => {
    // The finished run: 428 s of recorded elapsed time against a 365 s takt, so
    // the overrun is exactly 63 s with no clock left to read. The old field held
    // tenths of a minute, so 63 s could only be 1.1 min — and the board read
    // that out as "1m 6s", three seconds of overrun nobody measured.
    const rows = (await board()).behind_takt;
    const done = rows.find(r => r.operator_name === 'Cal');
    assert.ok(done, `the finished run is over its takt — got ${JSON.stringify(rows)}`);
    assert.equal(done.takt_seconds, 365);
    assert.equal(done.over_by_seconds, 63,
      'a finished run\'s overrun is arithmetic, not an estimate: 428s of work against a 365s takt');
  });

  it('carries a takt finer than the old rounding step, too', async () => {
    // A synthetic boundary: 5s is below the 0.1-minute step the field used to
    // round to, so it used to arrive as 0.1 whatever it really was. No work
    // order in the product can hold it — the takt input is capped at 0.1 min —
    // but the conversion must not have a floor of its own.
    const rows = (await board()).behind_takt;
    const fast = rows.find(r => r.operator_name === 'Ana');
    assert.ok(fast, `the fast job is behind its takt — got ${JSON.stringify(rows)}`);
    assert.equal(fast.takt_seconds, 5, 'a 5-second takt reaches the board as 5 seconds, not as 0.1 of anything');
    assert.ok(fast.over_by_seconds > 55 && fast.over_by_seconds < 75,
      `over_by_seconds should be about 60 — got ${fast.over_by_seconds}`);
  });

  it('carries one unit, not two — the pre-rounded minutes fields are gone', async () => {
    for (const row of (await board()).behind_takt) {
      assert.ok(!('takt_minutes' in row),
        'a second unit for the same measurement is how the two drift apart');
      assert.ok(!('over_by_minutes' in row), 'same for the overrun');
      assert.equal(typeof row.takt_seconds, 'number');
      assert.equal(typeof row.over_by_seconds, 'number');
    }
  });

  it('still orders the banner by how far behind, worst first', async () => {
    const rows = (await board()).behind_takt;
    assert.ok(rows.length >= 4, `all four runs are behind — got ${JSON.stringify(rows)}`);
    assert.equal(rows[0].operator_name, 'Bo', 'the job furthest behind leads the banner');
    for (let i = 1; i < rows.length; i++) {
      assert.ok(rows[i - 1].over_by_seconds >= rows[i].over_by_seconds,
        `behind_takt must descend by seconds — got ${rows.map(r => r.over_by_seconds).join(', ')}`);
    }
  });
});

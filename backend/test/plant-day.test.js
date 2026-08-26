'use strict';
// ─── "Today" means the plant's today, not Greenwich's ─────────────────────────
// SQLite's date('now') is UTC, so every "completed today" tile and every OEE
// counter rolled over at midnight UTC — 8pm in Detroit, 7pm in Chicago, 5pm in
// California. A plant running second shift watched its numbers reset to zero in
// the middle of the shift, and the morning crew read a figure that still had
// the back half of yesterday evening folded into it.
//
// The boundary now shifts by the company's own configured timezone, applied to
// both sides of the comparison. This file pins it by planting a run at a time
// that falls on DIFFERENT calendar days in two zones, and checking each company
// counts it the way its own clock would.
//
// Spawns a server on port 3258.

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Database = require('better-sqlite3');

const PORT = 3258; // unique per test file — a collision silently cancels a suite
const BASE = `http://localhost:${PORT}`;
const DB_PATH = path.join(os.tmpdir(), `mes-plant-day-${Date.now()}.db`);

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

before(async () => { await startServer(); });
after(() => {
  if (server) server.kill('SIGTERM');
  for (const ext of ['', '-shm', '-wal']) {
    try { fs.unlinkSync(DB_PATH + ext); } catch { /* ignore */ }
  }
});

describe('the day rolls over on the plant clock', () => {
  const HERE = {};   // a company whose clock says the run happened today
  const AWAY = {};   // a company whose clock says the same run was yesterday

  // The zone whose local calendar the "today" company runs on. Detroit is a
  // real customer's clock and sits behind UTC, which is where the bug bit.
  const HERE_TZ = 'America/Detroit';

  /** The wall-clock date in `tz` at `at`, as 'YYYY-MM-DD'. */
  function localDate(tz, at) {
    const p = Object.fromEntries(
      new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' })
        .formatToParts(at).map(x => [x.type, x.value]),
    );
    return `${p.year}-${p.month}-${p.day}`;
  }

  /** How far `tz` is ahead of UTC at `at`, in minutes. */
  function offset(tz, at) {
    const p = Object.fromEntries(
      new Intl.DateTimeFormat('en-US', {
        timeZone: tz, hour12: false,
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit',
      }).formatToParts(at).map(x => [x.type, x.value]),
    );
    const asUTC = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute, +p.second);
    return Math.round((asUTC - at.getTime()) / 60000);
  }

  /**
   * A UTC instant that is half past midnight TODAY on `tz`'s wall clock — so it
   * is unambiguously "today" there whatever time this suite happens to run.
   */
  function halfPastLocalMidnight(tz) {
    const now = new Date();
    const [y, m, d] = localDate(tz, now).split('-').map(Number);
    // Two passes: the offset at midnight can differ from the offset now on a
    // daylight-saving changeover day.
    let guess = new Date(Date.UTC(y, m - 1, d, 0, 30) - offset(tz, now) * 60000);
    guess = new Date(Date.UTC(y, m - 1, d, 0, 30) - offset(tz, guess) * 60000);
    return guess;
  }

  const toSqlite = date => date.toISOString().replace('T', ' ').slice(0, 19);

  before(async () => {
    const stampDate = halfPastLocalMidnight(HERE_TZ);
    const stamp = toSqlite(stampDate);
    const now = new Date();

    // Find a real zone that calls that same instant a DIFFERENT day than it
    // calls right now — i.e. a plant for which this run belongs to another
    // shift. Chosen at runtime so the test holds at every hour and both sides
    // of a daylight-saving change.
    const candidates = [
      'Pacific/Kiritimati', 'Pacific/Auckland', 'Asia/Tokyo', 'Asia/Kolkata',
      'Europe/Berlin', 'UTC', 'America/Los_Angeles', 'Pacific/Honolulu',
    ];
    const awayTz = candidates.find(tz => localDate(tz, stampDate) !== localDate(tz, now));
    assert.ok(awayTz, 'no candidate zone disagreed — the fixture is broken, not the code');
    AWAY.tz = awayTz;

    assert.equal(
      localDate(HERE_TZ, stampDate), localDate(HERE_TZ, now),
      'the fixture must be today on the "here" clock',
    );

    for (const [co, tz, email] of [
      [HERE, HERE_TZ, 'admin@here.test'],
      [AWAY, awayTz, 'admin@away.test'],
    ]) {
      const signup = await api('POST', '/api/auth/signup', {
        body: { company_name: `Plant ${tz}`, email, password: 'SecretPass1', display_name: 'Admin' },
      });
      assert.equal(signup.status, 201, `signup ${tz}: ${JSON.stringify(signup.json)}`);
      co.token = signup.json.token;

      const saved = await api('PUT', '/api/config', { token: co.token, body: { timezone: tz } });
      assert.equal(saved.status, 200, `saving timezone: ${JSON.stringify(saved.json)}`);
      assert.equal(saved.json.timezone, tz);

      const app = await api('POST', '/api/apps', { token: co.token, body: { name: 'Press Check' } });
      const c = await api('POST', '/api/completions', {
        token: co.token, body: { app_id: app.json.id, operator_name: 'Sam' },
      });
      const done = await api('PUT', `/api/completions/${c.json.id}`, {
        token: co.token, body: { status: 'completed', data: { qc: 'Pass' } },
      });
      assert.equal(done.status, 200, `completing: ${JSON.stringify(done.json)}`);
      co.runId = c.json.id;
    }

    // Both runs land on the SAME UTC instant. The only difference between the
    // two companies is the timezone each has configured — which is the whole
    // point. The API always stamps "now", so this goes in directly.
    const raw = new Database(DB_PATH);
    raw.prepare('UPDATE completions SET completed_at = ?, started_at = ? WHERE id IN (?, ?)')
      .run(stamp, stamp, HERE.runId, AWAY.runId);
    raw.close();
  });

  it('counts the run for the plant whose clock says it happened today', async () => {
    const overview = await api('GET', '/api/analytics/overview', { token: HERE.token });
    assert.equal(overview.status, 200);
    assert.equal(overview.json.todayCompletions, 1,
      `half past midnight ${HERE_TZ} time is today there`);
  });

  it('does not count the same instant for a plant whose clock says it was another day', async () => {
    const overview = await api('GET', '/api/analytics/overview', { token: AWAY.token });
    assert.equal(overview.status, 200);
    assert.equal(overview.json.todayCompletions, 0,
      `${AWAY.tz} calls that instant a different day, so it belongs to another shift there`);
  });

  it('gives the Command Center the same answer as the overview', async () => {
    // The two screens run different queries. If only one carried the shift they
    // would disagree about the same run, which is worse than both being wrong
    // in the same direction.
    const here = await api('GET', '/api/analytics/plant-view', { token: HERE.token });
    const away = await api('GET', '/api/analytics/plant-view', { token: AWAY.token });
    assert.equal(here.status, 200);
    assert.equal(away.status, 200);
    assert.equal(here.json.kpis.total_completed_today, 1);
    assert.equal(away.json.kpis.total_completed_today, 0);
  });

  it('and the daily brief too', async () => {
    const here = await api('GET', '/api/analytics/daily-brief', { token: HERE.token });
    const away = await api('GET', '/api/analytics/daily-brief', { token: AWAY.token });
    assert.equal(here.json.kpis.completed_today, 1);
    assert.equal(away.json.kpis.completed_today, 0);
  });

  it('falls back to UTC for a company that has never set a timezone', async () => {
    // The old behaviour, unchanged: this can never be worse than what it
    // replaces for someone who has not told us where they are.
    const signup = await api('POST', '/api/auth/signup', {
      body: { company_name: 'Nowhere Co', email: 'admin@nowhere.test', password: 'SecretPass1', display_name: 'Admin' },
    });
    assert.equal(signup.status, 201);
    const token = signup.json.token;

    const app = await api('POST', '/api/apps', { token, body: { name: 'Check' } });
    const c = await api('POST', '/api/completions', { token, body: { app_id: app.json.id, operator_name: 'Sam' } });
    await api('PUT', `/api/completions/${c.json.id}`, { token, body: { status: 'completed', data: {} } });

    // Noon UTC today — today by the UTC calendar at every hour this could run.
    const now = new Date();
    const noonUtc = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 12, 0, 0));
    const raw = new Database(DB_PATH);
    raw.prepare('UPDATE completions SET completed_at = ?, started_at = ? WHERE id = ?')
      .run(toSqlite(noonUtc), toSqlite(noonUtc), c.json.id);
    raw.close();

    const overview = await api('GET', '/api/analytics/overview', { token });
    assert.equal(overview.json.todayCompletions, 1, 'noon UTC is today in UTC');
  });
});

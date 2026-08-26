'use strict';
// ─── OEE measures the day so far, not the whole shift ─────────────────────────
// Performance divided today's output by the WHOLE planned day, so a station
// running perfectly at ten in the morning reported roughly 25%. The number only
// became meaningful once the shift was over, which is the one time nobody is
// looking at it — every morning reading was wrong in the same structural way
// that made the public demo read 1% OEE.
//
// The window now opens at the first thing that actually happened on the station
// today (a machine event or a run being started), because a shift start time is
// not something every company has told us. This file pins the three things that
// must hold: the denominator is the day so far, it can never exceed the planned
// shift, and a station that has done nothing today is UNMEASURED rather than 0%
// available — 0% reads as "down all day" when the truth is "not started yet".
//
// Runs with EARLY_ACCESS=true because OEE is a pro feature and this suite is
// about the arithmetic, not the plan gate.
//
// Uses Node built-ins only (node:test + global fetch). Run with: npm test

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const PORT = 3257; // unique per test file — a collision silently cancels a suite
const BASE = `http://localhost:${PORT}`;
const DB_PATH = path.join(os.tmpdir(), `mes-oee-window-${Date.now()}.db`);

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
        EARLY_ACCESS: 'true',   // OEE is a pro feature; this suite is about the maths
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

describe('OEE measures the day so far', () => {
  let token, station, idleStation, app;

  before(async () => {
    const signup = await api('POST', '/api/auth/signup', {
      body: { company_name: 'Elapsed Co', email: 'admin@elapsed.test', password: 'SecretPass1', display_name: 'Admin' },
    });
    assert.equal(signup.status, 201, `signup: ${JSON.stringify(signup.json)}`);
    token = signup.json.token;

    const created = await api('POST', '/api/apps', { token, body: { name: 'Press' } });
    app = created.json.id;

    // A one-minute ideal cycle on an eight-hour shift.
    const st = await api('POST', '/api/stations', { token, body: { name: 'Press 1' } });
    assert.ok([200, 201].includes(st.status), `station: ${JSON.stringify(st.json)}`);
    station = st.json.id;
    // Ideal cycle and planned hours live behind the OEE settings route, not the
    // stations route — PUT /api/stations ignores both without complaining.
    const cfg = await api('PUT', `/api/oee/${station}/settings`, {
      token, body: { ideal_cycle_seconds: 60, planned_hours_per_day: 8 },
    });
    assert.equal(cfg.status, 200, `configuring station: ${JSON.stringify(cfg.json)}`);
    assert.equal(cfg.json.ideal_cycle_seconds, 60, 'the ideal cycle must actually be stored');

    const idle = await api('POST', '/api/stations', { token, body: { name: 'Press 2' } });
    idleStation = idle.json.id;
    await api('PUT', `/api/oee/${idleStation}/settings`, {
      token, body: { ideal_cycle_seconds: 60, planned_hours_per_day: 8 },
    });

    // Open the day on Press 1, then finish two inspected runs against it.
    const evt = await api('POST', `/api/oee/${station}/event`, { token, body: { event_type: 'running' } });
    assert.equal(evt.status, 200, `machine event: ${JSON.stringify(evt.json)}`);
    for (const verdict of ['Pass', 'Pass']) {
      const c = await api('POST', '/api/completions', { token, body: { app_id: app, station_id: station, operator_name: 'Ada' } });
      const done = await api('PUT', `/api/completions/${c.json.id}`, {
        token, body: { status: 'completed', data: { qc: verdict } },
      });
      assert.equal(done.status, 200, `completing run: ${JSON.stringify(done.json)}`);
    }
  });

  it('divides by the minutes elapsed today, not the eight-hour shift', async () => {
    const list = await api('GET', '/api/oee', { token });
    assert.equal(list.status, 200, JSON.stringify(list.json));
    const press = list.json.find(s => s.id === station);
    assert.ok(press, 'Press 1 missing from the OEE list');

    // The window opened seconds ago, and it is floored at one minute — so the
    // denominator is minutes, not the 480 of a full shift.
    assert.ok(
      press.oee.planned_minutes <= 5,
      `planned window should be the day so far, got ${press.oee.planned_minutes} minutes`,
    );
    assert.equal(press.oee.planned_day_minutes, 480, 'the full shift is still reported alongside it');

    // Two one-minute runs inside a ~one-minute window is a station keeping up,
    // so Performance must read high. Against the whole shift it was 2/480 = 0%.
    assert.ok(
      press.oee.performance >= 50,
      `a station keeping pace should not read ${press.oee.performance}% performance`,
    );
    assert.equal(press.oee.quality, 100, 'both runs passed inspection');
    assert.ok(press.oee.measurable, `OEE should be measurable: missing ${JSON.stringify(press.oee.missing)}`);
  });

  it('never reports more than the full shift, however long a station is left running', async () => {
    const list = await api('GET', '/api/oee', { token });
    const press = list.json.find(s => s.id === station);
    assert.ok(
      press.oee.planned_minutes <= press.oee.planned_day_minutes,
      'the elapsed window must be capped at the planned day',
    );
  });

  it('says a station with no activity today is unmeasured, not 0% available', async () => {
    // 0% availability reads as "this machine was down all day". The truth is
    // that its day has not started.
    const list = await api('GET', '/api/oee', { token });
    const idle = list.json.find(s => s.id === idleStation);
    assert.ok(idle, 'Press 2 missing from the OEE list');
    assert.equal(idle.oee.availability, null, `expected unmeasured availability, got ${idle.oee.availability}`);
    assert.equal(idle.oee.oee, null, 'OEE cannot be stated without availability');
    assert.equal(idle.oee.measurable, false);
    assert.ok(
      idle.oee.missing.includes('any activity today'),
      `the screen should say what is missing, got ${JSON.stringify(idle.oee.missing)}`,
    );
  });
});

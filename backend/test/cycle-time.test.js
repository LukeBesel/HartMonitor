'use strict';
// ─── One definition of how long a run took ────────────────────────────────────
// The launch audit found the same run reporting 6m 21s on App History and
// 6m 42s on the Command Center, with nothing on either screen to say why; four
// screens printing a fabricated "0s" for an app whose runs were all sub-second;
// the Command Center deriving its seconds from a tenth-of-a-minute it had
// already rounded (eight runs measuring 3.20-3.56 s all printed "6s"); and a
// table headed RECENT COMPLETIONS listing an unfinished job with 27m 48s in its
// Duration column.
//
// backend/src/cycleTime.js is now the only place that decides how long a run
// took. This file holds the whole chain to that one definition:
//   • one run reads the SAME seconds on every endpoint that reports it,
//   • both measurements ship, each labelled, so the gap between hands-on time
//     and wall clock is a fact on screen rather than a contradiction,
//   • unknown is null — never 0 — and never drags an average toward zero,
//   • sub-second runs survive: they are measurements, not missing data,
//   • an unfinished run has no duration at all, only an elapsed-so-far.
//
// Uses Node built-ins only (node:test + global fetch). Run with: npm test

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const cycleTime = require('../src/cycleTime');

const PORT = 3306; // unique per test file — a collision silently cancels a suite
const BASE = `http://localhost:${PORT}`;
const DB_PATH = path.join(os.tmpdir(), `mes-cycle-time-${Date.now()}.db`);

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

before(async () => { await startServer(); });
after(() => {
  if (server) server.kill('SIGTERM');
  for (const ext of ['', '-shm', '-wal']) {
    try { fs.unlinkSync(DB_PATH + ext); } catch { /* ignore */ }
  }
});

// ─── The module itself ────────────────────────────────────────────────────────

describe('the cycle-time model', () => {
  it('rounds once, and never rounds a real measurement away to nothing', () => {
    assert.strictEqual(cycleTime.roundSeconds(3.2049), 3.2, 'a tenth of a second above 1s');
    assert.strictEqual(cycleTime.roundSeconds(381), 381);
    assert.strictEqual(cycleTime.roundSeconds(0.44), 0.44, 'milliseconds below 1s — the clock\'s real resolution');
    assert.strictEqual(cycleTime.roundSeconds(0.0204), 0.02,
      'rounding is the last place a zero can be invented; 0.02 s is not "no time at all"');
    assert.strictEqual(cycleTime.roundSeconds(0.0001), null,
      'finer than the clock that produced it ⇒ unknown, never a zero');
    // The Command Center's old two-stage rounding: 3.2 s → 0.1 min → 6 s.
    // Whatever this module returns for 3.2 s, it is not six.
    assert.notStrictEqual(cycleTime.roundSeconds(3.2), 6);
  });

  it('says unknown rather than zero', () => {
    assert.strictEqual(cycleTime.roundSeconds(null), null);
    assert.strictEqual(cycleTime.roundSeconds(undefined), null);
    assert.strictEqual(cycleTime.roundSeconds(NaN), null);
    assert.strictEqual(cycleTime.handsOnSecondsOf('{}'), null, 'no step timers ⇒ not timed');
    assert.strictEqual(cycleTime.handsOnSecondsOf('not json'), null, 'a malformed blob is not a zero');
    assert.strictEqual(cycleTime.handsOnSecondsOf({ 0: 0, 1: 0 }), null, 'timers that add to nothing were never run');
    assert.strictEqual(
      cycleTime.elapsedSecondsOf('2026-08-26 01:45:25', '2026-08-26 01:45:25'), null,
      'you cannot start and finish a unit in the same instant — that is a missing measurement',
    );
    assert.strictEqual(cycleTime.elapsedSecondsOf('2026-08-26 01:45:25', null), null);
  });

  it('reads the timestamps the server wrote as UTC, not as local time', () => {
    // SQLite hands back "YYYY-MM-DD HH:MM:SS" with no zone. Read as local time,
    // a run west of Greenwich appears to take hours or to finish before it started.
    assert.strictEqual(
      cycleTime.elapsedSecondsOf('2026-08-26 01:45:25', '2026-08-26 01:51:14'), 349,
    );
  });

  it('names the measurement behind the canonical duration', () => {
    const withTimers = cycleTime.runDurations({
      step_times: '{"0":55,"1":218,"2":108}',
      started_at: '2026-08-26 01:45:25', completed_at: '2026-08-26 01:51:14',
    });
    assert.strictEqual(withTimers.hands_on_seconds, 381);
    assert.strictEqual(withTimers.elapsed_seconds, 349);
    assert.strictEqual(withTimers.duration_seconds, 381, 'hands-on wins when the run has it');
    assert.strictEqual(withTimers.duration_basis, 'hands_on');

    const noTimers = cycleTime.runDurations({
      step_times: '{}',
      started_at: '2026-08-26 01:45:25', completed_at: '2026-08-26 01:51:14',
    });
    assert.strictEqual(noTimers.duration_seconds, 349, 'wall clock is the fallback, not a zero');
    assert.strictEqual(noTimers.duration_basis, 'elapsed');

    const neither = cycleTime.runDurations({ step_times: '{}', started_at: '2026-08-26 01:45:25', completed_at: null });
    assert.strictEqual(neither.duration_seconds, null, 'a run still open has no duration');
    assert.strictEqual(neither.duration_basis, null);
  });

  it('distinguishes a step with no takt from a takt of zero', () => {
    assert.strictEqual(cycleTime.stepTaktSeconds({ takt_time: 240 }), 240, 'legacy v1 blob');
    assert.strictEqual(cycleTime.stepTaktSeconds({ takt_time_seconds: 120 }), 120, 'v2 blob');
    assert.strictEqual(cycleTime.stepTaktSeconds({}), null, 'no takt was ever configured');
    assert.strictEqual(cycleTime.stepTaktSeconds({ takt_time: 0 }), null);
  });
});

// ─── The chain: one run, every endpoint ───────────────────────────────────────

describe('one run reads the same on every screen', () => {
  let token, appId, runId, subSecondApp, openRunId;

  before(async () => {
    const signup = await api('POST', '/api/auth/signup', {
      body: { company_name: 'Cycle Co', email: 'admin@cycle.test', password: 'SecretPass1', display_name: 'Admin' },
    });
    assert.equal(signup.status, 201, `signup: ${JSON.stringify(signup.json)}`);
    token = signup.json.token;

    const makeApp = async (name, steps) => {
      const created = await api('POST', '/api/apps', { token, body: { name } });
      assert.ok([200, 201].includes(created.status), `create ${name}: ${JSON.stringify(created.json)}`);
      const saved = await api('PUT', `/api/apps/${created.json.id}`, { token, body: { name, steps } });
      assert.equal(saved.status, 200, `save ${name}: ${JSON.stringify(saved.json)}`);
      return created.json.id;
    };

    // The demo's shape: three steps, three timers adding to 381 s of hands-on
    // work, and a wall clock that is necessarily longer because the run took
    // real time to record.
    appId = await makeApp('Bracket Assembly', [
      { id: 's1', name: 'Safety Check', order: 0, takt_time: 5, widgets: [] },
      { id: 's2', name: 'Assembly', order: 1, takt_time: 240, widgets: [] },
      { id: 's3', name: 'Final Inspection', order: 2, widgets: [] },
    ]);
    const created = await api('POST', '/api/completions', { token, body: { app_id: appId, operator_name: 'Bob' } });
    runId = created.json.id;
    assert.equal((await api('PUT', `/api/completions/${runId}`, {
      token, body: { status: 'completed', data: { visual_ok: 'Pass' }, step_times: { 0: 55, 1: 218, 2: 108 } },
    })).status, 200);

    // A job still on the bench: it has an elapsed-so-far and no duration.
    const open = await api('POST', '/api/completions', { token, body: { app_id: appId, operator_name: 'Maria' } });
    openRunId = open.json.id;

    // An app whose runs are genuinely sub-second. Every screen used to print
    // "0s" for this while App History said it had never been timed at all.
    subSecondApp = await makeApp('Go/No-Go Gauge', [
      { id: 'g1', name: 'Gauge it', order: 0, widgets: [] },
    ]);
    for (const seconds of [0.4, 0.5, 0.6]) {
      const c = await api('POST', '/api/completions', { token, body: { app_id: subSecondApp, operator_name: 'Priya' } });
      assert.equal((await api('PUT', `/api/completions/${c.json.id}`, {
        token, body: { status: 'completed', step_times: { 0: seconds } },
      })).status, 200);
    }
  });

  it('reports 381 seconds of hands-on time on App History, with the wall clock beside it', async () => {
    const h = await api('GET', `/api/completions/app/${appId}/history`, { token });
    assert.equal(h.status, 200, JSON.stringify(h.json));
    const row = h.json.completions.find(c => c.id === runId);
    assert.strictEqual(row.total_duration_seconds, 381);
    assert.strictEqual(row.duration_basis, 'hands_on', 'the row says which measurement it is');
    assert.strictEqual(row.hands_on_seconds, 381);
    // The other measurement rides along so the screen can name the gap. It is
    // null here when the run's two timestamps land in the same second — the
    // model's own rule, and never a zero.
    assert.ok('elapsed_seconds' in row, 'the row carries the other measurement');
    assert.notStrictEqual(row.elapsed_seconds, 0,
      'and it is never a fabricated zero — rounding must not turn a real span into "no time at all"');
    assert.strictEqual(h.json.avg_duration_basis, 'hands_on');
  });

  it('reports the SAME 381 seconds on App Detail, App Analytics and Completion Detail', async () => {
    const detail = await api('GET', `/api/apps/${appId}/detail`, { token });
    const detailRun = detail.json.recent_runs.find(r => r.id === runId);
    assert.strictEqual(detailRun.duration_s, 381, 'App Detail used to show wall clock here');
    assert.strictEqual(detailRun.duration_basis, 'hands_on');

    const analytics = await api('GET', `/api/apps/${appId}/analytics`, { token });
    const analyticsRun = analytics.json.recent_runs.find(r => r.id === runId);
    assert.strictEqual(analyticsRun.duration_s, 381, 'App Analytics used to show wall clock here');

    const one = await api('GET', `/api/analytics/completion/${runId}`, { token });
    assert.strictEqual(one.json.total_duration_seconds, 381,
      'Completion Detail printed "Total Duration —" over the step times it was already listing');
    assert.strictEqual(one.json.duration_basis, 'hands_on');

    const plant = await api('GET', '/api/analytics/plant-view', { token });
    const plantRun = plant.json.recent_completions.find(c => c.id === runId);
    assert.strictEqual(plantRun.duration_seconds, 381,
      'the Command Center showed 6m 42s where App History showed 6m 21s');
    assert.strictEqual(plantRun.duration_basis, 'hands_on');
  });

  it('gives Completion Detail the per-step seconds, takt and station NAME it holds', async () => {
    const one = await api('GET', `/api/analytics/completion/${runId}`, { token });
    const steps = one.json.step_breakdown;
    assert.deepStrictEqual(steps.map(s => s.duration_seconds), [55, 218, 108],
      'the page rendered "— / — / —" over exactly these numbers');
    assert.deepStrictEqual(steps.map(s => s.takt_seconds), [5, 240, null],
      'a step with no takt configured is null, not a takt of zero');
    assert.strictEqual(steps[2].status, 'unknown', 'no takt ⇒ no verdict to paint');
    assert.ok(steps[0].variance_pct !== null, 'a step with a takt has a variance');
    assert.strictEqual(steps[2].variance_pct, null);
    assert.ok('station_name' in one.json, 'the page printed a raw station UUID where the name belongs');
    assert.ok(Array.isArray(one.json.related_completions));
  });

  it('never reports a duration for a run that has not completed', async () => {
    const h = await api('GET', `/api/completions/app/${appId}/history`, { token });
    const open = h.json.completions.find(c => c.id === openRunId);
    assert.strictEqual(open.status, 'in_progress');
    assert.strictEqual(open.total_duration_seconds, null, 'an unfinished run took NULL, not zero, seconds');

    const plant = await api('GET', '/api/analytics/plant-view', { token });
    const plantOpen = plant.json.recent_completions.find(c => c.id === openRunId);
    assert.strictEqual(plantOpen.duration_seconds, null,
      'RECENT COMPLETIONS listed an in-progress job with its elapsed-so-far in the Duration column');
    assert.strictEqual(plantOpen.is_complete, false, 'and the row says so, so the table can label it');
    assert.strictEqual(plantOpen.status, 'in_progress');
    assert.ok(plantOpen.elapsed_so_far_seconds >= 0,
      'the elapsed-so-far is still available — in its own field, under its own name');
  });

  it('keeps a sub-second run measurable instead of printing a fabricated 0s', async () => {
    const h = await api('GET', `/api/completions/app/${subSecondApp}/history`, { token });
    assert.ok(h.json.avg_duration > 0 && h.json.avg_duration < 1,
      `half-second runs average to half a second, got ${h.json.avg_duration}`);
    assert.strictEqual(h.json.best_time, 0.4);

    // The three screens that used to print "0s" for exactly this data.
    const detail = await api('GET', `/api/apps/${subSecondApp}/detail`, { token });
    assert.ok(detail.json.stats.avg_duration_s > 0,
      `App Detail printed "0s" here; got ${detail.json.stats.avg_duration_s}`);
    const analytics = await api('GET', `/api/apps/${subSecondApp}/analytics`, { token });
    assert.ok(analytics.json.totals.avg_duration_s > 0,
      `App Analytics printed "0s" here; got ${analytics.json.totals.avg_duration_s}`);
    // And the two screens agree, which is the whole point.
    assert.strictEqual(detail.json.stats.avg_duration_s, analytics.json.totals.avg_duration_s);
    assert.strictEqual(detail.json.stats.avg_duration_s, h.json.avg_duration);
  });

  it('leaves an app nobody has timed as unknown, and keeps it out of every average', async () => {
    const created = await api('POST', '/api/apps', { token, body: { name: 'Never Timed' } });
    const untimedApp = created.json.id;
    await api('PUT', `/api/apps/${untimedApp}`, {
      token, body: { name: 'Never Timed', steps: [{ id: 'x', name: 'Look', order: 0, widgets: [] }] },
    });
    const c = await api('POST', '/api/completions', { token, body: { app_id: untimedApp, operator_name: 'Bob' } });
    // Completed with no step timers, and the same instant on both clocks is not
    // a measurement of zero — it is two timestamps too coarse to separate.
    await api('PUT', `/api/completions/${c.json.id}`, { token, body: { status: 'completed', step_times: {} } });

    const h = await api('GET', `/api/completions/app/${untimedApp}/history`, { token });
    const row = h.json.completions[0];
    // Either it has a real wall clock, or it has nothing — never a zero.
    assert.ok(row.total_duration_seconds === null || row.total_duration_seconds > 0,
      `a run is never zero seconds long; got ${row.total_duration_seconds}`);
    assert.notStrictEqual(h.json.avg_duration, 0, 'and it must not drag the average to zero');
    assert.notStrictEqual(h.json.best_time, 0);

    const detail = await api('GET', `/api/apps/${untimedApp}/detail`, { token });
    assert.notStrictEqual(detail.json.stats.avg_duration_s, 0);
    const analytics = await api('GET', `/api/apps/${untimedApp}/analytics`, { token });
    assert.notStrictEqual(analytics.json.totals.avg_duration_s, 0);
  });

  it('quantises nothing: durations are not snapped to six-second steps', async () => {
    // The Command Center derived seconds from a tenth of a MINUTE it had already
    // rounded, so every duration it printed was a multiple of six. Feed it runs
    // that cannot all be multiples of six and check that none of them is one.
    const created = await api('POST', '/api/apps', { token, body: { name: 'Press' } });
    const pressApp = created.json.id;
    await api('PUT', `/api/apps/${pressApp}`, {
      token, body: { name: 'Press', steps: [{ id: 'p', name: 'Press', order: 0, widgets: [] }] },
    });
    const measured = [3.2, 3.3, 3.4, 3.5, 3.56];
    for (const seconds of measured) {
      const c = await api('POST', '/api/completions', { token, body: { app_id: pressApp, operator_name: 'Bob' } });
      await api('PUT', `/api/completions/${c.json.id}`, {
        token, body: { status: 'completed', step_times: { 0: seconds } },
      });
    }
    const h = await api('GET', `/api/completions/app/${pressApp}/history`, { token });
    const reported = h.json.completions.map(c => c.total_duration_seconds).sort((a, b) => a - b);
    assert.deepStrictEqual(reported, [3.2, 3.3, 3.4, 3.5, 3.6],
      'eight runs measuring 3.20-3.56 s all used to print "6s"');
    for (const value of reported) {
      assert.ok(value < 6, `${value}s must not have been rounded up to a six-second step`);
    }
  });
});

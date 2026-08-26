'use strict';
// ─── Metric honesty: null, never a fabricated zero ────────────────────────────
// The launch audit found the app-history endpoint reporting `pass_rate: 0` for
// an app that records no pass/fail check at all (the UI then painted a red 0%
// on a run nobody ever inspected), and the analytics overview rounding cycle
// time to whole minutes before the client ever saw it — so every operation
// averaging under 30 seconds came back as 0 and rendered "0m".
//
// This file locks in the rule for the whole chain:
//   • a metric with nothing behind it is null,
//   • a duration keeps enough precision to be printed in seconds,
//   • the demo sandbox's OEE is a real measurement of seeded events and lands
//     where a working factory actually lands, not at 1 %.
//
// Uses Node built-ins only (node:test + global fetch). Run with: npm test

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const PORT = 3254; // unique per test file — a collision silently cancels a suite
const BASE = `http://localhost:${PORT}`;
const DB_PATH = path.join(os.tmpdir(), `mes-metric-honesty-${Date.now()}.db`);

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

describe('unmeasured metrics come back null', () => {
  let token, noQcApp, untimedApp, taktApp;

  before(async () => {
    const signup = await api('POST', '/api/auth/signup', {
      body: { company_name: 'Numbers Co', email: 'admin@numbers.test', password: 'SecretPass1', display_name: 'Admin' },
    });
    assert.equal(signup.status, 201, `signup: ${JSON.stringify(signup.json)}`);
    token = signup.json.token;

    // Create then save: POST only takes the name, the steps blob goes in on PUT.
    const makeApp = async (name, steps) => {
      const created = await api('POST', '/api/apps', { token, body: { name } });
      assert.ok([200, 201].includes(created.status), `create ${name}: ${JSON.stringify(created.json)}`);
      const saved = await api('PUT', `/api/apps/${created.json.id}`, { token, body: { name, steps } });
      assert.equal(saved.status, 200, `save ${name}: ${JSON.stringify(saved.json)}`);
      return created.json.id;
    };

    // An app whose steps carry no pass/fail widget: there is no quality result
    // to have, ever. One run, twelve seconds of step time.
    noQcApp = await makeApp('Torque Log', [
      { id: 's1', name: 'Record torque', order: 0,
        widgets: [{ id: 'w1', type: 'number-input', order: 0, label: 'Torque', config: { variableName: 'tq' } }] },
    ]);
    const c1 = await api('POST', '/api/completions', { token, body: { app_id: noQcApp, operator_name: 'Bob' } });
    assert.equal((await api('PUT', `/api/completions/${c1.json.id}`, {
      token, body: { status: 'completed', data: { tq: 15 }, step_times: { 0: 12 } },
    })).status, 200);

    // An app with a single run still on the bench — started, never finished.
    untimedApp = await makeApp('Untimed', [{ id: 'b1', name: 'Look at it', order: 0, widgets: [] }]);
    await api('POST', '/api/completions', { token, body: { app_id: untimedApp, operator_name: 'Bob' } });

    // An app nobody has ever run, with one step that has a takt and one that
    // does not.
    taktApp = await makeApp('Takt Mix', [
      { id: 't1', name: 'Timed step', order: 0, takt_time: 240, widgets: [] },
      { id: 't2', name: 'Untimed step', order: 1, widgets: [] },
    ]);
  });

  it('reports pass_rate null — not 0 — for an app with no pass/fail checks', async () => {
    const h = await api('GET', `/api/completions/app/${noQcApp}/history`, { token });
    assert.equal(h.status, 200);
    assert.strictEqual(h.json.pass_rate, null, 'no inspection ⇒ no pass rate, not 0%');
    assert.strictEqual(h.json.qc_sample_size, 0, 'and the sample size says why');
    assert.equal(h.json.total_runs, 1, 'the run itself is still counted');
  });

  it('keeps a twelve-second run at twelve seconds', async () => {
    const h = await api('GET', `/api/completions/app/${noQcApp}/history`, { token });
    assert.strictEqual(h.json.avg_duration, 12);
    assert.strictEqual(h.json.best_time, 12);
    assert.strictEqual(h.json.step_averages[0].avg_duration_seconds, 12);
    assert.strictEqual(h.json.completions[0].total_duration_seconds, 12);
  });

  it('reports null durations for a run nobody has timed, and keeps its start', async () => {
    const h = await api('GET', `/api/completions/app/${untimedApp}/history`, { token });
    assert.strictEqual(h.json.avg_duration, null, 'nothing finished ⇒ no average, not 0s');
    assert.strictEqual(h.json.best_time, null);
    assert.strictEqual(h.json.pass_rate, null);
    const row = h.json.completions[0];
    assert.equal(row.status, 'in_progress');
    assert.strictEqual(row.completed_at, null);
    assert.strictEqual(row.total_duration_seconds, null, 'an unfinished run took NULL, not zero, seconds');
    assert.ok(row.started_at, 'the DATE column still has a real date to show');
  });

  it('distinguishes a step with no takt from a step with a takt of zero', async () => {
    const h = await api('GET', `/api/completions/app/${taktApp}/history`, { token });
    assert.strictEqual(h.json.step_averages[0].takt_seconds, 240);
    assert.strictEqual(h.json.step_averages[1].takt_seconds, null, 'no takt configured ⇒ null');
    for (const s of h.json.step_averages) {
      assert.strictEqual(s.avg_duration_seconds, null, 'no run ⇒ no per-step average');
      assert.strictEqual(s.completion_count, 0);
    }
  });

  it('hands the analytics overview a cycle time in seconds, not rounded-away minutes', async () => {
    const o = await api('GET', `/api/analytics/overview?app_id=${noQcApp}`, { token });
    assert.equal(o.status, 200);
    assert.ok(o.json.avgCycleSeconds !== null && o.json.avgCycleSeconds >= 0,
      'a completed run has a measurable cycle time');
    assert.strictEqual(o.json.passRate, null, 'no inspection ⇒ no pass rate');
    assert.strictEqual(o.json.qcSampleSize, 0);

    const empty = await api('GET', `/api/analytics/overview?app_id=${untimedApp}`, { token });
    assert.strictEqual(empty.json.avgCycleSeconds, null, 'nothing completed ⇒ no average, not 0');
    assert.strictEqual(empty.json.avgCycleTime, null);
    assert.strictEqual(empty.json.passRate, null);
  });

  it('gives the operator and app rollups a seconds-precision average too', async () => {
    const ops = await api('GET', `/api/analytics/operator-performance?app_id=${noQcApp}`, { token });
    assert.equal(ops.status, 200);
    assert.ok(ops.json.length >= 1);
    assert.equal(typeof ops.json[0].avg_cycle_seconds, 'number');

    const apps = await api('GET', `/api/analytics/app-performance?app_id=${noQcApp}`, { token });
    assert.equal(apps.status, 200);
    assert.equal(typeof apps.json[0].avg_cycle_seconds, 'number');
  });
});

describe('the public demo sandbox is a credible factory', () => {
  let token;

  before(async () => {
    const demo = await api('POST', '/api/auth/demo');
    assert.equal(demo.status, 201, `demo: ${JSON.stringify(demo.json)}`);
    token = demo.json.token;
  });

  it('computes a believable OEE at Station 1 from the events it seeded', async () => {
    const oee = await api('GET', '/api/oee', { token });
    assert.equal(oee.status, 200);
    const st1 = oee.json.find(s => s.name === 'Station 1');
    assert.ok(st1, 'Station 1 seeded');
    const m = st1.oee;

    assert.equal(m.measurable, true, 'the showcase station must have a measurable OEE');
    assert.deepEqual(m.missing, [], 'nothing is missing to measure it');

    // The seed's own arithmetic: enough completions today to match the runtime
    // and the 420-second ideal cycle, with a small scrap rate. If any of those
    // drift apart the demo goes back to advertising a 1% factory.
    assert.equal(m.availability, 100, 'Station 1 logs no downtime today');
    assert.ok(m.performance >= 65 && m.performance <= 90,
      `performance ${m.performance}% should sit near the seeded 79%`);
    assert.ok(m.quality >= 80 && m.quality <= 100,
      `quality ${m.quality}% should reflect a small scrap rate, not half the shift`);
    assert.ok(m.oee >= 55 && m.oee <= 88,
      `OEE ${m.oee}% must land in the band a working plant runs at, not 1%`);

    // …and it is genuinely a measurement: OEE is the product of the three, not
    // a number of its own. The API rounds each factor for display and rounds
    // the product of the UNROUNDED factors, so recomputing from the displayed
    // factors can land a point either side — performance 78.5% and quality
    // 94.5% report as 79 and 95, whose product rounds to 75 while the real
    // product rounds to 74. A point of rounding is not what this guards
    // against; an OEE that ignores its own factors would be out by tens.
    const product = Math.round((m.availability / 100) * (m.performance / 100) * (m.quality / 100) * 100);
    assert.ok(Math.abs(m.oee - product) <= 1,
      `OEE ${m.oee}% must be availability × performance × quality (${product}%)`);

    // Output has to be consistent with the ideal cycle and the planned day,
    // which is what performance divides.
    const expected = Math.round((m.completions_today * st1.ideal_cycle_seconds) / (m.uptime_minutes * 60) * 100);
    assert.equal(m.performance, expected, 'performance follows from the seeded completions');
    assert.ok(m.completions_today >= 5, 'a shift on the board, not two runs');
  });

  it('keeps the work order, the kit and the day’s output telling one story', async () => {
    const wos = await api('GET', '/api/work-orders', { token });
    assert.equal(wos.status, 200);
    const open = wos.json.find(w => w.work_order_number.endsWith('WO-1001'));
    assert.ok(open, 'WO-1001 seeded');
    assert.ok(open.quantity_completed <= open.quantity,
      'a work order cannot have built more than it ordered');

    const oee = await api('GET', '/api/oee', { token });
    const st1 = oee.json.find(s => s.name === 'Station 1');
    assert.equal(open.quantity_completed, st1.oee.completions_today,
      'the open work order holds exactly what the station finished today');

    const kits = await api('GET', '/api/kits', { token });
    const kit = kits.json.find(k => k.work_order_number.endsWith('WO-1001'));
    assert.ok(kit, 'the WO-1001 kit is seeded');
    const detail = await api('GET', `/api/kits/${kit.id}`, { token });
    const short = detail.json.lines.find(l => l.status === 'short');
    assert.ok(short, 'the kit is short a line');
    assert.equal(short.qty_required, open.quantity,
      'the kit covers the whole order');
    assert.equal(short.qty_picked, open.quantity_completed,
      'exactly enough of the short item was picked to build what got built');
  });

  it('reports the demo’s quality the same way on the station and in analytics', async () => {
    const oee = await api('GET', '/api/oee', { token });
    const st1 = oee.json.find(s => s.name === 'Station 1');
    const overview = await api('GET', '/api/analytics/overview', { token });
    assert.ok(overview.json.passRate !== null, 'the demo records inspections');
    // Different windows (today vs all time), so not equal — but a customer must
    // not see 96% next to 50%.
    assert.ok(Math.abs(overview.json.passRate - st1.oee.quality) <= 10,
      `station quality ${st1.oee.quality}% and plant pass rate ${overview.json.passRate}% must not contradict each other`);
  });
});

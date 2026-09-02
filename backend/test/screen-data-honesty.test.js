'use strict';
// ─── Screen-data honesty tests (mission M1) ───────────────────────────────────
// Locks in two rules the product-goal review found broken:
//
//  1. Site filtering must not hide unassigned records. Every company gets a
//     primary site auto-selected in the UI, but departments/stations created
//     without a site used to disappear the moment that filter was applied —
//     blanking the Stations page, the Departments page and the Command
//     Center's department performance for most companies.
//
//  2. Metrics with no data behind them report `null`, never a fabricated
//     number. OEE in particular used to assume a 90% performance factor and a
//     100% quality factor for stations that had never reported anything.
//
// Uses Node built-ins only (node:test + global fetch). Run with: npm test

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const PORT = 3184;
const BASE = `http://localhost:${PORT}`;
const DB_PATH = path.join(os.tmpdir(), `mes-screen-honesty-${Date.now()}.db`);

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

describe('Site filtering keeps unassigned records visible', () => {
  let token, siteId, deptId, stationId;

  before(async () => {
    const signup = await api('POST', '/api/auth/signup', {
      body: { company_name: 'Honesty Co', email: 'admin@honesty.test', password: 'SecretPass1', display_name: 'Admin' },
    });
    assert.equal(signup.status, 201, 'signup failed');
    token = signup.json.token;

    // Signup already provisions a primary site — exactly the one the UI
    // auto-selects for every company.
    const sites = await api('GET', '/api/sites', { token });
    assert.equal(sites.status, 200);
    assert.ok(sites.json.length > 0, 'a new company should have a primary site');
    siteId = (sites.json.find(s => s.is_primary) ?? sites.json[0]).id;

    // Deliberately created WITHOUT a site — the common case for a company that
    // never touched the multi-site feature.
    const dept = await api('POST', '/api/departments', { token, body: { name: 'Assembly' } });
    assert.ok([200, 201].includes(dept.status), 'department create failed');
    deptId = dept.json.id;

    const station = await api('POST', '/api/stations', { token, body: { name: 'Station 1', department_id: deptId } });
    assert.ok([200, 201].includes(station.status), 'station create failed');
    stationId = station.json.id;
  });

  it('lists site-less departments when a site filter is applied', async () => {
    const all = await api('GET', '/api/departments', { token });
    assert.equal(all.status, 200);
    assert.equal(all.json.length, 1);

    const filtered = await api('GET', `/api/departments?site_id=${siteId}`, { token });
    assert.equal(filtered.status, 200);
    assert.equal(filtered.json.length, 1, 'a department with no site must still show under a selected site');
    assert.equal(filtered.json[0].id, deptId);
  });

  it('lists site-less stations when a site filter is applied', async () => {
    const filtered = await api('GET', `/api/stations?site_id=${siteId}`, { token });
    assert.equal(filtered.status, 200);
    assert.equal(filtered.json.length, 1, 'a station with no site must still show under a selected site');
    assert.equal(filtered.json[0].id, stationId);
  });

  it('keeps the Command Center floor view populated under a site filter', async () => {
    const plant = await api('GET', `/api/analytics/plant-view?site_id=${siteId}`, { token });
    assert.equal(plant.status, 200);
    assert.equal(
      plant.json.department_performance.length, 1,
      'department performance must not empty out when a site is selected',
    );
    assert.equal(plant.json.department_performance[0].id, deptId);
  });
});

describe('Metrics with no data report null, never an invented number', () => {
  let token, stationId;

  before(async () => {
    const signup = await api('POST', '/api/auth/signup', {
      body: { company_name: 'Empty Co', email: 'admin@empty.test', password: 'SecretPass1', display_name: 'Admin' },
    });
    assert.equal(signup.status, 201, 'signup failed');
    token = signup.json.token;

    // The OEE endpoints are Pro-gated.
    const plan = await api('PUT', '/api/config/plan', { token, body: { tier: 'pro' } });
    assert.equal(plan.status, 200);

    const station = await api('POST', '/api/stations', { token, body: { name: 'Fresh Station' } });
    assert.ok([200, 201].includes(station.status), 'station create failed');
    stationId = station.json.id;
  });

  it('reports OEE factors it cannot measure as null', async () => {
    const r = await api('GET', '/api/oee', { token });
    assert.equal(r.status, 200);
    const machine = r.json.find(m => m.id === stationId);
    assert.ok(machine, 'station should appear in the OEE list');

    assert.equal(machine.oee.performance, null, 'no ideal cycle time set → performance is unknown, not 90%');
    assert.equal(machine.oee.quality, null, 'no runs today → quality is unknown, not 100%');
    assert.equal(machine.oee.oee, null, 'OEE is only reported when every factor is real');
    assert.equal(machine.oee.measurable, false);
    assert.ok(Array.isArray(machine.oee.missing) && machine.oee.missing.length > 0,
      'the response must say what is missing so the UI can tell the user');

    // Availability used to be derived from the configured planned hours alone,
    // so a station nobody had ever touched reported 100% — on the very first
    // screen a new customer sees. That is the one number in this file that was
    // still invented: it says the machine was up and ready all day, about a
    // machine that has not run. Now the planned window opens at the first thing
    // that actually happens on the station each day, so before that there is no
    // window and nothing to state.
    assert.equal(machine.oee.availability, null,
      'a station with no activity today has no availability to report, not 100%');
    assert.ok(machine.oee.missing.includes('any activity today'),
      `the response must say why, got ${JSON.stringify(machine.oee.missing)}`);
  });

  it('reports pass rate as null until a run records a QC result', async () => {
    const overview = await api('GET', '/api/analytics/overview', { token });
    assert.equal(overview.status, 200);
    assert.equal(overview.json.passRate, null, 'no QC results → no pass rate (not 0%, not 100%)');
    assert.equal(overview.json.qcSampleSize, 0);

    const brief = await api('GET', '/api/analytics/daily-brief', { token });
    assert.equal(brief.status, 200);
    assert.equal(brief.json.kpis.pass_rate_7d, null);
    assert.equal(brief.json.kpis.schedule_adherence, null, 'no open work orders → no on-track percentage');
  });

  it('reports empty dashboard metric cards as null with a reason', async () => {
    const dash = await api('POST', '/api/dashboards', {
      token,
      body: {
        name: 'Empty metrics',
        cards: [
          { id: 'c1', type: 'metric', title: 'Pass Rate', metric_key: 'pass_rate' },
          { id: 'c2', type: 'metric', title: 'Avg Cycle', metric_key: 'avg_cycle' },
          { id: 'c3', type: 'metric', title: 'Training', metric_key: 'training_coverage' },
        ],
      },
    });
    assert.ok([200, 201].includes(dash.status), `dashboard create failed: ${JSON.stringify(dash.json)}`);

    const data = await api('GET', `/api/dashboards/${dash.json.id}/data`, { token });
    assert.equal(data.status, 200);
    for (const card of data.json.cards) {
      assert.equal(card.data.value, null, `card ${card.card_id} must report no value rather than a placeholder`);
      assert.ok(card.data.empty_reason, `card ${card.card_id} must explain why it is empty`);
    }
  });
});

describe('Command Center attention list stays triageable', () => {
  let token;

  before(async () => {
    const signup = await api('POST', '/api/auth/signup', {
      body: { company_name: 'Busy Co', email: 'admin@busy.test', password: 'SecretPass1', display_name: 'Admin' },
    });
    assert.equal(signup.status, 201, 'signup failed');
    token = signup.json.token;

    // Ten overdue work orders — far more than a supervisor can triage at once.
    for (let i = 0; i < 10; i++) {
      const r = await api('POST', '/api/work-orders', {
        token,
        body: {
          work_order_number: `BUSY-WO-${100 + i}`,
          part_number: 'P-1', part_name: 'Widget', quantity: 10,
          scheduled_start: '2020-01-01T08:00:00.000Z',
          scheduled_end: '2020-01-02T08:00:00.000Z',
          status: 'in_progress',
        },
      });
      assert.ok([200, 201].includes(r.status), `work order create failed: ${JSON.stringify(r.json)}`);
    }
  });

  it('caps late work orders and summarises the rest honestly', async () => {
    const brief = await api('GET', '/api/analytics/daily-brief', { token });
    assert.equal(brief.status, 200);

    const woItems = brief.json.attention.filter(a => a.type === 'wo_overdue' || a.type === 'wo_behind');
    assert.ok(woItems.length <= 6, `expected at most 6 work-order rows, got ${woItems.length}`);

    const overflow = brief.json.attention.find(a => a.type === 'more');
    assert.ok(overflow, 'the rows that did not fit must be summarised, not silently dropped');
    assert.match(overflow.label, /\d+ more work orders? behind schedule/);
    assert.equal(overflow.link, '/schedule');
  });
});

describe('Seeded sandbox tiles: no 0 stands in for something nobody measured', () => {
  // The sandbox is a plant with a full day of real activity behind it, so
  // every tile this suite checks SHOULD read as measured (sample > 0). The
  // rule under test is the contract each of these payloads documents on
  // itself: a value and its `_sample` (or `sample`) count travel together, and
  // a value is only ever null when its sample is 0 — never a bare 0 standing
  // in for "nobody counted this yet". Asserting sample > 0 here is therefore
  // also proof that the new wave-3/4 tiles (WIP good/scrap, the scrap yield,
  // the andon within-target figure) are actually populated by the seed, not
  // just that they fail safe when empty (screen-data-honesty's other describe
  // blocks already cover the empty case, against a fresh company).
  let token;

  before(async () => {
    const demo = await api('POST', '/api/auth/demo');
    assert.equal(demo.status, 201, `demo sandbox: ${JSON.stringify(demo.json)}`);
    token = demo.json.token;
  });

  // A value/sample/reason triad: if the sample is 0, the value MUST be null
  // and a reason MUST be given; if the sample is > 0, the value must be a real
  // number — the two can never both be true at once, and neither can print a
  // bare 0 in the sample's absence.
  function assertHonestTriad(label, value, sample, reason) {
    assert.ok(Number.isFinite(sample), `${label}: sample must be a number (got ${JSON.stringify(sample)})`);
    if (sample > 0) {
      assert.notEqual(value, null, `${label}: sample is ${sample} but the value is null`);
    } else {
      assert.equal(value, null, `${label}: sample is 0, so the value must be null, not a fabricated ${JSON.stringify(value)}`);
      assert.ok(reason, `${label}: a null value must carry a reason`);
    }
  }

  it('GET /api/floor/snapshot: cycle time and pass rate are measured, with samples', async () => {
    const r = await api('GET', '/api/floor/snapshot', { token });
    assert.equal(r.status, 200);
    assertHonestTriad('avg_cycle_seconds', r.json.avg_cycle_seconds, r.json.avg_cycle_sample, r.json.avg_cycle_reason);
    assertHonestTriad('pass_rate', r.json.pass_rate, r.json.pass_rate_sample, r.json.pass_rate_reason);
    assert.ok(r.json.avg_cycle_sample > 0, 'the sandbox has real cycle-time samples');
    assert.ok(r.json.pass_rate_sample > 0, 'the sandbox has real pass/fail samples');
  });

  it('GET /api/floor/wip-summary: today\'s good/scrap carry a real sample', async () => {
    const r = await api('GET', '/api/floor/wip-summary', { token });
    assert.equal(r.status, 200);
    assertHonestTriad('totals.good_today', r.json.totals.good_today, r.json.totals.good_today_sample, r.json.totals.good_today_reason);
    assertHonestTriad('totals.scrap_today', r.json.totals.scrap_today, r.json.totals.scrap_today_sample, r.json.totals.scrap_today_reason);
    assert.ok(r.json.totals.good_today_sample > 0, 'the seeded Weld runs count toward today\'s good units');
    assert.ok(r.json.totals.scrap_today_sample > 0, 'the seeded Weld runs count toward today\'s scrap');
    assert.ok(r.json.totals.good_today > 0);
    assert.ok(r.json.totals.scrap_today > 0);
    for (const dept of r.json.departments) {
      assertHonestTriad(`departments[${dept.department_name}].good_today`, dept.good_today, dept.good_today_sample, dept.good_today_reason);
      assertHonestTriad(`departments[${dept.department_name}].scrap_today`, dept.scrap_today, dept.scrap_today_sample, dept.scrap_today_reason);
    }
  });

  it('GET /api/oee/losses: every Pareto bar is a real, positive number of minutes', async () => {
    const r = await api('GET', '/api/oee/losses?days=1', { token });
    assert.equal(r.status, 200);
    assert.ok(r.json.pareto.length > 0, 'the Pareto is not empty');
    for (const row of r.json.pareto) {
      assert.ok(row.minutes > 0, `Pareto row "${row.label}" must carry real minutes, not a placeholder 0`);
      assert.ok(row.stops > 0, `Pareto row "${row.label}" must carry a real stop count`);
    }
    // The six big losses always print all six buckets (that is real: "0
    // minutes of speed loss" is itself measured, not unmeasured) — but the
    // buckets our seed actually populated must show up as positive minutes,
    // not the same fabricated placeholder every empty bucket would show.
    const populated = r.json.six_big_losses.filter(b => b.minutes > 0);
    assert.ok(populated.length >= 3, `at least 3 of the six buckets have real minutes (got ${populated.map(b => b.bucket).join(', ')})`);
  });

  it('GET /api/completions/scrap: first-pass yield is real, never a fabricated 0% or 100%', async () => {
    const r = await api('GET', '/api/completions/scrap?days=1', { token });
    assert.equal(r.status, 200);
    assert.ok(r.json.totals.sample > 0, 'the totals carry a real sample');
    assert.notEqual(r.json.totals.fpy, null, 'a sample > 0 must produce a real yield, not null');
    assert.ok(r.json.totals.fpy > 0 && r.json.totals.fpy <= 1, 'fpy is a real fraction');
    for (const part of r.json.parts) {
      if (part.sample > 0) {
        assert.notEqual(part.fpy, null, `part ${part.part_number}: sample > 0 but fpy is null`);
      } else {
        assert.equal(part.fpy, null, `part ${part.part_number}: sample is 0, fpy must be null not fabricated`);
        assert.ok(part.fpy_reason, `part ${part.part_number}: a null fpy must carry a reason`);
      }
    }
  });

  it('GET /api/andon/summary: within-target is a measured number, with its sample', async () => {
    const r = await api('GET', '/api/andon/summary', { token });
    assert.equal(r.status, 200);
    if (r.json.within_target_sample > 0) {
      assert.notEqual(r.json.within_target_pct, null, 'sample > 0 but within_target_pct is null');
    } else {
      assert.equal(r.json.within_target_pct, null, 'within_target_sample is 0, so the pct must be null, not a fabricated 0%');
      assert.ok(r.json.within_target_reason, 'a null within_target_pct must carry a reason');
    }
    assert.ok(r.json.within_target_sample > 0, 'the seeded acknowledged call gives this a real sample');
    assert.ok(r.json.escalated_open >= 1, 'the seeded escalated call is counted');
  });

  it('GET /api/analytics/overview: pass rate and cycle time are real, sampled numbers', async () => {
    const r = await api('GET', '/api/analytics/overview', { token });
    assert.equal(r.status, 200);
    assertHonestTriad('passRate', r.json.passRate, r.json.qcSampleSize, r.json.pass_rate_reason);
    assertHonestTriad('avgCycleSeconds', r.json.avgCycleSeconds, r.json.avgCycleSample, r.json.avg_cycle_reason);
    assert.ok(r.json.qcSampleSize > 0);
    assert.ok(r.json.avgCycleSample > 0);
  });
});

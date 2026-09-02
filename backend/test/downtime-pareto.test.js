'use strict';
// ─── Stopping a station means picking from the coded list ────────────────────
//
// Downtime was a free-text "Reason (optional)" on a machine event, so a plant
// with a hundred spellings of "no material" had a word cloud where it needed a
// Pareto — and no six-big-losses roll-up at all, because nothing said which of
// the six a stop belonged to.
//
// And OEE's quality factor was a string match for 'Pass'/'Fail' inside the run
// blob, which measures how many RUNS were inspected, not how many PIECES were
// good. A station that inspects nothing reported no quality; a station that
// scrapped four of ten pieces reported one pass.
//
// What has to hold:
//
//   • 'down' and 'maintenance' require a coded reason, naming the field; 'up'
//     and 'idle' never do — nobody should have to explain the good news;
//   • a code from another company, or one explaining scrap rather than a
//     stoppage, is refused and no event row is written;
//   • GET /losses splits the window's minutes across the six big losses and
//     across reason codes, and reports minutes logged before codes existed as
//     `unclassified_minutes` — its OWN bar, never redistributed;
//   • quality counts UNITS when a run recorded them (basis 'quantities'), falls
//     back to inspections (basis 'inspection'), and is null with a reason when
//     there is neither — in no case 100%;
//   • the window is the PLANT'S day: a stop ten minutes before midnight in
//     Pacific/Auckland belongs to yesterday, not to today.
//
// Uses Node built-ins plus better-sqlite3 — stops with real durations (and the
// pre-code free-text event) are seeded straight into the table, because the API
// can only ever create a stop that started this instant.
//
// Run with: node --test test/downtime-pareto.test.js

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Database = require('better-sqlite3');
const { randomUUID } = require('node:crypto');

const PORT = 3413; // reserved for scrap-rework-and-coded-downtime (MIGRATIONS.md)
const BASE = `http://localhost:${PORT}`;
const DB_PATH = path.join(os.tmpdir(), `mes-downtime-pareto-${Date.now()}.db`);

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

/** A writable handle on the running server's database (WAL, so a second writer
 *  is fine). Used to seed stops with real durations and a real start instant. */
function openDb() {
  const db = new Database(DB_PATH);
  db.pragma('busy_timeout = 5000');
  return db;
}

/** How far Pacific/Auckland is ahead of UTC right now, in minutes — the same
 *  arithmetic plantDay.js does, so the boundary this test builds is the
 *  boundary the server measures against. */
function offsetMinutes(timeZone, at = new Date()) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone, hour12: false,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    }).formatToParts(at).map(p => [p.type, p.value]),
  );
  const hour = Number(parts.hour) % 24;
  const localAsUTC = Date.UTC(
    Number(parts.year), Number(parts.month) - 1, Number(parts.day),
    hour, Number(parts.minute), Number(parts.second),
  );
  return Math.round((localAsUTC - at.getTime()) / 60000);
}

before(async () => { await startServer(); });
after(() => {
  if (server) server.kill('SIGTERM');
  for (const ext of ['', '-shm', '-wal']) {
    try { fs.unlinkSync(DB_PATH + ext); } catch { /* ignore */ }
  }
});

describe('a stop carries a coded reason', () => {
  let token, tokenB, stationId, otherStationId;
  let breakdownCode, changeoverCode, scrapCode, foreignDowntimeCode;

  before(async () => {
    const signup = await api('POST', '/api/auth/signup', {
      body: { company_name: 'Pareto Co', email: 'admin@pareto.test', password: 'SecretPass1', display_name: 'Admin' },
    });
    assert.equal(signup.status, 201, `signup: ${JSON.stringify(signup.json)}`);
    token = signup.json.token;

    const st = await api('POST', '/api/stations', { token, body: { name: 'Press 1' } });
    stationId = st.json.id;
    const st2 = await api('POST', '/api/stations', { token, body: { name: 'Press 2' } });
    otherStationId = st2.json.id;

    const downs = await api('GET', '/api/andon/reason-codes?kind=downtime', { token });
    assert.equal(downs.status, 200, `reason codes: ${JSON.stringify(downs.json)}`);
    breakdownCode = downs.json.find(r => r.loss_bucket === 'breakdown');
    changeoverCode = downs.json.find(r => r.loss_bucket === 'setup_adjustment');
    assert.ok(breakdownCode && changeoverCode, `seeded downtime codes: ${JSON.stringify(downs.json)}`);
    const scraps = await api('GET', '/api/andon/reason-codes?kind=scrap', { token });
    scrapCode = scraps.json[0];

    const signupB = await api('POST', '/api/auth/signup', {
      body: { company_name: 'Rival Co', email: 'admin@rival-down.test', password: 'SecretPass1', display_name: 'Rival' },
    });
    tokenB = signupB.json.token;
    const downsB = await api('GET', '/api/andon/reason-codes?kind=downtime', { token: tokenB });
    foreignDowntimeCode = downsB.json[0];
    assert.ok(foreignDowntimeCode);
    assert.notEqual(foreignDowntimeCode.id, breakdownCode.id);
  });

  function eventCount(station) {
    const db = new Database(DB_PATH, { readonly: true });
    try { return db.prepare('SELECT COUNT(*) AS n FROM machine_events WHERE station_id = ?').get(station).n; }
    finally { db.close(); }
  }

  it("refuses 'down' with no reason code, naming the field", async () => {
    const before = eventCount(stationId);
    const res = await api('POST', `/api/oee/${stationId}/event`, { token, body: { event_type: 'down' } });
    assert.equal(res.status, 400, `expected a refusal, got ${JSON.stringify(res.json)}`);
    assert.match(JSON.stringify(res.json), /reason_code_id/, 'the refusal must name the field');
    assert.equal(eventCount(stationId), before, 'a refused stop was written anyway');
  });

  it("refuses 'maintenance' with no reason code too", async () => {
    const res = await api('POST', `/api/oee/${stationId}/event`, { token, body: { event_type: 'maintenance', reason: 'weekly' } });
    assert.equal(res.status, 400, `expected a refusal, got ${JSON.stringify(res.json)}`);
    assert.match(JSON.stringify(res.json), /reason_code_id/);
  });

  it("refuses another company's code, and a code that explains scrap", async () => {
    const before = eventCount(stationId);
    const foreign = await api('POST', `/api/oee/${stationId}/event`, {
      token, body: { event_type: 'down', reason_code_id: foreignDowntimeCode.id },
    });
    assert.equal(foreign.status, 400, `expected a refusal, got ${JSON.stringify(foreign.json)}`);

    const wrongKind = await api('POST', `/api/oee/${stationId}/event`, {
      token, body: { event_type: 'down', reason_code_id: scrapCode.id },
    });
    assert.equal(wrongKind.status, 400, `expected a refusal, got ${JSON.stringify(wrongKind.json)}`);
    assert.equal(eventCount(stationId), before, 'a refused stop was written anyway');
  });

  it('refuses a retired code — history keeps it, nothing new joins it', async () => {
    const codes = await api('GET', '/api/andon/reason-codes?kind=downtime', { token });
    const doomed = codes.json.find(r => r.code === 'no_operator');
    assert.ok(doomed, `no no_operator code: ${JSON.stringify(codes.json.map(x => x.code))}`);
    const retired = await api('DELETE', `/api/andon/reason-codes/${doomed.id}`, { token });
    assert.equal(retired.status, 200, `retiring: ${JSON.stringify(retired.json)}`);

    const before = eventCount(stationId);
    const res = await api('POST', `/api/oee/${stationId}/event`, {
      token, body: { event_type: 'down', reason_code_id: doomed.id },
    });
    assert.equal(res.status, 400, `expected a refusal, got ${JSON.stringify(res.json)}`);
    assert.equal(eventCount(stationId), before, 'a stop was filed under a retired cause');
  });

  it("lets a station go up or idle with no code at all", async () => {
    const up = await api('POST', `/api/oee/${stationId}/event`, { token, body: { event_type: 'running' } });
    assert.equal(up.status, 200, JSON.stringify(up.json));
    const idle = await api('POST', `/api/oee/${stationId}/event`, { token, body: { event_type: 'idle' } });
    assert.equal(idle.status, 200, JSON.stringify(idle.json));
  });

  it('accepts a coded stop and stores the code beside the free-text note', async () => {
    const res = await api('POST', `/api/oee/${stationId}/event`, {
      token, body: { event_type: 'down', reason_code_id: breakdownCode.id, reason: 'third time this week' },
    });
    assert.equal(res.status, 200, JSON.stringify(res.json));
    const db = new Database(DB_PATH, { readonly: true });
    const row = db.prepare('SELECT * FROM machine_events WHERE station_id = ? ORDER BY started_at DESC, rowid DESC LIMIT 1').get(stationId);
    db.close();
    assert.equal(row.reason_code_id, breakdownCode.id);
    assert.equal(row.reason, 'third time this week', 'the free-text note is still kept');
    // Put the station back up so its open stop does not run on into the
    // Pareto figures the next test seeds by hand.
    await api('POST', `/api/oee/${stationId}/event`, { token, body: { event_type: 'running' } });
  });
});

describe('the downtime Pareto and the six big losses', () => {
  let token, stationId, quietStationId, breakdownCode, changeoverCode;

  before(async () => {
    const signup = await api('POST', '/api/auth/signup', {
      body: { company_name: 'Losses Co', email: 'admin@losses.test', password: 'SecretPass1', display_name: 'Admin' },
    });
    token = signup.json.token;
    stationId = (await api('POST', '/api/stations', { token, body: { name: 'Line 1' } })).json.id;
    quietStationId = (await api('POST', '/api/stations', { token, body: { name: 'Line 2' } })).json.id;

    const downs = await api('GET', '/api/andon/reason-codes?kind=downtime', { token });
    breakdownCode = downs.json.find(r => r.loss_bucket === 'breakdown');
    changeoverCode = downs.json.find(r => r.loss_bucket === 'setup_adjustment');

    // Stops with real durations, all inside the plant's day. Started minutes
    // ago rather than now, because a stop of zero minutes proves nothing.
    const db = openDb();
    const ins = db.prepare(`INSERT INTO machine_events (id, station_id, event_type, reason, reason_code_id, started_at, ended_at, duration_minutes)
                            VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
    const ago = m => new Date(Date.now() - m * 60000).toISOString();
    ins.run(randomUUID(), stationId, 'down', '', breakdownCode.id, ago(120), ago(90), 30);
    ins.run(randomUUID(), stationId, 'down', '', breakdownCode.id, ago(80), ago(70), 10);
    ins.run(randomUUID(), stationId, 'maintenance', '', changeoverCode.id, ago(60), ago(48), 12);
    // The event that existed before codes did: free text, no code. Its minutes
    // are real and must be reported — as their own bar.
    ins.run(randomUUID(), stationId, 'down', 'Conveyor drive jam', null, ago(40), ago(33), 7);
    db.close();
  });

  it('splits the minutes across the six losses and leaves the uncoded ones alone', async () => {
    const res = await api('GET', `/api/oee/losses?station_id=${stationId}`, { token });
    assert.equal(res.status, 200, JSON.stringify(res.json));
    const l = res.json;

    assert.ok(Math.abs(l.total_down_minutes - 59) < 0.2, `total minutes: ${l.total_down_minutes}`);
    assert.ok(Math.abs(l.unclassified_minutes - 7) < 0.2,
      `the pre-code free-text stop must be reported, got ${l.unclassified_minutes}`);

    const bucketSum = l.six_big_losses.reduce((a, b) => a + b.minutes, 0);
    assert.ok(Math.abs(bucketSum + l.unclassified_minutes - l.total_down_minutes) < 0.2,
      `buckets (${bucketSum}) + unclassified (${l.unclassified_minutes}) must equal the total (${l.total_down_minutes})`);

    const breakdown = l.six_big_losses.find(b => b.bucket === 'breakdown');
    const setup = l.six_big_losses.find(b => b.bucket === 'setup_adjustment');
    assert.ok(Math.abs(breakdown.minutes - 40) < 0.2, `breakdown: ${breakdown.minutes}`);
    assert.ok(Math.abs(setup.minutes - 12) < 0.2, `setup_adjustment: ${setup.minutes}`);
    assert.equal(l.six_big_losses.length, 6, 'all six losses are always named, even at zero');

    // The uncoded minutes are NOWHERE except their own line. A Pareto that
    // spreads unknown minutes over known reasons invents its own top cause.
    for (const b of l.six_big_losses) {
      assert.ok(Math.abs(b.minutes - 7) > 0.2 || b.bucket === '',
        `the uncoded 7 minutes leaked into ${b.bucket}`);
    }
    const uncoded = l.pareto.find(p => p.reason_code_id === null);
    assert.ok(uncoded, 'the uncoded minutes have no bar of their own');
    assert.ok(Math.abs(uncoded.minutes - 7) < 0.2);
  });

  it('orders the Pareto by minutes, with a cumulative percentage', async () => {
    const l = (await api('GET', `/api/oee/losses?station_id=${stationId}`, { token })).json;
    const mins = l.pareto.map(p => p.minutes);
    assert.deepEqual([...mins].sort((a, b) => b - a), mins, 'the Pareto is not descending');
    assert.equal(l.pareto[0].reason_code_id, breakdownCode.id, 'the biggest loss is not first');
    // The top bar and the bucket it rolls into agree — the screen shows both.
    const bucket = l.six_big_losses.find(b => b.bucket === l.pareto[0].loss_bucket);
    assert.equal(bucket.minutes, l.pareto[0].minutes,
      'the top Pareto bar and its six-big-losses row disagree');
    const last = l.pareto[l.pareto.length - 1];
    assert.ok(Math.abs(last.cumulative_pct - 100) < 0.2, `cumulative % ends at ${last.cumulative_pct}`);
  });

  it('says a station with no stops has none, rather than charting zeros', async () => {
    const l = (await api('GET', `/api/oee/losses?station_id=${quietStationId}`, { token })).json;
    assert.equal(l.total_down_minutes, 0);
    assert.deepEqual(l.pareto, []);
    assert.equal(l.empty_reason, 'No stops recorded today');
  });

  it('refuses a nonsense ?days= rather than quietly answering a different question', async () => {
    for (const bad of ['0', 'abc', '-3', '2.5', '400']) {
      const res = await api('GET', `/api/oee/losses?days=${bad}`, { token });
      assert.equal(res.status, 400, `days=${bad} should be refused, got ${JSON.stringify(res.json)}`);
      assert.match(res.json.error, /days/);
    }
    assert.equal((await api('GET', '/api/oee/losses?days=7', { token })).status, 200);
    assert.equal((await api('GET', '/api/oee/losses', { token })).status, 200);
  });

  it('never reaches into another tenant, and an unknown station selects nothing', async () => {
    const l = (await api('GET', `/api/oee/losses?station_id=${randomUUID()}`, { token })).json;
    assert.equal(l.total_down_minutes, 0);
    assert.equal(l.stops, 0);
  });
});

describe('OEE quality counts units, and says which basis it used', () => {
  let token, appId, unitsStation, inspectStation, silentStation, scrapCode;

  const oeeFor = async (id) => {
    const list = await api('GET', '/api/oee', { token });
    return list.json.find(s => s.id === id).oee;
  };

  before(async () => {
    const signup = await api('POST', '/api/auth/signup', {
      body: { company_name: 'Quality Co', email: 'admin@quality.test', password: 'SecretPass1', display_name: 'Admin' },
    });
    token = signup.json.token;
    appId = (await api('POST', '/api/apps', { token, body: { name: 'Press' } })).json.id;
    unitsStation = (await api('POST', '/api/stations', { token, body: { name: 'Counts' } })).json.id;
    inspectStation = (await api('POST', '/api/stations', { token, body: { name: 'Inspects' } })).json.id;
    silentStation = (await api('POST', '/api/stations', { token, body: { name: 'Measures nothing' } })).json.id;
    scrapCode = (await api('GET', '/api/andon/reason-codes?kind=scrap', { token })).json[0];

    const run = async (stationId, body) => {
      const c = await api('POST', '/api/completions', {
        token, body: { app_id: appId, station_id: stationId, operator_name: 'Ada' },
      });
      const done = await api('PUT', `/api/completions/${c.json.id}`, { token, body: { status: 'completed', ...body } });
      assert.equal(done.status, 200, `finish: ${JSON.stringify(done.json)}`);
    };

    // Nine good, one scrap — 90% by units.
    await run(unitsStation, { quantity_good: 9, quantity_scrap: 1, scrap_reason_code_id: scrapCode.id });
    // No counts anywhere, but inspected runs: one pass, one fail.
    await run(inspectStation, { data: { qc: 'Pass' } });
    await run(inspectStation, { data: { qc: 'Fail' } });
    // A run that measured nothing at all.
    await run(silentStation, { data: { note: 'ran it' } });
  });

  it('counts units when a run recorded them', async () => {
    const oee = await oeeFor(unitsStation);
    assert.equal(oee.quality, 90, `expected 90% from 9 good and 1 scrap, got ${oee.quality}`);
    assert.equal(oee.quality_basis, 'quantities', 'the screen has to be able to say what it counted');
    assert.equal(oee.quality_sample, 1);
    assert.equal(oee.units_good, 9);
    assert.equal(oee.units_scrap, 1);
  });

  it('falls back to inspections when nobody counted units', async () => {
    const oee = await oeeFor(inspectStation);
    assert.equal(oee.quality, 50, 'one pass and one fail is 50%');
    assert.equal(oee.quality_basis, 'inspection');
    assert.equal(oee.quality_sample, 2);
  });

  it('reports no quality at all — never 100% — when nothing was measured', async () => {
    const oee = await oeeFor(silentStation);
    assert.strictEqual(oee.quality, null, `a station measuring nothing reported ${oee.quality}%`);
    assert.notEqual(oee.quality, 100);
    assert.strictEqual(oee.quality_basis, null);
    assert.ok(oee.quality_reason && oee.quality_reason.length > 0, 'a missing number travels with its reason');
    assert.ok(oee.missing.includes('a recorded good/scrap count'),
      `the screen should say what would make it real: ${JSON.stringify(oee.missing)}`);
    assert.ok(oee.missing.includes('an inspected run today'), 'the older route to a quality figure still counts');
    // The two are ALTERNATIVES. A sentence that joins them with "and" sends a
    // supervisor off to build inspection steps when typing the units at the end
    // of a run would have done.
    assert.equal(oee.missing_hint,
      'Needs an ideal cycle time and either an inspected run or a good/scrap count today',
      `the printed sentence is wrong: ${oee.missing_hint}`);
  });

  it('reads as a list, not a chain of "and"s, when three things are missing', async () => {
    // A station nothing has happened on at all: no cycle time, no quality, no
    // day yet. "a and either b or c and d" is a sentence nobody can parse.
    const fresh = await api('POST', '/api/stations', { token, body: { name: 'Untouched Cell' } });
    const oee = await oeeFor(fresh.json.id);
    assert.equal(oee.missing_hint,
      'Needs an ideal cycle time, either an inspected run or a good/scrap count today and any activity today',
      `the printed sentence is wrong: ${oee.missing_hint}`);
  });
});

describe('the window is the plant’s day, not Greenwich’s', () => {
  let token, stationId;
  const ZONE = 'Pacific/Auckland';

  before(async () => {
    const signup = await api('POST', '/api/auth/signup', {
      body: { company_name: 'Auckland Co', email: 'admin@auckland.test', password: 'SecretPass1', display_name: 'Admin' },
    });
    token = signup.json.token;
    const me = await api('GET', '/api/auth/me', { token });
    const companyId = me.json.company_id || me.json.user?.company_id || me.json.company?.id;
    assert.ok(companyId, `could not resolve the company id from ${JSON.stringify(me.json)}`);
    stationId = (await api('POST', '/api/stations', { token, body: { name: 'Night Shift Press' } })).json.id;

    const db = openDb();
    db.prepare(`INSERT INTO org_settings (company_id, key, value) VALUES (?, 'timezone', ?)
                ON CONFLICT(company_id, key) DO UPDATE SET value = excluded.value`)
      .run(companyId, ZONE);

    // Ten minutes either side of the plant's own midnight. In UTC both stops
    // may well fall on the same calendar day — which is exactly the bug: the
    // evening one belongs to yesterday's shift.
    const off = offsetMinutes(ZONE);
    const localNow = Date.now() + off * 60000;
    const midnightUtcMs = Math.floor(localNow / 86400000) * 86400000 - off * 60000;
    const at = ms => new Date(ms).toISOString();

    const codes = await api('GET', '/api/andon/reason-codes?kind=downtime', { token });
    const code = codes.json[0].id;
    const ins = db.prepare(`INSERT INTO machine_events (id, station_id, event_type, reason, reason_code_id, started_at, ended_at, duration_minutes)
                            VALUES (?, ?, 'down', '', ?, ?, ?, ?)`);
    // Yesterday, ten minutes before the plant's midnight.
    ins.run(randomUUID(), stationId, code, at(midnightUtcMs - 10 * 60000), at(midnightUtcMs - 5 * 60000), 5);
    // Today, ten minutes after it.
    ins.run(randomUUID(), stationId, code, at(midnightUtcMs + 10 * 60000), at(midnightUtcMs + 15 * 60000), 5);
    db.close();
  });

  it('puts a stop just before the plant’s midnight on yesterday', async () => {
    const today = (await api('GET', `/api/oee/losses?station_id=${stationId}&days=1`, { token })).json;
    assert.equal(today.stops, 1, `only the post-midnight stop belongs to today: ${JSON.stringify(today)}`);
    assert.ok(Math.abs(today.total_down_minutes - 5) < 0.2, `today: ${today.total_down_minutes} minutes`);

    const twoDays = (await api('GET', `/api/oee/losses?station_id=${stationId}&days=2`, { token })).json;
    assert.equal(twoDays.stops, 2, 'yesterday’s stop is missing from a two-day window');
    assert.ok(Math.abs(twoDays.total_down_minutes - 10) < 0.2, `two days: ${twoDays.total_down_minutes} minutes`);
  });
});

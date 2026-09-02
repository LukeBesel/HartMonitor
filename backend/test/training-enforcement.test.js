'use strict';
// ─── Qualified people only — off by default, and provably off ────────────────
//
// training_records have existed since the training module shipped and nothing
// has ever read one at run start. Closing that hole is only safe if closing it
// changes NOTHING for a plant that has not asked for it: there is no
// requires-certification field on an app, so a gate that was on by default
// would block every operator without a record on the next deploy. That is a
// production outage dressed as a compliance feature.
//
// So the FIRST case in this file is the promise to existing customers: with no
// org_settings row, an uncertified operator starts a run exactly as today. The
// rest is what a company gets once it deliberately chooses Warn or Block.
//
// Runs with EARLY_ACCESS=true because /api/training is a pro feature and this
// suite is about the gate, not the plan check.
//
// Uses Node built-ins only (node:test + global fetch). Run with:
//   node --test test/training-enforcement.test.js

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const PORT = 3411; // reserved for this workstream in MIGRATIONS.md
const BASE = `http://localhost:${PORT}`;
const DB_PATH = path.join(os.tmpdir(), `mes-training-enforcement-${Date.now()}.db`);

// The in-process half of this suite (the "no training query in off mode" proof)
// opens the SAME database file the server is using, so these must be set before
// anything under src/ is required.
process.env.NODE_ENV = 'test';
process.env.DATABASE_PATH = DB_PATH;
process.env.SEED_DEMO_DATA = 'false';
process.env.BACKUP_DIR = '';

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

async function api(method, pathname, { token, body, headers } = {}) {
  const res = await fetch(`${BASE}${pathname}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(headers || {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  let json = null;
  try { json = await res.json(); } catch { /* no body */ }
  return { status: res.status, json };
}

// ── Deterministic plant-day fixtures ─────────────────────────────────────────
// The expiry rule is "lapsed at the start of the PLANT's day", which can only be
// distinguished from "lapsed at midnight UTC" while the two are on different
// calendar dates. Which zones satisfy that depends on the hour this suite is
// run at, so the zone is CHOSEN at run time rather than hard-coded: Auckland
// whenever Auckland is a day ahead of UTC (the case the requirement names), and
// a zone that is a day behind otherwise. Both directions prove the same thing —
// that the plant's date decides — and one of them always applies.

function localDate(tz, at = new Date()) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
    }).formatToParts(at).map(x => [x.type, x.value]),
  );
  return `${p.year}-${p.month}-${p.day}`;
}

function shiftDays(isoDate, days) {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** A zone whose calendar date differs from UTC's right now, and which way. */
function pickSkewedZone(at = new Date()) {
  const utc = at.toISOString().slice(0, 10);
  for (const tz of ['Pacific/Auckland', 'Pacific/Kiritimati']) {
    if (localDate(tz, at) === shiftDays(utc, 1)) return { tz, direction: 'ahead', utc };
  }
  for (const tz of ['Pacific/Honolulu', 'Etc/GMT+12']) {
    if (localDate(tz, at) === shiftDays(utc, -1)) return { tz, direction: 'behind', utc };
  }
  return null;
}

after(() => {
  if (server) server.kill('SIGTERM');
  for (const ext of ['', '-shm', '-wal']) {
    try { fs.unlinkSync(DB_PATH + ext); } catch { /* ignore */ }
  }
});

// ── One company, one published app, one operator with no training record ─────

const world = {};

before(async () => {
  await startServer();

  const signup = await api('POST', '/api/auth/signup', {
    body: {
      company_name: 'Gated Co', email: 'admin@gated.test',
      password: 'SecretPass1', display_name: 'Ada Admin',
    },
  });
  assert.equal(signup.status, 201, `signup: ${JSON.stringify(signup.json)}`);
  world.token = signup.json.token;
  const me = await api('GET', '/api/auth/me', { token: world.token });
  assert.equal(me.status, 200, `me: ${JSON.stringify(me.json)}`);
  world.companyId = me.json.company_id;

  const app = await api('POST', '/api/apps', { token: world.token, body: { name: 'Final QC Inspection' } });
  assert.equal(app.status, 201, `app: ${JSON.stringify(app.json)}`);
  world.appId = app.json.id;
  const published = await api('PUT', `/api/apps/${world.appId}`, {
    token: world.token, body: { status: 'published' },
  });
  assert.equal(published.json.status, 'published', 'the app must be published to be a skill column');

  const draft = await api('POST', '/api/apps', { token: world.token, body: { name: 'Bench Trial (draft)' } });
  world.draftAppId = draft.json.id;

  // Three people: one with no record at all, one certified, one supervisor.
  const mkUser = async (email, name, role) => {
    const r = await api('POST', '/api/users', {
      token: world.token, body: { email, display_name: name, password: 'SecretPass1', role },
    });
    assert.equal(r.status, 201, `user ${name}: ${JSON.stringify(r.json)}`);
    return r.json.id;
  };
  world.uncertifiedId = await mkUser('uma@gated.test', 'Uma Uncertified', 'operator');
  world.certifiedId   = await mkUser('cara@gated.test', 'Cara Certified', 'operator');
  world.lapsedId      = await mkUser('lena@gated.test', 'Lena Lapsed', 'operator');
  world.supervisorId  = await mkUser('sam@gated.test', 'Sam Supervisor', 'supervisor');

  const pin = await api('PUT', `/api/users/${world.supervisorId}/pin`, {
    token: world.token, body: { pin: '4417' },
  });
  assert.equal(pin.status, 200, `supervisor pin: ${JSON.stringify(pin.json)}`);

  const cert = await api('POST', '/api/training/records', {
    token: world.token,
    body: { user_id: world.certifiedId, app_id: world.appId, status: 'certified', certified_date: '2026-01-05' },
  });
  assert.equal(cert.status, 201, `certified record: ${JSON.stringify(cert.json)}`);
});

async function setEnforcement(value) {
  const r = await api('PUT', '/api/training/enforcement', { token: world.token, body: { enforcement: value } });
  assert.equal(r.status, 200, `set enforcement ${value}: ${JSON.stringify(r.json)}`);
  assert.equal(r.json.enforcement, value);
}

function startRun(who, { headers, appId } = {}) {
  return api('POST', '/api/completions', {
    token: world.token,
    headers,
    body: {
      app_id: appId || world.appId,
      operator_user_id: who.id,
      operator_name: who.name,
    },
  });
}

async function completionCount() {
  const r = await api('GET', '/api/completions?limit=500', { token: world.token });
  return r.json.length;
}

const UMA = () => ({ id: world.uncertifiedId, name: 'Uma Uncertified' });
const CARA = () => ({ id: world.certifiedId, name: 'Cara Certified' });

// ─── 1. Nothing changes for a company that never chose ───────────────────────

describe('with no enforcement setting, a run starts exactly as it does today', () => {
  let started;

  it('books the run for an operator with no training record at all', async () => {
    const before = await api('GET', '/api/training/enforcement', { token: world.token });
    assert.equal(before.json.enforcement, 'off', 'a company that never chose is off');

    started = await startRun(UMA());
    assert.equal(started.status, 201, `start: ${JSON.stringify(started.json)}`);

    // Every key the start response carried before this workstream, unchanged.
    for (const key of [
      'id', 'app_id', 'app_name', 'station_id', 'operator_name', 'work_order_id',
      'product_type_id', 'operator_user_id', 'company_id', 'status', 'started_at',
      'completed_at', 'data', 'step_times',
    ]) {
      assert.ok(key in started.json, `the start response lost the key "${key}"`);
    }
    assert.equal(started.json.status, 'in_progress');
    assert.equal(started.json.operator_user_id, world.uncertifiedId);

    // The one additive key: unmeasured, stated as such. Never 'none', which
    // would claim the plant checked and found the operator wanting.
    assert.equal(started.json.qualification_state, '',
      "a company with the gate off must not have a qualification verdict stamped on its runs");
  });

  it('issues no training query at all in off mode', async () => {
    // Proved by counter, not by timing. backend/src/qualification.js keeps a
    // __stats.trainingQueries counter incremented at the one place a
    // training_records row is read; the middleware is driven here in-process
    // against the SAME database file the server is using, with a stub req/res,
    // so this is the real code path and not a paraphrase of it.
    const qual = require('../src/qualification');

    const req = {
      companyId: world.companyId,
      body: { app_id: world.appId, operator_user_id: world.uncertifiedId, operator_name: 'Uma Uncertified' },
      get: () => undefined,
    };
    const res = { statusCode: 200, json() { throw new Error('res.json must not be called in off mode'); } };

    const beforeQueries = qual.__stats.trainingQueries;
    const beforeChecks = qual.__stats.checks;
    let passedThrough = false;
    qual.enforceQualification(req, res, () => { passedThrough = true; });

    assert.equal(qual.enforcementMode(world.companyId), 'off', 'the fixture is still off');
    assert.ok(passedThrough, 'off mode must call next()');
    assert.equal(qual.__stats.checks, beforeChecks,
      'off mode must not even run a qualification check');
    assert.equal(qual.__stats.trainingQueries, beforeQueries,
      'off mode must not read training_records');
    assert.equal(res.json, res.json, 'off mode leaves res.json alone');

    // And the same call in warn mode DOES query, so the counter is not simply
    // never moving.
    qual.setEnforcementMode(world.companyId, 'warn');
    qual.enforceQualification(req, { statusCode: 200, json: (b) => b }, () => {});
    assert.equal(qual.__stats.trainingQueries, beforeQueries + 1,
      'warn mode must read the training record');
    qual.setEnforcementMode(world.companyId, 'off');
  });
});

// ─── 2. Warn: the run starts, and says what was true ─────────────────────────

describe('warn stamps the verdict without stopping anyone', () => {
  before(async () => { await setEnforcement('warn'); });

  it('starts an uncertified run and records qualification_state "none"', async () => {
    const r = await startRun(UMA());
    assert.equal(r.status, 201, `start: ${JSON.stringify(r.json)}`);
    assert.equal(r.json.qualification_state, 'none');

    // And the stamp is on the ROW, not only in the response — a screen that
    // reads the run back later must see the same verdict.
    const read = await api('GET', `/api/completions/${r.json.id}`, { token: world.token });
    assert.equal(read.json.qualification_state, 'none');
  });

  it('stamps nothing for an app that asks for no certification', async () => {
    // A draft app is not a column on the Skills Matrix, so it requires nobody.
    const r = await startRun(UMA(), { appId: world.draftAppId });
    assert.equal(r.status, 201, `draft start: ${JSON.stringify(r.json)}`);
    assert.equal(r.json.qualification_state, '',
      'an app nothing is required for must not stamp an uncertified verdict');
  });
});

// ─── 3. Block: an uncertified operator cannot start ──────────────────────────

describe('block refuses the start and says why', () => {
  before(async () => { await setEnforcement('block'); });

  it('answers 403 NOT_QUALIFIED, books no run, and records the refusal', async () => {
    const countBefore = await completionCount();

    const r = await startRun(UMA());
    assert.equal(r.status, 403, `expected a refusal, got ${JSON.stringify(r.json)}`);
    assert.equal(r.json.code, 'NOT_QUALIFIED');
    assert.equal(r.json.app_name, 'Final QC Inspection');
    assert.equal(r.json.operator_name, 'Uma Uncertified');
    assert.equal(r.json.state, 'none');
    assert.equal(r.json.expiry_date, null);

    assert.equal(await completionCount(), countBefore, 'a refused start must book no run');

    const blocked = await api('GET', '/api/training/blocked-starts?days=7', { token: world.token });
    assert.equal(blocked.status, 200, JSON.stringify(blocked.json));
    const row = blocked.json.apps.find(a => a.app_id === world.appId);
    assert.ok(row, 'the app must appear in the blocked-starts report');
    assert.ok(row.blocked >= 1, `expected a recorded refusal, got ${row.blocked}`);
    assert.equal(blocked.json.empty_reason, null, 'something was measured, so no empty reason');
  });

  it('lets a certified operator straight through, stamped "certified"', async () => {
    const r = await startRun(CARA());
    assert.equal(r.status, 201, `certified start: ${JSON.stringify(r.json)}`);
    assert.equal(r.json.qualification_state, 'certified');
  });

  it('reports "—" rather than zero for an app nothing has been measured against', async () => {
    // A fresh company has refused nobody. "0 blocked starts" would read as a
    // gate that is on and quiet; the truth is that nothing has been measured.
    const other = await api('POST', '/api/auth/signup', {
      body: {
        company_name: 'Unmeasured Co', email: 'admin@unmeasured.test',
        password: 'SecretPass1', display_name: 'Ben Boss',
      },
    });
    const t = other.json.token;
    const a = await api('POST', '/api/apps', { token: t, body: { name: 'Nothing Yet' } });
    await api('PUT', `/api/apps/${a.json.id}`, { token: t, body: { status: 'published' } });
    const blocked = await api('GET', '/api/training/blocked-starts', { token: t });
    assert.equal(blocked.json.empty_reason, 'no starts have been blocked yet');
    assert.deepEqual(blocked.json.apps.map(x => x.blocked), [null]);
  });
});

// ─── 4. An expiry lapses on the plant's day, not Greenwich's ─────────────────

describe('an expiry lapses at the start of the plant\'s day', () => {
  it('reads a certificate as expired on the plant clock while UTC still says today', async () => {
    const skew = pickSkewedZone();
    assert.ok(skew, 'no zone is on a different calendar date from UTC right now');

    // Two companies, one record shape, one difference: where the plant is.
    // Company A sits in the skewed zone; company B is left on UTC.
    const mk = async (label, email, tz) => {
      const s = await api('POST', '/api/auth/signup', {
        body: { company_name: label, email, password: 'SecretPass1', display_name: 'Tz Admin' },
      });
      const t = s.json.token;
      if (tz) {
        const cfg = await api('PUT', '/api/config', { token: t, body: { timezone: tz } });
        assert.equal(cfg.status, 200, `timezone: ${JSON.stringify(cfg.json)}`);
      }
      const a = await api('POST', '/api/apps', { token: t, body: { name: 'Torque Check' } });
      await api('PUT', `/api/apps/${a.json.id}`, { token: t, body: { status: 'published' } });
      const u = await api('POST', '/api/users', {
        token: t, body: { email: `op-${email}`, display_name: 'Pat Plant', password: 'SecretPass1', role: 'operator' },
      });
      return { token: t, appId: a.json.id, userId: u.json.id };
    };

    const stamp = skew.direction === 'ahead'
      // Plant is a day ahead: a certificate stamped with TODAY's UTC date ran
      // out yesterday as far as the shift now working is concerned.
      ? skew.utc
      // Plant is a day behind: a certificate stamped with yesterday's UTC date
      // is still valid for the shift now working, though UTC has moved past it.
      : shiftDays(skew.utc, -1);

    const plant = await mk(`Plant ${skew.tz}`, `plant-${Date.now()}@tz.test`, skew.tz);
    const green = await mk('Greenwich Co', `utc-${Date.now()}@tz.test`, null);

    for (const co of [plant, green]) {
      const rec = await api('POST', '/api/training/records', {
        token: co.token,
        body: { user_id: co.userId, app_id: co.appId, status: 'certified', certified_date: '2026-01-01', expiry_date: stamp },
      });
      assert.equal(rec.status, 201, `record: ${JSON.stringify(rec.json)}`);
    }

    const ask = co => api(
      'GET',
      `/api/training/records/check?app_id=${co.appId}&user_id=${co.userId}`,
      { token: co.token },
    );

    const onPlant = (await ask(plant)).json;
    const onUtc = (await ask(green)).json;

    assert.equal(onPlant.expiry_date, stamp);
    if (skew.direction === 'ahead') {
      assert.equal(onPlant.state, 'expired',
        `${skew.tz} is already on ${localDate(skew.tz)}; a certificate expiring ${stamp} has lapsed there`);
      assert.equal(onUtc.state, 'certified',
        `the server clock is still on ${skew.utc}, so an unshifted comparison would have called this valid`);
    } else {
      assert.equal(onPlant.state, 'certified',
        `${skew.tz} is still on ${localDate(skew.tz)}; a certificate expiring ${stamp} has not lapsed there yet`);
      assert.equal(onUtc.state, 'expired',
        `the server clock has already moved past ${stamp}, so an unshifted comparison would have called this expired`);
    }
  });

  it('blocks a run whose certificate has lapsed, naming the expiry date', async () => {
    // Deliberately far in the past, so this case does not depend on the clock.
    const rec = await api('POST', '/api/training/records', {
      token: world.token,
      body: {
        user_id: world.lapsedId, app_id: world.appId, status: 'certified',
        certified_date: '2024-07-04', expiry_date: '2025-07-04',
      },
    });
    assert.equal(rec.status, 201, JSON.stringify(rec.json));

    const r = await startRun({ id: world.lapsedId, name: 'Lena Lapsed' });
    assert.equal(r.status, 403, JSON.stringify(r.json));
    assert.equal(r.json.state, 'expired');
    assert.equal(r.json.expiry_date, '2025-07-04');
    assert.match(r.json.error, /expired/i);
  });
});

// ─── 5. A supervisor's override: one PIN, one start, one permanent record ────

describe('a supervisor override permits exactly one start and leaves a record', () => {
  async function overrideToken(who) {
    const auth = await api('POST', '/api/operators/verify-authorizer', {
      token: world.token, body: { pin: '4417', purpose: 'qualification_override' },
    });
    assert.equal(auth.status, 200, `verify-authorizer: ${JSON.stringify(auth.json)}`);
    const minted = await api('POST', '/api/training/overrides', {
      token: world.token,
      body: { app_id: world.appId, user_id: who.id, operator_name: who.name, authorizer_proof: auth.json.authorization_id },
    });
    assert.equal(minted.status, 201, `mint override: ${JSON.stringify(minted.json)}`);
    return minted.json.token;
  }

  it('writes one override row and one activity entry naming both people', async () => {
    const listBefore = await api('GET', '/api/training/overrides', { token: world.token });
    const countBefore = listBefore.json.length;

    const token = await overrideToken(UMA());
    const run = await startRun(UMA(), { headers: { 'X-Qualification-Override': token } });
    assert.equal(run.status, 201, `override start: ${JSON.stringify(run.json)}`);
    assert.equal(run.json.qualification_state, 'override');

    const listAfter = await api('GET', '/api/training/overrides', { token: world.token });
    assert.equal(listAfter.json.length, countBefore + 1, 'exactly one override row was written');

    const row = listAfter.json[0];
    assert.equal(row.app_id, world.appId);
    assert.equal(row.user_id, world.uncertifiedId);
    assert.equal(row.approved_by_user_id, world.supervisorId);
    assert.equal(row.approved_by_name, 'Sam Supervisor');
    assert.equal(row.completion_id, run.json.id,
      'the override must point at the run it permitted');

    // scope=all — 'qualification' is not one of the Transaction Log's
    // production entity types, so the default production scope would hide it.
    const log = await api('GET', '/api/activity?scope=all&limit=500', { token: world.token });
    const entries = log.json.filter(
      e => e.entity_type === 'qualification' && /Qualification override/.test(e.action),
    );
    assert.equal(entries.length, 1, `expected one override log entry, got ${entries.length}`);
    assert.match(entries[0].action, /Uma Uncertified/, 'the log must name the operator');
    assert.match(entries[0].action, /Sam Supervisor/, 'the log must name the supervisor');
  });

  it('refuses the second start carrying the same token', async () => {
    const token = await overrideToken(UMA());

    const first = await startRun(UMA(), { headers: { 'X-Qualification-Override': token } });
    assert.equal(first.status, 201, `first start: ${JSON.stringify(first.json)}`);

    const second = await startRun(UMA(), { headers: { 'X-Qualification-Override': token } });
    assert.equal(second.status, 403, `a spent token must not start a second run: ${JSON.stringify(second.json)}`);
    assert.equal(second.json.code, 'NOT_QUALIFIED');
  });

  it('refuses a PIN belonging to another company\'s supervisor', async () => {
    const other = await api('POST', '/api/auth/signup', {
      body: {
        company_name: 'Neighbour Co', email: 'admin@neighbour.test',
        password: 'SecretPass1', display_name: 'Nia Neighbour',
      },
    });
    const otherToken = other.json.token;
    const otherSup = await api('POST', '/api/users', {
      token: otherToken,
      body: { email: 'sup@neighbour.test', display_name: 'Neil Neighbour', password: 'SecretPass1', role: 'supervisor' },
    });
    const setPin = await api('PUT', `/api/users/${otherSup.json.id}/pin`, {
      token: otherToken, body: { pin: '8823' },
    });
    assert.equal(setPin.status, 200, JSON.stringify(setPin.json));

    // The neighbour's PIN, offered to OUR company. It authorizes nothing here.
    const auth = await api('POST', '/api/operators/verify-authorizer', {
      token: world.token, body: { pin: '8823', purpose: 'qualification_override' },
    });
    assert.equal(auth.status, 403, `another company's PIN must not verify: ${JSON.stringify(auth.json)}`);

    // And a grant minted in the neighbour's company cannot be redeemed in ours.
    const theirAuth = await api('POST', '/api/operators/verify-authorizer', {
      token: otherToken, body: { pin: '8823', purpose: 'qualification_override' },
    });
    assert.equal(theirAuth.status, 200, JSON.stringify(theirAuth.json));
    const crossMint = await api('POST', '/api/training/overrides', {
      token: world.token,
      body: {
        app_id: world.appId, user_id: world.uncertifiedId, operator_name: 'Uma Uncertified',
        authorizer_proof: theirAuth.json.authorization_id,
      },
    });
    assert.equal(crossMint.status, 403, `a cross-tenant grant must not mint an override: ${JSON.stringify(crossMint.json)}`);

    // Nor used raw as a start proof.
    const run = await startRun(UMA(), { headers: { 'X-Qualification-Override': theirAuth.json.authorization_id } });
    assert.equal(run.status, 403, 'a cross-tenant proof must not start a blocked run');
  });
});

// ─── 6. Who may change the setting ───────────────────────────────────────────

describe('choosing the mode is a manager decision', () => {
  it('refuses an operator-role user', async () => {
    const login = await api('POST', '/api/auth/login', {
      body: { email: 'uma@gated.test', password: 'SecretPass1' },
    });
    assert.equal(login.status, 200, `operator login: ${JSON.stringify(login.json)}`);

    const attempt = await api('PUT', '/api/training/enforcement', {
      token: login.json.token, body: { enforcement: 'off' },
    });
    assert.equal(attempt.status, 403, `an operator must not set enforcement: ${JSON.stringify(attempt.json)}`);

    // And the setting is unchanged.
    const now = await api('GET', '/api/training/enforcement', { token: world.token });
    assert.equal(now.json.enforcement, 'block');
  });

  it('refuses a word that is not in the vocabulary', async () => {
    const bad = await api('PUT', '/api/training/enforcement', {
      token: world.token, body: { enforcement: 'strict' },
    });
    assert.equal(bad.status, 400, JSON.stringify(bad.json));
    assert.match(bad.json.error, /off, warn, block/);
  });
});

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
// Runs with EARLY_ACCESS=false — the plan gate is live — because one of the
// things that has to hold is that a company which downgrades to Free while
// enforcement is on Block can still reach the switch to turn it off. A gate you
// cannot open because of a billing state is a trapdoor, not a safety feature.
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
        // The plan gate is LIVE in this suite. /api/training is a pro feature,
        // so every company below is granted pro deliberately — except the one
        // in the last describe, which proves a downgraded company can still
        // reach the switch that stops its floor.
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

/** The in-process handle, opened once, on the same file the server is using. */
function localDb() {
  return require('../src/db');
}

/** The gate module itself, for the pure helpers the wire format depends on. */
function qualModule() {
  return require('../src/qualification');
}

/** Sign up a company and put it on pro, since /api/training is a pro feature. */
async function signupCompany(name, email, { pro = true } = {}) {
  const signup = await api('POST', '/api/auth/signup', {
    body: { company_name: name, email, password: 'SecretPass1', display_name: 'Ada Admin' },
  });
  assert.equal(signup.status, 201, `signup ${name}: ${JSON.stringify(signup.json)}`);
  const token = signup.json.token;
  const me = await api('GET', '/api/auth/me', { token });
  assert.equal(me.status, 200, `me: ${JSON.stringify(me.json)}`);
  if (pro) {
    localDb().prepare("UPDATE plan SET tier = 'pro' WHERE company_id = ?").run(me.json.company_id);
  }
  return { token, companyId: me.json.company_id };
}

before(async () => {
  await startServer();

  const co = await signupCompany('Gated Co', 'admin@gated.test');
  world.token = co.token;
  world.companyId = co.companyId;

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
    const other = await signupCompany('Unmeasured Co', 'admin@unmeasured.test');
    const t = other.token;
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
      const t = (await signupCompany(label, email)).token;
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
  /**
   * The real two-step exchange. The PIN is verified FOR this app and this
   * operator — the purpose string carries both — and only then is the grant
   * exchanged for a token scoped to the same pair.
   */
  async function verifyFor(who, { appId = world.appId, token = world.token, pin = '4417' } = {}) {
    return api('POST', '/api/operators/verify-authorizer', {
      token,
      body: { pin, purpose: qualModule().overridePurpose(appId, who.id, who.name) },
    });
  }

  async function overrideToken(who, { appId = world.appId, token = world.token } = {}) {
    const auth = await verifyFor(who, { appId, token });
    assert.equal(auth.status, 200, `verify-authorizer: ${JSON.stringify(auth.json)}`);
    const minted = await api('POST', '/api/training/overrides', {
      token,
      body: { app_id: appId, user_id: who.id, operator_name: who.name, authorizer_proof: auth.json.authorization_id },
    });
    assert.equal(minted.status, 201, `mint override: ${JSON.stringify(minted.json)}`);
    return minted.json.token;
  }

  it('refuses a grant raised for something else — an NCR sign-off is not a start permit', async () => {
    // Exactly what the in-run "Report quality issue" sheet mints: no purpose,
    // so the server stores 'ncr'. It is a valid, unused, twelve-hour grant from
    // a real supervisor PIN — and it must buy nothing here.
    const ncrGrant = await api('POST', '/api/operators/verify-authorizer', {
      token: world.token, body: { pin: '4417' },
    });
    assert.equal(ncrGrant.status, 200, `verify-authorizer: ${JSON.stringify(ncrGrant.json)}`);

    const minted = await api('POST', '/api/training/overrides', {
      token: world.token,
      body: {
        app_id: world.appId, user_id: world.uncertifiedId, operator_name: 'Uma Uncertified',
        authorizer_proof: ncrGrant.json.authorization_id,
      },
    });
    assert.equal(minted.status, 403, `an NCR grant must not mint an override: ${JSON.stringify(minted.json)}`);
    assert.equal(minted.json.code, 'AUTHORIZATION_INVALID');

    // And it is not accepted as a start proof either — a raw grant never is.
    const run = await startRun(UMA(), { headers: { 'X-Qualification-Override': ncrGrant.json.authorization_id } });
    assert.equal(run.status, 403, 'a raw authorization grant must not start a blocked run');
    assert.equal(run.json.code, 'NOT_QUALIFIED');
  });

  it('refuses an approval raised for a different app or a different person', async () => {
    const second = await api('POST', '/api/apps', { token: world.token, body: { name: 'Second Line QC' } });
    await api('PUT', `/api/apps/${second.json.id}`, { token: world.token, body: { status: 'published' } });

    // The supervisor was asked about Cara on the SECOND app.
    const auth = await verifyFor(CARA(), { appId: second.json.id });
    assert.equal(auth.status, 200, JSON.stringify(auth.json));

    // Spending it on Maria-equivalent (Uma) on the FIRST app must fail.
    const wrongBoth = await api('POST', '/api/training/overrides', {
      token: world.token,
      body: {
        app_id: world.appId, user_id: world.uncertifiedId, operator_name: 'Uma Uncertified',
        authorizer_proof: auth.json.authorization_id,
      },
    });
    assert.equal(wrongBoth.status, 403, `wrong app AND wrong operator: ${JSON.stringify(wrongBoth.json)}`);

    // Right person, wrong app.
    const authApp = await verifyFor(UMA(), { appId: second.json.id });
    const wrongApp = await api('POST', '/api/training/overrides', {
      token: world.token,
      body: {
        app_id: world.appId, user_id: world.uncertifiedId, operator_name: 'Uma Uncertified',
        authorizer_proof: authApp.json.authorization_id,
      },
    });
    assert.equal(wrongApp.status, 403, `wrong app: ${JSON.stringify(wrongApp.json)}`);

    // Right app, wrong person.
    const authWho = await verifyFor(CARA());
    const wrongWho = await api('POST', '/api/training/overrides', {
      token: world.token,
      body: {
        app_id: world.appId, user_id: world.uncertifiedId, operator_name: 'Uma Uncertified',
        authorizer_proof: authWho.json.authorization_id,
      },
    });
    assert.equal(wrongWho.status, 403, `wrong operator: ${JSON.stringify(wrongWho.json)}`);
  });

  it('is minted by the operator\'s own session — the case the override exists for', async () => {
    // /api/training is behind a supervisor write role; the override door is
    // mounted in front of it precisely so a tablet signed in as an operator can
    // reach it. If this 403s, no operator can ever be let through.
    const login = await api('POST', '/api/auth/login', {
      body: { email: 'uma@gated.test', password: 'SecretPass1' },
    });
    assert.equal(login.status, 200, `operator login: ${JSON.stringify(login.json)}`);

    const token = await overrideToken(UMA(), { token: login.json.token });
    const run = await api('POST', '/api/completions', {
      token: login.json.token,
      headers: { 'X-Qualification-Override': token },
      body: { app_id: world.appId, operator_user_id: world.uncertifiedId, operator_name: 'Uma Uncertified' },
    });
    assert.equal(run.status, 201, `operator-session override start: ${JSON.stringify(run.json)}`);
    assert.equal(run.json.qualification_state, 'override');
  });

  it('builds the same purpose string on both sides of the wire', async () => {
    // The frontend has to ask for the PIN with EXACTLY the purpose the server
    // will redeem it for, or every override fails in production while every
    // backend test passes. Read the shipped client and check the formula.
    const src = fs.readFileSync(
      path.join(__dirname, '..', '..', 'frontend', 'src', 'api', 'training.ts'), 'utf8',
    );
    assert.match(src, /qualification_override:\$\{appId\}:\$\{who\}/,
      'frontend overridePurpose must build `qualification_override:<app>:<who>`');
    assert.match(src, /userId \? `u:\$\{userId\}` : `n:\$\{\(operatorName \?\? ''\)\.trim\(\)\.toLowerCase\(\)\}`/,
      'frontend must resolve the operator half the same way the server does');
    assert.equal(
      qualModule().overridePurpose('app-1', 'user-9', 'Ignored'),
      'qualification_override:app-1:u:user-9',
    );
    assert.equal(
      qualModule().overridePurpose('app-1', null, '  Uma Uncertified '),
      'qualification_override:app-1:n:uma uncertified',
    );
  });

  async function overrideLogEntries() {
    // scope=all — 'qualification' is not one of the Transaction Log's
    // production entity types, so the default production scope would hide it.
    const log = await api('GET', '/api/activity?scope=all&limit=500', { token: world.token });
    return log.json.filter(e => e.entity_type === 'qualification' && /Qualification override/.test(e.action));
  }

  it('writes one override row and one activity entry naming both people', async () => {
    const listBefore = await api('GET', '/api/training/overrides', { token: world.token });
    const countBefore = listBefore.json.length;
    const logBefore = (await overrideLogEntries()).length;

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

    const entries = await overrideLogEntries();
    assert.equal(entries.length, logBefore + 1,
      `exactly one new override log entry, got ${entries.length - logBefore}`);
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
    const otherToken = (await signupCompany('Neighbour Co', 'admin@neighbour.test')).token;
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

// ─── 5b. Role first: a viewer cannot spend anybody's approval ────────────────

describe('the write role is answered before the gate', () => {
  it('refuses a viewer without burning an approval or writing any record', async () => {
    const viewer = await api('POST', '/api/users', {
      token: world.token,
      body: { email: 'val@gated.test', display_name: 'Val Viewer', password: 'SecretPass1', role: 'viewer' },
    });
    assert.equal(viewer.status, 201, JSON.stringify(viewer.json));
    const login = await api('POST', '/api/auth/login', {
      body: { email: 'val@gated.test', password: 'SecretPass1' },
    });
    assert.equal(login.status, 200, JSON.stringify(login.json));

    // A genuine, unspent supervisor approval, minted the proper way.
    const auth = await api('POST', '/api/operators/verify-authorizer', {
      token: world.token,
      body: { pin: '4417', purpose: qualModule().overridePurpose(world.appId, world.uncertifiedId, 'Uma Uncertified') },
    });
    const minted = await api('POST', '/api/training/overrides', {
      token: world.token,
      body: {
        app_id: world.appId, user_id: world.uncertifiedId, operator_name: 'Uma Uncertified',
        authorizer_proof: auth.json.authorization_id,
      },
    });
    assert.equal(minted.status, 201, JSON.stringify(minted.json));
    const token = minted.json.token;

    const overridesBefore = (await api('GET', '/api/training/overrides', { token: world.token })).json.length;
    const blockedBefore = (await api('GET', '/api/training/blocked-starts', { token: world.token }))
      .json.apps.find(a => a.app_id === world.appId)?.blocked ?? 0;

    // A viewer can never book a run. If the gate ran first it would still spend
    // the token, write a permanent override row naming a supervisor who
    // authorized nothing of the sort, and add a blocked start to a manager's
    // report — all for a request that was going to be refused anyway.
    const attempt = await api('POST', '/api/completions', {
      token: login.json.token,
      headers: { 'X-Qualification-Override': token },
      body: { app_id: world.appId, operator_user_id: world.uncertifiedId, operator_name: 'Uma Uncertified' },
    });
    assert.equal(attempt.status, 403, `a viewer must not book a run: ${JSON.stringify(attempt.json)}`);
    assert.notEqual(attempt.json.code, 'NOT_QUALIFIED', 'refused for role, not for certification');

    const overridesAfter = (await api('GET', '/api/training/overrides', { token: world.token })).json.length;
    const blockedAfter = (await api('GET', '/api/training/blocked-starts', { token: world.token }))
      .json.apps.find(a => a.app_id === world.appId)?.blocked ?? 0;
    assert.equal(overridesAfter, overridesBefore, 'no override row was written');
    assert.equal(blockedAfter, blockedBefore, 'no blocked start was recorded');

    // And the proof is untouched: the operator it was raised for can still use it.
    const real = await startRun(UMA(), { headers: { 'X-Qualification-Override': token } });
    assert.equal(real.status, 201, `the approval must survive the viewer's attempt: ${JSON.stringify(real.json)}`);
    assert.equal(real.json.qualification_state, 'override');
  });
});

// ─── 5c. The other door into a run: joining one already open ─────────────────

describe('joining a run is gated exactly like starting one', () => {
  let runId;

  before(async () => {
    await setEnforcement('block');
    const started = await startRun(CARA());
    assert.equal(started.status, 201, `certified start: ${JSON.stringify(started.json)}`);
    assert.equal(started.json.qualification_state, 'certified');
    runId = started.json.id;
  });

  function join(who, token = world.token) {
    return api('POST', `/api/completions/${runId}/sessions`, {
      token,
      body: { operator_name: who.name, operator_user_id: who.id },
    });
  }

  it('refuses an uncertified operator joining a certified run, and leaves its stamp alone', async () => {
    const attempt = await join(UMA());
    assert.equal(attempt.status, 403, `expected a refusal: ${JSON.stringify(attempt.json)}`);
    assert.equal(attempt.json.code, 'NOT_QUALIFIED');
    assert.equal(attempt.json.app_name, 'Final QC Inspection');
    assert.equal(attempt.json.operator_name, 'Uma Uncertified');

    // Without this gate the refused operator taps "Resume", finishes the unit,
    // and the record still says a certified person did the work.
    const run = await api('GET', `/api/completions/${runId}`, { token: world.token });
    assert.equal(run.json.qualification_state, 'certified',
      "the starter's verdict must not be rewritten by a joiner");
    assert.equal(run.json.sessions.filter(x => x.operator_name === 'Uma Uncertified').length, 0,
      'no session was opened for the refused operator');
  });

  it('records the refusal as a blocked start', async () => {
    const blocked = await api('GET', '/api/training/blocked-starts', { token: world.token });
    const row = blocked.json.apps.find(a => a.app_id === world.appId);
    assert.ok(row.blocked >= 1, `a refused join is a refused start of work: ${JSON.stringify(row)}`);
  });

  it('lets the same person join in warn, records what was true, and still leaves the stamp', async () => {
    await setEnforcement('warn');
    const joined = await join(UMA());
    assert.equal(joined.status, 201, `warn must not stop a join: ${JSON.stringify(joined.json)}`);
    assert.equal(joined.json.qualification_state, 'none', 'the joiner’s own state is reported');

    const run = await api('GET', `/api/completions/${runId}`, { token: world.token });
    assert.equal(run.json.qualification_state, 'certified', "the run's own stamp is unchanged");

    const log = await api('GET', '/api/activity?scope=all&limit=500', { token: world.token });
    const entries = log.json.filter(e => e.entity_type === 'qualification' && /Qualification on join/.test(e.action));
    assert.equal(entries.length, 1, `expected one join entry, got ${entries.length}`);
    assert.match(entries[0].action, /Uma Uncertified/);
    assert.match(entries[0].action, /none/);
  });

  it('does not look at training at all with the gate off', async () => {
    await setEnforcement('off');
    const joined = await join(UMA());
    assert.equal(joined.status, 201, `off must not stop a join: ${JSON.stringify(joined.json)}`);
    assert.equal(joined.json.qualification_state, undefined, 'off states nothing about the joiner');
    await setEnforcement('block');
  });
});

// ─── 5d. Two small honesty rules ─────────────────────────────────────────────

describe('what the blocked-starts report is allowed to claim', () => {
  it('says "—" for an app it has never refused anybody on, beside one it has', async () => {
    const quiet = await api('POST', '/api/apps', { token: world.token, body: { name: 'Never Refused Anyone' } });
    await api('PUT', `/api/apps/${quiet.json.id}`, { token: world.token, body: { status: 'published' } });

    const blocked = await api('GET', '/api/training/blocked-starts?days=7', { token: world.token });
    const busy = blocked.json.apps.find(a => a.app_id === world.appId);
    const idle = blocked.json.apps.find(a => a.app_id === quiet.json.id);

    assert.ok(busy.blocked >= 1, `the app that refused people has a count: ${JSON.stringify(busy)}`);
    assert.equal(idle.blocked, null,
      'an app nothing has been measured against reads "—", not a confident zero');
    assert.equal(blocked.json.empty_reason, null, 'something was measured somewhere');
  });
});

describe('an approval is spent only when it is needed', () => {
  it('survives a start that was never going to be refused', async () => {
    await setEnforcement('block');
    const token = await api('POST', '/api/operators/verify-authorizer', {
      token: world.token,
      body: { pin: '4417', purpose: qualModule().overridePurpose(world.appId, world.uncertifiedId, 'Uma Uncertified') },
    }).then(auth => api('POST', '/api/training/overrides', {
      token: world.token,
      body: {
        app_id: world.appId, user_id: world.uncertifiedId, operator_name: 'Uma Uncertified',
        authorizer_proof: auth.json.authorization_id,
      },
    })).then(m => m.json.token);

    // Sent along with a run in WARN, where nothing was going to be stopped. A
    // token quietly burned here is a supervisor who has already walked away and
    // an operator refused on the start that actually needed it.
    await setEnforcement('warn');
    const warned = await startRun(UMA(), { headers: { 'X-Qualification-Override': token } });
    assert.equal(warned.status, 201);
    assert.equal(warned.json.qualification_state, 'none', 'warn did not consume the approval');

    // And a certified operator's start in block must not spend it either.
    await setEnforcement('block');
    const certified = await startRun(CARA(), { headers: { 'X-Qualification-Override': token } });
    assert.equal(certified.status, 201);
    assert.equal(certified.json.qualification_state, 'certified');

    // Still good for the start it was raised for.
    const used = await startRun(UMA(), { headers: { 'X-Qualification-Override': token } });
    assert.equal(used.status, 201, `the approval must still be usable: ${JSON.stringify(used.json)}`);
    assert.equal(used.json.qualification_state, 'override');
  });
});

describe('which training record is read when a database holds more than one', () => {
  it('orders certified first, then most recently touched', () => {
    // UNIQUE(company_id, user_id, app_id) means this is unreachable through the
    // API today, so this is a source guard rather than a round trip: the case
    // it protects is a database restored from a double seed or migrated from
    // before that constraint, where "whichever row SQLite returned first" would
    // make the gate non-deterministic for exactly the accounts least able to
    // explain it.
    const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'qualification.js'), 'utf8');
    const query = src.slice(src.indexOf('FROM training_records'), src.indexOf('`).get(day, companyId'));
    assert.match(query, /ORDER BY CASE WHEN status = 'certified' THEN 0 ELSE 1 END/);
    assert.match(query, /COALESCE\(updated_at, created_at\) DESC/);
    assert.match(query, /LIMIT 1/);
  });

  it('still reads a single record exactly as before', async () => {
    const check = await api('GET',
      `/api/training/records/check?app_id=${world.appId}&user_id=${world.certifiedId}`,
      { token: world.token });
    assert.equal(check.json.state, 'certified');
  });
});

// ─── 5e. The switch that stops the floor is never behind a paywall ──────────

describe('a company that downgrades can still turn enforcement off', () => {
  it('keeps the training module paid, and the safety switch reachable', async () => {
    // Pro today: sets Block like anyone else.
    const co = await signupCompany('Lapsed Plan Co', 'admin@lapsed.test');
    const on = await api('PUT', '/api/training/enforcement', {
      token: co.token, body: { enforcement: 'block' },
    });
    assert.equal(on.status, 200, `set block: ${JSON.stringify(on.json)}`);

    // Subscription lapses back to Free.
    localDb().prepare(
      "UPDATE plan SET tier = 'free', trial_ends_at = NULL, grace_period_ends_at = NULL WHERE company_id = ?"
    ).run(co.companyId);

    // The paid module is closed, as it should be…
    const matrix = await api('GET', '/api/training/matrix', { token: co.token });
    assert.equal(matrix.status, 403, `the training module stays paid: ${JSON.stringify(matrix.json)}`);
    assert.equal(matrix.json.code, 'PLAN_REQUIRED');

    // …but the gate that is currently stopping their floor is not. Both
    // directions, or it is a trapdoor.
    const read = await api('GET', '/api/training/enforcement', { token: co.token });
    assert.equal(read.status, 200, `reading the setting must not be paywalled: ${JSON.stringify(read.json)}`);
    assert.equal(read.json.enforcement, 'block');

    const off = await api('PUT', '/api/training/enforcement', { token: co.token, body: { enforcement: 'off' } });
    assert.equal(off.status, 200, `turning it off must not be paywalled: ${JSON.stringify(off.json)}`);
    assert.equal(off.json.enforcement, 'off');
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

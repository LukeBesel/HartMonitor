'use strict';
// ─── Facility shifts + duplicate-name validation tests ─────────────────────────
// Spins up the real server against a throwaway database and verifies:
//   1. site_shifts CRUD on /api/sites/:siteId/shifts (tenant + site-ownership
//      scoped), including overnight spans (ends_at < starts_at) and time/day
//      validation, plus cross-tenant 404s.
//   2. Case-insensitive per-company duplicate-name 409s (per app for product
//      types) on create AND rename for departments, stations, sites, vendors,
//      locations, product types, apps, dashboards, and tables — while the same
//      name stays allowed in a different company.
//
// Uses Node built-ins only (node:test + global fetch). Run with: npm test

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const PORT = 3186;
const BASE = `http://localhost:${PORT}`;
const DB_PATH = path.join(os.tmpdir(), `mes-shifts-validation-${Date.now()}.db`);

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
        // Early access keeps plan gates (pro-only routers, app/dashboard
        // limits) open so vendor/location duplicate checks are reachable.
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

let tokenA, tokenB, siteA, siteB;

before(async () => {
  await startServer();

  const a = await api('POST', '/api/auth/signup', {
    body: { company_name: 'Shifts Co A', email: 'admin@shifts-a.test', password: 'SecretPass1', display_name: 'Admin A' },
  });
  assert.equal(a.status, 201, 'Company A signup failed');
  tokenA = a.json.token;

  const b = await api('POST', '/api/auth/signup', {
    body: { company_name: 'Shifts Co B', email: 'admin@shifts-b.test', password: 'SecretPass2', display_name: 'Admin B' },
  });
  assert.equal(b.status, 201, 'Company B signup failed');
  tokenB = b.json.token;

  // Signup auto-creates a primary "Main Site" for each company.
  const aSites = await api('GET', '/api/sites', { token: tokenA });
  const bSites = await api('GET', '/api/sites', { token: tokenB });
  assert.ok(aSites.json.length >= 1 && bSites.json.length >= 1, 'expected default sites');
  siteA = aSites.json[0].id;
  siteB = bSites.json[0].id;
});

after(() => {
  if (server) server.kill('SIGTERM');
  for (const ext of ['', '-shm', '-wal']) {
    try { fs.unlinkSync(DB_PATH + ext); } catch { /* ignore */ }
  }
});

// ─── Facility shifts CRUD ─────────────────────────────────────────────────────

describe('Facility shifts (site_shifts)', () => {
  let dayShiftId;

  it('creates a shift with name, times, days and color', async () => {
    const r = await api('POST', `/api/sites/${siteA}/shifts`, {
      token: tokenA,
      body: { name: 'Day', starts_at: '06:00', ends_at: '14:00', days: [1, 2, 3, 4, 5], color: '#3b82f6' },
    });
    assert.equal(r.status, 201, JSON.stringify(r.json));
    assert.equal(r.json.name, 'Day');
    assert.equal(r.json.starts_at, '06:00');
    assert.equal(r.json.ends_at, '14:00');
    assert.deepEqual(r.json.days, [1, 2, 3, 4, 5]);
    assert.equal(r.json.color, '#3b82f6');
    assert.equal(r.json.site_id, siteA);
    dayShiftId = r.json.id;
  });

  it('accepts overnight spans where ends_at < starts_at', async () => {
    const r = await api('POST', `/api/sites/${siteA}/shifts`, {
      token: tokenA,
      body: { name: 'Night', starts_at: '22:00', ends_at: '06:00', days: [1, 2, 3, 4, 5] },
    });
    assert.equal(r.status, 201, JSON.stringify(r.json));
    assert.equal(r.json.starts_at, '22:00');
    assert.equal(r.json.ends_at, '06:00');
  });

  it('lists shifts for the site', async () => {
    const r = await api('GET', `/api/sites/${siteA}/shifts`, { token: tokenA });
    assert.equal(r.status, 200);
    assert.equal(r.json.length, 2);
    assert.ok(r.json.every(s => Array.isArray(s.days)), 'days must be returned as arrays');
  });

  it('updates a shift', async () => {
    const r = await api('PUT', `/api/sites/${siteA}/shifts/${dayShiftId}`, {
      token: tokenA,
      body: { name: 'First Shift', starts_at: '05:30', days: [0, 1, 2, 3, 4, 5, 6] },
    });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.equal(r.json.name, 'First Shift');
    assert.equal(r.json.starts_at, '05:30');
    assert.equal(r.json.ends_at, '14:00', 'unchanged field must persist');
    assert.deepEqual(r.json.days, [0, 1, 2, 3, 4, 5, 6]);
  });

  it('rejects a missing name', async () => {
    const r = await api('POST', `/api/sites/${siteA}/shifts`, {
      token: tokenA, body: { starts_at: '06:00', ends_at: '14:00' },
    });
    assert.equal(r.status, 400);
  });

  it('rejects malformed times', async () => {
    for (const bad of [{ starts_at: '25:00', ends_at: '14:00' }, { starts_at: '6:00', ends_at: '14:00' }, { starts_at: '06:00', ends_at: 'nope' }]) {
      const r = await api('POST', `/api/sites/${siteA}/shifts`, {
        token: tokenA, body: { name: `Bad ${bad.starts_at}-${bad.ends_at}`, ...bad },
      });
      assert.equal(r.status, 400, `expected 400 for ${JSON.stringify(bad)}`);
    }
  });

  it('rejects zero-length spans and invalid day masks', async () => {
    const same = await api('POST', `/api/sites/${siteA}/shifts`, {
      token: tokenA, body: { name: 'Zero', starts_at: '08:00', ends_at: '08:00' },
    });
    assert.equal(same.status, 400);

    const badDays = await api('POST', `/api/sites/${siteA}/shifts`, {
      token: tokenA, body: { name: 'Bad Days', starts_at: '08:00', ends_at: '16:00', days: [7] },
    });
    assert.equal(badDays.status, 400);

    const emptyDays = await api('POST', `/api/sites/${siteA}/shifts`, {
      token: tokenA, body: { name: 'No Days', starts_at: '08:00', ends_at: '16:00', days: [] },
    });
    assert.equal(emptyDays.status, 400);
  });

  it('rejects a duplicate shift name within the same facility (case-insensitive)', async () => {
    const r = await api('POST', `/api/sites/${siteA}/shifts`, {
      token: tokenA, body: { name: 'night', starts_at: '23:00', ends_at: '07:00' },
    });
    assert.equal(r.status, 409);
    assert.equal(r.json.error, 'duplicate_name');
  });

  it('cross-tenant: company B cannot read or write company A shifts (404)', async () => {
    const list = await api('GET', `/api/sites/${siteA}/shifts`, { token: tokenB });
    assert.equal(list.status, 404, 'cross-tenant shift list must 404');

    const create = await api('POST', `/api/sites/${siteA}/shifts`, {
      token: tokenB, body: { name: 'Intruder', starts_at: '06:00', ends_at: '14:00' },
    });
    assert.equal(create.status, 404, 'cross-tenant shift create must 404');

    const update = await api('PUT', `/api/sites/${siteA}/shifts/${dayShiftId}`, {
      token: tokenB, body: { name: 'Hijacked' },
    });
    assert.equal(update.status, 404, 'cross-tenant shift update must 404');

    const del = await api('DELETE', `/api/sites/${siteA}/shifts/${dayShiftId}`, { token: tokenB });
    assert.equal(del.status, 404, 'cross-tenant shift delete must 404');
  });

  it('company B can define its own shift with the same name', async () => {
    const r = await api('POST', `/api/sites/${siteB}/shifts`, {
      token: tokenB, body: { name: 'Night', starts_at: '21:00', ends_at: '05:00' },
    });
    assert.equal(r.status, 201, JSON.stringify(r.json));
  });

  it('deletes a shift', async () => {
    const del = await api('DELETE', `/api/sites/${siteA}/shifts/${dayShiftId}`, { token: tokenA });
    assert.equal(del.status, 200);
    const list = await api('GET', `/api/sites/${siteA}/shifts`, { token: tokenA });
    assert.ok(!list.json.some(s => s.id === dayShiftId), 'deleted shift must be gone');
  });
});

// ─── Duplicate name validation ────────────────────────────────────────────────
// For every entity: create → exact duplicate 409 → case-variant 409 → rename
// another record onto the existing name 409 → same name in company B allowed.

function expectDup(r, label) {
  assert.equal(r.status, 409, `${label}: expected 409, got ${r.status} ${JSON.stringify(r.json)}`);
  assert.equal(r.json.error, 'duplicate_name', `${label}: expected duplicate_name error`);
  assert.ok(typeof r.json.message === 'string' && r.json.message.includes('already exists'), `${label}: message should explain the conflict`);
}

describe('Duplicate names', () => {
  it('departments: create + rename 409, other company allowed', async () => {
    const created = await api('POST', '/api/departments', { token: tokenA, body: { name: 'Assembly' } });
    assert.equal(created.status, 201);

    expectDup(await api('POST', '/api/departments', { token: tokenA, body: { name: 'Assembly' } }), 'dept dup');
    const caseDup = await api('POST', '/api/departments', { token: tokenA, body: { name: 'aSSembly' } });
    expectDup(caseDup, 'dept case dup');
    assert.match(caseDup.json.message, /department named/i);

    const other = await api('POST', '/api/departments', { token: tokenA, body: { name: 'Paint' } });
    assert.equal(other.status, 201);
    expectDup(await api('PUT', `/api/departments/${other.json.id}`, { token: tokenA, body: { name: 'assembly' } }), 'dept rename dup');

    // Renaming without changing the name (or only other fields) stays allowed.
    const noop = await api('PUT', `/api/departments/${other.json.id}`, { token: tokenA, body: { name: 'Paint', headcount: 4 } });
    assert.equal(noop.status, 200);

    const inB = await api('POST', '/api/departments', { token: tokenB, body: { name: 'Assembly' } });
    assert.equal(inB.status, 201, 'same name must be allowed in a different company');
  });

  it('stations: create + rename 409, other company allowed', async () => {
    assert.equal((await api('POST', '/api/stations', { token: tokenA, body: { name: 'Station 1' } })).status, 201);
    expectDup(await api('POST', '/api/stations', { token: tokenA, body: { name: 'station 1' } }), 'station dup');

    const other = await api('POST', '/api/stations', { token: tokenA, body: { name: 'Station 2' } });
    assert.equal(other.status, 201);
    expectDup(await api('PUT', `/api/stations/${other.json.id}`, { token: tokenA, body: { name: 'STATION 1' } }), 'station rename dup');

    assert.equal((await api('POST', '/api/stations', { token: tokenB, body: { name: 'Station 1' } })).status, 201);
  });

  it('sites: create + rename 409, other company allowed', async () => {
    assert.equal((await api('POST', '/api/sites', { token: tokenA, body: { name: 'North Plant', code: 'NP' } })).status, 201);
    expectDup(await api('POST', '/api/sites', { token: tokenA, body: { name: 'north plant', code: 'NP2' } }), 'site dup');

    const other = await api('POST', '/api/sites', { token: tokenA, body: { name: 'South Plant', code: 'SP' } });
    assert.equal(other.status, 201);
    expectDup(await api('PUT', `/api/sites/${other.json.id}`, { token: tokenA, body: { name: 'NORTH PLANT' } }), 'site rename dup');

    assert.equal((await api('POST', '/api/sites', { token: tokenB, body: { name: 'North Plant', code: 'NP' } })).status, 201);
  });

  it('vendors: create + rename 409, other company allowed', async () => {
    assert.equal((await api('POST', '/api/purchasing/vendors', { token: tokenA, body: { name: 'Acme Supply', code: 'ACME' } })).status, 201);
    expectDup(await api('POST', '/api/purchasing/vendors', { token: tokenA, body: { name: 'acme supply', code: 'ACME2' } }), 'vendor dup');

    const other = await api('POST', '/api/purchasing/vendors', { token: tokenA, body: { name: 'Beta Supply', code: 'BETA' } });
    assert.equal(other.status, 201);
    expectDup(await api('PUT', `/api/purchasing/vendors/${other.json.id}`, { token: tokenA, body: { name: 'ACME SUPPLY' } }), 'vendor rename dup');

    assert.equal((await api('POST', '/api/purchasing/vendors', { token: tokenB, body: { name: 'Acme Supply', code: 'ACME' } })).status, 201);
  });

  it('locations: create + rename 409, other company allowed', async () => {
    assert.equal((await api('POST', '/api/inventory/locations', { token: tokenA, body: { name: 'Warehouse A', code: 'WH-A' } })).status, 201);
    expectDup(await api('POST', '/api/inventory/locations', { token: tokenA, body: { name: 'warehouse a', code: 'WH-A2' } }), 'location dup');

    const other = await api('POST', '/api/inventory/locations', { token: tokenA, body: { name: 'Warehouse B', code: 'WH-B' } });
    assert.equal(other.status, 201);
    expectDup(await api('PUT', `/api/inventory/locations/${other.json.id}`, { token: tokenA, body: { name: 'WAREHOUSE A' } }), 'location rename dup');

    assert.equal((await api('POST', '/api/inventory/locations', { token: tokenB, body: { name: 'Warehouse A', code: 'WH-A' } })).status, 201);
  });

  it('apps: create + rename 409, other company allowed', async () => {
    assert.equal((await api('POST', '/api/apps', { token: tokenA, body: { name: 'Torque Check' } })).status, 201);
    expectDup(await api('POST', '/api/apps', { token: tokenA, body: { name: 'torque check' } }), 'app dup');

    const other = await api('POST', '/api/apps', { token: tokenA, body: { name: 'Final QA' } });
    assert.equal(other.status, 201);
    expectDup(await api('PUT', `/api/apps/${other.json.id}`, { token: tokenA, body: { name: 'TORQUE CHECK' } }), 'app rename dup');

    assert.equal((await api('POST', '/api/apps', { token: tokenB, body: { name: 'Torque Check' } })).status, 201);
  });

  it('product types: duplicates scoped per app, other app + other company allowed', async () => {
    const appA1 = (await api('POST', '/api/apps', { token: tokenA, body: { name: 'PT Host 1' } })).json;
    const appA2 = (await api('POST', '/api/apps', { token: tokenA, body: { name: 'PT Host 2' } })).json;

    assert.equal((await api('POST', '/api/product-types', { token: tokenA, body: { app_id: appA1.id, name: 'Model X' } })).status, 201);
    expectDup(await api('POST', '/api/product-types', { token: tokenA, body: { app_id: appA1.id, name: 'model x' } }), 'product type dup');

    // Same name under a DIFFERENT app is allowed (per-app scoping).
    assert.equal((await api('POST', '/api/product-types', { token: tokenA, body: { app_id: appA2.id, name: 'Model X' } })).status, 201);

    const other = await api('POST', '/api/product-types', { token: tokenA, body: { app_id: appA1.id, name: 'Model Y' } });
    assert.equal(other.status, 201);
    expectDup(await api('PUT', `/api/product-types/${other.json.id}`, { token: tokenA, body: { name: 'MODEL X' } }), 'product type rename dup');

    const appB = (await api('POST', '/api/apps', { token: tokenB, body: { name: 'PT Host B' } })).json;
    assert.equal((await api('POST', '/api/product-types', { token: tokenB, body: { app_id: appB.id, name: 'Model X' } })).status, 201);
  });

  it('dashboards: create + rename 409, other company allowed', async () => {
    assert.equal((await api('POST', '/api/dashboards', { token: tokenA, body: { name: 'Plant Overview' } })).status, 201);
    expectDup(await api('POST', '/api/dashboards', { token: tokenA, body: { name: 'plant overview' } }), 'dashboard dup');

    const other = await api('POST', '/api/dashboards', { token: tokenA, body: { name: 'Quality Board' } });
    assert.equal(other.status, 201);
    expectDup(await api('PUT', `/api/dashboards/${other.json.id}`, { token: tokenA, body: { name: 'PLANT OVERVIEW' } }), 'dashboard rename dup');

    assert.equal((await api('POST', '/api/dashboards', { token: tokenB, body: { name: 'Plant Overview' } })).status, 201);
  });

  it('tables: create + rename 409, other company allowed', async () => {
    assert.equal((await api('POST', '/api/tables', { token: tokenA, body: { name: 'Defect Codes' } })).status, 201);
    expectDup(await api('POST', '/api/tables', { token: tokenA, body: { name: 'defect codes' } }), 'table dup');

    const other = await api('POST', '/api/tables', { token: tokenA, body: { name: 'Scrap Reasons' } });
    assert.equal(other.status, 201);
    expectDup(await api('PUT', `/api/tables/${other.json.id}`, { token: tokenA, body: { name: 'DEFECT CODES' } }), 'table rename dup');

    assert.equal((await api('POST', '/api/tables', { token: tokenB, body: { name: 'Defect Codes' } })).status, 201);
  });
});

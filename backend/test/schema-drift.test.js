'use strict';
// ─── Schema drift: every written column must exist, every value must be legal ──
// Five separate 500s in this codebase were the same two shapes:
//
//   1. A route writes a column the table never had ("table capa_items has no
//      column named source_ref"). Demo workspaces hid it, because the sandbox
//      seed inserts the OLDER column names directly — so the read path had data
//      to show while both write paths were dead.
//   2. A route writes a value its own CHECK constraint forbids ("CHECK
//      constraint failed: priority IN (...)"), because the page and the schema
//      drifted to different words for the same thing ('normal' vs 'medium',
//      'complete' vs 'completed').
//
// The first half of this file is a standing guard: it walks every INSERT and
// UPDATE in the source and asserts each named column exists. The second half
// exercises the specific endpoints that were dead, so a regression shows up as
// a failing test rather than as a customer clicking a button that 500s.
//
// Uses Node built-ins only (node:test + global fetch). Run with: npm test

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const PORT = 3178;
const BASE = `http://localhost:${PORT}`;
const DB_PATH = path.join(os.tmpdir(), `mes-schema-drift-${Date.now()}.db`);

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

let token;

before(async () => {
  await startServer();
  const signup = await api('POST', '/api/auth/signup', {
    body: {
      company_name: 'Drift Co', email: 'admin@drift.test',
      password: 'SecretPass1', display_name: 'Admin',
    },
  });
  assert.equal(signup.status, 201, 'signup failed');
  token = signup.json.token;
});

after(() => {
  if (server) server.kill('SIGTERM');
  for (const ext of ['', '-shm', '-wal']) {
    try { fs.unlinkSync(DB_PATH + ext); } catch { /* ignore */ }
  }
});

// ─── The standing guard ───────────────────────────────────────────────────────

describe('every written column exists on its table', () => {
  it('finds no INSERT or UPDATE naming a column the schema lacks', () => {
    // Read the live schema from the same database the server just migrated, so
    // this reflects the additive migrations rather than the CREATE TABLE text.
    const Database = require('better-sqlite3');
    const conn = new Database(DB_PATH, { readonly: true });
    const schema = {};
    for (const t of conn.prepare("SELECT name FROM sqlite_master WHERE type='table'").all()) {
      schema[t.name] = conn.prepare(`PRAGMA table_info(${t.name})`).all().map(c => c.name);
    }
    conn.close();

    const srcDir = path.join(__dirname, '..', 'src');
    const files = [];
    (function walk(dir) {
      for (const e of fs.readdirSync(dir)) {
        const p = path.join(dir, e);
        if (fs.statSync(p).isDirectory()) { if (e !== 'node_modules') walk(p); }
        else if (e.endsWith('.js')) files.push(p);
      }
    })(srcDir);

    const problems = [];
    for (const file of files) {
      const src = fs.readFileSync(file, 'utf8');
      const rel = path.relative(srcDir, file);
      const lineOf = i => src.slice(0, i).split('\n').length;

      for (const m of src.matchAll(/INSERT\s+(?:OR\s+\w+\s+)?INTO\s+([a-z_][a-z0-9_]*)\s*\(([^)]*)\)/gi)) {
        const cols = schema[m[1]];
        if (!cols) continue;                     // table built elsewhere (SQL migrations)
        for (const raw of m[2].split(',')) {
          const col = raw.trim().replace(/["'`[\]]/g, '');
          if (!col || col.includes('$') || col.includes('{')) continue;   // interpolated
          if (!cols.includes(col)) problems.push(`${rel}:${lineOf(m.index)} INSERT ${m[1]}.${col}`);
        }
      }

      for (const m of src.matchAll(/UPDATE\s+([a-z_][a-z0-9_]*)\s+SET\s+([\s\S]*?)(?:\bWHERE\b|`\s*\))/gi)) {
        const cols = schema[m[1]];
        if (!cols) continue;
        for (const a of m[2].matchAll(/(^|,)\s*([a-z_][a-z0-9_]*)\s*=/gi)) {
          if (!cols.includes(a[2])) problems.push(`${rel}:${lineOf(m.index)} UPDATE ${m[1]}.${a[2]}`);
        }
      }
    }

    assert.deepEqual(problems, [], `columns written but not in the schema:\n  ${problems.join('\n  ')}`);
  });
});

// ─── Can a customer create one of everything? ─────────────────────────────────
// The broadest guard in the suite, and the one that would have caught all five
// of the 500s above on the day they landed. A 4xx here is fine — that is
// validation talking. A 5xx is a dead button on a screen we shipped.

describe('every "new" button a customer can press', () => {
  it('never answers with a server error', async () => {
    const stamp = Date.now();
    const ids = {};
    const results = [];

    // Its own company: this block creates one of everything, which would
    // otherwise skew the focused counter assertions further down the file.
    const owner = await api('POST', '/api/auth/signup', {
      body: {
        company_name: `Create All ${stamp}`, email: `create${stamp}@drift.test`,
        password: 'SecretPass1', display_name: 'Creator',
      },
    });
    assert.equal(owner.status, 201, 'create-all signup failed');
    const allToken = owner.json.token;
    const allUserId = owner.json.user.id;

    const make = async (label, path, body, keep) => {
      const r = await api('POST', path, { token: allToken, body });
      results.push({ label, path, status: r.status, body: JSON.stringify(r.json ?? {}).slice(0, 140) });
      if (keep && r.json?.id) ids[keep] = r.json.id;
      return r;
    };

    // Foundations first, so the rest have something real to point at.
    await make('department', '/api/departments', { name: 'Create-All Welding' }, 'dept');
    await make('site', '/api/sites', { name: `Plant ${stamp}`, code: `P${stamp % 100000}` }, 'site');
    await make('station', '/api/stations', { name: 'Create-All Station', department_id: ids.dept }, 'station');
    await make('app', '/api/apps', { name: 'Create-All App' }, 'app');
    await make('product type', '/api/product-types', { app_id: ids.app, name: 'Part A', part_number: 'PA-1' }, 'ptype');
    await make('vendor', '/api/purchasing/vendors', { name: `Acme ${stamp}`, code: `AC${stamp % 100000}` }, 'vendor');
    await make('location', '/api/inventory/locations', { name: `Rack ${stamp}`, code: `RK${stamp % 100000}` }, 'loc');
    await make('inventory item', '/api/inventory/items', { sku: `SKU-${stamp}`, name: 'Bracket', unit: 'ea' }, 'item');

    // Everything else a customer clicks "new" on.
    await make('work order', '/api/work-orders', { work_order_number: `WO-${stamp}`, part_number: 'PA-1', part_name: 'Bracket', quantity: 10, app_id: ids.app }, 'wo');
    await make('NCR', '/api/quality/ncrs', { title: 'Weld porosity', description: 'three in a row', severity: 'major' });
    await make('CAPA', '/api/capa', { title: 'Root-cause the porosity', source: 'ncr' }, 'capa');
    await make('CAPA action', `/api/capa/${ids.capa}/actions`, { description: 'Re-train the cell', owner_name: 'Ann' });
    await make('kaizen idea', '/api/kaizen', { title: 'Shorten changeover', category: 'quality', department_id: ids.dept });
    await make('asset', '/api/maintenance/assets', { asset_number: `AS-${stamp}`, name: 'Press 1', type: 'machine' }, 'asset');
    await make('maintenance WO', '/api/maintenance/work-orders', { title: 'Lube the press', asset_id: ids.asset });
    await make('PM schedule', '/api/maintenance/pm', { asset_id: ids.asset, title: 'Quarterly lube', frequency_type: 'months', frequency_value: 3 });
    await make('shift note', '/api/shifts', { shift_name: 'Day', shift_date: '2026-08-21', department_id: ids.dept }, 'shift');
    await make('shift handoff', `/api/shifts/${ids.shift}/handoff`, { handoff_notes: 'belt is worn', handed_off_to: 'Night lead' });
    await make('andon call', '/api/andon', { team: 'quality', title: 'Need a check', station_id: ids.station });
    await make('dashboard', '/api/dashboards', { name: 'Create-All Dashboard' });
    await make('table', '/api/tables', { name: `Torque specs ${stamp}`, columns: [{ name: 'part', type: 'text' }] }, 'table');
    await make('table record', `/api/tables/${ids.table}/records`, { values: { part: 'PA-1' } });
    await make('purchase order', '/api/purchasing/orders', { vendor_id: ids.vendor, expected_date: '2026-09-15' }, 'po');
    await make('PO line', `/api/purchasing/orders/${ids.po}/lines`, { item_id: ids.item, quantity_ordered: 5, unit_cost: 3.5 });
    await make('inventory movement', '/api/inventory/movements', { item_id: ids.item, quantity: 10, movement_type: 'receive', location_id: ids.loc });
    await make('shipment', '/api/inventory/shipments', { tracking_number: `TRK-${stamp}`, carrier: 'UPS' });
    await make('routing', '/api/routings', { name: `Routing ${stamp}`, part_number: 'PA-1' }, 'routing');
    await make('routing step', `/api/routings/${ids.routing}/steps`, { name: 'Weld', department_id: ids.dept, sequence: 1 });
    await make('BOM', '/api/boms', { app_id: ids.app, product_type_id: ids.ptype, name: 'Bracket BOM' });
    await make('department member', `/api/departments/${ids.dept}/members`, { user_id: allUserId, team_role: 'quality' });
    await make('site shift', `/api/sites/${ids.site}/shifts`, { name: 'Day', starts_at: '06:00', ends_at: '14:00', days: [1, 2, 3, 4, 5] });
    await make('api key', '/api/developer/api-keys', { name: 'Create-All key' });
    await make('webhook', '/api/developer/webhooks', { url: 'https://example.test/hook', events: ['completion.created'] });

    const serverErrors = results.filter(r => r.status >= 500)
      .map(r => `${r.label} (POST ${r.path}) → ${r.status} ${r.body}`);
    assert.deepEqual(serverErrors, [], `endpoints answering with a server error:\n  ${serverErrors.join('\n  ')}`);

    // A guard that stops reaching the endpoints stops guarding them, so hold the
    // floor: if a route is renamed and every call starts 404ing, this fails.
    const created = results.filter(r => r.status < 400).length;
    assert.ok(created >= 30, `expected at least 30 of ${results.length} creates to succeed, got ${created}`);
  });
});

// ─── Maintenance: the module that could not create anything ───────────────────

describe('Maintenance work orders and assets', () => {
  let assetId, woId;

  it('creates an asset with every field the form offers', async () => {
    const r = await api('POST', '/api/maintenance/assets', {
      token,
      body: {
        asset_number: 'A-001', name: 'Press 1', description: '250t stamping press',
        type: 'machine', make: 'Acme', model: 'P-250', serial_number: 'SN-9',
        location: 'Bay 3', install_date: '2025-01-15', purchase_cost: 42000,
      },
    });
    assert.equal(r.status, 201, `asset create failed: ${JSON.stringify(r.json)}`);
    assert.equal(r.json.description, '250t stamping press');
    assert.equal(r.json.make, 'Acme');
    assert.equal(r.json.purchase_cost, 42000);
    assetId = r.json.id;
  });

  it('creates a work order without being told a priority', async () => {
    // The route's default priority used to be 'normal', which its own CHECK
    // constraint forbids — so the plain "new work order" path always 500'd.
    const r = await api('POST', '/api/maintenance/work-orders', {
      token, body: { title: 'Lube the press', type: 'preventive', asset_id: assetId, scheduled_date: '2026-09-01', notes: 'quarterly' },
    });
    assert.equal(r.status, 201, `work order create failed: ${JSON.stringify(r.json)}`);
    assert.equal(r.json.priority, 'medium');
    assert.equal(r.json.notes, 'quarterly');
    assert.ok(r.json.wo_number, 'work order should get a number');
    woId = r.json.id;
  });

  it('still accepts a client that says "normal"', async () => {
    const r = await api('POST', '/api/maintenance/work-orders', {
      token, body: { title: 'Older client work order', priority: 'normal' },
    });
    assert.equal(r.status, 201, `legacy priority rejected: ${JSON.stringify(r.json)}`);
    assert.equal(r.json.priority, 'medium', 'legacy "normal" should store as "medium"');
  });

  it('can be finished, and stamps when', async () => {
    const started = await api('PUT', `/api/maintenance/work-orders/${woId}`, { token, body: { status: 'in_progress' } });
    assert.equal(started.status, 200);
    assert.ok(started.json.started_at, 'starting should stamp started_at');

    const done = await api('PUT', `/api/maintenance/work-orders/${woId}`, {
      token, body: { status: 'completed', parts_cost: 42, labor_cost: 80, resolution: 'Greased and tested' },
    });
    assert.equal(done.status, 200, `completing failed: ${JSON.stringify(done.json)}`);
    assert.equal(done.json.status, 'completed');
    assert.ok(done.json.completed_at, 'completing should stamp completed_at');
    assert.equal(done.json.parts_cost, 42);
  });

  it('still accepts a client that says "complete"', async () => {
    const r = await api('POST', '/api/maintenance/work-orders', { token, body: { title: 'Alias check' } });
    const alias = await api('PUT', `/api/maintenance/work-orders/${r.json.id}`, { token, body: { status: 'complete' } });
    assert.equal(alias.status, 200, `legacy status rejected: ${JSON.stringify(alias.json)}`);
    assert.equal(alias.json.status, 'completed', 'legacy "complete" should store as "completed"');
  });

  it('counts finished work as finished', async () => {
    // The summary compared against status = 'complete', a value the column can
    // never hold, so "completed today" was permanently 0 and finished work
    // orders kept counting as open.
    const r = await api('GET', '/api/maintenance/summary', { token });
    assert.equal(r.status, 200);
    assert.ok(r.json.completed_today >= 2, `expected completed work to be counted, got ${r.json.completed_today}`);
    assert.equal(r.json.open_wos, 1, 'only the untouched work order should still be open');
    assert.equal(r.json.assets_count, 1);
  });
});

// ─── Shift handoff: the point of the screen ───────────────────────────────────

describe('Shift handoff', () => {
  it('hands a shift over with notes for the next supervisor', async () => {
    const note = await api('POST', '/api/shifts', {
      token, body: { shift_name: 'Day', shift_date: '2026-08-21', notes: 'ran clean' },
    });
    assert.equal(note.status, 201, `shift note create failed: ${JSON.stringify(note.json)}`);

    const handoff = await api('POST', `/api/shifts/${note.json.id}/handoff`, {
      token, body: { handoff_notes: 'Line 2 needs a new belt before start', handed_off_to: 'Night lead' },
    });
    assert.equal(handoff.status, 200, `handoff failed: ${JSON.stringify(handoff.json)}`);
    assert.equal(handoff.json.status, 'handed_off');
    assert.equal(handoff.json.handoff_notes, 'Line 2 needs a new belt before start');
    assert.equal(handoff.json.handed_off_to, 'Night lead');
    assert.ok(handoff.json.handed_off_at, 'handing off should stamp when');
  });
});

// ─── CAPA actions: could be started but never finished ────────────────────────

describe('CAPA actions', () => {
  let capaId, actionId;

  before(async () => {
    const r = await api('POST', '/api/capa', { token, body: { title: 'Drift CAPA', source: 'ncr' } });
    assert.equal(r.status, 201, `capa create failed: ${JSON.stringify(r.json)}`);
    capaId = r.json.id;
  });

  it('adds an action with an owner and notes', async () => {
    const r = await api('POST', `/api/capa/${capaId}/actions`, {
      token, body: { description: 'Re-train the cell', owner_name: 'Ann Petrov', notes: 'before Friday' },
    });
    assert.equal(r.status, 201, `action create failed: ${JSON.stringify(r.json)}`);
    assert.equal(r.json.owner_name, 'Ann Petrov');
    assert.equal(r.json.notes, 'before Friday');
    actionId = r.json.id;
  });

  it('can be marked done, under either spelling', async () => {
    const done = await api('PUT', `/api/capa/${capaId}/actions/${actionId}`, { token, body: { status: 'done' } });
    assert.equal(done.status, 200, `marking done failed: ${JSON.stringify(done.json)}`);
    assert.equal(done.json.status, 'done');
    assert.ok(done.json.completed_at, 'finishing an action should stamp completed_at');

    const alias = await api('PUT', `/api/capa/${capaId}/actions/${actionId}`, { token, body: { status: 'complete' } });
    assert.equal(alias.status, 200, `legacy "complete" rejected: ${JSON.stringify(alias.json)}`);
    assert.equal(alias.json.status, 'done');
  });
});

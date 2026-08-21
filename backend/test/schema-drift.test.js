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

'use strict';
// ─── Capacity planning writes headcount to the right department ───────────────
// The defect this locks down: GET /analytics/capacity aggregated demand by
// department *name* and emitted no department_id, so the Capacity Planning page
// resolved a card back to a row by name when saving headcount. Two departments
// that share a name — or one renamed between a page load and the save — meant
// the write landed on the wrong row, or silently on none.
//
// The fix: the endpoint keys by department id and returns `department_id` on
// every card, and the page writes headcount straight to that id.
//
// Departments reject duplicate names through the API on purpose, so to build the
// two-same-named-departments case this test writes the duplicate name straight
// into the DB (a second better-sqlite3 connection on the same WAL file), which
// is exactly the shape the live server can end up in via renames/imports.
//
// Uses Node built-ins + better-sqlite3. Run with: npm test

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Database = require('better-sqlite3');

const PORT = 3231; // unique per task instruction
const BASE = `http://localhost:${PORT}`;
const DB_PATH = path.join(os.tmpdir(), `mes-capacity-deptid-${Date.now()}.db`);

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

async function create(token, pathname, body) {
  const r = await api('POST', pathname, { token, body });
  assert.ok(r.status === 200 || r.status === 201, `POST ${pathname} → ${r.status} ${JSON.stringify(r.json)}`);
  return r.json;
}

async function get(token, pathname) {
  const r = await api('GET', pathname, { token });
  assert.equal(r.status, 200, `GET ${pathname} → ${r.status} ${JSON.stringify(r.json)}`);
  return r.json;
}

before(async () => { await startServer(); });
after(() => {
  if (server) server.kill('SIGTERM');
  for (const ext of ['', '-shm', '-wal']) {
    try { fs.unlinkSync(DB_PATH + ext); } catch { /* ignore */ }
  }
});

describe('Capacity planning — headcount saves to the right department', () => {
  const A = {};

  before(async () => {
    const signup = await api('POST', '/api/auth/signup', {
      body: { company_name: 'Capacity Co', email: 'admin@capacity.test', password: 'SecretPass1', display_name: 'Admin' },
    });
    assert.equal(signup.status, 201);
    A.token = signup.json.token;

    A.finishing = await create(A.token, '/api/departments', { name: 'Finishing' });
    A.polishing = await create(A.token, '/api/departments', { name: 'Polishing' });

    // Each department carries one open work order so it appears on the capacity
    // page even before any headcount is set (a card shows when it has work or
    // headcount). Distinct quantities give distinct hours so the two cards are
    // provably separate rows, not one merged bucket.
    A.woFin = await create(A.token, '/api/work-orders', {
      part_number: 'F-1', part_name: 'Finish Job', quantity: 10,
      department_id: A.finishing.id, status: 'in_progress', priority: 'medium',
    });
    A.woPol = await create(A.token, '/api/work-orders', {
      part_number: 'P-1', part_name: 'Polish Job', quantity: 40,
      department_id: A.polishing.id, status: 'in_progress', priority: 'medium',
    });

    // Make the two departments share a name, bypassing the API's duplicate-name
    // guard — the exact collision the live server hits via renames or imports.
    const raw = new Database(DB_PATH);
    raw.pragma('busy_timeout = 5000');
    raw.prepare('UPDATE departments SET name = ? WHERE id = ?').run('Finishing', A.polishing.id);
    raw.close();
  });

  it('every capacity department card carries its department_id', async () => {
    const cap = await get(A.token, '/api/analytics/capacity');
    const depts = cap.summary.departments;
    assert.ok(Array.isArray(depts) && depts.length >= 2, 'both departments appear');
    for (const d of depts) {
      assert.ok('department_id' in d, `card "${d.name}" must expose department_id`);
    }
    // The ids match the real departments (never a name-only card).
    const byId = new Map(depts.map(d => [d.department_id, d]));
    assert.ok(byId.has(A.finishing.id), 'the Finishing card is keyed by its real id');
    assert.ok(byId.has(A.polishing.id), 'the renamed-collision card is keyed by its own id');
  });

  it('two departments sharing a name stay two distinct cards', async () => {
    const cap = await get(A.token, '/api/analytics/capacity');
    const finishingCards = cap.summary.departments.filter(d => d.name === 'Finishing');
    // Before the fix these merged into ONE name-keyed bucket with no id.
    assert.equal(finishingCards.length, 2, 'both same-named departments are their own card');
    const ids = finishingCards.map(d => d.department_id).sort();
    assert.deepEqual(ids, [A.finishing.id, A.polishing.id].sort(), 'each card has its own department id');
    // And their loads did not get folded together.
    const fin = finishingCards.find(d => d.department_id === A.finishing.id);
    const pol = finishingCards.find(d => d.department_id === A.polishing.id);
    assert.notEqual(fin.hours_required, pol.hours_required, 'the 10-unit and 40-unit jobs land on different cards');
  });

  it('saving headcount by id targets exactly one of the same-named departments', async () => {
    // Simulate the page's save() — write headcount straight to each id.
    assert.equal((await api('PUT', `/api/departments/${A.finishing.id}`, { token: A.token, body: { headcount: 3 } })).status, 200);
    assert.equal((await api('PUT', `/api/departments/${A.polishing.id}`, { token: A.token, body: { headcount: 7 } })).status, 200);

    const cap = await get(A.token, '/api/analytics/capacity');
    const byId = new Map(cap.summary.departments.map(d => [d.department_id, d]));
    assert.equal(byId.get(A.finishing.id).headcount, 3, 'Finishing got its own headcount');
    assert.equal(byId.get(A.polishing.id).headcount, 7, 'the collision department got its own, independent headcount');

    // The database agrees: two rows, two different headcounts, no cross-write.
    assert.equal((await get(A.token, `/api/departments`)).find(d => d.id === A.finishing.id).headcount, 3);
    assert.equal((await get(A.token, `/api/departments`)).find(d => d.id === A.polishing.id).headcount, 7);
  });

  it('a work order with no department rolls up under an id-less Unassigned card', async () => {
    await create(A.token, '/api/work-orders', {
      part_number: 'X-1', part_name: 'Odd Job', quantity: 5, status: 'in_progress', priority: 'medium',
    });
    const cap = await get(A.token, '/api/analytics/capacity');
    const unassigned = cap.summary.departments.find(d => d.department_id === null);
    assert.ok(unassigned, 'the no-department work order surfaces as an Unassigned roll-up');
    assert.equal(unassigned.name, 'Unassigned');
    assert.ok(unassigned.work_order_count >= 1);
  });
});

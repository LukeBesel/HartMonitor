'use strict';
// ─── Partial-update semantics tests ───────────────────────────────────────────
// PUT handlers used to write every editable column as `col = COALESCE(?, col)`,
// which cannot tell "the client did not mention this field" from "the client
// emptied this field" — both arrive as NULL, so the clear was silently thrown
// away and the old value reappeared on the next load. A save that looks like it
// worked and did not is the worst kind of bug in a record system.
//
// These tests pin both halves of the contract on the two routes that had it
// worst (Kaizen ideas and CAPA items), plus the pure buildUpdate helper.
//
// Uses Node built-ins only (node:test + global fetch). Run with: npm test

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { buildUpdate, nextValue } = require('../src/patch');

const PORT = 3179;
const BASE = `http://localhost:${PORT}`;
const DB_PATH = path.join(os.tmpdir(), `mes-partial-update-${Date.now()}.db`);

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

let token, deptId;

before(async () => {
  await startServer();

  const signup = await api('POST', '/api/auth/signup', {
    body: {
      company_name: 'Partial Update Co', email: 'admin@partial.test',
      password: 'SecretPass1', display_name: 'Admin',
    },
  });
  assert.equal(signup.status, 201, 'signup failed');
  token = signup.json.token;

  const dept = await api('POST', '/api/departments', { token, body: { name: 'Welding' } });
  assert.equal(dept.status, 201, 'department create failed');
  deptId = dept.json.id;
});

after(() => {
  if (server) server.kill('SIGTERM');
  for (const ext of ['', '-shm', '-wal']) {
    try { fs.unlinkSync(DB_PATH + ext); } catch { /* ignore */ }
  }
});

// ─── The helper on its own ────────────────────────────────────────────────────

describe('buildUpdate', () => {
  const COLS = ['title', 'champion_name', 'department_id'];

  it('writes only the columns the body actually names', () => {
    const { sql, params, touched } = buildUpdate({ title: 'New' }, COLS);
    assert.equal(sql, 'title = ?');
    assert.deepEqual(params, ['New']);
    assert.deepEqual(touched, ['title']);
  });

  it('treats an emptied field as a clear, not as silence', () => {
    const { sql, params } = buildUpdate({ champion_name: '', department_id: null }, COLS);
    assert.equal(sql, 'champion_name = ?, department_id = ?');
    // '' normalises to NULL so a cleared column reads the same as one never set.
    assert.deepEqual(params, [null, null]);
  });

  it('ignores keys the caller did not allow', () => {
    const { sql, params } = buildUpdate({ title: 'ok', company_id: 'attacker-co', id: 'other' }, COLS);
    assert.equal(sql, 'title = ?');
    assert.deepEqual(params, ['ok']);
  });

  it('produces empty SQL when the body names nothing', () => {
    const { sql, params, touched } = buildUpdate({ unrelated: 1 }, COLS);
    assert.equal(sql, '');
    assert.deepEqual(params, []);
    assert.deepEqual(touched, []);
  });

  it('survives a missing or non-object body', () => {
    assert.equal(buildUpdate(undefined, COLS).sql, '');
    assert.equal(buildUpdate(null, COLS).sql, '');
    assert.equal(buildUpdate('nope', COLS).sql, '');
  });

  it('nextValue reports what a column will become', () => {
    assert.equal(nextValue({ status: 'implemented' }, 'status', 'submitted'), 'implemented');
    assert.equal(nextValue({}, 'status', 'submitted'), 'submitted', 'absent key keeps the current value');
    assert.equal(nextValue({ status: '' }, 'status', 'submitted'), null, 'emptied key clears');
  });
});

// ─── Kaizen ideas ─────────────────────────────────────────────────────────────

describe('PUT /kaizen/:id partial updates', () => {
  let ideaId;

  before(async () => {
    const r = await api('POST', '/api/kaizen', {
      token,
      body: {
        title: 'Shorten the changeover', description: 'Cut setup time on the press',
        category: 'quality', champion_name: 'Dana Ruiz', department_id: deptId,
        target_date: '2026-09-01',
      },
    });
    assert.equal(r.status, 201, `kaizen create failed: ${JSON.stringify(r.json)}`);
    ideaId = r.json.id;
  });

  it('leaves fields the body never mentions alone', async () => {
    const r = await api('PUT', `/api/kaizen/${ideaId}`, { token, body: { title: 'Shorten the changeover v2' } });
    assert.equal(r.status, 200);
    assert.equal(r.json.title, 'Shorten the changeover v2');
    assert.equal(r.json.champion_name, 'Dana Ruiz', 'champion should survive an untouched update');
    assert.equal(r.json.department_id, deptId, 'department should survive an untouched update');
  });

  it('clears a champion when the field is emptied', async () => {
    const r = await api('PUT', `/api/kaizen/${ideaId}`, { token, body: { champion_name: '' } });
    assert.equal(r.status, 200);
    assert.ok(!r.json.champion_name, `expected champion cleared, got ${JSON.stringify(r.json.champion_name)}`);

    // And it must still be gone on a fresh read — this is where it used to
    // reappear, which is what made the save look like it had worked.
    const back = await api('GET', `/api/kaizen/${ideaId}`, { token });
    if (back.status === 200) {
      assert.ok(!back.json.champion_name, 'champion came back on reload');
    } else {
      const list = await api('GET', '/api/kaizen', { token });
      const row = list.json.find(i => i.id === ideaId);
      assert.ok(row && !row.champion_name, 'champion came back on reload');
    }
  });

  it('un-assigns a department when the field is nulled', async () => {
    const r = await api('PUT', `/api/kaizen/${ideaId}`, { token, body: { department_id: null } });
    assert.equal(r.status, 200);
    assert.ok(!r.json.department_id, `expected department cleared, got ${JSON.stringify(r.json.department_id)}`);
  });

  it('clears a target date without disturbing the title', async () => {
    const r = await api('PUT', `/api/kaizen/${ideaId}`, { token, body: { target_date: '' } });
    assert.equal(r.status, 200);
    assert.ok(!r.json.target_date, 'target date should be cleared');
    assert.equal(r.json.title, 'Shorten the changeover v2', 'title should be untouched');
  });

  it('still records a status change', async () => {
    const r = await api('PUT', `/api/kaizen/${ideaId}`, { token, body: { status: 'implemented' } });
    assert.equal(r.status, 200);
    assert.equal(r.json.status, 'implemented');
    assert.ok(r.json.completed_at, 'implementing an idea should stamp completed_at');
  });

  it('accepts an update that names nothing at all', async () => {
    const before = await api('PUT', `/api/kaizen/${ideaId}`, { token, body: { title: 'Stable title' } });
    const r = await api('PUT', `/api/kaizen/${ideaId}`, { token, body: {} });
    assert.equal(r.status, 200, 'an empty update should not 500');
    assert.equal(r.json.title, before.json.title, 'an empty update should change nothing');
  });
});

// ─── CAPA items ───────────────────────────────────────────────────────────────

describe('PUT /capa/:id partial updates', () => {
  let capaId;

  before(async () => {
    const r = await api('POST', '/api/capa', {
      token,
      body: {
        title: 'Recurring weld porosity', description: 'Three NCRs this month',
        source: 'ncr', type: 'corrective', priority: 'high',
        department_id: deptId, owner_name: 'Sam Okafor', due_date: '2026-09-15',
      },
    });
    assert.equal(r.status, 201, `capa create failed: ${JSON.stringify(r.json)}`);
    capaId = r.json.id;
  });

  it('leaves fields the body never mentions alone', async () => {
    const r = await api('PUT', `/api/capa/${capaId}`, { token, body: { priority: 'critical' } });
    assert.equal(r.status, 200);
    assert.equal(r.json.priority, 'critical');
    assert.equal(r.json.owner_name, 'Sam Okafor', 'owner should survive an untouched update');
    assert.equal(r.json.department_id, deptId, 'department should survive an untouched update');
  });

  it('un-assigns a department when the field is emptied', async () => {
    const r = await api('PUT', `/api/capa/${capaId}`, { token, body: { department_id: '' } });
    assert.equal(r.status, 200);
    assert.ok(!r.json.department_id, `expected department cleared, got ${JSON.stringify(r.json.department_id)}`);
  });

  it('clears an owner and a due date', async () => {
    const r = await api('PUT', `/api/capa/${capaId}`, { token, body: { owner_name: '', due_date: '' } });
    assert.equal(r.status, 200);
    assert.ok(!r.json.owner_name, 'owner should be cleared');
    assert.ok(!r.json.due_date, 'due date should be cleared');
    assert.equal(r.json.title, 'Recurring weld porosity', 'title should be untouched');
  });

  it('stamps closed_at on the transition to closed', async () => {
    const r = await api('PUT', `/api/capa/${capaId}`, { token, body: { status: 'closed' } });
    assert.equal(r.status, 200);
    assert.equal(r.json.status, 'closed');
    assert.ok(r.json.closed_at, 'closing a CAPA should stamp closed_at');
  });

  it('refuses to let a client write columns outside the editable set', async () => {
    const r = await api('PUT', `/api/capa/${capaId}`, {
      token,
      body: { title: 'Renamed', company_id: 'some-other-company', number: 'CAPA-9999-999' },
    });
    assert.equal(r.status, 200);
    assert.equal(r.json.title, 'Renamed');
    assert.notEqual(r.json.number, 'CAPA-9999-999', 'the server owns the CAPA number');

    // The row must still belong to this company — a rewritten company_id would
    // hand the record to another tenant.
    const list = await api('GET', '/api/capa', { token });
    assert.ok(list.json.some(c => c.id === capaId), 'CAPA left this company');
  });
});

// ─── Constraint failures answer the request instead of blaming the server ─────
// Blanking a field the database requires, or sending a status word its CHECK
// forbids, used to come back as a bare 500 "Internal server error". That tells
// the person at the screen nothing, and reads as the app being broken rather
// than the save being refused. These are statements about the request, so they
// belong in the 4xx range with the column named.

describe('a rule the database enforces comes back as a 4xx, not a 500', () => {
  let ideaId;

  before(async () => {
    const r = await api('POST', '/api/kaizen', {
      token,
      body: {
        title: 'Reduce scrap on line 2', description: 'Track the top three defect codes',
        category: 'quality',
      },
    });
    assert.equal(r.status, 201, `kaizen create failed: ${JSON.stringify(r.json)}`);
    ideaId = r.json.id;
  });

  it('blanking a required field is a 400 naming the field', async () => {
    const r = await api('PUT', `/api/kaizen/${ideaId}`, { token, body: { title: '' } });
    assert.equal(r.status, 400, `expected 400, got ${r.status} ${JSON.stringify(r.json)}`);
    assert.equal(r.json.code, 'FIELD_REQUIRED');
    assert.match(r.json.error, /title/, `the message should name the field: ${r.json.error}`);
    assert.doesNotMatch(r.json.error, /Internal server error/i);
  });

  it('a status word the column forbids is a 400, not a 500', async () => {
    const r = await api('PUT', `/api/kaizen/${ideaId}`, { token, body: { status: 'not-a-real-status' } });
    assert.ok(r.status >= 400 && r.status < 500, `expected a 4xx, got ${r.status} ${JSON.stringify(r.json)}`);
    assert.doesNotMatch(String(r.json.error), /Internal server error/i);
  });

  it('the refused save leaves the row exactly as it was', async () => {
    // A rejected write that half-applied would be worse than a 500.
    const r = await api('GET', `/api/kaizen/${ideaId}`, { token });
    assert.equal(r.status, 200);
    assert.equal(r.json.title, 'Reduce scrap on line 2', 'the title survived the refused blanking');
    assert.notEqual(r.json.status, 'not-a-real-status', 'the forbidden status was never stored');
  });

  it('never leaks a stack trace or a SQL statement to the client', async () => {
    const r = await api('PUT', `/api/kaizen/${ideaId}`, { token, body: { title: '' } });
    const body = JSON.stringify(r.json);
    for (const leak of ['SqliteError', 'at Object', 'UPDATE ', 'node_modules']) {
      assert.ok(!body.includes(leak), `response leaked ${leak}: ${body}`);
    }
  });
});

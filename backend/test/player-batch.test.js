// ─── Player batch tests: sessions, jobs-in-progress, supervisor authorization ─
// Spawns the real server against a throwaway database and exercises:
//   • completion_sessions open/close lifecycle (POST /:id/sessions,
//     PUT /:id/sessions/close) with GET /:id including sessions,
//   • resume by a second operator → two session rows + both names dual-written
//     into completions.data._operators,
//   • handoff comment round-trip (close with comment → next operator sees it
//     on the jobs-in-progress listing and on GET /:id),
//   • tenant isolation on sessions and the jobs-in-progress listing,
//   • POST /api/operators/verify-authorizer: supervisor PIN ok, operator PIN
//     403, wrong PIN 403,
//   • POST /api/quality/ncrs storing authorized_by / authorized_by_user_id /
//     step_name for in-run quality reports.
// Run with: npm test — uses only Node built-ins (node:test + global fetch).

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const PORT = 3189; // unique per test file — 3185-3199 are taken by other suites
const BASE = `http://localhost:${PORT}`;
const DB_PATH = path.join(os.tmpdir(), `mes-player-batch-test-${Date.now()}.db`);

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

let tokenA;        // Widget Co (developer)
let tokenB;        // Gadget Co (developer)
let appId;
let operatorId;    // floor operator in company A (PIN 4321)
let supervisorId;  // supervisor in company A (PIN 8765)
let completionId;  // the shared multi-operator run

before(async () => {
  await startServer();

  const a = await api('POST', '/api/auth/signup', {
    body: { company_name: 'Widget Co', email: 'owner@widget-pb.test', password: 'supersecret1', display_name: 'Widget Owner' },
  });
  assert.equal(a.status, 201);
  tokenA = a.json.token;

  const b = await api('POST', '/api/auth/signup', {
    body: { company_name: 'Gadget Co', email: 'owner@gadget-pb.test', password: 'supersecret1', display_name: 'Gadget Owner' },
  });
  assert.equal(b.status, 201);
  tokenB = b.json.token;

  const app = await api('POST', '/api/apps', { token: tokenA, body: { name: 'Session App' } });
  assert.equal(app.status, 201);
  appId = app.json.id;

  // An operator (PIN 4321) and a supervisor (PIN 8765), both with PINs set.
  const op = await api('POST', '/api/users', {
    token: tokenA,
    body: { email: 'op@widget-pb.test', display_name: 'Ana Operator', password: 'supersecret1', role: 'operator' },
  });
  assert.equal(op.status, 201);
  operatorId = op.json.id;
  assert.equal((await api('PUT', `/api/users/${operatorId}/pin`, { token: tokenA, body: { pin: '4321' } })).status, 200);

  const sup = await api('POST', '/api/users', {
    token: tokenA,
    body: { email: 'sup@widget-pb.test', display_name: 'Sam Supervisor', password: 'supersecret1', role: 'supervisor' },
  });
  assert.equal(sup.status, 201);
  supervisorId = sup.json.id;
  assert.equal((await api('PUT', `/api/users/${supervisorId}/pin`, { token: tokenA, body: { pin: '8765' } })).status, 200);
});

after(() => {
  if (server) server.kill('SIGTERM');
  for (const ext of ['', '-shm', '-wal']) { try { fs.unlinkSync(DB_PATH + ext); } catch { /* ignore */ } }
});

// ─── Session open/close lifecycle ─────────────────────────────────────────────

test('opening a session on run start creates a row; GET /:id includes it', async () => {
  const start = await api('POST', '/api/completions', {
    token: tokenA, body: { app_id: appId, operator_name: 'Ana Operator', operator_user_id: operatorId },
  });
  assert.equal(start.status, 201);
  completionId = start.json.id;

  const open = await api('POST', `/api/completions/${completionId}/sessions`, {
    token: tokenA, body: { operator_name: 'Ana Operator', operator_user_id: operatorId },
  });
  assert.equal(open.status, 201);
  assert.equal(open.json.completion_id, completionId);
  assert.equal(open.json.operator_name, 'Ana Operator');
  assert.equal(open.json.operator_user_id, operatorId);
  assert.ok(open.json.started_at, 'started_at stamped');
  assert.equal(open.json.ended_at, null, 'open session has no ended_at');

  const detail = await api('GET', `/api/completions/${completionId}`, { token: tokenA });
  assert.equal(detail.status, 200);
  assert.equal(detail.json.sessions.length, 1);
  assert.equal(detail.json.sessions[0].id, open.json.id);
  assert.deepEqual(detail.json.data._operators, ['Ana Operator'], 'dual-written roster');
});

test('sessions require an operator_name', async () => {
  const bad = await api('POST', `/api/completions/${completionId}/sessions`, { token: tokenA, body: {} });
  assert.equal(bad.status, 400);
});

test('handoff comment round-trips through close', async () => {
  const close = await api('PUT', `/api/completions/${completionId}/sessions/close`, {
    token: tokenA, body: { handoff_comment: 'Torque check left at step 3 — waiting on gauge cal' },
  });
  assert.equal(close.status, 200);
  assert.ok(close.json.ended_at, 'close stamps ended_at');
  assert.equal(close.json.handoff_comment, 'Torque check left at step 3 — waiting on gauge cal');

  // Closing again 404s — there is no open session left.
  const again = await api('PUT', `/api/completions/${completionId}/sessions/close`, { token: tokenA, body: {} });
  assert.equal(again.status, 404);
});

// ─── Resume by a second operator ──────────────────────────────────────────────

test('resume by a second operator adds a session row and both names land in _operators', async () => {
  const open = await api('POST', `/api/completions/${completionId}/sessions`, {
    token: tokenA, body: { operator_name: 'Ben Builder' },
  });
  assert.equal(open.status, 201);

  const detail = await api('GET', `/api/completions/${completionId}`, { token: tokenA });
  assert.equal(detail.json.sessions.length, 2, 'one row per operator stint');
  assert.deepEqual(
    detail.json.sessions.map(s => s.operator_name),
    ['Ana Operator', 'Ben Builder'],
    'ordered by start time',
  );
  assert.deepEqual(detail.json.data._operators, ['Ana Operator', 'Ben Builder']);
  assert.equal(detail.json.sessions[0].handoff_comment, 'Torque check left at step 3 — waiting on gauge cal');
});

test('a PUT flushing data without _operators does not clobber the roster', async () => {
  const put = await api('PUT', `/api/completions/${completionId}`, {
    token: tokenA, body: { partial: true, data: { torque: 8, _step_index: 2 } },
  });
  assert.equal(put.status, 200);
  assert.deepEqual(put.json.data._operators, ['Ana Operator', 'Ben Builder'], 'roster preserved');
  assert.equal(put.json.data.torque, 8, 'client fields written as sent');
});

test('opening a session auto-closes a still-open one (crash recovery)', async () => {
  // Ben's session is still open; a third stint by Ana must close it first.
  const open = await api('POST', `/api/completions/${completionId}/sessions`, {
    token: tokenA, body: { operator_name: 'Ana Operator' },
  });
  assert.equal(open.status, 201);
  const detail = await api('GET', `/api/completions/${completionId}`, { token: tokenA });
  assert.equal(detail.json.sessions.length, 3);
  const openOnes = detail.json.sessions.filter(s => s.ended_at === null);
  assert.equal(openOnes.length, 1, 'at most one open session per run');
  assert.equal(openOnes[0].id, open.json.id);
  // No duplicate names in the roster.
  assert.deepEqual(detail.json.data._operators, ['Ana Operator', 'Ben Builder']);
});

test('a cross-tenant operator_user_id on a session is silently dropped', async () => {
  const foreign = await api('POST', '/api/users', {
    token: tokenB,
    body: { email: 'op@gadget-pb.test', display_name: 'Foreign Op', password: 'supersecret1', role: 'operator' },
  });
  assert.equal(foreign.status, 201);
  const open = await api('POST', `/api/completions/${completionId}/sessions`, {
    token: tokenA, body: { operator_name: 'Spoofy', operator_user_id: foreign.json.id },
  });
  assert.equal(open.status, 201);
  assert.equal(open.json.operator_user_id, null);
  // Clean up the open stint so later assertions see a closed run.
  assert.equal((await api('PUT', `/api/completions/${completionId}/sessions/close`, { token: tokenA, body: {} })).status, 200);
});

// ─── Jobs in progress (player setup screen) ───────────────────────────────────

test('in-progress listing filters by app and attaches the last session', async () => {
  const list = await api('GET', `/api/completions?status=in_progress&app_id=${appId}`, { token: tokenA });
  assert.equal(list.status, 200);
  assert.equal(list.json.length, 1);
  const job = list.json[0];
  assert.equal(job.id, completionId);
  assert.equal(job.data._step_index, 2, 'saved position rides the data blob');
  assert.ok(job.last_session, 'last operator stint attached');
  assert.equal(job.last_session.operator_name, 'Spoofy');
  assert.ok(job.last_session.ended_at);

  // Other apps' runs are excluded by the app_id filter.
  const other = await api('POST', '/api/apps', { token: tokenA, body: { name: 'Other App' } });
  const otherRun = await api('POST', '/api/completions', { token: tokenA, body: { app_id: other.json.id, operator_name: 'X' } });
  assert.equal(otherRun.status, 201);
  const filtered = await api('GET', `/api/completions?status=in_progress&app_id=${appId}`, { token: tokenA });
  assert.equal(filtered.json.length, 1, 'app_id filter holds');
});

// ─── Tenant isolation ─────────────────────────────────────────────────────────

test('sessions and jobs-in-progress never cross tenants', async () => {
  // Company B cannot see, open, or close sessions on A's run.
  assert.equal((await api('GET', `/api/completions/${completionId}`, { token: tokenB })).status, 404);
  assert.equal((await api('POST', `/api/completions/${completionId}/sessions`, {
    token: tokenB, body: { operator_name: 'Intruder' },
  })).status, 404);
  assert.equal((await api('PUT', `/api/completions/${completionId}/sessions/close`, { token: tokenB, body: {} })).status, 404);

  // B's jobs-in-progress listing is empty even when filtered to A's app.
  const list = await api('GET', `/api/completions?status=in_progress&app_id=${appId}`, { token: tokenB });
  assert.equal(list.status, 200);
  assert.equal(list.json.length, 0);

  // And nothing leaked into A's run.
  const detail = await api('GET', `/api/completions/${completionId}`, { token: tokenA });
  assert.ok(!detail.json.sessions.some(s => s.operator_name === 'Intruder'));
});

// ─── Supervisor authorization (verify-authorizer) ─────────────────────────────

test('verify-authorizer accepts a supervisor PIN', async () => {
  const ok = await api('POST', '/api/operators/verify-authorizer', { token: tokenA, body: { pin: '8765' } });
  assert.equal(ok.status, 200);
  assert.equal(ok.json.user_id, supervisorId);
  assert.equal(ok.json.display_name, 'Sam Supervisor');
  assert.equal(ok.json.role, 'supervisor');
});

test('verify-authorizer rejects an operator PIN with 403 and a clear message', async () => {
  const low = await api('POST', '/api/operators/verify-authorizer', { token: tokenA, body: { pin: '4321' } });
  assert.equal(low.status, 403);
  assert.match(low.json.error, /supervisor/i);
});

test('verify-authorizer rejects a wrong PIN with 403 and requires a pin', async () => {
  const bad = await api('POST', '/api/operators/verify-authorizer', { token: tokenA, body: { pin: '0000' } });
  assert.equal(bad.status, 403);
  assert.match(bad.json.error, /not recognized/i);

  const empty = await api('POST', '/api/operators/verify-authorizer', { token: tokenA, body: {} });
  assert.equal(empty.status, 400);

  // A supervisor PIN from another company never authorizes here.
  const supB = await api('POST', '/api/users', {
    token: tokenB,
    body: { email: 'sup@gadget-pb.test', display_name: 'B Sup', password: 'supersecret1', role: 'supervisor' },
  });
  assert.equal(supB.status, 201);
  assert.equal((await api('PUT', `/api/users/${supB.json.id}/pin`, { token: tokenB, body: { pin: '2468' } })).status, 200);
  const cross = await api('POST', '/api/operators/verify-authorizer', { token: tokenA, body: { pin: '2468' } });
  assert.equal(cross.status, 403);
});

// ─── In-run NCR with authorization + auto-links ───────────────────────────────

test('POST /api/quality/ncrs stores authorized_by, authorized_by_user_id and step_name', async () => {
  // Quality module needs the pro tier.
  assert.equal((await api('PUT', '/api/config/plan', { token: tokenA, body: { tier: 'pro' } })).status, 200);

  const created = await api('POST', '/api/quality/ncrs', {
    token: tokenA,
    body: {
      title: 'Cracked housing found mid-run',
      severity: 'major',
      source: 'production',
      app_id: appId,
      completion_id: completionId,
      operator_name: 'Ana Operator',
      authorized_by: 'Sam Supervisor',
      authorized_by_user_id: supervisorId,
      step_name: 'Final inspection',
    },
  });
  assert.equal(created.status, 201);
  assert.equal(created.json.authorized_by, 'Sam Supervisor');
  assert.equal(created.json.authorized_by_user_id, supervisorId);
  assert.equal(created.json.step_name, 'Final inspection');
  assert.equal(created.json.completion_id, completionId);
  assert.equal(created.json.app_id, appId);

  // A cross-tenant authorizer id is silently dropped.
  const supB = await api('POST', '/api/quality/ncrs', {
    token: tokenB,
    body: { title: 'B ncr', authorized_by: 'Nope', authorized_by_user_id: supervisorId },
  });
  // B is on the free tier — pro gate may reject; upgrade then retry.
  if (supB.status === 402 || supB.status === 403) {
    assert.equal((await api('PUT', '/api/config/plan', { token: tokenB, body: { tier: 'pro' } })).status, 200);
    const retry = await api('POST', '/api/quality/ncrs', {
      token: tokenB,
      body: { title: 'B ncr', authorized_by: 'Nope', authorized_by_user_id: supervisorId },
    });
    assert.equal(retry.status, 201);
    assert.equal(retry.json.authorized_by_user_id, null, 'foreign authorizer dropped');
  } else {
    assert.equal(supB.status, 201);
    assert.equal(supB.json.authorized_by_user_id, null, 'foreign authorizer dropped');
  }
});

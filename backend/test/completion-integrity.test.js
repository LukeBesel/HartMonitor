// ─── Completion integrity: terminal runs, finish time, operator roster ───────
// A correctness audit found three ways a stale autosave flush could corrupt a
// FINISHED run: it could overwrite the final data + captured values, rewrite
// completed_at (skewing every duration/OEE/cycle metric), and shrink the
// multi-operator roster back to a stale subset. This suite pins all three, plus
// the defensive status-vocabulary guard, so the guarantees can't silently
// regress. Uses only Node built-ins (node:test + global fetch).

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const PORT = 3175; // unique per test file
const BASE = `http://localhost:${PORT}`;
const DB_PATH = path.join(os.tmpdir(), `mes-completion-integrity-${Date.now()}.db`);

let server;

function startServer() {
  return new Promise((resolve, reject) => {
    server = spawn('node', [path.join(__dirname, '..', 'src', 'index.js')], {
      env: { ...process.env, NODE_ENV: 'test', PORT: String(PORT), DATABASE_PATH: DB_PATH, SEED_DEMO_DATA: 'false', EARLY_ACCESS: 'true', BACKUP_DIR: '' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    server.stderr.on('data', d => process.stderr.write(`[server] ${d}`));
    const deadline = Date.now() + 15000;
    (async function poll() {
      try { const r = await fetch(`${BASE}/api/health`); if (r.ok) return resolve(); } catch { /* not up */ }
      if (Date.now() > deadline) return reject(new Error('server did not start'));
      setTimeout(poll, 200);
    })();
  });
}

async function api(method, pathname, { token, body } = {}) {
  const res = await fetch(`${BASE}${pathname}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  let json = null;
  try { json = await res.json(); } catch { /* no body */ }
  return { status: res.status, json };
}

let token, appId, stationId;

before(async () => {
  await startServer();
  const signup = await api('POST', '/api/auth/signup', {
    body: { company_name: 'Integrity Co', email: 'admin@integrity.test', password: 'SecretPass1', display_name: 'Admin' },
  });
  assert.equal(signup.status, 201, `signup failed: ${JSON.stringify(signup.json)}`);
  token = signup.json.token;

  const app = await api('POST', '/api/apps', { token, body: { name: 'Integrity App' } });
  assert.equal(app.status, 201);
  appId = app.json.id;

  const st = await api('POST', '/api/stations', { token, body: { name: 'Integrity Station' } });
  assert.equal(st.status, 201);
  stationId = st.json.id;
});

after(() => {
  if (server) server.kill('SIGTERM');
  for (const ext of ['', '-shm', '-wal']) { try { fs.unlinkSync(DB_PATH + ext); } catch { /* ignore */ } }
});

async function startRun(operatorName) {
  const r = await api('POST', '/api/completions', { token, body: { app_id: appId, station_id: stationId, operator_name: operatorName } });
  assert.equal(r.status, 201, `start run failed: ${JSON.stringify(r.json)}`);
  return r.json.id;
}

test('a partial autosave cannot overwrite a completed run\'s data or values', async () => {
  const id = await startRun('Bob');
  // Finish the run with its real result and a captured value.
  const done = await api('PUT', `/api/completions/${id}`, {
    token,
    body: {
      status: 'completed',
      data: { final_torque: 15, inspector: 'Bob', step_completed: 'ALL' },
      step_times: { 0: 42 },
      values: [{ step_id: 's0', widget_id: 'w_torque', variable_name: 'final_torque', value_type: 'number', value_number: 15 }],
    },
  });
  assert.equal(done.status, 200);
  assert.equal(done.json.status, 'completed');
  const finishedAt = done.json.completed_at;

  // A stale tablet flushes an old partial blob AFTER completion.
  const stale = await api('PUT', `/api/completions/${id}`, {
    token,
    body: { partial: true, data: { final_torque: 9, step_completed: 'step1' }, step_times: { 0: 5 },
            values: [{ step_id: 's0', widget_id: 'w_torque', variable_name: 'final_torque', value_type: 'number', value_number: 9 }] },
  });
  assert.equal(stale.status, 200);

  // The finished run is untouched: data, step_times, completed_at all preserved.
  const back = await api('GET', `/api/completions/${id}`, { token }).catch(() => null);
  const row = back && back.status === 200 ? back.json
    : (await api('GET', `/api/completions`, { token })).json.find(c => c.id === id);
  assert.equal(row.data.final_torque, 15, 'torque was overwritten by a stale autosave');
  assert.equal(row.data.inspector, 'Bob', 'inspector was lost');
  assert.equal(row.data.step_completed, 'ALL', 'the ALL marker was lost');
  assert.equal(row.completed_at, finishedAt, 'completed_at was rewritten');

  // The captured value is unchanged too.
  const vals = await api('GET', `/api/completions/${id}/values`, { token });
  const torque = vals.json.find(v => v.widget_id === 'w_torque');
  assert.equal(torque.value_number, 15, 'the structured value was overwritten');
});

test('completed_at is stamped only on the real transition, not on a re-send', async () => {
  const id = await startRun('Maria');
  const first = await api('PUT', `/api/completions/${id}`, { token, body: { status: 'completed', data: {} } });
  const t1 = first.json.completed_at;
  assert.ok(t1, 'completing should stamp completed_at');

  await new Promise(r => setTimeout(r, 1100));
  // A non-partial re-send of the same status must NOT bump the finish time.
  const resend = await api('PUT', `/api/completions/${id}`, { token, body: { status: 'completed', data: { note: 'again' } } });
  assert.equal(resend.status, 200);
  assert.equal(resend.json.completed_at, t1, 'completed_at was rewritten on a re-send');
});

test('the multi-operator roster only grows — a stale flush cannot drop a joiner', async () => {
  const id = await startRun('Alice');
  // Alice records her roster.
  await api('PUT', `/api/completions/${id}`, { token, body: { partial: true, data: { _operators: ['Alice'] } } });
  // Bob joins via a session AND the blob learns about him.
  await api('POST', `/api/completions/${id}/sessions`, { token, body: { operator_name: 'Bob' } });
  await api('PUT', `/api/completions/${id}`, { token, body: { partial: true, data: { _operators: ['Alice', 'Bob'] } } });

  // Alice's stale tablet flushes its old single-name roster.
  const stale = await api('PUT', `/api/completions/${id}`, { token, body: { partial: true, data: { _operators: ['Alice'] } } });
  assert.equal(stale.status, 200);
  assert.deepEqual([...stale.json.data._operators].sort(), ['Alice', 'Bob'], 'Bob was dropped from the roster');
});

test('an out-of-vocabulary status is a 400, not a 500', async () => {
  const id = await startRun('Sam');
  const bad = await api('PUT', `/api/completions/${id}`, { token, body: { status: 'paused' } });
  assert.equal(bad.status, 400, `expected 400, got ${bad.status}: ${JSON.stringify(bad.json)}`);
  // The run is untouched.
  const list = await api('GET', '/api/completions', { token });
  const row = list.json.find(c => c.id === id);
  assert.equal(row.status, 'in_progress');
});

test('a normal in-progress autosave still saves', async () => {
  const id = await startRun('Dana');
  const save = await api('PUT', `/api/completions/${id}`, { token, body: { partial: true, data: { step: 2, reading: 7 }, step_times: { 0: 30 } } });
  assert.equal(save.status, 200);
  assert.equal(save.json.status, 'in_progress', 'a partial flush must not change status');
  assert.equal(save.json.data.reading, 7, 'an in-progress autosave should persist');
});

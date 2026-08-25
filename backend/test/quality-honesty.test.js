// ─── Quality honesty: an uninspected run is not a pass ───────────────────────
// A real-plant dogfood found that "no Pass/Fail recorded" was being counted as
// a pass (or 0%) across four surfaces — inventing an 87% quality chart next to
// an 80% KPI, and drawing "100% pass" for departments/stations that inspect
// nothing. These tests pin the rule: only a run with an explicit Pass or Fail
// counts toward a quality number; a run with neither is excluded, not assumed
// good. Node built-ins only. Run with: npm test

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const PORT = 3173;
const BASE = `http://localhost:${PORT}`;
const DB_PATH = path.join(os.tmpdir(), `mes-quality-honesty-${Date.now()}.db`);

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
    body: { company_name: 'QC Honesty Co', email: 'admin@qc.test', password: 'SecretPass1', display_name: 'Admin' },
  });
  assert.equal(signup.status, 201);
  token = signup.json.token;
  appId = (await api('POST', '/api/apps', { token, body: { name: 'QC App' } })).json.id;
  stationId = (await api('POST', '/api/stations', { token, body: { name: 'QC Station' } })).json.id;
});

after(() => {
  if (server) server.kill('SIGTERM');
  for (const ext of ['', '-shm', '-wal']) { try { fs.unlinkSync(DB_PATH + ext); } catch { /* ignore */ } }
});

// Complete a run whose data blob carries the given QC value (or none).
async function runWith(qc) {
  const run = await api('POST', '/api/completions', { token, body: { app_id: appId, station_id: stationId, operator_name: 'Op' } });
  const data = qc === null ? { note: 'no inspection' } : { visual_ok: qc };
  await api('PUT', `/api/completions/${run.json.id}`, { token, body: { status: 'completed', data } });
}

test('the quality chart counts only inspected runs', async () => {
  await runWith('Pass');
  await runWith('Pass');
  await runWith('Fail');
  await runWith(null);   // completed but never inspected
  await runWith(null);

  const q = await api('GET', '/api/analytics/quality?days=30', { token });
  assert.equal(q.status, 200);
  const totals = q.json.reduce((acc, d) => ({ pass: acc.pass + d.pass, fail: acc.fail + d.fail }), { pass: 0, fail: 0 });
  // 2 Pass, 1 Fail, 2 uninspected → the two uninspected runs must NOT show up as passes.
  assert.equal(totals.pass, 2, `uninspected runs were counted as passes (pass=${totals.pass})`);
  assert.equal(totals.fail, 1);
});

test('the overview pass rate and the chart agree', async () => {
  const ov = await api('GET', '/api/analytics/overview?days=30', { token });
  // 2 pass / 3 inspected = 67%; sample size is the 3 inspected, not all 5 runs.
  assert.equal(ov.json.qcSampleSize, 3, `qcSampleSize should be inspected runs only, got ${ov.json.qcSampleSize}`);
  assert.equal(ov.json.passRate, 67);
});

test('OEE quality is null for a station that inspected nothing today', async () => {
  // A fresh station with one completed-but-uninspected run today.
  const st = (await api('POST', '/api/stations', { token, body: { name: 'Uninspected Station', ideal_cycle_seconds: 60 } })).json;
  const run = await api('POST', '/api/completions', { token, body: { app_id: appId, station_id: st.id, operator_name: 'Op' } });
  await api('PUT', `/api/completions/${run.json.id}`, { token, body: { status: 'completed', data: { note: 'ran, not inspected' } } });

  const oee = await api('GET', `/api/oee/${st.id}`, { token });
  assert.equal(oee.status, 200);
  assert.equal(oee.json.oee.quality, null, `quality must be null when nothing was inspected, got ${oee.json.oee.quality}`);
  assert.ok(oee.json.oee.missing.some(m => /inspected/.test(m)), 'the missing list should name the absent inspection');
});

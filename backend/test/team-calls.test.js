// ─── Team alerts (M6): the in-app "Request help" system on Andon ─────────────
// Spawns the real server against a throwaway database and exercises:
//   • create-from-player: a request raised mid-run stores AND returns the whole
//     run context (team, work order, app, step, completion, station,
//     department), with an auto-title derived from who is needed + location,
//   • raised from the app shell (no run): the same request with every run
//     context column left null,
//   • department targets: alerting one of the company's own departments,
//   • team + department filters: ?team= / ?department_id= return that queue,
//     including legacy rows that predate teams (tagged only by `type`),
//   • acknowledge ("On my way") → resolve lifecycle with responder names and
//     measured response / resolution seconds,
//   • cancel: the requester stands the alert down without losing the record,
//   • tenant isolation: cross-company reads, ack/resolve/cancel, and FK context
//     from another company (silently dropped, never linked),
//   • the WebSocket 'andon' frame is broadcast to the raising company only.
// Run with: npm test — uses only Node built-ins plus `ws` (already a dependency).

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const WebSocket = require('ws');

const PORT = 3183; // unique per test file — 3185-3199 are taken by other suites
const BASE = `http://localhost:${PORT}`;
const DB_PATH = path.join(os.tmpdir(), `mes-team-calls-test-${Date.now()}.db`);

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

// Opens an authenticated socket and collects every frame it receives.
function openSocket(token) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://localhost:${PORT}/ws?token=${token}`);
    const frames = [];
    ws.on('message', raw => {
      try { frames.push(JSON.parse(raw.toString())); } catch { /* ignore */ }
    });
    ws.on('open', () => resolve({ ws, frames }));
    ws.on('error', reject);
    setTimeout(() => reject(new Error('socket did not open in time')), 5000);
  });
}

const wait = ms => new Promise(r => setTimeout(r, ms));

let tokenA;         // Widget Co (developer)
let tokenB;         // Gadget Co (developer)
let appId;          // company A app
let deptId, stationId, workOrderId, completionId;
let foreignStationId, foreignAppId;   // company B rows, used for FK guards

before(async () => {
  await startServer();

  const a = await api('POST', '/api/auth/signup', {
    body: { company_name: 'Widget Co', email: 'owner@widget-tc.test', password: 'supersecret1', display_name: 'Wanda Owner' },
  });
  assert.equal(a.status, 201);
  tokenA = a.json.token;

  const b = await api('POST', '/api/auth/signup', {
    body: { company_name: 'Gadget Co', email: 'owner@gadget-tc.test', password: 'supersecret1', display_name: 'Gary Owner' },
  });
  assert.equal(b.status, 201);
  tokenB = b.json.token;

  const app = await api('POST', '/api/apps', { token: tokenA, body: { name: 'Torque Procedure' } });
  assert.equal(app.status, 201);
  appId = app.json.id;

  const dept = await api('POST', '/api/departments', { token: tokenA, body: { name: 'Assembly' } });
  assert.equal(dept.status, 201);
  deptId = dept.json.id;

  const station = await api('POST', '/api/stations', { token: tokenA, body: { name: 'Station 3', department_id: deptId } });
  assert.equal(station.status, 201);
  stationId = station.json.id;

  const wo = await api('POST', '/api/work-orders', {
    token: tokenA, body: { part_number: 'BRKT-200', part_name: 'Bracket', quantity: 10, app_id: appId },
  });
  assert.equal(wo.status, 201);
  workOrderId = wo.json.id;

  const completion = await api('POST', '/api/completions', {
    token: tokenA, body: { app_id: appId, operator_name: 'Ana Operator', work_order_id: workOrderId, station_id: stationId },
  });
  assert.equal(completion.status, 201);
  completionId = completion.json.id;

  const fStation = await api('POST', '/api/stations', { token: tokenB, body: { name: 'Foreign Station' } });
  assert.equal(fStation.status, 201);
  foreignStationId = fStation.json.id;

  const fApp = await api('POST', '/api/apps', { token: tokenB, body: { name: 'Foreign App' } });
  assert.equal(fApp.status, 201);
  foreignAppId = fApp.json.id;
});

after(() => {
  if (server) server.kill('SIGTERM');
  for (const ext of ['', '-shm', '-wal']) { try { fs.unlinkSync(DB_PATH + ext); } catch { /* ignore */ } }
});

// ─── 1. Create from the player: full context linkage ─────────────────────────

let playerCallId;

test('a call raised from the player links the whole run context', async () => {
  const created = await api('POST', '/api/andon', {
    token: tokenA,
    body: {
      team: 'quality',
      note: 'Torque reading is out of spec on unit 4',
      app_id: appId,
      completion_id: completionId,
      work_order_id: workOrderId,
      station_id: stationId,
      department_id: deptId,
      step_name: 'Final torque check',
      operator_name: 'Ana Operator',
    },
  });
  assert.equal(created.status, 201);
  playerCallId = created.json.id;

  const call = created.json;
  assert.equal(call.team, 'quality');
  assert.equal(call.team_label, 'Quality');
  assert.equal(call.type, 'quality', 'team maps onto the legacy type vocabulary');
  assert.equal(call.status, 'open');
  assert.equal(call.priority, 'normal');

  // Context — every linkage the responder needs to walk to the right place.
  assert.equal(call.app_id, appId);
  assert.equal(call.app_name, 'Torque Procedure');
  assert.equal(call.completion_id, completionId);
  assert.equal(call.work_order_id, workOrderId);
  assert.match(call.work_order_number, /^WO-/);
  assert.equal(call.part_name, 'Bracket');
  assert.equal(call.station_id, stationId);
  assert.equal(call.station_name, 'Station 3');
  assert.equal(call.department_id, deptId);
  assert.equal(call.department_name, 'Assembly');
  assert.equal(call.step_name, 'Final torque check');
  assert.equal(call.location, 'Station 3');
  assert.equal(call.created_by, 'Ana Operator');
  assert.equal(call.message, 'Torque reading is out of spec on unit 4');

  // No typed title needed: team + where it came from IS the title.
  assert.equal(call.title, 'Quality needed at Station 3');
  assert.equal(call.target_type, 'team');
  assert.equal(call.target_label, 'Quality');
  assert.equal(call.response_seconds, null, 'nobody has answered yet');
  assert.equal(call.resolution_seconds, null);
  assert.ok(call.age_seconds >= 0);
});

test('a bare request with no target and no title is rejected', async () => {
  const bad = await api('POST', '/api/andon', { token: tokenA, body: {} });
  assert.equal(bad.status, 400);
});

test('anyone can raise a request from outside a run — context stays null', async () => {
  // What the app-shell "Request help" action sends: who is needed, optionally
  // where, and a note. No work order, app, step or completion exists.
  const created = await api('POST', '/api/andon', {
    token: tokenA,
    body: { team: 'supervisor', station_id: stationId, note: 'Need a decision on the run order' },
  });
  assert.equal(created.status, 201);
  const call = created.json;
  assert.equal(call.team, 'supervisor');
  assert.equal(call.type, 'help');
  assert.equal(call.title, 'Supervisor needed at Station 3');
  assert.equal(call.station_id, stationId);
  assert.equal(call.work_order_id, null, 'no run context outside a run');
  assert.equal(call.app_id, null);
  assert.equal(call.completion_id, null);
  assert.equal(call.step_name, '');
  assert.equal(call.created_by, 'Wanda Owner', 'falls back to the signed-in user');
  assert.equal(call.status, 'open');

  // With no station either, it is still a valid request.
  const bare = await api('POST', '/api/andon', { token: tokenA, body: { team: 'supervisor' } });
  assert.equal(bare.status, 201);
  assert.equal(bare.json.title, 'Supervisor needed');
  assert.equal(bare.json.station_id, null);
  assert.equal(bare.json.location, '');

  // Tidy up so the later per-team counts stay readable.
  for (const id of [call.id, bare.json.id]) {
    assert.equal((await api('DELETE', `/api/andon/${id}`, { token: tokenA })).status, 200);
  }
});

test('a department can be alerted instead of a function team', async () => {
  const created = await api('POST', '/api/andon', {
    token: tokenA,
    body: { target_type: 'department', department_id: deptId, station_id: stationId, note: 'Need a second pair of hands' },
  });
  assert.equal(created.status, 201);
  const call = created.json;
  assert.equal(call.target_type, 'department');
  assert.equal(call.target_label, 'Assembly', 'the department name is what everyone renders');
  assert.equal(call.department_id, deptId);
  assert.equal(call.title, 'Assembly needed at Station 3');
  assert.ok(call.team, 'still carries a function team so team filters keep working');

  // Filterable by department, which also catches team requests raised there.
  const byDept = await api('GET', `/api/andon?department_id=${deptId}&status=open`, { token: tokenA });
  assert.ok(byDept.json.some(c => c.id === call.id));

  const item = (await api('GET', '/api/analytics/daily-brief', { token: tokenA }))
    .json.attention.find(i => i.call_id === call.id);
  assert.ok(item, 'department requests reach the Command Center too');
  assert.equal(item.target_type, 'department');
  assert.equal(item.label, 'Assembly needed · Station 3');
  assert.equal(item.link, `/andon?department_id=${deptId}`);

  // A department from another company can't be targeted — it falls back to the team.
  const foreignDept = await api('POST', '/api/departments', { token: tokenB, body: { name: 'Their Dept' } });
  assert.equal(foreignDept.status, 201);
  const spoofed = await api('POST', '/api/andon', {
    token: tokenA,
    body: { target_type: 'department', department_id: foreignDept.json.id, team: 'maintenance' },
  });
  assert.equal(spoofed.status, 201);
  assert.equal(spoofed.json.target_type, 'team', 'a foreign department is not a valid target');
  assert.equal(spoofed.json.department_id, null);
  assert.equal(spoofed.json.target_label, 'Maintenance');

  for (const id of [call.id, spoofed.json.id]) {
    assert.equal((await api('DELETE', `/api/andon/${id}`, { token: tokenA })).status, 200);
  }
});

test('the legacy shape (type + title, no team) still works and gets a team', async () => {
  const legacy = await api('POST', '/api/andon', {
    token: tokenA, body: { type: 'material', title: 'Bin 4 is empty', priority: 'high' },
  });
  assert.equal(legacy.status, 201);
  assert.equal(legacy.json.type, 'material');
  assert.equal(legacy.json.team, 'materials', 'a pre-team type still routes to a team');
  assert.equal(legacy.json.priority, 'high');
  assert.equal(legacy.json.title, 'Bin 4 is empty');
});

// ─── 2. Team filter ──────────────────────────────────────────────────────────

test('calls are filterable by team', async () => {
  const quality = await api('GET', '/api/andon?team=quality', { token: tokenA });
  assert.equal(quality.status, 200);
  assert.ok(quality.json.length >= 1);
  assert.ok(quality.json.every(c => c.team === 'quality'), 'only quality calls');
  assert.ok(quality.json.some(c => c.id === playerCallId));

  const materials = await api('GET', '/api/andon?team=materials', { token: tokenA });
  assert.equal(materials.status, 200);
  assert.ok(materials.json.every(c => c.team === 'materials'));
  assert.ok(!materials.json.some(c => c.id === playerCallId), 'quality call is filtered out');

  const maintenance = await api('GET', '/api/andon?team=maintenance', { token: tokenA });
  assert.equal(maintenance.json.length, 0, 'nobody has called maintenance');

  const all = await api('GET', '/api/andon', { token: tokenA });
  assert.ok(all.json.length >= 2, 'unfiltered list still returns everything');

  // The routing vocabulary is served, not hard-coded twice.
  const teams = await api('GET', '/api/andon/teams', { token: tokenA });
  assert.equal(teams.status, 200);
  assert.deepEqual(teams.json.map(t => t.id).sort(), ['maintenance', 'materials', 'quality', 'supervisor']);
});

test('the summary counts open calls per team', async () => {
  const s = await api('GET', '/api/andon/summary', { token: tokenA });
  assert.equal(s.status, 200);
  assert.equal(s.json.by_team.quality, 1);
  assert.equal(s.json.by_team.materials, 1);
  assert.equal(s.json.by_team.maintenance, 0);
  assert.equal(s.json.open, 2);
});

test('open calls surface on the Command Center attention feed with team, age and location', async () => {
  const brief = await api('GET', '/api/analytics/daily-brief', { token: tokenA });
  assert.equal(brief.status, 200);
  const item = brief.json.attention.find(i => i.call_id === playerCallId);
  assert.ok(item, 'the open call is in "needs attention"');
  assert.equal(item.type, 'andon_call');
  assert.equal(item.severity, 'red');
  assert.equal(item.team, 'quality');
  assert.equal(item.team_label, 'Quality');
  assert.equal(item.call_status, 'open');
  assert.equal(item.location, 'Station 3');
  assert.equal(item.label, 'Quality needed · Station 3');
  assert.equal(item.link, '/andon?team=quality');
  assert.match(item.detail, /WO WO-/, 'detail carries the work order');
  assert.ok(item.detail.includes('Torque Procedure · Final torque check'), 'detail carries app + step');
  assert.equal(typeof item.age_minutes, 'number');
  // A team call outranks the rest of the feed — a person is standing still.
  assert.equal(brief.json.attention[0].type, 'andon_call');
});

// ─── 3. Acknowledge → resolve lifecycle with timestamps ──────────────────────

test('acknowledge records the responder and a response time', async () => {
  const ack = await api('PUT', `/api/andon/${playerCallId}/acknowledge`, { token: tokenA });
  assert.equal(ack.status, 200);
  assert.equal(ack.json.status, 'acknowledged');
  assert.equal(ack.json.assigned_to, 'Wanda Owner', 'responder recorded');
  assert.equal(ack.json.acknowledged_by, 'Wanda Owner');
  assert.ok(ack.json.acknowledged_at, 'acknowledged_at stamped');
  assert.equal(typeof ack.json.response_seconds, 'number', 'time-to-respond measured');
  assert.ok(ack.json.response_seconds >= 0);
  assert.equal(ack.json.resolved_at, null);

  // Acknowledging twice is a conflict, not a silent overwrite of who responded.
  const again = await api('PUT', `/api/andon/${playerCallId}/acknowledge`, { token: tokenA });
  assert.equal(again.status, 409);

  // An acknowledged call is amber on the attention feed, with the responder named.
  const brief = await api('GET', '/api/analytics/daily-brief', { token: tokenA });
  const item = brief.json.attention.find(i => i.call_id === playerCallId);
  assert.equal(item.severity, 'amber');
  assert.equal(item.call_status, 'acknowledged');
  assert.ok(item.detail.includes('Wanda Owner on the way'));
});

test('resolve closes the call with a resolution and a resolution time', async () => {
  const done = await api('PUT', `/api/andon/${playerCallId}/resolve`, {
    token: tokenA, body: { resolution: 'Re-calibrated the driver; unit 4 re-torqued and passed' },
  });
  assert.equal(done.status, 200);
  assert.equal(done.json.status, 'resolved');
  assert.equal(done.json.resolved_by, 'Wanda Owner');
  assert.ok(done.json.resolved_at, 'resolved_at stamped');
  assert.match(done.json.resolution, /Re-calibrated/);
  assert.equal(typeof done.json.resolution_seconds, 'number');
  assert.ok(done.json.resolution_seconds >= 0);
  assert.equal(typeof done.json.response_seconds, 'number', 'response time survives resolution');

  const again = await api('PUT', `/api/andon/${playerCallId}/resolve`, { token: tokenA });
  assert.equal(again.status, 409, 'already resolved');

  // Closed calls leave the attention feed but stay on the board's history.
  const brief = await api('GET', '/api/analytics/daily-brief', { token: tokenA });
  assert.ok(!brief.json.attention.some(i => i.call_id === playerCallId));
  const history = await api('GET', '/api/andon?status=resolved', { token: tokenA });
  assert.ok(history.json.some(c => c.id === playerCallId));

  const summary = await api('GET', '/api/andon/summary', { token: tokenA });
  assert.equal(summary.json.resolved_today, 1);
  assert.equal(summary.json.responded_today, 1);
  assert.equal(typeof summary.json.avg_response_seconds_today, 'number');
});

test('the operator can stand a call down without erasing it', async () => {
  const raised = await api('POST', '/api/andon', {
    token: tokenA, body: { team: 'maintenance', station_id: stationId, note: 'Air line whistling' },
  });
  assert.equal(raised.status, 201);
  assert.equal(raised.json.title, 'Maintenance needed at Station 3');

  const cancelled = await api('PUT', `/api/andon/${raised.json.id}/cancel`, {
    token: tokenA, body: { reason: 'sorted it myself' },
  });
  assert.equal(cancelled.status, 200);
  assert.equal(cancelled.json.status, 'resolved');
  assert.match(cancelled.json.resolution, /Stood down/);
  assert.match(cancelled.json.resolution, /sorted it myself/);
  assert.ok(cancelled.json.resolved_at);

  const still = await api('GET', `/api/andon?team=maintenance&status=resolved`, { token: tokenA });
  assert.ok(still.json.some(c => c.id === raised.json.id), 'the record survives the cancel');
});

// ─── 4. Tenant isolation ─────────────────────────────────────────────────────

test('calls never cross companies', async () => {
  const mine = await api('POST', '/api/andon', {
    token: tokenA, body: { team: 'supervisor', station_id: stationId, note: 'Need a priority call' },
  });
  assert.equal(mine.status, 201);
  const id = mine.json.id;

  // Company B cannot see it…
  const theirList = await api('GET', '/api/andon', { token: tokenB });
  assert.ok(!theirList.json.some(c => c.id === id), 'not in the other company list');
  const theirTeamList = await api('GET', '/api/andon?team=supervisor', { token: tokenB });
  assert.equal(theirTeamList.json.length, 0);

  // …nor act on it.
  assert.equal((await api('PUT', `/api/andon/${id}/acknowledge`, { token: tokenB })).status, 404);
  assert.equal((await api('PUT', `/api/andon/${id}/resolve`, { token: tokenB })).status, 404);
  assert.equal((await api('PUT', `/api/andon/${id}/cancel`, { token: tokenB })).status, 404);
  assert.equal((await api('DELETE', `/api/andon/${id}`, { token: tokenB })).status, 404);

  // …and their attention feed and summary stay clean.
  const theirBrief = await api('GET', '/api/analytics/daily-brief', { token: tokenB });
  assert.ok(!theirBrief.json.attention.some(i => i.type === 'andon_call'));
  const theirSummary = await api('GET', '/api/andon/summary', { token: tokenB });
  assert.equal(theirSummary.json.open, 0);

  // Still ours, still open.
  assert.equal((await api('GET', '/api/andon?team=supervisor', { token: tokenA })).json.length, 1);
});

test('context pointing at another company is dropped, never linked', async () => {
  const created = await api('POST', '/api/andon', {
    token: tokenA,
    body: { team: 'materials', station_id: foreignStationId, app_id: foreignAppId, note: 'Cross-tenant attempt' },
  });
  assert.equal(created.status, 201);
  assert.equal(created.json.station_id, null, 'foreign station dropped');
  assert.equal(created.json.app_id, null, 'foreign app dropped');
  assert.equal(created.json.station_name, null);
  assert.equal(created.json.title, 'Materials needed', 'no location leaked into the title');
});

// ─── 5. WebSocket broadcast ──────────────────────────────────────────────────

test('raising, acknowledging and resolving broadcast to the company only', async () => {
  const mine = await openSocket(tokenA);
  const theirs = await openSocket(tokenB);
  try {
    const created = await api('POST', '/api/andon', {
      token: tokenA,
      body: { team: 'quality', station_id: stationId, app_id: appId, step_name: 'Weld inspection', note: 'Second opinion please' },
    });
    assert.equal(created.status, 201);
    const id = created.json.id;

    await api('PUT', `/api/andon/${id}/acknowledge`, { token: tokenA });
    await api('PUT', `/api/andon/${id}/resolve`, { token: tokenA, body: { resolution: 'Passed' } });
    await wait(400);

    const forThisCall = mine.frames.filter(f => f.type === 'andon' && f.call?.id === id);
    assert.deepEqual(
      forThisCall.map(f => f.action),
      ['created', 'acknowledged', 'resolved'],
      'every state change is pushed, in order',
    );

    // The payload is the whole call, so a dashboard can render it without refetching.
    const createdFrame = forThisCall[0];
    assert.equal(createdFrame.call.team, 'quality');
    assert.equal(createdFrame.call.team_label, 'Quality');
    assert.equal(createdFrame.call.station_name, 'Station 3');
    assert.equal(createdFrame.call.step_name, 'Weld inspection');
    assert.equal(createdFrame.call.status, 'open');
    assert.equal(forThisCall[1].call.assigned_to, 'Wanda Owner');
    assert.equal(typeof forThisCall[2].call.resolution_seconds, 'number');

    assert.equal(
      theirs.frames.filter(f => f.type === 'andon').length, 0,
      'the other company hears nothing',
    );
  } finally {
    mine.ws.close();
    theirs.ws.close();
  }
});

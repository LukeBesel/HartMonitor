'use strict';
// ─── A PM that raises its own job ────────────────────────────────────────────
// pm_schedules only ever moved when a human clicked "Mark Complete", so a PM
// that came due was a row nothing acted on. This suite pins the loop that
// replaces that:
//
//   • a due schedule raises EXACTLY ONE preventive work order on the first
//     sweep and none on the second, carrying pm_schedule_id and raised_by
//     'system',
//   • completing that job rolls the schedule forward and re-arms it, so the
//     next sweep raises nothing until the next cycle,
//   • completing the SCHEDULE closes the job it raised (one piece of work, not
//     two),
//   • auto_create_wo = 0 raises nothing, and lead_days raises early on purpose,
//   • an hours-based schedule raises nothing and says "needs a meter reading"
//     where a date would be, instead of returning a silent null,
//   • the Overdue PMs tile counts exactly the rows the overdue list returns —
//     both in the PLANT's day, proven on Pacific/Auckland, whatever the wall
//     clock of the machine running this test.
//
// The sweeper is off under NODE_ENV=test; POST /api/maintenance/pm-sweep drives
// exactly one sweep, which is the only way to assert "and none on the second".
//
// Uses Node built-ins only (node:test + global fetch). Run with:
//   node --test test/pm-auto-raise.test.js

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const PORT = 3408; // reserved for this workstream — see MIGRATIONS.md
const BASE = `http://localhost:${PORT}`;
const DB_PATH = path.join(os.tmpdir(), `mes-pm-auto-raise-${Date.now()}.db`);
const ZONE = 'Pacific/Auckland'; // +12/+13 — a day ahead of UTC most evenings

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
        EARLY_ACCESS: 'true',   // maintenance is a pro feature; this is about the loop
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

// ─── The plant's day, computed the same way the server computes it ───────────
// Never `new Date().toISOString().slice(0,10)`: in Auckland that is yesterday
// all morning. The date is read out of the zone itself, then walked back a day,
// and stamped at midnight UTC — which is 12:00 or 13:00 on that same Auckland
// date, so the stamp lands on the intended plant day whatever the DST offset.

function plantDate(offsetDays = 0) {
  const d = new Date(Date.now() + offsetDays * 86400000);
  return new Intl.DateTimeFormat('en-CA', { timeZone: ZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}
const atPlantDay = (offsetDays) => `${plantDate(offsetDays)}T00:00:00.000Z`;

let token, assetId;

before(async () => {
  await startServer();
  const signup = await api('POST', '/api/auth/signup', {
    body: {
      company_name: 'Kiwi Fabrication', email: 'owner@kiwi-pm.test',
      password: 'supersecret1', display_name: 'Kara Owner', timezone: ZONE,
    },
  });
  assert.equal(signup.status, 201, `signup: ${JSON.stringify(signup.json)}`);
  token = signup.json.token;

  const cfg = await api('GET', '/api/config', { token });
  assert.equal(cfg.json.timezone, ZONE, 'the company really is on the Auckland clock');

  const asset = await api('POST', '/api/maintenance/assets', {
    token, body: { asset_number: 'PRESS-1', name: 'Press 1' },
  });
  assert.equal(asset.status, 201, `asset: ${JSON.stringify(asset.json)}`);
  assetId = asset.json.id;
});

after(() => {
  if (server) server.kill('SIGTERM');
  for (const ext of ['', '-shm', '-wal']) { try { fs.unlinkSync(DB_PATH + ext); } catch { /* ignore */ } }
});

// ── helpers ───────────────────────────────────────────────────────────────────

async function createPM(body) {
  const r = await api('POST', '/api/maintenance/pm-schedules', { token, body: { asset_id: assetId, ...body } });
  assert.equal(r.status, 201, `create PM: ${JSON.stringify(r.json)}`);
  return r.json;
}

async function sweep() {
  const r = await api('POST', '/api/maintenance/pm-sweep', { token });
  assert.equal(r.status, 200, `sweep: ${JSON.stringify(r.json)}`);
  return r.json;
}

async function pmById(id) {
  const r = await api('GET', '/api/maintenance/pm-schedules', { token });
  assert.equal(r.status, 200);
  return r.json.find(p => p.id === id) || null;
}

async function wosFor(pmId) {
  const r = await api('GET', `/api/maintenance/work-orders?pm_schedule_id=${pmId}`, { token });
  assert.equal(r.status, 200);
  return r.json;
}

// ─── The loop ─────────────────────────────────────────────────────────────────

test('a monthly PM due yesterday raises exactly one job, and completing it re-arms the schedule', async () => {
  const pm = await createPM({
    title: '500-hour service', frequency_type: 'monthly', frequency_value: 1,
    assigned_to: 'Maintenance', next_due_at: atPlantDay(-1),
  });
  assert.equal(pm.auto_create_wo, true, 'auto-raise is on by default — a PM nobody sees is the bug');
  assert.equal(pm.lead_days, 0);
  assert.equal(pm.is_overdue, true, 'due yesterday on the plant clock');
  assert.equal(pm.next_due_reason, null);

  // ── First sweep ──
  const first = await sweep();
  assert.equal(first.count, 1, `one job raised: ${JSON.stringify(first)}`);
  const jobs = await wosFor(pm.id);
  assert.equal(jobs.length, 1);
  const job = jobs[0];
  assert.equal(job.type, 'preventive');
  assert.equal(job.title, '500-hour service', 'the job is titled from the schedule');
  assert.equal(job.pm_schedule_id, pm.id);
  assert.equal(job.raised_by, 'system', 'the job says who put it there');
  assert.equal(job.pm_title, '500-hour service', 'and carries the PM it came from, for the origin line');
  assert.equal(job.asset_id, assetId);
  assert.equal(job.priority, 'high', 'an already-overdue PM is not the same job as one raised early');
  assert.equal(job.status, 'open');
  assert.ok(job.wo_number, 'it is numbered like every other work order');

  // ── Second sweep: the schedule already has an open job ──
  const second = await sweep();
  assert.equal(second.count, 0, 'one due PM is one job, not one per sweep');
  assert.equal((await wosFor(pm.id)).length, 1);

  const stamped = await pmById(pm.id);
  assert.equal(stamped.last_raised_wo_id, job.id);
  assert.ok(stamped.last_raised_at);
  assert.equal(stamped.open_wo_number, job.wo_number, 'the schedule points at its open job');

  // ── Completing the job completes the PM ──
  const done = await api('PUT', `/api/maintenance/work-orders/${job.id}`, { token, body: { status: 'completed' } });
  assert.equal(done.status, 200, JSON.stringify(done.json));

  const rolled = await pmById(pm.id);
  assert.ok(rolled.last_completed_at, 'the PM was completed by the job being completed');
  assert.equal(rolled.is_overdue, false);
  const before = new Date(pm.next_due_at);
  const after = new Date(rolled.next_due_at);
  assert.ok(after > new Date(), 'the next one is in the future');
  const days = (after - before) / 86400000;
  assert.ok(days >= 27 && days <= 33, `one month forward, got ${days.toFixed(1)} days`);

  // ── And the next sweep has nothing to do ──
  const third = await sweep();
  assert.equal(third.count, 0, 'the schedule is re-armed, not re-raised');
});

test('completing the schedule closes the job it raised', async () => {
  const pm = await createPM({ title: 'Weekly greasing', frequency_type: 'weekly', next_due_at: atPlantDay(-1) });
  assert.equal((await sweep()).count, 1);
  const job = (await wosFor(pm.id))[0];
  assert.equal(job.status, 'open');

  const completed = await api('POST', `/api/maintenance/pm-schedules/${pm.id}/complete`, { token });
  assert.equal(completed.status, 200, JSON.stringify(completed.json));
  assert.equal(completed.json.closed_work_order_id, job.id, 'one piece of work, not two');

  const afterJobs = await wosFor(pm.id);
  assert.equal(afterJobs[0].status, 'completed');
  assert.ok(completed.json.last_completed_at);
  assert.equal((await sweep()).count, 0);
});

test('auto_create_wo = 0 raises nothing; lead_days raises early on purpose', async () => {
  const off = await createPM({ title: 'Manual-only inspection', frequency_type: 'monthly', next_due_at: atPlantDay(-1), auto_create_wo: false });
  assert.equal(off.auto_create_wo, false);
  assert.equal((await sweep()).count, 0, 'a schedule the plant runs by hand stays out of the queue');
  assert.equal((await wosFor(off.id)).length, 0);

  // Due in two days: nothing yet with no lead time…
  const soon = await createPM({ title: 'Filter change', frequency_type: 'monthly', next_due_at: atPlantDay(2) });
  assert.equal(soon.is_overdue, false);
  assert.equal((await sweep()).count, 0);

  // …and raised the moment three days of lead time is asked for, so the part
  // can be ordered before the machine stops.
  const lead = await api('PUT', `/api/maintenance/pm-schedules/${soon.id}`, { token, body: { lead_days: 3 } });
  assert.equal(lead.status, 200);
  assert.equal(lead.json.lead_days, 3);
  const raised = await sweep();
  assert.equal(raised.count, 1);
  const job = (await wosFor(soon.id))[0];
  assert.equal(job.priority, 'medium', 'raised in its lead window, not late');

  // Turning auto-raise off afterwards keeps the sweeper away from it.
  await api('PUT', `/api/maintenance/pm-schedules/${off.id}`, { token, body: { auto_create_wo: false } });
  assert.equal((await sweep()).count, 0);
});

test('a meter-based schedule says what it needs instead of returning nothing', async () => {
  const hours = await createPM({ title: '250-hour oil change', frequency_type: 'hours', frequency_value: 250 });
  assert.equal(hours.next_due_at, null);
  assert.equal(hours.next_due_reason, 'needs a meter reading',
    'a blank date reads as a bug; the reason reads as the truth');
  assert.equal(hours.is_overdue, false, 'a schedule with no due date cannot be overdue');

  const cycles = await createPM({ title: '10k-cycle die check', frequency_type: 'cycles', frequency_value: 10000 });
  assert.equal(cycles.next_due_reason, 'needs a meter reading');

  assert.equal((await sweep()).count, 0, 'hours and cycles cannot be projected onto a calendar');
  assert.equal((await wosFor(hours.id)).length, 0);
  assert.equal((await wosFor(cycles.id)).length, 0);

  // And it never counts as overdue in the tile either.
  const list = await api('GET', '/api/maintenance/pm-schedules?overdue=true', { token });
  assert.equal(list.json.some(p => p.id === hours.id), false);
});

test('the Overdue PMs tile counts exactly the rows the overdue list returns, on the plant clock', async () => {
  // Three schedules pinned to Auckland days either side of the boundary: two
  // overdue, one due today (which still has the day to run) and one tomorrow.
  await createPM({ title: 'Overdue A', frequency_type: 'monthly', next_due_at: atPlantDay(-1), auto_create_wo: false });
  await createPM({ title: 'Overdue B', frequency_type: 'monthly', next_due_at: atPlantDay(-5), auto_create_wo: false });
  const today = await createPM({ title: 'Due today', frequency_type: 'monthly', next_due_at: atPlantDay(0), auto_create_wo: false });
  const tomorrow = await createPM({ title: 'Due tomorrow', frequency_type: 'monthly', next_due_at: atPlantDay(1), auto_create_wo: false });

  const overdueList = await api('GET', '/api/maintenance/pm-schedules?overdue=true', { token });
  assert.equal(overdueList.status, 200);
  const summary = await api('GET', '/api/maintenance/summary', { token });
  assert.equal(summary.status, 200);
  assert.equal(summary.json.overdue_pms, overdueList.json.length,
    'the tile and the list are one predicate, or the screen contradicts itself');
  assert.ok(overdueList.json.length >= 2, `the two backdated schedules are overdue: ${overdueList.json.map(p => p.title)}`);
  assert.equal(overdueList.json.some(p => p.id === today.id), false, 'due today still has the day to run');
  assert.equal(overdueList.json.some(p => p.id === tomorrow.id), false);

  // The full list agrees with the filtered one, row for row.
  const all = await api('GET', '/api/maintenance/pm-schedules', { token });
  const flagged = all.json.filter(p => p.is_overdue).map(p => p.id).sort();
  assert.deepEqual(flagged, overdueList.json.map(p => p.id).sort(),
    'is_overdue on a row means exactly what ?overdue=true selects');
});

test('the shipped /pm path and the /pm-schedules path are the same list', async () => {
  const legacy = await api('GET', '/api/maintenance/pm', { token });
  const current = await api('GET', '/api/maintenance/pm-schedules', { token });
  assert.equal(legacy.status, 200);
  assert.deepEqual(legacy.json.map(p => p.id), current.json.map(p => p.id));
  assert.ok(legacy.json.every(p => 'next_due_reason' in p && 'is_overdue' in p));
});

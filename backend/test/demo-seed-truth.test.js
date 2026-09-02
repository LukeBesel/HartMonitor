'use strict';
// ─── The demo shows every module alive ────────────────────────────────────────
// Waves 1-4 made routings/operations, coded scrap and downtime, andon
// escalation, app revisions and training enforcement real. This suite proves
// the sandbox seed actually DEMONSTRATES each of them — a routed job standing
// on operation 2 of 4, real scrap with a coded reason, a downtime Pareto with
// three named causes, an andon call that escalated and one answered inside
// its target, an instruction on Rev 2 with an approver distinct from the
// author, and a training block that was overridden — and that
// deleteSandboxOrg removes every one of these new rows.
//
// Uses Node built-ins only (node:test + global fetch). Run with:
//   node --test test/demo-seed-truth.test.js

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const PORT = 3415; // reserved for this stream (demo-seed) in MIGRATIONS.md
const BASE = `http://localhost:${PORT}`;
const DB_PATH = path.join(os.tmpdir(), `mes-demo-seed-truth-${Date.now()}.db`);

process.env.DATABASE_PATH = DB_PATH;
process.env.SEED_DEMO_DATA = 'false';

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

let token, userId, orgId, db;

before(async () => {
  await startServer();

  const demo = await api('POST', '/api/auth/demo');
  assert.equal(demo.status, 201, `demo login: ${JSON.stringify(demo.json)}`);
  token = demo.json.token;
  userId = demo.json.user.id;

  db = require('../src/db');
  orgId = db.prepare('SELECT company_id FROM users WHERE id = ?').get(userId).company_id;
});

after(() => {
  if (server) server.kill('SIGTERM');
  for (const ext of ['', '-shm', '-wal']) { try { fs.unlinkSync(DB_PATH + ext); } catch { /* ignore */ } }
});

// ─── Routings and operations ──────────────────────────────────────────────────

test('a released work order stands on operation 2 of 4, 12 of 50 done', async () => {
  const routings = await api('GET', '/api/routings', { token });
  assert.equal(routings.status, 200);
  const list = Array.isArray(routings.json) ? routings.json : routings.json.routings;
  const routing = list.find(r => r.name === 'Bracket Line');
  assert.ok(routing, `Bracket Line routing seeded (got: ${list.map(r => r.name).join(', ')})`);

  const wos = await api('GET', '/api/work-orders?status=in_progress', { token });
  assert.equal(wos.status, 200);
  const rows = Array.isArray(wos.json) ? wos.json : wos.json.work_orders;
  const wo = rows.find(w => w.work_order_number.endsWith('WO-3001'));
  assert.ok(wo, `WO-3001 seeded and released (got: ${rows.map(w => w.work_order_number).join(', ')})`);
  assert.ok(wo.due_date, 'carries a due date');
  assert.ok(wo.customer_ref, 'carries a customer reference');

  const ops = await api('GET', `/api/work-orders/${wo.id}/operations`, { token });
  assert.equal(ops.status, 200);
  const opRows = Array.isArray(ops.json) ? ops.json : ops.json.operations;
  assert.equal(opRows.length, 4, 'four operations released from the routing');

  const op2 = opRows.find(o => o.sequence === 2);
  assert.ok(op2, 'operation 2 exists');
  assert.equal(op2.name, 'Weld');
  assert.equal(op2.quantity_completed, 12);
  assert.equal(op2.quantity_required, 50);
  assert.equal(wo.current_operation_id, op2.id, 'the work order points at operation 2');

  // The search box's own sentence — the same one the operator portal prints.
  const search = await api('GET', `/api/floor/wip?q=${encodeURIComponent(wo.work_order_number)}`, { token });
  assert.equal(search.status, 200);
  assert.ok(
    search.json.answer.startsWith(`${wo.work_order_number} is at operation 2 of 4`),
    `search answers "is at operation 2 of 4": ${search.json.answer}`,
  );

  // A second job, just released, standing on operation 1.
  const wo2 = rows.length ? (await api('GET', '/api/work-orders?status=pending', { token })).json : [];
  const pendingRows = Array.isArray(wo2) ? wo2 : (wo2.work_orders || []);
  const justReleased = pendingRows.find(w => w.work_order_number.endsWith('WO-3002'));
  assert.ok(justReleased, 'a second job was released on the same routing');
  assert.ok(justReleased.released_at, 'it is released, not merely planned');

  // MAJOR 1: the job-level counters routes/completions.js's own finish path
  // would have synced (quantity_completed, status) are not left at their
  // release-time defaults — a job actually in progress must not read 0% /
  // 'behind' on the Command Center, and a job nobody has touched yet must
  // read 'not_started', not 'behind'.
  assert.ok(wo.quantity_completed > 0, 'WO-3001 quantity_completed is synced, not left at 0');
  assert.ok(wo.completion_pct > 0, 'WO-3001 completion_pct > 0');
  assert.equal(wo.status, 'in_progress');
  assert.notEqual(wo.schedule_status, 'behind', `WO-3001 must not read 'behind' the moment it is released (got ${wo.schedule_status})`);

  assert.equal(justReleased.quantity_completed, 0, 'WO-3002 has booked nothing yet');
  assert.equal(justReleased.schedule_status, 'not_started', `WO-3002 has not been handed to anyone (got ${justReleased.schedule_status})`);
});

// ─── Scrap with a coded reason ─────────────────────────────────────────────────

test('scrap is coded and reconciles with the operation it was booked to', () => {
  const wo1Ops = db.prepare(`
    SELECT o.* FROM work_order_operations o
    JOIN work_orders wo ON wo.id = o.work_order_id
    WHERE o.company_id = ? AND wo.work_order_number LIKE '%WO-3001' ORDER BY o.sequence
  `).all(orgId);
  assert.equal(wo1Ops.length, 4);
  const op1 = wo1Ops.find(o => o.sequence === 1);
  const op2 = wo1Ops.find(o => o.sequence === 2);
  assert.equal(op2.quantity_completed, 12);
  assert.equal(op1.quantity_completed, 50);

  // MAJOR 2: EVERY operation's own quantity_completed/quantity_scrapped must
  // equal the sum of its own runs' quantity_good/quantity_scrap — not just
  // the one operation this seed happens to book scrap against.
  for (const op of wo1Ops) {
    const runs = db.prepare(`
      SELECT quantity_good, quantity_scrap, scrap_reason_code_id
      FROM completions WHERE company_id = ? AND work_order_operation_id = ?
    `).all(orgId, op.id);
    const sumGood = runs.reduce((a, r) => a + (r.quantity_good || 0), 0);
    const sumScrap = runs.reduce((a, r) => a + (r.quantity_scrap || 0), 0);
    assert.equal(sumGood, op.quantity_completed,
      `operation ${op.sequence} (${op.name}): SUM(quantity_good) (${sumGood}) must equal quantity_completed (${op.quantity_completed})`);
    assert.equal(sumScrap, op.quantity_scrapped,
      `operation ${op.sequence} (${op.name}): SUM(quantity_scrap) (${sumScrap}) must equal quantity_scrapped (${op.quantity_scrapped})`);
  }
  assert.ok(db.prepare('SELECT COUNT(*) c FROM completions WHERE company_id = ? AND work_order_operation_id = ?').get(orgId, op1.id).c >= 1,
    'operation 1 (Cut) has real runs behind its 50, not a bare number');

  const runs2 = db.prepare(`
    SELECT quantity_good, quantity_scrap, scrap_reason_code_id
    FROM completions WHERE company_id = ? AND work_order_operation_id = ?
  `).all(orgId, op2.id);
  const scrapped = runs2.filter(r => r.quantity_scrap > 0);
  assert.ok(scrapped.length >= 1, 'at least one run carries scrap');
  assert.ok(scrapped[0].scrap_reason_code_id, 'the scrap carries a coded reason');

  const reason = db.prepare('SELECT * FROM reason_codes WHERE id = ?').get(scrapped[0].scrap_reason_code_id);
  assert.ok(reason, 'the reason code row exists');
  assert.equal(reason.kind, 'scrap');
  assert.equal(reason.company_id, orgId);
});

test('GET /api/completions/scrap reports a real, sampled yield with coded reasons', async () => {
  const scrap = await api('GET', '/api/completions/scrap?days=1', { token });
  assert.equal(scrap.status, 200);
  assert.ok(scrap.json.totals.sample > 0, 'the yield tile has a sample');
  assert.ok(scrap.json.totals.scrap > 0, 'real scrap recorded today');
  assert.ok(scrap.json.totals.fpy !== null, 'a real yield fraction, not null');

  const part = scrap.json.parts.find(p => p.part_number === 'BRKT-100');
  assert.ok(part, 'the Bracket Line part shows up in the by-part breakdown');
  assert.ok(part.reasons.length >= 1, 'the scrap on it carries a coded reason');
  assert.ok(part.reasons[0].label, 'the reason has a real label, not a raw code');
});

// ─── Downtime Pareto across three loss buckets ────────────────────────────────

test('GET /api/oee/losses shows a Pareto with three named causes in three buckets', async () => {
  const losses = await api('GET', '/api/oee/losses?days=1', { token });
  assert.equal(losses.status, 200);
  assert.ok(losses.json.pareto.length >= 3, `at least three named causes (got ${losses.json.pareto.length})`);
  const buckets = new Set(losses.json.pareto.map(r => r.loss_bucket).filter(Boolean));
  assert.ok(buckets.size >= 3, `at least three distinct loss buckets (got: ${[...buckets].join(', ')})`);
  for (const row of losses.json.pareto.slice(0, 3)) {
    assert.ok(row.label, 'each Pareto row is named');
    assert.ok(row.minutes > 0, 'each Pareto row carries real minutes');
  }
});

test('machine_events: at least three coded stops today across three loss buckets', () => {
  const rows = db.prepare(`
    SELECT me.reason_code_id, rc.loss_bucket
    FROM machine_events me
    JOIN stations s ON s.id = me.station_id
    JOIN reason_codes rc ON rc.id = me.reason_code_id
    WHERE s.company_id = ? AND me.event_type = 'down'
      AND date(me.started_at) = date('now')
  `).all(orgId);
  assert.ok(rows.length >= 3, `at least 3 coded stops today (got ${rows.length})`);
  const buckets = new Set(rows.map(r => r.loss_bucket));
  assert.ok(buckets.size >= 3, `at least 3 distinct loss buckets (got: ${[...buckets].join(', ')})`);
});

// ─── Andon: one escalated, one answered inside target ─────────────────────────

test('one andon call escalated to a real manager; one was acknowledged inside target', async () => {
  const escalated = db.prepare(`
    SELECT * FROM andon_calls WHERE company_id = ? AND escalation_level >= 1
  `).get(orgId);
  assert.ok(escalated, 'an escalated call exists');
  assert.equal(escalated.status, 'open', 'escalation is a level, not a status change');
  assert.ok(escalated.respond_by, 'carries a target');
  assert.ok(new Date(escalated.respond_by).getTime() < Date.now(), 'respond_by is in the past');
  assert.ok(escalated.escalated_at, 'escalated_at stamped');
  assert.ok(escalated.escalated_to_user_id, 'escalated_to_user_id stamped');
  const manager = db.prepare('SELECT role FROM users WHERE id = ? AND company_id = ?')
    .get(escalated.escalated_to_user_id, orgId);
  assert.ok(manager, 'escalated to a real seeded user');
  assert.ok(['manager', 'developer'].includes(manager.role), 'escalated to a manager, not an operator');

  const summary = await api('GET', '/api/andon/summary', { token });
  assert.equal(summary.status, 200);
  assert.ok(summary.json.escalated_open >= 1, 'the summary counts the escalated call');
  assert.notEqual(summary.json.within_target_pct, null, 'within-target is a measured number');
  assert.ok(summary.json.within_target_sample >= 1, 'the within-target figure carries a sample');

  // MAJOR 3: a two-level escalation must be genuine — no "nobody to escalate
  // to" line (the symptom of re-resolving a tier that was already excluded),
  // and the acknowledged call's responder is not the person who raised it.
  const nobody = db.prepare(`
    SELECT COUNT(*) c FROM activity_log WHERE company_id = ? AND entity_type = 'andon' AND action LIKE '%Nobody to escalate to%'
  `).get(orgId).c;
  assert.equal(nobody, 0, 'no "Nobody to escalate to" line in the audit log');
  assert.equal(escalated.escalation_level, 2, 'a genuine two-rung climb');

  const acknowledged = db.prepare(`
    SELECT * FROM andon_calls WHERE company_id = ? AND status = 'acknowledged'
  `).get(orgId);
  assert.ok(acknowledged, 'the acknowledged call exists');
  assert.notEqual(acknowledged.acknowledged_by_user_id, acknowledged.created_by_user_id,
    'acknowledged by someone other than the raiser');

  // The sweeper must leave a fully-escalated call alone — it is already at
  // MAX_ESCALATION_LEVEL, so runOnce() must not touch it (and, since nothing
  // changed, must not write a second "Nobody to escalate to" line either).
  const andonEscalation = require('../src/andonEscalation');
  const before2 = db.prepare('SELECT * FROM andon_calls WHERE id = ?').get(escalated.id);
  andonEscalation.runOnce(new Date(), orgId);
  const after2 = db.prepare('SELECT * FROM andon_calls WHERE id = ?').get(escalated.id);
  assert.deepEqual(after2, before2, 'runOnce() leaves an already-fully-escalated call untouched');
  const nobodyAfter = db.prepare(`
    SELECT COUNT(*) c FROM activity_log WHERE company_id = ? AND entity_type = 'andon' AND action LIKE '%Nobody to escalate to%'
  `).get(orgId).c;
  assert.equal(nobodyAfter, 0, 'still no "Nobody to escalate to" line after a real sweep tick');
});

// ─── App revisions: Rev 1 and Rev 2, distinct publisher and approver ─────────

test('the QC app carries two revisions with a distinct publisher and approver', async () => {
  const apps = await api('GET', '/api/apps', { token });
  const qcApp = apps.json.find(a => a.name === 'Final QC Inspection');
  assert.ok(qcApp, 'QC app seeded');

  const revs = await api('GET', `/api/apps/${qcApp.id}/revisions`, { token });
  assert.equal(revs.status, 200);
  assert.equal(revs.json.current_revision, 2);
  assert.equal(revs.json.revisions.length, 2);

  const [rev2, rev1] = revs.json.revisions; // newest first
  assert.equal(rev1.revision, 1);
  assert.equal(rev1.change_note, 'First release');
  assert.equal(rev2.revision, 2);
  assert.equal(rev2.change_note, 'Added torque check');
  assert.notEqual(rev1.published_by_user_id, rev1.approved_by_user_id, 'Rev 1: approver is not the author');
  assert.notEqual(rev2.published_by_user_id, rev2.approved_by_user_id, 'Rev 2: approver is not the author');
  assert.equal(rev1.published_by_user_id, rev2.published_by_user_id, 'same publisher both times (the visitor)');
  assert.equal(rev1.approved_by_user_id, rev2.approved_by_user_id, 'same approver both times (the seeded manager)');
  assert.ok(rev1.published_by_name, 'publisher name resolves');
  assert.ok(rev1.approved_by_name, 'approver name resolves');

  // Completions carry the right revision: earlier runs Rev 1, the latest Rev 2.
  const completions = await api('GET', `/api/completions?app_id=${qcApp.id}`, { token });
  const sorted = completions.json.slice().sort((a, b) => new Date(a.completed_at) - new Date(b.completed_at));
  const withRevisions = sorted.filter(c => c.app_revision_id);
  assert.ok(withRevisions.length >= 6, 'every seeded QC run carries a revision id');
  assert.equal(sorted[sorted.length - 1].app_revision_id, rev2.id, 'the latest run is stamped Rev 2');
  assert.equal(sorted[0].app_revision_id, rev1.id, 'the earliest run is stamped Rev 1');

  const latestDetail = await api('GET', `/api/completions/${sorted[sorted.length - 1].id}`, { token });
  assert.equal(latestDetail.status, 200);
  assert.equal(latestDetail.json.app_revision.revision, 2, 'the run detail page says Rev 2');
});

// ─── Training: an expired cert, overridden by a supervisor ────────────────────

test('training enforcement is block, with one override on record for the expired operator', async () => {
  // MAJOR 4: 'block' is the mode the override exists for — under 'warn'
  // nothing is ever blocked, so a qualification_state 'override' run could
  // never actually occur.
  const enforcement = await api('GET', '/api/training/enforcement', { token });
  assert.equal(enforcement.status, 200);
  assert.equal(enforcement.json.enforcement, 'block');

  const overrides = await api('GET', '/api/training/overrides', { token });
  assert.equal(overrides.status, 200);
  assert.ok(overrides.json.length >= 1, 'at least one override on record');
  const ov = overrides.json[0];
  assert.equal(ov.reason, 'Cover for absence');
  assert.ok(ov.approved_by_name, 'names the approver');
  assert.notEqual(ov.approved_by_user_id, ov.user_id, 'approver is not the operator');

  const supervisor = db.prepare('SELECT role FROM users WHERE id = ? AND company_id = ?')
    .get(ov.approved_by_user_id, orgId);
  assert.ok(supervisor, 'approver is a real seeded user');
  assert.ok(['supervisor', 'manager', 'developer'].includes(supervisor.role), 'approver holds supervisor rank or above');

  assert.ok(ov.completion_id, 'the override links to the run it let through');
  const completion = db.prepare('SELECT operator_user_id, operator_name, qualification_state FROM completions WHERE id = ? AND company_id = ?')
    .get(ov.completion_id, orgId);
  assert.equal(completion.qualification_state, 'override');
  // MAJOR 5 (asserted on both paths — this is the sandbox path; the
  // loadSampleDataForCompany path is asserted in its own describe block
  // below): the override's operator is the SAME person as the run's own
  // operator, not a different one the override happens to point at.
  assert.equal(ov.user_id, completion.operator_user_id, 'the override\'s operator matches the run\'s own operator');

  const expired = db.prepare(`
    SELECT * FROM training_records WHERE company_id = ? AND app_id = ? AND status = 'expired'
  `).get(orgId, ov.app_id);
  assert.ok(expired, 'an expired training record exists for the QC app');
  assert.equal(expired.user_id, ov.user_id, 'the override\'s operator is the one with the expired certification');

  // Certifications for anyone else who might drive the app live are present,
  // so the block is real for the trainee and invisible to everyone else.
  const others = db.prepare(`
    SELECT COUNT(*) c FROM training_records WHERE company_id = ? AND app_id = ? AND status = 'certified'
  `).get(orgId, ov.app_id).c;
  assert.ok(others >= 2, 'at least two other people keep a clean certification on the QC app');
});

// ─── Cleanup: every new row deleteSandboxOrg must remove ─────────────────────

test('deleteSandboxOrg removes every new-shape row', () => {
  const { deleteSandboxOrg } = require('../src/sandbox');

  const before = {
    product_routings: db.prepare('SELECT COUNT(*) c FROM product_routings WHERE company_id = ?').get(orgId).c,
    routing_steps: db.prepare('SELECT COUNT(*) c FROM routing_steps WHERE company_id = ?').get(orgId).c,
    work_order_operations: db.prepare('SELECT COUNT(*) c FROM work_order_operations WHERE company_id = ?').get(orgId).c,
    reason_codes: db.prepare('SELECT COUNT(*) c FROM reason_codes WHERE company_id = ?').get(orgId).c,
    andon_targets: db.prepare('SELECT COUNT(*) c FROM andon_targets WHERE company_id = ?').get(orgId).c,
    app_revisions: db.prepare('SELECT COUNT(*) c FROM app_revisions WHERE company_id = ?').get(orgId).c,
    qualification_overrides: db.prepare('SELECT COUNT(*) c FROM qualification_overrides WHERE company_id = ?').get(orgId).c,
    andon_calls: db.prepare('SELECT COUNT(*) c FROM andon_calls WHERE company_id = ?').get(orgId).c,
    messages: db.prepare('SELECT COUNT(*) c FROM messages WHERE company_id = ?').get(orgId).c,
  };
  for (const [table, count] of Object.entries(before)) {
    assert.ok(count > 0, `seed populated ${table} (got ${count})`);
  }
  // machine_events carries no company_id — scoped through its station.
  const machineEventsBefore = db.prepare(`
    SELECT COUNT(*) c FROM machine_events WHERE station_id IN (SELECT id FROM stations WHERE company_id = ?)
  `).get(orgId).c;
  assert.ok(machineEventsBefore > 0, 'seed populated machine_events');
  const codedStopsBefore = db.prepare(`
    SELECT COUNT(*) c FROM machine_events WHERE reason_code_id IS NOT NULL
      AND station_id IN (SELECT id FROM stations WHERE company_id = ?)
  `).get(orgId).c;
  assert.ok(codedStopsBefore >= 3, 'seed populated coded downtime events');

  deleteSandboxOrg(orgId);

  for (const table of Object.keys(before)) {
    const c = db.prepare(`SELECT COUNT(*) c FROM "${table}" WHERE company_id = ?`).get(orgId).c;
    assert.equal(c, 0, `${table} fully cleaned for the sandbox org`);
  }
  const machineEventsAfter = db.prepare(`
    SELECT COUNT(*) c FROM machine_events WHERE station_id IN (SELECT id FROM stations WHERE company_id = ?)
  `).get(orgId).c;
  assert.equal(machineEventsAfter, 0, 'machine_events fully cleaned via its station');

  assert.equal(db.prepare('SELECT COUNT(*) c FROM organizations WHERE id = ?').get(orgId).c, 0);
});

// ─── MINOR 12: the two copies of REASON_DEFAULTS cannot silently drift ───────
// routes/andon.js is not a file this workstream owns, so this test PARSES
// its source rather than importing/executing it (which would also register
// its router) — a static comparison of the one object literal that matters.

test('seedShapes.REASON_DEFAULTS matches routes/andon.js\'s own REASON_DEFAULTS', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', 'andon.js'), 'utf8');
  const m = src.match(/const REASON_DEFAULTS = (\{[\s\S]*?\n\});/);
  assert.ok(m, 'routes/andon.js still defines REASON_DEFAULTS as a plain object literal');
  // eslint-disable-next-line no-new-func — static source in this repo, not user input.
  const routeDefaults = new Function(`return ${m[1]}`)();
  const seedShapes = require('../src/seedShapes');
  assert.deepEqual(seedShapes.REASON_DEFAULTS, routeDefaults,
    'seedShapes.REASON_DEFAULTS must match routes/andon.js\'s REASON_DEFAULTS exactly — the two lists cannot drift');
});

// ─── The real-signup path: loadSampleDataForCompany ("Load sample data") ────
// Its own server, its own company — MAJOR 1, 5 and 6 apply here too, and
// MAJOR 6 is ONLY meaningful on this path (the sandbox path deliberately
// drives the real escalateOne(), see seedAndonCalls' driveLive doc comment).

test('loadSampleDataForCompany: job-level counters, override operator, and no live andon side effects', async () => {
  const signup = await api('POST', '/api/auth/signup', {
    body: {
      company_name: 'Sample Data Co', email: `admin-${Date.now()}@sampledata.test`,
      password: 'SecretPass1', display_name: 'Owner Person',
    },
  });
  assert.equal(signup.status, 201, `signup failed: ${JSON.stringify(signup.json)}`);
  const sdToken = signup.json.token;
  const sdUserId = signup.json.user.id;
  const sdOrgId = db.prepare('SELECT company_id FROM users WHERE id = ?').get(sdUserId).company_id;

  const sample = await api('POST', '/api/config/sample-data', { token: sdToken });
  assert.equal(sample.status, 201, `sample-data failed: ${JSON.stringify(sample.json)}`);

  // MAJOR 1, on this path too.
  const wos = await api('GET', '/api/work-orders?status=in_progress', { token: sdToken });
  const inProgressWo = (Array.isArray(wos.json) ? wos.json : []).find(w => w.work_order_number.includes('WO-3001'));
  assert.ok(inProgressWo, 'a WO-3001-style released job exists');
  assert.ok(inProgressWo.completion_pct > 0, 'completion_pct > 0');
  assert.notEqual(inProgressWo.schedule_status, 'behind', `must not read 'behind' on release (got ${inProgressWo.schedule_status})`);

  const pending = await api('GET', '/api/work-orders?status=pending', { token: sdToken });
  const justReleasedWo = (Array.isArray(pending.json) ? pending.json : []).find(w => w.work_order_number.includes('WO-3002'));
  assert.ok(justReleasedWo, 'a WO-3002-style just-released job exists');
  assert.equal(justReleasedWo.schedule_status, 'not_started');

  // MAJOR 5: the override's operator and the run it is stamped onto belong
  // to the SAME person.
  const overrides = await api('GET', '/api/training/overrides', { token: sdToken });
  assert.ok(overrides.json.length >= 1, 'an override was seeded');
  const ov = overrides.json[0];
  const completion = db.prepare('SELECT operator_user_id, qualification_state FROM completions WHERE id = ? AND company_id = ?')
    .get(ov.completion_id, sdOrgId);
  assert.ok(completion, 'the override\'s completion exists');
  assert.equal(completion.qualification_state, 'override');
  assert.equal(ov.user_id, completion.operator_user_id,
    'the override\'s operator matches the completion\'s own operator — not a different, randomly-picked run');

  // MAJOR 6: no live escalateOne() side effects on a real signup's seed —
  // the escalation state exists, but nothing was actually emailed or
  // webhooked out.
  const escalated = db.prepare(`SELECT * FROM andon_calls WHERE company_id = ? AND escalation_level >= 1`).get(sdOrgId);
  assert.ok(escalated, 'an escalated call exists on this path too');
  assert.equal(escalated.escalation_level, 2);
  assert.ok(escalated.escalated_to_user_id, 'escalated_to_user_id stamped');
  const andonEscalated = db.prepare(`
    SELECT COUNT(*) c FROM notification_log WHERE company_id = ? AND event = 'andon.escalated'
  `).get(sdOrgId).c;
  assert.equal(andonEscalated, 0, 'no andon.escalated row in notification_log — nothing was actually emailed out');
  const nobody = db.prepare(`
    SELECT COUNT(*) c FROM activity_log WHERE company_id = ? AND entity_type = 'andon' AND action LIKE '%Nobody to escalate to%'
  `).get(sdOrgId).c;
  assert.equal(nobody, 0, 'no "Nobody to escalate to" line either');
  // The in-app trail (messages + activity_log) IS expected — that is the
  // "matching messages and activity_log rows" MAJOR 6 asks for.
  const messageCount = db.prepare(`SELECT COUNT(*) c FROM messages WHERE company_id = ?`).get(sdOrgId).c;
  assert.ok(messageCount >= 1, 'the in-app escalation trail was still written');
});


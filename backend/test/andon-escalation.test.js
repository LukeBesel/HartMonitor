'use strict';
// ─── A help call that chases someone ─────────────────────────────────────────
// Andon had routing and teams but no clock: a call nobody acknowledged sat
// 'open' forever and nothing ever looked at it again. This suite pins the
// behaviour that replaces that:
//
//   • every call is stamped with a respond_by from the company's own target,
//   • one tick past that target escalates it ONE level, to people who have not
//     already been alerted, with exactly one message per level,
//   • a tick inside the window escalates nothing, and level 2 is the end,
//   • acknowledging before the target keeps the call at level 0 forever,
//   • the board reports response time AGAINST target, and says "—" with a
//     reason rather than "0%" when nothing has been acknowledged,
//   • a company has one coded reason list, seeded on first read, scoped to it,
//   • and migration 007's CHECK word lists are vocab.js's, letter for letter.
//
// The sweeper is deliberately off under NODE_ENV=test; POST /api/andon/sweep
// drives exactly one tick, which is the only way to assert "the second tick
// sends nothing".
//
// Uses Node built-ins only (node:test + global fetch). Run with:
//   node --test test/andon-escalation.test.js

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const vocab = require('../src/vocab');

const PORT = 3407; // reserved for this workstream — see MIGRATIONS.md
const BASE = `http://localhost:${PORT}`;
const DB_PATH = path.join(os.tmpdir(), `mes-andon-escalation-${Date.now()}.db`);

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

// ─── Cast ─────────────────────────────────────────────────────────────────────
// Widget Co (A): quinn answers quality calls in Assembly, sana is Assembly's
// supervisor (the rung above a function team), tomas is a company-wide
// supervisor in another department, and mo is the MANAGEMENT tier — the top of
// the ladder, where a supervisor call and every level 2 ends up.
//
// Gadget Co (B) is deliberately a one-person company: it proves tenant scoping,
// keeps one company with NOTHING acknowledged so the summary's honest null can
// be asserted, and is the shop where the ladder runs out of people.

let tokenA, tokenB, opToken;
let quinn, sana, tomas, mo, ownerA;
let quinnToken, sanaToken, tomasToken, moToken;
let assemblyId, packagingId, stationId;

before(async () => {
  await startServer();

  const a = await api('POST', '/api/auth/signup', {
    body: { company_name: 'Widget Co', email: 'owner@widget-esc.test', password: 'supersecret1', display_name: 'Wanda Owner' },
  });
  assert.equal(a.status, 201, `signup A: ${JSON.stringify(a.json)}`);
  tokenA = a.json.token;
  ownerA = a.json.user?.id || a.json.id;

  const b = await api('POST', '/api/auth/signup', {
    body: { company_name: 'Gadget Co', email: 'owner@gadget-esc.test', password: 'supersecret1', display_name: 'Gary Owner' },
  });
  assert.equal(b.status, 201, `signup B: ${JSON.stringify(b.json)}`);
  tokenB = b.json.token;

  const mkUser = async (email, name, role) => {
    const r = await api('POST', '/api/users', { token: tokenA, body: { email, display_name: name, password: 'supersecret1', role } });
    assert.equal(r.status, 201, `created ${name}: ${JSON.stringify(r.json)}`);
    return r.json.id;
  };
  const login = async (email) => {
    const r = await api('POST', '/api/auth/login', { body: { email, password: 'supersecret1' } });
    assert.equal(r.status, 200, `login ${email}`);
    return r.json.token;
  };

  quinn = await mkUser('quinn@widget-esc.test', 'Quinn Quality', 'supervisor');
  sana  = await mkUser('sana@widget-esc.test', 'Sana Supervisor', 'supervisor');
  tomas = await mkUser('tomas@widget-esc.test', 'Tomas Tier2', 'supervisor');
  mo    = await mkUser('mo@widget-esc.test', 'Mo Manager', 'manager');
  await mkUser('olive@widget-esc.test', 'Olive Operator', 'operator');
  quinnToken = await login('quinn@widget-esc.test');
  sanaToken  = await login('sana@widget-esc.test');
  tomasToken = await login('tomas@widget-esc.test');
  moToken    = await login('mo@widget-esc.test');
  opToken    = await login('olive@widget-esc.test');

  const assembly = await api('POST', '/api/departments', { token: tokenA, body: { name: 'Assembly' } });
  assemblyId = assembly.json.id;
  const packaging = await api('POST', '/api/departments', { token: tokenA, body: { name: 'Packaging' } });
  packagingId = packaging.json.id;

  const station = await api('POST', '/api/stations', { token: tokenA, body: { name: 'Cell 4', department_id: assemblyId } });
  stationId = station.json.id;

  for (const [dept, user, role] of [
    [assemblyId, quinn, 'quality'],
    [assemblyId, sana, 'supervisor'],
    [packagingId, tomas, 'supervisor'],
  ]) {
    const r = await api('POST', `/api/departments/${dept}/members`, { token: tokenA, body: { user_id: user, team_role: role } });
    assert.equal(r.status, 201, `membership ${role}: ${JSON.stringify(r.json)}`);
  }
});

after(() => {
  if (server) server.kill('SIGTERM');
  for (const ext of ['', '-shm', '-wal']) { try { fs.unlinkSync(DB_PATH + ext); } catch { /* ignore */ } }
});

// ── helpers ───────────────────────────────────────────────────────────────────

async function raiseCall(token, body) {
  const r = await api('POST', '/api/andon', { token, body });
  assert.equal(r.status, 201, `raise: ${JSON.stringify(r.json)}`);
  return r.json;
}

async function getCall(token, id) {
  const r = await api('GET', '/api/andon?limit=200', { token });
  assert.equal(r.status, 200);
  return r.json.find(c => c.id === id) || null;
}

/** Message ids currently visible to one user. */
async function messageIds(token) {
  const r = await api('GET', '/api/messages?limit=200', { token });
  assert.equal(r.status, 200);
  return new Set(r.json.map(m => m.id));
}

async function newMessages(token, before_) {
  const r = await api('GET', '/api/messages?limit=200', { token });
  return r.json.filter(m => !before_.has(m.id));
}

/** Activity lines recorded against one call. */
async function activityFor(token, callId) {
  const r = await api('GET', '/api/activity?scope=all&limit=500', { token });
  assert.equal(r.status, 200);
  return r.json.filter(a => a.entity_id === callId).map(a => a.action);
}

/** One escalation tick, optionally after moving a call's respond_by into the past. */
async function tick(token, opts = {}) {
  const r = await api('POST', '/api/andon/sweep', { token, body: opts });
  assert.equal(r.status, 200, `sweep: ${JSON.stringify(r.json)}`);
  return r.json;
}

// ─── The clock ────────────────────────────────────────────────────────────────

test('every call is raised with a respond-by target it can be measured against', async () => {
  const call = await raiseCall(tokenA, { team: 'quality', station_id: stationId, department_id: assemblyId, title: 'Suspect weld' });
  assert.ok(call.respond_by, 'a call without a respond_by is a call with no clock');
  assert.equal(call.escalation_level, 0);
  assert.equal(call.target_seconds, 10 * 60, 'quality answers in ten minutes by default');
  assert.ok(call.respond_in_seconds > 9 * 60, `countdown should start near the target, got ${call.respond_in_seconds}`);
  assert.equal(call.overdue, false);

  // A safety call is on a much shorter clock than a materials one — the whole
  // point of a per-team target.
  const safety = await raiseCall(tokenA, { type: 'safety', title: 'Guard open', station_id: stationId });
  assert.equal(safety.target_seconds, 2 * 60);
  const materials = await raiseCall(tokenA, { team: 'materials', title: 'Short kit' });
  assert.equal(materials.target_seconds, 20 * 60);

  // Clean up so they do not escalate underneath a later assertion.
  for (const id of [call.id, safety.id, materials.id]) {
    await api('PUT', `/api/andon/${id}/resolve`, { token: tokenA });
  }
});

test('a call past its target escalates one level per tick, at most twice, to someone new', async () => {
  const call = await raiseCall(tokenA, {
    team: 'quality', station_id: stationId, department_id: assemblyId, title: 'Porosity on the fixture',
  });

  const beforeQuinn = await messageIds(quinnToken);
  const beforeSana = await messageIds(sanaToken);
  const beforeTomas = await messageIds(tomasToken);

  // A tick while the call is still inside its window changes nothing.
  const quiet = await tick(tokenA);
  assert.equal(quiet.count, 0, 'nothing is overdue yet');
  assert.equal((await getCall(tokenA, call.id)).escalation_level, 0);

  // ── First tick past respond_by ──
  const first = await tick(tokenA, { backdate_call_id: call.id, backdate_seconds: 120 });
  assert.equal(first.count, 1, `one call escalated: ${JSON.stringify(first)}`);

  const afterFirst = await getCall(tokenA, call.id);
  assert.equal(afterFirst.escalation_level, 1);
  assert.ok(afterFirst.escalated_at, 'escalated_at is stamped');
  assert.equal(afterFirst.status, 'open', 'escalation is a LEVEL — the status vocabulary never grew a fourth word');
  assert.equal(afterFirst.escalated_to_label, 'Supervisor');
  assert.equal(afterFirst.escalated_to_user_id, sana, 'the escalate-to team is the department supervisor');

  // Exactly one new message, addressed to the escalate-to team — and NOT to the
  // person who was already alerted and did not answer.
  const sanaNew = await newMessages(sanaToken, beforeSana);
  assert.equal(sanaNew.length, 1, `one escalation message: ${JSON.stringify(sanaNew.map(m => m.sender_name))}`);
  assert.match(sanaNew[0].sender_name, /escalation 1/);
  assert.equal(sanaNew[0].recipient_id, sana);
  assert.equal((await newMessages(quinnToken, beforeQuinn)).length, 0,
    'the original recipient is excluded — chasing the same silent person is not an escalation');

  // ── A second tick inside the new window adds nothing ──
  const second = await tick(tokenA);
  assert.equal(second.count, 0, 'escalating pushed respond_by forward, so this tick matches nothing');
  assert.equal((await getCall(tokenA, call.id)).escalation_level, 1);
  assert.equal((await newMessages(sanaToken, beforeSana)).length, 1, 'still exactly one message for level 1');

  // ── Past the escalate window: level 2 ends at management ──
  const beforeMo = await messageIds(moToken);
  const third = await tick(tokenA, { backdate_call_id: call.id, backdate_seconds: 60 });
  assert.equal(third.count, 1, `level 2 escalated: ${JSON.stringify(third)}`);
  assert.equal(third.escalated[0].recipients.length > 0, true,
    'a claimed level always reached somebody — that is what claiming it means');
  const afterSecond = await getCall(tokenA, call.id);
  assert.equal(afterSecond.escalation_level, 2);
  assert.equal(afterSecond.escalated_to_label, 'Management', 'the top of the ladder, not another lap of the same rung');
  assert.equal(afterSecond.escalated_to_user_id, mo, 'level 2 reaches past everyone levels 0 and 1 already alerted');
  assert.equal((await newMessages(moToken, beforeMo)).length, 1);
  assert.equal((await newMessages(tomasToken, beforeTomas)).length, 0, 'a supervisor is not the management tier');
  assert.equal((await newMessages(sanaToken, beforeSana)).length, 1, 'no repeat for the tier that already heard');

  // ── Level 2 is the end of the chain ──
  const fourth = await tick(tokenA, { backdate_call_id: call.id, backdate_seconds: 3600 });
  assert.equal(fourth.count, 0, 'two chases is the policy — not one a minute forever');
  assert.equal((await getCall(tokenA, call.id)).escalation_level, 2);
  assert.equal((await newMessages(moToken, beforeMo)).length, 1);

  await api('PUT', `/api/andon/${call.id}/resolve`, { token: tokenA });
});

test('a supervisor call and a safety call climb to management, not back to themselves', async () => {
  // The bug this pins: escalate_to used to be 'supervisor' for EVERY team, so a
  // plain "Call for help" (already the supervisor's) escalated to the
  // supervisors — minus the supervisors who had just ignored it. That resolves
  // to nobody, and the board painted a red badge over an alert nobody received.
  for (const [body, what] of [
    [{ team: 'supervisor', department_id: assemblyId, title: 'Line stopped, need a decision' }, 'a supervisor call'],
    [{ type: 'safety', station_id: stationId, title: 'Guard interlock bypassed' }, 'a safety call'],
  ]) {
    const call = await raiseCall(tokenA, body);
    const beforeMo = await messageIds(moToken);
    const beforeSana = await messageIds(sanaToken);

    const swept = await tick(tokenA, { backdate_call_id: call.id, backdate_seconds: 120 });
    assert.equal(swept.count, 1, `${what} escalated: ${JSON.stringify(swept)}`);
    assert.equal(swept.stalled_count, 0);

    const after = await getCall(tokenA, call.id);
    assert.equal(after.escalation_level, 1);
    assert.equal(after.escalated_to_label, 'Management', `${what} climbs to management`);
    assert.equal(after.escalated_to_user_id, mo);
    assert.equal((await newMessages(moToken, beforeMo)).length, 1, `${what} actually reached a manager`);
    assert.equal((await newMessages(sanaToken, beforeSana)).length, 0);

    await api('PUT', `/api/andon/${call.id}/resolve`, { token: tokenA });
  }
});

test('the escalation line counts minutes in English', async () => {
  // "no acknowledgement within 1 minutes" is the sort of sentence that tells a
  // customer nobody read the screen. A critical safety call has a one-minute
  // target, which is the case a bracketed (s) gets wrong.
  const call = await raiseCall(tokenA, { type: 'safety', priority: 'critical', title: 'Interlock bypassed again' });
  assert.equal(call.target_seconds, 60, 'a critical safety call is answered in a minute');
  const swept = await tick(tokenA, { backdate_call_id: call.id, backdate_seconds: 90 });
  assert.equal(swept.count, 1);

  const lines = await activityFor(tokenA, call.id);
  const escalation = lines.find(a => /^Escalated to/.test(a));
  assert.ok(escalation, `an escalation line was written: ${JSON.stringify(lines)}`);
  assert.match(escalation, /within 1 minute\b/, 'one minute, singular');
  assert.equal(/1 minutes/.test(escalation), false);

  const plural = await raiseCall(tokenA, { team: 'quality', department_id: assemblyId, title: 'Ten-minute target' });
  await tick(tokenA, { backdate_call_id: plural.id, backdate_seconds: 90 });
  const pluralLine = (await activityFor(tokenA, plural.id)).find(a => /^Escalated to/.test(a));
  assert.match(pluralLine, /within 10 minutes\b/, 'ten minutes, plural');

  for (const id of [call.id, plural.id]) await api('PUT', `/api/andon/${id}/resolve`, { token: tokenA });
});

test('a tier with nobody in it is not an escalation', async () => {
  // Gadget Co is one person: the owner, who raised the call. There is nobody
  // above them to chase. The level must NOT be claimed — a call the board says
  // was escalated, to a tier that heard nothing, is worse than one that is
  // plainly still waiting.
  const call = await raiseCall(tokenB, { team: 'maintenance', title: 'Nobody above me' });

  const first = await tick(tokenB, { backdate_call_id: call.id, backdate_seconds: 120 });
  assert.equal(first.count, 0, 'nothing was escalated, because nothing was told');
  assert.equal(first.stalled_count, 1, 'and the sweep says so rather than staying silent');

  const after = await getCall(tokenB, call.id);
  assert.equal(after.escalation_level, 0, 'the level is not claimed');
  assert.equal(after.escalated_at, null);
  assert.equal(after.escalated_to_label, null, 'so the board paints no "Escalated to …" badge');
  assert.equal(after.status, 'open');

  const lines = await activityFor(tokenB, call.id);
  const nobody = lines.filter(a => /Nobody to escalate to/.test(a));
  assert.equal(nobody.length, 1, `one line naming what is missing: ${JSON.stringify(lines)}`);
  assert.match(nobody[0], /add a manager or a team member/);

  // Retried every tick — but never logged twice.
  const second = await tick(tokenB);
  assert.equal(second.count, 0);
  assert.equal(second.stalled_count, 1, 'it keeps trying, so adding a manager fixes it');
  const again = (await activityFor(tokenB, call.id)).filter(a => /Nobody to escalate to/.test(a));
  assert.equal(again.length, 1, 'and it does not fill the log with the same sentence');

  const summary = await api('GET', '/api/andon/summary', { token: tokenB });
  assert.equal(summary.json.escalated_open, 0, 'nothing was escalated, so nothing is counted as escalated');
  assert.equal(summary.json.overdue, 1, 'it is simply overdue, which is the truth');

  await api('PUT', `/api/andon/${call.id}/resolve`, { token: tokenB });
});

test('acknowledging before the target leaves the call at level 0 forever', async () => {
  const call = await raiseCall(tokenA, { team: 'quality', department_id: assemblyId, title: 'Answered in time' });
  const ack = await api('PUT', `/api/andon/${call.id}/acknowledge`, { token: quinnToken });
  assert.equal(ack.status, 200, `acknowledge: ${JSON.stringify(ack.json)}`);

  const beforeSana = await messageIds(sanaToken);
  await tick(tokenA, { backdate_call_id: call.id, backdate_seconds: 600 });
  await tick(tokenA, { backdate_call_id: call.id, backdate_seconds: 600 });

  const after = await getCall(tokenA, call.id);
  assert.equal(after.escalation_level, 0, 'an answered call is not chased, however long it stays open');
  assert.equal(after.status, 'acknowledged');
  assert.equal(after.within_target, true, 'answered inside ten minutes');
  assert.equal((await newMessages(sanaToken, beforeSana)).length, 0);

  await api('PUT', `/api/andon/${call.id}/resolve`, { token: tokenA });
});

// ─── Reported against target ─────────────────────────────────────────────────

test('the summary reports against target, and says "nothing acknowledged" rather than 0%', async () => {
  // Gadget Co has raised one call and answered none: the honest answer is null
  // with a reason, never 0% (which would read as "every call was late").
  const call = await raiseCall(tokenB, { team: 'maintenance', title: 'Nobody has answered this' });
  const summaryB = await api('GET', '/api/andon/summary', { token: tokenB });
  assert.equal(summaryB.status, 200);
  assert.equal(summaryB.json.within_target_pct, null, 'never 0% when nothing was measured');
  assert.equal(summaryB.json.target_seconds, null);
  assert.equal(summaryB.json.within_target_sample, 0);
  assert.match(summaryB.json.within_target_reason, /nothing has been acknowledged/i);
  assert.equal(summaryB.json.overdue, 0, 'raised just now — not overdue yet');
  assert.equal(summaryB.json.escalated_open, 0);

  // Once it is past its target it counts as overdue — and in this one-person
  // company there is nobody to escalate to, so it stays at level 0 and is
  // counted as overdue, not as escalated.
  await tick(tokenB, { backdate_call_id: call.id, backdate_seconds: 120 });
  const overdueB = await api('GET', '/api/andon/summary', { token: tokenB });
  assert.equal(overdueB.json.overdue, 1);
  assert.equal(overdueB.json.escalated_open, 0);
  assert.equal(overdueB.json.within_target_pct, null, 'being late is not an answer');

  // Widget Co answered one call inside its target today.
  const summaryA = await api('GET', '/api/andon/summary', { token: tokenA });
  assert.equal(summaryA.json.within_target_sample >= 1, true);
  assert.equal(summaryA.json.within_target_pct, 100);
  assert.equal(summaryA.json.target_seconds, 600);

  await api('PUT', `/api/andon/${call.id}/resolve`, { token: tokenB });
});

test('response targets are readable by everyone and editable by managers only', async () => {
  const list = await api('GET', '/api/andon/targets', { token: opToken });
  assert.equal(list.status, 200);
  const supervisorNormal = list.json.find(t => t.team === 'supervisor' && t.priority === 'normal');
  assert.equal(supervisorNormal.respond_minutes, 15);
  assert.equal(supervisorNormal.escalate_minutes, 30);
  assert.equal(supervisorNormal.escalate_to_label, 'Management',
    'the supervisor rung climbs to management — a ladder has to go up');
  const qualityNormal = list.json.find(t => t.team === 'quality' && t.priority === 'normal');
  assert.equal(qualityNormal.escalate_to_label, 'Supervisor');
  const safetyCritical = list.json.find(t => t.team === 'safety' && t.priority === 'critical');
  assert.equal(safetyCritical.respond_minutes, 1, 'a critical call is answered in half the time');
  assert.ok(supervisorNormal.escalate_to_options.some(o => o.id === 'manager'),
    'the panel is offered exactly what the validator accepts');

  const denied = await api('PUT', '/api/andon/targets', {
    token: opToken, body: { team: 'quality', priority: 'normal', respond_minutes: 90 },
  });
  assert.equal(denied.status, 403, 'an operator cannot move the plant\'s response targets');

  const saved = await api('PUT', '/api/andon/targets', {
    token: tokenA, body: { team: 'materials', priority: 'normal', respond_minutes: 25, escalate_minutes: 45 },
  });
  assert.equal(saved.status, 200);
  assert.equal(saved.json.respond_minutes, 25);

  // ── Refusals are refusals: 400 and an unchanged row, never a silent
  //    substitution answered with 200. A manager who typed 0 has to learn that
  //    it was not stored; the old behaviour told them it was.
  for (const [body, why] of [
    [{ respond_minutes: 0 }, 'a zero-minute target'],
    [{ respond_minutes: 2.5 }, 'a fraction of a minute'],
    [{ escalate_minutes: -5 }, 'a negative escalate window'],
    [{ respond_minutes: 'soon' }, 'a word where a number goes'],
    [{ respond_minutes: 5000 }, 'a target longer than a day'],
    [{ respond_minutes: 30, escalate_minutes: 30 }, 'escalating the moment the target runs out'],
    [{ respond_minutes: 40, escalate_minutes: 20 }, 'escalating BEFORE the target runs out'],
    [{ escalate_to_team: 'the_ceo' }, 'a rung that does not exist'],
  ]) {
    const refused = await api('PUT', '/api/andon/targets', {
      token: tokenA, body: { team: 'materials', priority: 'normal', ...body },
    });
    assert.equal(refused.status, 400, `${why} is refused: ${JSON.stringify(refused.json)}`);
    assert.ok(refused.json.error, 'and says why, in words a manager reads');
    assert.equal(/[a-z]/.test(refused.json.error), true);
    const after = await api('GET', '/api/andon/targets', { token: tokenA });
    const row = after.json.find(t => t.team === 'materials' && t.priority === 'normal');
    assert.equal(row.respond_minutes, 25, `${why} left the stored target alone`);
    assert.equal(row.escalate_minutes, 45);
  }

  // The ladder itself is editable — a plant that wants materials chased by
  // management says so here.
  const repointed = await api('PUT', '/api/andon/targets', {
    token: tokenA, body: { team: 'materials', priority: 'normal', escalate_to_team: 'manager' },
  });
  assert.equal(repointed.status, 200);
  assert.equal(repointed.json.escalate_to_team, 'manager');
  assert.equal(repointed.json.escalate_to_label, 'Management');

  const raised = await raiseCall(tokenA, { team: 'materials', title: 'Uses the edited target' });
  assert.equal(raised.target_seconds, 25 * 60);
  const beforeMo = await messageIds(moToken);
  const swept = await tick(tokenA, { backdate_call_id: raised.id, backdate_seconds: 60 });
  assert.equal(swept.count, 1);
  assert.equal((await getCall(tokenA, raised.id)).escalated_to_label, 'Management',
    'the edited ladder is the one the sweeper walks');
  assert.equal((await newMessages(moToken, beforeMo)).length, 1);
  await api('PUT', `/api/andon/${raised.id}/resolve`, { token: tokenA });

  // Put it back, so a later test reads the seeded ladder.
  await api('PUT', '/api/andon/targets', {
    token: tokenA, body: { team: 'materials', priority: 'normal', escalate_to_team: 'supervisor' },
  });
});

test('even the test-only sweep is single-tenant', async () => {
  // A harness that sweeps every company on the box can make another suite's
  // assertions come true. This one is scoped like every other route here.
  const theirs = await raiseCall(tokenB, { team: 'quality', title: 'Gadget Co is not Widget Co' });
  await api('POST', '/api/andon/sweep', {
    token: tokenB, body: { backdate_call_id: theirs.id, backdate_seconds: 300 },
  });

  const mine = await raiseCall(tokenA, { team: 'quality', department_id: assemblyId, title: 'Widget Co only' });
  const swept = await tick(tokenA, { backdate_call_id: mine.id, backdate_seconds: 300 });
  assert.equal(swept.count, 1);
  assert.equal(swept.escalated.every(e => e.company_id !== undefined), true);
  assert.equal(swept.escalated.some(e => e.id === theirs.id), false, 'another tenant is never swept');
  assert.equal(swept.stalled.some(e => e.id === theirs.id), false);

  await api('PUT', `/api/andon/${mine.id}/resolve`, { token: tokenA });
  await api('PUT', `/api/andon/${theirs.id}/resolve`, { token: tokenB });
});

// ─── The coded reason list ───────────────────────────────────────────────────

test('a company gets one coded reason list, seeded on first read and scoped to it', async () => {
  const all = await api('GET', '/api/andon/reason-codes', { token: tokenA });
  assert.equal(all.status, 200);
  assert.ok(all.json.length >= 15, `three seeded lists: got ${all.json.length}`);
  for (const kind of vocab.REASON_KIND) {
    assert.ok(all.json.some(r => r.kind === kind), `${kind} list was seeded`);
  }

  const scrap = await api('GET', '/api/andon/reason-codes?kind=scrap', { token: opToken });
  assert.equal(scrap.status, 200);
  assert.ok(scrap.json.every(r => r.kind === 'scrap'));
  assert.ok(scrap.json.some(r => r.label === 'Weld porosity'));
  assert.ok(scrap.json.every(r => r.loss_bucket === ''), 'a scrap reason rolls into no OEE loss bucket');

  const downtime = await api('GET', '/api/andon/reason-codes?kind=downtime', { token: tokenA });
  const byCode = Object.fromEntries(downtime.json.map(r => [r.code, r.loss_bucket]));
  assert.equal(byCode.breakdown, 'breakdown');
  assert.equal(byCode.changeover, 'setup_adjustment');
  assert.equal(byCode.no_material, 'minor_stop');
  assert.equal(byCode.running_slow, 'speed_loss');
  assert.equal(byCode.startup_reject, 'startup_reject');
  assert.equal(byCode.process_reject, 'process_reject');
  for (const bucket of Object.values(byCode)) {
    assert.ok(vocab.LOSS_BUCKET.includes(bucket), `${bucket} is one of the six losses`);
  }

  const bad = await api('GET', '/api/andon/reason-codes?kind=nonsense', { token: tokenA });
  assert.equal(bad.status, 400);

  // A second company's list is its own — seeded on ITS first read, and nothing
  // one company writes can appear in the other's picker.
  const created = await api('POST', '/api/andon/reason-codes', {
    token: tokenA, body: { kind: 'scrap', code: 'widget_only', label: 'Widget Co only', sort_order: 99 },
  });
  assert.equal(created.status, 201, JSON.stringify(created.json));
  const otherList = await api('GET', '/api/andon/reason-codes?kind=scrap', { token: tokenB });
  assert.equal(otherList.status, 200);
  assert.ok(otherList.json.length > 0, 'Gadget Co gets its own seeded list');
  assert.equal(otherList.json.some(r => r.code === 'widget_only'), false, 'no cross-tenant leak');

  // Cross-tenant edit of a known id is a 404, not a 403 that confirms it exists.
  const foreign = await api('PUT', `/api/andon/reason-codes/${created.json.id}`, {
    token: tokenB, body: { label: 'Stolen' },
  });
  assert.equal(foreign.status, 404);
});

test('reason-code writes are manager-gated and validated against vocab.js', async () => {
  const denied = await api('POST', '/api/andon/reason-codes', {
    token: opToken, body: { kind: 'scrap', code: 'op_added', label: 'Operator added' },
  });
  assert.equal(denied.status, 403);

  const badKind = await api('POST', '/api/andon/reason-codes', {
    token: tokenA, body: { kind: 'shrinkage', code: 'x', label: 'X' },
  });
  assert.equal(badKind.status, 400);

  const badBucket = await api('POST', '/api/andon/reason-codes', {
    token: tokenA, body: { kind: 'downtime', code: 'x', label: 'X', loss_bucket: 'gremlins' },
  });
  assert.equal(badBucket.status, 400);

  const ok = await api('POST', '/api/andon/reason-codes', {
    token: tokenA, body: { kind: 'downtime', code: 'tool_change', label: 'Tool change', loss_bucket: 'setup_adjustment' },
  });
  assert.equal(ok.status, 201);
  const dup = await api('POST', '/api/andon/reason-codes', {
    token: tokenA, body: { kind: 'downtime', code: 'tool_change', label: 'Again', loss_bucket: 'minor_stop' },
  });
  assert.equal(dup.status, 409, 'one code means one thing');

  const renamed = await api('PUT', `/api/andon/reason-codes/${ok.json.id}`, {
    token: tokenA, body: { label: 'Tool change / insert', is_active: false },
  });
  assert.equal(renamed.status, 200);
  assert.equal(renamed.json.label, 'Tool change / insert');
  assert.equal(renamed.json.is_active, false);

  const active = await api('GET', '/api/andon/reason-codes?kind=downtime', { token: tokenA });
  assert.equal(active.json.some(r => r.id === ok.json.id), false, 'a retired code leaves the picker');
  const withInactive = await api('GET', '/api/andon/reason-codes?kind=downtime&include_inactive=true', { token: tokenA });
  assert.equal(withInactive.json.some(r => r.id === ok.json.id), true, 'but is never deleted from history');
});

test('deleting a reason code retires it, so last quarter\'s scrap still reads', async () => {
  const made = await api('POST', '/api/andon/reason-codes', {
    token: tokenA, body: { kind: 'rework', code: 'temporary', label: 'Temporary code' },
  });
  assert.equal(made.status, 201);

  assert.equal((await api('DELETE', `/api/andon/reason-codes/${made.json.id}`, { token: opToken })).status, 403);

  const removed = await api('DELETE', `/api/andon/reason-codes/${made.json.id}`, { token: tokenA });
  assert.equal(removed.status, 200);
  assert.equal(removed.json.is_active, false);
  assert.equal(removed.json.retired, true);

  const picker = await api('GET', '/api/andon/reason-codes?kind=rework', { token: tokenA });
  assert.equal(picker.json.some(r => r.id === made.json.id), false, 'gone from the picker');
  const history = await api('GET', '/api/andon/reason-codes?kind=rework&include_inactive=true', { token: tokenA });
  assert.equal(history.json.some(r => r.id === made.json.id), true,
    'but still there, so a row recorded against it keeps reading correctly');

  assert.equal((await api('DELETE', `/api/andon/reason-codes/${made.json.id}`, { token: tokenB })).status, 404);
});

// ─── The schema and the code quote the same words ────────────────────────────

test('migration 007 CHECK lists are vocab.js, letter for letter', () => {
  const sql = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'db', 'migrations', '007_andon_escalation_and_reason_codes.sql'),
    'utf8',
  );
  const listFor = (column) => {
    const m = sql.match(new RegExp(`CHECK\\(${column} IN \\(([^)]*)\\)\\)`));
    assert.ok(m, `007 constrains ${column}`);
    return m[1].split(',').map(v => v.trim().replace(/^'|'$/g, ''));
  };

  assert.deepEqual(listFor('kind'), [...vocab.REASON_KIND],
    'reason_codes.kind must quote vocab.REASON_KIND exactly — a CHECK cannot be altered later');
  // '' leads the list and is NOT a vocabulary value: it means "no OEE loss
  // bucket", which is the honest answer for every scrap and rework reason.
  // Documented in MIGRATIONS.md's note on 007, because a CHECK cannot be
  // altered afterwards without rebuilding the table on live data.
  assert.deepEqual(listFor('loss_bucket'), ['', ...vocab.LOSS_BUCKET],
    "reason_codes.loss_bucket is '' (no bucket) plus vocab.LOSS_BUCKET, in order");
  assert.equal(vocab.LOSS_BUCKET.includes(''), false,
    "'' is the column's way of saying 'no bucket' — it is not a loss");
});

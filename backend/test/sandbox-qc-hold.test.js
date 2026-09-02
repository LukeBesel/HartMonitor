'use strict';
// ─── The demo's QC app keeps the promise its own instructions make ───────────
// The seeded "Final QC Inspection" app tells the operator, in the step copy:
//   "Pass sends it to pack-out; Fail holds it and raises a quality record."
// It used to do neither. A Fail was saved as `{"qc_result":"Fail"},"ncr":null`
// under a green "Complete!", so the one sentence a visitor reads on the demo's
// quality gate was contradicted by the demo two clicks later.
//
// The seed now ships the trigger that sentence describes, in the exact shape
// the builder's Triggers tab writes and routes/apps.js validates:
//   When the step is left → If [Ships as-is?] equals "Fail"
//   → Create NCR, then Block with error
//
// This suite reads that trigger back off the API and then drives it the way the
// player does — the same endpoints AppPlayer.tsx calls, in the same order — so
// the assertions are about the seeded app's own data, not about a script that
// re-states it. Triggers are evaluated in the player (frontend/src/engine), so
// the test evaluates the seeded condition itself and then performs exactly the
// actions the trigger declares; anything the trigger did not declare, it does
// not do.
//
// Runs with EARLY_ACCESS=true because the sandbox seeds a Pro workspace.
//
// Uses Node built-ins only (node:test + global fetch). Run with:
//   node --test test/sandbox-qc-hold.test.js

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const PORT = 3403; // unique per test file — a collision silently cancels a suite
const BASE = `http://localhost:${PORT}`;
const DB_PATH = path.join(os.tmpdir(), `mes-sandbox-qc-hold-${Date.now()}.db`);

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

// ── The trigger engine's rules, only as far as this app needs them ───────────
// Mirrors frontend/src/engine/triggers.ts: a 'widget' ValueRef reads the widget's
// current value by widget id, a 'static' ValueRef is its literal, 'eq' compares
// loosely, and 'all' means every condition must hold.
function conditionsPass(trigger, widgetValues) {
  const resolve = ref => {
    if (!ref) return undefined;
    if (ref.kind === 'static') return ref.value;
    if (ref.kind === 'widget') return widgetValues[ref.name];
    return undefined;
  };
  if (!Array.isArray(trigger.conditions) || trigger.conditions.length === 0) return true;
  const one = c => {
    const left = resolve(c.left), right = resolve(c.right);
    if (c.op === 'eq') return String(left) === String(right);
    if (c.op === 'neq') return String(left) !== String(right);
    return false;
  };
  return trigger.match === 'any' ? trigger.conditions.some(one) : trigger.conditions.every(one);
}

let token, qcApp, visualStep, resultWidget, torqueWidget, holdTrigger;

before(async () => {
  await startServer();

  const demo = await api('POST', '/api/auth/demo');
  assert.equal(demo.status, 201, `demo sandbox: ${JSON.stringify(demo.json)}`);
  token = demo.json.token;

  const apps = await api('GET', '/api/apps', { token });
  assert.equal(apps.status, 200);
  const listed = apps.json.find(a => a.name === 'Final QC Inspection');
  assert.ok(listed, `the sandbox seeds a QC app: ${apps.json.map(a => a.name).join(', ')}`);

  const full = await api('GET', `/api/apps/${listed.id}`, { token });
  assert.equal(full.status, 200);
  qcApp = full.json;

  visualStep = qcApp.steps.find(s => (s.triggers ?? []).some(t => t.event === 'step_exit'));
  resultWidget = visualStep && visualStep.widgets.find(w => w.type === 'pass-fail');
  torqueWidget = qcApp.steps.flatMap(s => s.widgets).find(w => w.type === 'number-input');
  holdTrigger = visualStep && visualStep.triggers.find(t => t.event === 'step_exit');
});

after(() => {
  if (server) server.kill('SIGTERM');
  for (const ext of ['', '-shm', '-wal']) {
    try { fs.unlinkSync(DB_PATH + ext); } catch { /* ignore */ }
  }
});

describe('the seeded QC app carries the hold its copy promises', () => {
  it('ships a step_exit trigger keyed on the pass/fail widget being Fail', () => {
    assert.ok(visualStep, 'a step with a step_exit trigger');
    assert.ok(resultWidget, 'the step carries the pass/fail widget');
    assert.ok(holdTrigger, 'the step_exit trigger');
    assert.notEqual(holdTrigger.enabled, false, 'the trigger is enabled');

    const cond = holdTrigger.conditions.find(c => c.left && c.left.kind === 'widget');
    assert.ok(cond, `the condition reads a widget: ${JSON.stringify(holdTrigger.conditions)}`);
    assert.equal(cond.left.name, resultWidget.id, 'it reads the pass/fail widget by id');
    assert.equal(cond.op, 'eq');
    assert.equal(cond.right.kind, 'static');
    // Pass-fail widgets hold the literal strings 'Pass' / 'Fail' (PlayerWidgets.tsx).
    assert.equal(cond.right.value, 'Fail', 'it is keyed on the Fail value');
  });

  it('raises an NCR and blocks the run, in that order', () => {
    const types = holdTrigger.actions.map(a => a.type);
    assert.deepEqual(types, ['create_ncr', 'block_with_error'],
      'create_ncr must come FIRST — block_with_error stops the trigger there');
    const ncr = holdTrigger.actions[0];
    assert.ok(ncr.title && ncr.title.length > 0, 'the NCR has a title');
    assert.ok(['minor', 'major', 'critical'].includes(ncr.severity), 'a real severity');
    assert.match(holdTrigger.actions[1].text, /held/i, 'the block says the unit is held');
  });

  it('does not fire on a Pass', () => {
    assert.equal(conditionsPass(holdTrigger, { [resultWidget.id]: 'Pass' }), false);
    assert.equal(conditionsPass(holdTrigger, { [resultWidget.id]: 'Fail' }), true);
  });
});

describe('completing the QC app with Fail holds the run and files the record', () => {
  let completionId, filedNCR;

  before(async () => {
    // ── Exactly what AppPlayer.tsx calls, in order ──
    // 1. start the run
    const started = await api('POST', '/api/completions', {
      token, body: { app_id: qcApp.id, operator_name: 'Demo Visitor' },
    });
    assert.equal(started.status, 201, `starting the run: ${JSON.stringify(started.json)}`);
    completionId = started.json.id;
    assert.equal(started.json.status, 'in_progress');

    // 2. step data as the operator captures it (partial autosave flush)
    const widgetValues = { [torqueWidget.id]: 14.2, [resultWidget.id]: 'Fail' };
    const flush = await api('PUT', `/api/completions/${completionId}`, {
      token,
      body: {
        partial: true,
        data: { final_torque: 14.2, qc_result: 'Fail' },
        step_times: { 0: 6, 1: 44 },
        values: [
          { step_id: qcApp.steps[0].id, widget_id: torqueWidget.id, variable_name: 'final_torque', value_type: 'number', value_number: 14.2 },
          { step_id: visualStep.id, widget_id: resultWidget.id, variable_name: 'qc_result', value_type: 'pass_fail', value_text: 'fail' },
        ],
      },
    });
    assert.equal(flush.status, 200, `saving step data: ${JSON.stringify(flush.json)}`);

    // 3. leaving the last step fires step_exit. Evaluate the SEEDED trigger and
    //    do only what it declares — nothing here is hardcoded about the outcome.
    assert.ok(conditionsPass(holdTrigger, widgetValues), 'the seeded trigger fires on this run');

    let blocked = false;
    for (const action of holdTrigger.actions) {
      if (blocked) break; // block_with_error halts the remaining actions
      if (action.type === 'create_ncr') {
        // The player's outbox payload (AppPlayer.tsx handleEnqueueEffect).
        const res = await api('POST', '/api/quality/ncrs', {
          token,
          body: {
            title: action.title,
            description: action.description ?? '',
            severity: action.severity,
            source: 'production',
            app_id: qcApp.id,
            completion_id: completionId,
            work_order_id: null,
            operator_name: 'Demo Visitor',
          },
        });
        assert.equal(res.status, 201, `filing the NCR: ${JSON.stringify(res.json)}`);
        filedNCR = res.json;
      } else if (action.type === 'block_with_error') {
        blocked = true; // cancels the navigation — on the last step, the completion
      }
    }
    assert.ok(blocked, 'the trigger blocks the run');
  });

  it('files a quality record against that run — ncr is not null', async () => {
    assert.ok(filedNCR && filedNCR.id, 'the NCR came back');
    assert.ok(filedNCR.ncr_number, 'it has a real NCR number');
    assert.equal(filedNCR.completion_id, completionId, 'it points at the run that failed');
    assert.equal(filedNCR.app_id, qcApp.id);
    assert.equal(filedNCR.status, 'open');

    const list = await api('GET', `/api/quality/ncrs?app_id=${qcApp.id}`, { token });
    assert.equal(list.status, 200);
    const mine = list.json.filter(n => n.completion_id === completionId);
    assert.equal(mine.length, 1, 'exactly one quality record for this run');
    assert.equal(mine[0].title, holdTrigger.actions[0].title,
      'the record says what the app said it would say');
  });

  it('leaves the run HELD — the API never marks it complete', async () => {
    const run = await api('GET', `/api/completions/${completionId}`, { token });
    assert.equal(run.status, 200);
    assert.equal(run.json.status, 'in_progress',
      'a blocked run is not a completed run — nothing here can read as "Complete!"');
    assert.ok(!run.json.completed_at, 'and it has no finish time');

    // The state a summary screen reads: not complete, and an open NCR on it.
    const held = await api('GET', '/api/quality/ncrs?status=open', { token });
    assert.ok(held.json.some(n => n.completion_id === completionId),
      'the run carries an open quality record');
  });

  it('still completes normally on a Pass', async () => {
    const started = await api('POST', '/api/completions', {
      token, body: { app_id: qcApp.id, operator_name: 'Demo Visitor' },
    });
    const passId = started.json.id;
    assert.equal(conditionsPass(holdTrigger, { [resultWidget.id]: 'Pass' }), false,
      'a Pass does not fire the hold');
    const done = await api('PUT', `/api/completions/${passId}`, {
      token,
      body: {
        status: 'completed',
        data: { final_torque: 15.1, qc_result: 'Pass' },
        values: [{ step_id: visualStep.id, widget_id: resultWidget.id, variable_name: 'qc_result', value_type: 'pass_fail', value_text: 'pass' }],
      },
    });
    assert.equal(done.status, 200);
    assert.equal(done.json.status, 'completed');
    assert.ok(done.json.completed_at, 'a passing run does finish');

    const list = await api('GET', '/api/quality/ncrs', { token });
    assert.ok(!list.json.some(n => n.completion_id === passId), 'and files nothing');
  });
});

describe('the seeded history matches what the app now does', () => {
  // A FRESH sandbox: the suites above deliberately started runs of their own in
  // the first one, and the analytics agreement checked below is about what the
  // SEED alone produces.
  let seedToken, seedApp;

  before(async () => {
    const demo = await api('POST', '/api/auth/demo');
    assert.equal(demo.status, 201, `second demo sandbox: ${JSON.stringify(demo.json)}`);
    seedToken = demo.json.token;
    const apps = await api('GET', '/api/apps', { token: seedToken });
    seedApp = apps.json.find(a => a.name === 'Final QC Inspection');
    assert.ok(seedApp, 'the QC app is seeded');
  });

  it('records the Fail as a finished inspection, not an unfinished job', async () => {
    const runs = await api('GET', `/api/completions?app_id=${seedApp.id}`, { token: seedToken });
    assert.equal(runs.status, 200);
    const seeded = runs.json.filter(r => r.app_id === seedApp.id);
    assert.ok(seeded.length >= 6, `the QC app has seeded history (${seeded.length} runs)`);

    const failed = seeded.filter(r => {
      const data = typeof r.data === 'string' ? JSON.parse(r.data || '{}') : (r.data || {});
      return String(data.qc_result).toLowerCase() === 'fail';
    });
    assert.equal(failed.length, 1, 'one seeded Fail');
    // An inspection that happened and found a defect is DATA. Seeding it as an
    // unfinished run hid it from every screen that counts completed runs while
    // leaving it in the ones that do not — two tiles, one page, different
    // answers. The hold is a live behaviour (proved above), not a stored status.
    assert.equal(failed[0].status, 'completed', 'the seeded Fail is a completed, inspected run');
    assert.ok(failed[0].completed_at, 'and it has a finish time');
    assert.equal(seeded.filter(r => r.status === 'abandoned').length, 0,
      'nothing in the QC history is seeded as abandoned');
  });

  it('gives that Fail the quality record the copy promises', async () => {
    const runs = await api('GET', `/api/completions?app_id=${seedApp.id}`, { token: seedToken });
    const failed = runs.json.find(r => {
      const data = typeof r.data === 'string' ? JSON.parse(r.data || '{}') : (r.data || {});
      return String(data.qc_result).toLowerCase() === 'fail';
    });

    const ncrs = await api('GET', '/api/quality/ncrs', { token: seedToken });
    const linked = ncrs.json.find(n => n.completion_id === failed.id);
    assert.ok(linked, 'the seeded Fail has an NCR pointing at it');
    assert.equal(linked.severity, holdTrigger.actions[0].severity,
      'seeded at the severity the app itself would raise');
    assert.equal(linked.title, holdTrigger.actions[0].title,
      'and with the title the app itself would use');
    assert.equal(linked.status, 'open');
  });

  it('makes the two yield numbers on the analytics page agree', async () => {
    // routes/apps.js computes per-widget pass/fail over COMPLETED runs only,
    // while first_pass_yield does not filter on status. Any QC run that is not
    // completed makes those two tiles disagree on the same screen, which is the
    // exact failure a non-completed seeded Fail used to cause.
    const an = await api('GET', `/api/apps/${seedApp.id}/analytics?days=30`, { token: seedToken });
    assert.equal(an.status, 200);

    const passFail = an.json.fields.find(f => f.type === 'pass-fail');
    assert.ok(passFail, `the "Ships as-is?" field is reported: ${an.json.fields.map(f => f.type).join(', ')}`);
    assert.equal(passFail.stats.pass, 5, 'five passes');
    assert.equal(passFail.stats.fail, 1, 'one fail');
    assert.equal(passFail.stats.yield_pct, 83.3, 'the field-level yield is 83.3%');

    assert.equal(an.json.totals.first_pass_yield, passFail.stats.yield_pct,
      `first_pass_yield (${an.json.totals.first_pass_yield}) must equal the "Ships as-is?" yield (${passFail.stats.yield_pct})`);
    assert.equal(an.json.totals.runs, 6, 'six QC runs in the window');
    assert.equal(an.json.totals.completed, 6, 'all six completed');
    assert.equal(an.json.totals.abandoned, 0, 'and none reads as a run nobody finished');
  });
});

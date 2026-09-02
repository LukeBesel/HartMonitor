'use strict';
// ─── The ERP door: preview-then-import, and a write API ───────────────────────
//
// Before this suite, /api/v1 was three read-only GETs and the only way to get a
// job into the system was to type it. A shop releasing 200 jobs a week could
// not use the product. What this file pins:
//
//   * 200 rows through the public API in one call, under five seconds.
//   * The SAME body sent twice does not double the schedule: external_id is the
//     match key, so the second call reports 200 updated / 0 created.
//   * One bad row is one bad row. An unknown app name rejects that line, with
//     the app's name in the reason, and the other 199 still land.
//   * Preview writes NOTHING — the row count before and after is identical.
//   * A key for company B cannot create, read or PATCH company A's rows, and
//     every row a key creates carries that key's company_id.
//   * Quoted commas and CRLF survive the parser (every Excel export has both).
//   * The session-based commit is manager-or-above; an operator is refused.
//
// Uses Node built-ins only (node:test + global fetch). Run with:
//   node --test test/erp-import.test.js

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const PORT = 3406; // reserved for erp-door — see MIGRATIONS.md
const BASE = `http://localhost:${PORT}`;
const DB_PATH = path.join(os.tmpdir(), `mes-erp-import-${Date.now()}.db`);

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
        EARLY_ACCESS: 'true',   // API keys are an Enterprise feature; this suite is about the door
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

async function api(method, pathname, { token, apiKey, body, raw } = {}) {
  const res = await fetch(`${BASE}${pathname}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(apiKey ? { 'X-API-Key': apiKey } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  if (raw) return { status: res.status, text: await res.text(), headers: res.headers };
  let json = null;
  try { json = await res.json(); } catch { /* no body */ }
  return { status: res.status, json };
}

/** A whole tenant: signup, an app, a department, and a live API key. */
async function makeCompany({ company, email, appName }) {
  const signup = await api('POST', '/api/auth/signup', {
    body: { company_name: company, email, password: 'SecretPass1', display_name: 'Admin' },
  });
  assert.equal(signup.status, 201, `signup: ${JSON.stringify(signup.json)}`);
  const token = signup.json.token;

  const app = await api('POST', '/api/apps', { token, body: { name: appName } });
  assert.ok([200, 201].includes(app.status), `app: ${JSON.stringify(app.json)}`);

  const dept = await api('POST', '/api/departments', { token, body: { name: 'Fabrication' } });
  assert.ok([200, 201].includes(dept.status), `department: ${JSON.stringify(dept.json)}`);

  // The key is created through the real endpoint — no direct row insert.
  const key = await api('POST', '/api/developer/api-keys', { token, body: { name: `${company} ERP` } });
  assert.ok([200, 201].includes(key.status), `api key: ${JSON.stringify(key.json)}`);
  const secret = key.json.key || key.json.api_key || key.json.secret;
  assert.ok(secret && String(secret).startsWith('hm_live_'), `expected a full key back, got ${JSON.stringify(key.json)}`);

  return { token, apiKey: secret, appName, appId: app.json.id, deptId: dept.json.id, company };
}

async function countWorkOrders(token) {
  const list = await api('GET', '/api/work-orders', { token });
  assert.equal(list.status, 200, JSON.stringify(list.json));
  return list.json.length;
}

/** 200 jobs an ERP would send. `badAppRow` swaps one row's app for a fiction. */
function erpRows({ badAppRow = null, appName } = {}) {
  const rows = [];
  for (let i = 1; i <= 200; i++) {
    rows.push({
      external_id: `ERP-${String(i).padStart(4, '0')}`,
      part_number: `PN-${1000 + i}`,
      part_name: `Bracket ${i}`,
      quantity: 10 + (i % 7),
      due_date: '2026-04-17',
      customer_ref: `SO-${9000 + i}`,
      app_name: (badAppRow === i) ? 'Weld' : appName,
    });
  }
  return rows;
}

before(async () => { await startServer(); });
after(() => {
  if (server) server.kill('SIGTERM');
  for (const ext of ['', '-shm', '-wal']) {
    try { fs.unlinkSync(DB_PATH + ext); } catch { /* ignore */ }
  }
});

describe('the ERP door', () => {
  let A, B;

  before(async () => {
    A = await makeCompany({ company: 'Alpha Fabrication', email: 'admin@alpha.test', appName: 'Assembly' });
    B = await makeCompany({ company: 'Bravo Machining',   email: 'admin@bravo.test', appName: 'Turning' });
  });

  it('the migration gave work_orders the three columns the ERP needs', async () => {
    // Proven through the API rather than by opening the file: a work order
    // created with the three fields must hand them back.
    const created = await api('POST', '/api/work-orders', {
      token: A.token,
      body: {
        part_number: 'PN-SCHEMA', part_name: 'Schema Probe', quantity: 1,
        due_date: '2026-01-15', customer_ref: 'SO-SCHEMA', external_id: 'ERP-SCHEMA',
      },
    });
    assert.equal(created.status, 201, JSON.stringify(created.json));
    assert.equal(created.json.due_date, '2026-01-15');
    assert.equal(created.json.customer_ref, 'SO-SCHEMA');
    assert.equal(created.json.external_id, 'ERP-SCHEMA');

    const back = await api('GET', `/api/work-orders/${created.json.id}`, { token: A.token });
    assert.equal(back.json.due_date, '2026-01-15', 'due_date must survive a round trip');

    await api('DELETE', `/api/work-orders/${created.json.id}`, { token: A.token });
  });

  it('rejects a due date that is not a real day, rather than storing a guess', async () => {
    const bad = await api('POST', '/api/work-orders', {
      token: A.token,
      body: { part_number: 'PN-X', part_name: 'X', quantity: 1, due_date: '17/04/2026' },
    });
    assert.equal(bad.status, 400, JSON.stringify(bad.json));
    assert.match(bad.json.error, /due_date must be YYYY-MM-DD/);
  });

  it('takes 200 rows on one API call, under five seconds', async () => {
    const before = await countWorkOrders(A.token);
    const started = Date.now();
    const res = await api('POST', '/api/v1/work-orders', {
      apiKey: A.apiKey,
      body: { rows: erpRows({ appName: A.appName }) },
    });
    const elapsed = Date.now() - started;

    assert.equal(res.status, 200, JSON.stringify(res.json));
    assert.equal(res.json.summary.created, 200, JSON.stringify(res.json.summary));
    assert.equal(res.json.summary.rejected, 0, JSON.stringify(res.json.results.filter(r => r.reason)));
    assert.ok(elapsed < 5000, `200 rows took ${elapsed}ms; a week's release must not feel like a batch job`);

    assert.equal(await countWorkOrders(A.token), before + 200);

    // Every result names the row it is about and the work order it produced.
    const first = res.json.results[0];
    assert.equal(first.row, 1);
    assert.equal(first.result, 'created');
    assert.equal(first.reason, null);
    assert.ok(first.work_order_id, 'a created row must report its work order id');
    assert.match(first.work_order_number, /^WO-\d{4}-\d+$/, `numbering path reused, got ${first.work_order_number}`);
    assert.equal(first.external_id, 'ERP-0001');
  });

  it('sending the identical body again updates 200 and creates none', async () => {
    const before = await countWorkOrders(A.token);
    const res = await api('POST', '/api/v1/work-orders', {
      apiKey: A.apiKey,
      body: { rows: erpRows({ appName: A.appName }) },
    });
    assert.equal(res.status, 200, JSON.stringify(res.json));
    assert.equal(res.json.summary.updated, 200, JSON.stringify(res.json.summary));
    assert.equal(res.json.summary.created, 0, 'a re-import must not duplicate the schedule');
    assert.equal(await countWorkOrders(A.token), before, 'the row count cannot move on a re-import');
  });

  it('rejects the one row naming an unknown app, and lands the other 199', async () => {
    const rows = erpRows({ appName: A.appName, badAppRow: 42 });
    // Fresh external ids so the 199 good rows are creates, not updates.
    for (const r of rows) r.external_id = r.external_id.replace('ERP-', 'ERP2-');
    const before = await countWorkOrders(A.token);

    const res = await api('POST', '/api/v1/work-orders', { apiKey: A.apiKey, body: { rows } });
    assert.equal(res.status, 200, JSON.stringify(res.json));
    assert.equal(res.json.summary.created, 199, JSON.stringify(res.json.summary));
    assert.equal(res.json.summary.rejected, 1);

    const bad = res.json.results.find(r => r.result === 'rejected');
    assert.equal(bad.row, 42, 'the verdict must point at the line the planner has to fix');
    assert.match(bad.reason, /app "Weld" not found/, `reason must name the app, got: ${bad.reason}`);
    assert.equal(bad.work_order_id, null, 'a rejected row must not have written anything');
    assert.equal(bad.work_order_number, null, 'a rejected row must not be promised a number either');

    assert.equal(await countWorkOrders(A.token), before + 199);
  });

  it('names the reason for a quantity that is not a whole number', async () => {
    const res = await api('POST', '/api/v1/work-orders', {
      apiKey: A.apiKey,
      body: [{ external_id: 'ERP-QTY', part_number: 'PN-1', part_name: 'One', quantity: 'ten' }],
    });
    assert.equal(res.json.summary.rejected, 1);
    assert.match(res.json.results[0].reason, /quantity must be a whole number between 1 and 1,000,000/);
  });

  it('names the reason for a due date in the wrong shape', async () => {
    const res = await api('POST', '/api/v1/work-orders', {
      apiKey: A.apiKey,
      body: [{ external_id: 'ERP-DUE', part_number: 'PN-1', part_name: 'One', quantity: 5, due_date: 'next Tuesday' }],
    });
    assert.equal(res.json.summary.rejected, 1);
    assert.match(res.json.results[0].reason, /due_date must be YYYY-MM-DD/);
  });

  it('refuses a batch over the row limit instead of half-importing it', async () => {
    const rows = [];
    for (let i = 0; i < 2001; i++) rows.push({ external_id: `BIG-${i}`, part_number: 'P', part_name: 'P', quantity: 1 });
    const res = await api('POST', '/api/v1/work-orders', { apiKey: A.apiKey, body: { rows } });
    assert.equal(res.status, 413, JSON.stringify(res.json));
    assert.match(res.json.message, /2,000 rows at a time/);
  });

  it('preview writes nothing', async () => {
    const before = await countWorkOrders(A.token);
    const csv = [
      'WO Number,External ID,Part Number,Part Name,Qty,Due,Customer Ref,App',
      `,PREVIEW-1,PN-77,Preview Part,5,2026-05-01,SO-1,${A.appName}`,
      ',PREVIEW-2,PN-78,Second Part,notanumber,2026-05-01,SO-2,Assembly',
    ].join('\r\n');

    const res = await api('POST', '/api/work-orders/import/preview', { token: A.token, body: { csv } });
    assert.equal(res.status, 200, JSON.stringify(res.json));
    assert.equal(res.json.dry_run, true);
    assert.equal(res.json.summary.created, 1);
    assert.equal(res.json.summary.rejected, 1);
    assert.equal(res.json.results[0].work_order_id, null, 'preview cannot report an id it did not create');
    assert.equal(await countWorkOrders(A.token), before, 'preview must leave the row count exactly as it was');
  });

  it('parses a CSV with quoted commas and CRLF line endings', async () => {
    const csv =
      'External ID,Part Number,Part Name,Qty,Due,Notes\r\n' +
      'CSV-1,PN-90,"Bracket, left hand",12,2026-06-02,"Rush, per ""phone call"""\r\n' +
      'CSV-2,PN-91,Plain part,3,2026-06-03,\r\n';

    const res = await api('POST', '/api/work-orders/import/commit', { token: A.token, body: { csv } });
    assert.equal(res.status, 200, JSON.stringify(res.json));
    assert.equal(res.json.summary.created, 2, JSON.stringify(res.json.results));

    const list = await api('GET', '/api/work-orders', { token: A.token });
    const wo = list.json.find(w => w.external_id === 'CSV-1');
    assert.ok(wo, 'the quoted row must have landed');
    assert.equal(wo.part_name, 'Bracket, left hand', 'a quoted comma is one cell, not two');
    assert.equal(wo.notes, 'Rush, per "phone call"', 'a doubled quote is one quote');
    assert.equal(wo.quantity, 12);
    assert.equal(wo.due_date, '2026-06-02');
  });

  it('serves the CSV template as a file, not JSON', async () => {
    const res = await fetch(`${BASE}/api/work-orders/import/template`, {
      headers: { Authorization: `Bearer ${A.token}` },
    });
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type') || '', /text\/csv/);
    const text = await res.text();
    for (const col of ['work_order_number', 'external_id', 'part_number', 'quantity', 'due_date', 'customer_ref']) {
      assert.ok(text.includes(col), `template header is missing ${col}`);
    }
  });

  it('refuses the session-based commit for an operator', async () => {
    const made = await api('POST', '/api/users', {
      token: A.token,
      body: { email: 'op@alpha.test', display_name: 'Otto Operator', password: 'SecretPass1', role: 'operator' },
    });
    assert.ok([200, 201].includes(made.status), `create operator: ${JSON.stringify(made.json)}`);

    const login = await api('POST', '/api/auth/login', {
      body: { email: 'op@alpha.test', password: 'SecretPass1' },
    });
    assert.equal(login.status, 200, JSON.stringify(login.json));

    const before = await countWorkOrders(A.token);
    const res = await api('POST', '/api/work-orders/import/commit', {
      token: login.json.token,
      body: { rows: [{ external_id: 'OP-1', part_number: 'PN-1', part_name: 'One', quantity: 1 }] },
    });
    assert.equal(res.status, 403, `an operator must not be able to rewrite the week: ${JSON.stringify(res.json)}`);
    assert.equal(await countWorkOrders(A.token), before);

    const preview = await api('POST', '/api/work-orders/import/preview', {
      token: login.json.token, body: { rows: [{ external_id: 'OP-2', part_number: 'P', part_name: 'P', quantity: 1 }] },
    });
    assert.equal(preview.status, 403, 'preview is manager-or-above too');
  });
});

describe('one key, one company', () => {
  let A, B;

  before(async () => {
    A = await makeCompany({ company: 'Cobalt Works', email: 'admin@cobalt.test', appName: 'Assembly' });
    B = await makeCompany({ company: 'Delta Press',  email: 'admin@delta.test',  appName: 'Pressing' });

    const seeded = await api('POST', '/api/v1/work-orders', {
      apiKey: A.apiKey,
      body: [{ external_id: 'SHARED-1', part_number: 'PN-A', part_name: 'Alpha Part', quantity: 4, due_date: '2026-07-01' }],
    });
    assert.equal(seeded.json.summary.created, 1, JSON.stringify(seeded.json));
  });

  it('every row a key creates carries that key\'s company', async () => {
    const mine = await api('GET', '/api/v1/work-orders', { apiKey: A.apiKey });
    assert.equal(mine.status, 200);
    assert.ok(mine.json.some(w => w.external_id === 'SHARED-1'));

    const theirs = await api('GET', '/api/v1/work-orders', { apiKey: B.apiKey });
    assert.equal(theirs.status, 200);
    assert.equal(theirs.json.length, 0, 'company B must not read company A\'s schedule');
  });

  it('company B reusing company A\'s external_id creates its own row, never touching A\'s', async () => {
    const res = await api('POST', '/api/v1/work-orders', {
      apiKey: B.apiKey,
      body: [{ external_id: 'SHARED-1', part_number: 'PN-B', part_name: 'Bravo Part', quantity: 99 }],
    });
    assert.equal(res.json.summary.created, 1, 'the same external_id in another tenant is a different job');

    const a = (await api('GET', '/api/v1/work-orders', { apiKey: A.apiKey }))
      .json.find(w => w.external_id === 'SHARED-1');
    assert.equal(a.part_name, 'Alpha Part', 'company A\'s row must be untouched');
    assert.equal(a.quantity, 4);

    const b = (await api('GET', '/api/v1/work-orders', { apiKey: B.apiKey }))
      .json.find(w => w.external_id === 'SHARED-1');
    assert.equal(b.part_name, 'Bravo Part');
  });

  it('a PATCH from the wrong company is a 404, not someone else\'s data', async () => {
    // Delete B's own SHARED-1 first so the only one left is A's.
    const bRow = (await api('GET', '/api/v1/work-orders', { apiKey: B.apiKey }))
      .json.find(w => w.external_id === 'SHARED-1');
    await api('DELETE', `/api/work-orders/${bRow.id}`, { token: B.token });

    const res = await api('PATCH', '/api/v1/work-orders/SHARED-1', {
      apiKey: B.apiKey, body: { quantity: 1 },
    });
    assert.equal(res.status, 404, JSON.stringify(res.json));

    const a = (await api('GET', '/api/v1/work-orders', { apiKey: A.apiKey }))
      .json.find(w => w.external_id === 'SHARED-1');
    assert.equal(a.quantity, 4, 'A\'s quantity must not have moved');
  });

  it('the owning key can PATCH its own row', async () => {
    const res = await api('PATCH', '/api/v1/work-orders/SHARED-1', {
      apiKey: A.apiKey, body: { quantity: 12, due_date: '2026-08-09', customer_ref: 'SO-NEW' },
    });
    assert.equal(res.status, 200, JSON.stringify(res.json));
    assert.equal(res.json.result, 'updated');

    const a = (await api('GET', '/api/v1/work-orders', { apiKey: A.apiKey }))
      .json.find(w => w.external_id === 'SHARED-1');
    assert.equal(a.quantity, 12);
    assert.equal(a.due_date, '2026-08-09');
    assert.equal(a.customer_ref, 'SO-NEW');
    assert.equal(a.part_name, 'Alpha Part', 'a field the PATCH did not mention keeps its value');
  });

  it('a PATCH that would break a rule is refused with the reason', async () => {
    const res = await api('PATCH', '/api/v1/work-orders/SHARED-1', {
      apiKey: A.apiKey, body: { quantity: 0 },
    });
    assert.equal(res.status, 400, JSON.stringify(res.json));
    assert.match(res.json.reason, /quantity must be a whole number between 1 and 1,000,000/);
  });

  it('no key, no door', async () => {
    const res = await api('POST', '/api/v1/work-orders', {
      body: [{ external_id: 'NOKEY', part_number: 'P', part_name: 'P', quantity: 1 }],
    });
    assert.equal(res.status, 401, JSON.stringify(res.json));
  });

  it('a row without an external_id is a create, and a duplicate WO number is refused', async () => {
    const first = await api('POST', '/api/v1/work-orders', {
      apiKey: A.apiKey,
      body: [{ work_order_number: 'WO-MANUAL-1', part_number: 'PN-M', part_name: 'Manual', quantity: 2 }],
    });
    assert.equal(first.json.summary.created, 1, JSON.stringify(first.json));

    const again = await api('POST', '/api/v1/work-orders', {
      apiKey: A.apiKey,
      body: [{ work_order_number: 'WO-MANUAL-1', part_number: 'PN-M', part_name: 'Manual', quantity: 2 }],
    });
    assert.equal(again.json.summary.rejected, 1, 'a second row under the same number is a duplicate');
    assert.match(again.json.results[0].reason, /already exists/);
  });
});

// ─── Review fixes: the ways a "successful" import was still wrong ─────────────
//
// Each case below is a defect the adversarial review found in the first cut.
// They share one theme: the preview and the commit have to agree, and a verdict
// of "created"/"updated" has to mean the row actually landed the way it reads.

describe('preview and commit agree, row for row', () => {
  let C;

  before(async () => {
    C = await makeCompany({ company: 'Echo Tooling', email: 'admin@echo.test', appName: 'Milling' });
  });

  it('rejects a hand-typed number that collides with one this import will assign', async () => {
    // Row 1 has no number, so the sequence will hand it the next one. Row 2
    // types that exact number. Before the fix the preview said "created,
    // created" and the commit died on the unique index, taking all of it down.
    const next = (await api('POST', '/api/work-orders/import/preview', {
      token: C.token, body: { rows: [{ part_number: 'PN-P', part_name: 'Probe', quantity: 1 }] },
    })).json.results[0].work_order_number;
    assert.match(next, /^WO-\d{4}-\d+$/, `preview must name the number it would assign, got ${next}`);

    const rows = [
      { external_id: 'CLASH-A', part_number: 'PN-1', part_name: 'First', quantity: 5 },
      { external_id: 'CLASH-B', work_order_number: next, part_number: 'PN-2', part_name: 'Second', quantity: 5 },
    ];

    const preview = await api('POST', '/api/work-orders/import/preview', { token: C.token, body: { rows } });
    assert.equal(preview.status, 200, JSON.stringify(preview.json));
    assert.equal(preview.json.summary.created, 1, JSON.stringify(preview.json.results));
    assert.equal(preview.json.summary.rejected, 1);
    assert.match(
      preview.json.results[1].reason,
      /collides with a number this import will assign/,
      `got: ${preview.json.results[1].reason}`,
    );

    const commit = await api('POST', '/api/work-orders/import/commit', { token: C.token, body: { rows } });
    assert.equal(commit.status, 200, JSON.stringify(commit.json));
    assert.deepStrictEqual(
      commit.json.results.map(r => [r.result, r.reason]),
      preview.json.results.map(r => [r.result, r.reason]),
      'the commit must reach the same verdicts the preview promised',
    );
    // And the number the preview printed is the number the job actually got.
    assert.equal(commit.json.results[0].work_order_number, next);
  });

  it('a preview names the number a numberless row will be given, and the commit uses it', async () => {
    const rows = [
      { external_id: 'SEQ-1', part_number: 'PN-A', part_name: 'A', quantity: 1 },
      { external_id: 'SEQ-2', part_number: 'PN-B', part_name: 'B', quantity: 1 },
    ];
    const preview = await api('POST', '/api/work-orders/import/preview', { token: C.token, body: { rows } });
    const promised = preview.json.results.map(r => r.work_order_number);
    assert.ok(promised.every(Boolean) && promised[0] !== promised[1], JSON.stringify(promised));

    const commit = await api('POST', '/api/work-orders/import/commit', { token: C.token, body: { rows } });
    assert.deepStrictEqual(commit.json.results.map(r => r.work_order_number), promised);
  });
});

describe('a column that means two things is refused before any row is judged', () => {
  let D;
  before(async () => { D = await makeCompany({ company: 'Foxtrot Fab', email: 'admin@foxtrot.test', appName: 'Bending' }); });

  it('an empty alias column cannot mask a filled canonical one', async () => {
    const csv = [
      'External ID,Part Number,Part Name,Qty Ordered,quantity',
      'AMB-1,PN-1,One,,5',
    ].join('\r\n');
    const res = await api('POST', '/api/work-orders/import/preview', { token: D.token, body: { csv } });
    assert.equal(res.status, 400, JSON.stringify(res.json));
    assert.equal(res.json.error, 'ambiguous_columns');
    assert.match(res.json.message, /two columns map to quantity/);
    assert.match(res.json.message, /"Qty Ordered"/);
    assert.match(res.json.message, /"quantity"/);
    assert.match(res.json.message, /remove one/);
  });

  it('two customer columns cannot silently drop one', async () => {
    const csv = [
      'External ID,Part Number,Part Name,quantity,Customer,Customer PO',
      'AMB-2,PN-2,Two,5,Acme,PO-99',
    ].join('\r\n');
    const res = await api('POST', '/api/work-orders/import/preview', { token: D.token, body: { csv } });
    assert.equal(res.status, 400, JSON.stringify(res.json));
    assert.match(res.json.message, /two columns map to customer_ref/);
  });

  it('the same guard applies to a single JSON work order on the public API', async () => {
    const res = await api('POST', '/api/v1/work-orders', {
      apiKey: D.apiKey,
      body: { external_id: 'AMB-3', part_number: 'P', part_name: 'P', qty: 900, quantity: 5 },
    });
    assert.equal(res.status, 400, JSON.stringify(res.json));
    assert.match(res.json.message, /two columns map to quantity/);
  });
});

describe('an update cannot break a job that is already running', () => {
  let E, wo;

  before(async () => {
    E = await makeCompany({ company: 'Golf Grinding', email: 'admin@golf.test', appName: 'Grinding' });
    const made = await api('POST', '/api/v1/work-orders', {
      apiKey: E.apiKey,
      body: [{ external_id: 'RUN-1', part_number: 'PN-R', part_name: 'Runner', quantity: 100 }],
    });
    assert.equal(made.json.summary.created, 1, JSON.stringify(made.json));
    wo = made.json.results[0].work_order_id;
    // Sixty units are already built.
    const put = await api('PUT', `/api/work-orders/${wo}`, {
      token: E.token, body: { quantity_completed: 60, status: 'in_progress' },
    });
    assert.equal(put.status, 200, JSON.stringify(put.json));
  });

  it('refuses a quantity below what the floor has already completed', async () => {
    const res = await api('POST', '/api/v1/work-orders', {
      apiKey: E.apiKey, body: [{ external_id: 'RUN-1', quantity: 10 }],
    });
    assert.equal(res.json.summary.rejected, 1, JSON.stringify(res.json.results));
    assert.match(res.json.results[0].reason, /quantity 10 is below the 60 already completed/);

    const after = (await api('GET', '/api/v1/work-orders', { apiKey: E.apiKey }))
      .json.find(w => w.external_id === 'RUN-1');
    assert.equal(after.quantity, 100, 'the stored order must not have shrunk');
  });

  it('refuses to renumber a job that is in progress', async () => {
    const res = await api('POST', '/api/v1/work-orders', {
      apiKey: E.apiKey, body: [{ external_id: 'RUN-1', work_order_number: 'WO-RENAMED-1' }],
    });
    assert.equal(res.json.summary.rejected, 1, JSON.stringify(res.json.results));
    assert.match(res.json.results[0].reason, /work_order_number cannot be changed — work order is in_progress/);
  });

  it('allows renumbering a job nobody has started', async () => {
    const made = await api('POST', '/api/v1/work-orders', {
      apiKey: E.apiKey, body: [{ external_id: 'PEND-1', part_number: 'PN-P', part_name: 'Pending', quantity: 3 }],
    });
    assert.equal(made.json.summary.created, 1);
    const res = await api('POST', '/api/v1/work-orders', {
      apiKey: E.apiKey, body: [{ external_id: 'PEND-1', work_order_number: 'WO-RENAMED-2' }],
    });
    assert.equal(res.json.summary.updated, 1, JSON.stringify(res.json.results));
    assert.equal(res.json.results[0].work_order_number, 'WO-RENAMED-2');
  });

  it('refuses to change a completed work order', async () => {
    const made = await api('POST', '/api/v1/work-orders', {
      apiKey: E.apiKey, body: [{ external_id: 'DONE-1', part_number: 'PN-D', part_name: 'Done', quantity: 5 }],
    });
    const id = made.json.results[0].work_order_id;
    await api('PUT', `/api/work-orders/${id}/complete`, { token: E.token });

    const res = await api('POST', '/api/v1/work-orders', {
      apiKey: E.apiKey, body: [{ external_id: 'DONE-1', quantity: 50 }],
    });
    assert.equal(res.json.summary.rejected, 1, JSON.stringify(res.json.results));
    assert.match(res.json.results[0].reason, /work order is completed — reopen it before importing changes/);
  });
});

describe('numbers, dates and ids are checked before they are stored', () => {
  let F;
  before(async () => { F = await makeCompany({ company: 'Hotel Hydraulics', email: 'admin@hotel.test', appName: 'Honing' }); });

  const reject = async (row) => {
    const res = await api('POST', '/api/v1/work-orders', { apiKey: F.apiKey, body: [row] });
    assert.equal(res.json.summary.rejected, 1, `expected a rejection, got ${JSON.stringify(res.json)}`);
    return res.json.results[0].reason;
  };

  it('refuses a quantity too large to be an integer in the column', async () => {
    const reason = await reject({ external_id: 'BIG-Q', part_number: 'P', part_name: 'P', quantity: '99999999999999999999' });
    assert.match(reason, /quantity must be a whole number between 1 and 1,000,000/);
    const list = await api('GET', '/api/v1/work-orders', { apiKey: F.apiKey });
    assert.equal(list.json.filter(w => w.external_id === 'BIG-Q').length, 0, 'nothing may have been written');
  });

  it('refuses a quantity with leading zeros rather than reading 007 as 7', async () => {
    const reason = await reject({ external_id: 'ZERO-Q', part_number: 'P', part_name: 'P', quantity: '007' });
    assert.match(reason, /quantity must not have leading zeros/);
  });

  it('refuses a schedule window that ends before it starts', async () => {
    const reason = await reject({
      external_id: 'BACKWARDS', part_number: 'P', part_name: 'P', quantity: 1,
      scheduled_start: '2026-05-10 08:00', scheduled_end: '2026-05-09 17:00',
    });
    assert.match(reason, /scheduled_end .* is before scheduled_start/);
  });

  it('refuses an external_id that is not usable as one', async () => {
    for (const [id, pattern] of [['.', /cannot be "\.".*"\.\."/], ['..', /cannot be "\.".*"\.\."/], ['a/b', /cannot contain/], ['a\\b', /cannot contain/]]) {
      const res = await api('POST', '/api/v1/work-orders', {
        apiKey: F.apiKey, body: [{ external_id: id, part_number: 'P', part_name: 'P', quantity: 1 }],
      });
      assert.equal(res.json.summary.rejected, 1, `external_id ${JSON.stringify(id)} should be refused`);
      assert.match(res.json.results[0].reason, pattern, `for ${JSON.stringify(id)}: ${res.json.results[0].reason}`);
    }
  });
});

describe('whitespace never reaches the column', () => {
  let G;
  before(async () => { G = await makeCompany({ company: 'India Injection', email: 'admin@india.test', appName: 'Moulding' }); });

  it('POST trims due_date and customer_ref', async () => {
    const res = await api('POST', '/api/work-orders', {
      token: G.token,
      body: { part_number: 'PN-T', part_name: 'Trimmed', quantity: 1, due_date: '  2026-04-17  ', customer_ref: '  SO-55  ' },
    });
    assert.equal(res.status, 201, JSON.stringify(res.json));
    assert.equal(res.json.due_date, '2026-04-17', 'a padded date must be stored trimmed, not raw');
    assert.equal(res.json.customer_ref, 'SO-55');
  });

  it('PUT trims due_date and customer_ref', async () => {
    const made = await api('POST', '/api/work-orders', {
      token: G.token, body: { part_number: 'PN-U', part_name: 'Untrimmed', quantity: 1 },
    });
    const put = await api('PUT', `/api/work-orders/${made.json.id}`, {
      token: G.token, body: { due_date: ' 2026-06-01 ', customer_ref: ' SO-66 ' },
    });
    assert.equal(put.status, 200, JSON.stringify(put.json));
    assert.equal(put.json.due_date, '2026-06-01');
    assert.equal(put.json.customer_ref, 'SO-66');
  });
});

describe('files that are not comma-separated still read', () => {
  let H;
  before(async () => { H = await makeCompany({ company: 'Juliet Joinery', email: 'admin@juliet.test', appName: 'Sanding' }); });

  const commit = (csv) => api('POST', '/api/work-orders/import/commit', { token: H.token, body: { csv } });

  it('reads a tab-separated paste', async () => {
    const res = await commit('External ID\tPart Number\tPart Name\tQty\r\nTSV-1\tPN-1\tTabbed part\t7\r\n');
    assert.equal(res.status, 200, JSON.stringify(res.json));
    assert.equal(res.json.summary.created, 1, JSON.stringify(res.json.results));
  });

  it('reads a semicolon-separated European export', async () => {
    const res = await commit('External ID;Part Number;Part Name;Qty\r\nSSV-1;PN-2;Semi part;8\r\n');
    assert.equal(res.json.summary.created, 1, JSON.stringify(res.json.results));
  });

  it("honours Excel's sep= line instead of reading it as the header", async () => {
    const res = await commit('sep=;\r\nExternal ID;Part Number;Part Name;Qty\r\nSEP-1;PN-3;Sep part;9\r\n');
    assert.equal(res.json.summary.created, 1, JSON.stringify(res.json.results));
    const wo = (await api('GET', '/api/work-orders', { token: H.token })).json.find(w => w.external_id === 'SEP-1');
    assert.equal(wo.quantity, 9);
  });

  it('answers a file whose columns mean nothing with one message, not a reason per field', async () => {
    const res = await api('POST', '/api/work-orders/import/preview', {
      token: H.token, body: { csv: 'Widget,Gizmo,Doohickey\r\na,b,c\r\n' },
    });
    assert.equal(res.status, 400, JSON.stringify(res.json));
    assert.equal(res.json.error, 'unrecognised_columns');
    assert.match(res.json.message, /unrecognised_columns: Widget, Gizmo, Doohickey/);
  });
});

describe('an update that changes nothing says so', () => {
  let I, woId;

  before(async () => {
    I = await makeCompany({ company: 'Kilo Castings', email: 'admin@kilo.test', appName: 'Casting' });
    const made = await api('POST', '/api/v1/work-orders', {
      apiKey: I.apiKey,
      body: [{ external_id: 'NOOP-1', part_number: 'PN-N', part_name: 'Noop', quantity: 12, due_date: '2026-09-09' }],
    });
    assert.equal(made.json.summary.created, 1, JSON.stringify(made.json));
    woId = made.json.results[0].work_order_id;
  });

  const activityCount = async () => {
    const rows = await api('GET', '/api/activity?entity_type=work_order&limit=1000', { token: I.token });
    assert.equal(rows.status, 200, JSON.stringify(rows.json));
    return rows.json.filter(r => r.entity_id === woId).length;
  };

  it('reports the row as updated but records nothing when every value already matches', async () => {
    const before = await activityCount();
    const beforeRow = (await api('GET', `/api/work-orders/${woId}`, { token: I.token })).json;

    const res = await api('POST', '/api/v1/work-orders', {
      apiKey: I.apiKey,
      body: [{ external_id: 'NOOP-1', part_number: 'PN-N', part_name: 'Noop', quantity: 12, due_date: '2026-09-09' }],
    });
    assert.equal(res.json.summary.updated, 1, JSON.stringify(res.json.summary));
    assert.equal(res.json.summary.unchanged, 1, 'a no-op must be counted as such');
    assert.equal(res.json.results[0].reason, 'nothing changed');

    assert.equal(await activityCount(), before, 'a no-op must not write an activity entry');
    const afterRow = (await api('GET', `/api/work-orders/${woId}`, { token: I.token })).json;
    assert.equal(afterRow.updated_at, beforeRow.updated_at, 'a no-op must not stamp updated_at');
  });

  it('the preview says "nothing changed" about exactly the rows the commit will skip', async () => {
    const rows = [{ external_id: 'NOOP-1', part_number: 'PN-N', part_name: 'Noop', quantity: 12, due_date: '2026-09-09' }];
    const preview = await api('POST', '/api/work-orders/import/preview', { token: I.token, body: { rows } });
    assert.equal(preview.json.summary.unchanged, 1, JSON.stringify(preview.json.summary));
    assert.equal(preview.json.results[0].reason, 'nothing changed');

    const commit = await api('POST', '/api/work-orders/import/commit', { token: I.token, body: { rows } });
    assert.deepStrictEqual(
      commit.json.results.map(r => [r.result, r.reason]),
      preview.json.results.map(r => [r.result, r.reason]),
    );
    assert.equal(commit.json.summary.unchanged, preview.json.summary.unchanged);
  });

  it('a real change is still counted, recorded and reported', async () => {
    const before = await activityCount();
    const res = await api('POST', '/api/v1/work-orders', {
      apiKey: I.apiKey, body: [{ external_id: 'NOOP-1', quantity: 20 }],
    });
    assert.equal(res.json.summary.updated, 1);
    assert.equal(res.json.summary.unchanged, 0, JSON.stringify(res.json.summary));
    assert.equal(res.json.results[0].reason, null);
    assert.equal(await activityCount(), before + 1);
  });
});

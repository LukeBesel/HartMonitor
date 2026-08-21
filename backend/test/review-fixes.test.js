// ─── Regression tests for the PR-review (Codex) sweep ────────────────────────
// One suite per server-side defect found in review, so none of them can come
// back silently:
//
//   • PR #20 P1 — kit shortage quantities must reconcile with inventory: a
//     SHORT line with a partial pick still consumed that material, and revising
//     a quantity down must give the difference back (routes/kits.js).
//   • PR #22 P1 — CSV export values were fetched with an independent, unordered
//     LIMIT, so big exports shipped rows with blank widget columns; values must
//     be scoped to the completions the row query selected (routes/apps.js).
//   • PR #22 P1 — exported cells beginning with = + - @ are FORMULAS to Excel;
//     they must be neutralized (src/csv.js, used by apps.js and export.js).
//   • PR #22 P2 — /completions/app/:id/history must page in SQL rather than
//     loading and JSON-parsing every run on every request.
//   • PR #23 P2 — step takt must fall back to the legacy `takt_time` key.
//   • PR #20 P2 — /api/tables/import must accept a body up to its advertised
//     decoded size instead of 413-ing at the global parser first.
//
// Uses only Node built-ins (node:test + global fetch). Run with: npm test

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const PORT = 3184; // unique per test file — 3185-3199 are taken by other suites
const BASE = `http://localhost:${PORT}`;
const DB_PATH = path.join(os.tmpdir(), `mes-review-fixes-test-${Date.now()}.db`);

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

async function api(method, pathname, { token, body, raw } = {}) {
  const res = await fetch(`${BASE}${pathname}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (raw) return { status: res.status, text: await res.text() };
  let json = null;
  try { json = await res.json(); } catch { /* no body */ }
  return { status: res.status, json };
}

let token;
let itemId, locationId, appId;

before(async () => {
  await startServer();

  const signup = await api('POST', '/api/auth/signup', {
    body: {
      company_name: 'Review Fixes Co', email: 'owner@review-fixes.test',
      password: 'supersecret1', display_name: 'Owner',
    },
  });
  assert.equal(signup.status, 201);
  token = signup.json.token;

  const loc = await api('POST', '/api/inventory/locations', { token, body: { name: 'Main Store', code: 'MS' } });
  assert.equal(loc.status, 201);
  locationId = loc.json.id;

  const item = await api('POST', '/api/inventory/items', {
    token, body: { sku: 'RF-BOLT', name: 'M6 Bolt', unit: 'ea' },
  });
  assert.equal(item.status, 201);
  itemId = item.json.id;

  // 100 on hand at the store.
  assert.equal((await api('POST', '/api/inventory/movements', {
    token, body: { item_id: itemId, location_id: locationId, movement_type: 'receive', quantity: 100 },
  })).status, 201);
});

after(() => {
  if (server) server.kill();
  try { fs.unlinkSync(DB_PATH); } catch { /* already gone */ }
  for (const suffix of ['-wal', '-shm']) {
    try { fs.unlinkSync(DB_PATH + suffix); } catch { /* fine */ }
  }
});

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function onHand() {
  const { json } = await api('GET', `/api/inventory/items/${itemId}`, { token });
  return json.total_quantity;
}

async function kitMovements(kitId) {
  const { json } = await api('GET', `/api/inventory/movements?item_id=${itemId}&limit=200`, { token });
  return json.filter(m => m.reference_type === 'kit' && m.reference_id === kitId);
}

async function netConsumed(kitId) {
  const rows = await kitMovements(kitId);
  return rows.reduce((sum, m) => sum - Number(m.quantity), 0);
}

// POST /apps only takes a name (it seeds one empty step); steps land via PUT.
async function makeApp(name, steps) {
  const created = await api('POST', '/api/apps', { token, body: { name } });
  assert.equal(created.status, 201);
  const saved = await api('PUT', `/api/apps/${created.json.id}`, { token, body: { name, steps } });
  assert.equal(saved.status, 200);
  return created.json.id;
}

// Builds a work order with a one-line BOM and generates its kit.
async function makeKit(qtyPer, woQty) {
  const kitApp = await makeApp(`Kit App ${Math.random().toString(36).slice(2, 8)}`, [
    { id: 'k1', name: 'Build', order: 0, widgets: [] },
  ]);
  const pt = await api('POST', '/api/product-types', {
    token, body: { app_id: kitApp, name: `PT-${Math.random().toString(36).slice(2, 8)}` },
  });
  assert.equal(pt.status, 201);

  const bom = await api('POST', '/api/boms', { token, body: { product_type_id: pt.json.id } });
  assert.equal(bom.status, 201);
  assert.equal((await api('PUT', `/api/boms/${bom.json.id}`, {
    token, body: { lines: [{ item_id: itemId, qty_per: qtyPer }] },
  })).status, 200);
  assert.equal((await api('POST', `/api/boms/${bom.json.id}/activate`, { token })).status, 200);

  const wo = await api('POST', '/api/work-orders', {
    token,
    body: {
      work_order_number: `WO-${Math.random().toString(36).slice(2, 8)}`,
      product_type_id: pt.json.id, quantity: woQty,
      part_number: 'PN-1', part_name: 'Bracket', app_id: kitApp,
    },
  });
  assert.equal(wo.status, 201);

  const gen = await api('POST', '/api/kits/generate', {
    token, body: { work_order_id: wo.json.id, location_id: locationId },
  });
  assert.equal(gen.status, 201);
  const line = gen.json.lines.find(l => l.item_id === itemId);
  return { kitId: gen.json.id, lineId: line.id, required: line.qty_required };
}

// ─── PR #20 P1: shortage quantities must reconcile with inventory ────────────

test('a short line with a partial pick consumes exactly what was taken', async () => {
  const { kitId, lineId, required } = await makeKit(10, 1);   // needs 10
  const before = await onHand();

  const short = await api('PUT', `/api/kits/${kitId}/lines/${lineId}`, {
    token, body: { status: 'short', qty_picked: 4, short_reason: 'bin nearly empty' },
  });
  assert.equal(short.status, 200);
  assert.equal(short.json.line.status, 'short');
  assert.equal(short.json.line.qty_picked, 4);

  // The 4 bolts left the bin — the ledger and stock level must say so.
  assert.equal(await netConsumed(kitId), 4, 'partial pick on a short line is consumed');
  assert.equal(await onHand(), before - 4);
  assert.equal(required, 10);
});

test('revising a picked quantity downward returns the difference to stock', async () => {
  const { kitId, lineId } = await makeKit(10, 1);
  const before = await onHand();

  // Full pick first…
  assert.equal((await api('PUT', `/api/kits/${kitId}/lines/${lineId}`, {
    token, body: { status: 'picked' },
  })).status, 200);
  assert.equal(await netConsumed(kitId), 10);
  assert.equal(await onHand(), before - 10);

  // …then the picker discovers only 6 were good and marks the line short.
  const revised = await api('PUT', `/api/kits/${kitId}/lines/${lineId}`, {
    token, body: { status: 'short', qty_picked: 6, short_reason: '4 damaged' },
  });
  assert.equal(revised.status, 200);
  assert.equal(await netConsumed(kitId), 6, 'net consumption follows the line quantity');
  assert.equal(await onHand(), before - 6, '4 returned to the shelf');

  // Recovering the shortage consumes the difference again — and only once.
  assert.equal((await api('PUT', `/api/kits/${kitId}/lines/${lineId}`, {
    token, body: { status: 'picked', qty_picked: 10 },
  })).status, 200);
  assert.equal(await netConsumed(kitId), 10);
  assert.equal(await onHand(), before - 10);

  // A no-op update must not move anything.
  const movementsBefore = (await kitMovements(kitId)).length;
  assert.equal((await api('PUT', `/api/kits/${kitId}/lines/${lineId}`, {
    token, body: { status: 'verified' },
  })).status, 200);
  assert.equal((await kitMovements(kitId)).length, movementsBefore, 'idempotent: no extra movement');
  assert.equal(await onHand(), before - 10);
});

// ─── PR #22: CSV export correctness ──────────────────────────────────────────

test('exported CSV values cover every exported row and neutralize formulas', async () => {
  appId = await makeApp('Export App', [{
    id: 'step-1', name: 'Capture', order: 0,
    widgets: [{ id: 'w-note', type: 'text-input', order: 0, label: 'Note', config: { variableName: 'note' } }],
  }]);

  // A hostile operator name and a hostile captured value.
  const RUNS = 12;
  for (let i = 0; i < RUNS; i++) {
    const c = await api('POST', '/api/completions', {
      token, body: { app_id: appId, operator_name: i === 0 ? '=cmd|calc' : `Op ${i}` },
    });
    assert.equal(c.status, 201);
    const put = await api('PUT', `/api/completions/${c.json.id}`, {
      token,
      body: {
        status: 'completed',
        data: { note: i === 0 ? '=HYPERLINK("http://evil","click")' : `note ${i}` },
        step_times: { 0: 30 + i },
        values: [{
          widget_id: 'w-note', step_id: 'step-1', variable_name: 'note', value_type: 'text',
          value_text: i === 0 ? '=HYPERLINK("http://evil","click")' : `note ${i}`,
        }],
      },
    });
    assert.equal(put.status, 200);
  }

  const csv = await api('GET', `/api/apps/${appId}/export.csv`, { token, raw: true });
  assert.equal(csv.status, 200);
  const lines = csv.text.replace(/^﻿/, '').trim().split('\n');
  assert.equal(lines.length, RUNS + 1, 'header + one row per run');

  // Every data row carries its widget value — none blank.
  const header = lines[0].split(',');
  const noteCol = header.indexOf('Note');
  assert.ok(noteCol > 0, 'widget column present');
  for (const row of lines.slice(1)) {
    const cells = row.split(',');
    assert.ok(cells.length >= header.length - 1, `row has all columns: ${row}`);
  }
  assert.equal(lines.slice(1).filter(r => /note \d/.test(r) || /HYPERLINK/.test(r)).length, RUNS,
    'every exported row carries its captured value');

  // Formula-leading cells are apostrophe-prefixed (and quoted when they also
  // contain CSV punctuation).
  assert.ok(csv.text.includes(`,'=cmd|calc,`), 'operator name neutralized');
  assert.ok(csv.text.includes(`"'=HYPERLINK(`), 'captured value neutralized and quoted');
  assert.ok(!csv.text.includes(',=cmd'), 'no raw formula cell survives');
  assert.ok(!csv.text.includes(',=HYPERLINK'), 'no raw formula cell survives');
  // Ordinary numbers keep their sign and stay numeric.
  assert.ok(!/,'-?\d+(\.\d+)?[,\n]/.test(csv.text), 'plain numbers are not apostrophe-prefixed');
});

test('escapeCSV neutralizes every formula lead without mangling numbers', () => {
  const { escapeCSV } = require('../src/csv');
  for (const bad of ['=1+1', '+1', '-1+1', '@SUM(A1)', '\tx', '\rx']) {
    assert.ok(escapeCSV(bad).startsWith("'") || escapeCSV(bad).startsWith(`"'`),
      `${JSON.stringify(bad)} must be neutralized`);
  }
  assert.equal(escapeCSV('-12.5'), '-12.5');
  assert.equal(escapeCSV('42'), '42');
  assert.equal(escapeCSV('-1e3'), '-1e3');
  assert.equal(escapeCSV('plain'), 'plain');
  assert.equal(escapeCSV('a,b'), '"a,b"');
  assert.equal(escapeCSV('say "hi"'), '"say ""hi"""');
  assert.equal(escapeCSV(null), '');
});

// ─── PR #22 P2: history pages in SQL and keeps its aggregates ────────────────

test('app history pages in the database and reports honest aggregates', async () => {
  const page1 = await api('GET', `/api/completions/app/${appId}/history?page=1&limit=5`, { token });
  assert.equal(page1.status, 200);
  assert.equal(page1.json.completions.length, 5, 'page size honored');
  assert.equal(page1.json.total, 12, 'total counts every run, not just the page');
  assert.equal(page1.json.total_runs, 12, 'all runs completed');

  const page3 = await api('GET', `/api/completions/app/${appId}/history?page=3&limit=5`, { token });
  assert.equal(page3.json.completions.length, 2, 'last page is partial');
  const ids1 = page1.json.completions.map(c => c.id);
  assert.ok(page3.json.completions.every(c => !ids1.includes(c.id)), 'pages do not overlap');

  // Durations come from step_times (30..41 seconds), so the rollups are known.
  assert.equal(page1.json.best_time, 30);
  const expectedAvg = Math.round(Array.from({ length: 12 }, (_, i) => 30 + i).reduce((a, b) => a + b, 0) / 12);
  assert.equal(page1.json.avg_duration, expectedAvg);
  assert.equal(page1.json.step_averages[0].completion_count, 12);
  assert.equal(page1.json.step_averages[0].avg_duration_seconds, expectedAvg);

  // Beyond the last page: empty list, aggregates unchanged.
  const page9 = await api('GET', `/api/completions/app/${appId}/history?page=9&limit=5`, { token });
  assert.equal(page9.json.completions.length, 0);
  assert.equal(page9.json.total, 12);
});

test('history reads pass/fail from the run data blob', async () => {
  const qcAppId = await makeApp('QC App', [{
    id: 's1', name: 'Check', order: 0,
    widgets: [{ id: 'w1', type: 'pass-fail', order: 0, label: 'Visual', config: { variableName: 'visual' } }],
  }]);
  const results = ['Pass', 'Pass', 'Pass', 'Fail'];
  for (const r of results) {
    const c = await api('POST', '/api/completions', { token, body: { app_id: qcAppId, operator_name: 'QC' } });
    assert.equal((await api('PUT', `/api/completions/${c.json.id}`, {
      token, body: { status: 'completed', data: { visual: r }, step_times: { 0: 10 } },
    })).status, 200);
  }
  const hist = await api('GET', `/api/completions/app/${qcAppId}/history`, { token });
  assert.equal(hist.json.total_runs, 4);
  assert.equal(hist.json.pass_rate, 75);
  assert.deepEqual(hist.json.completions.map(c => c.pass_fail).sort(), ['fail', 'pass', 'pass', 'pass']);
});

test('history reports takt from the legacy takt_time key', async () => {
  // Apps seeded before the v2 builder (and the demo sandbox) store step takt as
  // `takt_time`; reading only `takt_time_seconds` reported zero for all of them.
  const legacyAppId = await makeApp('Legacy Takt App', [
    { id: 'l1', name: 'Legacy step', order: 0, takt_time: 240, widgets: [] },
    { id: 'l2', name: 'Modern step', order: 1, takt_time_seconds: 120, widgets: [] },
  ]);
  const hist = await api('GET', `/api/completions/app/${legacyAppId}/history`, { token });
  assert.equal(hist.json.step_averages[0].takt_seconds, 240, 'legacy takt_time honored');
  assert.equal(hist.json.step_averages[1].takt_seconds, 120);
});

// ─── PR #20 P2: table import body limit matches the advertised cap ───────────

test('table import accepts a payload larger than the global 10 MiB JSON cap', async () => {
  // A ~9 MiB decoded CSV is ~12 MiB base64 — over the global parser's limit,
  // under the route's own 10 MiB decoded cap. Before the dedicated parser this
  // 413'd at the body parser, never reaching the route's friendly error.
  const row = 'a,b,c\n';
  const csv = 'col_a,col_b,col_c\n' + row.repeat(Math.ceil((9 * 1024 * 1024) / row.length));
  const b64 = Buffer.from(csv, 'utf8').toString('base64');
  assert.ok(b64.length > 11 * 1024 * 1024, 'payload exceeds the global 10 MiB parser limit');

  const res = await api('POST', '/api/tables/import', {
    token, body: { name: 'Big Import', filename: 'big.csv', data: b64 },
  });
  // The BODY PARSER no longer rejects it, so the ROUTE answers for itself —
  // here with its own row-cap message rather than an opaque 413.
  assert.notEqual(res.status, 413, 'body parser must not reject before the route runs');
  assert.equal(res.status, 400, `route applied its own rules (got ${JSON.stringify(res.json)})`);
  assert.match(res.json.error, /rows/i, 'rejected by the route’s row cap, not the parser');
});

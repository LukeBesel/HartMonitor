// ─── Excel / CSV table-import tests ───────────────────────────────────────────
// Spawns the real server against a throwaway database and exercises
// POST /api/tables/import: xlsx happy path (a real workbook built with
// XLSX.write), csv parsing, column type inference, field-id sanitization,
// the column/row/size caps, the supervisor+ write gate, and cross-tenant
// isolation of imported tables. Run with: npm test
//
// Uses node:test + global fetch + the already-installed 'xlsx' package.

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { spawn } = require('node:child_process');
const os = require('node:os');
const path = require('node:path');
const XLSX = require('xlsx');

const PORT = 3191; // unique per test file — 3192-3199 are taken by the other suites
const BASE = `http://localhost:${PORT}`;
const DB_PATH = path.join(os.tmpdir(), `mes-table-import-test-${Date.now()}.db`);

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

function xlsxBase64(rows, sheetName = 'Sheet1') {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), sheetName);
  return XLSX.write(wb, { type: 'base64', bookType: 'xlsx' });
}

function csvBase64(text) {
  return Buffer.from(text, 'utf8').toString('base64');
}

let tokenA; // Widget Co (developer — signup owner)
let tokenB; // Gadget Co (developer)
let operatorToken; // Widget Co operator

before(async () => {
  await startServer();

  const a = await api('POST', '/api/auth/signup', {
    body: { company_name: 'Widget Co', email: 'owner@widget-ti.test', password: 'supersecret1', display_name: 'Widget Owner' },
  });
  assert.equal(a.status, 201);
  tokenA = a.json.token;

  const b = await api('POST', '/api/auth/signup', {
    body: { company_name: 'Gadget Co', email: 'owner@gadget-ti.test', password: 'supersecret1', display_name: 'Gadget Owner' },
  });
  assert.equal(b.status, 201);
  tokenB = b.json.token;

  const created = await api('POST', '/api/users', {
    token: tokenA,
    body: { email: 'op@widget-ti.test', display_name: 'Import Op', password: 'supersecret1', role: 'operator' },
  });
  assert.equal(created.status, 201);
  const login = await api('POST', '/api/auth/login', { body: { email: 'op@widget-ti.test', password: 'supersecret1' } });
  assert.equal(login.status, 200);
  operatorToken = login.json.token;
});

after(() => {
  server?.kill();
});

// ─── Happy path: xlsx ─────────────────────────────────────────────────────────

let importedTableId;

test('imports a real .xlsx workbook: fields from headers, records from rows', async () => {
  const data = xlsxBase64([
    ['Part Name', 'Qty', 'SKU #'],
    ['Bracket', 4, 'BRK-001'],
    ['Housing', 1, 'HSG-002'],
    ['Screw M3', 12, 'SCR-M3'],
  ]);
  const res = await api('POST', '/api/tables/import', {
    token: tokenA,
    body: { name: 'Kit Parts', data, filename: 'kit-parts.xlsx' },
  });
  assert.equal(res.status, 201);
  importedTableId = res.json.id;
  assert.equal(res.json.name, 'Kit Parts');
  assert.equal(res.json.record_count, 3);

  // Fields carry the exact hand-made shape: { id, name, type }.
  assert.deepEqual(res.json.fields.map(f => f.name), ['Part Name', 'Qty', 'SKU #']);
  assert.deepEqual(res.json.fields.map(f => f.id), ['part_name', 'qty', 'sku']);
  assert.deepEqual(res.json.fields.map(f => f.type), ['text', 'number', 'text']);

  // Records read back through the ordinary records route, keyed by field id.
  const recs = await api('GET', `/api/tables/${importedTableId}/records`, { token: tokenA });
  assert.equal(recs.status, 200);
  assert.equal(recs.json.length, 3);
  const bracket = recs.json.find(r => r.data.part_name === 'Bracket');
  assert.ok(bracket);
  assert.strictEqual(bracket.data.qty, 4); // stored as a real number
  assert.equal(bracket.data.sku, 'BRK-001');
});

test('imported table is indistinguishable from a hand-made one', async () => {
  // Shows up in the list with a record count, loads via GET /:id, accepts
  // ordinary record inserts and updates — the same lifecycle as POST '/'.
  const list = await api('GET', '/api/tables', { token: tokenA });
  assert.equal(list.status, 200);
  const row = list.json.find(t => t.id === importedTableId);
  assert.ok(row, 'imported table appears in the tables list');
  assert.equal(row.record_count, 3);

  const one = await api('GET', `/api/tables/${importedTableId}`, { token: tokenA });
  assert.equal(one.status, 200);
  assert.equal(one.json.fields.length, 3);

  const ins = await api('POST', `/api/tables/${importedTableId}/records`, {
    token: tokenA,
    body: { data: { part_name: 'Washer', qty: 8, sku: 'WSH-004' } },
  });
  assert.equal(ins.status, 201);
});

// ─── Happy path: csv ──────────────────────────────────────────────────────────

test('imports a .csv with quoted values', async () => {
  const data = csvBase64(
    'Station,Cycle Seconds,Notes\n' +
    'Weld 1,42,"Runs hot, check coolant"\n' +
    'Weld 2,38,\n' +
    'Assembly,55,OK\n'
  );
  const res = await api('POST', '/api/tables/import', {
    token: tokenA,
    body: { name: 'Cycle Times', data, filename: 'cycles.csv' },
  });
  assert.equal(res.status, 201);
  assert.equal(res.json.record_count, 3);
  assert.deepEqual(res.json.fields.map(f => f.id), ['station', 'cycle_seconds', 'notes']);
  assert.deepEqual(res.json.fields.map(f => f.type), ['text', 'number', 'text']);

  const recs = await api('GET', `/api/tables/${res.json.id}/records`, { token: tokenA });
  const weld1 = recs.json.find(r => r.data.station === 'Weld 1');
  assert.strictEqual(weld1.data.cycle_seconds, 42);
  assert.equal(weld1.data.notes, 'Runs hot, check coolant');
  // Blank cells are simply absent from the record data.
  const weld2 = recs.json.find(r => r.data.station === 'Weld 2');
  assert.ok(!('notes' in weld2.data));
});

// ─── Type inference & sanitization details ────────────────────────────────────

test('column type inference: all-numeric → number, mixed → text, blanks ignored', async () => {
  const data = csvBase64(
    'all_num,mixed,num_with_blanks,all_blank\n' +
    '1,2,,\n' +
    '2.5,abc,7,\n' +
    '-3,4,8.25,\n'
  );
  const res = await api('POST', '/api/tables/import', {
    token: tokenA,
    body: { name: 'Inference', data, filename: 'inference.csv' },
  });
  assert.equal(res.status, 201);
  const types = Object.fromEntries(res.json.fields.map(f => [f.id, f.type]));
  assert.equal(types.all_num, 'number');
  assert.equal(types.mixed, 'text');
  assert.equal(types.num_with_blanks, 'number'); // blanks don't break numeric inference
  assert.equal(types.all_blank, 'text');         // no evidence → text
});

test('field ids are sanitized and deduped', async () => {
  const data = xlsxBase64([
    ['  Part Name!! ', 'Part Name', '2nd Qty', '', 'Part Name'],
    ['a', 'b', 1, 'd', 'e'],
  ]);
  const res = await api('POST', '/api/tables/import', {
    token: tokenA,
    body: { name: 'Sanitize', data, filename: 'sanitize.xlsx' },
  });
  assert.equal(res.status, 201);
  const ids = res.json.fields.map(f => f.id);
  assert.deepEqual(ids, ['part_name', 'part_name_2', 'f_2nd_qty', 'column_4', 'part_name_3']);
  // Blank header still gets a readable display name.
  assert.equal(res.json.fields[3].name, 'Column 4');
});

test('table name falls back to the filename when name is blank', async () => {
  const data = csvBase64('a\n1\n');
  const res = await api('POST', '/api/tables/import', {
    token: tokenA,
    body: { name: '  ', data, filename: 'shift-log.csv' },
  });
  assert.equal(res.status, 201);
  assert.equal(res.json.name, 'shift-log');
});

// ─── Caps & malformed input ───────────────────────────────────────────────────

test('rejects more than 50 columns with a clear 400', async () => {
  const headers = Array.from({ length: 51 }, (_, i) => `c${i + 1}`);
  const data = csvBase64(`${headers.join(',')}\n${headers.map(() => '1').join(',')}\n`);
  const res = await api('POST', '/api/tables/import', {
    token: tokenA,
    body: { name: 'Too Wide', data, filename: 'wide.csv' },
  });
  assert.equal(res.status, 400);
  assert.match(res.json.error, /columns/i);
});

test('rejects more than 5000 rows with a clear 400', async () => {
  const lines = ['sku,qty'];
  for (let i = 0; i < 5001; i++) lines.push(`SKU-${i},${i}`);
  const res = await api('POST', '/api/tables/import', {
    token: tokenA,
    body: { name: 'Too Tall', data: csvBase64(lines.join('\n')), filename: 'tall.csv' },
  });
  assert.equal(res.status, 400);
  assert.match(res.json.error, /rows/i);
});

test('accepts exactly 5000 rows (cap is inclusive)', async () => {
  const lines = ['sku'];
  for (let i = 0; i < 5000; i++) lines.push(`SKU-${i}`);
  const res = await api('POST', '/api/tables/import', {
    token: tokenA,
    body: { name: 'At Cap', data: csvBase64(lines.join('\n')), filename: 'atcap.csv' },
  });
  assert.equal(res.status, 201);
  assert.equal(res.json.record_count, 5000);
});

test('rejects oversized files', async () => {
  // ~10.7 MB decoded. The route caps decoded size at 10 MB (400); bodies this
  // large can also be refused earlier by the JSON body-size limit (413) —
  // either way the import must be clearly rejected, never partially applied.
  const big = 'A'.repeat(Math.ceil(10.7 * 1024 * 1024 / 4) * 4); // valid base64 charset, multiple of 4
  const res = await api('POST', '/api/tables/import', {
    token: tokenA,
    body: { name: 'Huge', data: big, filename: 'huge.csv' },
  });
  assert.ok([400, 413].includes(res.status), `expected 400/413, got ${res.status}`);
  const list = await api('GET', '/api/tables', { token: tokenA });
  assert.ok(!list.json.some(t => t.name === 'Huge'));
});

test('rejects missing data and unparseable files', async () => {
  const noData = await api('POST', '/api/tables/import', {
    token: tokenA,
    body: { name: 'Nothing', filename: 'x.csv' },
  });
  assert.equal(noData.status, 400);

  const empty = await api('POST', '/api/tables/import', {
    token: tokenA,
    body: { name: 'Empty', data: '', filename: 'x.csv' },
  });
  assert.equal(empty.status, 400);

  // A file with nothing but blank lines has no header row to build fields from.
  const blank = await api('POST', '/api/tables/import', {
    token: tokenA,
    body: { name: 'Blank', data: csvBase64('\n\n\n'), filename: 'x.csv' },
  });
  assert.equal(blank.status, 400);
});

test('leading blank rows are skipped — first non-blank row becomes headers', async () => {
  const res = await api('POST', '/api/tables/import', {
    token: tokenA,
    body: { name: 'Skip Blank', data: csvBase64(',,\nsku,qty\nBRK-1,2\n'), filename: 'x.csv' },
  });
  assert.equal(res.status, 201);
  assert.deepEqual(res.json.fields.map(f => f.id), ['sku', 'qty']);
  assert.equal(res.json.record_count, 1);
});

// ─── Role gate & tenant isolation ─────────────────────────────────────────────

test('operators cannot import (supervisor+ write gate)', async () => {
  const res = await api('POST', '/api/tables/import', {
    token: operatorToken,
    body: { name: 'Sneaky', data: csvBase64('a\n1\n'), filename: 'sneaky.csv' },
  });
  assert.equal(res.status, 403);
});

test('unauthenticated import is rejected', async () => {
  const res = await api('POST', '/api/tables/import', {
    body: { name: 'Anon', data: csvBase64('a\n1\n'), filename: 'anon.csv' },
  });
  assert.equal(res.status, 401);
});

test('imported tables are tenant-scoped: company B cannot see or touch them', async () => {
  const view = await api('GET', `/api/tables/${importedTableId}`, { token: tokenB });
  assert.equal(view.status, 404);

  const recs = await api('GET', `/api/tables/${importedTableId}/records`, { token: tokenB });
  assert.equal(recs.status, 404);

  const list = await api('GET', '/api/tables', { token: tokenB });
  assert.equal(list.status, 200);
  assert.ok(!list.json.some(t => t.id === importedTableId), 'B must not list A\'s imported table');

  // B's own import lands in B's tenant only.
  const bImport = await api('POST', '/api/tables/import', {
    token: tokenB,
    body: { name: 'B Table', data: csvBase64('x\n1\n'), filename: 'b.csv' },
  });
  assert.equal(bImport.status, 201);
  const aList = await api('GET', '/api/tables', { token: tokenA });
  assert.ok(!aList.json.some(t => t.id === bImport.json.id), 'A must not list B\'s imported table');
});

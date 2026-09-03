// ─── BOM versioning + kit generation/picking tests ────────────────────────────
// Spawns the real server against a throwaway database and exercises the full
// BOM lifecycle (draft → lines → activate → new version → supersede), runtime
// BOM resolution, kit generation with snapshotted quantities/scan codes, the
// kit-line state machine with exactly-once stock consumption, work-order
// product-type integration, the BOM-derived MRP requirements pass, role gates,
// and cross-tenant isolation. Run with: npm test
//
// Uses only Node built-ins (node:test + global fetch) — no extra dependencies.

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const PORT = 3193; // unique per test file — 3195-3199 are taken by the other suites
const BASE = `http://localhost:${PORT}`;
const DB_PATH = path.join(os.tmpdir(), `mes-boms-kits-test-${Date.now()}.db`);

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

let tokenA;      // Widget Co (developer)
let tokenB;      // Gadget Co (developer)
let operatorToken; // Widget Co operator

// Widget Co fixtures
let appId, productTypeId, emptyProductTypeId;
let item1, item2;   // { id, sku }
let locationId;
let bomV1, bomV2;   // bom ids
let woId;           // work order with product type (quantity 5)
let kitId;

before(async () => {
  await startServer();

  const a = await api('POST', '/api/auth/signup', {
    body: { company_name: 'Widget Co', email: 'owner@widget-bk.test', password: 'supersecret1', display_name: 'Widget Owner' },
  });
  assert.equal(a.status, 201);
  tokenA = a.json.token;

  const b = await api('POST', '/api/auth/signup', {
    body: { company_name: 'Gadget Co', email: 'owner@gadget-bk.test', password: 'supersecret1', display_name: 'Gadget Owner' },
  });
  assert.equal(b.status, 201);
  tokenB = b.json.token;

  // Inventory endpoints are Pro-gated; upgrade company A so the tests can
  // create items/locations and read the movements ledger.
  const plan = await api('PUT', '/api/config/plan', { token: tokenA, body: { tier: 'pro' } });
  assert.equal(plan.status, 200);

  // A floor operator in company A (for role-gate checks and line picking).
  const created = await api('POST', '/api/users', {
    token: tokenA,
    body: { email: 'op@widget-bk.test', display_name: 'Kit Op', password: 'supersecret1', role: 'operator' },
  });
  assert.equal(created.status, 201);
  const login = await api('POST', '/api/auth/login', { body: { email: 'op@widget-bk.test', password: 'supersecret1' } });
  assert.equal(login.status, 200);
  operatorToken = login.json.token;

  // App + product types (BOMs hang off product types).
  const app = await api('POST', '/api/apps', { token: tokenA, body: { name: 'Assembly App' } });
  assert.equal(app.status, 201);
  appId = app.json.id;

  const pt = await api('POST', '/api/product-types', { token: tokenA, body: { app_id: appId, name: 'Model X' } });
  assert.equal(pt.status, 201);
  productTypeId = pt.json.id;

  const pt2 = await api('POST', '/api/product-types', { token: tokenA, body: { app_id: appId, name: 'Model Y (no BOM)' } });
  assert.equal(pt2.status, 201);
  emptyProductTypeId = pt2.json.id;

  // Items + a pick-from location with stock.
  const i1 = await api('POST', '/api/inventory/items', {
    token: tokenA, body: { sku: 'RES-100', name: 'Resistor 100R', unit_of_measure: 'ea' },
  });
  assert.equal(i1.status, 201);
  item1 = { id: i1.json.id, sku: 'RES-100' };

  const i2 = await api('POST', '/api/inventory/items', {
    token: tokenA, body: { sku: 'CAP-200', name: 'Capacitor 200uF', unit_of_measure: 'ea' },
  });
  assert.equal(i2.status, 201);
  item2 = { id: i2.json.id, sku: 'CAP-200' };

  const loc = await api('POST', '/api/inventory/locations', { token: tokenA, body: { name: 'Main Warehouse', code: 'WH1' } });
  assert.equal(loc.status, 201);
  locationId = loc.json.id;

  for (const item of [item1, item2]) {
    const recv = await api('POST', '/api/inventory/movements', {
      token: tokenA, body: { item_id: item.id, location_id: locationId, movement_type: 'receive', quantity: 100 },
    });
    assert.equal(recv.status, 201);
  }
});

after(() => {
  if (server) server.kill('SIGTERM');
  for (const ext of ['', '-shm', '-wal']) { try { fs.unlinkSync(DB_PATH + ext); } catch { /* ignore */ } }
});

// ─── BOM lifecycle ────────────────────────────────────────────────────────────

test('BOM endpoints require authentication', async () => {
  assert.equal((await api('GET', '/api/boms')).status, 401);
  assert.equal((await api('POST', '/api/kits/generate', { body: { work_order_id: 'x' } })).status, 401);
});

test('creating a BOM draft requires supervisor+; operators are rejected', async () => {
  const denied = await api('POST', '/api/boms', { token: operatorToken, body: { product_type_id: productTypeId } });
  assert.equal(denied.status, 403);
});

test('POST /api/boms creates a v1 draft for an owned product type', async () => {
  const missing = await api('POST', '/api/boms', { token: tokenA, body: {} });
  assert.equal(missing.status, 400);

  const created = await api('POST', '/api/boms', { token: tokenA, body: { product_type_id: productTypeId, notes: 'first pass' } });
  assert.equal(created.status, 201);
  assert.equal(created.json.version, 1);
  assert.equal(created.json.status, 'draft');
  assert.equal(created.json.notes, 'first pass');
  assert.equal(created.json.product_type_id, productTypeId);
  assert.deepEqual(created.json.lines, []);
  bomV1 = created.json.id;
});

test('a product type from another company is rejected', async () => {
  const foreign = await api('POST', '/api/boms', { token: tokenB, body: { product_type_id: productTypeId } });
  assert.equal(foreign.status, 404);
});

test('PUT /api/boms/:id replaces lines on a draft, joining item details', async () => {
  const put = await api('PUT', `/api/boms/${bomV1}`, {
    token: tokenA,
    body: {
      notes: 'ready',
      lines: [
        { item_id: item1.id, qty_per: 2, reference: 'R12, R14', step_id: 'step-1' },
        { item_id: item2.id, qty_per: 1, scan_code: 'CUSTOM-CODE', sort_order: 1 },
      ],
    },
  });
  assert.equal(put.status, 200);
  assert.equal(put.json.lines.length, 2);
  const l1 = put.json.lines.find(l => l.item_id === item1.id);
  assert.equal(l1.qty_per, 2);
  assert.equal(l1.item_sku, 'RES-100');
  assert.equal(l1.item_name, 'Resistor 100R');
  assert.equal(l1.reference, 'R12, R14');
  const l2 = put.json.lines.find(l => l.item_id === item2.id);
  assert.equal(l2.scan_code, 'CUSTOM-CODE');
  assert.equal(put.json.notes, 'ready');
});

test('BOM lines referencing another tenant\'s item are rejected before any write', async () => {
  const foreignItem = await api('POST', '/api/inventory/items', {
    token: tokenB, body: { sku: 'SPY-1', name: 'Foreign Part' },
  });
  // Company B is on the free tier — inventory is pro-gated, so create via plan upgrade.
  let foreignItemId;
  if (foreignItem.status === 201) {
    foreignItemId = foreignItem.json.id;
  } else {
    await api('PUT', '/api/config/plan', { token: tokenB, body: { tier: 'pro' } });
    const retry = await api('POST', '/api/inventory/items', { token: tokenB, body: { sku: 'SPY-1', name: 'Foreign Part' } });
    assert.equal(retry.status, 201);
    foreignItemId = retry.json.id;
  }

  const put = await api('PUT', `/api/boms/${bomV1}`, {
    token: tokenA,
    body: { lines: [{ item_id: foreignItemId, qty_per: 1 }] },
  });
  assert.equal(put.status, 400);

  // Original lines untouched.
  const fresh = await api('GET', `/api/boms/${bomV1}`, { token: tokenA });
  assert.equal(fresh.json.lines.length, 2);
});

test('activate flips draft to active; editing an active BOM is a 409', async () => {
  const act = await api('POST', `/api/boms/${bomV1}/activate`, { token: tokenA });
  assert.equal(act.status, 200);
  assert.equal(act.json.status, 'active');

  const put = await api('PUT', `/api/boms/${bomV1}`, { token: tokenA, body: { lines: [] } });
  assert.equal(put.status, 409);
  assert.equal(put.json.code, 'NOT_DRAFT');
});

test('new-version copies lines into a draft; activating it supersedes v1', async () => {
  const nv = await api('POST', `/api/boms/${bomV1}/new-version`, { token: tokenA });
  assert.equal(nv.status, 201);
  assert.equal(nv.json.version, 2);
  assert.equal(nv.json.status, 'draft');
  assert.equal(nv.json.lines.length, 2, 'lines copied from v1');
  bomV2 = nv.json.id;

  const act = await api('POST', `/api/boms/${bomV2}/activate`, { token: tokenA });
  assert.equal(act.status, 200);
  assert.equal(act.json.status, 'active');

  const v1 = await api('GET', `/api/boms/${bomV1}`, { token: tokenA });
  assert.equal(v1.json.status, 'superseded', 'previous active version is superseded');
});

test('DELETE is manager-gated and draft-only', async () => {
  const active = await api('DELETE', `/api/boms/${bomV2}`, { token: tokenA });
  assert.equal(active.status, 409, 'active BOM cannot be deleted');

  const draft = await api('POST', `/api/boms/${bomV2}/new-version`, { token: tokenA });
  assert.equal(draft.status, 201);
  assert.equal(draft.json.version, 3);

  const denied = await api('DELETE', `/api/boms/${draft.json.id}`, { token: operatorToken });
  assert.equal(denied.status, 403, 'operators cannot delete BOMs');

  const del = await api('DELETE', `/api/boms/${draft.json.id}`, { token: tokenA });
  assert.equal(del.status, 200);
  assert.equal((await api('GET', `/api/boms/${draft.json.id}`, { token: tokenA })).status, 404);
});

test('GET /api/boms lists headers with line counts, filterable by product type and app', async () => {
  const list = await api('GET', `/api/boms?product_type_id=${productTypeId}`, { token: tokenA });
  assert.equal(list.status, 200);
  assert.equal(list.json.length, 2, 'v1 + v2');
  for (const row of list.json) {
    assert.equal(row.line_count, 2);
    assert.equal(row.product_type_name, 'Model X');
  }
  const byApp = await api('GET', `/api/boms?app_id=${appId}`, { token: tokenA });
  assert.equal(byApp.json.length, 2);
});

test('cross-tenant BOM access is a 404', async () => {
  assert.equal((await api('GET', `/api/boms/${bomV2}`, { token: tokenB })).status, 404);
  assert.equal((await api('PUT', `/api/boms/${bomV2}`, { token: tokenB, body: { lines: [] } })).status, 404);
  assert.equal((await api('POST', `/api/boms/${bomV2}/activate`, { token: tokenB })).status, 404);
  assert.equal((await api('DELETE', `/api/boms/${bomV2}`, { token: tokenB })).status, 404);
});

// ─── Work order product type + BOM resolution ─────────────────────────────────

test('work orders accept a product_type_id that matches company and app', async () => {
  const wo = await api('POST', '/api/work-orders', {
    token: tokenA,
    body: { part_number: 'MX-1', part_name: 'Model X Unit', quantity: 5, app_id: appId, product_type_id: productTypeId },
  });
  assert.equal(wo.status, 201);
  assert.equal(wo.json.product_type_id, productTypeId);
  woId = wo.json.id;
});

test('a product type from another app or tenant is silently nulled (ownedOrNull pattern)', async () => {
  const otherApp = await api('POST', '/api/apps', { token: tokenA, body: { name: 'Other App' } });
  assert.equal(otherApp.status, 201);
  const mismatched = await api('POST', '/api/work-orders', {
    token: tokenA,
    body: { part_number: 'MM-1', part_name: 'Mismatch', quantity: 1, app_id: otherApp.json.id, product_type_id: productTypeId },
  });
  assert.equal(mismatched.status, 201);
  assert.equal(mismatched.json.product_type_id, null, 'PT belongs to a different app');

  const foreign = await api('POST', '/api/work-orders', {
    token: tokenB,
    body: { part_number: 'FF-1', part_name: 'Foreign', quantity: 1, product_type_id: productTypeId },
  });
  assert.equal(foreign.status, 201);
  assert.equal(foreign.json.product_type_id, null, 'cross-tenant PT never sticks');
});

test('GET /api/boms/resolve joins WO → product type → active BOM', async () => {
  const resolved = await api('GET', `/api/boms/resolve?work_order_id=${woId}`, { token: tokenA });
  assert.equal(resolved.status, 200);
  assert.equal(resolved.json.id, bomV2, 'resolves the active version');
  assert.equal(resolved.json.lines.length, 2);

  // Cross-tenant WO → 404
  assert.equal((await api('GET', `/api/boms/resolve?work_order_id=${woId}`, { token: tokenB })).status, 404);
});

// Having no bill of materials is the NORMAL case — a routed job carries its app
// on the operation and no product type at all — and the player asks this route
// on every start. Answering 404 there printed a red failure in the console of a
// perfectly ordinary job and fired the caller's error path, so the empty answer
// is a 200 that says it is empty. The two real errors stay 404.
test('a job with no bill of materials resolves 200-and-empty, not 404', async () => {
  const bare = await api('POST', '/api/work-orders', {
    token: tokenA, body: { part_number: 'B-1', part_name: 'Bare', quantity: 1, app_id: appId },
  });
  const noType = await api('GET', `/api/boms/resolve?work_order_id=${bare.json.id}`, { token: tokenA });
  assert.equal(noType.status, 200, 'no product type is not an error');
  assert.equal(noType.json.id, null, 'nothing to render');
  assert.deepEqual(noType.json.lines, []);
  assert.match(noType.json.reason, /no product type/i, 'the emptiness says why');

  // A product type nobody has activated a BOM for: same answer, its own reason.
  const typed = await api('POST', '/api/work-orders', {
    token: tokenA,
    body: { part_number: 'B-2', part_name: 'Model Y unit', quantity: 1, app_id: appId, product_type_id: emptyProductTypeId },
  });
  assert.equal(typed.json.product_type_id, emptyProductTypeId);
  const noActive = await api('GET', `/api/boms/resolve?work_order_id=${typed.json.id}`, { token: tokenA });
  assert.equal(noActive.status, 200, 'no active version is not an error either');
  assert.equal(noActive.json.id, null);
  assert.match(noActive.json.reason, /activated/i);

  // The genuine errors are still errors, and still indistinguishable from each
  // other: a work order that does not exist, and one this company cannot see.
  assert.equal((await api('GET', '/api/boms/resolve?work_order_id=no-such-wo', { token: tokenA })).status, 404);
  assert.equal((await api('GET', `/api/boms/resolve?work_order_id=${woId}`, { token: tokenB })).status, 404);
});

// ─── Kit generation ───────────────────────────────────────────────────────────

test('kit generation snapshots quantities, SKUs and scan codes from the active BOM', async () => {
  const denied = await api('POST', '/api/kits/generate', { token: operatorToken, body: { work_order_id: woId } });
  assert.equal(denied.status, 403, 'kit generation is supervisor+');

  const gen = await api('POST', '/api/kits/generate', { token: tokenA, body: { work_order_id: woId, location_id: locationId } });
  assert.equal(gen.status, 201);
  kitId = gen.json.id;
  assert.equal(gen.json.status, 'open');
  assert.equal(gen.json.bom_id, bomV2);
  assert.equal(gen.json.bom_version, 2);
  assert.equal(gen.json.location_id, locationId);
  assert.equal(gen.json.lines.length, 2);

  const l1 = gen.json.lines.find(l => l.item_id === item1.id);
  assert.equal(l1.qty_required, 10, 'wo.quantity(5) × qty_per(2)');
  assert.equal(l1.sku, 'RES-100');
  assert.equal(l1.scan_code, 'RES-100', 'falls back to the item SKU');
  assert.equal(l1.item_name, 'Resistor 100R');
  assert.equal(l1.status, 'pending');

  const l2 = gen.json.lines.find(l => l.item_id === item2.id);
  assert.equal(l2.qty_required, 5, 'wo.quantity(5) × qty_per(1)');
  assert.equal(l2.scan_code, 'CUSTOM-CODE', 'bom_line scan override wins');
});

test('one kit per work order: a second generate is a 409 KIT_EXISTS', async () => {
  const again = await api('POST', '/api/kits/generate', { token: tokenA, body: { work_order_id: woId } });
  assert.equal(again.status, 409);
  assert.equal(again.json.code, 'KIT_EXISTS');
});

test('generate errors: NO_PRODUCT_TYPE and NO_ACTIVE_BOM', async () => {
  const bare = await api('POST', '/api/work-orders', {
    token: tokenA, body: { part_number: 'NPT-1', part_name: 'No PT', quantity: 2, app_id: appId },
  });
  const noPt = await api('POST', '/api/kits/generate', { token: tokenA, body: { work_order_id: bare.json.id } });
  assert.equal(noPt.status, 422);
  assert.equal(noPt.json.code, 'NO_PRODUCT_TYPE');

  const woNoBom = await api('POST', '/api/work-orders', {
    token: tokenA, body: { part_number: 'NB-1', part_name: 'No BOM', quantity: 2, app_id: appId, product_type_id: emptyProductTypeId },
  });
  const noBom = await api('POST', '/api/kits/generate', { token: tokenA, body: { work_order_id: woNoBom.json.id } });
  assert.equal(noBom.status, 422);
  assert.equal(noBom.json.code, 'NO_ACTIVE_BOM');

  const foreign = await api('POST', '/api/kits/generate', { token: tokenB, body: { work_order_id: woId } });
  assert.equal(foreign.status, 404, 'cross-tenant WO is invisible');
});

test('GET /api/work-orders/:id surfaces product_type_name, kit_id and kit_status', async () => {
  const wo = await api('GET', `/api/work-orders/${woId}`, { token: tokenA });
  assert.equal(wo.status, 200);
  assert.equal(wo.json.product_type_name, 'Model X');
  assert.equal(wo.json.kit_id, kitId);
  assert.equal(wo.json.kit_status, 'open');
});

// ─── Kit line state machine + exactly-once consumption ────────────────────────

async function movementsFor(itemId) {
  const { json } = await api('GET', `/api/inventory/movements?item_id=${itemId}&movement_type=consume`, { token: tokenA });
  return json.filter(m => m.reference_type === 'kit' && m.reference_id === kitId);
}

test('picking a line writes exactly one consume movement and decrements stock', async () => {
  const kit = (await api('GET', `/api/kits/${kitId}`, { token: tokenA })).json;
  const line1 = kit.lines.find(l => l.item_id === item1.id);

  const pick = await api('PUT', `/api/kits/${kitId}/lines/${line1.id}`, {
    token: operatorToken, body: { status: 'picked' },
  });
  assert.equal(pick.status, 200, 'operators can pick lines');
  const picked = pick.json.line;
  assert.equal(picked.status, 'picked');
  assert.equal(picked.qty_picked, 10, 'defaults to full qty_required');
  assert.ok(picked.picked_at, 'picked_at stamped');
  assert.equal(pick.json.status, 'picking', 'kit rolls up to picking');

  const consumes = await movementsFor(item1.id);
  assert.equal(consumes.length, 1, 'one consume movement in the ledger');
  assert.equal(consumes[0].quantity, -10);
  assert.equal(consumes[0].movement_type, 'consume');

  const stock = await api('GET', `/api/inventory/items/${item1.id}`, { token: tokenA });
  assert.equal(stock.json.total_quantity, 90, '100 received - 10 consumed');
});

test('verifying an already-picked line writes NO second movement (exactly-once)', async () => {
  const kit = (await api('GET', `/api/kits/${kitId}`, { token: tokenA })).json;
  const line1 = kit.lines.find(l => l.item_id === item1.id);

  const verify = await api('PUT', `/api/kits/${kitId}/lines/${line1.id}`, {
    token: operatorToken, body: { status: 'verified' },
  });
  assert.equal(verify.status, 200);
  assert.equal(verify.json.line.status, 'verified');
  assert.ok(verify.json.line.verified_at);

  const consumes = await movementsFor(item1.id);
  assert.equal(consumes.length, 1, 'still exactly one consume movement');
  const stock = await api('GET', `/api/inventory/items/${item1.id}`, { token: tokenA });
  assert.equal(stock.json.total_quantity, 90, 'stock not decremented twice');
});

test('a direct pending→verified transition consumes once too', async () => {
  const kit = (await api('GET', `/api/kits/${kitId}`, { token: tokenA })).json;
  const line2 = kit.lines.find(l => l.item_id === item2.id);

  const verify = await api('PUT', `/api/kits/${kitId}/lines/${line2.id}`, {
    token: operatorToken, body: { status: 'verified', qty_picked: 5 },
  });
  assert.equal(verify.status, 200);
  assert.equal(verify.json.status, 'complete', 'all lines verified → kit complete');

  const consumes = await movementsFor(item2.id);
  assert.equal(consumes.length, 1);
  assert.equal(consumes[0].quantity, -5);
});

test('illegal transitions are 409s and bad statuses 400s', async () => {
  const kit = (await api('GET', `/api/kits/${kitId}`, { token: tokenA })).json;
  const line1 = kit.lines.find(l => l.item_id === item1.id);

  const back = await api('PUT', `/api/kits/${kitId}/lines/${line1.id}`, {
    token: tokenA, body: { status: 'picked' },
  });
  assert.equal(back.status, 409, 'verified → picked is illegal');
  assert.equal(back.json.code, 'ILLEGAL_TRANSITION');

  const bad = await api('PUT', `/api/kits/${kitId}/lines/${line1.id}`, {
    token: tokenA, body: { status: 'exploded' },
  });
  assert.equal(bad.status, 400);
});

test('POST /:id/verify stamps the kit once every line is picked/verified', async () => {
  const ok = await api('POST', `/api/kits/${kitId}/verify`, { token: operatorToken });
  assert.equal(ok.status, 200);
  assert.equal(ok.json.status, 'complete');
  assert.equal(ok.json.verified_by, 'Kit Op');
  assert.ok(ok.json.verified_at);
});

// ─── Shortage path ────────────────────────────────────────────────────────────

let shortKitId, shortWoId;

test('short lines flag the kit and can recover via short→picked', async () => {
  const wo = await api('POST', '/api/work-orders', {
    token: tokenA, body: { part_number: 'MX-2', part_name: 'Model X Unit', quantity: 2, app_id: appId, product_type_id: productTypeId },
  });
  shortWoId = wo.json.id;
  const gen = await api('POST', '/api/kits/generate', { token: tokenA, body: { work_order_id: shortWoId, location_id: locationId } });
  assert.equal(gen.status, 201);
  shortKitId = gen.json.id;

  const line = gen.json.lines.find(l => l.item_id === item1.id);
  const short = await api('PUT', `/api/kits/${shortKitId}/lines/${line.id}`, {
    token: tokenA, body: { status: 'short', short_reason: 'bin empty' },
  });
  assert.equal(short.status, 200);
  assert.equal(short.json.line.status, 'short');
  assert.equal(short.json.line.short_reason, 'bin empty');
  assert.equal(short.json.status, 'short', 'kit rolls up short');

  // No consumption happened for a short line.
  const consumes = (await api('GET', `/api/inventory/movements?item_id=${item1.id}&movement_type=consume`, { token: tokenA }))
    .json.filter(m => m.reference_type === 'kit' && m.reference_id === shortKitId);
  assert.equal(consumes.length, 0);

  const list = await api('GET', `/api/kits?work_order_id=${shortWoId}`, { token: tokenA });
  assert.equal(list.status, 200);
  assert.equal(list.json.length, 1);
  assert.equal(list.json[0].has_short, true);
  assert.equal(list.json[0].n_total, 2);

  const verifyBlocked = await api('POST', `/api/kits/${shortKitId}/verify`, { token: tokenA });
  assert.equal(verifyBlocked.status, 409);
  assert.equal(verifyBlocked.json.code, 'KIT_INCOMPLETE');
  assert.equal(verifyBlocked.json.offending_lines.length, 2, 'the short line and the pending line');

  // Recovery: material arrived — short → picked consumes (first time), exactly once.
  const repick = await api('PUT', `/api/kits/${shortKitId}/lines/${line.id}`, {
    token: tokenA, body: { status: 'picked', qty_picked: 4 },
  });
  assert.equal(repick.status, 200);
  assert.equal(repick.json.line.status, 'picked');
  const consumed = (await api('GET', `/api/inventory/movements?item_id=${item1.id}&movement_type=consume`, { token: tokenA }))
    .json.filter(m => m.reference_type === 'kit' && m.reference_id === shortKitId);
  assert.equal(consumed.length, 1);
  assert.equal(consumed[0].quantity, -4);
});

test('cross-tenant kit access is a 404 everywhere', async () => {
  assert.equal((await api('GET', `/api/kits/${kitId}`, { token: tokenB })).status, 404);
  const kit = (await api('GET', `/api/kits/${shortKitId}`, { token: tokenA })).json;
  const anyLine = kit.lines[0];
  assert.equal((await api('PUT', `/api/kits/${shortKitId}/lines/${anyLine.id}`, { token: tokenB, body: { status: 'picked' } })).status, 404);
  assert.equal((await api('POST', `/api/kits/${shortKitId}/verify`, { token: tokenB })).status, 404);
  assert.equal((await api('DELETE', `/api/kits/${shortKitId}`, { token: tokenB })).status, 404);

  const listB = await api('GET', '/api/kits', { token: tokenB });
  assert.equal(listB.status, 200);
  assert.equal(listB.json.length, 0, 'company B sees no kits');
});

test('DELETE cancels only an open kit with zero picks; regenerate then succeeds', async () => {
  const inProgress = await api('DELETE', `/api/kits/${shortKitId}`, { token: tokenA });
  assert.equal(inProgress.status, 409, 'kit with picks cannot be cancelled');

  const wo = await api('POST', '/api/work-orders', {
    token: tokenA, body: { part_number: 'MX-3', part_name: 'Model X Unit', quantity: 1, app_id: appId, product_type_id: productTypeId },
  });
  const gen = await api('POST', '/api/kits/generate', { token: tokenA, body: { work_order_id: wo.json.id } });
  assert.equal(gen.status, 201);

  const cancel = await api('DELETE', `/api/kits/${gen.json.id}`, { token: tokenA });
  assert.equal(cancel.status, 200);
  assert.equal(cancel.json.status, 'cancelled');

  // Regenerate replaces the cancelled kit under the one-kit-per-WO constraint.
  const regen = await api('POST', '/api/kits/generate', { token: tokenA, body: { work_order_id: wo.json.id } });
  assert.equal(regen.status, 201);
  assert.notEqual(regen.json.id, gen.json.id);
  const old = await api('GET', `/api/kits/${gen.json.id}`, { token: tokenA });
  assert.equal(old.status, 404, 'the cancelled kit row was replaced');
});

// ─── MRP requirements: BOM-derived exact pass ─────────────────────────────────

test('requirements uses exact BOM keying for product-typed WOs and parts_list for the rest', async () => {
  // Give the app a legacy parts_list that would double-count if the BOM pass
  // didn't win for product-typed WOs.
  const app = (await api('GET', `/api/apps/${appId}`, { token: tokenA })).json;
  const steps = app.steps.map(s => ({ ...s, parts_list: [{ name: 'Widget Glue', sku: 'GLUE-1', quantity: 3, unit: 'ea' }] }));
  const saved = await api('PUT', `/api/apps/${appId}`, { token: tokenA, body: { steps } });
  assert.equal(saved.status, 200);

  const reqs = await api('GET', '/api/inventory/requirements', { token: tokenA });
  assert.equal(reqs.status, 200);

  const res100 = reqs.json.items.find(i => i.sku === 'RES-100');
  assert.ok(res100, 'BOM-derived row present');
  assert.equal(res100.source, 'bom');
  assert.equal(res100.item_id, item1.id, 'exact item keying — no string matching');
  // Open product-typed WOs: woId (qty 5), shortWoId (qty 2), MX-3 (qty 1) → (5+2+1) × qty_per 2 = 16
  assert.equal(res100.required_qty, 16);

  const glue = reqs.json.items.find(i => i.sku === 'GLUE-1');
  assert.ok(glue, 'parts_list pass still runs for WOs without an active BOM');
  assert.equal(glue.source, 'parts_list');
  // WOs that resolved an active BOM must NOT contribute parts_list rows
  // (BOM-derived rows win per WO) — check none of the Model X WOs appear.
  const allWos = (await api('GET', '/api/work-orders', { token: tokenA })).json;
  const bomWoNumbers = allWos.filter(w => w.product_type_id === productTypeId).map(w => w.work_order_number);
  assert.ok(bomWoNumbers.length >= 3, 'sanity: the Model X WOs exist');
  for (const w of glue.work_orders) {
    assert.ok(!bomWoNumbers.includes(w.wo_number), `BOM-resolved WO ${w.wo_number} must not contribute parts_list rows`);
  }
});

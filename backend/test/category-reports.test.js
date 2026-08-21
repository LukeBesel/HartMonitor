'use strict';
// ─── Per-category Reports dashboards tests ────────────────────────────────────
// Verifies GET /api/dashboards/category/:category — auto-creation on first
// access, sensible per-category default cards, idempotency, tenant isolation,
// and validation of the category segment. Spins up the real server against a
// throwaway database.
//
// Uses Node built-ins only (node:test + global fetch). Run with: npm test

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const PORT = 3188;
const BASE = `http://localhost:${PORT}`;
const DB_PATH = path.join(os.tmpdir(), `mes-category-reports-${Date.now()}.db`);

const CATEGORIES = ['production', 'inventory', 'quality', 'kaizen', 'maintenance', 'people'];
const SUPPORTED_CARD_TYPES = ['metric', 'time_series', 'distribution', 'leaderboard', 'wo_status', 'table'];

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

before(async () => { await startServer(); });
after(() => {
  if (server) server.kill('SIGTERM');
  for (const ext of ['', '-shm', '-wal']) {
    try { fs.unlinkSync(DB_PATH + ext); } catch { /* ignore */ }
  }
});

describe('Per-category Reports dashboards', () => {
  let tokenA, tokenB;

  before(async () => {
    const a = await api('POST', '/api/auth/signup', {
      body: { company_name: 'Reports Co A', email: 'admin@reports-a.test', password: 'SecretPass1', display_name: 'Admin A' },
    });
    assert.equal(a.status, 201, 'Company A signup failed');
    tokenA = a.json.token;

    const b = await api('POST', '/api/auth/signup', {
      body: { company_name: 'Reports Co B', email: 'admin@reports-b.test', password: 'SecretPass2', display_name: 'Admin B' },
    });
    assert.equal(b.status, 201, 'Company B signup failed');
    tokenB = b.json.token;
  });

  it('auto-creates the category dashboard once and stays idempotent', async () => {
    const first = await api('GET', '/api/dashboards/category/production', { token: tokenA });
    assert.equal(first.status, 200);
    assert.ok(first.json.id, 'created dashboard must have an id');
    assert.equal(first.json.category, 'production');
    assert.equal(first.json.name, 'Production Reports');
    assert.ok(Array.isArray(first.json.cards) && first.json.cards.length > 0, 'must be seeded with default cards');

    const second = await api('GET', '/api/dashboards/category/production', { token: tokenA });
    assert.equal(second.status, 200);
    assert.equal(second.json.id, first.json.id, 'second call must return the same dashboard, not a new one');
    assert.deepEqual(
      second.json.cards.map(c => c.id).sort(),
      first.json.cards.map(c => c.id).sort(),
      'second call must return the same cards'
    );

    // Still exactly one production report dashboard for the company.
    const all = await api('GET', '/api/dashboards', { token: tokenA });
    assert.equal(all.status, 200);
    const productionReports = all.json.filter(d => d.category === 'production');
    assert.equal(productionReports.length, 1, 'company must have exactly one production reports dashboard');
  });

  it('seeds sensible defaults per category, using only supported card types', async () => {
    const byCategory = {};
    for (const cat of CATEGORIES) {
      const r = await api('GET', `/api/dashboards/category/${cat}`, { token: tokenA });
      assert.equal(r.status, 200, `category ${cat} should resolve`);
      assert.equal(r.json.category, cat);
      assert.ok(r.json.cards.length > 0, `category ${cat} must have default cards`);
      for (const card of r.json.cards) {
        assert.ok(SUPPORTED_CARD_TYPES.includes(card.type), `card type "${card.type}" (${cat}) must be a supported engine type`);
        assert.ok(card.id && card.title, `every seeded card needs id + title (${cat})`);
      }
      byCategory[cat] = r.json.cards;
    }

    const has = (cat, pred) => byCategory[cat].some(pred);
    // Production → throughput + cycle time + station status
    assert.ok(has('production', c => c.type === 'time_series' && c.series === 'throughput'), 'production: throughput trend');
    assert.ok(has('production', c => c.type === 'time_series' && c.series === 'cycle_time'), 'production: cycle time trend');
    assert.ok(has('production', c => c.type === 'distribution' && c.group_by === 'station_status'), 'production: station status');
    // Quality → NCR trend + pass rate
    assert.ok(has('quality', c => c.type === 'time_series' && c.series === 'ncr_trend'), 'quality: NCR trend');
    assert.ok(has('quality', c => c.type === 'metric' && c.metric_key === 'pass_rate'), 'quality: pass rate');
    // Inventory → low stock + recent movements
    assert.ok(has('inventory', c => c.type === 'metric' && c.metric_key === 'low_stock_items'), 'inventory: low stock');
    assert.ok(has('inventory', c => c.type === 'time_series' && c.series === 'stock_movements'), 'inventory: recent movements');
    // Maintenance → open WOs + PM due
    assert.ok(has('maintenance', c => c.type === 'metric' && c.metric_key === 'open_maintenance_wos'), 'maintenance: open WOs');
    assert.ok(has('maintenance', c => c.type === 'metric' && c.metric_key === 'pm_due'), 'maintenance: PM due');
    // Kaizen → ideas by status
    assert.ok(has('kaizen', c => c.type === 'distribution' && c.group_by === 'kaizen_status'), 'kaizen: ideas by status');
    // People → training coverage
    assert.ok(has('people', c => c.type === 'metric' && c.metric_key === 'training_coverage'), 'people: training coverage');
  });

  it('every seeded card computes data without errors', async () => {
    for (const cat of CATEGORIES) {
      const d = await api('GET', `/api/dashboards/category/${cat}`, { token: tokenA });
      assert.equal(d.status, 200);
      const data = await api('GET', `/api/dashboards/${d.json.id}/data`, { token: tokenA });
      assert.equal(data.status, 200, `data endpoint should work for ${cat}`);
      assert.equal(data.json.cards.length, d.json.cards.length);
      for (const card of data.json.cards) {
        assert.ok(!card.error, `card ${card.card_id} (${cat}) errored: ${card.error}`);
        assert.ok(card.data !== null && card.data !== undefined, `card ${card.card_id} (${cat}) returned no data`);
      }
    }
  });

  it('category dashboards behave like custom dashboards for edits (persisted cards)', async () => {
    const d = await api('GET', '/api/dashboards/category/kaizen', { token: tokenA });
    assert.equal(d.status, 200);
    const newCards = [...d.json.cards, { id: 'added-card-1', type: 'metric', title: 'Total Completions', metric_key: 'total_completions', size: 'sm' }];
    const upd = await api('PUT', `/api/dashboards/${d.json.id}`, { token: tokenA, body: { cards: newCards } });
    assert.equal(upd.status, 200);

    const again = await api('GET', '/api/dashboards/category/kaizen', { token: tokenA });
    assert.equal(again.status, 200);
    assert.equal(again.json.id, d.json.id);
    assert.ok(again.json.cards.some(c => c.id === 'added-card-1'), 'edited cards must persist on the category dashboard');
  });

  it('is tenant-isolated: each company gets its own category dashboard', async () => {
    const a = await api('GET', '/api/dashboards/category/production', { token: tokenA });
    const b = await api('GET', '/api/dashboards/category/production', { token: tokenB });
    assert.equal(a.status, 200);
    assert.equal(b.status, 200);
    assert.notEqual(a.json.id, b.json.id, 'companies must not share a category dashboard');

    // Cross-tenant direct fetch of the other company's report dashboard fails.
    const leak = await api('GET', `/api/dashboards/${a.json.id}`, { token: tokenB });
    assert.equal(leak.status, 404, 'company B must not read company A report dashboard');

    // Company B's edits do not appear on company A's dashboard.
    const bCards = b.json.cards.filter((_, i) => i > 0); // remove first card
    const upd = await api('PUT', `/api/dashboards/${b.json.id}`, { token: tokenB, body: { cards: bCards } });
    assert.equal(upd.status, 200);
    const aAgain = await api('GET', '/api/dashboards/category/production', { token: tokenA });
    assert.equal(aAgain.json.cards.length, a.json.cards.length, 'company B edits must not affect company A');
  });

  it('rejects invalid categories with 400', async () => {
    // Note: '..' is excluded — URL resolution collapses it client-side before
    // the request reaches the route.
    for (const bad of ['finance', 'PRODUCTION', 'people2', 'production%20', 'null']) {
      const r = await api('GET', `/api/dashboards/category/${encodeURIComponent(bad)}`, { token: tokenA });
      assert.equal(r.status, 400, `category "${bad}" should be rejected`);
      assert.ok(r.json.error, 'error body expected');
    }
  });

  it('requires authentication', async () => {
    const r = await api('GET', '/api/dashboards/category/production', {});
    assert.equal(r.status, 401);
  });
});

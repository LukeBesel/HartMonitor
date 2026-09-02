// ─── Sandbox full-coverage demo seed tests ────────────────────────────────────
// Spawns the real server against a throwaway database, creates a demo sandbox
// via POST /api/auth/demo, and asserts the seed showcases every module with
// coherent, interlinked data:
//   • an ACTIVE versioned BOM per product type,
//   • a kit for WO-1001 with a real shortage (one short line + short_reason),
//   • the daily brief's attention list contains station_down, stock_low,
//     ncr_critical and po_late,
//   • app analytics data sources are populated (step metrics totals + structured
//     completion_values fields),
//   • after deleteSandboxOrg (called directly, in-process against the same DB)
//     a sweep across EVERY seeded table finds zero rows for the sandbox org.
// Run with: npm test — uses only Node built-ins (node:test + global fetch).

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const PORT = 3185; // unique per test file
const BASE = `http://localhost:${PORT}`;
const DB_PATH = path.join(os.tmpdir(), `mes-sandbox-seed-test-${Date.now()}.db`);

// The delete-function test requires src/sandbox (and its db) in THIS process,
// against the same database file the server child process uses (WAL mode makes
// multi-process access safe). config.js reads env at require time.
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

let token;
let userId;
let orgId;
let db; // in-process handle to the same database file

before(async () => {
  await startServer();

  const demo = await api('POST', '/api/auth/demo');
  assert.equal(demo.status, 201, `demo login: ${JSON.stringify(demo.json)}`);
  assert.ok(demo.json.token, 'demo returns a session token');
  token = demo.json.token;
  userId = demo.json.user.id;

  db = require('../src/db');
  orgId = db.prepare('SELECT company_id FROM users WHERE id = ?').get(userId).company_id;
  assert.ok(orgId, 'demo visitor belongs to a sandbox org');
  assert.equal(db.prepare('SELECT is_sandbox FROM organizations WHERE id = ?').get(orgId).is_sandbox, 1);
});

after(() => {
  if (server) server.kill('SIGTERM');
  for (const ext of ['', '-shm', '-wal']) { try { fs.unlinkSync(DB_PATH + ext); } catch { /* ignore */ } }
});

// ─── BOMs: an active versioned BOM per product type ───────────────────────────

test('every product type has exactly one ACTIVE BOM, with real lines', async () => {
  const pts = await api('GET', '/api/product-types', { token });
  assert.equal(pts.status, 200);
  assert.ok(pts.json.length >= 2, 'two product types seeded');

  const boms = await api('GET', '/api/boms', { token });
  assert.equal(boms.status, 200);

  for (const pt of pts.json) {
    const actives = boms.json.filter(b => b.product_type_id === pt.id && b.status === 'active');
    assert.equal(actives.length, 1, `${pt.name} has exactly one active BOM`);
    assert.ok(actives[0].line_count >= 4, `${pt.name} active BOM has at least 4 lines`);
  }

  // BRKT-100 showcases versioning: v1 superseded, v2 active.
  const std = pts.json.find(p => p.name.includes('BRKT-100'));
  const stdBoms = boms.json.filter(b => b.product_type_id === std.id);
  assert.deepEqual(
    stdBoms.map(b => [b.version, b.status]).sort((a, b) => a[0] - b[0]),
    [[1, 'superseded'], [2, 'active']],
    'BRKT-100 carries a superseded v1 and an active v2'
  );

  // Line detail: qty_per, units and scan codes resolve.
  const active = stdBoms.find(b => b.status === 'active');
  const detail = await api('GET', `/api/boms/${active.id}`, { token });
  assert.equal(detail.status, 200);
  assert.equal(detail.json.lines.length, 4);
  for (const line of detail.json.lines) {
    assert.ok(line.qty_per > 0, 'qty_per set');
    assert.ok(line.unit, 'unit set');
    assert.ok(line.item_name, 'item join resolves');
  }
  const boltLine = detail.json.lines.find(l => l.item_name === 'M6 Bolt Kit');
  assert.ok(boltLine.scan_code, 'bolt kit line carries a scan code override');
});

// ─── Kitting: the WO-1001 kit shows a real shortage ───────────────────────────

test('the WO-1001 kit is short exactly one line, with a short_reason', async () => {
  const kits = await api('GET', '/api/kits', { token });
  assert.equal(kits.status, 200);
  const kit = kits.json.find(k => k.work_order_number.endsWith('WO-1001'));
  assert.ok(kit, 'a kit exists for WO-1001');
  assert.equal(kit.status, 'short');
  assert.equal(kit.has_short, true);
  assert.equal(kit.n_short, 1, 'exactly one short line');
  assert.equal(kit.n_total, 4);
  assert.ok(kit.n_verified >= 2, 'most lines verified');

  const detail = await api('GET', `/api/kits/${kit.id}`, { token });
  assert.equal(detail.status, 200);
  const short = detail.json.lines.find(l => l.status === 'short');
  assert.ok(short, 'short line present');
  assert.ok(short.short_reason.length > 0, 'shortage carries a reason');
  assert.ok(short.qty_picked < short.qty_required, 'short line is genuinely under-picked');

  const legal = ['pending', 'picked', 'verified', 'short'];
  for (const l of detail.json.lines) {
    assert.ok(legal.includes(l.status), `legal line status: ${l.status}`);
    if (l.status === 'verified') assert.ok(l.verified_at && l.verified_by, 'verified lines are stamped');
    if (l.status === 'picked' || l.status === 'verified') assert.ok(l.picked_at, 'picked lines are stamped');
  }
});

// ─── Daily brief: attention items across modules ──────────────────────────────

test('the daily brief flags station_down, stock_low, ncr_critical and po_late', async () => {
  const brief = await api('GET', '/api/analytics/daily-brief', { token });
  assert.equal(brief.status, 200);
  const types = new Set(brief.json.attention.map(a => a.type));
  for (const expected of ['station_down', 'stock_low', 'ncr_critical', 'po_late']) {
    assert.ok(types.has(expected), `attention contains ${expected} (got: ${[...types].join(', ')})`);
  }

  const down = brief.json.attention.find(a => a.type === 'station_down');
  assert.ok(down.label.includes('Station 2'), 'the down station is Station 2');
  const low = brief.json.attention.find(a => a.type === 'stock_low');
  assert.ok(low.label.includes('M6 Bolt Kit'), 'the low-stock item is the bolt kit');
});

// ─── App analytics: populated totals + structured per-widget fields ───────────

test('app analytics opens populated: step-metric totals and completion_values fields', async () => {
  const apps = await api('GET', '/api/apps', { token });
  assert.equal(apps.status, 200);
  const app = apps.json.find(a => a.name === 'Bracket Assembly');
  assert.ok(app, 'sample app seeded');

  const metrics = await api('GET', `/api/analytics/step-metrics/${app.id}`, { token });
  assert.equal(metrics.status, 200);
  assert.ok(metrics.json.total_completions >= 8, 'total completions populated');
  assert.equal(metrics.json.steps.length, 3);
  for (const step of metrics.json.steps) {
    assert.ok(step.completions >= 8, `step "${step.name}" has timing data`);
    assert.ok(step.avg_seconds > 0, `step "${step.name}" avg populated`);
  }
  assert.ok(metrics.json.steps[1].over_takt_count >= 1, 'one run exceeded the Assembly takt');

  const perf = await api('GET', '/api/analytics/app-performance', { token });
  assert.equal(perf.status, 200);
  const row = perf.json.find(r => r.app_id === app.id);
  assert.ok(row && row.completions >= 8, 'app-performance totals populated');
  assert.ok(row.avg_cycle_minutes > 0, 'cycle time totals populated');

  // Structured capture: every completed run wrote per-widget values with the
  // sample app's REAL step/widget ids and variable names.
  const completions = await api('GET', '/api/completions?status=completed', { token });
  assert.equal(completions.status, 200);
  assert.ok(completions.json.length >= 8, 'eight completed runs seeded');
  const stepIds = new Set(app.steps.map(s => s.id));
  const widgetIds = new Set(app.steps.flatMap(s => s.widgets.map(w => w.id)));

  const values = await api('GET', `/api/completions/${completions.json[0].id}/values`, { token });
  assert.equal(values.status, 200);
  assert.ok(values.json.length >= 5, 'per-widget values captured');
  const vars = new Set(values.json.map(v => v.variable_name));
  for (const expected of ['ppe_worn', 'torque_value', 'serial_number', 'visual_ok']) {
    assert.ok(vars.has(expected), `captured field ${expected}`);
  }
  for (const v of values.json) {
    assert.ok(stepIds.has(v.step_id), 'value points at a real step id');
    assert.ok(widgetIds.has(v.widget_id), 'value points at a real widget id');
  }
  const torque = values.json.find(v => v.variable_name === 'torque_value');
  assert.equal(torque.value_type, 'number');
  assert.ok(Number.isFinite(torque.value_number));
});

// ─── Coherence spot-checks across the remaining modules ───────────────────────

test('quality, maintenance, andon, training, purchasing and kaizen are coherent', async () => {
  // NCRs: one open critical, one resolved.
  const ncrs = await api('GET', '/api/quality/ncrs', { token });
  assert.equal(ncrs.status, 200);
  assert.ok(ncrs.json.some(n => n.severity === 'critical' && n.status === 'open'), 'open critical NCR');
  assert.ok(ncrs.json.some(n => n.status === 'resolved' && n.resolved_at), 'resolved NCR');
  const critical = ncrs.json.find(n => n.severity === 'critical');
  assert.ok(critical.completion_id, 'critical NCR links back to the failed completion');

  // CAPA: one actively in work ('action' is this app's in-progress state) with
  // at least one action row underway.
  const capas = await api('GET', '/api/capa', { token });
  assert.equal(capas.status, 200);
  const inWork = capas.json.find(c => c.status === 'action');
  assert.ok(inWork, 'CAPA in the action (in-progress) state seeded');
  const capaDetail = await api('GET', `/api/capa/${inWork.id}`, { token });
  assert.ok(capaDetail.json.actions.length >= 1, 'CAPA has action rows');
  assert.ok(capaDetail.json.actions.some(a => a.status === 'in_progress'), 'an action is underway');

  // Maintenance: 2 assets, a PM due within days, an open MWO on the conveyor.
  assert.equal(db.prepare('SELECT COUNT(*) AS c FROM assets WHERE company_id = ?').get(orgId).c, 2);
  const dueSoon = db.prepare(`SELECT COUNT(*) AS c FROM pm_schedules WHERE company_id = ? AND next_due_at <= datetime('now', '+7 days')`).get(orgId).c;
  assert.ok(dueSoon >= 1, 'a PM schedule is due within days');
  const mwo = db.prepare(`SELECT * FROM maintenance_work_orders WHERE company_id = ? AND status = 'open'`).get(orgId);
  assert.ok(mwo, 'open maintenance work order');

  // Andon: resolved call on Station 2, consistent with the downtime story.
  // Filtered on type='maintenance' — the seed now also carries a still-open,
  // escalated safety call and a separately-answered quality call (see
  // demo-seed-truth.test.js), so this is the only 'maintenance' row.
  const andon = db.prepare(`
    SELECT a.*, s.name AS station_name, s.current_status FROM andon_calls a
    JOIN stations s ON s.id = a.station_id WHERE a.company_id = ? AND a.type = 'maintenance'
  `).get(orgId);
  assert.equal(andon.status, 'resolved');
  assert.equal(andon.station_name, 'Station 2');
  assert.equal(andon.current_status, 'down', 'Station 2 is still down (awaiting the MWO)');
  assert.ok(andon.resolution.includes('MWO'), 'resolution hands off to the maintenance work order');

  // Training: three operators at mixed levels on the assembly app, one
  // expiring soon, plus the QC app's own records — Priya's expired one
  // (demo-seed-truth.test.js covers the override that lets her run anyway)
  // and the clean certifications Bob and the visitor need under 'block' mode
  // so the live QC demo and sandbox-qc-hold.test.js are never the ones it stops.
  const training = db.prepare(`
    SELECT tr.status, tr.expiry_date, u.display_name FROM training_records tr
    JOIN users u ON u.id = tr.user_id WHERE tr.company_id = ?
  `).all(orgId);
  assert.equal(training.length, 6, 'training records: three on the assembly app, three on the QC app');
  assert.ok(new Set(training.map(r => r.status)).size >= 2, 'mixed training levels');
  const expiringSoon = training.filter(r => r.expiry_date && r.expiry_date <= db.prepare(`SELECT date('now', '+30 days') AS d`).get().d);
  assert.ok(expiringSoon.length >= 1, 'a certification window expires soon');
  assert.equal(db.prepare('SELECT COUNT(*) AS c FROM certifications WHERE company_id = ?').get(orgId).c, 1);

  // Purchasing: sent PO, ~2 days late, for the low-stock bolt kit, with a shipment.
  const po = db.prepare(`SELECT * FROM purchase_orders WHERE company_id = ?`).get(orgId);
  assert.equal(po.status, 'sent');
  assert.ok(po.expected_date < db.prepare(`SELECT date('now') AS d`).get().d, 'PO expected date is past');
  const poLine = db.prepare(`SELECT pl.*, i.name FROM po_lines pl JOIN items i ON i.id = pl.item_id WHERE pl.po_id = ?`).get(po.id);
  assert.equal(poLine.name, 'M6 Bolt Kit', 'the late PO restocks the short/low item');
  assert.ok(db.prepare(`SELECT 1 FROM shipments WHERE company_id = ? AND po_id = ?`).get(orgId, po.id), 'shipment row tracks the PO');

  // Kaizen: three ideas in different statuses.
  const kaizen = await api('GET', '/api/kaizen', { token });
  assert.equal(kaizen.status, 200);
  const ideas = Array.isArray(kaizen.json) ? kaizen.json : kaizen.json.ideas;
  assert.ok(ideas.length >= 3, 'three kaizen ideas');
  assert.ok(new Set(ideas.map(i => i.status)).size >= 3, 'kaizen ideas span different statuses');
});

// ─── Enum safety: every seeded enum value renders on its consuming page ───────
// Each set below mirrors the config map of the page that renders the value
// (STATUS_CONFIG / *_BADGE / *_CFG in frontend/src/pages/*). Seeding a value
// outside these sets has crashed pages in production (e.g. kaizen
// 'under_review' vs the Kaizen page's STATUS_CONFIG), so the seed must stay
// within the page-known vocabulary — and, where the table also has a CHECK
// constraint, within the intersection of the two.

test('seeded enum values all exist in the consuming pages’ config maps', () => {
  const KNOWN = {
    kaizen_status:    ['submitted', 'reviewing', 'approved', 'in_progress', 'implemented', 'rejected', 'on_hold'], // Kaizen.tsx STATUS_CONFIG
    kaizen_category:  ['safety', 'quality', 'delivery', 'cost', 'morale', 'environment'],                          // Kaizen.tsx CATEGORY_CONFIG
    ncr_severity:     ['critical', 'major', 'minor'],                                                              // Quality.tsx SEVERITY_STYLES
    ncr_status:       ['open', 'investigating', 'resolved', 'closed'],                                             // Quality.tsx StatusBadge
    capa_status:      ['open', 'root_cause', 'action', 'verification', 'closed'],                                  // CAPA.tsx STATUS_BADGE
    capa_source:      ['manual', 'ncr', 'audit', 'andon', 'customer', 'supplier'],                                 // CAPA.tsx SOURCE_BADGE
    capa_type:        ['corrective', 'preventive', 'both'],                                                        // CAPA.tsx TYPE_BADGE
    capa_action:      ['open', 'in_progress', 'complete'],                                                         // CAPA.tsx ACTION_STATUS_BADGE
    andon_type:       ['help', 'quality', 'material', 'maintenance', 'safety'],                                    // Andon.tsx TYPE_CONFIG
    andon_status:     ['open', 'acknowledged', 'resolved'],                                                        // Andon.tsx STATUS_BADGE
    andon_priority:   ['low', 'normal', 'high', 'critical'],                                                       // Andon.tsx PRIORITY_BADGE
    mwo_status:       ['open', 'in_progress', 'on_hold', 'complete', 'cancelled'],                                 // Maintenance.tsx statusColor
    po_status:        ['draft', 'sent', 'partial', 'received', 'cancelled'],                                       // Purchasing.tsx PO_STATUS_BADGE
    shipment_status:  ['pending', 'in_transit', 'out_for_delivery', 'delivered', 'delayed', 'exception'],          // ShipmentTracker.tsx STATUS_CONFIG
    kit_status:       ['open', 'picking', 'complete', 'short', 'cancelled'],                                       // Kitting.tsx KIT_STATUS_CHIP
    kit_line_status:  ['pending', 'picked', 'verified', 'short'],                                                  // Kitting.tsx LINE_STATUS_CHIP
    training_status:  ['not_started', 'in_training', 'certified', 'expired', 'needs_refresh'],                     // Training.tsx STATUS_CFG
    machine_status:   ['running', 'down', 'maintenance', 'idle'],                                                  // OEETracker.tsx STATUS_CONFIG
  };

  const checks = [
    ['kaizen_ideas . status',              'SELECT DISTINCT status v FROM kaizen_ideas WHERE company_id = ?',            'kaizen_status'],
    ['kaizen_ideas . category',            'SELECT DISTINCT category v FROM kaizen_ideas WHERE company_id = ?',          'kaizen_category'],
    ['ncrs . severity',                    'SELECT DISTINCT severity v FROM ncrs WHERE company_id = ?',                  'ncr_severity'],
    ['ncrs . status',                      'SELECT DISTINCT status v FROM ncrs WHERE company_id = ?',                    'ncr_status'],
    ['capa_items . status',                'SELECT DISTINCT status v FROM capa_items WHERE company_id = ?',              'capa_status'],
    ['capa_items . source',                'SELECT DISTINCT source v FROM capa_items WHERE company_id = ?',              'capa_source'],
    ['capa_items . type',                  'SELECT DISTINCT type v FROM capa_items WHERE company_id = ?',                'capa_type'],
    ['capa_actions . status',              'SELECT DISTINCT ca.status v FROM capa_actions ca JOIN capa_items c ON c.id = ca.capa_id WHERE c.company_id = ?', 'capa_action'],
    ['andon_calls . type',                 'SELECT DISTINCT type v FROM andon_calls WHERE company_id = ?',               'andon_type'],
    ['andon_calls . status',               'SELECT DISTINCT status v FROM andon_calls WHERE company_id = ?',             'andon_status'],
    ['andon_calls . priority',             'SELECT DISTINCT priority v FROM andon_calls WHERE company_id = ?',           'andon_priority'],
    ['maintenance_work_orders . status',   'SELECT DISTINCT status v FROM maintenance_work_orders WHERE company_id = ?', 'mwo_status'],
    ['purchase_orders . status',           'SELECT DISTINCT status v FROM purchase_orders WHERE company_id = ?',         'po_status'],
    ['shipments . status',                 'SELECT DISTINCT status v FROM shipments WHERE company_id = ?',               'shipment_status'],
    ['kits . status',                      'SELECT DISTINCT status v FROM kits WHERE company_id = ?',                    'kit_status'],
    ['kit_lines . status',                 'SELECT DISTINCT status v FROM kit_lines WHERE company_id = ?',               'kit_line_status'],
    ['training_records . status',          'SELECT DISTINCT status v FROM training_records WHERE company_id = ?',        'training_status'],
    ['stations . current_status',          'SELECT DISTINCT current_status v FROM stations WHERE company_id = ?',        'machine_status'],
  ];
  for (const [what, sql, setKey] of checks) {
    const values = db.prepare(sql).all(orgId).map(r => r.v);
    assert.ok(values.length > 0, `${what}: seeded rows exist`);
    for (const v of values) {
      assert.ok(KNOWN[setKey].includes(v), `${what}: '${v}' must be one of [${KNOWN[setKey].join(', ')}]`);
    }
  }
});

// ─── Cleanup: deleteSandboxOrg wipes every seeded table ───────────────────────

test('deleteSandboxOrg deletes EVERYTHING the seed created', async () => {
  const { deleteSandboxOrg } = require('../src/sandbox');

  // Child tables that scope through a parent (no company_id of their own):
  // count them via their parent BEFORE deletion so we can prove they empty out.
  const childCounts = {
    po_lines:        `SELECT COUNT(*) AS c FROM po_lines WHERE po_id IN (SELECT id FROM purchase_orders WHERE company_id = ?)`,
    stock_levels:    `SELECT COUNT(*) AS c FROM stock_levels WHERE item_id IN (SELECT id FROM items WHERE company_id = ?)`,
    stock_movements: `SELECT COUNT(*) AS c FROM stock_movements WHERE item_id IN (SELECT id FROM items WHERE company_id = ?)`,
    machine_events:  `SELECT COUNT(*) AS c FROM machine_events WHERE station_id IN (SELECT id FROM stations WHERE company_id = ?)`,
    ncr_comments:    `SELECT COUNT(*) AS c FROM ncr_comments WHERE ncr_id IN (SELECT id FROM ncrs WHERE company_id = ?)`,
    capa_actions:    `SELECT COUNT(*) AS c FROM capa_actions WHERE capa_id IN (SELECT id FROM capa_items WHERE company_id = ?)`,
    sessions:        `SELECT COUNT(*) AS c FROM sessions WHERE user_id IN (SELECT id FROM users WHERE company_id = ?)`,
  };
  // Because children are counted THROUGH their parent, capture the raw child
  // ids up front — after cleanup the parent rows are gone, so we re-check by id.
  const childIds = {
    po_lines:        db.prepare(`SELECT pl.id FROM po_lines pl JOIN purchase_orders p ON p.id = pl.po_id WHERE p.company_id = ?`).all(orgId).map(r => r.id),
    stock_levels:    db.prepare(`SELECT sl.id FROM stock_levels sl JOIN items i ON i.id = sl.item_id WHERE i.company_id = ?`).all(orgId).map(r => r.id),
    stock_movements: db.prepare(`SELECT sm.id FROM stock_movements sm JOIN items i ON i.id = sm.item_id WHERE i.company_id = ?`).all(orgId).map(r => r.id),
    machine_events:  db.prepare(`SELECT me.id FROM machine_events me JOIN stations s ON s.id = me.station_id WHERE s.company_id = ?`).all(orgId).map(r => r.id),
    ncr_comments:    db.prepare(`SELECT nc.id FROM ncr_comments nc JOIN ncrs n ON n.id = nc.ncr_id WHERE n.company_id = ?`).all(orgId).map(r => r.id),
    capa_actions:    db.prepare(`SELECT ca.id FROM capa_actions ca JOIN capa_items c ON c.id = ca.capa_id WHERE c.company_id = ?`).all(orgId).map(r => r.id),
    sessions:        db.prepare(`SELECT s.id FROM sessions s JOIN users u ON u.id = s.user_id WHERE u.company_id = ?`).all(orgId).map(r => r.id),
  };
  for (const [table, sql] of Object.entries(childCounts)) {
    assert.ok(db.prepare(sql).get(orgId).c > 0, `seed populated ${table}`);
  }

  // Every company-scoped table the seed must have touched.
  const SEEDED_TABLES = [
    'apps', 'completions', 'completion_values', 'stations', 'departments',
    'work_orders', 'product_types', 'items', 'locations', 'vendors',
    'purchase_orders', 'ncrs', 'capa_items', 'assets', 'pm_schedules',
    'maintenance_work_orders', 'andon_calls', 'training_records',
    'certifications', 'training_plans', 'kaizen_ideas', 'shift_notes',
    'shipments', 'boms', 'bom_lines', 'kits', 'kit_lines', 'users', 'plan',
    'org_settings', 'sites',
    // Waves 3/4: routings and operations, coded reasons, change control, overrides.
    'product_routings', 'routing_steps', 'work_order_operations',
    'reason_codes', 'andon_targets', 'app_revisions', 'qualification_overrides',
  ];
  for (const t of SEEDED_TABLES) {
    const c = db.prepare(`SELECT COUNT(*) AS c FROM "${t}" WHERE company_id = ?`).get(orgId).c;
    assert.ok(c > 0, `seed populated ${t}`);
  }

  deleteSandboxOrg(orgId);

  // Sweep 1: every table that carries company_id — zero rows for the org.
  const allTables = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'`).all().map(r => r.name);
  for (const t of allTables) {
    const cols = db.prepare(`PRAGMA table_info(${JSON.stringify(t)})`).all().map(c => c.name);
    if (!cols.includes('company_id')) continue;
    const c = db.prepare(`SELECT COUNT(*) AS c FROM "${t}" WHERE company_id = ?`).get(orgId).c;
    assert.equal(c, 0, `${t} fully cleaned for the sandbox org`);
  }

  // Sweep 2: parent-scoped child tables — the captured ids are all gone.
  for (const [table, ids] of Object.entries(childIds)) {
    if (ids.length === 0) continue;
    const placeholders = ids.map(() => '?').join(', ');
    const c = db.prepare(`SELECT COUNT(*) AS c FROM "${table}" WHERE id IN (${placeholders})`).get(...ids).c;
    assert.equal(c, 0, `${table} fully cleaned for the sandbox org`);
  }

  // And the org row itself.
  assert.equal(db.prepare('SELECT COUNT(*) AS c FROM organizations WHERE id = ?').get(orgId).c, 0);
});

// ─── No-sign-in demo sandboxes ────────────────────────────────────────────────
// POST /api/auth/demo creates a throwaway, fully-isolated workspace with sample
// data and logs the visitor straight in — no email, no password form. Each
// visitor gets their OWN org (normal multi-tenant isolation applies), flagged
// is_sandbox so an hourly sweep deletes anything older than 24 hours.

'use strict';
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const db = require('./db');

// Marker column — additive, guarded, safe to run on every boot.
const orgCols = db.prepare('PRAGMA table_info(organizations)').all().map(r => r.name);
if (!orgCols.includes('is_sandbox')) {
  db.exec('ALTER TABLE organizations ADD COLUMN is_sandbox INTEGER DEFAULT 0');
}

const SANDBOX_EMAIL_DOMAIN = 'sandbox.hartmonitor.local';
const SANDBOX_TTL_HOURS = 24;

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

// ─── Sample data ──────────────────────────────────────────────────────────────

function sampleAppSteps() {
  return [
    {
      id: uuidv4(), name: 'Safety Check', order: 0, takt_time: 60,
      widgets: [
        { id: uuidv4(), type: 'instruction', order: 0, label: 'Before You Start', config: { content: 'Welcome to the HartMonitor demo! This is a guided work instruction an operator would follow. Put on PPE and confirm the work area is clear.', backgroundColor: '#fef3c7' } },
        { id: uuidv4(), type: 'checkbox', order: 1, label: 'PPE Worn', config: { required: true, variableName: 'ppe_worn' } },
        { id: uuidv4(), type: 'checkbox', order: 2, label: 'Work Area Clear', config: { required: true, variableName: 'area_clear' } },
        { id: uuidv4(), type: 'button', order: 3, label: '', config: { buttonText: 'Start Assembly', buttonType: 'next', buttonColor: '#22c55e' } },
      ],
    },
    {
      id: uuidv4(), name: 'Assembly', order: 1, takt_time: 240,
      widgets: [
        { id: uuidv4(), type: 'instruction', order: 0, label: 'Assembly Instructions', config: { content: '1. Place the base bracket on the fixture\n2. Torque the four M6 bolts to 15 Nm\n3. Seat the control board and connect the harness', backgroundColor: '#eff6ff' } },
        { id: uuidv4(), type: 'number-input', order: 1, label: 'Torque Value (Nm)', config: { required: true, variableName: 'torque_value', placeholder: '15' } },
        { id: uuidv4(), type: 'text-input', order: 2, label: 'Board Serial Number', config: { required: true, variableName: 'serial_number', placeholder: 'Scan or type the serial' } },
        { id: uuidv4(), type: 'button', order: 3, label: '', config: { buttonText: 'Assembly Done', buttonType: 'next', buttonColor: '#3b82f6' } },
      ],
    },
    {
      id: uuidv4(), name: 'Final Inspection', order: 2, takt_time: 120,
      widgets: [
        { id: uuidv4(), type: 'pass-fail', order: 0, label: 'Visual Inspection', config: { variableName: 'visual_ok' } },
        { id: uuidv4(), type: 'pass-fail', order: 1, label: 'Functional Test', config: { variableName: 'function_ok' } },
        { id: uuidv4(), type: 'text-input', order: 2, label: 'Notes', config: { variableName: 'notes', placeholder: 'Anything worth recording…' } },
        { id: uuidv4(), type: 'button', order: 3, label: '', config: { buttonText: 'Complete', buttonType: 'complete', buttonColor: '#22c55e' } },
      ],
    },
  ];
}

function seedSandboxData(orgId, tag, siteId) {
  const appId = uuidv4();
  db.prepare(`INSERT INTO apps (id, name, description, status, steps, company_id) VALUES (?, ?, ?, 'published', ?, ?)`)
    .run(appId, 'Bracket Assembly', 'A sample guided work instruction — open it in the App Builder or run it in the Player.', JSON.stringify(sampleAppSteps()), orgId);

  const deptA = uuidv4(), deptB = uuidv4();
  db.prepare(`INSERT INTO departments (id, name, description, color, company_id) VALUES (?, 'Assembly', 'Main assembly line', '#3b82f6', ?)`).run(deptA, orgId);
  db.prepare(`INSERT INTO departments (id, name, description, color, company_id) VALUES (?, 'Packaging', 'Pack-out and shipping prep', '#8b5cf6', ?)`).run(deptB, orgId);

  const st1 = uuidv4();
  db.prepare(`INSERT INTO stations (id, name, description, location, status, current_app_id, company_id, department_id) VALUES (?, 'Station 1', 'Bracket assembly bench', 'Line A', 'active', ?, ?, ?)`).run(st1, appId, orgId, deptA);
  db.prepare(`INSERT INTO stations (id, name, description, location, status, company_id, department_id) VALUES (?, 'Station 2', 'Pack-out bench', 'Line A', 'active', ?, ?)`).run(uuidv4(), orgId, deptB);

  const ptStd = uuidv4();
  db.prepare(`INSERT INTO product_types (id, app_id, name, description, company_id) VALUES (?, ?, 'BRKT-100 Standard', 'Standard bracket', ?)`).run(ptStd, appId, orgId);
  db.prepare(`INSERT INTO product_types (id, app_id, name, description, company_id) VALUES (?, ?, 'BRKT-200 Heavy Duty', 'Heavy-duty variant', ?)`).run(uuidv4(), appId, orgId);

  const items = [
    ['Base Bracket',   'Steel base bracket',        'Components', 4.2,  25],
    ['M6 Bolt Kit',    'Bag of 4 M6 bolts',         'Hardware',   0.8,  100],
    ['Control Board',  'Rev C control board',       'Electronics',18.5, 10],
    ['Wire Harness',   '12-pin harness',            'Electronics', 6.4, 15],
    ['Foam Packaging', 'Molded foam insert',        'Packaging',   1.1, 40],
  ];
  for (const [name, description, category, cost, reorder] of items) {
    db.prepare(`INSERT INTO items (id, sku, name, description, category, unit_of_measure, unit_cost, reorder_point, company_id) VALUES (?, ?, ?, ?, ?, 'ea', ?, ?, ?)`)
      .run(uuidv4(), `${tag}-${name.replace(/[^A-Za-z0-9]+/g, '').slice(0, 10).toUpperCase()}`, name, description, category, cost, reorder, orgId);
  }

  db.prepare(`INSERT INTO work_orders (id, work_order_number, part_number, part_name, quantity, quantity_completed, app_id, department_id, status, priority, company_id, site_id) VALUES (?, ?, 'BRKT-100', 'Standard Bracket', 25, 8, ?, ?, 'in_progress', 'high', ?, ?)`)
    .run(uuidv4(), `${tag}-WO-1001`, appId, deptA, orgId, siteId);
  db.prepare(`INSERT INTO work_orders (id, work_order_number, part_number, part_name, quantity, quantity_completed, app_id, department_id, status, priority, company_id, site_id) VALUES (?, ?, 'BRKT-200', 'Heavy Duty Bracket', 10, 0, ?, ?, 'pending', 'medium', ?, ?)`)
    .run(uuidv4(), `${tag}-WO-1002`, appId, deptA, orgId, siteId);

  db.prepare(`INSERT INTO kaizen_ideas (id, company_id, number, title, description, category, status, submitted_by) VALUES (?, ?, ?, 'Pre-kit bolts at receiving', 'Bag bolts into per-unit kits when they arrive so assemblers stop counting at the bench.', 'delivery', 'under_review', 'Bob Operator')`)
    .run(uuidv4(), orgId, `${tag}-KZ-1`);
}

// ─── Public API ───────────────────────────────────────────────────────────────

function createSandbox(generateToken) {
  const orgId  = uuidv4();
  const userId = uuidv4();
  const tag    = crypto.randomBytes(3).toString('hex').toUpperCase(); // uniquifies global-unique fields
  const email  = `visitor-${tag.toLowerCase()}@${SANDBOX_EMAIL_DOMAIN}`;
  const rawToken  = generateToken();
  const expiresAt = new Date(Date.now() + SANDBOX_TTL_HOURS * 60 * 60 * 1000).toISOString();

  const create = db.transaction(() => {
    db.prepare(`INSERT INTO organizations (id, name, slug, is_sandbox) VALUES (?, 'Acme Manufacturing (Demo)', ?, 1)`)
      .run(orgId, `sandbox-${tag.toLowerCase()}`);
    db.prepare(`INSERT INTO users (id, email, display_name, password_hash, role, company_id) VALUES (?, ?, 'Demo Visitor', ?, 'manager', ?)`)
      .run(userId, email, hashPassword(crypto.randomBytes(24).toString('hex')), orgId);
    db.prepare(`INSERT INTO plan (tier, app_limit, dashboard_limit, company_id) VALUES ('free', 5, 2, ?)`).run(orgId);
    const siteId = uuidv4();
    db.prepare(`INSERT INTO sites (id, company_id, name, code, is_primary) VALUES (?, ?, 'Main Site', 'MAIN', 1)`).run(siteId, orgId);
    const settings = [['company_name', 'Acme Manufacturing (Demo)'], ['timezone', 'America/New_York'], ['date_format', 'MM/DD/YYYY'], ['currency', 'USD']];
    const ins = db.prepare(`INSERT OR IGNORE INTO org_settings (company_id, key, value) VALUES (?, ?, ?)`);
    for (const [k, v] of settings) ins.run(orgId, k, v);
    seedSandboxData(orgId, tag, siteId);
    // Session expires with the sandbox itself.
    db.prepare(`INSERT INTO sessions (id, user_id, token, expires_at) VALUES (?, ?, ?, ?)`).run(uuidv4(), userId, rawToken, expiresAt);
  });
  create();

  return { orgId, userId, email, rawToken };
}

// Delete a sandbox org and every row it owns, in every table that carries
// company_id — discovered dynamically so new tables are covered automatically.
function deleteSandboxOrg(orgId) {
  const tables = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'`).all().map(r => r.name);
  const wipe = db.transaction(() => {
    // Sessions key on user_id, not company_id — clear them first.
    db.prepare(`DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE company_id = ?)`).run(orgId);
    for (const t of tables) {
      const cols = db.prepare(`PRAGMA table_info(${JSON.stringify(t)})`).all().map(c => c.name);
      if (cols.includes('company_id')) {
        db.prepare(`DELETE FROM "${t}" WHERE company_id = ?`).run(orgId);
      }
    }
    db.prepare(`DELETE FROM organizations WHERE id = ?`).run(orgId);
  });
  wipe();
}

function cleanupExpiredSandboxes() {
  const stale = db.prepare(
    `SELECT id FROM organizations WHERE is_sandbox = 1 AND created_at < datetime('now', '-${SANDBOX_TTL_HOURS} hours')`
  ).all();
  for (const org of stale) {
    try {
      deleteSandboxOrg(org.id);
      console.log(`[sandbox] cleaned up expired sandbox org ${org.id}`);
    } catch (err) {
      console.error(`[sandbox] cleanup failed for ${org.id}:`, err.message);
    }
  }
  return stale.length;
}

// Hourly sweep (also runs shortly after boot so restarts don't accumulate junk).
setTimeout(() => { try { cleanupExpiredSandboxes(); } catch (e) { console.error('[sandbox] sweep failed:', e.message); } }, 30 * 1000);
setInterval(() => { try { cleanupExpiredSandboxes(); } catch (e) { console.error('[sandbox] sweep failed:', e.message); } }, 60 * 60 * 1000);

module.exports = { createSandbox, cleanupExpiredSandboxes, deleteSandboxOrg, SANDBOX_EMAIL_DOMAIN };

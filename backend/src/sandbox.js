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

// Map variableName → { step_id, widget_id, widget type } so seeded
// completion_values rows point at the REAL widget ids of the sample app.
function widgetIndex(steps) {
  const byVar = {};
  for (const step of steps) {
    for (const w of step.widgets) {
      const v = w.config && w.config.variableName;
      if (v) byVar[v] = { step_id: step.id, widget_id: w.id, type: w.type };
    }
  }
  return byVar;
}

// Seeds a coherent, cross-linked demo dataset that touches every module:
// production (WOs, stations, machine events), apps + structured completion
// capture, BOM/kitting (with a real shortage), inventory + purchasing (a late
// PO for the low-stock item), quality (NCRs + CAPA), maintenance, andon,
// training, kaizen and shift notes. Everything is tag-prefixed where a value
// is unique, and every datetime offset uses a SINGLE SQLite modifier.
function seedSandboxData(orgId, tag, siteId, visitorUserId) {
  const steps = sampleAppSteps();
  const widgets = widgetIndex(steps);
  const lowTag = tag.toLowerCase();

  const appId = uuidv4();
  db.prepare(`INSERT INTO apps (id, name, description, status, steps, company_id) VALUES (?, ?, ?, 'published', ?, ?)`)
    .run(appId, 'Bracket Assembly', 'A sample guided work instruction — open it in the App Builder or run it in the Player.', JSON.stringify(steps), orgId);

  const deptA = uuidv4(), deptB = uuidv4();
  db.prepare(`INSERT INTO departments (id, name, description, color, company_id) VALUES (?, 'Assembly', 'Main assembly line', '#3b82f6', ?)`).run(deptA, orgId);
  db.prepare(`INSERT INTO departments (id, name, description, color, company_id) VALUES (?, 'Packaging', 'Pack-out and shipping prep', '#8b5cf6', ?)`).run(deptB, orgId);

  // ── Stations: Station 1 is running; Station 2 is DOWN (conveyor jam) ────────
  const st1 = uuidv4(), st2 = uuidv4();
  db.prepare(`INSERT INTO stations (id, name, description, location, status, current_app_id, company_id, department_id, current_status, current_status_since, ideal_cycle_seconds)
              VALUES (?, 'Station 1', 'Bracket assembly bench', 'Line A', 'active', ?, ?, ?, 'running', datetime('now', '-180 minutes'), 420)`).run(st1, appId, orgId, deptA);
  db.prepare(`INSERT INTO stations (id, name, description, location, status, company_id, department_id, current_status, current_status_since)
              VALUES (?, 'Station 2', 'Pack-out bench', 'Line A', 'active', ?, ?, 'down', datetime('now', '-45 minutes'))`).run(st2, orgId, deptB);

  const insEvent = db.prepare(`INSERT INTO machine_events (id, station_id, event_type, reason, started_at, ended_at, duration_minutes) VALUES (?, ?, ?, ?, datetime('now', ?), ?, ?)`);
  insEvent.run(uuidv4(), st1, 'up', '', '-180 minutes', null, null);
  insEvent.run(uuidv4(), st2, 'up', '', '-300 minutes', db.prepare(`SELECT datetime('now', '-45 minutes') AS t`).get().t, 255);
  insEvent.run(uuidv4(), st2, 'down', 'Conveyor drive jam', '-45 minutes', null, null);

  // ── Product types ───────────────────────────────────────────────────────────
  const ptStd = uuidv4(), ptHd = uuidv4();
  db.prepare(`INSERT INTO product_types (id, app_id, name, description, company_id) VALUES (?, ?, 'BRKT-100 Standard', 'Standard bracket', ?)`).run(ptStd, appId, orgId);
  db.prepare(`INSERT INTO product_types (id, app_id, name, description, company_id) VALUES (?, ?, 'BRKT-200 Heavy Duty', 'Heavy-duty variant', ?)`).run(ptHd, appId, orgId);

  // ── Items (ids captured for BOMs / kit / stock / PO links) ──────────────────
  const items = [
    ['bracket', 'Base Bracket',   'Steel base bracket',  'Components',  4.2,  25],
    ['boltkit', 'M6 Bolt Kit',    'Bag of 4 M6 bolts',   'Hardware',    0.8,  100],
    ['board',   'Control Board',  'Rev C control board', 'Electronics', 18.5, 10],
    ['harness', 'Wire Harness',   '12-pin harness',      'Electronics', 6.4,  15],
    ['foam',    'Foam Packaging', 'Molded foam insert',  'Packaging',   1.1,  40],
  ];
  const itemId = {};
  const insItem = db.prepare(`INSERT INTO items (id, sku, name, description, category, unit_of_measure, unit_cost, reorder_point, company_id) VALUES (?, ?, ?, ?, ?, 'ea', ?, ?, ?)`);
  for (const [key, name, description, category, cost, reorder] of items) {
    itemId[key] = uuidv4();
    insItem.run(itemId[key], `${tag}-${name.replace(/[^A-Za-z0-9]+/g, '').slice(0, 10).toUpperCase()}`, name, description, category, cost, reorder, orgId);
  }

  // ── Locations + stock (the bolt kit sits BELOW its reorder point) ───────────
  const locWh = uuidv4(), locLine = uuidv4();
  db.prepare(`INSERT INTO locations (id, name, code, description, type, company_id, site_id) VALUES (?, 'Main Warehouse', ?, 'Central stores', 'warehouse', ?, ?)`).run(locWh, `${tag}-WH1`, orgId, siteId);
  db.prepare(`INSERT INTO locations (id, name, code, description, type, company_id, site_id) VALUES (?, 'Line A Supermarket', ?, 'Point-of-use rack at Line A', 'production', ?, ?)`).run(locLine, `${tag}-LINEA`, orgId, siteId);

  const insStock = db.prepare(`INSERT INTO stock_levels (id, item_id, location_id, quantity) VALUES (?, ?, ?, ?)`);
  insStock.run(uuidv4(), itemId.bracket, locWh, 180);
  insStock.run(uuidv4(), itemId.bracket, locLine, 20);
  insStock.run(uuidv4(), itemId.boltkit, locWh, 12);      // reorder point 100 → stock_low
  insStock.run(uuidv4(), itemId.board,   locWh, 45);
  insStock.run(uuidv4(), itemId.harness, locWh, 60);
  insStock.run(uuidv4(), itemId.foam,    locWh, 55);

  // ── Work orders ─────────────────────────────────────────────────────────────
  const wo1001 = uuidv4(), wo1002 = uuidv4();
  db.prepare(`INSERT INTO work_orders (id, work_order_number, part_number, part_name, quantity, quantity_completed, app_id, department_id, product_type_id, status, priority, scheduled_start, scheduled_end, company_id, site_id)
              VALUES (?, ?, 'BRKT-100', 'Standard Bracket', 25, 8, ?, ?, ?, 'in_progress', 'high', datetime('now', '-3 days'), datetime('now', '+2 days'), ?, ?)`)
    .run(wo1001, `${tag}-WO-1001`, appId, deptA, ptStd, orgId, siteId);
  db.prepare(`INSERT INTO work_orders (id, work_order_number, part_number, part_name, quantity, quantity_completed, app_id, department_id, product_type_id, status, priority, scheduled_start, scheduled_end, company_id, site_id)
              VALUES (?, ?, 'BRKT-200', 'Heavy Duty Bracket', 10, 0, ?, ?, ?, 'pending', 'medium', datetime('now', '+2 days'), datetime('now', '+7 days'), ?, ?)`)
    .run(wo1002, `${tag}-WO-1002`, appId, deptA, ptHd, orgId, siteId);

  // ── Operators (verified floor identities: badge + PIN) ──────────────────────
  // One shared scrypt hash keeps sandbox creation fast; these accounts are for
  // badge/PIN attribution in the demo, not password logins.
  const opPassword = hashPassword(crypto.randomBytes(12).toString('hex'));
  const opPin = hashPassword('1234');
  const operators = [
    ['Bob Operator', 'bob',   `${tag}-OP1`],
    ['Maria Lopez',  'maria', `${tag}-OP2`],
    ['Priya Shah',   'priya', `${tag}-OP3`],
  ];
  const opId = {};
  const insUser = db.prepare(`INSERT INTO users (id, email, display_name, password_hash, role, company_id, department_id, job_title, pin_hash, badge_code) VALUES (?, ?, ?, ?, 'operator', ?, ?, 'Assembly Operator', ?, ?)`);
  for (const [name, key, badge] of operators) {
    opId[key] = uuidv4();
    insUser.run(opId[key], `${key}-${lowTag}@${SANDBOX_EMAIL_DOMAIN}`, name, opPassword, orgId, deptA, opPin, badge);
  }

  // ── BOMs: an ACTIVE versioned BOM per product type ──────────────────────────
  const insBom = db.prepare(`INSERT INTO boms (id, company_id, product_type_id, version, status, notes, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, 'Demo Visitor', datetime('now', ?))`);
  const insBomLine = db.prepare(`INSERT INTO bom_lines (id, bom_id, company_id, item_id, qty_per, unit, reference, step_id, scan_code, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const asmStep = steps[1].id; // point of use: the Assembly step

  // BRKT-100: v1 superseded (pre-harness design), v2 active.
  const bomStdV1 = uuidv4();
  insBom.run(bomStdV1, orgId, ptStd, 1, 'superseded', 'Original release — harness was field-installed', '-30 days');
  insBomLine.run(uuidv4(), bomStdV1, orgId, itemId.bracket, 1, 'ea', 'BASE', asmStep, '', 0);
  insBomLine.run(uuidv4(), bomStdV1, orgId, itemId.boltkit, 1, 'kit', 'M6 x4', asmStep, `${tag}-M6KIT-BAG`, 1);
  insBomLine.run(uuidv4(), bomStdV1, orgId, itemId.board, 1, 'ea', 'PCB U1', asmStep, '', 2);

  const bomStdV2 = uuidv4();
  insBom.run(bomStdV2, orgId, ptStd, 2, 'active', 'Rev C — wire harness now factory-fitted', '-14 days');
  const stdLine = {};
  for (const [i, [key, qty, unit, ref, scan]] of [
    ['bracket', 1, 'ea',  'BASE',   ''],
    ['boltkit', 1, 'kit', 'M6 x4',  `${tag}-M6KIT-BAG`],
    ['board',   1, 'ea',  'PCB U1', ''],
    ['harness', 1, 'ea',  'J1-J12', ''],
  ].entries()) {
    stdLine[key] = uuidv4();
    insBomLine.run(stdLine[key], bomStdV2, orgId, itemId[key], qty, unit, ref, asmStep, scan, i);
  }

  // BRKT-200 heavy-duty: v1 active (doubled hardware + foam).
  const bomHdV1 = uuidv4();
  insBom.run(bomHdV1, orgId, ptHd, 1, 'active', 'Heavy-duty variant — doubled fasteners and harness runs', '-14 days');
  for (const [i, [key, qty, unit, ref, scan]] of [
    ['bracket', 1, 'ea',  'BASE',    ''],
    ['boltkit', 2, 'kit', 'M6 x8',   `${tag}-M6KIT-BAG`],
    ['board',   1, 'ea',  'PCB U1',  ''],
    ['harness', 2, 'ea',  'J1-J24',  ''],
    ['foam',    1, 'ea',  'PACKOUT', ''],
  ].entries()) {
    insBomLine.run(uuidv4(), bomHdV1, orgId, itemId[key], qty, unit, ref, asmStep, scan, i);
  }

  // ── Kit for WO-1001: mostly picked/verified, bolt kits SHORT ────────────────
  const kitId = uuidv4();
  db.prepare(`INSERT INTO kits (id, company_id, work_order_id, bom_id, bom_version, status, location_id, created_by, created_at, updated_at)
              VALUES (?, ?, ?, ?, 2, 'short', ?, 'Maria Lopez', datetime('now', '-150 minutes'), datetime('now', '-110 minutes'))`)
    .run(kitId, orgId, wo1001, bomStdV2, locLine);

  const insKitLine = db.prepare(`INSERT INTO kit_lines (id, kit_id, company_id, bom_line_id, item_id, item_name, sku, qty_required, qty_picked, unit, scan_code, reference, step_id, status, picked_by, picked_at, verified_by, verified_at, short_reason, sort_order)
    VALUES (?, ?, ?, ?, ?, ?, (SELECT sku FROM items WHERE id = ?), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const t = m => db.prepare(`SELECT datetime('now', ?) AS t`).get(`-${m} minutes`).t;
  const kitLine = {};
  const kitLines = [
    // key,      name,             qty, picked, scan,               status,    pickedBy,      pickedAt, verBy,          verAt, shortReason
    ['bracket', 'Base Bracket',    25,  25, '',                  'verified', 'Maria Lopez', 130, 'Bob Operator', 125, ''],
    ['boltkit', 'M6 Bolt Kit',     25,  13, `${tag}-M6KIT-BAG`,  'short',    'Maria Lopez', 120, '',             0,   'Bin empty after 13 kits — stockout, awaiting PO ' + tag + '-PO-2001'],
    ['board',   'Control Board',   25,  25, '',                  'picked',   'Maria Lopez', 115, '',             0,   ''],
    ['harness', 'Wire Harness',    25,  25, '',                  'verified', 'Maria Lopez', 112, 'Bob Operator', 110, ''],
  ];
  for (const [i, [key, name, req, picked, scanOverride, status, pickedBy, pickedMin, verBy, verMin, shortReason]] of kitLines.entries()) {
    kitLine[key] = uuidv4();
    insKitLine.run(
      kitLine[key], kitId, orgId, stdLine[key], itemId[key], name, itemId[key],
      req, picked, key === 'boltkit' ? 'kit' : 'ea',
      scanOverride || db.prepare('SELECT sku FROM items WHERE id = ?').get(itemId[key]).sku,
      '', asmStep, status,
      pickedBy, pickedMin ? t(pickedMin) : null,
      verBy || '', verMin ? t(verMin) : null,
      shortReason, i
    );
  }

  // Consume movements mirroring the picks (marker matches kits.js exactly-once pattern).
  const insMove = db.prepare(`INSERT INTO stock_movements (id, item_id, location_id, movement_type, quantity, unit_cost, reference_type, reference_id, notes, operator_name, created_by, created_at) VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, datetime('now', ?))`);
  insMove.run(uuidv4(), itemId.bracket, locWh, 'receive', 200, '', '', 'Weekly stock replenishment', 'Demo Visitor', 'Demo Visitor', '-7 days');
  for (const [key, qty, min] of [['bracket', 25, 130], ['boltkit', 13, 120], ['board', 25, 115], ['harness', 25, 112]]) {
    insMove.run(uuidv4(), itemId[key], locLine, 'consume', -qty, 'kit', kitId, `kit_line:${kitLine[key]}`, 'Maria Lopez', 'Maria Lopez', `-${min} minutes`);
  }

  // ── Completions with structured per-widget capture ──────────────────────────
  // 8 completed runs (matches WO-1001's quantity_completed) + 1 in progress.
  const insCompletion = db.prepare(`INSERT INTO completions (id, app_id, app_name, station_id, operator_name, operator_user_id, work_order_id, product_type_id, kit_id, started_at, completed_at, status, data, step_times, takt_exceeded_steps, company_id)
    VALUES (?, ?, 'Bracket Assembly', ?, ?, ?, ?, ?, ?, datetime('now', ?), datetime('now', ?), ?, ?, ?, ?, ?)`);
  const insValue = db.prepare(`INSERT INTO completion_values (id, completion_id, company_id, app_id, step_id, widget_id, variable_name, value_type, value_text, value_number, recorded_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now', ?))`);

  function addValues(completionId, offsetMin, data) {
    for (const [varName, raw] of Object.entries(data)) {
      const w = widgets[varName];
      if (!w) continue;
      let type = 'text', text = null, num = null;
      if (w.type === 'checkbox')          { type = 'boolean';   num = raw ? 1 : 0; }
      else if (w.type === 'number-input') { type = 'number';    num = raw; }
      else if (w.type === 'pass-fail')    { type = 'pass_fail'; text = String(raw).toLowerCase(); }
      else                                { type = 'text';      text = String(raw); }
      insValue.run(uuidv4(), completionId, orgId, appId, w.step_id, w.widget_id, varName, type, text, num, `-${offsetMin} minutes`);
    }
  }

  const ops = [[opId.bob, 'Bob Operator'], [opId.maria, 'Maria Lopez'], [opId.priya, 'Priya Shah']];
  //           minutes-ago, duration, torque, step1 seconds, over-takt?, visual
  const runs = [
    [5760, 9,  15.1, 212, false, 'Pass'],
    [4320, 8,  14.9, 205, false, 'Pass'],
    [4260, 10, 15.3, 231, false, 'Pass'],
    [2880, 12, 15.0, 262, true,  'Pass'],   // step 1 blew its 240s takt
    [2820, 8,  14.8, 208, false, 'Pass'],
    [1440, 9,  15.2, 219, false, 'Pass'],
    [90,   11, 15.4, 226, false, 'Fail'],   // today's reject — raised the critical NCR
    [30,   8,  15.0, 210, false, 'Pass'],
  ];
  let failedCompletionId = null;
  runs.forEach(([end, dur, torque, s1, overTakt, visual], i) => {
    const cid = uuidv4();
    const [operatorUserId, operatorName] = ops[i % 3];
    const data = {
      ppe_worn: true, area_clear: true,
      torque_value: torque, serial_number: `${tag}-SN-${1001 + i}`,
      visual_ok: visual, function_ok: visual === 'Fail' ? 'Fail' : 'Pass',
      notes: visual === 'Fail' ? 'Solder bridging on U3 — raised NCR' : '',
    };
    insCompletion.run(
      cid, appId, st1, operatorName, operatorUserId, wo1001, ptStd, kitId,
      `-${end + dur} minutes`, `-${end} minutes`, 'completed',
      JSON.stringify(data),
      JSON.stringify({ 0: 45 + (i % 3) * 4, 1: s1, 2: 88 + (i % 4) * 6 }),
      JSON.stringify(overTakt ? [1] : []),
      orgId
    );
    if (visual === 'Fail') failedCompletionId = cid;
    addValues(cid, end, data);
  });

  // A live in-progress run for the "active now" tiles.
  const liveId = uuidv4();
  db.prepare(`INSERT INTO completions (id, app_id, app_name, station_id, operator_name, operator_user_id, work_order_id, product_type_id, kit_id, started_at, status, data, step_times, company_id)
              VALUES (?, ?, 'Bracket Assembly', ?, 'Maria Lopez', ?, ?, ?, ?, datetime('now', '-12 minutes'), 'in_progress', ?, '{}', ?)`)
    .run(liveId, appId, st1, opId.maria, wo1001, ptStd, kitId, JSON.stringify({ ppe_worn: true, area_clear: true }), orgId);
  addValues(liveId, 10, { ppe_worn: true, area_clear: true });

  // ── Quality: NCRs (one open critical, one resolved) + a receiving minor ─────
  const ncr1 = uuidv4(), ncr2 = uuidv4(), ncr3 = uuidv4();
  const insNcr = db.prepare(`INSERT INTO ncrs (id, ncr_number, title, description, severity, status, source, app_id, completion_id, work_order_id, item_id, assigned_to, root_cause, corrective_action, due_date, resolved_at, created_at, company_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now', ?), ?)`);
  insNcr.run(ncr1, `${tag}-NCR-101`, 'Solder bridging on control board', 'Visual inspection failed on unit SN-1007 — solder bridge across U3 pins 4-5.', 'critical', 'open', 'production',
    appId, failedCompletionId, wo1001, itemId.board, 'Demo Visitor', '', '',
    db.prepare(`SELECT date('now', '+3 days') AS d`).get().d, null, '-80 minutes', orgId);
  insNcr.run(ncr2, `${tag}-NCR-102`, 'Wire harness pin misalignment', 'Pin 7 seated half-depth on three units; caught at functional test.', 'major', 'resolved', 'production',
    appId, null, wo1001, itemId.harness, 'Demo Visitor', 'Crimp die worn past service limit', 'Die replaced; first-article check added to setup sheet',
    db.prepare(`SELECT date('now', '-1 days') AS d`).get().d,
    db.prepare(`SELECT datetime('now', '-2 days') AS t`).get().t, '-6 days', orgId);
  insNcr.run(ncr3, `${tag}-NCR-103`, 'M6 bolt kits under-count in bags', 'Two receiving samples contained 3 bolts instead of 4.', 'minor', 'open', 'receiving',
    null, null, null, itemId.boltkit, 'Bob Operator', '', '',
    db.prepare(`SELECT date('now', '+7 days') AS d`).get().d, null, '-1 days', orgId);
  db.prepare(`INSERT INTO ncr_comments (id, ncr_id, author, body, created_at) VALUES (?, ?, 'Demo Visitor', 'Quarantined remaining WO-1001 boards pending rework instructions.', datetime('now', '-60 minutes'))`).run(uuidv4(), ncr1);

  // ── CAPA: one actively in work (with actions), one open preventive ──────────
  // Enum-safe values only: the CAPA page's maps know status open | root_cause |
  // action | verification | closed, source manual | ncr | audit | andon |
  // customer | supplier, and action status open | in_progress | complete —
  // while the capa_actions CHECK allows open | in_progress | done. 'action'
  // (= corrective actions in work) is this app's "in progress" state, and
  // action rows stay within {open, in_progress}, the page ∩ CHECK intersection.
  const capa1 = uuidv4(), capa2 = uuidv4();
  // Both spellings of the three renamed columns are written: the page reads the
  // newer names, and filling only the older ones left every demo CAPA showing a
  // blank owner, containment and root cause.
  const insCapa = db.prepare(`INSERT INTO capa_items (id, company_id, number, title, source, type, priority, status, department_id, assigned_to, owner_name, due_date, description, containment, containment_action, root_cause, root_cause_analysis, corrective_action, preventive_action, created_by, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Demo Visitor', datetime('now', ?), datetime('now', ?))`);
  {
    const contain = 'Quarantine current board lot; 100% visual on U3 until closed';
    const cause = 'Stencil aperture oversized for the U3 pad redesign';
    insCapa.run(capa1, orgId, `${tag}-CAPA-001`, 'Eliminate solder bridging on Rev C boards', 'ncr', 'corrective', 'high', 'action', deptA, 'Demo Visitor', 'Demo Visitor',
      db.prepare(`SELECT date('now', '+7 days') AS d`).get().d,
      'Recurring solder bridges near U3 on Rev C control boards (see ' + tag + '-NCR-101).',
      contain, contain, cause, cause,
      'Order corrected stencil; requalify reflow profile', 'Add stencil review to the ECO checklist', '-5 days', '-5 days');
  }
  insCapa.run(capa2, orgId, `${tag}-CAPA-002`, 'Prevent conveyor drive jams at pack-out', 'andon', 'preventive', 'medium', 'open', deptB, 'Demo Visitor', 'Demo Visitor',
    db.prepare(`SELECT date('now', '+14 days') AS d`).get().d,
    'Station 2 conveyor jammed twice this quarter; PM interval may be too long.', '', '', '', '', '', 'Shorten belt inspection PM from monthly to biweekly', '-40 minutes', '-40 minutes');

  const insCapaAction = db.prepare(`INSERT INTO capa_actions (id, capa_id, description, assigned_to, owner_name, due_date, status, created_at, completed_at) VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now', ?), ?)`);
  insCapaAction.run(uuidv4(), capa1, 'Corrected stencil ordered from supplier — awaiting delivery', 'Demo Visitor', 'Demo Visitor',
    db.prepare(`SELECT date('now', '+2 days') AS d`).get().d, 'in_progress', '-5 days', null);
  insCapaAction.run(uuidv4(), capa1, 'Requalify reflow profile with new stencil', 'Maria Lopez', 'Maria Lopez',
    db.prepare(`SELECT date('now', '+4 days') AS d`).get().d, 'open', '-3 days', null);
  insCapaAction.run(uuidv4(), capa2, 'Draft biweekly belt inspection checklist', 'Priya Shah', 'Priya Shah',
    db.prepare(`SELECT date('now', '+10 days') AS d`).get().d, 'open', '-40 minutes', null);

  // ── Maintenance: assets, PM schedules (one due soon), open MWO ──────────────
  const asset1 = uuidv4(), asset2 = uuidv4();
  const insAsset = db.prepare(`INSERT INTO assets (id, company_id, name, asset_number, category, type, manufacturer, make, model, department_id, location, status, purchase_date, install_date, notes, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`);
  insAsset.run(asset1, orgId, 'Torque Driver — Station 1', `${tag}-AST-01`, 'Tooling', 'Tooling', 'Atlas Copco', 'Atlas Copco', 'ETV ST61', deptA, 'Line A', 'active', '2023-06-12', '2023-06-12', 'Calibrated quarterly');
  insAsset.run(asset2, orgId, 'Pack-out Conveyor', `${tag}-AST-02`, 'Conveyance', 'Conveyance', 'Dorner', 'Dorner', '2200 Series', deptB, 'Line A', 'maintenance', '2021-03-02', '2021-03-02', 'Drive jam — see open work order');

  const insPm = db.prepare(`INSERT INTO pm_schedules (id, company_id, asset_id, title, description, frequency_value, frequency_type, last_completed_at, next_due_at, assigned_to, estimated_hours) VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now', ?), datetime('now', ?), ?, ?)`);
  insPm.run(uuidv4(), orgId, asset1, 'Torque driver calibration', 'Verify against reference transducer; record as-found/as-left.', 1, 'months', '-28 days', '+2 days', 'Demo Visitor', 1);
  insPm.run(uuidv4(), orgId, asset2, 'Belt & roller inspection', 'Check belt tracking, tension and roller bearings.', 1, 'months', '-9 days', '+21 days', 'Priya Shah', 1.5);

  db.prepare(`INSERT INTO maintenance_work_orders (id, company_id, number, wo_number, title, type, priority, status, asset_id, department_id, assigned_to, description, estimated_hours, requested_by, due_date, created_at, updated_at)
              VALUES (?, ?, ?, ?, 'Conveyor drive jam — Station 2 stopped', 'emergency', 'critical', 'open', ?, ?, 'Demo Visitor', 'Pack-out conveyor jammed mid-cycle; Station 2 down until the drive belt is replaced.', 2, 'Priya Shah', date('now', '+1 days'), datetime('now', '-40 minutes'), datetime('now', '-40 minutes'))`)
    .run(uuidv4(), orgId, `${tag}-MWO-100`, `${tag}-MWO-100`, asset2, deptB);

  // ── Andon: resolved call, consistent with Station 2's downtime ──────────────
  db.prepare(`INSERT INTO andon_calls (id, company_id, department_id, station_id, type, priority, status, description, raised_by, acknowledged_by, acknowledged_at, resolved_by, resolved_at, resolution, created_at)
              VALUES (?, ?, ?, ?, 'maintenance', 'high', 'resolved', 'Conveyor stopped mid-cycle at pack-out', 'Priya Shah', 'Demo Visitor', datetime('now', '-42 minutes'), 'Demo Visitor', datetime('now', '-35 minutes'), ?, datetime('now', '-45 minutes'))`)
    .run(uuidv4(), orgId, deptB, st2, `Escalated to maintenance — ${tag}-MWO-100 opened; station stays down pending drive belt`);

  // ── Training: mixed levels for the three operators ──────────────────────────
  const insTraining = db.prepare(`INSERT INTO training_records (id, company_id, user_id, app_id, status, certified_date, expiry_date, certified_by, score, attempts, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const d = expr => db.prepare(`SELECT date('now', ?) AS d`).get(expr).d;
  insTraining.run(uuidv4(), orgId, opId.bob, appId, 'certified', d('-60 days'), d('+305 days'), visitorUserId, 96, 1, '');
  insTraining.run(uuidv4(), orgId, opId.maria, appId, 'in_training', null, null, null, null, 1, 'Shadowing Bob on Line A this week');
  insTraining.run(uuidv4(), orgId, opId.priya, appId, 'certified', d('-350 days'), d('+15 days'), visitorUserId, 88, 2, 'Recert due — schedule refresher');
  db.prepare(`INSERT INTO certifications (id, company_id, user_id, name, issuer, cert_number, issued_date, expiry_date, notes) VALUES (?, ?, ?, 'IPC J-STD-001 Soldering', 'IPC', ?, ?, ?, 'Expiring soon — book renewal exam')`)
    .run(uuidv4(), orgId, opId.priya, `${tag}-CERT-88`, d('-350 days'), d('+15 days'));
  db.prepare(`INSERT INTO training_plans (id, company_id, user_id, app_id, assigned_by, target_date, status, notes) VALUES (?, ?, ?, ?, ?, ?, 'in_progress', 'Certify before BRKT-200 ramp')`)
    .run(uuidv4(), orgId, opId.maria, appId, visitorUserId, d('+10 days'));

  // ── Purchasing: vendor + late PO for the low-stock bolt kit + shipment ──────
  const vendorId = uuidv4(), poId = uuidv4();
  db.prepare(`INSERT INTO vendors (id, name, code, contact_name, email, phone, payment_terms, lead_time_days, rating, company_id) VALUES (?, 'FastenerWorks Supply', ?, 'Dana Reeves', 'orders@fastenerworks.example', '+1 (216) 555-0182', 'net30', 10, 4, ?)`)
    .run(vendorId, `${tag}-FSTW`, orgId);
  db.prepare(`INSERT INTO purchase_orders (id, po_number, vendor_id, status, order_date, expected_date, shipping_cost, notes, company_id) VALUES (?, ?, ?, 'sent', date('now', '-9 days'), date('now', '-2 days'), 45, 'Expedite — bolt kits below reorder point', ?)`)
    .run(poId, `${tag}-PO-2001`, vendorId, orgId);
  db.prepare(`INSERT INTO po_lines (id, po_id, item_id, quantity_ordered, quantity_received, unit_cost, notes) VALUES (?, ?, ?, 500, 0, 0.72, 'Covers WO-1001 shortage + safety stock')`)
    .run(uuidv4(), poId, itemId.boltkit);
  db.prepare(`INSERT INTO shipments (id, company_id, po_id, carrier, tracking_number, origin, status, shipped_date, estimated_arrival, notes) VALUES (?, ?, ?, 'FreightLine', ?, 'Cleveland, OH', 'delayed', datetime('now', '-5 days'), datetime('now', '+1 days'), 'Carrier reports weather delay at the Toledo hub')`)
    .run(uuidv4(), orgId, poId, `${tag}-TRK-8842`);

  // ── Kaizen: three ideas across the funnel ───────────────────────────────────
  const insKaizen = db.prepare(`INSERT INTO kaizen_ideas (id, company_id, number, idea_number, title, description, category, status, department_id, submitted_by, assigned_to, estimated_savings, actual_savings, created_at, completed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now', ?), ?)`);
  // NOTE: statuses/categories must exist in BOTH the kaizen_ideas CHECK
  // constraint AND the Kaizen page's STATUS_CONFIG/CATEGORY_CONFIG maps —
  // the intersection is: submitted, approved, in_progress, implemented,
  // rejected ('under_review' crashes the page; 'reviewing' fails the CHECK).
  insKaizen.run(uuidv4(), orgId, `${tag}-KZ-1`, `${tag}-KZ-1`, 'Pre-kit bolts at receiving', 'Bag bolts into per-unit kits when they arrive so assemblers stop counting at the bench.', 'delivery', 'submitted', deptA, 'Bob Operator', '', 0, 0, '-4 days', null);
  insKaizen.run(uuidv4(), orgId, `${tag}-KZ-2`, `${tag}-KZ-2`, 'Shadow board for torque drivers', 'Outlined shadow board at Station 1 ended the morning hunt for the 15 Nm driver.', 'safety', 'implemented', deptA, 'Maria Lopez', 'Demo Visitor', 800, 1200, '-30 days',
    db.prepare(`SELECT datetime('now', '-10 days') AS t`).get().t);
  insKaizen.run(uuidv4(), orgId, `${tag}-KZ-3`, `${tag}-KZ-3`, 'Vacuum lifter for heavy-duty brackets', 'BRKT-200 brackets are 14 kg — a vacuum lifter at pack-out would cut strain and drops.', 'cost', 'approved', deptB, 'Priya Shah', 'Demo Visitor', 3500, 0, '-12 days', null);

  // ── Shift handoff note (yesterday, tells the same downtime story) ───────────
  db.prepare(`INSERT INTO shift_notes (id, company_id, department_id, shift_name, shift_date, supervisor, good_count, scrap_count, downtime_minutes, notes, status, created_by) VALUES (?, ?, ?, 'Day', date('now', '-1 days'), 'Demo Visitor', 120, 3, 25, 'Pack-out conveyor squealing near the drive end — maintenance notified, keep an eye on it.', 'submitted', 'Demo Visitor')`)
    .run(uuidv4(), orgId, deptB);

  // ── A SECOND published app, so the App Dashboard picker shows more than one ──
  // Final QC on the pack-out line: a torque re-check plus a visual pass/fail.
  // Kept deliberately small — two steps, its own runs on Station 2 — but real
  // enough that its analytics tiles, operators and captured values are populated.
  const qcAppId = uuidv4();
  const qcTorqueW = uuidv4(), qcResultW = uuidv4();
  const qcSteps = [
    { id: uuidv4(), name: 'Re-torque check', order: 0, layout: 'stacked', widgets: [
      { id: uuidv4(), type: 'instruction', config: { text: 'Confirm the two frame bolts hold 15 Nm before the unit ships.' } },
      { id: qcTorqueW, type: 'number-input', config: { label: 'Verified torque (Nm)', variableName: 'final_torque', required: true } },
    ] },
    { id: uuidv4(), name: 'Final visual', order: 1, layout: 'stacked', widgets: [
      { id: qcResultW, type: 'pass-fail', config: { label: 'Ships as-is?', variableName: 'qc_result', required: true } },
    ] },
  ];
  db.prepare(`INSERT INTO apps (id, name, description, status, steps, company_id) VALUES (?, ?, ?, 'published', ?, ?)`)
    .run(qcAppId, 'Final QC Inspection', 'Pack-out quality gate — a torque re-check and a ship/hold decision.', JSON.stringify(qcSteps), orgId);

  const qcWidgets = widgetIndex(qcSteps);
  const insQcCompletion = db.prepare(`INSERT INTO completions (id, app_id, app_name, station_id, operator_name, operator_user_id, started_at, completed_at, status, data, step_times, takt_exceeded_steps, company_id)
    VALUES (?, ?, 'Final QC Inspection', ?, ?, ?, datetime('now', ?), datetime('now', ?), 'completed', ?, ?, '[]', ?)`);
  // end-minutes-ago, duration, torque, result — spread across ~4 days and 3 operators.
  const qcRuns = [
    [5730, 4, 15.1, 'Pass'], [4290, 5, 14.9, 'Pass'], [2850, 4, 15.2, 'Pass'],
    [1400, 6, 14.6, 'Fail'], [1380, 4, 15.0, 'Pass'], [120, 5, 15.3, 'Pass'],
  ];
  qcRuns.forEach(([end, dur, torque, result], i) => {
    const cid = uuidv4();
    const [operatorUserId, operatorName] = ops[i % 3];
    insQcCompletion.run(
      cid, qcAppId, st2, operatorName, operatorUserId,
      `-${end + dur} minutes`, `-${end} minutes`,
      JSON.stringify({ final_torque: torque, qc_result: result }),
      JSON.stringify({ 0: 90 + (i % 3) * 10, 1: 40 + (i % 2) * 12 }),
      orgId
    );
    for (const [varName, raw] of Object.entries({ final_torque: torque, qc_result: result })) {
      const w = qcWidgets[varName];
      if (!w) continue;
      const isNum = w.type === 'number-input';
      insValue.run(uuidv4(), cid, orgId, qcAppId, w.step_id, w.widget_id, varName,
        isNum ? 'number' : 'pass_fail', isNum ? null : String(raw).toLowerCase(), isNum ? raw : null, `-${end} minutes`);
    }
  });
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
    // Pro tier so the demo showcases every module (quality, inventory,
    // purchasing, maintenance, training and the daily brief's pro sections).
    db.prepare(`INSERT INTO plan (tier, app_limit, dashboard_limit, company_id) VALUES ('pro', 25, 10, ?)`).run(orgId);
    const siteId = uuidv4();
    db.prepare(`INSERT INTO sites (id, company_id, name, code, is_primary) VALUES (?, ?, 'Main Site', 'MAIN', 1)`).run(siteId, orgId);
    const settings = [['company_name', 'Acme Manufacturing (Demo)'], ['timezone', 'America/New_York'], ['date_format', 'MM/DD/YYYY'], ['currency', 'USD']];
    const ins = db.prepare(`INSERT OR IGNORE INTO org_settings (company_id, key, value) VALUES (?, ?, ?)`);
    for (const [k, v] of settings) ins.run(orgId, k, v);
    seedSandboxData(orgId, tag, siteId, userId);
    // Session expires with the sandbox itself.
    db.prepare(`INSERT INTO sessions (id, user_id, token, expires_at) VALUES (?, ?, ?, ?)`).run(uuidv4(), userId, rawToken, expiresAt);
  });
  create();

  return { orgId, userId, email, rawToken };
}

// Delete a sandbox org and every row it owns, in every table that carries
// company_id — discovered dynamically so new tables are covered automatically.
// Child tables that scope through a parent (no company_id column of their own)
// are cleared first, in FK-safe order, so the dynamic sweep can never trip a
// foreign-key constraint (e.g. po_lines.item_id → items, purchase_orders.vendor_id
// → vendors).
function deleteSandboxOrg(orgId) {
  const tables = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'`).all().map(r => r.name);
  const wipe = db.transaction(() => {
    // Sessions key on user_id, not company_id — clear them first.
    db.prepare(`DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE company_id = ?)`).run(orgId);

    // Parent-scoped child tables + order-sensitive parents. Each entry is
    // [table, WHERE clause] with a single `?` bound to the org id.
    const CHILD_DELETES = [
      ['po_lines',              `po_id IN (SELECT id FROM purchase_orders WHERE company_id = ?)`],
      ['purchase_orders',       `company_id = ?`],  // before vendors/items (vendor_id / po_lines.item_id FKs)
      ['kit_lines',             `company_id = ?`],
      ['kits',                  `company_id = ?`],
      ['bom_lines',             `company_id = ?`],
      ['boms',                  `company_id = ?`],
      ['completion_values',     `company_id = ?`],
      ['capa_actions',          `capa_id IN (SELECT id FROM capa_items WHERE company_id = ?)`],
      ['stock_levels',          `item_id IN (SELECT id FROM items WHERE company_id = ?)`],
      ['stock_movements',       `item_id IN (SELECT id FROM items WHERE company_id = ?)`],
      ['machine_events',        `station_id IN (SELECT id FROM stations WHERE company_id = ?)`],
      ['table_records',         `table_id IN (SELECT id FROM tables WHERE company_id = ?)`],
      ['ncr_comments',          `ncr_id IN (SELECT id FROM ncrs WHERE company_id = ?)`],
      ['wo_comments',           `work_order_id IN (SELECT id FROM work_orders WHERE company_id = ?)`],
      ['password_reset_tokens', `user_id IN (SELECT id FROM users WHERE company_id = ?)`],
      ['webhook_deliveries',    `webhook_id IN (SELECT id FROM webhooks WHERE company_id = ?)`],
    ];
    for (const [t, where] of CHILD_DELETES) {
      if (tables.includes(t)) db.prepare(`DELETE FROM "${t}" WHERE ${where}`).run(orgId);
    }

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
// Started explicitly from index.js at listen() — NOT at module load, because
// this module is required lazily by POST /auth/demo: a server that never gets a
// demo request would otherwise never sweep, and 24h-expired sandbox orgs would
// live forever. unref() so tests/scripts that require it aren't kept alive.
let sweeperStarted = false;
function startSandboxSweeper() {
  if (sweeperStarted) return;
  sweeperStarted = true;
  const sweep = () => {
    try { cleanupExpiredSandboxes(); } catch (e) { console.error('[sandbox] sweep failed:', e.message); }
  };
  setTimeout(sweep, 30 * 1000).unref();
  setInterval(sweep, 60 * 60 * 1000).unref();
}

module.exports = { createSandbox, cleanupExpiredSandboxes, deleteSandboxOrg, startSandboxSweeper, SANDBOX_EMAIL_DOMAIN };

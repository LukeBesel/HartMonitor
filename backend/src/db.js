const Database = require('better-sqlite3');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const DB_PATH = path.join(__dirname, '..', 'mes.db');
const db = new Database(DB_PATH);

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// ─── Existing tables ─────────────────────────────────────────────────────────

db.exec(`
  CREATE TABLE IF NOT EXISTS apps (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT DEFAULT '',
    status TEXT DEFAULT 'draft' CHECK(status IN ('draft', 'published')),
    steps TEXT DEFAULT '[]',
    variables TEXT DEFAULT '[]',
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS completions (
    id TEXT PRIMARY KEY,
    app_id TEXT NOT NULL,
    app_name TEXT NOT NULL,
    station_id TEXT,
    operator_name TEXT DEFAULT 'Unknown',
    started_at TEXT DEFAULT (datetime('now')),
    completed_at TEXT,
    status TEXT DEFAULT 'in_progress' CHECK(status IN ('in_progress', 'completed', 'abandoned')),
    data TEXT DEFAULT '{}',
    step_times TEXT DEFAULT '{}',
    FOREIGN KEY(app_id) REFERENCES apps(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS tables (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT DEFAULT '',
    fields TEXT DEFAULT '[]',
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS table_records (
    id TEXT PRIMARY KEY,
    table_id TEXT NOT NULL,
    data TEXT DEFAULT '{}',
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY(table_id) REFERENCES tables(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS stations (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT DEFAULT '',
    location TEXT DEFAULT '',
    status TEXT DEFAULT 'active' CHECK(status IN ('active', 'inactive', 'maintenance')),
    current_app_id TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );
`);

// ─── Migrations: add new columns to completions if missing ──────────────────

const completionCols = db.prepare('PRAGMA table_info(completions)').all().map(r => r.name);

if (!completionCols.includes('work_order_id')) {
  db.exec('ALTER TABLE completions ADD COLUMN work_order_id TEXT');
}
if (!completionCols.includes('takt_exceeded_steps')) {
  db.exec("ALTER TABLE completions ADD COLUMN takt_exceeded_steps TEXT DEFAULT '[]'");
}
if (!completionCols.includes('product_type_id')) {
  db.exec('ALTER TABLE completions ADD COLUMN product_type_id TEXT');
}

// ─── Migrations: stations OEE fields ─────────────────────────────────────────

const stationCols = db.prepare('PRAGMA table_info(stations)').all().map(r => r.name);
if (!stationCols.includes('planned_hours_per_day')) {
  db.exec('ALTER TABLE stations ADD COLUMN planned_hours_per_day REAL DEFAULT 8');
}
if (!stationCols.includes('ideal_cycle_seconds')) {
  db.exec('ALTER TABLE stations ADD COLUMN ideal_cycle_seconds REAL DEFAULT 0');
}
if (!stationCols.includes('current_status')) {
  db.exec("ALTER TABLE stations ADD COLUMN current_status TEXT DEFAULT 'idle'");
}
if (!stationCols.includes('current_status_since')) {
  db.exec('ALTER TABLE stations ADD COLUMN current_status_since TEXT');
}

// ─── New tables ──────────────────────────────────────────────────────────────

db.exec(`
  CREATE TABLE IF NOT EXISTS departments (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT DEFAULT '',
    manager_name TEXT DEFAULT '',
    color TEXT DEFAULT '#3b82f6',
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS work_orders (
    id TEXT PRIMARY KEY,
    work_order_number TEXT NOT NULL UNIQUE,
    part_number TEXT NOT NULL,
    part_name TEXT NOT NULL,
    quantity INTEGER NOT NULL,
    quantity_completed INTEGER DEFAULT 0,
    app_id TEXT REFERENCES apps(id) ON DELETE SET NULL,
    department_id TEXT REFERENCES departments(id) ON DELETE SET NULL,
    scheduled_start TEXT,
    scheduled_end TEXT,
    takt_time_minutes REAL DEFAULT 0,
    status TEXT DEFAULT 'pending' CHECK(status IN ('pending','in_progress','completed','overdue','cancelled')),
    priority TEXT DEFAULT 'medium' CHECK(priority IN ('low','medium','high','critical')),
    notes TEXT DEFAULT '',
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS product_types (
    id TEXT PRIMARY KEY,
    app_id TEXT NOT NULL REFERENCES apps(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    description TEXT DEFAULT '',
    takt_overrides TEXT DEFAULT '{}',
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS machine_events (
    id TEXT PRIMARY KEY,
    station_id TEXT NOT NULL REFERENCES stations(id) ON DELETE CASCADE,
    event_type TEXT NOT NULL CHECK(event_type IN ('up','down','maintenance','idle')),
    reason TEXT DEFAULT '',
    started_at TEXT DEFAULT (datetime('now')),
    ended_at TEXT,
    duration_minutes REAL
  );

  CREATE TABLE IF NOT EXISTS dashboards (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT DEFAULT '',
    cards TEXT DEFAULT '[]',
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  );
`);

// ─── Seed helpers ─────────────────────────────────────────────────────────────

function isoOffset(days, hours = 8) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  d.setHours(hours, 0, 0, 0);
  return d.toISOString();
}

// ─── Seed: apps, stations, completions, tables ────────────────────────────────

function seedAppData() {
  const appCount = db.prepare('SELECT COUNT(*) as c FROM apps').get();
  if (appCount.c > 0) return;

  const appId = uuidv4();
  const steps = [
    {
      id: uuidv4(),
      name: 'Safety Check',
      order: 0,
      takt_time: 60,
      widgets: [
        { id: uuidv4(), type: 'instruction', order: 0, label: 'Safety Instructions', config: { content: 'Ensure all safety equipment is in place before starting. Wear PPE including gloves and safety glasses.', backgroundColor: '#fef3c7' } },
        { id: uuidv4(), type: 'checkbox', order: 1, label: 'PPE Worn', config: { required: true, variableName: 'ppe_worn' } },
        { id: uuidv4(), type: 'checkbox', order: 2, label: 'Work Area Clear', config: { required: true, variableName: 'area_clear' } },
        { id: uuidv4(), type: 'button', order: 3, label: '', config: { buttonText: 'Proceed to Assembly', buttonType: 'next', buttonColor: '#22c55e' } }
      ]
    },
    {
      id: uuidv4(),
      name: 'Part Inspection',
      order: 1,
      takt_time: 120,
      widgets: [
        { id: uuidv4(), type: 'text', order: 0, label: '', config: { text: 'Inspect incoming parts for defects before assembly.', fontSize: 16, color: '#374151' } },
        { id: uuidv4(), type: 'select-input', order: 1, label: 'Part Condition', config: { required: true, variableName: 'part_condition', options: ['Good', 'Minor Defect', 'Major Defect', 'Reject'] } },
        { id: uuidv4(), type: 'text-input', order: 2, label: 'Part Serial Number', config: { required: true, variableName: 'serial_number', placeholder: 'Scan or enter serial number' } },
        { id: uuidv4(), type: 'pass-fail', order: 3, label: 'Visual Inspection', config: { variableName: 'visual_inspection' } },
        { id: uuidv4(), type: 'button', order: 4, label: '', config: { buttonText: 'Next Step', buttonType: 'next', buttonColor: '#3b82f6' } }
      ]
    },
    {
      id: uuidv4(),
      name: 'Assembly',
      order: 2,
      takt_time: 300,
      widgets: [
        { id: uuidv4(), type: 'instruction', order: 0, label: 'Assembly Instructions', config: { content: '1. Place base component on fixture\n2. Apply torque to 15 Nm\n3. Attach side panels using M6 bolts\n4. Verify alignment before final tightening', backgroundColor: '#eff6ff' } },
        { id: uuidv4(), type: 'counter', order: 1, label: 'Bolt Count', config: { variableName: 'bolt_count', min: 0, max: 8, step: 1, initialValue: 0 } },
        { id: uuidv4(), type: 'number-input', order: 2, label: 'Torque Value (Nm)', config: { required: true, variableName: 'torque_value', placeholder: '15' } },
        { id: uuidv4(), type: 'button', order: 3, label: '', config: { buttonText: 'Assembly Complete', buttonType: 'next', buttonColor: '#3b82f6' } }
      ]
    },
    {
      id: uuidv4(),
      name: 'Quality Check',
      order: 3,
      takt_time: 180,
      widgets: [
        { id: uuidv4(), type: 'text', order: 0, label: '', config: { text: 'Perform final quality inspection', fontSize: 18, fontWeight: 'bold', color: '#111827' } },
        { id: uuidv4(), type: 'pass-fail', order: 1, label: 'Dimensional Check', config: { variableName: 'dim_check' } },
        { id: uuidv4(), type: 'pass-fail', order: 2, label: 'Functional Test', config: { variableName: 'func_test' } },
        { id: uuidv4(), type: 'text-input', order: 3, label: 'Inspector Notes', config: { variableName: 'inspector_notes', placeholder: 'Enter any observations...' } },
        { id: uuidv4(), type: 'button', order: 4, label: '', config: { buttonText: 'Complete Process', buttonType: 'complete', buttonColor: '#22c55e' } }
      ]
    }
  ];

  db.prepare(`INSERT INTO apps (id, name, description, status, steps) VALUES (?, ?, ?, ?, ?)`)
    .run(appId, 'Widget Assembly Process', 'Standard assembly process for widget production line', 'published', JSON.stringify(steps));

  const station1Id = uuidv4();
  const station2Id = uuidv4();
  db.prepare(`INSERT INTO stations (id, name, description, location, current_app_id) VALUES (?, ?, ?, ?, ?)`)
    .run(station1Id, 'Assembly Station A1', 'Primary assembly workstation', 'Building A - Floor 1', appId);
  db.prepare(`INSERT INTO stations (id, name, description, location) VALUES (?, ?, ?, ?)`)
    .run(station2Id, 'QC Inspection Bench', 'Quality control inspection area', 'Building A - Floor 1');

  const now = new Date();
  for (let i = 30; i >= 0; i--) {
    const date = new Date(now);
    date.setDate(date.getDate() - i);
    const completionsPerDay = Math.floor(Math.random() * 8) + 3;
    for (let j = 0; j < completionsPerDay; j++) {
      const startTime = new Date(date);
      startTime.setHours(7 + Math.floor(Math.random() * 9));
      startTime.setMinutes(Math.floor(Math.random() * 60));
      const cycleMinutes = 15 + Math.floor(Math.random() * 25);
      const endTime = new Date(startTime.getTime() + cycleMinutes * 60000);
      const operators = ['Alice Johnson', 'Bob Martinez', 'Carol Chen', 'David Kim', 'Emma Davis'];
      const passFail = Math.random() > 0.08 ? 'Pass' : 'Fail';
      db.prepare(`
        INSERT INTO completions
          (id, app_id, app_name, station_id, operator_name, started_at, completed_at,
           status, data, step_times, takt_exceeded_steps)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        uuidv4(), appId, 'Widget Assembly Process',
        Math.random() > 0.5 ? station1Id : station2Id,
        operators[Math.floor(Math.random() * operators.length)],
        startTime.toISOString(), endTime.toISOString(), 'completed',
        JSON.stringify({ serial_number: `SN-${Date.now()}-${j}`, part_condition: 'Good', visual_inspection: passFail, dim_check: passFail, func_test: passFail, bolt_count: 8, torque_value: 15, ppe_worn: true, area_clear: true }),
        JSON.stringify({ 0: 45 + Math.random() * 30, 1: 120 + Math.random() * 60, 2: 300 + Math.random() * 120, 3: 180 + Math.random() * 90 }),
        JSON.stringify([])
      );
    }
  }

  const tableId = uuidv4();
  db.prepare(`INSERT INTO tables (id, name, description, fields) VALUES (?, ?, ?, ?)`)
    .run(tableId, 'Part Inventory', 'Master list of parts used in assembly', JSON.stringify([
      { id: uuidv4(), name: 'Part Number', type: 'text' },
      { id: uuidv4(), name: 'Description', type: 'text' },
      { id: uuidv4(), name: 'Quantity', type: 'number' },
      { id: uuidv4(), name: 'Reorder Point', type: 'number' },
      { id: uuidv4(), name: 'Active', type: 'boolean' }
    ]));

  const parts = [
    { 'Part Number': 'WGT-BASE-001', 'Description': 'Widget Base Plate',  'Quantity': 150,  'Reorder Point': 50,  'Active': true },
    { 'Part Number': 'WGT-PANEL-L', 'Description': 'Left Side Panel',     'Quantity': 200,  'Reorder Point': 75,  'Active': true },
    { 'Part Number': 'WGT-PANEL-R', 'Description': 'Right Side Panel',    'Quantity': 195,  'Reorder Point': 75,  'Active': true },
    { 'Part Number': 'BOLT-M6-20',  'Description': 'M6 x 20mm Bolt',      'Quantity': 2400, 'Reorder Point': 500, 'Active': true },
    { 'Part Number': 'GSKT-SIL-01', 'Description': 'Silicone Gasket',     'Quantity': 45,   'Reorder Point': 100, 'Active': true },
  ];
  for (const part of parts) {
    db.prepare(`INSERT INTO table_records (id, table_id, data) VALUES (?, ?, ?)`)
      .run(uuidv4(), tableId, JSON.stringify(part));
  }

  // Return appId so work-order seeding can reference it
  return appId;
}

// ─── Seed: departments ────────────────────────────────────────────────────────

function seedDepartments() {
  const deptCount = db.prepare('SELECT COUNT(*) as c FROM departments').get();
  if (deptCount.c > 0) return null;

  const depts = [
    { name: 'Assembly',        description: 'Final product assembly operations',  manager_name: 'Tom Rivera',   color: '#3b82f6' },
    { name: 'Quality Control', description: 'Inspection and quality assurance',   manager_name: 'Sarah Nguyen', color: '#10b981' },
    { name: 'Packaging',       description: 'Product packaging and labeling',     manager_name: 'James Patel',  color: '#f59e0b' },
    { name: 'Maintenance',     description: 'Equipment maintenance and repair',   manager_name: 'Linda Okafor', color: '#ef4444' },
  ];

  const insertDept = db.prepare(`INSERT INTO departments (id, name, description, manager_name, color) VALUES (?, ?, ?, ?, ?)`);
  const ids = {};
  for (const d of depts) {
    const id = uuidv4();
    insertDept.run(id, d.name, d.description, d.manager_name, d.color);
    ids[d.name] = id;
  }
  return ids;
}

// ─── Seed: work orders ────────────────────────────────────────────────────────

function seedWorkOrders(appId, deptIds) {
  const woCount = db.prepare('SELECT COUNT(*) as c FROM work_orders').get();
  if (woCount.c > 0) return;

  if (!appId) {
    appId = db.prepare('SELECT id FROM apps LIMIT 1').get()?.id;
  }
  if (!deptIds) {
    const rows = db.prepare('SELECT id, name FROM departments').all();
    deptIds = {};
    for (const r of rows) deptIds[r.name] = r.id;
  }

  const insertWO = db.prepare(`
    INSERT INTO work_orders
      (id, work_order_number, part_number, part_name, quantity, quantity_completed,
       app_id, department_id, scheduled_start, scheduled_end, takt_time_minutes,
       status, priority, notes, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
  `);

  const orders = [
    {
      work_order_number: 'WO-2024-001',
      part_number:       'WGT-BASE-001',
      part_name:         'Widget Base Plate Assembly',
      quantity:          50,
      quantity_completed: 32,
      department:        'Assembly',
      scheduled_start:   isoOffset(-2),
      scheduled_end:     isoOffset(1),
      takt_time_minutes: 18,
      status:            'in_progress',
      priority:          'high',
      notes:             'Priority run for Q4 customer order. Maintain takt discipline.',
    },
    {
      work_order_number: 'WO-2024-002',
      part_number:       'WGT-PANEL-L',
      part_name:         'Left Side Panel Sub-Assembly',
      quantity:          100,
      quantity_completed: 100,
      department:        'Assembly',
      scheduled_start:   isoOffset(-5),
      scheduled_end:     isoOffset(-1),
      takt_time_minutes: 12,
      status:            'completed',
      priority:          'medium',
      notes:             'Routine production run. All units passed QC.',
    },
    {
      work_order_number: 'WO-2024-003',
      part_number:       'GSKT-SIL-01',
      part_name:         'Silicone Gasket Inspection Lot',
      quantity:          200,
      quantity_completed: 80,
      department:        'Quality Control',
      scheduled_start:   isoOffset(-1),
      scheduled_end:     isoOffset(2),
      takt_time_minutes: 5,
      status:            'in_progress',
      priority:          'critical',
      notes:             'Incoming inspection — supplier quality issue flagged last week.',
    },
    {
      work_order_number: 'WO-2024-004',
      part_number:       'BOLT-M6-20',
      part_name:         'M6 Fastener Kit Packaging',
      quantity:          75,
      quantity_completed: 0,
      department:        'Packaging',
      scheduled_start:   isoOffset(1),
      scheduled_end:     isoOffset(3),
      takt_time_minutes: 8,
      status:            'pending',
      priority:          'low',
      notes:             'Standard packaging run, no special requirements.',
    },
    {
      work_order_number: 'WO-2024-005',
      part_number:       'WGT-BASE-001',
      part_name:         'Widget Base Plate Assembly — Rework',
      quantity:          20,
      quantity_completed: 5,
      department:        'Assembly',
      scheduled_start:   isoOffset(-3),
      scheduled_end:     isoOffset(0, 17),
      takt_time_minutes: 22,
      status:            'overdue',
      priority:          'high',
      notes:             'Rework lot from WO-2024-001 defect escape. Expedite.',
    },
  ];

  for (const o of orders) {
    insertWO.run(
      uuidv4(),
      o.work_order_number,
      o.part_number,
      o.part_name,
      o.quantity,
      o.quantity_completed,
      appId || null,
      deptIds[o.department] || null,
      o.scheduled_start,
      o.scheduled_end,
      o.takt_time_minutes,
      o.status,
      o.priority,
      o.notes
    );
  }
}

// ─── Run seed ─────────────────────────────────────────────────────────────────

const seededAppId  = seedAppData();
const seededDeptIds = seedDepartments();
seedWorkOrders(seededAppId, seededDeptIds);

module.exports = db;

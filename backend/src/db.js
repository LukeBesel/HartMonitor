const Database = require('better-sqlite3');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const DB_PATH = path.join(__dirname, '..', 'mes.db');
const db = new Database(DB_PATH);

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

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

function seedDemoData() {
  const appCount = db.prepare('SELECT COUNT(*) as c FROM apps').get();
  if (appCount.c > 0) return;

  const appId = uuidv4();
  const steps = [
    {
      id: uuidv4(),
      name: 'Safety Check',
      order: 0,
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
      widgets: [
        { id: uuidv4(), type: 'text', order: 0, label: '', config: { text: 'Perform final quality inspection', fontSize: 18, fontWeight: 'bold', color: '#111827' } },
        { id: uuidv4(), type: 'pass-fail', order: 1, label: 'Dimensional Check', config: { variableName: 'dim_check' } },
        { id: uuidv4(), type: 'pass-fail', order: 2, label: 'Functional Test', config: { variableName: 'func_test' } },
        { id: uuidv4(), type: 'text-input', order: 3, label: 'Inspector Notes', config: { variableName: 'inspector_notes', placeholder: 'Enter any observations...' } },
        { id: uuidv4(), type: 'button', order: 4, label: '', config: { buttonText: 'Complete Process', buttonType: 'complete', buttonColor: '#22c55e' } }
      ]
    }
  ];

  db.prepare(`INSERT INTO apps (id, name, description, status, steps) VALUES (?, ?, ?, ?, ?)`).run(
    appId,
    'Widget Assembly Process',
    'Standard assembly process for widget production line',
    'published',
    JSON.stringify(steps)
  );

  const station1Id = uuidv4();
  const station2Id = uuidv4();
  db.prepare(`INSERT INTO stations (id, name, description, location, current_app_id) VALUES (?, ?, ?, ?, ?)`).run(
    station1Id, 'Assembly Station A1', 'Primary assembly workstation', 'Building A - Floor 1', appId
  );
  db.prepare(`INSERT INTO stations (id, name, description, location) VALUES (?, ?, ?, ?)`).run(
    station2Id, 'QC Inspection Bench', 'Quality control inspection area', 'Building A - Floor 1'
  );

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
      db.prepare(`INSERT INTO completions (id, app_id, app_name, station_id, operator_name, started_at, completed_at, status, data, step_times) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
        uuidv4(), appId, 'Widget Assembly Process',
        Math.random() > 0.5 ? station1Id : station2Id,
        operators[Math.floor(Math.random() * operators.length)],
        startTime.toISOString(), endTime.toISOString(), 'completed',
        JSON.stringify({ serial_number: `SN-${Date.now()}-${j}`, part_condition: 'Good', visual_inspection: passFail, dim_check: passFail, func_test: passFail, bolt_count: 8, torque_value: 15, ppe_worn: true, area_clear: true }),
        JSON.stringify({ 0: 45 + Math.random() * 30, 1: 120 + Math.random() * 60, 2: 300 + Math.random() * 120, 3: 180 + Math.random() * 90 })
      );
    }
  }

  const tableId = uuidv4();
  db.prepare(`INSERT INTO tables (id, name, description, fields) VALUES (?, ?, ?, ?)`).run(
    tableId, 'Part Inventory',
    'Master list of parts used in assembly',
    JSON.stringify([
      { id: uuidv4(), name: 'Part Number', type: 'text' },
      { id: uuidv4(), name: 'Description', type: 'text' },
      { id: uuidv4(), name: 'Quantity', type: 'number' },
      { id: uuidv4(), name: 'Reorder Point', type: 'number' },
      { id: uuidv4(), name: 'Active', type: 'boolean' }
    ])
  );

  const parts = [
    { 'Part Number': 'WGT-BASE-001', 'Description': 'Widget Base Plate', 'Quantity': 150, 'Reorder Point': 50, 'Active': true },
    { 'Part Number': 'WGT-PANEL-L', 'Description': 'Left Side Panel', 'Quantity': 200, 'Reorder Point': 75, 'Active': true },
    { 'Part Number': 'WGT-PANEL-R', 'Description': 'Right Side Panel', 'Quantity': 195, 'Reorder Point': 75, 'Active': true },
    { 'Part Number': 'BOLT-M6-20', 'Description': 'M6 x 20mm Bolt', 'Quantity': 2400, 'Reorder Point': 500, 'Active': true },
    { 'Part Number': 'GSKT-SIL-01', 'Description': 'Silicone Gasket', 'Quantity': 45, 'Reorder Point': 100, 'Active': true },
  ];
  for (const part of parts) {
    db.prepare(`INSERT INTO table_records (id, table_id, data) VALUES (?, ?, ?)`).run(uuidv4(), tableId, JSON.stringify(part));
  }
}

seedDemoData();

module.exports = db;

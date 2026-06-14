const Database = require('better-sqlite3');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const DB_PATH = path.join(__dirname, '..', 'mes.db');
const db = new Database(DB_PATH);

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// ─── Core tables ──────────────────────────────────────────────────────────────

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

// ─── Migrations: completions ──────────────────────────────────────────────────

const completionCols = db.prepare('PRAGMA table_info(completions)').all().map(r => r.name);
if (!completionCols.includes('work_order_id'))       db.exec('ALTER TABLE completions ADD COLUMN work_order_id TEXT');
if (!completionCols.includes('takt_exceeded_steps')) db.exec("ALTER TABLE completions ADD COLUMN takt_exceeded_steps TEXT DEFAULT '[]'");
if (!completionCols.includes('product_type_id'))     db.exec('ALTER TABLE completions ADD COLUMN product_type_id TEXT');

// ─── Migrations: stations ─────────────────────────────────────────────────────

const stationCols = db.prepare('PRAGMA table_info(stations)').all().map(r => r.name);
if (!stationCols.includes('planned_hours_per_day'))  db.exec('ALTER TABLE stations ADD COLUMN planned_hours_per_day REAL DEFAULT 8');
if (!stationCols.includes('ideal_cycle_seconds'))    db.exec('ALTER TABLE stations ADD COLUMN ideal_cycle_seconds REAL DEFAULT 0');
if (!stationCols.includes('current_status'))         db.exec("ALTER TABLE stations ADD COLUMN current_status TEXT DEFAULT 'idle'");
if (!stationCols.includes('current_status_since'))   db.exec('ALTER TABLE stations ADD COLUMN current_status_since TEXT');

// ─── Operations tables ────────────────────────────────────────────────────────

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

// ─── Migrations: stations → departments, department headcount ────────────────

if (!stationCols.includes('department_id'))
  db.exec('ALTER TABLE stations ADD COLUMN department_id TEXT REFERENCES departments(id) ON DELETE SET NULL');

const deptCols = db.prepare('PRAGMA table_info(departments)').all().map(r => r.name);
if (!deptCols.includes('headcount')) db.exec('ALTER TABLE departments ADD COLUMN headcount INTEGER DEFAULT 0');

db.exec(`
  CREATE INDEX IF NOT EXISTS idx_stations_department    ON stations(department_id);
  CREATE INDEX IF NOT EXISTS idx_completions_station    ON completions(station_id);
  CREATE INDEX IF NOT EXISTS idx_completions_work_order ON completions(work_order_id);
  CREATE INDEX IF NOT EXISTS idx_completions_completed  ON completions(status, completed_at);
`);

// ─── ERP / Inventory tables ───────────────────────────────────────────────────

db.exec(`
  CREATE TABLE IF NOT EXISTS company_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS plan (
    id INTEGER PRIMARY KEY DEFAULT 1,
    tier TEXT NOT NULL DEFAULT 'free',
    app_limit INTEGER NOT NULL DEFAULT 5,
    dashboard_limit INTEGER NOT NULL DEFAULT 2,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS items (
    id TEXT PRIMARY KEY,
    sku TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    description TEXT DEFAULT '',
    category TEXT DEFAULT 'General',
    unit_of_measure TEXT DEFAULT 'ea',
    unit_cost REAL DEFAULT 0,
    reorder_point REAL DEFAULT 0,
    reorder_qty REAL DEFAULT 0,
    lead_time_days INTEGER DEFAULT 7,
    is_active INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS locations (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    code TEXT UNIQUE NOT NULL,
    description TEXT DEFAULT '',
    type TEXT DEFAULT 'warehouse',
    is_active INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS stock_levels (
    id TEXT PRIMARY KEY,
    item_id TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
    location_id TEXT NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
    quantity REAL DEFAULT 0,
    updated_at TEXT DEFAULT (datetime('now')),
    UNIQUE(item_id, location_id)
  );

  CREATE TABLE IF NOT EXISTS stock_movements (
    id TEXT PRIMARY KEY,
    item_id TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
    location_id TEXT REFERENCES locations(id),
    movement_type TEXT NOT NULL,
    quantity REAL NOT NULL,
    unit_cost REAL DEFAULT 0,
    reference_type TEXT DEFAULT '',
    reference_id TEXT DEFAULT '',
    notes TEXT DEFAULT '',
    operator_name TEXT DEFAULT '',
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS vendors (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    code TEXT UNIQUE NOT NULL,
    contact_name TEXT DEFAULT '',
    email TEXT DEFAULT '',
    phone TEXT DEFAULT '',
    address TEXT DEFAULT '',
    payment_terms TEXT DEFAULT 'net30',
    lead_time_days INTEGER DEFAULT 14,
    rating INTEGER DEFAULT 3,
    notes TEXT DEFAULT '',
    is_active INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS purchase_orders (
    id TEXT PRIMARY KEY,
    po_number TEXT UNIQUE NOT NULL,
    vendor_id TEXT NOT NULL REFERENCES vendors(id),
    status TEXT NOT NULL DEFAULT 'draft',
    order_date TEXT NOT NULL,
    expected_date TEXT,
    received_date TEXT,
    shipping_cost REAL DEFAULT 0,
    notes TEXT DEFAULT '',
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS po_lines (
    id TEXT PRIMARY KEY,
    po_id TEXT NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
    item_id TEXT NOT NULL REFERENCES items(id),
    quantity_ordered REAL NOT NULL,
    quantity_received REAL DEFAULT 0,
    unit_cost REAL NOT NULL DEFAULT 0,
    notes TEXT DEFAULT ''
  );

  CREATE TABLE IF NOT EXISTS ncrs (
    id TEXT PRIMARY KEY,
    ncr_number TEXT UNIQUE NOT NULL,
    title TEXT NOT NULL,
    description TEXT DEFAULT '',
    severity TEXT NOT NULL DEFAULT 'minor',
    status TEXT NOT NULL DEFAULT 'open',
    source TEXT DEFAULT 'production',
    app_id TEXT REFERENCES apps(id) ON DELETE SET NULL,
    completion_id TEXT REFERENCES completions(id) ON DELETE SET NULL,
    work_order_id TEXT REFERENCES work_orders(id) ON DELETE SET NULL,
    item_id TEXT REFERENCES items(id) ON DELETE SET NULL,
    assigned_to TEXT DEFAULT '',
    root_cause TEXT DEFAULT '',
    corrective_action TEXT DEFAULT '',
    due_date TEXT,
    resolved_at TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS ncr_comments (
    id TEXT PRIMARY KEY,
    ncr_id TEXT NOT NULL REFERENCES ncrs(id) ON DELETE CASCADE,
    author TEXT NOT NULL,
    body TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS activity_log (
    id TEXT PRIMARY KEY,
    company_id TEXT REFERENCES organizations(id),
    entity_type TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    action TEXT NOT NULL,
    actor TEXT DEFAULT '',
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_activity_log_entity ON activity_log(entity_type, entity_id);
`);

// ─── Migrations: plan (à-la-carte add-on slots) ──────────────────────────────

const planCols = db.prepare('PRAGMA table_info(plan)').all().map(r => r.name);
if (!planCols.includes('extra_app_slots'))       db.exec('ALTER TABLE plan ADD COLUMN extra_app_slots INTEGER NOT NULL DEFAULT 0');
if (!planCols.includes('extra_dashboard_slots')) db.exec('ALTER TABLE plan ADD COLUMN extra_dashboard_slots INTEGER NOT NULL DEFAULT 0');
if (!planCols.includes('billing_email'))         db.exec("ALTER TABLE plan ADD COLUMN billing_email TEXT DEFAULT ''");
// Stripe billing linkage (populated only when real payments are configured)
if (!planCols.includes('stripe_customer_id'))     db.exec('ALTER TABLE plan ADD COLUMN stripe_customer_id TEXT');
if (!planCols.includes('stripe_subscription_id')) db.exec('ALTER TABLE plan ADD COLUMN stripe_subscription_id TEXT');
if (!planCols.includes('subscription_status'))    db.exec("ALTER TABLE plan ADD COLUMN subscription_status TEXT DEFAULT ''");

db.exec(`
  CREATE TABLE IF NOT EXISTS billing_history (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL CHECK(type IN ('tier_change','app_slot','dashboard_slot','refund')),
    description TEXT NOT NULL,
    quantity INTEGER NOT NULL DEFAULT 1,
    unit_price REAL NOT NULL DEFAULT 0,
    amount REAL NOT NULL DEFAULT 0,
    recurring INTEGER NOT NULL DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now'))
  );
`);

// ─── Auth tables ──────────────────────────────────────────────────────────────

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT UNIQUE NOT NULL,
    display_name TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'viewer' CHECK(role IN ('developer','manager','supervisor','operator','viewer')),
    is_active INTEGER NOT NULL DEFAULT 1,
    last_login TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token TEXT UNIQUE NOT NULL,
    expires_at TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now'))
  );
`);

// ─── Multi-tenancy: organizations, per-org settings, schema meta ──────────────

db.exec(`
  CREATE TABLE IF NOT EXISTS organizations (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    slug TEXT UNIQUE,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS org_settings (
    company_id TEXT NOT NULL,
    key TEXT NOT NULL,
    value TEXT NOT NULL,
    updated_at TEXT DEFAULT (datetime('now')),
    PRIMARY KEY (company_id, key)
  );

  CREATE TABLE IF NOT EXISTS schema_meta (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
`);

// ─── Live broadcast messages ──────────────────────────────────────────────────

db.exec(`
  CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY,
    company_id TEXT REFERENCES organizations(id),
    sender_id TEXT REFERENCES users(id),
    sender_name TEXT NOT NULL,
    sender_role TEXT NOT NULL DEFAULT '',
    body TEXT NOT NULL,
    severity TEXT NOT NULL DEFAULT 'info' CHECK(severity IN ('info','warning','urgent')),
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_messages_company ON messages(company_id, created_at);
`);

// ─── Migrations: company_id on every directly-scoped table ────────────────────
// Child tables (table_records, machine_events, stock_levels, stock_movements,
// po_lines, ncr_comments, sessions) scope through their parent instead.

const TENANT_TABLES = [
  'apps', 'completions', 'tables', 'stations', 'departments', 'work_orders',
  'dashboards', 'users', 'items', 'locations', 'vendors', 'purchase_orders',
  'ncrs', 'product_types', 'billing_history', 'plan',
];
for (const t of TENANT_TABLES) {
  const cols = db.prepare(`PRAGMA table_info(${t})`).all().map(r => r.name);
  if (!cols.includes('company_id')) db.exec(`ALTER TABLE ${t} ADD COLUMN company_id TEXT REFERENCES organizations(id)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_${t}_company ON ${t}(company_id)`);
}

// ─── Migration: per-company unique constraints ────────────────────────────────
// work_order_number, sku, location code, vendor code, po_number and ncr_number
// were globally UNIQUE. Rebuild each table with UNIQUE(company_id, <col>) so
// every organization gets its own numbering space. One-time, guarded by a
// schema_meta flag. users.email intentionally stays globally unique (login has
// no org discriminator).

const uniqueRebuilt = db.prepare("SELECT value FROM schema_meta WHERE key = 'tenant_unique_rebuild'").get();
if (!uniqueRebuilt) {
  const REBUILDS = [
    {
      table: 'work_orders',
      columns: ['id', 'work_order_number', 'part_number', 'part_name', 'quantity', 'quantity_completed', 'app_id', 'department_id', 'scheduled_start', 'scheduled_end', 'takt_time_minutes', 'status', 'priority', 'notes', 'created_at', 'updated_at', 'company_id'],
      create: `CREATE TABLE work_orders_new (
        id TEXT PRIMARY KEY,
        work_order_number TEXT NOT NULL,
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
        updated_at TEXT DEFAULT (datetime('now')),
        company_id TEXT REFERENCES organizations(id),
        UNIQUE(company_id, work_order_number)
      )`,
    },
    {
      table: 'items',
      columns: ['id', 'sku', 'name', 'description', 'category', 'unit_of_measure', 'unit_cost', 'reorder_point', 'reorder_qty', 'lead_time_days', 'is_active', 'created_at', 'updated_at', 'company_id'],
      create: `CREATE TABLE items_new (
        id TEXT PRIMARY KEY,
        sku TEXT NOT NULL,
        name TEXT NOT NULL,
        description TEXT DEFAULT '',
        category TEXT DEFAULT 'General',
        unit_of_measure TEXT DEFAULT 'ea',
        unit_cost REAL DEFAULT 0,
        reorder_point REAL DEFAULT 0,
        reorder_qty REAL DEFAULT 0,
        lead_time_days INTEGER DEFAULT 7,
        is_active INTEGER DEFAULT 1,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now')),
        company_id TEXT REFERENCES organizations(id),
        UNIQUE(company_id, sku)
      )`,
    },
    {
      table: 'locations',
      columns: ['id', 'name', 'code', 'description', 'type', 'is_active', 'created_at', 'company_id'],
      create: `CREATE TABLE locations_new (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        code TEXT NOT NULL,
        description TEXT DEFAULT '',
        type TEXT DEFAULT 'warehouse',
        is_active INTEGER DEFAULT 1,
        created_at TEXT DEFAULT (datetime('now')),
        company_id TEXT REFERENCES organizations(id),
        UNIQUE(company_id, code)
      )`,
    },
    {
      table: 'vendors',
      columns: ['id', 'name', 'code', 'contact_name', 'email', 'phone', 'address', 'payment_terms', 'lead_time_days', 'rating', 'notes', 'is_active', 'created_at', 'updated_at', 'company_id'],
      create: `CREATE TABLE vendors_new (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        code TEXT NOT NULL,
        contact_name TEXT DEFAULT '',
        email TEXT DEFAULT '',
        phone TEXT DEFAULT '',
        address TEXT DEFAULT '',
        payment_terms TEXT DEFAULT 'net30',
        lead_time_days INTEGER DEFAULT 14,
        rating INTEGER DEFAULT 3,
        notes TEXT DEFAULT '',
        is_active INTEGER DEFAULT 1,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now')),
        company_id TEXT REFERENCES organizations(id),
        UNIQUE(company_id, code)
      )`,
    },
    {
      table: 'purchase_orders',
      columns: ['id', 'po_number', 'vendor_id', 'status', 'order_date', 'expected_date', 'received_date', 'shipping_cost', 'notes', 'created_at', 'updated_at', 'company_id'],
      create: `CREATE TABLE purchase_orders_new (
        id TEXT PRIMARY KEY,
        po_number TEXT NOT NULL,
        vendor_id TEXT NOT NULL REFERENCES vendors(id),
        status TEXT NOT NULL DEFAULT 'draft',
        order_date TEXT NOT NULL,
        expected_date TEXT,
        received_date TEXT,
        shipping_cost REAL DEFAULT 0,
        notes TEXT DEFAULT '',
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now')),
        company_id TEXT REFERENCES organizations(id),
        UNIQUE(company_id, po_number)
      )`,
    },
    {
      table: 'ncrs',
      columns: ['id', 'ncr_number', 'title', 'description', 'severity', 'status', 'source', 'app_id', 'completion_id', 'work_order_id', 'item_id', 'assigned_to', 'root_cause', 'corrective_action', 'due_date', 'resolved_at', 'created_at', 'updated_at', 'company_id'],
      create: `CREATE TABLE ncrs_new (
        id TEXT PRIMARY KEY,
        ncr_number TEXT NOT NULL,
        title TEXT NOT NULL,
        description TEXT DEFAULT '',
        severity TEXT NOT NULL DEFAULT 'minor',
        status TEXT NOT NULL DEFAULT 'open',
        source TEXT DEFAULT 'production',
        app_id TEXT REFERENCES apps(id) ON DELETE SET NULL,
        completion_id TEXT REFERENCES completions(id) ON DELETE SET NULL,
        work_order_id TEXT REFERENCES work_orders(id) ON DELETE SET NULL,
        item_id TEXT REFERENCES items(id) ON DELETE SET NULL,
        assigned_to TEXT DEFAULT '',
        root_cause TEXT DEFAULT '',
        corrective_action TEXT DEFAULT '',
        due_date TEXT,
        resolved_at TEXT,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now')),
        company_id TEXT REFERENCES organizations(id),
        UNIQUE(company_id, ncr_number)
      )`,
    },
  ];

  db.pragma('foreign_keys = OFF');
  const rebuildAll = db.transaction(() => {
    for (const r of REBUILDS) {
      const cols = r.columns.join(', ');
      db.exec(r.create);
      db.exec(`INSERT INTO ${r.table}_new (${cols}) SELECT ${cols} FROM ${r.table}`);
      db.exec(`DROP TABLE ${r.table}`);
      db.exec(`ALTER TABLE ${r.table}_new RENAME TO ${r.table}`);
      db.exec(`CREATE INDEX IF NOT EXISTS idx_${r.table}_company ON ${r.table}(company_id)`);
    }
    db.prepare(`INSERT INTO schema_meta (key, value) VALUES ('tenant_unique_rebuild', '1')`).run();
  });
  rebuildAll();
  db.pragma('foreign_keys = ON');
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function isoOffset(days, hours = 8) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  d.setHours(hours, 0, 0, 0);
  return d.toISOString();
}

function daysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString();
}

// ─── Seed: plan ───────────────────────────────────────────────────────────────

function seedPlan() {
  const existing = db.prepare('SELECT id FROM plan LIMIT 1').get();
  if (!existing) {
    db.prepare(`INSERT INTO plan (tier, app_limit, dashboard_limit) VALUES ('free', 5, 2)`).run();
  }
}

// ─── Seed: company settings ───────────────────────────────────────────────────

function seedCompanySettings() {
  const existing = db.prepare("SELECT key FROM company_settings WHERE key = 'company_name'").get();
  if (existing) return;
  const settings = [
    ['company_name',    'HartMonitor Demo Co'],
    ['company_industry','Electronics Manufacturing'],
    ['company_address', '1234 Industrial Blvd, Suite 200, Detroit, MI 48201'],
    ['company_phone',   '+1 (313) 555-0147'],
    ['company_email',   'ops@hartmonitor.demo'],
    ['timezone',        'America/Detroit'],
    ['date_format',     'MM/DD/YYYY'],
    ['currency',        'USD'],
    ['logo_url',        ''],
    ['fiscal_year_start','01'],
  ];
  const ins = db.prepare(`INSERT OR IGNORE INTO company_settings (key, value) VALUES (?, ?)`);
  for (const [k, v] of settings) ins.run(k, v);
}

// ─── Seed: apps, stations, completions ───────────────────────────────────────

function seedAppData() {
  if (db.prepare('SELECT COUNT(*) as c FROM apps').get().c > 0) return null;

  const appId = uuidv4();
  const steps = [
    {
      id: uuidv4(), name: 'Safety Check', order: 0, takt_time: 60,
      widgets: [
        { id: uuidv4(), type: 'instruction', order: 0, label: 'Safety Instructions', config: { content: 'Ensure all safety equipment is in place before starting. Wear PPE including gloves and safety glasses.', backgroundColor: '#fef3c7' } },
        { id: uuidv4(), type: 'checkbox', order: 1, label: 'PPE Worn', config: { required: true, variableName: 'ppe_worn' } },
        { id: uuidv4(), type: 'checkbox', order: 2, label: 'Work Area Clear', config: { required: true, variableName: 'area_clear' } },
        { id: uuidv4(), type: 'button', order: 3, label: '', config: { buttonText: 'Proceed to Assembly', buttonType: 'next', buttonColor: '#22c55e' } }
      ]
    },
    {
      id: uuidv4(), name: 'Part Inspection', order: 1, takt_time: 120,
      widgets: [
        { id: uuidv4(), type: 'text', order: 0, label: '', config: { text: 'Inspect incoming parts for defects before assembly.', fontSize: 16, color: '#374151' } },
        { id: uuidv4(), type: 'select-input', order: 1, label: 'Part Condition', config: { required: true, variableName: 'part_condition', options: ['Good', 'Minor Defect', 'Major Defect', 'Reject'] } },
        { id: uuidv4(), type: 'text-input', order: 2, label: 'Part Serial Number', config: { required: true, variableName: 'serial_number', placeholder: 'Scan or enter serial number' } },
        { id: uuidv4(), type: 'pass-fail', order: 3, label: 'Visual Inspection', config: { variableName: 'visual_inspection' } },
        { id: uuidv4(), type: 'button', order: 4, label: '', config: { buttonText: 'Next Step', buttonType: 'next', buttonColor: '#3b82f6' } }
      ]
    },
    {
      id: uuidv4(), name: 'Assembly', order: 2, takt_time: 300,
      widgets: [
        { id: uuidv4(), type: 'instruction', order: 0, label: 'Assembly Instructions', config: { content: '1. Place base component on fixture\n2. Apply torque to 15 Nm\n3. Attach side panels using M6 bolts\n4. Verify alignment before final tightening', backgroundColor: '#eff6ff' } },
        { id: uuidv4(), type: 'counter', order: 1, label: 'Bolt Count', config: { variableName: 'bolt_count', min: 0, max: 8, step: 1, initialValue: 0 } },
        { id: uuidv4(), type: 'number-input', order: 2, label: 'Torque Value (Nm)', config: { required: true, variableName: 'torque_value', placeholder: '15' } },
        { id: uuidv4(), type: 'button', order: 3, label: '', config: { buttonText: 'Assembly Complete', buttonType: 'next', buttonColor: '#3b82f6' } }
      ]
    },
    {
      id: uuidv4(), name: 'Quality Check', order: 3, takt_time: 180,
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

  const s1 = uuidv4(), s2 = uuidv4();
  db.prepare(`INSERT INTO stations (id, name, description, location, current_app_id) VALUES (?, ?, ?, ?, ?)`)
    .run(s1, 'Assembly Station A1', 'Primary assembly workstation', 'Building A - Floor 1', appId);
  db.prepare(`INSERT INTO stations (id, name, description, location) VALUES (?, ?, ?, ?)`)
    .run(s2, 'QC Inspection Bench', 'Quality control inspection area', 'Building A - Floor 1');

  const operators = ['Alice Johnson', 'Bob Martinez', 'Carol Chen', 'David Kim', 'Emma Davis'];
  const now = new Date();
  for (let i = 30; i >= 0; i--) {
    const date = new Date(now);
    date.setDate(date.getDate() - i);
    const perDay = Math.floor(Math.random() * 8) + 3;
    for (let j = 0; j < perDay; j++) {
      const start = new Date(date);
      start.setHours(7 + Math.floor(Math.random() * 9));
      start.setMinutes(Math.floor(Math.random() * 60));
      const cycleMin = 15 + Math.floor(Math.random() * 25);
      const end = new Date(start.getTime() + cycleMin * 60000);
      const pf = Math.random() > 0.08 ? 'Pass' : 'Fail';
      db.prepare(`
        INSERT INTO completions (id, app_id, app_name, station_id, operator_name, started_at, completed_at, status, data, step_times, takt_exceeded_steps)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        uuidv4(), appId, 'Widget Assembly Process',
        Math.random() > 0.5 ? s1 : s2,
        operators[Math.floor(Math.random() * operators.length)],
        start.toISOString(), end.toISOString(), 'completed',
        JSON.stringify({ serial_number: `SN-${Date.now()}-${j}`, part_condition: 'Good', visual_inspection: pf, dim_check: pf, func_test: pf, bolt_count: 8, torque_value: 15, ppe_worn: true, area_clear: true }),
        JSON.stringify({ 0: 45 + Math.random() * 30, 1: 110 + Math.random() * 60, 2: 290 + Math.random() * 120, 3: 170 + Math.random() * 90 }),
        JSON.stringify([])
      );
    }
  }

  const tableId = uuidv4();
  db.prepare(`INSERT INTO tables (id, name, description, fields) VALUES (?, ?, ?, ?)`)
    .run(tableId, 'Assembly Specs', 'Reference specs for assembly operations', JSON.stringify([
      { id: uuidv4(), name: 'Part Number', type: 'text' },
      { id: uuidv4(), name: 'Torque Spec (Nm)', type: 'number' },
      { id: uuidv4(), name: 'Bolt Count', type: 'number' },
      { id: uuidv4(), name: 'Rev Level', type: 'text' },
      { id: uuidv4(), name: 'Active', type: 'boolean' },
    ]));
  for (const r of [
    { 'Part Number': 'WGT-BASE-001', 'Torque Spec (Nm)': 15, 'Bolt Count': 8, 'Rev Level': 'C', 'Active': true },
    { 'Part Number': 'WGT-PANEL-L',  'Torque Spec (Nm)': 10, 'Bolt Count': 6, 'Rev Level': 'B', 'Active': true },
    { 'Part Number': 'WGT-PANEL-R',  'Torque Spec (Nm)': 10, 'Bolt Count': 6, 'Rev Level': 'B', 'Active': true },
  ]) db.prepare(`INSERT INTO table_records (id, table_id, data) VALUES (?, ?, ?)`).run(uuidv4(), tableId, JSON.stringify(r));

  return { appId, s1, s2 };
}

// ─── Seed: departments ────────────────────────────────────────────────────────

function seedDepartments() {
  if (db.prepare('SELECT COUNT(*) as c FROM departments').get().c > 0) return null;
  const depts = [
    { name: 'Assembly',        description: 'Final product assembly operations',  manager_name: 'Tom Rivera',   color: '#3b82f6' },
    { name: 'Quality Control', description: 'Inspection and quality assurance',   manager_name: 'Sarah Nguyen', color: '#10b981' },
    { name: 'Packaging',       description: 'Product packaging and labeling',     manager_name: 'James Patel',  color: '#f59e0b' },
    { name: 'Maintenance',     description: 'Equipment maintenance and repair',   manager_name: 'Linda Okafor', color: '#ef4444' },
  ];
  const ins = db.prepare(`INSERT INTO departments (id, name, description, manager_name, color) VALUES (?, ?, ?, ?, ?)`);
  const ids = {};
  for (const d of depts) { const id = uuidv4(); ins.run(id, d.name, d.description, d.manager_name, d.color); ids[d.name] = id; }
  return ids;
}

// ─── Seed: work orders ────────────────────────────────────────────────────────

function seedWorkOrders(appId, deptIds) {
  if (db.prepare('SELECT COUNT(*) as c FROM work_orders').get().c > 0) return;
  if (!appId) appId = db.prepare('SELECT id FROM apps LIMIT 1').get()?.id;
  if (!deptIds) {
    const rows = db.prepare('SELECT id, name FROM departments').all();
    deptIds = {};
    for (const r of rows) deptIds[r.name] = r.id;
  }
  const ins = db.prepare(`
    INSERT INTO work_orders (id, work_order_number, part_number, part_name, quantity, quantity_completed, app_id, department_id, scheduled_start, scheduled_end, takt_time_minutes, status, priority, notes, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
  `);
  for (const o of [
    { wo: 'WO-2024-001', pn: 'WGT-BASE-001', nm: 'Widget Base Plate Assembly',          qty: 50,  qc: 32,  dept: 'Assembly',        ss: isoOffset(-2),    se: isoOffset(1),        takt: 18, st: 'in_progress', pri: 'high',     notes: 'Priority run for Q4 customer order.' },
    { wo: 'WO-2024-002', pn: 'WGT-PANEL-L',  nm: 'Left Side Panel Sub-Assembly',        qty: 100, qc: 100, dept: 'Assembly',        ss: isoOffset(-5),    se: isoOffset(-1),       takt: 12, st: 'completed',  pri: 'medium',   notes: 'Routine production run. All units passed QC.' },
    { wo: 'WO-2024-003', pn: 'GSKT-SIL-01',  nm: 'Silicone Gasket Inspection Lot',      qty: 200, qc: 80,  dept: 'Quality Control', ss: isoOffset(-1),    se: isoOffset(2),        takt: 5,  st: 'in_progress', pri: 'critical', notes: 'Incoming inspection — supplier quality issue flagged.' },
    { wo: 'WO-2024-004', pn: 'BOLT-M6-20',   nm: 'M6 Fastener Kit Packaging',           qty: 75,  qc: 0,   dept: 'Packaging',       ss: isoOffset(1),     se: isoOffset(3),        takt: 8,  st: 'pending',    pri: 'low',      notes: 'Standard packaging run.' },
    { wo: 'WO-2024-005', pn: 'WGT-BASE-001', nm: 'Widget Base Plate Assembly — Rework', qty: 20,  qc: 5,   dept: 'Assembly',        ss: isoOffset(-3),    se: isoOffset(0, 17),    takt: 22, st: 'overdue',    pri: 'high',     notes: 'Rework lot from WO-2024-001 defect escape. Expedite.' },
    { wo: 'WO-2024-006', pn: 'MTR-DC-12V',   nm: 'DC Motor Drive Assembly',             qty: 30,  qc: 0,   dept: 'Assembly',        ss: isoOffset(2),     se: isoOffset(5),        takt: 25, st: 'pending',    pri: 'medium',   notes: 'New product launch support.' },
  ]) ins.run(uuidv4(), o.wo, o.pn, o.nm, o.qty, o.qc, appId || null, deptIds[o.dept] || null, o.ss, o.se, o.takt, o.st, o.pri, o.notes);
}

// ─── Seed: inventory ─────────────────────────────────────────────────────────

function seedInventory() {
  if (db.prepare('SELECT COUNT(*) as c FROM items').get().c > 0) return null;

  // Locations
  const locMWH = uuidv4(), locAFL = uuidv4(), locQCH = uuidv4(), locFGS = uuidv4();
  const insLoc = db.prepare(`INSERT INTO locations (id, name, code, description, type) VALUES (?, ?, ?, ?, ?)`);
  insLoc.run(locMWH, 'Main Warehouse',   'MWH', 'Primary storage warehouse',          'warehouse');
  insLoc.run(locAFL, 'Assembly Floor',   'AFL', 'Floor stock at assembly workstations','floor');
  insLoc.run(locQCH, 'QC Hold Area',     'QCH', 'Items under quality inspection',      'hold');
  insLoc.run(locFGS, 'Finished Goods',   'FGS', 'Completed products ready for ship',   'warehouse');

  // Items
  const itemDefs = [
    { sku: 'WGT-BASE-001', name: 'Widget Base Plate',         desc: 'Stamped steel base plate for widget assembly',            cat: 'Mechanical',   uom: 'ea',  cost: 4.25,  rop: 50,  roq: 200, ltd: 10 },
    { sku: 'WGT-PANEL-L',  name: 'Left Side Panel',           desc: 'Injection-molded ABS left panel',                        cat: 'Mechanical',   uom: 'ea',  cost: 2.80,  rop: 75,  roq: 300, ltd: 14 },
    { sku: 'WGT-PANEL-R',  name: 'Right Side Panel',          desc: 'Injection-molded ABS right panel',                       cat: 'Mechanical',   uom: 'ea',  cost: 2.80,  rop: 75,  roq: 300, ltd: 14 },
    { sku: 'BOLT-M6-20',   name: 'M6 × 20mm Hex Bolt',        desc: 'Grade 8.8 zinc-plated M6 bolt',                          cat: 'Fasteners',    uom: 'ea',  cost: 0.12,  rop: 500, roq: 2000,ltd: 5  },
    { sku: 'GSKT-SIL-01',  name: 'Silicone Gasket',           desc: '3mm silicone sealing gasket — under quality review',     cat: 'Seals',        uom: 'ea',  cost: 1.45,  rop: 100, roq: 500, ltd: 21 },
    { sku: 'MTR-DC-12V',   name: 'DC Motor 12V 50rpm',        desc: '12VDC brushless motor, 50 RPM output',                   cat: 'Electronics',  uom: 'ea',  cost: 18.50, rop: 25,  roq: 100, ltd: 30 },
    { sku: 'PCB-CTRL-V2',  name: 'Control PCB v2.1',          desc: 'Microcontroller board with sensor inputs',               cat: 'Electronics',  uom: 'ea',  cost: 34.00, rop: 50,  roq: 100, ltd: 45 },
    { sku: 'HSG-ABS-BLK',  name: 'ABS Housing — Black',       desc: 'Outer housing, black ABS, 150×80×40mm',                 cat: 'Mechanical',   uom: 'ea',  cost: 6.70,  rop: 40,  roq: 150, ltd: 21 },
    { sku: 'CONN-USB-C',   name: 'USB-C Connector 16-pin',    desc: 'SMD USB-C port, 16-pin dual orientation',                cat: 'Electronics',  uom: 'ea',  cost: 0.85,  rop: 200, roq: 1000,ltd: 14 },
    { sku: 'BRKT-STL-01',  name: 'Steel Mounting Bracket',    desc: 'L-bracket, 2mm steel, zinc plated',                     cat: 'Mechanical',   uom: 'ea',  cost: 1.10,  rop: 50,  roq: 200, ltd: 10 },
    { sku: 'SPRING-M8-C',  name: 'Compression Spring M8',     desc: '45mm free length, 0.9mm wire diameter',                 cat: 'Mechanical',   uom: 'ea',  cost: 0.65,  rop: 100, roq: 500, ltd: 7  },
    { sku: 'BEARING-6200', name: 'Deep Groove Ball Bearing',  desc: '6200-2RS, 10×30×9mm sealed',                            cat: 'Mechanical',   uom: 'ea',  cost: 2.20,  rop: 50,  roq: 200, ltd: 14 },
    { sku: 'SEAL-OR-25',   name: 'O-Ring 25mm ID',            desc: 'Nitrile O-ring, 25mm ID × 3mm CS',                      cat: 'Seals',        uom: 'ea',  cost: 0.30,  rop: 100, roq: 500, ltd: 7  },
    { sku: 'LABEL-4X6',    name: 'Thermal Label 4×6"',        desc: 'Direct thermal label, 4×6 inch, 250/roll',              cat: 'Packaging',    uom: 'roll',cost: 8.50,  rop: 10,  roq: 50,  ltd: 5  },
    { sku: 'BOX-MED-RSC',  name: 'Medium RSC Shipping Box',   desc: '12×10×6" corrugated box, 32ECT',                        cat: 'Packaging',    uom: 'ea',  cost: 0.95,  rop: 100, roq: 500, ltd: 5  },
  ];

  const insItem = db.prepare(`INSERT INTO items (id, sku, name, description, category, unit_of_measure, unit_cost, reorder_point, reorder_qty, lead_time_days) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const insSL = db.prepare(`INSERT INTO stock_levels (id, item_id, location_id, quantity) VALUES (?, ?, ?, ?)`);
  const insMov = db.prepare(`INSERT INTO stock_movements (id, item_id, location_id, movement_type, quantity, unit_cost, reference_type, notes, operator_name, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);

  const itemIds = {};
  const stockData = {
    'WGT-BASE-001': { [locMWH]: 142, [locAFL]: 18 },
    'WGT-PANEL-L':  { [locMWH]: 188, [locAFL]: 12 },
    'WGT-PANEL-R':  { [locMWH]: 192, [locAFL]: 12 },
    'BOLT-M6-20':   { [locMWH]: 2150,[locAFL]: 280 },
    'GSKT-SIL-01':  { [locMWH]: 38,  [locAFL]: 0,  [locQCH]: 200 },  // LOW STOCK
    'MTR-DC-12V':   { [locMWH]: 72,  [locAFL]: 8 },
    'PCB-CTRL-V2':  { [locMWH]: 43,  [locAFL]: 4 },  // NEAR REORDER
    'HSG-ABS-BLK':  { [locMWH]: 115, [locAFL]: 18 },
    'CONN-USB-C':   { [locMWH]: 480, [locAFL]: 45 },
    'BRKT-STL-01':  { [locMWH]: 75,  [locAFL]: 14 },
    'SPRING-M8-C':  { [locMWH]: 280, [locAFL]: 22 },
    'BEARING-6200': { [locMWH]: 145, [locAFL]: 18 },
    'SEAL-OR-25':   { [locMWH]: 235, [locAFL]: 28 },
    'LABEL-4X6':    { [locMWH]: 22,  [locAFL]: 3 },
    'BOX-MED-RSC':  { [locMWH]: 480, [locAFL]: 42 },
  };

  for (const def of itemDefs) {
    const id = uuidv4();
    insItem.run(id, def.sku, def.name, def.desc, def.cat, def.uom, def.cost, def.rop, def.roq, def.ltd);
    itemIds[def.sku] = id;
    const locs = stockData[def.sku] || {};
    for (const [locId, qty] of Object.entries(locs)) {
      insSL.run(uuidv4(), id, locId, qty);
    }
  }

  // Historical receives (last 30 days)
  const receiveData = [
    { sku: 'WGT-BASE-001', qty: 200, daysAgo: 25, cost: 4.25, ref: 'PO-2024-001', op: 'Maria Santos' },
    { sku: 'WGT-PANEL-L',  qty: 300, daysAgo: 25, cost: 2.80, ref: 'PO-2024-001', op: 'Maria Santos' },
    { sku: 'WGT-PANEL-R',  qty: 300, daysAgo: 25, cost: 2.80, ref: 'PO-2024-001', op: 'Maria Santos' },
    { sku: 'BOLT-M6-20',   qty: 5000,daysAgo: 20, cost: 0.12, ref: 'PO-2024-002', op: 'Carlos Ruiz' },
    { sku: 'PCB-CTRL-V2',  qty: 100, daysAgo: 15, cost: 34.00,ref: 'PO-2024-003', op: 'Maria Santos' },
    { sku: 'CONN-USB-C',   qty: 1000,daysAgo: 15, cost: 0.85, ref: 'PO-2024-003', op: 'Maria Santos' },
    { sku: 'MTR-DC-12V',   qty: 100, daysAgo: 10, cost: 18.50,ref: 'PO-2024-004', op: 'Carlos Ruiz' },
    { sku: 'BOX-MED-RSC',  qty: 500, daysAgo: 7,  cost: 0.95, ref: 'PO-2024-005', op: 'James Patel' },
    { sku: 'LABEL-4X6',    qty: 50,  daysAgo: 7,  cost: 8.50, ref: 'PO-2024-005', op: 'James Patel' },
  ];
  for (const r of receiveData) {
    const id = itemIds[r.sku];
    if (!id) continue;
    const d = new Date(); d.setDate(d.getDate() - r.daysAgo);
    insMov.run(uuidv4(), id, locMWH, 'receive', r.qty, r.cost, 'purchase_order', `Received from ${r.ref}`, r.op, d.toISOString());
  }

  // Historical consumes (last 14 days)
  const consumeSkus = ['WGT-BASE-001','WGT-PANEL-L','WGT-PANEL-R','BOLT-M6-20','GSKT-SIL-01','PCB-CTRL-V2','CONN-USB-C','BEARING-6200','SEAL-OR-25'];
  for (let day = 14; day >= 1; day--) {
    for (const sku of consumeSkus) {
      const id = itemIds[sku];
      if (!id) continue;
      const qty = Math.floor(Math.random() * 20) + 5;
      const d = new Date(); d.setDate(d.getDate() - day);
      insMov.run(uuidv4(), id, locAFL, 'consume', -qty, 0, 'work_order', 'Production consumption', 'System', d.toISOString());
    }
  }

  // A couple of adjustments
  const d1 = new Date(); d1.setDate(d1.getDate() - 5);
  insMov.run(uuidv4(), itemIds['GSKT-SIL-01'], locQCH, 'adjust', -12, 0, 'manual', 'Disposed — failed incoming inspection NCR-2024-002', 'Sarah Nguyen', d1.toISOString());
  const d2 = new Date(); d2.setDate(d2.getDate() - 3);
  insMov.run(uuidv4(), itemIds['PCB-CTRL-V2'],  locMWH, 'scrap',  -5,  34.0,'manual', 'Scrapped — defective batch from supplier NCR-2024-001', 'Sarah Nguyen', d2.toISOString());

  return { locMWH, locAFL, locQCH, locFGS, itemIds };
}

// ─── Seed: vendors and purchase orders ───────────────────────────────────────

function seedVendorsAndPOs(inventoryData) {
  if (db.prepare('SELECT COUNT(*) as c FROM vendors').get().c > 0) return;
  if (!inventoryData) return;

  const { locMWH, itemIds } = inventoryData;

  const vendors = [
    { id: uuidv4(), name: 'FastTrack Electronics',  code: 'FTE', contact: 'Jennifer Wu',     email: 'jwu@fasttrack-elec.com',       phone: '(408) 555-0182', addr: '2400 Silicon Ave, San Jose, CA 95128',  terms: 'net30', ltd: 21, rating: 4, notes: 'Preferred supplier for PCBs and connectors. Good quality, occasional lead time delays.' },
    { id: uuidv4(), name: 'Global Parts Supply',    code: 'GPS', contact: 'Mike Torres',     email: 'mtorres@globalparts.com',       phone: '(313) 555-0294', addr: '890 Industrial Dr, Detroit, MI 48201',  terms: 'net45', ltd: 7,  rating: 5, notes: 'Excellent pricing on fasteners and hardware. Very reliable.' },
    { id: uuidv4(), name: 'MechMasters Inc',        code: 'MMI', contact: 'Sandra Lee',      email: 'slee@mechmasters.com',          phone: '(216) 555-0371', addr: '1100 Precision Way, Cleveland, OH 44101',terms: 'net30', ltd: 14, rating: 4, notes: 'Specialty mechanical components — bearings, springs, seals.' },
    { id: uuidv4(), name: 'PackagePro Solutions',   code: 'PPS', contact: 'David Brown',     email: 'dbrown@packagepro.com',         phone: '(312) 555-0458', addr: '3300 Logistics Blvd, Chicago, IL 60601', terms: 'net15', ltd: 5,  rating: 4, notes: 'Packaging and labeling supplier. Fast turnaround.' },
    { id: uuidv4(), name: 'Apex Plastics Corp',     code: 'APC', contact: 'Rachel Green',    email: 'rgreen@apexplastics.com',       phone: '(248) 555-0512', addr: '500 Polymer Pkwy, Auburn Hills, MI 48326',terms: 'net30', ltd: 21, rating: 3, notes: 'Injection molded parts. Some quality issues in Q3 — under review.' },
  ];
  const insVend = db.prepare(`INSERT INTO vendors (id, name, code, contact_name, email, phone, address, payment_terms, lead_time_days, rating, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const vendorIds = {};
  for (const v of vendors) {
    insVend.run(v.id, v.name, v.code, v.contact, v.email, v.phone, v.addr, v.terms, v.ltd, v.rating, v.notes);
    vendorIds[v.code] = v.id;
  }

  // Purchase Orders
  const insPO = db.prepare(`INSERT INTO purchase_orders (id, po_number, vendor_id, status, order_date, expected_date, received_date, shipping_cost, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const insLine = db.prepare(`INSERT INTO po_lines (id, po_id, item_id, quantity_ordered, quantity_received, unit_cost) VALUES (?, ?, ?, ?, ?, ?)`);

  const poData = [
    {
      id: uuidv4(), po: 'PO-2024-001', vendor: 'GPS', status: 'received',
      ordered: daysAgo(28), expected: daysAgo(18), received: daysAgo(25), ship: 12.00,
      notes: 'Initial stock replenishment — base plates and panels',
      lines: [
        { sku: 'WGT-BASE-001', qo: 200, qr: 200, cost: 4.25 },
        { sku: 'WGT-PANEL-L',  qo: 300, qr: 300, cost: 2.80 },
        { sku: 'WGT-PANEL-R',  qo: 300, qr: 300, cost: 2.80 },
      ]
    },
    {
      id: uuidv4(), po: 'PO-2024-002', vendor: 'GPS', status: 'received',
      ordered: daysAgo(22), expected: daysAgo(17), received: daysAgo(20), ship: 8.50,
      notes: 'Fastener replenishment order',
      lines: [
        { sku: 'BOLT-M6-20',   qo: 5000, qr: 5000, cost: 0.12 },
        { sku: 'SPRING-M8-C',  qo: 500,  qr: 500,  cost: 0.65 },
        { sku: 'BEARING-6200', qo: 200,  qr: 200,  cost: 2.20 },
      ]
    },
    {
      id: uuidv4(), po: 'PO-2024-003', vendor: 'FTE', status: 'received',
      ordered: daysAgo(18), expected: daysAgo(10), received: daysAgo(15), ship: 25.00,
      notes: 'Electronics restock — PCBs and connectors',
      lines: [
        { sku: 'PCB-CTRL-V2', qo: 100, qr: 100, cost: 34.00 },
        { sku: 'CONN-USB-C',  qo: 1000,qr: 1000,cost: 0.85  },
      ]
    },
    {
      id: uuidv4(), po: 'PO-2024-004', vendor: 'MMI', status: 'received',
      ordered: daysAgo(14), expected: daysAgo(7), received: daysAgo(10), ship: 18.00,
      notes: 'Motor and gasket order — note gasket batch flagged for inspection',
      lines: [
        { sku: 'MTR-DC-12V',  qo: 100, qr: 100, cost: 18.50 },
        { sku: 'GSKT-SIL-01', qo: 500, qr: 500, cost: 1.45  },
      ]
    },
    {
      id: uuidv4(), po: 'PO-2024-005', vendor: 'PPS', status: 'received',
      ordered: daysAgo(10), expected: daysAgo(5), received: daysAgo(7), ship: 0.00,
      notes: 'Packaging materials replenishment',
      lines: [
        { sku: 'BOX-MED-RSC', qo: 500, qr: 500, cost: 0.95 },
        { sku: 'LABEL-4X6',   qo: 50,  qr: 50,  cost: 8.50 },
      ]
    },
    {
      id: uuidv4(), po: 'PO-2024-006', vendor: 'FTE', status: 'sent',
      ordered: daysAgo(3), expected: daysAgo(-18), received: null, ship: 0,
      notes: 'PCB reorder — stock depleting faster than forecast due to WO-2024-006',
      lines: [
        { sku: 'PCB-CTRL-V2', qo: 150, qr: 0, cost: 33.50 },
        { sku: 'CONN-USB-C',  qo: 500, qr: 0, cost: 0.82  },
        { sku: 'MTR-DC-12V',  qo: 50,  qr: 0, cost: 18.00 },
      ]
    },
    {
      id: uuidv4(), po: 'PO-2024-007', vendor: 'GPS', status: 'draft',
      ordered: daysAgo(1), expected: daysAgo(-7), received: null, ship: 0,
      notes: 'Draft — pending approval for base plate and panel reorder',
      lines: [
        { sku: 'WGT-BASE-001', qo: 200, qr: 0, cost: 4.25 },
        { sku: 'WGT-PANEL-L',  qo: 200, qr: 0, cost: 2.80 },
        { sku: 'WGT-PANEL-R',  qo: 200, qr: 0, cost: 2.80 },
        { sku: 'BRKT-STL-01',  qo: 200, qr: 0, cost: 1.10 },
      ]
    },
  ];

  for (const po of poData) {
    insPO.run(po.id, po.po, vendorIds[po.vendor], po.status, po.ordered, po.expected, po.received, po.ship, po.notes);
    for (const l of po.lines) {
      const itemId = itemIds[l.sku];
      if (!itemId) continue;
      insLine.run(uuidv4(), po.id, itemId, l.qo, l.qr, l.cost);
    }
  }
}

// ─── Seed: NCRs ──────────────────────────────────────────────────────────────

function seedNCRs(appData, itemIds) {
  if (db.prepare('SELECT COUNT(*) as c FROM ncrs').get().c > 0) return;

  const appId = appData?.appId || db.prepare('SELECT id FROM apps LIMIT 1').get()?.id;
  const woRows = db.prepare('SELECT id, work_order_number FROM work_orders').all();
  const woIds = {};
  for (const w of woRows) woIds[w.work_order_number] = w.id;

  const insNCR = db.prepare(`
    INSERT INTO ncrs (id, ncr_number, title, description, severity, status, source, app_id, work_order_id, item_id, assigned_to, root_cause, corrective_action, due_date, resolved_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insComment = db.prepare(`INSERT INTO ncr_comments (id, ncr_id, author, body, created_at) VALUES (?, ?, ?, ?, ?)`);

  const ncrs = [
    {
      id: uuidv4(), num: 'NCR-2024-001',
      title: 'PCB-CTRL-V2 Batch Failure — 5 units defective',
      desc: 'Received 100 units of PCB-CTRL-V2 on PO-2024-003. During incoming inspection, 5 units (5%) failed functional test at U3 component. Suspected solder defect.',
      sev: 'major', st: 'investigating', src: 'receiving',
      wo: null, sku: 'PCB-CTRL-V2',
      assigned: 'Sarah Nguyen',
      rc: 'Solder paste misalignment on U3 footprint. Suspected wave solder temperature drift at supplier facility.',
      ca: '1. Quarantine affected batch\n2. Issue RMA to FastTrack Electronics\n3. Request 100% functional test on replacement batch\n4. Update incoming inspection checklist',
      due: isoOffset(3), resolved: null,
      comments: [
        { author: 'Sarah Nguyen', body: 'NCR opened after incoming inspection flagged 5 failures. Batch quarantined in QC Hold Area.', daysAgo: 12 },
        { author: 'Jennifer Wu (FTE)', body: 'Confirmed defect received. We are investigating our process. Will have RMA approved within 48 hours.', daysAgo: 10 },
        { author: 'Sarah Nguyen', body: 'RMA approved. Scrapped 5 units. Replacement batch expected on PO-2024-006.', daysAgo: 8 },
      ]
    },
    {
      id: uuidv4(), num: 'NCR-2024-002',
      title: 'Silicone Gasket Incoming Quality — Dimensional non-conformance',
      desc: 'Full lot (500 units GSKT-SIL-01) received on PO-2024-004 placed in QC Hold. 12/25 sample measured undersize by 0.3mm on inner diameter. Affects seal performance.',
      sev: 'critical', st: 'open', src: 'receiving',
      wo: 'WO-2024-003', sku: 'GSKT-SIL-01',
      assigned: 'Sarah Nguyen',
      rc: '', ca: '',
      due: isoOffset(2), resolved: null,
      comments: [
        { author: 'Sarah Nguyen', body: 'Full lot placed on hold per receiving SOP. WO-2024-003 is blocked pending resolution. MechMasters notified.', daysAgo: 5 },
        { author: 'Tom Rivera', body: 'WO-2024-003 impact: 120 units still need gaskets. We have ~38 units of old stock. Need resolution within 2 days.', daysAgo: 4 },
        { author: 'Sandra Lee (MMI)', body: 'We are reviewing our tooling. New certified lot can ship in 5 business days. Expedite available for additional cost.', daysAgo: 3 },
      ]
    },
    {
      id: uuidv4(), num: 'NCR-2024-003',
      title: 'Label Misalignment on Packaging Run — WO-2024-002',
      desc: 'Approximately 15% of units from WO-2024-002 (Left Side Panel packaging) have product label shifted 3mm right of center spec. Cosmetic issue only, no functional impact.',
      sev: 'minor', st: 'resolved', src: 'production',
      wo: 'WO-2024-002', sku: null,
      assigned: 'James Patel',
      rc: 'Label applicator guide rail shifted during shift change on Day 3. Not caught in hourly checks.',
      ca: '1. Re-label 15 affected units (rework completed)\n2. Added label alignment check to hourly audit sheet\n3. Adjusted guide rail and re-calibrated',
      due: isoOffset(-5), resolved: daysAgo(3),
      comments: [
        { author: 'James Patel', body: 'Identified during end-of-shift inspection. 15 units set aside for rework.', daysAgo: 9 },
        { author: 'James Patel', body: 'Root cause found — guide rail. Rework complete. All 15 units re-labeled and released.', daysAgo: 3 },
      ]
    },
    {
      id: uuidv4(), num: 'NCR-2024-004',
      title: 'DC Motor Bearing Noise at Speed — MTR-DC-12V',
      desc: 'Production operator reported intermittent grinding noise from MTR-DC-12V during functional test on 3 units this week. Noise appears above 30 RPM.',
      sev: 'major', st: 'open', src: 'production',
      wo: 'WO-2024-006', sku: 'MTR-DC-12V',
      assigned: 'Linda Okafor',
      rc: '', ca: '',
      due: isoOffset(5), resolved: null,
      comments: [
        { author: 'Emma Davis', body: 'First reported at Station A1 this morning. Two more units flagged by afternoon. All three quarantined.', daysAgo: 1 },
      ]
    },
    {
      id: uuidv4(), num: 'NCR-2024-005',
      title: 'Assembly SOP Missing Torque Verification Step',
      desc: 'Internal audit identified that revision C of the Widget Assembly Process SOP does not include a torque wrench verification step after bolt installation. Risk of under-torqued assemblies reaching customers.',
      sev: 'minor', st: 'closed', src: 'audit',
      wo: null, sku: null,
      assigned: 'Tom Rivera',
      rc: 'SOP revision C was updated without change control review. Torque check step was accidentally removed in a formatting update.',
      ca: '1. SOP updated to Rev D with torque verification step\n2. Change control process enforced via ECO-2024-018\n3. All assembly operators retrained on Rev D',
      due: isoOffset(-10), resolved: daysAgo(15),
      comments: [
        { author: 'Tom Rivera', body: 'Raised by internal audit team. SOP Rev D completed and released. Training scheduled for this week.', daysAgo: 18 },
        { author: 'Sarah Nguyen', body: 'Training confirmed complete for all 5 assembly operators. NCR can be closed.', daysAgo: 15 },
      ]
    },
  ];

  for (const n of ncrs) {
    const itemId = n.sku ? (itemIds?.[n.sku] || null) : null;
    const woId = n.wo ? (woIds[n.wo] || null) : null;
    insNCR.run(n.id, n.num, n.title, n.desc, n.sev, n.st, n.src, appId || null, woId, itemId, n.assigned, n.rc, n.ca, n.due, n.resolved);
    for (const c of n.comments) {
      const d = new Date(); d.setDate(d.getDate() - c.daysAgo);
      insComment.run(uuidv4(), n.id, c.author, c.body, d.toISOString());
    }
  }
}

// ─── Seed: sample dashboard ───────────────────────────────────────────────────

function seedDashboard() {
  if (db.prepare('SELECT COUNT(*) as c FROM dashboards').get().c > 0) return;
  const appId = db.prepare('SELECT id FROM apps LIMIT 1').get()?.id;
  const cards = [
    { id: uuidv4(), type: 'metric',        title: 'Today\'s Output',        metric_key: 'today_completions', size: 'sm', color: '#3b82f6' },
    { id: uuidv4(), type: 'metric',        title: 'Pass Rate',              metric_key: 'pass_rate',         size: 'sm', color: '#10b981' },
    { id: uuidv4(), type: 'metric',        title: 'Avg Cycle Time',         metric_key: 'avg_cycle',         size: 'sm', color: '#f59e0b' },
    { id: uuidv4(), type: 'wo_status',     title: 'Work Order Status',      size: 'md' },
    { id: uuidv4(), type: 'time_series',   title: '30-Day Throughput',      series: 'throughput', period_days: 30, size: 'lg', color: '#3b82f6' },
    { id: uuidv4(), type: 'distribution',  title: 'Completions by Operator',group_by: 'operator', period_days: 30, size: 'md' },
    { id: uuidv4(), type: 'leaderboard',   title: 'Top Operators',          leaderboard_metric: 'completions', limit: 5, size: 'sm' },
    { id: uuidv4(), type: 'table',         title: 'Recent Completions',     limit: 10, size: 'lg', app_id: appId },
  ];
  db.prepare(`INSERT INTO dashboards (id, name, description, cards) VALUES (?, ?, ?, ?)`)
    .run(uuidv4(), 'Production Overview', 'Daily production KPIs and throughput tracking', JSON.stringify(cards));
}

// ─── Seed: users ──────────────────────────────────────────────────────────────

function seedUsers() {
  if (db.prepare('SELECT COUNT(*) as c FROM users').get().c > 0) return;
  const crypto = require('crypto');
  function hashPw(password) {
    const salt = crypto.randomBytes(16).toString('hex');
    const hash = crypto.scryptSync(password, salt, 64).toString('hex');
    return `${salt}:${hash}`;
  }
  const users = [
    { id: uuidv4(), email: 'admin@hartmonitor.demo',    display_name: 'Admin User',      password: 'Admin123!',    role: 'developer' },
    { id: uuidv4(), email: 'manager@hartmonitor.demo',  display_name: 'Sarah Manager',   password: 'Manager123',   role: 'manager'   },
    { id: uuidv4(), email: 'operator@hartmonitor.demo', display_name: 'Bob Operator',    password: 'Operator123',  role: 'operator'  },
    { id: uuidv4(), email: 'demo@hartmonitor.demo',     display_name: 'Demo User',       password: 'demo',         role: 'viewer'    },
  ];
  const ins = db.prepare(`INSERT INTO users (id, email, display_name, password_hash, role) VALUES (?, ?, ?, ?, ?)`);
  for (const u of users) ins.run(u.id, u.email, u.display_name, hashPw(u.password), u.role);
}

// ─── Run all seeds ────────────────────────────────────────────────────────────

seedUsers();
seedPlan();
seedCompanySettings();
const appData     = seedAppData();
const deptIds     = seedDepartments();
seedWorkOrders(appData?.appId, deptIds);
const invData     = seedInventory();
seedVendorsAndPOs(invData);
seedNCRs(appData, invData?.itemIds);
seedDashboard();

// ─── Backfill: assign seeded stations to departments, default headcounts ─────
// Runs on every boot so existing databases pick these up too.

{
  const deptByName = {};
  for (const d of db.prepare('SELECT id, name FROM departments').all()) deptByName[d.name] = d.id;

  const stationDeptMap = {
    'Assembly Station A1': 'Assembly',
    'QC Inspection Bench': 'Quality Control',
  };
  const setDept = db.prepare('UPDATE stations SET department_id = ? WHERE name = ? AND department_id IS NULL');
  for (const [stationName, deptName] of Object.entries(stationDeptMap)) {
    if (deptByName[deptName]) setDept.run(deptByName[deptName], stationName);
  }

  const defaultHeadcounts = { 'Assembly': 4, 'Quality Control': 2, 'Packaging': 2, 'Maintenance': 1 };
  const setHeadcount = db.prepare('UPDATE departments SET headcount = ? WHERE name = ? AND (headcount IS NULL OR headcount = 0)');
  for (const [deptName, hc] of Object.entries(defaultHeadcounts)) setHeadcount.run(hc, deptName);
}

// ─── Backfill: default organization ──────────────────────────────────────────
// Idempotent, runs every boot. Any rows without a company_id (seed data and
// pre-tenancy databases) are adopted by the default organization.

{
  let defaultOrg = db.prepare('SELECT id FROM organizations LIMIT 1').get();
  if (!defaultOrg) {
    const id = uuidv4();
    const nameRow = db.prepare("SELECT value FROM company_settings WHERE key = 'company_name'").get();
    const name = nameRow?.value || 'HartMonitor Demo Co';
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'default';
    db.prepare('INSERT INTO organizations (id, name, slug) VALUES (?, ?, ?)').run(id, name, slug);
    defaultOrg = { id };
  }

  for (const t of TENANT_TABLES) {
    db.prepare(`UPDATE ${t} SET company_id = ? WHERE company_id IS NULL`).run(defaultOrg.id);
  }

  // Copy legacy company_settings into the default org's org_settings once
  const hasOrgSettings = db.prepare('SELECT 1 FROM org_settings WHERE company_id = ? LIMIT 1').get(defaultOrg.id);
  if (!hasOrgSettings) {
    const ins = db.prepare(`INSERT OR IGNORE INTO org_settings (company_id, key, value, updated_at) VALUES (?, ?, ?, ?)`);
    for (const r of db.prepare('SELECT key, value, updated_at FROM company_settings').all()) {
      ins.run(defaultOrg.id, r.key, r.value, r.updated_at);
    }
  }
}

// ─── Migration: bump free-tier app limit from 3 to 5 ──────────────────────────
// One-time, guarded by a schema_meta flag. Only touches plans that are still
// on the original free-tier default (tier='free' and app_limit=3); plans that
// were already customized (e.g. via add-on purchases changing only extra_app_slots)
// are unaffected since app_limit itself is untouched by add-on purchases.

const freeLimitBumped = db.prepare("SELECT value FROM schema_meta WHERE key = 'free_tier_app_limit_v2'").get();
if (!freeLimitBumped) {
  db.prepare("UPDATE plan SET app_limit = 5, updated_at = datetime('now') WHERE tier = 'free' AND app_limit = 3").run();
  db.prepare("INSERT INTO schema_meta (key, value) VALUES ('free_tier_app_limit_v2', '1')").run();
}

module.exports = db;

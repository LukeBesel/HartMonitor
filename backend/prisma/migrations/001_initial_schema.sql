-- 001_initial_schema.sql
-- HartMonitor MES — initial Postgres schema
-- Run against a fresh Supabase/Postgres database

BEGIN;

-- ── Core tables ──────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS organizations (
  id         TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  name       TEXT NOT NULL,
  slug       TEXT UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS sites (
  id         TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  company_id TEXT REFERENCES organizations(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  code       TEXT NOT NULL,
  address    TEXT NOT NULL DEFAULT '',
  timezone   TEXT NOT NULL DEFAULT '',
  is_primary BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (company_id, code)
);

CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  email         TEXT UNIQUE NOT NULL,
  display_name  TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'viewer'
                  CHECK (role IN ('developer','manager','supervisor','operator','viewer')),
  is_active     BOOLEAN NOT NULL DEFAULT TRUE,
  last_login    TIMESTAMPTZ,
  sso_provider  TEXT NOT NULL DEFAULT '',
  company_id    TEXT REFERENCES organizations(id) ON DELETE SET NULL,
  department_id TEXT,  -- FK added after departments table
  job_title     TEXT NOT NULL DEFAULT '',
  pin_hash      TEXT NOT NULL DEFAULT '',
  badge_code    TEXT NOT NULL DEFAULT '',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS sessions (
  id         TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token      TEXT UNIQUE NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS password_reset_tokens (
  id         TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT UNIQUE NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at    TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS org_settings (
  company_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  key        TEXT NOT NULL,
  value      TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (company_id, key)
);

CREATE TABLE IF NOT EXISTS schema_meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS role_permissions (
  company_id TEXT NOT NULL,
  role       TEXT NOT NULL,
  nav_key    TEXT NOT NULL,
  visible    BOOLEAN NOT NULL DEFAULT TRUE,
  PRIMARY KEY (company_id, role, nav_key)
);

-- ── Plan / Billing ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS plan (
  id                     SERIAL PRIMARY KEY,
  tier                   TEXT NOT NULL DEFAULT 'free',
  app_limit              INTEGER NOT NULL DEFAULT 5,
  dashboard_limit        INTEGER NOT NULL DEFAULT 2,
  extra_app_slots        INTEGER NOT NULL DEFAULT 0,
  extra_dashboard_slots  INTEGER NOT NULL DEFAULT 0,
  billing_email          TEXT NOT NULL DEFAULT '',
  stripe_customer_id     TEXT,
  stripe_subscription_id TEXT,
  subscription_status    TEXT NOT NULL DEFAULT '',
  company_id             TEXT REFERENCES organizations(id) ON DELETE SET NULL,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS billing_history (
  id          TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  type        TEXT NOT NULL CHECK (type IN ('tier_change','app_slot','dashboard_slot','refund')),
  description TEXT NOT NULL,
  quantity    INTEGER NOT NULL DEFAULT 1,
  unit_price  NUMERIC(12,4) NOT NULL DEFAULT 0,
  amount      NUMERIC(12,4) NOT NULL DEFAULT 0,
  recurring   BOOLEAN NOT NULL DEFAULT TRUE,
  company_id  TEXT REFERENCES organizations(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS company_settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── App Builder ───────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS apps (
  id                 TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  name               TEXT NOT NULL,
  description        TEXT NOT NULL DEFAULT '',
  status             TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published')),
  steps              JSONB NOT NULL DEFAULT '[]',
  variables          JSONB NOT NULL DEFAULT '[]',
  company_id         TEXT REFERENCES organizations(id) ON DELETE SET NULL,
  department_id      TEXT,  -- FK added after departments
  site_id            TEXT REFERENCES sites(id) ON DELETE SET NULL,
  station_id         TEXT,  -- FK added after stations
  show_takt_warnings BOOLEAN NOT NULL DEFAULT TRUE,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS tables (
  id          TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  name        TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  fields      JSONB NOT NULL DEFAULT '[]',
  company_id  TEXT REFERENCES organizations(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS table_records (
  id         TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  table_id   TEXT NOT NULL REFERENCES tables(id) ON DELETE CASCADE,
  data       JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Operations ────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS departments (
  id           TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  name         TEXT NOT NULL,
  description  TEXT NOT NULL DEFAULT '',
  manager_name TEXT NOT NULL DEFAULT '',
  color        TEXT NOT NULL DEFAULT '#3b82f6',
  headcount    INTEGER NOT NULL DEFAULT 0,
  company_id   TEXT REFERENCES organizations(id) ON DELETE SET NULL,
  site_id      TEXT REFERENCES sites(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Back-fill the deferred FK on users
ALTER TABLE users
  ADD CONSTRAINT fk_users_department
  FOREIGN KEY (department_id) REFERENCES departments(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS stations (
  id                    TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  name                  TEXT NOT NULL,
  description           TEXT NOT NULL DEFAULT '',
  location              TEXT NOT NULL DEFAULT '',
  status                TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive','maintenance')),
  current_app_id        TEXT,  -- FK added after apps
  planned_hours_per_day NUMERIC(6,2) NOT NULL DEFAULT 8,
  ideal_cycle_seconds   NUMERIC(10,2) NOT NULL DEFAULT 0,
  current_status        TEXT NOT NULL DEFAULT 'idle',
  current_status_since  TIMESTAMPTZ,
  department_id         TEXT REFERENCES departments(id) ON DELETE SET NULL,
  company_id            TEXT REFERENCES organizations(id) ON DELETE SET NULL,
  site_id               TEXT REFERENCES sites(id) ON DELETE SET NULL,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Back-fill deferred FKs on apps
ALTER TABLE apps
  ADD CONSTRAINT fk_apps_department FOREIGN KEY (department_id) REFERENCES departments(id) ON DELETE SET NULL;
ALTER TABLE apps
  ADD CONSTRAINT fk_apps_station FOREIGN KEY (station_id) REFERENCES stations(id) ON DELETE SET NULL;

ALTER TABLE stations
  ADD CONSTRAINT fk_stations_current_app FOREIGN KEY (current_app_id) REFERENCES apps(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS product_types (
  id             TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  app_id         TEXT NOT NULL REFERENCES apps(id) ON DELETE CASCADE,
  name           TEXT NOT NULL,
  description    TEXT NOT NULL DEFAULT '',
  takt_overrides JSONB NOT NULL DEFAULT '{}',
  company_id     TEXT REFERENCES organizations(id) ON DELETE SET NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS machine_events (
  id               TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  station_id       TEXT NOT NULL REFERENCES stations(id) ON DELETE CASCADE,
  event_type       TEXT NOT NULL CHECK (event_type IN ('up','down','maintenance','idle')),
  reason           TEXT NOT NULL DEFAULT '',
  started_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ended_at         TIMESTAMPTZ,
  duration_minutes NUMERIC(10,2)
);

CREATE TABLE IF NOT EXISTS work_orders (
  id                  TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  work_order_number   TEXT NOT NULL,
  part_number         TEXT NOT NULL,
  part_name           TEXT NOT NULL,
  quantity            INTEGER NOT NULL,
  quantity_completed  INTEGER NOT NULL DEFAULT 0,
  app_id              TEXT REFERENCES apps(id) ON DELETE SET NULL,
  department_id       TEXT REFERENCES departments(id) ON DELETE SET NULL,
  scheduled_start     TIMESTAMPTZ,
  scheduled_end       TIMESTAMPTZ,
  takt_time_minutes   NUMERIC(10,2) NOT NULL DEFAULT 0,
  status              TEXT NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending','in_progress','completed','overdue','cancelled')),
  priority            TEXT NOT NULL DEFAULT 'medium'
                        CHECK (priority IN ('low','medium','high','critical')),
  notes               TEXT NOT NULL DEFAULT '',
  company_id          TEXT REFERENCES organizations(id) ON DELETE SET NULL,
  site_id             TEXT REFERENCES sites(id) ON DELETE SET NULL,
  routing_id          TEXT,  -- FK added after product_routings
  assigned_user_id    TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (company_id, work_order_number)
);

CREATE TABLE IF NOT EXISTS completions (
  id                  TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  app_id              TEXT NOT NULL REFERENCES apps(id) ON DELETE CASCADE,
  app_name            TEXT NOT NULL,
  station_id          TEXT REFERENCES stations(id) ON DELETE SET NULL,
  operator_name       TEXT NOT NULL DEFAULT 'Unknown',
  started_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at        TIMESTAMPTZ,
  status              TEXT NOT NULL DEFAULT 'in_progress'
                        CHECK (status IN ('in_progress','completed','abandoned')),
  data                JSONB NOT NULL DEFAULT '{}',
  step_times          JSONB NOT NULL DEFAULT '{}',
  work_order_id       TEXT REFERENCES work_orders(id) ON DELETE SET NULL,
  takt_exceeded_steps JSONB NOT NULL DEFAULT '[]',
  product_type_id     TEXT REFERENCES product_types(id) ON DELETE SET NULL,
  company_id          TEXT REFERENCES organizations(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS dashboards (
  id          TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  name        TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  cards       JSONB NOT NULL DEFAULT '[]',
  company_id  TEXT REFERENCES organizations(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS wo_comments (
  id            TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  work_order_id TEXT NOT NULL REFERENCES work_orders(id) ON DELETE CASCADE,
  author_id     TEXT REFERENCES users(id) ON DELETE SET NULL,
  author_name   TEXT NOT NULL DEFAULT '',
  body          TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── ERP / Inventory ───────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS items (
  id              TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  sku             TEXT NOT NULL,
  name            TEXT NOT NULL,
  description     TEXT NOT NULL DEFAULT '',
  category        TEXT NOT NULL DEFAULT 'General',
  unit_of_measure TEXT NOT NULL DEFAULT 'ea',
  unit_cost       NUMERIC(12,4) NOT NULL DEFAULT 0,
  reorder_point   NUMERIC(12,4) NOT NULL DEFAULT 0,
  reorder_qty     NUMERIC(12,4) NOT NULL DEFAULT 0,
  reorder_max     NUMERIC(12,4) NOT NULL DEFAULT 0,
  lead_time_days  INTEGER NOT NULL DEFAULT 7,
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  company_id      TEXT REFERENCES organizations(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (company_id, sku)
);

CREATE TABLE IF NOT EXISTS locations (
  id          TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  name        TEXT NOT NULL,
  code        TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  type        TEXT NOT NULL DEFAULT 'warehouse',
  is_active   BOOLEAN NOT NULL DEFAULT TRUE,
  company_id  TEXT REFERENCES organizations(id) ON DELETE SET NULL,
  site_id     TEXT REFERENCES sites(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (company_id, code)
);

CREATE TABLE IF NOT EXISTS stock_levels (
  id          TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  item_id     TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  location_id TEXT NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
  quantity    NUMERIC(14,4) NOT NULL DEFAULT 0,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (item_id, location_id)
);

CREATE TABLE IF NOT EXISTS stock_movements (
  id             TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  item_id        TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  location_id    TEXT REFERENCES locations(id) ON DELETE SET NULL,
  movement_type  TEXT NOT NULL,
  quantity       NUMERIC(14,4) NOT NULL,
  unit_cost      NUMERIC(12,4) NOT NULL DEFAULT 0,
  reference_type TEXT NOT NULL DEFAULT '',
  reference_id   TEXT NOT NULL DEFAULT '',
  notes          TEXT NOT NULL DEFAULT '',
  operator_name  TEXT NOT NULL DEFAULT '',
  created_by     TEXT NOT NULL DEFAULT '',
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS vendors (
  id             TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  name           TEXT NOT NULL,
  code           TEXT NOT NULL,
  contact_name   TEXT NOT NULL DEFAULT '',
  email          TEXT NOT NULL DEFAULT '',
  phone          TEXT NOT NULL DEFAULT '',
  address        TEXT NOT NULL DEFAULT '',
  payment_terms  TEXT NOT NULL DEFAULT 'net30',
  lead_time_days INTEGER NOT NULL DEFAULT 14,
  rating         INTEGER NOT NULL DEFAULT 3,
  notes          TEXT NOT NULL DEFAULT '',
  is_active      BOOLEAN NOT NULL DEFAULT TRUE,
  company_id     TEXT REFERENCES organizations(id) ON DELETE SET NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (company_id, code)
);

CREATE TABLE IF NOT EXISTS purchase_orders (
  id            TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  po_number     TEXT NOT NULL,
  vendor_id     TEXT NOT NULL REFERENCES vendors(id) ON DELETE RESTRICT,
  status        TEXT NOT NULL DEFAULT 'draft',
  order_date    TIMESTAMPTZ NOT NULL,
  expected_date TIMESTAMPTZ,
  received_date TIMESTAMPTZ,
  shipping_cost NUMERIC(12,4) NOT NULL DEFAULT 0,
  notes         TEXT NOT NULL DEFAULT '',
  company_id    TEXT REFERENCES organizations(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (company_id, po_number)
);

CREATE TABLE IF NOT EXISTS po_lines (
  id                TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  po_id             TEXT NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
  item_id           TEXT NOT NULL REFERENCES items(id) ON DELETE RESTRICT,
  quantity_ordered  NUMERIC(14,4) NOT NULL,
  quantity_received NUMERIC(14,4) NOT NULL DEFAULT 0,
  unit_cost         NUMERIC(12,4) NOT NULL DEFAULT 0,
  notes             TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS shipments (
  id                TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  company_id        TEXT REFERENCES organizations(id) ON DELETE SET NULL,
  po_id             TEXT REFERENCES purchase_orders(id) ON DELETE SET NULL,
  carrier           TEXT NOT NULL DEFAULT '',
  tracking_number   TEXT NOT NULL DEFAULT '',
  origin            TEXT NOT NULL DEFAULT '',
  status            TEXT NOT NULL DEFAULT 'pending'
                      CHECK (status IN ('pending','in_transit','out_for_delivery','delivered','delayed','exception')),
  shipped_date      TIMESTAMPTZ,
  estimated_arrival TIMESTAMPTZ,
  actual_arrival    TIMESTAMPTZ,
  notes             TEXT NOT NULL DEFAULT '',
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Quality / NCR ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS ncrs (
  id                TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  ncr_number        TEXT NOT NULL,
  title             TEXT NOT NULL,
  description       TEXT NOT NULL DEFAULT '',
  severity          TEXT NOT NULL DEFAULT 'minor',
  status            TEXT NOT NULL DEFAULT 'open',
  source            TEXT NOT NULL DEFAULT 'production',
  app_id            TEXT REFERENCES apps(id) ON DELETE SET NULL,
  completion_id     TEXT REFERENCES completions(id) ON DELETE SET NULL,
  work_order_id     TEXT REFERENCES work_orders(id) ON DELETE SET NULL,
  item_id           TEXT REFERENCES items(id) ON DELETE SET NULL,
  assigned_to       TEXT NOT NULL DEFAULT '',
  root_cause        TEXT NOT NULL DEFAULT '',
  corrective_action TEXT NOT NULL DEFAULT '',
  due_date          TIMESTAMPTZ,
  resolved_at       TIMESTAMPTZ,
  company_id        TEXT REFERENCES organizations(id) ON DELETE SET NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (company_id, ncr_number)
);

CREATE TABLE IF NOT EXISTS ncr_comments (
  id         TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  ncr_id     TEXT NOT NULL REFERENCES ncrs(id) ON DELETE CASCADE,
  author     TEXT NOT NULL,
  body       TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Messaging ─────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS messages (
  id           TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  company_id   TEXT REFERENCES organizations(id) ON DELETE SET NULL,
  sender_id    TEXT REFERENCES users(id) ON DELETE SET NULL,
  sender_name  TEXT NOT NULL,
  sender_role  TEXT NOT NULL DEFAULT '',
  body         TEXT NOT NULL,
  severity     TEXT NOT NULL DEFAULT 'info' CHECK (severity IN ('info','warning','urgent')),
  recipient_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Notifications ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS notification_log (
  id         TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  company_id TEXT REFERENCES organizations(id) ON DELETE SET NULL,
  channel    TEXT NOT NULL CHECK (channel IN ('email','sms')),
  event      TEXT NOT NULL,
  recipient  TEXT NOT NULL,
  subject    TEXT NOT NULL DEFAULT '',
  body       TEXT NOT NULL,
  status     TEXT NOT NULL DEFAULT 'simulated' CHECK (status IN ('sent','simulated','failed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Activity Log ──────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS activity_log (
  id            TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  company_id    TEXT REFERENCES organizations(id) ON DELETE SET NULL,
  entity_type   TEXT NOT NULL,
  entity_id     TEXT NOT NULL,
  action        TEXT NOT NULL,
  actor         TEXT NOT NULL DEFAULT '',
  department_id TEXT,
  station_id    TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── API Keys & Webhooks ───────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS api_keys (
  id           TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  company_id   TEXT REFERENCES organizations(id) ON DELETE SET NULL,
  name         TEXT NOT NULL,
  key_prefix   TEXT NOT NULL,
  key_hash     TEXT NOT NULL,
  created_by   TEXT NOT NULL DEFAULT '',
  last_used_at TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS webhooks (
  id         TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  company_id TEXT REFERENCES organizations(id) ON DELETE SET NULL,
  url        TEXT NOT NULL,
  events     JSONB NOT NULL DEFAULT '[]',
  secret     TEXT NOT NULL,
  is_active  BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS webhook_deliveries (
  id          TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  webhook_id  TEXT NOT NULL REFERENCES webhooks(id) ON DELETE CASCADE,
  event       TEXT NOT NULL,
  status_code INTEGER,
  success     BOOLEAN NOT NULL DEFAULT FALSE,
  error       TEXT NOT NULL DEFAULT '',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Training & Skills ─────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS training_records (
  id             TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  company_id     TEXT REFERENCES organizations(id) ON DELETE CASCADE,
  user_id        TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  app_id         TEXT NOT NULL REFERENCES apps(id) ON DELETE CASCADE,
  status         TEXT NOT NULL DEFAULT 'not_started'
                   CHECK (status IN ('not_started','in_training','certified','expired','needs_refresh')),
  certified_date TIMESTAMPTZ,
  expiry_date    TIMESTAMPTZ,
  certified_by   TEXT REFERENCES users(id) ON DELETE SET NULL,
  score          NUMERIC(5,2),
  attempts       INTEGER NOT NULL DEFAULT 0,
  notes          TEXT NOT NULL DEFAULT '',
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (company_id, user_id, app_id)
);

CREATE TABLE IF NOT EXISTS certifications (
  id           TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  company_id   TEXT REFERENCES organizations(id) ON DELETE CASCADE,
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  issuer       TEXT NOT NULL DEFAULT '',
  cert_number  TEXT NOT NULL DEFAULT '',
  issued_date  TIMESTAMPTZ,
  expiry_date  TIMESTAMPTZ,
  document_url TEXT NOT NULL DEFAULT '',
  notes        TEXT NOT NULL DEFAULT '',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS training_plans (
  id          TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  company_id  TEXT REFERENCES organizations(id) ON DELETE CASCADE,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  app_id      TEXT REFERENCES apps(id) ON DELETE CASCADE,
  assigned_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  target_date TIMESTAMPTZ,
  status      TEXT NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending','in_progress','completed','overdue')),
  notes       TEXT NOT NULL DEFAULT '',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Product Routings ──────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS product_routings (
  id          TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  company_id  TEXT REFERENCES organizations(id) ON DELETE SET NULL,
  name        TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Back-fill routing_id FK on work_orders now that product_routings exists
ALTER TABLE work_orders
  ADD CONSTRAINT fk_work_orders_routing
  FOREIGN KEY (routing_id) REFERENCES product_routings(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS routing_steps (
  id                      TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  routing_id              TEXT NOT NULL REFERENCES product_routings(id) ON DELETE CASCADE,
  company_id              TEXT REFERENCES organizations(id) ON DELETE SET NULL,
  step_number             INTEGER NOT NULL,
  name                    TEXT NOT NULL,
  description             TEXT NOT NULL DEFAULT '',
  app_id                  TEXT REFERENCES apps(id) ON DELETE SET NULL,
  department_id           TEXT REFERENCES departments(id) ON DELETE SET NULL,
  estimated_cycle_seconds NUMERIC(10,2) NOT NULL DEFAULT 0,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── SQDC ─────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS sqdc_entries (
  id            TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  company_id    TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  category      TEXT NOT NULL,
  subtype       TEXT NOT NULL DEFAULT '',
  department_id TEXT REFERENCES departments(id) ON DELETE SET NULL,
  location      TEXT NOT NULL DEFAULT '',
  description   TEXT NOT NULL DEFAULT '',
  value         NUMERIC(14,4),
  entry_date    TIMESTAMPTZ NOT NULL,
  created_by    TEXT NOT NULL DEFAULT '',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Andon ─────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS andon_calls (
  id              TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  company_id      TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  department_id   TEXT REFERENCES departments(id) ON DELETE SET NULL,
  station_id      TEXT REFERENCES stations(id) ON DELETE SET NULL,
  type            TEXT NOT NULL CHECK (type IN ('help','quality','material','maintenance','safety')),
  priority        TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('normal','high','critical')),
  status          TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','acknowledged','resolved')),
  description     TEXT NOT NULL DEFAULT '',
  raised_by       TEXT NOT NULL DEFAULT '',
  acknowledged_by TEXT NOT NULL DEFAULT '',
  acknowledged_at TIMESTAMPTZ,
  resolved_by     TEXT NOT NULL DEFAULT '',
  resolved_at     TIMESTAMPTZ,
  resolution      TEXT NOT NULL DEFAULT '',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── CAPA ─────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS capa_items (
  id                TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  company_id        TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  number            TEXT NOT NULL,
  title             TEXT NOT NULL,
  source            TEXT NOT NULL DEFAULT 'internal',
  type              TEXT NOT NULL DEFAULT 'corrective',
  priority          TEXT NOT NULL DEFAULT 'medium',
  status            TEXT NOT NULL DEFAULT 'open',
  department_id     TEXT REFERENCES departments(id) ON DELETE SET NULL,
  assigned_to       TEXT NOT NULL DEFAULT '',
  due_date          TIMESTAMPTZ,
  description       TEXT NOT NULL DEFAULT '',
  containment       TEXT NOT NULL DEFAULT '',
  root_cause        TEXT NOT NULL DEFAULT '',
  corrective_action TEXT NOT NULL DEFAULT '',
  preventive_action TEXT NOT NULL DEFAULT '',
  created_by        TEXT NOT NULL DEFAULT '',
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  closed_at         TIMESTAMPTZ,
  verified_at       TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS capa_actions (
  id           TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  capa_id      TEXT NOT NULL REFERENCES capa_items(id) ON DELETE CASCADE,
  description  TEXT NOT NULL,
  assigned_to  TEXT NOT NULL DEFAULT '',
  due_date     TIMESTAMPTZ,
  status       TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','in_progress','done')),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

-- ── Maintenance / CMMS ────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS assets (
  id              TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  company_id      TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  asset_number    TEXT NOT NULL DEFAULT '',
  category        TEXT NOT NULL DEFAULT '',
  manufacturer    TEXT NOT NULL DEFAULT '',
  model           TEXT NOT NULL DEFAULT '',
  serial_number   TEXT NOT NULL DEFAULT '',
  department_id   TEXT REFERENCES departments(id) ON DELETE SET NULL,
  location        TEXT NOT NULL DEFAULT '',
  status          TEXT NOT NULL DEFAULT 'active'
                    CHECK (status IN ('active','inactive','maintenance','retired')),
  purchase_date   TIMESTAMPTZ,
  warranty_expiry TIMESTAMPTZ,
  notes           TEXT NOT NULL DEFAULT '',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS pm_schedules (
  id                TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  company_id        TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  asset_id          TEXT REFERENCES assets(id) ON DELETE CASCADE,
  title             TEXT NOT NULL,
  description       TEXT NOT NULL DEFAULT '',
  frequency_value   INTEGER NOT NULL DEFAULT 1,
  frequency_type    TEXT NOT NULL DEFAULT 'months'
                      CHECK (frequency_type IN ('days','weeks','months','hours','cycles')),
  last_completed_at TIMESTAMPTZ,
  next_due_at       TIMESTAMPTZ,
  assigned_to       TEXT NOT NULL DEFAULT '',
  estimated_hours   NUMERIC(6,2) NOT NULL DEFAULT 1,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS maintenance_work_orders (
  id              TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  company_id      TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  number          TEXT NOT NULL,
  title           TEXT NOT NULL,
  type            TEXT NOT NULL DEFAULT 'corrective'
                    CHECK (type IN ('corrective','preventive','emergency','inspection')),
  priority        TEXT NOT NULL DEFAULT 'medium'
                    CHECK (priority IN ('low','medium','high','critical')),
  status          TEXT NOT NULL DEFAULT 'open'
                    CHECK (status IN ('open','in_progress','on_hold','completed','cancelled')),
  asset_id        TEXT REFERENCES assets(id) ON DELETE SET NULL,
  department_id   TEXT REFERENCES departments(id) ON DELETE SET NULL,
  assigned_to     TEXT NOT NULL DEFAULT '',
  description     TEXT NOT NULL DEFAULT '',
  resolution      TEXT NOT NULL DEFAULT '',
  estimated_hours NUMERIC(6,2),
  actual_hours    NUMERIC(6,2),
  requested_by    TEXT NOT NULL DEFAULT '',
  due_date        TIMESTAMPTZ,
  completed_at    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Shift Notes ───────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS shift_notes (
  id               TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  company_id       TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  department_id    TEXT REFERENCES departments(id) ON DELETE SET NULL,
  shift_name       TEXT NOT NULL DEFAULT 'Day',
  shift_date       TIMESTAMPTZ NOT NULL,
  supervisor       TEXT NOT NULL DEFAULT '',
  good_count       INTEGER NOT NULL DEFAULT 0,
  scrap_count      INTEGER NOT NULL DEFAULT 0,
  downtime_minutes INTEGER NOT NULL DEFAULT 0,
  notes            TEXT NOT NULL DEFAULT '',
  issues           JSONB NOT NULL DEFAULT '[]',
  status           TEXT NOT NULL DEFAULT 'active'
                     CHECK (status IN ('active','submitted','handed_off')),
  handed_off_to    TEXT NOT NULL DEFAULT '',
  handed_off_at    TIMESTAMPTZ,
  created_by       TEXT NOT NULL DEFAULT '',
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Kaizen / CI Ideas ─────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS kaizen_ideas (
  id                TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  company_id        TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  number            TEXT NOT NULL,
  title             TEXT NOT NULL,
  description       TEXT NOT NULL DEFAULT '',
  category          TEXT NOT NULL DEFAULT 'quality'
                      CHECK (category IN ('safety','quality','delivery','cost','morale','environment')),
  status            TEXT NOT NULL DEFAULT 'submitted'
                      CHECK (status IN ('submitted','under_review','approved','in_progress','implemented','rejected')),
  department_id     TEXT REFERENCES departments(id) ON DELETE SET NULL,
  submitted_by      TEXT NOT NULL DEFAULT '',
  assigned_to       TEXT NOT NULL DEFAULT '',
  estimated_savings NUMERIC(14,4) NOT NULL DEFAULT 0,
  actual_savings    NUMERIC(14,4) NOT NULL DEFAULT 0,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at      TIMESTAMPTZ
);

-- ── Misc ──────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS game_scores (
  id          TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  player_name TEXT NOT NULL,
  company     TEXT NOT NULL DEFAULT '',
  score       INTEGER NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS sso_state (
  id         TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  state      TEXT UNIQUE NOT NULL,
  provider   TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL
);

-- ── Indexes ───────────────────────────────────────────────────────────────────

-- Core lookups
CREATE INDEX IF NOT EXISTS idx_stations_department       ON stations(department_id);
CREATE INDEX IF NOT EXISTS idx_stations_company          ON stations(company_id);
CREATE INDEX IF NOT EXISTS idx_stations_site             ON stations(site_id);
CREATE INDEX IF NOT EXISTS idx_completions_station       ON completions(station_id);
CREATE INDEX IF NOT EXISTS idx_completions_work_order    ON completions(work_order_id);
CREATE INDEX IF NOT EXISTS idx_completions_completed     ON completions(status, completed_at);
CREATE INDEX IF NOT EXISTS idx_completions_company       ON completions(company_id);

-- Tenant tables
CREATE INDEX IF NOT EXISTS idx_apps_company              ON apps(company_id);
CREATE INDEX IF NOT EXISTS idx_tables_company            ON tables(company_id);
CREATE INDEX IF NOT EXISTS idx_departments_company       ON departments(company_id);
CREATE INDEX IF NOT EXISTS idx_departments_site          ON departments(site_id);
CREATE INDEX IF NOT EXISTS idx_work_orders_company       ON work_orders(company_id);
CREATE INDEX IF NOT EXISTS idx_work_orders_site          ON work_orders(site_id);
CREATE INDEX IF NOT EXISTS idx_dashboards_company        ON dashboards(company_id);
CREATE INDEX IF NOT EXISTS idx_users_company             ON users(company_id);
CREATE INDEX IF NOT EXISTS idx_items_company             ON items(company_id);
CREATE INDEX IF NOT EXISTS idx_locations_company         ON locations(company_id);
CREATE INDEX IF NOT EXISTS idx_locations_site            ON locations(site_id);
CREATE INDEX IF NOT EXISTS idx_vendors_company           ON vendors(company_id);
CREATE INDEX IF NOT EXISTS idx_purchase_orders_company   ON purchase_orders(company_id);
CREATE INDEX IF NOT EXISTS idx_ncrs_company              ON ncrs(company_id);
CREATE INDEX IF NOT EXISTS idx_product_types_company     ON product_types(company_id);
CREATE INDEX IF NOT EXISTS idx_billing_history_company   ON billing_history(company_id);
CREATE INDEX IF NOT EXISTS idx_plan_company              ON plan(company_id);

-- Inventory
CREATE INDEX IF NOT EXISTS idx_stock_movements_item      ON stock_movements(item_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_stock_movements_created   ON stock_movements(created_at DESC);

-- Messages & notifications
CREATE INDEX IF NOT EXISTS idx_messages_company          ON messages(company_id, created_at);
CREATE INDEX IF NOT EXISTS idx_notification_log_company  ON notification_log(company_id, created_at);

-- Webhooks
CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_webhook ON webhook_deliveries(webhook_id, created_at);

-- Activity log
CREATE INDEX IF NOT EXISTS idx_activity_log_entity          ON activity_log(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_activity_log_company_created ON activity_log(company_id, created_at DESC);

-- Training
CREATE INDEX IF NOT EXISTS idx_training_records_company  ON training_records(company_id);
CREATE INDEX IF NOT EXISTS idx_training_records_user     ON training_records(user_id);
CREATE INDEX IF NOT EXISTS idx_certifications_company    ON certifications(company_id, user_id);
CREATE INDEX IF NOT EXISTS idx_training_plans_company    ON training_plans(company_id, user_id);

-- Routings
CREATE INDEX IF NOT EXISTS idx_routing_steps_routing     ON routing_steps(routing_id, step_number);
CREATE INDEX IF NOT EXISTS idx_product_routings_company  ON product_routings(company_id);

-- WO comments
CREATE INDEX IF NOT EXISTS idx_wo_comments_wo            ON wo_comments(work_order_id, created_at);

-- Shipments
CREATE INDEX IF NOT EXISTS idx_shipments_company         ON shipments(company_id, created_at DESC);

-- Auth
CREATE INDEX IF NOT EXISTS idx_pw_reset_token            ON password_reset_tokens(token_hash);
CREATE INDEX IF NOT EXISTS idx_pw_reset_user             ON password_reset_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_sso_state_expires         ON sso_state(expires_at);

-- SQDC / Andon / CAPA / Maintenance
CREATE INDEX IF NOT EXISTS idx_sqdc_entries_lookup       ON sqdc_entries(company_id, category, entry_date);
CREATE INDEX IF NOT EXISTS idx_andon_calls_lookup        ON andon_calls(company_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_capa_items_lookup         ON capa_items(company_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_capa_actions_capa         ON capa_actions(capa_id);
CREATE INDEX IF NOT EXISTS idx_assets_lookup             ON assets(company_id, status);
CREATE INDEX IF NOT EXISTS idx_pm_schedules_lookup       ON pm_schedules(company_id, next_due_at);
CREATE INDEX IF NOT EXISTS idx_mwo_lookup                ON maintenance_work_orders(company_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_shift_notes_lookup        ON shift_notes(company_id, shift_date DESC, department_id);
CREATE INDEX IF NOT EXISTS idx_kaizen_ideas_lookup       ON kaizen_ideas(company_id, status, created_at DESC);

-- Game scores
CREATE INDEX IF NOT EXISTS idx_game_scores_score         ON game_scores(score DESC, created_at ASC);

COMMIT;

-- 002_row_level_security.sql
-- Adds RLS policies so each company can only access their own data.
-- Run in Supabase SQL editor or via migration after 001_initial_schema.sql.

-- ── Helper function ────────────────────────────────────────────────────────────
-- The backend sets: SET LOCAL app.company_id = 'xxx' before running queries.
-- Service-role connections bypass RLS entirely (Supabase default behaviour).

CREATE OR REPLACE FUNCTION current_company_id() RETURNS TEXT AS $$
  SELECT current_setting('app.company_id', true)
$$ LANGUAGE SQL STABLE;

-- ── Enable RLS on all tenant-scoped tables ────────────────────────────────────

ALTER TABLE organizations         ENABLE ROW LEVEL SECURITY;
ALTER TABLE sites                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE org_settings          ENABLE ROW LEVEL SECURITY;
ALTER TABLE role_permissions      ENABLE ROW LEVEL SECURITY;
ALTER TABLE plan                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE billing_history       ENABLE ROW LEVEL SECURITY;
ALTER TABLE apps                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE tables                ENABLE ROW LEVEL SECURITY;
ALTER TABLE table_records         ENABLE ROW LEVEL SECURITY;
ALTER TABLE stations              ENABLE ROW LEVEL SECURITY;
ALTER TABLE departments           ENABLE ROW LEVEL SECURITY;
ALTER TABLE work_orders           ENABLE ROW LEVEL SECURITY;
ALTER TABLE completions           ENABLE ROW LEVEL SECURITY;
ALTER TABLE product_types         ENABLE ROW LEVEL SECURITY;
ALTER TABLE machine_events        ENABLE ROW LEVEL SECURITY;
ALTER TABLE dashboards            ENABLE ROW LEVEL SECURITY;
ALTER TABLE wo_comments           ENABLE ROW LEVEL SECURITY;
ALTER TABLE users                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE sessions              ENABLE ROW LEVEL SECURITY;
ALTER TABLE password_reset_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE items                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE locations             ENABLE ROW LEVEL SECURITY;
ALTER TABLE stock_levels          ENABLE ROW LEVEL SECURITY;
ALTER TABLE stock_movements       ENABLE ROW LEVEL SECURITY;
ALTER TABLE vendors               ENABLE ROW LEVEL SECURITY;
ALTER TABLE purchase_orders       ENABLE ROW LEVEL SECURITY;
ALTER TABLE po_lines              ENABLE ROW LEVEL SECURITY;
ALTER TABLE shipments             ENABLE ROW LEVEL SECURITY;
ALTER TABLE ncrs                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE ncr_comments          ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages              ENABLE ROW LEVEL SECURITY;
ALTER TABLE notification_log      ENABLE ROW LEVEL SECURITY;
ALTER TABLE activity_log          ENABLE ROW LEVEL SECURITY;
ALTER TABLE api_keys              ENABLE ROW LEVEL SECURITY;
ALTER TABLE webhooks              ENABLE ROW LEVEL SECURITY;
ALTER TABLE webhook_deliveries    ENABLE ROW LEVEL SECURITY;
ALTER TABLE training_records      ENABLE ROW LEVEL SECURITY;
ALTER TABLE certifications        ENABLE ROW LEVEL SECURITY;
ALTER TABLE training_plans        ENABLE ROW LEVEL SECURITY;
ALTER TABLE product_routings      ENABLE ROW LEVEL SECURITY;
ALTER TABLE routing_steps         ENABLE ROW LEVEL SECURITY;
ALTER TABLE sqdc_entries          ENABLE ROW LEVEL SECURITY;
ALTER TABLE andon_calls           ENABLE ROW LEVEL SECURITY;
ALTER TABLE capa_items            ENABLE ROW LEVEL SECURITY;
ALTER TABLE capa_actions          ENABLE ROW LEVEL SECURITY;
ALTER TABLE assets                ENABLE ROW LEVEL SECURITY;
ALTER TABLE pm_schedules          ENABLE ROW LEVEL SECURITY;
ALTER TABLE maintenance_work_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE shift_notes           ENABLE ROW LEVEL SECURITY;
ALTER TABLE kaizen_ideas          ENABLE ROW LEVEL SECURITY;

-- game_scores and sso_state are intentionally NOT scoped to a company.

-- ── Policies: direct company_id columns ───────────────────────────────────────

CREATE POLICY "company_isolation" ON organizations
  FOR ALL USING (id = current_company_id());

CREATE POLICY "company_isolation" ON sites
  FOR ALL USING (company_id = current_company_id());

CREATE POLICY "company_isolation" ON org_settings
  FOR ALL USING (company_id = current_company_id());

CREATE POLICY "company_isolation" ON role_permissions
  FOR ALL USING (company_id = current_company_id());

CREATE POLICY "company_isolation" ON plan
  FOR ALL USING (company_id = current_company_id());

CREATE POLICY "company_isolation" ON billing_history
  FOR ALL USING (company_id = current_company_id());

CREATE POLICY "company_isolation" ON apps
  FOR ALL USING (company_id = current_company_id());

CREATE POLICY "company_isolation" ON tables
  FOR ALL USING (company_id = current_company_id());

CREATE POLICY "company_isolation" ON stations
  FOR ALL USING (company_id = current_company_id());

CREATE POLICY "company_isolation" ON departments
  FOR ALL USING (company_id = current_company_id());

CREATE POLICY "company_isolation" ON work_orders
  FOR ALL USING (company_id = current_company_id());

CREATE POLICY "company_isolation" ON completions
  FOR ALL USING (company_id = current_company_id());

CREATE POLICY "company_isolation" ON product_types
  FOR ALL USING (company_id = current_company_id());

CREATE POLICY "company_isolation" ON dashboards
  FOR ALL USING (company_id = current_company_id());

CREATE POLICY "company_isolation" ON users
  FOR ALL USING (company_id = current_company_id());

CREATE POLICY "company_isolation" ON items
  FOR ALL USING (company_id = current_company_id());

CREATE POLICY "company_isolation" ON locations
  FOR ALL USING (company_id = current_company_id());

CREATE POLICY "company_isolation" ON vendors
  FOR ALL USING (company_id = current_company_id());

CREATE POLICY "company_isolation" ON purchase_orders
  FOR ALL USING (company_id = current_company_id());

CREATE POLICY "company_isolation" ON shipments
  FOR ALL USING (company_id = current_company_id());

CREATE POLICY "company_isolation" ON ncrs
  FOR ALL USING (company_id = current_company_id());

CREATE POLICY "company_isolation" ON messages
  FOR ALL USING (company_id = current_company_id());

CREATE POLICY "company_isolation" ON notification_log
  FOR ALL USING (company_id = current_company_id());

CREATE POLICY "company_isolation" ON activity_log
  FOR ALL USING (company_id = current_company_id());

CREATE POLICY "company_isolation" ON api_keys
  FOR ALL USING (company_id = current_company_id());

CREATE POLICY "company_isolation" ON webhooks
  FOR ALL USING (company_id = current_company_id());

CREATE POLICY "company_isolation" ON training_records
  FOR ALL USING (company_id = current_company_id());

CREATE POLICY "company_isolation" ON certifications
  FOR ALL USING (company_id = current_company_id());

CREATE POLICY "company_isolation" ON training_plans
  FOR ALL USING (company_id = current_company_id());

CREATE POLICY "company_isolation" ON product_routings
  FOR ALL USING (company_id = current_company_id());

CREATE POLICY "company_isolation" ON sqdc_entries
  FOR ALL USING (company_id = current_company_id());

CREATE POLICY "company_isolation" ON andon_calls
  FOR ALL USING (company_id = current_company_id());

CREATE POLICY "company_isolation" ON capa_items
  FOR ALL USING (company_id = current_company_id());

CREATE POLICY "company_isolation" ON assets
  FOR ALL USING (company_id = current_company_id());

CREATE POLICY "company_isolation" ON pm_schedules
  FOR ALL USING (company_id = current_company_id());

CREATE POLICY "company_isolation" ON maintenance_work_orders
  FOR ALL USING (company_id = current_company_id());

CREATE POLICY "company_isolation" ON shift_notes
  FOR ALL USING (company_id = current_company_id());

CREATE POLICY "company_isolation" ON kaizen_ideas
  FOR ALL USING (company_id = current_company_id());

-- ── Policies: child tables (scope via parent join) ────────────────────────────

-- table_records → tables → company_id
CREATE POLICY "company_isolation" ON table_records
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM tables t
      WHERE t.id = table_records.table_id
        AND t.company_id = current_company_id()
    )
  );

-- machine_events → stations → company_id
CREATE POLICY "company_isolation" ON machine_events
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM stations s
      WHERE s.id = machine_events.station_id
        AND s.company_id = current_company_id()
    )
  );

-- wo_comments → work_orders → company_id
CREATE POLICY "company_isolation" ON wo_comments
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM work_orders w
      WHERE w.id = wo_comments.work_order_id
        AND w.company_id = current_company_id()
    )
  );

-- sessions → users → company_id
CREATE POLICY "company_isolation" ON sessions
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM users u
      WHERE u.id = sessions.user_id
        AND u.company_id = current_company_id()
    )
  );

-- password_reset_tokens → users → company_id
CREATE POLICY "company_isolation" ON password_reset_tokens
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM users u
      WHERE u.id = password_reset_tokens.user_id
        AND u.company_id = current_company_id()
    )
  );

-- stock_levels → items → company_id
CREATE POLICY "company_isolation" ON stock_levels
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM items i
      WHERE i.id = stock_levels.item_id
        AND i.company_id = current_company_id()
    )
  );

-- stock_movements → items → company_id
CREATE POLICY "company_isolation" ON stock_movements
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM items i
      WHERE i.id = stock_movements.item_id
        AND i.company_id = current_company_id()
    )
  );

-- po_lines → purchase_orders → company_id
CREATE POLICY "company_isolation" ON po_lines
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM purchase_orders po
      WHERE po.id = po_lines.po_id
        AND po.company_id = current_company_id()
    )
  );

-- ncr_comments → ncrs → company_id
CREATE POLICY "company_isolation" ON ncr_comments
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM ncrs n
      WHERE n.id = ncr_comments.ncr_id
        AND n.company_id = current_company_id()
    )
  );

-- webhook_deliveries → webhooks → company_id
CREATE POLICY "company_isolation" ON webhook_deliveries
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM webhooks wh
      WHERE wh.id = webhook_deliveries.webhook_id
        AND wh.company_id = current_company_id()
    )
  );

-- routing_steps → product_routings → company_id
CREATE POLICY "company_isolation" ON routing_steps
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM product_routings pr
      WHERE pr.id = routing_steps.routing_id
        AND pr.company_id = current_company_id()
    )
  );

-- capa_actions → capa_items → company_id
CREATE POLICY "company_isolation" ON capa_actions
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM capa_items ci
      WHERE ci.id = capa_actions.capa_id
        AND ci.company_id = current_company_id()
    )
  );

export type WidgetType =
  | 'text' | 'instruction' | 'image' | 'button'
  | 'text-input' | 'number-input' | 'select-input' | 'checkbox'
  | 'timer' | 'counter' | 'pass-fail' | 'separator' | 'signature'
  | 'video' | 'model-viewer';

export interface WidgetConfig {
  text?: string; content?: string; fontSize?: number; fontWeight?: string;
  color?: string; backgroundColor?: string; textAlign?: 'left' | 'center' | 'right';
  verticalAlign?: 'top' | 'center' | 'bottom'; fontStyle?: 'normal' | 'italic';
  buttonText?: string; buttonType?: 'next' | 'prev' | 'complete' | 'custom';
  buttonColor?: string; buttonSize?: 'sm' | 'md' | 'lg';
  placeholder?: string; required?: boolean; variableName?: string;
  defaultValue?: string | number | boolean; options?: string[];
  min?: number; max?: number; step?: number; initialValue?: number;
  duration?: number; autoStart?: boolean;
  imageUrl?: string; imageAlt?: string; imageFit?: 'contain' | 'cover';
  opacity?: number; borderRadius?: number;
  // Video widget
  videoUrl?: string; videoType?: 'youtube' | 'upload'; videoAutoplay?: boolean; videoControls?: boolean;
  // 3D model viewer
  modelUrl?: string; modelAlt?: string; modelAutoRotate?: boolean; modelCameraOrbit?: string;
  modelExposure?: number; modelShadowIntensity?: number;
}

/** Free-form placement of a widget on a canvas-mode step. All values are in
 *  logical canvas pixels (canvas is a fixed logical width; see CANVAS_W). */
export interface WidgetLayout {
  x: number; y: number; width: number; height: number;
  rotation?: number; z?: number;
}

export interface Widget {
  id: string; type: WidgetType; label: string; order: number; config: WidgetConfig;
  /** Present only on canvas-mode steps. Absent = rendered in the stacked flow. */
  layout?: WidgetLayout;
}

/** A part or material required for a specific step. */
export interface PartItem {
  name: string;
  sku?: string;
  quantity: number;
  unit?: string;
  notes?: string;
}

export interface Step {
  id: string; name: string; order: number; widgets: Widget[];
  takt_time_seconds?: number; description?: string;
  /** 'flow' (default) stacks widgets vertically; 'canvas' positions them freely. */
  layoutMode?: 'flow' | 'canvas';
  canvasHeight?: number;
  canvasBackground?: string;
  /** Parts and materials needed for this step — shown to operators as an info overlay. */
  parts_list?: PartItem[];
}

export interface AppVariable {
  id: string; name: string; type: 'text' | 'number' | 'boolean';
  defaultValue?: string | number | boolean;
}

export interface App {
  id: string; name: string; description: string;
  status: 'draft' | 'published'; steps: Step[];
  variables: AppVariable[]; created_at: string; updated_at: string;
  department_id?: string | null;
  site_id?: string | null;
  station_id?: string | null;
  show_takt_warnings?: number | boolean;
}

export interface Completion {
  id: string; app_id: string; app_name: string;
  station_id: string | null; operator_name: string;
  started_at: string; completed_at: string | null;
  status: 'in_progress' | 'completed' | 'abandoned';
  data: Record<string, unknown>; step_times: Record<string, number>;
  work_order_id?: string | null; takt_exceeded_steps?: number[];
}

export interface CompletionDetail extends Completion {
  steps_breakdown: {
    index: number; name: string; duration_seconds: number;
    takt_seconds?: number; variance_seconds?: number; exceeded: boolean;
  }[];
}

export type FieldType = 'text' | 'number' | 'boolean' | 'date' | 'select';
export interface TableField { id: string; name: string; type: FieldType; options?: string[]; }
export interface MESTable {
  id: string; name: string; description: string; fields: TableField[];
  record_count: number; created_at: string; updated_at: string;
}
export interface TableRecord {
  id: string; table_id: string; data: Record<string, unknown>;
  created_at: string; updated_at: string;
}

export interface Station {
  id: string; name: string; description: string; location: string;
  status: 'active' | 'inactive' | 'maintenance';
  current_app_id: string | null; completion_count: number; created_at: string;
  department_id?: string | null;
  department_name?: string | null;
  department_color?: string | null;
  site_id?: string | null;
}

export interface Department {
  id: string; name: string; description: string;
  manager_name: string; color: string;
  work_order_count?: number; created_at: string;
  site_id?: string | null;
}

export type WorkOrderStatus = 'pending' | 'in_progress' | 'completed' | 'overdue' | 'cancelled';
export type WorkOrderPriority = 'low' | 'medium' | 'high' | 'critical';
export type ScheduleStatus = 'on_track' | 'at_risk' | 'behind' | 'not_started' | 'completed' | 'overdue';

export interface WorkOrder {
  id: string; work_order_number: string; part_number: string; part_name: string;
  quantity: number; quantity_completed: number;
  app_id: string | null; app_name?: string;
  department_id: string | null; department_name?: string; department_color?: string;
  scheduled_start: string; scheduled_end: string;
  takt_time_minutes: number; status: WorkOrderStatus; priority: WorkOrderPriority;
  notes: string; schedule_status: ScheduleStatus;
  site_id?: string | null;
  created_at: string; updated_at: string;
}

// ── OEE ───────────────────────────────────────────────────────────────────────

export type MachineStatus = 'running' | 'down' | 'maintenance' | 'idle';

export interface OEEStats {
  availability: number; performance: number; quality: number; oee: number;
  uptime_minutes: number; downtime_minutes: number; planned_minutes: number;
  completions_today: number;
}

export interface OEEMachine {
  id: string; name: string; description: string; location: string;
  current_status: MachineStatus; current_status_since: string | null;
  planned_hours_per_day: number; ideal_cycle_seconds: number;
  oee: OEEStats;
}

export interface MachineEvent {
  id: string; station_id: string;
  event_type: 'up' | 'running' | 'down' | 'maintenance' | 'idle';
  reason: string; started_at: string; ended_at: string | null; duration_minutes: number | null;
}

// ── Dashboards ────────────────────────────────────────────────────────────────

export type DashboardCardType = 'metric' | 'time_series' | 'distribution' | 'leaderboard' | 'wo_status' | 'table';

export interface DashboardCard {
  id: string; type: DashboardCardType; title: string;
  app_id?: string | null; period_days?: number;
  metric_key?: string;
  series?: string;
  group_by?: string;
  leaderboard_metric?: string; limit?: number;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  color?: string;
}

export interface Dashboard {
  id: string; name: string; description: string;
  cards: DashboardCard[]; created_at: string; updated_at: string;
}

export interface ProductType {
  id: string; app_id: string; name: string; description: string;
  takt_overrides: Record<string, number>;
  created_at: string; updated_at: string;
}

// ── Inventory ─────────────────────────────────────────────────────────────────

export interface InventoryItem {
  id: string; sku: string; name: string; description: string;
  category: string; unit_of_measure: string; unit_cost: number;
  reorder_point: number; reorder_qty: number; lead_time_days: number;
  is_active: number; total_quantity: number; total_value?: number;
  stock_by_location?: StockByLocation[];
  created_at: string; updated_at: string;
}

export interface StockByLocation {
  location_id: string; location_name: string; location_code: string; quantity: number; updated_at: string;
}

export interface InventoryLocation {
  id: string; name: string; code: string; description: string;
  type: string; is_active: number; item_count?: number; total_units?: number;
  site_id?: string | null;
  created_at: string;
}

export type MovementType = 'receive' | 'consume' | 'adjust' | 'transfer' | 'ship' | 'scrap' | 'return';

export interface StockMovement {
  id: string; item_id: string; location_id: string | null;
  movement_type: MovementType; quantity: number; unit_cost: number;
  reference_type: string; reference_id: string;
  notes: string; operator_name: string;
  created_by?: string;
  item_name?: string; sku?: string; location_name?: string; location_code?: string;
  created_at: string;
}

export interface InventorySummary {
  total_items: number; total_value: number; low_stock: number;
  categories: string[]; today_receives: number; today_consumes: number;
}

// ── Purchasing ────────────────────────────────────────────────────────────────

export interface Vendor {
  id: string; name: string; code: string; contact_name: string;
  email: string; phone: string; address: string;
  payment_terms: string; lead_time_days: number; rating: number;
  notes: string; is_active: number; po_count?: number;
  created_at: string; updated_at: string;
}

export type POStatus = 'draft' | 'sent' | 'partial' | 'received' | 'cancelled';

export interface POLine {
  id: string; po_id: string; item_id: string;
  quantity_ordered: number; quantity_received: number; unit_cost: number;
  notes: string; item_name?: string; sku?: string; unit_of_measure?: string;
}

export interface PurchaseOrder {
  id: string; po_number: string; vendor_id: string; status: POStatus;
  order_date: string; expected_date: string | null; received_date: string | null;
  shipping_cost: number; notes: string;
  vendor_name?: string; vendor_code?: string;
  lines?: POLine[]; total_amount?: number; total_received?: number;
  created_at: string; updated_at: string;
}

// ── Quality / NCRs ────────────────────────────────────────────────────────────

export type NCRSeverity = 'minor' | 'major' | 'critical';
export type NCRStatus   = 'open' | 'investigating' | 'resolved' | 'closed';
export type NCRSource   = 'production' | 'receiving' | 'customer' | 'audit' | 'internal';

export interface NCR {
  id: string; ncr_number: string; title: string; description: string;
  severity: NCRSeverity; status: NCRStatus; source: NCRSource;
  app_id: string | null; completion_id: string | null;
  work_order_id: string | null; item_id: string | null;
  assigned_to: string; root_cause: string; corrective_action: string;
  due_date: string | null; resolved_at: string | null;
  app_name?: string; work_order_number?: string; item_name?: string; item_sku?: string;
  comment_count?: number; comments?: NCRComment[];
  created_at: string; updated_at: string;
}

export interface NCRComment {
  id: string; ncr_id: string; author: string; body: string; created_at: string;
}

export interface QualitySummary {
  total: number; open: number; investigating: number; resolved: number; closed: number;
  critical: number; overdue: number;
  by_source: { source: string; count: number }[];
  by_severity: { severity: string; count: number }[];
}

// ── Plan ──────────────────────────────────────────────────────────────────────

export type PlanTier = 'free' | 'pro' | 'enterprise';

export interface TierPricing {
  name: string; monthly_price: number | null;
  app_limit: number; dashboard_limit: number; features: string[];
}

export interface AddonPricing {
  name: string; monthly_price: number; description: string;
}

export interface BillingRecord {
  id: string; type: 'tier_change' | 'app_slot' | 'dashboard_slot' | 'refund';
  description: string; quantity: number; unit_price: number; amount: number;
  recurring: number; created_at: string;
}

export interface Plan {
  id: number; tier: PlanTier; app_limit: number; dashboard_limit: number;
  extra_app_slots: number; extra_dashboard_slots: number;
  effective_app_limit: number; effective_dashboard_limit: number;
  monthly_total: number;
  app_count: number; dashboard_count: number; completion_count: number;
  features: string[];
  pricing: { tiers: Record<PlanTier, TierPricing>; addons: Record<'app_slot' | 'dashboard_slot', AddonPricing> };
  billing_history: BillingRecord[];
  created_at: string; updated_at: string;
}

// ── Company settings ──────────────────────────────────────────────────────────

export interface CompanySettings {
  company_name?: string; company_industry?: string; company_address?: string;
  company_phone?: string; company_email?: string; timezone?: string;
  date_format?: string; currency?: string; logo_url?: string; fiscal_year_start?: string;
  [key: string]: string | undefined;
}

// ── Analytics ─────────────────────────────────────────────────────────────────

export interface AnalyticsOverview {
  totalCompletions: number; todayCompletions: number; inProgress: number;
  totalApps: number; publishedApps: number; activeStations: number;
  avgCycleTime: number; passRate: number;
}

export interface PlantViewData {
  kpis: {
    totalCompleted: number; todayCompleted: number; activeNow: number;
    passRate: number; avgCycleTime: number; scheduleAdherence: number;
  };
  department_performance: {
    id: string; name: string; color: string; completion_count: number;
    avg_cycle_minutes: number; on_track_pct: number;
  }[];
  hourly_throughput: { hour: string; count: number }[];
  work_order_summary: { on_track: number; at_risk: number; behind: number; not_started: number; completed: number; };
}

export interface ManagerViewData {
  active_completions: {
    id: string; operator_name: string; app_name: string; app_id: string;
    started_at: string; work_order_number?: string; station_name?: string;
  }[];
  work_orders: WorkOrder[];
  department_stats: { id: string; name: string; color: string; active_count: number; on_track_count: number; behind_count: number; }[];
}

// ── Daily brief / attention ──────────────────────────────────────────────────

export type AttentionType = 'wo_overdue' | 'wo_behind' | 'station_down' | 'ncr_critical' | 'stock_low' | 'po_late';

export interface AttentionItem {
  type: AttentionType;
  severity: 'red' | 'amber';
  label: string;
  detail: string;
  link: string;
}

export interface DailyBrief {
  attention: AttentionItem[];
  kpis: {
    completed_today: number;
    vs_7day_avg_pct: number | null;
    active_now: number;
    pass_rate_7d: number | null;
    schedule_adherence: number | null;
    work_orders_on_track: number;
    work_orders_total: number;
  };
  due_soon: Array<{
    id: string; work_order_number: string; part_name: string;
    department_name: string | null; quantity: number; quantity_completed: number;
    completion_pct: number; scheduled_end: string; priority: string;
    schedule_status: string;
  }>;
  throughput_7d: Array<{ date: string; count: number }>;
  week_avg_per_day: number;
  is_pro: boolean;
}

// ── Leaderboard ───────────────────────────────────────────────────────────────

export type LeaderboardPeriod = 'today' | 'week' | 'month' | 'all';

export interface LeaderboardEntry {
  rank: number;
  operator_name: string;
  best_minutes: number;
  avg_minutes: number;
  completions: number;
  last_completed_at: string;
  is_record: boolean;
}

export interface LeaderboardBoard {
  app_id: string;
  app_name: string;
  product_type_id: string | null;
  product_type_name: string | null;
  qualifying_count: number;
  operator_count: number;
  excluded_quality_count: number;
  all_time_best_minutes: number | null;
  leaders: LeaderboardEntry[];
}

export interface LeaderboardResponse {
  period: LeaderboardPeriod;
  period_label: string;
  generated_at: string;
  // Present on drill-down (Level 2) responses; null on the unscoped board.
  department_id?: string | null;
  app_id?: string | null;
  // Distinct apps/operations available within the current scope (Level 2 picker).
  apps?: { app_id: string; app_name: string }[];
  boards: LeaderboardBoard[];
}

// Level 1: leaderboard ranked by department.
export interface LeaderboardDepartment {
  rank: number;
  department_id: string | null;
  department_name: string;
  department_color: string;
  completions: number;
  operator_count: number;
  avg_minutes: number | null;
  best_minutes: number | null;
  last_completed_at: string | null;
  throughput_per_day: number;
}

export interface LeaderboardDepartmentsResponse {
  period: LeaderboardPeriod;
  period_label: string;
  generated_at: string;
  departments: LeaderboardDepartment[];
}

// ── Pricing catalog (public marketing + in-app billing) ───────────────────────

export interface PricingTier {
  name: string;
  monthly_price: number | null;
  app_limit: number;
  dashboard_limit: number;
  features: string[];
}

export interface PricingAddon {
  name: string;
  monthly_price: number;
  description: string;
}

export interface PricingModule {
  name: string;
  monthly_price: number;
  description: string;
  features: string[];
}

export interface PricingCatalog {
  tiers: Record<string, PricingTier>;
  addons: Record<string, PricingAddon>;
  modules?: Record<string, PricingModule>;
}

// ── Sites (multi-site / multi-plant) ──────────────────────────────────────────

export interface Site {
  id: string; name: string; code: string; address: string; timezone: string;
  is_primary: number;
  station_count?: number; department_count?: number; work_order_count?: number; location_count?: number;
  created_at: string; updated_at: string;
}

// ── Notifications (email/SMS alerts) ──────────────────────────────────────────

export interface NotificationPrefs {
  email_enabled: boolean; email_to: string;
  sms_enabled: boolean; sms_to: string;
  events: string[];
  available_events: Record<string, string>;
  email_configured: boolean; sms_configured: boolean;
}

export interface NotificationLogEntry {
  id: string; event: string; channel: 'email' | 'sms';
  recipient: string; subject: string;
  status: 'sent' | 'simulated' | 'failed';
  created_at: string;
}

// ── Role permission overrides ─────────────────────────────────────────────────

export type AppRole = 'viewer' | 'operator' | 'supervisor' | 'manager';
export type RolePermissionMap = Record<AppRole, Record<string, 0 | 1>>;

// ── Developer: API keys & webhooks (Enterprise) ───────────────────────────────

export interface ApiKey {
  id: string; name: string; key_prefix: string;
  last_used_at: string | null; created_at: string;
}

export interface Webhook {
  id: string; name: string; url: string; events: string[];
  secret?: string; is_active: number; created_at: string; updated_at: string;
}

export interface WebhookDelivery {
  id: string; webhook_id: string; event: string;
  status_code: number | null; success: number; error: string | null; created_at: string;
}

// ── Audit log ──────────────────────────────────────────────────────────────────

export interface AuditLogEntry {
  id: string; entity_type: string; entity_id: string;
  action: string; actor: string; created_at: string;
}

// ── SSO ────────────────────────────────────────────────────────────────────────

export interface SSOProviderInfo {
  id: string; name: string; mode: 'live' | 'demo';
}

// ── Live broadcast messages ───────────────────────────────────────────────────

export type MessageSeverity = 'info' | 'warning' | 'urgent';

export interface BroadcastMessage {
  id: string;
  sender_id: string;
  sender_name: string;
  sender_role: string;
  body: string;
  severity: MessageSeverity;
  created_at: string;
  /** When set, the message is a direct message to this user (not company-wide). */
  recipient_id?: string | null;
  recipient_name?: string | null;
}

// ─── Inventory Tracker ────────────────────────────────────────────────────────

/** A single stock movement (transaction) in the inventory ledger. Re-exports the
 *  existing StockMovement type under the tracker's name for the Inventory page. */
export type InventoryMovement = StockMovement;

/** A low-stock row surfaced on the Overview tab. */
export interface InventoryLowStockRow {
  id: string;
  sku: string;
  name: string;
  category: string | null;
  unit_of_measure: string;
  unit_cost: number;
  reorder_point: number;
  reorder_max?: number;
  reorder_qty: number;
  total_quantity: number;
  total_value: number;
}

/** Stock value rolled up by category (Overview chart series). */
export interface InventoryCategoryValue {
  category: string;
  value: number;
  quantity: number;
  items: number;
}

/** Rollup powering the Inventory Tracker Overview tab. */
export interface InventoryTrackerSummary {
  total_items: number;
  total_value: number;
  low_stock: number;
  out_of_stock: number;
  today_receives: number;
  today_consumes: number;
  categories: string[];
  value_by_category: InventoryCategoryValue[];
  low_stock_list: InventoryLowStockRow[];
}

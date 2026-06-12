export type WidgetType =
  | 'text' | 'instruction' | 'image' | 'button'
  | 'text-input' | 'number-input' | 'select-input' | 'checkbox'
  | 'timer' | 'counter' | 'pass-fail' | 'separator' | 'signature';

export interface WidgetConfig {
  text?: string; content?: string; fontSize?: number; fontWeight?: string;
  color?: string; backgroundColor?: string; textAlign?: string;
  buttonText?: string; buttonType?: 'next' | 'prev' | 'complete' | 'custom';
  buttonColor?: string; buttonSize?: 'sm' | 'md' | 'lg';
  placeholder?: string; required?: boolean; variableName?: string;
  defaultValue?: string | number | boolean; options?: string[];
  min?: number; max?: number; step?: number; initialValue?: number;
  duration?: number; autoStart?: boolean;
  imageUrl?: string; imageAlt?: string;
}

export interface Widget {
  id: string; type: WidgetType; label: string; order: number; config: WidgetConfig;
}

export interface Step {
  id: string; name: string; order: number; widgets: Widget[];
  takt_time_seconds?: number; description?: string;
}

export interface AppVariable {
  id: string; name: string; type: 'text' | 'number' | 'boolean';
  defaultValue?: string | number | boolean;
}

export interface App {
  id: string; name: string; description: string;
  status: 'draft' | 'published'; steps: Step[];
  variables: AppVariable[]; created_at: string; updated_at: string;
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
}

export interface Department {
  id: string; name: string; description: string;
  manager_name: string; color: string;
  work_order_count?: number; created_at: string;
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
  created_at: string;
}

export type MovementType = 'receive' | 'consume' | 'adjust' | 'transfer' | 'ship' | 'scrap' | 'return';

export interface StockMovement {
  id: string; item_id: string; location_id: string | null;
  movement_type: MovementType; quantity: number; unit_cost: number;
  reference_type: string; reference_id: string;
  notes: string; operator_name: string;
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

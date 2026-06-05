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
  event_type: 'up' | 'down' | 'maintenance' | 'idle';
  reason: string; started_at: string; ended_at: string | null; duration_minutes: number | null;
}

// ── Dashboards ────────────────────────────────────────────────────────────────
export type DashboardCardType = 'metric' | 'time_series' | 'distribution' | 'leaderboard' | 'wo_status' | 'table';

export interface DashboardCard {
  id: string; type: DashboardCardType; title: string;
  app_id?: string | null; period_days?: number;
  // metric
  metric_key?: string;
  // time_series
  series?: string;
  // distribution
  group_by?: string;
  // leaderboard
  leaderboard_metric?: string; limit?: number;
  // layout
  size?: 'sm' | 'md' | 'lg' | 'xl';
  color?: string;
}

export interface Dashboard {
  id: string; name: string; description: string;
  cards: DashboardCard[]; created_at: string; updated_at: string;
}

export interface ProductType {
  id: string;
  app_id: string;
  name: string;
  description: string;
  takt_overrides: Record<string, number>;
  created_at: string;
  updated_at: string;
}

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

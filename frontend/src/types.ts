export type WidgetType =
  | 'text'
  | 'instruction'
  | 'image'
  | 'button'
  | 'text-input'
  | 'number-input'
  | 'select-input'
  | 'checkbox'
  | 'timer'
  | 'counter'
  | 'pass-fail'
  | 'separator'
  | 'signature';

export interface WidgetConfig {
  // text/instruction
  text?: string;
  content?: string;
  fontSize?: number;
  fontWeight?: string;
  color?: string;
  backgroundColor?: string;
  textAlign?: string;
  // button
  buttonText?: string;
  buttonType?: 'next' | 'prev' | 'complete' | 'custom';
  buttonColor?: string;
  buttonSize?: 'sm' | 'md' | 'lg';
  // inputs
  placeholder?: string;
  required?: boolean;
  variableName?: string;
  defaultValue?: string | number | boolean;
  // select
  options?: string[];
  // number
  min?: number;
  max?: number;
  step?: number;
  // counter
  initialValue?: number;
  // timer
  duration?: number;
  autoStart?: boolean;
  // image
  imageUrl?: string;
  imageAlt?: string;
}

export interface Widget {
  id: string;
  type: WidgetType;
  label: string;
  order: number;
  config: WidgetConfig;
}

export interface Step {
  id: string;
  name: string;
  order: number;
  widgets: Widget[];
}

export interface AppVariable {
  id: string;
  name: string;
  type: 'text' | 'number' | 'boolean';
  defaultValue?: string | number | boolean;
}

export interface App {
  id: string;
  name: string;
  description: string;
  status: 'draft' | 'published';
  steps: Step[];
  variables: AppVariable[];
  created_at: string;
  updated_at: string;
}

export interface Completion {
  id: string;
  app_id: string;
  app_name: string;
  station_id: string | null;
  operator_name: string;
  started_at: string;
  completed_at: string | null;
  status: 'in_progress' | 'completed' | 'abandoned';
  data: Record<string, unknown>;
  step_times: Record<string, number>;
}

export type FieldType = 'text' | 'number' | 'boolean' | 'date' | 'select';

export interface TableField {
  id: string;
  name: string;
  type: FieldType;
  options?: string[];
}

export interface MESTable {
  id: string;
  name: string;
  description: string;
  fields: TableField[];
  record_count: number;
  created_at: string;
  updated_at: string;
}

export interface TableRecord {
  id: string;
  table_id: string;
  data: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface Station {
  id: string;
  name: string;
  description: string;
  location: string;
  status: 'active' | 'inactive' | 'maintenance';
  current_app_id: string | null;
  completion_count: number;
  created_at: string;
}

export interface AnalyticsOverview {
  totalCompletions: number;
  todayCompletions: number;
  inProgress: number;
  totalApps: number;
  publishedApps: number;
  activeStations: number;
  avgCycleTime: number;
  passRate: number;
}

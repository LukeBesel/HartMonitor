// ─── Maintenance: a PM that raises its own job ───────────────────────────────
//
// A PM schedule used to move only when a human clicked "Mark Complete", so a
// schedule that came due was a row nothing acted on. A due schedule now raises
// exactly one preventive work order, linked both ways: the job carries
// `pm_schedule_id` (and the PM's title, for its origin line), and the schedule
// carries `open_wo_number` while that job is outstanding. Completing either one
// completes both.
//
// Two honesty rules travel with these types:
//
//   • `next_due_at: null` never stands alone. An hours- or cycles-based
//     schedule cannot be projected onto a calendar — it needs a meter reading
//     nothing records yet — so it ships `next_due_reason` and the screen prints
//     that where a date would go. A blank cell reads as a bug; the reason reads
//     as the truth.
//   • `is_overdue` is decided by the server, in the PLANT's day, by the same
//     predicate the Overdue PMs tile counts with. A screen that recomputed it
//     from the browser's clock would disagree with its own tile every evening.

import { request } from './client';

/** How often a PM comes round. hours/cycles need a meter reading. */
export type PMFrequencyType = 'days' | 'weeks' | 'months' | 'hours' | 'cycles';

export interface PMSchedule {
  id: string;
  asset_id: string;
  asset_name?: string;
  asset_number?: string;
  title: string;
  description?: string;
  frequency_type: PMFrequencyType;
  frequency_value: number;
  last_completed_at?: string | null;
  /** Null for a meter-based schedule — read next_due_reason before printing. */
  next_due_at: string | null;
  /** Why there is no date, when there is none. e.g. "needs a meter reading". */
  next_due_reason: string | null;
  /** Server-decided, in the plant's day. Never recompute this in the browser. */
  is_overdue: boolean;
  assigned_to: string;
  estimated_hours: number;
  /** Whether this schedule raises its own work order when it comes due. */
  auto_create_wo: boolean;
  /** How many days before the due date the job is raised. */
  lead_days: number;
  last_raised_wo_id?: string | null;
  last_raised_at?: string | null;
  /** The job this schedule raised and nobody has closed yet. */
  open_wo_id?: string | null;
  open_wo_number?: string | null;
}

export interface MaintenanceWorkOrder {
  id: string;
  wo_number: string;
  number?: string;
  asset_id?: string | null;
  asset_name?: string | null;
  type: 'preventive' | 'corrective' | 'emergency' | 'inspection';
  title: string;
  description: string;
  priority: 'low' | 'medium' | 'high' | 'critical';
  status: 'open' | 'in_progress' | 'on_hold' | 'completed' | 'cancelled';
  assigned_to: string;
  due_date?: string | null;
  completed_at?: string | null;
  actual_hours: number;
  created_at: string;
  /** Set when the PM sweeper raised this job. */
  pm_schedule_id?: string | null;
  /** The schedule's title, so the job can name where it came from. */
  pm_title?: string | null;
  /** 'system' when the sweeper raised it, '' when a person typed it in. */
  raised_by?: string;
}

export interface PMScheduleUpdate {
  title?: string;
  description?: string;
  frequency_type?: string;
  frequency_value?: number;
  assigned_to?: string;
  estimated_hours?: number;
  /** Turn auto-raise off for a schedule the plant runs by hand. */
  auto_create_wo?: boolean;
  /** 0-365. Raise the job this many days before it is due. */
  lead_days?: number;
  /** Reschedule: the machine is busy this week, do the PM next week. */
  next_due_at?: string;
}

/** `overdue: true` filters to schedules past due in the plant's own day. */
export function getPMSchedules(params?: { asset_id?: string; overdue?: boolean }): Promise<PMSchedule[]> {
  const qs = new URLSearchParams();
  if (params?.asset_id) qs.set('asset_id', params.asset_id);
  if (params?.overdue) qs.set('overdue', 'true');
  const s = qs.toString();
  return request<PMSchedule[]>(`/maintenance/pm-schedules${s ? `?${s}` : ''}`);
}

export function updatePMSchedule(id: string, body: PMScheduleUpdate): Promise<PMSchedule> {
  return request<PMSchedule>(`/maintenance/pm-schedules/${id}`, { method: 'PUT', body: JSON.stringify(body) });
}

/** Completing the schedule also closes the job it raised — one piece of work. */
export function completePMSchedule(id: string): Promise<PMSchedule & { closed_work_order_id: string | null }> {
  return request<PMSchedule & { closed_work_order_id: string | null }>(
    `/maintenance/pm-schedules/${id}/complete`, { method: 'POST' },
  );
}

export function getMaintenanceWorkOrders(params?: {
  status?: string; asset_id?: string; type?: string; priority?: string; pm_schedule_id?: string;
}): Promise<MaintenanceWorkOrder[]> {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params || {})) if (v) qs.set(k, String(v));
  const s = qs.toString();
  return request<MaintenanceWorkOrder[]>(`/maintenance/work-orders${s ? `?${s}` : ''}`);
}

/** What a PM row says where a date would go. */
export function dueLabel(pm: PMSchedule): string {
  if (pm.next_due_at) {
    return new Date(pm.next_due_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }
  // Capitalised for a cell: "Needs a meter reading".
  const reason = pm.next_due_reason;
  return reason ? reason.charAt(0).toUpperCase() + reason.slice(1) : '—';
}

/** How a schedule's cadence reads on a row: "Every 3 months", "Every 250 hours". */
export function cadenceLabel(pm: { frequency_value: number; frequency_type: string }): string {
  const n = pm.frequency_value;
  const unit = n === 1 ? pm.frequency_type.replace(/s$/, '') : pm.frequency_type;
  return `Every ${n === 1 ? '' : `${n} `}${unit}`;
}

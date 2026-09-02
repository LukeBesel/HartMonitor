// ─── Operations on a work order ───────────────────────────────────────────────
//
// A work order used to be one app in one department, so a seven-operation job
// had to be typed in as seven unrelated work orders. Releasing a work order
// against a routing turns it into N operations in sequence, each with its own
// app, department, station, standard time and quantities.
//
// These calls sit on /work-orders, not /routings, and that is deliberate:
// designing a routing is a Pro feature, but RUNNING a job is the product's core
// loop and is open to every account. A Free-tier company can release a job and
// watch it move even though it cannot open the Routings screen.
//
// Nothing here computes a number. `of`, `sequence` and every quantity come from
// the server, so a screen that shows "op 3 of 7" is quoting the database rather
// than counting rows it happens to have in hand.

import { request } from './client';

/** Where an operation stands. Mirrors backend vocab.OPERATION_STATUS exactly. */
export type OperationStatus =
  | 'queued' | 'ready' | 'running' | 'complete' | 'skipped' | 'on_hold';

/** One operation of a released work order. */
export interface WorkOrderOperation {
  id: string;
  company_id: string;
  work_order_id: string;
  /** The routing step this was copied from, or null for an ad-hoc operation. */
  routing_step_id: string | null;
  /** 1-based position in the job. Stable: operations are appended, never renumbered. */
  sequence: number;
  /** How many operations the job has, so a row can print "3 of 7" on its own. */
  of: number;
  name: string;
  app_id: string | null;
  app_name: string | null;
  department_id: string | null;
  department_name: string | null;
  station_id: string | null;
  station_name: string | null;
  /** Standard time per piece, in SECONDS. Render with fmtDuration, never by hand. */
  standard_seconds: number;
  quantity_required: number;
  quantity_completed: number;
  quantity_scrapped: number;
  quantity_rework: number;
  status: OperationStatus;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * The compact "where is this job" object every work order carries.
 * null — not a zeroed object — when the work order was never released: "op 0 of
 * 0" is a number nobody measured.
 */
export interface CurrentOperation {
  id: string;
  sequence: number;
  of: number;
  name: string;
  department_name: string | null;
  qty_good: number;
  qty_required: number;
  standard_seconds: number;
  status: OperationStatus;
}

/** What a release answers with: the updated work order plus its operations. */
export interface ReleaseResult {
  id: string;
  work_order_number: string;
  routing_id: string | null;
  routing_name?: string | null;
  released_at: string | null;
  current_operation: CurrentOperation | null;
  operations: WorkOrderOperation[];
  [key: string]: unknown;
}

/** One open job on a routing, and the operation it is standing on. */
export interface RoutingUsageWorkOrder {
  id: string;
  work_order_number: string;
  part_number: string | null;
  part_name: string | null;
  quantity: number;
  quantity_completed: number;
  status: string;
  priority: string;
  due_date: string | null;
  released_at: string | null;
  hold_reason: string | null;
  current_operation: CurrentOperation | null;
}

export interface RoutingUsage {
  routing_id: string;
  routing_name: string;
  open_work_orders: number;
  work_orders: RoutingUsageWorkOrder[];
}

/** Turn a routing into this job's operations. Once — a second call is a 409. */
export function releaseWorkOrder(workOrderId: string, routingId?: string): Promise<ReleaseResult> {
  return request<ReleaseResult>(`/work-orders/${workOrderId}/release`, {
    method: 'POST',
    body: JSON.stringify(routingId ? { routing_id: routingId } : {}),
  });
}

/** The job's operations in sequence. [] for a work order nobody released. */
export function getOperations(workOrderId: string): Promise<WorkOrderOperation[]> {
  return request<WorkOrderOperation[]>(`/work-orders/${workOrderId}/operations`);
}

/** One extra operation on the end — the rework loop, the second inspection. */
export function addOperation(
  workOrderId: string,
  data: {
    name: string;
    app_id?: string | null;
    department_id?: string | null;
    station_id?: string | null;
    standard_seconds?: number;
    quantity_required?: number;
  },
): Promise<WorkOrderOperation> {
  return request<WorkOrderOperation>(`/work-orders/${workOrderId}/operations`, {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

/**
 * Move one operation by hand. `hold_reason` is stored on the WORK ORDER, not
 * the operation: putting an operation on hold and saying why is one action for
 * a supervisor and two columns underneath.
 */
export function updateOperation(
  workOrderId: string,
  operationId: string,
  patch: { status?: OperationStatus; station_id?: string | null; hold_reason?: string | null },
): Promise<WorkOrderOperation> {
  return request<WorkOrderOperation>(`/work-orders/${workOrderId}/operations/${operationId}`, {
    method: 'PUT',
    body: JSON.stringify(patch),
  });
}

/** Which live jobs run on a routing. Pro-gated with the rest of /routings. */
export function getRoutingUsage(routingId: string): Promise<RoutingUsage> {
  return request<RoutingUsage>(`/routings/${routingId}/usage`);
}

/**
 * How an operation reads in one line: "Op 3 of 7 · Weld · 12/50 · 6m 10s std".
 * The caller supplies the duration formatter — components/apps/appModel's
 * `fmtDuration` is the only one in the product, and this module must not become
 * a second place that decides what a duration looks like.
 */
export function operationLine(
  op: Pick<WorkOrderOperation, 'sequence' | 'of' | 'name' | 'quantity_completed' | 'quantity_required' | 'standard_seconds'>,
  fmtDuration: (seconds: number) => string,
): string {
  const parts = [
    `Op ${op.sequence} of ${op.of}`,
    op.name || 'Unnamed operation',
    `${op.quantity_completed}/${op.quantity_required}`,
  ];
  // A standard time of zero is "nobody has set one", not "instant" — so it is
  // left out rather than printed as 0s.
  if (op.standard_seconds > 0) parts.push(`${fmtDuration(op.standard_seconds)} std`);
  return parts.join(' · ');
}

/** The status chip's words. Kept here so one spelling reaches every screen. */
export const OPERATION_STATUS_LABELS: Record<OperationStatus, string> = {
  queued: 'Queued',
  ready: 'Ready',
  running: 'Running',
  complete: 'Complete',
  skipped: 'Skipped',
  on_hold: 'On hold',
};

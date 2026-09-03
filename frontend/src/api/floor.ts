// ─── The plant's own answer about its own day ─────────────────────────────────
//
// One HTTP call, one set of numbers. Everything on this payload was measured
// server-side against the PLANT's calendar day — never the tablet's clock, and
// never recomputed in a component. `plant_date` is the day the numbers describe;
// a screen prints it rather than deriving one of its own.
//
// The honesty contract, mirrored in the types below:
//
//   * A number nobody measured is `null`, never 0, and the `_sample` beside it
//     says how many observations are behind it. `pass_rate: 0` means every
//     inspected run failed; `pass_rate: null` with `pass_rate_sample: 0` means
//     nothing was inspected. Rendering those the same way is the bug this
//     module exists to make impossible.
//   * Every nullable number ships a `_reason` string. Print it where the number
//     would go — a bare "—" leaves a supervisor guessing whether the line is
//     broken or the day has not started.
//   * `on_track_basis` names what the on-track counts are a share OF, so a tile
//     cannot quietly print them over a different denominator.

import { request } from './client';

/** What an average duration was measured with. `mixed` = some of each. */
export type CycleBasis = 'hands_on' | 'elapsed' | 'mixed';

/** What the on-track counts are a share of. */
export type OnTrackBasis = 'open_work_orders';

/** The window a measured number was taken over. Every payload carrying an
 *  average or a pass rate names its window, so a reader never has to guess
 *  whether a tile means today, this week or all time — the difference between
 *  two screens is then a stated question, not a suspected bug. */
export type MeasurementWindow = 'today' | '7d' | '30d' | 'all';

/** The scope the server actually applied — not the one the client asked for. */
export interface FloorScope {
  site_id: string | null;
  department_id: string | null;
  app_id: string | null;
  station_id: string | null;
  /** False when an id in the request belongs to no record this company owns.
   *  Every figure is then an empty scope's: zeros, nulls, and no names. */
  valid: boolean;
}

/** The plant's state, for the plant's own day. */
export interface FloorSnapshot {
  /** Runs ONE operator finished on this same plant day, when the request named
   *  one (`operator_user_id` / `operator_name`). null — never 0 — when nobody
   *  said who is asking, or when the id belongs to no user this company owns.
   *  The Operator Portal's TODAY tile reads this instead of counting the
   *  tablet's own midnight, which is how it used to disagree with every
   *  management screen after 8pm. */
  finished_today_for_operator?: number | null;
  /** Why it is null, for the tile to print in its place. */
  finished_today_for_operator_reason?: string | null;

  /** 'YYYY-MM-DD' at the plant right now. What "today" means on this payload. */
  plant_date: string;
  /** The IANA zone that date was computed in; 'UTC' when none is configured. */
  timezone: string;

  /** Runs that FINISHED on the plant's day. A count: 0 means zero finished. */
  finished_today: number;
  /** Runs open on the floor at this instant. Live, not a day measure. */
  running_now: number;

  /** Today's average run duration. null when nothing finished — never 0. */
  avg_cycle_seconds: number | null;
  avg_cycle_basis: CycleBasis | null;
  /** Runs behind the average. 0 ⇒ avg_cycle_seconds is null. */
  avg_cycle_sample: number;
  /** Why it is null, for the screen to print in its place. */
  avg_cycle_reason: string | null;
  /** The window this average was taken over. 'today' on the floor snapshot. */
  avg_cycle_window: MeasurementWindow;

  /** Today's pass rate over INSPECTED runs only, 0–100. null when none were. */
  pass_rate: number | null;
  /** Inspected runs behind it. 0 ⇒ pass_rate is null. */
  pass_rate_sample: number;
  pass_rate_reason: string | null;
  pass_rate_pass: number;
  pass_rate_fail: number;
  /** The window this rate was taken over. 'today' on the floor snapshot. */
  pass_rate_window: MeasurementWindow;

  /** Work orders still open — the denominator on_track is a share of. */
  open_work_orders: number;
  on_track: number;
  at_risk: number;
  behind: number;
  overdue: number;
  not_started: number;
  completed_work_orders: number;
  total_work_orders: number;
  /** on_track as a percentage of open_work_orders. null when none are open —
   *  0% would read as "everything is late". */
  on_track_pct: number | null;
  on_track_reason: string | null;
  on_track_basis: OnTrackBasis;

  scope: FloorScope;
}

/** One department's snapshot, in the per-department listing. */
export interface DepartmentSnapshot extends Omit<FloorSnapshot, 'scope'> {
  department_id: string;
  department_name: string;
  department_color: string | null;
  /** Full precision, for a caller converting to another unit. Never round a
   *  rounded number — that is how 3.2 s once became 6 s on the busiest screen. */
  avg_cycle_seconds_raw: number | null;
}

export interface FloorDepartments {
  plant_date: string;
  timezone: string;
  departments: DepartmentSnapshot[];
  scope: { site_id: string | null; valid: boolean };
}

export interface FloorParams {
  site_id?: string | null;
  department_id?: string | null;
  app_id?: string | null;
  station_id?: string | null;
  product_type_id?: string | null;
  /** Adds finished_today_for_operator to the snapshot. NOT a scope: the plant's
   *  numbers do not change because an operator asked. */
  operator_user_id?: string | null;
  operator_name?: string | null;
}

/** Drop empty filters so `?department_id=` never reaches the server as a real
 *  (and unmatchable) id. */
function query(params?: FloorParams): string {
  if (!params) return '';
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value != null && value !== '') search.set(key, String(value));
  }
  const qs = search.toString();
  return qs ? `?${qs}` : '';
}

/** The whole plant, or one department / site / app / station of it. */
export function getFloorSnapshot(params?: FloorParams): Promise<FloorSnapshot> {
  return request<FloorSnapshot>(`/floor/snapshot${query(params)}`);
}

/** The same snapshot for every department, answered in one round trip. */
export function getFloorDepartments(params?: Pick<FloorParams, 'site_id'>): Promise<FloorDepartments> {
  return request<FloorDepartments>(`/floor/departments${query(params)}`);
}

// ─── Dispatch: what to run next, here ─────────────────────────────────────────
//
// The keystone wrote ordered operations onto every released work order and no
// screen read them. These three calls are that data reaching a screen, under
// the same honesty contract as the snapshot above: a scope is valid or empty,
// a number nobody measured is null with a reason, and the plant's day is the
// server's answer rather than the tablet's.

/** What one dispatch row is. An operation belongs to a job; an app is a
 *  standing one that needs no work order at all. */
export type DispatchKind = 'operation' | 'app';

/** One thing that can be started right now. */
export interface DispatchRow {
  kind: DispatchKind;
  /** True for a published app that needs no work order — the row the Operator
   *  Portal could never show, because it listed work orders. */
  no_work_order: boolean;

  /** The operation, when this row is one. Null on a standing app. */
  work_order_operation_id: string | null;
  work_order_id: string | null;
  work_order_number: string | null;
  part_number: string | null;
  part_name: string | null;
  priority: string | null;
  due_date: string | null;

  /** "Op 3 of 7 · Weld" — sequence, count and name, or nulls on a standing app. */
  operation_sequence: number | null;
  operation_count: number | null;
  operation_name: string | null;
  /** 'ready' | 'running' for an operation; 'ready' for a standing app. */
  status: string;
  started_at: string | null;

  /** The order booked against this operation. Null on a standing app — no job
   *  means no ordered quantity, and 0 would read as "none of them are done". */
  quantity_required: number | null;
  quantity_completed: number | null;
  standard_seconds: number | null;

  department_id: string | null;
  department_name: string | null;
  department_color: string | null;
  station_id: string | null;
  station_name: string | null;

  /** The app to open. Null when the routing step named none — the row is still
   *  the next thing due on that job, and `app_reason` says what is missing. */
  app_id: string | null;
  app_name: string | null;
  app_reason: string | null;

  /** Present on a standing app: why it needs no work order. */
  reason?: string | null;
}

export interface FloorDispatch {
  plant_date: string;
  timezone: string;
  /** The operation statuses this list was built from, named on the payload. */
  statuses: string[];
  /** The order the rows are in, in words. */
  order: string;
  rows: DispatchRow[];
  scope: FloorScope;
}

/** Where one job stands, in the shape the search box prints. */
export interface WipRow {
  work_order_id: string;
  work_order_number: string;
  part_number: string;
  part_name: string;
  /** null on a job nobody released — never "operation 0 of 0". */
  operation_sequence: number | null;
  /** How many operations the job has. A count: 0 means it has none. */
  operation_count: number;
  operation_name: string | null;
  department_name: string | null;
  quantity_completed: number;
  quantity_required: number;
  /** The operation's status when released, else the work order's own. */
  status: string;
  /** The JOB's status, always — so a reader can see that the thing they
   *  searched for is cancelled or finished without parsing the sentence. */
  work_order_status: string;
  started_at: string | null;
  released: boolean;
  /** The whole answer, in one sentence, written by the server so the Schedule,
   *  the Command Center and anything else asking cannot word it differently. */
  answer: string;
}

export interface WipAnswer {
  plant_date: string;
  timezone: string;
  query: string;
  /** Which of the three questions the server answered — a number, a part
   *  number, or the part NAME printed beside them on every screen. Every value
   *  the server can send is here: a union missing one is a `switch` that
   *  compiles while the case it needs is unreachable. */
  match: 'work_order' | 'part_number' | 'part_name' | 'none';
  /** The one job, when the query resolved to exactly one. */
  result: WipRow | null;
  /** Every job that matched — several when a part number is shared. */
  results: WipRow[];
  answer: string | null;
  /** Why there is no answer, for the screen to print instead of an empty box. */
  reason: string | null;
  /** How many jobs matched in total — which is not `results.length` once a
   *  popular part is capped. */
  total_matches: number;
  /** True when the plant has more jobs on this part than the page shows. */
  truncated: boolean;
  /** Say so on screen: "25" read as "all of them" is a wrong answer. */
  truncated_note: string | null;
}

/** One department's work in progress, by operation. */
export interface WipDepartment {
  /** null on the 'No department' bucket — the work that belongs to none. */
  department_id: string | null;
  department_name: string;
  department_color: string | null;
  running: number;
  queued: number;
  /** What `queued` counted, named so a strip cannot re-word it. */
  queued_basis: string;
  /** Today's counted units. null WITH A REASON until anybody counts any — a
   *  plant that has recorded no scrap has not made zero scrap. */
  good_today: number | null;
  good_today_sample: number;
  good_today_reason: string | null;
  scrap_today: number | null;
  scrap_today_sample: number;
  scrap_today_reason: string | null;
}

/** The plant's totals. Taken ungrouped, so work belonging to no department is
 *  in them — summing the rows is exactly how such work used to vanish. */
export interface WipTotals extends Omit<WipDepartment, 'department_id' | 'department_name' | 'department_color'> {
  /** What the totals are a total OF, said out loud. */
  basis: string;
}

export interface WipSummary {
  plant_date: string;
  timezone: string;
  departments: WipDepartment[];
  totals: WipTotals;
  scope: { site_id: string | null; department_id: string | null; valid: boolean };
}

/** The queue for a department / station: ready and running operations in
 *  priority → due date → sequence order, plus the standing apps. */
export function getFloorDispatch(params?: FloorParams): Promise<FloorDispatch> {
  return request<FloorDispatch>(`/floor/dispatch${query(params)}`);
}

/** "Where is WO-1042?" — one sentence, written by the server. */
export function getWip(q: string): Promise<WipAnswer> {
  return request<WipAnswer>(`/floor/wip?q=${encodeURIComponent(q)}`);
}

/** Running / queued / good / scrap today, per department. */
export function getWipSummary(params?: Pick<FloorParams, 'site_id' | 'department_id'>): Promise<WipSummary> {
  return request<WipSummary>(`/floor/wip-summary${query(params)}`);
}

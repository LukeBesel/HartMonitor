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

  /** Today's pass rate over INSPECTED runs only, 0–100. null when none were. */
  pass_rate: number | null;
  /** Inspected runs behind it. 0 ⇒ pass_rate is null. */
  pass_rate_sample: number;
  pass_rate_reason: string | null;
  pass_rate_pass: number;
  pass_rate_fail: number;

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

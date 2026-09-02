// ─── The floor's own view of the floor ────────────────────────────────────────
//
// What ONE operator, standing at ONE station, needs the server to tell them:
// what they should run next, what they left half-finished, and what they have
// already done today. Everything here is the server's answer — the portal runs
// on a tablet whose clock and whose timezone are nobody's idea of the truth,
// which is exactly how it used to disagree with every management screen about
// what "today" meant.

import { request } from './client';
import { getFloorDispatch, type FloorDispatch, type DispatchRow } from './floor';

export type { FloorDispatch, DispatchRow };

/** One run, as the completions API returns it. */
export interface OperatorRun {
  id: string;
  app_id: string;
  app_name: string;
  station_id: string | null;
  work_order_id: string | null;
  /** Written by the player once a run is started against a specific operation.
   *  Absent on every run recorded before that — read defensively, never
   *  assumed. */
  work_order_operation_id?: string | null;
  operator_name: string;
  started_at: string;
  completed_at: string | null;
  status: 'in_progress' | 'completed' | 'abandoned';
  /** Per-step timers, keyed by step index. The canonical duration comes from
   *  appModel's runDurationSeconds, never from arithmetic here. */
  step_times?: Record<string, unknown> | null;
}

export interface OperatorQueueParams {
  /** The station this tablet is standing at, when one was chosen. */
  station_id?: string | null;
  /** The department that station belongs to. */
  department_id?: string | null;
  site_id?: string | null;
}

/**
 * What this operator should run next: the ready and running operations for
 * their station (and, through it, their department), plus the published apps
 * that need no work order at all.
 *
 * That last group is the whole reason this call exists. The portal used to list
 * WORK ORDERS, so 'Final QC Inspection' — published, runnable, attached to no
 * job — was unreachable from the tablet meant to run it, and the header said
 * "2 jobs available" about a floor with three things to do.
 */
export function getOperatorQueue(params: OperatorQueueParams = {}): Promise<FloorDispatch> {
  return getFloorDispatch(params);
}

/** Runs this operator left open. Newest first, as the server orders them. */
export function getOperatorRuns(operatorName: string, limit = 50): Promise<OperatorRun[]> {
  const q = new URLSearchParams({ status: 'in_progress', operator_name: operatorName, limit: String(limit) });
  return request<OperatorRun[]>(`/completions?${q.toString()}`);
}

/** Everything this operator has touched recently, finished or not. */
export function getOperatorHistory(operatorName: string, limit = 50): Promise<OperatorRun[]> {
  const q = new URLSearchParams({ operator_name: operatorName, limit: String(limit) });
  return request<OperatorRun[]>(`/completions?${q.toString()}`);
}

// ─── Shaping what the tablet shows ────────────────────────────────────────────

/**
 * One row per piece of work, not one per row the reaper has not closed yet.
 *
 * A tablet that reloads mid-run starts a second completion against the same
 * job, and runReaper.js only closes an abandoned run after twelve hours — so an
 * operator who lost signal three times over a shift came back to an uncapped
 * pile of identical "Jobs in progress" and no way to tell which one they were
 * actually on. The newest row for each (work order, operation, app) is the one
 * they were on; the rest are the same work, listed again.
 *
 * WHAT `work_order_operation_id` DOES TODAY: completions do not carry it yet —
 * the column arrives with the scrap workstream, written by the player from the
 * `op` on the deep link. Until it does, every run reads `undefined` there and
 * the key is effectively (work order, app): two runs on operation 1 and
 * operation 4 of the same job, in the same app, COLLAPSE INTO ONE ROW.
 *
 * That is the right trade while the column is missing — the alternative is the
 * pile this replaces — and it stops being a trade the moment the column lands,
 * with no change here. Both behaviours are pinned in
 * pages/__tests__/operator-portal.test.tsx so the change is visible when it
 * happens rather than discovered.
 *
 * This HIDES rows. It closes nothing, touches no other operator's run, and asks
 * the server for nothing — the reaper's twelve-hour rule is a separate
 * question, and dedupe is not allowed to be a stealth answer to it.
 */
export function dedupeRuns<T extends {
  id: string;
  app_id: string;
  work_order_id?: string | null;
  work_order_operation_id?: string | null;
  started_at: string;
}>(runs: T[]): T[] {
  const newest = new Map<string, T>();
  for (const run of runs) {
    const key = [
      run.work_order_id ?? '',
      run.work_order_operation_id ?? '',
      run.app_id ?? '',
    ].join('|');
    const held = newest.get(key);
    if (!held || startedAtMs(run.started_at) > startedAtMs(held.started_at)) newest.set(key, run);
  }
  // Newest work first — what the operator was doing a minute ago is what they
  // are coming back to.
  return [...newest.values()].sort((a, b) => startedAtMs(b.started_at) - startedAtMs(a.started_at));
}

/** A stored stamp as milliseconds. SQLite writes 'YYYY-MM-DD HH:MM:SS' with no
 *  zone marker, which `new Date()` reads as the BROWSER's local time and slides
 *  by hours on every tablet that is not set to UTC. Both are UTC; only one says
 *  so, so this says it for both. */
function startedAtMs(iso: string | null | undefined): number {
  if (!iso) return 0;
  const s = String(iso).trim().replace(' ', 'T');
  const d = new Date(/[Zz]$|[+-]\d{2}:?\d{2}$/.test(s) ? s : `${s}Z`);
  return Number.isNaN(d.getTime()) ? 0 : d.getTime();
}

/**
 * A timestamp on the PLANT's clock.
 *
 * `timeZone` comes from the snapshot the server sent — never
 * `Intl.DateTimeFormat()`'s default, which is the tablet's own setting and is
 * wrong on every kiosk somebody unboxed without touching the region screen.
 * That is the same class of mistake as counting "today" in the browser, and it
 * shows up in exactly the place an operator is trying to work out which of two
 * runs is theirs.
 */
export function stampIn(iso: string | null | undefined, timeZone: string): string {
  const ms = startedAtMs(iso);
  if (!ms) return '—';
  try {
    return new Intl.DateTimeFormat('en-US', {
      timeZone: timeZone || 'UTC',
      month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
    }).format(new Date(ms));
  } catch {
    // A zone the runtime does not know is a settings problem, not a reason to
    // blank the row — fall back to UTC and keep the stamp readable.
    return new Intl.DateTimeFormat('en-US', {
      timeZone: 'UTC', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
    }).format(new Date(ms));
  }
}

/** "Op 3 of 7 · Weld", or "No work order needed" for a standing app. One
 *  sentence, written once, so the portal and the Schedule cannot word the same
 *  row two ways. */
export function dispatchRowLabel(row: Pick<DispatchRow,
  'no_work_order' | 'operation_sequence' | 'operation_count' | 'operation_name'>): string {
  if (row.no_work_order) return 'No work order needed';
  if (row.operation_sequence == null || row.operation_count == null) return 'Operation';
  const name = (row.operation_name ?? '').trim();
  // A routing whose steps are called "Op 1", "Step 2" and so on — which the
  // importer and the demo seed both produce — otherwise reads "Op 1 of 4 · Op
  // 1", saying the same number twice and looking like a rendering fault.
  const echoesSequence = new RegExp(`^(op|operation|step)\\s*0*${row.operation_sequence}$`, 'i').test(name);
  const suffix = name && !echoesSequence ? ` · ${name}` : '';
  return `Op ${row.operation_sequence} of ${row.operation_count}${suffix}`;
}

// ─── The demo's own PINs, when the server says this is a demo ─────────────────

/**
 * The PINs a SANDBOX hands out, straight from the server.
 *
 * A visitor who taps a name on the PIN pad of a sandbox they were dropped into
 * has no way to know the demo operator's PIN is 1234, and the dead end is the
 * first screen of the product they meet. GET /api/auth/me carries `demo_hints`
 * on a sandbox and on nothing else, so the hint is the SERVER saying "this is a
 * demo" — never a guess this screen makes from a hostname or a flag it invented.
 */
export interface DemoHints {
  operator_pin?: string | null;
  supervisor_pin?: string | null;
  manager_pin?: string | null;
}

/**
 * `demo_hints` from GET /api/auth/me, or null.
 *
 * Null for every real company, for a signed-out visitor, for an older server
 * that does not send the field, and for any failure at all: a screen that
 * printed a PIN because a request went wrong would be worse than one that
 * printed nothing.
 */
export async function getDemoHints(): Promise<DemoHints | null> {
  try {
    const me = await request<{ demo_hints?: DemoHints | null }>('/auth/me');
    const hints = me && typeof me === 'object' ? me.demo_hints : null;
    if (!hints || typeof hints !== 'object') return null;
    // Only the PINs, and only ones that are really strings — the line renders
    // off what is present, so a null field must not become "null" on a tablet.
    const clean: DemoHints = {};
    for (const key of ['operator_pin', 'supervisor_pin', 'manager_pin'] as const) {
      const v = (hints as Record<string, unknown>)[key];
      if (typeof v === 'string' && v.trim()) clean[key] = v.trim();
    }
    return Object.keys(clean).length > 0 ? clean : null;
  } catch {
    return null;
  }
}

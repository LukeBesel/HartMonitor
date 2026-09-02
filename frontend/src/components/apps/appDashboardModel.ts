// Pure logic behind the one per-app screen (/apps/:id): the filters its one
// filter bar sends, the headline numbers the analytics payload can actually
// support, the "who ran it" rollup, and the four different nothings.
//
// The app picker that used to live here went with Apps → Dashboard: the app
// card in the library is the only entrance to per-app data now, so there is
// no remembered selection to resolve.
//
// Every function here is a pure read over data the server sent. A metric that
// the data cannot support comes back as `value: null` carrying the reason, so
// the page renders "—" and says why instead of printing a zero nobody measured.
// Nothing in here derives a number the server did not already count.

import type { AppAnalyticsResponse } from '../../api/client';
import { durationBasisLabel, fmtDuration, measuredSeconds, pluralize } from './appModel';

// ─── Filters the analytics endpoint actually honours ─────────────────────────
// GET /api/apps/:id/analytics filters on exactly these four (see
// buildCompletionFilters in backend/src/routes/apps.js). Anything else sent
// along would be ignored server-side and would look like it worked.

export interface AppDashboardFilters {
  days: number;
  operator: string;
  workOrderId: string;
  productTypeId: string;
  /** Applied to the runs on screen, not sent to the server: the analytics
   *  endpoint has no result dimension, and pretending it did would filter a
   *  slice the totals above the table were not taken over. */
  result: ResultFilter;
  /** Same deal — narrows the rows, never the totals. */
  status: StatusFilter;
  /** Free text over operator, work order and run id, over the loaded rows. */
  query: string;
}

export type ResultFilter = 'all' | 'pass' | 'fail' | 'unchecked';
export type StatusFilter = 'all' | 'completed' | 'in_progress' | 'abandoned';

export const DEFAULT_FILTERS: AppDashboardFilters = {
  days: 30, operator: '', workOrderId: '', productTypeId: '',
  result: 'all', status: 'all', query: '',
};

/** Day windows offered by the picker. The server clamps `days` to 1..365. */
export const DAY_PRESETS = [7, 30, 90, 365] as const;

/** True when something narrower than the plain day window is applied. */
export function hasNarrowingFilters(filters: AppDashboardFilters): boolean {
  return !!(filters.operator || filters.workOrderId || filters.productTypeId
    || filters.result !== 'all' || filters.status !== 'all' || filters.query.trim());
}

/** True for the three the SERVER honours — the ones the totals move with. */
export function hasServerFilters(filters: AppDashboardFilters): boolean {
  return !!(filters.operator || filters.workOrderId || filters.productTypeId);
}

/**
 * The filters a URL is carrying, in the SAME parameter names the API takes —
 * `days`, `operator`, `work_order_id`, `product_type_id`. The retired Apps
 * Dashboard handed those four to /apps/:id/analytics through the query string,
 * so reading them here is what keeps every one of those links landing on the
 * slice it named rather than on a reset page.
 *
 * A `days` outside the offered windows falls back to the default rather than
 * being sent on to the server to be clamped into a window nothing on screen
 * says out loud.
 */
export function filtersFromQuery(params: URLSearchParams): AppDashboardFilters {
  const days = Number.parseInt(params.get('days') ?? '', 10);
  const result = params.get('result');
  const status = params.get('status');
  return {
    days: (DAY_PRESETS as readonly number[]).includes(days) ? days : DEFAULT_FILTERS.days,
    operator: params.get('operator') ?? '',
    workOrderId: params.get('work_order_id') ?? '',
    productTypeId: params.get('product_type_id') ?? '',
    result: (['pass', 'fail', 'unchecked'] as const).includes(result as never)
      ? (result as ResultFilter) : 'all',
    status: (['completed', 'in_progress', 'abandoned'] as const).includes(status as never)
      ? (status as StatusFilter) : 'all',
    query: params.get('q') ?? '',
  };
}

/**
 * True when the URL asked for a day window this screen does not offer.
 *
 * `?days=14` was silently rounded to 30 and then reported as "the last 30
 * days": a window nobody asked for, under a label nobody could question. The
 * screen normalises the URL to the window it actually used instead, and says
 * it did.
 */
export function unofferedDays(params: URLSearchParams): number | null {
  const raw = params.get('days');
  if (raw === null || raw === '') return null;
  const days = Number.parseInt(raw, 10);
  if (Number.isNaN(days)) return null;
  return (DAY_PRESETS as readonly number[]).includes(days) ? null : days;
}

// ─── Headline metrics ────────────────────────────────────────────────────────

export interface HeadlineMetric {
  key: 'runs' | 'completed' | 'avg_cycle' | 'best_cycle' | 'first_pass_yield';
  label: string;
  /** Formatted value, or null when the data cannot support the metric. */
  value: string | null;
  /** Why it reads "—", or what a real value was measured over, and the window
   *  it was taken over — every tile names its own window. */
  note: string;
}

/**
 * The four tiles. Counts the server actually counted are shown as counts; every
 * rate and average is null-checked first, because "no pass/fail check was ever
 * recorded" and "everything failed" are different facts and must not both
 * render as 0%.
 */
export function buildHeadlineMetrics(
  totals: AppAnalyticsResponse['totals'],
  days: number,
  /** Summed per-step takt for this app, when it has one. A cycle time only
   *  means something against the time the job was planned to take. */
  taktSeconds: number | null = null,
): HeadlineMetric[] {
  const noRuns = totals.runs === 0;
  // Every tile names the window it was taken over. Four numbers in a row with
  // no window on them is how the same tile got read as "today" on one screen
  // and "all time" on the next.
  const window = `last ${days} days`;
  const avg = measuredSeconds(totals.avg_duration_s);
  const takt = measuredSeconds(taktSeconds);
  const best = measuredSeconds(totals.best_duration_s);
  const qcSample = totals.qc_sample_size ?? 0;
  const vsTakt = avg !== null && takt !== null ? avg - takt : null;

  return [
    {
      key: 'avg_cycle',
      // The basis rides the label: hands-on step time and wall clock are two
      // different, both-correct numbers for the same runs, and an unlabelled
      // average is what made two screens look like they contradicted each other.
      label: measuredSeconds(totals.avg_duration_s) !== null && durationBasisLabel(totals.avg_duration_basis)
        ? `Average cycle time · ${durationBasisLabel(totals.avg_duration_basis)}`
        : 'Average cycle time',
      // The server averages wall clock between start and finish, so runs that
      // opened and closed inside one second average out to 0. Zero seconds is
      // not a cycle time anyone can act on — it is the shape of "nobody timed
      // it", which is exactly what Run History reports as "—". Treat it the
      // same here rather than letting one screen print 0s for what another
      // screen calls unknown.
      value: avg === null ? null : fmtDuration(avg),
      note: avg === null
        ? (noRuns ? `no runs in the ${window}`
          : totals.completed === 0 ? `no run has finished in the ${window}`
            : `no finished run was timed · ${window}`)
        // Against takt when the app has one: a cycle time on its own is a
        // number, and a number against the planned time is an answer.
        : vsTakt !== null
          ? `${vsTakt > 0 ? '+' : '−'}${fmtDuration(Math.abs(vsTakt))} vs takt ${fmtDuration(takt)} · ${window}`
          // The sign carries the direction: "+31s vs takt 6m 5s" is over,
          // "−31s" is under. No colour is doing work the words are not.
          : `over ${pluralize(totals.completed, 'completed run')} · ${window}`,
    },
    {
      key: 'best_cycle',
      label: 'Best cycle time',
      value: best === null ? null : fmtDuration(best),
      note: best === null
        ? (noRuns ? `no runs in the ${window}` : `no finished run was timed · ${window}`)
        : `fastest completed run · ${window}`,
    },
    {
      key: 'first_pass_yield',
      label: 'First-pass yield',
      value: totals.first_pass_yield === null ? null : `${Math.round(totals.first_pass_yield)}%`,
      note: totals.first_pass_yield === null
        ? (noRuns ? `no runs in the ${window}` : `no pass/fail check recorded · ${window}`)
        // The sample is the point: 100% of two inspected runs and 100% of two
        // hundred are the same number and not the same claim.
        : `from ${pluralize(qcSample, 'inspected run')} · ${window}`,
    },
    {
      key: 'completed',
      label: 'Completed',
      value: String(totals.completed),
      // A completion rate over zero runs is a made-up percentage, not a zero.
      note: noRuns
        ? `no runs to complete · ${window}`
        : `${Math.round((totals.completed / totals.runs) * 100)}% of runs started · ${window}`,
    },
    {
      key: 'runs',
      label: 'Runs started',
      value: String(totals.runs),
      note: noRuns
        ? `nothing started in the ${window}`
        : `${totals.abandoned} abandoned · ${window}`,
    },
  ];
}

// ─── Empty states ────────────────────────────────────────────────────────────
// Four different nothings, and the page must not blur them: no apps at all, an
// app nobody has ever run, an app that ran but not lately, and filters that
// happen to match nothing.

export type DashboardEmptyReason =
  | { kind: 'no-apps' }
  | { kind: 'never-run'; appName: string }
  | { kind: 'no-runs-in-window'; appName: string; days: number; lastRunAt: string | null }
  | { kind: 'no-match-filters'; appName: string; days: number };

/** The little the empty states need to know about the app itself. */
export interface EmptyStateApp {
  name: string;
  /** Lifetime runs, or null when that counter is unknown — never assumed zero. */
  runsTotal: number | null;
  lastRunAt: string | null;
}

export function emptyReasonFor(input: {
  appCount: number;
  app: EmptyStateApp | null;
  runsInWindow: number;
  days: number;
  filtersActive: boolean;
}): DashboardEmptyReason | null {
  const { appCount, app, runsInWindow, days, filtersActive } = input;
  if (appCount === 0) return { kind: 'no-apps' };
  if (!app) return null;
  if (runsInWindow > 0) return null;
  if (filtersActive) return { kind: 'no-match-filters', appName: app.name, days };
  // `runsTotal === null` means the counters didn't load; unknown is not zero, so
  // fall through to the softer "nothing in this window" rather than assert the
  // app has never been run.
  if (app.runsTotal === 0) return { kind: 'never-run', appName: app.name };
  return { kind: 'no-runs-in-window', appName: app.name, days, lastRunAt: app.lastRunAt };
}

// ─── Captured-field summaries ────────────────────────────────────────────────

/**
 * One line of plain English per captured field, describing what operators
 * actually entered. Fields whose values the server could not summarise read
 * "—" here too rather than borrowing a neighbour's number.
 */
export function summariseField(field: AppAnalyticsResponse['fields'][number]): string {
  const stats = field.stats;
  switch (field.kind) {
    case 'number': {
      if (stats.avg === null || stats.avg === undefined) return '—';
      return `avg ${fmtNumber(stats.avg)} · range ${fmtNumber(stats.min)}–${fmtNumber(stats.max)}`;
    }
    case 'boolean': {
      const pass = stats.pass ?? 0;
      const fail = stats.fail ?? 0;
      if (pass + fail === 0) return '—';
      const pct = stats.yield_pct;
      return `${pass} pass · ${fail} fail${pct === null || pct === undefined ? '' : ` · ${Math.round(pct)}% pass rate`}`;
    }
    case 'option': {
      const options = stats.options ?? [];
      if (options.length === 0) return '—';
      return options.slice(0, 3).map(o => `${o.value} (${o.count})`).join(' · ')
        + (options.length > 3 ? ` · +${options.length - 3} more` : '');
    }
    default:
      return pluralize(stats.count ?? 0, 'entry', 'entries');
  }
}

/** Entries counted for a field — the "how much of this was actually captured" column. */
export function fieldSampleSize(field: AppAnalyticsResponse['fields'][number]): number {
  if (field.kind === 'boolean') return (field.stats.pass ?? 0) + (field.stats.fail ?? 0);
  return field.stats.count ?? 0;
}

function fmtNumber(n: number | null | undefined): string {
  if (n === null || n === undefined) return '—';
  return Number.isInteger(n) ? String(n) : String(Math.round(n * 1000) / 1000);
}

// ─── Who ran it ──────────────────────────────────────────────────────────────

/** One person's row in the "who ran it" rollup. */
export interface OperatorRollupRow {
  /** Their name, or "Unknown" when the run recorded none. */
  name: string;
  runs: number;
  /** 0–1, this person's runs against the busiest person's — the bar's width. */
  share: number;
  /** Their average cycle, already formatted, or null when nothing timed them. */
  avgCycle: string | null;
  /** Why the average is missing, or what it was measured over. */
  avgNote: string;
}

/**
 * The "who ran it" rollup, ordered busiest first.
 *
 * An operator whose runs were never timed has NO average — rendering "avg 0s"
 * there would name them the fastest person on the floor, which is the exact
 * shape of the bug `measuredSeconds` exists to stop. The share is taken against
 * the busiest person in the slice, so the bars compare people with each other
 * rather than with a total nothing on screen shows.
 */
export function buildOperatorRollup(
  rows: AppAnalyticsResponse['by_operator'],
): OperatorRollupRow[] {
  const busiest = Math.max(1, ...rows.map(r => r.runs));
  return rows
    .slice()
    .sort((a, b) => b.runs - a.runs)
    .map(row => {
      const seconds = measuredSeconds(row.avg_duration_s);
      return {
        name: row.operator_name || 'Unknown',
        runs: row.runs,
        share: row.runs / busiest,
        avgCycle: seconds === null ? null : fmtDuration(seconds),
        avgNote: seconds === null
          ? 'none of their runs was timed'
          : `average cycle time over ${pluralize(row.runs, 'run')}`,
      };
    });
}

// ─── Getting faster or slower ────────────────────────────────────────────────

export interface CycleTrend {
  /** Recent mean minus earlier mean, in seconds. Negative is faster. */
  deltaSeconds: number;
  /** How many runs are on EACH side of the comparison. */
  sample: number;
  /** True when the gap is too small to call a direction. */
  flat: boolean;
}

/**
 * Faster or slower: the most recent timed runs against the same number of timed
 * runs before them. Null until there are enough of both to compare — a "trend"
 * drawn from two runs is noise wearing a verdict's clothes — and `flat` when
 * the gap is inside the noise, because the same job done twice is not a
 * direction.
 *
 * Runs arrive newest-first (the API orders by started_at DESC); only finished,
 * timed runs count, since an untimed run has no length to trend.
 */
export function buildCycleTrend(
  runs: { status: string; duration_s: number | null }[],
): CycleTrend | null {
  const MIN_PER_SIDE = 3;
  const timed = runs
    .filter(r => r.status === 'completed' && measuredSeconds(r.duration_s) !== null)
    .map(r => measuredSeconds(r.duration_s) as number);
  if (timed.length < MIN_PER_SIDE * 2) return null;
  const half = Math.min(Math.floor(timed.length / 2), 20);
  const mean = (values: number[]) => values.reduce((s, v) => s + v, 0) / values.length;
  const recent = mean(timed.slice(0, half));
  const earlier = mean(timed.slice(half, half * 2));
  const deltaSeconds = recent - earlier;
  return {
    deltaSeconds,
    sample: half,
    flat: Math.abs(deltaSeconds) < Math.max(2, earlier * 0.02),
  };
}

// ─── Narrowing the rows on screen ────────────────────────────────────────────

/**
 * The result / status / free-text filters, applied to the runs the server sent.
 *
 * These three are deliberately client-side: GET /apps/:id/analytics has no
 * result, status or text dimension, so sending them would look like it worked
 * and quietly change nothing. They narrow the ROWS; the tiles above the table
 * keep reporting the server's slice, and the table says which is which.
 */
export function filterRuns<T extends {
  status: string;
  operator_name: string;
  work_order_number: string | null;
  id: string;
  pass_fail?: 'pass' | 'fail' | null;
}>(runs: T[], filters: AppDashboardFilters): T[] {
  const needle = filters.query.trim().toLowerCase();
  return runs.filter(run => {
    if (filters.status !== 'all' && run.status !== filters.status) return false;
    if (filters.result === 'pass' && run.pass_fail !== 'pass') return false;
    if (filters.result === 'fail' && run.pass_fail !== 'fail') return false;
    // "No check recorded" means exactly that: null, not a falsy 'pass'.
    if (filters.result === 'unchecked' && (run.pass_fail ?? null) !== null) return false;
    if (needle) {
      const hay = `${run.operator_name ?? ''} ${run.work_order_number ?? ''} ${run.id}`.toLowerCase();
      if (!hay.includes(needle)) return false;
    }
    return true;
  });
}

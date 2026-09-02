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
}

export const DEFAULT_FILTERS: AppDashboardFilters = {
  days: 30, operator: '', workOrderId: '', productTypeId: '',
};

/** Day windows offered by the picker. The server clamps `days` to 1..365. */
export const DAY_PRESETS = [7, 30, 90, 365] as const;

/** True when something narrower than the plain day window is applied. */
export function hasNarrowingFilters(filters: AppDashboardFilters): boolean {
  return !!(filters.operator || filters.workOrderId || filters.productTypeId);
}

/** Query-string form for deep-linking the full analytics page at the same slice. */
export function filtersToQuery(filters: AppDashboardFilters): string {
  const qs = new URLSearchParams();
  qs.set('days', String(filters.days));
  if (filters.operator) qs.set('operator', filters.operator);
  if (filters.workOrderId) qs.set('work_order_id', filters.workOrderId);
  if (filters.productTypeId) qs.set('product_type_id', filters.productTypeId);
  return `?${qs.toString()}`;
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
  return {
    days: (DAY_PRESETS as readonly number[]).includes(days) ? days : DEFAULT_FILTERS.days,
    operator: params.get('operator') ?? '',
    workOrderId: params.get('work_order_id') ?? '',
    productTypeId: params.get('product_type_id') ?? '',
  };
}

// ─── Headline metrics ────────────────────────────────────────────────────────

export interface HeadlineMetric {
  key: 'runs' | 'completed' | 'avg_cycle' | 'first_pass_yield';
  label: string;
  /** Formatted value, or null when the data cannot support the metric. */
  value: string | null;
  /** Why it reads "—", or what a real value was measured over. */
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
): HeadlineMetric[] {
  const noRuns = totals.runs === 0;

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
      value: measuredSeconds(totals.avg_duration_s) === null
        ? null
        : fmtDuration(measuredSeconds(totals.avg_duration_s)),
      note: measuredSeconds(totals.avg_duration_s) === null
        ? (noRuns ? 'no runs in this window'
          : totals.completed === 0 ? 'no run has finished yet'
            : 'no finished run was timed')
        : `over ${pluralize(totals.completed, 'completed run')}`,
    },
    {
      key: 'first_pass_yield',
      label: 'First-pass yield',
      value: totals.first_pass_yield === null ? null : `${Math.round(totals.first_pass_yield)}%`,
      note: totals.first_pass_yield === null
        ? (noRuns ? 'no runs in this window' : 'no pass/fail check recorded')
        : 'runs whose checks all passed',
    },
    {
      key: 'completed',
      label: 'Completed',
      value: String(totals.completed),
      // A completion rate over zero runs is a made-up percentage, not a zero.
      note: noRuns
        ? 'no runs to complete'
        : `${Math.round((totals.completed / totals.runs) * 100)}% of runs started`,
    },
    {
      key: 'runs',
      label: 'Runs started',
      value: String(totals.runs),
      note: noRuns
        ? `nothing started in the last ${days} days`
        : `${totals.abandoned} abandoned`,
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

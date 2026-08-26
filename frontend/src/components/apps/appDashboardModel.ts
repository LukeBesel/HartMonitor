// Pure logic behind Apps → Dashboard: which app the page opens on, where that
// choice is remembered, and — the rule the whole screen turns on — which
// headline numbers the analytics payload can actually support.
//
// Every function here is a pure read over data the server sent. A metric that
// the data cannot support comes back as `value: null` carrying the reason, so
// the page renders "—" and says why instead of printing a zero nobody measured.
// Nothing in here derives a number the server did not already count.

import type { AppAnalyticsResponse, AppRunStats } from '../../api/client';
import type { App } from '../../types';
import { durationBasisLabel, fmtDuration, measuredSeconds, parseServerTime, pluralize } from './appModel';

// ─── App options (the picker at the top) ─────────────────────────────────────

export interface DashboardAppOption {
  id: string;
  name: string;
  status: App['status'];
  /** Which department owns the app — the only department signal on this page. */
  departmentId: string | null;
  /**
   * Lifetime runs across all time, from /apps/stats. `null` when that call
   * failed: unknown is not zero, and the empty state must not claim an app has
   * never been run just because a stats request dropped.
   */
  runsTotal: number | null;
  /** Last time anybody ran it, all-time. Null when never run (or unknown). */
  lastRunAt: string | null;
}

/**
 * Join the app list with its run counters. Apps arrive from `GET /apps` already
 * ordered `updated_at DESC`; that order is preserved and becomes the tiebreak
 * for apps nobody has run yet.
 */
export function buildAppOptions(apps: App[], stats: AppRunStats[] | null): DashboardAppOption[] {
  const byId = new Map<string, AppRunStats>();
  for (const s of stats ?? []) byId.set(s.app_id, s);
  return apps.map(app => {
    const stat = byId.get(app.id);
    return {
      id: app.id,
      name: app.name,
      status: app.status,
      departmentId: app.department_id ?? null,
      runsTotal: stats === null ? null : stat?.runs_total ?? 0,
      lastRunAt: stat?.last_run_at ?? null,
    };
  });
}

/**
 * The app the page opens on when nothing is remembered: whichever was run most
 * recently, so arriving here shows data instead of asking a question. Apps
 * nobody has run sort last, keeping the incoming `updated_at DESC` order.
 */
export function pickDefaultAppId(options: DashboardAppOption[]): string | null {
  let best: DashboardAppOption | null = null;
  let bestAt = -Infinity;
  for (const option of options) {
    const at = parseServerTime(option.lastRunAt)?.getTime();
    if (at === undefined) continue;
    if (at > bestAt) { best = option; bestAt = at; }
  }
  return best?.id ?? options[0]?.id ?? null;
}

/**
 * Which app to show. A remembered id that no longer exists — deleted, another
 * company's, or filtered out of the current department — falls back to the
 * default rather than leaving the page pointed at nothing.
 */
export function resolveAppId(options: DashboardAppOption[], storedId: string | null): string | null {
  if (storedId && options.some(o => o.id === storedId)) return storedId;
  return pickDefaultAppId(options);
}

// ─── Remembering the choice (per user, per browser) ──────────────────────────

const SELECTION_PREFIX = 'hm_appdash_app';

/** Keyed by user so two people sharing a workstation don't inherit each other's app. */
export function appSelectionKey(userId?: string | null): string {
  return userId ? `${SELECTION_PREFIX}_${userId}` : SELECTION_PREFIX;
}

export function readSelectedAppId(userId?: string | null): string | null {
  try {
    return localStorage.getItem(appSelectionKey(userId)) || null;
  } catch {
    return null; // private mode — the choice just won't survive a reload
  }
}

export function writeSelectedAppId(userId: string | null | undefined, appId: string | null): void {
  try {
    if (appId) localStorage.setItem(appSelectionKey(userId), appId);
    else localStorage.removeItem(appSelectionKey(userId));
  } catch {
    /* private mode — nothing to persist to */
  }
}

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
        ? `Avg cycle time · ${durationBasisLabel(totals.avg_duration_basis)}`
        : 'Avg cycle time',
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

export function emptyReasonFor(input: {
  appCount: number;
  app: DashboardAppOption | null;
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

// The one screen for one app: /apps/:id.
//
// This app's cycle time used to be reported on five screens — a detail page, a
// run history, a per-app analytics page, an apps overview and a per-operation
// breakdown — under four different labels, at three different precisions, each
// behind its own filter bar. The numbers came from the same runs, so the disagreements were
// all presentation, and the one genuinely useful comparison ("who ran it") was
// six clicks and a dead end away.
//
// There is one screen now. It has ONE filter bar (`data-testid=app-filter-bar`)
// that every tab reads, and ONE vocabulary — "Average cycle time" with the
// basis it was measured on, "First-pass yield", "Runs" — all of it formatted by
// components/apps/appModel, which is the only place a duration is turned into
// text in this frontend.
//
//   Overview   what it is, what it produced in this slice, what went wrong
//   Runs       the runs themselves, newest first, one click from each record
//   Who ran it the per-operator rollup, from appDashboardModel
//   Steps      where the time goes, per step, against takt
//
// Everything below is measured. A number the payload cannot support renders
// "—" with the reason beside it; it never renders 0.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  Activity, AlertTriangle, ArrowLeft, BarChart2, Boxes, Building2, CheckCircle2,
  ChevronDown, ChevronRight, ChevronUp, ClipboardList, Clock, Copy, Download,
  Edit3, Gauge, GitBranch, Globe, Info, Layers, ListChecks, Lock, MapPin, Minus,
  MousePointerClick, Package, Play, RefreshCw, Search, SlidersHorizontal,
  TrendingDown, TrendingUp, User, Users, XCircle, Zap,
} from 'lucide-react';
import {
  Bar, BarChart, CartesianGrid, Cell, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import { api } from '../api/client';
import type {
  AppAnalyticsParams, AppAnalyticsResponse, AppDetailResponse,
} from '../api/client';
import PageHeader from '../components/shared/PageHeader';
import EmptyState from '../components/shared/EmptyState';
import StatCard from '../components/shared/StatCard';
import TabBar from '../components/shared/TabBar';
import LastRefreshed from '../components/shared/LastRefreshed';
import { useCoachDocked } from '../components/apps/AppTrainingCoach';
import { useAuth } from '../context/AuthContext';
import { usePlan } from '../context/PlanContext';
import { useToast } from '../context/ToastContext';
import {
  appShape, durationBasisLabel, durationBasisNote, durationTicks, elapsedSeconds,
  fmtDateTime, fmtDuration, fmtRelative, isCaptureWidget, measuredSeconds,
  orderedSteps, parseServerTime, pluralize, widgetTypeLabel, widgetsOf,
} from '../components/apps/appModel';
import {
  DAY_PRESETS, buildCycleTrend, buildHeadlineMetrics, buildOperatorRollup, emptyReasonFor,
  fieldSampleSize, filterRuns, filtersFromQuery, hasNarrowingFilters, hasServerFilters,
  summariseField, unofferedDays,
} from '../components/apps/appDashboardModel';
import type {
  AppDashboardFilters, CycleTrend, HeadlineMetric, ResultFilter, StatusFilter,
} from '../components/apps/appDashboardModel';
import { stepTaktSeconds } from '../components/player/runtime';
import useAutoRefresh from '../hooks/useAutoRefresh';

const REFRESH_MS = 60_000;
const ACCENT = '#6366f1';

type TabKey = 'overview' | 'runs' | 'who' | 'steps';
const TABS: { key: TabKey; label: string }[] = [
  { key: 'overview', label: 'Overview' },
  { key: 'runs', label: 'Runs' },
  { key: 'who', label: 'Who ran it' },
  { key: 'steps', label: 'Steps' },
];

function isTab(value: string | null): value is TabKey {
  return TABS.some(t => t.key === value);
}

const METRIC_CHROME: Record<HeadlineMetric['key'], { icon: React.ReactNode; iconBg: string; iconColor: string }> = {
  avg_cycle:        { icon: <Clock size={18} />,        iconBg: 'bg-purple-50', iconColor: 'text-purple-600' },
  best_cycle:       { icon: <TrendingDown size={18} />, iconBg: 'bg-green-50',  iconColor: 'text-green-600' },
  first_pass_yield: { icon: <TrendingUp size={18} />,   iconBg: 'bg-amber-50',  iconColor: 'text-amber-600' },
  completed:        { icon: <CheckCircle2 size={18} />, iconBg: 'bg-green-50',  iconColor: 'text-green-600' },
  runs:             { icon: <Activity size={18} />,     iconBg: 'bg-blue-50',   iconColor: 'text-blue-600' },
};

/** Per-step timing, from GET /api/analytics/step-metrics/:appId. */
interface StepMetric {
  index: number;
  name: string;
  takt_seconds: number;
  completions: number;
  avg_seconds: number;
  min_seconds: number;
  max_seconds: number;
  p95_seconds: number;
  over_takt_count: number;
  over_takt_pct: number;
}

interface StepMetricsPayload {
  app_id: string;
  app_name: string;
  total_completions: number;
  steps: StepMetric[];
}

/** The four query parameters GET /api/apps/:id/analytics actually filters on. */
function toParams(filters: AppDashboardFilters): AppAnalyticsParams {
  return {
    days: filters.days,
    operator: filters.operator || undefined,
    work_order_id: filters.workOrderId || undefined,
    product_type_id: filters.productTypeId || undefined,
  };
}

/** "Mar 4" for a chart axis, read as the server wrote it (UTC, not local). */
function dayLabel(iso: string): string {
  const d = parseServerTime(`${iso} 00:00:00`);
  return d ? d.toLocaleDateString([], { month: 'short', day: 'numeric' }) : iso;
}

function statusBadgeClass(status: string): string {
  if (status === 'completed') return 'badge-green';
  if (status === 'abandoned') return 'badge-red';
  if (status === 'in_progress') return 'badge-blue';
  return 'badge-gray';
}

function statusLabel(status: string): string {
  if (status === 'in_progress') return 'Running now';
  return status.charAt(0).toUpperCase() + status.slice(1);
}

/** Bar colour for a step average against its own takt. Indigo means the step
 *  has no takt to be judged against, not that it did badly. */
function stepBarColor(avg: number | null, takt: number | null): string {
  if (!takt || takt <= 0 || avg === null) return ACCENT;
  const ratio = avg / takt;
  if (ratio <= 1) return '#22c55e';
  if (ratio <= 1.1) return '#f59e0b';
  return '#ef4444';
}

export default function AppDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { canEdit } = useAuth();
  // Leave the floating training coach a lane instead of hiding a column.
  const coachDocked = useCoachDocked();
  const { refresh: refreshPlan } = usePlan();
  const { addToast } = useToast();

  // The URL is the state: the tab and all four filters live in the query
  // string, so a link somebody sends carries the exact slice they were reading
  // — and the retired /apps/:id/analytics?days=…&operator=… links still land on
  // their own slice rather than on a reset page.
  const [searchParams, setSearchParams] = useSearchParams();
  const tab: TabKey = isTab(searchParams.get('tab')) ? (searchParams.get('tab') as TabKey) : 'overview';
  const filters = useMemo(() => filtersFromQuery(searchParams), [searchParams]);

  /**
   * Every tab and every filter is a place in the history, because a person who
   * moved to one and pressed Back means "put the last one back", not "throw me
   * off this app". Only two things replace instead of pushing: landing from a
   * retired URL, and this screen normalising a window it cannot offer — neither
   * is a place anybody chose to be, and neither should be somewhere Back goes.
   */
  const setQuery = useCallback((patch: Record<string, string>, replace = false) => {
    setSearchParams(prev => {
      const next = new URLSearchParams(prev);
      for (const [key, value] of Object.entries(patch)) {
        if (value) next.set(key, value);
        else next.delete(key);
      }
      return next;
    }, { replace });
  }, [setSearchParams]);

  const setTab = (key: TabKey) => setQuery({ tab: key });

  const FILTER_PARAM: Record<keyof AppDashboardFilters, string> = {
    days: 'days', operator: 'operator', workOrderId: 'work_order_id',
    productTypeId: 'product_type_id', result: 'result', status: 'status', query: 'q',
  };
  const setFilter = <K extends keyof AppDashboardFilters>(key: K, value: AppDashboardFilters[K]) => {
    const raw = String(value ?? '');
    // 'all' is the absence of a filter, not a filter set to a value — keeping
    // it out of the URL is what makes a shared link read as what it narrows.
    setQuery({ [FILTER_PARAM[key]]: raw === 'all' ? '' : raw });
  };
  const clearFilters = () => setQuery({
    operator: '', work_order_id: '', product_type_id: '', result: '', status: '', q: '',
  });

  // Exactly the four parameters GET /apps/:id/analytics honours — and the only
  // thing a refetch depends on, so narrowing the table by result or typing in
  // the search box does not re-ask the server the same question.
  const serverParams: AppAnalyticsParams & { days: number } = useMemo(
    () => ({ ...toParams(filters), days: filters.days }),
    [filters.days, filters.operator, filters.workOrderId, filters.productTypeId],
  );

  const [detail, setDetail] = useState<AppDetailResponse | null>(null);
  const [analytics, setAnalytics] = useState<AppAnalyticsResponse | null>(null);
  const [steps, setSteps] = useState<StepMetricsPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [sort, setSort] = useState<{ key: 'date' | 'operator' | 'duration'; desc: boolean }>({ key: 'date', desc: true });
  // Typing is not navigating: the box holds its own text and lands it in the
  // URL after a pause, as a replace. A push per keystroke would turn Back into
  // a walk back through the alphabet. A pasted ?q= link still fills the box.
  const [fieldDetails, setFieldDetails] = useState(false);
  const [queryText, setQueryText] = useState(filters.query);
  useEffect(() => { setQueryText(filters.query); }, [filters.query]);
  useEffect(() => {
    if (queryText === filters.query) return;
    const timer = setTimeout(() => setQuery({ q: queryText }, true), 300);
    return () => clearTimeout(timer);
  }, [queryText, filters.query, setQuery]);

  // Three reads, one screen. The detail payload describes the app itself
  // (what it is, where it runs) and never moves with the filters; the analytics
  // payload IS the filtered slice; step metrics honour the day window, which is
  // the only one of the four the step endpoint knows about — the page says so
  // on the tab rather than letting a control look like it was obeyed.
  const load = useCallback(async () => {
    if (!id) return;
    try {
      const [detailRes, analyticsRes, stepsRes] = await Promise.all([
        api.getAppDetail(id),
        api.getAppAnalytics(id, serverParams),
        api.getStepMetrics(id, serverParams.days).catch(() => null) as Promise<StepMetricsPayload | null>,
      ]);
      setDetail(detailRes);
      setAnalytics(analyticsRes);
      setSteps(stepsRes);
      setError(null);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load this app');
      throw err; // let useAutoRefresh keep the freshness stamp honestly stale
    } finally {
      setLoading(false);
    }
  }, [id, serverParams]);

  const { lastRefreshed, refreshing, refresh } = useAutoRefresh(load, REFRESH_MS);

  // A URL asking for ?days=14 used to be rounded to 30 in silence and then
  // labelled "the last 30 days" — a window nobody asked for under a label
  // nobody could question. Rewrite the URL to the window actually used (a
  // replace: this is not a place anybody chose to be) and say so out loud.
  const [normalisedFrom, setNormalisedFrom] = useState<number | null>(null);
  const askedFor = unofferedDays(searchParams);
  useEffect(() => {
    if (askedFor === null) return;
    setNormalisedFrom(askedFor);
    setQuery({ days: String(filters.days) }, true);
  }, [askedFor, filters.days, setQuery]);

  // Runs still on the bench report how long they have been open, so the clock
  // has to move between polls or a live row reads as frozen.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(tick);
  }, []);

  const handleDuplicate = async () => {
    if (!id) return;
    setBusy(true);
    try {
      const copy = await api.duplicateApp(id);
      addToast(`Created "${copy.name}"`, 'success');
      refreshPlan();
      navigate(`/apps/${copy.id}/build`);
    } catch (err: unknown) {
      addToast(err instanceof Error ? err.message : 'Failed to duplicate app', 'error');
    } finally {
      setBusy(false);
    }
  };

  const handleSaveAsTemplate = async () => {
    if (!detail) return;
    const name = prompt('Template name:', detail.app.name);
    if (name === null || !name.trim()) return;
    const description = prompt('Template description (optional):', detail.app.description || '');
    if (description === null) return;
    setBusy(true);
    try {
      const saved = await api.saveAppAsTemplate(detail.app.id, { name: name.trim(), description });
      addToast(`Template "${saved.name}" saved — it now shows up as a starting point`, 'success');
    } catch (err: unknown) {
      addToast(err instanceof Error ? err.message : 'Failed to save template', 'error');
    } finally {
      setBusy(false);
    }
  };

  // The export carries the same filters as the screen, so what downloads is the
  // slice being read — with every value each run recorded.
  const handleExport = async () => {
    if (!id || exporting) return;
    setExporting(true);
    try {
      await api.downloadAppAnalyticsCsv(id, toParams(filters));
      addToast('Runs CSV downloaded — the slice on screen', 'success');
    } catch (err: unknown) {
      addToast(err instanceof Error ? err.message : 'Export failed', 'error');
    } finally {
      setExporting(false);
    }
  };

  if (loading && !detail) {
    return (
      <div className="p-6 space-y-6">
        <div className="h-8 w-64 rounded animate-pulse bg-gray-100" />
        <div className="card h-14 animate-pulse bg-gray-100" />
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {[1, 2, 3, 4].map(i => <div key={i} className="card h-20 animate-pulse bg-gray-100" />)}
        </div>
        <div className="card h-96 animate-pulse bg-gray-100" />
      </div>
    );
  }

  if (error && !detail) {
    return (
      <div className="p-6 space-y-4">
        <Link to="/apps" className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800">
          <ArrowLeft size={15} /> All apps
        </Link>
        <div className="card p-10">
          <EmptyState
            icon={AlertTriangle}
            title="Couldn't open this app"
            description={error || 'It may have been deleted, or it belongs to another company.'}
            action={
              <button onClick={() => { setLoading(true); void refresh(); }} className="btn-secondary">
                <RefreshCw size={14} /> Retry
              </button>
            }
          />
        </div>
      </div>
    );
  }

  if (!detail) return null;

  const { app, bindings, stats } = detail;
  const shape = appShape(app);
  const published = app.status === 'published';
  // `current_revision` rides the app row from GET /api/apps/:id(/detail).
  //
  // Three different facts, three different lines — and a published app must
  // never be labelled unpublished:
  //   absent  the payload does not carry revisions at all → say nothing
  //   0       revisions exist but this app has none yet   → "Revision not tracked yet"
  //   N > 0   the revision the floor is running           → "Rev N live"
  const rawRevision = (app as { current_revision?: number | null }).current_revision;
  const revision = rawRevision === undefined || rawRevision === null
    ? null
    : Number(rawRevision);
  const authoredSteps = orderedSteps(app);
  const filtersActive = hasNarrowingFilters(filters);

  // App takt is the sum of its per-step takts, read from the blob the builder
  // saved. stepTaktSeconds also reads the legacy `takt_time` key: apps built
  // before the v2 builder (the demo sandbox's included) store it that way, and
  // reading only `takt_time_seconds` reported a takt of zero for all of them —
  // which hid the comparison on every legacy app.
  const taktTotalSeconds = (app.steps ?? []).reduce(
    (total: number, step) => total + stepTaktSeconds(step), 0,
  );
  const metrics = analytics
    ? buildHeadlineMetrics(analytics.totals, analytics.days, taktTotalSeconds)
    : [];
  const runs = analytics?.recent_runs ?? [];
  const runningNow = runs.filter(r => r.status === 'in_progress');
  const operatorRows = analytics ? buildOperatorRollup(analytics.by_operator) : [];
  // Getting faster or slower, over the runs on screen. Null until there are
  // enough timed runs on both sides to make the claim.
  const trend = buildCycleTrend(runs);

  // The four different nothings, told apart: no runs ever, none in this window,
  // none matching these filters — each with its own way out.
  const emptyReason = analytics
    ? emptyReasonFor({
      appCount: 1,
      app: { name: app.name, runsTotal: stats.runs_total, lastRunAt: stats.last_run_at },
      runsInWindow: analytics.totals.runs,
      days: filters.days,
      // Only the server-side three can empty the payload; the row filters
      // empty the table, which the table says for itself.
      filtersActive: hasServerFilters(filters),
    })
    : null;

  const seriesData = (analytics?.series ?? []).map(s => ({
    ...s, day: dayLabel(s.date), avg_duration_s: measuredSeconds(s.avg_duration_s),
  }));
  const durationData = seriesData.filter(s => s.avg_duration_s !== null);
  const cycleTicks = durationTicks(Math.max(0, ...durationData.map(d => d.avg_duration_s ?? 0)));

  // What went wrong in this slice: failures the server counted per pass/fail
  // widget, plus the runs nobody finished. Nothing here is inferred.
  const failedChecks = (analytics?.fields ?? [])
    .filter(f => f.kind === 'boolean' && (f.stats.fail ?? 0) > 0)
    .map(f => ({ label: f.label, fail: f.stats.fail ?? 0, of: (f.stats.pass ?? 0) + (f.stats.fail ?? 0) }))
    .sort((a, b) => b.fail - a.fail);

  const timedSteps = (steps?.steps ?? []).filter(s => measuredSeconds(s.avg_seconds) !== null);
  const untimedStepCount = (steps?.steps.length ?? 0) - timedSteps.length;
  const stepTicks = durationTicks(Math.max(
    0, ...timedSteps.map(s => Math.max(s.avg_seconds, s.takt_seconds || 0)),
  ));

  // The server narrowed by window / operator / product type / work order; the
  // result, status and text filters narrow the ROWS it sent. The table says
  // which is which rather than letting a reader take the tiles as the same set.
  const rowFiltersActive = filters.result !== 'all' || filters.status !== 'all' || !!filters.query.trim();
  const visibleRuns = filterRuns(runs, filters);
  const sortedRuns = visibleRuns.slice().sort((a, b) => {
    const dir = sort.desc ? -1 : 1;
    if (sort.key === 'operator') {
      return String(a.operator_name ?? '').localeCompare(String(b.operator_name ?? '')) * dir;
    }
    if (sort.key === 'duration') {
      // A run with no duration is not the fastest run ever — unknowns sink to
      // the bottom whichever way the column is pointed.
      const av = measuredSeconds(a.duration_s);
      const bv = measuredSeconds(b.duration_s);
      if (av === null && bv === null) return 0;
      if (av === null) return 1;
      if (bv === null) return -1;
      return (av - bv) * dir;
    }
    return String(a.started_at ?? '').localeCompare(String(b.started_at ?? '')) * dir;
  });

  const toggleSort = (key: 'date' | 'operator' | 'duration') =>
    setSort(prev => (prev.key === key ? { key, desc: !prev.desc } : { key, desc: key !== 'operator' }));

  const runCountLine = analytics
    ? `${pluralize(analytics.totals.runs, 'run')} in the last ${analytics.days} days`
    : 'reading this window…';

  /** A link to the Runs tab, this slice, narrowed the way the caller says. */
  const runsHref = (patch: Partial<Record<'result' | 'status', string>>) => {
    const next = new URLSearchParams(searchParams);
    next.set('tab', 'runs');
    for (const [key, value] of Object.entries(patch)) {
      if (value && value !== 'all') next.set(key, value);
      else next.delete(key);
    }
    return `?${next.toString()}`;
  };

  // The runs behind "what went wrong": a failed check, or a run nobody
  // finished. Up to six, each one click from its own record.
  const troubleRuns = runs
    .filter(r => r.pass_fail === 'fail' || r.status === 'abandoned')
    .slice(0, 6);

  // A filter can outlive the thing it names — a bookmark to a product type
  // somebody deleted, or an operator who left. The select then shows "All
  // product types" while the numbers stay narrowed by it: a filter obeyed
  // invisibly, which is the worst of both. Say it, and offer the way out.
  const options = analytics?.filter_options;
  const staleFilters = !options ? [] : ([
    filters.productTypeId && !options.product_types.some(pt => pt.id === filters.productTypeId)
      ? { key: 'productTypeId' as const, label: 'a product type that no longer exists' } : null,
    filters.workOrderId && !options.work_orders.some(wo => wo.id === filters.workOrderId)
      ? { key: 'workOrderId' as const, label: 'a work order that no longer exists' } : null,
    filters.operator && !options.operators.includes(filters.operator)
      ? { key: 'operator' as const, label: `an operator with no runs of this app (${filters.operator})` } : null,
  ].filter(Boolean) as { key: keyof AppDashboardFilters; label: string }[]);

  return (
    <div className={`p-4 sm:p-6 space-y-5 transition-[padding] ${coachDocked ? 'lg:pr-[392px]' : ''}`}>
      <Link to="/apps" className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800">
        <ArrowLeft size={15} /> All apps
      </Link>

      <PageHeader
        title={
          <span className="flex items-center gap-3 flex-wrap">
            {app.name}
            <span className={`inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full align-middle ${
              published ? 'bg-green-50 text-green-700' : 'bg-amber-50 text-amber-700'
            }`}>
              {published ? <Globe size={10} /> : <Lock size={10} />}
              {published ? 'Published' : 'Draft'}
            </span>
            {/* Which revision the floor is running. Nothing at all when the
                payload does not carry revisions; a neutral "not tracked yet"
                when it does and this app has none — never a line that reads as
                "unpublished" beside a Published badge. */}
            {revision !== null && (
              <span
                className="text-[11px] font-medium text-gray-400 align-middle"
                title={revision > 0
                  ? 'The revision operators are running right now'
                  : 'Revisions are recorded from the next publish onwards'}
              >
                {revision > 0 ? `Rev ${revision} live` : 'Revision not tracked yet'}
              </span>
            )}
          </span>
        }
        subtitle={app.description || 'No description yet — add one in the builder so your team knows when to use this app.'}
        actions={
          <>
            <LastRefreshed at={lastRefreshed} refreshing={refreshing} onRefresh={() => void refresh()} />
            {canEdit && (
              <Link to={`/apps/${app.id}/build`} className="btn-secondary">
                <Edit3 size={14} /> Edit in builder
              </Link>
            )}
            {/* The same export the Runs tab offers, under the same name: it
                carries the filters on screen, so what downloads is the slice
                being read — not "all runs" as the old label implied. */}
            <button onClick={handleExport} disabled={exporting} className="btn-secondary disabled:opacity-50">
              {exporting ? <RefreshCw size={14} className="animate-spin" /> : <Download size={14} />}
              Export this slice (CSV)
            </button>
            {canEdit && (
              <button onClick={handleDuplicate} disabled={busy} className="btn-secondary">
                <Copy size={14} /> Duplicate
              </button>
            )}
            {canEdit && (
              <button onClick={handleSaveAsTemplate} disabled={busy} className="btn-secondary">
                <Layers size={14} /> Save as template
              </button>
            )}
            {published ? (
              <Link to={`/play/${app.id}`} className="btn-primary">
                <Play size={14} /> Run
              </Link>
            ) : canEdit ? (
              // Publishing is under change control — it needs a change note,
              // and an approver when the app requires one. That conversation
              // lives in the builder's publish flow; this screen sends people
              // there rather than firing a call the server now refuses.
              <Link to={`/apps/${app.id}/build`} className="btn-primary">
                <Globe size={14} /> Publish in builder
              </Link>
            ) : null}
          </>
        }
      />

      {/* ── One filter bar, read by every tab ──────────────────────────────── */}
      <section className="card px-4 py-3 space-y-2" data-testid="app-filter-bar">
        <div className="flex items-center gap-3 flex-wrap">
          <span className="flex items-center gap-1.5 text-xs font-semibold text-gray-500 uppercase tracking-wide">
            <SlidersHorizontal size={13} /> Filters
          </span>

          <div className="flex rounded-lg border border-gray-200 overflow-hidden" role="group" aria-label="Date range">
            {DAY_PRESETS.map(d => (
              <button
                key={d}
                type="button"
                onClick={() => setFilter('days', d)}
                aria-pressed={filters.days === d}
                className={`px-3 py-1.5 text-xs font-medium transition-colors ${
                  filters.days === d ? 'bg-indigo-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'
                }`}
              >
                {d}d
              </button>
            ))}
          </div>

          <select
            aria-label="Operator"
            className="input-field w-auto min-w-[9rem] py-1.5 text-xs"
            value={filters.operator}
            onChange={e => setFilter('operator', e.target.value)}
          >
            <option value="">All operators</option>
            {(options?.operators ?? []).map(o => <option key={o} value={o}>{o}</option>)}
          </select>

          <select
            aria-label="Product type"
            className="input-field w-auto min-w-[9rem] py-1.5 text-xs"
            value={filters.productTypeId}
            onChange={e => setFilter('productTypeId', e.target.value)}
          >
            <option value="">All product types</option>
            {(options?.product_types ?? []).map(pt => <option key={pt.id} value={pt.id}>{pt.name}</option>)}
          </select>

          <select
            aria-label="Work order"
            className="input-field w-auto min-w-[9rem] py-1.5 text-xs"
            value={filters.workOrderId}
            onChange={e => setFilter('workOrderId', e.target.value)}
          >
            <option value="">All work orders</option>
            {(options?.work_orders ?? []).map(wo => (
              <option key={wo.id} value={wo.id}>{wo.work_order_number}</option>
            ))}
          </select>

          {/* Result and status narrow the runs the server sent; they are the
              Runs tab's own two, kept in this one bar so there is still only
              one place filters live. */}
          <select
            aria-label="Result"
            className="input-field w-auto min-w-[9rem] py-1.5 text-xs"
            value={filters.result}
            onChange={e => setFilter('result', e.target.value as ResultFilter)}
          >
            <option value="all">Any result</option>
            <option value="pass">Passed</option>
            <option value="fail">Failed</option>
            <option value="unchecked">No check recorded</option>
          </select>

          <select
            aria-label="Status"
            className="input-field w-auto min-w-[9rem] py-1.5 text-xs"
            value={filters.status}
            onChange={e => setFilter('status', e.target.value as StatusFilter)}
          >
            <option value="all">Any status</option>
            <option value="completed">Completed</option>
            <option value="in_progress">Running now</option>
            <option value="abandoned">Abandoned</option>
          </select>

          <label className="relative">
            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              value={queryText}
              onChange={e => setQueryText(e.target.value)}
              placeholder="Operator, work order, run id"
              aria-label="Search runs"
              className="input-field w-auto min-w-[13rem] py-1.5 pl-7 text-xs"
            />
          </label>

          {filtersActive && (
            <button type="button" onClick={clearFilters} className="text-xs font-medium text-indigo-600 hover:text-indigo-800">
              Clear filters
            </button>
          )}

          <span className="text-[11px] text-gray-400 ml-auto" data-testid="app-filter-summary">
            {runCountLine}
          </span>
        </div>

        {/* A window this screen does not offer was silently rounded before. */}
        {normalisedFrom !== null && (
          <p className="text-[11px] text-amber-600 flex items-center gap-1.5" data-testid="window-normalised">
            <AlertTriangle size={12} className="flex-shrink-0" />
            This screen offers {DAY_PRESETS.join(', ')} day windows, so the {normalisedFrom}-day window in
            the link was read as {filters.days} days. Every number below is the last {filters.days} days.
            <button
              type="button"
              onClick={() => setNormalisedFrom(null)}
              className="font-medium text-indigo-600 hover:text-indigo-800"
            >
              Got it
            </button>
          </p>
        )}

        {/* A filter can outlive what it names. Obeying it in silence, while the
            select reads "All product types", is the failure this line ends. */}
        {staleFilters.map(stale => (
          <p key={stale.key} className="text-[11px] text-amber-600 flex items-center gap-1.5" data-testid="stale-filter">
            <AlertTriangle size={12} className="flex-shrink-0" />
            Filtered by {stale.label} — every number below is narrowed by it.
            <button
              type="button"
              onClick={() => setFilter(stale.key, (stale.key === 'result' || stale.key === 'status' ? 'all' : '') as never)}
              className="font-medium text-indigo-600 hover:text-indigo-800"
            >
              Remove this filter
            </button>
          </p>
        ))}

        {/* The row filters narrow the table, not the tiles. Never let the two
            be read as one set. */}
        {(filters.result !== 'all' || filters.status !== 'all' || filters.query.trim()) && (
          <p className="text-[11px] text-gray-400">
            Result, status and search narrow the runs listed on the Runs tab. The tiles above them
            report the whole {filters.days}-day slice, which is what the server measured.
          </p>
        )}
      </section>

      <TabBar
        items={TABS.map(t => ({ key: t.key, label: t.label }))}
        active={tab}
        onSelect={setTab}
        ariaLabel="App screens"
      />

      {error && (
        <div className="card border-red-100 bg-red-50/60 px-4 py-3 text-sm text-red-700" role="alert">
          {error}
        </div>
      )}

      {/* ── Overview ──────────────────────────────────────────────────────── */}
      {tab === 'overview' && (
        <div className="space-y-5">
          <MetricRow metrics={metrics} trend={trend} />

          {emptyReason ? (
            <div className="card">
              <EmptyReason
                reason={emptyReason}
                appId={app.id}
                onWiden={() => setFilter('days', 365)}
                onClear={clearFilters}
              />
            </div>
          ) : (
            <>
              <LiveBand runs={runningNow} now={now} />

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 items-start">
                <section className="card p-5">
                  <div className="flex items-center gap-2 mb-1">
                    <Clock size={16} className="text-gray-400" />
                    <h2 className="font-semibold text-gray-900">Average cycle time by day</h2>
                  </div>
                  <p className="text-[11px] text-gray-400 mb-3" title={durationBasisNote(analytics?.totals.avg_duration_basis ?? null)}>
                    Averaged over the runs that finished each day
                    {durationBasisLabel(analytics?.totals.avg_duration_basis ?? null)
                      ? ` · ${durationBasisLabel(analytics?.totals.avg_duration_basis ?? null)}`
                      : ''}.
                  </p>
                  {durationData.length === 0 ? (
                    <EmptyState
                      compact
                      icon={Clock}
                      title="No timed run in this window"
                      description="A day appears here once a run has both started and finished on it — those times are missing, not zero."
                    />
                  ) : (
                    <ResponsiveContainer width="100%" height={220}>
                      <LineChart data={durationData} margin={{ left: 4, right: 12, top: 8, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="var(--grid-line)" />
                        <XAxis dataKey="day" tick={{ fontSize: 10, fill: 'var(--muted)' }} minTickGap={18} />
                        <YAxis
                          tick={{ fontSize: 11, fill: 'var(--muted)' }}
                          tickFormatter={v => fmtDuration(v)}
                          ticks={cycleTicks}
                          domain={[0, cycleTicks[cycleTicks.length - 1]]}
                          width={58}
                        />
                        <Tooltip content={<ChartTip format={(v: number) => fmtDuration(v)} />} />
                        <Line type="monotone" dataKey="avg_duration_s" stroke={ACCENT} strokeWidth={2}
                          dot={{ r: 3, fill: ACCENT }} activeDot={{ r: 5 }} />
                      </LineChart>
                    </ResponsiveContainer>
                  )}
                </section>

                <section className="card p-5">
                  <div className="flex items-center gap-2 mb-1">
                    <BarChart2 size={16} className="text-gray-400" />
                    <h2 className="font-semibold text-gray-900">Runs completed per day</h2>
                  </div>
                  <p className="text-[11px] text-gray-400 mb-3">How much this app produced, day by day.</p>
                  <ResponsiveContainer width="100%" height={220}>
                    <BarChart data={seriesData} margin={{ left: 0, right: 8, top: 8, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--grid-line)" vertical={false} />
                      <XAxis dataKey="day" tick={{ fontSize: 10, fill: 'var(--muted)' }} minTickGap={18} />
                      <YAxis tick={{ fontSize: 11, fill: 'var(--muted)' }} allowDecimals={false} width={32} />
                      <Tooltip content={<ChartTip format={(v: number) => `${v} completed`} />} cursor={{ fill: 'rgba(99,102,241,0.06)' }} />
                      <Bar dataKey="completed" fill={ACCENT} radius={[3, 3, 0, 0]} maxBarSize={28} />
                    </BarChart>
                  </ResponsiveContainer>
                </section>
              </div>

              <section className="card p-5">
                <div className="flex items-center gap-2 mb-1">
                  <XCircle size={16} className="text-gray-400" />
                  <h2 className="font-semibold text-gray-900">What went wrong</h2>
                </div>
                <p className="text-[11px] text-gray-400 mb-4">Failed checks and runs nobody finished, in this window.</p>
                {failedChecks.length === 0 && (analytics?.totals.abandoned ?? 0) === 0 ? (
                  <p className="text-sm text-gray-500 flex items-center gap-2">
                    <CheckCircle2 size={15} className="text-green-600 flex-shrink-0" />
                    {(analytics?.fields ?? []).some(f => f.kind === 'boolean')
                      ? `Every check passed and every run finished across ${pluralize(analytics?.totals.runs ?? 0, 'run')}.`
                      : 'Every run finished. This app records no pass/fail check, so there is no yield to report.'}
                  </p>
                ) : (
                  <>
                    {/* Every count here is a door, not a full stop: "3 failed"
                        with no way to the three runs is a dead end, and finding
                        them by hand is what the old five screens made people
                        do. */}
                    <ul className="grid grid-cols-1 md:grid-cols-2 gap-2">
                      {failedChecks.map(f => (
                        <li key={f.label}>
                          <Link
                            to={runsHref({ result: 'fail' })}
                            data-testid="failed-check"
                            className="flex items-center gap-3 rounded-xl border border-red-100 bg-red-50/50 px-3 py-2 hover:border-red-200 transition-colors"
                          >
                            <XCircle size={14} className="text-red-500 flex-shrink-0" />
                            <span className="text-[13px] text-gray-900 min-w-0 flex-1 truncate" title={f.label}>{f.label}</span>
                            <span className="text-xs font-semibold text-red-600 tabular-nums flex-shrink-0">
                              {f.fail} failed of {f.of}
                            </span>
                            <ChevronRight size={13} className="text-red-400 flex-shrink-0" />
                          </Link>
                        </li>
                      ))}
                      {(analytics?.totals.abandoned ?? 0) > 0 && (
                        <li>
                          <Link
                            to={runsHref({ status: 'abandoned' })}
                            data-testid="abandoned-runs"
                            className="flex items-center gap-3 rounded-xl border border-amber-100 bg-amber-50/50 px-3 py-2 hover:border-amber-200 transition-colors"
                          >
                            <Activity size={14} className="text-amber-500 flex-shrink-0" />
                            <span className="text-[13px] text-gray-900 min-w-0 flex-1">Runs nobody finished</span>
                            <span className="text-xs font-semibold text-amber-700 tabular-nums flex-shrink-0">
                              {analytics?.totals.abandoned} abandoned
                            </span>
                            <ChevronRight size={13} className="text-amber-400 flex-shrink-0" />
                          </Link>
                        </li>
                      )}
                    </ul>

                    {/* And the runs themselves, named, straight to the record. */}
                    {troubleRuns.length > 0 && (
                      <ul className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-2">
                        {troubleRuns.map(run => (
                          <li key={run.id}>
                            <Link
                              to={`/completions/${run.id}`}
                              data-testid="trouble-run"
                              className="flex items-center gap-3 rounded-xl border border-gray-100 bg-white px-3 py-2 hover:border-gray-300 transition-colors"
                            >
                              <XCircle size={14} className="text-red-400 flex-shrink-0" />
                              <span className="min-w-0 flex-1">
                                <span className="block text-[13px] font-medium text-gray-900 truncate">
                                  {run.pass_fail === 'fail' ? 'Failed a check' : 'Never finished'}
                                  {run.work_order_number ? ` · ${run.work_order_number}` : ''}
                                </span>
                                <span className="block text-[11px] text-gray-500 truncate">
                                  {run.operator_name || 'Unknown operator'} · {fmtRelative(run.completed_at ?? run.started_at)}
                                </span>
                              </span>
                              <span className="text-[11px] text-indigo-600 font-medium flex-shrink-0">Open</span>
                            </Link>
                          </li>
                        ))}
                      </ul>
                    )}
                  </>
                )}
              </section>

              {(analytics?.fields.length ?? 0) > 0 && (
                <section className="card p-5">
                  <div className="flex items-center gap-2 mb-1">
                    <ListChecks size={16} className="text-gray-400" />
                    <h2 className="font-semibold text-gray-900">What operators entered</h2>
                    <span className="text-xs text-gray-400">({analytics?.fields.length})</span>
                  </div>
                  <p className="text-[11px] text-gray-400 mb-3">
                    Summarised across the runs in this window. Open a run on the Runs tab for the values it recorded one by one.
                  </p>
                  <button
                    type="button"
                    onClick={() => setFieldDetails(open => !open)}
                    aria-expanded={fieldDetails}
                    className="mb-3 inline-flex items-center gap-1 text-xs font-medium text-indigo-600 hover:text-indigo-800"
                  >
                    {fieldDetails ? 'Hide' : 'Show'} field details
                    <ChevronDown size={13} className={`transition-transform ${fieldDetails ? 'rotate-180' : ''}`} />
                  </button>

                  {/* One line per field answers "what got recorded"; the cards
                      answer "what did it say" — the pass/fail split, the
                      number's spread and its daily trend, the option counts.
                      Collapsing the second question into the first is what
                      lost it. */}
                  {fieldDetails ? (
                    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4" data-testid="field-cards">
                      {(analytics?.fields ?? []).map(field => (
                        <FieldCard key={field.widget_id} field={field} />
                      ))}
                    </div>
                  ) : (
                  <ul className="divide-y divide-gray-100">
                    {(analytics?.fields ?? []).map(field => (
                      <li key={field.widget_id} className="py-2 flex items-baseline justify-between gap-4">
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-gray-800 truncate" title={field.label}>{field.label}</p>
                          {field.step_name && <p className="text-[11px] text-gray-400 truncate">{field.step_name}</p>}
                        </div>
                        <div className="text-right flex-shrink-0 max-w-[55%]">
                          <p className="text-xs text-gray-700 tabular-nums truncate" title={summariseField(field)}>
                            {summariseField(field)}
                          </p>
                          <p className="text-[11px] text-gray-400">{pluralize(fieldSampleSize(field), 'entry', 'entries')}</p>
                        </div>
                      </li>
                    ))}
                  </ul>
                  )}
                </section>
              )}
            </>
          )}

          {/* What the app IS — from the builder's own blob, never the runs. */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-5 items-start">
            <section className="card p-5 lg:col-span-2">
              <header className="flex items-start justify-between gap-3 flex-wrap mb-4">
                <div>
                  <h2 className="text-sm font-semibold text-gray-900">What this app does</h2>
                  <p className="text-xs text-gray-400 mt-0.5">
                    The exact sequence an operator walks through, straight from the builder.
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-gray-500">
                  <span className="flex items-center gap-1"><Layers size={11} /> {pluralize(shape.stepCount, 'step')}</span>
                  <span className="flex items-center gap-1"><MousePointerClick size={11} /> {pluralize(shape.widgetCount, 'widget')}</span>
                  <span className="flex items-center gap-1"><Zap size={11} /> {pluralize(shape.triggerCount, 'trigger')}</span>
                </div>
              </header>

              {authoredSteps.length === 0 || !shape.hasContent ? (
                <EmptyState
                  icon={Layers}
                  title="This app has no content yet"
                  description="Open the builder and drop a few widgets onto the first step — instructions, a photo, a pass/fail check."
                  action={canEdit ? (
                    <Link to={`/apps/${app.id}/build`} className="btn-primary">
                      <Edit3 size={14} /> Open the builder
                    </Link>
                  ) : undefined}
                  compact
                />
              ) : (
                <ol className="space-y-3">
                  {authoredSteps.map(({ step, index, groupName }) => {
                    const widgets = widgetsOf(step);
                    const stepTriggers = Array.isArray(step?.triggers) ? step.triggers.length : 0;
                    return (
                      <li key={step.id || index} className="rounded-xl border border-gray-100 bg-gray-50/50 p-3.5">
                        <div className="flex items-start gap-3">
                          <span className="mt-0.5 w-6 h-6 rounded-lg bg-white border border-gray-200 text-gray-600 text-[11px] font-bold flex items-center justify-center flex-shrink-0 tabular-nums">
                            {index + 1}
                          </span>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2 flex-wrap">
                              <h3 className="text-[13px] font-semibold text-gray-900">{step.name || `Step ${index + 1}`}</h3>
                              {groupName && (
                                <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-white border border-gray-200 text-gray-500">
                                  {groupName}
                                </span>
                              )}
                              {step.step_type === 'kit' && (
                                <span className="inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded bg-sky-50 text-sky-700">
                                  <Boxes size={9} /> Kit check
                                </span>
                              )}
                              {!!step.takt_time_seconds && (
                                <span className="inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded bg-white border border-gray-200 text-gray-500">
                                  <Clock size={9} /> takt {fmtDuration(step.takt_time_seconds)}
                                </span>
                              )}
                              {stepTriggers > 0 && (
                                <span className="inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded bg-violet-50 text-violet-700">
                                  <Zap size={9} /> {pluralize(stepTriggers, 'trigger')}
                                </span>
                              )}
                            </div>
                            {step.description && (
                              <p className="text-[12px] text-gray-500 mt-1 leading-relaxed">{step.description}</p>
                            )}

                            {widgets.length === 0 ? (
                              <p className="text-[11px] text-gray-400 mt-2 italic">No widgets on this step yet</p>
                            ) : (
                              <ul className="flex flex-wrap gap-1.5 mt-2">
                                {widgets.map((w, wi) => {
                                  const captures = isCaptureWidget(w.type);
                                  const label = (w.label || w.config?.buttonText || w.config?.variableName || '').trim()
                                    || widgetTypeLabel(w.type);
                                  return (
                                    <li
                                      key={w.id || wi}
                                      title={`${widgetTypeLabel(w.type)}${captures ? ' · captures data' : ''}`}
                                      className={`inline-flex items-center gap-1.5 text-[11px] rounded-lg px-2 py-1 border ${
                                        captures
                                          ? 'bg-white border-indigo-100 text-gray-700'
                                          : 'bg-white border-gray-200 text-gray-500'
                                      }`}
                                    >
                                      {captures && <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ backgroundColor: 'var(--secondary)' }} />}
                                      <span className="truncate max-w-[180px]">{label}</span>
                                      <span className="text-[10px] text-gray-400">{widgetTypeLabel(w.type)}</span>
                                    </li>
                                  );
                                })}
                              </ul>
                            )}
                          </div>
                        </div>
                      </li>
                    );
                  })}
                </ol>
              )}

              {shape.captureCount > 0 && (
                <p className="text-[11px] text-gray-400 mt-4 flex items-center gap-1.5">
                  <Info size={12} className="flex-shrink-0" />
                  {pluralize(shape.captureCount, 'widget')} on this app record a value on every run — those are the
                  columns you get in the CSV export.
                </p>
              )}
            </section>

            <section className="card p-5">
              <h2 className="text-sm font-semibold text-gray-900">Where this app runs</h2>
              <p className="text-xs text-gray-400 mt-0.5 mb-3">Everything currently pointing at this app.</p>

              <dl className="space-y-2.5">
                <BindingRow icon={Building2} label="Department">
                  {bindings.department ? (
                    <span className="inline-flex items-center gap-1.5">
                      <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: bindings.department.color || '#94a3b8' }} />
                      {bindings.department.name}
                    </span>
                  ) : <Unset>Not assigned</Unset>}
                </BindingRow>

                <BindingRow icon={MapPin} label="Site">
                  {bindings.site ? bindings.site.name : <Unset>All sites</Unset>}
                </BindingRow>

                <BindingRow icon={ClipboardList} label="Stations">
                  {bindings.stations.length === 0
                    ? <Unset>No station is set to this app</Unset>
                    : (
                      <span className="flex flex-wrap gap-1">
                        {bindings.stations.map(s => (
                          <Link
                            key={s.id}
                            to={`/stations/${s.id}`}
                            className="inline-flex items-center gap-1 text-[12px] rounded-md bg-gray-50 border border-gray-200 px-1.5 py-0.5 hover:border-gray-300"
                          >
                            {s.name}
                          </Link>
                        ))}
                      </span>
                    )}
                </BindingRow>

                <BindingRow icon={Package} label="Product types">
                  {bindings.product_types.length === 0
                    ? <Unset>None defined</Unset>
                    : (
                      <span className="flex flex-wrap gap-1">
                        {bindings.product_types.map(p => (
                          <span key={p.id} className="text-[12px] rounded-md bg-gray-50 border border-gray-200 px-1.5 py-0.5">
                            {p.name}
                          </span>
                        ))}
                      </span>
                    )}
                </BindingRow>

                <BindingRow icon={GitBranch} label="Routings">
                  {bindings.routings.length === 0
                    ? <Unset>Not used in a routing</Unset>
                    : (
                      <span className="flex flex-col gap-0.5">
                        {bindings.routings.map(r => (
                          <Link key={`${r.routing_id}-${r.step_number}`} to="/routings" className="text-[12px] hover:underline">
                            {r.routing_name} <span className="text-gray-400">· step {r.step_number} {r.step_name}</span>
                          </Link>
                        ))}
                      </span>
                    )}
                </BindingRow>

                <BindingRow icon={ClipboardList} label="Work orders">
                  {bindings.work_order_count === 0
                    ? <Unset>None yet</Unset>
                    : (
                      <span className="flex flex-col gap-0.5">
                        <span className="text-[12px] text-gray-500">
                          {pluralize(bindings.work_order_count, 'work order')} run through this app
                        </span>
                        {bindings.work_orders.slice(0, 4).map(wo => (
                          <Link key={wo.id} to="/schedule" className="text-[12px] hover:underline">
                            {wo.work_order_number} <span className="text-gray-400">· {wo.part_number} · {wo.quantity_completed}/{wo.quantity}</span>
                          </Link>
                        ))}
                      </span>
                    )}
                </BindingRow>
              </dl>

              <p className="text-[11px] text-gray-400 mt-4 pt-3 border-t border-gray-100">
                All time: {pluralize(stats.runs_total, 'run')}
                {stats.first_run_at
                  ? <> · first run {fmtRelative(stats.first_run_at)} · last run {fmtRelative(stats.last_run_at)}</>
                  : ' · nothing recorded yet.'}
              </p>
            </section>
          </div>
        </div>
      )}

      {/* ── Runs ──────────────────────────────────────────────────────────── */}
      {tab === 'runs' && (
        <div className="space-y-5">
          <MetricRow metrics={metrics} trend={trend} />

          <LiveBand runs={runningNow} now={now} />

          {emptyReason ? (
            <div className="card">
              <EmptyReason
                reason={emptyReason}
                appId={app.id}
                onWiden={() => setFilter('days', 365)}
                onClear={clearFilters}
              />
            </div>
          ) : (
            <section className="card overflow-hidden">
              <div className="flex items-center gap-2 px-5 py-4 border-b border-gray-100 flex-wrap">
                <Activity size={15} className="text-gray-400" />
                <h2 className="font-semibold text-gray-900">Runs</h2>
                <span className="text-xs text-gray-400" data-testid="runs-count">
                  {rowFiltersActive
                    ? `${sortedRuns.length} of the latest ${runs.length} match`
                    : `latest ${runs.length} of ${pluralize(analytics?.totals.runs ?? 0, 'run')} in this window`}
                </span>
                <button onClick={handleExport} disabled={exporting} className="ml-auto btn-secondary text-xs disabled:opacity-50">
                  <Download size={13} /> Export this slice (CSV)
                </button>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm min-w-[46rem]">
                  <thead className="bg-gray-50 border-b border-gray-100">
                    <tr>
                      <SortHeader label="Started" sortKey="date" sort={sort} onSort={toggleSort} />
                      <SortHeader label="Operator" sortKey="operator" sort={sort} onSort={toggleSort} />
                      <SortHeader label="Cycle time" sortKey="duration" sort={sort} onSort={toggleSort} />
                      {['Result', 'Work order', 'Product type', 'Status', ''].map(h => (
                        <th key={h} className="text-left text-[11px] font-semibold text-gray-500 uppercase tracking-wide px-4 py-3">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {sortedRuns.map(run => (
                      <tr
                        key={run.id}
                        className={`transition-colors cursor-pointer ${
                          run.status === 'in_progress' ? 'bg-blue-50/40 hover:bg-blue-50/70' : 'hover:bg-gray-50'
                        }`}
                        onClick={() => navigate(`/completions/${run.id}`)}
                        data-testid="app-run-row"
                      >
                        <td className="px-4 py-3 text-xs text-gray-600 whitespace-nowrap">{fmtDateTime(run.started_at)}</td>
                        <td className="px-4 py-3 text-xs text-gray-700">
                          {run.operator_name || <span className="text-gray-400">—</span>}
                        </td>
                        <td className="px-4 py-3 text-xs font-medium tabular-nums whitespace-nowrap">
                          {/* An unfinished run has no cycle time to report — it has an
                              elapsed time, which is a different thing; and a finished
                              run nobody timed reads "—" rather than a zero. */}
                          {run.status === 'in_progress' ? (
                            <span className="text-blue-600 font-semibold">
                              {fmtDuration(elapsedSeconds(run.started_at, now))}
                              <span className="text-[10px] font-normal text-blue-500"> and counting</span>
                            </span>
                          ) : measuredSeconds(run.duration_s) === null ? (
                            <span className="text-gray-400" title="this run was never timed">—</span>
                          ) : (
                            <span className="text-gray-900" title={durationBasisNote(run.duration_basis)}>
                              {fmtDuration(measuredSeconds(run.duration_s))}
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          {/* Passed, failed, or never inspected — three facts,
                              three renderings. A run nobody checked is not a
                              run that passed. */}
                          {run.pass_fail === 'pass' ? (
                            <span className="flex items-center gap-1 text-xs text-green-600 font-medium">
                              <CheckCircle2 size={12} /> Pass
                            </span>
                          ) : run.pass_fail === 'fail' ? (
                            <span className="flex items-center gap-1 text-xs text-red-600 font-medium">
                              <XCircle size={12} /> Fail
                            </span>
                          ) : (
                            <span className="text-xs text-gray-400" title="no pass/fail check recorded on this run">—</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-xs text-gray-600">
                          {run.work_order_number || <span className="text-gray-400">—</span>}
                        </td>
                        <td className="px-4 py-3 text-xs text-gray-600">
                          {run.product_type_name || <span className="text-gray-400">—</span>}
                        </td>
                        <td className="px-4 py-3">
                          <span className={statusBadgeClass(run.status)}>
                            {run.status === 'in_progress' && (
                              <span className="w-1.5 h-1.5 rounded-full bg-blue-500 live-pulse" aria-hidden="true" />
                            )}
                            {statusLabel(run.status)}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <span className="text-xs text-indigo-600 flex items-center justify-end gap-0.5 whitespace-nowrap">
                            Open <ChevronRight size={12} />
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {sortedRuns.length === 0 && (
                <EmptyState
                  icon={SlidersHorizontal}
                  title="No runs match these filters"
                  description={`${pluralize(runs.length, 'run')} listed for this window, none of them matching the result, status or search you picked.`}
                  action={<button type="button" onClick={clearFilters} className="btn-secondary">Show all runs</button>}
                />
              )}
              {/* A control that quietly reaches less far than the number
                  beside it is worse than no control at all. Say how far. */}
              <p className="px-5 py-3 border-t border-gray-100 bg-gray-50 text-[11px] text-gray-500" data-testid="runs-footer">
                {rowFiltersActive
                  ? `Showing ${sortedRuns.length}, sorted within the latest ${runs.length} of ${pluralize(analytics?.totals.runs ?? 0, 'run')} in this window.`
                  : `Sorted within the latest ${runs.length} of ${pluralize(analytics?.totals.runs ?? 0, 'run')} in this window.`}
                {(analytics?.totals.runs ?? 0) > runs.length && (
                  <> Export the CSV above for all {pluralize(analytics?.totals.runs ?? 0, 'run')}, or narrow the window.</>
                )}
              </p>
            </section>
          )}
        </div>
      )}

      {/* ── Who ran it ────────────────────────────────────────────────────── */}
      {tab === 'who' && (
        <div className="space-y-5">
        <section className="card p-5" data-testid="who-ran-it">
          <div className="flex items-center gap-2 mb-1">
            <User size={16} className="text-gray-400" />
            <h2 className="font-semibold text-gray-900">Who ran it</h2>
            <span className="text-[11px] text-gray-400">last {filters.days} days</span>
          </div>
          {/* This rollup counts the person who STARTED each run — it is grouped
              by the run's operator_name, so somebody who picked a job up
              mid-shift is not in it. The all-time panel below counts them, and
              says so. Two different questions, two different lists. */}
          <p className="text-[11px] text-gray-400 mb-4">
            Operators who started a run in this window, busiest first, with their own average cycle time beside it.
          </p>
          {operatorRows.length === 0 ? (
            <EmptyState
              compact
              icon={Users}
              title="No operator recorded on these runs"
              description={(analytics?.totals.runs ?? 0) === 0
                ? 'Nothing ran in this window — widen the date range in the filter bar above.'
                : 'These runs carry no operator name, so there is nobody to compare.'}
            />
          ) : (
            <ul className="space-y-2">
              {operatorRows.map(row => (
                <li key={row.name} className="flex items-center gap-3" data-testid="who-row">
                  <span className="text-xs text-gray-700 w-32 truncate flex-shrink-0" title={row.name}>{row.name}</span>
                  <div className="flex-1 h-4 bg-gray-100 rounded overflow-hidden min-w-[3rem]">
                    <div className="h-full rounded bg-indigo-500" style={{ width: `${row.share * 100}%` }} />
                  </div>
                  <span className="text-xs font-semibold text-gray-900 tabular-nums w-8 text-right">{row.runs}</span>
                  <span className="text-[11px] text-gray-400 w-24 truncate text-right" title={row.avgNote}>
                    {row.avgCycle === null ? '— avg' : `avg ${row.avgCycle}`}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* ── All time: who has EVER worked this app ──────────────────────
            The window rollup above is grouped by the run's own operator, so a
            person who joined a job mid-shift never appears in it. This one is
            the detail endpoint's, which counts them — and names how many of
            their runs they joined rather than started. It is all-time on
            purpose: the filter bar does not reach it, and it says so. */}
        <section className="card p-5" data-testid="who-all-time">
          <div className="flex items-center gap-2 mb-1">
            <Users size={16} className="text-gray-400" />
            <h2 className="font-semibold text-gray-900">All time</h2>
            <span className="text-[11px] text-gray-400">not narrowed by the filters above</span>
          </div>
          <p className="text-[11px] text-gray-400 mb-4">
            Everyone who has ever worked a run of this app, including anyone who picked one up mid-job.
          </p>
          {detail.operators.length === 0 ? (
            <EmptyState icon={Users} compact title="No operators yet" description="Nobody has opened this app on the floor." />
          ) : (
            <ul className="space-y-2">
              {detail.operators.map(op => (
                <li key={op.operator_name} className="flex items-center gap-2.5" data-testid="who-all-time-row">
                  <span className="w-7 h-7 rounded-full bg-gray-100 text-gray-500 text-[11px] font-semibold flex items-center justify-center flex-shrink-0">
                    {initials(op.operator_name)}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[13px] text-gray-800 truncate">{op.operator_name}</span>
                    <span className="block text-[11px] text-gray-400">
                      {pluralize(op.runs, 'run')}
                      {op.joined_runs > 0 && ` (${op.joined_runs} joined)`}
                      {' · last '}{fmtRelative(op.last_run_at)}
                    </span>
                  </span>
                  <span
                    className={`text-[12px] tabular-nums flex-shrink-0 ${
                      measuredSeconds(op.avg_duration_s) === null ? 'text-gray-400' : 'text-gray-500'
                    }`}
                    title={measuredSeconds(op.avg_duration_s) === null
                      ? 'none of their runs was timed'
                      : 'average cycle time, all time'}
                  >
                    {fmtDuration(measuredSeconds(op.avg_duration_s))}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
        </div>
      )}

      {/* ── Steps ─────────────────────────────────────────────────────────── */}
      {tab === 'steps' && (
        <section className="card p-5" data-testid="step-times">
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <Gauge size={16} className="text-gray-400" />
            <h2 className="font-semibold text-gray-900">Where the time goes</h2>
          </div>
          <p className="text-[11px] text-gray-400 mb-3">
            Average time per step across the runs completed in the last {filters.days} days, against each step's takt.
          </p>
          {/* The step-timing endpoint takes a day window and nothing else. Saying
              so beats letting three controls above look like they narrowed it. */}
          {filtersActive && (
            <p className="text-[11px] text-amber-600 flex items-center gap-1.5 mb-3">
              <AlertTriangle size={12} className="flex-shrink-0" />
              Every run of this app in the window — the operator, product type and work order filters do not narrow per-step times.
            </p>
          )}
          {timedSteps.length === 0 ? (
            <EmptyState
              compact
              icon={Gauge}
              title="No step has been timed yet"
              description="Per-step timers are recorded as operators walk the job in the player. Until then there is no bottleneck to point at."
            />
          ) : (
            <>
              <div className="flex items-center gap-x-4 gap-y-1 mb-3 text-[11px] text-gray-500 flex-wrap">
                <Legend color="#22c55e" label="Under takt" />
                <Legend color="#f59e0b" label="Within 10%" />
                <Legend color="#ef4444" label="Over takt" />
                <Legend color={ACCENT} label="No takt set" />
              </div>
              {/* Wide content scrolls inside its own box; the page never does. */}
              <div className="overflow-x-auto">
                <div className="min-w-[22rem]">
                  <ResponsiveContainer width="100%" height={Math.max(160, timedSteps.length * 42)}>
                    <BarChart data={timedSteps} layout="vertical" barGap={2} margin={{ left: 4, right: 20, top: 4, bottom: 4 }}>
                      <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="var(--grid-line)" />
                      <XAxis
                        type="number"
                        tick={{ fontSize: 11, fill: 'var(--muted)' }}
                        tickFormatter={v => fmtDuration(v)}
                        ticks={stepTicks}
                        domain={[0, stepTicks[stepTicks.length - 1]]}
                      />
                      <YAxis type="category" dataKey="name" tick={{ fontSize: 11, fill: 'var(--muted)' }} width={104} />
                      <Tooltip content={<StepTip />} cursor={{ fill: 'rgba(99,102,241,0.06)' }} />
                      {timedSteps.some(s => s.takt_seconds > 0) && (
                        <Bar dataKey="takt_seconds" name="Takt" fill="var(--baseline)" radius={[0, 3, 3, 0]} maxBarSize={8} />
                      )}
                      <Bar dataKey="avg_seconds" name="Average" radius={[0, 3, 3, 0]} maxBarSize={16}>
                        {timedSteps.map((entry, i) => (
                          <Cell key={i} fill={stepBarColor(entry.avg_seconds, entry.takt_seconds)} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>

              <div className="overflow-x-auto mt-4">
                <table className="w-full text-sm min-w-[34rem]">
                  <thead className="border-b border-gray-100">
                    <tr className="text-left text-[11px] uppercase tracking-wide text-gray-400">
                      <th className="font-semibold px-2 pb-2">Step</th>
                      <th className="font-semibold px-2 pb-2 text-right">Average</th>
                      <th className="font-semibold px-2 pb-2 text-right">Best</th>
                      <th className="font-semibold px-2 pb-2 text-right">Takt</th>
                      <th className="font-semibold px-2 pb-2 text-right">Runs timed</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {timedSteps.map(step => (
                      <tr key={step.index} data-testid="step-row">
                        <td className="px-2 py-2 text-[13px] text-gray-800 truncate max-w-[16rem]" title={step.name}>
                          {step.index + 1}. {step.name}
                        </td>
                        <td className="px-2 py-2 text-[13px] text-right tabular-nums text-gray-900">
                          {fmtDuration(measuredSeconds(step.avg_seconds))}
                        </td>
                        <td className="px-2 py-2 text-[13px] text-right tabular-nums text-gray-500">
                          {fmtDuration(measuredSeconds(step.min_seconds))}
                        </td>
                        <td className="px-2 py-2 text-[13px] text-right tabular-nums text-gray-500">
                          {step.takt_seconds > 0
                            ? fmtDuration(step.takt_seconds)
                            : <span className="text-gray-400" title="no takt was ever set on this step">—</span>}
                        </td>
                        <td className="px-2 py-2 text-[13px] text-right tabular-nums text-gray-500">{step.completions}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {untimedStepCount > 0 && (
                <p className="text-[11px] text-gray-400 mt-3">
                  {pluralize(untimedStepCount, 'step')} not shown — no run in this window recorded a time
                  for {untimedStepCount === 1 ? 'it' : 'them'}.
                </p>
              )}
            </>
          )}
        </section>
      )}
    </div>
  );
}

// ── Pieces ───────────────────────────────────────────────────────────────────

/**
 * The headline row every tab shows: the five measured tiles plus the trend.
 *
 * The trend is a claim about DIRECTION, so it only appears once there is
 * something on both sides of the comparison to make it with — and a couple of
 * seconds either way is the same job done twice, not a direction.
 */
function MetricRow({ metrics, trend }: { metrics: HeadlineMetric[]; trend: CycleTrend | null }) {
  return (
    <div className="grid grid-cols-2 lg:grid-cols-3 gap-3" data-testid="app-metrics">
      {metrics.map(metric => (
        <StatCard
          key={metric.key}
          label={metric.label}
          value={<span data-testid={`metric-${metric.key}`}>{metric.value ?? '—'}</span>}
          deltaLabel={metric.note}
          {...METRIC_CHROME[metric.key]}
        />
      ))}
      <TrendCard trend={trend} />
    </div>
  );
}

function TrendCard({ trend }: { trend: CycleTrend | null }) {
  if (!trend) {
    return (
      <StatCard
        label="Trend"
        value={<span data-testid="metric-trend" className="text-gray-400">—</span>}
        deltaLabel="not enough timed runs to compare"
        icon={<Minus size={18} />} iconBg="bg-gray-100" iconColor="text-gray-500"
      />
    );
  }
  const sample = `last ${trend.sample} runs vs the ${trend.sample} before`;
  if (trend.flat) {
    return (
      <StatCard
        label="Trend"
        value={<span data-testid="metric-trend">Holding steady</span>}
        deltaLabel={sample}
        icon={<Minus size={18} />} iconBg="bg-gray-100" iconColor="text-gray-500"
      />
    );
  }
  const faster = trend.deltaSeconds < 0;
  return (
    <StatCard
      label={faster ? 'Trend · getting faster' : 'Trend · getting slower'}
      value={(
        <span data-testid="metric-trend" className={faster ? 'text-green-600' : 'text-red-600'}>
          {faster ? '−' : '+'}{fmtDuration(Math.abs(trend.deltaSeconds))}
        </span>
      )}
      deltaLabel={sample}
      icon={faster ? <TrendingDown size={18} /> : <TrendingUp size={18} />}
      iconBg={faster ? 'bg-green-50' : 'bg-red-50'}
      iconColor={faster ? 'text-green-600' : 'text-red-600'}
    />
  );
}

function LiveBand({ runs, now }: {
  runs: AppAnalyticsResponse['recent_runs']; now: number;
}) {
  if (runs.length === 0) return null;
  return (
    <section className="card border-blue-100 bg-blue-50/40 p-4">
      <div className="flex items-center gap-2 mb-3 flex-wrap">
        <span className="w-2 h-2 rounded-full bg-blue-500 live-pulse" aria-hidden="true" />
        <h2 className="font-semibold text-gray-900 text-sm">Running now</h2>
        <span className="text-xs text-gray-500">{pluralize(runs.length, 'run')} in progress</span>
      </div>
      <ul className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-2">
        {runs.map(run => (
          <li key={run.id}>
            <Link
              to={`/completions/${run.id}`}
              className="flex items-center gap-3 rounded-xl bg-white border border-blue-100 px-3 py-2 hover:border-blue-200 transition-colors"
            >
              <span className="min-w-0 flex-1">
                <span className="block text-[13px] font-medium text-gray-900 truncate">
                  {run.operator_name || 'Unknown operator'}
                </span>
                <span className="block text-[11px] text-gray-400 truncate">
                  {run.work_order_number ? `${run.work_order_number} · ` : ''}
                  started {fmtRelative(run.started_at).toLowerCase()}
                </span>
              </span>
              <span className="text-sm font-bold text-blue-600 tabular-nums flex-shrink-0">
                {fmtDuration(elapsedSeconds(run.started_at, now))}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** The four different nothings, each with its own way out. */
function EmptyReason({ reason, appId, onWiden, onClear }: {
  reason: NonNullable<ReturnType<typeof emptyReasonFor>>;
  appId: string;
  onWiden: () => void;
  onClear: () => void;
}) {
  if (reason.kind === 'never-run') {
    return (
      <EmptyState
        icon={Play}
        title={`"${reason.appName}" has no runs yet`}
        description="Nobody has run this app, so there is nothing to measure — not a zero, just nothing recorded."
        action={<Link to={`/play/${appId}`} className="btn-primary"><Play size={14} /> Run it in the player</Link>}
      />
    );
  }
  if (reason.kind === 'no-runs-in-window') {
    return (
      <EmptyState
        icon={Clock}
        title={`No runs of "${reason.appName}" in the last ${reason.days} days`}
        description={reason.lastRunAt
          ? `It has run before — most recently ${fmtRelative(reason.lastRunAt).toLowerCase()}. Widen the window to see that.`
          : 'Widen the window, or run it in the player.'}
        action={
          <div className="flex items-center gap-2 flex-wrap justify-center">
            <button type="button" onClick={onWiden} className="btn-secondary">Look back a year</button>
            <Link to={`/play/${appId}`} className="btn-primary"><Play size={14} /> Run app</Link>
          </div>
        }
      />
    );
  }
  if (reason.kind === 'no-match-filters') {
    return (
      <EmptyState
        icon={SlidersHorizontal}
        title="No runs match these filters"
        description={`"${reason.appName}" has runs in the last ${reason.days} days, but none matching the operator, product type or work order you picked.`}
        action={<button type="button" onClick={onClear} className="btn-secondary">Show all runs</button>}
      />
    );
  }
  return (
    <EmptyState
      icon={Activity}
      title="Nothing to measure yet"
      description="This app has recorded no runs."
    />
  );
}

function ChartTip({ active, payload, label, format }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-white border border-gray-200 rounded-lg shadow-lg px-3 py-2 text-xs">
      <div className="font-medium text-gray-700 mb-0.5">{label}</div>
      <div className="text-gray-900 font-semibold tabular-nums">
        {format ? format(payload[0].value) : payload[0].value}
      </div>
    </div>
  );
}

function StepTip({ active, payload }: any) {
  if (!active || !payload?.length) return null;
  const step: StepMetric = payload[0].payload;
  const hasTakt = step.takt_seconds > 0;
  const ratio = hasTakt ? step.avg_seconds / step.takt_seconds : 0;
  return (
    <div className="bg-white border border-gray-200 rounded-lg shadow-lg p-3 text-xs min-w-[11rem]">
      <div className="font-semibold text-gray-900 mb-1.5 truncate">{step.name}</div>
      <div className="space-y-1 text-gray-600">
        <div className="flex justify-between gap-4"><span>Average</span><span className="font-medium text-gray-900">{fmtDuration(measuredSeconds(step.avg_seconds))}</span></div>
        <div className="flex justify-between gap-4"><span>Takt</span><span className="font-medium text-gray-900">{hasTakt ? fmtDuration(step.takt_seconds) : '—'}</span></div>
        <div className="flex justify-between gap-4"><span>Runs timed</span><span className="font-medium text-gray-900">{step.completions}</span></div>
        {hasTakt && ratio > 0 && (
          <div className={`font-semibold ${ratio > 1 ? 'text-red-600' : 'text-green-600'}`}>
            {ratio > 1 ? `${Math.round((ratio - 1) * 100)}% over takt` : `${Math.round((1 - ratio) * 100)}% under takt`}
          </div>
        )}
      </div>
    </div>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className="w-2.5 h-2.5 rounded-sm inline-block" style={{ backgroundColor: color }} />
      {label}
    </span>
  );
}

function SortHeader({ label, sortKey, sort, onSort }: {
  label: string;
  sortKey: 'date' | 'operator' | 'duration';
  sort: { key: string; desc: boolean };
  onSort: (k: 'date' | 'operator' | 'duration') => void;
}) {
  const active = sort.key === sortKey;
  return (
    <th className="text-left px-4 py-3" aria-sort={active ? (sort.desc ? 'descending' : 'ascending') : 'none'}>
      <button
        type="button"
        onClick={e => { e.stopPropagation(); onSort(sortKey); }}
        className={`inline-flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide transition-colors ${
          active ? 'text-gray-900' : 'text-gray-500 hover:text-gray-800'
        }`}
      >
        {label}
        {active
          ? (sort.desc ? <ChevronDown size={12} /> : <ChevronUp size={12} />)
          : <ChevronDown size={12} className="opacity-25" />}
      </button>
    </th>
  );
}

function BindingRow({ icon: Icon, label, children }: {
  icon: React.ElementType; label: string; children: React.ReactNode;
}) {
  return (
    <div className="flex items-start gap-2.5">
      <Icon size={14} className="text-gray-300 mt-0.5 flex-shrink-0" />
      <div className="min-w-0 flex-1">
        <dt className="text-[11px] text-gray-400">{label}</dt>
        <dd className="text-[13px] text-gray-700 mt-0.5">{children}</dd>
      </div>
    </div>
  );
}

function Unset({ children }: { children: React.ReactNode }) {
  return <span className="text-gray-400">{children}</span>;
}

// ── Field cards ──────────────────────────────────────────────────────────────
// What each capture widget actually recorded, in the shape the value has: a
// pass/fail split with its yield, a number's spread and daily trend, an
// option's top values. One line per field says a field was recorded; these say
// what it said.

const FIELD_KIND: Record<string, { icon: React.ElementType; label: string }> = {
  number: { icon: Activity, label: 'Number' },
  boolean: { icon: CheckCircle2, label: 'Pass / Fail' },
  option: { icon: ListChecks, label: 'Options' },
  text: { icon: Info, label: 'Text' },
};

function yieldColor(pct: number | null | undefined): string {
  if (pct === null || pct === undefined) return 'text-gray-400';
  return pct >= 95 ? 'text-green-600' : pct >= 80 ? 'text-amber-600' : 'text-red-600';
}

/** A captured number, printed as recorded — never through a duration formatter,
 *  because a torque reading is not a length of time. */
function fmtValue(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(Number(n))) return '—';
  const value = Number(n);
  return Number.isInteger(value) ? String(value) : String(Math.round(value * 1000) / 1000);
}

function FieldCard({ field }: { field: AppAnalyticsResponse['fields'][number] }) {
  const meta = FIELD_KIND[field.kind] ?? FIELD_KIND.text;
  const Icon = meta.icon;
  const trend = (field.trend ?? []).map(t => ({ ...t, day: dayLabel(t.date) }));
  const pass = field.stats.pass ?? 0;
  const fail = field.stats.fail ?? 0;
  const options = field.stats.options ?? [];
  const busiest = Math.max(1, ...options.map(o => o.count));

  return (
    <div className="card p-4" data-testid="field-card">
      <div className="flex items-start justify-between gap-2 mb-3">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-gray-900 truncate" title={field.label}>{field.label}</h3>
          {field.step_name && <p className="text-[11px] text-gray-400 truncate">{field.step_name}</p>}
        </div>
        <span className="flex items-center gap-1 text-[11px] text-gray-500 bg-gray-50 border border-gray-100 rounded-full px-2 py-0.5 flex-shrink-0">
          <Icon size={11} /> {meta.label}
        </span>
      </div>

      {field.kind === 'boolean' && (
        <div className="flex items-center gap-4">
          <div className={`text-2xl font-bold tabular-nums ${yieldColor(field.stats.yield_pct)}`}>
            {field.stats.yield_pct === null || field.stats.yield_pct === undefined
              ? '—'
              : `${Math.round(field.stats.yield_pct)}%`}
            <span className="block text-[10px] font-medium uppercase tracking-wide text-gray-400">yield</span>
          </div>
          <div className="space-y-1 text-xs">
            <div className="flex items-center gap-1.5 text-gray-700">
              <CheckCircle2 size={13} className="text-green-600" />
              Pass <span className="font-semibold text-gray-900 tabular-nums">{pass}</span>
            </div>
            <div className="flex items-center gap-1.5 text-gray-700">
              <XCircle size={13} className="text-red-600" />
              Fail <span className="font-semibold text-gray-900 tabular-nums">{fail}</span>
            </div>
            <div className="text-gray-400">{pluralize(pass + fail, 'check')}</div>
          </div>
        </div>
      )}

      {field.kind === 'number' && (
        <div>
          <div className="grid grid-cols-4 gap-2 mb-3">
            {[
              ['Avg', fmtValue(field.stats.avg)], ['Min', fmtValue(field.stats.min)],
              ['Max', fmtValue(field.stats.max)], ['Count', String(field.stats.count ?? 0)],
            ].map(([label, value]) => (
              <div key={label} className="bg-gray-50 rounded-lg px-2 py-1.5 text-center">
                <div className="text-sm font-bold text-gray-900 tabular-nums">{value}</div>
                <div className="text-[10px] text-gray-400 uppercase tracking-wide">{label}</div>
              </div>
            ))}
          </div>
          {trend.length > 1 ? (
            <ResponsiveContainer width="100%" height={110}>
              <LineChart data={trend} margin={{ left: 0, right: 8, top: 4, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--grid-line)" />
                <XAxis dataKey="day" tick={{ fontSize: 9, fill: 'var(--muted)' }} minTickGap={14} />
                <YAxis
                  tick={{ fontSize: 10, fill: 'var(--muted)' }}
                  width={46}
                  tickCount={4}
                  tickFormatter={(v: number) => fmtValue(v)}
                  domain={['auto', 'auto']}
                />
                <Tooltip content={<ChartTip format={(v: number) => fmtValue(v)} />} />
                <Line type="monotone" dataKey="avg" stroke={ACCENT} strokeWidth={2}
                  dot={{ r: 2.5, fill: ACCENT }} activeDot={{ r: 4 }} />
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <p className="text-[11px] text-gray-400 text-center py-2">A daily trend appears once more than one day has data</p>
          )}
        </div>
      )}

      {field.kind === 'option' && (
        <div className="space-y-2">
          {options.slice(0, 8).map(option => (
            <div key={option.value} className="flex items-center gap-3">
              <span className="text-xs text-gray-700 w-24 truncate flex-shrink-0" title={option.value}>{option.value}</span>
              <div className="flex-1 h-4 bg-gray-100 rounded overflow-hidden min-w-[2rem]">
                <div className="h-full rounded" style={{ width: `${(option.count / busiest) * 100}%`, background: ACCENT }} />
              </div>
              <span className="text-xs font-semibold text-gray-900 tabular-nums w-8 text-right">{option.count}</span>
            </div>
          ))}
          {options.length > 8 && (
            <p className="text-[11px] text-gray-400">+{options.length - 8} more values</p>
          )}
          <p className="text-[11px] text-gray-400">{pluralize(field.stats.count ?? 0, 'selection')}</p>
        </div>
      )}

      {field.kind === 'text' && (
        <p className="text-sm text-gray-500 py-3">
          <span className="text-xl font-bold text-gray-900 tabular-nums mr-1.5">{field.stats.count ?? 0}</span>
          entries captured
        </p>
      )}
    </div>
  );
}

/** "Maria Lopez" → "ML". Two letters is what fits an avatar chip. */
function initials(name: string): string {
  const parts = (name || '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

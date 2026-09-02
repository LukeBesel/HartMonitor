// The one screen for one app: /apps/:id.
//
// This app's cycle time used to be reported on five screens — App Detail, Run
// History, App Analytics, the Apps Dashboard and Operation Analytics — under
// four different labels, at three different precisions, each behind its own
// filter bar. The numbers came from the same runs, so the disagreements were
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
  Edit3, Gauge, GitBranch, Globe, Info, Layers, ListChecks, Lock, MapPin,
  MousePointerClick, Package, Play, RefreshCw, SlidersHorizontal, TrendingUp,
  User, Users, XCircle, Zap,
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
  DAY_PRESETS, buildHeadlineMetrics, buildOperatorRollup, emptyReasonFor,
  fieldSampleSize, filtersFromQuery, hasNarrowingFilters, summariseField,
} from '../components/apps/appDashboardModel';
import type { AppDashboardFilters, HeadlineMetric } from '../components/apps/appDashboardModel';
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

  const setQuery = useCallback((patch: Record<string, string>) => {
    setSearchParams(prev => {
      const next = new URLSearchParams(prev);
      for (const [key, value] of Object.entries(patch)) {
        if (value) next.set(key, value);
        else next.delete(key);
      }
      return next;
    }, { replace: true });
  }, [setSearchParams]);

  const setTab = (key: TabKey) => setQuery({ tab: key });
  const setFilter = <K extends keyof AppDashboardFilters>(key: K, value: AppDashboardFilters[K]) => {
    const param = key === 'days' ? 'days'
      : key === 'operator' ? 'operator'
        : key === 'workOrderId' ? 'work_order_id' : 'product_type_id';
    setQuery({ [param]: String(value ?? '') });
  };
  const clearFilters = () => setQuery({ operator: '', work_order_id: '', product_type_id: '' });

  const [detail, setDetail] = useState<AppDetailResponse | null>(null);
  const [analytics, setAnalytics] = useState<AppAnalyticsResponse | null>(null);
  const [steps, setSteps] = useState<StepMetricsPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [sort, setSort] = useState<{ key: 'date' | 'operator' | 'duration'; desc: boolean }>({ key: 'date', desc: true });

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
        api.getAppAnalytics(id, toParams(filters)),
        api.getStepMetrics(id, filters.days).catch(() => null) as Promise<StepMetricsPayload | null>,
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
  }, [id, filters]);

  const { lastRefreshed, refreshing, refresh } = useAutoRefresh(load, REFRESH_MS);

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
      addToast('Runs CSV downloaded', 'success');
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
  // `current_revision` rides the app row from GET /api/apps/:id(/detail). A
  // payload without it is not revision 1 — it is an app nobody has published
  // under change control, which the header says in words.
  const revision = Number((app as { current_revision?: number }).current_revision ?? 0);
  const authoredSteps = orderedSteps(app);
  const options = analytics?.filter_options;
  const filtersActive = hasNarrowingFilters(filters);

  const metrics = analytics ? buildHeadlineMetrics(analytics.totals, analytics.days) : [];
  const runs = analytics?.recent_runs ?? [];
  const runningNow = runs.filter(r => r.status === 'in_progress');
  const operatorRows = analytics ? buildOperatorRollup(analytics.by_operator) : [];

  // The four different nothings, told apart: no runs ever, none in this window,
  // none matching these filters — each with its own way out.
  const emptyReason = analytics
    ? emptyReasonFor({
      appCount: 1,
      app: { name: app.name, runsTotal: stats.runs_total, lastRunAt: stats.last_run_at },
      runsInWindow: analytics.totals.runs,
      days: filters.days,
      filtersActive,
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

  const sortedRuns = runs.slice().sort((a, b) => {
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
            {/* Which revision the floor is actually running. Revision 0 is not
                revision one — it means this app predates change control, or has
                never been published under it, and saying "Rev 0 live" would
                claim a revision that does not exist. */}
            <span className="text-[11px] font-medium text-gray-400 align-middle" title={revision > 0
              ? 'The revision operators are running right now'
              : 'This app has never been published through the builder’s change-controlled publish flow'}>
              {revision > 0 ? `Rev ${revision} live` : 'Not yet published under change control'}
            </span>
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
            <button onClick={handleExport} disabled={exporting} className="btn-secondary disabled:opacity-50">
              {exporting ? <RefreshCw size={14} className="animate-spin" /> : <Download size={14} />}
              Export runs (CSV)
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

          {filtersActive && (
            <button type="button" onClick={clearFilters} className="text-xs font-medium text-indigo-600 hover:text-indigo-800">
              Clear filters
            </button>
          )}

          <span className="text-[11px] text-gray-400 ml-auto" data-testid="app-filter-summary">
            {runCountLine}
          </span>
        </div>
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
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3" data-testid="app-metrics">
            {metrics.map(metric => (
              <StatCard
                key={metric.key}
                label={metric.label}
                value={<span data-testid={`metric-${metric.key}`}>{metric.value ?? '—'}</span>}
                deltaLabel={metric.note}
                {...METRIC_CHROME[metric.key]}
              />
            ))}
          </div>

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
                  <ul className="grid grid-cols-1 md:grid-cols-2 gap-2">
                    {failedChecks.map(f => (
                      <li key={f.label} className="flex items-center gap-3 rounded-xl border border-red-100 bg-red-50/50 px-3 py-2">
                        <XCircle size={14} className="text-red-500 flex-shrink-0" />
                        <span className="text-[13px] text-gray-900 min-w-0 flex-1 truncate" title={f.label}>{f.label}</span>
                        <span className="text-xs font-semibold text-red-600 tabular-nums flex-shrink-0">
                          {f.fail} failed of {f.of}
                        </span>
                      </li>
                    ))}
                    {(analytics?.totals.abandoned ?? 0) > 0 && (
                      <li className="flex items-center gap-3 rounded-xl border border-amber-100 bg-amber-50/50 px-3 py-2">
                        <Activity size={14} className="text-amber-500 flex-shrink-0" />
                        <span className="text-[13px] text-gray-900 min-w-0 flex-1">Runs nobody finished</span>
                        <span className="text-xs font-semibold text-amber-700 tabular-nums flex-shrink-0">
                          {analytics?.totals.abandoned} abandoned
                        </span>
                      </li>
                    )}
                  </ul>
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
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {metrics.map(metric => (
              <StatCard
                key={metric.key}
                label={metric.label}
                value={<span data-testid={`metric-${metric.key}`}>{metric.value ?? '—'}</span>}
                deltaLabel={metric.note}
                {...METRIC_CHROME[metric.key]}
              />
            ))}
          </div>

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
                <span className="text-xs text-gray-400">
                  latest {runs.length} of {pluralize(analytics?.totals.runs ?? 0, 'run')} in this window
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
                      {['Work order', 'Product type', 'Status', ''].map(h => (
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
              {(analytics?.totals.runs ?? 0) > runs.length && (
                <p className="px-5 py-3 border-t border-gray-100 bg-gray-50 text-[11px] text-gray-500">
                  The newest {runs.length} runs of this slice are listed. Export the CSV above for all
                  {' '}{pluralize(analytics?.totals.runs ?? 0, 'run')}, or narrow the window.
                </p>
              )}
            </section>
          )}
        </div>
      )}

      {/* ── Who ran it ────────────────────────────────────────────────────── */}
      {tab === 'who' && (
        <section className="card p-5" data-testid="who-ran-it">
          <div className="flex items-center gap-2 mb-1">
            <User size={16} className="text-gray-400" />
            <h2 className="font-semibold text-gray-900">Who ran it</h2>
          </div>
          <p className="text-[11px] text-gray-400 mb-4">
            Everyone who worked a run in this window, busiest first, with their own average cycle time beside it.
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

function LiveBand({ runs, now }: {
  runs: AppAnalyticsResponse['recent_runs']; now: number;
}) {
  if (runs.length === 0) return null;
  return (
    <section className="card border-blue-100 bg-blue-50/40 p-4">
      <div className="flex items-center gap-2 mb-3 flex-wrap">
        <span className="w-2 h-2 rounded-full bg-blue-500 live-pulse" aria-hidden="true" />
        <h2 className="font-semibold text-gray-900 text-sm">On the bench right now</h2>
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

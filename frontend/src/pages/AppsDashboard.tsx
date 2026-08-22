// Apps → Dashboard. The front door to app data: pick an app at the top, set the
// filters next to it, and read what that app's runs actually recorded — who ran
// it, how long it took, what passed, and what operators typed in.
//
// It deliberately does NOT re-implement /apps/:id/analytics. That page owns the
// deep dive (trend charts, per-field distributions); this one owns the choosing,
// answers the questions a supervisor asks first, and hands the current slice
// over to the deep dive through the query string.
//
// The rule everything here follows: never print a number the data didn't earn.
// A metric the payload can't support renders "—" with the reason next to it,
// and four different kinds of "nothing" get four different empty states.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  Activity, AppWindow, BarChart2, CheckCircle2, ChevronRight, Clock, Download,
  ListChecks, Play, Plus, RefreshCw, SlidersHorizontal, TrendingUp, User,
} from 'lucide-react';
import { api } from '../api/client';
import type { AppAnalyticsParams, AppAnalyticsResponse } from '../api/client';
import type { App } from '../types';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { useAutoRefresh } from '../hooks/useAutoRefresh';
import { useDepartmentFilter } from '../hooks/useDepartmentFilter';
import PageHeader from '../components/shared/PageHeader';
import EmptyState from '../components/shared/EmptyState';
import StatCard from '../components/shared/StatCard';
import LastRefreshed from '../components/shared/LastRefreshed';
import { useCoachDocked } from '../components/apps/AppTrainingCoach';
import { fmtDateTime, fmtDuration, fmtRelative, pluralize } from '../components/apps/appModel';
import {
  DAY_PRESETS, DEFAULT_FILTERS, buildAppOptions, buildHeadlineMetrics, emptyReasonFor,
  fieldSampleSize, filtersToQuery, hasNarrowingFilters, readSelectedAppId, resolveAppId,
  summariseField, writeSelectedAppId,
} from '../components/apps/appDashboardModel';
import type {
  AppDashboardFilters, DashboardAppOption, HeadlineMetric,
} from '../components/apps/appDashboardModel';

const REFRESH_MS = 60_000;

const METRIC_CHROME: Record<HeadlineMetric['key'], { icon: React.ReactNode; iconBg: string; iconColor: string }> = {
  runs:             { icon: <Activity size={18} />,     iconBg: 'bg-blue-50',   iconColor: 'text-blue-600' },
  completed:        { icon: <CheckCircle2 size={18} />, iconBg: 'bg-green-50',  iconColor: 'text-green-600' },
  avg_cycle:        { icon: <Clock size={18} />,        iconBg: 'bg-purple-50', iconColor: 'text-purple-600' },
  first_pass_yield: { icon: <TrendingUp size={18} />,   iconBg: 'bg-amber-50',  iconColor: 'text-amber-600' },
};

/** The four query parameters GET /api/apps/:id/analytics actually filters on. */
function toParams(filters: AppDashboardFilters): AppAnalyticsParams {
  return {
    days: filters.days,
    operator: filters.operator || undefined,
    work_order_id: filters.workOrderId || undefined,
    product_type_id: filters.productTypeId || undefined,
  };
}

function statusBadgeClass(status: string): string {
  if (status === 'completed') return 'badge-green';
  if (status === 'abandoned') return 'badge-red';
  if (status === 'in_progress') return 'badge-blue';
  return 'badge-gray';
}

function statusLabel(status: string): string {
  if (status === 'in_progress') return 'In progress';
  return status.charAt(0).toUpperCase() + status.slice(1);
}

export default function AppsDashboard() {
  const { user } = useAuth();
  const { addToast } = useToast();
  const navigate = useNavigate();
  // The training coach floats bottom-right on the apps surfaces; leave it a lane
  // rather than let it sit on top of the runs table.
  const coachDocked = useCoachDocked();
  const dept = useDepartmentFilter('apps-dashboard');

  const [apps, setApps] = useState<DashboardAppOption[]>([]);
  const [appsLoaded, setAppsLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  // What the user picked (or picked last visit), which is not always what is on
  // screen — a remembered app can be outside the chosen department.
  const [chosenId, setChosenId] = useState<string | null>(() => readSelectedAppId(user?.id));
  const [filters, setFilters] = useState<AppDashboardFilters>(DEFAULT_FILTERS);
  // The payload is kept with the exact question it answers, so a response can
  // never be read under a different app's name or a different filter's label.
  const [result, setResult] = useState<{ key: string; payload: AppAnalyticsResponse } | null>(null);
  const failedKey = useRef<string | null>(null);
  // The server builds these lists all-time for the app, independent of the
  // filters, so they are kept across a filter reload — a select that empties
  // itself mid-fetch would silently discard the choice being made in it.
  const [pickable, setPickable] =
    useState<{ appId: string; options: AppAnalyticsResponse['filter_options'] } | null>(null);

  // Department is the one filter the analytics endpoint knows nothing about, so
  // it scopes the app list instead of the numbers. Apps carry department_id.
  const visibleApps = useMemo(
    () => apps.filter(a => dept.matches({ department_id: a.departmentId })),
    [apps, dept],
  );

  const activeId = useMemo(() => resolveAppId(visibleApps, chosenId), [visibleApps, chosenId]);
  const activeApp = useMemo(
    () => visibleApps.find(a => a.id === activeId) ?? null,
    [visibleApps, activeId],
  );

  /** Identifies one question: this app, these filters. */
  const requestKey = activeId ? `${activeId}|${filtersToQuery(filters)}` : '';

  const loadApps = useCallback(async () => {
    // The run counters are a nice-to-have: without them the picker still works,
    // it just can't say which app ran most recently.
    const [appList, stats] = await Promise.all([
      api.getApps() as Promise<App[]>,
      api.getAppsStats().catch(() => null),
    ]);
    setApps(buildAppOptions(Array.isArray(appList) ? appList : [], stats?.apps ?? null));
    setAppsLoaded(true);
  }, []);

  useEffect(() => {
    loadApps().catch((err: unknown) => {
      setLoadError(err instanceof Error ? err.message : 'Failed to load apps');
      setAppsLoaded(true);
    });
  }, [loadApps]);

  const loadAnalytics = useCallback(async () => {
    if (!activeId) { setResult(null); return; }
    const key = requestKey;
    try {
      const payload = await api.getAppAnalytics(activeId, toParams(filters));
      failedKey.current = null;
      setResult({ key, payload });
      setPickable({ appId: activeId, options: payload.filter_options });
      setLoadError(null);
    } catch (err: unknown) {
      failedKey.current = key;
      setLoadError(err instanceof Error ? err.message : 'Failed to load app data');
      throw err; // let useAutoRefresh keep the freshness stamp honestly stale
    }
  }, [activeId, filters, requestKey]);

  const { lastRefreshed, refreshing, refresh } = useAutoRefresh(loadAnalytics, REFRESH_MS);

  // useAutoRefresh deliberately drops a fetch that starts while another is in
  // flight, so a burst of filter changes can leave the last one unfetched — the
  // controls would then describe a slice the numbers below aren't from. Re-ask
  // whenever what's on screen no longer answers the question being asked, and
  // stop at a key that already failed rather than spinning on a broken endpoint.
  useEffect(() => {
    if (!requestKey || refreshing) return;
    if (result?.key === requestKey || failedKey.current === requestKey) return;
    void refresh();
  }, [requestKey, refreshing, result, refresh]);

  const refreshAll = useCallback(() => {
    failedKey.current = null;
    void loadApps().catch(() => { /* the analytics refresh reports its own failure */ });
    void refresh();
  }, [loadApps, refresh]);

  // Picking a different app clears the run filters with it: an operator or work
  // order from the previous app is almost never a choice about this one, and a
  // stale id would silently filter everything away.
  const chooseApp = (id: string) => {
    setChosenId(id);
    writeSelectedAppId(user?.id, id);
    setFilters(prev => ({ ...DEFAULT_FILTERS, days: prev.days }));
  };

  const setFilter = <K extends keyof AppDashboardFilters>(key: K, value: AppDashboardFilters[K]) =>
    setFilters(prev => ({ ...prev, [key]: value }));

  const clearFilters = () => setFilters(prev => ({ ...DEFAULT_FILTERS, days: prev.days }));

  const handleExport = async () => {
    if (!activeId || exporting) return;
    setExporting(true);
    try {
      // The export carries the same filters as the screen, so what downloads is
      // the slice being looked at — with every value each run recorded.
      await api.downloadAppAnalyticsCsv(activeId, toParams(filters));
      addToast('Run data CSV downloaded', 'success');
    } catch (err: unknown) {
      addToast(err instanceof Error ? err.message : 'Export failed', 'error');
    } finally {
      setExporting(false);
    }
  };

  // Only ever read a payload back against the question it answers — switching
  // apps must not show the previous app's numbers under the new app's name.
  const current = result && result.key === requestKey ? result.payload : null;
  const filtersActive = hasNarrowingFilters(filters);
  // "Nothing to show" is only knowable once the answer is in. Deciding earlier
  // would flash "no runs in the last 30 days" over every app switch.
  const answered = appsLoaded && (apps.length === 0 || !!current);
  const emptyReason = answered
    ? emptyReasonFor({
      appCount: apps.length,
      app: activeApp,
      runsInWindow: current?.totals.runs ?? 0,
      days: filters.days,
      filtersActive,
    })
    : null;
  const waitingForAnswer = !answered && !loadError;

  const metrics = current ? buildHeadlineMetrics(current.totals, current.days) : [];
  const options = pickable?.appId === activeId ? pickable.options : undefined;

  return (
    <div className={`min-h-screen bg-[#f8fafc] p-6 space-y-6 transition-[padding] ${coachDocked ? 'lg:pr-[392px]' : ''}`}>
      <PageHeader
        title="App Dashboard"
        subtitle="Pick an app, set the filters, and read what its runs actually recorded."
        actions={
          <>
            <LastRefreshed at={lastRefreshed} refreshing={refreshing} onRefresh={refreshAll} />
            {activeId && (
              <>
                <button onClick={handleExport} disabled={exporting} className="btn-secondary disabled:opacity-50">
                  {exporting ? <RefreshCw size={14} className="animate-spin" /> : <Download size={14} />}
                  Export CSV
                </button>
                <Link to={`/apps/${activeId}/analytics${filtersToQuery(filters)}`} className="btn-secondary">
                  <BarChart2 size={14} /> Full analytics
                </Link>
                <Link to={`/play/${activeId}`} className="btn-primary">
                  <Play size={14} /> Run app
                </Link>
              </>
            )}
          </>
        }
      />

      {/* ── App picker + filters ─────────────────────────────────────────── */}
      <section className="card p-4 sm:p-5 space-y-3" data-testid="app-dashboard-controls">
        <div className="flex items-end gap-3 flex-wrap">
          <label className="flex flex-col gap-1 min-w-[16rem] flex-1 max-w-md">
            <span className="text-xs font-semibold text-gray-500">App</span>
            <select
              className="input-field py-2"
              value={activeId ?? ''}
              disabled={visibleApps.length === 0}
              onChange={e => chooseApp(e.target.value)}
            >
              {visibleApps.length === 0 && <option value="">No apps to show</option>}
              {visibleApps.map(a => (
                <option key={a.id} value={a.id}>
                  {a.name}{a.status === 'draft' ? ' (draft)' : ''} — last run {fmtRelative(a.lastRunAt).toLowerCase()}
                </option>
              ))}
            </select>
          </label>

          {dept.departments.length > 0 && (
            <label className="flex flex-col gap-1 min-w-[12rem]">
              <span className="text-xs font-semibold text-gray-500">Department</span>
              <select
                className="input-field py-2"
                value={dept.departmentId}
                onChange={e => dept.setDepartmentId(e.target.value)}
              >
                <option value="">All departments</option>
                {dept.departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            </label>
          )}

          {activeApp && (
            <div className="text-xs text-gray-400 pb-2.5">
              {activeApp.runsTotal === null
                ? 'Run total unavailable'
                : `${pluralize(activeApp.runsTotal, 'run')} all time`}
              {' · '}last run {fmtRelative(activeApp.lastRunAt).toLowerCase()}
            </div>
          )}
        </div>

        <div className="flex items-center gap-3 flex-wrap border-t border-gray-100 pt-3">
          <span className="flex items-center gap-1.5 text-xs font-semibold text-gray-500">
            <SlidersHorizontal size={13} /> Runs
          </span>

          <div className="flex rounded-lg border border-gray-200 overflow-hidden" role="group" aria-label="Time window">
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
        </div>

        {/* Say what each control really does, so nothing on screen looks like a
            filter it isn't. */}
        <p className="text-[11px] text-gray-400 leading-relaxed">
          Department narrows which apps you can pick. The run filters are the four this app's
          analytics API supports — time window, operator, product type and work order — so every
          number below moves with them.
        </p>
      </section>

      {loadError && (
        <div className="card border-red-100 bg-red-50/60 px-4 py-3 text-sm text-red-700" role="alert">
          {loadError}
        </div>
      )}

      {/* ── Body ─────────────────────────────────────────────────────────── */}
      {emptyReason ? (
        <div className="card">
          {emptyReason.kind === 'no-apps' && (
            <EmptyState
              icon={AppWindow}
              title="No apps yet"
              description="An app is a guided procedure operators run on the floor. Build one and its data shows up here."
              action={<Link to="/apps?new=1" className="btn-primary"><Plus size={14} /> Build an app</Link>}
            />
          )}
          {emptyReason.kind === 'never-run' && (
            <EmptyState
              icon={Play}
              title={`"${emptyReason.appName}" has no runs yet`}
              description="Nobody has run this app, so there is nothing to measure — not a zero, just nothing recorded."
              action={<Link to={`/play/${activeId}`} className="btn-primary"><Play size={14} /> Run it in the player</Link>}
            />
          )}
          {emptyReason.kind === 'no-runs-in-window' && (
            <EmptyState
              icon={Clock}
              title={`No runs of "${emptyReason.appName}" in the last ${emptyReason.days} days`}
              description={emptyReason.lastRunAt
                ? `It has run before — most recently ${fmtRelative(emptyReason.lastRunAt).toLowerCase()}. Widen the window to see that.`
                : 'Widen the window, or run it in the player.'}
              action={
                <div className="flex items-center gap-2">
                  <button type="button" onClick={() => setFilter('days', 365)} className="btn-secondary">
                    Look back a year
                  </button>
                  <Link to={`/play/${activeId}`} className="btn-primary"><Play size={14} /> Run app</Link>
                </div>
              }
            />
          )}
          {emptyReason.kind === 'no-match-filters' && (
            <EmptyState
              icon={SlidersHorizontal}
              title="No runs match these filters"
              description={`"${emptyReason.appName}" has runs in the last ${emptyReason.days} days, but none matching the operator, product type or work order you picked.`}
              action={<button type="button" onClick={clearFilters} className="btn-secondary">Show all runs</button>}
            />
          )}
        </div>
      ) : waitingForAnswer ? (
        <div className="card py-16 flex flex-col items-center gap-3">
          <div className="w-7 h-7 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
          <span className="text-sm text-gray-400">Loading run data…</span>
        </div>
      ) : current ? (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4" data-testid="app-dashboard-metrics">
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

          {/* items-start: each card hugs its own content instead of stretching to
              match the taller one, which left a half-empty operator panel. */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
            {/* Who ran it */}
            <section className="card p-5">
              <div className="flex items-center gap-2 mb-4">
                <User size={16} className="text-gray-400" />
                <h2 className="font-semibold text-gray-900">Who ran it</h2>
              </div>
              {current.by_operator.length === 0 ? (
                <EmptyState compact icon={User} title="No operator recorded on these runs" />
              ) : (
                <div className="space-y-2">
                  {current.by_operator.map(op => {
                    const max = Math.max(1, ...current.by_operator.map(o => o.runs));
                    return (
                      <div key={op.operator_name || 'unknown'} className="flex items-center gap-3">
                        <span className="text-xs text-gray-700 w-32 truncate flex-shrink-0" title={op.operator_name}>
                          {op.operator_name || 'Unknown'}
                        </span>
                        <div className="flex-1 h-4 bg-gray-100 rounded overflow-hidden">
                          <div className="h-full rounded bg-indigo-500" style={{ width: `${(op.runs / max) * 100}%` }} />
                        </div>
                        <span className="text-xs font-semibold text-gray-900 tabular-nums w-8 text-right">{op.runs}</span>
                        <span className="text-[11px] text-gray-400 w-20 truncate" title="average cycle time">
                          {op.avg_duration_s === null ? '— avg' : `avg ${fmtDuration(op.avg_duration_s)}`}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </section>

            {/* What operators entered */}
            <section className="card p-5">
              <div className="flex items-center gap-2 mb-1">
                <ListChecks size={16} className="text-gray-400" />
                <h2 className="font-semibold text-gray-900">What operators entered</h2>
                {current.fields.length > 0 && (
                  <span className="text-xs text-gray-400">({current.fields.length})</span>
                )}
              </div>
              <p className="text-[11px] text-gray-400 mb-3">
                Summarised across the filtered runs. Open a run below for the values it recorded one by one.
              </p>
              {current.fields.length === 0 ? (
                <EmptyState
                  compact
                  icon={ListChecks}
                  title="No captured values in this window"
                  description="These runs recorded no input, check or scan — either the app captures nothing or nobody filled it in."
                />
              ) : (
                <ul className="divide-y divide-gray-100">
                  {current.fields.map(field => (
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
          </div>

          {/* The runs themselves */}
          <section className="card overflow-hidden">
            <div className="flex items-center gap-2 px-5 py-4 border-b border-gray-100">
              <Activity size={15} className="text-gray-400" />
              <h2 className="font-semibold text-gray-900">Runs</h2>
              <span className="text-xs text-gray-400">
                latest {current.recent_runs.length} of {pluralize(current.totals.runs, 'run')} in this window
              </span>
              <Link
                to={`/apps/${activeId}/history`}
                className="ml-auto text-xs font-medium text-indigo-600 hover:text-indigo-800 flex items-center gap-0.5"
              >
                Full history <ChevronRight size={12} />
              </Link>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 border-b border-gray-100">
                  <tr>
                    {['Started', 'Operator', 'Duration', 'Work order', 'Product type', 'Status', ''].map(h => (
                      <th key={h} className="text-left text-xs font-medium text-gray-500 uppercase tracking-wide px-4 py-3">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {current.recent_runs.map(run => (
                    <tr
                      key={run.id}
                      className="hover:bg-gray-50 transition-colors cursor-pointer"
                      onClick={() => navigate(`/completions/${run.id}`)}
                      data-testid="dashboard-run-row"
                    >
                      <td className="px-4 py-3 text-xs text-gray-600 whitespace-nowrap">{fmtDateTime(run.started_at)}</td>
                      <td className="px-4 py-3 text-xs text-gray-700">{run.operator_name || <span className="text-gray-400">—</span>}</td>
                      <td className="px-4 py-3 text-xs font-medium text-gray-900 tabular-nums">
                        {/* An unfinished run has no duration to report — not a zero. */}
                        {run.duration_s === null ? <span className="text-gray-400" title="run has not finished">—</span> : fmtDuration(run.duration_s)}
                      </td>
                      <td className="px-4 py-3 text-xs text-gray-600">{run.work_order_number || <span className="text-gray-400">—</span>}</td>
                      <td className="px-4 py-3 text-xs text-gray-600">{run.product_type_name || <span className="text-gray-400">—</span>}</td>
                      <td className="px-4 py-3">
                        <span className={statusBadgeClass(run.status)}>{statusLabel(run.status)}</span>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <span className="text-xs text-indigo-600 flex items-center justify-end gap-0.5">
                          Values <ChevronRight size={12} />
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      ) : null}
    </div>
  );
}

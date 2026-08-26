import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams, useNavigate, useSearchParams, Link } from 'react-router-dom';
import { api, AppAnalyticsResponse, AppAnalyticsField, AppAnalyticsParams } from '../api/client';
import { useToast } from '../context/ToastContext';
import { useAuth } from '../context/AuthContext';
import { markTrainingDataSeen } from '../components/apps/useAppTraining';
import {
  durationTicks, elapsedSeconds, fmtDuration, fmtRelative, measuredSeconds, parseServerTime, pluralize,
} from '../components/apps/appModel';
import useAutoRefresh from '../hooks/useAutoRefresh';
import LastRefreshed from '../components/shared/LastRefreshed';
import EmptyState from '../components/shared/EmptyState';
import { useCoachDocked } from '../components/apps/AppTrainingCoach';
import {
  ArrowLeft, Play, Activity, Clock, CheckCircle2, XCircle, TrendingUp,
  Download, Database, BarChart2, Calendar, User, Package, ChevronRight,
  SlidersHorizontal, RefreshCw, Type, Hash, ListChecks, History, Info,
} from 'lucide-react';
import {
  ResponsiveContainer, BarChart, Bar, LineChart, Line, XAxis, YAxis,
  Tooltip, CartesianGrid, PieChart, Pie, Cell,
} from 'recharts';
import { stepTaktSeconds } from '../components/player/runtime';

// ── Formatting helpers (same conventions as AppHistory) ───────────────────────

const ACCENT = '#6366f1';
const GOOD = '#22c55e';
const BAD = '#ef4444';

function fmtDate(iso: string | null) {
  // SQLite hands back "YYYY-MM-DD HH:MM:SS" with no zone, which `new Date()`
  // reads as LOCAL time — so a run recorded just after midnight UTC showed on
  // the previous day for anyone west of it. parseServerTime treats it as UTC.
  const d = parseServerTime(iso);
  if (!d) return '—';
  return d.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
}

function fmtDay(iso: string) {
  const d = new Date(`${iso}T00:00:00`);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

function fmtNum(n: number | null | undefined) {
  if (n === null || n === undefined) return '—';
  return Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/\.?0+$/, '');
}

function statusBadge(status: string) {
  if (status === 'completed') return { label: 'Completed', cls: 'badge-green' };
  if (status === 'abandoned') return { label: 'Abandoned', cls: 'badge-red' };
  if (status === 'in_progress') return { label: 'Running now', cls: 'badge-blue' };
  return { label: status, cls: 'badge-gray' };
}

function ChartTip({ active, payload, label, format }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-white border border-gray-200 rounded-lg shadow-lg px-3 py-2 text-xs">
      <div className="font-medium text-gray-700 mb-0.5">{label}</div>
      <div className="text-gray-900 font-semibold tabular-nums">{format ? format(payload[0].value) : payload[0].value}</div>
    </div>
  );
}

const DAY_PRESETS = [7, 30, 90, 365];
const REFRESH_MS = 60_000;

// ── Page ──────────────────────────────────────────────────────────────────────

export default function AppAnalytics() {
  const { id: appId } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { addToast } = useToast();
  const { user } = useAuth();
  // Leave the floating training coach a lane instead of covering a chart.
  const coachDocked = useCoachDocked();

  // Openable at a slice: the Apps Dashboard hands this page the filters the
  // supervisor was already looking at, so "Full analytics" continues the view
  // instead of resetting it. Same parameter names the API takes.
  const [searchParams] = useSearchParams();
  const [days, setDays] = useState(() => {
    const parsed = parseInt(searchParams.get('days') ?? '', 10);
    return DAY_PRESETS.includes(parsed) ? parsed : 30;
  });
  const [operator, setOperator] = useState(() => searchParams.get('operator') ?? '');
  const [workOrderId, setWorkOrderId] = useState(() => searchParams.get('work_order_id') ?? '');
  const [productTypeId, setProductTypeId] = useState(() => searchParams.get('product_type_id') ?? '');

  const [data, setData] = useState<AppAnalyticsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [taktTotalS, setTaktTotalS] = useState(0);
  const [exportingApp, setExportingApp] = useState(false);
  const [exportingAll, setExportingAll] = useState(false);

  const filterParams: AppAnalyticsParams = useMemo(() => ({
    days,
    operator: operator || undefined,
    work_order_id: workOrderId || undefined,
    product_type_id: productTypeId || undefined,
  }), [days, operator, workOrderId, productTypeId]);

  // The window this page reads is live: it polls on a timer and stamps the
  // header with when the numbers on screen were actually read. `filterParams`
  // is part of the callback's identity, so moving a filter refetches at once
  // rather than waiting out the interval.
  const load = useCallback(async () => {
    if (!appId) return;
    try {
      const res = await api.getAppAnalytics(appId, filterParams);
      setData(res);
      setError(null);
    } catch (e: any) {
      setError(e.message ?? 'Failed to load analytics');
      throw e; // let useAutoRefresh keep the freshness stamp honestly stale
    } finally {
      setLoading(false);
    }
  }, [appId, filterParams]);

  const { lastRefreshed, refreshing, refresh } = useAutoRefresh(load, REFRESH_MS);

  // Live runs report how long they have been open, so the clock has to move
  // between polls or an in-progress row reads as frozen.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(tick);
  }, []);

  // Looking at what a run captured is the last milestone of the builder-first
  // training — and it is only true once there is something here to look at.
  useEffect(() => {
    if ((data?.totals.runs ?? 0) > 0) markTrainingDataSeen(user?.id);
  }, [data?.totals.runs, user?.id]);

  // App takt (sum of per-step takt) for the "avg cycle vs takt" comparison.
  // stepTaktSeconds also reads the legacy `takt_time` key — apps built before
  // the v2 builder (including the demo sandbox's seeded app) store it that way,
  // and reading only `takt_time_seconds` reported a takt of zero for all of
  // them, hiding the comparison on every legacy app.
  useEffect(() => {
    if (!appId) return;
    api.getApp(appId)
      .then(app => {
        const total = (app.steps ?? []).reduce(
          (s: number, st: { takt_time_seconds?: number | null; takt_time?: number | null }) => s + stepTaktSeconds(st),
          0,
        );
        setTaktTotalS(total);
      })
      .catch(() => setTaktTotalS(0));
  }, [appId]);

  const handleExportApp = async () => {
    if (!appId || exportingApp) return;
    setExportingApp(true);
    try {
      await api.downloadAppAnalyticsCsv(appId, filterParams);
      addToast('App data CSV downloaded', 'success');
    } catch (e: any) {
      addToast(e.message || 'Export failed', 'error');
    } finally {
      setExportingApp(false);
    }
  };

  const handleExportAll = async () => {
    if (exportingAll) return;
    setExportingAll(true);
    try {
      await api.downloadAllCompanyData();
      addToast('Full company data export downloaded', 'success');
    } catch (e: any) {
      addToast(e.message || 'Export failed', 'error');
    } finally {
      setExportingAll(false);
    }
  };

  const hasFilters = !!(operator || workOrderId || productTypeId);

  if (loading && !data) {
    return (
      <div className="min-h-screen bg-[#f8fafc] p-4 sm:p-6 space-y-5">
        <div className="h-8 w-64 rounded animate-pulse bg-gray-100" />
        <div className="card h-14 animate-pulse bg-gray-100" />
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map(i => <div key={i} className="card h-24 animate-pulse bg-gray-100" />)}
        </div>
        <div className="card h-72 animate-pulse bg-gray-100" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="min-h-screen bg-[#f8fafc] p-4 sm:p-6">
        <div className="card p-10 max-w-lg mx-auto mt-10">
          <EmptyState
            icon={XCircle}
            title="Couldn't open this app's analytics"
            description={error || 'The app may have been deleted, or it belongs to another company.'}
            action={<button onClick={() => navigate(-1)} className="btn-secondary"><ArrowLeft size={14} /> Go back</button>}
          />
        </div>
      </div>
    );
  }

  const { totals, series, fields, filter_options: opts, recent_runs: recent } = data;
  // The API measures a cycle as wall clock between start and finish, so a run
  // opened and closed inside one second averages out to 0. Zero is not a cycle
  // time — it is the shape of "nobody timed it", which is what Run History says
  // in SQL and prints as "—". measuredSeconds makes this page agree.
  const avgCycle = measuredSeconds(totals.avg_duration_s);
  const takt = measuredSeconds(taktTotalS);
  const avgVsTakt = takt !== null && avgCycle !== null ? avgCycle - takt : null;

  const seriesData = series.map(s => ({ ...s, day: fmtDay(s.date), avg_duration_s: measuredSeconds(s.avg_duration_s) }));
  const durationData = seriesData.filter(s => s.avg_duration_s !== null);
  const runningNow = recent.filter(r => r.status === 'in_progress');
  // Axis ticks land on durations a person reads at a glance rather than on
  // recharts' arithmetically-even "1m 5s, 2m 10s, 3m 15s".
  const cycleTicks = durationTicks(Math.max(0, ...durationData.map(d => d.avg_duration_s ?? 0)));
  // What went wrong in this slice: every pass/fail widget's failures, plus the
  // runs nobody finished. Both are counted by the server; nothing is inferred.
  const failedChecks = fields
    .filter(f => f.kind === 'boolean' && (f.stats.fail ?? 0) > 0)
    .map(f => ({ label: f.label, fail: f.stats.fail ?? 0, of: (f.stats.pass ?? 0) + (f.stats.fail ?? 0) }))
    .sort((a, b) => b.fail - a.fail);

  return (
    <div className={`min-h-screen bg-[#f8fafc] p-4 sm:p-6 space-y-5 transition-[padding] ${coachDocked ? 'lg:pr-[392px]' : ''}`}>
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate(-1)}
            className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800 transition-colors"
          >
            <ArrowLeft size={16} /> Back
          </button>
          <div className="w-px h-5 bg-gray-200" />
          <div>
            <h1 className="text-xl font-bold text-gray-900">{data.app_name}</h1>
            <p className="text-gray-500 text-xs mt-0.5">
              App analytics · last {data.days} days
              {runningNow.length > 0 && (
                <span className="text-blue-600 font-medium"> · {runningNow.length} running now</span>
              )}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <LastRefreshed at={lastRefreshed} refreshing={refreshing} onRefresh={() => void refresh()} />
          <Link to={`/apps/${appId}`} className="btn-secondary">
            <Info size={14} /> App details
          </Link>
          <Link to={`/apps/${appId}/history`} className="btn-secondary">
            <History size={14} /> History
          </Link>
          <button onClick={handleExportApp} disabled={exportingApp} className="btn-secondary disabled:opacity-50">
            {exportingApp ? <RefreshCw size={14} className="animate-spin" /> : <Download size={14} />}
            Export this app's data (CSV)
          </button>
          <button onClick={handleExportAll} disabled={exportingAll} className="btn-secondary disabled:opacity-50">
            {exportingAll ? <RefreshCw size={14} className="animate-spin" /> : <Database size={14} />}
            Export ALL company data
          </button>
          <Link to={`/play/${appId}`} className="btn-primary">
            <Play size={14} /> Run App
          </Link>
        </div>
      </div>

      {/* Filter bar */}
      <div className="card px-4 py-3 flex items-center gap-3 flex-wrap">
        <span className="flex items-center gap-1.5 text-xs font-medium text-gray-500 uppercase tracking-wide">
          <SlidersHorizontal size={13} /> Filters
        </span>
        <div className="flex rounded-lg border border-gray-200 overflow-hidden">
          {DAY_PRESETS.map(d => (
            <button
              key={d}
              onClick={() => setDays(d)}
              className={`px-3 py-1.5 text-xs font-medium transition-colors ${
                days === d ? 'bg-indigo-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'
              }`}
            >
              {d}d
            </button>
          ))}
        </div>
        <select value={operator} onChange={e => setOperator(e.target.value)}
          className="text-xs border border-gray-200 rounded-lg px-2.5 py-1.5 bg-white text-gray-700 max-w-[160px]">
          <option value="">All operators</option>
          {opts.operators.map(o => <option key={o} value={o}>{o}</option>)}
        </select>
        <select value={productTypeId} onChange={e => setProductTypeId(e.target.value)}
          className="text-xs border border-gray-200 rounded-lg px-2.5 py-1.5 bg-white text-gray-700 max-w-[160px]">
          <option value="">All product types</option>
          {opts.product_types.map(pt => <option key={pt.id} value={pt.id}>{pt.name}</option>)}
        </select>
        <select value={workOrderId} onChange={e => setWorkOrderId(e.target.value)}
          className="text-xs border border-gray-200 rounded-lg px-2.5 py-1.5 bg-white text-gray-700 max-w-[160px]">
          <option value="">All work orders</option>
          {opts.work_orders.map(wo => <option key={wo.id} value={wo.id}>{wo.work_order_number}</option>)}
        </select>
        {hasFilters && (
          <button
            onClick={() => { setOperator(''); setWorkOrderId(''); setProductTypeId(''); }}
            className="text-xs text-indigo-600 hover:text-indigo-800 font-medium"
          >
            Clear filters
          </button>
        )}
        {refreshing && <RefreshCw size={13} className="animate-spin text-gray-400 ml-auto" />}
      </div>

      {totals.runs === 0 ? (
        <div className="card">
          {hasFilters ? (
            <EmptyState
              icon={SlidersHorizontal}
              title="No runs match these filters"
              description={`Nothing in the last ${data.days} days matched the operator, product type or work order you picked.`}
              action={
                <button
                  onClick={() => { setOperator(''); setWorkOrderId(''); setProductTypeId(''); }}
                  className="btn-secondary"
                >
                  Show all runs
                </button>
              }
            />
          ) : (
            <EmptyState
              icon={Activity}
              title={`No runs of "${data.app_name}" in the last ${data.days} days`}
              description="Nothing has been measured in this window — not a zero, just nothing recorded. Widen the window, or run the app on the floor and watch this page fill in."
              action={
                <div className="flex items-center gap-2 flex-wrap justify-center">
                  {days < 365 && (
                    <button onClick={() => setDays(365)} className="btn-secondary">Look back a year</button>
                  )}
                  <Link to={`/play/${appId}`} className="btn-primary"><Play size={14} /> Run app</Link>
                </div>
              }
            />
          )}
        </div>
      ) : (
        <>
          {/* ── 1. How long does this job take, in this slice? ─────────────
              Time leads; the counts that give it context follow it. */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <KPI icon={<Clock size={18} className="text-purple-600" />} bg="bg-purple-50"
              label="Avg cycle time"
              value={avgCycle === null ? '—' : fmtDuration(avgCycle)}
              valueColor={avgCycle === null ? 'text-gray-400' : undefined}
              sub={avgCycle === null
                ? (totals.completed === 0 ? 'no run has finished in this window' : 'no finished run was timed')
                : avgVsTakt !== null
                  ? `${avgVsTakt > 0 ? '+' : '−'}${fmtDuration(Math.abs(avgVsTakt))} vs takt ${fmtDuration(takt)}`
                  : 'no takt set on this app'}
              subColor={avgCycle !== null && avgVsTakt !== null ? (avgVsTakt > 0 ? 'text-red-600' : 'text-green-600') : undefined} />
            <KPI
              icon={<TrendingUp size={18} className={yieldColor(totals.first_pass_yield)} />}
              bg={yieldBg(totals.first_pass_yield)}
              label="First-pass yield"
              value={totals.first_pass_yield === null ? '—' : `${totals.first_pass_yield.toFixed(0)}%`}
              valueColor={yieldColor(totals.first_pass_yield)}
              sub={totals.first_pass_yield === null ? 'no pass/fail check recorded' : 'runs whose checks all passed'} />
            <KPI icon={<CheckCircle2 size={18} className="text-green-600" />} bg="bg-green-50"
              label="Completed" value={totals.completed}
              sub={`${Math.round((totals.completed / totals.runs) * 100)}% of runs started`} />
            <KPI icon={<Activity size={18} className="text-blue-600" />} bg="bg-blue-50"
              label="Runs started" value={totals.runs}
              sub={totals.abandoned > 0 ? `${totals.abandoned} abandoned` : 'none abandoned'}
              subColor={totals.abandoned > 0 ? 'text-red-600' : undefined} />
          </div>

          {/* ── Live: what is on the bench right now ────────────────────────── */}
          {runningNow.length > 0 && (
            <section className="card border-blue-100 bg-blue-50/40 p-4">
              <div className="flex items-center gap-2 mb-3 flex-wrap">
                <span className="w-2 h-2 rounded-full bg-blue-500 live-pulse" aria-hidden="true" />
                <h2 className="font-semibold text-gray-900 text-sm">On the bench right now</h2>
                <span className="text-xs text-gray-500">{pluralize(runningNow.length, 'run')} in progress</span>
              </div>
              <ul className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-2">
                {runningNow.map(r => (
                  <li key={r.id}>
                    <Link
                      to={`/completions/${r.id}`}
                      className="flex items-center gap-3 rounded-xl bg-white border border-blue-100 px-3 py-2 hover:border-blue-200 transition-colors"
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block text-[13px] font-medium text-gray-900 truncate">
                          {r.operator_name || 'Unknown operator'}
                        </span>
                        <span className="block text-[11px] text-gray-400 truncate">
                          {r.work_order_number ? `${r.work_order_number} · ` : ''}
                          started {fmtRelative(r.started_at).toLowerCase()}
                        </span>
                      </span>
                      <span className="text-sm font-bold text-blue-600 tabular-nums flex-shrink-0">
                        {fmtDuration(elapsedSeconds(r.started_at, now))}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {/* ── 2. Is it getting faster or slower? ─────────────────────────── */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 items-start">
            <div className="card p-5">
              <div className="flex items-center gap-2 mb-1">
                <Clock size={16} className="text-gray-400" />
                <h2 className="font-semibold text-gray-900">Cycle time by day</h2>
              </div>
              <p className="text-[11px] text-gray-400 mb-3">Start to finish, averaged over the runs that finished each day.</p>
              {durationData.length === 0 ? (
                <EmptyState
                  compact
                  icon={Clock}
                  title="No timed run in this window"
                  description="A day only appears here once a run has both started and finished on it — those times are missing, not zero."
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
            </div>

            <div className="card p-5">
              <div className="flex items-center gap-2 mb-1">
                <BarChart2 size={16} className="text-gray-400" />
                <h2 className="font-semibold text-gray-900">Completions per day</h2>
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
            </div>
          </div>

          {/* Which step is the bottleneck lives on Run History, where the
              per-step averages come from — the analytics endpoint has no
              per-step figures to slice, and inventing them here would put two
              different answers to one question on two screens. */}
          <div className="card px-5 py-3 flex items-center gap-3 flex-wrap">
            <BarChart2 size={15} className="text-gray-400 flex-shrink-0" />
            <span className="text-xs text-gray-600">
              Looking for which step is the bottleneck? Per-step averages against takt live on Run history.
            </span>
            <Link
              to={`/apps/${appId}/history`}
              className="ml-auto text-xs font-medium text-indigo-600 hover:text-indigo-800 flex items-center gap-0.5"
            >
              Where the time goes <ChevronRight size={12} />
            </Link>
          </div>

          {/* ── 3. Who runs it well? ───────────────────────────────────────── */}
          <div className="card p-5">
            <div className="flex items-center gap-2 mb-1">
              <User size={16} className="text-gray-400" />
              <h2 className="font-semibold text-gray-900">Who runs it</h2>
            </div>
            <p className="text-[11px] text-gray-400 mb-4">
              Runs each person started in this window, with their own average cycle beside it.
            </p>
            {data.by_operator.length === 0 ? (
              <EmptyState compact icon={User} title="No operator recorded on these runs" />
            ) : (
              <BarList
                rows={data.by_operator.map(o => ({
                  label: o.operator_name || 'Unknown',
                  count: o.runs,
                  // An operator whose runs were never timed has no average —
                  // "avg 0s" would read as the fastest person on the floor.
                  extra: measuredSeconds(o.avg_duration_s) === null
                    ? '— avg'
                    : `avg ${fmtDuration(measuredSeconds(o.avg_duration_s))}`,
                }))}
              />
            )}
          </div>

          {/* ── 4. What went wrong? ────────────────────────────────────────── */}
          <div className="card p-5">
            <div className="flex items-center gap-2 mb-1">
              <XCircle size={16} className="text-gray-400" />
              <h2 className="font-semibold text-gray-900">What went wrong</h2>
            </div>
            <p className="text-[11px] text-gray-400 mb-4">Failed checks and runs nobody finished, in this window.</p>
            {failedChecks.length === 0 && totals.abandoned === 0 ? (
              <p className="text-sm text-gray-500 flex items-center gap-2">
                <CheckCircle2 size={15} className="text-green-600 flex-shrink-0" />
                {fields.some(f => f.kind === 'boolean')
                  ? `Every check passed and every run finished across ${pluralize(totals.runs, 'run')}.`
                  : `Every run finished. This app records no pass/fail check, so there is no yield to report.`}
              </p>
            ) : (
              <ul className="space-y-2">
                {failedChecks.map(f => (
                  <li key={f.label} className="flex items-center gap-3 rounded-xl border border-red-100 bg-red-50/50 px-3 py-2">
                    <XCircle size={14} className="text-red-500 flex-shrink-0" />
                    <span className="text-[13px] text-gray-900 min-w-0 flex-1 truncate" title={f.label}>{f.label}</span>
                    <span className="text-xs font-semibold text-red-600 tabular-nums flex-shrink-0">
                      {f.fail} failed of {f.of}
                    </span>
                  </li>
                ))}
                {totals.abandoned > 0 && (
                  <li className="flex items-center gap-3 rounded-xl border border-amber-100 bg-amber-50/50 px-3 py-2">
                    <Activity size={14} className="text-amber-500 flex-shrink-0" />
                    <span className="text-[13px] text-gray-900 min-w-0 flex-1">Runs nobody finished</span>
                    <span className="text-xs font-semibold text-amber-700 tabular-nums flex-shrink-0">
                      {totals.abandoned} abandoned
                    </span>
                  </li>
                )}
              </ul>
            )}
          </div>

          {/* ── 5. What operators entered ──────────────────────────────────── */}
          {fields.length > 0 && (
            <div>
              <div className="flex items-center gap-2 mb-1">
                <ListChecks size={16} className="text-gray-400" />
                <h2 className="font-semibold text-gray-900">What operators entered</h2>
                <span className="text-xs text-gray-400">({fields.length})</span>
              </div>
              <p className="text-[11px] text-gray-400 mb-3">
                Every capture widget on this app, summarised across the completed runs in this window.
              </p>
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                {fields.map(f => <FieldCard key={f.widget_id} field={f} />)}
              </div>
            </div>
          )}

          {/* ── 6. The runs themselves ─────────────────────────────────────── */}
          <div className="card overflow-hidden">
            <div className="flex items-center gap-2 px-5 py-4 border-b border-gray-100 flex-wrap">
              <Calendar size={15} className="text-gray-400" />
              <h2 className="font-semibold text-gray-900">Recent runs</h2>
              <span className="text-xs text-gray-400">
                latest {recent.length} of {pluralize(totals.runs, 'run')} in this window
              </span>
              <Link to={`/apps/${appId}/history`} className="ml-auto text-xs text-indigo-600 hover:text-indigo-800 font-medium flex items-center gap-0.5">
                Filter and sort every run <ChevronRight size={12} />
              </Link>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[46rem]">
                <thead className="bg-gray-50 border-b border-gray-100">
                  <tr>
                    {['Started', 'Operator', 'Duration', 'Work order', 'Product type', 'Status', ''].map(h => (
                      <th key={h} className="text-left text-[11px] font-semibold text-gray-500 uppercase tracking-wide px-4 py-3">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {recent.map(r => {
                    const badge = statusBadge(r.status);
                    const live = r.status === 'in_progress';
                    const duration = measuredSeconds(r.duration_s);
                    return (
                      <tr key={r.id}
                        className={`transition-colors cursor-pointer ${live ? 'bg-blue-50/40 hover:bg-blue-50/70' : 'hover:bg-gray-50'}`}
                        onClick={() => navigate(`/completions/${r.id}`)}>
                        <td className="px-4 py-3 text-xs text-gray-600 whitespace-nowrap">{fmtDate(r.started_at)}</td>
                        <td className="px-4 py-3 text-xs text-gray-700">
                          <div className="flex items-center gap-1.5">
                            <User size={11} className="text-gray-400 flex-shrink-0" />
                            {r.operator_name || <span className="text-gray-400">—</span>}
                          </div>
                        </td>
                        <td className="px-4 py-3 text-xs font-medium tabular-nums whitespace-nowrap">
                          {/* A run still on the bench has no duration to report —
                              it has an elapsed time, which is a different thing. */}
                          {live ? (
                            <span className="text-blue-600 font-semibold">
                              {fmtDuration(elapsedSeconds(r.started_at, now))}
                              <span className="text-[10px] font-normal text-blue-500"> and counting</span>
                            </span>
                          ) : duration === null ? (
                            <span className="text-gray-400" title="this run was never timed">—</span>
                          ) : (
                            <span className="text-gray-900">{fmtDuration(duration)}</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-xs text-gray-600">
                          {r.work_order_number ? (
                            <span className="flex items-center gap-1 text-indigo-600"><Package size={11} /> {r.work_order_number}</span>
                          ) : <span className="text-gray-400">—</span>}
                        </td>
                        <td className="px-4 py-3 text-xs text-gray-600">{r.product_type_name || <span className="text-gray-400">—</span>}</td>
                        <td className="px-4 py-3">
                          <span className={badge.cls}>
                            {live && <span className="w-1.5 h-1.5 rounded-full bg-blue-500 live-pulse" aria-hidden="true" />}
                            {badge.label}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <span className="text-xs text-indigo-600 flex items-center justify-end gap-0.5">
                            View <ChevronRight size={12} />
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// ── Pieces ────────────────────────────────────────────────────────────────────

function yieldColor(y: number | null) {
  if (y === null) return 'text-gray-400';
  return y >= 95 ? 'text-green-600' : y >= 80 ? 'text-amber-600' : 'text-red-600';
}
function yieldBg(y: number | null) {
  if (y === null) return 'bg-gray-50';
  return y >= 95 ? 'bg-green-50' : y >= 80 ? 'bg-amber-50' : 'bg-red-50';
}

function KPI({ icon, bg, label, value, sub, valueColor, subColor }: {
  icon: React.ReactNode; bg: string; label: string; value: string | number;
  sub?: string; valueColor?: string; subColor?: string;
}) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4 flex items-center gap-3">
      <div className={`w-10 h-10 ${bg} rounded-lg flex items-center justify-center flex-shrink-0`}>{icon}</div>
      <div className="min-w-0">
        <div className={`text-xl font-bold tabular-nums ${valueColor ?? 'text-gray-900'}`}>{value}</div>
        <div className="text-xs text-gray-500">{label}</div>
        {/* The sub-line carries the comparison the number only means something
            against ("+31s vs takt 6m 5s"). Truncated on a phone it read
            "+31s vs tak…" — the baseline gone. It wraps instead. */}
        {sub && <div className={`text-[11px] mt-0.5 ${subColor ?? 'text-gray-400'}`}>{sub}</div>}
      </div>
    </div>
  );
}

/** Horizontal proportional bar list — used for operators and option distributions. */
function BarList({ rows }: { rows: { label: string; count: number; extra?: string }[] }) {
  const max = Math.max(1, ...rows.map(r => r.count));
  return (
    <div className="space-y-2">
      {rows.map(r => (
        <div key={r.label} className="flex items-center gap-3">
          <span className="text-xs text-gray-700 w-32 truncate flex-shrink-0" title={r.label}>{r.label}</span>
          <div className="flex-1 h-4 bg-gray-100 rounded overflow-hidden">
            <div className="h-full rounded" style={{ width: `${(r.count / max) * 100}%`, background: ACCENT }} />
          </div>
          <span className="text-xs font-semibold text-gray-900 tabular-nums w-8 text-right">{r.count}</span>
          {r.extra && <span className="text-[11px] text-gray-400 w-20 truncate">{r.extra}</span>}
        </div>
      ))}
    </div>
  );
}

const KIND_META: Record<string, { icon: React.ElementType; label: string }> = {
  number: { icon: Hash, label: 'Number' },
  boolean: { icon: CheckCircle2, label: 'Pass / Fail' },
  option: { icon: ListChecks, label: 'Options' },
  text: { icon: Type, label: 'Text' },
};

function FieldCard({ field }: { field: AppAnalyticsField }) {
  const meta = KIND_META[field.kind] ?? KIND_META.text;
  const Icon = meta.icon;
  return (
    <div className="card p-4">
      <div className="flex items-start justify-between gap-2 mb-3">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-gray-900 truncate" title={field.label}>{field.label}</h3>
          {field.step_name && <p className="text-[11px] text-gray-400 truncate">{field.step_name}</p>}
        </div>
        <span className="flex items-center gap-1 text-[11px] text-gray-500 bg-gray-50 border border-gray-100 rounded-full px-2 py-0.5 flex-shrink-0">
          <Icon size={11} /> {meta.label}
        </span>
      </div>
      {field.kind === 'number' && <NumberField field={field} />}
      {field.kind === 'boolean' && <BooleanField field={field} />}
      {field.kind === 'option' && <OptionField field={field} />}
      {field.kind === 'text' && (
        <p className="text-sm text-gray-500 py-4">
          <span className="text-xl font-bold text-gray-900 tabular-nums mr-1.5">{field.stats.count ?? 0}</span>
          entries captured
        </p>
      )}
    </div>
  );
}

function NumberField({ field }: { field: AppAnalyticsField }) {
  const { stats, trend = [] } = field;
  const trendData = trend.map(t => ({ ...t, day: fmtDay(t.date) }));
  return (
    <div>
      <div className="grid grid-cols-4 gap-2 mb-3">
        {[
          ['Avg', fmtNum(stats.avg)], ['Min', fmtNum(stats.min)],
          ['Max', fmtNum(stats.max)], ['Count', String(stats.count ?? 0)],
        ].map(([l, v]) => (
          <div key={l} className="bg-gray-50 rounded-lg px-2 py-1.5 text-center">
            <div className="text-sm font-bold text-gray-900 tabular-nums">{v}</div>
            <div className="text-[10px] text-gray-400 uppercase tracking-wide">{l}</div>
          </div>
        ))}
      </div>
      {trendData.length > 1 ? (
        <ResponsiveContainer width="100%" height={120}>
          <LineChart data={trendData} margin={{ left: 0, right: 8, top: 4, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--grid-line)" />
            <XAxis dataKey="day" tick={{ fontSize: 9, fill: 'var(--muted)' }} minTickGap={14} />
            {/* Auto ticks on a tight range come out as 15.015 / 14.945, which a
                36px gutter clipped to "5.015" — a number the app never recorded.
                Round the labels and give them room. */}
            <YAxis
              tick={{ fontSize: 10, fill: 'var(--muted)' }}
              width={46}
              tickCount={4}
              tickFormatter={(v: number) => fmtNum(v)}
              domain={['auto', 'auto']}
            />
            <Tooltip content={<ChartTip format={(v: number) => fmtNum(v)} />} />
            <Line type="monotone" dataKey="avg" stroke={ACCENT} strokeWidth={2}
              dot={{ r: 2.5, fill: ACCENT }} activeDot={{ r: 4 }} />
          </LineChart>
        </ResponsiveContainer>
      ) : (
        <p className="text-[11px] text-gray-400 text-center py-2">Daily trend appears with data on more days</p>
      )}
    </div>
  );
}

function BooleanField({ field }: { field: AppAnalyticsField }) {
  const pass = field.stats.pass ?? 0;
  const fail = field.stats.fail ?? 0;
  const yieldPct = field.stats.yield_pct;
  const pie = [
    { name: 'Pass', value: pass, color: GOOD },
    { name: 'Fail', value: fail, color: BAD },
  ].filter(s => s.value > 0);
  return (
    <div className="flex items-center gap-4">
      <div className="relative w-[120px] h-[120px] flex-shrink-0">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie data={pie} cx="50%" cy="50%" innerRadius={38} outerRadius={54}
              paddingAngle={pie.length > 1 ? 3 : 0} dataKey="value" stroke="#fff" strokeWidth={2}>
              {pie.map(s => <Cell key={s.name} fill={s.color} />)}
            </Pie>
          </PieChart>
        </ResponsiveContainer>
        <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
          <span className={`text-lg font-bold tabular-nums ${yieldColor(yieldPct ?? null)}`}>
            {yieldPct === null || yieldPct === undefined ? '—' : `${yieldPct.toFixed(0)}%`}
          </span>
          <span className="text-[9px] text-gray-400 uppercase tracking-wide">yield</span>
        </div>
      </div>
      <div className="space-y-2 text-xs">
        <div className="flex items-center gap-1.5 text-gray-700">
          <CheckCircle2 size={13} className="text-green-600" />
          Pass <span className="font-semibold text-gray-900 tabular-nums">{pass}</span>
        </div>
        <div className="flex items-center gap-1.5 text-gray-700">
          <XCircle size={13} className="text-red-600" />
          Fail <span className="font-semibold text-gray-900 tabular-nums">{fail}</span>
        </div>
        <div className="text-gray-400">{pass + fail} checks</div>
      </div>
    </div>
  );
}

function OptionField({ field }: { field: AppAnalyticsField }) {
  const options = field.stats.options ?? [];
  return (
    <div>
      <BarList rows={options.slice(0, 8).map(o => ({ label: o.value, count: o.count }))} />
      {options.length > 8 && (
        <p className="text-[11px] text-gray-400 mt-2">+{options.length - 8} more values</p>
      )}
      <p className="text-[11px] text-gray-400 mt-2">{field.stats.count ?? 0} selections</p>
    </div>
  );
}

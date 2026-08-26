// Apps → one app → Run history. The record of everything this app has ever
// done, arranged in the order a supervisor asks about it:
//
//   1. How long does this job actually take?
//   2. Is it getting faster or slower?
//   3. Which step is the bottleneck?
//   4. What went wrong recently?
//   5. …and then every run, filterable and sortable, one click from its detail.
//
// "Who runs it well" is deliberately NOT duplicated here — the Analytics page
// owns the per-operator breakdown, and the header links straight to it.
//
// Runs load a page at a time and stack up, so the filters and the sort always
// describe exactly the rows on screen; the header says how many of the total
// those are, because a filter that quietly searches a quarter of the data is
// worse than no filter at all.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { api } from '../api/client';
import {
  ArrowLeft, Play, CheckCircle2, XCircle, Clock, User, TrendingUp, TrendingDown,
  ChevronDown, ChevronUp, BarChart2, Activity, Calendar, Package, Info,
  AlertTriangle, Gauge, History, Search, SlidersHorizontal, Minus, Loader2,
} from 'lucide-react';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  CartesianGrid, LineChart, Line, ReferenceLine, Cell,
} from 'recharts';
// One duration formatter for the whole app: seconds / minutes / hours, and "—"
// for null. A second local copy is how this page ended up printing "0m" for a
// twelve-second run while the App Dashboard printed "12s".
import { type DurationBasis,
  durationTicks, elapsedSeconds, fmtDateTime, fmtDuration, fmtRelative, measuredSeconds, pluralize, durationBasisLabel, durationBasisNote } from '../components/apps/appModel';
import useAutoRefresh from '../hooks/useAutoRefresh';
import LastRefreshed from '../components/shared/LastRefreshed';
import EmptyState from '../components/shared/EmptyState';

// ── Types ─────────────────────────────────────────────────────────────────────

// Anything the API cannot measure arrives as null, never 0 — a step nobody
// timed, a takt nobody configured, a run still in progress. The page renders
// those as "—" with the reason, because a fabricated zero reads as a
// measurement (and, for a pass rate, as an alarming red one).
interface StepAverage {
  step_id: string;
  step_name: string;
  step_order: number;
  avg_duration_seconds: number | null;
  takt_seconds: number | null;
  completion_count: number;
}

interface HistoryCompletion {
  id: string;
  operator_name: string;
  started_at: string | null;
  completed_at: string | null;
  total_duration_seconds: number | null;
  status: 'completed' | 'abandoned' | 'in_progress';
  work_order_number: string | null;
  pass_fail: 'pass' | 'fail' | null;
}

interface AppHistoryData {
  app_id: string;
  app_name: string;
  total_runs: number;
  avg_duration: number | null;
  /** Which measurement avg_duration is — hands-on, wall clock, or a mix. */
  avg_duration_basis?: DurationBasis;
  best_time: number | null;
  pass_rate: number | null;
  qc_sample_size?: number;
  step_averages: StepAverage[];
  completions: HistoryCompletion[];
  total: number;
}

type StatusFilter = 'all' | 'completed' | 'in_progress' | 'abandoned';
type ResultFilter = 'all' | 'pass' | 'fail' | 'unchecked';
type SortKey = 'date' | 'duration' | 'operator' | 'result';

const PAGE_SIZE = 50;
const REFRESH_MS = 30_000;

function fmtDateShort(iso: string | null) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

/** Bar colour for a step average against its own takt. Indigo means the step
 *  has no takt to be judged against, not that it did badly. */
function stepBarColor(avg: number | null, takt: number | null) {
  if (!takt || takt <= 0 || avg === null) return '#6366f1';
  const ratio = avg / takt;
  if (ratio <= 1) return '#22c55e';
  if (ratio <= 1.10) return '#f59e0b';
  return '#ef4444';
}

function statusBadge(status: string) {
  if (status === 'completed') return { label: 'Completed', cls: 'badge-green' };
  if (status === 'abandoned') return { label: 'Abandoned', cls: 'badge-red' };
  if (status === 'in_progress') return { label: 'Running now', cls: 'badge-blue' };
  return { label: status, cls: 'badge-gray' };
}

function StepAvgTooltip({ active, payload }: any) {
  if (!active || !payload?.length) return null;
  const d: StepAverage = payload[0].payload;
  const ratio = d.takt_seconds && d.takt_seconds > 0 && d.avg_duration_seconds !== null
    ? d.avg_duration_seconds / d.takt_seconds : 0;
  const overUnder = ratio > 1
    ? `${((ratio - 1) * 100).toFixed(0)}% over takt`
    : ratio > 0 ? `${((1 - ratio) * 100).toFixed(0)}% under takt` : '';
  return (
    <div className="bg-white border border-gray-200 rounded-lg shadow-lg p-3 text-xs min-w-[11rem]">
      <div className="font-semibold text-gray-900 mb-1.5 truncate">{d.step_name}</div>
      <div className="space-y-1 text-gray-600">
        <div className="flex justify-between gap-4"><span>Avg</span><span className="font-medium text-gray-900">{fmtDuration(d.avg_duration_seconds)}</span></div>
        <div className="flex justify-between gap-4"><span>Takt</span><span className="font-medium text-gray-900">{fmtDuration(d.takt_seconds)}</span></div>
        <div className="flex justify-between gap-4"><span>Runs</span><span className="font-medium text-gray-900">{d.completion_count}</span></div>
        {overUnder && <div className={`font-semibold ${ratio > 1 ? 'text-red-600' : 'text-green-600'}`}>{overUnder}</div>}
      </div>
    </div>
  );
}

function TrendTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-white border border-gray-200 rounded-lg shadow-lg p-3 text-xs">
      <div className="font-medium text-gray-700 mb-1">{label}</div>
      <div className="text-gray-900 font-semibold">{fmtDuration(payload[0].value)}</div>
    </div>
  );
}

export default function AppHistory() {
  const { id: appId } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [data, setData] = useState<AppHistoryData | null>(null);
  const [runs, setRuns] = useState<HistoryCompletion[]>([]);
  const [pagesLoaded, setPagesLoaded] = useState(1);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [total, setTotal] = useState(0);

  const [status, setStatus] = useState<StatusFilter>('all');
  const [result, setResult] = useState<ResultFilter>('all');
  const [operator, setOperator] = useState('');
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({ key: 'date', desc: true });

  // Live elapsed for the in-progress rows, on its own clock so they do not sit
  // frozen between polls.
  const [now, setNow] = useState(() => Date.now());

  const fetchHistory = useCallback(async () => {
    if (!appId) return;
    try {
      // Every page already loaded is re-read, so a poll refreshes the whole
      // list rather than leaving older pages stale under a fresh first page.
      const pages = await Promise.all(
        Array.from({ length: pagesLoaded }, (_, i) => api.getAppHistory(appId, i + 1, PAGE_SIZE)),
      ) as AppHistoryData[];
      const head = pages[0];
      setData(head);
      setTotal(head.total ?? head.completions?.length ?? 0);
      // De-duplicate on id: a run finishing between two page reads shifts rows
      // across the page boundary and would otherwise appear twice.
      const seen = new Set<string>();
      const merged: HistoryCompletion[] = [];
      for (const page of pages) {
        for (const c of page.completions ?? []) {
          if (seen.has(c.id)) continue;
          seen.add(c.id);
          merged.push(c);
        }
      }
      setRuns(merged);
      setError(null);
    } catch (e: any) {
      setError(e.message ?? 'Failed to load history');
      throw e; // let useAutoRefresh keep the freshness stamp honestly stale
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, [appId, pagesLoaded]);

  const { lastRefreshed, refreshing, refresh } = useAutoRefresh(fetchHistory, REFRESH_MS);

  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(tick);
  }, []);

  const loadMore = () => {
    setLoadingMore(true);
    setPagesLoaded(p => p + 1);
  };

  // ── Derived ────────────────────────────────────────────────────────────────

  const steps = useMemo(() => data?.step_averages ?? [], [data]);
  const loadedCount = runs.length;
  const running = useMemo(() => runs.filter(r => r.status === 'in_progress'), [runs]);

  const operators = useMemo(
    () => Array.from(new Set(runs.map(r => r.operator_name).filter(Boolean))).sort(),
    [runs],
  );

  // Newest-first timed completions drive both the trend chart and the
  // faster/slower readout, so the two can never disagree.
  const timedRuns = useMemo(
    () => runs
      .filter(r => r.status === 'completed' && measuredSeconds(r.total_duration_seconds) !== null)
      .slice()
      .sort((a, b) => String(b.completed_at ?? '').localeCompare(String(a.completed_at ?? ''))),
    [runs],
  );

  const trendData = useMemo(
    () => timedRuns
      .slice(0, 40)
      .map(c => ({ date: fmtDateShort(c.completed_at), duration: c.total_duration_seconds as number }))
      .reverse(),
    [timedRuns],
  );

  const trendTicks = useMemo(
    () => durationTicks(Math.max(0, ...trendData.map(d => d.duration))),
    [trendData],
  );

  /** Faster or slower: the most recent timed runs against the same number of
   *  timed runs before them. Null until there are enough of both to compare —
   *  a "trend" drawn from two runs is noise wearing a verdict's clothes. */
  const trend = useMemo(() => {
    const MIN_PER_SIDE = 3;
    if (timedRuns.length < MIN_PER_SIDE * 2) return null;
    const half = Math.min(Math.floor(timedRuns.length / 2), 20);
    const mean = (rows: HistoryCompletion[]) =>
      rows.reduce((s, r) => s + (r.total_duration_seconds as number), 0) / rows.length;
    const recent = mean(timedRuns.slice(0, half));
    const earlier = mean(timedRuns.slice(half, half * 2));
    return { deltaSeconds: recent - earlier, sample: half, recent, earlier };
  }, [timedRuns]);

  // Only steps somebody actually timed get a bar. A step with no runs behind it
  // would otherwise draw a confident zero-length bar next to the real ones.
  const timedSteps = useMemo(
    () => steps.filter(s => measuredSeconds(s.avg_duration_seconds) !== null),
    [steps],
  );
  const untimedStepCount = steps.length - timedSteps.length;

  // Axis ticks land on durations a person reads at a glance rather than on
  // recharts' arithmetically-even "1m 5s, 2m 10s, 3m 15s".
  const stepTicks = useMemo(
    () => durationTicks(Math.max(
      0,
      ...timedSteps.map(s => Math.max(s.avg_duration_seconds ?? 0, s.takt_seconds ?? 0)),
    )),
    [timedSteps],
  );

  const bottleneck = useMemo(() => {
    const withTakt = timedSteps.filter(s => s.takt_seconds && s.takt_seconds > 0);
    if (withTakt.length > 0) {
      const ratioOf = (s: StepAverage) => (s.avg_duration_seconds as number) / (s.takt_seconds as number);
      const worst = withTakt.reduce((a, b) => (ratioOf(b) > ratioOf(a) ? b : a));
      return ratioOf(worst) > 1 ? { step: worst, overPct: Math.round((ratioOf(worst) - 1) * 100) } : null;
    }
    if (timedSteps.length === 0) return null;
    const longest = timedSteps.reduce((a, b) =>
      ((b.avg_duration_seconds as number) > (a.avg_duration_seconds as number) ? b : a));
    return { step: longest, overPct: null as number | null };
  }, [timedSteps]);

  /** Recent trouble: a failed check, or a run nobody finished. */
  const problems = useMemo(
    () => runs.filter(r => r.pass_fail === 'fail' || r.status === 'abandoned').slice(0, 6),
    [runs],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const rows = runs.filter(r => {
      if (status !== 'all' && r.status !== status) return false;
      if (result === 'pass' && r.pass_fail !== 'pass') return false;
      if (result === 'fail' && r.pass_fail !== 'fail') return false;
      if (result === 'unchecked' && r.pass_fail !== null) return false;
      if (operator && r.operator_name !== operator) return false;
      if (q) {
        const hay = `${r.operator_name ?? ''} ${r.work_order_number ?? ''} ${r.id}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
    const dir = sort.desc ? -1 : 1;
    return rows.sort((a, b) => {
      switch (sort.key) {
        case 'duration': {
          // A run with no duration is not the fastest run ever — unknowns sink
          // to the bottom whichever way the column is pointed.
          const av = measuredSeconds(a.total_duration_seconds);
          const bv = measuredSeconds(b.total_duration_seconds);
          if (av === null && bv === null) return 0;
          if (av === null) return 1;
          if (bv === null) return -1;
          return (av - bv) * dir;
        }
        case 'operator':
          return String(a.operator_name ?? '').localeCompare(String(b.operator_name ?? '')) * dir;
        case 'result':
          return String(a.pass_fail ?? 'zz').localeCompare(String(b.pass_fail ?? 'zz')) * dir;
        default: {
          const at = a.completed_at ?? a.started_at ?? '';
          const bt = b.completed_at ?? b.started_at ?? '';
          return String(at).localeCompare(String(bt)) * dir;
        }
      }
    });
  }, [runs, status, result, operator, query, sort]);

  const filtersActive = status !== 'all' || result !== 'all' || !!operator || !!query.trim();
  const clearFilters = () => { setStatus('all'); setResult('all'); setOperator(''); setQuery(''); };

  const toggleSort = (key: SortKey) =>
    setSort(prev => (prev.key === key ? { key, desc: !prev.desc } : { key, desc: key !== 'operator' }));

  // ── States ─────────────────────────────────────────────────────────────────

  if (loading && !data) {
    return (
      <div className="min-h-screen bg-[#f8fafc] p-4 sm:p-6 space-y-5">
        <div className="h-8 w-64 rounded animate-pulse bg-gray-100" />
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
            icon={AlertTriangle}
            title="Couldn't open this history"
            description={error || 'The app may have been deleted, or it belongs to another company.'}
            action={<button onClick={() => navigate(-1)} className="btn-secondary"><ArrowLeft size={14} /> Go back</button>}
          />
        </div>
      </div>
    );
  }

  // pass_rate is null when this app records no Pass/Fail result at all — the
  // same thing /apps/:id/analytics and /apps/dashboard already say out loud.
  // Coalescing it to 0 painted a red "0%" onto an app nobody ever inspected.
  const passRate = data.pass_rate;
  const qcSample = data.qc_sample_size ?? 0;
  const passTone = passRate === null ? 'gray'
    : passRate >= 95 ? 'green' : passRate >= 80 ? 'amber' : 'red';
  const TONE = {
    gray: { icon: 'text-gray-400', bg: 'bg-gray-100', value: 'text-gray-400' },
    green: { icon: 'text-green-600', bg: 'bg-green-50', value: 'text-green-600' },
    amber: { icon: 'text-amber-600', bg: 'bg-amber-50', value: 'text-amber-600' },
    red: { icon: 'text-red-600', bg: 'bg-red-50', value: 'text-red-600' },
  } as const;
  const tone = TONE[passTone];
  const avgDuration = measuredSeconds(data.avg_duration);
  const bestTime = measuredSeconds(data.best_time);
  const neverRun = total === 0;

  return (
    <div className="min-h-screen bg-[#f8fafc] p-4 sm:p-6 space-y-5">
      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-4">
        <div className="flex items-center gap-3 min-w-0">
          <button
            onClick={() => navigate(-1)}
            className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800 transition-colors"
          >
            <ArrowLeft size={16} /> Back
          </button>
          <div className="w-px h-5 bg-gray-200" />
          <div className="min-w-0">
            <h1 className="text-xl font-bold text-gray-900 truncate">{data.app_name}</h1>
            <p className="text-gray-500 text-xs mt-0.5">
              Run history · {pluralize(total, 'run')} all time
              {running.length > 0 && (
                <span className="text-blue-600 font-medium"> · {running.length} running now</span>
              )}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <LastRefreshed at={lastRefreshed} refreshing={refreshing} onRefresh={() => void refresh()} />
          <Link to={`/apps/${appId}`} className="btn-secondary"><Info size={14} /> App details</Link>
          <Link to={`/apps/${appId}/analytics`} className="btn-secondary"><BarChart2 size={14} /> Analytics</Link>
          <Link to={`/play/${appId}`} className="btn-primary"><Play size={14} /> Run app</Link>
        </div>
      </div>

      {neverRun ? (
        <div className="card">
          <EmptyState
            icon={Play}
            title={`Nobody has run "${data.app_name}" yet`}
            description="This page fills in the first time somebody completes a run — every step time, every value they enter, and how it compares with the runs after it."
            action={<Link to={`/play/${appId}`} className="btn-primary"><Play size={14} /> Run it in the player</Link>}
          />
          {steps.length > 0 && (
            <p className="text-[11px] text-gray-400 text-center pb-8 -mt-2">
              {pluralize(steps.length, 'step')} ready to be timed
              {steps.some(s => s.takt_seconds) ? ' · takt already set' : ' · no takt set on any step yet'}
            </p>
          )}
        </div>
      ) : (
        <>
          {/* ── 1. How long does this job take? ─────────────────────────────── */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <SummaryCard
              icon={<Clock size={18} className="text-purple-600" />} bg="bg-purple-50"
              label="Typical run time"
              title={durationBasisNote(data.avg_duration_basis)}
              value={avgDuration === null ? null : fmtDuration(avgDuration)}
              // The API says which measurement its average actually is. The old
              // note asserted "step timers" unconditionally — true for a tenant
              // whose runs all record timers, a quiet lie for one whose average
              // fell back to wall clock.
              note={avgDuration === null
                ? 'no run has been timed yet'
                : `${durationBasisLabel(data.avg_duration_basis) || 'measured'} · all completed runs`}
            />
            <TrendCard trend={trend} />
            <SummaryCard
              icon={<TrendingDown size={18} className="text-green-600" />} bg="bg-green-50" label="Best time"
              value={bestTime === null ? null : fmtDuration(bestTime)}
              note={bestTime === null ? 'no run has been timed yet' : 'fastest completed run'}
            />
            <SummaryCard
              icon={<CheckCircle2 size={18} className={tone.icon} />}
              bg={tone.bg}
              label="First-pass yield"
              value={passRate === null ? null : `${passRate.toFixed(0)}%`}
              valueColor={tone.value}
              note={passRate === null
                ? 'no pass/fail check recorded'
                : `from ${pluralize(qcSample, 'inspected run')}`}
            />
          </div>

          {/* ── Live: what is on the bench right now ────────────────────────── */}
          {running.length > 0 && (
            <section className="card border-blue-100 bg-blue-50/40 p-4">
              <div className="flex items-center gap-2 mb-3 flex-wrap">
                <span className="w-2 h-2 rounded-full bg-blue-500 live-pulse" aria-hidden="true" />
                <h2 className="font-semibold text-gray-900 text-sm">On the bench right now</h2>
                <span className="text-xs text-gray-500">{pluralize(running.length, 'run')} in progress</span>
              </div>
              <ul className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-2">
                {running.map(r => (
                  <li key={r.id}>
                    <Link
                      to={`/completions/${r.id}`}
                      className="flex items-center gap-3 rounded-xl bg-white border border-blue-100 px-3 py-2 hover:border-blue-200 transition-colors"
                    >
                      <Loader2 size={14} className="text-blue-500 animate-spin flex-shrink-0" />
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

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 items-start">
            {/* ── 2. Is it getting faster or slower? ────────────────────────── */}
            <section className="card p-5">
              <div className="flex items-center gap-2 mb-1 flex-wrap">
                <TrendingUp size={16} className="text-gray-400" />
                <h2 className="font-semibold text-gray-900">Getting faster or slower?</h2>
                {trendData.length > 1 && (
                  <span className="text-xs text-gray-400 ml-auto">last {trendData.length} timed runs</span>
                )}
              </div>
              <p className="text-[11px] text-gray-400 mb-3">Each completed run in the order it finished, oldest on the left.</p>
              {trendData.length > 1 ? (
                <ResponsiveContainer width="100%" height={220}>
                  <LineChart data={trendData} margin={{ left: 4, right: 12, top: 8, bottom: 4 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--grid-line)" />
                    <XAxis dataKey="date" tick={{ fontSize: 10, fill: 'var(--muted)' }} minTickGap={18} />
                    <YAxis
                      tick={{ fontSize: 11, fill: 'var(--muted)' }}
                      tickFormatter={v => fmtDuration(v)}
                      ticks={trendTicks}
                      domain={[0, trendTicks[trendTicks.length - 1]]}
                      width={58}
                    />
                    <Tooltip content={<TrendTooltip />} />
                    {avgDuration !== null && (
                      <ReferenceLine y={avgDuration} stroke="#6366f1" strokeDasharray="4 4"
                        label={{ value: 'avg', fill: '#6366f1', fontSize: 10, position: 'insideTopLeft' }} />
                    )}
                    <Line type="monotone" dataKey="duration" stroke="#6366f1" strokeWidth={2}
                      dot={{ r: 2.5, fill: '#6366f1' }} activeDot={{ r: 5 }} />
                  </LineChart>
                </ResponsiveContainer>
              ) : (
                <EmptyState
                  compact
                  icon={TrendingUp}
                  title="Not enough timed runs to draw a trend"
                  description="Two completed runs with recorded times make a line; a few more make it mean something."
                />
              )}
            </section>

            {/* ── 3. Which step is the bottleneck? ──────────────────────────── */}
            <section className="card p-5">
              <div className="flex items-center gap-2 mb-1 flex-wrap">
                <Gauge size={16} className="text-gray-400" />
                <h2 className="font-semibold text-gray-900">Where the time goes</h2>
                {bottleneck && (
                  <span className="badge-amber">
                    Slowest: {bottleneck.step.step_name}
                    {bottleneck.overPct !== null && ` · ${bottleneck.overPct}% over takt`}
                  </span>
                )}
              </div>
              <p className="text-[11px] text-gray-400 mb-3">Average time per step across every completed run.</p>
              {timedSteps.length > 0 ? (
                <>
                  <div className="flex items-center gap-x-4 gap-y-1 mb-3 text-[11px] text-gray-500 flex-wrap">
                    <Legend color="#22c55e" label="Under takt" />
                    <Legend color="#f59e0b" label="Within 10%" />
                    <Legend color="#ef4444" label="Over takt" />
                    <Legend color="#6366f1" label="No takt set" />
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
                          <YAxis type="category" dataKey="step_name" tick={{ fontSize: 11, fill: 'var(--muted)' }} width={104} />
                          <Tooltip content={<StepAvgTooltip />} cursor={{ fill: 'rgba(99,102,241,0.06)' }} />
                          {timedSteps.some(s => !!s.takt_seconds) && (
                            <Bar dataKey="takt_seconds" name="Takt" fill="var(--baseline)" radius={[0, 3, 3, 0]} maxBarSize={8} />
                          )}
                          <Bar dataKey="avg_duration_seconds" name="Average" radius={[0, 3, 3, 0]} maxBarSize={16}>
                            {timedSteps.map((entry, i) => (
                              <Cell key={i} fill={stepBarColor(entry.avg_duration_seconds, entry.takt_seconds)} />
                            ))}
                          </Bar>
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  </div>
                  {untimedStepCount > 0 && (
                    <p className="text-[11px] text-gray-400 mt-2">
                      {pluralize(untimedStepCount, 'step')} not shown — no run has recorded a time for {untimedStepCount === 1 ? 'it' : 'them'} yet.
                    </p>
                  )}
                </>
              ) : (
                <EmptyState
                  compact
                  icon={Gauge}
                  title="No step has been timed yet"
                  description="Per-step timers are recorded as operators walk the job in the player. Until then there is no bottleneck to point at."
                />
              )}
            </section>
          </div>

          {/* ── 4. What went wrong recently? ────────────────────────────────── */}
          <section className="card p-5">
            <div className="flex items-center gap-2 mb-1">
              <AlertTriangle size={16} className="text-gray-400" />
              <h2 className="font-semibold text-gray-900">What went wrong recently</h2>
            </div>
            <p className="text-[11px] text-gray-400 mb-3">
              Failed checks and runs nobody finished, from the {pluralize(loadedCount, 'run')} loaded below.
            </p>
            {problems.length === 0 ? (
              <p className="text-sm text-gray-500 flex items-center gap-2">
                <CheckCircle2 size={15} className="text-green-600 flex-shrink-0" />
                Nothing failed and nothing was abandoned in
                {loadedCount >= total ? ' this app’s whole history.' : ` the last ${pluralize(loadedCount, 'run')}.`}
              </p>
            ) : (
              <ul className="grid grid-cols-1 md:grid-cols-2 gap-2">
                {problems.map(p => (
                  <li key={p.id}>
                    <Link
                      to={`/completions/${p.id}`}
                      className="flex items-center gap-3 rounded-xl border border-red-100 bg-red-50/50 px-3 py-2 hover:border-red-200 transition-colors"
                    >
                      <XCircle size={14} className="text-red-500 flex-shrink-0" />
                      <span className="min-w-0 flex-1">
                        <span className="block text-[13px] font-medium text-gray-900 truncate">
                          {p.pass_fail === 'fail' ? 'Failed a check' : 'Never finished'}
                          {p.work_order_number ? ` · ${p.work_order_number}` : ''}
                        </span>
                        <span className="block text-[11px] text-gray-600 truncate">
                          {p.operator_name || 'Unknown operator'} · {fmtRelative(p.completed_at ?? p.started_at)}
                        </span>
                      </span>
                      <span className="text-[11px] text-red-600 font-medium flex-shrink-0">Open</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* ── 5. Every run ────────────────────────────────────────────────── */}
          <section className="card overflow-hidden">
            <div className="px-5 py-4 border-b border-gray-100 space-y-3">
              <div className="flex items-center gap-2 flex-wrap">
                <History size={15} className="text-gray-400" />
                <h2 className="font-semibold text-gray-900">Every run</h2>
                <span className="text-xs text-gray-400">
                  {filtersActive
                    ? `${filtered.length} of ${loadedCount} loaded match`
                    : `${loadedCount} of ${total} loaded`}
                </span>
              </div>

              <div className="flex items-center gap-2 flex-wrap">
                <span className="flex items-center gap-1.5 text-[11px] font-semibold text-gray-500 uppercase tracking-wide">
                  <SlidersHorizontal size={12} /> Filter
                </span>
                <label className="relative">
                  <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
                  <input
                    value={query}
                    onChange={e => setQuery(e.target.value)}
                    placeholder="Operator, work order, run id"
                    aria-label="Search runs"
                    className="input-field w-auto min-w-[13rem] py-1.5 pl-7 text-xs"
                  />
                </label>
                <select
                  aria-label="Status" value={status} onChange={e => setStatus(e.target.value as StatusFilter)}
                  className="input-field w-auto py-1.5 text-xs"
                >
                  <option value="all">Any status</option>
                  <option value="completed">Completed</option>
                  <option value="in_progress">Running now</option>
                  <option value="abandoned">Abandoned</option>
                </select>
                <select
                  aria-label="Result" value={result} onChange={e => setResult(e.target.value as ResultFilter)}
                  className="input-field w-auto py-1.5 text-xs"
                >
                  <option value="all">Any result</option>
                  <option value="pass">Passed</option>
                  <option value="fail">Failed</option>
                  <option value="unchecked">No check recorded</option>
                </select>
                <select
                  aria-label="Operator" value={operator} onChange={e => setOperator(e.target.value)}
                  className="input-field w-auto py-1.5 text-xs"
                >
                  <option value="">All operators</option>
                  {operators.map(o => <option key={o} value={o}>{o}</option>)}
                </select>
                {filtersActive && (
                  <button type="button" onClick={clearFilters} className="text-xs font-medium text-indigo-600 hover:text-indigo-800">
                    Clear filters
                  </button>
                )}
              </div>

              {/* Say plainly how far the controls reach, so a filter can never
                  look like it searched runs it has not seen. */}
              {loadedCount < total && (
                <p className="text-[11px] text-gray-400">
                  Filtering and sorting cover the {pluralize(loadedCount, 'run')} loaded so far, newest first.
                  Load more to reach further back.
                </p>
              )}
            </div>

            {filtered.length === 0 ? (
              <EmptyState
                icon={SlidersHorizontal}
                title="No runs match these filters"
                description={`${pluralize(loadedCount, 'run')} loaded, none of them matching. Widen a filter, or load more history.`}
                action={<button type="button" onClick={clearFilters} className="btn-secondary">Show all runs</button>}
              />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm min-w-[46rem]">
                  <thead className="bg-gray-50 border-b border-gray-100">
                    <tr>
                      <SortHeader label="Date" sortKey="date" sort={sort} onSort={toggleSort} />
                      <SortHeader label="Operator" sortKey="operator" sort={sort} onSort={toggleSort} />
                      <SortHeader label="Duration" sortKey="duration" sort={sort} onSort={toggleSort} />
                      <SortHeader label="Result" sortKey="result" sort={sort} onSort={toggleSort} />
                      <th className="text-left text-[11px] font-semibold text-gray-500 uppercase tracking-wide px-4 py-3">Work order</th>
                      <th className="text-left text-[11px] font-semibold text-gray-500 uppercase tracking-wide px-4 py-3">Status</th>
                      <th className="px-4 py-3" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {filtered.map(c => {
                      const badge = statusBadge(c.status);
                      const live = c.status === 'in_progress';
                      // Faster/slower than average is only a judgement when there
                      // IS an average and this run was actually timed.
                      const duration = measuredSeconds(c.total_duration_seconds);
                      const vsAvg = avgDuration !== null && duration !== null ? duration / avgDuration : 1;
                      const durationColor = duration === null ? 'text-gray-400'
                        : vsAvg <= 0.9 ? 'text-green-600' : vsAvg <= 1.1 ? 'text-gray-900' : 'text-red-600';
                      return (
                        <tr
                          key={c.id}
                          className={`transition-colors cursor-pointer ${live ? 'bg-blue-50/40 hover:bg-blue-50/70' : 'hover:bg-gray-50'}`}
                          onClick={() => navigate(`/completions/${c.id}`)}
                        >
                          {/* A run still on the bench has no completed_at, but it
                              does have a start — showing when it started beats an
                              em-dash in a column headed DATE. */}
                          <td className="px-4 py-3 text-xs text-gray-600 whitespace-nowrap">
                            <span className="flex items-center gap-1.5">
                              <Calendar size={11} className="text-gray-400 flex-shrink-0" />
                              {c.completed_at
                                ? fmtDateTime(c.completed_at)
                                : c.started_at
                                  ? <span className="text-gray-500">started {fmtDateTime(c.started_at)}</span>
                                  : '—'}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-xs text-gray-700">
                            <span className="flex items-center gap-1.5">
                              <User size={11} className="text-gray-400 flex-shrink-0" />
                              {c.operator_name || <span className="text-gray-400">—</span>}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-xs font-medium tabular-nums whitespace-nowrap">
                            {live ? (
                              <span className="text-blue-600 font-semibold">
                                {fmtDuration(elapsedSeconds(c.started_at, now))}
                                <span className="text-[10px] font-normal text-blue-500"> and counting</span>
                              </span>
                            ) : (
                              <span className={durationColor} title={duration === null ? 'this run was never timed' : undefined}>
                                {fmtDuration(duration)}
                              </span>
                            )}
                          </td>
                          <td className="px-4 py-3">
                            {c.pass_fail === 'pass' ? (
                              <span className="flex items-center gap-1 text-xs text-green-600 font-medium">
                                <CheckCircle2 size={12} /> Pass
                              </span>
                            ) : c.pass_fail === 'fail' ? (
                              <span className="flex items-center gap-1 text-xs text-red-600 font-medium">
                                <XCircle size={12} /> Fail
                              </span>
                            ) : (
                              <span className="text-xs text-gray-400" title="no pass/fail check recorded on this run">—</span>
                            )}
                          </td>
                          <td className="px-4 py-3 text-xs text-gray-600">
                            {c.work_order_number ? (
                              <span className="flex items-center gap-1 text-indigo-600">
                                <Package size={11} /> {c.work_order_number}
                              </span>
                            ) : <span className="text-gray-400">—</span>}
                          </td>
                          <td className="px-4 py-3">
                            <span className={badge.cls}>
                              {live && <span className="w-1.5 h-1.5 rounded-full bg-blue-500 live-pulse" aria-hidden="true" />}
                              {badge.label}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-right">
                            <span className="text-xs text-indigo-600 whitespace-nowrap">Open →</span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            <div className="flex items-center justify-between gap-3 px-5 py-3 border-t border-gray-100 bg-gray-50 flex-wrap">
              <span className="text-xs text-gray-500">
                Showing {filtered.length} of {loadedCount} loaded · {pluralize(total, 'run')} all time
              </span>
              {loadedCount < total && (
                <button
                  type="button"
                  onClick={loadMore}
                  disabled={loadingMore || refreshing}
                  className="btn-secondary text-xs disabled:opacity-50"
                >
                  {loadingMore ? <Activity size={13} className="animate-pulse" /> : <ChevronDown size={13} />}
                  Load {Math.min(PAGE_SIZE, total - loadedCount)} more
                </button>
              )}
            </div>
          </section>
        </>
      )}
    </div>
  );
}

// ── Pieces ───────────────────────────────────────────────────────────────────

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className="w-2.5 h-2.5 rounded-sm inline-block" style={{ backgroundColor: color }} />
      {label}
    </span>
  );
}

// `value` is null exactly when the number is unknown; the card then shows "—"
// and the short reason underneath instead of a zero nobody measured.
function SummaryCard({ icon, bg, label, value, valueColor, note, title }: {
  icon: React.ReactNode;
  bg: string;
  label: string;
  value: string | number | null;
  valueColor?: string;
  note?: string;
  title?: string;
}) {
  const known = value !== null && value !== undefined;
  return (
    <div className="card p-4 flex items-center gap-3 min-w-0" title={title}>
      <div className={`w-10 h-10 ${bg} rounded-lg flex items-center justify-center flex-shrink-0`}>{icon}</div>
      <div className="min-w-0">
        <div className={`text-xl font-bold tabular-nums ${known ? (valueColor ?? 'text-gray-900') : 'text-gray-400'}`}>
          {known ? value : '—'}
        </div>
        <div className="text-xs text-gray-500 truncate" title={label}>{label}</div>
        {note && <div className="text-[11px] text-gray-400 truncate" title={note}>{note}</div>}
      </div>
    </div>
  );
}

/** Faster or slower, or an honest "not enough runs to say". A trend is a claim
 *  about direction, so it only appears once there is something on both sides of
 *  the comparison to make it with. */
function TrendCard({ trend }: {
  trend: { deltaSeconds: number; sample: number; recent: number; earlier: number } | null;
}) {
  if (!trend) {
    return (
      <SummaryCard
        icon={<Minus size={18} className="text-gray-400" />} bg="bg-gray-100"
        label="Trend" value={null} note="not enough timed runs to compare"
      />
    );
  }
  // A couple of seconds either way is the same job done twice, not a direction.
  const flat = Math.abs(trend.deltaSeconds) < Math.max(2, trend.earlier * 0.02);
  const sample = `last ${trend.sample} runs vs the ${trend.sample} before`;
  if (flat) {
    return (
      <SummaryCard
        icon={<Minus size={18} className="text-gray-500" />} bg="bg-gray-100"
        label="Trend" value="Holding steady" note={sample}
      />
    );
  }
  const faster = trend.deltaSeconds < 0;
  return (
    <SummaryCard
      icon={faster
        ? <TrendingDown size={18} className="text-green-600" />
        : <TrendingUp size={18} className="text-red-600" />}
      bg={faster ? 'bg-green-50' : 'bg-red-50'}
      label={faster ? 'Trend · getting faster' : 'Trend · getting slower'}
      value={`${faster ? '−' : '+'}${fmtDuration(Math.abs(trend.deltaSeconds))}`}
      valueColor={faster ? 'text-green-600' : 'text-red-600'}
      note={sample}
    />
  );
}

function SortHeader({ label, sortKey, sort, onSort }: {
  label: string; sortKey: SortKey; sort: { key: SortKey; desc: boolean }; onSort: (k: SortKey) => void;
}) {
  const active = sort.key === sortKey;
  return (
    <th className="text-left px-4 py-3" aria-sort={active ? (sort.desc ? 'descending' : 'ascending') : 'none'}>
      <button
        type="button"
        onClick={() => onSort(sortKey)}
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

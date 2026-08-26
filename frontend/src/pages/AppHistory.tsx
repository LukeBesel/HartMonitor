import { useEffect, useState, useCallback } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { api } from '../api/client';
import {
  ArrowLeft, Play, CheckCircle2, XCircle, Clock, User, TrendingUp,
  ChevronLeft, ChevronRight, BarChart2, Activity, Calendar, Package, Info
} from 'lucide-react';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  CartesianGrid, LineChart, Line, ReferenceLine, Cell
} from 'recharts';
// One duration formatter for the whole app: seconds / minutes / hours, and "—"
// for null. A second local copy is how this page ended up printing "0m" for a
// twelve-second run while the App Dashboard printed "12s".
import { fmtDuration, durationBasisNote } from '../components/apps/appModel';

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
  /** The canonical run duration — the same number every other screen shows. */
  total_duration_seconds: number | null;
  /** Which measurement it is, so the cell can say so. */
  duration_basis: 'hands_on' | 'elapsed' | null;
  hands_on_seconds: number | null;
  elapsed_seconds: number | null;
  elapsed_so_far_seconds: number | null;
  status: 'completed' | 'abandoned' | 'in_progress';
  work_order_number: string | null;
  pass_fail: 'pass' | 'fail' | null;
}

interface AppHistoryData {
  app_id: string;
  app_name: string;
  total_runs: number;
  avg_duration: number | null;
  avg_duration_basis: 'hands_on' | 'elapsed' | 'mixed' | null;
  avg_hands_on_seconds: number | null;
  avg_elapsed_seconds: number | null;
  best_time: number | null;
  pass_rate: number | null;
  qc_sample_size?: number;
  step_averages: StepAverage[];
  completions: HistoryCompletion[];
  total: number;
}

const PAGE_SIZE = 25;

/** Why this run reads what it reads, and what it measures the other way. */
function durationTitle(c: HistoryCompletion): string {
  if (c.total_duration_seconds === null) {
    return c.status === 'in_progress'
      ? `This run has not finished — ${c.elapsed_so_far_seconds === null ? 'no elapsed time recorded' : `${fmtDuration(c.elapsed_so_far_seconds)} elapsed so far`}.`
      : 'This run was never timed.';
  }
  const other = c.duration_basis === 'hands_on'
    ? (c.elapsed_seconds == null ? null : `${fmtDuration(c.elapsed_seconds)} wall clock, start to finish`)
    : (c.hands_on_seconds == null ? null : `${fmtDuration(c.hands_on_seconds)} hands-on`);
  return `${durationBasisNote(c.duration_basis)}${other ? ` This run the other way: ${other}.` : ''}`;
}

function fmtDate(iso: string | null) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
}

function fmtDateShort(iso: string | null) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

function stepBarColor(avg: number | null, takt: number | null) {
  if (!takt || takt <= 0 || avg === null) return '#3b82f6';
  const ratio = avg / takt;
  if (ratio <= 1) return '#22c55e';
  if (ratio <= 1.10) return '#f59e0b';
  return '#ef4444';
}

function statusBadge(status: string) {
  if (status === 'completed') return { label: 'Completed', cls: 'bg-green-100 text-green-700' };
  if (status === 'abandoned') return { label: 'Abandoned', cls: 'bg-red-100 text-red-700' };
  if (status === 'in_progress') return { label: 'In Progress', cls: 'bg-blue-100 text-blue-700' };
  return { label: status, cls: 'bg-gray-100 text-gray-600' };
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
    <div className="bg-white border border-gray-200 rounded-lg shadow-lg p-3 text-xs min-w-[180px]">
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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);

  const load = useCallback(
    async (p: number) => {
      if (!appId) return;
      setLoading(true);
      setError(null);
      try {
        const result = await api.getAppHistory(appId, p);
        setData(result);
        setTotal(result.total ?? result.completions?.length ?? 0);
        setPage(p);
      } catch (e: any) {
        setError(e.message ?? 'Failed to load history');
      } finally {
        setLoading(false);
      }
    },
    [appId]
  );

  useEffect(() => { load(1); }, [load]);

  if (loading && !data) {
    return (
      <div className="min-h-screen bg-[#f8fafc] flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
          <span className="text-gray-500 text-sm">Loading history...</span>
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="min-h-screen bg-[#f8fafc] flex items-center justify-center">
        <div className="text-center">
          <XCircle size={32} className="text-red-400 mx-auto mb-3" />
          <p className="text-gray-700 font-medium">{error ?? 'App not found'}</p>
          <button onClick={() => navigate(-1)} className="mt-4 btn-secondary">
            <ArrowLeft size={14} /> Go Back
          </button>
        </div>
      </div>
    );
  }

  const completions = data.completions ?? [];
  const steps = data.step_averages ?? [];
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const trendData = completions
    .filter((c) => c.status === 'completed' && c.completed_at && c.total_duration_seconds !== null)
    .map((c) => ({ date: fmtDateShort(c.completed_at), duration: c.total_duration_seconds as number }))
    .reverse();

  // Only steps somebody actually timed get a bar. A step with no runs behind it
  // would otherwise draw a confident zero-length bar next to the real ones.
  const timedSteps = steps.filter((s) => s.avg_duration_seconds !== null);
  const untimedStepCount = steps.length - timedSteps.length;
  const stepChartData = timedSteps.map((s) => ({
    ...s,
    avg_minutes: parseFloat(((s.avg_duration_seconds as number) / 60).toFixed(2)),
  }));
  const taktMinutes = steps.map((s) => s.takt_seconds).filter((t): t is number => !!t && t > 0).map((t) => t / 60);
  const maxTaktMin = taktMinutes.length > 0 ? Math.max(...taktMinutes) : 0;

  // pass_rate is null when this app records no Pass/Fail result at all — the
  // same thing /apps/:id/analytics and /apps/dashboard already say out loud.
  // Coalescing it to 0 painted a red "0%" onto an app nobody ever inspected.
  const passRate = data.pass_rate;
  // The measurement the headline is NOT showing, so both are on screen and the
  // gap between this page and the Command Center reads as two facts rather than
  // a contradiction. See backend/src/cycleTime.js for the model.
  const avgOtherMeasurement = data.avg_duration === null ? null
    : data.avg_duration_basis === 'hands_on'
      ? (data.avg_elapsed_seconds == null ? null : `${fmtDuration(data.avg_elapsed_seconds)} wall clock`)
      : data.avg_duration_basis === 'elapsed'
        ? (data.avg_hands_on_seconds == null ? null : `${fmtDuration(data.avg_hands_on_seconds)} hands-on`)
        : null;
  const qcSample = data.qc_sample_size ?? 0;
  const passTone = passRate === null ? 'gray'
    : passRate >= 95 ? 'green' : passRate >= 80 ? 'amber' : 'red';
  const TONE = {
    gray:  { icon: 'text-gray-400',   bg: 'bg-gray-100',  value: 'text-gray-400' },
    green: { icon: 'text-green-600',  bg: 'bg-green-50',  value: 'text-green-600' },
    amber: { icon: 'text-amber-600',  bg: 'bg-amber-50',  value: 'text-amber-600' },
    red:   { icon: 'text-red-600',    bg: 'bg-red-50',    value: 'text-red-600' },
  } as const;
  const tone = TONE[passTone];

  return (
    <div className="min-h-screen bg-[#f8fafc] p-6 space-y-6">
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
            <p className="text-gray-500 text-xs mt-0.5">Completion History</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Link to={`/apps/${appId}`} className="btn-secondary">
            <Info size={14} /> App details
          </Link>
          <Link to={`/apps/${appId}/analytics`} className="btn-secondary">
            <BarChart2 size={14} /> Analytics
          </Link>
          <Link to={`/play/${appId}`} className="btn-primary">
            <Play size={14} /> Run App
          </Link>
        </div>
      </div>

      {/* Summary Stats
          "Avg hands-on time" is deliberately NOT called "avg cycle time": this
          page sums the per-step timers over every completed run ever, while
          /apps/:id/analytics measures wall clock from start to finish over the
          chosen day range. The two differ by whatever happens between steps, so
          they are labelled for what each one actually counts rather than left
          to look like the system disagreeing with itself. */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <SummaryCard icon={<Activity size={18} className="text-blue-600" />} bg="bg-blue-50" label="Total Runs" value={total} />
        <SummaryCard
          icon={<Clock size={18} className="text-purple-600" />} bg="bg-purple-50"
          label={data.avg_duration_basis === 'elapsed' ? 'Avg Wall Clock'
                 : data.avg_duration_basis === 'mixed' ? 'Avg Run Time · mixed'
                 : 'Avg Hands-On Time'}
          title={`${durationBasisNote(data.avg_duration_basis)}${
            avgOtherMeasurement ? ` The same runs measured the other way: ${avgOtherMeasurement}.` : ''}`}
          value={data.avg_duration === null ? null : fmtDuration(data.avg_duration)}
          note={data.avg_duration === null
            ? 'no run has been timed yet'
            : avgOtherMeasurement ? `${avgOtherMeasurement} start to finish`
            : 'all completed runs'}
        />
        <SummaryCard
          icon={<TrendingUp size={18} className="text-green-600" />} bg="bg-green-50" label="Best Time"
          value={data.best_time === null ? null : fmtDuration(data.best_time)}
          note={data.best_time === null ? 'no run has been timed yet' : 'fastest completed run'}
        />
        <SummaryCard
          icon={<CheckCircle2 size={18} className={tone.icon} />}
          bg={tone.bg}
          label="Pass Rate"
          value={passRate === null ? null : `${passRate.toFixed(0)}%`}
          valueColor={tone.value}
          note={passRate === null
            ? 'no pass/fail checks recorded'
            : `from ${qcSample} inspected run${qcSample === 1 ? '' : 's'}`}
        />
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {timedSteps.length > 0 && (
          <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-5">
            <div className="flex items-center gap-2 mb-3">
              <BarChart2 size={16} className="text-gray-500" />
              <h2 className="font-semibold text-gray-900">Average Time per Step</h2>
            </div>
            <div className="flex items-center gap-4 mb-3 text-xs text-gray-500">
              <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-green-500 inline-block" />Under takt</span>
              <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-amber-500 inline-block" />Within 10%</span>
              <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-red-500 inline-block" />Over takt</span>
            </div>
            <ResponsiveContainer width="100%" height={Math.max(180, timedSteps.length * 36)}>
              <BarChart data={stepChartData} layout="vertical" margin={{ left: 8, right: 40, top: 4, bottom: 4 }}>
                <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#f0f0f0" />
                <XAxis type="number" tick={{ fontSize: 11 }} unit="m" />
                <YAxis type="category" dataKey="step_name" tick={{ fontSize: 11 }} width={120} />
                <Tooltip content={<StepAvgTooltip />} />
                {maxTaktMin > 0 && (
                  <ReferenceLine x={maxTaktMin} stroke="#f59e0b" strokeDasharray="4 4" strokeWidth={1.5}
                    label={{ value: 'Takt', fill: '#f59e0b', fontSize: 10, position: 'top' }} />
                )}
                <Bar dataKey="avg_minutes" radius={[0, 3, 3, 0]} maxBarSize={22}>
                  {stepChartData.map((entry, i) => (
                    <Cell key={i} fill={stepBarColor(entry.avg_duration_seconds, entry.takt_seconds)} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
            {untimedStepCount > 0 && (
              <p className="text-xs text-gray-400 mt-2">
                {untimedStepCount} step{untimedStepCount === 1 ? '' : 's'} not shown — no run has recorded a time for {untimedStepCount === 1 ? 'it' : 'them'} yet.
              </p>
            )}
          </div>
        )}

        {trendData.length > 1 && (
          <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-5">
            <div className="flex items-center gap-2 mb-3">
              <TrendingUp size={16} className="text-gray-500" />
              <h2 className="font-semibold text-gray-900">Completion Time Trend</h2>
              <span className="text-xs text-gray-400 ml-auto">Last {trendData.length} runs</span>
            </div>
            <ResponsiveContainer width="100%" height={230}>
              <LineChart data={trendData} margin={{ left: 8, right: 16, top: 8, bottom: 4 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="date" tick={{ fontSize: 10 }} />
                <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => fmtDuration(v)} width={52} />
                <Tooltip content={<TrendTooltip />} />
                {data.avg_duration !== null && data.avg_duration > 0 && (
                  <ReferenceLine y={data.avg_duration} stroke="#3b82f6" strokeDasharray="4 4"
                    label={{ value: 'Avg', fill: '#3b82f6', fontSize: 10, position: 'right' }} />
                )}
                <Line type="monotone" dataKey="duration" stroke="#6366f1" strokeWidth={2}
                  dot={{ r: 3, fill: '#6366f1' }} activeDot={{ r: 5 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>

      {/* Completions Table */}
      <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200">
          <div className="flex items-center gap-2">
            <Calendar size={15} className="text-gray-400" />
            <h2 className="font-semibold text-gray-900">All Completions</h2>
            <span className="text-xs text-gray-400">({total} total)</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-500">Page {page} of {totalPages}</span>
            <button onClick={() => load(page - 1)} disabled={page <= 1 || loading}
              className="p-1.5 rounded-lg hover:bg-gray-100 transition-colors disabled:opacity-40 disabled:cursor-not-allowed">
              <ChevronLeft size={15} />
            </button>
            <button onClick={() => load(page + 1)} disabled={page >= totalPages || loading}
              className="p-1.5 rounded-lg hover:bg-gray-100 transition-colors disabled:opacity-40 disabled:cursor-not-allowed">
              <ChevronRight size={15} />
            </button>
          </div>
        </div>

        {completions.length === 0 ? (
          <div className="py-16 text-center">
            <Activity size={28} className="mx-auto mb-3 text-gray-300" />
            <p className="font-medium text-gray-600">Nobody has run this app yet</p>
            <p className="text-sm text-gray-400 mt-1">
              Open it in the player and complete a run — every value captured lands here.
            </p>
            <Link to={`/play/${appId}`} className="btn-primary inline-flex mt-4">
              <Play size={14} /> Run it now
            </Link>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  {['Date', 'Operator', 'Duration', 'Pass/Fail', 'Work Order', 'Status', ''].map((h) => (
                    <th key={h} className="text-left text-xs font-medium text-gray-500 uppercase tracking-wide px-4 py-3">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {completions.map((c) => {
                  const badge = statusBadge(c.status);
                  // Faster/slower than average is only a judgement when there IS
                  // an average and this run was actually timed.
                  const durationVsAvg = data.avg_duration && c.total_duration_seconds !== null
                    ? c.total_duration_seconds / data.avg_duration : 1;
                  const durationColor = c.total_duration_seconds === null ? 'text-gray-400'
                    : durationVsAvg <= 0.9 ? 'text-green-600' : durationVsAvg <= 1.1 ? 'text-gray-900' : 'text-red-600';
                  return (
                    <tr key={c.id} className="hover:bg-gray-50 transition-colors cursor-pointer"
                      onClick={() => navigate(`/completions/${c.id}`)}>
                      {/* A run still on the bench has no completed_at, but it
                          does have a start — showing the day it started beats an
                          em-dash in a column headed DATE. */}
                      <td className="px-4 py-3 text-xs text-gray-600 whitespace-nowrap">
                        <div className="flex items-center gap-1.5">
                          <Calendar size={11} className="text-gray-400 flex-shrink-0" />
                          {c.completed_at
                            ? fmtDate(c.completed_at)
                            : c.started_at
                              ? <span className="text-gray-500">started {fmtDate(c.started_at)}</span>
                              : '—'}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-xs text-gray-700">
                        <div className="flex items-center gap-1.5">
                          <User size={11} className="text-gray-400 flex-shrink-0" />
                          {c.operator_name || '—'}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-xs font-mono font-medium">
                        <span className={durationColor} title={durationTitle(c)}>
                          {c.total_duration_seconds === null ? '—' : fmtDuration(c.total_duration_seconds)}
                        </span>
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
                          <span className="text-xs text-gray-400">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-xs text-gray-600">
                        {c.work_order_number ? (
                          <div className="flex items-center gap-1 text-blue-600">
                            <Package size={11} /> {c.work_order_number}
                          </div>
                        ) : <span className="text-gray-400">—</span>}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${badge.cls}`}>{badge.label}</span>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <span className="text-xs text-blue-600 flex items-center justify-end gap-0.5">
                          View <ChevronRight size={12} />
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {totalPages > 1 && (
          <div className="flex items-center justify-between px-5 py-3 border-t border-gray-100 bg-gray-50">
            <span className="text-xs text-gray-500">
              Showing {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, total)} of {total}
            </span>
            <div className="flex items-center gap-1">
              <button onClick={() => load(page - 1)} disabled={page <= 1 || loading}
                className="px-3 py-1.5 rounded-lg text-xs border border-gray-200 bg-white hover:bg-gray-50 transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1">
                <ChevronLeft size={13} /> Previous
              </button>
              <button onClick={() => load(page + 1)} disabled={page >= totalPages || loading}
                className="px-3 py-1.5 rounded-lg text-xs border border-gray-200 bg-white hover:bg-gray-50 transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1">
                Next <ChevronRight size={13} />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
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
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4 flex items-center gap-3" title={title}>
      <div className={`w-10 h-10 ${bg} rounded-lg flex items-center justify-center flex-shrink-0`}>{icon}</div>
      <div className="min-w-0">
        <div className={`text-xl font-bold ${known ? (valueColor ?? 'text-gray-900') : 'text-gray-400'}`}>
          {known ? value : '—'}
        </div>
        <div className="text-xs text-gray-500">{label}</div>
        {note && <div className="text-[11px] text-gray-400 truncate" title={note}>{note}</div>}
      </div>
    </div>
  );
}

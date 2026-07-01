import { useEffect, useState, useCallback } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { api } from '../api/client';
import {
  ArrowLeft, Play, CheckCircle2, XCircle, Clock, User, TrendingUp,
  ChevronLeft, ChevronRight, BarChart2, Activity, Calendar, Package
} from 'lucide-react';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  CartesianGrid, LineChart, Line, ReferenceLine, Cell
} from 'recharts';

// ── Types ─────────────────────────────────────────────────────────────────────

interface StepAverage {
  step_id: string;
  step_name: string;
  step_order: number;
  avg_duration_seconds: number;
  takt_seconds: number;
  completion_count: number;
}

interface HistoryCompletion {
  id: string;
  operator_name: string;
  completed_at: string;
  total_duration_seconds: number;
  status: 'completed' | 'abandoned' | 'in_progress';
  work_order_number: string | null;
  pass_fail: 'pass' | 'fail' | null;
}

interface AppHistoryData {
  app_id: string;
  app_name: string;
  total_runs: number;
  avg_duration: number;
  best_time: number;
  pass_rate: number;
  step_averages: StepAverage[];
  completions: HistoryCompletion[];
  total: number;
}

const PAGE_SIZE = 25;

function fmtDuration(seconds: number) {
  if (!seconds || seconds <= 0) return '—';
  if (seconds < 60) return `${Math.round(seconds)}s`;
  if (seconds < 3600) {
    const m = Math.floor(seconds / 60);
    const s = Math.round(seconds % 60);
    return s > 0 ? `${m}m ${s}s` : `${m}m`;
  }
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return `${h}h ${m}m`;
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

function stepBarColor(avg: number, takt: number) {
  if (takt <= 0) return '#3b82f6';
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
  const ratio = d.takt_seconds > 0 ? d.avg_duration_seconds / d.takt_seconds : 0;
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
        const result = await (api as any).getAppHistory(appId, p);
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
    .filter((c) => c.status === 'completed' && c.completed_at)
    .map((c) => ({ date: fmtDateShort(c.completed_at), duration: c.total_duration_seconds }))
    .reverse();

  const stepChartData = steps.map((s) => ({
    ...s,
    avg_minutes: parseFloat((s.avg_duration_seconds / 60).toFixed(2)),
  }));
  const maxTaktMin = steps.length > 0 ? Math.max(...steps.map((s) => s.takt_seconds / 60)) : 0;
  const passRate = data.pass_rate ?? 0;

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
        <Link to={`/play/${appId}`} className="btn-primary">
          <Play size={14} /> Run App
        </Link>
      </div>

      {/* Summary Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <SummaryCard icon={<Activity size={18} className="text-blue-600" />} bg="bg-blue-50" label="Total Runs" value={total} />
        <SummaryCard icon={<Clock size={18} className="text-purple-600" />} bg="bg-purple-50" label="Avg Duration" value={fmtDuration(data.avg_duration)} />
        <SummaryCard icon={<TrendingUp size={18} className="text-green-600" />} bg="bg-green-50" label="Best Time" value={fmtDuration(data.best_time)} />
        <SummaryCard
          icon={<CheckCircle2 size={18} className={passRate >= 95 ? 'text-green-600' : passRate >= 80 ? 'text-amber-600' : 'text-red-600'} />}
          bg={passRate >= 95 ? 'bg-green-50' : passRate >= 80 ? 'bg-amber-50' : 'bg-red-50'}
          label="Pass Rate"
          value={`${passRate.toFixed(0)}%`}
          valueColor={passRate >= 95 ? 'text-green-600' : passRate >= 80 ? 'text-amber-600' : 'text-red-600'}
        />
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {steps.length > 0 && (
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
            <ResponsiveContainer width="100%" height={Math.max(180, steps.length * 36)}>
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
                {data.avg_duration > 0 && (
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
          <div className="py-16 text-center text-gray-400 text-sm">
            <Activity size={28} className="mx-auto mb-3 text-gray-300" />
            No completions yet
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
                  const durationVsAvg = data.avg_duration > 0 ? c.total_duration_seconds / data.avg_duration : 1;
                  const durationColor = durationVsAvg <= 0.9 ? 'text-green-600' : durationVsAvg <= 1.1 ? 'text-gray-900' : 'text-red-600';
                  return (
                    <tr key={c.id} className="hover:bg-gray-50 transition-colors cursor-pointer"
                      onClick={() => navigate(`/completions/${c.id}`)}>
                      <td className="px-4 py-3 text-xs text-gray-600 whitespace-nowrap">
                        <div className="flex items-center gap-1.5">
                          <Calendar size={11} className="text-gray-400 flex-shrink-0" />
                          {fmtDate(c.completed_at)}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-xs text-gray-700">
                        <div className="flex items-center gap-1.5">
                          <User size={11} className="text-gray-400 flex-shrink-0" />
                          {c.operator_name || '—'}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-xs font-mono font-medium">
                        <span className={durationColor}>{fmtDuration(c.total_duration_seconds)}</span>
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

function SummaryCard({ icon, bg, label, value, valueColor }: {
  icon: React.ReactNode;
  bg: string;
  label: string;
  value: string | number;
  valueColor?: string;
}) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4 flex items-center gap-3">
      <div className={`w-10 h-10 ${bg} rounded-lg flex items-center justify-center flex-shrink-0`}>{icon}</div>
      <div>
        <div className={`text-xl font-bold ${valueColor ?? 'text-gray-900'}`}>{value}</div>
        <div className="text-xs text-gray-500">{label}</div>
      </div>
    </div>
  );
}

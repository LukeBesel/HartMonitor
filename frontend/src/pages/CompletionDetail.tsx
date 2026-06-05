import { useEffect, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { api } from '../api/client';
import {
  ArrowLeft, CheckCircle2, XCircle, Clock, User, Calendar,
  Package, ChevronRight, BarChart2, Layers, ExternalLink
} from 'lucide-react';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  CartesianGrid, Cell, ReferenceLine
} from 'recharts';

// ── Types ─────────────────────────────────────────────────────────────────────

interface StepBreakdown {
  step_id: string;
  step_name: string;
  step_order: number;
  duration_seconds: number;
  takt_seconds: number;
  variance_pct: number;
  status: 'under' | 'on_target' | 'over';
}

interface CompletionDetail {
  id: string;
  app_id: string;
  app_name: string;
  operator_name: string;
  station_id: string | null;
  started_at: string;
  completed_at: string | null;
  status: 'in_progress' | 'completed' | 'abandoned';
  total_duration_seconds: number;
  work_order_id: string | null;
  work_order_number: string | null;
  step_breakdown: StepBreakdown[];
  captured_data: Record<string, unknown>;
  related_completions: Array<{
    id: string;
    operator_name: string;
    completed_at: string;
    total_duration_seconds: number;
    status: string;
  }>;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtDuration(seconds: number) {
  if (!seconds || seconds < 0) return '—';
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return s > 0 ? `${m}m ${s}s` : `${m}m`;
  }
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return `${h}h ${m}m`;
}

function fmtDateTime(iso: string | null) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString([], {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

function fmtTimeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 60000) return 'just now';
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  return new Date(iso).toLocaleDateString();
}

function shortId(id: string) {
  return id.slice(0, 8).toUpperCase();
}

function stepBarColor(status: string) {
  if (status === 'under')     return '#22c55e';
  if (status === 'on_target') return '#3b82f6';
  return '#ef4444';
}

function statusBadge(status: string) {
  if (status === 'completed')  return { label: 'Completed',  cls: 'bg-green-100 text-green-700' };
  if (status === 'in_progress') return { label: 'In Progress', cls: 'bg-blue-100 text-blue-700' };
  if (status === 'abandoned')  return { label: 'Abandoned',  cls: 'bg-red-100 text-red-700' };
  return { label: status, cls: 'bg-gray-100 text-gray-600' };
}

function variancePctLabel(pct: number) {
  if (pct <= 0) return { text: `${Math.abs(pct).toFixed(0)}% under`, cls: 'text-green-600' };
  if (pct <= 10) return { text: `+${pct.toFixed(0)}%`, cls: 'text-amber-600' };
  return { text: `+${pct.toFixed(0)}% over`, cls: 'text-red-600' };
}

function stepStatusIcon(status: string) {
  if (status === 'under')     return <CheckCircle2 size={14} className="text-green-500" />;
  if (status === 'on_target') return <CheckCircle2 size={14} className="text-blue-500" />;
  return <XCircle size={14} className="text-red-500" />;
}

function formatDataValue(v: unknown): string {
  if (v === null || v === undefined) return '—';
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

// ── Custom Tooltip for Step Chart ─────────────────────────────────────────────

function StepTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload as StepBreakdown;
  const v = variancePctLabel(d.variance_pct);
  return (
    <div className="bg-white border border-gray-200 rounded-lg shadow-lg p-3 text-xs min-w-[180px]">
      <div className="font-semibold text-gray-900 mb-1.5">{d.step_name}</div>
      <div className="space-y-1 text-gray-600">
        <div className="flex justify-between gap-4">
          <span>Duration</span>
          <span className="font-medium text-gray-900">{fmtDuration(d.duration_seconds)}</span>
        </div>
        <div className="flex justify-between gap-4">
          <span>Takt</span>
          <span className="font-medium text-gray-900">{fmtDuration(d.takt_seconds)}</span>
        </div>
        <div className="flex justify-between gap-4">
          <span>Variance</span>
          <span className={`font-medium ${v.cls}`}>{v.text}</span>
        </div>
      </div>
    </div>
  );
}

// ── Main Component ─────────────────────────────────────────────────────────────

export default function CompletionDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [completion, setCompletion] = useState<CompletionDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    (api as any).getCompletionDetail(id)
      .then((data: CompletionDetail) => {
        setCompletion(data);
        setLoading(false);
      })
      .catch((e: any) => {
        setError(e.message ?? 'Failed to load completion');
        setLoading(false);
      });
  }, [id]);

  if (loading) {
    return (
      <div className="min-h-screen bg-[#f8fafc] flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
          <span className="text-gray-500 text-sm">Loading completion…</span>
        </div>
      </div>
    );
  }

  if (error || !completion) {
    return (
      <div className="min-h-screen bg-[#f8fafc] flex items-center justify-center">
        <div className="text-center">
          <XCircle size={32} className="text-red-400 mx-auto mb-3" />
          <p className="text-gray-700 font-medium">{error ?? 'Completion not found'}</p>
          <button onClick={() => navigate(-1)} className="mt-4 btn-secondary">
            <ArrowLeft size={14} /> Go Back
          </button>
        </div>
      </div>
    );
  }

  const badge = statusBadge(completion.status);
  const steps = completion.step_breakdown ?? [];
  const capturedEntries = Object.entries(completion.captured_data ?? {});
  const chartData = steps.map(s => ({
    ...s,
    duration_minutes: parseFloat((s.duration_seconds / 60).toFixed(2)),
    takt_minutes: parseFloat((s.takt_seconds / 60).toFixed(2)),
  }));
  const maxTakt = steps.length > 0 ? Math.max(...steps.map(s => s.takt_seconds / 60)) : 0;

  return (
    <div className="min-h-screen bg-[#f8fafc] p-6 space-y-6">
      {/* Breadcrumb + Back */}
      <div className="flex items-center gap-2 text-sm text-gray-500">
        <button
          onClick={() => navigate(-1)}
          className="flex items-center gap-1.5 text-gray-500 hover:text-gray-800 transition-colors"
        >
          <ArrowLeft size={15} />
          Back
        </button>
        <ChevronRight size={13} className="text-gray-300" />
        <Link to="/analytics" className="hover:text-blue-600 transition-colors">Analytics</Link>
        <ChevronRight size={13} className="text-gray-300" />
        <Link to={`/apps/${completion.app_id}/history`} className="hover:text-blue-600 transition-colors">
          {completion.app_name}
        </Link>
        <ChevronRight size={13} className="text-gray-300" />
        <span className="text-gray-800 font-medium">{shortId(completion.id)}</span>
      </div>

      {/* Header Card */}
      <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-6">
        <div className="flex items-start justify-between flex-wrap gap-4">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="font-mono text-xs text-gray-400 bg-gray-100 px-2 py-0.5 rounded">
                #{shortId(completion.id)}
              </span>
              <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${badge.cls}`}>{badge.label}</span>
            </div>
            <h1 className="text-xl font-bold text-gray-900">{completion.app_name}</h1>
          </div>
          <Link
            to={`/play/${completion.app_id}`}
            className="btn-primary text-xs"
          >
            <ExternalLink size={13} />
            Run App Again
          </Link>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-6 mt-6">
          <MetaItem icon={<User size={14} className="text-gray-400" />} label="Operator" value={completion.operator_name || 'Unknown'} />
          <MetaItem icon={<Calendar size={14} className="text-gray-400" />} label="Started" value={fmtDateTime(completion.started_at)} />
          <MetaItem icon={<Clock size={14} className="text-gray-400" />} label="Total Duration" value={fmtDuration(completion.total_duration_seconds)} highlight />
          {completion.work_order_number && (
            <MetaItem icon={<Package size={14} className="text-gray-400" />} label="Work Order" value={completion.work_order_number} />
          )}
          {completion.completed_at && (
            <MetaItem icon={<Calendar size={14} className="text-gray-400" />} label="Completed" value={fmtDateTime(completion.completed_at)} />
          )}
          {completion.station_id && (
            <MetaItem icon={<Layers size={14} className="text-gray-400" />} label="Station" value={completion.station_id} />
          )}
        </div>
      </div>

      {/* Step Performance */}
      {steps.length > 0 && (
        <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-6 space-y-5">
          <div className="flex items-center gap-2">
            <BarChart2 size={16} className="text-gray-500" />
            <h2 className="font-semibold text-gray-900">Step Performance</h2>
          </div>

          {/* Bar chart */}
          <div>
            <div className="flex items-center gap-4 mb-3 text-xs text-gray-500">
              <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-green-500 inline-block" />Under takt</span>
              <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-blue-500 inline-block" />Within 10%</span>
              <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-red-500 inline-block" />Over takt</span>
            </div>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={chartData} layout="vertical" margin={{ left: 8, right: 24, top: 4, bottom: 4 }}>
                <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#f0f0f0" />
                <XAxis
                  type="number"
                  tick={{ fontSize: 11 }}
                  unit="m"
                  domain={[0, 'dataMax + 0.5']}
                />
                <YAxis
                  type="category"
                  dataKey="step_name"
                  tick={{ fontSize: 11 }}
                  width={110}
                />
                <Tooltip content={<StepTooltip />} />
                <ReferenceLine x={maxTakt} stroke="#f59e0b" strokeDasharray="4 4" strokeWidth={1.5} label={{ value: 'Takt', fill: '#f59e0b', fontSize: 10, position: 'top' }} />
                <Bar dataKey="duration_minutes" radius={[0, 3, 3, 0]} maxBarSize={20}>
                  {chartData.map((entry, index) => (
                    <Cell key={index} fill={stepBarColor(entry.status)} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* Step table */}
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 rounded-lg">
                <tr className="border-b border-gray-200">
                  {['#', 'Step Name', 'Duration', 'Takt Time', 'Variance', 'Status'].map(h => (
                    <th key={h} className="text-left text-xs font-medium text-gray-500 px-3 py-2.5">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {steps.map((step, i) => {
                  const v = variancePctLabel(step.variance_pct);
                  return (
                    <tr key={step.step_id ?? i} className="hover:bg-gray-50 transition-colors">
                      <td className="px-3 py-2.5 text-xs text-gray-400 w-8">{step.step_order ?? i + 1}</td>
                      <td className="px-3 py-2.5 text-xs font-medium text-gray-900">{step.step_name}</td>
                      <td className="px-3 py-2.5 text-xs text-gray-700 tabular-nums font-mono">{fmtDuration(step.duration_seconds)}</td>
                      <td className="px-3 py-2.5 text-xs text-gray-500 tabular-nums font-mono">{fmtDuration(step.takt_seconds)}</td>
                      <td className={`px-3 py-2.5 text-xs font-semibold ${v.cls}`}>{v.text}</td>
                      <td className="px-3 py-2.5">{stepStatusIcon(step.status)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Captured Data */}
      {capturedEntries.length > 0 && (
        <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-6">
          <h2 className="font-semibold text-gray-900 mb-4">Captured Data</h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
            {capturedEntries.map(([key, val]) => (
              <div key={key} className="bg-gray-50 rounded-lg p-3 border border-gray-100">
                <div className="text-xs text-gray-400 mb-1 truncate">{key.replace(/_/g, ' ')}</div>
                <div className="text-sm font-medium text-gray-900 break-words">{formatDataValue(val)}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Related Completions */}
      {(completion.related_completions ?? []).length > 0 && (
        <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold text-gray-900">Other Runs of {completion.app_name}</h2>
            <Link
              to={`/apps/${completion.app_id}/history`}
              className="text-xs text-blue-600 hover:text-blue-700 flex items-center gap-1"
            >
              View all history <ChevronRight size={12} />
            </Link>
          </div>
          <div className="space-y-2">
            {completion.related_completions.slice(0, 5).map(rel => {
              const relBadge = statusBadge(rel.status);
              const isCurrent = rel.id === completion.id;
              return (
                <Link
                  key={rel.id}
                  to={`/completions/${rel.id}`}
                  className={`flex items-center gap-4 p-3 rounded-lg border transition-colors ${
                    isCurrent
                      ? 'bg-blue-50 border-blue-200 cursor-default pointer-events-none'
                      : 'bg-gray-50 border-gray-100 hover:border-gray-200 hover:bg-gray-100'
                  }`}
                >
                  <span className="font-mono text-xs text-gray-400 w-20 flex-shrink-0">#{shortId(rel.id)}</span>
                  <div className="flex items-center gap-1.5 text-xs text-gray-600 flex-1">
                    <User size={11} />
                    {rel.operator_name || 'Unknown'}
                  </div>
                  <span className="text-xs text-gray-500 flex-shrink-0">{fmtTimeAgo(rel.completed_at)}</span>
                  <span className="text-xs text-gray-700 font-mono flex-shrink-0">{fmtDuration(rel.total_duration_seconds)}</span>
                  <span className={`text-xs font-medium px-2 py-0.5 rounded-full flex-shrink-0 ${relBadge.cls}`}>{relBadge.label}</span>
                  {isCurrent && (
                    <span className="text-xs text-blue-600 font-semibold flex-shrink-0">← current</span>
                  )}
                </Link>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Small Shared Components ───────────────────────────────────────────────────

function MetaItem({ icon, label, value, highlight }: {
  icon: React.ReactNode;
  label: string;
  value: string;
  highlight?: boolean;
}) {
  return (
    <div>
      <div className="flex items-center gap-1.5 text-xs text-gray-400 mb-0.5">
        {icon}
        {label}
      </div>
      <div className={`text-sm font-semibold ${highlight ? 'text-blue-600' : 'text-gray-900'}`}>{value}</div>
    </div>
  );
}

import { useEffect, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { api } from '../api/client';
import {
  fmtDuration, fmtDateTime, fmtRelative, durationBasisLabel, durationBasisNote,
} from '../components/apps/appModel';
import {
  ArrowLeft, CheckCircle2, XCircle, Clock, User, Calendar,
  Package, ChevronRight, BarChart2, Layers, ExternalLink
} from 'lucide-react';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  CartesianGrid, Cell, ReferenceLine
} from 'recharts';

// ── Types ─────────────────────────────────────────────────────────────────────

// Every duration below is SECONDS and says so in its name, and every one of
// them is nullable — a step nobody timed, or a takt nobody configured, is
// unknown, not zero. See backend/src/cycleTime.js for the model.
interface StepBreakdown {
  step_id: string;
  step_name: string;
  step_order: number;
  duration_seconds: number | null;
  takt_seconds: number | null;
  variance_pct: number | null;
  status: 'under' | 'on_target' | 'over' | 'unknown';
}

interface CompletionDetail {
  id: string;
  app_id: string;
  app_name: string;
  operator_name: string;
  station_id: string | null;
  station_name: string | null;
  started_at: string;
  completed_at: string | null;
  status: 'in_progress' | 'completed' | 'abandoned';
  /** The canonical run duration. Null when this run was never timed. */
  total_duration_seconds: number | null;
  /** Which measurement the total is — the page labels it rather than leaving
   *  a customer to guess why another screen shows a different number. */
  duration_basis: 'hands_on' | 'elapsed' | null;
  hands_on_seconds: number | null;
  elapsed_seconds: number | null;
  elapsed_so_far_seconds: number | null;
  work_order_id: string | null;
  work_order_number: string | null;
  step_breakdown: StepBreakdown[];
  captured_data: Record<string, unknown>;
  related_completions: Array<{
    id: string;
    operator_name: string;
    started_at: string;
    completed_at: string | null;
    total_duration_seconds: number | null;
    duration_basis: 'hands_on' | 'elapsed' | null;
    status: string;
  }>;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

// Durations, timestamps and relative times all come from the shared model.
// This page used to declare its own `fmtDuration`, whose `if (!seconds)` guard
// turned a real zero-length takt into "—", and read SQLite's zone-less
// timestamps as local time.
const fmtTimeAgo = fmtRelative;

function shortId(id: string) {
  return id.slice(0, 8).toUpperCase();
}

function stepBarColor(status: string) {
  if (status === 'under')     return '#22c55e';
  if (status === 'on_target') return '#3b82f6';
  // No takt was ever set for this step, so there is no verdict to paint. Grey
  // says "not measured against anything"; red would accuse it of missing a
  // target nobody set.
  if (status === 'unknown')   return '#cbd5e1';
  return '#ef4444';
}

function statusBadge(status: string) {
  if (status === 'completed')  return { label: 'Completed',  cls: 'bg-green-100 text-green-700' };
  if (status === 'in_progress') return { label: 'In Progress', cls: 'bg-blue-100 text-blue-700' };
  if (status === 'abandoned')  return { label: 'Abandoned',  cls: 'bg-red-100 text-red-700' };
  return { label: status, cls: 'bg-gray-100 text-gray-600' };
}

function variancePctLabel(pct: number | null | undefined) {
  // A run or step with no takt baseline has no variance. Calling .toFixed on the
  // resulting undefined crashed the whole Completion Detail page (a hard
  // ErrorBoundary) for that very common data shape — guard it and show a dash.
  if (pct === null || pct === undefined || Number.isNaN(pct)) return { text: '—', cls: 'text-gray-400' };
  if (pct <= 0) return { text: `${Math.abs(pct).toFixed(0)}% under`, cls: 'text-green-600' };
  if (pct <= 10) return { text: `+${pct.toFixed(0)}%`, cls: 'text-amber-600' };
  return { text: `+${pct.toFixed(0)}% over`, cls: 'text-red-600' };
}

function stepStatusIcon(status: string) {
  if (status === 'under')     return <CheckCircle2 size={14} className="text-green-500" />;
  if (status === 'on_target') return <CheckCircle2 size={14} className="text-blue-500" />;
  if (status === 'unknown')   return <span className="text-gray-300" title="no takt configured for this step">—</span>;
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
          <span className="font-medium text-gray-900">
            {d.takt_seconds === null ? <span className="text-gray-400" title="no takt configured">—</span> : fmtDuration(d.takt_seconds)}
          </span>
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
    api.getCompletionDetail(id)
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
  const basisLabel = durationBasisLabel(completion.duration_basis);
  // The measurement the headline is NOT showing, so both are on screen and a
  // customer can see they are two facts rather than two answers.
  const otherMeasurement = completion.duration_basis === 'hands_on'
    ? (completion.elapsed_seconds === null
        ? 'wall clock not recorded'
        : `${fmtDuration(completion.elapsed_seconds)} wall clock, start to finish`)
    : (completion.hands_on_seconds === null
        ? 'no step timers recorded on this run'
        : `${fmtDuration(completion.hands_on_seconds)} hands-on`);
  const capturedEntries = Object.entries(completion.captured_data ?? {});
  // Only steps that were actually timed can be plotted. A step with no recorded
  // time is absent from the chart rather than drawn as a zero-length bar.
  const chartData = steps
    .filter(s => s.duration_seconds !== null)
    .map(s => ({
      ...s,
      duration_minutes: parseFloat(((s.duration_seconds as number) / 60).toFixed(2)),
      takt_minutes: s.takt_seconds === null ? null : parseFloat((s.takt_seconds / 60).toFixed(2)),
    }));
  const taktMinutes = steps.map(s => s.takt_seconds).filter((t): t is number => t !== null).map(t => t / 60);
  // No takt anywhere ⇒ no reference line, rather than a line drawn at zero.
  const maxTakt = taktMinutes.length > 0 ? Math.max(...taktMinutes) : null;

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
          {/* Two different measurements of one run genuinely exist, so this
              names which one it is showing and offers the other beside it.
              Unlabelled, the gap between them reads as the system contradicting
              itself. */}
          <MetaItem
            icon={<Clock size={14} className="text-gray-400" />}
            label={`Total Duration${basisLabel ? ` · ${basisLabel}` : ''}`}
            value={completion.total_duration_seconds === null ? '—' : fmtDuration(completion.total_duration_seconds)}
            note={completion.total_duration_seconds === null
              ? 'this run was never timed'
              : otherMeasurement}
            title={durationBasisNote(completion.duration_basis)}
            highlight
          />
          {completion.work_order_number && (
            <MetaItem icon={<Package size={14} className="text-gray-400" />} label="Work Order" value={completion.work_order_number} />
          )}
          {completion.completed_at ? (
            <MetaItem icon={<Calendar size={14} className="text-gray-400" />} label="Completed" value={fmtDateTime(completion.completed_at)} />
          ) : (
            <MetaItem
              icon={<Clock size={14} className="text-gray-400" />}
              label="Running for"
              value={completion.elapsed_so_far_seconds === null ? '—' : fmtDuration(completion.elapsed_so_far_seconds)}
              note="elapsed so far — this run has not finished"
            />
          )}
          {completion.station_id && (
            /* The station's NAME. The id is the join key, not something to show
               a person — this field used to print a raw UUID. */
            <MetaItem
              icon={<Layers size={14} className="text-gray-400" />}
              label="Station"
              value={completion.station_name || 'Unknown station'}
              note={completion.station_name ? undefined : 'the station this ran on no longer exists'}
            />
          )}
        </div>
      </div>

      {/* Step Performance */}
      {steps.length > 0 && (
        <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-6 space-y-5">
          <div className="flex items-center gap-2">
            <BarChart2 size={16} className="text-gray-500" />
            <h2 className="font-semibold text-gray-900">Step Performance</h2>
            <span className="text-xs text-gray-400">· hands-on time per step</span>
          </div>

          {/* Bar chart — only over the steps that were actually timed. */}
          {chartData.length > 0 && (
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
                {maxTakt !== null && (
                  <ReferenceLine x={maxTakt} stroke="#f59e0b" strokeDasharray="4 4" strokeWidth={1.5} label={{ value: 'Takt', fill: '#f59e0b', fontSize: 10, position: 'top' }} />
                )}
                <Bar dataKey="duration_minutes" radius={[0, 3, 3, 0]} maxBarSize={20}>
                  {chartData.map((entry, index) => (
                    <Cell key={index} fill={stepBarColor(entry.status)} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
          )}

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
                      <td className="px-3 py-2.5 text-xs text-gray-700 tabular-nums font-mono">
                        {step.duration_seconds === null
                          ? <span className="text-gray-400" title="this step was never timed">—</span>
                          : fmtDuration(step.duration_seconds)}
                      </td>
                      <td className="px-3 py-2.5 text-xs text-gray-500 tabular-nums font-mono">
                        {step.takt_seconds === null
                          ? <span className="text-gray-400" title="no takt configured for this step">—</span>
                          : fmtDuration(step.takt_seconds)}
                      </td>
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
            <div>
              <h2 className="font-semibold text-gray-900">Other Runs of {completion.app_name}</h2>
              <p className="text-xs text-gray-400 mt-0.5">
                Hands-on time where a run recorded step timers, wall clock otherwise — the same number App History shows.
              </p>
            </div>
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
                  <span className="text-xs text-gray-500 flex-shrink-0">{fmtTimeAgo(rel.completed_at ?? rel.started_at)}</span>
                  <span
                    className={`text-xs font-mono flex-shrink-0 ${rel.total_duration_seconds === null ? 'text-gray-400' : 'text-gray-700'}`}
                    title={durationBasisNote(rel.duration_basis)}
                  >
                    {rel.total_duration_seconds === null ? '—' : fmtDuration(rel.total_duration_seconds)}
                  </span>
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

function MetaItem({ icon, label, value, note, title, highlight }: {
  icon: React.ReactNode;
  label: string;
  value: string;
  /** The short honest reason under the value — why it reads "—", or what a
   *  real value was measured against. */
  note?: string;
  title?: string;
  highlight?: boolean;
}) {
  return (
    <div title={title}>
      <div className="flex items-center gap-1.5 text-xs text-gray-400 mb-0.5">
        {icon}
        {label}
      </div>
      <div className={`text-sm font-semibold ${value === '—' ? 'text-gray-400' : highlight ? 'text-blue-600' : 'text-gray-900'}`}>{value}</div>
      {note && <div className="text-[11px] text-gray-400 mt-0.5">{note}</div>}
    </div>
  );
}

import { useEffect, useMemo, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { api, AppAnalyticsResponse, AppAnalyticsField, AppAnalyticsParams } from '../api/client';
import { useToast } from '../context/ToastContext';
import { useAuth } from '../context/AuthContext';
import { markTrainingDataSeen } from '../components/apps/useAppTraining';
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

// ── Formatting helpers (same conventions as AppHistory) ───────────────────────

const ACCENT = '#6366f1';
const GOOD = '#22c55e';
const BAD = '#ef4444';

function fmtDuration(seconds: number | null | undefined) {
  if (seconds === null || seconds === undefined || seconds < 0) return '—';
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
  if (status === 'completed') return { label: 'Completed', cls: 'bg-green-100 text-green-700' };
  if (status === 'abandoned') return { label: 'Abandoned', cls: 'bg-red-100 text-red-700' };
  if (status === 'in_progress') return { label: 'In Progress', cls: 'bg-blue-100 text-blue-700' };
  return { label: status, cls: 'bg-gray-100 text-gray-600' };
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

// ── Page ──────────────────────────────────────────────────────────────────────

export default function AppAnalytics() {
  const { id: appId } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { addToast } = useToast();
  const { user } = useAuth();
  // Leave the floating training coach a lane instead of covering a chart.
  const coachDocked = useCoachDocked();

  const [days, setDays] = useState(30);
  const [operator, setOperator] = useState('');
  const [workOrderId, setWorkOrderId] = useState('');
  const [productTypeId, setProductTypeId] = useState('');

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

  useEffect(() => {
    if (!appId) return;
    let cancelled = false;
    setLoading(true);
    api.getAppAnalytics(appId, filterParams)
      .then(res => { if (!cancelled) { setData(res); setError(null); } })
      .catch((e: any) => { if (!cancelled) setError(e.message ?? 'Failed to load analytics'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [appId, filterParams]);

  // Looking at what a run captured is the last milestone of the builder-first
  // training — and it is only true once there is something here to look at.
  useEffect(() => {
    if ((data?.totals.runs ?? 0) > 0) markTrainingDataSeen(user?.id);
  }, [data?.totals.runs, user?.id]);

  // App takt (sum of per-step takt) for the "avg cycle vs takt" comparison.
  useEffect(() => {
    if (!appId) return;
    api.getApp(appId)
      .then(app => {
        const total = (app.steps ?? []).reduce((s: number, st: any) => s + (Number(st?.takt_time_seconds) || 0), 0);
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
      <div className="min-h-screen bg-[#f8fafc] flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
          <span className="text-gray-500 text-sm">Loading analytics...</span>
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

  const { totals, series, fields, filter_options: opts, recent_runs: recent } = data;
  const avgVsTakt = taktTotalS > 0 && totals.avg_duration_s !== null
    ? totals.avg_duration_s - taktTotalS : null;

  const seriesData = series.map(s => ({ ...s, day: fmtDay(s.date) }));
  const durationData = seriesData.filter(s => s.avg_duration_s !== null);

  return (
    <div className={`min-h-screen bg-[#f8fafc] p-6 space-y-6 transition-[padding] ${coachDocked ? 'lg:pr-[392px]' : ''}`}>
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
            <p className="text-gray-500 text-xs mt-0.5">App Analytics · last {data.days} days</p>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
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
      <div className="bg-white rounded-2xl border border-gray-200 shadow-sm px-4 py-3 flex items-center gap-3 flex-wrap">
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
        {loading && <RefreshCw size={13} className="animate-spin text-gray-400 ml-auto" />}
      </div>

      {totals.runs === 0 ? (
        <div className="bg-white rounded-2xl border border-gray-200 shadow-sm py-20 text-center">
          <Activity size={40} className="mx-auto mb-4 text-gray-300" />
          {hasFilters ? (
            <>
              <p className="font-medium text-gray-600">No runs match these filters</p>
              <p className="text-sm text-gray-400 mt-1">Try widening the date range or clearing a filter.</p>
            </>
          ) : (
            <>
              <p className="font-medium text-gray-600">No data yet</p>
              <p className="text-sm text-gray-400 mt-1">Run this app in the Player to start collecting data.</p>
              <Link to={`/play/${appId}`} className="btn-primary inline-flex mt-4">
                <Play size={14} /> Run App
              </Link>
            </>
          )}
        </div>
      ) : (
        <>
          {/* KPI stat row */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <KPI icon={<Activity size={18} className="text-blue-600" />} bg="bg-blue-50"
              label="Runs" value={totals.runs}
              sub={`${totals.abandoned} abandoned`} />
            <KPI icon={<CheckCircle2 size={18} className="text-green-600" />} bg="bg-green-50"
              label="Completions" value={totals.completed}
              sub={totals.runs > 0 ? `${Math.round((totals.completed / totals.runs) * 100)}% of runs` : undefined} />
            <KPI icon={<Clock size={18} className="text-purple-600" />} bg="bg-purple-50"
              label="Avg Cycle" value={fmtDuration(totals.avg_duration_s)}
              sub={avgVsTakt !== null
                ? `${avgVsTakt > 0 ? '+' : '−'}${fmtDuration(Math.abs(avgVsTakt))} vs takt ${fmtDuration(taktTotalS)}`
                : taktTotalS > 0 ? `takt ${fmtDuration(taktTotalS)}` : undefined}
              subColor={avgVsTakt !== null ? (avgVsTakt > 0 ? 'text-red-600' : 'text-green-600') : undefined} />
            <KPI
              icon={<TrendingUp size={18} className={yieldColor(totals.first_pass_yield)} />}
              bg={yieldBg(totals.first_pass_yield)}
              label="First-Pass Yield"
              value={totals.first_pass_yield === null ? '—' : `${totals.first_pass_yield.toFixed(0)}%`}
              valueColor={yieldColor(totals.first_pass_yield)}
              sub={totals.first_pass_yield === null ? 'no pass/fail checks recorded' : undefined} />
          </div>

          {/* Completions over time + duration trend */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-5">
              <div className="flex items-center gap-2 mb-3">
                <BarChart2 size={16} className="text-gray-500" />
                <h2 className="font-semibold text-gray-900">Completions Over Time</h2>
              </div>
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={seriesData} margin={{ left: 0, right: 8, top: 8, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" vertical={false} />
                  <XAxis dataKey="day" tick={{ fontSize: 10 }} />
                  <YAxis tick={{ fontSize: 11 }} allowDecimals={false} width={32} />
                  <Tooltip content={<ChartTip format={(v: number) => `${v} completed`} />} cursor={{ fill: 'rgba(99,102,241,0.06)' }} />
                  <Bar dataKey="completed" fill={ACCENT} radius={[3, 3, 0, 0]} maxBarSize={28} />
                </BarChart>
              </ResponsiveContainer>
            </div>

            <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-5">
              <div className="flex items-center gap-2 mb-3">
                <Clock size={16} className="text-gray-500" />
                <h2 className="font-semibold text-gray-900">Avg Cycle Time by Day</h2>
              </div>
              {durationData.length === 0 ? (
                <div className="h-[220px] flex items-center justify-center text-sm text-gray-400">
                  No completed runs with durations in range
                </div>
              ) : (
                <ResponsiveContainer width="100%" height={220}>
                  <LineChart data={durationData} margin={{ left: 8, right: 12, top: 8, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                    <XAxis dataKey="day" tick={{ fontSize: 10 }} />
                    <YAxis tick={{ fontSize: 11 }} tickFormatter={v => fmtDuration(v)} width={52} />
                    <Tooltip content={<ChartTip format={(v: number) => fmtDuration(v)} />} />
                    <Line type="monotone" dataKey="avg_duration_s" stroke={ACCENT} strokeWidth={2}
                      dot={{ r: 3, fill: ACCENT }} activeDot={{ r: 5 }} />
                  </LineChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>

          {/* Operators */}
          {data.by_operator.length > 0 && (
            <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-5">
              <div className="flex items-center gap-2 mb-4">
                <User size={16} className="text-gray-500" />
                <h2 className="font-semibold text-gray-900">Runs by Operator</h2>
              </div>
              <BarList
                rows={data.by_operator.map(o => ({
                  label: o.operator_name || 'Unknown',
                  count: o.runs,
                  extra: `avg ${fmtDuration(o.avg_duration_s)}`,
                }))}
              />
            </div>
          )}

          {/* Per-field visuals */}
          {fields.length > 0 && (
            <div>
              <div className="flex items-center gap-2 mb-3">
                <ListChecks size={16} className="text-gray-500" />
                <h2 className="font-semibold text-gray-900">Captured Fields</h2>
                <span className="text-xs text-gray-400">({fields.length})</span>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                {fields.map(f => <FieldCard key={f.widget_id} field={f} />)}
              </div>
            </div>
          )}

          {/* Recent runs */}
          <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
            <div className="flex items-center gap-2 px-5 py-4 border-b border-gray-200">
              <Calendar size={15} className="text-gray-400" />
              <h2 className="font-semibold text-gray-900">Recent Runs</h2>
              <span className="text-xs text-gray-400">(latest {recent.length})</span>
              <Link to={`/apps/${appId}/history`} className="ml-auto text-xs text-indigo-600 hover:text-indigo-800 font-medium flex items-center gap-0.5">
                Full history <ChevronRight size={12} />
              </Link>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 border-b border-gray-200">
                  <tr>
                    {['Started', 'Operator', 'Duration', 'Work Order', 'Product Type', 'Status', ''].map(h => (
                      <th key={h} className="text-left text-xs font-medium text-gray-500 uppercase tracking-wide px-4 py-3">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {recent.map(r => {
                    const badge = statusBadge(r.status);
                    return (
                      <tr key={r.id} className="hover:bg-gray-50 transition-colors cursor-pointer"
                        onClick={() => navigate(`/completions/${r.id}`)}>
                        <td className="px-4 py-3 text-xs text-gray-600 whitespace-nowrap">{fmtDate(r.started_at)}</td>
                        <td className="px-4 py-3 text-xs text-gray-700">
                          <div className="flex items-center gap-1.5">
                            <User size={11} className="text-gray-400 flex-shrink-0" />
                            {r.operator_name || '—'}
                          </div>
                        </td>
                        <td className="px-4 py-3 text-xs font-mono font-medium text-gray-900 tabular-nums">{fmtDuration(r.duration_s)}</td>
                        <td className="px-4 py-3 text-xs text-gray-600">
                          {r.work_order_number ? (
                            <span className="flex items-center gap-1 text-blue-600"><Package size={11} /> {r.work_order_number}</span>
                          ) : <span className="text-gray-400">—</span>}
                        </td>
                        <td className="px-4 py-3 text-xs text-gray-600">{r.product_type_name || <span className="text-gray-400">—</span>}</td>
                        <td className="px-4 py-3">
                          <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${badge.cls}`}>{badge.label}</span>
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
        {sub && <div className={`text-[11px] mt-0.5 truncate ${subColor ?? 'text-gray-400'}`}>{sub}</div>}
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
    <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-4">
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
            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
            <XAxis dataKey="day" tick={{ fontSize: 9 }} />
            <YAxis tick={{ fontSize: 10 }} width={36} domain={['auto', 'auto']} />
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

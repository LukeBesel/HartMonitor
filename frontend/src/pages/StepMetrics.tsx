import { useEffect, useState } from 'react';
import { api } from '../api/client';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  LineChart, Line, ReferenceLine, Legend
} from 'recharts';
import { Timer, TrendingUp, AlertTriangle, ChevronDown, RefreshCw, CheckCircle } from 'lucide-react';

function Skeleton({ className }: { className?: string }) {
  return <div className={`animate-pulse bg-gray-200 rounded ${className ?? ''}`} />;
}

interface StepStat {
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
  trend: { date: string; avg_seconds: number; count: number }[];
}

interface StepMetricsData {
  app_id: string;
  app_name: string;
  total_completions: number;
  steps: StepStat[];
}

function fmt(seconds: number): string {
  if (!seconds) return '—';
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

function StatusBadge({ pct, takt }: { pct: number; takt: number }) {
  if (!takt) return <span className="text-xs text-gray-400">No takt</span>;
  if (pct === 0) return <span className="text-xs font-medium text-green-600 bg-green-50 px-2 py-0.5 rounded-full">All In Takt</span>;
  if (pct < 10) return <span className="text-xs font-medium text-amber-600 bg-amber-50 px-2 py-0.5 rounded-full">{pct}% Over Takt</span>;
  return <span className="text-xs font-medium text-red-600 bg-red-50 px-2 py-0.5 rounded-full border border-red-200">{pct}% Over Takt</span>;
}

function StepCard({ step, expanded, onToggle }: { step: StepStat; expanded: boolean; onToggle: () => void }) {
  const hasTakt = step.takt_seconds > 0;
  const avgVsTakt = hasTakt ? step.avg_seconds / step.takt_seconds : 0;
  const barColor = !hasTakt ? '#6b7280' : avgVsTakt <= 0.8 ? '#10b981' : avgVsTakt <= 1 ? '#3b82f6' : avgVsTakt <= 1.2 ? '#f59e0b' : '#ef4444';

  const barData = [
    { label: 'Min', value: step.min_seconds, fill: '#10b981' },
    { label: 'Avg', value: step.avg_seconds, fill: barColor },
    { label: 'P95', value: step.p95_seconds, fill: '#f59e0b' },
    { label: 'Max', value: step.max_seconds, fill: '#ef4444' },
    ...(hasTakt ? [{ label: 'Takt', value: step.takt_seconds, fill: '#6366f1' }] : []),
  ];

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
      {/* Card header */}
      <div
        className="flex items-center gap-4 p-4 cursor-pointer hover:bg-gray-50 transition-colors"
        onClick={onToggle}
      >
        <div className="w-8 h-8 rounded-full bg-blue-100 text-blue-700 text-sm font-bold flex items-center justify-center flex-shrink-0">
          {step.index + 1}
        </div>
        <div className="flex-1 min-w-0">
          <div className="font-semibold text-gray-900 text-sm truncate">{step.name}</div>
          <div className="text-xs text-gray-400 mt-0.5">{step.completions} runs recorded</div>
        </div>
        <div className="hidden md:flex items-center gap-6 text-center">
          <div>
            <div className="text-lg font-bold text-gray-900">{fmt(step.avg_seconds)}</div>
            <div className="text-xs text-gray-400">Avg</div>
          </div>
          <div>
            <div className="text-lg font-bold text-green-600">{fmt(step.min_seconds)}</div>
            <div className="text-xs text-gray-400">Best</div>
          </div>
          <div>
            <div className="text-lg font-bold text-red-500">{fmt(step.max_seconds)}</div>
            <div className="text-xs text-gray-400">Max</div>
          </div>
          {hasTakt && (
            <div>
              <div className="text-lg font-bold text-indigo-600">{fmt(step.takt_seconds)}</div>
              <div className="text-xs text-gray-400">Takt</div>
            </div>
          )}
        </div>
        <StatusBadge pct={step.over_takt_pct} takt={step.takt_seconds} />
        <ChevronDown size={16} className={`text-gray-400 transition-transform flex-shrink-0 ${expanded ? 'rotate-180' : ''}`} />
      </div>

      {/* Takt bar if set */}
      {hasTakt && (
        <div className="px-4 pb-2">
          <div className="flex items-center justify-between text-xs text-gray-400 mb-1">
            <span>Avg vs takt</span>
            <span style={{ color: barColor }}>{Math.round(avgVsTakt * 100)}%</span>
          </div>
          <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
            <div
              className="h-full rounded-full transition-all"
              style={{ width: `${Math.min(100, avgVsTakt * 100)}%`, backgroundColor: barColor }}
            />
          </div>
        </div>
      )}

      {/* Expanded content */}
      {expanded && (
        <div className="border-t border-gray-100 p-4 space-y-4 bg-gray-50">
          {/* Mobile stats */}
          <div className="md:hidden grid grid-cols-4 gap-2 text-center">
            {barData.map(d => (
              <div key={d.label} className="bg-white rounded-lg p-2 border border-gray-200">
                <div className="font-bold text-sm" style={{ color: d.fill }}>{fmt(d.value)}</div>
                <div className="text-xs text-gray-400">{d.label}</div>
              </div>
            ))}
          </div>

          {/* Bar chart comparison */}
          <div>
            <div className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Time Breakdown</div>
            <ResponsiveContainer width="100%" height={120}>
              <BarChart data={barData} layout="vertical" margin={{ left: 0, right: 40, top: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                <XAxis type="number" tickFormatter={fmt} tick={{ fontSize: 10 }} />
                <YAxis type="category" dataKey="label" tick={{ fontSize: 11 }} width={30} />
                <Tooltip formatter={(v: any) => [fmt(Number(v)), 'Time']} />
                <Bar dataKey="value" fill="#3b82f6" radius={[0, 4, 4, 0]}>
                  {barData.map((d, i) => (
                    <rect key={i} fill={d.fill} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* Trend chart */}
          {(step.trend ?? []).length > 1 && (
            <div>
              <div className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Daily Average Trend</div>
              <ResponsiveContainer width="100%" height={150}>
                <LineChart data={step.trend} margin={{ left: 0, right: 20, top: 5, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="date" tick={{ fontSize: 10 }} tickFormatter={d => d.slice(5)} />
                  <YAxis tick={{ fontSize: 10 }} tickFormatter={fmt} />
                  <Tooltip formatter={(v: any) => [fmt(Number(v)), 'Avg Time']} labelFormatter={d => `Date: ${d}`} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  {hasTakt && (
                    <ReferenceLine y={step.takt_seconds} stroke="#6366f1" strokeDasharray="4 2" label={{ value: 'Takt', fill: '#6366f1', fontSize: 10 }} />
                  )}
                  <Line
                    type="monotone" dataKey="avg_seconds" stroke={barColor}
                    dot={false} strokeWidth={2} name="Avg Seconds"
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* Over takt summary */}
          {hasTakt && step.over_takt_count > 0 && (
            <div className="flex items-start gap-2 p-3 bg-amber-50 border border-amber-200 rounded-lg text-sm">
              <AlertTriangle size={15} className="text-amber-600 flex-shrink-0 mt-0.5" />
              <div className="text-amber-700">
                <span className="font-semibold">{step.over_takt_count} runs</span> ({step.over_takt_pct}%) exceeded takt time of {fmt(step.takt_seconds)}
              </div>
            </div>
          )}
          {hasTakt && step.over_takt_count === 0 && step.completions > 0 && (
            <div className="flex items-center gap-2 p-3 bg-green-50 border border-green-200 rounded-lg text-sm">
              <CheckCircle size={15} className="text-green-600" />
              <span className="text-green-700 font-medium">All runs completed within takt time</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// Reusable per-step metrics body for a single app/operation. Owns its own data
// fetch so it can be embedded anywhere (the standalone Step Metrics page and the
// Operation Analytics drill-down) by passing an appId + lookback window.
export function StepMetricsPanel({ appId, days }: { appId: string; days: number }) {
  const [data, setData] = useState<StepMetricsData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [expandedSteps, setExpandedSteps] = useState<Set<number>>(new Set());

  useEffect(() => {
    if (!appId) { setData(null); return; }
    setLoading(true);
    setError(null);
    setExpandedSteps(new Set());
    api.getStepMetrics(appId, days)
      .then(setData)
      .catch((err: any) => setError(err.message || 'Failed to load step metrics'))
      .finally(() => setLoading(false));
  }, [appId, days, reloadKey]);

  const toggleStep = (idx: number) => {
    setExpandedSteps(prev => {
      const next = new Set(prev);
      next.has(idx) ? next.delete(idx) : next.add(idx);
      return next;
    });
  };

  const expandAll = () => setExpandedSteps(new Set(data?.steps.map(s => s.index) ?? []));
  const collapseAll = () => setExpandedSteps(new Set());

  const totalOverTakt = data?.steps.reduce((s, step) => s + step.over_takt_count, 0) ?? 0;
  const stepsWithTakt = data?.steps.filter(s => s.takt_seconds > 0) ?? [];
  const avgTaktAdherence = stepsWithTakt.length > 0
    ? Math.round(stepsWithTakt.reduce((s, step) => s + (100 - step.over_takt_pct), 0) / stepsWithTakt.length)
    : 100;

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <RefreshCw size={28} className="animate-spin text-blue-500" />
      </div>
    );
  }
  if (error) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <AlertTriangle size={32} className="text-red-400 mb-3" />
        <p className="text-gray-500 font-medium">Couldn't load step metrics</p>
        <p className="text-gray-400 text-sm mt-1">{error}</p>
        <button onClick={() => setReloadKey(k => k + 1)} className="btn-secondary mt-4">
          <RefreshCw size={14} /> Retry
        </button>
      </div>
    );
  }
  if (!data) {
    return <div className="text-center py-16 text-gray-400">Select an app to view step metrics</div>;
  }

  return (
    <div className="space-y-6">
      {/* KPI summary */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4">
          <div className="text-2xl font-bold text-gray-900">{data.total_completions}</div>
          <div className="text-xs text-gray-500 mt-0.5">Total Runs Analyzed</div>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4">
          <div className="text-2xl font-bold text-gray-900">{data.steps.length}</div>
          <div className="text-xs text-gray-500 mt-0.5">Steps in Process</div>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4">
          <div className="text-2xl font-bold text-amber-600">{totalOverTakt}</div>
          <div className="text-xs text-gray-500 mt-0.5">Takt Time Exceedances</div>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4">
          <div className={`text-2xl font-bold ${avgTaktAdherence >= 90 ? 'text-green-600' : avgTaktAdherence >= 75 ? 'text-amber-600' : 'text-red-500'}`}>
            {avgTaktAdherence}%
          </div>
          <div className="text-xs text-gray-500 mt-0.5">Takt Adherence</div>
        </div>
      </div>

      {/* Step overview bar chart */}
      {data.steps.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
          <div className="flex items-center justify-between mb-4">
            <div className="text-sm font-semibold text-gray-900">Average Time Per Step</div>
            <div className="flex items-center gap-4 text-xs text-gray-500">
              <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-sm bg-blue-500 inline-block" />Avg Time</span>
              <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-sm bg-indigo-500 inline-block" />Takt Time</span>
            </div>
          </div>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart
              data={data.steps.map(s => ({
                name: s.name.length > 12 ? s.name.slice(0, 12) + '…' : s.name,
                avg: s.avg_seconds,
                takt: s.takt_seconds || undefined,
              }))}
              margin={{ top: 5, right: 20, left: 10, bottom: 5 }}
            >
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="name" tick={{ fontSize: 11 }} />
              <YAxis tickFormatter={fmt} tick={{ fontSize: 10 }} />
              <Tooltip formatter={(v: any, name: string) => [fmt(Number(v)), name === 'avg' ? 'Avg Time' : 'Takt Time']} />
              <Bar dataKey="avg" fill="#3b82f6" radius={[4, 4, 0, 0]} name="Avg" />
              <Bar dataKey="takt" fill="#6366f1" radius={[4, 4, 0, 0]} name="Takt" opacity={0.7} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Steps list */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-base font-semibold text-gray-900">Step Breakdown</h2>
          <div className="flex items-center gap-2">
            <button onClick={expandAll} className="text-xs text-blue-600 hover:text-blue-700">Expand All</button>
            <span className="text-gray-300">|</span>
            <button onClick={collapseAll} className="text-xs text-gray-500 hover:text-gray-700">Collapse All</button>
          </div>
        </div>
        <div className="space-y-3">
          {data.steps.map(step => (
            <StepCard
              key={step.index}
              step={step}
              expanded={expandedSteps.has(step.index)}
              onToggle={() => toggleStep(step.index)}
            />
          ))}
        </div>
      </div>

      {data.steps.length === 0 && (
        <div className="text-center py-16 text-gray-400">
          <TrendingUp size={32} className="mx-auto mb-2 text-gray-300" />
          No completion data yet for this app
        </div>
      )}
    </div>
  );
}

export default function StepMetrics() {
  const [apps, setApps] = useState<{ id: string; name: string }[]>([]);
  const [selectedAppId, setSelectedAppId] = useState('');
  const [days, setDays] = useState(30);
  const [appsLoading, setAppsLoading] = useState(true);
  const [appsError, setAppsError] = useState<string | null>(null);

  const loadApps = () => {
    setAppsLoading(true);
    setAppsError(null);
    api.getApps()
      .then((list: any[]) => {
        const published = list.filter(a => a.status === 'published');
        setApps(published);
        if (published.length > 0) setSelectedAppId(published[0].id);
      })
      .catch((err: any) => setAppsError(err.message || 'Failed to load apps'))
      .finally(() => setAppsLoading(false));
  };

  useEffect(() => { loadApps(); }, []);

  return (
    <div className="min-h-screen bg-[#f8fafc] p-6 space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-4">
        <div>
          <div className="flex items-center gap-2">
            <Timer size={20} className="text-blue-600" />
            <h1 className="text-2xl font-bold text-gray-900">Step Metrics</h1>
          </div>
          <p className="text-gray-500 text-sm mt-0.5">Analyze per-step timing performance across all completed runs</p>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <select
            className="h-9 border border-gray-200 rounded-lg px-3 text-sm bg-white shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            value={selectedAppId}
            onChange={e => setSelectedAppId(e.target.value)}
          >
            {apps.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
          <select
            className="h-9 border border-gray-200 rounded-lg px-3 text-sm bg-white shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            value={days}
            onChange={e => setDays(Number(e.target.value))}
          >
            <option value={7}>Last 7 days</option>
            <option value={30}>Last 30 days</option>
            <option value={60}>Last 60 days</option>
            <option value={90}>Last 90 days</option>
          </select>
        </div>
      </div>

      {appsLoading ? (
        <div className="space-y-6">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {[0, 1, 2, 3].map(i => <Skeleton key={i} className="h-20" />)}
          </div>
          <Skeleton className="h-64" />
        </div>
      ) : appsError ? (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <AlertTriangle size={32} className="text-red-400 mb-3" />
          <p className="text-gray-500 font-medium">Couldn't load apps</p>
          <p className="text-gray-400 text-sm mt-1">{appsError}</p>
          <button onClick={loadApps} className="btn-secondary mt-4">
            <RefreshCw size={14} /> Retry
          </button>
        </div>
      ) : apps.length === 0 ? (
        <div className="text-center py-16">
          <Timer size={32} className="mx-auto mb-3 text-gray-300" />
          <p className="text-gray-500 font-medium">No published apps yet</p>
          <p className="text-gray-400 text-sm mt-1">Publish an app and complete a few runs to see step metrics here</p>
        </div>
      ) : selectedAppId ? (
        <StepMetricsPanel appId={selectedAppId} days={days} />
      ) : (
        <div className="text-center py-16 text-gray-400">Select an app to view step metrics</div>
      )}
    </div>
  );
}

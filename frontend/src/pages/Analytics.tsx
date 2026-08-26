import { useEffect, useState } from 'react';
import { api, AnalyticsFilters } from '../api/client';
import { AnalyticsOverview } from '../types';
import {
  AreaChart, Area, BarChart, Bar, LineChart, Line, XAxis, YAxis,
  Tooltip, ResponsiveContainer, CartesianGrid, Legend, PieChart, Pie, Cell
} from 'recharts';
import { TrendingUp, CheckCircle, Clock, Users, Activity, BarChart2, Filter, X, Timer, ChevronDown, AlertTriangle, RefreshCw } from 'lucide-react';
import ModuleOnboarding from '../components/shared/ModuleOnboarding';
import { StepMetricsPanel } from './StepMetrics';
import { fmtDuration } from '../components/apps/appModel';

const COLORS = ['#22c55e', '#ef4444', '#3b82f6', '#f59e0b', '#8b5cf6'];
const DAYS_OPTIONS = [7, 14, 30, 90];

function Skeleton({ className }: { className?: string }) {
  return <div className={`animate-pulse bg-gray-200 rounded ${className ?? ''}`} />;
}

export default function Analytics() {
  const [overview, setOverview] = useState<AnalyticsOverview | null>(null);
  const [throughput, setThroughput] = useState<any[]>([]);
  const [cycleTimes, setCycleTimes] = useState<any[]>([]);
  const [operators, setOperators] = useState<any[]>([]);
  const [appPerf, setAppPerf] = useState<any[]>([]);
  const [quality, setQuality] = useState<any[]>([]);
  const [days, setDays] = useState(30);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // ── Filters ──
  const [apps, setApps] = useState<any[]>([]);
  const [productTypes, setProductTypes] = useState<any[]>([]);
  const [departments, setDepartments] = useState<any[]>([]);
  const [appId, setAppId] = useState('');
  const [productTypeId, setProductTypeId] = useState('');
  const [departmentId, setDepartmentId] = useState('');

  // ── Step-metrics drill-down (revealed once a department + operation chosen) ──
  const [drillAppId, setDrillAppId] = useState('');
  const [drillOpen, setDrillOpen] = useState(true);

  // Load apps and departments once for the filter dropdowns
  useEffect(() => { api.getApps().then(setApps).catch(() => setApps([])); }, []);
  useEffect(() => { api.getDepartments().then(setDepartments).catch(() => setDepartments([])); }, []);

  // When the selected app changes, reload its product types and reset the part filter
  useEffect(() => {
    setProductTypeId('');
    if (!appId) { setProductTypes([]); return; }
    api.getProductTypes(appId).then(setProductTypes).catch(() => setProductTypes([]));
  }, [appId]);

  const load = (d: number, filters: AnalyticsFilters) => {
    setLoading(true);
    setError(null);
    Promise.all([
      api.getOverview(filters),
      api.getThroughput(d, filters),
      api.getCycleTimes(d, filters),
      api.getOperatorPerformance(filters),
      api.getAppPerformance(filters),
      api.getQualityData(d, filters),
    ]).then(([ov, tp, ct, ops, ap, q]) => {
      setOverview(ov);
      setThroughput(Array.isArray(tp) ? tp : []);
      setCycleTimes(Array.isArray(ct) ? ct : []);
      setOperators(Array.isArray(ops) ? ops : []);
      setAppPerf(Array.isArray(ap) ? ap : []);
      setQuality(Array.isArray(q) ? q : []);
    }).catch((err: any) => {
      setError(err?.message || 'Failed to load analytics data');
    }).finally(() => {
      setLoading(false);
    });
  };

  const currentFilters: AnalyticsFilters = { app_id: appId || undefined, product_type_id: productTypeId || undefined, department_id: departmentId || undefined };

  useEffect(() => {
    load(days, { app_id: appId || undefined, product_type_id: productTypeId || undefined, department_id: departmentId || undefined });
  }, [days, appId, productTypeId, departmentId]);

  const hasFilters = !!appId || !!productTypeId || !!departmentId;
  const clearFilters = () => { setAppId(''); setProductTypeId(''); setDepartmentId(''); setDrillAppId(''); };
  const selectedDeptName = departments.find((d: any) => d.id === departmentId)?.name;

  // When the department changes, reset the operation drill-down selection.
  useEffect(() => { setDrillAppId(''); }, [departmentId]);

  // passRate is null until at least one run records a QC result — never chart a
  // pass/fail split that no inspection produced.
  const passRate: number | null = overview?.passRate ?? null;
  const qualityPieData = passRate !== null ? [
    { name: 'Pass', value: passRate },
    { name: 'Fail', value: 100 - passRate },
  ] : [];

  return (
    <div className="p-6 space-y-6">
      <ModuleOnboarding
        moduleId="analytics"
        title="Analytics"
        description="Analytics turns your completion data into insights about throughput, efficiency, and trends."
        steps={[
          "Select an app and date range to analyze",
          "Compare actual vs. ideal cycle times",
          "Spot bottlenecks and overtime stations",
          "Export data for offline reporting",
        ]}
        icon={BarChart2}
        color="#0ea5e9"
      />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Operation Analytics</h1>
          <p className="text-gray-500 text-sm mt-0.5">Throughput, cycle time and quality across every operation — pick an operation below to drill into per-step timing</p>
        </div>
        <div className="flex gap-1 bg-gray-100 rounded-lg p-1">
          {DAYS_OPTIONS.map(d => (
            <button
              key={d}
              onClick={() => setDays(d)}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                days === d ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              {d}d
            </button>
          ))}
        </div>
      </div>

      {/* Filter bar */}
      <div className="card p-3 flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-1.5 text-sm font-medium text-gray-500">
          <Filter size={15} /> Filters
        </div>
        <div className="flex w-full items-center gap-2 xs:w-auto">
          <label className="text-xs text-gray-500 shrink-0">App</label>
          <select
            className="input-field text-sm py-1.5 w-full xs:w-auto xs:min-w-[12rem]"
            value={appId}
            onChange={e => setAppId(e.target.value)}
          >
            <option value="">All Apps</option>
            {apps.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </div>
        <div className="flex w-full items-center gap-2 xs:w-auto">
          <label className="text-xs text-gray-500 shrink-0 whitespace-nowrap">Part Type</label>
          <select
            className="input-field text-sm py-1.5 w-full xs:w-auto xs:min-w-[12rem] disabled:opacity-50 disabled:cursor-not-allowed"
            value={productTypeId}
            onChange={e => setProductTypeId(e.target.value)}
            disabled={!appId || productTypes.length === 0}
            title={!appId ? 'Select an app first' : productTypes.length === 0 ? 'This app has no part types' : ''}
          >
            <option value="">{!appId ? 'Select an app first' : productTypes.length === 0 ? 'No part types' : 'All Part Types'}</option>
            {productTypes.map(pt => <option key={pt.id} value={pt.id}>{pt.name}</option>)}
          </select>
        </div>
        {departments.length > 0 && (
          <div className="flex w-full items-center gap-2 xs:w-auto">
            <label className="text-xs text-gray-500 shrink-0">Department</label>
            <select
              className="input-field text-sm py-1.5 w-full xs:w-auto xs:min-w-[12rem]"
              value={departmentId}
              onChange={e => setDepartmentId(e.target.value)}
            >
              <option value="">All Departments</option>
              {departments.map((d: any) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </div>
        )}
        {hasFilters && (
          <button
            onClick={clearFilters}
            className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-800 px-2 py-1.5 rounded-lg hover:bg-gray-100 transition-colors"
          >
            <X size={13} /> Clear
          </button>
        )}
        <div className="ml-auto text-xs text-gray-400">
          {hasFilters
            ? `Showing ${[
                apps.find(a => a.id === appId)?.name ?? 'all apps',
                productTypeId ? productTypes.find(p => p.id === productTypeId)?.name : null,
                selectedDeptName,
              ].filter(Boolean).join(' · ')}`
            : 'Showing all production data'}
        </div>
      </div>

      {/* ── Operation drill-down: pick an operation → per-step timing ──
          Step metrics are per-app, so this is NOT gated on picking a department
          any more — that gate made the page's own "drill into step timing"
          promise unreachable for anyone who never used departments. */}
      <div className="card overflow-hidden">
        <div className="flex flex-wrap items-center gap-3 p-4 border-b border-gray-100">
          <div className="flex items-center gap-1.5 text-sm font-medium text-gray-700">
            <Timer size={15} className="text-blue-600" /> Step Metrics
          </div>
          <div className="flex items-center gap-2">
            <label className="text-xs text-gray-500">Operation</label>
            <select
              className="input-field text-sm py-1.5 min-w-[14rem]"
              value={drillAppId}
              onChange={e => setDrillAppId(e.target.value)}
            >
              <option value="">Select an operation…</option>
              {apps
                .filter((a: any) => a.status === 'published')
                .map((a: any) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </div>
          {/* Step timing comes from GET /analytics/step-metrics/:appId, which is
              per-operation and takes no department parameter — it reads every run
              of the chosen operation. Saying so beats letting the panel sit under
              a department filter looking like it obeyed it. */}
          {departmentId && (
            <span className="flex items-center gap-1.5 text-xs text-amber-600">
              <AlertTriangle size={12} className="shrink-0" />
              All runs of this operation — not narrowed to {selectedDeptName ?? 'the selected department'}
            </span>
          )}
          {drillAppId && (
            <button
              onClick={() => setDrillOpen(o => !o)}
              className="ml-auto flex items-center gap-1 text-xs text-gray-500 hover:text-gray-800"
            >
              {drillOpen ? 'Hide' : 'Show'} detail
              <ChevronDown size={14} className={`transition-transform ${drillOpen ? 'rotate-180' : ''}`} />
            </button>
          )}
        </div>
        {drillAppId ? (
          drillOpen && (
            <div className="p-4 bg-gray-50">
              <StepMetricsPanel appId={drillAppId} days={days} />
            </div>
          )
        ) : (
          <div className="p-6 text-center text-sm text-gray-400">
            Choose an operation above to see its per-step cycle times, takt adherence and trends.
          </div>
        )}
      </div>

      {error ? (
        <div className="card p-10 flex flex-col items-center gap-3 text-center">
          <AlertTriangle size={28} className="text-red-400" />
          <p className="text-gray-600 font-medium">Couldn't load analytics</p>
          <p className="text-sm text-gray-400">{error}</p>
          <button onClick={() => load(days, currentFilters)} className="btn-secondary">
            <RefreshCw size={14} /> Retry
          </button>
        </div>
      ) : loading && !overview ? (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {[1, 2, 3, 4].map(i => (
              <div key={i} className="stat-card flex items-center gap-3">
                <Skeleton className="w-10 h-10 rounded-lg flex-shrink-0" />
                <div className="space-y-1.5 flex-1">
                  <Skeleton className="h-5 w-16" />
                  <Skeleton className="h-3 w-24" />
                </div>
              </div>
            ))}
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2 card p-5"><Skeleton className="h-48 w-full" /></div>
            <div className="card p-5"><Skeleton className="h-48 w-full" /></div>
          </div>
          <div className="card p-5"><Skeleton className="h-48 w-full" /></div>
        </>
      ) : (
      <>
      {/* KPI cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KPICard icon={<CheckCircle size={18} className="text-green-600" />} bg="bg-green-50" label="Total Completions"
          value={overview ? overview.totalCompletions : null} note={overview ? null : 'not loaded'} />
        {/* Seconds in, unit out: fmtDuration prints 12s / 3m 20s / 1h 5m, so a
            sub-minute operation stops reading "0m". */}
        <KPICard icon={<Clock size={18} className="text-blue-600" />} bg="bg-blue-50" label="Avg Cycle Time"
          title="Wall clock from run start to run finish, over completed runs only."
          value={overview?.avgCycleSeconds != null ? fmtDuration(overview.avgCycleSeconds) : null}
          note={overview?.avgCycleSeconds != null ? 'start to finish, completed runs' : 'no completed runs in scope'} />
        <KPICard icon={<TrendingUp size={18} className="text-purple-600" />} bg="bg-purple-50" label="Pass Rate"
          value={passRate !== null ? `${passRate}%` : null}
          note={passRate !== null
            ? `from ${overview?.qcSampleSize ?? 0} inspected run${overview?.qcSampleSize === 1 ? '' : 's'}`
            : 'no pass/fail checks recorded'} />
        <KPICard icon={<Activity size={18} className="text-orange-600" />} bg="bg-orange-50" label="Today"
          value={overview ? overview.todayCompletions : null} note={overview ? null : 'not loaded'} />
      </div>

      {/* Throughput + Quality */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 card p-5">
          <h3 className="font-semibold text-gray-900 mb-4">Daily Throughput</h3>
          <ResponsiveContainer width="100%" height={200}>
            <AreaChart data={throughput}>
              <defs>
                <linearGradient id="tpG" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.2} />
                  <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis dataKey="date" tick={{ fontSize: 11 }} tickFormatter={d => d.slice(5)} />
              <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
              <Tooltip formatter={(v) => [v, 'Completions']} />
              <Area type="monotone" dataKey="count" stroke="#3b82f6" fill="url(#tpG)" strokeWidth={2} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
        <div className="card p-5">
          <h3 className="font-semibold text-gray-900 mb-4">Quality Pass Rate</h3>
          {qualityPieData.length > 0 ? (
            <>
              <ResponsiveContainer width="100%" height={140}>
                <PieChart>
                  <Pie data={qualityPieData} cx="50%" cy="50%" innerRadius={45} outerRadius={65} paddingAngle={3} dataKey="value">
                    <Cell fill="#22c55e" />
                    <Cell fill="#ef4444" />
                  </Pie>
                  <Tooltip formatter={(v: any) => [`${v}%`]} />
                </PieChart>
              </ResponsiveContainer>
              <div className="flex justify-center gap-4 text-xs mt-2">
                <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 bg-green-500 rounded-full inline-block" />Pass {passRate}%</span>
                <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 bg-red-500 rounded-full inline-block" />Fail {100 - passRate!}%</span>
              </div>
              {typeof overview?.qcSampleSize === 'number' && (
                <div className="text-center text-[11px] text-gray-400 mt-1">
                  from {overview.qcSampleSize} inspected run{overview.qcSampleSize === 1 ? '' : 's'}
                </div>
              )}
            </>
          ) : (
            <div className="text-center py-10 text-sm text-gray-400">
              No pass/fail results recorded yet
              <div className="text-xs text-gray-300 mt-1">Add a Pass/Fail step to an app to track quality here</div>
            </div>
          )}
        </div>
      </div>

      {/* Cycle times */}
      <div className="card p-5">
        <h3 className="font-semibold text-gray-900 mb-4">Cycle Time Trend (minutes)</h3>
        <ResponsiveContainer width="100%" height={200}>
          <LineChart data={cycleTimes}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
            <XAxis dataKey="date" tick={{ fontSize: 11 }} tickFormatter={d => d.slice(5)} />
            <YAxis tick={{ fontSize: 11 }} unit="m" />
            <Tooltip formatter={(v: any, n) => [`${v}m`, n === 'avg_minutes' ? 'Average' : n === 'min_minutes' ? 'Minimum' : 'Maximum']} />
            <Legend formatter={n => n === 'avg_minutes' ? 'Average' : n === 'min_minutes' ? 'Min' : 'Max'} />
            <Line type="monotone" dataKey="avg_minutes" stroke="#3b82f6" strokeWidth={2} dot={false} />
            <Line type="monotone" dataKey="min_minutes" stroke="#22c55e" strokeWidth={1.5} strokeDasharray="4 4" dot={false} />
            <Line type="monotone" dataKey="max_minutes" stroke="#ef4444" strokeWidth={1.5} strokeDasharray="4 4" dot={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* Quality trend */}
      <div className="card p-5">
        <h3 className="font-semibold text-gray-900 mb-4">Daily Quality Trend</h3>
        <ResponsiveContainer width="100%" height={160}>
          <BarChart data={quality}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
            <XAxis dataKey="date" tick={{ fontSize: 11 }} tickFormatter={d => d.slice(5)} />
            <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
            <Tooltip />
            <Legend />
            <Bar dataKey="pass" name="Pass" fill="#22c55e" stackId="a" radius={[0, 0, 0, 0]} />
            <Bar dataKey="fail" name="Fail" fill="#ef4444" stackId="a" radius={[3, 3, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Operator performance */}
        <div className="card p-5">
          <div className="flex items-center gap-2 mb-4">
            <Users size={16} className="text-gray-500" />
            <h3 className="font-semibold text-gray-900">Operator Performance</h3>
            {/* This panel is not date-scoped — the day-range selector above drives
                throughput, cycle time and quality, but operator and app rollups
                are all-time. Say so rather than let the control look dead here. */}
            <span className="ml-auto text-xs text-gray-400" title="Not limited to the selected date range; the app, part and department filters still apply.">all time</span>
          </div>
          <div className="space-y-3">
            {operators.map((op, i) => (
              <div key={op.operator_name} className="flex items-center gap-3">
                <div className="w-7 h-7 bg-blue-100 text-blue-700 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0">{i + 1}</div>
                <div className="flex-1 min-w-0">
                  <div className="flex justify-between items-center mb-0.5">
                    <span className="text-sm font-medium text-gray-800 truncate">{op.operator_name}</span>
                    <span className="text-xs text-gray-500 ml-2 flex-shrink-0">
                      {op.completions} runs · {op.avg_cycle_seconds == null ? '— avg' : `${fmtDuration(op.avg_cycle_seconds)} avg`}
                    </span>
                  </div>
                  <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                    <div className="h-full bg-blue-500 rounded-full" style={{ width: `${Math.min(100, (op.completions / (operators[0]?.completions || 1)) * 100)}%` }} />
                  </div>
                </div>
              </div>
            ))}
            {operators.length === 0 && <p className="text-gray-400 text-sm text-center py-4">No data yet</p>}
          </div>
        </div>

        {/* App performance */}
        <div className="card p-5">
          <div className="flex items-center gap-2 mb-4">
            <BarChart2 size={16} className="text-gray-500" />
            <h3 className="font-semibold text-gray-900">App Performance</h3>
            <span className="ml-auto text-xs text-gray-400" title="Not limited to the selected date range; the app, part and department filters still apply.">all time</span>
          </div>
          <div className="space-y-3">
            {appPerf.map(ap => (
              <div key={ap.app_id} className="p-3 rounded-lg bg-gray-50">
                <div className="flex justify-between items-start mb-1">
                  <span className="text-sm font-medium text-gray-800">{ap.app_name}</span>
                  <span className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full ml-2">{ap.completions} runs</span>
                </div>
                <div className="flex gap-3 text-xs text-gray-500">
                  <span><Clock size={10} className="inline mr-0.5" />{ap.avg_cycle_seconds == null ? '— avg' : `${fmtDuration(ap.avg_cycle_seconds)} avg`}</span>
                  {ap.abandoned_count > 0 && <span className="text-red-500">{ap.abandoned_count} abandoned</span>}
                </div>
              </div>
            ))}
            {appPerf.length === 0 && <p className="text-gray-400 text-sm text-center py-4">No data yet</p>}
          </div>
        </div>
      </div>
      </>
      )}
    </div>
  );
}

// A KPI with nothing behind it shows an em-dash and why, never a zero. `value`
// is null exactly when the number is unknown; `note` is the short reason (or a
// bit of provenance when the number IS known, so the two tiles that could be
// confused for each other say what they measure).
function KPICard({ icon, bg, label, value, note, title }: {
  icon: React.ReactNode; bg: string; label: string;
  value: string | number | null; note?: string | null; title?: string;
}) {
  const known = value !== null && value !== undefined;
  return (
    <div className="stat-card flex items-center gap-3" title={title}>
      <div className={`w-10 h-10 ${bg} rounded-lg flex items-center justify-center flex-shrink-0`}>{icon}</div>
      <div className="min-w-0">
        <div className={`text-xl font-bold ${known ? 'text-gray-900' : 'text-gray-400'}`}>{known ? value : '—'}</div>
        <div className="text-xs text-gray-500">{label}</div>
        {note && <div className="text-[11px] text-gray-400 truncate" title={note}>{note}</div>}
      </div>
    </div>
  );
}

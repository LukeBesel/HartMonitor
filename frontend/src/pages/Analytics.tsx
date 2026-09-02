// App comparison — the cross-app screen.
//
// One app's own numbers live on ONE screen: /apps/:id, reached by clicking the
// app's card. This screen is the other half of that split — it compares apps
// with each other, and it carries OEE as a tab, because a single-site shop
// never needed a top-level menu item for /oee.
//
//   Compare   throughput, cycle time, quality and per-app / per-operator rollups
//   OEE       every station's OEE today, the cards /oee used to render
//
// The vocabulary matches the Command Center's, deliberately: "Average cycle
// time" and "Pass rate" mean here exactly what they mean there, and every
// duration on screen is printed by the one shared formatter.

import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api, AnalyticsFilters } from '../api/client';
import { AnalyticsOverview } from '../types';
import {
  AreaChart, Area, BarChart, Bar, LineChart, Line, XAxis, YAxis,
  Tooltip, ResponsiveContainer, CartesianGrid, Legend, PieChart, Pie, Cell
} from 'recharts';
import { TrendingUp, CheckCircle, Clock, Users, Activity, BarChart2, Filter, X, Timer, ChevronDown, AlertTriangle, RefreshCw, Cpu, Lock } from 'lucide-react';
import ModuleOnboarding from '../components/shared/ModuleOnboarding';
import TabBar from '../components/shared/TabBar';
import UpgradeModal from '../components/shared/UpgradeModal';
import { StepMetricsPanel } from '../components/analytics/StepMetricsPanel';
import { OEEPanel } from '../components/analytics/OEEPanel';
import { getLosses } from '../api/oee';
import type { LossesReport } from '../api/oee';
import { fmtDuration } from '../components/apps/appModel';
import { useAuth } from '../context/AuthContext';
import { usePlan } from '../context/PlanContext';
import { useModules } from '../context/ModulesContext';

const DAYS_OPTIONS = [7, 14, 30, 90];

function Skeleton({ className }: { className?: string }) {
  return <div className={`animate-pulse bg-gray-200 rounded ${className ?? ''}`} />;
}

type Tab = 'compare' | 'oee';

export default function Analytics() {
  // OEE was a nav item with a gate on it: supervisor and up, Pro, and only
  // while the production module is on. Moving it to a tab must not drop the
  // gate — the same three rules ride the tab instead.
  const { isAtLeast } = useAuth();
  const { isFree } = usePlan();
  const { isEnabled } = useModules();
  const oeeAllowed = isAtLeast('supervisor') && isEnabled('production');
  const oeeLocked = oeeAllowed && isFree;
  const [showUpgrade, setShowUpgrade] = useState(false);

  // The tab is in the URL, so /analytics?tab=oee is a link somebody can send —
  // and the retired /oee bookmark lands straight on it. Choosing a tab is a
  // navigation: it PUSHES, so Back returns to the tab you were reading.
  const [searchParams, setSearchParams] = useSearchParams();
  const askedForOee = searchParams.get('tab') === 'oee';
  const tab: Tab = askedForOee && oeeAllowed ? 'oee' : 'compare';
  const setTab = (next: Tab) => setSearchParams(prev => {
    const params = new URLSearchParams(prev);
    if (next === 'compare') params.delete('tab');
    else params.set('tab', next);
    return params;
  });

  // A link to a tab this account cannot see lands on Compare, and the URL is
  // rewritten to say so (a replace — nobody chose to be sent here).
  useEffect(() => {
    if (!askedForOee || oeeAllowed) return;
    setSearchParams(prev => {
      const params = new URLSearchParams(prev);
      params.delete('tab');
      return params;
    }, { replace: true });
  }, [askedForOee, oeeAllowed, setSearchParams]);

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

  // ── Step-metrics drill-down: pick an app, read its per-step timing ──
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

  // When the department changes, reset the per-app drill-down selection.
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
        title="App comparison"
        description="App comparison turns your completion data into insights about throughput, efficiency, and trends across every app."
        steps={[
          "Pick a date range and compare your apps",
          "Compare actual vs. ideal cycle times",
          "Spot bottlenecks and overtime stations",
          "Export data for offline reporting",
        ]}
        icon={BarChart2}
        color="#0ea5e9"
      />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">App comparison</h1>
          <p className="text-gray-500 text-sm mt-0.5">
            Throughput, cycle time and quality across every app — one app's own numbers live on its
            own screen, reached from its card in the App Library.
          </p>
        </div>
        {tab === 'compare' && (
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
        )}
      </div>

      <TabBar
        items={[
          { key: 'compare', label: 'Compare', icon: <BarChart2 size={15} /> },
          ...(oeeAllowed ? [{
            key: 'oee' as const,
            label: 'OEE',
            icon: oeeLocked ? <Lock size={15} /> : <Cpu size={15} />,
            badge: oeeLocked
              ? <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-600 leading-none">PRO</span>
              : undefined,
          }] : []),
        ]}
        active={tab}
        onSelect={setTab}
        ariaLabel="App comparison screens"
      />

      {tab === 'oee' && (oeeLocked ? (
        <div className="card p-10" data-testid="oee-locked">
          <div className="flex flex-col items-center text-center gap-3">
            <div className="w-12 h-12 rounded-full bg-amber-50 flex items-center justify-center">
              <Lock size={22} className="text-amber-500" strokeWidth={1.75} />
            </div>
            <p className="text-sm font-semibold text-gray-700">OEE is a Pro feature</p>
            <p className="text-xs text-gray-400 max-w-sm leading-relaxed">
              Availability, performance and quality for every station, measured against its planned
              hours and ideal cycle time.
            </p>
            <button onClick={() => setShowUpgrade(true)} className="btn-primary">
              Upgrade to Pro
            </button>
          </div>
        </div>
      ) : (
        <>
          <OEEPanel />
          <DowntimePareto stationId={searchParams.get('station_id') || ''} />
        </>
      ))}

      {showUpgrade && (
        <UpgradeModal
          lockedFeature="OEE"
          onClose={() => setShowUpgrade(false)}
          onPurchased={() => setShowUpgrade(false)}
        />
      )}

      {tab === 'compare' && (
      <div className="space-y-6">

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

      {/* ── Per-app drill-down: pick an app → per-step timing ──
          Step metrics are per-app, so this is NOT gated on picking a department
          any more — that gate made the page's own "drill into step timing"
          promise unreachable for anyone who never used departments. */}
      <div className="card overflow-hidden">
        <div className="flex flex-wrap items-center gap-3 p-4 border-b border-gray-100">
          <div className="flex items-center gap-1.5 text-sm font-medium text-gray-700">
            <Timer size={15} className="text-blue-600" /> Step Metrics
          </div>
          <div className="flex items-center gap-2">
            <label className="text-xs text-gray-500">App</label>
            <select
              className="input-field text-sm py-1.5 min-w-[14rem]"
              value={drillAppId}
              onChange={e => setDrillAppId(e.target.value)}
            >
              <option value="">Select an app…</option>
              {apps
                .filter((a: any) => a.status === 'published')
                .map((a: any) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </div>
          {/* Step timing comes from GET /analytics/step-metrics/:appId, which is
              per-app and takes no department parameter — it reads every run
              of the chosen app. Saying so beats letting the panel sit under
              a department filter looking like it obeyed it. */}
          {departmentId && (
            <span className="flex items-center gap-1.5 text-xs text-amber-600">
              <AlertTriangle size={12} className="shrink-0" />
              All runs of this app — not narrowed to {selectedDeptName ?? 'the selected department'}
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
            Choose an app above to see its per-step cycle times, takt adherence and trends.
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
        <KPICard icon={<CheckCircle size={18} className="text-green-600" />} bg="bg-green-50" label="Runs completed"
          value={overview ? overview.totalCompletions : null} note={overview ? null : 'not loaded'} />
        {/* Seconds in, unit out: fmtDuration prints 12s / 3m 20s / 1h 5m, so a
            sub-minute app stops reading "0m". */}
        <KPICard icon={<Clock size={18} className="text-blue-600" />} bg="bg-blue-50" label="Average cycle time"
          title="Wall clock from run start to run finish, over completed runs only."
          value={overview?.avgCycleSeconds != null ? fmtDuration(overview.avgCycleSeconds) : null}
          note={overview?.avgCycleSeconds != null ? 'start to finish, completed runs' : 'no completed runs in scope'} />
        <KPICard icon={<TrendingUp size={18} className="text-purple-600" />} bg="bg-purple-50" label="Pass rate"
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

// ─── The downtime Pareto and the six big losses ──────────────────────────────
//
// Downtime used to be a free-text "Reason (optional)" on a machine event, so
// the plant had a word cloud where it needed a Pareto — and no six-big-losses
// roll-up at all. Every stop now picks from the company's coded list.
//
// Two rules this panel keeps:
//
//   • Minutes with no coded reason get their OWN labelled bar and are never
//     spread across the six buckets. A Pareto that redistributes unknown
//     minutes invents its own top cause, and somebody then goes and fixes it.
//   • A day with no stops says so. A chart of six zero-height bars reads as a
//     measurement, and it is not one.

function DowntimePareto({ stationId }: { stationId: string }) {
  const [data, setData] = useState<LossesReport | null>(null);
  const [days, setDays] = useState(1);
  const [error, setError] = useState('');

  useEffect(() => {
    let live = true;
    // Wrapped so a SYNCHRONOUS throw becomes a rejection like any other
    // failure: this panel must degrade to a line of text, never take the OEE
    // tab down with it.
    Promise.resolve()
      .then(() => getLosses({ days, stationId: stationId || undefined }))
      .then(d => { if (live) { setData(d); setError(''); } })
      .catch((err: unknown) => { if (live) setError(err instanceof Error ? err.message : 'Could not load downtime'); });
    return () => { live = false; };
  }, [days, stationId]);

  if (error) {
    return <div className="card p-5 mt-6 text-sm text-gray-500">{error}</div>;
  }
  if (!data) {
    return <div className="card p-5 mt-6"><Skeleton className="h-24 w-full" /></div>;
  }

  const worst = data.pareto[0]?.minutes ?? 0;

  return (
    <div className="card p-5 mt-6 space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h3 className="font-semibold text-gray-900 flex items-center gap-2">
            <AlertTriangle size={15} className="text-amber-500" /> Why the plant stopped
          </h3>
          <p className="text-xs text-gray-400 mt-0.5">
            {data.station_name ? `${data.station_name} · ` : ''}
            {data.stops} stop{data.stops === 1 ? '' : 's'} · {data.total_down_minutes} minutes
            {data.plant_date ? ` · plant day ${data.plant_date}` : ''}
          </p>
        </div>
        <select
          className="input-field w-auto text-sm"
          value={days}
          onChange={e => setDays(Number(e.target.value))}
          aria-label="Downtime window"
        >
          <option value={1}>Today</option>
          <option value={7}>Last 7 days</option>
          <option value={30}>Last 30 days</option>
        </select>
      </div>

      {data.pareto.length === 0 ? (
        <p className="text-sm text-gray-400">{data.empty_reason ?? 'No stops recorded'}</p>
      ) : (
        <>
          <div className="space-y-2">
            {data.pareto.map(row => (
              <div key={row.reason_code_id ?? 'unclassified'} className="space-y-1">
                <div className="flex items-baseline justify-between gap-3 text-xs">
                  <span className={`font-medium truncate pr-1 ${row.reason_code_id ? 'text-gray-700' : 'text-gray-400 italic'}`}>
                    {row.label}
                    {/* The reason code and its loss bucket are often the same
                        word — "Breakdown · Breakdown" said nothing twice. The
                        bucket only earns its place when it adds one. */}
                    {row.bucket_label && row.bucket_label.trim().toLowerCase() !== row.label.trim().toLowerCase() && (
                      <span className="text-gray-400 font-normal"> · {row.bucket_label}</span>
                    )}
                  </span>
                  <span className="tabular-nums text-gray-500 flex-shrink-0">
                    {row.minutes}m{row.pct !== null ? ` · ${row.pct}%` : ''}
                    {row.cumulative_pct !== null && <span className="text-gray-300"> ({row.cumulative_pct}% cum.)</span>}
                  </span>
                </div>
                <div className="h-2.5 rounded-full bg-gray-100 overflow-hidden">
                  <div
                    className={`h-full rounded-full ${row.reason_code_id ? 'bg-amber-500' : 'bg-gray-300'}`}
                    style={{ width: worst > 0 ? `${Math.max(2, (row.minutes / worst) * 100)}%` : '0%' }}
                  />
                </div>
              </div>
            ))}
          </div>

          <div>
            <h4 className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-2">
              The six big losses
            </h4>
            <div className="overflow-x-auto">
              <div className="flex gap-2 min-w-max">
                {data.six_big_losses.map(b => (
                  <div key={b.bucket || 'none'} className="rounded-lg border border-gray-200 px-3 py-2 min-w-[112px]">
                    <div className="text-lg font-bold tabular-nums text-gray-900">{b.minutes}m</div>
                    <div className="text-[11px] text-gray-500 leading-tight">{b.label}</div>
                  </div>
                ))}
                {data.unclassified_minutes > 0 && (
                  <div className="rounded-lg border border-dashed border-gray-300 px-3 py-2 min-w-[112px]">
                    <div className="text-lg font-bold tabular-nums text-gray-400">{data.unclassified_minutes}m</div>
                    <div className="text-[11px] text-gray-400 leading-tight">
                      Not coded — logged before reasons, never redistributed
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

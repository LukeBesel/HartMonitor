import { useEffect, useState } from 'react';
import { api, AnalyticsFilters } from '../api/client';
import { AnalyticsOverview } from '../types';
import {
  AreaChart, Area, BarChart, Bar, LineChart, Line, XAxis, YAxis,
  Tooltip, ResponsiveContainer, CartesianGrid, Legend, PieChart, Pie, Cell
} from 'recharts';
import { TrendingUp, CheckCircle, Clock, Users, Activity, BarChart2, Filter, X } from 'lucide-react';

const COLORS = ['#22c55e', '#ef4444', '#3b82f6', '#f59e0b', '#8b5cf6'];
const DAYS_OPTIONS = [7, 14, 30, 90];

export default function Analytics() {
  const [overview, setOverview] = useState<AnalyticsOverview | null>(null);
  const [throughput, setThroughput] = useState<any[]>([]);
  const [cycleTimes, setCycleTimes] = useState<any[]>([]);
  const [operators, setOperators] = useState<any[]>([]);
  const [appPerf, setAppPerf] = useState<any[]>([]);
  const [quality, setQuality] = useState<any[]>([]);
  const [days, setDays] = useState(30);

  // ── Filters ──
  const [apps, setApps] = useState<any[]>([]);
  const [productTypes, setProductTypes] = useState<any[]>([]);
  const [appId, setAppId] = useState('');
  const [productTypeId, setProductTypeId] = useState('');

  // Load apps once for the filter dropdown
  useEffect(() => { api.getApps().then(setApps).catch(() => setApps([])); }, []);

  // When the selected app changes, reload its product types and reset the part filter
  useEffect(() => {
    setProductTypeId('');
    if (!appId) { setProductTypes([]); return; }
    api.getProductTypes(appId).then(setProductTypes).catch(() => setProductTypes([]));
  }, [appId]);

  const load = (d: number, filters: AnalyticsFilters) => {
    Promise.all([
      api.getOverview(filters),
      api.getThroughput(d, filters),
      api.getCycleTimes(d, filters),
      api.getOperatorPerformance(filters),
      api.getAppPerformance(filters),
      api.getQualityData(d, filters),
    ]).then(([ov, tp, ct, ops, ap, q]) => {
      setOverview(ov);
      setThroughput(tp);
      setCycleTimes(ct);
      setOperators(ops);
      setAppPerf(ap);
      setQuality(q);
    });
  };

  useEffect(() => {
    load(days, { app_id: appId || undefined, product_type_id: productTypeId || undefined });
  }, [days, appId, productTypeId]);

  const hasFilters = !!appId || !!productTypeId;
  const clearFilters = () => { setAppId(''); setProductTypeId(''); };

  const qualityPieData = overview ? [
    { name: 'Pass', value: overview.passRate },
    { name: 'Fail', value: 100 - overview.passRate },
  ] : [];

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Analytics</h1>
          <p className="text-gray-500 text-sm mt-0.5">Manufacturing performance metrics</p>
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
        <div className="flex items-center gap-2">
          <label className="text-xs text-gray-500">App</label>
          <select
            className="input-field text-sm py-1.5 min-w-[12rem]"
            value={appId}
            onChange={e => setAppId(e.target.value)}
          >
            <option value="">All Apps</option>
            {apps.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </div>
        <div className="flex items-center gap-2">
          <label className="text-xs text-gray-500">Part Type</label>
          <select
            className="input-field text-sm py-1.5 min-w-[12rem] disabled:opacity-50 disabled:cursor-not-allowed"
            value={productTypeId}
            onChange={e => setProductTypeId(e.target.value)}
            disabled={!appId || productTypes.length === 0}
            title={!appId ? 'Select an app first' : productTypes.length === 0 ? 'This app has no part types' : ''}
          >
            <option value="">{!appId ? 'Select an app first' : productTypes.length === 0 ? 'No part types' : 'All Part Types'}</option>
            {productTypes.map(pt => <option key={pt.id} value={pt.id}>{pt.name}</option>)}
          </select>
        </div>
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
            ? `Showing ${apps.find(a => a.id === appId)?.name ?? 'all apps'}${productTypeId ? ` · ${productTypes.find(p => p.id === productTypeId)?.name}` : ''}`
            : 'Showing all production data'}
        </div>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KPICard icon={<CheckCircle size={18} className="text-green-600" />} bg="bg-green-50" label="Total Completions" value={overview?.totalCompletions ?? '—'} />
        <KPICard icon={<Clock size={18} className="text-blue-600" />} bg="bg-blue-50" label="Avg Cycle Time" value={overview ? `${overview.avgCycleTime}m` : '—'} />
        <KPICard icon={<TrendingUp size={18} className="text-purple-600" />} bg="bg-purple-50" label="Pass Rate" value={overview ? `${overview.passRate}%` : '—'} />
        <KPICard icon={<Activity size={18} className="text-orange-600" />} bg="bg-orange-50" label="Today" value={overview?.todayCompletions ?? '—'} />
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
          {qualityPieData.length > 0 && (
            <ResponsiveContainer width="100%" height={140}>
              <PieChart>
                <Pie data={qualityPieData} cx="50%" cy="50%" innerRadius={45} outerRadius={65} paddingAngle={3} dataKey="value">
                  <Cell fill="#22c55e" />
                  <Cell fill="#ef4444" />
                </Pie>
                <Tooltip formatter={(v: any) => [`${v}%`]} />
              </PieChart>
            </ResponsiveContainer>
          )}
          <div className="flex justify-center gap-4 text-xs mt-2">
            <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 bg-green-500 rounded-full inline-block" />Pass {overview?.passRate}%</span>
            <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 bg-red-500 rounded-full inline-block" />Fail {100 - (overview?.passRate ?? 100)}%</span>
          </div>
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
          </div>
          <div className="space-y-3">
            {operators.map((op, i) => (
              <div key={op.operator_name} className="flex items-center gap-3">
                <div className="w-7 h-7 bg-blue-100 text-blue-700 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0">{i + 1}</div>
                <div className="flex-1 min-w-0">
                  <div className="flex justify-between items-center mb-0.5">
                    <span className="text-sm font-medium text-gray-800 truncate">{op.operator_name}</span>
                    <span className="text-xs text-gray-500 ml-2 flex-shrink-0">{op.completions} runs · {op.avg_cycle_minutes}m avg</span>
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
          </div>
          <div className="space-y-3">
            {appPerf.map(ap => (
              <div key={ap.app_id} className="p-3 rounded-lg bg-gray-50">
                <div className="flex justify-between items-start mb-1">
                  <span className="text-sm font-medium text-gray-800">{ap.app_name}</span>
                  <span className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full ml-2">{ap.completions} runs</span>
                </div>
                <div className="flex gap-3 text-xs text-gray-500">
                  <span><Clock size={10} className="inline mr-0.5" />{ap.avg_cycle_minutes}m avg</span>
                  {ap.abandoned_count > 0 && <span className="text-red-500">{ap.abandoned_count} abandoned</span>}
                </div>
              </div>
            ))}
            {appPerf.length === 0 && <p className="text-gray-400 text-sm text-center py-4">No data yet</p>}
          </div>
        </div>
      </div>
    </div>
  );
}

function KPICard({ icon, bg, label, value }: any) {
  return (
    <div className="stat-card flex items-center gap-3">
      <div className={`w-10 h-10 ${bg} rounded-lg flex items-center justify-center flex-shrink-0`}>{icon}</div>
      <div>
        <div className="text-xl font-bold text-gray-900">{value}</div>
        <div className="text-xs text-gray-500">{label}</div>
      </div>
    </div>
  );
}

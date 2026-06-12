import { useEffect, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client';
import {
  CheckCircle2, Activity, TrendingUp, Clock, CalendarCheck, Package,
  AlertTriangle, RefreshCw, Building2, ChevronRight
} from 'lucide-react';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  CartesianGrid, PieChart, Pie, Cell, Legend
} from 'recharts';

const GREEN = '#22c55e';
const AMBER = '#f59e0b';
const RED = '#ef4444';
const BLUE = '#3b82f6';
const GRAY = '#94a3b8';

interface PlantViewData {
  kpis: {
    total_completed_today: number;
    active_now: number;
    pass_rate: number;
    avg_cycle_time: number;
    schedule_adherence: number;
    work_orders_on_track: number;
    work_orders_total: number;
  };
  department_performance: Array<{
    id: string;
    department: string;
    color: string;
    completion_count: number;
    avg_cycle_time: number;
    takt_time: number;
    on_track_count: number;
    total_count: number;
    status: 'on_track' | 'at_risk' | 'behind';
  }>;
  hourly_throughput: Array<{
    hour: string;
    count: number;
  }>;
  work_order_summary: {
    on_track: number;
    at_risk: number;
    behind: number;
    not_started: number;
  };
  active_alerts: Array<{
    id: string;
    work_order_number: string;
    part_name: string;
    department: string;
    status: 'behind' | 'overdue';
    scheduled_end: string;
    completion_pct: number;
  }>;
  recent_completions: Array<{
    id: string;
    app_name: string;
    operator_name: string;
    department: string;
    completed_at: string;
    duration_minutes: number;
    status: string;
  }>;
}

function useLiveClock() {
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);
  return now;
}

function formatDuration(minutes: number) {
  if (minutes < 60) return `${minutes.toFixed(1)}m`;
  return `${(minutes / 60).toFixed(1)}h`;
}

function formatTimeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 60000) return 'just now';
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function departmentBorderColor(status: string) {
  if (status === 'on_track') return 'border-l-green-500';
  if (status === 'at_risk') return 'border-l-amber-500';
  return 'border-l-red-500';
}

const WO_SUMMARY_COLORS: Record<string, string> = {
  on_track: GREEN,
  at_risk: AMBER,
  behind: RED,
  not_started: GRAY,
};

export default function PlantView() {
  const [data, setData] = useState<PlantViewData | null>(null);
  const [loading, setLoading] = useState(true);
  const [lastRefresh, setLastRefresh] = useState(new Date());
  const [refreshing, setRefreshing] = useState(false);
  const now = useLiveClock();

  const load = useCallback(async (showSpinner = false) => {
    if (showSpinner) setRefreshing(true);
    try {
      const result = await (api as any).getPlantView();
      setData(result);
      setLastRefresh(new Date());
    } catch {
      // keep stale data on error
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    load(true);
    const interval = setInterval(() => load(false), 30000);
    return () => clearInterval(interval);
  }, [load]);

  const secondsSinceRefresh = Math.floor((now.getTime() - lastRefresh.getTime()) / 1000);

  const woSummaryData = data
    ? [
        { name: 'On Track', value: data.work_order_summary.on_track },
        { name: 'At Risk', value: data.work_order_summary.at_risk },
        { name: 'Behind', value: data.work_order_summary.behind },
        { name: 'Not Started', value: data.work_order_summary.not_started },
      ].filter(d => d.value > 0)
    : [];

  return (
    <div className="min-h-screen bg-[#f8fafc] p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2 mb-0.5">
            <Building2 size={20} className="text-blue-600" />
            <h1 className="text-2xl font-bold text-gray-900">Plant Overview</h1>
          </div>
          <p className="text-gray-500 text-sm">Executive operations dashboard</p>
        </div>
        <div className="flex items-center gap-4">
          <div className="text-right">
            <div className="text-xl font-semibold text-gray-900 tabular-nums">
              {now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
            </div>
            <div className="text-xs text-gray-400">{now.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' })}</div>
          </div>
          <button
            onClick={() => load(true)}
            className="flex items-center gap-2 px-3 py-2 bg-white border border-gray-200 rounded-lg text-sm text-gray-600 hover:bg-gray-50 transition-colors shadow-sm"
          >
            <RefreshCw size={14} className={refreshing ? 'animate-spin text-blue-500' : ''} />
            <span className="text-xs text-gray-400">{secondsSinceRefresh}s ago</span>
          </button>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-64">
          <div className="flex flex-col items-center gap-3">
            <RefreshCw size={28} className="animate-spin text-blue-500" />
            <span className="text-gray-500 text-sm">Loading plant data…</span>
          </div>
        </div>
      ) : (
        <>
          {/* KPI Row */}
          <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-4">
            <KPICard
              icon={<CheckCircle2 size={18} className="text-green-600" />}
              bg="bg-green-50"
              label="Completed Today"
              value={data?.kpis.total_completed_today ?? 0}
            />
            <KPICard
              icon={<Activity size={18} className="text-blue-600" />}
              bg="bg-blue-50"
              label="Active Now"
              value={data?.kpis.active_now ?? 0}
            />
            <KPICard
              icon={<TrendingUp size={18} className="text-purple-600" />}
              bg="bg-purple-50"
              label="Pass Rate"
              value={`${data?.kpis.pass_rate ?? 0}%`}
              color={
                (data?.kpis.pass_rate ?? 0) >= 95 ? 'text-green-600' :
                (data?.kpis.pass_rate ?? 0) >= 85 ? 'text-amber-600' : 'text-red-600'
              }
            />
            <KPICard
              icon={<Clock size={18} className="text-orange-600" />}
              bg="bg-orange-50"
              label="Avg Cycle Time"
              value={data ? formatDuration(data.kpis.avg_cycle_time) : '—'}
            />
            <KPICard
              icon={<CalendarCheck size={18} className="text-teal-600" />}
              bg="bg-teal-50"
              label="Schedule Adherence"
              value={`${data?.kpis.schedule_adherence ?? 0}%`}
              color={
                (data?.kpis.schedule_adherence ?? 0) >= 90 ? 'text-green-600' :
                (data?.kpis.schedule_adherence ?? 0) >= 75 ? 'text-amber-600' : 'text-red-600'
              }
            />
            <KPICard
              icon={<Package size={18} className="text-indigo-600" />}
              bg="bg-indigo-50"
              label="WOs On Track"
              value={`${data?.kpis.work_orders_on_track ?? 0} / ${data?.kpis.work_orders_total ?? 0}`}
            />
          </div>

          {/* Department Performance */}
          <div>
            <h2 className="text-base font-semibold text-gray-900 mb-3">Department Performance</h2>
            <div className="grid grid-cols-3 gap-4">
              {(data?.department_performance ?? []).length === 0 && (
                <div className="col-span-3 text-center text-gray-400 text-sm py-8 bg-white rounded-xl border border-gray-200">
                  No department data available
                </div>
              )}
              {(data?.department_performance ?? []).map(dept => {
                const cycleVsTakt = dept.takt_time > 0 ? (dept.avg_cycle_time / dept.takt_time) * 100 : 0;
                const barColor = dept.status === 'on_track' ? 'bg-green-500' : dept.status === 'at_risk' ? 'bg-amber-500' : 'bg-red-500';
                const onTrackPct = dept.total_count > 0 ? Math.round((dept.on_track_count / dept.total_count) * 100) : 0;
                return (
                  <Link key={dept.id || dept.department} to={`/departments/${dept.id}`} className={`block bg-white rounded-xl border border-gray-200 shadow-sm p-4 border-l-4 hover:shadow-md hover:border-gray-300 transition-all ${departmentBorderColor(dept.status)}`}>
                    <div className="flex items-start justify-between mb-3">
                      <div>
                        <div className="font-semibold text-gray-900 flex items-center gap-1">{dept.department} <ChevronRight size={14} className="text-gray-300" /></div>
                        <div className="text-2xl font-bold text-gray-900 mt-1">{dept.completion_count}</div>
                        <div className="text-xs text-gray-500">completions today</div>
                      </div>
                      <StatusPill status={dept.status} />
                    </div>
                    <div className="space-y-2">
                      <div>
                        <div className="flex justify-between text-xs text-gray-500 mb-1">
                          <span>Cycle vs Takt</span>
                          <span>{dept.avg_cycle_time.toFixed(1)}m / {dept.takt_time}m</span>
                        </div>
                        <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                          <div
                            className={`h-full rounded-full ${barColor}`}
                            style={{ width: `${Math.min(100, cycleVsTakt)}%` }}
                          />
                        </div>
                      </div>
                      <div className="flex justify-between text-xs text-gray-500">
                        <span>{onTrackPct}% on track</span>
                        <span>{dept.on_track_count} / {dept.total_count} WOs</span>
                      </div>
                    </div>
                  </Link>
                );
              })}
            </div>
          </div>

          {/* Charts Row */}
          <div className="grid grid-cols-3 gap-6">
            {/* WO Summary Donut */}
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
              <h2 className="font-semibold text-gray-900 mb-4">Work Order Summary</h2>
              {woSummaryData.length > 0 ? (
                <>
                  <ResponsiveContainer width="100%" height={180}>
                    <PieChart>
                      <Pie
                        data={woSummaryData}
                        cx="50%"
                        cy="50%"
                        innerRadius={52}
                        outerRadius={74}
                        paddingAngle={3}
                        dataKey="value"
                      >
                        {woSummaryData.map((entry) => (
                          <Cell key={entry.name} fill={WO_SUMMARY_COLORS[entry.name.toLowerCase().replace(' ', '_')] ?? GRAY} />
                        ))}
                      </Pie>
                      <Tooltip formatter={(v: any) => [v, 'Work Orders']} />
                    </PieChart>
                  </ResponsiveContainer>
                  <div className="grid grid-cols-2 gap-1.5 mt-2">
                    {woSummaryData.map(d => (
                      <div key={d.name} className="flex items-center gap-1.5 text-xs text-gray-600">
                        <span
                          className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                          style={{ backgroundColor: WO_SUMMARY_COLORS[d.name.toLowerCase().replace(' ', '_')] ?? GRAY }}
                        />
                        {d.name}: <span className="font-semibold text-gray-900">{d.value}</span>
                      </div>
                    ))}
                  </div>
                </>
              ) : (
                <div className="text-center text-gray-400 text-sm py-12">No work order data</div>
              )}
            </div>

            {/* Hourly Throughput */}
            <div className="col-span-2 bg-white rounded-xl border border-gray-200 shadow-sm p-5">
              <div className="flex items-center justify-between mb-4">
                <h2 className="font-semibold text-gray-900">Hourly Throughput</h2>
                <span className="text-xs text-gray-400">Last 24 hours</span>
              </div>
              <ResponsiveContainer width="100%" height={190}>
                <BarChart data={data?.hourly_throughput ?? []} barSize={18}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" vertical={false} />
                  <XAxis dataKey="hour" tick={{ fontSize: 10 }} tickFormatter={h => h.slice(11, 16)} interval={3} />
                  <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                  <Tooltip labelFormatter={l => `Hour: ${l}`} formatter={(v: any) => [v, 'Units']} />
                  <Bar dataKey="count" fill={BLUE} radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Alerts + Recent Completions */}
          <div className="grid grid-cols-5 gap-6">
            {/* Active Alerts */}
            <div className="col-span-2 bg-white rounded-xl border border-gray-200 shadow-sm p-5">
              <div className="flex items-center gap-2 mb-4">
                <AlertTriangle size={16} className="text-red-500" />
                <h2 className="font-semibold text-gray-900">Active Alerts</h2>
                {(data?.active_alerts ?? []).length > 0 && (
                  <span className="ml-auto bg-red-100 text-red-700 text-xs font-semibold px-2 py-0.5 rounded-full">
                    {data!.active_alerts.length}
                  </span>
                )}
              </div>
              <div className="space-y-2">
                {(data?.active_alerts ?? []).length === 0 && (
                  <div className="text-center py-8">
                    <CheckCircle2 size={28} className="text-green-400 mx-auto mb-2" />
                    <p className="text-gray-400 text-sm">No active alerts</p>
                  </div>
                )}
                {(data?.active_alerts ?? []).map(alert => (
                  <div
                    key={alert.id}
                    className={`flex items-start gap-3 p-3 rounded-lg border ${
                      alert.status === 'overdue'
                        ? 'bg-red-50 border-red-200'
                        : 'bg-amber-50 border-amber-200'
                    }`}
                  >
                    <AlertTriangle
                      size={14}
                      className={`flex-shrink-0 mt-0.5 ${alert.status === 'overdue' ? 'text-red-500' : 'text-amber-500'}`}
                    />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-xs text-gray-900">{alert.work_order_number}</span>
                        <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${
                          alert.status === 'overdue'
                            ? 'bg-red-200 text-red-800'
                            : 'bg-amber-200 text-amber-800'
                        }`}>
                          {alert.status === 'overdue' ? 'Overdue' : 'Behind'}
                        </span>
                      </div>
                      <div className="text-xs text-gray-700 truncate">{alert.part_name}</div>
                      <div className="text-xs text-gray-500">{alert.department} · {alert.completion_pct}% complete</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Recent Completions */}
            <div className="col-span-3 bg-white rounded-xl border border-gray-200 shadow-sm p-5">
              <div className="flex items-center justify-between mb-4">
                <h2 className="font-semibold text-gray-900">Recent Completions</h2>
                <Link to="/analytics" className="text-xs text-blue-600 hover:text-blue-700 flex items-center gap-1">
                  View all <ChevronRight size={12} />
                </Link>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-100">
                      <th className="text-left text-xs font-medium text-gray-500 pb-2">App</th>
                      <th className="text-left text-xs font-medium text-gray-500 pb-2">Operator</th>
                      <th className="text-left text-xs font-medium text-gray-500 pb-2">Dept</th>
                      <th className="text-left text-xs font-medium text-gray-500 pb-2">Duration</th>
                      <th className="text-left text-xs font-medium text-gray-500 pb-2">Time</th>
                      <th className="text-left text-xs font-medium text-gray-500 pb-2">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {(data?.recent_completions ?? []).length === 0 && (
                      <tr>
                        <td colSpan={6} className="text-center text-gray-400 text-xs py-6">No recent completions</td>
                      </tr>
                    )}
                    {(data?.recent_completions ?? []).slice(0, 10).map(c => (
                      <tr key={c.id} className="hover:bg-gray-50 transition-colors">
                        <td className="py-2.5 pr-3 text-xs font-medium text-gray-900 truncate max-w-[140px]">{c.app_name}</td>
                        <td className="py-2.5 pr-3 text-xs text-gray-600">{c.operator_name}</td>
                        <td className="py-2.5 pr-3 text-xs text-gray-500">{c.department}</td>
                        <td className="py-2.5 pr-3 text-xs text-gray-700 tabular-nums">{formatDuration(c.duration_minutes)}</td>
                        <td className="py-2.5 pr-3 text-xs text-gray-400">{formatTimeAgo(c.completed_at)}</td>
                        <td className="py-2.5">
                          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                            c.status === 'completed' ? 'bg-green-100 text-green-700' :
                            c.status === 'in_progress' ? 'bg-blue-100 text-blue-700' :
                            'bg-gray-100 text-gray-600'
                          }`}>
                            {c.status === 'in_progress' ? 'Running' : c.status}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function KPICard({ icon, bg, label, value, color }: {
  icon: React.ReactNode;
  bg: string;
  label: string;
  value: string | number;
  color?: string;
}) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
      <div className={`w-9 h-9 ${bg} rounded-lg flex items-center justify-center mb-3`}>{icon}</div>
      <div className={`text-2xl font-bold ${color ?? 'text-gray-900'}`}>{value}</div>
      <div className="text-xs text-gray-500 mt-0.5">{label}</div>
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
  const map: Record<string, { label: string; cls: string }> = {
    on_track: { label: 'On Track', cls: 'bg-green-100 text-green-700' },
    at_risk: { label: 'At Risk', cls: 'bg-amber-100 text-amber-700' },
    behind: { label: 'Behind', cls: 'bg-red-100 text-red-700' },
  };
  const s = map[status] ?? { label: status, cls: 'bg-gray-100 text-gray-600' };
  return (
    <span className={`text-xs font-semibold px-2 py-1 rounded-full ${s.cls}`}>{s.label}</span>
  );
}

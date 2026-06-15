import { useEffect, useState, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import { api } from '../api/client';
import {
  CheckCircle2, Activity, TrendingUp, Clock, Package, RefreshCw,
  ArrowLeft, Monitor, User, ChevronRight, Calendar
} from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';

interface DeptViewData {
  department: { id: string; name: string; color: string; manager_name: string; description: string; headcount: number };
  kpis: {
    completed_today: number; active_now: number; pass_rate: number;
    avg_cycle_time: number; wos_on_track: number; wos_total: number;
  };
  stations: Array<{
    id: string; name: string; location: string; status: string;
    current_status: string; current_status_since: string | null;
    current_app_id: string | null; current_app_name: string | null;
    active_completion: { id: string; operator_name: string; app_name: string; started_at: string } | null;
    oee: { availability: number; performance: number; quality: number; oee: number; completions_today: number };
  }>;
  work_orders: Array<{
    id: string; work_order_number: string; part_name: string; app_name: string | null;
    quantity: number; quantity_completed: number; scheduled_end: string;
    priority: string; schedule_status: string; completion_pct: number;
  }>;
  hourly_throughput: Array<{ hour: string; count: number }>;
  recent_completions: Array<{
    id: string; app_name: string; operator_name: string; status: string;
    station_name: string | null; completed_at: string; duration_minutes: number;
  }>;
}

const MACHINE_STATUS: Record<string, { label: string; dot: string; text: string }> = {
  running:     { label: 'Running',     dot: 'bg-green-500',  text: 'text-green-700' },
  idle:        { label: 'Idle',        dot: 'bg-gray-400',   text: 'text-gray-600' },
  down:        { label: 'Down',        dot: 'bg-red-500',    text: 'text-red-700' },
  maintenance: { label: 'Maintenance', dot: 'bg-amber-500',  text: 'text-amber-700' },
};

const SCHEDULE_PILL: Record<string, string> = {
  on_track:    'bg-green-100 text-green-700',
  at_risk:     'bg-amber-100 text-amber-700',
  behind:      'bg-red-100 text-red-700',
  overdue:     'bg-red-200 text-red-800',
  not_started: 'bg-gray-100 text-gray-600',
  completed:   'bg-blue-100 text-blue-700',
};

function elapsedSince(iso: string) {
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return 'just started';
  if (mins < 60) return `${mins}m`;
  return `${Math.floor(mins / 60)}h ${mins % 60}m`;
}

function formatTimeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 60000) return 'just now';
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  return new Date(iso).toLocaleDateString([], { month: 'short', day: 'numeric' });
}

export default function DepartmentView() {
  const { id } = useParams<{ id: string }>();
  const [data, setData] = useState<DeptViewData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const load = useCallback(async () => {
    if (!id) return;
    try {
      setData(await api.getDepartmentView(id));
      setError(false);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    setLoading(true);
    load();
    const interval = setInterval(load, 30000);
    return () => clearInterval(interval);
  }, [load]);

  if (loading) return (
    <div className="flex items-center justify-center h-64">
      <RefreshCw size={28} className="animate-spin text-blue-500" />
    </div>
  );

  if (error || !data) return (
    <div className="p-6 text-center text-gray-400">
      <p>Department not found</p>
      <Link to="/dashboard" className="text-blue-600 text-sm hover:underline mt-2 inline-block">← Back to Command Center</Link>
    </div>
  );

  const { department: dept, kpis } = data;

  return (
    <div className="min-h-screen bg-[#f8fafc] p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Link to="/dashboard" className="p-2 hover:bg-gray-100 rounded-lg text-gray-400 hover:text-gray-600 transition-colors">
            <ArrowLeft size={18} />
          </Link>
          <div className="w-1.5 h-12 rounded-full" style={{ backgroundColor: dept.color }} />
          <div>
            <h1 className="text-2xl font-bold text-gray-900">{dept.name}</h1>
            <p className="text-gray-500 text-sm">
              {dept.manager_name && <>Manager: {dept.manager_name} · </>}
              {dept.headcount > 0 && <>{dept.headcount} operators · </>}
              {data.stations.length} station{data.stations.length !== 1 ? 's' : ''}
            </p>
          </div>
        </div>
        <button onClick={load} className="flex items-center gap-2 px-3 py-2 bg-white border border-gray-200 rounded-lg text-sm text-gray-600 hover:bg-gray-50 shadow-sm">
          <RefreshCw size={14} /> Refresh
        </button>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-4">
        <KPICard icon={<CheckCircle2 size={18} className="text-green-600" />} bg="bg-green-50" label="Completed Today" value={kpis.completed_today} />
        <KPICard icon={<Activity size={18} className="text-blue-600" />} bg="bg-blue-50" label="Active Now" value={kpis.active_now} />
        <KPICard icon={<TrendingUp size={18} className="text-purple-600" />} bg="bg-purple-50" label="Pass Rate (7d)" value={`${kpis.pass_rate}%`} />
        <KPICard icon={<Clock size={18} className="text-orange-600" />} bg="bg-orange-50" label="Avg Cycle Time" value={kpis.avg_cycle_time ? `${kpis.avg_cycle_time}m` : '—'} />
        <KPICard icon={<Package size={18} className="text-indigo-600" />} bg="bg-indigo-50" label="WOs On Track" value={`${kpis.wos_on_track} / ${kpis.wos_total}`} />
      </div>

      {/* Stations */}
      <div>
        <h2 className="text-base font-semibold text-gray-900 mb-3">Stations</h2>
        {data.stations.length === 0 ? (
          <div className="text-center text-gray-400 text-sm py-8 bg-white rounded-xl border border-gray-200">
            No stations assigned to this department yet. Assign stations from the <Link to="/stations" className="text-blue-600 hover:underline">Stations</Link> page.
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {data.stations.map(st => {
              const ms = MACHINE_STATUS[st.current_status] ?? MACHINE_STATUS.idle;
              return (
                <Link key={st.id} to={`/stations/${st.id}`}
                  className="bg-white rounded-xl border border-gray-200 shadow-sm p-4 hover:shadow-md hover:border-gray-300 transition-all block">
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex items-center gap-2.5">
                      <Monitor size={16} className="text-gray-400" />
                      <div className="font-semibold text-gray-900 text-sm">{st.name}</div>
                    </div>
                    <span className={`flex items-center gap-1.5 text-xs font-medium ${ms.text}`}>
                      <span className={`w-2 h-2 rounded-full ${ms.dot} ${st.current_status === 'running' ? 'animate-pulse' : ''}`} />
                      {ms.label}
                      {st.current_status_since && <span className="text-gray-400 font-normal">· {elapsedSince(st.current_status_since)}</span>}
                    </span>
                  </div>
                  {st.active_completion ? (
                    <div className="bg-blue-50 border border-blue-100 rounded-lg px-3 py-2 mb-3">
                      <div className="flex items-center gap-1.5 text-xs text-blue-700 font-medium">
                        <User size={11} /> {st.active_completion.operator_name}
                        <span className="text-blue-400">running</span>
                      </div>
                      <div className="text-xs text-blue-900 font-semibold truncate">{st.active_completion.app_name}</div>
                      <div className="text-[11px] text-blue-400">{elapsedSince(st.active_completion.started_at)} elapsed</div>
                    </div>
                  ) : (
                    <div className="bg-gray-50 rounded-lg px-3 py-2 mb-3 text-xs text-gray-500">
                      {st.current_app_name ? <>Assigned: <span className="font-medium text-gray-700">{st.current_app_name}</span></> : 'No app assigned'}
                    </div>
                  )}
                  <div className="flex items-center justify-between text-xs text-gray-500">
                    <span>OEE <span className={`font-bold ${st.oee.oee >= 80 ? 'text-green-600' : st.oee.oee >= 60 ? 'text-amber-600' : 'text-red-600'}`}>{st.oee.oee}%</span></span>
                    <span>{st.oee.completions_today} today</span>
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </div>

      {/* WOs + throughput */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold text-gray-900">Work Orders</h2>
            <Link to="/schedule" className="text-xs text-blue-600 hover:text-blue-700 flex items-center gap-1">
              Schedule <ChevronRight size={12} />
            </Link>
          </div>
          <div className="space-y-2.5">
            {data.work_orders.length === 0 && (
              <div className="text-center text-gray-400 text-sm py-8">No active work orders</div>
            )}
            {data.work_orders.map(wo => (
              <div key={wo.id} className="border border-gray-100 rounded-lg p-3">
                <div className="flex items-center justify-between mb-1.5">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-xs text-gray-900">{wo.work_order_number}</span>
                    <span className={`text-[11px] px-1.5 py-0.5 rounded-full font-medium ${SCHEDULE_PILL[wo.schedule_status] ?? 'bg-gray-100 text-gray-600'}`}>
                      {wo.schedule_status.replace('_', ' ')}
                    </span>
                  </div>
                  <span className="text-xs text-gray-400 flex items-center gap-1">
                    <Calendar size={10} /> {new Date(wo.scheduled_end).toLocaleDateString([], { month: 'short', day: 'numeric' })}
                  </span>
                </div>
                <div className="text-xs text-gray-600 truncate mb-1.5">{wo.part_name}</div>
                <div className="flex items-center gap-2">
                  <div className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                    <div className="h-full bg-blue-500 rounded-full" style={{ width: `${wo.completion_pct}%` }} />
                  </div>
                  <span className="text-[11px] text-gray-500 tabular-nums">{wo.quantity_completed}/{wo.quantity}</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="space-y-6">
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-semibold text-gray-900">Hourly Throughput</h2>
              <span className="text-xs text-gray-400">Last 24 hours</span>
            </div>
            <ResponsiveContainer width="100%" height={150}>
              <BarChart data={data.hourly_throughput} barSize={14}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" vertical={false} />
                <XAxis dataKey="hour" tick={{ fontSize: 10 }} tickFormatter={h => h.slice(11, 16)} interval={3} />
                <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                <Tooltip labelFormatter={l => `Hour: ${l}`} formatter={(v: any) => [v, 'Units']} />
                <Bar dataKey="count" fill={dept.color || '#3b82f6'} radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>

          <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
            <h2 className="font-semibold text-gray-900 mb-3">Recent Completions</h2>
            <div className="divide-y divide-gray-50">
              {data.recent_completions.length === 0 && (
                <div className="text-center text-gray-400 text-xs py-6">No completions yet</div>
              )}
              {data.recent_completions.slice(0, 8).map(c => (
                <div key={c.id} className="flex items-center justify-between py-2 text-xs">
                  <div className="min-w-0">
                    <div className="font-medium text-gray-900 truncate">{c.app_name}</div>
                    <div className="text-gray-400">{c.operator_name}{c.station_name ? ` · ${c.station_name}` : ''}</div>
                  </div>
                  <div className="text-right flex-shrink-0 ml-3">
                    <span className={`px-2 py-0.5 rounded-full font-medium ${
                      c.status === 'completed' ? 'bg-green-100 text-green-700' :
                      c.status === 'in_progress' ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-600'
                    }`}>
                      {c.status === 'in_progress' ? 'Running' : c.status}
                    </span>
                    <div className="text-gray-400 mt-0.5">{formatTimeAgo(c.completed_at)}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function KPICard({ icon, bg, label, value }: { icon: React.ReactNode; bg: string; label: string; value: string | number }) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
      <div className={`w-9 h-9 ${bg} rounded-lg flex items-center justify-center mb-3`}>{icon}</div>
      <div className="text-2xl font-bold text-gray-900">{value}</div>
      <div className="text-xs text-gray-500 mt-0.5">{label}</div>
    </div>
  );
}

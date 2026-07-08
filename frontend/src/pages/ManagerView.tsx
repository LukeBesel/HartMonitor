import { useEffect, useState, useCallback, useRef } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client';
import {
  Users, Clock, CheckCircle2, AlertTriangle, Activity,
  RefreshCw, ChevronRight, Zap, Timer, Package, TrendingUp, TrendingDown
} from 'lucide-react';

// ── Types matching actual API response ────────────────────────────────────────

interface ActiveCompletion {
  id: string;
  app_name: string;
  operator_name: string;
  station_id: string | null;
  started_at: string;
  work_order_number: string | null;
  work_order_id: string | null;
}

interface WorkOrder {
  id: string;
  work_order_number: string;
  part_number: string;
  part_name: string;
  app_id: string | null;
  app_name?: string;
  department_name?: string;
  department_color?: string;
  quantity: number;
  quantity_completed: number;
  completion_pct: number;
  priority: 'critical' | 'high' | 'medium' | 'low';
  schedule_status: 'on_track' | 'at_risk' | 'behind' | 'not_started' | 'overdue' | 'completed';
  scheduled_start: string;
  scheduled_end: string;
  takt_time_minutes: number;
  status: string;
  notes: string;
}

interface DeptStat {
  id: string;
  name: string;
  color: string;
  manager_name: string;
  active_count: number;
  on_track_count: number;
  behind_count: number;
  total_work_orders: number;
}

interface ManagerViewData {
  active_completions: ActiveCompletion[];
  work_orders: WorkOrder[];
  department_stats: DeptStat[];
}

// ── Constants ─────────────────────────────────────────────────────────────────

const SCHEDULE_STATUS: Record<string, { label: string; cls: string }> = {
  on_track:    { label: 'On Track',    cls: 'bg-green-100 text-green-700 border border-green-200' },
  at_risk:     { label: 'At Risk',     cls: 'bg-amber-100 text-amber-700 border border-amber-200' },
  behind:      { label: 'Behind',      cls: 'bg-red-100 text-red-700 border border-red-200' },
  overdue:     { label: 'Overdue',     cls: 'bg-red-200 text-red-800 border border-red-300' },
  not_started: { label: 'Not Started', cls: 'bg-gray-100 text-gray-600 border border-gray-200' },
  completed:   { label: 'Completed',   cls: 'bg-emerald-100 text-emerald-700 border border-emerald-200' },
};

const PRIORITY: Record<string, { label: string; cls: string }> = {
  critical: { label: 'Critical', cls: 'bg-red-600 text-white' },
  high:     { label: 'High',     cls: 'bg-orange-500 text-white' },
  medium:   { label: 'Medium',   cls: 'bg-blue-500 text-white' },
  low:      { label: 'Low',      cls: 'bg-gray-400 text-white' },
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function useElapsedSeconds(startedAt: string) {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    const update = () => {
      const start = new Date(startedAt).getTime();
      setElapsed(isNaN(start) ? 0 : Math.max(0, Math.floor((Date.now() - start) / 1000)));
    };
    update();
    const t = setInterval(update, 1000);
    return () => clearInterval(t);
  }, [startedAt]);
  return elapsed;
}

function formatElapsed(seconds: number) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m ${String(s).padStart(2, '0')}s`;
}

function formatDate(iso: string) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

function calcETA(wo: WorkOrder): string {
  if (wo.quantity_completed >= wo.quantity) return 'Complete';
  const remaining = wo.quantity - wo.quantity_completed;
  const etaMins = remaining * (wo.takt_time_minutes || 15);
  if (etaMins < 60) return `~${Math.round(etaMins)}m`;
  return `~${(etaMins / 60).toFixed(1)}h`;
}

// ── Sub-components ────────────────────────────────────────────────────────────

function ActiveRunCard({ run }: { run: ActiveCompletion }) {
  const elapsed = useElapsedSeconds(run.started_at);
  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4 flex flex-col gap-2">
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-2">
          <span className="w-2.5 h-2.5 rounded-full bg-green-500 animate-pulse flex-shrink-0 mt-0.5" />
          <span className="font-semibold text-sm text-gray-900 leading-tight">{run.app_name}</span>
        </div>
        <span className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full font-medium flex-shrink-0">Running</span>
      </div>
      <div className="flex items-center gap-2 text-xs text-gray-500">
        <Users size={12} />
        <span>{run.operator_name || 'Unknown'}</span>
      </div>
      <div className="flex items-center gap-2 text-xs text-gray-700 font-mono font-medium">
        <Timer size={12} className="text-blue-500" />
        <span className="tabular-nums">{formatElapsed(elapsed)}</span>
      </div>
      {run.work_order_number && (
        <div className="flex items-center gap-1.5 text-xs text-blue-600">
          <Package size={11} />
          <span>WO: {run.work_order_number}</span>
        </div>
      )}
    </div>
  );
}

function WorkOrderCard({ wo }: { wo: WorkOrder }) {
  const pct = wo.completion_pct ?? (wo.quantity > 0 ? Math.round((wo.quantity_completed / wo.quantity) * 100) : 0);
  const schedStatus = SCHEDULE_STATUS[wo.schedule_status] ?? SCHEDULE_STATUS.not_started;
  const priorityInfo = PRIORITY[wo.priority] ?? PRIORITY.low;
  const barColor =
    wo.schedule_status === 'on_track'  ? 'bg-green-500' :
    wo.schedule_status === 'at_risk'   ? 'bg-amber-500' :
    wo.schedule_status === 'behind'    ? 'bg-red-500'   :
    wo.schedule_status === 'overdue'   ? 'bg-red-600'   : 'bg-gray-300';

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4 space-y-3 hover:shadow-md transition-shadow">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-xs text-gray-400 font-mono">{wo.work_order_number}</div>
          <div className="font-bold text-sm text-gray-900 leading-tight truncate">{wo.part_name}</div>
          <div className="text-xs text-gray-500">{wo.part_number}</div>
        </div>
        <span className={`text-xs font-semibold px-2 py-0.5 rounded-full flex-shrink-0 ${priorityInfo.cls}`}>
          {priorityInfo.label}
        </span>
      </div>
      <div>
        <div className="flex justify-between items-center mb-1">
          <span className="text-xs text-gray-500">{wo.quantity_completed} / {wo.quantity} units</span>
          <span className="text-xs font-semibold text-gray-900">{pct}%</span>
        </div>
        <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
          <div className={`h-full rounded-full transition-all ${barColor}`} style={{ width: `${pct}%` }} />
        </div>
      </div>
      <div className="flex items-center gap-2 flex-wrap">
        <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${schedStatus.cls}`}>{schedStatus.label}</span>
        <span className="text-xs text-gray-400">|</span>
        <span className="text-xs text-gray-600 flex items-center gap-1">
          <Clock size={10} className="flex-shrink-0" />
          {wo.takt_time_minutes}m takt
        </span>
        <span className="text-xs text-gray-400">|</span>
        <span className="text-xs text-gray-600">ETA: {calcETA(wo)}</span>
      </div>
      <div className="flex items-center gap-1.5 text-xs text-gray-400">
        <ChevronRight size={10} />
        {formatDate(wo.scheduled_start)} – {formatDate(wo.scheduled_end)}
        {wo.department_name && (
          <span
            className="ml-auto text-xs font-medium px-2 py-0.5 rounded-full"
            style={{ backgroundColor: (wo.department_color || '#6b7280') + '22', color: wo.department_color || '#6b7280' }}
          >
            {wo.department_name}
          </span>
        )}
      </div>
    </div>
  );
}

function QuickStat({ icon, bg, label, value, sub }: {
  icon: React.ReactNode; bg: string; label: string; value: string | number; sub?: string;
}) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4 flex items-center gap-3">
      <div className={`w-10 h-10 ${bg} rounded-lg flex items-center justify-center flex-shrink-0`}>{icon}</div>
      <div>
        <div className="text-2xl font-bold text-gray-900 leading-none">{value}</div>
        <div className="text-xs text-gray-500 mt-0.5">{label}</div>
        {sub && <div className="text-xs text-gray-400 mt-0.5">{sub}</div>}
      </div>
    </div>
  );
}

// ── Main Component ─────────────────────────────────────────────────────────────

const ALL_DEPARTMENTS = 'All';

export default function ManagerView() {
  const [data, setData] = useState<ManagerViewData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [activeDept, setActiveDept] = useState(ALL_DEPARTMENTS);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(async (showSpinner = false) => {
    if (showSpinner) setRefreshing(true);
    try {
      const mvData = await api.getManagerView();
      setData(mvData);
      setError(null);
    } catch (err: any) {
      // keep stale data if we have it; surface the error otherwise
      setError(err.message || 'Failed to load operations data');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    load(true);
    intervalRef.current = setInterval(() => load(false), 15000);
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [load]);

  const workOrders: WorkOrder[] = data?.work_orders ?? [];
  const activeCompletions: ActiveCompletion[] = data?.active_completions ?? [];
  const deptStats: DeptStat[] = data?.department_stats ?? [];

  const departments = [ALL_DEPARTMENTS, ...Array.from(new Set(workOrders.map(wo => wo.department_name).filter(Boolean) as string[]))];

  const filteredWOs = workOrders.filter(wo =>
    activeDept === ALL_DEPARTMENTS || wo.department_name === activeDept
  );

  const totalOnTrack = deptStats.reduce((s, d) => s + d.on_track_count, 0);
  const totalBehind = deptStats.reduce((s, d) => s + d.behind_count, 0);
  const totalWOs = workOrders.length;

  return (
    <div className="min-h-screen bg-[#f8fafc] p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <div className="flex items-center gap-2">
            <Activity size={20} className="text-blue-600" />
            <h1 className="text-2xl font-bold text-gray-900">Operations Manager</h1>
          </div>
          <p className="text-gray-500 text-sm mt-0.5">Live production floor view — auto-refreshes every 15s</p>
        </div>
        <button
          onClick={() => load(true)}
          disabled={refreshing}
          className="flex items-center gap-2 px-3 py-2 bg-white border border-gray-200 rounded-lg text-sm text-gray-600 hover:bg-gray-50 transition-colors shadow-sm disabled:opacity-60"
        >
          <RefreshCw size={14} className={refreshing ? 'animate-spin text-blue-500' : ''} />
          Refresh
        </button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-64">
          <div className="flex flex-col items-center gap-3">
            <RefreshCw size={28} className="animate-spin text-blue-500" />
            <span className="text-gray-500 text-sm">Loading operations data…</span>
          </div>
        </div>
      ) : error && !data ? (
        <div className="flex flex-col items-center justify-center h-64 text-center">
          <AlertTriangle size={32} className="text-red-400 mb-3" />
          <p className="text-gray-500 font-medium">Couldn't load operations data</p>
          <p className="text-gray-400 text-sm mt-1">{error}</p>
          <button onClick={() => load(true)} className="btn-secondary mt-4">
            <RefreshCw size={14} /> Retry
          </button>
        </div>
      ) : (
        <>
          {/* Quick Stats */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <QuickStat
              icon={<Users size={18} className="text-blue-600" />}
              bg="bg-blue-50"
              label="Active Operators"
              value={activeCompletions.length}
              sub="currently running"
            />
            <QuickStat
              icon={<TrendingUp size={18} className="text-green-600" />}
              bg="bg-green-50"
              label="On Track"
              value={totalOnTrack}
              sub="work orders"
            />
            <QuickStat
              icon={<TrendingDown size={18} className="text-red-500" />}
              bg="bg-red-50"
              label="Behind / At Risk"
              value={totalBehind}
              sub="work orders"
            />
            <QuickStat
              icon={<Package size={18} className="text-purple-600" />}
              bg="bg-purple-50"
              label="Total Work Orders"
              value={totalWOs}
              sub="in schedule"
            />
          </div>

          {/* Live Active Runs */}
          <section>
            <div className="flex items-center gap-2 mb-3">
              <span className="w-2.5 h-2.5 rounded-full bg-green-500 animate-pulse" />
              <h2 className="text-base font-semibold text-gray-900">Live Active Runs</h2>
              <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full font-medium">
                {activeCompletions.length} running
              </span>
            </div>
            {activeCompletions.length === 0 ? (
              <div className="bg-white rounded-xl border border-gray-200 shadow-sm py-10 text-center text-gray-400 text-sm">
                <Zap size={28} className="mx-auto mb-2 text-gray-300" />
                No active runs at the moment
              </div>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
                {activeCompletions.map(run => (
                  <ActiveRunCard key={run.id} run={run} />
                ))}
              </div>
            )}
          </section>

          {/* Department filter tabs */}
          <div className="flex items-center gap-1 bg-gray-100 rounded-lg p-1 w-fit overflow-x-auto">
            {departments.map(dept => (
              <button
                key={dept}
                onClick={() => setActiveDept(dept)}
                className={`px-3 py-1.5 rounded-md text-xs font-medium whitespace-nowrap transition-colors ${
                  activeDept === dept
                    ? 'bg-white text-gray-900 shadow-sm'
                    : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                {dept}
                {dept !== ALL_DEPARTMENTS && (
                  <span className="ml-1 text-gray-400">
                    ({workOrders.filter(wo => wo.department_name === dept).length})
                  </span>
                )}
              </button>
            ))}
          </div>

          {/* Work Order Grid */}
          <section>
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-base font-semibold text-gray-900">Work Orders</h2>
              <Link to="/schedule" className="text-xs text-blue-600 hover:text-blue-700 flex items-center gap-1">
                Manage Schedule <ChevronRight size={12} />
              </Link>
            </div>
            {filteredWOs.length === 0 ? (
              <div className="bg-white rounded-xl border border-gray-200 shadow-sm py-12 text-center text-gray-400 text-sm">
                <Package size={28} className="mx-auto mb-2 text-gray-300" />
                No work orders found
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-4">
                {filteredWOs.map(wo => (
                  <WorkOrderCard key={wo.id} wo={wo} />
                ))}
              </div>
            )}
          </section>

          {/* Department Stats */}
          {deptStats.length > 0 && (
            <section>
              <h2 className="text-base font-semibold text-gray-900 mb-3">Department Summary</h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                {deptStats.map(dept => {
                  const onTrackPct = dept.total_work_orders > 0
                    ? Math.round((dept.on_track_count / dept.total_work_orders) * 100) : 0;
                  const statusColor =
                    onTrackPct >= 75 ? 'text-green-600 bg-green-50 border-green-200' :
                    onTrackPct >= 50 ? 'text-amber-600 bg-amber-50 border-amber-200' :
                    'text-red-600 bg-red-50 border-red-200';
                  return (
                    <div key={dept.id} className="bg-white rounded-xl border border-gray-200 shadow-sm p-4">
                      <div className="flex items-start justify-between mb-3">
                        <div>
                          <div
                            className="w-2.5 h-2.5 rounded-full inline-block mr-2"
                            style={{ backgroundColor: dept.color }}
                          />
                          <span className="font-semibold text-gray-900 text-sm">{dept.name}</span>
                          {dept.manager_name && (
                            <div className="text-xs text-gray-400 mt-0.5">{dept.manager_name}</div>
                          )}
                        </div>
                        <span className={`text-xs font-semibold px-2 py-0.5 rounded-full border ${statusColor}`}>
                          {dept.active_count} active
                        </span>
                      </div>
                      <div className="grid grid-cols-3 gap-2 text-center mb-3">
                        <div>
                          <div className="text-lg font-bold text-gray-900">{dept.on_track_count}</div>
                          <div className="text-xs text-gray-400">On Track</div>
                        </div>
                        <div>
                          <div className="text-lg font-bold text-amber-600">{dept.behind_count}</div>
                          <div className="text-xs text-gray-400">Behind</div>
                        </div>
                        <div>
                          <div className="text-lg font-bold text-gray-900">{dept.total_work_orders}</div>
                          <div className="text-xs text-gray-400">Total WOs</div>
                        </div>
                      </div>
                      <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                        <div
                          className={`h-full rounded-full ${onTrackPct >= 75 ? 'bg-green-500' : onTrackPct >= 50 ? 'bg-amber-500' : 'bg-red-500'}`}
                          style={{ width: `${onTrackPct}%` }}
                        />
                      </div>
                      <div className="text-xs text-gray-400 mt-1 text-right">{onTrackPct}% on track</div>
                      {dept.behind_count > 0 && (
                        <div className="flex items-center gap-1.5 mt-2 text-xs text-red-500">
                          <AlertTriangle size={11} />
                          {dept.behind_count} WO{dept.behind_count > 1 ? 's' : ''} behind schedule
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );
}

import { useEffect, useState, useCallback, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client';
import {
  Users, Clock, AlertTriangle, Activity,
  RefreshCw, ChevronRight, Zap, Timer, Package, TrendingUp, TrendingDown
} from 'lucide-react';
import { useAutoRefresh } from '../hooks/useAutoRefresh';
import LastRefreshed from '../components/shared/LastRefreshed';
import DepartmentFilter from '../components/shared/DepartmentFilter';
import { useDepartmentFilter } from '../hooks/useDepartmentFilter';
import { tintedChipStyle } from '../utils/contrast';
import { useIsDark } from '../utils/useIsDark';
import { elapsedSeconds, fmtDuration, fmtMinutes } from '../components/apps/appModel';

// ── Types matching actual API response ────────────────────────────────────────

// The manager-view endpoint joins each in-progress run to its work order's
// department, so a run carries a department whenever it belongs to a work
// order. Ad-hoc runs (no work order) have none — they are counted separately
// rather than being assigned to whichever department is on screen.
interface ActiveCompletion {
  id: string;
  app_name: string;
  operator_name: string;
  station_id: string | null;
  started_at: string;
  work_order_number: string | null;
  work_order_id: string | null;
  department_id?: string | null;
  department_name?: string | null;
  department_color?: string | null;
}

interface WorkOrder {
  id: string;
  work_order_number: string;
  part_number: string;
  part_name: string;
  app_id: string | null;
  app_name?: string;
  department_id?: string | null;
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
    // elapsedSeconds parses SQLite's "YYYY-MM-DD HH:MM:SS" as UTC
    // (parseServerTime) — `new Date(startedAt)` used to read that same string
    // as LOCAL time, so a run in a UTC-behind timezone (e.g. America/Chicago)
    // could show "0s" elapsed while another screen reading the identical run
    // through the shared helper showed several minutes.
    const update = () => setElapsed(elapsedSeconds(startedAt) ?? 0);
    update();
    const t = setInterval(update, 1000);
    return () => clearInterval(t);
  }, [startedAt]);
  return elapsed;
}

function formatDate(iso: string) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

// Remaining-time estimate from the work order's takt time. With no takt set
// there is nothing to project from, so it reports "—" instead of the invented
// 15-minutes-per-unit assumption it used to fall back on.
function calcETA(wo: WorkOrder): string {
  if (wo.quantity_completed >= wo.quantity) return 'Complete';
  if (!wo.takt_time_minutes || wo.takt_time_minutes <= 0) return '—';
  const remaining = wo.quantity - wo.quantity_completed;
  const etaMins = remaining * wo.takt_time_minutes;
  return `~${fmtMinutes(etaMins)}`;
}

// ── Sub-components ────────────────────────────────────────────────────────────

function ActiveRunCard({ run }: { run: ActiveCompletion }) {
  const elapsed = useElapsedSeconds(run.started_at);
  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4 flex flex-col gap-2" data-testid="active-run">
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
        <span className="tabular-nums">{fmtDuration(elapsed)}</span>
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
  const darkMode = useIsDark();
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
          {wo.takt_time_minutes > 0 ? `${fmtMinutes(wo.takt_time_minutes)} takt` : 'no takt set'}
        </span>
        <span className="text-xs text-gray-400">|</span>
        <span className="text-xs text-gray-600" title={wo.takt_time_minutes > 0 ? undefined : 'Set a takt time on this work order to estimate remaining time'}>
          ETA: {calcETA(wo)}
        </span>
      </div>
      <div className="flex items-center gap-1.5 text-xs text-gray-400">
        <ChevronRight size={10} />
        {formatDate(wo.scheduled_start)} – {formatDate(wo.scheduled_end)}
        {wo.department_name && (
          <span
            className="ml-auto text-xs font-medium px-2 py-0.5 rounded-full"
            style={tintedChipStyle(wo.department_color, darkMode)}
          >
            {wo.department_name}
          </span>
        )}
      </div>
    </div>
  );
}

function QuickStat({ icon, bg, label, value, sub, testId }: {
  icon: React.ReactNode; bg: string; label: string; value: string | number; sub?: string; testId?: string;
}) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4 flex items-center gap-3">
      <div className={`w-10 h-10 ${bg} rounded-lg flex items-center justify-center flex-shrink-0`}>{icon}</div>
      <div>
        <div className="text-2xl font-bold text-gray-900 leading-none" data-testid={testId}>{value}</div>
        <div className="text-xs text-gray-500 mt-0.5">{label}</div>
        {sub && <div className="text-xs text-gray-400 mt-0.5">{sub}</div>}
      </div>
    </div>
  );
}

// Shown when the plant has rows but the chosen department has none — a dead end
// the manager can back out of, rather than a screen that just looks broken.
function FilteredEmpty({ icon, message, hint, onClear }: {
  icon: React.ReactNode; message: string; hint?: string; onClear: () => void;
}) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm py-10 text-center">
      <div className="mx-auto mb-2 text-gray-300 w-fit">{icon}</div>
      <p className="text-sm text-gray-500">{message}</p>
      {hint && <p className="text-xs text-gray-400 mt-1">{hint}</p>}
      <button onClick={onClear} className="btn-secondary mt-4 mx-auto">
        Show all departments
      </button>
    </div>
  );
}

// ── Main Component ─────────────────────────────────────────────────────────────

export default function ManagerView() {
  const [data, setData] = useState<ManagerViewData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const dept = useDepartmentFilter('manager');

  const load = useCallback(async () => {
    try {
      const mvData = await api.getManagerView();
      setData(mvData);
      setError(null);
    } catch (err: any) {
      // keep stale data if we have it; surface the error otherwise
      setError(err.message || 'Failed to load operations data');
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  // The floor moves minute to minute — 15s while the tab is visible.
  const auto = useAutoRefresh(load, 15_000);

  const workOrders: WorkOrder[] = data?.work_orders ?? [];
  const activeCompletions: ActiveCompletion[] = data?.active_completions ?? [];
  const deptStats: DeptStat[] = data?.department_stats ?? [];

  // One department choice scopes the whole page: the tiles, the live runs, the
  // work order grid and the department summary all read from these three sets.
  // Previously only the grid was filtered, so a manager who picked "Welding"
  // read plant-wide totals directly above welding's work orders.
  const { matches } = dept;
  const filteredWOs = useMemo(() => workOrders.filter(matches), [workOrders, matches]);
  const filteredRuns = useMemo(() => activeCompletions.filter(matches), [activeCompletions, matches]);
  const filteredDeptStats = useMemo(
    () => (dept.active ? deptStats.filter(d => d.id === dept.departmentId) : deptStats),
    [deptStats, dept.active, dept.departmentId],
  );

  // Runs that belong to no work order have no department to file them under.
  // They are never silently folded into the selected department; the Live
  // Active Runs heading says how many are being held back instead.
  const undepartmentedRuns = useMemo(
    () => activeCompletions.filter(r => !r.department_id && !r.department_name).length,
    [activeCompletions],
  );

  // All four tiles are counted from the same filtered work-order set, so they
  // agree with each other and with the grid below. The old tiles mixed sources:
  // "On Track"/"Behind" summed per-department stats (which silently drop work
  // orders with no department) while "Total" counted every work order.
  const totalOnTrack = filteredWOs.filter(wo => wo.schedule_status === 'on_track').length;
  const totalBehind = filteredWOs.filter(wo =>
    wo.schedule_status === 'behind' || wo.schedule_status === 'overdue' || wo.schedule_status === 'at_risk'
  ).length;
  const totalWOs = filteredWOs.length;

  const scopeLabel = dept.selected ? dept.selected.name : 'plant-wide';

  return (
    <div className="min-h-screen bg-[#f8fafc] p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <div className="flex items-center gap-2">
            <Activity size={20} className="text-blue-600" />
            <h1 className="text-2xl font-bold text-gray-900">Operations Manager</h1>
          </div>
          <p className="text-gray-500 text-sm mt-0.5">
            {dept.selected
              ? `${dept.selected.name} — auto-refreshes every 15s`
              : 'Live production floor view — auto-refreshes every 15s'}
          </p>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <DepartmentFilter
            filter={dept}
            matchCount={filteredWOs.length}
            matchNoun={filteredWOs.length === 1 ? 'work order' : 'work orders'}
          />
          <LastRefreshed
            at={auto.lastRefreshed}
            refreshing={auto.refreshing}
            onRefresh={() => { void auto.refresh(); }}
          />
        </div>
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
          <button onClick={() => { void auto.refresh(); }} className="btn-secondary mt-4">
            <RefreshCw size={14} /> Retry
          </button>
        </div>
      ) : (
        <>
          {/* Quick Stats */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {/* "Active Runs", not "Active Operators": this counts in-progress
                runs, and one operator can have more than one going. It now
                matches the Live Active Runs section below exactly. */}
            <QuickStat
              icon={<Users size={18} className="text-blue-600" />}
              bg="bg-blue-50"
              label="Active Runs"
              value={filteredRuns.length}
              sub={`in progress · ${scopeLabel}`}
              testId="stat-active-runs"
            />
            <QuickStat
              icon={<TrendingUp size={18} className="text-green-600" />}
              bg="bg-green-50"
              label="On Track"
              value={totalOnTrack}
              sub={`work orders · ${scopeLabel}`}
              testId="stat-on-track"
            />
            <QuickStat
              icon={<TrendingDown size={18} className="text-red-500" />}
              bg="bg-red-50"
              label="Behind / At Risk"
              value={totalBehind}
              sub={`behind, overdue or at risk · ${scopeLabel}`}
              testId="stat-behind"
            />
            <QuickStat
              icon={<Package size={18} className="text-purple-600" />}
              bg="bg-purple-50"
              label="Total Work Orders"
              value={totalWOs}
              sub={`in schedule · ${scopeLabel}`}
              testId="stat-total-wos"
            />
          </div>

          {/* Live Active Runs — scoped to the selected department via the
              work order each run belongs to. */}
          <section>
            <div className="flex items-center gap-2 mb-3 flex-wrap">
              <span className="w-2.5 h-2.5 rounded-full bg-green-500 animate-pulse" />
              <h2 className="text-base font-semibold text-gray-900">
                Live Active Runs{dept.selected ? ` — ${dept.selected.name}` : ''}
              </h2>
              <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full font-medium">
                {filteredRuns.length} running
              </span>
              {dept.active && undepartmentedRuns > 0 && (
                <span
                  className="text-xs text-gray-400"
                  title="These runs are not tied to a work order, so there is no department to file them under."
                >
                  {undepartmentedRuns} run{undepartmentedRuns === 1 ? '' : 's'} hidden — no work order, so no department
                </span>
              )}
            </div>
            {activeCompletions.length === 0 ? (
              <div className="bg-white rounded-xl border border-gray-200 shadow-sm py-10 text-center text-gray-400 text-sm">
                <Zap size={28} className="mx-auto mb-2 text-gray-300" />
                No active runs at the moment
              </div>
            ) : filteredRuns.length === 0 ? (
              <FilteredEmpty
                icon={<Zap size={28} />}
                message={`Nothing running in ${dept.selected?.name ?? 'this department'} right now`}
                hint={`${activeCompletions.length} run${activeCompletions.length === 1 ? '' : 's'} active elsewhere in the plant`}
                onClear={dept.clear}
              />
            ) : (
              /* One run per row on a phone: at two-up each card is 165px, which
                 broke the app name over two lines and wrapped the work-order
                 number mid-token. */
              <div className="grid grid-cols-1 xs:grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
                {filteredRuns.map(run => (
                  <ActiveRunCard key={run.id} run={run} />
                ))}
              </div>
            )}
          </section>

          {/* Work Order Grid */}
          <section>
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-base font-semibold text-gray-900">
                Work Orders{dept.selected ? ` — ${dept.selected.name}` : ''}
              </h2>
              <Link to="/schedule" className="text-xs text-blue-600 hover:text-blue-700 flex items-center gap-1">
                Manage Schedule <ChevronRight size={12} />
              </Link>
            </div>
            {workOrders.length === 0 ? (
              <div className="bg-white rounded-xl border border-gray-200 shadow-sm py-12 text-center text-gray-400 text-sm">
                <Package size={28} className="mx-auto mb-2 text-gray-300" />
                No work orders in the schedule yet
              </div>
            ) : filteredWOs.length === 0 ? (
              <FilteredEmpty
                icon={<Package size={28} />}
                message={`No work orders in ${dept.selected?.name ?? 'this department'}`}
                hint={`${workOrders.length} work order${workOrders.length === 1 ? '' : 's'} elsewhere in the plant`}
                onClear={dept.clear}
              />
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
              <h2 className="text-base font-semibold text-gray-900 mb-3">
                {dept.selected ? `${dept.selected.name} Summary` : 'Department Summary'}
              </h2>
              {filteredDeptStats.length === 0 ? (
                <FilteredEmpty
                  icon={<Users size={28} />}
                  message={`No summary recorded for ${dept.selected?.name ?? 'this department'}`}
                  onClear={dept.clear}
                />
              ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                {filteredDeptStats.map(stat => {
                  // null (not 0) when the department has no work orders — an
                  // empty department isn't "0% on track", it has nothing to track.
                  const onTrackPct = stat.total_work_orders > 0
                    ? Math.round((stat.on_track_count / stat.total_work_orders) * 100) : null;
                  const statusColor =
                    onTrackPct === null ? 'text-gray-500 bg-gray-50 border-gray-200' :
                    onTrackPct >= 75 ? 'text-green-600 bg-green-50 border-green-200' :
                    onTrackPct >= 50 ? 'text-amber-600 bg-amber-50 border-amber-200' :
                    'text-red-600 bg-red-50 border-red-200';
                  return (
                    <div key={stat.id} data-testid={`dept-summary-${stat.id}`} className="bg-white rounded-xl border border-gray-200 shadow-sm p-4">
                      <div className="flex items-start justify-between mb-3">
                        <div>
                          <div
                            className="w-2.5 h-2.5 rounded-full inline-block mr-2"
                            style={{ backgroundColor: stat.color }}
                          />
                          <span className="font-semibold text-gray-900 text-sm">{stat.name}</span>
                          {stat.manager_name && (
                            <div className="text-xs text-gray-400 mt-0.5">{stat.manager_name}</div>
                          )}
                        </div>
                        <span className={`text-xs font-semibold px-2 py-0.5 rounded-full border ${statusColor}`}>
                          {stat.active_count} active
                        </span>
                      </div>
                      <div className="grid grid-cols-3 gap-2 text-center mb-3">
                        <div>
                          <div className="text-lg font-bold text-gray-900">{stat.on_track_count}</div>
                          <div className="text-xs text-gray-400">On Track</div>
                        </div>
                        <div>
                          <div className="text-lg font-bold text-amber-600">{stat.behind_count}</div>
                          <div className="text-xs text-gray-400">Behind</div>
                        </div>
                        <div>
                          <div className="text-lg font-bold text-gray-900">{stat.total_work_orders}</div>
                          <div className="text-xs text-gray-400">Total WOs</div>
                        </div>
                      </div>
                      <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                        {onTrackPct !== null && (
                          <div
                            className={`h-full rounded-full ${onTrackPct >= 75 ? 'bg-green-500' : onTrackPct >= 50 ? 'bg-amber-500' : 'bg-red-500'}`}
                            style={{ width: `${onTrackPct}%` }}
                          />
                        )}
                      </div>
                      <div className="text-xs text-gray-400 mt-1 text-right">
                        {onTrackPct === null ? 'No work orders assigned' : `${onTrackPct}% on track`}
                      </div>
                      {stat.behind_count > 0 && (
                        <div className="flex items-center gap-1.5 mt-2 text-xs text-red-500">
                          <AlertTriangle size={11} />
                          {stat.behind_count} WO{stat.behind_count > 1 ? 's' : ''} behind schedule
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
              )}
            </section>
          )}
        </>
      )}
    </div>
  );
}

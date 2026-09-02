import { useState, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import { api } from '../api/client';
import { getFloorSnapshot } from '../api/floor';
import type { FloorSnapshot } from '../api/floor';
import { onTrackSentence } from '../utils/floorWording';
import {
  CheckCircle2, Activity, TrendingUp, Clock, RefreshCw,
  ArrowLeft, Monitor, User, ChevronRight, Calendar, AlertTriangle
} from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
import { useAutoRefresh } from '../hooks/useAutoRefresh';
import LastRefreshed from '../components/shared/LastRefreshed';
import { fmtDuration } from '../components/apps/appModel';
import DepartmentTeam from '../components/departments/DepartmentTeam';

interface DeptViewData {
  department: { id: string; name: string; color: string; manager_name: string; description: string; headcount: number };
  // NO `kpis` here on purpose. Finished today, running now, the average cycle,
  // the pass rate and the on-track share are read from GET /api/floor/snapshot
  // (api/floor.ts) with this department's id, so this page, the Command Center
  // and the wall board cannot answer the same question three ways. The endpoint
  // below still sends a `kpis` object for older clients; nothing reads it.
  stations: Array<{
    id: string; name: string; location: string; status: string;
    current_status: string; current_status_since: string | null;
    current_app_id: string | null; current_app_name: string | null;
    active_completion: { id: string; operator_name: string; app_name: string; started_at: string } | null;
    oee: {
      availability: number | null; performance: number | null; quality: number | null;
      oee: number | null; completions_today: number;
    };
  }>;
  work_orders: Array<{
    id: string; work_order_number: string; part_name: string; app_name: string | null;
    quantity: number; quantity_completed: number; scheduled_end: string;
    priority: string; schedule_status: string; completion_pct: number;
  }>;
  hourly_throughput: Array<{ hour: string; count: number }>;
  recent_completions: Array<{
    id: string; app_name: string; operator_name: string; status: string;
    station_name: string | null; started_at: string | null;
    completed_at: string;
    /** Tenths of a minute; too coarse to render. Use `runSeconds` instead. */
    duration_minutes: number;
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
  const t = new Date(iso).getTime();
  if (isNaN(t)) return '—';
  const mins = Math.floor((Date.now() - t) / 60000);
  if (mins < 1) return 'just started';
  if (mins < 60) return `${mins}m`;
  return `${Math.floor(mins / 60)}h ${mins % 60}m`;
}

function formatTimeAgo(iso: string) {
  const t = new Date(iso).getTime();
  if (isNaN(t)) return '—';
  const diff = Date.now() - t;
  if (diff < 60000) return 'just now';
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  return new Date(iso).toLocaleDateString([], { month: 'short', day: 'numeric' });
}

function formatShortDate(iso: string) {
  const d = new Date(iso);
  return isNaN(d.getTime()) ? '—' : d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

/**
 * How long a run took, in SECONDS, for the shared `fmtDuration` to render.
 *
 * The endpoint only sends `duration_minutes`, rounded to a tenth — enough to
 * turn a real six-second check into "0.1m" — but it also sends both raw
 * timestamps, so the exact figure is computable here and nothing has to be
 * invented.
 *
 * A run in progress has no cycle time yet, so what comes back for one is the
 * time elapsed so far, which the caller labels as such. An abandoned run is
 * never stamped finished, so measuring it against the clock would produce a
 * figure that grows forever: null, and the caller prints a dash.
 */
function runSeconds(c: { started_at?: string | null; completed_at: string; status: string }): number | null {
  if (!c.started_at) return null;
  if (c.status !== 'completed' && c.status !== 'in_progress') return null;
  const start = new Date(c.started_at).getTime();
  if (isNaN(start)) return null;
  const end = c.status === 'completed' ? new Date(c.completed_at).getTime() : Date.now();
  if (isNaN(end)) return null;
  const seconds = Math.round((end - start) / 1000);
  return seconds >= 0 ? seconds : null;
}

export default function DepartmentView() {
  const { id } = useParams<{ id: string }>();
  const [data, setData] = useState<DeptViewData | null>(null);
  const [snapshot, setSnapshot] = useState<FloorSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    if (!id) return;
    try {
      // The lists come from this department's own endpoint; every NUMBER comes
      // from the plant's one definition of its day, scoped to this department.
      const [view, snap] = await Promise.all([
        api.getDepartmentView(id),
        getFloorSnapshot({ department_id: id }).catch(() => null),
      ]);
      setData(view);
      if (snap) setSnapshot(snap);
      setError('');
    } catch (err: any) {
      setError(err?.message || 'Failed to load department');
      throw err;
    } finally {
      setLoading(false);
    }
  }, [id]);

  // Live department board — 30s while the tab is visible.
  const auto = useAutoRefresh(load, 30_000);

  if (loading && !data) return (
    <div className="flex items-center justify-center h-64">
      <RefreshCw size={28} className="animate-spin text-blue-500" />
    </div>
  );

  if (!data) return (
    <div className="p-6 flex flex-col items-center justify-center py-24 gap-3 text-center">
      <AlertTriangle size={40} className="text-red-400" />
      <div>
        <p className="font-medium text-gray-500">Couldn't load this department</p>
        <p className="text-sm text-gray-400 mt-1">{error || 'Department not found'}</p>
      </div>
      <button className="btn-secondary" onClick={() => { setLoading(true); void auto.refresh(); }}>Retry</button>
      <Link to="/dashboard" className="text-blue-600 text-sm hover:underline">← Back to Command Center</Link>
    </div>
  );

  const { department: dept } = data;
  const stations = data.stations ?? [];
  const workOrders = data.work_orders ?? [];
  const recentCompletions = data.recent_completions ?? [];

  // The same sentence, from the same payload, as the Command Center tile and
  // the wall board — written once in utils/floorWording.
  const onTrack = onTrackSentence(snapshot);
  const onTrackNote = onTrack ?? `— ${snapshot?.on_track_reason ?? 'no open work order to be on track with'}`;

  return (
    // The app shell owns the page background and the scroll container, so this
    // no longer paints its own surface or claims a second screen of height.
    <div className="p-4 sm:p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
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
              {stations.length} station{stations.length !== 1 ? 's' : ''}
            </p>
          </div>
        </div>
        <LastRefreshed
          at={auto.lastRefreshed}
          refreshing={auto.refreshing}
          onRefresh={() => { void auto.refresh(); }}
        />
      </div>

      {/* KPIs — the same four the Command Center shows for this department,
          from the same snapshot, with the on-track share in the Work Orders
          card's own header where it sits next to the orders it describes.
          A number nobody measured is '—' beside the payload's reason. */}
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-3 sm:gap-4">
        <KPICard
          icon={<CheckCircle2 size={18} className="text-green-600" />} bg="bg-green-50"
          label="Finished today"
          value={snapshot ? snapshot.finished_today : '—'}
          testId="dept-finished-today"
        />
        <KPICard
          icon={<Activity size={18} className="text-blue-600" />} bg="bg-blue-50"
          label="Running now"
          value={snapshot ? snapshot.running_now : '—'}
        />
        <KPICard
          icon={<Clock size={18} className="text-orange-600" />} bg="bg-orange-50"
          label="Average cycle time"
          value={snapshot?.avg_cycle_seconds != null ? fmtDuration(snapshot.avg_cycle_seconds) : '—'}
          note={snapshot?.avg_cycle_seconds != null ? undefined : snapshot?.avg_cycle_reason ?? 'no run has finished yet'}
        />
        <KPICard
          icon={<TrendingUp size={18} className="text-purple-600" />} bg="bg-purple-50"
          label="Pass rate"
          value={snapshot?.pass_rate != null ? `${snapshot.pass_rate}%` : '—'}
          note={snapshot?.pass_rate != null ? undefined : snapshot?.pass_rate_reason ?? 'no pass/fail result recorded yet'}
        />
      </div>

      {/* Stations */}
      <div>
        <h2 className="text-base font-semibold text-gray-900 mb-3">Stations</h2>
        {stations.length === 0 ? (
          <div className="text-center text-gray-400 text-sm py-8 bg-white rounded-xl border border-gray-200">
            No stations assigned to this department yet. Assign stations from the <Link to="/stations" className="text-blue-600 hover:underline">Stations</Link> page.
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {stations.map(st => {
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
                        <span className="text-blue-600">running</span>
                      </div>
                      <div className="text-xs text-blue-900 font-semibold truncate">{st.active_completion.app_name}</div>
                      <div className="text-[11px] text-blue-600">{elapsedSince(st.active_completion.started_at)} elapsed</div>
                    </div>
                  ) : (
                    <div className="bg-gray-50 rounded-lg px-3 py-2 mb-3 text-xs text-gray-500">
                      {st.current_app_name ? <>Assigned: <span className="font-medium text-gray-700">{st.current_app_name}</span></> : 'No app assigned'}
                    </div>
                  )}
                  <div className="flex items-center justify-between text-xs text-gray-500">
                    <span>OEE {st.oee.oee === null
                      ? <span className="font-bold text-gray-400" title="Set an ideal cycle time and record runs to measure OEE">—</span>
                      : <span className={`font-bold ${st.oee.oee >= 80 ? 'text-green-600' : st.oee.oee >= 60 ? 'text-amber-600' : 'text-red-600'}`}>{st.oee.oee}%</span>}</span>
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
          <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
            <div className="min-w-0">
              <h2 className="font-semibold text-gray-900">Work Orders</h2>
              <p className="text-[11px] text-gray-500" data-testid="dept-on-track">{onTrackNote}</p>
            </div>
            <Link to="/schedule" className="text-xs text-blue-600 hover:text-blue-700 flex items-center gap-1">
              Schedule <ChevronRight size={12} />
            </Link>
          </div>
          <div className="space-y-2.5">
            {workOrders.length === 0 && (
              <div className="text-center text-gray-400 text-sm py-8">No active work orders</div>
            )}
            {workOrders.map(wo => (
              <div key={wo.id} className="border border-gray-100 rounded-lg p-3">
                <div className="flex items-center justify-between mb-1.5">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-xs text-gray-900">{wo.work_order_number}</span>
                    <span className={`text-[11px] px-1.5 py-0.5 rounded-full font-medium ${SCHEDULE_PILL[wo.schedule_status] ?? 'bg-gray-100 text-gray-600'}`}>
                      {wo.schedule_status.replace('_', ' ')}
                    </span>
                  </div>
                  <span className="text-xs text-gray-400 flex items-center gap-1">
                    <Calendar size={10} /> {formatShortDate(wo.scheduled_end)}
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
              <BarChart data={data.hourly_throughput ?? []} barSize={14}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" vertical={false} />
                <XAxis dataKey="hour" tick={{ fontSize: 10 }} tickFormatter={h => h.slice(11, 16)} interval={3} />
                <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                <Tooltip labelFormatter={l => `Hour: ${l}`} formatter={(v: any) => [v, 'Units']} />
                <Bar dataKey="count" fill={dept.color || '#3b82f6'} radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>

          <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
            <h2 className="font-semibold text-gray-900">Latest runs</h2>
            <p className="text-[11px] text-gray-500 mb-3">What each one took, as your apps record it</p>
            <div className="divide-y divide-gray-50">
              {recentCompletions.length === 0 && (
                <div className="text-center text-gray-400 text-xs py-6">No runs recorded here yet</div>
              )}
              {recentCompletions.slice(0, 8).map(c => {
                // A run that is still running has elapsed time, not a cycle time.
                // Printing it unlabelled would quietly fold a job that has not
                // finished into the reader's sense of what a cycle costs.
                const running = c.status === 'in_progress';
                const seconds = runSeconds(c);
                return (
                  <div key={c.id} className="flex items-center justify-between gap-3 py-2 text-xs">
                    <div className="min-w-0">
                      <div className="font-medium text-gray-900 truncate">{c.app_name}</div>
                      <div className="text-gray-400 truncate">{c.operator_name}{c.station_name ? ` · ${c.station_name}` : ''}</div>
                    </div>
                    <div className="text-right flex-shrink-0">
                      <div className="font-semibold text-gray-700 tabular-nums whitespace-nowrap">
                        {seconds != null ? fmtDuration(seconds) : '—'}
                        {running && seconds != null && <span className="font-normal text-gray-400"> so far</span>}
                      </div>
                      <div className="text-gray-400 mt-0.5 whitespace-nowrap">
                        {running && <span className="text-blue-600 font-medium">running</span>}
                        {!running && c.status !== 'completed' && <span>{c.status}</span>}
                        {c.status === 'completed' && formatTimeAgo(c.completed_at)}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {/* Who this department's help requests reach.
          Last on the page on purpose. It is a setup panel, not production
          status, and on a phone its "nobody is here yet" state is a whole
          screen of scrolling between the reader and the numbers they came
          for. Work first, then who to call about it. */}
      <DepartmentTeam departmentId={dept.id} departmentName={dept.name} />
    </div>
  );
}

function KPICard({ icon, bg, label, value, note, testId }: {
  icon: React.ReactNode; bg: string; label: string; value: string | number;
  /** Why the value is a dash. Present only when there is nothing to report. */
  note?: string;
  testId?: string;
}) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4 sm:p-5" data-testid={testId}>
      <div className={`w-9 h-9 ${bg} rounded-lg flex items-center justify-center mb-3`}>{icon}</div>
      <div className="text-2xl font-bold text-gray-900 tabular-nums">{value}</div>
      <div className="text-xs text-gray-500 mt-0.5">{label}</div>
      {note && <div className="text-[11px] text-gray-400 mt-0.5">{note}</div>}
    </div>
  );
}

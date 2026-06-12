import { useEffect, useState, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import { api } from '../api/client';
import {
  RefreshCw, ArrowLeft, Monitor, MapPin, User, Play, Clock,
  Gauge, CheckCircle2, Wrench, AlertTriangle, Activity
} from 'lucide-react';

interface StationViewData {
  station: {
    id: string; name: string; description: string; location: string; status: string;
    current_status: string; current_status_since: string | null;
    department_id: string | null; department_name: string | null; department_color: string | null;
    planned_hours_per_day: number; ideal_cycle_seconds: number;
  };
  current_app: { id: string; name: string } | null;
  active_completion: {
    id: string; operator_name: string; app_name: string; app_id: string;
    started_at: string; work_order_number: string | null; part_name: string | null;
  } | null;
  oee: {
    availability: number; performance: number; quality: number; oee: number;
    uptime_minutes: number; downtime_minutes: number; planned_minutes: number;
    completions_today: number;
  };
  recent_completions: Array<{
    id: string; app_name: string; operator_name: string; status: string;
    work_order_number: string | null; completed_at: string;
    duration_minutes: number; qc_result: 'pass' | 'fail' | null;
  }>;
  recent_events: Array<{
    id: string; event_type: string; reason: string;
    started_at: string; ended_at: string | null; duration_minutes: number | null;
  }>;
}

const MACHINE_STATUS: Record<string, { label: string; dot: string; text: string; bg: string }> = {
  running:     { label: 'Running',     dot: 'bg-green-500', text: 'text-green-700', bg: 'bg-green-50 border-green-200' },
  idle:        { label: 'Idle',        dot: 'bg-gray-400',  text: 'text-gray-600',  bg: 'bg-gray-50 border-gray-200' },
  down:        { label: 'Down',        dot: 'bg-red-500',   text: 'text-red-700',   bg: 'bg-red-50 border-red-200' },
  maintenance: { label: 'Maintenance', dot: 'bg-amber-500', text: 'text-amber-700', bg: 'bg-amber-50 border-amber-200' },
};

const EVENT_ICONS: Record<string, React.ReactNode> = {
  up:          <Activity size={13} className="text-green-500" />,
  down:        <AlertTriangle size={13} className="text-red-500" />,
  maintenance: <Wrench size={13} className="text-amber-500" />,
  idle:        <Clock size={13} className="text-gray-400" />,
};

function elapsedSince(iso: string) {
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return 'just now';
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

export default function StationView() {
  const { id } = useParams<{ id: string }>();
  const [data, setData] = useState<StationViewData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const load = useCallback(async () => {
    if (!id) return;
    try {
      setData(await api.getStationView(id));
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
      <p>Station not found</p>
      <Link to="/stations" className="text-blue-600 text-sm hover:underline mt-2 inline-block">← Back to Stations</Link>
    </div>
  );

  const { station: st, oee } = data;
  const ms = MACHINE_STATUS[st.current_status] ?? MACHINE_STATUS.idle;

  return (
    <div className="min-h-screen bg-[#f8fafc] p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div className="flex items-center gap-4">
          <Link to="/stations" className="p-2 hover:bg-gray-100 rounded-lg text-gray-400 hover:text-gray-600 transition-colors">
            <ArrowLeft size={18} />
          </Link>
          <div className="w-11 h-11 bg-blue-50 rounded-xl flex items-center justify-center">
            <Monitor size={20} className="text-blue-600" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">{st.name}</h1>
            <div className="flex items-center gap-3 text-sm text-gray-500">
              {st.department_name && st.department_id && (
                <Link to={`/departments/${st.department_id}`}
                  className="text-xs font-medium px-2 py-0.5 rounded-full hover:opacity-80"
                  style={{ backgroundColor: (st.department_color || '#6b7280') + '22', color: st.department_color || '#6b7280' }}>
                  {st.department_name}
                </Link>
              )}
              {st.location && <span className="flex items-center gap-1 text-xs"><MapPin size={11} /> {st.location}</span>}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <span className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-sm font-medium ${ms.bg} ${ms.text}`}>
            <span className={`w-2.5 h-2.5 rounded-full ${ms.dot} ${st.current_status === 'running' ? 'animate-pulse' : ''}`} />
            {ms.label}
            {st.current_status_since && <span className="font-normal opacity-70">for {elapsedSince(st.current_status_since)}</span>}
          </span>
          <button onClick={load} className="flex items-center gap-2 px-3 py-2 bg-white border border-gray-200 rounded-lg text-sm text-gray-600 hover:bg-gray-50 shadow-sm">
            <RefreshCw size={14} /> Refresh
          </button>
        </div>
      </div>

      {/* Now running / idle */}
      {data.active_completion ? (
        <div className="bg-blue-600 rounded-xl shadow-md p-5 text-white flex items-center justify-between flex-wrap gap-4">
          <div>
            <div className="flex items-center gap-2 text-blue-100 text-xs font-semibold uppercase tracking-wide mb-1">
              <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse" /> Now Running
            </div>
            <div className="text-xl font-bold">{data.active_completion.app_name}</div>
            <div className="text-blue-100 text-sm flex items-center gap-3 mt-1">
              <span className="flex items-center gap-1"><User size={13} /> {data.active_completion.operator_name}</span>
              <span className="flex items-center gap-1"><Clock size={13} /> {elapsedSince(data.active_completion.started_at)} elapsed</span>
              {data.active_completion.work_order_number && (
                <span>{data.active_completion.work_order_number} · {data.active_completion.part_name}</span>
              )}
            </div>
          </div>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5 flex items-center justify-between flex-wrap gap-4">
          <div>
            <div className="text-xs text-gray-400 font-semibold uppercase tracking-wide mb-1">No process running</div>
            {data.current_app ? (
              <div className="text-gray-700 text-sm">Assigned app: <span className="font-semibold">{data.current_app.name}</span></div>
            ) : (
              <div className="text-gray-400 text-sm italic">No app assigned to this station</div>
            )}
          </div>
          {data.current_app && (
            <Link to={`/play/${data.current_app.id}?station=${st.id}`} target="_blank"
              className="flex items-center gap-2 px-4 py-2.5 bg-blue-600 text-white rounded-lg text-sm font-semibold hover:bg-blue-700 transition-colors">
              <Play size={14} /> Launch
            </Link>
          )}
        </div>
      )}

      {/* OEE KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-4">
        <OEECard label="OEE" value={oee.oee} highlight />
        <OEECard label="Availability" value={oee.availability} />
        <OEECard label="Performance" value={oee.performance} />
        <OEECard label="Quality" value={oee.quality} />
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
          <div className="w-9 h-9 bg-green-50 rounded-lg flex items-center justify-center mb-3">
            <CheckCircle2 size={18} className="text-green-600" />
          </div>
          <div className="text-2xl font-bold text-gray-900">{oee.completions_today}</div>
          <div className="text-xs text-gray-500 mt-0.5">Completed Today</div>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        {/* Recent completions */}
        <div className="xl:col-span-2 bg-white rounded-xl border border-gray-200 shadow-sm p-5">
          <h2 className="font-semibold text-gray-900 mb-4">Recent Completions</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 text-left text-xs font-medium text-gray-500">
                  <th className="pb-2">App</th>
                  <th className="pb-2">Operator</th>
                  <th className="pb-2">Work Order</th>
                  <th className="pb-2 text-right">Duration</th>
                  <th className="pb-2 text-right">QC</th>
                  <th className="pb-2 text-right">Time</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {data.recent_completions.length === 0 && (
                  <tr><td colSpan={6} className="text-center text-gray-400 text-xs py-6">No completions yet</td></tr>
                )}
                {data.recent_completions.map(c => (
                  <tr key={c.id} className="hover:bg-gray-50 transition-colors">
                    <td className="py-2.5 pr-3 text-xs font-medium text-gray-900">
                      <Link to={`/completions/${c.id}`} className="hover:text-blue-600">{c.app_name}</Link>
                    </td>
                    <td className="py-2.5 pr-3 text-xs text-gray-600">{c.operator_name}</td>
                    <td className="py-2.5 pr-3 text-xs text-gray-500">{c.work_order_number || '—'}</td>
                    <td className="py-2.5 pr-3 text-xs text-gray-700 text-right tabular-nums">{c.duration_minutes}m</td>
                    <td className="py-2.5 pr-3 text-right">
                      {c.qc_result === 'pass' && <span className="text-xs font-semibold text-green-600">Pass</span>}
                      {c.qc_result === 'fail' && <span className="text-xs font-semibold text-red-600">Fail</span>}
                      {c.qc_result === null && <span className="text-xs text-gray-300">—</span>}
                    </td>
                    <td className="py-2.5 text-xs text-gray-400 text-right">{formatTimeAgo(c.completed_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Machine events */}
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold text-gray-900">Machine Events</h2>
            <Link to="/oee" className="text-xs text-blue-600 hover:text-blue-700 flex items-center gap-1">
              <Gauge size={12} /> OEE Tracker
            </Link>
          </div>
          <div className="space-y-2.5">
            {data.recent_events.length === 0 && (
              <div className="text-center text-gray-400 text-xs py-6">No events logged. Use the OEE Tracker to log up/down/maintenance events.</div>
            )}
            {data.recent_events.map(ev => (
              <div key={ev.id} className="flex items-start gap-2.5 text-xs">
                <div className="mt-0.5">{EVENT_ICONS[ev.event_type] ?? EVENT_ICONS.idle}</div>
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-gray-800 capitalize">{ev.event_type}{ev.reason ? ` — ${ev.reason}` : ''}</div>
                  <div className="text-gray-400">
                    {formatTimeAgo(ev.started_at)}
                    {ev.duration_minutes != null && ` · ${Math.round(ev.duration_minutes)}m`}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function OEECard({ label, value, highlight }: { label: string; value: number; highlight?: boolean }) {
  const color = value >= 80 ? 'text-green-600' : value >= 60 ? 'text-amber-600' : 'text-red-600';
  return (
    <div className={`bg-white rounded-xl border shadow-sm p-5 ${highlight ? 'border-blue-200 ring-1 ring-blue-100' : 'border-gray-200'}`}>
      <div className="w-9 h-9 bg-blue-50 rounded-lg flex items-center justify-center mb-3">
        <Gauge size={18} className="text-blue-600" />
      </div>
      <div className={`text-2xl font-bold ${color}`}>{value}%</div>
      <div className="text-xs text-gray-500 mt-0.5">{label}</div>
    </div>
  );
}

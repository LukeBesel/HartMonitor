import { useState, useCallback, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { api } from '../api/client';
import {
  RefreshCw, ArrowLeft, Monitor, MapPin, User, Play, Clock,
  Gauge, CheckCircle2, Wrench, AlertTriangle, Activity, X
} from 'lucide-react';
import { logStationEvent, needsReasonCode } from '../api/oee';
import type { StationEventType } from '../api/oee';
import { getReasonCodes } from '../api/andon';
import type { ReasonCode } from '../api/andon';
import { useAutoRefresh } from '../hooks/useAutoRefresh';
import LastRefreshed from '../components/shared/LastRefreshed';
import { tintedChipStyle } from '../utils/contrast';
import { useIsDark } from '../utils/useIsDark';

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
    availability: number | null; performance: number | null; quality: number | null; oee: number | null;
    measurable?: boolean; missing?: string[];
    /** The sentence to print when OEE cannot be stated — written server-side so
     *  this page and the OEE tab describe the same gap the same way. */
    missing_hint?: string | null;
    uptime_minutes: number; downtime_minutes: number; planned_minutes: number;
    completions_today: number;
    /** 'quantities' | 'inspection' | null — what the quality figure counted.
     *  Printed beside it: 90% from counted units and 90% from pass/fail stamps
     *  are different claims. */
    quality_basis?: 'quantities' | 'inspection' | null;
    quality_reason?: string | null;
    quality_sample?: number;
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
  const t = new Date(iso).getTime();
  if (isNaN(t)) return '—';
  const mins = Math.floor((Date.now() - t) / 60000);
  if (mins < 1) return 'just now';
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

export default function StationView() {
  const darkMode = useIsDark();
  const { id } = useParams<{ id: string }>();
  const [data, setData] = useState<StationViewData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    if (!id) return;
    try {
      setData(await api.getStationView(id));
      setError('');
    } catch (err: any) {
      setError(err?.message || 'Failed to load station');
      throw err;
    } finally {
      setLoading(false);
    }
  }, [id]);

  const [statusOpen, setStatusOpen] = useState(false);

  // Live machine state — 30s while the tab is visible.
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
        <p className="font-medium text-gray-500">Couldn't load this station</p>
        <p className="text-sm text-gray-400 mt-1">{error || 'Station not found'}</p>
      </div>
      <button className="btn-secondary" onClick={() => { setLoading(true); void auto.refresh(); }}>Retry</button>
      <Link to="/stations" className="text-blue-600 text-sm hover:underline">← Back to Stations</Link>
    </div>
  );

  const { station: st, oee } = data;
  const ms = MACHINE_STATUS[st.current_status] ?? MACHINE_STATUS.idle;
  const recentCompletions = data.recent_completions ?? [];
  const recentEvents = data.recent_events ?? [];

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
                  style={tintedChipStyle(st.department_color, darkMode)}>
                  {st.department_name}
                </Link>
              )}
              {st.location && <span className="flex items-center gap-1 text-xs"><MapPin size={11} /> {st.location}</span>}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <span className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-sm font-medium ${ms.bg} ${ms.text}`}>
            <span className={`w-2.5 h-2.5 rounded-full ${ms.dot} ${st.current_status === 'running' ? 'animate-pulse' : ''}`} />
            {ms.label}
            {st.current_status_since && <span className="font-normal opacity-70 whitespace-nowrap">for {elapsedSince(st.current_status_since)}</span>}
          </span>
          <button className="btn-secondary text-sm" onClick={() => setStatusOpen(true)}>
            Change status
          </button>
          <LastRefreshed
            at={auto.lastRefreshed}
            refreshing={auto.refreshing}
            onRefresh={() => { void auto.refresh(); }}
          />
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
            {/* Each fact wraps as a whole. In a plain three-across row on a
                phone they were squeezed until "Maria Lopez" and "2m elapsed"
                broke across lines inside themselves. */}
            <div className="text-blue-100 text-sm flex flex-wrap items-center gap-x-3 gap-y-1 mt-1">
              <span className="flex items-center gap-1 whitespace-nowrap"><User size={13} /> {data.active_completion.operator_name}</span>
              <span className="flex items-center gap-1 whitespace-nowrap"><Clock size={13} /> {elapsedSince(data.active_completion.started_at)} elapsed</span>
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

      {/* ── OEE: ONE percentage, and the three factors behind it ────────────
          This block used to print four big percentages side by side — the OEE
          figure and its own three factors, at the same size, with nothing
          saying that the first is the product of the other three. Two of them
          disagreeing (rounding) then looked like two measurements disagreeing.
          One headline figure, three factors underneath it, and the quality
          factor NAMES what it counted. */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <OEECard label="OEE" value={oee.oee} highlight
          hint={oee.missing_hint || 'Not enough data yet'} />

        <div className="lg:col-span-2 bg-white rounded-xl border border-gray-200 shadow-sm p-5">
          <div className="grid grid-cols-3 gap-4">
            <Factor label="Availability" value={oee.availability} />
            <Factor label="Performance" value={oee.performance} note="needs an ideal cycle time" />
            <Factor
              label="Quality"
              value={oee.quality}
              note={oee.quality_reason || undefined}
              basis={
                oee.quality_basis === 'quantities'
                  ? `counted units${oee.quality_sample ? ` · ${oee.quality_sample} run${oee.quality_sample === 1 ? '' : 's'}` : ''}`
                  : oee.quality_basis === 'inspection'
                    ? `pass/fail${oee.quality_sample ? ` · ${oee.quality_sample} inspected` : ''}`
                    : undefined
              }
            />
          </div>
          <div className="mt-4 pt-3 border-t border-gray-100 flex items-center justify-between flex-wrap gap-2 text-xs">
            <span className="text-gray-500 tabular-nums">
              {oee.completions_today} completed today · {Math.round(oee.downtime_minutes)}m stopped
              of {Math.round(oee.planned_minutes)}m
            </span>
            <Link to={`/analytics?tab=oee&station_id=${st.id}`} className="text-blue-600 hover:text-blue-700 font-medium">
              Why it stopped →
            </Link>
          </div>
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
                {recentCompletions.length === 0 && (
                  <tr><td colSpan={6} className="text-center text-gray-400 text-xs py-6">No completions yet</td></tr>
                )}
                {recentCompletions.map(c => (
                  <tr key={c.id} className="hover:bg-gray-50 transition-colors">
                    <td className="py-2.5 pr-3 text-xs font-medium text-gray-900">
                      <Link to={`/completions/${c.id}`} className="hover:text-blue-600">{c.app_name}</Link>
                    </td>
                    <td className="py-2.5 pr-3 text-xs text-gray-600">{c.operator_name}</td>
                    <td className="py-2.5 pr-3 text-xs text-gray-500">{c.work_order_number || '—'}</td>
                    <td className="py-2.5 pr-3 text-xs text-gray-700 text-right tabular-nums">{c.duration_minutes != null && !isNaN(c.duration_minutes) ? `${c.duration_minutes}m` : '—'}</td>
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
            <Link to="/analytics?tab=oee" className="text-xs text-blue-600 hover:text-blue-700 flex items-center gap-1">
              <Gauge size={12} /> OEE Tracker
            </Link>
          </div>
          <div className="space-y-2.5">
            {recentEvents.length === 0 && (
              <div className="text-center text-gray-400 text-xs py-6">No events logged. Use the OEE Tracker to log up/down/maintenance events.</div>
            )}
            {recentEvents.map(ev => (
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

      {/* Stopping a station means picking from the coded list — a Pareto and a
          six-big-losses split cannot be built out of free text. */}
      {statusOpen && (
        <StationStatusDialog
          stationId={st.id}
          stationName={st.name}
          onClose={() => setStatusOpen(false)}
          onLogged={() => { setStatusOpen(false); void auto.refresh(); }}
        />
      )}
    </div>
  );
}

/** One OEE factor: smaller than the headline figure, because it is a part of
 *  it. `basis` says what the number counted when that is a real choice. */
function Factor({ label, value, note, basis }: {
  label: string; value: number | null; note?: string; basis?: string;
}) {
  const known = value !== null && Number.isFinite(value);
  return (
    <div>
      <div className="text-xs font-medium text-gray-500">{label}</div>
      <div className={`text-xl font-bold tabular-nums ${known ? 'text-gray-900' : 'text-gray-300'}`}>
        {known ? `${value}%` : '—'}
      </div>
      {known && basis && <div className="text-[11px] text-gray-400 leading-tight mt-0.5">{basis}</div>}
      {!known && note && <div className="text-[11px] text-gray-400 leading-tight mt-0.5">{note}</div>}
    </div>
  );
}

// ─── The stop dialog ─────────────────────────────────────────────────────────
// 'down' and 'maintenance' cannot be submitted without a coded reason — the
// server refuses them, and so does this, so an operator finds out before the
// round trip rather than after it. 'Running' and 'Idle' need nothing: nobody
// should have to explain the good news.

function StationStatusDialog({ stationId, stationName, onClose, onLogged }: {
  stationId: string;
  stationName: string;
  onClose: () => void;
  onLogged: () => void;
}) {
  const [eventType, setEventType] = useState<StationEventType>('down');
  const [reasonCodeId, setReasonCodeId] = useState('');
  const [note, setNote] = useState('');
  const [codes, setCodes] = useState<ReasonCode[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    getReasonCodes({ kind: 'downtime' }).then(setCodes).catch(() => setCodes([]));
  }, []);

  const requiresCode = needsReasonCode(eventType);

  async function submit() {
    if (requiresCode && !reasonCodeId) {
      setError('Pick what stopped it — a stop with no reason cannot be reported on.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      await logStationEvent(stationId, {
        event_type: eventType,
        ...(requiresCode ? { reason_code_id: reasonCodeId } : {}),
        ...(note.trim() ? { reason: note.trim() } : {}),
      });
      onLogged();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Could not log the event');
    } finally {
      setSaving(false);
    }
  }

  const OPTIONS: Array<{ value: StationEventType; label: string }> = [
    { value: 'running', label: 'Running' },
    { value: 'idle', label: 'Idle' },
    { value: 'down', label: 'Down' },
    { value: 'maintenance', label: 'Maintenance' },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true" aria-label="Change station status">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold text-gray-900">{stationName}</h2>
          <button onClick={onClose} aria-label="Close" className="text-gray-400 hover:text-gray-600 p-1">
            <X size={18} />
          </button>
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1" htmlFor="station-event-type">Status</label>
          <select
            id="station-event-type"
            className="input-field"
            value={eventType}
            onChange={e => { setEventType(e.target.value as StationEventType); setError(''); }}
          >
            {OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>

        {requiresCode && (
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1" htmlFor="station-reason-code">
              Reason <span className="text-red-500">*</span>
            </label>
            {codes.length > 0 ? (
              <select
                id="station-reason-code"
                className="input-field"
                value={reasonCodeId}
                onChange={e => { setReasonCodeId(e.target.value); setError(''); }}
              >
                <option value="">Pick a reason…</option>
                {codes.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
              </select>
            ) : (
              <p className="text-xs text-amber-600">
                No downtime reasons have been set up yet. A manager adds them on the Andon board.
              </p>
            )}
          </div>
        )}

        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1" htmlFor="station-note">Note (optional)</label>
          <input
            id="station-note"
            className="input-field"
            value={note}
            onChange={e => setNote(e.target.value)}
            placeholder="Third time this week"
          />
        </div>

        {error && <p className="text-sm text-red-600">{error}</p>}

        <div className="flex gap-3">
          <button
            className="btn-primary flex-1"
            onClick={() => { void submit(); }}
            disabled={saving || (requiresCode && !reasonCodeId)}
          >
            {saving ? 'Saving…' : 'Log event'}
          </button>
          <button className="btn-secondary flex-1" onClick={onClose} disabled={saving}>Cancel</button>
        </div>
      </div>
    </div>
  );
}

function OEECard({ label, value, highlight, hint }: { label: string; value: number | null; highlight?: boolean; hint?: string }) {
  const known = value !== null && Number.isFinite(value);
  const color = !known ? 'text-gray-400'
    : (value as number) >= 80 ? 'text-green-600'
    : (value as number) >= 60 ? 'text-amber-600' : 'text-red-600';
  return (
    <div className={`bg-white rounded-xl border shadow-sm p-5 ${highlight ? 'border-blue-200 ring-1 ring-blue-100' : 'border-gray-200'}`}>
      <div className="w-9 h-9 bg-blue-50 rounded-lg flex items-center justify-center mb-3">
        <Gauge size={18} className="text-blue-600" />
      </div>
      <div className={`text-2xl font-bold ${color}`}>{known ? `${value}%` : '—'}</div>
      <div className="text-xs text-gray-500 mt-0.5">{label}</div>
      {!known && hint && <div className="text-[11px] text-gray-400 mt-1 leading-snug">{hint}</div>}
    </div>
  );
}

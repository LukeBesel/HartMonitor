import { useState, useCallback, useEffect } from 'react';
import {
  Activity, RefreshCw, AlertTriangle, CheckCircle,
  Plus, X, Cpu, TrendingUp,
  Play, Pause, Wrench, Monitor,
} from 'lucide-react';
import { api } from '../../api/client';
import { logStationEvent, needsReasonCode } from '../../api/oee';
import type { StationEventInput, StationEventType } from '../../api/oee';
import { getReasonCodes } from '../../api/andon';
import type { ReasonCode } from '../../api/andon';
import { useAutoRefresh } from '../../hooks/useAutoRefresh';
import LastRefreshed from '../shared/LastRefreshed';

// Every factor is nullable: the backend reports `null` for anything it cannot
// measure (no ideal cycle time configured, no runs today) instead of guessing.
interface OEEData {
  availability: number | null;
  performance: number | null;
  quality: number | null;
  oee: number | null;
  measurable: boolean;
  missing: string[];
  uptime_minutes: number;
  downtime_minutes: number;
  planned_minutes: number;
  completions_today: number;
  /** What the quality figure counted: units a run recorded, or pass/fail
   *  stamps. Printed beside the bar — they are different claims. */
  quality_basis?: 'quantities' | 'inspection' | null;
  quality_reason?: string | null;
  quality_sample?: number;
  /** The sentence to print when OEE cannot be stated. Written server-side, so
   *  every screen describes the same gap the same way — and never "and" where
   *  the truth is "either an inspected run or a good/scrap count". */
  missing_hint?: string | null;
}

interface OEEMachine {
  id: string;
  name: string;
  description: string;
  location: string;
  current_status: 'running' | 'down' | 'maintenance' | 'idle';
  current_status_since: string | null;
  planned_hours_per_day: number;
  ideal_cycle_seconds: number;
  oee: OEEData;
}

interface LogEventForm {
  event_type: StationEventType;
  /** The coded reason. Required for 'down' and 'maintenance' — a stop with no
   *  code cannot appear on a Pareto or in the six big losses. */
  reason_code_id: string;
  /** The free-text note that used to be the ONLY record. Still optional. */
  reason: string;
}

const STATUS_CONFIG = {
  running:     { color: 'bg-green-500',  text: 'text-emerald-700', label: 'Running',     icon: Play },
  down:        { color: 'bg-red-500',    text: 'text-red-700',   label: 'Down',        icon: AlertTriangle },
  maintenance: { color: 'bg-amber-500',  text: 'text-amber-700', label: 'Maintenance', icon: Wrench },
  idle:        { color: 'bg-gray-400',   text: 'text-gray-500',  label: 'Idle',        icon: Pause },
};

function oeeColor(pct: number): string {
  if (pct >= 80) return 'text-emerald-700';
  if (pct >= 60) return 'text-amber-700';
  return 'text-red-700';
}

function oeeBgColor(pct: number): string {
  if (pct >= 80) return 'bg-green-500';
  if (pct >= 60) return 'bg-amber-500';
  return 'bg-red-500';
}

function elapsedSince(iso: string | null): string {
  if (!iso) return '';
  const t = new Date(iso).getTime();
  if (isNaN(t)) return '';
  const diff = Date.now() - t;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ${mins % 60}m ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function MiniBar({ label, value, color, hint }: { label: string; value: number | null; color: string; hint?: string }) {
  const known = value !== null && Number.isFinite(value);
  const safe = known ? (value as number) : 0;
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-[10px]">
        <span className="text-gray-500 font-medium">{label}</span>
        {known
          ? <span className="text-gray-700 font-semibold">{safe.toFixed(1)}%</span>
          : <span className="text-gray-400 font-semibold" title={hint}>not measured</span>}
      </div>
      <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
        {known && (
          <div
            className={`h-full rounded-full transition-all ${color}`}
            style={{ width: `${Math.min(safe, 100)}%` }}
          />
        )}
      </div>
    </div>
  );
}

function MachineCard({
  machine,
  isExpanded,
  onToggleExpand,
  onLogEvent,
}: {
  machine: OEEMachine;
  isExpanded: boolean;
  onToggleExpand: () => void;
  onLogEvent: (id: string, data: StationEventInput) => Promise<void>;
}) {
  const [form, setForm] = useState<LogEventForm>({ event_type: 'running', reason_code_id: '', reason: '' });
  const [saving, setSaving] = useState(false);
  const [codes, setCodes] = useState<ReasonCode[]>([]);
  const [formError, setFormError] = useState('');
  const requiresCode = needsReasonCode(form.event_type);

  // The company's coded downtime list, loaded when the form is first opened.
  useEffect(() => {
    if (!isExpanded || codes.length > 0) return;
    getReasonCodes({ kind: 'downtime' }).then(setCodes).catch(() => setCodes([]));
  }, [isExpanded, codes.length]);

  const statusCfg = STATUS_CONFIG[machine.current_status] ?? STATUS_CONFIG.idle;
  const oee: OEEData = machine.oee ?? {
    availability: null, performance: null, quality: null, oee: null,
    measurable: false, missing: [],
    uptime_minutes: 0, downtime_minutes: 0, planned_minutes: 0, completions_today: 0,
    quality_basis: null, quality_reason: null, quality_sample: 0, missing_hint: null,
  };
  const missingHint = oee.missing_hint
    ? `${oee.missing_hint} to measure OEE`
    : 'Not enough data to measure OEE yet';

  const handleSave = async () => {
    if (requiresCode && !form.reason_code_id) {
      setFormError('Pick what stopped it — a stop with no reason cannot be reported on.');
      return;
    }
    setSaving(true);
    setFormError('');
    try {
      await onLogEvent(machine.id, {
        event_type: form.event_type,
        ...(requiresCode ? { reason_code_id: form.reason_code_id } : {}),
        ...(form.reason.trim() ? { reason: form.reason.trim() } : {}),
      });
      onToggleExpand();
    } catch (err: any) {
      setFormError(err?.message || 'Failed to log event');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="rounded-2xl border border-gray-200 bg-white overflow-hidden">
      {/* Card body */}
      <div className="p-4 space-y-3">
        {/* Status row */}
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <div className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${statusCfg.color}`} />
            <div className="min-w-0">
              <div className="font-semibold text-gray-900 text-sm truncate">{machine.name}</div>
              <div className="text-[11px] text-gray-500 truncate">{machine.location}</div>
            </div>
          </div>
          <div className="text-right flex-shrink-0">
            <div className={`text-[10px] font-medium ${statusCfg.text}`}>{statusCfg.label}</div>
            {machine.current_status_since && (
              <div className="text-[10px] text-gray-500 mt-0.5">{elapsedSince(machine.current_status_since)}</div>
            )}
          </div>
        </div>

        {/* OEE big number — "—" when a factor can't be measured, never a guess */}
        <div className="flex items-end gap-2">
          {oee.oee !== null ? (
            <div className={`text-3xl font-bold tabular-nums leading-none ${oeeColor(oee.oee)}`}>
              {oee.oee.toFixed(1)}
              <span className="text-base font-medium">%</span>
            </div>
          ) : (
            <div className="text-3xl font-bold leading-none text-gray-500">—</div>
          )}
          <div className="text-xs text-gray-500 mb-1">OEE</div>
        </div>
        {oee.oee === null && (
          <div className="text-[10px] text-amber-400/90 leading-snug">{missingHint}</div>
        )}

        {/* Progress bars */}
        <div className="space-y-1.5">
          <MiniBar label="Availability" value={oee.availability} color="bg-green-500" />
          <MiniBar label="Performance"  value={oee.performance}  color="bg-blue-500"
            hint="Set an ideal cycle time for this station to measure performance" />
          <MiniBar
            label={oee.quality_basis === 'quantities' ? 'Quality · counted units'
              : oee.quality_basis === 'inspection' ? 'Quality · pass/fail'
              : 'Quality'}
            value={oee.quality}
            color="bg-purple-500"
            hint={oee.quality_reason || "Quality is measured from today's completed runs"} />
        </div>

        {/* Footer row */}
        <div className="flex items-center justify-between pt-1">
          <div className="flex items-center gap-1 text-[10px] text-gray-500">
            <Cpu size={11} />
            <span>{oee.completions_today} completions today</span>
          </div>
          <button
            onClick={onToggleExpand}
            className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-medium transition-colors text-gray-500 hover:text-gray-900 border border-gray-300 hover:border-gray-400 hover:bg-gray-100"
          >
            {isExpanded ? (
              <>
                <X size={11} />
                Cancel
              </>
            ) : (
              <>
                <Plus size={11} />
                Log Event
              </>
            )}
          </button>
        </div>
      </div>

      {/* Expand: log event form */}
      {isExpanded && (
        <div className="border-t border-gray-200 bg-gray-50 p-4 space-y-3">
          <div className="text-xs font-semibold text-gray-700 uppercase tracking-wider">Log Status Event</div>

          <div>
            <label className="text-[11px] text-gray-500 mb-1 block">New Status</label>
            <select
              value={form.event_type}
              onChange={e => { setFormError(''); setForm(f => ({ ...f, event_type: e.target.value as StationEventType })); }}
              className="w-full px-3 py-2 rounded-lg text-sm bg-white border border-gray-300 text-gray-900 focus:outline-none focus:border-blue-500 transition-colors"
            >
              <option value="running">Running</option>
              <option value="down">Down</option>
              <option value="maintenance">Maintenance</option>
              <option value="idle">Idle</option>
            </select>
          </div>

          {requiresCode && (
            <div>
              <label className="text-[11px] text-gray-500 mb-1 block" htmlFor={`reason-code-${machine.id}`}>
                Reason <span className="text-red-500">*</span>
              </label>
              {codes.length > 0 ? (
                <select
                  id={`reason-code-${machine.id}`}
                  value={form.reason_code_id}
                  onChange={e => { setFormError(''); setForm(f => ({ ...f, reason_code_id: e.target.value })); }}
                  className="w-full px-3 py-2 rounded-lg text-sm bg-white border border-gray-300 text-gray-900 focus:outline-none focus:border-blue-500 transition-colors"
                >
                  <option value="">Pick a reason…</option>
                  {codes.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
                </select>
              ) : (
                <p className="text-[11px] text-amber-600">
                  No downtime reasons set up yet — a manager adds them on the Andon board.
                </p>
              )}
            </div>
          )}

          <div>
            <label className="text-[11px] text-gray-500 mb-1 block">Note (optional)</label>
            <textarea
              value={form.reason}
              onChange={e => setForm(f => ({ ...f, reason: e.target.value }))}
              rows={2}
              placeholder="Describe what happened..."
              className="w-full px-3 py-2 rounded-lg text-sm bg-white border border-gray-300 text-gray-900 placeholder-gray-400 focus:outline-none focus:border-blue-500 transition-colors resize-none"
            />
          </div>

          {formError && <p className="text-[11px] text-red-600">{formError}</p>}

          <div className="flex gap-2">
            <button
              onClick={handleSave}
              disabled={saving || (requiresCode && !form.reason_code_id)}
              className="flex-1 py-2 rounded-lg text-sm font-medium text-white transition-colors disabled:opacity-50 bg-blue-600 hover:bg-blue-500"
            >
              {saving ? 'Saving…' : 'Save Event'}
            </button>
            <button
              onClick={onToggleExpand}
              className="px-4 py-2 rounded-lg text-sm font-medium text-gray-500 hover:text-gray-900 border border-gray-300 hover:border-gray-400 transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Every station's OEE for today, with the log-an-event control on each card.
 *
 * This is what /oee rendered as a top-level nav item. A single-site shop never
 * needed a whole menu entry for it, so it is a TAB on the app-comparison screen
 * now — same endpoint, same `calcOEE` on the server, same numbers. The other
 * (and only other) OEE surface is the per-station card on a station's own page,
 * which is the drill-down from here.
 */
export function OEEPanel() {
  const [machines, setMachines] = useState<OEEMachine[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await api.getOEE();
      setMachines(Array.isArray(data) ? data : []);
      setLoadError(null);
    } catch (err: any) {
      console.error('Failed to load OEE data', err);
      setLoadError(err?.message || 'Failed to load OEE data');
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  // Machine state turns over fast on the floor — poll every 30s while visible.
  const auto = useAutoRefresh(load, 30_000);

  const handleLogEvent = async (id: string, data: StationEventInput) => {
    // The typed call, because api.logOEEEvent cannot carry a reason code.
    const updated = await logStationEvent(id, data) as OEEMachine | null;
    setMachines(prev => prev.map(m => (m.id === id && updated ? updated : m)));
  };

  // KPI aggregates
  const totalMachines = machines.length;
  const runningNow = machines.filter(m => m.current_status === 'running').length;
  const downNow = machines.filter(m => m.current_status === 'down').length;
  // Plant-wide OEE averages ONLY the machines whose OEE is actually measurable —
  // folding un-measurable machines in as zeros would understate the whole plant.
  const measured = machines.filter(m => typeof m.oee?.oee === 'number');
  const plantOEE = measured.length > 0
    ? measured.reduce((sum, m) => sum + (m.oee.oee as number), 0) / measured.length
    : null;

  return (
    <div className="space-y-5" data-testid="oee-panel">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <div className="flex items-center gap-2.5">
            <h2 className="text-lg font-bold text-gray-900 tracking-tight">OEE today</h2>
            <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-green-100 text-green-700 text-[11px] font-semibold">
              <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
              Live
            </span>
          </div>
          <p className="text-sm text-gray-500 mt-0.5">
            Overall Equipment Effectiveness for today, measured against each station's planned
            hours and ideal cycle time — auto-refresh every 30s
          </p>
        </div>
        <div className="flex items-center gap-3">
          <LastRefreshed
            at={auto.lastRefreshed}
            refreshing={auto.refreshing}
            onRefresh={() => { void auto.refresh(); }}
          />
        </div>
      </div>

      {/* KPI Bar */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard
          icon={<Monitor size={18} className="text-blue-600" />}
          iconBg="bg-blue-50"
          label="Stations"
          value={String(totalMachines)}
        />
        <KpiCard
          icon={<CheckCircle size={18} className="text-green-600" />}
          iconBg="bg-green-50"
          label="Running Now"
          value={String(runningNow)}
          sub={`${totalMachines > 0 ? Math.round((runningNow / totalMachines) * 100) : 0}% of stations`}
        />
        <KpiCard
          icon={<AlertTriangle size={18} className="text-red-500" />}
          iconBg="bg-red-50"
          label="Down Now"
          value={String(downNow)}
          sub={downNow > 0 ? 'Attention required' : 'All systems OK'}
        />
        <KpiCard
          icon={<TrendingUp size={18} className="text-purple-600" />}
          iconBg="bg-purple-50"
          label="Plant-wide OEE"
          value={plantOEE === null ? '—' : `${plantOEE.toFixed(1)}%`}
          sub={plantOEE === null
            ? 'No station has enough data yet'
            : `averaged over ${measured.length} of ${totalMachines} machines`}
          valueClass={plantOEE === null ? 'text-gray-400' : oeeColor(plantOEE)}
        />
      </div>

      {/* Machine grid */}
      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="h-48 rounded-2xl bg-gray-100 animate-pulse" />
          ))}
        </div>
      ) : loadError && machines.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 gap-3 text-center">
          <AlertTriangle size={28} className="text-red-700" />
          <p className="text-gray-500 font-medium">Couldn't load machines</p>
          <p className="text-sm text-gray-500">{loadError}</p>
          <button onClick={() => { void auto.refresh(); }} className="btn-secondary">
            <RefreshCw size={14} /> Retry
          </button>
        </div>
      ) : machines.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-gray-500">
          <Activity size={40} className="mb-3 opacity-30" />
          <div className="font-medium text-gray-500">No machines configured</div>
          <div className="text-sm mt-1">Add machines to the OEE system to see data here</div>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {machines.map(machine => (
            <MachineCard
              key={machine.id}
              machine={machine}
              isExpanded={expandedId === machine.id}
              onToggleExpand={() => setExpandedId(prev => (prev === machine.id ? null : machine.id))}
              onLogEvent={handleLogEvent}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function KpiCard({
  icon,
  iconBg,
  label,
  value,
  sub,
  valueClass,
}: {
  icon: React.ReactNode;
  iconBg: string;
  label: string;
  value: string;
  sub?: string;
  valueClass?: string;
}) {
  return (
    <div className="stat-card">
      <div className="flex items-center gap-3">
        <div className={`w-10 h-10 ${iconBg} rounded-lg flex items-center justify-center flex-shrink-0`}>
          {icon}
        </div>
        <div>
          <div className={`text-2xl font-bold ${valueClass || 'text-gray-900'}`}>{value}</div>
          <div className="text-xs font-medium text-gray-500">{label}</div>
          {sub && <div className="text-xs text-gray-500">{sub}</div>}
        </div>
      </div>
    </div>
  );
}

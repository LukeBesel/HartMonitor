import { useEffect, useState, useCallback } from 'react';
import {
  Activity, RefreshCw, AlertTriangle, CheckCircle, Clock,
  Plus, X, ChevronDown, ChevronUp, Cpu, TrendingUp, Circle,
  Play, Pause, Wrench, Monitor,
} from 'lucide-react';
import { api } from '../api/client';

interface OEEData {
  availability: number;
  performance: number;
  quality: number;
  oee: number;
  uptime_minutes: number;
  downtime_minutes: number;
  planned_minutes: number;
  completions_today: number;
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
  event_type: 'running' | 'down' | 'maintenance' | 'idle';
  reason: string;
}

const STATUS_CONFIG = {
  running:     { color: 'bg-green-500',  text: 'text-green-400', label: 'Running',     icon: Play },
  down:        { color: 'bg-red-500',    text: 'text-red-400',   label: 'Down',        icon: AlertTriangle },
  maintenance: { color: 'bg-amber-500',  text: 'text-amber-400', label: 'Maintenance', icon: Wrench },
  idle:        { color: 'bg-gray-400',   text: 'text-gray-400',  label: 'Idle',        icon: Pause },
};

function oeeColor(pct: number): string {
  if (pct >= 80) return 'text-green-400';
  if (pct >= 60) return 'text-amber-400';
  return 'text-red-400';
}

function oeeBgColor(pct: number): string {
  if (pct >= 80) return 'bg-green-500';
  if (pct >= 60) return 'bg-amber-500';
  return 'bg-red-500';
}

function elapsedSince(iso: string | null): string {
  if (!iso) return '';
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ${mins % 60}m ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function MiniBar({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-[10px]">
        <span className="text-gray-400 font-medium">{label}</span>
        <span className="text-gray-300 font-semibold">{value.toFixed(1)}%</span>
      </div>
      <div className="h-1.5 bg-gray-700 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all ${color}`}
          style={{ width: `${Math.min(value, 100)}%` }}
        />
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
  onLogEvent: (id: string, data: { event_type: string; reason: string }) => Promise<void>;
}) {
  const [form, setForm] = useState<LogEventForm>({ event_type: 'running', reason: '' });
  const [saving, setSaving] = useState(false);

  const statusCfg = STATUS_CONFIG[machine.current_status] ?? STATUS_CONFIG.idle;

  const handleSave = async () => {
    setSaving(true);
    try {
      await onLogEvent(machine.id, { event_type: form.event_type, reason: form.reason });
      onToggleExpand();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="rounded-2xl border border-gray-700 overflow-hidden" style={{ backgroundColor: '#1a2235' }}>
      {/* Card body */}
      <div className="p-4 space-y-3">
        {/* Status row */}
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <div className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${statusCfg.color}`} />
            <div className="min-w-0">
              <div className="font-semibold text-white text-sm truncate">{machine.name}</div>
              <div className="text-[11px] text-gray-400 truncate">{machine.location}</div>
            </div>
          </div>
          <div className="text-right flex-shrink-0">
            <div className={`text-[10px] font-medium ${statusCfg.text}`}>{statusCfg.label}</div>
            {machine.current_status_since && (
              <div className="text-[10px] text-gray-500 mt-0.5">{elapsedSince(machine.current_status_since)}</div>
            )}
          </div>
        </div>

        {/* OEE big number */}
        <div className="flex items-end gap-2">
          <div className={`text-3xl font-bold tabular-nums leading-none ${oeeColor(machine.oee.oee)}`}>
            {machine.oee.oee.toFixed(1)}
            <span className="text-base font-medium">%</span>
          </div>
          <div className="text-xs text-gray-500 mb-1">OEE</div>
        </div>

        {/* Progress bars */}
        <div className="space-y-1.5">
          <MiniBar label="Availability" value={machine.oee.availability} color="bg-green-500" />
          <MiniBar label="Performance"  value={machine.oee.performance}  color="bg-blue-500" />
          <MiniBar label="Quality"      value={machine.oee.quality}      color="bg-purple-500" />
        </div>

        {/* Footer row */}
        <div className="flex items-center justify-between pt-1">
          <div className="flex items-center gap-1 text-[10px] text-gray-500">
            <Cpu size={11} />
            <span>{machine.oee.completions_today} completions today</span>
          </div>
          <button
            onClick={onToggleExpand}
            className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-medium transition-colors text-gray-400 hover:text-white border border-gray-600 hover:border-gray-500 hover:bg-gray-700"
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
        <div className="border-t border-gray-700 p-4 space-y-3" style={{ backgroundColor: '#111827' }}>
          <div className="text-xs font-semibold text-gray-300 uppercase tracking-wider">Log Status Event</div>

          <div>
            <label className="text-[11px] text-gray-400 mb-1 block">New Status</label>
            <select
              value={form.event_type}
              onChange={e => setForm(f => ({ ...f, event_type: e.target.value as LogEventForm['event_type'] }))}
              className="w-full px-3 py-2 rounded-lg text-sm bg-gray-800 border border-gray-600 text-white focus:outline-none focus:border-blue-500 transition-colors"
            >
              <option value="running">Running</option>
              <option value="down">Down</option>
              <option value="maintenance">Maintenance</option>
              <option value="idle">Idle</option>
            </select>
          </div>

          <div>
            <label className="text-[11px] text-gray-400 mb-1 block">Reason (optional)</label>
            <textarea
              value={form.reason}
              onChange={e => setForm(f => ({ ...f, reason: e.target.value }))}
              rows={2}
              placeholder="Describe what happened..."
              className="w-full px-3 py-2 rounded-lg text-sm bg-gray-800 border border-gray-600 text-white placeholder-gray-500 focus:outline-none focus:border-blue-500 transition-colors resize-none"
            />
          </div>

          <div className="flex gap-2">
            <button
              onClick={handleSave}
              disabled={saving}
              className="flex-1 py-2 rounded-lg text-sm font-medium text-white transition-colors disabled:opacity-50 bg-blue-600 hover:bg-blue-500"
            >
              {saving ? 'Saving…' : 'Save Event'}
            </button>
            <button
              onClick={onToggleExpand}
              className="px-4 py-2 rounded-lg text-sm font-medium text-gray-400 hover:text-white border border-gray-600 hover:border-gray-500 transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default function OEETracker() {
  const [machines, setMachines] = useState<OEEMachine[]>([]);
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async (showRefreshing = false) => {
    if (showRefreshing) setRefreshing(true);
    try {
      const data = await (api as any).getOEE();
      setMachines(data);
      setLastUpdated(new Date());
    } catch (err) {
      console.error('Failed to load OEE data', err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    load();
    const interval = setInterval(() => load(), 30000);
    return () => clearInterval(interval);
  }, [load]);

  const handleLogEvent = async (id: string, data: { event_type: string; reason: string }) => {
    const updated = await (api as any).logOEEEvent(id, data);
    setMachines(prev => prev.map(m => (m.id === id ? updated : m)));
    setLastUpdated(new Date());
  };

  // KPI aggregates
  const totalMachines = machines.length;
  const runningNow = machines.filter(m => m.current_status === 'running').length;
  const downNow = machines.filter(m => m.current_status === 'down').length;
  const plantOEE = totalMachines > 0
    ? machines.reduce((sum, m) => sum + m.oee.oee, 0) / totalMachines
    : 0;

  const formattedLastUpdated = lastUpdated
    ? lastUpdated.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    : null;

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="text-2xl font-bold text-gray-900 tracking-tight">OEE Dashboard</h1>
            <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-green-100 text-green-700 text-[11px] font-semibold">
              <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
              Live
            </span>
          </div>
          <p className="text-sm text-gray-500 mt-0.5">Overall Equipment Effectiveness — auto-refresh every 30s</p>
        </div>
        <div className="flex items-center gap-3">
          {formattedLastUpdated && (
            <div className="flex items-center gap-1.5 text-xs text-gray-400">
              <Clock size={12} />
              Updated {formattedLastUpdated}
            </div>
          )}
          <button
            onClick={() => load(true)}
            disabled={refreshing}
            className="btn-secondary"
          >
            <RefreshCw size={14} className={refreshing ? 'animate-spin' : ''} />
            Refresh
          </button>
        </div>
      </div>

      {/* KPI Bar */}
      <div className="grid grid-cols-4 gap-4">
        <KpiCard
          icon={<Monitor size={18} className="text-blue-600" />}
          iconBg="bg-blue-50"
          label="Total Machines"
          value={String(totalMachines)}
        />
        <KpiCard
          icon={<CheckCircle size={18} className="text-green-600" />}
          iconBg="bg-green-50"
          label="Running Now"
          value={String(runningNow)}
          sub={`${totalMachines > 0 ? Math.round((runningNow / totalMachines) * 100) : 0}% of fleet`}
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
          value={`${plantOEE.toFixed(1)}%`}
          valueClass={oeeColor(plantOEE).replace('text-', 'text-')}
        />
      </div>

      {/* Machine grid */}
      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="h-48 rounded-2xl bg-gray-100 animate-pulse" />
          ))}
        </div>
      ) : machines.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-gray-400">
          <Activity size={40} className="mb-3 opacity-30" />
          <div className="font-medium">No machines configured</div>
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
          {sub && <div className="text-xs text-gray-400">{sub}</div>}
        </div>
      </div>
    </div>
  );
}

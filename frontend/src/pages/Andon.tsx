import { useEffect, useState, useCallback } from 'react';
import {
  Siren, HelpCircle, ShieldAlert, Package, Wrench, AlertTriangle,
  CheckCircle, X, ChevronDown, RefreshCw, Plus, Loader2,
  type LucideIcon,
} from 'lucide-react';
import { api } from '../api/client';

// ── Types ─────────────────────────────────────────────────────────────────────

interface AndonCall {
  id: string;
  type: 'help' | 'quality' | 'material' | 'maintenance' | 'safety';
  priority: 'low' | 'normal' | 'high' | 'critical';
  status: 'open' | 'acknowledged' | 'resolved';
  title: string;
  message: string;
  department_id?: string;
  department_name?: string;
  station_id?: string;
  created_by: string;
  assigned_to?: string;
  acknowledged_at?: string;
  resolved_at?: string;
  created_at: string;
}

interface Department {
  id: string;
  name: string;
  description: string;
  manager_name: string;
  color: string;
  created_at: string;
}

interface AndonSummary {
  open: number;
  critical: number;
  acknowledged: number;
  resolved_today: number;
  by_type: Record<string, number>;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

// ── Config maps ───────────────────────────────────────────────────────────────

const TYPE_CONFIG: Record<
  AndonCall['type'],
  { label: string; icon: React.ElementType; color: string; borderColor: string; bgColor: string; iconColor: string }
> = {
  help:        { label: 'Help',        icon: HelpCircle,   color: 'blue',   borderColor: 'border-l-blue-500',   bgColor: 'bg-blue-600 hover:bg-blue-700',   iconColor: 'text-blue-400' },
  quality:     { label: 'Quality',     icon: ShieldAlert,  color: 'purple', borderColor: 'border-l-purple-500', bgColor: 'bg-purple-600 hover:bg-purple-700', iconColor: 'text-purple-400' },
  material:    { label: 'Material',    icon: Package,      color: 'amber',  borderColor: 'border-l-amber-500',  bgColor: 'bg-amber-600 hover:bg-amber-700',  iconColor: 'text-amber-400' },
  maintenance: { label: 'Maintenance', icon: Wrench,       color: 'orange', borderColor: 'border-l-orange-500', bgColor: 'bg-orange-600 hover:bg-orange-700', iconColor: 'text-orange-400' },
  safety:      { label: 'Safety',      icon: AlertTriangle,color: 'red',    borderColor: 'border-l-red-500',    bgColor: 'bg-red-600 hover:bg-red-700',      iconColor: 'text-red-400' },
};

const PRIORITY_BADGE: Record<AndonCall['priority'], string> = {
  low:      'bg-gray-700 text-gray-300',
  normal:   'bg-gray-700 text-gray-300',
  high:     'bg-amber-900/50 text-amber-300 border border-amber-700',
  critical: 'bg-red-900/50 text-red-300 border border-red-700 animate-pulse',
};

const STATUS_BADGE: Record<AndonCall['status'], string> = {
  open:         'bg-red-900/50 text-red-300',
  acknowledged: 'bg-amber-900/50 text-amber-300',
  resolved:     'bg-green-900/50 text-green-300',
};

// ── Raise Call Modal ──────────────────────────────────────────────────────────

interface RaiseCallModalProps {
  departments: Department[];
  onClose: () => void;
  onCreated: () => void;
}

function RaiseCallModal({ departments, onClose, onCreated }: RaiseCallModalProps) {
  const [selectedType, setSelectedType] = useState<AndonCall['type'] | null>(null);
  const [title, setTitle] = useState('');
  const [message, setMessage] = useState('');
  const [priority, setPriority] = useState<'normal' | 'high' | 'critical'>('normal');
  const [departmentId, setDepartmentId] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const types = Object.entries(TYPE_CONFIG) as [AndonCall['type'], typeof TYPE_CONFIG[AndonCall['type']]][];

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedType) { setError('Please select a call type.'); return; }
    if (!title.trim()) { setError('Title is required.'); return; }
    setError('');
    setSubmitting(true);
    try {
      await api.createAndonCall({
        type: selectedType,
        title: title.trim(),
        message: message.trim() || undefined,
        priority,
        department_id: departmentId || undefined,
      });
      onCreated();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create call.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-gray-900 border border-gray-800 rounded-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-gray-800">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-red-900/40 rounded-lg">
              <Siren size={20} className="text-red-400" />
            </div>
            <h2 className="text-lg font-semibold text-white">Raise an Andon Call</h2>
          </div>
          <button
            onClick={onClose}
            className="p-2 text-gray-400 hover:text-white hover:bg-gray-800 rounded-lg transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-5">
          {/* Type Selector */}
          <div>
            <label className="section-label mb-3 block">Call Type *</label>
            <div className="grid grid-cols-3 gap-2">
              {types.map(([key, cfg]) => {
                const Icon = cfg.icon;
                const isSelected = selectedType === key;
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setSelectedType(key)}
                    className={`flex flex-col items-center gap-2 p-3 rounded-xl border transition-all ${
                      isSelected
                        ? `${cfg.bgColor} border-transparent text-white`
                        : 'bg-gray-800 border-gray-700 text-gray-400 hover:bg-gray-700 hover:text-white'
                    }`}
                  >
                    <Icon size={20} />
                    <span className="text-xs font-medium">{cfg.label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Title */}
          <div>
            <label className="section-label mb-1 block">Title *</label>
            <input
              type="text"
              className="input-field w-full"
              placeholder="Brief description of the issue"
              value={title}
              onChange={e => setTitle(e.target.value)}
              required
            />
          </div>

          {/* Message */}
          <div>
            <label className="section-label mb-1 block">Message (optional)</label>
            <textarea
              className="input-field w-full resize-none"
              rows={3}
              placeholder="Additional details..."
              value={message}
              onChange={e => setMessage(e.target.value)}
            />
          </div>

          {/* Priority */}
          <div>
            <label className="section-label mb-2 block">Priority</label>
            <div className="flex gap-2">
              {(['normal', 'high', 'critical'] as const).map(p => (
                <button
                  key={p}
                  type="button"
                  onClick={() => setPriority(p)}
                  className={`flex-1 py-2 px-3 rounded-lg text-sm font-medium capitalize transition-colors border ${
                    priority === p
                      ? p === 'critical'
                        ? 'bg-red-700 border-red-600 text-white'
                        : p === 'high'
                        ? 'bg-amber-700 border-amber-600 text-white'
                        : 'bg-blue-700 border-blue-600 text-white'
                      : 'bg-gray-800 border-gray-700 text-gray-400 hover:bg-gray-700'
                  }`}
                >
                  {p}
                </button>
              ))}
            </div>
          </div>

          {/* Department */}
          {departments.length > 0 && (
            <div>
              <label className="section-label mb-1 block">Department (optional)</label>
              <div className="relative">
                <select
                  className="input-field w-full appearance-none pr-8"
                  value={departmentId}
                  onChange={e => setDepartmentId(e.target.value)}
                >
                  <option value="">— Select department —</option>
                  {departments.map(d => (
                    <option key={d.id} value={d.id}>{d.name}</option>
                  ))}
                </select>
                <ChevronDown size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
              </div>
            </div>
          )}

          {/* Error */}
          {error && (
            <p className="text-sm text-red-400 bg-red-900/20 border border-red-800 rounded-lg px-3 py-2">{error}</p>
          )}

          {/* Actions */}
          <div className="flex gap-3 pt-1">
            <button type="button" onClick={onClose} className="btn-secondary flex-1">
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="flex-1 bg-red-600 hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed text-white font-bold py-2 px-4 rounded-xl flex items-center justify-center gap-2 transition-colors"
            >
              {submitting ? <Loader2 size={16} className="animate-spin" /> : <Siren size={16} />}
              {submitting ? 'Raising…' : 'Raise Call'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Skeleton ──────────────────────────────────────────────────────────────────

function SkeletonCards() {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="bg-gray-900 border border-gray-800 rounded-xl p-4 animate-pulse">
          <div className="flex items-start justify-between mb-3">
            <div className="h-5 bg-gray-800 rounded w-2/3" />
            <div className="h-5 bg-gray-800 rounded w-16" />
          </div>
          <div className="h-4 bg-gray-800 rounded w-1/3 mb-4" />
          <div className="h-4 bg-gray-800 rounded w-full mb-2" />
          <div className="h-4 bg-gray-800 rounded w-3/4 mb-4" />
          <div className="flex gap-2">
            <div className="h-8 bg-gray-800 rounded-lg w-24" />
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function Andon() {
  const [calls, setCalls] = useState<AndonCall[]>([]);
  const [summary, setSummary] = useState<AndonSummary | null>(null);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [typeFilter, setTypeFilter] = useState<string>('all');

  const [showCreate, setShowCreate] = useState(false);

  // Per-card action loading: key = call id, value = true while in-flight
  const [actionLoading, setActionLoading] = useState<Record<string, boolean>>({});

  // Inline resolve: which card is expanded + text
  const [resolveCardId, setResolveCardId] = useState<string | null>(null);
  const [resolutionText, setResolutionText] = useState('');

  // ── Data loading ─────────────────────────────────────────────────────────

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    setError('');
    try {
      const params: { status?: string; type?: string } = {};
      if (statusFilter !== 'all') params.status = statusFilter;
      if (typeFilter !== 'all') params.type = typeFilter;

      const [callsData, summaryData, depsData] = await Promise.all([
        api.getAndonCalls(params),
        api.getAndonSummary(),
        api.getDepartments(),
      ]);
      setCalls(callsData);
      setSummary(summaryData);
      setDepartments(depsData);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load Andon data.');
    } finally {
      if (!silent) setLoading(false);
    }
  }, [statusFilter, typeFilter]);

  useEffect(() => {
    load();
  }, [load]);

  // Auto-refresh every 30 seconds
  useEffect(() => {
    const interval = setInterval(() => load(true), 30_000);
    return () => clearInterval(interval);
  }, [load]);

  // ── Actions ───────────────────────────────────────────────────────────────

  async function handleAcknowledge(id: string) {
    setActionLoading(prev => ({ ...prev, [id]: true }));
    try {
      await api.acknowledgeAndonCall(id);
      await load(true);
    } catch (err) {
      console.error('Acknowledge failed:', err);
    } finally {
      setActionLoading(prev => ({ ...prev, [id]: false }));
    }
  }

  async function handleResolve(id: string) {
    setActionLoading(prev => ({ ...prev, [id]: true }));
    try {
      await api.resolveAndonCall(id, resolutionText.trim() || undefined);
      setResolveCardId(null);
      setResolutionText('');
      await load(true);
    } catch (err) {
      console.error('Resolve failed:', err);
    } finally {
      setActionLoading(prev => ({ ...prev, [id]: false }));
    }
  }

  // ── Render helpers ────────────────────────────────────────────────────────

  const statusFilters = ['all', 'open', 'acknowledged', 'resolved'];
  const typeFilters = ['all', 'help', 'quality', 'material', 'maintenance', 'safety'];

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      <div className="max-w-7xl mx-auto px-4 py-8 space-y-6">

        {/* ── Page Header ── */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-red-900/40 border border-red-800/60 rounded-xl">
              <Siren size={24} className="text-red-400" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-white">Andon Board</h1>
              <p className="text-sm text-gray-400">Real-time production call management</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={() => load()}
              className="btn-ghost flex items-center gap-2"
              title="Refresh"
            >
              <RefreshCw size={16} />
              <span className="hidden sm:inline">Refresh</span>
            </button>
            <button
              onClick={() => setShowCreate(true)}
              className="bg-red-600 hover:bg-red-700 text-white font-bold py-3 px-6 rounded-xl flex items-center gap-2 transition-colors w-full sm:w-auto justify-center"
            >
              <Plus size={18} />
              Raise a Call
            </button>
          </div>
        </div>

        {/* ── Error State ── */}
        {error && (
          <div className="bg-red-900/20 border border-red-800 rounded-xl p-4 flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <AlertTriangle size={18} className="text-red-400 shrink-0" />
              <p className="text-red-300 text-sm">{error}</p>
            </div>
            <button onClick={() => load()} className="btn-secondary text-sm shrink-0">
              Retry
            </button>
          </div>
        )}

        {/* ── Stats Strip ── */}
        {summary && (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {/* Open */}
            <div className={`bg-gray-900 border border-gray-800 rounded-xl p-4 ${summary.open > 0 ? 'border-red-800/60' : ''}`}>
              <div className="flex items-center justify-between mb-1">
                <span className="section-label">Open Calls</span>
                {summary.open > 0 && (
                  <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
                )}
              </div>
              <p className={`text-3xl font-bold ${summary.open > 0 ? 'text-red-400' : 'text-white'}`}>
                {summary.open}
              </p>
            </div>

            {/* Critical */}
            <div className={`bg-gray-900 border border-gray-800 rounded-xl p-4 ${summary.critical > 0 ? 'border-red-800/60' : ''}`}>
              <div className="flex items-center justify-between mb-1">
                <span className="section-label">Critical</span>
                {summary.critical > 0 && (
                  <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
                )}
              </div>
              <p className={`text-3xl font-bold ${summary.critical > 0 ? 'text-red-400' : 'text-white'}`}>
                {summary.critical}
              </p>
            </div>

            {/* Acknowledged */}
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
              <p className="section-label mb-1">Acknowledged</p>
              <p className="text-3xl font-bold text-amber-400">{summary.acknowledged}</p>
            </div>

            {/* Resolved Today */}
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
              <p className="section-label mb-1">Resolved Today</p>
              <p className="text-3xl font-bold text-green-400">{summary.resolved_today}</p>
            </div>
          </div>
        )}

        {/* ── Filter Chips ── */}
        <div className="space-y-3">
          {/* Status filters */}
          <div className="flex flex-wrap gap-2 items-center">
            <span className="section-label mr-1">Status:</span>
            {statusFilters.map(s => (
              <button
                key={s}
                onClick={() => setStatusFilter(s)}
                className={`px-3 py-1.5 rounded-full text-sm font-medium capitalize transition-colors ${
                  statusFilter === s
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-800 text-gray-400 hover:bg-gray-700 hover:text-white'
                }`}
              >
                {s === 'all' ? 'All' : s}
              </button>
            ))}
          </div>

          {/* Type filters */}
          <div className="flex flex-wrap gap-2 items-center">
            <span className="section-label mr-1">Type:</span>
            {typeFilters.map(t => (
              <button
                key={t}
                onClick={() => setTypeFilter(t)}
                className={`px-3 py-1.5 rounded-full text-sm font-medium capitalize transition-colors ${
                  typeFilter === t
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-800 text-gray-400 hover:bg-gray-700 hover:text-white'
                }`}
              >
                {t === 'all' ? 'All' : TYPE_CONFIG[t as AndonCall['type']]?.label ?? t}
              </button>
            ))}
          </div>
        </div>

        {/* ── Call Cards ── */}
        {loading ? (
          <SkeletonCards />
        ) : calls.length === 0 ? (
          /* ── Empty State ── */
          <div className="flex flex-col items-center justify-center py-24 gap-4">
            <div className="p-5 bg-green-900/30 border border-green-800/50 rounded-full">
              <CheckCircle size={40} className="text-green-400" />
            </div>
            <div className="text-center">
              <h3 className="text-xl font-semibold text-white mb-1">All clear</h3>
              <p className="text-gray-400">No active Andon calls</p>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {calls.map(call => {
              const cfg = TYPE_CONFIG[call.type];
              const Icon = cfg.icon;
              const isActioning = !!actionLoading[call.id];
              const isResolvingThis = resolveCardId === call.id;

              return (
                <div
                  key={call.id}
                  className={`bg-gray-900 border border-gray-800 rounded-xl p-4 border-l-4 ${cfg.borderColor} flex flex-col gap-3`}
                >
                  {/* Card Header */}
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <Icon size={16} className={`${cfg.iconColor} shrink-0`} />
                      <span className="font-semibold text-white truncate">{call.title}</span>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      {call.priority === 'critical' && (
                        <span className="animate-pulse bg-red-500 rounded-full w-2 h-2 shrink-0" />
                      )}
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium capitalize ${PRIORITY_BADGE[call.priority]}`}>
                        {call.priority}
                      </span>
                    </div>
                  </div>

                  {/* Meta row */}
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-gray-400">
                    {call.department_name && (
                      <span className="font-medium text-gray-300">{call.department_name}</span>
                    )}
                    <span className="capitalize flex items-center gap-1">
                      <span className={`px-1.5 py-0.5 rounded text-xs font-medium ${STATUS_BADGE[call.status]}`}>
                        {call.status}
                      </span>
                    </span>
                    <span>{timeAgo(call.created_at)}</span>
                  </div>

                  {/* Message */}
                  {call.message && (
                    <p className="text-sm text-gray-400 leading-relaxed line-clamp-2">{call.message}</p>
                  )}

                  {/* Assigned to */}
                  {call.assigned_to && (
                    <p className="text-xs text-gray-500">
                      Assigned to: <span className="text-gray-300">{call.assigned_to}</span>
                    </p>
                  )}

                  {/* Actions */}
                  {call.status === 'open' && (
                    <button
                      onClick={() => handleAcknowledge(call.id)}
                      disabled={isActioning}
                      className="mt-auto btn-primary flex items-center justify-center gap-2 py-2 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {isActioning ? (
                        <Loader2 size={14} className="animate-spin" />
                      ) : null}
                      Acknowledge
                    </button>
                  )}

                  {call.status === 'acknowledged' && !isResolvingThis && (
                    <button
                      onClick={() => { setResolveCardId(call.id); setResolutionText(''); }}
                      disabled={isActioning}
                      className="mt-auto bg-green-700 hover:bg-green-600 text-white text-sm font-medium py-2 px-4 rounded-lg flex items-center justify-center gap-2 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      <CheckCircle size={14} />
                      Resolve
                    </button>
                  )}

                  {call.status === 'acknowledged' && isResolvingThis && (
                    <div className="mt-auto space-y-2">
                      <textarea
                        className="input-field w-full resize-none text-sm"
                        rows={2}
                        placeholder="Resolution notes (optional)…"
                        value={resolutionText}
                        onChange={e => setResolutionText(e.target.value)}
                        autoFocus
                      />
                      <div className="flex gap-2">
                        <button
                          onClick={() => { setResolveCardId(null); setResolutionText(''); }}
                          className="btn-ghost flex-1 text-sm py-1.5"
                        >
                          Cancel
                        </button>
                        <button
                          onClick={() => handleResolve(call.id)}
                          disabled={isActioning}
                          className="flex-1 bg-green-700 hover:bg-green-600 text-white text-sm font-medium py-1.5 px-3 rounded-lg flex items-center justify-center gap-2 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          {isActioning ? <Loader2 size={13} className="animate-spin" /> : <CheckCircle size={13} />}
                          Confirm
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Resolved footer */}
                  {call.status === 'resolved' && call.resolved_at && (
                    <p className="text-xs text-green-400 mt-auto">
                      Resolved {timeAgo(call.resolved_at)}
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ── Raise Call Modal ── */}
      {showCreate && (
        <RaiseCallModal
          departments={departments}
          onClose={() => setShowCreate(false)}
          onCreated={() => load()}
        />
      )}
    </div>
  );
}

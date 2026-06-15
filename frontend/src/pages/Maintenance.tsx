import { useEffect, useState, useCallback } from 'react';
import {
  Wrench, Plus, Search, AlertTriangle, CheckCircle2, Clock,
  Trash2, RefreshCw, Calendar, User, MapPin, Cpu, ClipboardList,
  BarChart3, ChevronDown, X, AlertCircle, Settings,
} from 'lucide-react';
import { api } from '../api/client';

// ── Types ─────────────────────────────────────────────────────────────────────

interface Asset {
  id: string;
  asset_number: string;
  name: string;
  type: string;
  make: string;
  model: string;
  serial_number: string;
  department_name?: string;
  department_id?: string;
  location: string;
  status: 'active' | 'inactive' | 'under_maintenance' | 'retired';
  install_date?: string;
  notes: string;
}

interface MaintenanceWO {
  id: string;
  wo_number: string;
  asset_id?: string;
  asset_name?: string;
  type: 'pm' | 'corrective' | 'emergency' | 'inspection';
  title: string;
  description: string;
  priority: 'low' | 'normal' | 'high' | 'critical';
  status: 'open' | 'in_progress' | 'on_hold' | 'complete' | 'cancelled';
  assigned_to: string;
  due_date?: string;
  completed_at?: string;
  actual_hours: number;
  created_at: string;
}

interface PMSchedule {
  id: string;
  asset_id: string;
  asset_name?: string;
  title: string;
  frequency_type: string;
  frequency_value: number;
  last_completed_at?: string;
  next_due_at?: string;
  assigned_to: string;
  estimated_hours: number;
}

interface MaintenanceSummary {
  open_wos: number;
  overdue_pms: number;
  assets_count: number;
  critical_wos: number;
  completed_today: number;
}

interface Department {
  id: string;
  name: string;
}

type TabKey = 'overview' | 'work_orders' | 'assets' | 'pm_schedules';

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatDate(iso?: string): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function isOverdue(dateStr?: string): boolean {
  if (!dateStr) return false;
  return new Date(dateStr) < new Date();
}

function priorityColor(p: string): string {
  switch (p) {
    case 'critical': return 'bg-red-500/20 text-red-400 border border-red-500/30';
    case 'high':     return 'bg-amber-500/20 text-amber-400 border border-amber-500/30';
    case 'normal':   return 'bg-blue-500/20 text-blue-400 border border-blue-500/30';
    case 'low':      return 'bg-gray-700 text-gray-400 border border-gray-600';
    default:         return 'bg-gray-700 text-gray-400 border border-gray-600';
  }
}

function statusColor(s: string): string {
  switch (s) {
    case 'open':        return 'bg-blue-500/20 text-blue-400 border border-blue-500/30';
    case 'in_progress': return 'bg-amber-500/20 text-amber-400 border border-amber-500/30';
    case 'on_hold':     return 'bg-gray-700 text-gray-400 border border-gray-600';
    case 'complete':    return 'bg-green-500/20 text-green-400 border border-green-500/30';
    case 'cancelled':   return 'bg-red-500/20 text-red-400 border border-red-500/30';
    default:            return 'bg-gray-700 text-gray-400 border border-gray-600';
  }
}

function assetStatusColor(s: string): string {
  switch (s) {
    case 'active':            return 'bg-green-500/20 text-green-400 border border-green-500/30';
    case 'inactive':          return 'bg-gray-700 text-gray-400 border border-gray-600';
    case 'under_maintenance': return 'bg-amber-500/20 text-amber-400 border border-amber-500/30';
    case 'retired':           return 'bg-gray-700 text-gray-300 border border-gray-600';
    default:                  return 'bg-gray-700 text-gray-400 border border-gray-600';
  }
}

function woTypeLabel(t: string): string {
  switch (t) {
    case 'pm':          return 'Preventive';
    case 'corrective':  return 'Corrective';
    case 'emergency':   return 'Emergency';
    case 'inspection':  return 'Inspection';
    default:            return t;
  }
}

function woTypeColor(t: string): string {
  switch (t) {
    case 'pm':          return 'bg-blue-500/20 text-blue-300 border border-blue-500/30';
    case 'corrective':  return 'bg-amber-500/20 text-amber-300 border border-amber-500/30';
    case 'emergency':   return 'bg-red-500/20 text-red-300 border border-red-500/30';
    case 'inspection':  return 'bg-purple-500/20 text-purple-300 border border-purple-500/30';
    default:            return 'bg-gray-700 text-gray-400 border border-gray-600';
  }
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1).replace(/_/g, ' ');
}

// ── Loading Skeleton ──────────────────────────────────────────────────────────

function SkeletonCard() {
  return (
    <div className="animate-pulse bg-gray-800 rounded-xl p-4 h-28" />
  );
}

function SkeletonRow() {
  return (
    <div className="animate-pulse flex gap-3 p-3 border-b border-gray-800">
      <div className="bg-gray-800 rounded h-4 w-24" />
      <div className="bg-gray-800 rounded h-4 flex-1" />
      <div className="bg-gray-800 rounded h-4 w-16" />
    </div>
  );
}

// ── Stat Card ─────────────────────────────────────────────────────────────────

interface StatCardProps {
  label: string;
  value: number | string;
  icon: React.ReactNode;
  accent?: string;
  sub?: string;
}

function StatCard({ label, value, icon, accent = 'text-blue-400', sub }: StatCardProps) {
  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 flex items-start gap-3">
      <div className={`mt-0.5 ${accent}`}>{icon}</div>
      <div>
        <div className="text-2xl font-bold text-white">{value}</div>
        <div className="text-xs font-medium text-gray-400 mt-0.5">{label}</div>
        {sub && <div className="text-xs text-gray-500 mt-0.5">{sub}</div>}
      </div>
    </div>
  );
}

// ── Empty State ───────────────────────────────────────────────────────────────

interface EmptyStateProps {
  icon: React.ReactNode;
  title: string;
  sub?: string;
}

function EmptyState({ icon, title, sub }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <div className="text-gray-700 mb-3">{icon}</div>
      <div className="text-gray-400 font-semibold text-base mb-1">{title}</div>
      {sub && <div className="text-gray-500 text-sm">{sub}</div>}
    </div>
  );
}

// ── Create WO Modal ───────────────────────────────────────────────────────────

interface CreateWOModalProps {
  assets: Asset[];
  onClose: () => void;
  onCreated: () => void;
}

function CreateWOModal({ assets, onClose, onCreated }: CreateWOModalProps) {
  const [form, setForm] = useState({
    asset_id: '',
    type: 'corrective',
    title: '',
    description: '',
    priority: 'normal',
    assigned_to: '',
    due_date: '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  function set(field: string, value: string) {
    setForm(prev => ({ ...prev, [field]: value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.title.trim()) { setError('Title is required.'); return; }
    setSaving(true);
    setError('');
    try {
      const payload: Record<string, string> = {
        type: form.type,
        title: form.title.trim(),
        description: form.description.trim(),
        priority: form.priority,
        assigned_to: form.assigned_to.trim(),
      };
      if (form.asset_id) payload.asset_id = form.asset_id;
      if (form.due_date) payload.due_date = form.due_date;
      await api.createMaintenanceWO(payload);
      onCreated();
      onClose();
    } catch (err: any) {
      setError(err.message || 'Failed to create work order.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="bg-gray-900 rounded-2xl shadow-2xl w-full max-w-lg flex flex-col max-h-[90vh]">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-800">
          <h2 className="text-white font-semibold text-base">New Work Order</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-white transition-colors">
            <X size={18} />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="overflow-y-auto flex-1 px-6 py-4 space-y-4">
          {error && (
            <div className="bg-red-500/10 border border-red-500/30 text-red-400 text-sm rounded-lg px-3 py-2">
              {error}
            </div>
          )}
          <div>
            <label className="text-xs font-medium text-gray-400 block mb-1">Asset (optional)</label>
            <select
              value={form.asset_id}
              onChange={e => set('asset_id', e.target.value)}
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
            >
              <option value="">— No asset —</option>
              {assets.map(a => (
                <option key={a.id} value={a.id}>{a.asset_number} — {a.name}</option>
              ))}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-gray-400 block mb-1">Type</label>
              <select
                value={form.type}
                onChange={e => set('type', e.target.value)}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
              >
                <option value="corrective">Corrective</option>
                <option value="pm">Preventive (PM)</option>
                <option value="emergency">Emergency</option>
                <option value="inspection">Inspection</option>
              </select>
            </div>
            <div>
              <label className="text-xs font-medium text-gray-400 block mb-1">Priority</label>
              <select
                value={form.priority}
                onChange={e => set('priority', e.target.value)}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
              >
                <option value="low">Low</option>
                <option value="normal">Normal</option>
                <option value="high">High</option>
                <option value="critical">Critical</option>
              </select>
            </div>
          </div>
          <div>
            <label className="text-xs font-medium text-gray-400 block mb-1">Title *</label>
            <input
              type="text"
              value={form.title}
              onChange={e => set('title', e.target.value)}
              placeholder="e.g. Replace conveyor belt"
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
            />
          </div>
          <div>
            <label className="text-xs font-medium text-gray-400 block mb-1">Description</label>
            <textarea
              value={form.description}
              onChange={e => set('description', e.target.value)}
              rows={3}
              placeholder="Describe the work to be done..."
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm resize-none"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-gray-400 block mb-1">Assigned To</label>
              <input
                type="text"
                value={form.assigned_to}
                onChange={e => set('assigned_to', e.target.value)}
                placeholder="Technician name"
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-400 block mb-1">Due Date</label>
              <input
                type="date"
                value={form.due_date}
                onChange={e => set('due_date', e.target.value)}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
              />
            </div>
          </div>
        </form>
        <div className="px-6 py-4 border-t border-gray-800 flex justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            className="inline-flex items-center gap-2 px-4 py-2 bg-gray-800 text-gray-200 border border-gray-700 rounded-lg text-sm font-medium hover:bg-gray-700 transition-colors"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={saving}
            onClick={handleSubmit as any}
            className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors disabled:opacity-50"
          >
            {saving ? 'Creating…' : 'Create WO'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Create Asset Modal ────────────────────────────────────────────────────────

interface CreateAssetModalProps {
  departments: Department[];
  onClose: () => void;
  onCreated: () => void;
}

function CreateAssetModal({ departments, onClose, onCreated }: CreateAssetModalProps) {
  const [form, setForm] = useState({
    asset_number: '',
    name: '',
    type: 'Machine',
    make: '',
    model: '',
    serial_number: '',
    department_id: '',
    location: '',
    install_date: '',
    notes: '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  function set(field: string, value: string) {
    setForm(prev => ({ ...prev, [field]: value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) { setError('Name is required.'); return; }
    if (!form.asset_number.trim()) { setError('Asset number is required.'); return; }
    setSaving(true);
    setError('');
    try {
      const payload: Record<string, string> = {
        asset_number: form.asset_number.trim(),
        name: form.name.trim(),
        type: form.type,
        make: form.make.trim(),
        model: form.model.trim(),
        serial_number: form.serial_number.trim(),
        location: form.location.trim(),
        notes: form.notes.trim(),
        status: 'active',
      };
      if (form.department_id) payload.department_id = form.department_id;
      if (form.install_date) payload.install_date = form.install_date;
      await api.createAsset(payload);
      onCreated();
      onClose();
    } catch (err: any) {
      setError(err.message || 'Failed to create asset.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="bg-gray-900 rounded-2xl shadow-2xl w-full max-w-lg flex flex-col max-h-[90vh]">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-800">
          <h2 className="text-white font-semibold text-base">New Asset</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-white transition-colors">
            <X size={18} />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="overflow-y-auto flex-1 px-6 py-4 space-y-4">
          {error && (
            <div className="bg-red-500/10 border border-red-500/30 text-red-400 text-sm rounded-lg px-3 py-2">
              {error}
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-gray-400 block mb-1">Asset Number *</label>
              <input
                type="text"
                value={form.asset_number}
                onChange={e => set('asset_number', e.target.value)}
                placeholder="e.g. AST-001"
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-400 block mb-1">Type</label>
              <select
                value={form.type}
                onChange={e => set('type', e.target.value)}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
              >
                <option>Machine</option>
                <option>Tool</option>
                <option>Vehicle</option>
                <option>Facility</option>
                <option>Instrument</option>
              </select>
            </div>
          </div>
          <div>
            <label className="text-xs font-medium text-gray-400 block mb-1">Name *</label>
            <input
              type="text"
              value={form.name}
              onChange={e => set('name', e.target.value)}
              placeholder="e.g. CNC Mill #3"
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-gray-400 block mb-1">Make</label>
              <input
                type="text"
                value={form.make}
                onChange={e => set('make', e.target.value)}
                placeholder="e.g. Haas"
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-400 block mb-1">Model</label>
              <input
                type="text"
                value={form.model}
                onChange={e => set('model', e.target.value)}
                placeholder="e.g. VF-2SS"
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
              />
            </div>
          </div>
          <div>
            <label className="text-xs font-medium text-gray-400 block mb-1">Serial Number</label>
            <input
              type="text"
              value={form.serial_number}
              onChange={e => set('serial_number', e.target.value)}
              placeholder="e.g. SN-20240001"
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-gray-400 block mb-1">Department</label>
              <select
                value={form.department_id}
                onChange={e => set('department_id', e.target.value)}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
              >
                <option value="">— None —</option>
                {departments.map(d => (
                  <option key={d.id} value={d.id}>{d.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs font-medium text-gray-400 block mb-1">Location</label>
              <input
                type="text"
                value={form.location}
                onChange={e => set('location', e.target.value)}
                placeholder="e.g. Bay 4, Line 2"
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
              />
            </div>
          </div>
          <div>
            <label className="text-xs font-medium text-gray-400 block mb-1">Install Date</label>
            <input
              type="date"
              value={form.install_date}
              onChange={e => set('install_date', e.target.value)}
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
            />
          </div>
          <div>
            <label className="text-xs font-medium text-gray-400 block mb-1">Notes</label>
            <textarea
              value={form.notes}
              onChange={e => set('notes', e.target.value)}
              rows={2}
              placeholder="Any additional notes..."
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm resize-none"
            />
          </div>
        </form>
        <div className="px-6 py-4 border-t border-gray-800 flex justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            className="inline-flex items-center gap-2 px-4 py-2 bg-gray-800 text-gray-200 border border-gray-700 rounded-lg text-sm font-medium hover:bg-gray-700 transition-colors"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={saving}
            onClick={handleSubmit as any}
            className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors disabled:opacity-50"
          >
            {saving ? 'Creating…' : 'Create Asset'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Create PM Schedule Modal ──────────────────────────────────────────────────

interface CreatePMModalProps {
  assets: Asset[];
  onClose: () => void;
  onCreated: () => void;
}

function CreatePMModal({ assets, onClose, onCreated }: CreatePMModalProps) {
  const [form, setForm] = useState({
    asset_id: '',
    title: '',
    frequency_type: 'monthly',
    frequency_value: '1',
    assigned_to: '',
    estimated_hours: '1',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  function set(field: string, value: string) {
    setForm(prev => ({ ...prev, [field]: value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.asset_id) { setError('Asset is required.'); return; }
    if (!form.title.trim()) { setError('Title is required.'); return; }
    setSaving(true);
    setError('');
    try {
      await api.createPMSchedule({
        asset_id: form.asset_id,
        title: form.title.trim(),
        frequency_type: form.frequency_type,
        frequency_value: Number(form.frequency_value) || 1,
        assigned_to: form.assigned_to.trim(),
        estimated_hours: Number(form.estimated_hours) || 1,
      });
      onCreated();
      onClose();
    } catch (err: any) {
      setError(err.message || 'Failed to create PM schedule.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="bg-gray-900 rounded-2xl shadow-2xl w-full max-w-lg flex flex-col max-h-[90vh]">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-800">
          <h2 className="text-white font-semibold text-base">Add PM Schedule</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-white transition-colors">
            <X size={18} />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="overflow-y-auto flex-1 px-6 py-4 space-y-4">
          {error && (
            <div className="bg-red-500/10 border border-red-500/30 text-red-400 text-sm rounded-lg px-3 py-2">
              {error}
            </div>
          )}
          <div>
            <label className="text-xs font-medium text-gray-400 block mb-1">Asset *</label>
            <select
              value={form.asset_id}
              onChange={e => set('asset_id', e.target.value)}
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
            >
              <option value="">— Select asset —</option>
              {assets.map(a => (
                <option key={a.id} value={a.id}>{a.asset_number} — {a.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-xs font-medium text-gray-400 block mb-1">Title *</label>
            <input
              type="text"
              value={form.title}
              onChange={e => set('title', e.target.value)}
              placeholder="e.g. Lubrication & filter check"
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-gray-400 block mb-1">Frequency Type</label>
              <select
                value={form.frequency_type}
                onChange={e => set('frequency_type', e.target.value)}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
              >
                <option value="daily">Daily</option>
                <option value="weekly">Weekly</option>
                <option value="monthly">Monthly</option>
                <option value="quarterly">Quarterly</option>
                <option value="yearly">Yearly</option>
              </select>
            </div>
            <div>
              <label className="text-xs font-medium text-gray-400 block mb-1">Every N</label>
              <input
                type="number"
                min="1"
                value={form.frequency_value}
                onChange={e => set('frequency_value', e.target.value)}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-gray-400 block mb-1">Assigned To</label>
              <input
                type="text"
                value={form.assigned_to}
                onChange={e => set('assigned_to', e.target.value)}
                placeholder="Technician name"
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-400 block mb-1">Est. Hours</label>
              <input
                type="number"
                min="0.5"
                step="0.5"
                value={form.estimated_hours}
                onChange={e => set('estimated_hours', e.target.value)}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
              />
            </div>
          </div>
        </form>
        <div className="px-6 py-4 border-t border-gray-800 flex justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            className="inline-flex items-center gap-2 px-4 py-2 bg-gray-800 text-gray-200 border border-gray-700 rounded-lg text-sm font-medium hover:bg-gray-700 transition-colors"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={saving}
            onClick={handleSubmit as any}
            className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Save Schedule'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Overview Tab ──────────────────────────────────────────────────────────────

interface OverviewTabProps {
  summary: MaintenanceSummary | null;
  summaryLoading: boolean;
  overduePMs: PMSchedule[];
  pmsLoading: boolean;
  openWOs: MaintenanceWO[];
  wosLoading: boolean;
}

function OverviewTab({ summary, summaryLoading, overduePMs, pmsLoading, openWOs, wosLoading }: OverviewTabProps) {
  return (
    <div className="space-y-6">
      {/* Stat cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        {summaryLoading ? (
          [...Array(5)].map((_, i) => <SkeletonCard key={i} />)
        ) : (
          <>
            <StatCard
              label="Open Work Orders"
              value={summary?.open_wos ?? 0}
              icon={<ClipboardList size={20} />}
              accent="text-blue-400"
            />
            <StatCard
              label="Overdue PMs"
              value={summary?.overdue_pms ?? 0}
              icon={<AlertTriangle size={20} />}
              accent="text-red-400"
            />
            <StatCard
              label="Total Assets"
              value={summary?.assets_count ?? 0}
              icon={<Cpu size={20} />}
              accent="text-purple-400"
            />
            <StatCard
              label="Critical WOs"
              value={summary?.critical_wos ?? 0}
              icon={<AlertCircle size={20} />}
              accent="text-amber-400"
            />
            <StatCard
              label="Completed Today"
              value={summary?.completed_today ?? 0}
              icon={<CheckCircle2 size={20} />}
              accent="text-green-400"
            />
          </>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Overdue / Due Soon PMs */}
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
          <div className="flex items-center gap-2 mb-4">
            <AlertTriangle size={16} className="text-red-400" />
            <h3 className="text-white font-semibold text-sm">Overdue / Due Soon PMs</h3>
          </div>
          {pmsLoading ? (
            <div className="space-y-2">
              {[...Array(3)].map((_, i) => <SkeletonRow key={i} />)}
            </div>
          ) : overduePMs.length === 0 ? (
            <EmptyState
              icon={<CheckCircle2 size={36} />}
              title="No overdue PMs"
              sub="All preventive maintenance schedules are on track."
            />
          ) : (
            <div className="space-y-2">
              {overduePMs.map(pm => {
                const overdue = isOverdue(pm.next_due_at);
                return (
                  <div key={pm.id} className="flex items-start justify-between gap-3 p-3 bg-gray-800/60 rounded-lg border border-gray-700/50">
                    <div className="min-w-0">
                      <div className="text-sm font-medium text-white truncate">{pm.title}</div>
                      <div className="text-xs text-gray-400 mt-0.5">{pm.asset_name || '—'}</div>
                      {pm.assigned_to && (
                        <div className="flex items-center gap-1 text-xs text-gray-500 mt-0.5">
                          <User size={10} />
                          {pm.assigned_to}
                        </div>
                      )}
                    </div>
                    <div className="shrink-0 text-right">
                      <div className={`text-xs font-medium ${overdue ? 'text-red-400' : 'text-amber-400'}`}>
                        {pm.next_due_at ? formatDate(pm.next_due_at) : '—'}
                      </div>
                      {overdue && (
                        <div className="text-xs text-red-500 mt-0.5">Overdue</div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Open Work Orders */}
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
          <div className="flex items-center gap-2 mb-4">
            <Wrench size={16} className="text-blue-400" />
            <h3 className="text-white font-semibold text-sm">Open Work Orders</h3>
          </div>
          {wosLoading ? (
            <div className="space-y-2">
              {[...Array(3)].map((_, i) => <SkeletonRow key={i} />)}
            </div>
          ) : openWOs.length === 0 ? (
            <EmptyState
              icon={<CheckCircle2 size={36} />}
              title="No open work orders"
              sub="All work orders are resolved or completed."
            />
          ) : (
            <div className="space-y-2">
              {openWOs.slice(0, 5).map(wo => (
                <div key={wo.id} className="flex items-start justify-between gap-3 p-3 bg-gray-800/60 rounded-lg border border-gray-700/50">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-xs font-mono text-gray-500">{wo.wo_number}</span>
                      <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${priorityColor(wo.priority)}`}>
                        {capitalize(wo.priority)}
                      </span>
                    </div>
                    <div className="text-sm font-medium text-white mt-0.5 truncate">{wo.title}</div>
                    {wo.asset_name && (
                      <div className="text-xs text-gray-400 mt-0.5">{wo.asset_name}</div>
                    )}
                  </div>
                  <div className="shrink-0">
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${statusColor(wo.status)}`}>
                      {capitalize(wo.status)}
                    </span>
                    {wo.due_date && (
                      <div className={`text-xs mt-1 text-right ${isOverdue(wo.due_date) ? 'text-red-400' : 'text-gray-500'}`}>
                        {formatDate(wo.due_date)}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Work Orders Tab ───────────────────────────────────────────────────────────

interface WorkOrdersTabProps {
  wos: MaintenanceWO[];
  loading: boolean;
  onRefresh: () => void;
  onNewWO: () => void;
}

function WorkOrdersTab({ wos, loading, onRefresh, onNewWO }: WorkOrdersTabProps) {
  const [statusFilter, setStatusFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [priorityFilter, setPriorityFilter] = useState('');
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const filtered = wos.filter(wo => {
    if (statusFilter && wo.status !== statusFilter) return false;
    if (typeFilter && wo.type !== typeFilter) return false;
    if (priorityFilter && wo.priority !== priorityFilter) return false;
    return true;
  });

  async function handleStatusChange(id: string, newStatus: string) {
    setUpdatingId(id);
    try {
      await api.updateMaintenanceWO(id, { status: newStatus });
      onRefresh();
    } catch {
      // ignore
    } finally {
      setUpdatingId(null);
    }
  }

  async function handleDelete(id: string) {
    setDeletingId(id);
    try {
      await api.deleteMaintenanceWO(id);
      onRefresh();
    } catch {
      // ignore
    } finally {
      setDeletingId(null);
      setConfirmDelete(null);
    }
  }

  const selectCls = "bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm";

  return (
    <div className="space-y-4">
      {/* Filter bar */}
      <div className="flex flex-wrap items-center gap-3">
        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} className={selectCls}>
          <option value="">All Statuses</option>
          <option value="open">Open</option>
          <option value="in_progress">In Progress</option>
          <option value="on_hold">On Hold</option>
          <option value="complete">Complete</option>
          <option value="cancelled">Cancelled</option>
        </select>
        <select value={typeFilter} onChange={e => setTypeFilter(e.target.value)} className={selectCls}>
          <option value="">All Types</option>
          <option value="pm">Preventive</option>
          <option value="corrective">Corrective</option>
          <option value="emergency">Emergency</option>
          <option value="inspection">Inspection</option>
        </select>
        <select value={priorityFilter} onChange={e => setPriorityFilter(e.target.value)} className={selectCls}>
          <option value="">All Priorities</option>
          <option value="low">Low</option>
          <option value="normal">Normal</option>
          <option value="high">High</option>
          <option value="critical">Critical</option>
        </select>
        <div className="flex-1" />
        <button
          onClick={onNewWO}
          className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors"
        >
          <Plus size={15} /> New WO
        </button>
      </div>

      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          {[...Array(6)].map((_, i) => <SkeletonCard key={i} />)}
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={<ClipboardList size={40} />}
          title="No work orders found"
          sub="Adjust filters or create a new work order."
        />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          {filtered.map(wo => (
            <div key={wo.id} className="bg-gray-900 border border-gray-800 rounded-xl p-4 flex flex-col gap-3 hover:border-gray-700 transition-colors">
              {/* Header row */}
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap mb-1">
                    <span className="text-xs font-mono text-gray-500">{wo.wo_number}</span>
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${woTypeColor(wo.type)}`}>
                      {woTypeLabel(wo.type)}
                    </span>
                  </div>
                  <div className="text-sm font-semibold text-white leading-snug">{wo.title}</div>
                  {wo.asset_name && (
                    <div className="flex items-center gap-1 text-xs text-gray-400 mt-1">
                      <Cpu size={10} /> {wo.asset_name}
                    </div>
                  )}
                </div>
                <button
                  onClick={() => setConfirmDelete(confirmDelete === wo.id ? null : wo.id)}
                  className="text-gray-600 hover:text-red-400 transition-colors shrink-0 mt-0.5"
                >
                  <Trash2 size={14} />
                </button>
              </div>

              {/* Badges */}
              <div className="flex flex-wrap gap-2">
                <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${priorityColor(wo.priority)}`}>
                  {capitalize(wo.priority)}
                </span>
                <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${statusColor(wo.status)}`}>
                  {capitalize(wo.status)}
                </span>
              </div>

              {/* Meta */}
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-500">
                {wo.assigned_to && (
                  <span className="flex items-center gap-1"><User size={10} /> {wo.assigned_to}</span>
                )}
                {wo.due_date && (
                  <span className={`flex items-center gap-1 ${isOverdue(wo.due_date) && wo.status !== 'complete' && wo.status !== 'cancelled' ? 'text-red-400' : ''}`}>
                    <Calendar size={10} /> {formatDate(wo.due_date)}
                  </span>
                )}
              </div>

              {/* Inline status update */}
              <div className="flex items-center gap-2">
                <ChevronDown size={12} className="text-gray-500 shrink-0" />
                <select
                  value={wo.status}
                  disabled={updatingId === wo.id}
                  onChange={e => handleStatusChange(wo.id, e.target.value)}
                  className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-2 py-1.5 text-white focus:outline-none focus:ring-2 focus:ring-blue-500 text-xs disabled:opacity-50"
                >
                  <option value="open">Open</option>
                  <option value="in_progress">In Progress</option>
                  <option value="on_hold">On Hold</option>
                  <option value="complete">Complete</option>
                  <option value="cancelled">Cancelled</option>
                </select>
                {updatingId === wo.id && <RefreshCw size={12} className="animate-spin text-blue-400" />}
              </div>

              {/* Delete confirm */}
              {confirmDelete === wo.id && (
                <div className="bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2 flex items-center justify-between gap-2">
                  <span className="text-xs text-red-400">Delete this WO?</span>
                  <div className="flex gap-2">
                    <button
                      onClick={() => setConfirmDelete(null)}
                      className="text-xs text-gray-400 hover:text-white transition-colors"
                    >
                      No
                    </button>
                    <button
                      onClick={() => handleDelete(wo.id)}
                      disabled={deletingId === wo.id}
                      className="text-xs text-red-400 hover:text-red-300 font-medium transition-colors disabled:opacity-50"
                    >
                      {deletingId === wo.id ? 'Deleting…' : 'Yes, delete'}
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Assets Tab ────────────────────────────────────────────────────────────────

interface AssetsTabProps {
  assets: Asset[];
  departments: Department[];
  loading: boolean;
  onRefresh: () => void;
  onNewAsset: () => void;
}

function AssetsTab({ assets, departments, loading, onRefresh, onNewAsset }: AssetsTabProps) {
  const [search, setSearch] = useState('');
  const [deptFilter, setDeptFilter] = useState('');
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const filtered = assets.filter(a => {
    if (deptFilter && a.department_id !== deptFilter) return false;
    if (search) {
      const q = search.toLowerCase();
      return (
        a.name.toLowerCase().includes(q) ||
        a.asset_number.toLowerCase().includes(q) ||
        a.type.toLowerCase().includes(q) ||
        a.location.toLowerCase().includes(q) ||
        (a.make || '').toLowerCase().includes(q) ||
        (a.model || '').toLowerCase().includes(q)
      );
    }
    return true;
  });

  async function handleDelete(id: string) {
    setDeletingId(id);
    try {
      await api.deleteAsset(id);
      onRefresh();
    } catch {
      // ignore
    } finally {
      setDeletingId(null);
      setConfirmDelete(null);
    }
  }

  return (
    <div className="space-y-4">
      {/* Search + filter bar */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[180px] max-w-xs">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search assets…"
            className="w-full bg-gray-800 border border-gray-700 rounded-lg pl-8 pr-3 py-2 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
          />
        </div>
        <select
          value={deptFilter}
          onChange={e => setDeptFilter(e.target.value)}
          className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
        >
          <option value="">All Departments</option>
          {departments.map(d => (
            <option key={d.id} value={d.id}>{d.name}</option>
          ))}
        </select>
        <div className="flex-1" />
        <button
          onClick={onNewAsset}
          className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors"
        >
          <Plus size={15} /> New Asset
        </button>
      </div>

      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
          {[...Array(8)].map((_, i) => <SkeletonCard key={i} />)}
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={<Cpu size={40} />}
          title="No assets found"
          sub={search || deptFilter ? 'Try adjusting your filters.' : 'Add your first asset to get started.'}
        />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
          {filtered.map(asset => (
            <div key={asset.id} className="bg-gray-900 border border-gray-800 rounded-xl p-4 flex flex-col gap-3 hover:border-gray-700 transition-colors">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <div className="text-xs font-mono text-gray-500 mb-0.5">{asset.asset_number}</div>
                  <div className="text-sm font-semibold text-white leading-snug truncate">{asset.name}</div>
                  <div className="text-xs text-gray-400 mt-0.5">{asset.type}</div>
                </div>
                <span className={`rounded-full px-2 py-0.5 text-xs font-medium shrink-0 ${assetStatusColor(asset.status)}`}>
                  {capitalize(asset.status)}
                </span>
              </div>

              <div className="space-y-1">
                {(asset.make || asset.model) && (
                  <div className="flex items-center gap-1 text-xs text-gray-400">
                    <Settings size={10} className="shrink-0" />
                    {[asset.make, asset.model].filter(Boolean).join(' / ')}
                  </div>
                )}
                {asset.location && (
                  <div className="flex items-center gap-1 text-xs text-gray-400">
                    <MapPin size={10} className="shrink-0" />
                    {asset.location}
                  </div>
                )}
                {asset.department_name && (
                  <div className="flex items-center gap-1 text-xs text-gray-400">
                    <BarChart3 size={10} className="shrink-0" />
                    {asset.department_name}
                  </div>
                )}
                {asset.install_date && (
                  <div className="flex items-center gap-1 text-xs text-gray-500">
                    <Calendar size={10} className="shrink-0" />
                    Installed {formatDate(asset.install_date)}
                  </div>
                )}
              </div>

              {/* Delete */}
              {confirmDelete === asset.id ? (
                <div className="bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2 flex items-center justify-between gap-2">
                  <span className="text-xs text-red-400">Delete asset?</span>
                  <div className="flex gap-2">
                    <button
                      onClick={() => setConfirmDelete(null)}
                      className="text-xs text-gray-400 hover:text-white transition-colors"
                    >
                      No
                    </button>
                    <button
                      onClick={() => handleDelete(asset.id)}
                      disabled={deletingId === asset.id}
                      className="text-xs text-red-400 hover:text-red-300 font-medium transition-colors disabled:opacity-50"
                    >
                      {deletingId === asset.id ? 'Deleting…' : 'Yes, delete'}
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  onClick={() => setConfirmDelete(asset.id)}
                  className="flex items-center gap-1.5 text-xs text-gray-600 hover:text-red-400 transition-colors self-start"
                >
                  <Trash2 size={12} /> Delete
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── PM Schedules Tab ──────────────────────────────────────────────────────────

interface PMSchedulesTabProps {
  pms: PMSchedule[];
  loading: boolean;
  onRefresh: () => void;
  onNewPM: () => void;
}

function PMSchedulesTab({ pms, loading, onRefresh, onNewPM }: PMSchedulesTabProps) {
  const [completingId, setCompletingId] = useState<string | null>(null);

  async function handleComplete(id: string) {
    setCompletingId(id);
    try {
      await api.completePMSchedule(id);
      onRefresh();
    } catch {
      // ignore
    } finally {
      setCompletingId(null);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <span className="text-sm text-gray-400">{pms.length} schedule{pms.length !== 1 ? 's' : ''}</span>
        <button
          onClick={onNewPM}
          className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors"
        >
          <Plus size={15} /> Add PM Schedule
        </button>
      </div>

      {loading ? (
        <div className="space-y-2">
          {[...Array(5)].map((_, i) => <SkeletonRow key={i} />)}
        </div>
      ) : pms.length === 0 ? (
        <EmptyState
          icon={<Clock size={40} />}
          title="No PM schedules"
          sub="Add a preventive maintenance schedule to keep assets running."
        />
      ) : (
        <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm whitespace-nowrap">
              <thead>
                <tr className="border-b border-gray-800 bg-gray-800/40">
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Asset</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Title</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Frequency</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Next Due</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Last Done</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Assigned To</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Est. Hrs</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-800">
                {pms.map(pm => {
                  const overdue = isOverdue(pm.next_due_at);
                  return (
                    <tr key={pm.id} className="hover:bg-gray-800/30 transition-colors">
                      <td className="px-4 py-3 text-gray-300">{pm.asset_name || '—'}</td>
                      <td className="px-4 py-3 text-white font-medium max-w-[200px] truncate">{pm.title}</td>
                      <td className="px-4 py-3 text-gray-400">
                        Every {pm.frequency_value} {capitalize(pm.frequency_type)}
                        {pm.frequency_value !== 1 ? 's' : ''}
                      </td>
                      <td className="px-4 py-3">
                        {pm.next_due_at ? (
                          <div className="flex items-center gap-2">
                            <span className={overdue ? 'text-red-400 font-medium' : 'text-gray-300'}>
                              {formatDate(pm.next_due_at)}
                            </span>
                            {overdue && (
                              <span className="rounded-full px-2 py-0.5 text-xs font-medium bg-red-500/20 text-red-400 border border-red-500/30">
                                Overdue
                              </span>
                            )}
                          </div>
                        ) : '—'}
                      </td>
                      <td className="px-4 py-3 text-gray-400">{formatDate(pm.last_completed_at)}</td>
                      <td className="px-4 py-3 text-gray-400">{pm.assigned_to || '—'}</td>
                      <td className="px-4 py-3 text-gray-400">{pm.estimated_hours}h</td>
                      <td className="px-4 py-3">
                        <button
                          onClick={() => handleComplete(pm.id)}
                          disabled={completingId === pm.id}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-green-600/20 text-green-400 border border-green-500/30 rounded-lg text-xs font-medium hover:bg-green-600/30 transition-colors disabled:opacity-50"
                        >
                          {completingId === pm.id ? (
                            <RefreshCw size={11} className="animate-spin" />
                          ) : (
                            <CheckCircle2 size={11} />
                          )}
                          {completingId === pm.id ? 'Saving…' : 'Mark Complete'}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────

export default function Maintenance() {
  const [activeTab, setActiveTab] = useState<TabKey>('overview');

  // Data
  const [summary, setSummary] = useState<MaintenanceSummary | null>(null);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [wos, setWOs] = useState<MaintenanceWO[]>([]);
  const [pms, setPMs] = useState<PMSchedule[]>([]);
  const [overduePMs, setOverduePMs] = useState<PMSchedule[]>([]);
  const [openWOs, setOpenWOs] = useState<MaintenanceWO[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);

  // Loading states
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [assetsLoading, setAssetsLoading] = useState(false);
  const [wosLoading, setWOsLoading] = useState(false);
  const [pmsLoading, setPMsLoading] = useState(false);
  const [overviewPMsLoading, setOverviewPMsLoading] = useState(false);
  const [overviewWOsLoading, setOverviewWOsLoading] = useState(false);

  // Modals
  const [showCreateWO, setShowCreateWO] = useState(false);
  const [showCreateAsset, setShowCreateAsset] = useState(false);
  const [showCreatePM, setShowCreatePM] = useState(false);

  // Error
  const [error, setError] = useState('');

  // Load departments once
  useEffect(() => {
    api.getDepartments().then(data => setDepartments(data as Department[])).catch(() => {});
  }, []);

  // Load summary + overview data
  const loadOverview = useCallback(async () => {
    setSummaryLoading(true);
    setOverviewPMsLoading(true);
    setOverviewWOsLoading(true);
    setError('');
    try {
      const [sum, pmsData, wosData] = await Promise.all([
        api.getMaintenanceSummary(),
        api.getPMSchedules({ overdue: true }),
        api.getMaintenanceWOs({ status: 'open' }),
      ]);
      setSummary(sum as MaintenanceSummary);
      setOverduePMs(pmsData as PMSchedule[]);
      setOpenWOs(wosData as MaintenanceWO[]);
    } catch (err: any) {
      setError(err.message || 'Failed to load overview data.');
    } finally {
      setSummaryLoading(false);
      setOverviewPMsLoading(false);
      setOverviewWOsLoading(false);
    }
  }, []);

  const loadWOs = useCallback(async () => {
    setWOsLoading(true);
    setError('');
    try {
      const data = await api.getMaintenanceWOs();
      setWOs(data as MaintenanceWO[]);
    } catch (err: any) {
      setError(err.message || 'Failed to load work orders.');
    } finally {
      setWOsLoading(false);
    }
  }, []);

  const loadAssets = useCallback(async () => {
    setAssetsLoading(true);
    setError('');
    try {
      const data = await api.getAssets();
      setAssets(data as Asset[]);
    } catch (err: any) {
      setError(err.message || 'Failed to load assets.');
    } finally {
      setAssetsLoading(false);
    }
  }, []);

  const loadPMs = useCallback(async () => {
    setPMsLoading(true);
    setError('');
    try {
      const data = await api.getPMSchedules();
      setPMs(data as PMSchedule[]);
    } catch (err: any) {
      setError(err.message || 'Failed to load PM schedules.');
    } finally {
      setPMsLoading(false);
    }
  }, []);

  // Load data when tab changes
  useEffect(() => {
    if (activeTab === 'overview') {
      loadOverview();
      // Also preload assets for modals
      if (assets.length === 0) loadAssets();
    } else if (activeTab === 'work_orders') {
      loadWOs();
      if (assets.length === 0) loadAssets();
    } else if (activeTab === 'assets') {
      loadAssets();
    } else if (activeTab === 'pm_schedules') {
      loadPMs();
      if (assets.length === 0) loadAssets();
    }
  }, [activeTab]); // eslint-disable-line react-hooks/exhaustive-deps

  const tabs: { key: TabKey; label: string; icon: React.ReactNode }[] = [
    { key: 'overview',     label: 'Overview',      icon: <BarChart3 size={15} /> },
    { key: 'work_orders',  label: 'Work Orders',   icon: <ClipboardList size={15} /> },
    { key: 'assets',       label: 'Assets',        icon: <Cpu size={15} /> },
    { key: 'pm_schedules', label: 'PM Schedules',  icon: <Clock size={15} /> },
  ];

  return (
    <div className="min-h-full bg-gray-950 p-6 space-y-5">
      {/* Page header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <Wrench size={22} className="text-blue-400" />
            <h1 className="text-2xl font-bold text-white">Maintenance</h1>
          </div>
          <p className="text-sm text-gray-400">CMMS — Assets, work orders, and preventive maintenance schedules</p>
        </div>
        <button
          onClick={() => {
            if (activeTab === 'overview') loadOverview();
            else if (activeTab === 'work_orders') loadWOs();
            else if (activeTab === 'assets') loadAssets();
            else if (activeTab === 'pm_schedules') loadPMs();
          }}
          className="inline-flex items-center gap-2 px-4 py-2 bg-gray-800 text-gray-200 border border-gray-700 rounded-lg text-sm font-medium hover:bg-gray-700 transition-colors"
        >
          <RefreshCw size={14} /> Refresh
        </button>
      </div>

      {/* Error banner */}
      {error && (
        <div className="bg-red-500/10 border border-red-500/30 text-red-400 text-sm rounded-xl px-4 py-3 flex items-center gap-2">
          <AlertCircle size={15} />
          {error}
          <button onClick={() => setError('')} className="ml-auto text-red-500 hover:text-red-300 transition-colors">
            <X size={14} />
          </button>
        </div>
      )}

      {/* Tab bar */}
      <div className="border-b border-gray-800">
        <nav className="-mb-px flex gap-1">
          {tabs.map(tab => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`inline-flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium transition-colors border-b-2 ${
                activeTab === tab.key
                  ? 'border-blue-500 text-white'
                  : 'border-transparent text-gray-400 hover:text-gray-200'
              }`}
            >
              {tab.icon}
              {tab.label}
            </button>
          ))}
        </nav>
      </div>

      {/* Tab content */}
      {activeTab === 'overview' && (
        <OverviewTab
          summary={summary}
          summaryLoading={summaryLoading}
          overduePMs={overduePMs}
          pmsLoading={overviewPMsLoading}
          openWOs={openWOs}
          wosLoading={overviewWOsLoading}
        />
      )}

      {activeTab === 'work_orders' && (
        <WorkOrdersTab
          wos={wos}
          loading={wosLoading}
          onRefresh={loadWOs}
          onNewWO={() => setShowCreateWO(true)}
        />
      )}

      {activeTab === 'assets' && (
        <AssetsTab
          assets={assets}
          departments={departments}
          loading={assetsLoading}
          onRefresh={loadAssets}
          onNewAsset={() => setShowCreateAsset(true)}
        />
      )}

      {activeTab === 'pm_schedules' && (
        <PMSchedulesTab
          pms={pms}
          loading={pmsLoading}
          onRefresh={loadPMs}
          onNewPM={() => setShowCreatePM(true)}
        />
      )}

      {/* Modals */}
      {showCreateWO && (
        <CreateWOModal
          assets={assets}
          onClose={() => setShowCreateWO(false)}
          onCreated={() => {
            if (activeTab === 'work_orders') loadWOs();
            else loadOverview();
          }}
        />
      )}

      {showCreateAsset && (
        <CreateAssetModal
          departments={departments}
          onClose={() => setShowCreateAsset(false)}
          onCreated={loadAssets}
        />
      )}

      {showCreatePM && (
        <CreatePMModal
          assets={assets}
          onClose={() => setShowCreatePM(false)}
          onCreated={loadPMs}
        />
      )}
    </div>
  );
}

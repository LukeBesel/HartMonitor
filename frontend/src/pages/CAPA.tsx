import { useEffect, useState, useCallback, useMemo } from 'react';
import {
  ClipboardCheck, Plus, Search, X, AlertTriangle, ChevronRight,
  Calendar, User, Loader2, CheckCircle2, Circle, CheckCheck,
  Trash2, Save, AlertCircle,
} from 'lucide-react';
import { api } from '../api/client';
import { useDepartmentFilter } from '../hooks/useDepartmentFilter';
import DepartmentFilter from '../components/shared/DepartmentFilter';
import { timeAgo } from '../utils/time';

// ── Types ─────────────────────────────────────────────────────────────────────

interface CAPA {
  id: string;
  number: string;
  title: string;
  description: string;
  source: 'manual' | 'ncr' | 'audit' | 'andon' | 'customer' | 'supplier';
  type: 'corrective' | 'preventive' | 'both';
  priority: 'low' | 'medium' | 'high' | 'critical';
  status: 'open' | 'root_cause' | 'action' | 'verification' | 'closed';
  department_id?: string;
  department_name?: string;
  owner_id?: string;
  owner_name?: string;
  due_date?: string;
  root_cause_analysis?: string;
  containment_action?: string;
  corrective_action?: string;
  preventive_action?: string;
  verified_at?: string;
  closed_at?: string;
  created_by: string;
  created_at: string;
}

interface CAPADetail extends CAPA {
  actions?: CAPAAction[];
}

interface CAPAAction {
  id: string;
  description: string;
  owner_name: string;
  due_date?: string;
  // Matches the stored vocabulary (a DB CHECK): open / in_progress / done.
  status: 'open' | 'in_progress' | 'done';
  completed_at?: string;
  notes?: string;
}

interface CAPASummary {
  open: number;
  overdue: number;
  by_status: Record<string, number>;
  by_priority: Record<string, number>;
}

/** Just enough of a department to offer it in a picker. */
interface DepartmentChoice {
  id: string;
  name: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatDate(dateStr?: string): string {
  if (!dateStr) return '—';
  return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function isOverdue(capa: CAPA): boolean {
  if (!capa.due_date) return false;
  if (capa.status === 'closed') return false;
  return new Date(capa.due_date) < new Date();
}

// ── Style maps ────────────────────────────────────────────────────────────────

const PRIORITY_BADGE: Record<CAPA['priority'], string> = {
  low:      'bg-gray-100 text-gray-700',
  medium:   'bg-blue-50 text-blue-700 border border-blue-200',
  high:     'bg-amber-50 text-amber-700 border border-amber-200',
  critical: 'bg-red-50 text-red-700 border border-red-200',
};

const STATUS_BADGE: Record<CAPA['status'], string> = {
  open:         'bg-gray-100 text-gray-700',
  root_cause:   'bg-purple-50 text-purple-700 border border-purple-200',
  action:       'bg-blue-50 text-blue-700 border border-blue-200',
  verification: 'bg-amber-50 text-amber-700 border border-amber-200',
  closed:       'bg-emerald-50 text-emerald-700 border border-emerald-200',
};

const STATUS_LABEL: Record<CAPA['status'], string> = {
  open:         'Open',
  root_cause:   'Root Cause',
  action:       'Action',
  verification: 'Verification',
  closed:       'Closed',
};

const SOURCE_BADGE: Record<CAPA['source'], string> = {
  manual:   'bg-gray-100 text-gray-700',
  ncr:      'bg-purple-50 text-purple-700 border border-purple-200',
  audit:    'bg-indigo-50 text-indigo-700 border border-indigo-200',
  andon:    'bg-amber-50 text-amber-700 border border-amber-200',
  customer: 'bg-cyan-50 text-cyan-700 border border-cyan-200',
  supplier: 'bg-amber-50 text-amber-700 border border-amber-200',
};

const TYPE_BADGE: Record<CAPA['type'], string> = {
  corrective: 'bg-blue-50 text-blue-700 border border-blue-200',
  preventive: 'bg-emerald-50 text-emerald-700 border border-emerald-200',
  both:       'bg-cyan-50 text-cyan-700 border border-cyan-200',
};

const ACTION_STATUS_BADGE: Record<CAPAAction['status'], string> = {
  open:        'bg-gray-100 text-gray-700',
  in_progress: 'bg-blue-50 text-blue-700 border border-blue-200',
  done:        'bg-emerald-50 text-emerald-700 border border-emerald-200',
};

const ACTION_STATUS_NEXT: Record<CAPAAction['status'], CAPAAction['status']> = {
  open:        'in_progress',
  in_progress: 'done',
  done:        'open',
};

const STATUS_STEPS: CAPA['status'][] = ['open', 'root_cause', 'action', 'verification', 'closed'];

// ── Dark input styling helper (inline since this is a dark page) ──────────────

const darkInput = 'bg-white border border-gray-300 text-gray-900 placeholder:text-gray-500 rounded-lg px-3 py-2 w-full focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm';
const darkSelect = `${darkInput} appearance-none`;

// ── Status Stepper ────────────────────────────────────────────────────────────

function StatusStepper({ status }: { status: CAPA['status'] }) {
  const currentIdx = STATUS_STEPS.indexOf(status);

  return (
    <div className="flex items-center gap-0 w-full mt-3 mb-1">
      {STATUS_STEPS.map((step, idx) => {
        const done = idx < currentIdx;
        const active = idx === currentIdx;
        const future = idx > currentIdx;
        return (
          <div key={step} className="flex items-center flex-1 min-w-0">
            <div className="flex flex-col items-center shrink-0">
              <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold transition-colors ${
                done
                  ? 'bg-blue-600 text-white'
                  : active
                  ? 'bg-blue-600 text-white ring-4 ring-blue-200'
                  : 'bg-gray-100 text-gray-500'
              }`}>
                {done ? <CheckCheck size={12} /> : idx + 1}
              </div>
              <span className={`text-xs mt-1 whitespace-nowrap font-medium ${
                done ? 'text-blue-700' : active ? 'text-gray-900' : 'text-gray-500'
              }`}>
                {STATUS_LABEL[step]}
              </span>
            </div>
            {idx < STATUS_STEPS.length - 1 && (
              <div className={`flex-1 h-0.5 mx-1 transition-colors ${done ? 'bg-blue-600' : 'bg-gray-100'}`} />
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── New CAPA Modal ────────────────────────────────────────────────────────────

interface NewCAPAModalProps {
  departments: DepartmentChoice[];
  onClose: () => void;
  onCreated: (id: string) => void;
}

function NewCAPAModal({ departments, onClose, onCreated }: NewCAPAModalProps) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [form, setForm] = useState({
    title: '',
    description: '',
    source: 'manual' as CAPA['source'],
    type: 'corrective' as CAPA['type'],
    priority: 'medium' as CAPA['priority'],
    department_id: '',
    owner_name: '',
    due_date: '',
  });

  function set<K extends keyof typeof form>(field: K, value: typeof form[K]) {
    setForm(f => ({ ...f, [field]: value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.title.trim()) { setError('Title is required.'); return; }
    setError('');
    setSubmitting(true);
    try {
      const payload = {
        title: form.title.trim(),
        description: form.description.trim() || undefined,
        source: form.source,
        type: form.type,
        priority: form.priority,
        department_id: form.department_id || undefined,
        owner_name: form.owner_name.trim() || undefined,
        due_date: form.due_date || undefined,
      };
      const created = await api.createCAPAItem(payload);
      onCreated(created.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create CAPA.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-white border border-gray-200 rounded-2xl w-full max-w-xl max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-gray-200">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-blue-50 rounded-lg">
              <ClipboardCheck size={20} className="text-blue-700" />
            </div>
            <h2 className="text-lg font-semibold text-gray-900">New CAPA</h2>
          </div>
          <button onClick={onClose} className="p-2 text-gray-500 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-colors">
            <X size={18} />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-6 space-y-4">
          <div>
            <label className="text-xs font-semibold text-gray-500 block mb-1">Title *</label>
            <input className={darkInput} placeholder="Brief description of the issue" value={form.title}
              onChange={e => set('title', e.target.value)} required />
          </div>

          <div>
            <label className="text-xs font-semibold text-gray-500 block mb-1">Description</label>
            <textarea className={`${darkInput} resize-none`} rows={3} placeholder="Detailed description..."
              value={form.description} onChange={e => set('description', e.target.value)} />
          </div>

          <div className="field-row gap-3">
            <div>
              <label className="text-xs font-semibold text-gray-500 block mb-1">Source *</label>
              <select className={darkSelect} value={form.source} onChange={e => set('source', e.target.value as CAPA['source'])}>
                <option value="manual">Manual</option>
                <option value="ncr">NCR</option>
                <option value="audit">Audit</option>
                <option value="andon">Andon</option>
                <option value="customer">Customer</option>
                <option value="supplier">Supplier</option>
              </select>
            </div>
            <div>
              <label className="text-xs font-semibold text-gray-500 block mb-1">Type *</label>
              <select className={darkSelect} value={form.type} onChange={e => set('type', e.target.value as CAPA['type'])}>
                <option value="corrective">Corrective</option>
                <option value="preventive">Preventive</option>
                <option value="both">Both</option>
              </select>
            </div>
          </div>

          <div className="field-row gap-3">
            <div>
              <label className="text-xs font-semibold text-gray-500 block mb-1">Priority *</label>
              <select className={darkSelect} value={form.priority} onChange={e => set('priority', e.target.value as CAPA['priority'])}>
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
                <option value="critical">Critical</option>
              </select>
            </div>
            <div>
              <label className="text-xs font-semibold text-gray-500 block mb-1">Department</label>
              <select className={darkSelect} value={form.department_id} onChange={e => set('department_id', e.target.value)}>
                <option value="">— None —</option>
                {departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            </div>
          </div>

          <div className="field-row gap-3">
            <div>
              <label className="text-xs font-semibold text-gray-500 block mb-1">Owner Name</label>
              <input className={darkInput} placeholder="Person responsible" value={form.owner_name}
                onChange={e => set('owner_name', e.target.value)} />
            </div>
            <div>
              <label className="text-xs font-semibold text-gray-500 block mb-1">Due Date</label>
              <input type="date" className={darkInput} value={form.due_date} onChange={e => set('due_date', e.target.value)} />
            </div>
          </div>

          {error && (
            <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>
          )}
        </form>

        {/* Footer */}
        <div className="flex gap-3 p-6 border-t border-gray-200">
          <button type="button" onClick={onClose}
            className="flex-1 px-4 py-2 bg-gray-100 hover:bg-gray-100 text-gray-700 font-medium rounded-lg transition-colors">
            Cancel
          </button>
          <button onClick={handleSubmit} disabled={submitting || !form.title.trim()}
            className="flex-1 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold py-2 px-4 rounded-lg flex items-center justify-center gap-2 transition-colors">
            {submitting ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />}
            {submitting ? 'Creating…' : 'Create CAPA'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── CAPA Detail Panel ─────────────────────────────────────────────────────────

interface CAPADetailPanelProps {
  capaId: string;
  onClose: () => void;
  onUpdated: () => void;
}

function CAPADetailPanel({ capaId, onClose, onUpdated }: CAPADetailPanelProps) {
  const [detail, setDetail] = useState<CAPADetail | null>(null);
  const [actions, setActions] = useState<CAPAAction[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Textarea fields (local state mirrors detail fields for editing)
  const [containment, setContainment] = useState('');
  const [rootCause, setRootCause] = useState('');
  const [corrective, setCorrective] = useState('');
  const [preventive, setPreventive] = useState('');
  const [savingField, setSavingField] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  // Action items
  const [showAddAction, setShowAddAction] = useState(false);
  const [newAction, setNewAction] = useState({ description: '', owner_name: '', due_date: '' });
  const [addingAction, setAddingAction] = useState(false);
  const [togglingAction, setTogglingAction] = useState<string | null>(null);

  // Close / delete
  const [closing, setClosing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const loadDetail = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      // GET /capa/:id already returns `actions` inline (same query the
      // /:id/actions endpoint runs), so read them from the detail response
      // rather than making a second round-trip.
      const d = await api.getCAPAItem(capaId);
      setDetail(d);
      setActions(d.actions ?? []);
      setContainment(d.containment_action ?? '');
      setRootCause(d.root_cause_analysis ?? '');
      setCorrective(d.corrective_action ?? '');
      setPreventive(d.preventive_action ?? '');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load CAPA detail.');
    } finally {
      setLoading(false);
    }
  }, [capaId]);

  useEffect(() => { loadDetail(); }, [loadDetail]);

  async function handleBlurSave(field: string, value: string) {
    if (!detail) return;
    const key = field as keyof CAPADetail;
    if (value === (detail[key] ?? '')) return;
    setSavingField(field);
    try {
      await api.updateCAPAItem(capaId, { [field]: value });
      setSaved(field);
      setTimeout(() => setSaved(null), 2000);
      await loadDetail();
      onUpdated();
    } finally {
      setSavingField(null);
    }
  }

  async function handleToggleActionStatus(action: CAPAAction) {
    setTogglingAction(action.id);
    try {
      const next = ACTION_STATUS_NEXT[action.status];
      await api.updateCAPAItemAction(capaId, action.id, { status: next });
      const updated = await api.getCAPAItemActions(capaId);
      setActions(updated);
    } finally {
      setTogglingAction(null);
    }
  }

  async function handleAddAction(e: React.FormEvent) {
    e.preventDefault();
    if (!newAction.description.trim()) return;
    setAddingAction(true);
    try {
      await api.createCAPAItemAction(capaId, {
        description: newAction.description.trim(),
        owner_name: newAction.owner_name.trim() || undefined,
        due_date: newAction.due_date || undefined,
      });
      setNewAction({ description: '', owner_name: '', due_date: '' });
      setShowAddAction(false);
      const updated = await api.getCAPAItemActions(capaId);
      setActions(updated);
    } finally {
      setAddingAction(false);
    }
  }

  async function handleClose() {
    setClosing(true);
    try {
      await api.updateCAPAItem(capaId, { status: 'closed', closed_at: new Date().toISOString() });
      await loadDetail();
      onUpdated();
    } finally {
      setClosing(false);
    }
  }

  async function handleDelete() {
    setDeleting(true);
    try {
      await api.deleteCAPAItem(capaId);
      onClose();
      onUpdated();
    } finally {
      setDeleting(false);
    }
  }

  function FieldSaveIndicator({ field }: { field: string }) {
    if (savingField === field) return <span className="text-blue-700 text-xs ml-1">Saving…</span>;
    if (saved === field) return <span className="text-emerald-700 text-xs ml-1">Saved</span>;
    return null;
  }

  return (
    <div className="fixed inset-y-0 right-0 z-40 w-full max-w-2xl bg-white border-l border-gray-200 flex flex-col shadow-2xl">
      {/* Panel Header */}
      <div className="p-6 border-b border-gray-200 shrink-0">
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <span className="font-mono text-blue-700 text-sm">{detail?.number ?? '...'}</span>
              {detail && isOverdue(detail) && (
                <span className="text-xs font-bold text-red-700 uppercase tracking-wide">Overdue</span>
              )}
            </div>
            <h2 className="text-lg font-bold text-gray-900 leading-snug truncate">
              {detail ? detail.title : 'Loading…'}
            </h2>
          </div>
          <button onClick={onClose} className="p-2 text-gray-500 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-colors shrink-0">
            <X size={18} />
          </button>
        </div>
        {detail && <StatusStepper status={detail.status} />}
      </div>

      {/* Body */}
      {loading ? (
        <div className="flex-1 flex items-center justify-center">
          <Loader2 size={24} className="animate-spin text-blue-700" />
        </div>
      ) : error ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-3 p-6">
          <AlertCircle size={32} className="text-red-700" />
          <p className="text-red-700 text-sm text-center">{error}</p>
          <button onClick={loadDetail} className="px-4 py-2 bg-gray-100 hover:bg-gray-100 text-gray-900 rounded-lg text-sm">Retry</button>
        </div>
      ) : detail ? (
        <div className="flex-1 overflow-y-auto p-6 space-y-6">

          {/* Meta grid */}
          <div className="grid grid-cols-2 gap-3 bg-gray-100 rounded-xl p-4 text-sm">
            {detail.department_name && (
              <div>
                <p className="text-xs text-gray-500 mb-0.5">Department</p>
                <p className="text-gray-900 font-medium">{detail.department_name}</p>
              </div>
            )}
            {detail.owner_name && (
              <div>
                <p className="text-xs text-gray-500 mb-0.5">Owner</p>
                <p className="text-gray-900 font-medium flex items-center gap-1"><User size={12} /> {detail.owner_name}</p>
              </div>
            )}
            <div>
              <p className="text-xs text-gray-500 mb-0.5">Due Date</p>
              <p className={`font-medium flex items-center gap-1 ${isOverdue(detail) ? 'text-red-700' : 'text-gray-900'}`}>
                <Calendar size={12} /> {formatDate(detail.due_date)}
              </p>
            </div>
            <div>
              <p className="text-xs text-gray-500 mb-0.5">Created</p>
              <p className="text-gray-900 font-medium">{formatDate(detail.created_at)}</p>
            </div>
            <div>
              <p className="text-xs text-gray-500 mb-0.5">Source</p>
              <span className={`px-2 py-0.5 rounded-full text-xs font-medium capitalize ${SOURCE_BADGE[detail.source]}`}>
                {detail.source}
              </span>
            </div>
            <div>
              <p className="text-xs text-gray-500 mb-0.5">Type</p>
              <span className={`px-2 py-0.5 rounded-full text-xs font-medium capitalize ${TYPE_BADGE[detail.type]}`}>
                {detail.type}
              </span>
            </div>
            <div>
              <p className="text-xs text-gray-500 mb-0.5">Priority</p>
              <span className={`px-2 py-0.5 rounded-full text-xs font-medium capitalize ${PRIORITY_BADGE[detail.priority]}`}>
                {detail.priority}
              </span>
            </div>
            {detail.created_by && (
              <div>
                <p className="text-xs text-gray-500 mb-0.5">Created By</p>
                <p className="text-gray-900 font-medium">{detail.created_by}</p>
              </div>
            )}
          </div>

          {/* Description */}
          {detail.description && (
            <div>
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Description</p>
              <p className="text-sm text-gray-700 leading-relaxed whitespace-pre-wrap">{detail.description}</p>
            </div>
          )}

          {/* Investigation textareas */}
          <div>
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Investigation</p>
            <div className="space-y-4">
              {/* Containment */}
              <div>
                <label className="text-xs font-medium text-gray-500 mb-1 flex items-center">
                  Containment Action
                  <FieldSaveIndicator field="containment_action" />
                </label>
                <textarea
                  className={`${darkInput} resize-none`}
                  rows={3}
                  placeholder="Immediate containment steps taken…"
                  value={containment}
                  onChange={e => setContainment(e.target.value)}
                  onBlur={() => handleBlurSave('containment_action', containment)}
                />
              </div>

              {/* Root Cause */}
              <div>
                <label className="text-xs font-medium text-gray-500 mb-1 flex items-center">
                  Root Cause Analysis
                  <FieldSaveIndicator field="root_cause_analysis" />
                </label>
                <textarea
                  className={`${darkInput} resize-none`}
                  rows={3}
                  placeholder="Root cause of the issue…"
                  value={rootCause}
                  onChange={e => setRootCause(e.target.value)}
                  onBlur={() => handleBlurSave('root_cause_analysis', rootCause)}
                />
              </div>

              {/* Corrective */}
              <div>
                <label className="text-xs font-medium text-gray-500 mb-1 flex items-center">
                  Corrective Action
                  <FieldSaveIndicator field="corrective_action" />
                </label>
                <textarea
                  className={`${darkInput} resize-none`}
                  rows={3}
                  placeholder="Actions taken to fix the issue…"
                  value={corrective}
                  onChange={e => setCorrective(e.target.value)}
                  onBlur={() => handleBlurSave('corrective_action', corrective)}
                />
              </div>

              {/* Preventive */}
              <div>
                <label className="text-xs font-medium text-gray-500 mb-1 flex items-center">
                  Preventive Action
                  <FieldSaveIndicator field="preventive_action" />
                </label>
                <textarea
                  className={`${darkInput} resize-none`}
                  rows={3}
                  placeholder="Steps to prevent recurrence…"
                  value={preventive}
                  onChange={e => setPreventive(e.target.value)}
                  onBlur={() => handleBlurSave('preventive_action', preventive)}
                />
              </div>
            </div>
          </div>

          {/* Action Items */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Action Items ({actions.length})</p>
              <button
                onClick={() => setShowAddAction(v => !v)}
                className="text-xs bg-gray-100 hover:bg-gray-100 text-gray-700 px-3 py-1.5 rounded-lg flex items-center gap-1.5 transition-colors"
              >
                <Plus size={12} /> Add Action
              </button>
            </div>

            {/* Add Action form */}
            {showAddAction && (
              <form onSubmit={handleAddAction} className="bg-gray-100 rounded-xl p-4 mb-3 space-y-3">
                <div>
                  <label className="text-xs text-gray-500 mb-1 block">Description *</label>
                  <input className={darkInput} placeholder="What needs to be done?" value={newAction.description}
                    onChange={e => setNewAction(a => ({ ...a, description: e.target.value }))} required />
                </div>
                <div className="field-row gap-2">
                  <div>
                    <label className="text-xs text-gray-500 mb-1 block">Owner</label>
                    <input className={darkInput} placeholder="Person's name" value={newAction.owner_name}
                      onChange={e => setNewAction(a => ({ ...a, owner_name: e.target.value }))} />
                  </div>
                  <div>
                    <label className="text-xs text-gray-500 mb-1 block">Due Date</label>
                    <input type="date" className={darkInput} value={newAction.due_date}
                      onChange={e => setNewAction(a => ({ ...a, due_date: e.target.value }))} />
                  </div>
                </div>
                <div className="flex gap-2">
                  <button type="button" onClick={() => setShowAddAction(false)}
                    className="flex-1 px-3 py-1.5 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg text-sm transition-colors">
                    Cancel
                  </button>
                  <button type="submit" disabled={addingAction || !newAction.description.trim()}
                    className="flex-1 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-medium py-1.5 px-3 rounded-lg flex items-center justify-center gap-1.5 transition-colors">
                    {addingAction ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}
                    Save
                  </button>
                </div>
              </form>
            )}

            {/* Action list */}
            {actions.length === 0 && !showAddAction ? (
              <p className="text-sm text-gray-500 italic">No action items yet.</p>
            ) : (
              <div className="space-y-2">
                {actions.map(action => (
                  <div key={action.id} className={`bg-gray-100 rounded-xl p-3 flex items-start gap-3 ${action.status === 'done' ? 'opacity-60' : ''}`}>
                    <button
                      onClick={() => handleToggleActionStatus(action)}
                      disabled={togglingAction === action.id}
                      className="shrink-0 mt-0.5"
                      title="Toggle status"
                    >
                      {togglingAction === action.id ? (
                        <Loader2 size={18} className="animate-spin text-blue-700" />
                      ) : action.status === 'done' ? (
                        <CheckCircle2 size={18} className="text-emerald-700" />
                      ) : action.status === 'in_progress' ? (
                        <Circle size={18} className="text-blue-700" />
                      ) : (
                        <Circle size={18} className="text-gray-400" />
                      )}
                    </button>
                    <div className="flex-1 min-w-0">
                      <p className={`text-sm text-gray-900 ${action.status === 'done' ? 'line-through text-gray-500' : ''}`}>
                        {action.description}
                      </p>
                      <div className="flex flex-wrap items-center gap-2 mt-1">
                        {action.owner_name && (
                          <span className="text-xs text-gray-500 flex items-center gap-1">
                            <User size={10} /> {action.owner_name}
                          </span>
                        )}
                        {action.due_date && (
                          <span className="text-xs text-gray-500 flex items-center gap-1">
                            <Calendar size={10} /> {formatDate(action.due_date)}
                          </span>
                        )}
                        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${ACTION_STATUS_BADGE[action.status]}`}>
                          {action.status.replace('_', ' ')}
                        </span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* CAPA Actions */}
          {detail.status !== 'closed' && (
            <div>
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Close CAPA</p>
              <button
                onClick={handleClose}
                disabled={closing}
                className="bg-green-700 hover:bg-green-600 disabled:opacity-50 text-white font-medium py-2 px-4 rounded-lg flex items-center gap-2 transition-colors"
              >
                {closing ? <Loader2 size={16} className="animate-spin" /> : <CheckCircle2 size={16} />}
                {closing ? 'Closing…' : 'Mark as Closed'}
              </button>
            </div>
          )}

          {/* Danger zone */}
          <div className="border-t border-gray-200 pt-4">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Danger Zone</p>
            {!confirmDelete ? (
              <button
                onClick={() => setConfirmDelete(true)}
                className="flex items-center gap-2 text-sm text-red-700 hover:text-red-800 hover:bg-red-100 px-3 py-2 rounded-lg transition-colors"
              >
                <Trash2 size={14} /> Delete CAPA
              </button>
            ) : (
              <div className="flex items-center gap-3">
                <span className="text-sm text-gray-700">Are you sure?</span>
                <button
                  onClick={handleDelete}
                  disabled={deleting}
                  className="bg-red-700 hover:bg-red-600 disabled:opacity-50 text-white text-sm font-medium py-1.5 px-3 rounded-lg flex items-center gap-1.5"
                >
                  {deleting ? <Loader2 size={13} className="animate-spin" /> : null}
                  Delete
                </button>
                <button onClick={() => setConfirmDelete(false)}
                  className="px-3 py-1.5 bg-gray-100 hover:bg-gray-100 text-gray-700 text-sm rounded-lg">
                  Cancel
                </button>
              </div>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}

// ── Main CAPA Page ────────────────────────────────────────────────────────────

export default function CAPA() {
  const [capas, setCapas] = useState<CAPA[]>([]);
  const [summary, setSummary] = useState<CAPASummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [priorityFilter, setPriorityFilter] = useState('');

  const [showCreate, setShowCreate] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const deptFilter = useDepartmentFilter('capa');

  // ── Load data ───────────────────────────────────────────────────────────────
  //
  // Every CAPA is fetched once and narrowed in the browser. Status, priority
  // and search used to round-trip to the server, but the summary strip has to
  // be recomputed for the chosen department and that needs the department's
  // whole CAPA list, not just the rows surviving the other filters.

  const loadCapas = useCallback(async () => {
    setError('');
    try {
      const [list, sum] = await Promise.all([
        api.getCAPAs(),
        api.getCAPAModuleSummary(),
      ]);
      setCapas(list);
      setSummary(sum);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load CAPAs.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    setLoading(true);
    loadCapas();
  }, [loadCapas]);

  // ── Filtering ───────────────────────────────────────────────────────────────

  // Everything the chosen department owns, before status/priority/search — this
  // is what the summary strip counts.
  const deptCapas = useMemo(() => capas.filter(deptFilter.matches), [capas, deptFilter.matches]);

  // What the table actually shows.
  const visibleCapas = useMemo(() => {
    const q = search.trim().toLowerCase();
    return deptCapas.filter(capa => {
      if (statusFilter && capa.status !== statusFilter) return false;
      if (priorityFilter && capa.priority !== priorityFilter) return false;
      if (q) {
        const haystack = `${capa.title ?? ''} ${capa.number ?? ''}`.toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    });
  }, [deptCapas, statusFilter, priorityFilter, search]);

  const otherFiltersActive = !!statusFilter || !!priorityFilter || !!search.trim();

  // A remembered department id filters correctly from the first render, but its
  // name only arrives with the departments fetch — so copy that would otherwise
  // read "No CAPAs in undefined" falls back to a generic phrase for that beat.
  const deptName = deptFilter.selected?.name ?? 'this department';

  // ── Summary computed values ─────────────────────────────────────────────────
  //
  // Under "All departments" the server's own tally is authoritative. /capa/summary
  // takes no department, so once one is chosen the same four numbers are
  // recomputed from that department's CAPAs rather than left showing the plant.

  const stats = useMemo(() => {
    if (deptFilter.active) {
      if (loading) return null; // don't flash zeros before the CAPAs arrive
      return {
        open:    deptCapas.filter(c => c.status !== 'closed').length,
        overdue: deptCapas.filter(isOverdue).length,
        closed:  deptCapas.filter(c => c.status === 'closed').length,
        total:   deptCapas.length,
      };
    }
    if (!summary) return null;
    return {
      open:    summary.open,
      overdue: summary.overdue,
      closed:  summary.by_status?.closed ?? 0,
      total:   Object.values(summary.by_status ?? {}).reduce((a, b) => a + b, 0),
    };
  }, [deptFilter.active, deptCapas, summary, loading]);

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-white text-gray-900">
      <div className="max-w-7xl mx-auto px-4 py-8">

        {/* Page Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-blue-50 border border-blue-200 rounded-xl">
              <ClipboardCheck size={24} className="text-blue-700" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-gray-900">CAPA Tracker</h1>
              <p className="text-sm text-gray-500">Corrective and Preventive Action management</p>
            </div>
          </div>
          <button
            onClick={() => setShowCreate(true)}
            className="bg-blue-600 hover:bg-blue-700 text-white font-semibold py-2.5 px-5 rounded-xl flex items-center gap-2 transition-colors"
          >
            <Plus size={18} /> New CAPA
          </button>
        </div>

        {/* Error banner */}
        {error && (
          <div className="bg-red-50 border border-red-200 rounded-xl p-4 flex items-center justify-between gap-4 mb-6">
            <div className="flex items-center gap-3">
              <AlertTriangle size={18} className="text-red-700 shrink-0" />
              <p className="text-red-700 text-sm">{error}</p>
            </div>
            <button onClick={loadCapas} className="text-sm px-3 py-1.5 bg-gray-100 hover:bg-gray-100 text-gray-900 rounded-lg shrink-0">
              Retry
            </button>
          </div>
        )}

        {/* Summary Strip — scoped to the selected department, so the headline
            numbers never describe a wider plant than the table below. */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          <div className="bg-white border border-gray-200 rounded-xl p-4">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Open</p>
            <p className="text-3xl font-bold text-gray-900">{stats?.open ?? '—'}</p>
            <p className="text-xs text-gray-500 mt-1 truncate">
              active CAPAs{deptFilter.selected ? ` — ${deptFilter.selected.name}` : ''}
            </p>
          </div>
          <div className={`bg-white border rounded-xl p-4 ${stats && stats.overdue > 0 ? 'border-red-200 bg-red-50' : 'border-gray-200'}`}>
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Overdue</p>
            <p className={`text-3xl font-bold ${stats && stats.overdue > 0 ? 'text-red-700' : 'text-gray-900'}`}>
              {stats?.overdue ?? '—'}
            </p>
            <p className="text-xs text-gray-500 mt-1">past due date</p>
          </div>
          <div className="bg-white border border-gray-200 rounded-xl p-4">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Closed</p>
            <p className="text-3xl font-bold text-emerald-700">{stats?.closed ?? '—'}</p>
            <p className="text-xs text-gray-500 mt-1">completed</p>
          </div>
          <div className="bg-white border border-gray-200 rounded-xl p-4">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Total</p>
            <p className="text-3xl font-bold text-gray-900">{stats?.total ?? '—'}</p>
            <p className="text-xs text-gray-500 mt-1">all time</p>
          </div>
        </div>

        {/* Filter row */}
        <div className="flex flex-wrap gap-3 mb-6">
          {/* Search */}
          <div className="relative flex-1 min-w-[200px]">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
            <input
              className="bg-white border border-gray-200 text-gray-900 placeholder:text-gray-500 rounded-lg pl-9 pr-3 py-2 w-full focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
              placeholder="Search CAPAs…"
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>

          {/* Status */}
          <select
            className={`${darkSelect} min-w-[160px] flex-none`}
            value={statusFilter}
            onChange={e => setStatusFilter(e.target.value)}
          >
            <option value="">All Statuses</option>
            <option value="open">Open</option>
            <option value="root_cause">Root Cause</option>
            <option value="action">Action</option>
            <option value="verification">Verification</option>
            <option value="closed">Closed</option>
          </select>

          {/* Priority */}
          <select
            className={`${darkSelect} min-w-[140px] flex-none`}
            value={priorityFilter}
            onChange={e => setPriorityFilter(e.target.value)}
          >
            <option value="">All Priorities</option>
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
            <option value="critical">Critical</option>
          </select>

          {/* Department — the shared picker, so the choice is remembered and
              site-aware like it is on the other management screens. */}
          <DepartmentFilter
            filter={deptFilter}
            matchCount={deptCapas.length}
            matchNoun={deptCapas.length === 1 ? 'CAPA' : 'CAPAs'}
            className="flex-none"
          />
        </div>

        {/* CAPA Table */}
        {loading ? (
          <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="flex gap-4 p-4 border-b border-gray-200 animate-pulse">
                <div className="h-4 bg-gray-100 rounded w-24 shrink-0" />
                <div className="h-4 bg-gray-100 rounded flex-1" />
                <div className="h-4 bg-gray-100 rounded w-16 shrink-0" />
                <div className="h-4 bg-gray-100 rounded w-16 shrink-0" />
                <div className="h-4 bg-gray-100 rounded w-20 shrink-0" />
              </div>
            ))}
          </div>
        ) : visibleCapas.length === 0 ? (
          /* An empty department reads very differently from an empty plant, so
             say which one this is and offer the way back out. */
          <div className="flex flex-col items-center justify-center py-24 gap-4">
            <div className="p-5 bg-emerald-50 border border-emerald-200 rounded-full">
              <ClipboardCheck size={40} className="text-emerald-700" />
            </div>
            <div className="text-center max-w-sm">
              <h3 className="text-xl font-semibold text-gray-900 mb-1">
                {deptFilter.active ? `No CAPAs in ${deptName}` : 'No CAPAs found'}
              </h3>
              <p className="text-gray-500">
                {deptFilter.active
                  ? otherFiltersActive
                    ? `Nothing in ${deptName} matches the current filters. Other departments may have CAPAs that do.`
                    : `No corrective or preventive actions are assigned to ${deptName}. Other departments may have some.`
                  : 'Adjust filters or create a new CAPA'}
              </p>
            </div>
            {deptFilter.active && (
              <button
                onClick={deptFilter.clear}
                className="flex items-center gap-2 px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 font-medium rounded-lg transition-colors"
              >
                <X size={15} />
                Show all departments
              </button>
            )}
          </div>
        ) : (
          <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
            {/* Table header */}
            <div className="hidden lg:grid grid-cols-[120px_1fr_100px_100px_100px_100px_120px_40px] gap-3 px-4 py-3 bg-gray-100 border-b border-gray-300">
              {['Number', 'Title', 'Source', 'Type', 'Priority', 'Status', 'Due Date', ''].map(h => (
                <span key={h} className="text-xs font-semibold text-gray-500 uppercase tracking-wide">{h}</span>
              ))}
            </div>

            {/* Table rows */}
            <div className="divide-y divide-gray-100">
              {visibleCapas.map(capa => {
                const overdue = isOverdue(capa);
                const isSelected = selectedId === capa.id;
                return (
                  <div
                    key={capa.id}
                    onClick={() => setSelectedId(isSelected ? null : capa.id)}
                    className={`cursor-pointer transition-colors px-4 py-3 hover:bg-gray-100
                      lg:grid lg:grid-cols-[120px_1fr_100px_100px_100px_100px_120px_40px] lg:gap-3 lg:items-center
                      flex flex-col gap-2
                      ${isSelected ? 'bg-blue-50 border-l-2 border-l-blue-500' : ''}`}
                  >
                    {/* Number */}
                    <span className="font-mono text-blue-700 text-sm">{capa.number}</span>

                    {/* Title */}
                    <div className="min-w-0">
                      <p className="text-gray-900 text-sm font-medium truncate">{capa.title}</p>
                      {capa.department_name && (
                        <p className="text-xs text-gray-500 truncate">{capa.department_name}</p>
                      )}
                    </div>

                    {/* Source */}
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium capitalize w-fit ${SOURCE_BADGE[capa.source]}`}>
                      {capa.source}
                    </span>

                    {/* Type */}
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium capitalize w-fit ${TYPE_BADGE[capa.type]}`}>
                      {capa.type}
                    </span>

                    {/* Priority */}
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium capitalize w-fit ${PRIORITY_BADGE[capa.priority]}`}>
                      {capa.priority}
                    </span>

                    {/* Status */}
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium w-fit ${STATUS_BADGE[capa.status]}`}>
                      {STATUS_LABEL[capa.status]}
                    </span>

                    {/* Due date */}
                    <span className={`text-sm flex items-center gap-1 ${overdue ? 'text-red-700 font-medium' : 'text-gray-500'}`}>
                      {overdue && <AlertTriangle size={12} />}
                      {formatDate(capa.due_date)}
                    </span>

                    {/* Chevron */}
                    <ChevronRight size={16} className="text-gray-400 hidden lg:block" />
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* Detail Panel overlay */}
      {selectedId && (
        <>
          {/* Backdrop (click to close) */}
          <div
            className="fixed inset-0 z-30 bg-black/40"
            onClick={() => setSelectedId(null)}
          />
          <CAPADetailPanel
            key={selectedId}
            capaId={selectedId}
            onClose={() => setSelectedId(null)}
            onUpdated={loadCapas}
          />
        </>
      )}

      {/* New CAPA modal */}
      {showCreate && (
        <NewCAPAModal
          // Same department list the filter uses — one source of truth, and it
          // follows the selected site like the rest of the app.
          departments={deptFilter.departments}
          onClose={() => setShowCreate(false)}
          onCreated={(id) => {
            setShowCreate(false);
            loadCapas();
            setSelectedId(id);
          }}
        />
      )}
    </div>
  );
}

import { useEffect, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  AlertTriangle, ShieldCheck, Plus, Search, Download, X,
  User, Calendar, MessageSquare, ChevronRight, AlertCircle,
  Package, Briefcase, Cpu, Clock, Send, Trash2, History,
} from 'lucide-react';
import { api } from '../api/client';
import ActivityLog from '../components/shared/ActivityLog';
import SavedViewsBar from '../components/shared/SavedViewsBar';
import { useAuth } from '../context/AuthContext';

// ── Types ─────────────────────────────────────────────────────────────────────

interface NCR {
  id: string;
  ncr_number: string;
  title: string;
  description: string;
  severity: 'critical' | 'major' | 'minor';
  status: 'open' | 'investigating' | 'resolved' | 'closed';
  source: string;
  assigned_to?: string;
  due_date?: string;
  created_at: string;
  resolved_at?: string;
  root_cause?: string;
  corrective_action?: string;
  app_id?: string;
  app_name?: string;
  work_order_id?: string;
  work_order_number?: string;
  item_id?: string;
  item_sku?: string;
  comments?: NCRComment[];
  comment_count?: number;
}

interface NCRComment {
  id: string;
  author: string;
  body: string;
  created_at: string;
}

interface QualitySummary {
  total: number;
  open: number;
  investigating: number;
  resolved: number;
  closed: number;
  critical: number;
  overdue: number;
  by_source: Record<string, number>;
  by_severity: Record<string, number>;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} minute${mins === 1 ? '' : 's'} ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} day${days === 1 ? '' : 's'} ago`;
  const months = Math.floor(days / 30);
  return `${months} month${months === 1 ? '' : 's'} ago`;
}

function isOverdue(ncr: NCR): boolean {
  if (!ncr.due_date) return false;
  if (ncr.status === 'resolved' || ncr.status === 'closed') return false;
  return new Date(ncr.due_date) < new Date();
}

function formatDate(dateStr?: string): string {
  if (!dateStr) return '—';
  return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

// ── Severity styling ──────────────────────────────────────────────────────────

const SEVERITY_STYLES: Record<string, { border: string; badge: string; label: string }> = {
  critical: {
    border: 'border-l-red-500',
    badge: 'bg-red-50 text-red-600 border border-red-200',
    label: 'Critical',
  },
  major: {
    border: 'border-l-amber-500',
    badge: 'bg-amber-50 text-amber-600 border border-amber-200',
    label: 'Major',
  },
  minor: {
    border: 'border-l-blue-500',
    badge: 'bg-blue-50 text-blue-600 border border-blue-200',
    label: 'Minor',
  },
};

// ── Status dot ────────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: NCR['status'] }) {
  const map: Record<NCR['status'], { dot: string; label: string }> = {
    open:          { dot: 'bg-red-500',   label: 'Open' },
    investigating: { dot: 'bg-amber-500', label: 'Investigating' },
    resolved:      { dot: 'bg-green-500', label: 'Resolved' },
    closed:        { dot: 'bg-gray-400',  label: 'Closed' },
  };
  const { dot, label } = map[status] ?? { dot: 'bg-gray-400', label: status };
  return (
    <span className="badge badge-gray gap-1.5">
      <span className={`w-1.5 h-1.5 rounded-full ${dot}`} />
      {label}
    </span>
  );
}

// ── NCR Card ──────────────────────────────────────────────────────────────────

function NCRCard({ ncr, selected, onClick }: { ncr: NCR; selected: boolean; onClick: () => void }) {
  const sev = SEVERITY_STYLES[ncr.severity] ?? SEVERITY_STYLES.minor;
  const overdue = isOverdue(ncr);
  const isCritical = ncr.severity === 'critical' && ncr.status !== 'closed';

  return (
    <div
      onClick={onClick}
      className={`card border-l-4 ${sev.border} p-4 cursor-pointer transition-all hover:shadow-md
        ${selected ? 'ring-2 ring-blue-400 shadow-md' : ''}
        ${isCritical ? 'ncr-critical-pulse' : ''}
      `}
    >
      <div className="flex items-start justify-between gap-3">
        {/* Left */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="font-mono text-xs text-gray-400">{ncr.ncr_number}</span>
            {overdue && (
              <span className="text-xs font-bold text-red-600 uppercase tracking-wide">Overdue</span>
            )}
          </div>
          <p className="font-semibold text-gray-900 truncate">{ncr.title}</p>

          <div className="flex flex-wrap items-center gap-1.5 mt-2">
            <span className={`badge text-xs font-semibold px-2 py-0.5 rounded-full ${sev.badge}`}>
              {sev.label}
            </span>
            <StatusBadge status={ncr.status} />
            {ncr.source && (
              <span className="badge badge-gray capitalize">{ncr.source}</span>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-3 mt-2 text-xs text-gray-500">
            {ncr.assigned_to && (
              <span className="flex items-center gap-1">
                <User size={11} /> {ncr.assigned_to}
              </span>
            )}
            {ncr.due_date && (
              <span className={`flex items-center gap-1 ${overdue ? 'text-red-600 font-medium' : ''}`}>
                <Calendar size={11} /> {formatDate(ncr.due_date)}
              </span>
            )}
            {ncr.work_order_number && (
              <span className="flex items-center gap-1">
                <Briefcase size={11} /> {ncr.work_order_number}
              </span>
            )}
            {ncr.app_name && (
              <span className="flex items-center gap-1">
                <Cpu size={11} /> {ncr.app_name}
              </span>
            )}
            {ncr.item_sku && (
              <span className="flex items-center gap-1">
                <Package size={11} /> {ncr.item_sku}
              </span>
            )}
            {(ncr.comment_count ?? 0) > 0 && (
              <span className="flex items-center gap-1">
                <MessageSquare size={11} /> {ncr.comment_count}
              </span>
            )}
          </div>
        </div>

        {/* Right — big status indicator */}
        <div className="flex flex-col items-end gap-1 shrink-0">
          <ChevronRight size={16} className="text-gray-300" />
          <span className="text-xs text-gray-400">{timeAgo(ncr.created_at)}</span>
        </div>
      </div>
    </div>
  );
}

// ── Comment Thread ─────────────────────────────────────────────────────────────

function CommentThread({ ncrId, comments, onAdded }: {
  ncrId: string;
  comments: NCRComment[];
  onAdded: () => void;
}) {
  const { canEdit } = useAuth();
  const [author, setAuthor] = useState('');
  const [body, setBody] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!author.trim() || !body.trim()) return;
    setSubmitting(true);
    try {
      await api.addNCRComment(ncrId, { author: author.trim(), body: body.trim() });
      setBody('');
      onAdded();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div>
      <p className="section-label">Comments ({comments.length})</p>

      <div className="space-y-3 mb-4">
        {comments.length === 0 && (
          <p className="text-sm text-gray-400 italic">No comments yet.</p>
        )}
        {comments.map(c => (
          <div key={c.id} className="flex gap-3">
            <div className="w-8 h-8 rounded-full bg-blue-100 text-blue-700 flex items-center justify-center text-xs font-bold shrink-0">
              {c.author.charAt(0).toUpperCase()}
            </div>
            <div className="flex-1 bg-gray-50 rounded-xl px-3 py-2">
              <div className="flex items-baseline gap-2">
                <span className="text-xs font-semibold text-gray-800">{c.author}</span>
                <span className="text-xs text-gray-400">{timeAgo(c.created_at)}</span>
              </div>
              <p className="text-sm text-gray-700 mt-0.5 whitespace-pre-wrap">{c.body}</p>
            </div>
          </div>
        ))}
      </div>

      {canEdit && (
        <form onSubmit={handleSubmit} className="space-y-2">
          <input
            className="input-field"
            placeholder="Your name"
            value={author}
            onChange={e => setAuthor(e.target.value)}
            required
          />
          <textarea
            className="input-field resize-none"
            rows={2}
            placeholder="Add a comment…"
            value={body}
            onChange={e => setBody(e.target.value)}
            required
          />
          <button type="submit" className="btn-primary" disabled={submitting || !author.trim() || !body.trim()}>
            <Send size={14} />
            {submitting ? 'Posting…' : 'Post Comment'}
          </button>
        </form>
      )}
    </div>
  );
}

// ── NCR Detail ────────────────────────────────────────────────────────────────

function NCRDetail({ ncrId, onClose, onRefresh }: {
  ncrId: string;
  onClose: () => void;
  onRefresh: () => void;
}) {
  const [ncr, setNcr] = useState<NCR | null>(null);
  const [loading, setLoading] = useState(true);
  const [rootCause, setRootCause] = useState('');
  const [correctiveAction, setCorrectiveAction] = useState('');
  const [savingField, setSavingField] = useState<string | null>(null);
  const [statusUpdating, setStatusUpdating] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const { canEdit } = useAuth();
  const navigate = useNavigate();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.getNCR(ncrId);
      setNcr(data);
      setRootCause(data.root_cause ?? '');
      setCorrectiveAction(data.corrective_action ?? '');
    } finally {
      setLoading(false);
    }
  }, [ncrId]);

  useEffect(() => { load(); }, [load]);

  async function handleBlurSave(field: string, value: string) {
    if (!ncr) return;
    const original = field === 'root_cause' ? ncr.root_cause : ncr.corrective_action;
    if (value === (original ?? '')) return;
    setSavingField(field);
    try {
      await api.updateNCR(ncrId, { [field]: value });
      await load();
    } finally {
      setSavingField(null);
    }
  }

  async function handleStatusChange(newStatus: NCR['status']) {
    setStatusUpdating(true);
    const patch: any = { status: newStatus };
    if (newStatus === 'resolved') patch.resolved_at = new Date().toISOString();
    try {
      await api.updateNCR(ncrId, patch);
      await load();
      onRefresh();
    } finally {
      setStatusUpdating(false);
    }
  }

  async function handleSeverityChange(newSeverity: string) {
    await api.updateNCR(ncrId, { severity: newSeverity });
    await load();
    onRefresh();
  }

  async function handleDelete() {
    await api.deleteNCR(ncrId);
    onClose();
    navigate('/quality');
    onRefresh();
  }

  if (loading || !ncr) {
    return (
      <div className="flex items-center justify-center h-full text-gray-400 text-sm">
        Loading…
      </div>
    );
  }

  const sev = SEVERITY_STYLES[ncr.severity] ?? SEVERITY_STYLES.minor;
  const overdue = isOverdue(ncr);

  const nextStatusAction: Record<NCR['status'], { label: string; next: NCR['status']; cls: string } | null> = {
    open:          { label: 'Start Investigation', next: 'investigating', cls: 'btn-secondary' },
    investigating: { label: 'Mark Resolved',       next: 'resolved',     cls: 'btn-success'   },
    resolved:      { label: 'Close NCR',           next: 'closed',       cls: 'btn-secondary' },
    closed:        null,
  };
  const action = nextStatusAction[ncr.status];

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="flex items-start justify-between p-5 border-b border-gray-100">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="font-mono text-xs text-gray-400">{ncr.ncr_number}</span>
            {overdue && (
              <span className="text-xs font-bold text-red-600 uppercase tracking-wide">Overdue</span>
            )}
          </div>
          <h2 className="text-lg font-bold text-gray-900 leading-snug">{ncr.title}</h2>
          <div className="flex flex-wrap items-center gap-2 mt-2">
            <span className={`badge text-xs font-semibold px-2.5 py-1 rounded-full ${sev.badge}`}>
              {sev.label}
            </span>
            <StatusBadge status={ncr.status} />
            {ncr.source && (
              <span className="badge badge-gray capitalize">{ncr.source}</span>
            )}
          </div>
        </div>
        <button onClick={onClose} className="btn-ghost ml-2 shrink-0">
          <X size={16} />
        </button>
      </div>

      {/* Scrollable body */}
      <div className="flex-1 overflow-y-auto p-5 space-y-6">

        {/* Meta row */}
        <div className="grid grid-cols-2 gap-3 text-sm">
          <div>
            <p className="text-xs text-gray-400 mb-0.5">Created</p>
            <p className="font-medium text-gray-800">{formatDate(ncr.created_at)}</p>
          </div>
          {ncr.assigned_to && (
            <div>
              <p className="text-xs text-gray-400 mb-0.5">Assigned To</p>
              <p className="font-medium text-gray-800 flex items-center gap-1">
                <User size={13} /> {ncr.assigned_to}
              </p>
            </div>
          )}
          {ncr.due_date && (
            <div>
              <p className="text-xs text-gray-400 mb-0.5">Due Date</p>
              <p className={`font-medium flex items-center gap-1 ${overdue ? 'text-red-600' : 'text-gray-800'}`}>
                <Calendar size={13} /> {formatDate(ncr.due_date)}
              </p>
            </div>
          )}
          {ncr.resolved_at && (
            <div>
              <p className="text-xs text-gray-400 mb-0.5">Resolved</p>
              <p className="font-medium text-green-700">{formatDate(ncr.resolved_at)}</p>
            </div>
          )}
        </div>

        {/* Description */}
        {ncr.description && (
          <div>
            <p className="section-label">Description</p>
            <p className="text-sm text-gray-700 whitespace-pre-wrap leading-relaxed">{ncr.description}</p>
          </div>
        )}

        {/* Linked items */}
        {(ncr.work_order_number || ncr.app_name || ncr.item_sku) && (
          <div>
            <p className="section-label">Linked Items</p>
            <div className="space-y-1.5">
              {ncr.work_order_number && (
                <div className="flex items-center gap-2 text-sm text-gray-700">
                  <Briefcase size={14} className="text-gray-400" />
                  <span className="font-medium">Work Order:</span>
                  <span>{ncr.work_order_number}</span>
                </div>
              )}
              {ncr.app_name && (
                <div className="flex items-center gap-2 text-sm text-gray-700">
                  <Cpu size={14} className="text-gray-400" />
                  <span className="font-medium">App:</span>
                  <span>{ncr.app_name}</span>
                </div>
              )}
              {ncr.item_sku && (
                <div className="flex items-center gap-2 text-sm text-gray-700">
                  <Package size={14} className="text-gray-400" />
                  <span className="font-medium">Item SKU:</span>
                  <span>{ncr.item_sku}</span>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Root Cause & Corrective Action */}
        <div>
          <p className="section-label">Investigation</p>
          <div className="space-y-3">
            <div>
              <label className="text-xs font-medium text-gray-600 mb-1 block">
                Root Cause
                {savingField === 'root_cause' && <span className="text-blue-500 ml-1 font-normal">Saving…</span>}
              </label>
              <textarea
                className="input-field resize-none"
                rows={3}
                placeholder="Describe the root cause…"
                value={rootCause}
                onChange={e => setRootCause(e.target.value)}
                onBlur={() => handleBlurSave('root_cause', rootCause)}
                readOnly={!canEdit}
              />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-600 mb-1 block">
                Corrective Action
                {savingField === 'corrective_action' && <span className="text-blue-500 ml-1 font-normal">Saving…</span>}
              </label>
              <textarea
                className="input-field resize-none"
                rows={3}
                placeholder="Describe the corrective action taken…"
                value={correctiveAction}
                onChange={e => setCorrectiveAction(e.target.value)}
                onBlur={() => handleBlurSave('corrective_action', correctiveAction)}
                readOnly={!canEdit}
              />
            </div>
          </div>
        </div>

        {/* Status actions */}
        {canEdit && (
        <div>
          <p className="section-label">Actions</p>
          <div className="flex flex-wrap items-center gap-2">
            {action && (
              <button
                className={action.cls}
                onClick={() => handleStatusChange(action.next)}
                disabled={statusUpdating}
              >
                {statusUpdating ? 'Updating…' : action.label}
              </button>
            )}

            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-500">Severity:</span>
              <select
                className="text-xs border border-gray-200 rounded-lg px-2 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-blue-400"
                value={ncr.severity}
                onChange={e => handleSeverityChange(e.target.value)}
              >
                <option value="minor">Minor</option>
                <option value="major">Major</option>
                <option value="critical">Critical</option>
              </select>
            </div>
          </div>
        </div>
        )}

        {/* Comments */}
        <div>
          <CommentThread
            ncrId={ncrId}
            comments={ncr.comments ?? []}
            onAdded={load}
          />
        </div>

        {/* Activity */}
        <div>
          <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-gray-500 mb-2">
            <History size={12} />
            Activity
          </div>
          <ActivityLog entityType="ncr" entityId={ncrId} />
        </div>

        {/* Danger zone */}
        {canEdit && (
        <div className="border-t border-gray-100 pt-4">
          {!confirmDelete ? (
            <button
              className="btn-ghost text-red-500 hover:bg-red-50"
              onClick={() => setConfirmDelete(true)}
            >
              <Trash2 size={14} /> Delete NCR
            </button>
          ) : (
            <div className="flex items-center gap-2">
              <span className="text-sm text-gray-600">Are you sure?</span>
              <button className="btn-danger" onClick={handleDelete}>Delete</button>
              <button className="btn-ghost" onClick={() => setConfirmDelete(false)}>Cancel</button>
            </div>
          )}
        </div>
        )}
      </div>
    </div>
  );
}

// ── Create NCR Modal ──────────────────────────────────────────────────────────

function CreateNCRModal({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) {
  const [apps, setApps] = useState<any[]>([]);
  const [workOrders, setWorkOrders] = useState<any[]>([]);
  const [items, setItems] = useState<any[]>([]);
  const [submitting, setSubmitting] = useState(false);

  const [form, setForm] = useState({
    title: '',
    severity: 'minor' as 'minor' | 'major' | 'critical',
    source: 'production' as string,
    description: '',
    assigned_to: '',
    due_date: '',
    app_id: '',
    work_order_id: '',
    item_id: '',
  });

  useEffect(() => {
    Promise.all([api.getApps(), api.getWorkOrders(), api.getInventoryItems()])
      .then(([a, w, i]) => {
        setApps(a);
        setWorkOrders(w);
        setItems(i);
      })
      .catch(() => {});
  }, []);

  function set(field: string, value: string) {
    setForm(f => ({ ...f, [field]: value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    try {
      const payload: any = {
        title: form.title.trim(),
        severity: form.severity,
        source: form.source,
        description: form.description.trim() || undefined,
        assigned_to: form.assigned_to.trim() || undefined,
        due_date: form.due_date || undefined,
        app_id: form.app_id || undefined,
        work_order_id: form.work_order_id || undefined,
        item_id: form.item_id || undefined,
      };
      const created = await api.createNCR(payload);
      onCreated(created.id);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-xl flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <div className="flex items-center gap-2">
            <AlertTriangle size={18} className="text-red-600" />
            <h2 className="text-lg font-bold text-gray-900">New Non-Conformance Report</h2>
          </div>
          <button className="btn-ghost" onClick={onClose}><X size={16} /></button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
          <div>
            <label className="text-xs font-semibold text-gray-600 block mb-1">Title *</label>
            <input
              className="input-field"
              placeholder="Brief description of the non-conformance"
              value={form.title}
              onChange={e => set('title', e.target.value)}
              required
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-semibold text-gray-600 block mb-1">Severity *</label>
              <select className="input-field" value={form.severity} onChange={e => set('severity', e.target.value)} required>
                <option value="minor">Minor</option>
                <option value="major">Major</option>
                <option value="critical">Critical</option>
              </select>
            </div>
            <div>
              <label className="text-xs font-semibold text-gray-600 block mb-1">Source *</label>
              <select className="input-field" value={form.source} onChange={e => set('source', e.target.value)} required>
                <option value="production">Production</option>
                <option value="receiving">Receiving</option>
                <option value="customer">Customer</option>
                <option value="audit">Audit</option>
                <option value="internal">Internal</option>
              </select>
            </div>
          </div>

          <div>
            <label className="text-xs font-semibold text-gray-600 block mb-1">Description</label>
            <textarea
              className="input-field resize-none"
              rows={3}
              placeholder="Detailed description of the issue…"
              value={form.description}
              onChange={e => set('description', e.target.value)}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-semibold text-gray-600 block mb-1">Assigned To</label>
              <input
                className="input-field"
                placeholder="Person's name"
                value={form.assigned_to}
                onChange={e => set('assigned_to', e.target.value)}
              />
            </div>
            <div>
              <label className="text-xs font-semibold text-gray-600 block mb-1">Due Date</label>
              <input
                type="date"
                className="input-field"
                value={form.due_date}
                onChange={e => set('due_date', e.target.value)}
              />
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3">
            <div>
              <label className="text-xs font-semibold text-gray-600 block mb-1">Link to App</label>
              <select className="input-field" value={form.app_id} onChange={e => set('app_id', e.target.value)}>
                <option value="">— None —</option>
                {apps.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs font-semibold text-gray-600 block mb-1">Link to Work Order</label>
              <select className="input-field" value={form.work_order_id} onChange={e => set('work_order_id', e.target.value)}>
                <option value="">— None —</option>
                {workOrders.map(w => <option key={w.id} value={w.id}>{w.work_order_number} — {w.part_name}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs font-semibold text-gray-600 block mb-1">Link to Item</label>
              <select className="input-field" value={form.item_id} onChange={e => set('item_id', e.target.value)}>
                <option value="">— None —</option>
                {items.map(i => <option key={i.id} value={i.id}>{i.sku} — {i.name}</option>)}
              </select>
            </div>
          </div>
        </form>

        {/* Footer */}
        <div className="flex justify-end gap-2 px-6 py-4 border-t border-gray-100">
          <button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>
          <button
            type="submit"
            className="btn-danger"
            onClick={handleSubmit}
            disabled={submitting || !form.title.trim()}
          >
            <AlertTriangle size={14} />
            {submitting ? 'Creating…' : 'Create NCR'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Summary Bar ───────────────────────────────────────────────────────────────

function SummaryBar({ summary }: { summary: QualitySummary | null }) {
  const resolvedThisMonth = summary?.resolved ?? 0;

  const cards = [
    {
      label: 'Total NCRs',
      value: summary?.total ?? '—',
      sub: 'all time',
      icon: <ShieldCheck size={18} className="text-gray-500" />,
      bg: 'bg-gray-50',
      valueClass: 'text-gray-900',
    },
    {
      label: 'Open',
      value: summary?.open ?? '—',
      sub: 'need attention',
      icon: <AlertCircle size={18} className={summary && summary.open > 0 ? 'text-red-600' : 'text-gray-400'} />,
      bg: summary && summary.open > 0 ? 'bg-red-50' : 'bg-gray-50',
      valueClass: summary && summary.open > 0 ? 'text-red-700' : 'text-gray-900',
    },
    {
      label: 'Critical Active',
      value: summary?.critical ?? '—',
      sub: 'not closed',
      icon: <AlertTriangle size={18} className={summary && summary.critical > 0 ? 'text-red-600' : 'text-gray-400'} />,
      bg: summary && summary.critical > 0 ? 'bg-red-50' : 'bg-gray-50',
      valueClass: summary && summary.critical > 0 ? 'text-red-700' : 'text-gray-900',
    },
    {
      label: 'Overdue',
      value: summary?.overdue ?? '—',
      sub: 'past due date',
      icon: <Clock size={18} className={summary && summary.overdue > 0 ? 'text-red-600' : 'text-gray-400'} />,
      bg: summary && summary.overdue > 0 ? 'bg-red-50' : 'bg-gray-50',
      valueClass: summary && summary.overdue > 0 ? 'text-red-700' : 'text-gray-900',
    },
    {
      label: 'Resolved',
      value: resolvedThisMonth,
      sub: 'total resolved',
      icon: <ShieldCheck size={18} className="text-green-600" />,
      bg: 'bg-green-50',
      valueClass: 'text-green-700',
    },
  ];

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 mb-6">
      {cards.map(c => (
        <div key={c.label} className={`stat-card ${c.bg} flex items-start gap-3`}>
          <div className="mt-0.5">{c.icon}</div>
          <div>
            <p className={`text-2xl font-bold ${c.valueClass}`}>{c.value}</p>
            <p className="text-xs font-semibold text-gray-700 leading-tight">{c.label}</p>
            <p className="text-xs text-gray-400">{c.sub}</p>
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Main Quality Page ─────────────────────────────────────────────────────────

const STATUS_PILLS = ['All', 'open', 'investigating', 'resolved', 'closed'] as const;
const SEVERITY_PILLS = ['All', 'critical', 'major', 'minor'] as const;
const SOURCE_PILLS = ['All', 'production', 'receiving', 'customer', 'audit', 'internal'] as const;

interface NCRViewFilters {
  statusFilter: string;
  severityFilter: string;
  sourceFilter: string;
  search: string;
}

export default function Quality() {
  const { id } = useParams<{ id?: string }>();
  const navigate = useNavigate();
  const { canEdit } = useAuth();

  const [ncrs, setNcrs] = useState<NCR[]>([]);
  const [summary, setSummary] = useState<QualitySummary | null>(null);
  const [loading, setLoading] = useState(true);

  const [statusFilter, setStatusFilter] = useState<string>('All');
  const [severityFilter, setSeverityFilter] = useState<string>('All');
  const [sourceFilter, setSourceFilter] = useState<string>('All');
  const [search, setSearch] = useState('');
  const [showCreate, setShowCreate] = useState(false);

  const applySavedView = (f: NCRViewFilters) => {
    setStatusFilter(f.statusFilter);
    setSeverityFilter(f.severityFilter);
    setSourceFilter(f.sourceFilter);
    setSearch(f.search);
  };

  const loadNCRs = useCallback(async () => {
    const params: any = {};
    if (statusFilter !== 'All')   params.status   = statusFilter;
    if (severityFilter !== 'All') params.severity = severityFilter;
    if (sourceFilter !== 'All')   params.source   = sourceFilter;
    if (search.trim())            params.search   = search.trim();

    const [list, sum] = await Promise.all([
      api.getNCRs(params),
      api.getQualitySummary(),
    ]);
    setNcrs(list);
    setSummary(sum);
    setLoading(false);
  }, [statusFilter, severityFilter, sourceFilter, search]);

  useEffect(() => {
    setLoading(true);
    const t = setTimeout(() => { loadNCRs(); }, search ? 300 : 0);
    return () => clearTimeout(t);
  }, [loadNCRs, search]);

  function selectNCR(ncrId: string) {
    navigate(`/quality/${ncrId}`);
  }

  function closeDetail() {
    navigate('/quality');
  }

  function handleCreated(ncrId: string) {
    setShowCreate(false);
    loadNCRs();
    navigate(`/quality/${ncrId}`);
  }

  const pillBase = 'px-3 py-1.5 rounded-full text-xs font-medium transition-colors cursor-pointer';
  const pillActive = 'bg-gray-900 text-white';
  const pillInactive = 'bg-white text-gray-600 border border-gray-200 hover:bg-gray-50';

  return (
    <div className="flex h-full bg-[#f8fafc]">
      {/* Left pane */}
      <div className={`flex flex-col flex-1 min-w-0 overflow-hidden ${id ? 'hidden lg:flex' : 'flex'}`}>
        <div className="flex-1 overflow-y-auto p-6">
          {/* Page header */}
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-6">
            <div>
              <h1 className="text-2xl font-bold text-gray-900 tracking-tight flex items-center gap-2">
                <ShieldCheck size={22} className="text-red-600" />
                Quality — NCR Management
              </h1>
              <p className="text-sm text-gray-500 mt-0.5">Track and resolve non-conformance reports</p>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <button onClick={() => api.downloadExport('ncrs')} className="btn-secondary whitespace-nowrap">
                <Download size={14} /> Export CSV
              </button>
              {canEdit && (
                <button className="btn-danger whitespace-nowrap" onClick={() => setShowCreate(true)}>
                  <Plus size={14} /> New NCR
                </button>
              )}
            </div>
          </div>

          {/* Summary bar */}
          <SummaryBar summary={summary} />

          {/* Toolbar */}
          <div className="space-y-3 mb-5">
            {/* Status pills */}
            <div className="flex flex-wrap gap-1.5">
              {STATUS_PILLS.map(s => (
                <button
                  key={s}
                  className={`${pillBase} ${statusFilter === s ? pillActive : pillInactive}`}
                  onClick={() => setStatusFilter(s)}
                >
                  {s === 'All' ? 'All Statuses' : s.charAt(0).toUpperCase() + s.slice(1)}
                </button>
              ))}
            </div>

            <div className="flex flex-wrap gap-2">
              {/* Severity pills */}
              <div className="flex flex-wrap gap-1.5">
                {SEVERITY_PILLS.map(s => (
                  <button
                    key={s}
                    className={`${pillBase} ${severityFilter === s ? pillActive : pillInactive}`}
                    onClick={() => setSeverityFilter(s)}
                  >
                    {s === 'All' ? 'All Severities' : s.charAt(0).toUpperCase() + s.slice(1)}
                  </button>
                ))}
              </div>

              {/* Source pills */}
              <div className="flex flex-wrap gap-1.5">
                {SOURCE_PILLS.map(s => (
                  <button
                    key={s}
                    className={`${pillBase} ${sourceFilter === s ? pillActive : pillInactive}`}
                    onClick={() => setSourceFilter(s)}
                  >
                    {s === 'All' ? 'All Sources' : s.charAt(0).toUpperCase() + s.slice(1)}
                  </button>
                ))}
              </div>

              {/* Search */}
              <div className="ml-auto relative">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                <input
                  className="input-field pl-8 w-60"
                  placeholder="Search NCRs…"
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                />
              </div>
            </div>

            <SavedViewsBar<NCRViewFilters>
              storageKey="hm_saved_views_ncrs"
              currentFilters={{ statusFilter, severityFilter, sourceFilter, search }}
              onApply={applySavedView}
            />
          </div>

          {/* NCR list */}
          {loading ? (
            <div className="space-y-3">
              {[...Array(4)].map((_, i) => (
                <div key={i} className="card h-24 animate-pulse bg-gray-100" />
              ))}
            </div>
          ) : ncrs.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-24 text-gray-400 gap-4">
              <ShieldCheck size={48} className="text-gray-200" />
              <div className="text-center">
                <p className="font-semibold text-gray-500">No NCRs found</p>
                <p className="text-sm">Try adjusting filters or create a new NCR</p>
              </div>
            </div>
          ) : (
            <div className="space-y-2">
              {ncrs.map(ncr => (
                <NCRCard
                  key={ncr.id}
                  ncr={ncr}
                  selected={id === ncr.id}
                  onClick={() => selectNCR(ncr.id)}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Right detail panel */}
      {id && (
        <div className="w-full lg:w-[480px] lg:max-w-[480px] shrink-0 bg-white border-l border-gray-200 flex flex-col h-full overflow-hidden shadow-xl">
          <NCRDetail
            key={id}
            ncrId={id}
            onClose={closeDetail}
            onRefresh={loadNCRs}
          />
        </div>
      )}

      {/* Create modal */}
      {showCreate && (
        <CreateNCRModal
          onClose={() => setShowCreate(false)}
          onCreated={handleCreated}
        />
      )}
    </div>
  );
}

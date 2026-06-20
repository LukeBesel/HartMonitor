import { useEffect, useState, useCallback, useRef, Fragment } from 'react';
import { api } from '../api/client';
import { useHighlight } from '../hooks/useHighlight';
import { useSite } from '../context/SiteContext';
import { useAuth } from '../context/AuthContext';
import ActivityLog from '../components/shared/ActivityLog';
import SavedViewsBar from '../components/shared/SavedViewsBar';
import {
  Plus, Search, Filter, List, BarChart2, Edit2, Trash2, CheckSquare,
  X, ChevronDown, AlertTriangle, Calendar, Package, Building2, Clock, History,
  MessageSquare, Send, QrCode, Printer, Trash,
} from 'lucide-react';
import ModuleOnboarding from '../components/shared/ModuleOnboarding';
import QRCodeLib from 'qrcode';

// ── Types ─────────────────────────────────────────────────────────────────────

interface WorkOrder {
  id: string;
  work_order_number: string;
  part_number: string;
  part_name: string;
  app_id: string;
  app_name: string;
  department: string;
  quantity_total: number;
  quantity_completed: number;
  priority: 'critical' | 'high' | 'medium' | 'low';
  status: 'pending' | 'in_progress' | 'completed' | 'overdue';
  schedule_status: 'on_track' | 'at_risk' | 'behind' | 'not_started';
  scheduled_start: string;
  scheduled_end: string;
  takt_time: number;
  notes: string;
}

interface App {
  id: string;
  name: string;
  status: string;
}

interface Department {
  id: string;
  name: string;
}

interface WOFormData {
  work_order_number: string;
  part_number: string;
  part_name: string;
  app_id: string;
  department: string;
  quantity_total: number;
  priority: 'critical' | 'high' | 'medium' | 'low';
  status: 'pending' | 'in_progress' | 'completed' | 'overdue';
  scheduled_start: string;
  scheduled_end: string;
  takt_time: number;
  notes: string;
}

interface ScheduleViewFilters {
  statusFilter: string;
  priorityFilter: string;
  deptFilter: string;
  search: string;
  viewMode: ViewMode;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const STATUS_OPTIONS = ['All', 'pending', 'in_progress', 'completed', 'overdue'] as const;
const PRIORITY_OPTIONS = ['All', 'critical', 'high', 'medium', 'low'] as const;

const STATUS_LABELS: Record<string, string> = {
  pending: 'Pending', in_progress: 'In Progress', completed: 'Completed', overdue: 'Overdue',
};
const STATUS_CLASSES: Record<string, string> = {
  pending:     'bg-gray-100 text-gray-600',
  in_progress: 'bg-blue-100 text-blue-700',
  completed:   'bg-green-100 text-green-700',
  overdue:     'bg-red-100 text-red-700',
};
const SCHEDULE_STATUS_CLASSES: Record<string, string> = {
  on_track:    'bg-green-100 text-green-700',
  at_risk:     'bg-amber-100 text-amber-700',
  behind:      'bg-red-100 text-red-700',
  not_started: 'bg-gray-100 text-gray-500',
};
const PRIORITY_CLASSES: Record<string, string> = {
  critical: 'bg-red-600 text-white',
  high:     'bg-orange-500 text-white',
  medium:   'bg-blue-500 text-white',
  low:      'bg-gray-400 text-white',
};
const GANTT_BAR_CLASSES: Record<string, string> = {
  pending:     'bg-gray-400',
  in_progress: 'bg-blue-500',
  completed:   'bg-green-500',
  overdue:     'bg-red-500',
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatDateLocal(iso: string) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString([], { month: 'short', day: 'numeric', year: '2-digit' });
}

function toDatetimeLocal(iso: string) {
  if (!iso) return '';
  return iso.slice(0, 16);
}

function generateWONumber() {
  const n = Math.floor(Math.random() * 90000) + 10000;
  return `WO-${n}`;
}

function defaultForm(): WOFormData {
  const now = new Date();
  const end = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
  return {
    work_order_number: generateWONumber(),
    part_number: '',
    part_name: '',
    app_id: '',
    department: '',
    quantity_total: 100,
    priority: 'medium',
    status: 'pending',
    scheduled_start: toDatetimeLocal(now.toISOString()),
    scheduled_end: toDatetimeLocal(end.toISOString()),
    takt_time: 5,
    notes: '',
  };
}

// ── Gantt Helpers ─────────────────────────────────────────────────────────────

function ganttPosition(start: string, end: string, minDate: Date, maxDate: Date) {
  const totalMs = maxDate.getTime() - minDate.getTime();
  if (totalMs === 0) return { left: 0, width: 100 };
  const startMs = Math.max(new Date(start).getTime() - minDate.getTime(), 0);
  const endMs = Math.min(new Date(end).getTime() - minDate.getTime(), totalMs);
  return {
    left: (startMs / totalMs) * 100,
    width: Math.max(0.5, ((endMs - startMs) / totalMs) * 100),
  };
}

// ── QR Code Modal ─────────────────────────────────────────────────────────────

function QRCodeModal({ woNumber, partName, quantity, onClose }: {
  woNumber: string; partName: string; quantity: number; onClose: () => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [dataUrl, setDataUrl] = useState('');

  useEffect(() => {
    const text = woNumber;
    QRCodeLib.toDataURL(text, { width: 256, margin: 2, color: { dark: '#1e293b', light: '#ffffff' } })
      .then(setDataUrl)
      .catch(() => {});
    if (canvasRef.current) {
      QRCodeLib.toCanvas(canvasRef.current, text, { width: 256, margin: 2, color: { dark: '#1e293b', light: '#ffffff' } })
        .catch(() => {});
    }
  }, [woNumber]);

  const handlePrint = () => {
    const win = window.open('', '_blank', 'width=400,height=500');
    if (!win) return;
    win.document.write(`<!DOCTYPE html><html><head><title>WO ${woNumber}</title>
      <style>
        body { font-family: system-ui, sans-serif; padding: 32px; text-align: center; }
        img { width: 220px; height: 220px; }
        h2 { font-size: 22px; font-weight: 700; margin: 12px 0 4px; }
        p { color: #64748b; font-size: 14px; margin: 2px 0; }
        @media print { body { padding: 0; } }
      </style></head><body>
      <img src="${dataUrl}" alt="QR" />
      <h2>${woNumber}</h2>
      <p>${partName}</p>
      <p>Qty: ${quantity}</p>
      <script>window.onload = () => { window.print(); window.close(); }<\/script>
    </body></html>`);
    win.document.close();
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-[60] flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl p-6 max-w-xs w-full" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-semibold text-gray-900">Work Order QR</h3>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100">
            <X size={16} className="text-gray-500" />
          </button>
        </div>
        <div className="flex flex-col items-center gap-3">
          {dataUrl ? (
            <img src={dataUrl} alt="QR code" className="w-48 h-48 rounded-lg border border-gray-200" />
          ) : (
            <div className="w-48 h-48 bg-gray-100 rounded-lg flex items-center justify-center">
              <span className="text-gray-400 text-sm">Generating…</span>
            </div>
          )}
          <div className="text-center">
            <div className="font-bold text-gray-900 text-lg">{woNumber}</div>
            <div className="text-gray-500 text-sm">{partName}</div>
            <div className="text-gray-400 text-xs">Qty: {quantity}</div>
          </div>
          <button
            onClick={handlePrint}
            disabled={!dataUrl}
            className="w-full flex items-center justify-center gap-2 py-2.5 px-4 bg-slate-800 text-white text-sm font-medium rounded-xl hover:bg-slate-700 disabled:opacity-50 transition-colors"
          >
            <Printer size={15} /> Print Label
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Work Order Comments Panel ─────────────────────────────────────────────────

interface WOComment { id: string; author_name: string; body: string; created_at: string; author_id?: string; }

function WOCommentsPanel({ woId, currentUserId }: { woId: string; currentUserId?: string }) {
  const [comments, setComments] = useState<WOComment[]>([]);
  const [draft, setDraft] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    try { setComments(await api.getWorkOrderComments(woId)); } catch { /* ignore */ }
  }, [woId]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [comments]);

  const submit = async () => {
    if (!draft.trim()) return;
    setSubmitting(true);
    try {
      await api.addWorkOrderComment(woId, draft.trim());
      setDraft('');
      await load();
    } catch { /* ignore */ } finally { setSubmitting(false); }
  };

  const deleteComment = async (id: string) => {
    try {
      await api.deleteWorkOrderComment(woId, id);
      await load();
    } catch { /* ignore */ }
  };

  const fmt = (iso: string) => new Date(iso).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

  return (
    <div className="pt-3 border-t border-gray-100">
      <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-gray-500 mb-2">
        <MessageSquare size={12} />
        Comments {comments.length > 0 && `(${comments.length})`}
      </div>
      <div className="space-y-2 max-h-40 overflow-y-auto mb-3 pr-1">
        {comments.length === 0 && (
          <p className="text-xs text-gray-400 italic">No comments yet. Add a note for your team.</p>
        )}
        {comments.map(c => (
          <div key={c.id} className="flex gap-2 group">
            <div className="w-6 h-6 rounded-full bg-indigo-100 flex-shrink-0 flex items-center justify-center text-[10px] font-bold text-indigo-600">
              {c.author_name.charAt(0).toUpperCase()}
            </div>
            <div className="flex-1 bg-gray-50 rounded-lg px-2.5 py-1.5">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[11px] font-semibold text-gray-700">{c.author_name}</span>
                <div className="flex items-center gap-1">
                  <span className="text-[10px] text-gray-400">{fmt(c.created_at)}</span>
                  {(c.author_id === currentUserId) && (
                    <button
                      onClick={() => deleteComment(c.id)}
                      className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-red-100 transition-all"
                    >
                      <Trash size={10} className="text-red-400" />
                    </button>
                  )}
                </div>
              </div>
              <p className="text-xs text-gray-600 mt-0.5 leading-relaxed">{c.body}</p>
            </div>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>
      <div className="flex gap-2">
        <textarea
          className="flex-1 text-xs border border-gray-200 rounded-lg px-2.5 py-2 resize-none focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-400"
          rows={2}
          placeholder="Add a comment…"
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submit(); }}
        />
        <button
          onClick={submit}
          disabled={submitting || !draft.trim()}
          className="px-3 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-40 transition-colors flex-shrink-0 self-end"
        >
          <Send size={13} />
        </button>
      </div>
    </div>
  );
}

// ── Modal Component ───────────────────────────────────────────────────────────

function WOModal({
  title,
  form,
  apps,
  departments,
  saving,
  onChange,
  onSave,
  onClose,
  entityId,
  currentUserId,
}: {
  title: string;
  form: WOFormData;
  apps: App[];
  departments: Department[];
  saving: boolean;
  onChange: (field: keyof WOFormData, value: any) => void;
  onSave: () => void;
  onClose: () => void;
  entityId?: string;
  currentUserId?: string;
}) {
  const [showQR, setShowQR] = useState(false);

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-5 border-b border-gray-200 sticky top-0 bg-white rounded-t-2xl">
          <h2 className="font-semibold text-gray-900 text-lg">{title}</h2>
          <div className="flex items-center gap-2">
            {entityId && (
              <button
                onClick={() => setShowQR(true)}
                title="Print QR code"
                className="p-1.5 rounded-lg hover:bg-gray-100 transition-colors text-gray-400 hover:text-gray-600"
              >
                <QrCode size={16} />
              </button>
            )}
            <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100 transition-colors">
              <X size={18} className="text-gray-500" />
            </button>
          </div>
        </div>
        {showQR && (
          <QRCodeModal
            woNumber={form.work_order_number}
            partName={form.part_name}
            quantity={form.quantity_total}
            onClose={() => setShowQR(false)}
          />
        )}

        <div className="p-5 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">WO Number</label>
              <input
                className="input-field"
                value={form.work_order_number}
                onChange={e => onChange('work_order_number', e.target.value)}
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Part Number</label>
              <input
                className="input-field"
                placeholder="e.g. PN-12345"
                value={form.part_number}
                onChange={e => onChange('part_number', e.target.value)}
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Part Name</label>
            <input
              className="input-field"
              placeholder="e.g. Hydraulic Pump Assembly"
              value={form.part_name}
              onChange={e => onChange('part_name', e.target.value)}
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">App</label>
              <div className="relative">
                <select
                  className="input-field appearance-none pr-8"
                  value={form.app_id}
                  onChange={e => onChange('app_id', e.target.value)}
                >
                  <option value="">— Select App —</option>
                  {apps.filter(a => a.status === 'published').map(a => (
                    <option key={a.id} value={a.id}>{a.name}</option>
                  ))}
                </select>
                <ChevronDown size={14} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Department</label>
              <div className="relative">
                <select
                  className="input-field appearance-none pr-8"
                  value={form.department}
                  onChange={e => onChange('department', e.target.value)}
                >
                  <option value="">— Select Department —</option>
                  {departments.map(d => (
                    <option key={d.id} value={d.name}>{d.name}</option>
                  ))}
                  {departments.length === 0 && (
                    <option value="Assembly">Assembly</option>
                  )}
                </select>
                <ChevronDown size={14} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
              </div>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Quantity</label>
              <input
                type="number"
                min={1}
                className="input-field"
                value={form.quantity_total}
                onChange={e => onChange('quantity_total', Number(e.target.value))}
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Priority</label>
              <div className="relative">
                <select
                  className="input-field appearance-none pr-8"
                  value={form.priority}
                  onChange={e => onChange('priority', e.target.value)}
                >
                  {(['critical', 'high', 'medium', 'low'] as const).map(p => (
                    <option key={p} value={p}>{p.charAt(0).toUpperCase() + p.slice(1)}</option>
                  ))}
                </select>
                <ChevronDown size={14} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Status</label>
              <div className="relative">
                <select
                  className="input-field appearance-none pr-8"
                  value={form.status}
                  onChange={e => onChange('status', e.target.value)}
                >
                  {(['pending', 'in_progress', 'completed', 'overdue'] as const).map(s => (
                    <option key={s} value={s}>{STATUS_LABELS[s]}</option>
                  ))}
                </select>
                <ChevronDown size={14} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Scheduled Start</label>
              <input
                type="datetime-local"
                className="input-field"
                value={form.scheduled_start}
                onChange={e => onChange('scheduled_start', e.target.value)}
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Scheduled End</label>
              <input
                type="datetime-local"
                className="input-field"
                value={form.scheduled_end}
                onChange={e => onChange('scheduled_end', e.target.value)}
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Takt Time (min/unit)</label>
            <input
              type="number"
              min={0.1}
              step={0.1}
              className="input-field"
              value={form.takt_time}
              onChange={e => onChange('takt_time', Number(e.target.value))}
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Notes</label>
            <textarea
              className="input-field resize-none"
              rows={2}
              placeholder="Optional notes…"
              value={form.notes}
              onChange={e => onChange('notes', e.target.value)}
            />
          </div>

          {entityId && (
            <div className="pt-2 border-t border-gray-100">
              <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-gray-500 mb-2">
                <History size={12} />
                Activity
              </div>
              <ActivityLog entityType="work_order" entityId={entityId} />
            </div>
          )}

          {entityId && <WOCommentsPanel woId={entityId} currentUserId={currentUserId} />}
        </div>

        <div className="flex items-center justify-end gap-3 px-5 pb-5">
          <button onClick={onClose} className="btn-secondary">Cancel</button>
          <button onClick={onSave} disabled={saving} className="btn-primary">
            {saving ? 'Saving…' : 'Save Work Order'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Main Component ─────────────────────────────────────────────────────────────

type ViewMode = 'list' | 'gantt';

export default function Schedule() {
  const { selectedSiteId } = useSite();
  const { canEdit, user } = useAuth();
  const { highlightId, isHighlighted, highlightRef } = useHighlight();
  const [workOrders, setWorkOrders] = useState<WorkOrder[]>([]);
  const [apps, setApps] = useState<App[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [loading, setLoading] = useState(true);

  const [viewMode, setViewMode] = useState<ViewMode>('list');
  const [statusFilter, setStatusFilter] = useState('All');
  const [priorityFilter, setPriorityFilter] = useState('All');
  const [deptFilter, setDeptFilter] = useState('All');
  const [search, setSearch] = useState('');

  const applySavedView = (f: ScheduleViewFilters) => {
    setStatusFilter(f.statusFilter);
    setPriorityFilter(f.priorityFilter);
    setDeptFilter(f.deptFilter);
    setSearch(f.search);
    setViewMode(f.viewMode);
  };

  const [showCreate, setShowCreate] = useState(false);
  const [editTarget, setEditTarget] = useState<WorkOrder | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<WorkOrder | null>(null);
  const [form, setForm] = useState<WOFormData>(defaultForm());
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const siteParams = { site_id: selectedSiteId || undefined };
      const [wos, appList, deptList] = await Promise.all([
        api.getWorkOrders(siteParams),
        api.getApps(),
        api.getDepartments(siteParams).catch(() => []),
      ]);
      setWorkOrders(wos ?? []);
      setApps(appList ?? []);
      setDepartments(deptList ?? []);
    } catch {
      setWorkOrders([]);
    } finally {
      setLoading(false);
    }
  }, [selectedSiteId]);

  useEffect(() => { load(); }, [load]);

  const handleChange = (field: keyof WOFormData, value: any) => {
    setForm(prev => ({ ...prev, [field]: value }));
  };

  const openCreate = () => {
    setForm(defaultForm());
    setShowCreate(true);
  };

  const openEdit = (wo: WorkOrder) => {
    setForm({
      work_order_number: wo.work_order_number,
      part_number: wo.part_number,
      part_name: wo.part_name,
      app_id: wo.app_id,
      department: wo.department,
      quantity_total: wo.quantity_total,
      priority: wo.priority,
      status: wo.status,
      scheduled_start: toDatetimeLocal(wo.scheduled_start),
      scheduled_end: toDatetimeLocal(wo.scheduled_end),
      takt_time: wo.takt_time,
      notes: wo.notes,
    });
    setEditTarget(wo);
  };

  const handleSaveCreate = async () => {
    setSaving(true);
    try {
      await api.createWorkOrder(form);
      setShowCreate(false);
      await load();
    } catch (e: any) {
      alert(e.message ?? 'Failed to create work order');
    } finally {
      setSaving(false);
    }
  };

  const handleSaveEdit = async () => {
    if (!editTarget) return;
    setSaving(true);
    try {
      await api.updateWorkOrder(editTarget.id, form);
      setEditTarget(null);
      await load();
    } catch (e: any) {
      alert(e.message ?? 'Failed to update work order');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setSaving(true);
    try {
      await api.deleteWorkOrder(deleteTarget.id);
      setDeleteTarget(null);
      await load();
    } catch (e: any) {
      alert(e.message ?? 'Failed to delete work order');
    } finally {
      setSaving(false);
    }
  };

  const handleMarkComplete = async (wo: WorkOrder) => {
    try {
      await api.updateWorkOrder(wo.id, { ...wo, status: 'completed' });
      await load();
    } catch { /* ignore */ }
  };

  // Filtering
  const deptOptions = ['All', ...Array.from(new Set(workOrders.map(w => w.department).filter(Boolean)))];
  const filtered = workOrders.filter(wo => {
    if (statusFilter !== 'All' && wo.status !== statusFilter) return false;
    if (priorityFilter !== 'All' && wo.priority !== priorityFilter) return false;
    if (deptFilter !== 'All' && wo.department !== deptFilter) return false;
    if (search) {
      const q = search.toLowerCase();
      if (
        !wo.work_order_number.toLowerCase().includes(q) &&
        !wo.part_name.toLowerCase().includes(q) &&
        !wo.part_number.toLowerCase().includes(q)
      ) return false;
    }
    return true;
  });

  // Gantt date range
  const ganttDates = filtered.flatMap(wo => [new Date(wo.scheduled_start), new Date(wo.scheduled_end)]);
  const minDate = ganttDates.length > 0 ? new Date(Math.min(...ganttDates.map(d => d.getTime()))) : new Date();
  const maxDate = ganttDates.length > 0 ? new Date(Math.max(...ganttDates.map(d => d.getTime()))) : new Date(Date.now() + 7 * 86400000);
  const ganttByDept = filtered.reduce<Record<string, WorkOrder[]>>((acc, wo) => {
    const dept = wo.department || 'Unassigned';
    if (!acc[dept]) acc[dept] = [];
    acc[dept].push(wo);
    return acc;
  }, {});

  return (
    <div className="min-h-screen bg-[#f8fafc] p-6 space-y-5">
      <ModuleOnboarding
        moduleId="schedule"
        title="Schedule"
        description="Schedule lets you plan production runs and assign work orders across your team."
        steps={[
          "Create a work order for each production job",
          "Set quantity, app, department, and due date",
          "Drag to reschedule or adjust priorities",
          "Track progress as operators complete runs",
        ]}
        icon={Calendar}
        color="#6366f1"
      />
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <Calendar size={20} className="text-blue-600" />
            <h1 className="text-2xl font-bold text-gray-900">Schedule</h1>
          </div>
          <p className="text-gray-500 text-sm mt-0.5">Work order management and production scheduling</p>
        </div>
        {canEdit && (
          <button onClick={openCreate} className="btn-primary flex-shrink-0 whitespace-nowrap self-start sm:self-auto">
            <Plus size={16} />
            New Work Order
          </button>
        )}
      </div>

      {/* Filter Bar */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4 flex flex-wrap items-center gap-3">
        {/* Search */}
        <div className="relative flex-1 min-w-[200px]">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            className="input-field pl-9"
            placeholder="Search WO#, part name…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <Filter size={14} className="text-gray-400" />
          {/* Status */}
          <FilterSelect
            value={statusFilter}
            onChange={setStatusFilter}
            options={STATUS_OPTIONS.map(s => ({ value: s, label: s === 'All' ? 'All Statuses' : STATUS_LABELS[s] ?? s }))}
          />
          {/* Priority */}
          <FilterSelect
            value={priorityFilter}
            onChange={setPriorityFilter}
            options={PRIORITY_OPTIONS.map(p => ({ value: p, label: p === 'All' ? 'All Priorities' : p.charAt(0).toUpperCase() + p.slice(1) }))}
          />
          {/* Department */}
          <FilterSelect
            value={deptFilter}
            onChange={setDeptFilter}
            options={deptOptions.map(d => ({ value: d, label: d === 'All' ? 'All Depts' : d }))}
          />
        </div>

        <SavedViewsBar<ScheduleViewFilters>
          storageKey="hm_saved_views_schedule"
          currentFilters={{ statusFilter, priorityFilter, deptFilter, search, viewMode }}
          onApply={applySavedView}
        />

        {/* View toggle */}
        <div className="flex items-center gap-1 bg-gray-100 rounded-lg p-1 ml-auto">
          <button
            onClick={() => setViewMode('list')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${viewMode === 'list' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
          >
            <List size={13} /> List
          </button>
          <button
            onClick={() => setViewMode('gantt')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${viewMode === 'gantt' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
          >
            <BarChart2 size={13} /> Gantt
          </button>
        </div>
      </div>

      {/* Content */}
      {loading ? (
        <div className="flex items-center justify-center h-48 text-gray-400 text-sm">Loading…</div>
      ) : viewMode === 'list' ? (
        <ListView
          workOrders={filtered}
          onEdit={openEdit}
          onDelete={setDeleteTarget}
          onComplete={handleMarkComplete}
          isHighlighted={isHighlighted}
          highlightRef={highlightRef}
          canEdit={canEdit}
        />
      ) : (
        <GanttView
          byDept={ganttByDept}
          minDate={minDate}
          maxDate={maxDate}
        />
      )}

      {/* Create Modal */}
      {showCreate && (
        <WOModal
          title="New Work Order"
          form={form}
          apps={apps}
          departments={departments}
          saving={saving}
          onChange={handleChange}
          onSave={handleSaveCreate}
          onClose={() => setShowCreate(false)}
          currentUserId={user?.id}
        />
      )}

      {/* Edit Modal */}
      {editTarget && (
        <WOModal
          title={`Edit ${editTarget.work_order_number}`}
          form={form}
          apps={apps}
          departments={departments}
          saving={saving}
          onChange={handleChange}
          onSave={handleSaveEdit}
          onClose={() => setEditTarget(null)}
          entityId={editTarget.id}
          currentUserId={user?.id}
        />
      )}

      {/* Delete Confirm */}
      {deleteTarget && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl p-6 w-full max-w-sm">
            <div className="flex items-center gap-3 mb-3">
              <div className="w-10 h-10 bg-red-100 rounded-full flex items-center justify-center">
                <AlertTriangle size={20} className="text-red-600" />
              </div>
              <h3 className="font-semibold text-gray-900">Delete Work Order?</h3>
            </div>
            <p className="text-sm text-gray-600 mb-5">
              This will permanently delete <strong>{deleteTarget.work_order_number}</strong> – {deleteTarget.part_name}. This cannot be undone.
            </p>
            <div className="flex items-center gap-3 justify-end">
              <button onClick={() => setDeleteTarget(null)} className="btn-secondary">Cancel</button>
              <button onClick={handleDelete} disabled={saving} className="btn-danger">
                {saving ? 'Deleting…' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── List View ─────────────────────────────────────────────────────────────────

function ListView({
  workOrders,
  onEdit,
  onDelete,
  onComplete,
  isHighlighted,
  highlightRef,
  canEdit,
}: {
  workOrders: WorkOrder[];
  onEdit: (wo: WorkOrder) => void;
  onDelete: (wo: WorkOrder) => void;
  onComplete: (wo: WorkOrder) => void;
  isHighlighted: (id: string) => boolean;
  highlightRef: (id: string) => (el: HTMLElement | null) => void;
  canEdit: boolean;
}) {
  if (workOrders.length === 0) {
    return (
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm py-16 text-center text-gray-400 text-sm">
        <Package size={32} className="mx-auto mb-3 text-gray-300" />
        No work orders match your filters
      </div>
    );
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm whitespace-nowrap">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr>
              {['WO #', 'Part', 'Department', 'Quantity', 'Priority', 'Scheduled', 'Status', 'Actions'].map(h => (
                <th key={h} className="text-left text-xs font-medium text-gray-500 uppercase tracking-wide px-4 py-3">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {workOrders.map(wo => {
              const pct = wo.quantity_total > 0 ? Math.round((wo.quantity_completed / wo.quantity_total) * 100) : 0;
              return (
                <tr
                  key={wo.id}
                  ref={highlightRef(wo.id)}
                  className={`hover:bg-gray-50 transition-colors ${isHighlighted(wo.id) ? 'nav-highlight' : ''}`}
                >
                  <td className="px-4 py-3">
                    <span className="font-mono text-xs font-semibold text-blue-700">{wo.work_order_number}</span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="font-medium text-gray-900 text-xs">{wo.part_name}</div>
                    <div className="text-xs text-gray-400">{wo.part_number}</div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1.5 text-xs text-gray-600">
                      <Building2 size={11} />
                      {wo.department || '—'}
                    </div>
                  </td>
                  <td className="px-4 py-3 min-w-[120px]">
                    <div className="text-xs text-gray-700 mb-1">{wo.quantity_completed} / {wo.quantity_total}</div>
                    <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden w-20">
                      <div
                        className={`h-full rounded-full ${GANTT_BAR_CLASSES[wo.status] ?? 'bg-gray-400'}`}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${PRIORITY_CLASSES[wo.priority] ?? 'bg-gray-100 text-gray-600'}`}>
                      {wo.priority}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="text-xs text-gray-600 whitespace-nowrap">
                      {formatDateLocal(wo.scheduled_start)} –
                    </div>
                    <div className="text-xs text-gray-600">{formatDateLocal(wo.scheduled_end)}</div>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_CLASSES[wo.status] ?? 'bg-gray-100 text-gray-600'}`}>
                      {STATUS_LABELS[wo.status] ?? wo.status}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    {canEdit && (
                      <div className="flex items-center gap-1.5">
                        <button
                          onClick={() => onEdit(wo)}
                          title="Edit"
                          className="p-1.5 rounded-lg hover:bg-blue-50 text-gray-400 hover:text-blue-600 transition-colors"
                        >
                          <Edit2 size={13} />
                        </button>
                        {wo.status !== 'completed' && (
                          <button
                            onClick={() => onComplete(wo)}
                            title="Mark Complete"
                            className="p-1.5 rounded-lg hover:bg-green-50 text-gray-400 hover:text-green-600 transition-colors"
                          >
                            <CheckSquare size={13} />
                          </button>
                        )}
                        <button
                          onClick={() => onDelete(wo)}
                          title="Delete"
                          className="p-1.5 rounded-lg hover:bg-red-50 text-gray-400 hover:text-red-600 transition-colors"
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Gantt View ─────────────────────────────────────────────────────────────────

function GanttView({
  byDept,
  minDate,
  maxDate,
}: {
  byDept: Record<string, WorkOrder[]>;
  minDate: Date;
  maxDate: Date;
}) {
  const totalMs = maxDate.getTime() - minDate.getTime();
  const dayCount = Math.max(1, Math.ceil(totalMs / 86400000));
  const dayLabels: Date[] = [];
  for (let i = 0; i <= Math.min(dayCount, 30); i++) {
    dayLabels.push(new Date(minDate.getTime() + i * 86400000));
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
      {/* Timeline header */}
      <div className="flex border-b border-gray-200 bg-gray-50">
        <div className="w-48 flex-shrink-0 px-4 py-2 text-xs font-medium text-gray-500 border-r border-gray-200">Department / WO</div>
        <div className="flex-1 relative overflow-hidden">
          <div className="flex" style={{ minWidth: '100%' }}>
            {dayLabels.map((d, i) => (
              <div key={i} className="flex-1 text-center text-xs text-gray-400 py-2 border-r border-gray-100 last:border-r-0">
                {d.toLocaleDateString([], { month: 'short', day: 'numeric' })}
              </div>
            ))}
          </div>
        </div>
      </div>

      {Object.keys(byDept).length === 0 && (
        <div className="py-12 text-center text-gray-400 text-sm">No work orders to display</div>
      )}

      {Object.entries(byDept).map(([dept, wos]) => (
        <Fragment key={dept}>
          {/* Dept row */}
          <div className="flex items-center bg-gray-50 border-b border-gray-200">
            <div className="w-48 flex-shrink-0 px-4 py-2 text-xs font-semibold text-gray-700 flex items-center gap-1.5 border-r border-gray-200">
              <Building2 size={12} className="text-gray-400" />
              {dept}
            </div>
            <div className="flex-1 py-2 px-2" />
          </div>
          {/* WO rows */}
          {wos.map(wo => {
            const { left, width } = ganttPosition(wo.scheduled_start, wo.scheduled_end, minDate, maxDate);
            const barCls = GANTT_BAR_CLASSES[wo.status] ?? 'bg-gray-400';
            const today = new Date();
            const todayPct = ((today.getTime() - minDate.getTime()) / totalMs) * 100;
            return (
              <div key={wo.id} className="flex items-center border-b border-gray-100 hover:bg-gray-50 transition-colors h-10">
                <div className="w-48 flex-shrink-0 px-4 text-xs text-gray-700 truncate border-r border-gray-100 flex flex-col justify-center">
                  <span className="font-mono font-semibold text-blue-700">{wo.work_order_number}</span>
                  <span className="text-gray-500 truncate">{wo.part_name}</span>
                </div>
                <div className="flex-1 relative h-full">
                  {/* Today line */}
                  {todayPct >= 0 && todayPct <= 100 && (
                    <div
                      className="absolute top-0 bottom-0 w-0.5 bg-red-400 opacity-60 z-10"
                      style={{ left: `${todayPct}%` }}
                    />
                  )}
                  {/* Bar */}
                  <div
                    title={`${wo.work_order_number}: ${formatDateLocal(wo.scheduled_start)} – ${formatDateLocal(wo.scheduled_end)}`}
                    className={`absolute top-2 bottom-2 rounded-md ${barCls} opacity-80 hover:opacity-100 transition-opacity cursor-default flex items-center px-2 overflow-hidden`}
                    style={{ left: `${left}%`, width: `${width}%` }}
                  >
                    <span className="text-white text-xs font-medium truncate">{wo.part_name}</span>
                  </div>
                </div>
              </div>
            );
          })}
        </Fragment>
      ))}

      {/* Legend */}
      <div className="flex items-center gap-4 px-4 py-3 bg-gray-50 border-t border-gray-200">
        {Object.entries(GANTT_BAR_CLASSES).map(([status, cls]) => (
          <div key={status} className="flex items-center gap-1.5 text-xs text-gray-600">
            <span className={`w-3 h-3 rounded ${cls}`} />
            {STATUS_LABELS[status] ?? status}
          </div>
        ))}
        <div className="flex items-center gap-1.5 text-xs text-gray-600 ml-4">
          <span className="w-3 h-3 flex items-center justify-center"><span className="w-0.5 h-3 bg-red-400 rounded" /></span>
          Today
        </div>
      </div>
    </div>
  );
}

// ── Shared Components ─────────────────────────────────────────────────────────

function FilterSelect({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <div className="relative">
      <select
        value={value}
        onChange={e => onChange(e.target.value)}
        className="input-field appearance-none pr-7 text-xs py-1.5 h-auto"
      >
        {options.map(o => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
      <ChevronDown size={12} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
    </div>
  );
}

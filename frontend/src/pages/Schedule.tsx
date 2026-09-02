import { useEffect, useState, useCallback, useRef, Fragment } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../api/client';
import type { Kit } from '../types';
import { useHighlight } from '../hooks/useHighlight';
import { useSite } from '../context/SiteContext';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import ActivityLog from '../components/shared/ActivityLog';
import SavedViewsBar from '../components/shared/SavedViewsBar';
import {
  Plus, Search, Filter, List, BarChart2, Edit2, Trash2, CheckSquare,
  X, ChevronDown, AlertTriangle, Calendar, Package, Building2, Clock, History,
  MessageSquare, Send, QrCode, Printer, Trash, PackageOpen, Flag, ExternalLink,
  Upload, FileDown, CheckCircle2, XCircle, RefreshCw, GitBranch, PlayCircle, Factory,
} from 'lucide-react';
import ModuleOnboarding from '../components/shared/ModuleOnboarding';
import DepartmentFilter from '../components/shared/DepartmentFilter';
import WipSearch from '../components/shared/WipSearch';
import { useDepartmentFilter } from '../hooks/useDepartmentFilter';
import { getFloorDispatch, type DispatchRow } from '../api/floor';
import { dispatchRowLabel } from '../api/operator';
import { buildPlayLink } from '../components/player/runtime';
import { displayId } from '../utils/ids';
import {
  previewWorkOrderImport, commitWorkOrderImport, verdictLabel,
  IMPORT_COLUMNS, IMPORT_TEMPLATE_URL,
  type ImportOutcome, type ImportRowVerdict,
} from '../api/workOrders';
import {
  releaseWorkOrder, getOperations, updateOperation,
  operationLine, OPERATION_STATUS_LABELS,
  type WorkOrderOperation, type CurrentOperation,
} from '../api/operations';
import { fmtDuration } from '../components/apps/appModel';
import QRCodeLib from 'qrcode';

// ── Types ─────────────────────────────────────────────────────────────────────

interface WorkOrder {
  id: string;
  work_order_number: string;
  part_number: string;
  part_name: string;
  app_id: string;
  app_name: string;
  department_id: string | null;
  department_name?: string | null;
  quantity: number;
  quantity_completed: number;
  priority: 'critical' | 'high' | 'medium' | 'low';
  status: 'pending' | 'in_progress' | 'completed' | 'overdue';
  schedule_status: 'on_track' | 'at_risk' | 'behind' | 'not_started';
  scheduled_start: string;
  scheduled_end: string;
  takt_time_minutes: number;
  notes: string;
  product_type_id?: string | null;
  /** The date the customer needs it, YYYY-MM-DD. null when nobody has said. */
  due_date?: string | null;
  /** Customer / sales-order reference off the paperwork. */
  customer_ref?: string | null;
  /** The ERP's own id for this job — the key a re-import matches on. */
  external_id?: string | null;
  /** The routing this job runs on, and its name. null until one is picked. */
  routing_id?: string | null;
  routing_name?: string | null;
  /** When the routing became this job's operations. null = never released. */
  released_at?: string | null;
  /** Why the job is stopped. A column, not a status word — a status cannot
   *  say why, and work_orders.status is frozen behind a CHECK. */
  hold_reason?: string | null;
  /** Where the job stands. null for a job with no operations — never a zeroed
   *  object, which would read as "operation 0 of 0". */
  current_operation?: CurrentOperation | null;
}

interface RoutingOption {
  id: string;
  name: string;
  step_count?: number;
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

interface ProductTypeOption {
  id: string;
  app_id: string;
  name: string;
}

interface LocationOption {
  id: string;
  name: string;
  code: string;
}

/** A station the Dispatch queue can be narrowed to. */
interface StationOption {
  id: string;
  name: string;
  status?: string;
  department_id?: string | null;
}

/** Kit list row — the server adds pick-progress rollups beyond the shared type. */
interface KitRow extends Kit {
  n_picked?: number;
  n_short?: number;
}

interface WOFormData {
  work_order_number: string;
  part_number: string;
  part_name: string;
  app_id: string;
  department_id: string;
  product_type_id: string;
  quantity: number;
  priority: 'critical' | 'high' | 'medium' | 'low';
  status: 'pending' | 'in_progress' | 'completed' | 'overdue';
  scheduled_start: string;
  scheduled_end: string;
  takt_time_minutes: number;
  notes: string;
  due_date: string;
  customer_ref: string;
  routing_id: string;
  hold_reason: string;
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
  // The chip label is 12px, so it needs 4.5:1 rather than the 3:1 these shades
  // were picked for: orange-600 measured 3.56:1 and blue-500 3.68:1 under white.
  critical: 'bg-red-600 text-white',
  high:     'bg-orange-700 text-white',
  medium:   'bg-blue-600 text-white',
  low:      'bg-gray-600 text-white',
};
const GANTT_BAR_CLASSES: Record<string, string> = {
  pending:     'bg-gray-400',
  in_progress: 'bg-blue-500',
  completed:   'bg-green-500',
  overdue:     'bg-red-500',
};
// The six words vocab.OPERATION_STATUS allows, and nothing else — a chip with
// no entry falls back to grey rather than inventing a seventh state.
const OP_STATUS_CLASSES: Record<string, string> = {
  queued:   'bg-gray-100 text-gray-600',
  ready:    'bg-blue-100 text-blue-700',
  running:  'bg-indigo-100 text-indigo-700',
  complete: 'bg-green-100 text-green-700',
  skipped:  'bg-gray-100 text-gray-500',
  on_hold:  'bg-amber-100 text-amber-700',
};
const KIT_STATUS_CLASSES: Record<string, string> = {
  open:      'bg-gray-100 text-gray-600',
  picking:   'bg-blue-100 text-blue-700',
  complete:  'bg-green-100 text-green-700',
  short:     'bg-amber-100 text-amber-700',
  cancelled: 'bg-gray-50 text-gray-400',
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatDateLocal(iso: string) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleDateString([], { month: 'short', day: 'numeric', year: '2-digit' });
}

function Skeleton({ className }: { className?: string }) {
  return <div className={`animate-pulse bg-gray-200 rounded ${className ?? ''}`} />;
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
    department_id: '',
    product_type_id: '',
    quantity: 100,
    priority: 'medium',
    status: 'pending',
    scheduled_start: toDatetimeLocal(now.toISOString()),
    scheduled_end: toDatetimeLocal(end.toISOString()),
    takt_time_minutes: 5,
    notes: '',
    due_date: '',
    customer_ref: '',
    routing_id: '',
    hold_reason: '',
  };
}

/** A due date printed as a plain day. Empty stays empty — never today's date. */
function formatDueDate(due?: string | null) {
  if (!due) return '—';
  const d = new Date(`${due}T00:00:00`);
  if (isNaN(d.getTime())) return due;
  return d.toLocaleDateString([], { month: 'short', day: 'numeric', year: '2-digit' });
}

/** API payload from the form — product_type_id/department_id empty string → null. */
function toPayload(form: WOFormData) {
  return {
    ...form,
    department_id: form.department_id || null,
    product_type_id: form.product_type_id || null,
    due_date: form.due_date || null,
    customer_ref: form.customer_ref || null,
    routing_id: form.routing_id || null,
    hold_reason: form.hold_reason.trim() || null,
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
            className="w-full flex items-center justify-center gap-2 py-2.5 px-4 bg-slate-800 dark:bg-slate-600 text-white text-sm font-medium rounded-xl hover:bg-slate-700 dark:hover:bg-slate-500 disabled:opacity-50 transition-colors"
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
                      <Trash size={10} className="text-red-500" />
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
  kit,
  locations,
  generatingKit,
  onGenerateKit,
  routings,
  workOrder,
  operations,
  releasing,
  onRelease,
  onSkipOperation,
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
  /** Existing (non-cancelled) kit for this WO, when editing. */
  kit?: KitRow | null;
  locations?: LocationOption[];
  generatingKit?: boolean;
  onGenerateKit?: (locationId: string) => void;
  /** Routings this company has. Empty on a Free account — designing a routing
   *  is a Pro feature, even though releasing and running a job is not. */
  routings: RoutingOption[];
  /** The stored work order, when editing — released_at is the fact that
   *  decides whether this drawer offers Release or lists operations. */
  workOrder?: WorkOrder | null;
  operations?: WorkOrderOperation[];
  releasing?: boolean;
  onRelease?: () => void;
  onSkipOperation?: (operationId: string) => void;
}) {
  const [showQR, setShowQR] = useState(false);
  const [kitLocationId, setKitLocationId] = useState('');

  // Released is a FACT off the stored work order, never a guess from the form:
  // picking a routing in the drawer does not release anything until Release is
  // pressed, and a released job must never offer the button again.
  const released = Boolean(workOrder?.released_at);
  // A finished or cancelled job is not something to start. Release cannot be
  // undone, so the server refuses it (409 work_order_closed) and the button
  // does not sit there inviting the press.
  // Compared as a plain string: the server's work-order vocabulary also has
  // 'cancelled', which this file's narrower union never learned about.
  const jobStatus = String(workOrder?.status ?? '');
  const jobClosed = jobStatus === 'completed' || jobStatus === 'cancelled';
  const opList = operations ?? [];
  // How many operations Release will actually create — the routing's step
  // count, straight off the list the server sent. A routing with no steps
  // cannot be released, and the line under the button says so instead of
  // promising "Creates 0 operations".
  const pickedSteps = routings.find(r => r.id === form.routing_id)?.step_count ?? 0;

  // Product types for the selected app — drives BOM resolution at kit generation.
  const [productTypes, setProductTypes] = useState<ProductTypeOption[]>([]);
  useEffect(() => {
    let cancelled = false;
    if (!form.app_id) { setProductTypes([]); return; }
    api.getProductTypes(form.app_id)
      .then((rows: ProductTypeOption[]) => { if (!cancelled) setProductTypes(rows); })
      .catch(() => { if (!cancelled) setProductTypes([]); });
    return () => { cancelled = true; };
  }, [form.app_id]);

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
            quantity={form.quantity}
            onClose={() => setShowQR(false)}
          />
        )}

        <div className="p-5 space-y-4">
          <div className="field-row gap-4">
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

          <div className="field-row gap-4">
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">App</label>
              <div className="relative">
                <select
                  className="input-field appearance-none pr-8"
                  value={form.app_id}
                  onChange={e => { onChange('app_id', e.target.value); onChange('product_type_id', ''); }}
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
                  value={form.department_id}
                  onChange={e => onChange('department_id', e.target.value)}
                >
                  <option value="">— Select Department —</option>
                  {departments.map(d => (
                    <option key={d.id} value={d.id}>{d.name}</option>
                  ))}
                </select>
                <ChevronDown size={14} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
              </div>
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Product Type</label>
            <div className="relative">
              <select
                className="input-field appearance-none pr-8"
                value={form.product_type_id}
                onChange={e => onChange('product_type_id', e.target.value)}
                disabled={!form.app_id || productTypes.length === 0}
              >
                <option value="">
                  {!form.app_id
                    ? '— Select an app first —'
                    : productTypes.length === 0
                      ? '— No product types on this app —'
                      : '— No product type —'}
                </option>
                {productTypes.map(pt => (
                  <option key={pt.id} value={pt.id}>{pt.name}</option>
                ))}
              </select>
              <ChevronDown size={14} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
            </div>
            <p className="text-[11px] text-gray-400 mt-1">
              The product type resolves the active BOM for kit generation and locks the operator's selection at run start.
            </p>
          </div>

          {/* ── Routing and operations ──
              A work order with no routing behaves exactly as it always has: one
              app, one department, no operations. Picking a routing and pressing
              Release turns it into N operations in sequence — which is what a
              seven-operation job actually is, instead of seven unrelated work
              orders sharing nothing. Released once: the operations are a
              snapshot of what the floor is running, and rebuilding them would
              throw away booked quantity. */}
          <div className="pt-3 border-t border-gray-100">
            <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-gray-500 mb-2">
              <GitBranch size={12} />
              Routing &amp; Operations
            </div>

            {released ? (
              <div className="space-y-3">
                <div className="flex flex-wrap items-center gap-2 text-xs text-gray-600">
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 font-semibold">
                    <CheckCircle2 size={11} /> Released
                  </span>
                  <span className="text-gray-500">
                    {workOrder?.routing_name || 'Routing'} · {opList.length} operation{opList.length === 1 ? '' : 's'}
                  </span>
                </div>

                <ol className="space-y-1.5">
                  {opList.map(op => (
                    <li
                      key={op.id}
                      className={`flex flex-wrap items-center gap-2 rounded-lg border px-2.5 py-2 ${
                        op.id === workOrder?.current_operation?.id
                          ? 'border-blue-200 bg-blue-50'
                          : 'border-gray-100 bg-gray-50'
                      }`}
                    >
                      <span className="text-xs text-gray-800 [font-variant-numeric:tabular-nums]">
                        {operationLine(op, fmtDuration)}
                      </span>
                      <span className="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full bg-purple-100 text-purple-700">
                        <Building2 size={10} />
                        {op.department_name || 'No department'}
                      </span>
                      <span className={`text-[11px] px-2 py-0.5 rounded-full font-semibold ${OP_STATUS_CLASSES[op.status] ?? 'bg-gray-100 text-gray-600'}`}>
                        {OPERATION_STATUS_LABELS[op.status]}
                      </span>
                      {onSkipOperation && op.status !== 'complete' && op.status !== 'skipped' && (
                        <button
                          onClick={() => onSkipOperation(op.id)}
                          className="ml-auto text-[11px] font-semibold text-gray-400 hover:text-gray-700"
                        >
                          Skip
                        </button>
                      )}
                    </li>
                  ))}
                </ol>
                {opList.length === 0 && (
                  <p className="text-xs text-gray-400">This job is released but its operations have not loaded.</p>
                )}
              </div>
            ) : (
              <div className="space-y-2">
                <div className="relative">
                  <select
                    className="input-field appearance-none pr-8"
                    value={form.routing_id}
                    onChange={e => onChange('routing_id', e.target.value)}
                    aria-label="Routing"
                  >
                    <option value="">
                      {routings.length === 0 ? '— No routings available —' : '— No routing (single operation) —'}
                    </option>
                    {routings.map(r => (
                      <option key={r.id} value={r.id}>
                        {r.name}{r.step_count !== undefined ? ` (${r.step_count} step${r.step_count === 1 ? '' : 's'})` : ''}
                      </option>
                    ))}
                  </select>
                  <ChevronDown size={14} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
                </div>

                {entityId && onRelease && jobClosed && (
                  <p className="text-[11px] text-gray-500">
                    This work order is {STATUS_LABELS[jobStatus] ?? jobStatus}. Reopen it before releasing a routing onto it.
                  </p>
                )}
                {entityId && onRelease && !jobClosed && (
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      onClick={onRelease}
                      disabled={releasing || !form.routing_id || pickedSteps === 0}
                      className="btn-secondary text-xs !py-1.5"
                    >
                      <GitBranch size={13} />
                      {releasing ? 'Releasing…' : 'Release'}
                    </button>
                    {/* Say what the button will do before it is pressed. A
                        release cannot be undone, so "Creates 7 operations for
                        quantity 50" is the whole confirmation. */}
                    <span className="text-[11px] text-gray-500">
                      {!form.routing_id
                        ? 'Pick a routing to release this job into operations.'
                        : pickedSteps === 0
                          ? 'That routing has no steps yet — add one on the Routings screen.'
                          : `Creates ${pickedSteps} operation${pickedSteps === 1 ? '' : 's'} for quantity ${form.quantity}.`}
                    </span>
                  </div>
                )}
                {!entityId && form.routing_id && (
                  <p className="text-[11px] text-gray-500">
                    {pickedSteps > 0
                      ? `Saving creates ${pickedSteps} operation${pickedSteps === 1 ? '' : 's'} for quantity ${form.quantity}.`
                      : 'That routing has no steps yet, so this job will be created without operations.'}
                  </p>
                )}
                {routings.length === 0 && (
                  <p className="text-[11px] text-gray-400">
                    No routings on this account. A job with no routing runs exactly as it always has.
                  </p>
                )}
              </div>
            )}

            <div className="mt-3">
              <label className="block text-xs font-medium text-gray-700 mb-1">Hold Reason</label>
              <input
                className="input-field"
                placeholder="Blank unless the job is stopped"
                value={form.hold_reason}
                onChange={e => onChange('hold_reason', e.target.value)}
              />
              <p className="text-[11px] text-gray-400 mt-1">
                Why this job is stopped, in words the next shift can act on. A status word cannot say why.
              </p>
            </div>
          </div>

          <div className="field-row-3 gap-4">
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Quantity</label>
              <input
                type="number"
                min={1}
                className="input-field"
                value={form.quantity}
                onChange={e => onChange('quantity', Number(e.target.value))}
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

          <div className="field-row gap-4">
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

          <div className="field-row gap-4">
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Due Date</label>
              <input
                type="date"
                className="input-field"
                value={form.due_date}
                onChange={e => onChange('due_date', e.target.value)}
              />
              <p className="text-[11px] text-gray-400 mt-1">The day the customer needs it. Leave blank if nobody has said.</p>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Customer Ref</label>
              <input
                className="input-field"
                placeholder="e.g. SO-4471"
                value={form.customer_ref}
                onChange={e => onChange('customer_ref', e.target.value)}
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
              value={form.takt_time_minutes}
              onChange={e => onChange('takt_time_minutes', Number(e.target.value))}
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

          {/* ── Material kit (BOM-driven) ── */}
          {entityId && onGenerateKit && (
            <div className="pt-3 border-t border-gray-100">
              <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-gray-500 mb-2">
                <PackageOpen size={12} />
                Material Kit
              </div>
              {kit ? (
                <div className="flex items-center gap-2 flex-wrap text-sm">
                  <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${KIT_STATUS_CLASSES[kit.status] ?? 'bg-gray-100 text-gray-600'}`}>
                    Kit {kit.status}
                  </span>
                  {kit.n_total !== undefined && (
                    <span className="text-xs text-gray-500 [font-variant-numeric:tabular-nums]">
                      {(kit.n_verified ?? 0) + (kit.n_picked ?? 0)}/{kit.n_total} picked
                    </span>
                  )}
                  {Boolean(kit.has_short) && (
                    <span className="inline-flex items-center gap-1 text-xs font-semibold text-amber-600">
                      <Flag size={11} /> short
                    </span>
                  )}
                  <Link
                    to={`/inventory/kitting/${kit.id}`}
                    className="inline-flex items-center gap-1 text-xs font-medium text-indigo-600 hover:text-indigo-700"
                  >
                    Open in Kitting <ExternalLink size={11} />
                  </Link>
                </div>
              ) : (
                <div className="flex items-center gap-2 flex-wrap">
                  <div className="relative">
                    <select
                      className="input-field appearance-none pr-8 text-xs py-1.5 h-auto"
                      value={kitLocationId}
                      onChange={e => setKitLocationId(e.target.value)}
                    >
                      <option value="">Pick-from location (optional)</option>
                      {(locations ?? []).map(l => (
                        <option key={l.id} value={l.id}>{l.name}{l.code ? ` (${l.code})` : ''}</option>
                      ))}
                    </select>
                    <ChevronDown size={12} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
                  </div>
                  <button
                    onClick={() => onGenerateKit(kitLocationId)}
                    disabled={generatingKit || !form.product_type_id}
                    title={!form.product_type_id ? 'Assign a product type (with an active BOM) first' : 'Generate a kit from the active BOM'}
                    className="btn-secondary text-xs !py-1.5"
                  >
                    <PackageOpen size={13} />
                    {generatingKit ? 'Generating…' : 'Generate Kit'}
                  </button>
                  {!form.product_type_id && (
                    <span className="text-[11px] text-gray-400">Requires a product type with an active BOM</span>
                  )}
                </div>
              )}
            </div>
          )}

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

type ViewMode = 'list' | 'gantt' | 'dispatch';

/** How a priority reads on a dispatch row. The ORDER of the queue is the
 *  server's (priority → due date → sequence); this is only its colour. */
const DISPATCH_PRIORITY_CHIP: Record<string, string> = {
  critical: 'bg-red-100 text-red-700',
  high: 'bg-orange-100 text-orange-700',
  medium: 'bg-blue-100 text-blue-700',
  low: 'bg-gray-100 text-gray-600',
};

export default function Schedule() {
  const { selectedSiteId } = useSite();
  const { canEdit, user } = useAuth();
  // Importing rewrites the week's schedule, so it is manager-or-above — the
  // same bar /api/work-orders/import/* enforces on the server.
  const canImport = user?.role === 'manager' || user?.role === 'developer';
  const { addToast } = useToast();
  const { highlightId, isHighlighted, highlightRef } = useHighlight();
  const [workOrders, setWorkOrders] = useState<WorkOrder[]>([]);
  const [apps, setApps] = useState<App[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [kitsByWo, setKitsByWo] = useState<Record<string, KitRow>>({});
  const [locations, setLocations] = useState<LocationOption[]>([]);
  const [routings, setRoutings] = useState<RoutingOption[]>([]);
  const [operations, setOperations] = useState<WorkOrderOperation[]>([]);
  const [releasing, setReleasing] = useState(false);
  const [generatingKit, setGeneratingKit] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [viewMode, setViewMode] = useState<ViewMode>('list');

  // ── Dispatch: what to run next, here ────────────────────────────────────────
  // The queue is the server's (/api/floor/dispatch) — ready and running
  // operations in priority → due date → sequence order, plus the apps that need
  // no work order. This screen never sorts it itself: the order IS the answer,
  // and two screens ordering the same queue two ways is the bug the floor
  // endpoints exist to stop.
  const navigate = useNavigate();
  const dispatchDept = useDepartmentFilter('dispatch');
  const [dispatchStationId, setDispatchStationId] = useState('');
  const [stations, setStations] = useState<StationOption[]>([]);
  const [dispatchRows, setDispatchRows] = useState<DispatchRow[]>([]);
  const [dispatchLoading, setDispatchLoading] = useState(false);
  const [dispatchError, setDispatchError] = useState<string | null>(null);
  /** How much the WHOLE plant has ready. Asked for only when the filtered list
   *  came back empty, so the ordinary path never pays for it — and it is what
   *  lets the empty state tell "nothing released" from "nothing here". */
  const [dispatchElsewhere, setDispatchElsewhere] = useState(0);

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
  const [showImport, setShowImport] = useState(false);
  const [editTarget, setEditTarget] = useState<WorkOrder | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<WorkOrder | null>(null);
  const [form, setForm] = useState<WOFormData>(defaultForm());
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const siteParams = { site_id: selectedSiteId || undefined };
      const [wos, appList, deptList, kitList, locList, routingList] = await Promise.all([
        api.getWorkOrders(siteParams),
        api.getApps(),
        api.getDepartments(siteParams).catch(() => []),
        api.getKits().catch(() => [] as KitRow[]),
        api.getLocations().catch(() => []),
        // Designing a routing is a Pro feature, so this 403s on a Free account.
        // Releasing a job is not, which is why the failure is an empty picker
        // rather than an error on the page.
        api.getRoutings().catch(() => [] as RoutingOption[]),
      ]);
      setWorkOrders(Array.isArray(wos) ? wos : []);
      setApps(Array.isArray(appList) ? appList : []);
      setDepartments(Array.isArray(deptList) ? deptList : []);
      const byWo: Record<string, KitRow> = {};
      for (const k of (Array.isArray(kitList) ? kitList as KitRow[] : [])) {
        if (k.status !== 'cancelled') byWo[k.work_order_id] = k;
      }
      setKitsByWo(byWo);
      setLocations(Array.isArray(locList) ? (locList as LocationOption[]) : []);
      setRoutings(Array.isArray(routingList) ? (routingList as RoutingOption[]) : []);
      // Best-effort: the Dispatch station picker is a narrowing, not a gate.
      api.getStations(selectedSiteId ? { site_id: selectedSiteId } : undefined)
        .then((rows: StationOption[]) => setStations(
          (Array.isArray(rows) ? rows : []).filter(st => st.status !== 'inactive')
        ))
        .catch(() => setStations([]));
    } catch (e: any) {
      setWorkOrders([]);
      setLoadError(e?.message || 'Failed to load work orders');
    } finally {
      setLoading(false);
    }
  }, [selectedSiteId]);

  useEffect(() => { load(); }, [load]);

  /** The queue for the picked department / station. Reloaded when either
   *  changes, and when the tab is opened — a dispatch list is only useful if it
   *  is what the floor looks like now. */
  const loadDispatch = useCallback(async () => {
    setDispatchLoading(true);
    setDispatchError(null);
    try {
      const scoped = !!(dispatchDept.departmentId || dispatchStationId);
      const res = await getFloorDispatch({
        site_id: selectedSiteId || undefined,
        department_id: dispatchDept.departmentId || undefined,
        station_id: dispatchStationId || undefined,
      });
      setDispatchRows(res.rows);
      // Only when this came back empty under a filter is the second question
      // worth asking — and only then is the answer worth anything.
      if (res.rows.length === 0 && scoped) {
        const plant = await getFloorDispatch({ site_id: selectedSiteId || undefined })
          .catch(() => null);
        setDispatchElsewhere(plant?.rows.length ?? 0);
      } else {
        setDispatchElsewhere(0);
      }
    } catch (e: any) {
      setDispatchRows([]);
      setDispatchError(e?.message || 'Failed to load the dispatch queue');
    } finally {
      setDispatchLoading(false);
    }
  }, [selectedSiteId, dispatchDept.departmentId, dispatchStationId]);

  useEffect(() => {
    if (viewMode !== 'dispatch') return;
    void loadDispatch();
  }, [viewMode, loadDispatch]);

  /** Start the top of the queue on the tablet. The MANAGER's own identity
   *  applies — no uid on the link, because nobody has clocked in here — and the
   *  operation id rides along so the run books against the operation the queue
   *  offered, not whichever one the job's pointer names by then. */
  const startDispatchRow = (row: DispatchRow) => {
    if (!row.app_id) return;
    navigate(buildPlayLink({
      appId: row.app_id,
      workOrderId: row.work_order_id,
      operationId: row.work_order_operation_id,
      stationId: row.station_id || dispatchStationId || null,
      from: 'dispatch',
    }));
  };

  // Deep link from the Routings screen: /schedule?routing_id=… opens the create
  // form with that routing already picked, so "Release a job on this routing"
  // lands somewhere that can actually do it instead of a blank page.
  const [searchParams, setSearchParams] = useSearchParams();
  const linkedRoutingId = searchParams.get('routing_id') || '';
  useEffect(() => {
    if (!linkedRoutingId) return;
    setForm({ ...defaultForm(), routing_id: linkedRoutingId });
    setShowCreate(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [linkedRoutingId]);

  /** Closing the create form also drops the deep-link parameter, so pressing
   *  New Work Order afterwards does not silently re-pick the same routing. */
  const closeCreate = () => {
    setShowCreate(false);
    if (linkedRoutingId) {
      const next = new URLSearchParams(searchParams);
      next.delete('routing_id');
      setSearchParams(next, { replace: true });
    }
  };

  const handleChange = (field: keyof WOFormData, value: any) => {
    setForm(prev => ({ ...prev, [field]: value }));
  };

  const openCreate = (routingId?: string) => {
    setForm({ ...defaultForm(), routing_id: routingId ?? '' });
    setShowCreate(true);
  };

  const openEdit = (wo: WorkOrder) => {
    setForm({
      work_order_number: wo.work_order_number,
      part_number: wo.part_number,
      part_name: wo.part_name,
      app_id: wo.app_id,
      department_id: wo.department_id ?? '',
      product_type_id: wo.product_type_id ?? '',
      quantity: wo.quantity,
      priority: wo.priority,
      status: wo.status,
      scheduled_start: toDatetimeLocal(wo.scheduled_start),
      scheduled_end: toDatetimeLocal(wo.scheduled_end),
      takt_time_minutes: wo.takt_time_minutes,
      notes: wo.notes,
      due_date: wo.due_date ?? '',
      customer_ref: wo.customer_ref ?? '',
      routing_id: wo.routing_id ?? '',
      hold_reason: wo.hold_reason ?? '',
    });
    setEditTarget(wo);
    setOperations([]);
    getOperations(wo.id)
      .then(rows => setOperations(Array.isArray(rows) ? rows : []))
      .catch(() => setOperations([]));
  };

  /** Turn the picked routing into this job's operations. Once, and only from
   *  the button — saving the form never releases anything. */
  const handleRelease = async () => {
    if (!editTarget) return;
    setReleasing(true);
    try {
      const result = await releaseWorkOrder(editTarget.id, form.routing_id || undefined);
      setOperations(result.operations ?? []);
      setEditTarget(prev => (prev ? {
        ...prev,
        routing_id: result.routing_id ?? prev.routing_id ?? null,
        routing_name: result.routing_name ?? prev.routing_name ?? null,
        released_at: result.released_at ?? null,
        current_operation: result.current_operation ?? null,
      } : prev));
      const n = result.operations?.length ?? 0;
      addToast(`${editTarget.work_order_number} released — ${n} operation${n === 1 ? '' : 's'}`, 'success');
      await load();
    } catch (e: any) {
      addToast(e?.data?.message || e?.message || 'Failed to release this work order', 'error');
    } finally {
      setReleasing(false);
    }
  };

  const handleSkipOperation = async (operationId: string) => {
    if (!editTarget) return;
    try {
      await updateOperation(editTarget.id, operationId, { status: 'skipped' });
      const rows = await getOperations(editTarget.id);
      setOperations(Array.isArray(rows) ? rows : []);
      await load();
    } catch (e: any) {
      addToast(e?.data?.message || e?.message || 'Failed to update the operation', 'error');
    }
  };

  const handleSaveCreate = async () => {
    setSaving(true);
    try {
      // A job created WITH a routing comes back already released — the server
      // does it in the same request, so there is no second button to press.
      const created = await api.createWorkOrder(toPayload(form));
      closeCreate();
      if (created?.released_at && created?.current_operation) {
        addToast(`${created.work_order_number} released — ${created.current_operation.of} operations`, 'success');
      }
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
      await api.updateWorkOrder(editTarget.id, toPayload(form));
      setEditTarget(null);
      await load();
    } catch (e: any) {
      alert(e.message ?? 'Failed to update work order');
    } finally {
      setSaving(false);
    }
  };

  // Generate a material kit from the WO's product type's active BOM. Saves the
  // form first so a just-picked product type is on the WO before resolution.
  const handleGenerateKit = async (locationId: string) => {
    if (!editTarget) return;
    setGeneratingKit(true);
    try {
      await api.updateWorkOrder(editTarget.id, toPayload(form));
      const kit = await api.generateKit({
        work_order_id: editTarget.id,
        ...(locationId ? { location_id: locationId } : {}),
      });
      setKitsByWo(prev => ({ ...prev, [editTarget.id]: kit as KitRow }));
      addToast(`Kit generated for ${editTarget.work_order_number} (BOM v${kit.bom_version})`, 'success');
      // Refresh rollups in the background — the modal stays open on this WO.
      api.getKits().then(list => {
        const byWo: Record<string, KitRow> = {};
        for (const k of list as KitRow[]) if (k.status !== 'cancelled') byWo[k.work_order_id] = k;
        setKitsByWo(byWo);
      }).catch(() => {});
    } catch (e: any) {
      const code = e?.data?.code;
      if (code === 'KIT_EXISTS') addToast('A kit already exists for this work order', 'warning');
      else if (code === 'NO_PRODUCT_TYPE') addToast('Assign a product type to this work order first', 'warning');
      else if (code === 'NO_ACTIVE_BOM') addToast('No active BOM for this product type — activate one under Inventory → BOMs', 'warning');
      else addToast(e?.message ?? 'Failed to generate kit', 'error');
    } finally {
      setGeneratingKit(false);
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
    } catch (e: any) {
      alert(e.message ?? 'Failed to mark work order complete');
    }
  };

  // Filtering
  const deptOptions = ['All', ...Array.from(new Set(workOrders.map(w => w.department_name).filter((n): n is string => Boolean(n))))];
  const filtered = workOrders.filter(wo => {
    if (statusFilter !== 'All' && wo.status !== statusFilter) return false;
    if (priorityFilter !== 'All' && wo.priority !== priorityFilter) return false;
    if (deptFilter !== 'All' && wo.department_name !== deptFilter) return false;
    if (search) {
      const q = search.toLowerCase();
      if (
        !(wo.work_order_number ?? '').toLowerCase().includes(q) &&
        !(wo.part_name ?? '').toLowerCase().includes(q) &&
        !(wo.part_number ?? '').toLowerCase().includes(q)
      ) return false;
    }
    return true;
  });
  const hasActiveFilters = statusFilter !== 'All' || priorityFilter !== 'All' || deptFilter !== 'All' || search.trim() !== '';

  // Gantt date range
  const ganttDates = filtered
    .flatMap(wo => [new Date(wo.scheduled_start), new Date(wo.scheduled_end)])
    .filter(d => !isNaN(d.getTime()));
  const minDate = ganttDates.length > 0 ? new Date(Math.min(...ganttDates.map(d => d.getTime()))) : new Date();
  const maxDate = ganttDates.length > 0 ? new Date(Math.max(...ganttDates.map(d => d.getTime()))) : new Date(Date.now() + 7 * 86400000);
  const ganttByDept = filtered.reduce<Record<string, WorkOrder[]>>((acc, wo) => {
    const dept = wo.department_name || 'Unassigned';
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
          <div className="flex items-center gap-2 flex-wrap self-start sm:self-auto">
            {canImport && (
              <button
                onClick={() => setShowImport(v => !v)}
                aria-expanded={showImport}
                className="btn-secondary flex-shrink-0 whitespace-nowrap"
              >
                <Upload size={16} />
                Import work orders
              </button>
            )}
            <button onClick={() => openCreate()} className="btn-primary flex-shrink-0 whitespace-nowrap">
              <Plus size={16} />
              New Work Order
            </button>
          </div>
        )}
      </div>

      {canImport && showImport && (
        <ImportPanel onClose={() => setShowImport(false)} onImported={load} />
      )}

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
          {/* Dispatch is a THIRD view of the same schedule, not a second
              screen: the plan, the chart, and what to run next out of it. */}
          <button
            onClick={() => setViewMode('dispatch')}
            data-testid="tab-dispatch"
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${viewMode === 'dispatch' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
          >
            <PlayCircle size={13} /> Dispatch
          </button>
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

      {/* ── "Where is WO-1042?" ──────────────────────────────────────────────
          One box, one sentence, written by the server. It sits above every view
          of the Schedule because the question does not depend on which view is
          open — and because the alternative, which is what the floor did until
          now, was to find the row, open the drawer and count the operations. */}
      <div className="card p-4">
        <WipSearch className="max-w-xl" data-testid="schedule-wip-search" />
      </div>

      {/* Content */}
      {viewMode === 'dispatch' ? (
        <DispatchView
          rows={dispatchRows}
          loading={dispatchLoading}
          error={dispatchError}
          departmentFilter={dispatchDept}
          stations={stations}
          stationId={dispatchStationId}
          onChooseStation={setDispatchStationId}
          onRefresh={loadDispatch}
          onStart={startDispatchRow}
          onCreate={() => openCreate()}
          canEdit={canEdit}
          elsewhere={dispatchElsewhere}
          onClearScope={() => { dispatchDept.setDepartmentId(''); setDispatchStationId(''); }}
        />
      ) : loading ? (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4 space-y-3">
          {[...Array(6)].map((_, i) => <Skeleton key={i} className="h-10" />)}
        </div>
      ) : loadError ? (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm py-16 flex flex-col items-center gap-3 text-center">
          <AlertTriangle size={28} className="text-red-500" />
          <p className="text-gray-500 font-medium">Couldn't load work orders</p>
          <p className="text-xs text-gray-400">{loadError}</p>
          <button onClick={load} className="btn-secondary">Retry</button>
        </div>
      ) : viewMode === 'list' ? (
        <ListView
          workOrders={filtered}
          kitsByWo={kitsByWo}
          onEdit={openEdit}
          onDelete={setDeleteTarget}
          onComplete={handleMarkComplete}
          isHighlighted={isHighlighted}
          highlightRef={highlightRef}
          canEdit={canEdit}
          hasActiveFilters={hasActiveFilters}
          onCreate={() => openCreate()}
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
          routings={routings}
          saving={saving}
          onChange={handleChange}
          onSave={handleSaveCreate}
          onClose={closeCreate}
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
          kit={kitsByWo[editTarget.id] ?? null}
          locations={locations}
          generatingKit={generatingKit}
          onGenerateKit={canEdit ? handleGenerateKit : undefined}
          routings={routings}
          workOrder={editTarget}
          operations={operations}
          releasing={releasing}
          onRelease={canEdit ? handleRelease : undefined}
          onSkipOperation={canEdit ? handleSkipOperation : undefined}
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

// ── Dispatch ──────────────────────────────────────────────────────────────────
//
// "What should we run next in Weld?" — the question the Schedule could not
// answer. It listed JOBS; the floor runs OPERATIONS, and which one is next
// depends on priority, on what the customer was promised, and on where each job
// already stands.
//
// The order on this screen is the SERVER's: priority → due date (nulls last) →
// sequence, decided once in plantTruth.js so the tablet, the portal and this
// list cannot each sort it their own way. Nothing here re-sorts, re-filters or
// re-counts what came back.
//
// Start hands the operator's tablet the whole context — app, job, operation,
// station — so the run books against the operation this row offered rather than
// whichever one the job's pointer happens to name a minute later.

function DispatchView({
  rows, loading, error, departmentFilter, stations, stationId, onChooseStation,
  onRefresh, onStart, onCreate, canEdit, elsewhere, onClearScope,
}: {
  rows: DispatchRow[];
  loading: boolean;
  error: string | null;
  departmentFilter: ReturnType<typeof useDepartmentFilter>;
  stations: StationOption[];
  stationId: string;
  onChooseStation: (id: string) => void;
  onRefresh: () => void;
  onStart: (row: DispatchRow) => void;
  onCreate: () => void;
  canEdit: boolean;
  /** How much the whole plant has ready, asked for ONLY when this list came
   *  back empty under a filter — so the ordinary path pays nothing for it. */
  elsewhere: number;
  onClearScope: () => void;
}) {
  // The station list is the picked department's when one is picked — offering
  // a welder under a Paint filter is offering work that cannot be there.
  const stationOptions = departmentFilter.departmentId
    ? stations.filter(st => st.department_id === departmentFilter.departmentId)
    : stations;

  return (
    <div className="space-y-4" data-testid="dispatch-view">
      <div className="card p-4 flex flex-wrap items-center gap-3">
        <DepartmentFilter
          filter={departmentFilter}
          allLabel="All departments"
          matchCount={rows.length}
          // "ready" was wrong twice over: the queue also carries the operations
          // that are RUNNING, and the standing apps that need no work order at
          // all. What the number counts is things you can start.
          matchNoun="available"
        />

        {stationOptions.length > 0 && (
          <label className="flex items-center gap-1.5">
            <Factory size={13} className="text-gray-400" aria-hidden="true" />
            <span className="sr-only">Station</span>
            <select
              aria-label="Station"
              className="input-field text-sm py-1.5 w-auto min-w-[10rem]"
              value={stationId}
              onChange={e => onChooseStation(e.target.value)}
            >
              <option value="">All stations</option>
              {stationOptions.map(st => <option key={st.id} value={st.id}>{st.name}</option>)}
            </select>
          </label>
        )}

        <button onClick={onRefresh} disabled={loading} className="btn-secondary ml-auto">
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          Refresh
        </button>
      </div>

      {error && (
        <div className="card p-4 flex items-center gap-2 text-sm text-red-700 bg-red-50 border-red-200">
          <AlertTriangle size={16} className="flex-shrink-0" />
          {error}
        </div>
      )}

      {loading && rows.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4 space-y-3">
          {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-14" />)}
        </div>
      ) : rows.length === 0 ? (
        // Not a zeroed list — and not one sentence for two different situations
        // either. "Nothing has been released anywhere" and "nothing is ready in
        // Weld, though the plant is busy" want opposite actions, and telling a
        // supervisor to go and create a work order when there are eleven of
        // them one filter away is worse than saying nothing.
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm py-16 flex flex-col items-center gap-3 text-center px-6" data-testid="dispatch-empty">
          <PlayCircle size={28} className="text-gray-300" />
          {elsewhere > 0 ? (
            <>
              <p className="text-gray-700 font-medium">Nothing is ready here right now</p>
              <p className="text-xs text-gray-500 max-w-md">
                The plant has {elsewhere} thing{elsewhere === 1 ? '' : 's'} ready to run — just not
                under this filter.
              </p>
              <button onClick={onClearScope} className="btn-secondary" data-testid="dispatch-empty-clear">
                Show the whole plant
              </button>
            </>
          ) : (
            <>
              <p className="text-gray-700 font-medium">Release a job with a routing to see it here</p>
              <p className="text-xs text-gray-500 max-w-md">
                A dispatch queue is made of a released job's operations. Create a work order,
                pick a routing on it and press Release — every operation then appears here in
                the order the floor should run it.
              </p>
              {canEdit && (
                <button onClick={onCreate} className="btn-primary" data-testid="dispatch-empty-create">
                  <Plus size={16} /> New Work Order
                </button>
              )}
            </>
          )}
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm divide-y divide-gray-100" data-testid="dispatch-queue">
          {rows.map(row => {
            const required = row.quantity_required ?? 0;
            const done = row.quantity_completed ?? 0;
            return (
              <div
                key={row.work_order_operation_id ?? `app:${row.app_id}`}
                data-testid="dispatch-row"
                className="p-4 flex flex-wrap items-center gap-x-4 gap-y-2"
              >
                <div className="min-w-[12rem] flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    {/* The number on the traveller, not the one in the
                        database: the stored id carries a company tag the floor
                        never says out loud. The full id stays in `title` for a
                        support ticket to quote. */}
                    <span
                      className="font-semibold text-gray-900 [font-variant-numeric:tabular-nums]"
                      title={row.work_order_number ?? undefined}
                    >
                      {row.work_order_number ? displayId(row.work_order_number) : row.app_name}
                    </span>
                    {row.part_number && (
                      <span className="text-xs text-gray-500 font-mono" title={row.part_number}>{displayId(row.part_number)}</span>
                    )}
                    {row.priority && (
                      <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full capitalize ${DISPATCH_PRIORITY_CHIP[row.priority] ?? 'bg-gray-100 text-gray-600'}`}>
                        {row.priority}
                      </span>
                    )}
                    {row.status === 'running' && (
                      <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-green-100 text-green-700">
                        Running now
                      </span>
                    )}
                  </div>
                  {/* The part this job makes. A standing app has none, and
                      printing its own name twice reads as two facts. */}
                  {row.part_name && (
                    <div className="text-xs text-gray-600 mt-0.5 truncate">{row.part_name}</div>
                  )}
                </div>

                {/* Which operation this is — the fact the job carries. */}
                <div className="text-sm text-gray-700 min-w-[9rem]">
                  {dispatchRowLabel(row)}
                </div>

                <div
                  className="text-sm text-gray-700 [font-variant-numeric:tabular-nums] min-w-[5rem]"
                  title={required > 0 ? undefined : 'no work order, so no ordered quantity'}
                >
                  {required > 0 ? `${done} / ${required}` : <span className="text-gray-400">—</span>}
                </div>

                <div className="text-sm text-gray-600 min-w-[6rem]">
                  {row.due_date
                    ? <>Due {formatDueDate(row.due_date)}</>
                    : <span className="text-gray-400">no due date</span>}
                </div>

                {/* Which app the operator will open. On a standing row the app
                    IS the row, so its name is already the heading. */}
                <div className="text-sm text-gray-600 min-w-[8rem] truncate">
                  {row.no_work_order
                    ? null
                    : (row.app_name ?? <span className="text-amber-600">{row.app_reason ?? 'no app on this operation'}</span>)}
                </div>

                <button
                  onClick={() => onStart(row)}
                  disabled={!row.app_id}
                  title={row.app_id ? undefined : (row.app_reason ?? 'no app on this operation')}
                  className="btn-primary flex-shrink-0 ml-auto disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <PlayCircle size={16} /> Start
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Import Work Orders ────────────────────────────────────────────────────────
//
// Paste the week's list, see exactly what will happen to every line, then
// import. The rules this panel is built around:
//
//   * Nothing is written until Import is pressed. Preview is a dry run on the
//     server — the same validator, told not to save.
//   * A row the server rejected STAYS ON SCREEN with its reason after the
//     import. Making the bad lines disappear is what turns a five-minute fix
//     into an afternoon of re-exporting.
//   * The verdicts come from the server. This component never decides that a
//     row is fine, and never prints a work order number the server has not
//     assigned.
//   * The textarea does not take focus when the panel opens: a planner arriving
//     by keyboard should not have the page scroll-jump into a paste box.

const VERDICT_CLASSES: Record<string, string> = {
  created:  'bg-green-100 text-green-700',
  updated:  'bg-blue-100 text-blue-700',
  rejected: 'bg-red-100 text-red-700',
};

function ImportPanel({ onClose, onImported }: {
  onClose: () => void;
  onImported: () => void;
}) {
  const [csv, setCsv] = useState('');
  const [fileName, setFileName] = useState('');
  const [preview, setPreview] = useState<ImportOutcome | null>(null);
  const [applied, setApplied] = useState<ImportOutcome | null>(null);
  const [busy, setBusy] = useState<'preview' | 'import' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // Any edit to the text invalidates the verdicts that were read off the old text.
  const editText = (value: string) => {
    setCsv(value);
    setPreview(null);
    setApplied(null);
    setError(null);
  };

  const pickFile = async (file: File | null) => {
    if (!file) return;
    try {
      const text = await file.text();
      setFileName(file.name);
      editText(text);
    } catch {
      setError('Could not read that file.');
    }
  };

  const runPreview = async () => {
    setBusy('preview');
    setError(null);
    try {
      setApplied(null);
      setPreview(await previewWorkOrderImport(csv));
    } catch (e: any) {
      setPreview(null);
      setError(e?.message ?? 'Could not read those rows.');
    } finally {
      setBusy(null);
    }
  };

  const runImport = async () => {
    setBusy('import');
    setError(null);
    try {
      const outcome = await commitWorkOrderImport(csv);
      setApplied(outcome);
      setPreview(null);
      onImported();
    } catch (e: any) {
      setError(e?.message ?? 'Could not import those rows.');
    } finally {
      setBusy(null);
    }
  };

  const shown = applied ?? preview;
  const importable = preview ? preview.summary.created + preview.summary.updated : 0;
  const rejected = shown ? shown.results.filter(r => r.result === 'rejected') : [];
  // Rows that went in WITHOUT an external_id have no key to match on, so the
  // same file pasted again creates them a second time. Saying "paste again, it
  // will update" over those rows is how a planner ends up with 16 jobs from an
  // 8-row file.
  const appliedWithoutKey = applied
    ? applied.results.filter(r => r.result !== 'rejected' && !r.external_id).length
    : 0;

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm">
      <div className="flex items-center justify-between px-5 py-3.5 border-b border-gray-200">
        <div className="flex items-center gap-2">
          <Upload size={16} className="text-indigo-600" />
          <h2 className="font-semibold text-gray-900 text-sm">Import work orders</h2>
        </div>
        <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100 transition-colors" aria-label="Close import panel">
          <X size={16} className="text-gray-500" />
        </button>
      </div>

      <div className="p-5 space-y-4">
        <div>
          <label htmlFor="wo-import-csv" className="block text-xs font-medium text-gray-700 mb-1">
            Paste your job list, or choose a .csv file
          </label>
          <textarea
            id="wo-import-csv"
            className="input-field resize-y font-mono text-xs"
            rows={6}
            placeholder="work_order_number,external_id,part_number,part_name,quantity,due_date,…"
            value={csv}
            onChange={e => editText(e.target.value)}
          />
          <p className="text-[11px] text-gray-500 mt-1.5 leading-relaxed">
            The first line is the column headers. Columns we read:{' '}
            <span className="font-mono text-gray-600">{IMPORT_COLUMNS.join(', ')}</span>.
            Everything else in the file is ignored. Common spellings work too — “WO Number”, “Qty”, “Due”.
            Quantity must be a whole number; due date must be written 2026-04-17.
            A row with an <span className="font-mono">external_id</span> updates the job that already has it,
            so importing the same file twice does not duplicate anything.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <input
            ref={fileRef}
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            onChange={e => { void pickFile(e.target.files?.[0] ?? null); e.target.value = ''; }}
          />
          <button onClick={() => fileRef.current?.click()} className="btn-secondary">
            <Upload size={14} /> Choose file
          </button>
          {fileName && <span className="text-xs text-gray-500">{fileName}</span>}

          <a href={IMPORT_TEMPLATE_URL} className="text-xs font-medium text-indigo-600 hover:text-indigo-700 inline-flex items-center gap-1">
            <FileDown size={13} /> Download blank template
          </a>

          <div className="flex items-center gap-2 ml-auto">
            <button onClick={runPreview} disabled={!csv.trim() || busy !== null} className="btn-secondary">
              {busy === 'preview' ? 'Checking…' : 'Preview'}
            </button>
            <button onClick={runImport} disabled={!preview || importable === 0 || busy !== null} className="btn-primary">
              {busy === 'import' ? 'Importing…' : `Import${importable ? ` ${importable}` : ''}`}
            </button>
          </div>
        </div>

        {error && (
          <div className="flex items-start gap-2 text-sm text-red-700 bg-red-50 border border-red-100 rounded-lg px-3 py-2">
            <AlertTriangle size={15} className="mt-0.5 flex-shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {applied && (
          <div className="flex items-start gap-2 text-sm text-green-800 bg-green-50 border border-green-100 rounded-lg px-3 py-2">
            <CheckCircle2 size={15} className="mt-0.5 flex-shrink-0" />
            <span>
              Imported: {applied.summary.created} created, {applied.summary.updated} updated
              {applied.summary.rejected > 0
                ? `. ${applied.summary.rejected} row${applied.summary.rejected === 1 ? '' : 's'} still need fixing — they are listed below and were not imported.`
                : '. Every row went in.'}
            </span>
          </div>
        )}

        {preview && (
          <div className="flex flex-wrap items-center gap-4 text-xs text-gray-600">
            <span className="inline-flex items-center gap-1.5"><CheckCircle2 size={13} className="text-green-600" /> {preview.summary.created} to create</span>
            <span className="inline-flex items-center gap-1.5"><RefreshCw size={13} className="text-blue-600" /> {preview.summary.updated} to update</span>
            <span className="inline-flex items-center gap-1.5"><XCircle size={13} className="text-red-600" /> {preview.summary.rejected} rejected</span>
            <span className="text-gray-400">Nothing has been saved yet.</span>
          </div>
        )}

        {shown && shown.results.length > 0 && (
          <div className="border border-gray-200 rounded-lg overflow-hidden">
            <div className="max-h-80 overflow-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 border-b border-gray-200 sticky top-0">
                  <tr>
                    {['Row', 'Result', 'WO #'].map(h => (
                      <th key={h} className="text-left text-xs font-medium text-gray-500 uppercase tracking-wide px-3 py-2 whitespace-nowrap">{h}</th>
                    ))}
                    {/* On a phone the id and the reason move UNDER their row.
                        Kept as columns they sit off the right edge of a 390px
                        screen, and a reason you have to scroll sideways to read
                        is a reason nobody reads. */}
                    {['External ID', 'Reason'].map(h => (
                      <th key={h} className="hidden sm:table-cell text-left text-xs font-medium text-gray-500 uppercase tracking-wide px-3 py-2 whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {shown.results.map((r: ImportRowVerdict) => (
                    <Fragment key={r.row}>
                      <tr className={r.result === 'rejected' ? 'bg-red-50/40' : ''}>
                        <td className="px-3 py-2 text-xs text-gray-500 [font-variant-numeric:tabular-nums]">{r.row}</td>
                        <td className="px-3 py-2">
                          <span className={`text-xs px-2 py-0.5 rounded-full font-semibold whitespace-nowrap ${VERDICT_CLASSES[r.result] ?? 'bg-gray-100 text-gray-600'}`}>
                            {verdictLabel(r.result, Boolean(applied))}
                          </span>
                        </td>
                        <td className="px-3 py-2 font-mono text-xs text-gray-700 sm:whitespace-nowrap break-words">
                          {r.work_order_number
                            ? r.work_order_number
                            : r.result === 'rejected'
                              ? <span className="text-gray-400">—</span>
                              : <span className="text-gray-400">assigned on import</span>}
                        </td>
                        <td className="hidden sm:table-cell px-3 py-2 font-mono text-xs text-gray-500 whitespace-nowrap">{r.external_id ?? '—'}</td>
                        <td className="hidden sm:table-cell px-3 py-2 text-xs text-gray-700">{r.reason ?? ''}</td>
                      </tr>
                      {(r.reason || r.external_id) && (
                        <tr className={`sm:hidden ${r.result === 'rejected' ? 'bg-red-50/40' : ''}`}>
                          <td colSpan={3} className="px-3 pb-2 text-xs text-gray-700 break-words">
                            {r.external_id && <span className="font-mono text-gray-500">{r.external_id}</span>}
                            {r.external_id && r.reason ? ' — ' : ''}
                            {r.reason}
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {applied && appliedWithoutKey > 0 && (
          <p className="text-xs text-amber-700 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2">
            {appliedWithoutKey} of these rows carry no external_id — pasting them again will create them
            a second time. Add an external_id column to make re-imports safe.
          </p>
        )}
        {applied && appliedWithoutKey === 0 && rejected.length > 0 && (
          <p className="text-xs text-gray-500">
            Fix the rows above in your file, then paste again — the ones that already went in will be
            recognised by their external_id and updated rather than duplicated.
          </p>
        )}
      </div>
    </div>
  );
}

// ── List View ─────────────────────────────────────────────────────────────────

function ListView({
  workOrders,
  kitsByWo,
  onEdit,
  onDelete,
  onComplete,
  isHighlighted,
  highlightRef,
  canEdit,
  hasActiveFilters,
  onCreate,
}: {
  workOrders: WorkOrder[];
  kitsByWo: Record<string, KitRow>;
  onEdit: (wo: WorkOrder) => void;
  onDelete: (wo: WorkOrder) => void;
  onComplete: (wo: WorkOrder) => void;
  isHighlighted: (id: string) => boolean;
  highlightRef: (id: string) => (el: HTMLElement | null) => void;
  canEdit: boolean;
  hasActiveFilters: boolean;
  onCreate: () => void;
}) {
  if (workOrders.length === 0) {
    return (
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm py-16 text-center">
        <Package size={32} className="mx-auto mb-3 text-gray-300" />
        <p className="text-gray-500 font-medium text-sm">
          {hasActiveFilters ? 'No work orders match your filters' : 'No work orders yet'}
        </p>
        <p className="text-gray-400 text-xs mt-1">
          {hasActiveFilters
            ? 'Try adjusting or clearing your search and filters.'
            : 'Create your first work order to start scheduling production.'}
        </p>
        {!hasActiveFilters && canEdit && (
          <button onClick={onCreate} className="btn-primary mt-4">
            <Plus size={16} />
            New Work Order
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm whitespace-nowrap">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr>
              {['WO #', 'Part', 'Department', 'Quantity', 'Kit', 'Priority', 'Due', 'Scheduled', 'Status', 'Actions'].map(h => (
                <th key={h} className="text-left text-xs font-medium text-gray-500 uppercase tracking-wide px-4 py-3">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {workOrders.map(wo => {
              const pct = wo.quantity > 0 ? Math.round((wo.quantity_completed / wo.quantity) * 100) : 0;
              const kit = kitsByWo[wo.id];
              return (
                <tr
                  key={wo.id}
                  ref={highlightRef(wo.id)}
                  className={`hover:bg-gray-50 transition-colors ${isHighlighted(wo.id) ? 'nav-highlight' : ''}`}
                >
                  <td className="px-4 py-3">
                    <span className="font-mono text-xs font-semibold text-blue-700" title={wo.work_order_number}>{displayId(wo.work_order_number)}</span>
                    {/* Where the job stands, on the row itself. Only for a
                        released job — a work order with no operations says
                        nothing here rather than "op 0 of 0". */}
                    {wo.current_operation && (
                      <div className="text-[11px] text-gray-500 [font-variant-numeric:tabular-nums]">
                        op {wo.current_operation.sequence} of {wo.current_operation.of}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <div className="font-medium text-gray-900 text-xs">{wo.part_name}</div>
                    <div className="text-xs text-gray-400" title={wo.part_number || undefined}>
                      {displayId(wo.part_number)}
                      {wo.customer_ref ? ` · ${wo.customer_ref}` : ''}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1.5 text-xs text-gray-600">
                      <Building2 size={11} />
                      {wo.department_name || '—'}
                    </div>
                  </td>
                  <td className="px-4 py-3 min-w-[120px]">
                    <div className="text-xs text-gray-700 mb-1 [font-variant-numeric:tabular-nums]">{wo.quantity_completed} / {wo.quantity}</div>
                    <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden w-20">
                      <div
                        className={`h-full rounded-full ${GANTT_BAR_CLASSES[wo.status] ?? 'bg-gray-400'}`}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    {kit ? (
                      <Link
                        to={`/inventory/kitting/${kit.id}`}
                        onClick={e => e.stopPropagation()}
                        title={`Kit ${kit.status} — ${(kit.n_verified ?? 0) + (kit.n_picked ?? 0)}/${kit.n_total ?? 0} picked`}
                        className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-semibold hover:opacity-80 transition-opacity ${KIT_STATUS_CLASSES[kit.status] ?? 'bg-gray-100 text-gray-600'}`}
                      >
                        <PackageOpen size={11} />
                        {kit.status}
                        {Boolean(kit.has_short) && <Flag size={10} className="text-amber-600" />}
                      </Link>
                    ) : (
                      <span className="text-xs text-gray-400">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${PRIORITY_CLASSES[wo.priority] ?? 'bg-gray-100 text-gray-600'}`}>
                      {wo.priority}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="text-xs text-gray-700 whitespace-nowrap">{formatDueDate(wo.due_date)}</div>
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
                  <span className="font-mono font-semibold text-blue-700" title={wo.work_order_number}>{displayId(wo.work_order_number)}</span>
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

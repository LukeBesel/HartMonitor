import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { useAuth } from '../context/AuthContext';
import {
  Truck, Plus, X, Trash2, Edit2, AlertTriangle, CheckCircle,
  Package, Clock, MapPin, RefreshCw,
} from 'lucide-react';

// ── Types ─────────────────────────────────────────────────────────────────────

interface Shipment {
  id: string;
  company_id: string;
  po_id?: string;
  carrier: string;
  tracking_number: string;
  origin: string;
  status: 'pending' | 'in_transit' | 'out_for_delivery' | 'delivered' | 'delayed' | 'exception';
  shipped_date?: string;
  estimated_arrival?: string;
  actual_arrival?: string;
  notes: string;
  created_at: string;
  updated_at: string;
  po_number?: string;
}

interface PurchaseOrder {
  id: string;
  po_number: string;
  vendor_name: string;
  status: string;
}

type ShipmentStatus = Shipment['status'];

interface ShipmentFormData {
  carrier: string;
  tracking_number: string;
  origin: string;
  status: ShipmentStatus;
  shipped_date: string;
  estimated_arrival: string;
  po_id: string;
  notes: string;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const STATUS_FILTERS = ['All', 'pending', 'in_transit', 'out_for_delivery', 'delivered', 'delayed', 'exception'] as const;

const STATUS_CONFIG: Record<ShipmentStatus, { label: string; badgeClass: string; dotClass: string }> = {
  pending:          { label: 'Pending',          badgeClass: 'bg-gray-100 text-gray-600 border border-gray-200',         dotClass: 'bg-gray-400' },
  in_transit:       { label: 'In Transit',        badgeClass: 'bg-blue-50 text-blue-700 border border-blue-100',          dotClass: 'bg-blue-500' },
  out_for_delivery: { label: 'Out for Delivery',  badgeClass: 'bg-purple-50 text-purple-700 border border-purple-100',    dotClass: 'bg-purple-500' },
  delivered:        { label: 'Delivered',         badgeClass: 'bg-green-50 text-green-700 border border-green-100',       dotClass: 'bg-green-500' },
  delayed:          { label: 'Delayed',           badgeClass: 'bg-amber-50 text-amber-700 border border-amber-100',       dotClass: 'bg-amber-500' },
  exception:        { label: 'Exception',         badgeClass: 'bg-red-50 text-red-700 border border-red-100',             dotClass: 'bg-red-500' },
};

const FILTER_LABELS: Record<string, string> = {
  All: 'All',
  pending: 'Pending',
  in_transit: 'In Transit',
  out_for_delivery: 'Out for Delivery',
  delivered: 'Delivered',
  delayed: 'Delayed',
  exception: 'Exception',
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtDate(iso?: string) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
}

function isOverdue(shipment: Shipment): boolean {
  if (shipment.status === 'delivered') return false;
  if (!shipment.estimated_arrival) return false;
  const eta = new Date(shipment.estimated_arrival);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  eta.setHours(0, 0, 0, 0);
  return eta <= today;
}

function isDueToday(shipment: Shipment): boolean {
  if (shipment.status === 'delivered') return false;
  if (!shipment.estimated_arrival) return false;
  const eta = new Date(shipment.estimated_arrival);
  const today = new Date();
  return (
    eta.getFullYear() === today.getFullYear() &&
    eta.getMonth() === today.getMonth() &&
    eta.getDate() === today.getDate()
  );
}

function defaultForm(): ShipmentFormData {
  return {
    carrier: '',
    tracking_number: '',
    origin: '',
    status: 'pending',
    shipped_date: '',
    estimated_arrival: '',
    po_id: '',
    notes: '',
  };
}

// ── Status Badge ──────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: ShipmentStatus }) {
  const cfg = STATUS_CONFIG[status];
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold ${cfg.badgeClass}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${cfg.dotClass}`} />
      {cfg.label}
    </span>
  );
}

// ── Shipment Modal ─────────────────────────────────────────────────────────────

function ShipmentModal({
  initial,
  pos,
  onSave,
  onClose,
}: {
  initial?: Shipment;
  pos: PurchaseOrder[];
  onSave: (data: ShipmentFormData) => Promise<void>;
  onClose: () => void;
}) {
  const [form, setForm] = useState<ShipmentFormData>(
    initial
      ? {
          carrier: initial.carrier,
          tracking_number: initial.tracking_number,
          origin: initial.origin,
          status: initial.status,
          shipped_date: initial.shipped_date?.slice(0, 10) ?? '',
          estimated_arrival: initial.estimated_arrival?.slice(0, 10) ?? '',
          po_id: initial.po_id ?? '',
          notes: initial.notes ?? '',
        }
      : defaultForm()
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const f = (k: keyof ShipmentFormData, v: string) =>
    setForm(p => ({ ...p, [k]: v }));

  async function handleSave() {
    if (!form.carrier.trim()) { setError('Carrier is required.'); return; }
    if (!form.tracking_number.trim()) { setError('Tracking number is required.'); return; }
    setSaving(true);
    setError('');
    try {
      await onSave(form);
    } catch (e: any) {
      setError(e.message || 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-start justify-center p-4 overflow-y-auto">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg my-8">
        <div className="flex items-center justify-between p-6 border-b border-gray-100">
          <h2 className="text-lg font-semibold text-gray-900">
            {initial ? 'Edit Shipment' : 'Add Shipment'}
          </h2>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100 transition-colors">
            <X className="w-4 h-4 text-gray-500" />
          </button>
        </div>
        <div className="p-6 space-y-4">
          {error && (
            <div className="p-3 bg-red-50 text-red-700 rounded-xl text-sm">{error}</div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Carrier *</label>
              <input
                className="input-field"
                value={form.carrier}
                onChange={e => f('carrier', e.target.value)}
                placeholder="FedEx, UPS, USPS…"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Tracking Number *</label>
              <input
                className="input-field font-mono"
                value={form.tracking_number}
                onChange={e => f('tracking_number', e.target.value)}
                placeholder="1Z999AA10123456784"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Origin</label>
              <input
                className="input-field"
                value={form.origin}
                onChange={e => f('origin', e.target.value)}
                placeholder="Chicago, IL"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Status</label>
              <select
                className="input-field"
                value={form.status}
                onChange={e => f('status', e.target.value as ShipmentStatus)}
              >
                {Object.entries(STATUS_CONFIG).map(([k, v]) => (
                  <option key={k} value={k}>{v.label}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Shipped Date</label>
              <input
                className="input-field"
                type="date"
                value={form.shipped_date}
                onChange={e => f('shipped_date', e.target.value)}
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Est. Arrival</label>
              <input
                className="input-field"
                type="date"
                value={form.estimated_arrival}
                onChange={e => f('estimated_arrival', e.target.value)}
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Linked PO (optional)</label>
            <select
              className="input-field"
              value={form.po_id}
              onChange={e => f('po_id', e.target.value)}
            >
              <option value="">No linked PO</option>
              {pos.map(po => (
                <option key={po.id} value={po.id}>
                  {po.po_number} — {po.vendor_name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Notes</label>
            <textarea
              className="input-field resize-none"
              rows={2}
              value={form.notes}
              onChange={e => f('notes', e.target.value)}
              placeholder="Special handling, reference numbers…"
            />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button
              className="btn-secondary"
              onClick={onClose}
            >
              Cancel
            </button>
            <button
              className="btn-primary"
              onClick={handleSave}
              disabled={saving}
            >
              {saving ? 'Saving…' : initial ? 'Save Changes' : 'Add Shipment'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Delete Confirm Modal ───────────────────────────────────────────────────────

function DeleteConfirmModal({
  shipment,
  onConfirm,
  onClose,
}: {
  shipment: Shipment;
  onConfirm: () => Promise<void>;
  onClose: () => void;
}) {
  const [deleting, setDeleting] = useState(false);

  const handleDelete = async () => {
    setDeleting(true);
    try {
      await onConfirm();
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm">
        <div className="p-6 text-center space-y-4">
          <div className="w-12 h-12 bg-red-50 rounded-full flex items-center justify-center mx-auto">
            <Trash2 className="w-6 h-6 text-red-500" />
          </div>
          <div>
            <h3 className="font-semibold text-gray-900 text-lg">Delete Shipment</h3>
            <p className="text-gray-500 text-sm mt-1">
              Remove tracking for{' '}
              <span className="font-mono font-medium text-gray-700">{shipment.tracking_number}</span>?
              This cannot be undone.
            </p>
          </div>
          <div className="flex gap-2 justify-center">
            <button className="btn-secondary" onClick={onClose}>Cancel</button>
            <button className="btn-danger" onClick={handleDelete} disabled={deleting}>
              {deleting ? 'Deleting…' : 'Delete'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Shipment Row ──────────────────────────────────────────────────────────────

function ShipmentRow({
  shipment,
  onEdit,
  onDelete,
  canEdit,
}: {
  shipment: Shipment;
  onEdit: () => void;
  onDelete: () => void;
  canEdit: boolean;
}) {
  const overdue = isOverdue(shipment);
  const dueToday = !overdue && isDueToday(shipment);

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4 hover:shadow-md transition-shadow">
      <div className="flex items-start gap-3 flex-wrap">
        {/* Carrier icon + info */}
        <div className="w-10 h-10 rounded-xl bg-blue-50 flex items-center justify-center flex-shrink-0">
          <Truck className="w-5 h-5 text-blue-600" />
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold text-gray-900">{shipment.carrier}</span>
            <span className="font-mono text-sm text-gray-500 bg-gray-50 px-2 py-0.5 rounded-lg border border-gray-100">
              {shipment.tracking_number}
            </span>
            <StatusBadge status={shipment.status} />
            {overdue && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-red-50 text-red-600 border border-red-100">
                <AlertTriangle className="w-3 h-3" /> Overdue
              </span>
            )}
            {dueToday && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-amber-50 text-amber-600 border border-amber-100">
                <Clock className="w-3 h-3" /> Due Today
              </span>
            )}
          </div>

          <div className="flex items-center gap-4 mt-2 text-sm text-gray-500 flex-wrap">
            {shipment.origin && (
              <span className="flex items-center gap-1">
                <MapPin className="w-3.5 h-3.5 text-gray-300" />
                {shipment.origin}
              </span>
            )}
            {shipment.shipped_date && (
              <span className="flex items-center gap-1">
                <Package className="w-3.5 h-3.5 text-gray-300" />
                Shipped {fmtDate(shipment.shipped_date)}
              </span>
            )}
            {shipment.estimated_arrival && (
              <span className="flex items-center gap-1">
                <Clock className="w-3.5 h-3.5 text-gray-300" />
                ETA {fmtDate(shipment.estimated_arrival)}
              </span>
            )}
            {shipment.po_number && (
              <span className="inline-flex items-center gap-1 text-xs font-medium text-blue-600 bg-blue-50 px-2 py-0.5 rounded-lg border border-blue-100">
                PO {shipment.po_number}
              </span>
            )}
          </div>

          {shipment.notes && (
            <p className="mt-2 text-xs text-gray-400 line-clamp-1">{shipment.notes}</p>
          )}
        </div>

        {/* Actions */}
        {canEdit && (
          <div className="flex items-center gap-1 flex-shrink-0">
            <button
              onClick={onEdit}
              className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors"
              title="Edit"
            >
              <Edit2 className="w-4 h-4" />
            </button>
            <button
              onClick={onDelete}
              className="p-1.5 rounded-lg hover:bg-red-50 text-gray-400 hover:text-red-500 transition-colors"
              title="Delete"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function ShipmentTracker() {
  const { canEdit } = useAuth();
  const [shipments, setShipments] = useState<Shipment[]>([]);
  const [pos, setPOs] = useState<PurchaseOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [statusFilter, setStatusFilter] = useState('All');
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<Shipment | null>(null);
  const [deleting, setDeleting] = useState<Shipment | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    document.title = 'Shipment Tracker';
  }, []);

  const loadData = async () => {
    try {
      const [shipmentsData, posData] = await Promise.all([
        api.getShipments().catch(() => []),
        api.getPurchaseOrders().catch(() => []),
      ]);
      setShipments(shipmentsData ?? []);
      setPOs(posData ?? []);
      setError('');
    } catch (e: any) {
      setError(e.message || 'Failed to load shipments');
    }
  };

  useEffect(() => {
    setLoading(true);
    loadData().finally(() => setLoading(false));
  }, []);

  const handleRefresh = async () => {
    setRefreshing(true);
    await loadData().finally(() => setRefreshing(false));
  };

  const handleCreate = async (data: ShipmentFormData) => {
    await api.createShipment({
      carrier: data.carrier,
      tracking_number: data.tracking_number,
      origin: data.origin,
      status: data.status,
      shipped_date: data.shipped_date || undefined,
      estimated_arrival: data.estimated_arrival || undefined,
      po_id: data.po_id || undefined,
      notes: data.notes,
    });
    setShowModal(false);
    await loadData();
  };

  const handleUpdate = async (data: ShipmentFormData) => {
    if (!editing) return;
    await api.updateShipment(editing.id, {
      carrier: data.carrier,
      tracking_number: data.tracking_number,
      origin: data.origin,
      status: data.status,
      shipped_date: data.shipped_date || undefined,
      estimated_arrival: data.estimated_arrival || undefined,
      po_id: data.po_id || undefined,
      notes: data.notes,
    });
    setEditing(null);
    await loadData();
  };

  const handleDelete = async () => {
    if (!deleting) return;
    await api.deleteShipment(deleting.id);
    setDeleting(null);
    await loadData();
  };

  const filtered = statusFilter === 'All'
    ? shipments
    : shipments.filter(s => s.status === statusFilter);

  // Enrich shipments with PO numbers from local pos list
  const enriched = filtered.map(s => ({
    ...s,
    po_number: s.po_number ?? pos.find(p => p.id === s.po_id)?.po_number,
  }));

  return (
    <div className="min-h-screen bg-[#f8fafc] p-6">
      <div className="max-w-5xl mx-auto">
        {/* Header */}
        <div className="flex items-start justify-between gap-4 mb-6 flex-wrap">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Shipments</h1>
            <p className="text-gray-500 text-sm mt-0.5">Track inbound shipments and deliveries</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleRefresh}
              disabled={refreshing}
              className="btn-secondary"
            >
              <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
              Refresh
            </button>
            {canEdit && (
              <button
                className="btn-primary"
                onClick={() => setShowModal(true)}
              >
                <Plus className="w-4 h-4" />
                Add Shipment
              </button>
            )}
          </div>
        </div>

        {/* Status filter chips */}
        <div className="flex gap-2 flex-wrap mb-5">
          {STATUS_FILTERS.map(s => {
            const isActive = statusFilter === s;
            const count = s === 'All' ? shipments.length : shipments.filter(sh => sh.status === s).length;
            return (
              <button
                key={s}
                onClick={() => setStatusFilter(s)}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors flex items-center gap-1.5 ${
                  isActive
                    ? 'bg-gray-900 text-white shadow-sm'
                    : 'bg-white border border-gray-200 text-gray-600 hover:bg-gray-50'
                }`}
              >
                {FILTER_LABELS[s]}
                {count > 0 && (
                  <span className={`text-xs px-1.5 py-0.5 rounded-full font-semibold ${
                    isActive ? 'bg-white/20 text-white' : 'bg-gray-100 text-gray-500'
                  }`}>
                    {count}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* Content */}
        {loading ? (
          <div className="flex items-center justify-center py-24 gap-3 text-gray-400">
            <span className="w-6 h-6 border-2 border-gray-200 border-t-gray-500 rounded-full animate-spin" />
            <span>Loading…</span>
          </div>
        ) : error ? (
          <div className="bg-red-50 border border-red-100 text-red-700 rounded-xl p-5 flex items-center gap-3">
            <AlertTriangle className="w-5 h-5 flex-shrink-0" />
            <div>
              <div className="font-semibold">Could not load shipments</div>
              <div className="text-sm text-red-600 mt-0.5">{error}</div>
            </div>
          </div>
        ) : enriched.length === 0 ? (
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm py-24 flex flex-col items-center justify-center text-center gap-4">
            <div className="w-16 h-16 bg-gray-50 rounded-full border-2 border-gray-100 flex items-center justify-center">
              <Truck className="w-8 h-8 text-gray-300" />
            </div>
            <div>
              <div className="font-semibold text-gray-700 text-lg">
                {statusFilter === 'All' ? 'No shipments yet' : `No ${FILTER_LABELS[statusFilter].toLowerCase()} shipments`}
              </div>
              <div className="text-gray-400 text-sm mt-1">
                {statusFilter === 'All'
                  ? 'Add a shipment to start tracking inbound deliveries'
                  : 'Try a different status filter'}
              </div>
            </div>
            {canEdit && statusFilter === 'All' && (
              <button className="btn-primary mt-2" onClick={() => setShowModal(true)}>
                <Plus className="w-4 h-4" /> Add Shipment
              </button>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            {enriched.map(s => (
              <ShipmentRow
                key={s.id}
                shipment={s}
                canEdit={canEdit}
                onEdit={() => setEditing(s)}
                onDelete={() => setDeleting(s)}
              />
            ))}
            <div className="text-xs text-gray-400 text-center pt-2">
              {enriched.length} shipment{enriched.length !== 1 ? 's' : ''}
              {statusFilter !== 'All' ? ` · ${FILTER_LABELS[statusFilter]}` : ''}
            </div>
          </div>
        )}

        {/* "Delivered" summary card when showing all */}
        {!loading && !error && statusFilter === 'All' && shipments.length > 0 && (
          <div className="mt-6 grid grid-cols-2 sm:grid-cols-3 gap-3">
            {(['in_transit', 'delayed', 'delivered'] as ShipmentStatus[]).map(s => {
              const c = shipments.filter(sh => sh.status === s).length;
              const cfg = STATUS_CONFIG[s];
              return (
                <div key={s} className="bg-white rounded-xl border border-gray-200 shadow-sm p-4 flex items-center gap-3">
                  <span className={`w-3 h-3 rounded-full flex-shrink-0 ${cfg.dotClass}`} />
                  <div>
                    <div className="text-xl font-bold text-gray-900">{c}</div>
                    <div className="text-xs text-gray-500">{cfg.label}</div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Modals */}
      {showModal && (
        <ShipmentModal
          pos={pos}
          onSave={handleCreate}
          onClose={() => setShowModal(false)}
        />
      )}
      {editing && (
        <ShipmentModal
          initial={editing}
          pos={pos}
          onSave={handleUpdate}
          onClose={() => setEditing(null)}
        />
      )}
      {deleting && (
        <DeleteConfirmModal
          shipment={deleting}
          onConfirm={handleDelete}
          onClose={() => setDeleting(null)}
        />
      )}
    </div>
  );
}

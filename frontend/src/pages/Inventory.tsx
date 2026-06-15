import { useEffect, useState, useCallback, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  Package, DollarSign, AlertTriangle, TrendingUp, Search, Plus,
  Download, MapPin, X, Pencil, Trash2, ArrowUpCircle, ArrowDownCircle,
  RefreshCw, ChevronDown, Layers, RotateCcw, ArrowLeftRight, Truck,
  ClipboardList, ScanLine, Database, LayoutGrid, PackageX,
} from 'lucide-react';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Cell,
} from 'recharts';
import { api } from '../api/client';
import type { InventoryTrackerSummary, InventoryMovement } from '../types';
import SavedViewsBar from '../components/shared/SavedViewsBar';
import BarcodeScannerModal from '../components/shared/BarcodeScannerModal';
import ModuleOnboarding from '../components/shared/ModuleOnboarding';
import { useSite } from '../context/SiteContext';
import { useAuth } from '../context/AuthContext';

// ─── Helpers ───────────────────────────────────────────────────────────────

function fmtCurrency(v: number | null | undefined): string {
  if (v == null) return '$0.00';
  return '$' + v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtCurrencyWhole(v: number | null | undefined): string {
  if (v == null) return '$0';
  return '$' + Math.round(v).toLocaleString('en-US');
}

function fmtNum(v: number | null | undefined): string {
  if (v == null) return '0';
  return v.toLocaleString('en-US');
}

function fmtDate(iso: string): string {
  if (!iso) return '—';
  const d = new Date(iso);
  const now = new Date();
  const diff = now.getTime() - d.getTime();
  if (diff < 60000) return 'just now';
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  return d.toLocaleDateString();
}

function stockStatus(qty: number, reorderPoint: number): 'ok' | 'low' | 'critical' {
  if (qty <= 0) return 'critical';
  if (qty <= reorderPoint) return 'critical';
  if (qty <= reorderPoint * 1.2) return 'low';
  return 'ok';
}

// ─── Movement type config ───────────────────────────────────────────────────

const MOVE_CONFIG: Record<string, { label: string; color: string; bgColor: string; icon: any; sign: number }> = {
  receive:  { label: 'Receive',  color: 'text-emerald-700', bgColor: 'bg-emerald-50', icon: ArrowUpCircle,   sign: 1 },
  consume:  { label: 'Consume',  color: 'text-red-700',     bgColor: 'bg-red-50',     icon: ArrowDownCircle, sign: -1 },
  ship:     { label: 'Ship',     color: 'text-orange-700',  bgColor: 'bg-orange-50',  icon: Truck,           sign: -1 },
  scrap:    { label: 'Scrap',    color: 'text-gray-600',    bgColor: 'bg-gray-100',   icon: Trash2,          sign: -1 },
  adjust:   { label: 'Adjust',   color: 'text-blue-700',    bgColor: 'bg-blue-50',    icon: Pencil,          sign: 0 },
  return:   { label: 'Return',   color: 'text-teal-700',    bgColor: 'bg-teal-50',    icon: RotateCcw,       sign: 1 },
  transfer: { label: 'Transfer', color: 'text-purple-700',  bgColor: 'bg-purple-50',  icon: ArrowLeftRight,  sign: 0 },
};

const CHART_COLORS = ['#3b82f6', '#22c55e', '#f59e0b', '#8b5cf6', '#ef4444', '#06b6d4', '#ec4899', '#84cc16'];

// ─── Skeleton ───────────────────────────────────────────────────────────────

function Skeleton({ className }: { className?: string }) {
  return <div className={`animate-pulse bg-gray-200 rounded ${className ?? ''}`} />;
}

// ─── Stat Card ──────────────────────────────────────────────────────────────

function SummaryCard({ icon, iconBg, label, value, sub }: any) {
  return (
    <div className="stat-card">
      <div className="flex items-center gap-3">
        <div className={`w-10 h-10 ${iconBg} rounded-xl flex items-center justify-center flex-shrink-0`}>
          {icon}
        </div>
        <div className="min-w-0">
          <div className="text-base sm:text-2xl font-bold text-gray-900 truncate">{value}</div>
          <div className="text-xs font-medium text-gray-500">{label}</div>
          {sub && <div className="text-xs text-gray-400">{sub}</div>}
        </div>
      </div>
    </div>
  );
}

// ─── Item Form Modal ─────────────────────────────────────────────────────────

const EMPTY_ITEM = {
  sku: '', name: '', description: '', category: '',
  unit_of_measure: 'ea', unit_cost: '', reorder_point: '', reorder_qty: '', lead_time_days: '',
};

function ItemModal({ item, onClose, onSaved }: { item: any | null; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState<any>(item ? {
    sku: item.sku ?? '',
    name: item.name ?? '',
    description: item.description ?? '',
    category: item.category ?? '',
    unit_of_measure: item.unit_of_measure ?? 'ea',
    unit_cost: item.unit_cost ?? '',
    reorder_point: item.reorder_point ?? '',
    reorder_qty: item.reorder_qty ?? '',
    lead_time_days: item.lead_time_days ?? '',
  } : { ...EMPTY_ITEM });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  function set(field: string, val: any) {
    setForm((f: any) => ({ ...f, [field]: val }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.sku.trim() || !form.name.trim()) {
      setError('SKU and Name are required.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const payload: any = { ...form };
      if (payload.unit_cost !== '') payload.unit_cost = parseFloat(payload.unit_cost);
      else delete payload.unit_cost;
      if (payload.reorder_point !== '') payload.reorder_point = parseFloat(payload.reorder_point);
      else delete payload.reorder_point;
      if (payload.reorder_qty !== '') payload.reorder_qty = parseFloat(payload.reorder_qty);
      else delete payload.reorder_qty;
      if (payload.lead_time_days !== '') payload.lead_time_days = parseInt(payload.lead_time_days);
      else delete payload.lead_time_days;

      if (item?.id) {
        await api.updateInventoryItem(item.id, payload);
      } else {
        await api.createInventoryItem(payload);
      }
      onSaved();
      onClose();
    } catch (err: any) {
      setError(err.message || 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <h2 className="font-semibold text-gray-900">{item ? 'Edit Item' : 'New Inventory Item'}</h2>
          <button onClick={onClose} className="btn-ghost p-1.5 rounded-lg"><X size={16} /></button>
        </div>
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">SKU *</label>
              <input className="input-field" value={form.sku} onChange={e => set('sku', e.target.value)} placeholder="SKU-001" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Name *</label>
              <input className="input-field" value={form.name} onChange={e => set('name', e.target.value)} placeholder="Item name" />
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Description</label>
            <textarea className="input-field resize-none" rows={2} value={form.description} onChange={e => set('description', e.target.value)} placeholder="Optional description" />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Category</label>
              <input className="input-field" value={form.category} onChange={e => set('category', e.target.value)} placeholder="e.g. Raw Materials" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Unit of Measure</label>
              <select className="input-field" value={form.unit_of_measure} onChange={e => set('unit_of_measure', e.target.value)}>
                {['ea','kg','m','L','roll','box','set'].map(u => <option key={u} value={u}>{u}</option>)}
              </select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Unit Cost ($)</label>
              <input className="input-field" type="number" min="0" step="0.01" value={form.unit_cost} onChange={e => set('unit_cost', e.target.value)} placeholder="0.00" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Reorder Point</label>
              <input className="input-field" type="number" min="0" value={form.reorder_point} onChange={e => set('reorder_point', e.target.value)} placeholder="0" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Reorder Qty</label>
              <input className="input-field" type="number" min="0" value={form.reorder_qty} onChange={e => set('reorder_qty', e.target.value)} placeholder="0" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Lead Time (days)</label>
              <input className="input-field" type="number" min="0" value={form.lead_time_days} onChange={e => set('lead_time_days', e.target.value)} placeholder="0" />
            </div>
          </div>
          {error && <p className="text-sm text-red-600">{error}</p>}
          <div className="flex justify-end gap-3 pt-2">
            <button type="button" onClick={onClose} className="btn-secondary">Cancel</button>
            <button type="submit" disabled={saving} className="btn-primary">
              {saving ? <RefreshCw size={14} className="animate-spin" /> : null}
              {item ? 'Save Changes' : 'Create Item'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Record Movement Modal ───────────────────────────────────────────────────
// Global movement recorder: pick any item (or pre-bound to one), a type, qty,
// location(s), and a note. Recording updates the item's stock atomically server-side.

function RecordMovementModal({
  item, items, onClose, onSaved,
}: {
  item?: any | null;           // optional pre-selected item
  items?: any[];               // catalog for the item picker (when not pre-selected)
  onClose: () => void;
  onSaved: () => void;
}) {
  const { selectedSiteId } = useSite();
  const [locations, setLocations] = useState<any[]>([]);
  const [form, setForm] = useState({
    item_id: item?.id ?? '',
    location_id: '',
    to_location_id: '',
    movement_type: 'receive',
    quantity: '',
    notes: '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    api.getLocations({ site_id: selectedSiteId || undefined }).then(setLocations).catch(() => {});
  }, [selectedSiteId]);

  function set(field: string, val: any) {
    setForm(f => ({ ...f, [field]: val }));
  }

  const isTransfer = form.movement_type === 'transfer';
  const isAdjust = form.movement_type === 'adjust';

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.item_id) { setError('Select an item.'); return; }
    if (!form.location_id) { setError(isTransfer ? 'Select the source location.' : 'Select a location.'); return; }
    if (isTransfer && !form.to_location_id) { setError('Select a destination location.'); return; }
    if (isTransfer && form.to_location_id === form.location_id) { setError('Source and destination must differ.'); return; }
    if (form.quantity === '' || isNaN(Number(form.quantity))) { setError('Enter a valid quantity.'); return; }
    setSaving(true);
    setError('');
    try {
      await api.createMovement({
        item_id: form.item_id,
        location_id: form.location_id,
        to_location_id: isTransfer ? form.to_location_id : undefined,
        movement_type: form.movement_type,
        quantity: parseFloat(form.quantity),
        notes: form.notes || undefined,
      });
      onSaved();
      onClose();
    } catch (err: any) {
      setError(err.message || 'Failed to record movement');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <div>
            <h2 className="font-semibold text-gray-900">Record Movement</h2>
            {item && <p className="text-xs text-gray-500 mt-0.5">{item.name}</p>}
          </div>
          <button onClick={onClose} className="btn-ghost p-1.5 rounded-lg"><X size={16} /></button>
        </div>
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {!item && (
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Item *</label>
              <select className="input-field" value={form.item_id} onChange={e => set('item_id', e.target.value)}>
                <option value="">Select item…</option>
                {(items ?? []).map(i => (
                  <option key={i.id} value={i.id}>{i.name} ({i.sku})</option>
                ))}
              </select>
            </div>
          )}
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Movement Type *</label>
            <select className="input-field" value={form.movement_type} onChange={e => set('movement_type', e.target.value)}>
              <option value="receive">Receive (+)</option>
              <option value="consume">Consume (−)</option>
              <option value="ship">Ship (−)</option>
              <option value="scrap">Scrap (−)</option>
              <option value="return">Return (+)</option>
              <option value="adjust">Adjust (±)</option>
              <option value="transfer">Transfer</option>
            </select>
          </div>
          <div className={isTransfer ? 'grid grid-cols-2 gap-3' : ''}>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">{isTransfer ? 'From Location *' : 'Location *'}</label>
              <select className="input-field" value={form.location_id} onChange={e => set('location_id', e.target.value)}>
                <option value="">Select location…</option>
                {locations.map(l => (
                  <option key={l.id} value={l.id}>{l.name} ({l.code})</option>
                ))}
              </select>
            </div>
            {isTransfer && (
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">To Location *</label>
                <select className="input-field" value={form.to_location_id} onChange={e => set('to_location_id', e.target.value)}>
                  <option value="">Select location…</option>
                  {locations.map(l => (
                    <option key={l.id} value={l.id}>{l.name} ({l.code})</option>
                  ))}
                </select>
              </div>
            )}
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">
              Quantity {isAdjust ? '(+ for in, − for out)' : ''}
            </label>
            <input
              className="input-field"
              type="number"
              step="0.001"
              value={form.quantity}
              onChange={e => set('quantity', e.target.value)}
              placeholder={isAdjust ? '±0' : '0'}
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Reason / Note</label>
            <input className="input-field" value={form.notes} onChange={e => set('notes', e.target.value)} placeholder="Optional reason or note" />
          </div>
          {error && <p className="text-sm text-red-600">{error}</p>}
          <div className="flex justify-end gap-3 pt-2">
            <button type="button" onClick={onClose} className="btn-secondary">Cancel</button>
            <button type="submit" disabled={saving} className="btn-primary">
              {saving ? <RefreshCw size={14} className="animate-spin" /> : null}
              Record Movement
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Locations Tab ───────────────────────────────────────────────────────────

function LocationsTab({ canEdit }: { canEdit: boolean }) {
  const { selectedSiteId } = useSite();
  const [locations, setLocations] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({ name: '', code: '', type: 'warehouse' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const loadLocations = useCallback(() => {
    setLoading(true);
    api.getLocations({ site_id: selectedSiteId || undefined })
      .then(data => { setLocations(data); setLoading(false); })
      .catch(() => setLoading(false));
  }, [selectedSiteId]);

  useEffect(() => { loadLocations(); }, [loadLocations]);

  function set(field: string, val: string) {
    setForm(f => ({ ...f, [field]: val }));
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim() || !form.code.trim()) { setError('Name and Code are required.'); return; }
    setSaving(true);
    setError('');
    try {
      await api.createLocation(form);
      setForm({ name: '', code: '', type: 'warehouse' });
      loadLocations();
    } catch (err: any) {
      setError(err.message || 'Failed to create location');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="card p-6 space-y-5">
      {loading ? (
        <div className="space-y-2">
          {[1,2,3].map(i => <Skeleton key={i} className="h-10" />)}
        </div>
      ) : (
        <div className="overflow-auto">
          <table className="w-full text-sm min-w-[480px]">
            <thead>
              <tr className="border-b border-gray-100">
                <th className="text-left py-2 px-3 text-xs font-semibold text-gray-500">Name</th>
                <th className="text-left py-2 px-3 text-xs font-semibold text-gray-500">Code</th>
                <th className="text-left py-2 px-3 text-xs font-semibold text-gray-500">Type</th>
                <th className="text-right py-2 px-3 text-xs font-semibold text-gray-500">Items</th>
                <th className="text-right py-2 px-3 text-xs font-semibold text-gray-500">Units</th>
              </tr>
            </thead>
            <tbody>
              {locations.length === 0 && (
                <tr>
                  <td colSpan={5} className="text-center py-6 text-gray-400 text-sm">No locations yet</td>
                </tr>
              )}
              {locations.map(l => (
                <tr key={l.id} className="border-b border-gray-50 hover:bg-gray-50">
                  <td className="py-2.5 px-3 font-medium text-gray-900">{l.name}</td>
                  <td className="py-2.5 px-3 text-gray-500 font-mono text-xs">{l.code}</td>
                  <td className="py-2.5 px-3">
                    <span className="badge-gray capitalize">{l.type}</span>
                  </td>
                  <td className="py-2.5 px-3 text-right text-gray-700">{fmtNum(l.item_count)}</td>
                  <td className="py-2.5 px-3 text-right text-gray-700">{fmtNum(l.total_units)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {canEdit && (
        <div className="border-t border-gray-100 pt-4">
          <h3 className="text-sm font-semibold text-gray-700 mb-3">New Location</h3>
          <form onSubmit={handleCreate} className="grid grid-cols-1 sm:grid-cols-4 gap-3 items-end">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Name *</label>
              <input className="input-field" value={form.name} onChange={e => set('name', e.target.value)} placeholder="Warehouse A" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Code *</label>
              <input className="input-field" value={form.code} onChange={e => set('code', e.target.value)} placeholder="WH-A" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Type</label>
              <select className="input-field" value={form.type} onChange={e => set('type', e.target.value)}>
                <option value="warehouse">Warehouse</option>
                <option value="floor">Floor</option>
                <option value="hold">Hold</option>
                <option value="other">Other</option>
              </select>
            </div>
            <button type="submit" disabled={saving} className="btn-primary">
              {saving ? <RefreshCw size={14} className="animate-spin" /> : <Plus size={14} />}
              Add
            </button>
          </form>
          {error && <p className="text-sm text-red-600 mt-2">{error}</p>}
        </div>
      )}
    </div>
  );
}

// ─── Item Detail Panel ───────────────────────────────────────────────────────

function DetailPanel({ itemId, onClose, onEdit, onRefreshList, canEdit }: {
  itemId: string;
  onClose: () => void;
  onEdit: (item: any) => void;
  onRefreshList: () => void;
  canEdit: boolean;
}) {
  const [item, setItem] = useState<any>(null);
  const [movements, setMovements] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<'stock' | 'movements'>('stock');
  const [showAdjust, setShowAdjust] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    Promise.all([
      api.getInventoryItem(itemId),
      api.getMovements({ item_id: itemId, limit: 50 }),
    ]).then(([it, mv]) => {
      setItem(it);
      setMovements(mv);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, [itemId]);

  useEffect(() => { load(); }, [load]);

  const totalStock = useMemo(() => {
    if (!item?.stock_by_location) return 0;
    return item.stock_by_location.reduce((sum: number, l: any) => sum + (l.quantity ?? 0), 0);
  }, [item]);

  const totalValue = useMemo(() => {
    if (!item) return 0;
    return totalStock * (item.unit_cost ?? 0);
  }, [item, totalStock]);

  if (loading) {
    return (
      <div className="w-full lg:flex-1 bg-white rounded-2xl border border-gray-200 shadow-sm p-6 space-y-4 min-w-0">
        <Skeleton className="h-6 w-48" />
        <Skeleton className="h-4 w-32" />
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }

  if (!item) {
    return (
      <div className="w-full lg:flex-1 bg-white rounded-2xl border border-gray-200 shadow-sm p-6 flex items-center justify-center">
        <p className="text-gray-400">Item not found</p>
      </div>
    );
  }

  const status = stockStatus(totalStock, item.reorder_point ?? 0);

  return (
    <div className="w-full lg:flex-1 bg-white rounded-2xl border border-gray-200 shadow-sm flex flex-col min-w-0 overflow-hidden">
      {showAdjust && (
        <RecordMovementModal
          item={item}
          onClose={() => setShowAdjust(false)}
          onSaved={() => { load(); onRefreshList(); }}
        />
      )}

      {/* Header */}
      <div className="px-5 py-4 border-b border-gray-100 flex items-start gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="badge-blue font-mono text-xs">{item.sku}</span>
            <span className={`badge ${status === 'ok' ? 'badge-green' : status === 'low' ? 'badge-amber' : 'badge-red'}`}>
              {status === 'ok' ? 'In Stock' : status === 'low' ? 'Low Stock' : 'Critical'}
            </span>
          </div>
          <h2 className="text-lg font-bold text-gray-900 mt-1 truncate">{item.name}</h2>
          <div className="flex items-center gap-3 mt-0.5 text-xs text-gray-500">
            {item.category && <span>{item.category}</span>}
            <span className="badge-gray">{item.unit_of_measure ?? 'ea'}</span>
          </div>
        </div>
        <div className="flex items-center gap-1 flex-shrink-0">
          {canEdit && (
            <button onClick={() => onEdit(item)} className="btn-ghost p-1.5 rounded-lg" title="Edit">
              <Pencil size={14} />
            </button>
          )}
          <button onClick={onClose} className="btn-ghost p-1.5 rounded-lg" title="Close">
            <X size={16} />
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-gray-100">
        {(['stock', 'movements'] as const).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`flex-1 py-2.5 text-sm font-medium transition-colors capitalize ${
              tab === t ? 'text-blue-600 border-b-2 border-blue-600' : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            {t === 'movements' ? 'Movements' : 'Stock'}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-y-auto p-5">
        {tab === 'stock' && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="bg-gray-50 rounded-xl p-3">
                <div className="text-xs text-gray-500 mb-0.5">Total Stock</div>
                <div className="text-xl font-bold text-gray-900">{fmtNum(totalStock)} <span className="text-sm font-normal text-gray-400">{item.unit_of_measure}</span></div>
              </div>
              <div className="bg-gray-50 rounded-xl p-3">
                <div className="text-xs text-gray-500 mb-0.5">Total Value</div>
                <div className="text-xl font-bold text-gray-900">{fmtCurrency(totalValue)}</div>
              </div>
            </div>
            {item.reorder_point != null && (
              <div className="flex items-center gap-2 text-xs text-gray-500 bg-gray-50 rounded-xl p-3">
                <AlertTriangle size={13} className={status !== 'ok' ? 'text-red-500' : 'text-gray-400'} />
                <span>Reorder point: <strong>{fmtNum(item.reorder_point)} {item.unit_of_measure}</strong></span>
                {item.reorder_qty ? <span className="ml-2">· Reorder qty: <strong>{fmtNum(item.reorder_qty)}</strong></span> : null}
              </div>
            )}

            <div>
              <div className="section-label">By Location</div>
              {(!item.stock_by_location || item.stock_by_location.length === 0) && (
                <p className="text-sm text-gray-400 text-center py-4">No stock records</p>
              )}
              <div className="space-y-2">
                {(item.stock_by_location ?? []).map((sl: any) => {
                  const ls = sl.quantity <= 0 ? 'critical' : stockStatus(sl.quantity, item.reorder_point ?? 0);
                  return (
                    <div key={sl.location_id} className="flex items-center justify-between p-3 rounded-xl border border-gray-100 hover:bg-gray-50">
                      <div className="flex items-center gap-2">
                        <MapPin size={13} className="text-gray-400" />
                        <span className="text-sm font-medium text-gray-800">{sl.location_name}</span>
                        {sl.location_code && <span className="text-xs text-gray-400 font-mono">{sl.location_code}</span>}
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold text-gray-900">{fmtNum(sl.quantity)}</span>
                        <span className={`badge ${ls === 'ok' ? 'badge-green' : ls === 'low' ? 'badge-amber' : 'badge-red'}`}>
                          {ls === 'ok' ? 'OK' : ls === 'low' ? 'Low' : 'Critical'}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {canEdit && (
              <button onClick={() => setShowAdjust(true)} className="btn-secondary w-full justify-center">
                <Layers size={14} />
                Record Movement
              </button>
            )}
          </div>
        )}

        {tab === 'movements' && (
          <div className="space-y-1">
            {movements.length === 0 && (
              <p className="text-sm text-gray-400 text-center py-6">No movements recorded</p>
            )}
            {movements.map((mv: any) => {
              const cfg = MOVE_CONFIG[mv.movement_type] ?? MOVE_CONFIG.adjust;
              const Icon = cfg.icon;
              const isPositive = mv.quantity > 0;
              const qtyStr = (isPositive && mv.movement_type !== 'adjust' ? '+' : '') + fmtNum(mv.quantity);
              return (
                <div key={mv.id} className="flex items-center gap-3 py-2.5 border-b border-gray-50 last:border-0">
                  <div className={`w-7 h-7 ${cfg.bgColor} rounded-lg flex items-center justify-center flex-shrink-0`}>
                    <Icon size={13} className={cfg.color} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className={`text-xs font-semibold ${cfg.color}`}>{cfg.label}</span>
                      <span className="text-xs text-gray-400">{fmtDate(mv.created_at)}</span>
                    </div>
                    <div className="text-xs text-gray-500 truncate">
                      {mv.location_name && <span>{mv.location_name}</span>}
                      {mv.created_by && <span className="ml-2 text-gray-400">· {mv.created_by}</span>}
                      {mv.notes && <span className="ml-2 text-gray-400">· {mv.notes}</span>}
                    </div>
                  </div>
                  <span className={`text-sm font-bold flex-shrink-0 ${
                    mv.quantity > 0 ? 'text-emerald-600' : 'text-red-600'
                  }`}>
                    {qtyStr}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

interface InventoryViewFilters {
  search: string;
  category: string;
  lowStockOnly: boolean;
}

type TabKey = 'overview' | 'items' | 'movements' | 'locations';

// ─── Overview Tab ─────────────────────────────────────────────────────────────

function OverviewTab({
  summary, loading, onSelectItem,
}: {
  summary: InventoryTrackerSummary | null;
  loading: boolean;
  onSelectItem: (id: string) => void;
}) {
  const chartData = useMemo(() => (summary?.value_by_category ?? []).slice(0, 8), [summary]);

  return (
    <div className="space-y-5">
      {/* KPI cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {loading || !summary ? (
          [1,2,3,4].map(i => (
            <div key={i} className="stat-card">
              <div className="flex items-center gap-3">
                <Skeleton className="w-10 h-10 rounded-xl" />
                <div className="space-y-1.5 flex-1">
                  <Skeleton className="h-6 w-16" />
                  <Skeleton className="h-3 w-24" />
                </div>
              </div>
            </div>
          ))
        ) : (
          <>
            <SummaryCard
              icon={<Package size={18} className="text-blue-600" />}
              iconBg="bg-blue-50"
              label="Total SKUs"
              value={fmtNum(summary.total_items)}
              sub={`${summary.categories.length} categories`}
            />
            <SummaryCard
              icon={<DollarSign size={18} className="text-emerald-600" />}
              iconBg="bg-emerald-50"
              label="Total Stock Value"
              value={fmtCurrencyWhole(summary.total_value)}
              sub="across all locations"
            />
            <SummaryCard
              icon={<AlertTriangle size={18} className="text-amber-600" />}
              iconBg="bg-amber-50"
              label="Below Reorder Point"
              value={fmtNum(summary.low_stock)}
              sub="low-stock alerts"
            />
            <SummaryCard
              icon={<PackageX size={18} className="text-red-600" />}
              iconBg="bg-red-50"
              label="Out of Stock"
              value={fmtNum(summary.out_of_stock)}
              sub="items at zero"
            />
          </>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Stock value by category chart */}
        <div className="card p-5">
          <h3 className="text-sm font-semibold text-gray-700 mb-4">Stock Value by Category</h3>
          {loading || !summary ? (
            <Skeleton className="h-64 w-full" />
          ) : chartData.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-16">No stock value to display</p>
          ) : (
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={chartData} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                <XAxis dataKey="category" tick={{ fontSize: 11, fill: '#64748b' }} tickLine={false} axisLine={{ stroke: '#e2e8f0' }} />
                <YAxis tick={{ fontSize: 11, fill: '#64748b' }} tickLine={false} axisLine={false}
                  tickFormatter={(v) => '$' + (v >= 1000 ? `${(v / 1000).toFixed(0)}k` : v)} />
                <Tooltip
                  formatter={(v: any) => [fmtCurrency(Number(v)), 'Value']}
                  contentStyle={{ borderRadius: 12, border: '1px solid #e2e8f0', fontSize: 12 }}
                />
                <Bar dataKey="value" radius={[6, 6, 0, 0]}>
                  {chartData.map((_, i) => <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* Low-stock alert list */}
        <div className="card p-5">
          <div className="flex items-center gap-2 mb-4">
            <AlertTriangle size={15} className="text-amber-500" />
            <h3 className="text-sm font-semibold text-gray-700">Low-Stock Alerts</h3>
          </div>
          {loading || !summary ? (
            <div className="space-y-2">{[1,2,3,4].map(i => <Skeleton key={i} className="h-12" />)}</div>
          ) : summary.low_stock_list.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-16">All items are above their reorder points</p>
          ) : (
            <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
              {summary.low_stock_list.map(row => {
                const out = row.total_quantity <= 0;
                return (
                  <button
                    key={row.id}
                    onClick={() => onSelectItem(row.id)}
                    className="w-full flex items-center justify-between p-3 rounded-xl border border-gray-100 hover:bg-gray-50 text-left transition-colors"
                  >
                    <div className="min-w-0">
                      <div className="font-medium text-gray-900 text-sm truncate">{row.name}</div>
                      <div className="text-xs text-gray-400 font-mono">{row.sku}</div>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <div className="text-right">
                        <div className={`text-sm font-bold ${out ? 'text-red-600' : 'text-amber-600'}`}>
                          {fmtNum(row.total_quantity)} <span className="text-xs font-normal text-gray-400">{row.unit_of_measure}</span>
                        </div>
                        <div className="text-xs text-gray-400">reorder at {fmtNum(row.reorder_point)}</div>
                      </div>
                      <span className={`badge ${out ? 'badge-red' : 'badge-amber'}`}>{out ? 'Out' : 'Low'}</span>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Movements Tab ────────────────────────────────────────────────────────────

const MOVEMENT_FILTER_TYPES = ['', 'receive', 'consume', 'ship', 'scrap', 'return', 'adjust', 'transfer'];

function MovementsTab({
  items, canEdit, reloadKey, onRecord,
}: {
  items: any[];
  canEdit: boolean;
  reloadKey: number;
  onRecord: () => void;
}) {
  const [movements, setMovements] = useState<InventoryMovement[]>([]);
  const [loading, setLoading] = useState(true);
  const [typeFilter, setTypeFilter] = useState('');
  const [days, setDays] = useState(30);

  const load = useCallback(() => {
    setLoading(true);
    api.getMovements({
      movement_type: typeFilter || undefined,
      days,
      limit: 200,
    }).then(data => { setMovements(data); setLoading(false); })
      .catch(() => setLoading(false));
  }, [typeFilter, days]);

  useEffect(() => { load(); }, [load, reloadKey]);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative">
          <select className="input-field pr-8 appearance-none cursor-pointer" value={typeFilter} onChange={e => setTypeFilter(e.target.value)}>
            {MOVEMENT_FILTER_TYPES.map(t => (
              <option key={t} value={t}>{t === '' ? 'All Types' : (MOVE_CONFIG[t]?.label ?? t)}</option>
            ))}
          </select>
          <ChevronDown size={13} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
        </div>
        <div className="relative">
          <select className="input-field pr-8 appearance-none cursor-pointer" value={days} onChange={e => setDays(Number(e.target.value))}>
            {[7, 14, 30, 90, 365].map(d => <option key={d} value={d}>Last {d} days</option>)}
          </select>
          <ChevronDown size={13} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
        </div>
        <div className="flex-1" />
        {canEdit && (
          <button onClick={onRecord} disabled={items.length === 0} className="btn-primary whitespace-nowrap">
            <Plus size={14} />
            Record Movement
          </button>
        )}
      </div>

      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm whitespace-nowrap">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50/60">
                <th className="text-left py-3 px-4 text-xs font-semibold text-gray-500">Type</th>
                <th className="text-left py-3 px-4 text-xs font-semibold text-gray-500">Item</th>
                <th className="text-right py-3 px-4 text-xs font-semibold text-gray-500">Quantity</th>
                <th className="text-left py-3 px-4 text-xs font-semibold text-gray-500">Location</th>
                <th className="text-left py-3 px-4 text-xs font-semibold text-gray-500">Reason / Note</th>
                <th className="text-left py-3 px-4 text-xs font-semibold text-gray-500">User</th>
                <th className="text-left py-3 px-4 text-xs font-semibold text-gray-500">When</th>
              </tr>
            </thead>
            <tbody>
              {loading && [1,2,3,4,5].map(i => (
                <tr key={i} className="border-b border-gray-50">
                  {[1,2,3,4,5,6,7].map(j => <td key={j} className="py-3 px-4"><Skeleton className="h-4 w-full" /></td>)}
                </tr>
              ))}
              {!loading && movements.length === 0 && (
                <tr>
                  <td colSpan={7} className="py-16 text-center">
                    <div className="flex flex-col items-center gap-3">
                      <div className="w-12 h-12 bg-gray-100 rounded-xl flex items-center justify-center">
                        <ClipboardList size={22} className="text-gray-400" />
                      </div>
                      <p className="text-gray-500 font-medium">No movements recorded</p>
                      <p className="text-xs text-gray-400">Stock receipts, issues, adjustments and transfers will appear here</p>
                    </div>
                  </td>
                </tr>
              )}
              {!loading && movements.map(mv => {
                const cfg = MOVE_CONFIG[mv.movement_type] ?? MOVE_CONFIG.adjust;
                const Icon = cfg.icon;
                const isPositive = mv.quantity > 0;
                const qtyStr = (isPositive && mv.movement_type !== 'adjust' ? '+' : '') + fmtNum(mv.quantity);
                return (
                  <tr key={mv.id} className="border-b border-gray-50 hover:bg-gray-50">
                    <td className="py-3 px-4">
                      <span className={`inline-flex items-center gap-1.5 ${cfg.bgColor} ${cfg.color} px-2 py-1 rounded-lg text-xs font-semibold`}>
                        <Icon size={12} />
                        {cfg.label}
                      </span>
                    </td>
                    <td className="py-3 px-4">
                      <div className="font-medium text-gray-900 truncate max-w-[200px]">{mv.item_name ?? '—'}</div>
                      {mv.sku && <div className="text-xs text-gray-400 font-mono">{mv.sku}</div>}
                    </td>
                    <td className={`py-3 px-4 text-right font-bold ${mv.quantity > 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                      {qtyStr}
                    </td>
                    <td className="py-3 px-4 text-gray-600">{mv.location_name ?? '—'}</td>
                    <td className="py-3 px-4 text-gray-500 max-w-[220px] truncate">{mv.notes || '—'}</td>
                    <td className="py-3 px-4 text-gray-600">{mv.created_by || mv.operator_name || '—'}</td>
                    <td className="py-3 px-4 text-gray-400">{fmtDate(mv.created_at)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {!loading && movements.length > 0 && (
          <div className="px-4 py-2.5 border-t border-gray-50">
            <span className="text-xs text-gray-400">{movements.length} movement{movements.length !== 1 ? 's' : ''}</span>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Main Page ───────────────────────────────────────────────────────────────

export default function Inventory() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [tab, setTab] = useState<TabKey>('overview');

  const [trackerSummary, setTrackerSummary] = useState<InventoryTrackerSummary | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(true);
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('');
  const [lowStockOnly, setLowStockOnly] = useState(false);

  const applySavedView = (f: InventoryViewFilters) => {
    setSearch(f.search);
    setCategory(f.category);
    setLowStockOnly(f.lowStockOnly);
  };

  const [showItemModal, setShowItemModal] = useState(false);
  const [editingItem, setEditingItem] = useState<any>(null);
  const [showRecordMovement, setShowRecordMovement] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [showScanner, setShowScanner] = useState(false);
  const [loadingSample, setLoadingSample] = useState(false);
  const [sampleError, setSampleError] = useState('');
  const [movementsReloadKey, setMovementsReloadKey] = useState(0);
  const { isAtLeast, canEdit } = useAuth();

  const loadSummary = useCallback(() => {
    setSummaryLoading(true);
    api.getInventoryTrackerSummary()
      .then(s => { setTrackerSummary(s); setSummaryLoading(false); })
      .catch(() => setSummaryLoading(false));
  }, []);

  const loadItems = useCallback(() => {
    setLoading(true);
    const params: any = {};
    if (search) params.search = search;
    if (category) params.category = category;
    if (lowStockOnly) params.low_stock = true;
    api.getInventoryItems(params)
      .then(data => { setItems(data); setLoading(false); })
      .catch(() => setLoading(false));
  }, [search, category, lowStockOnly]);

  useEffect(() => { loadSummary(); }, [loadSummary]);
  useEffect(() => { loadItems(); }, [loadItems]);

  // Deep-linked item detail forces the Items tab so the panel is visible.
  useEffect(() => { if (id) setTab('items'); }, [id]);

  const handleLoadSampleData = async () => {
    setLoadingSample(true);
    setSampleError('');
    try {
      await api.loadSampleData();
      loadItems();
      loadSummary();
    } catch (err: any) {
      setSampleError(err?.message || 'Failed to load sample data');
    } finally {
      setLoadingSample(false);
    }
  };

  function refresh() {
    loadSummary();
    loadItems();
    setMovementsReloadKey(k => k + 1);
  }

  async function handleDelete(item: any) {
    if (!confirm(`Delete "${item.name}"? This will deactivate the item.`)) return;
    setDeletingId(item.id);
    try {
      await api.deleteInventoryItem(item.id);
      if (id === item.id) navigate('/inventory');
      refresh();
    } catch (err: any) {
      alert(err.message || 'Delete failed');
    } finally {
      setDeletingId(null);
    }
  }

  function selectItem(itemId: string) {
    if (id === itemId) {
      navigate('/inventory');
    } else {
      navigate(`/inventory/${itemId}`);
    }
  }

  const categories: string[] = useMemo(() => {
    if (trackerSummary?.categories?.length) return trackerSummary.categories;
    const cats = [...new Set(items.map((i: any) => i.category).filter(Boolean))] as string[];
    return cats;
  }, [trackerSummary, items]);

  const TABS: { key: TabKey; label: string; icon: any }[] = [
    { key: 'overview',  label: 'Overview',  icon: LayoutGrid },
    { key: 'items',     label: 'Items',     icon: Package },
    { key: 'movements', label: 'Movements', icon: ClipboardList },
    { key: 'locations', label: 'Locations', icon: MapPin },
  ];

  return (
    <div className="p-6 space-y-5 bg-[#f8fafc] min-h-full">
      <ModuleOnboarding
        moduleId="inventory"
        title="Inventory"
        description="Inventory tracks your raw materials, WIP, and finished goods across storage locations."
        steps={[
          "Add items with SKU, unit of measure, and reorder point",
          "Set up storage locations for each area of the plant",
          "Record stock movements as materials flow",
          "Reorder alerts trigger when stock falls below minimum",
        ]}
        icon={Package}
        color="#f97316"
      />
      {/* Modals */}
      {showItemModal && (
        <ItemModal
          item={editingItem}
          onClose={() => { setShowItemModal(false); setEditingItem(null); }}
          onSaved={refresh}
        />
      )}
      {showRecordMovement && (
        <RecordMovementModal
          items={items}
          onClose={() => setShowRecordMovement(false)}
          onSaved={refresh}
        />
      )}
      {showScanner && (
        <BarcodeScannerModal
          title="Scan Item Barcode"
          hint="Scan a SKU barcode to search for that item"
          onClose={() => setShowScanner(false)}
          onScan={code => { setSearch(code.trim()); setTab('items'); setShowScanner(false); }}
        />
      )}

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Inventory Tracker</h1>
          <p className="text-gray-500 text-sm mt-0.5">Track stock levels, movements and locations</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <button onClick={() => api.downloadExport('inventory')} className="btn-secondary whitespace-nowrap">
            <Download size={14} />
            Export CSV
          </button>
          {canEdit && (
            <button onClick={() => setShowRecordMovement(true)} disabled={items.length === 0} className="btn-secondary whitespace-nowrap">
              <ClipboardList size={14} />
              Record Movement
            </button>
          )}
          {canEdit && (
            <button onClick={() => { setEditingItem(null); setShowItemModal(true); }} className="btn-primary whitespace-nowrap">
              <Plus size={14} />
              New Item
            </button>
          )}
        </div>
      </div>

      {/* Tab bar */}
      <div className="flex items-center gap-1 border-b border-gray-200">
        {TABS.map(t => {
          const Icon = t.icon;
          const active = tab === t.key;
          return (
            <button
              key={t.key}
              onClick={() => { if (t.key !== 'items' && id) navigate('/inventory'); setTab(t.key); }}
              className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium transition-colors -mb-px border-b-2 ${
                active ? 'text-blue-600 border-blue-600' : 'text-gray-500 border-transparent hover:text-gray-700'
              }`}
            >
              <Icon size={15} />
              {t.label}
              {t.key === 'overview' && trackerSummary && trackerSummary.low_stock > 0 && (
                <span className="ml-1 text-xs bg-red-100 text-red-700 px-1.5 rounded-full font-semibold">{trackerSummary.low_stock}</span>
              )}
            </button>
          );
        })}
      </div>

      {/* ─── OVERVIEW ─── */}
      {tab === 'overview' && (
        <OverviewTab
          summary={trackerSummary}
          loading={summaryLoading}
          onSelectItem={(itemId) => { setTab('items'); navigate(`/inventory/${itemId}`); }}
        />
      )}

      {/* ─── ITEMS ─── */}
      {tab === 'items' && (
        <>
          {/* Toolbar */}
          <div className="flex items-center gap-3 flex-wrap">
            <div className="relative flex-1 min-w-48">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                className="input-field pl-8 pr-9"
                placeholder="Search items by name or SKU…"
                value={search}
                onChange={e => setSearch(e.target.value)}
              />
              <button
                onClick={() => setShowScanner(true)}
                title="Scan barcode"
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-blue-600 transition-colors"
              >
                <ScanLine size={15} />
              </button>
            </div>
            <div className="relative">
              <select
                className="input-field pr-8 appearance-none cursor-pointer"
                value={category}
                onChange={e => setCategory(e.target.value)}
              >
                <option value="">All Categories</option>
                {categories.map((c: string) => <option key={c} value={c}>{c}</option>)}
              </select>
              <ChevronDown size={13} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
            </div>
            <button
              onClick={() => setLowStockOnly(v => !v)}
              className={`btn-secondary ${lowStockOnly ? 'bg-red-50 border-red-200 text-red-700' : ''}`}
            >
              <AlertTriangle size={14} />
              Low Stock Only
              {lowStockOnly && <span className="w-2 h-2 bg-red-500 rounded-full" />}
            </button>

            <SavedViewsBar<InventoryViewFilters>
              storageKey="hm_saved_views_inventory"
              currentFilters={{ search, category, lowStockOnly }}
              onApply={applySavedView}
            />
          </div>

          {/* Main content: list + optional detail */}
          <div className={`flex flex-col lg:flex-row gap-5 items-start ${id ? 'lg:min-h-[500px]' : ''}`}>

            {/* Items table */}
            <div className={`card overflow-hidden flex-shrink-0 w-full ${id ? 'lg:w-[55%]' : 'lg:flex-1'}`}>
              <div className="overflow-x-auto">
                <table className="w-full text-sm whitespace-nowrap">
                  <thead>
                    <tr className="border-b border-gray-100 bg-gray-50/60">
                      <th className="text-left py-3 px-4 text-xs font-semibold text-gray-500 whitespace-nowrap">SKU</th>
                      <th className="text-left py-3 px-4 text-xs font-semibold text-gray-500">Name</th>
                      {!id && <th className="text-left py-3 px-4 text-xs font-semibold text-gray-500">Category</th>}
                      <th className="text-right py-3 px-4 text-xs font-semibold text-gray-500 whitespace-nowrap">Stock</th>
                      {!id && <th className="text-right py-3 px-4 text-xs font-semibold text-gray-500 whitespace-nowrap">Reorder Pt</th>}
                      {!id && <th className="text-right py-3 px-4 text-xs font-semibold text-gray-500 whitespace-nowrap">Unit Cost</th>}
                      {!id && <th className="text-right py-3 px-4 text-xs font-semibold text-gray-500 whitespace-nowrap">Value</th>}
                      <th className="text-left py-3 px-4 text-xs font-semibold text-gray-500">Status</th>
                      <th className="py-3 px-4" />
                    </tr>
                  </thead>
                  <tbody>
                    {loading && (
                      [1,2,3,4,5].map(i => (
                        <tr key={i} className="border-b border-gray-50">
                          {[1,2,3,4,5,6,7,8].map(j => (
                            <td key={j} className="py-3 px-4">
                              <Skeleton className="h-4 w-full" />
                            </td>
                          ))}
                        </tr>
                      ))
                    )}
                    {!loading && items.length === 0 && (
                      <tr>
                        <td colSpan={9} className="py-16 text-center">
                          <div className="flex flex-col items-center gap-3">
                            <div className="w-12 h-12 bg-gray-100 rounded-xl flex items-center justify-center">
                              <Package size={22} className="text-gray-400" />
                            </div>
                            <p className="text-gray-500 font-medium">No items found</p>
                            <p className="text-xs text-gray-400">
                              {search || category || lowStockOnly ? 'Try adjusting your filters' : 'Get started by adding your first item'}
                            </p>
                            {!search && !category && !lowStockOnly && canEdit && (
                              <div className="flex items-center justify-center gap-2 mt-1">
                                <button
                                  onClick={() => { setEditingItem(null); setShowItemModal(true); }}
                                  className="btn-primary"
                                >
                                  <Plus size={14} />
                                  New Item
                                </button>
                                {isAtLeast('manager') && (
                                  <button onClick={handleLoadSampleData} disabled={loadingSample} className="btn-secondary">
                                    {loadingSample ? <RefreshCw size={14} className="animate-spin" /> : <Database size={14} />}
                                    Load Sample Data
                                  </button>
                                )}
                              </div>
                            )}
                            {sampleError && (
                              <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2 mt-1 max-w-sm mx-auto">{sampleError}</p>
                            )}
                          </div>
                        </td>
                      </tr>
                    )}
                    {!loading && items.map((item: any) => {
                      const totalQty = item.total_quantity ?? item.total_stock ?? item.quantity ?? 0;
                      const rp = item.reorder_point ?? 0;
                      const status = stockStatus(totalQty, rp);
                      const isSelected = id === item.id;
                      const isLow = status !== 'ok';
                      return (
                        <tr
                          key={item.id}
                          onClick={() => selectItem(item.id)}
                          className={`border-b border-gray-50 cursor-pointer transition-colors ${
                            isSelected
                              ? 'bg-blue-50 hover:bg-blue-50'
                              : isLow
                              ? 'bg-red-50/40 hover:bg-red-50'
                              : 'hover:bg-gray-50'
                          }`}
                        >
                          <td className="py-3 px-4">
                            <span className="font-mono text-xs text-gray-600 bg-gray-100 px-1.5 py-0.5 rounded">{item.sku}</span>
                          </td>
                          <td className="py-3 px-4">
                            <div className="font-medium text-gray-900 truncate max-w-[180px]">{item.name}</div>
                            {item.description && !id && (
                              <div className="text-xs text-gray-400 truncate max-w-[180px]">{item.description}</div>
                            )}
                          </td>
                          {!id && (
                            <td className="py-3 px-4">
                              {item.category ? <span className="badge-gray">{item.category}</span> : <span className="text-gray-300">—</span>}
                            </td>
                          )}
                          <td className="py-3 px-4 text-right">
                            <span className={`font-semibold ${
                              status === 'ok' ? 'text-emerald-700' : status === 'low' ? 'text-amber-700' : 'text-red-700'
                            }`}>
                              {fmtNum(totalQty)}
                            </span>
                            <span className="text-xs text-gray-400 ml-1">{item.unit_of_measure}</span>
                          </td>
                          {!id && (
                            <td className="py-3 px-4 text-right text-gray-500">{rp > 0 ? fmtNum(rp) : '—'}</td>
                          )}
                          {!id && (
                            <td className="py-3 px-4 text-right text-gray-700">
                              {item.unit_cost != null ? fmtCurrency(item.unit_cost) : '—'}
                            </td>
                          )}
                          {!id && (
                            <td className="py-3 px-4 text-right font-medium text-gray-900">
                              {item.unit_cost != null ? fmtCurrency(totalQty * item.unit_cost) : '—'}
                            </td>
                          )}
                          <td className="py-3 px-4">
                            <span className={`badge ${
                              status === 'ok' ? 'badge-green' : status === 'low' ? 'badge-amber' : 'badge-red'
                            }`}>
                              {status === 'ok' ? 'In Stock' : status === 'low' ? 'Low Stock' : 'Critical'}
                            </span>
                          </td>
                          <td className="py-3 px-4">
                            {canEdit && (
                              <div className="flex items-center gap-1 justify-end" onClick={e => e.stopPropagation()}>
                                <button
                                  onClick={() => { setEditingItem(item); setShowItemModal(true); }}
                                  className="btn-ghost p-1.5 rounded-lg"
                                  title="Edit"
                                >
                                  <Pencil size={13} />
                                </button>
                                <button
                                  onClick={() => handleDelete(item)}
                                  disabled={deletingId === item.id}
                                  className="btn-ghost p-1.5 rounded-lg text-red-500 hover:bg-red-50"
                                  title="Delete"
                                >
                                  {deletingId === item.id
                                    ? <RefreshCw size={13} className="animate-spin" />
                                    : <Trash2 size={13} />
                                  }
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

              {!loading && items.length > 0 && (
                <div className="px-4 py-2.5 border-t border-gray-50 flex items-center justify-between">
                  <span className="text-xs text-gray-400">{items.length} item{items.length !== 1 ? 's' : ''}</span>
                  <div className="flex items-center gap-3 text-xs text-gray-400">
                    <span className="flex items-center gap-1"><span className="w-2 h-2 bg-emerald-400 rounded-full" /> In Stock</span>
                    <span className="flex items-center gap-1"><span className="w-2 h-2 bg-amber-400 rounded-full" /> Low</span>
                    <span className="flex items-center gap-1"><span className="w-2 h-2 bg-red-400 rounded-full" /> Critical</span>
                  </div>
                </div>
              )}
            </div>

            {/* Detail panel */}
            {id && (
              <DetailPanel
                itemId={id}
                onClose={() => navigate('/inventory')}
                onEdit={(item) => { setEditingItem(item); setShowItemModal(true); }}
                onRefreshList={refresh}
                canEdit={canEdit}
              />
            )}
          </div>
        </>
      )}

      {/* ─── MOVEMENTS ─── */}
      {tab === 'movements' && (
        <MovementsTab
          items={items}
          canEdit={canEdit}
          reloadKey={movementsReloadKey}
          onRecord={() => setShowRecordMovement(true)}
        />
      )}

      {/* ─── LOCATIONS ─── */}
      {tab === 'locations' && (
        <LocationsTab canEdit={canEdit} />
      )}
    </div>
  );
}

import { useEffect, useState, useCallback, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../api/client';
import ActivityLog from '../components/shared/ActivityLog';
import SavedViewsBar from '../components/shared/SavedViewsBar';
import { useAuth } from '../context/AuthContext';
import {
  Plus, Search, Download, Eye, Trash2, Send, Package, Star,
  X, CheckCircle, Building2, Phone,
  Mail, Clock, Edit2, TrendingUp, ShoppingCart, History,
} from 'lucide-react';

// ── Types ─────────────────────────────────────────────────────────────────────

type POStatus = 'draft' | 'sent' | 'partial' | 'received' | 'cancelled';
type PaymentTerms = 'net15' | 'net30' | 'net45' | 'net60' | 'cod';

interface Vendor {
  id: string;
  name: string;
  code: string;
  contact_name: string;
  email: string;
  phone: string;
  address: string;
  payment_terms: PaymentTerms;
  lead_time_days: number;
  rating: number;
  notes: string;
  is_active: boolean;
  po_count?: number;
}

interface POLine {
  id: string;
  item_id: string;
  item_sku: string;
  item_name: string;
  quantity_ordered: number;
  quantity_received: number;
  unit_cost: number;
  notes: string;
}

interface PurchaseOrder {
  id: string;
  po_number: string;
  vendor_id: string;
  vendor_name: string;
  status: POStatus;
  order_date: string;
  expected_date: string;
  received_date?: string;
  shipping_cost: number;
  notes: string;
  total_amount: number;
  total_received: number;
  lines?: POLine[];
  line_count?: number;
}

interface PurchasingSummary {
  by_status: { status: string; count: number; value: number }[];
  total_vendors: number;
  open_pos: number;
}

interface InventoryItem {
  id: string;
  sku: string;
  name: string;
  unit_of_measure: string;
}

interface Location {
  id: string;
  name: string;
  code: string;
}

interface VendorFormData {
  name: string;
  code: string;
  contact_name: string;
  email: string;
  phone: string;
  address: string;
  payment_terms: PaymentTerms;
  lead_time_days: number;
  rating: number;
  notes: string;
}

interface PODraftLine {
  item_id: string;
  item_sku: string;
  item_name: string;
  quantity_ordered: number;
  unit_cost: number;
  notes: string;
}

interface CreatePOForm {
  vendor_id: string;
  expected_date: string;
  shipping_cost: number;
  notes: string;
  lines: PODraftLine[];
}

interface ReceiptEntry {
  line_id: string;
  item_name: string;
  quantity_ordered: number;
  quantity_received: number;
  remaining: number;
  qty_to_receive: number;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const PO_STATUS_FILTERS = ['All', 'draft', 'sent', 'partial', 'received', 'cancelled'] as const;

const PO_STATUS_BADGE: Record<POStatus, string> = {
  draft:     'badge-gray',
  sent:      'badge-blue',
  partial:   'badge-amber',
  received:  'badge-green',
  cancelled: 'badge-red',
};

const PO_STATUS_LABEL: Record<POStatus, string> = {
  draft:     'Draft',
  sent:      'Sent',
  partial:   'Partial',
  received:  'Received',
  cancelled: 'Cancelled',
};

const PAYMENT_TERMS_OPTIONS: { value: PaymentTerms; label: string }[] = [
  { value: 'net15', label: 'Net 15' },
  { value: 'net30', label: 'Net 30' },
  { value: 'net45', label: 'Net 45' },
  { value: 'net60', label: 'Net 60' },
  { value: 'cod',   label: 'COD' },
];

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmt(amount: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount ?? 0);
}

function fmtWhole(amount: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(amount ?? 0);
}

function fmtDate(iso: string | undefined) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
}

function fmtDateShort(iso: string | undefined) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString([], { month: 'short', day: 'numeric' });
}

function defaultVendorForm(): VendorFormData {
  return { name: '', code: '', contact_name: '', email: '', phone: '', address: '', payment_terms: 'net30', lead_time_days: 14, rating: 3, notes: '' };
}

function defaultPOForm(): CreatePOForm {
  const d = new Date();
  d.setDate(d.getDate() + 14);
  return { vendor_id: '', expected_date: d.toISOString().slice(0, 10), shipping_cost: 0, notes: '', lines: [] };
}

// ── Sub-components ────────────────────────────────────────────────────────────

function SkeletonRow({ cols }: { cols: number }) {
  return (
    <tr>
      {Array.from({ length: cols }).map((_, i) => (
        <td key={i} className="px-4 py-3">
          <div className="h-4 bg-gray-100 rounded animate-pulse" />
        </td>
      ))}
    </tr>
  );
}

function SkeletonCard() {
  return (
    <div className="card p-5 space-y-3 animate-pulse">
      <div className="flex justify-between">
        <div className="h-5 bg-gray-100 rounded w-32" />
        <div className="h-5 bg-gray-100 rounded w-16" />
      </div>
      <div className="h-4 bg-gray-100 rounded w-48" />
      <div className="h-4 bg-gray-100 rounded w-40" />
      <div className="flex gap-2 pt-1">
        <div className="h-8 bg-gray-100 rounded w-16" />
        <div className="h-8 bg-gray-100 rounded w-20" />
      </div>
    </div>
  );
}

function RatingDots({ rating, max = 5 }: { rating: number; max?: number }) {
  return (
    <div className="flex gap-1">
      {Array.from({ length: max }).map((_, i) => (
        <div
          key={i}
          className="w-2.5 h-2.5 rounded-full"
          style={{ backgroundColor: i < rating ? 'var(--accent)' : '#e5e7eb' }}
        />
      ))}
    </div>
  );
}

function StarRatingSelect({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return (
    <div className="flex gap-1">
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          onClick={() => onChange(n)}
          className="focus:outline-none"
        >
          <Star
            className="w-5 h-5"
            fill={n <= value ? 'var(--accent)' : 'none'}
            stroke={n <= value ? 'var(--accent)' : '#9ca3af'}
          />
        </button>
      ))}
    </div>
  );
}

function ProgressBar({ value, max }: { value: number; max: number }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  return (
    <div className="w-full bg-gray-100 rounded-full h-1.5">
      <div
        className="h-1.5 rounded-full transition-all"
        style={{ width: `${pct}%`, backgroundColor: pct >= 100 ? '#10b981' : pct > 0 ? '#f59e0b' : '#e5e7eb' }}
      />
    </div>
  );
}

function Modal({ title, onClose, children, wide }: { title: string; onClose: () => void; children: React.ReactNode; wide?: boolean }) {
  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-start justify-center p-4 overflow-y-auto">
      <div className={`bg-white rounded-2xl shadow-xl w-full my-8 ${wide ? 'max-w-3xl' : 'max-w-lg'}`}>
        <div className="flex items-center justify-between p-6 border-b border-gray-100">
          <h2 className="text-lg font-semibold text-gray-900">{title}</h2>
          <button onClick={onClose} className="btn-ghost p-1.5 rounded-lg"><X className="w-4 h-4" /></button>
        </div>
        <div className="p-6">{children}</div>
      </div>
    </div>
  );
}

// ── Vendor Modal ──────────────────────────────────────────────────────────────

function VendorModal({
  initial,
  onSave,
  onClose,
}: {
  initial?: Vendor;
  onSave: (data: VendorFormData) => Promise<void>;
  onClose: () => void;
}) {
  const [form, setForm] = useState<VendorFormData>(
    initial ? {
      name: initial.name, code: initial.code, contact_name: initial.contact_name,
      email: initial.email, phone: initial.phone, address: initial.address,
      payment_terms: initial.payment_terms, lead_time_days: initial.lead_time_days,
      rating: initial.rating, notes: initial.notes,
    } : defaultVendorForm()
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const f = (k: keyof VendorFormData, v: any) => setForm(p => ({ ...p, [k]: v }));

  async function handleSave() {
    if (!form.name.trim() || !form.code.trim()) { setError('Name and Code are required.'); return; }
    setSaving(true);
    setError('');
    try { await onSave(form); }
    catch (e: any) { setError(e.message || 'Save failed'); }
    finally { setSaving(false); }
  }

  return (
    <Modal title={initial ? 'Edit Vendor' : 'New Vendor'} onClose={onClose}>
      {error && <div className="mb-4 p-3 bg-red-50 text-red-700 rounded-xl text-sm">{error}</div>}
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Vendor Name *</label>
            <input className="input-field" value={form.name} onChange={e => f('name', e.target.value)} placeholder="Acme Corp" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Code *</label>
            <input className="input-field" value={form.code} onChange={e => f('code', e.target.value.toUpperCase())} placeholder="ACM" />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Contact Name</label>
            <input className="input-field" value={form.contact_name} onChange={e => f('contact_name', e.target.value)} />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Email</label>
            <input className="input-field" type="email" value={form.email} onChange={e => f('email', e.target.value)} />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Phone</label>
            <input className="input-field" value={form.phone} onChange={e => f('phone', e.target.value)} />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Payment Terms</label>
            <select className="input-field" value={form.payment_terms} onChange={e => f('payment_terms', e.target.value as PaymentTerms)}>
              {PAYMENT_TERMS_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Address</label>
          <textarea className="input-field resize-none" rows={2} value={form.address} onChange={e => f('address', e.target.value)} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Lead Time (days)</label>
            <input className="input-field" type="number" min={0} value={form.lead_time_days} onChange={e => f('lead_time_days', Number(e.target.value))} />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-2">Rating</label>
            <StarRatingSelect value={form.rating} onChange={v => f('rating', v)} />
          </div>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Notes</label>
          <textarea className="input-field resize-none" rows={2} value={form.notes} onChange={e => f('notes', e.target.value)} />
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <button className="btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn-primary" onClick={handleSave} disabled={saving}>
            {saving ? 'Saving…' : initial ? 'Save Changes' : 'Create Vendor'}
          </button>
        </div>
      </div>
    </Modal>
  );
}

// ── Create PO Modal ───────────────────────────────────────────────────────────

function CreatePOModal({
  vendors,
  onSave,
  onClose,
}: {
  vendors: Vendor[];
  onSave: (data: CreatePOForm) => Promise<void>;
  onClose: () => void;
}) {
  const [form, setForm] = useState<CreatePOForm>(defaultPOForm());
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [itemSearch, setItemSearch] = useState('');
  const [itemDropdown, setItemDropdown] = useState(false);
  const [selectedItem, setSelectedItem] = useState<InventoryItem | null>(null);
  const [lineQty, setLineQty] = useState(1);
  const [lineCost, setLineCost] = useState(0);
  const [lineNotes, setLineNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const itemRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    api.getInventoryItems().then(setItems).catch(() => {});
  }, []);

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (itemRef.current && !itemRef.current.contains(e.target as Node)) setItemDropdown(false);
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const filteredItems = items.filter(i =>
    i.name.toLowerCase().includes(itemSearch.toLowerCase()) ||
    i.sku.toLowerCase().includes(itemSearch.toLowerCase())
  ).slice(0, 20);

  function addLine() {
    if (!selectedItem) return;
    setForm(p => ({
      ...p,
      lines: [...p.lines, {
        item_id: selectedItem.id,
        item_sku: selectedItem.sku,
        item_name: selectedItem.name,
        quantity_ordered: lineQty,
        unit_cost: lineCost,
        notes: lineNotes,
      }],
    }));
    setSelectedItem(null);
    setItemSearch('');
    setLineQty(1);
    setLineCost(0);
    setLineNotes('');
  }

  function removeLine(idx: number) {
    setForm(p => ({ ...p, lines: p.lines.filter((_, i) => i !== idx) }));
  }

  const lineTotal = form.lines.reduce((sum, l) => sum + l.quantity_ordered * l.unit_cost, 0);

  async function handleSave() {
    if (!form.vendor_id) { setError('Select a vendor.'); return; }
    if (!form.expected_date) { setError('Expected date is required.'); return; }
    if (form.lines.length === 0) { setError('Add at least one line item.'); return; }
    setSaving(true);
    setError('');
    try { await onSave(form); }
    catch (e: any) { setError(e.message || 'Failed to create PO'); }
    finally { setSaving(false); }
  }

  return (
    <Modal title="New Purchase Order" onClose={onClose} wide>
      {error && <div className="mb-4 p-3 bg-red-50 text-red-700 rounded-xl text-sm">{error}</div>}
      <div className="space-y-5">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Vendor *</label>
            <select className="input-field" value={form.vendor_id} onChange={e => setForm(p => ({ ...p, vendor_id: e.target.value }))}>
              <option value="">Select vendor…</option>
              {vendors.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Expected Date *</label>
            <input className="input-field" type="date" value={form.expected_date} onChange={e => setForm(p => ({ ...p, expected_date: e.target.value }))} />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Shipping Cost</label>
            <input className="input-field" type="number" min={0} step={0.01} value={form.shipping_cost} onChange={e => setForm(p => ({ ...p, shipping_cost: Number(e.target.value) }))} />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Notes</label>
            <input className="input-field" value={form.notes} onChange={e => setForm(p => ({ ...p, notes: e.target.value }))} />
          </div>
        </div>

        <div>
          <div className="section-label">Line Items</div>
          <div className="bg-gray-50 rounded-xl p-4 space-y-3">
            <div className="grid grid-cols-12 gap-2 items-end">
              <div className="col-span-5" ref={itemRef}>
                <label className="block text-xs font-medium text-gray-600 mb-1">Item</label>
                <div className="relative">
                  <input
                    className="input-field pr-8"
                    value={selectedItem ? `${selectedItem.sku} — ${selectedItem.name}` : itemSearch}
                    onChange={e => { setItemSearch(e.target.value); setSelectedItem(null); setItemDropdown(true); }}
                    onFocus={() => setItemDropdown(true)}
                    placeholder="Search SKU or name…"
                  />
                  {selectedItem && (
                    <button className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600" onClick={() => { setSelectedItem(null); setItemSearch(''); }}>
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                  {itemDropdown && !selectedItem && (
                    <div className="absolute z-10 mt-1 w-full bg-white border border-gray-200 rounded-xl shadow-lg max-h-48 overflow-y-auto">
                      {filteredItems.length === 0
                        ? <div className="px-3 py-2 text-sm text-gray-400">No items found</div>
                        : filteredItems.map(i => (
                          <button key={i.id} className="w-full text-left px-3 py-2 text-sm hover:bg-gray-50 flex justify-between"
                            onClick={() => { setSelectedItem(i); setItemSearch(''); setItemDropdown(false); }}>
                            <span className="font-medium">{i.name}</span>
                            <span className="text-gray-400 text-xs">{i.sku}</span>
                          </button>
                        ))
                      }
                    </div>
                  )}
                </div>
              </div>
              <div className="col-span-2">
                <label className="block text-xs font-medium text-gray-600 mb-1">Qty</label>
                <input className="input-field" type="number" min={1} value={lineQty} onChange={e => setLineQty(Number(e.target.value))} />
              </div>
              <div className="col-span-2">
                <label className="block text-xs font-medium text-gray-600 mb-1">Unit Cost</label>
                <input className="input-field" type="number" min={0} step={0.01} value={lineCost} onChange={e => setLineCost(Number(e.target.value))} />
              </div>
              <div className="col-span-2">
                <label className="block text-xs font-medium text-gray-600 mb-1">Notes</label>
                <input className="input-field" value={lineNotes} onChange={e => setLineNotes(e.target.value)} />
              </div>
              <div className="col-span-1">
                <button className="btn-primary w-full justify-center" onClick={addLine} disabled={!selectedItem}>
                  <Plus className="w-4 h-4" />
                </button>
              </div>
            </div>

            {form.lines.length > 0 && (
              <div className="overflow-x-auto">
              <table className="w-full text-sm mt-2">
                <thead>
                  <tr className="text-xs text-gray-400 uppercase">
                    <th className="text-left pb-1">Item</th>
                    <th className="text-right pb-1">Qty</th>
                    <th className="text-right pb-1">Unit Cost</th>
                    <th className="text-right pb-1">Total</th>
                    <th className="pb-1" />
                  </tr>
                </thead>
                <tbody>
                  {form.lines.map((l, idx) => (
                    <tr key={idx} className="border-t border-gray-100">
                      <td className="py-1.5">
                        <span className="font-medium">{l.item_name}</span>
                        <span className="text-gray-400 text-xs ml-1">({l.item_sku})</span>
                      </td>
                      <td className="text-right">{l.quantity_ordered}</td>
                      <td className="text-right">{fmt(l.unit_cost)}</td>
                      <td className="text-right font-medium">{fmt(l.quantity_ordered * l.unit_cost)}</td>
                      <td className="text-right">
                        <button onClick={() => removeLine(idx)} className="text-red-400 hover:text-red-600 p-1">
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t border-gray-200">
                    <td colSpan={3} className="text-right font-semibold pt-2 text-xs text-gray-500 uppercase">Subtotal</td>
                    <td className="text-right font-bold pt-2">{fmt(lineTotal)}</td>
                    <td />
                  </tr>
                  {form.shipping_cost > 0 && (
                    <>
                      <tr>
                        <td colSpan={3} className="text-right text-xs text-gray-400">Shipping</td>
                        <td className="text-right text-sm">{fmt(form.shipping_cost)}</td>
                        <td />
                      </tr>
                      <tr>
                        <td colSpan={3} className="text-right font-semibold text-xs text-gray-500 uppercase">Total</td>
                        <td className="text-right font-bold">{fmt(lineTotal + form.shipping_cost)}</td>
                        <td />
                      </tr>
                    </>
                  )}
                </tfoot>
              </table>
              </div>
            )}
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-1">
          <button className="btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn-primary" onClick={handleSave} disabled={saving}>
            {saving ? 'Creating…' : 'Create PO'}
          </button>
        </div>
      </div>
    </Modal>
  );
}

// ── PO Detail Modal ───────────────────────────────────────────────────────────

function PODetailModal({
  poId,
  onClose,
  onRefresh,
}: {
  poId: string;
  onClose: () => void;
  onRefresh: () => void;
}) {
  const { canEdit } = useAuth();
  const [po, setPO] = useState<PurchaseOrder | null>(null);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [showReceive, setShowReceive] = useState(false);
  const [locations, setLocations] = useState<Location[]>([]);
  const [receipts, setReceipts] = useState<ReceiptEntry[]>([]);
  const [locationId, setLocationId] = useState('');
  const [operator, setOperator] = useState('');
  const [receiving, setReceiving] = useState(false);
  const [receiveError, setReceiveError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.getPurchaseOrder(poId);
      setPO(data);
    } finally {
      setLoading(false);
    }
  }, [poId]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (showReceive && po) {
      api.getLocations().then(setLocations).catch(() => {});
      setReceipts(
        (po.lines ?? []).map(l => ({
          line_id: l.id,
          item_name: l.item_name,
          quantity_ordered: l.quantity_ordered,
          quantity_received: l.quantity_received,
          remaining: Math.max(0, l.quantity_ordered - l.quantity_received),
          qty_to_receive: Math.max(0, l.quantity_ordered - l.quantity_received),
        }))
      );
    }
  }, [showReceive, po]);

  async function handleSend() {
    if (!po) return;
    setSending(true);
    try { await api.sendPurchaseOrder(po.id); await load(); onRefresh(); }
    finally { setSending(false); }
  }

  async function handleReceive() {
    if (!po) return;
    const toReceive = receipts.filter(r => r.qty_to_receive > 0);
    if (toReceive.length === 0) { setReceiveError('Enter at least one quantity.'); return; }
    setReceiving(true);
    setReceiveError('');
    try {
      await api.receivePurchaseOrder(po.id, {
        receipts: toReceive.map(r => ({ line_id: r.line_id, quantity_received: r.qty_to_receive, location_id: locationId || undefined })),
        operator_name: operator,
        location_id: locationId || undefined,
      });
      await load();
      onRefresh();
      setShowReceive(false);
    } catch (e: any) {
      setReceiveError(e.message || 'Receive failed');
    } finally {
      setReceiving(false);
    }
  }

  if (loading || !po) {
    return (
      <Modal title="Purchase Order" onClose={onClose} wide>
        <div className="space-y-3 animate-pulse">
          {[1,2,3].map(i => <div key={i} className="h-8 bg-gray-100 rounded-xl" />)}
        </div>
      </Modal>
    );
  }

  const statusBadge = PO_STATUS_BADGE[po.status];
  const canSend = po.status === 'draft';
  const canReceive = po.status === 'sent' || po.status === 'partial';

  return (
    <Modal title={`PO ${po.po_number}`} onClose={onClose} wide>
      <div className="space-y-5">
        <div className="flex flex-wrap gap-4 bg-gray-50 rounded-xl p-4">
          <div>
            <div className="text-xs text-gray-400 mb-0.5">Vendor</div>
            <div className="font-semibold text-gray-900">{po.vendor_name}</div>
          </div>
          <div>
            <div className="text-xs text-gray-400 mb-0.5">Status</div>
            <span className={statusBadge}>{PO_STATUS_LABEL[po.status]}</span>
          </div>
          <div>
            <div className="text-xs text-gray-400 mb-0.5">Order Date</div>
            <div className="text-sm text-gray-700">{fmtDate(po.order_date)}</div>
          </div>
          <div>
            <div className="text-xs text-gray-400 mb-0.5">Expected</div>
            <div className="text-sm text-gray-700">{fmtDate(po.expected_date)}</div>
          </div>
          {po.received_date && (
            <div>
              <div className="text-xs text-gray-400 mb-0.5">Received</div>
              <div className="text-sm text-green-700 flex items-center gap-1">
                <CheckCircle className="w-3.5 h-3.5" />{fmtDate(po.received_date)}
              </div>
            </div>
          )}
          {po.shipping_cost > 0 && (
            <div>
              <div className="text-xs text-gray-400 mb-0.5">Shipping</div>
              <div className="text-sm text-gray-700">{fmt(po.shipping_cost)}</div>
            </div>
          )}
          {po.notes && (
            <div className="w-full">
              <div className="text-xs text-gray-400 mb-0.5">Notes</div>
              <div className="text-sm text-gray-700">{po.notes}</div>
            </div>
          )}
        </div>

        <div>
          <div className="section-label">Line Items</div>
          <div className="border border-gray-100 rounded-xl overflow-x-auto">
            <table className="w-full text-sm whitespace-nowrap">
              <thead className="bg-gray-50">
                <tr>
                  <th className="text-left px-4 py-2.5 text-xs font-semibold text-gray-500 uppercase">Item</th>
                  <th className="text-right px-4 py-2.5 text-xs font-semibold text-gray-500 uppercase">Ordered</th>
                  <th className="text-right px-4 py-2.5 text-xs font-semibold text-gray-500 uppercase">Received</th>
                  <th className="text-right px-4 py-2.5 text-xs font-semibold text-gray-500 uppercase">Unit Cost</th>
                  <th className="text-right px-4 py-2.5 text-xs font-semibold text-gray-500 uppercase">Total</th>
                  <th className="px-4 py-2.5 text-xs font-semibold text-gray-500 uppercase">Progress</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {(po.lines ?? []).map(l => (
                  <tr key={l.id} className="hover:bg-gray-50/50">
                    <td className="px-4 py-3">
                      <div className="font-medium text-gray-900">{l.item_name}</div>
                      <div className="text-xs text-gray-400">{l.item_sku}</div>
                    </td>
                    <td className="px-4 py-3 text-right text-gray-700">{l.quantity_ordered}</td>
                    <td className="px-4 py-3 text-right">
                      <span className={l.quantity_received >= l.quantity_ordered ? 'text-green-600 font-medium' : 'text-gray-700'}>
                        {l.quantity_received}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right text-gray-700">{fmt(l.unit_cost)}</td>
                    <td className="px-4 py-3 text-right font-medium">{fmt(l.quantity_ordered * l.unit_cost)}</td>
                    <td className="px-4 py-3 w-24">
                      <ProgressBar value={l.quantity_received} max={l.quantity_ordered} />
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="bg-gray-50 border-t border-gray-100">
                <tr>
                  <td colSpan={4} className="px-4 py-2.5 text-right text-xs font-semibold text-gray-500 uppercase">Total</td>
                  <td className="px-4 py-2.5 text-right font-bold text-gray-900">{fmt(po.total_amount)}</td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>
        </div>

        {showReceive && (
          <div className="border border-green-100 bg-green-50/40 rounded-xl p-4 space-y-3">
            <div className="font-semibold text-gray-800 text-sm">Receive Items</div>
            {receiveError && <div className="text-red-600 text-sm">{receiveError}</div>}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Operator Name</label>
                <input className="input-field" value={operator} onChange={e => setOperator(e.target.value)} placeholder="Your name" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Destination Location</label>
                <select className="input-field" value={locationId} onChange={e => setLocationId(e.target.value)}>
                  <option value="">No specific location</option>
                  {locations.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
                </select>
              </div>
            </div>
            <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-gray-400 uppercase">
                  <th className="text-left pb-1">Item</th>
                  <th className="text-right pb-1">Remaining</th>
                  <th className="text-right pb-1 w-28">Qty to Receive</th>
                </tr>
              </thead>
              <tbody>
                {receipts.map((r, i) => (
                  <tr key={r.line_id} className="border-t border-gray-100">
                    <td className="py-1.5 font-medium">{r.item_name}</td>
                    <td className="text-right text-gray-600">{r.remaining}</td>
                    <td className="text-right py-1.5 pl-3">
                      <input
                        className="input-field text-right w-24"
                        type="number"
                        min={0}
                        max={r.remaining}
                        value={r.qty_to_receive}
                        onChange={e => setReceipts(prev => prev.map((x, j) => j === i ? { ...x, qty_to_receive: Number(e.target.value) } : x))}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
            <div className="flex gap-2 justify-end">
              <button className="btn-secondary" onClick={() => setShowReceive(false)}>Cancel</button>
              <button className="btn-primary" onClick={handleReceive} disabled={receiving}>
                {receiving ? 'Saving…' : 'Confirm Receipt'}
              </button>
            </div>
          </div>
        )}

        <div>
          <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-gray-500 mb-2">
            <History size={12} />
            Activity
          </div>
          <ActivityLog entityType="purchase_order" entityId={po.id} />
        </div>

        <div className="flex justify-between items-center pt-1">
          <div className="flex gap-2">
            {canEdit && canSend && (
              <button className="btn-primary" onClick={handleSend} disabled={sending}>
                <Send className="w-4 h-4" />
                {sending ? 'Sending…' : 'Send PO'}
              </button>
            )}
            {canEdit && canReceive && !showReceive && (
              <button
                className="inline-flex items-center gap-2 px-4 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 transition-colors font-medium text-sm shadow-sm"
                onClick={() => setShowReceive(true)}
              >
                <Package className="w-4 h-4" />
                Receive Items
              </button>
            )}
          </div>
          <button className="btn-secondary" onClick={onClose}>Close</button>
        </div>
      </div>
    </Modal>
  );
}

// ── Purchase Orders Tab ───────────────────────────────────────────────────────

interface POViewFilters {
  statusFilter: string;
  search: string;
}

function PurchaseOrdersTab({ vendors }: { vendors: Vendor[] }) {
  const { canEdit } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const [pos, setPOs] = useState<PurchaseOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<string>('All');
  const [search, setSearch] = useState('');

  const applySavedView = (f: POViewFilters) => {
    setStatusFilter(f.statusFilter);
    setSearch(f.search);
  };
  const [showCreate, setShowCreate] = useState(false);
  const [viewPO, setViewPO] = useState<string | null>(() => searchParams.get('highlight'));

  // Arriving from a "Needs Attention" link opens that PO's detail directly,
  // and strips the param so refreshing the page doesn't keep reopening it.
  useEffect(() => {
    if (!searchParams.get('highlight')) return;
    const next = new URLSearchParams(searchParams);
    next.delete('highlight');
    setSearchParams(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.getPurchaseOrders({
        status: statusFilter !== 'All' ? statusFilter : undefined,
        search: search || undefined,
      });
      setPOs(data);
    } finally {
      setLoading(false);
    }
  }, [statusFilter, search]);

  useEffect(() => { load(); }, [load]);

  async function handleCreate(data: CreatePOForm) {
    await api.createPurchaseOrder({
      vendor_id: data.vendor_id,
      expected_date: data.expected_date,
      shipping_cost: data.shipping_cost,
      notes: data.notes,
      lines: data.lines.map(l => ({ item_id: l.item_id, quantity_ordered: l.quantity_ordered, unit_cost: l.unit_cost, notes: l.notes })),
    });
    setShowCreate(false);
    load();
  }

  async function handleDelete(po: PurchaseOrder) {
    if (!confirm(`Delete ${po.po_number}?`)) return;
    await api.deletePurchaseOrder(po.id);
    load();
  }

  const amountColor = (po: PurchaseOrder) => {
    if (po.status === 'received') return 'text-emerald-600';
    if (po.status === 'partial') return 'text-amber-600';
    return 'text-blue-600';
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-3 items-center justify-between">
        <div className="flex gap-1.5 flex-wrap">
          {PO_STATUS_FILTERS.map(s => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                statusFilter === s
                  ? 'text-white shadow-sm'
                  : 'bg-white border border-gray-200 text-gray-600 hover:bg-gray-50'
              }`}
              style={statusFilter === s ? { backgroundColor: 'var(--accent)' } : {}}
            >
              {s === 'All' ? 'All' : PO_STATUS_LABEL[s as POStatus]}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap gap-2 items-center w-full sm:w-auto">
          <div className="relative flex-1 sm:flex-initial min-w-[160px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              className="input-field pl-9 w-full sm:w-52"
              placeholder="Search PO# or vendor…"
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>
          <button className="btn-secondary whitespace-nowrap" onClick={() => api.downloadExport('purchase-orders')}>
            <Download className="w-4 h-4" /> Export CSV
          </button>
          {canEdit && (
            <button className="btn-primary whitespace-nowrap" onClick={() => setShowCreate(true)}>
              <Plus className="w-4 h-4" /> New PO
            </button>
          )}
        </div>
        <SavedViewsBar<POViewFilters>
          storageKey="hm_saved_views_purchase_orders"
          currentFilters={{ statusFilter, search }}
          onApply={applySavedView}
        />
      </div>

      <div className="card overflow-x-auto">
        <table className="w-full text-sm whitespace-nowrap">
          <thead className="bg-gray-50 border-b border-gray-100">
            <tr>
              {['PO #', 'Vendor', 'Status', 'Order Date', 'Expected', 'Lines', 'Amount', 'Actions'].map(h => (
                <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {loading
              ? Array.from({ length: 5 }).map((_, i) => <SkeletonRow key={i} cols={8} />)
              : pos.length === 0
                ? (
                  <tr>
                    <td colSpan={8} className="px-4 py-16 text-center">
                      <ShoppingCart className="w-10 h-10 text-gray-200 mx-auto mb-3" />
                      <div className="text-gray-400 font-medium">No purchase orders found</div>
                      <div className="text-gray-300 text-xs mt-1">Create your first PO to get started</div>
                    </td>
                  </tr>
                )
                : pos.map(po => (
                  <tr key={po.id} className="hover:bg-gray-50/60 transition-colors cursor-pointer" onClick={() => setViewPO(po.id)}>
                    <td className="px-4 py-3 font-semibold text-gray-900">{po.po_number}</td>
                    <td className="px-4 py-3 text-gray-700">{po.vendor_name}</td>
                    <td className="px-4 py-3">
                      <span className={PO_STATUS_BADGE[po.status]}>
                        {po.status === 'received' && <CheckCircle className="w-3 h-3" />}
                        {PO_STATUS_LABEL[po.status]}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-500">{fmtDateShort(po.order_date)}</td>
                    <td className="px-4 py-3 text-gray-500">{fmtDateShort(po.expected_date)}</td>
                    <td className="px-4 py-3 text-gray-500">{po.line_count ?? po.lines?.length ?? '—'}</td>
                    <td className={`px-4 py-3 font-semibold ${amountColor(po)}`}>{fmt(po.total_amount)}</td>
                    <td className="px-4 py-3" onClick={e => e.stopPropagation()}>
                      <div className="flex gap-1">
                        <button className="btn-ghost p-1.5 rounded-lg" onClick={() => setViewPO(po.id)} title="View">
                          <Eye className="w-4 h-4" />
                        </button>
                        {canEdit && po.status === 'draft' && (
                          <button className="btn-ghost p-1.5 rounded-lg text-red-400 hover:text-red-600 hover:bg-red-50" onClick={() => handleDelete(po)} title="Delete">
                            <Trash2 className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
            }
          </tbody>
        </table>
      </div>

      {showCreate && <CreatePOModal vendors={vendors} onSave={handleCreate} onClose={() => setShowCreate(false)} />}
      {viewPO && <PODetailModal poId={viewPO} onClose={() => setViewPO(null)} onRefresh={load} />}
    </div>
  );
}

// ── Vendor POs List (inline in vendor card) ───────────────────────────────────

function VendorPOsList({ vendorId, vendorName }: { vendorId: string; vendorName: string }) {
  const [pos, setPOs] = useState<PurchaseOrder[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.getPurchaseOrders({ vendor_id: vendorId }).then(setPOs).catch(() => setPOs([])).finally(() => setLoading(false));
  }, [vendorId]);

  if (loading) return <div className="text-xs text-gray-400 animate-pulse py-2">Loading orders…</div>;
  if (pos.length === 0) return <div className="text-xs text-gray-400 py-2">No orders for {vendorName}</div>;

  return (
    <div className="border-t border-gray-100 pt-3 space-y-2">
      {pos.slice(0, 5).map(po => (
        <div key={po.id} className="flex justify-between items-center text-xs gap-2">
          <span className="font-medium text-gray-700 shrink-0">{po.po_number}</span>
          <span className={PO_STATUS_BADGE[po.status]}>{PO_STATUS_LABEL[po.status]}</span>
          <span className="text-gray-500 ml-auto">{fmt(po.total_amount)}</span>
        </div>
      ))}
      {pos.length > 5 && <div className="text-xs text-gray-400">+{pos.length - 5} more</div>}
    </div>
  );
}

// ── Vendors Tab ───────────────────────────────────────────────────────────────

function VendorsTab({ onVendorsChange }: { onVendorsChange: (vendors: Vendor[]) => void }) {
  const { canEdit } = useAuth();
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [editing, setEditing] = useState<Vendor | null>(null);
  const [openPOsFor, setOpenPOsFor] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.getVendors({ search: search || undefined });
      setVendors(data);
      onVendorsChange(data);
    } finally {
      setLoading(false);
    }
  }, [search, onVendorsChange]);

  useEffect(() => { load(); }, [load]);

  async function handleCreate(data: VendorFormData) {
    await api.createVendor(data);
    setShowCreate(false);
    load();
  }

  async function handleUpdate(data: VendorFormData) {
    if (!editing) return;
    await api.updateVendor(editing.id, data);
    setEditing(null);
    load();
  }

  async function handleDelete(v: Vendor) {
    if (!confirm(`Deactivate "${v.name}"?`)) return;
    await api.deleteVendor(v.id);
    load();
  }

  const paymentTermsLabel = (t: PaymentTerms) => PAYMENT_TERMS_OPTIONS.find(o => o.value === t)?.label ?? t;

  return (
    <div className="space-y-4">
      <div className="flex gap-3 items-center justify-between">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input className="input-field pl-9 w-64" placeholder="Search vendors…" value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        {canEdit && (
          <button className="btn-primary" onClick={() => setShowCreate(true)}>
            <Plus className="w-4 h-4" /> New Vendor
          </button>
        )}
      </div>

      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => <SkeletonCard key={i} />)}
        </div>
      ) : vendors.length === 0 ? (
        <div className="card py-20 text-center">
          <Building2 className="w-10 h-10 text-gray-200 mx-auto mb-3" />
          <div className="text-gray-400 font-medium">No vendors found</div>
          <div className="text-gray-300 text-xs mt-1">Add your first vendor to start purchasing</div>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {vendors.map(v => (
            <div key={v.id} className="card p-5 flex flex-col gap-3 hover:shadow-md transition-shadow">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="font-semibold text-gray-900 leading-tight">{v.name}</div>
                  <span className="badge badge-gray mt-1">{v.code}</span>
                </div>
                <RatingDots rating={v.rating} />
              </div>

              <div className="space-y-1.5 text-sm text-gray-600">
                {v.contact_name && (
                  <div className="flex items-center gap-1.5">
                    <Building2 className="w-3.5 h-3.5 text-gray-300 shrink-0" />
                    <span>{v.contact_name}</span>
                  </div>
                )}
                {v.email && (
                  <div className="flex items-center gap-1.5">
                    <Mail className="w-3.5 h-3.5 text-gray-300 shrink-0" />
                    <a href={`mailto:${v.email}`} className="hover:underline text-blue-600" onClick={e => e.stopPropagation()}>{v.email}</a>
                  </div>
                )}
                {v.phone && (
                  <div className="flex items-center gap-1.5">
                    <Phone className="w-3.5 h-3.5 text-gray-300 shrink-0" />
                    <span>{v.phone}</span>
                  </div>
                )}
              </div>

              <div className="flex gap-3 text-xs text-gray-500 pt-0.5">
                <div className="flex items-center gap-1">
                  <TrendingUp className="w-3.5 h-3.5 text-gray-300" />
                  {paymentTermsLabel(v.payment_terms)}
                </div>
                <div className="flex items-center gap-1">
                  <Clock className="w-3.5 h-3.5 text-gray-300" />
                  {v.lead_time_days}d lead
                </div>
                {v.po_count !== undefined && (
                  <div className="ml-auto">
                    <span className="badge badge-blue">{v.po_count} POs</span>
                  </div>
                )}
              </div>

              <div className="flex gap-2 pt-1 border-t border-gray-50">
                {canEdit && (
                  <button className="btn-ghost text-xs flex-1 justify-center" onClick={() => setEditing(v)}>
                    <Edit2 className="w-3.5 h-3.5" /> Edit
                  </button>
                )}
                <button
                  className="btn-ghost text-xs flex-1 justify-center"
                  onClick={() => setOpenPOsFor(openPOsFor === v.id ? null : v.id)}
                >
                  <Eye className="w-3.5 h-3.5" /> View POs
                </button>
                {canEdit && (
                  <button className="btn-ghost text-xs text-red-400 hover:text-red-600 hover:bg-red-50 px-2" onClick={() => handleDelete(v)} title="Deactivate">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>

              {openPOsFor === v.id && (
                <VendorPOsList vendorId={v.id} vendorName={v.name} />
              )}
            </div>
          ))}
        </div>
      )}

      {showCreate && <VendorModal onSave={handleCreate} onClose={() => setShowCreate(false)} />}
      {editing && <VendorModal initial={editing} onSave={handleUpdate} onClose={() => setEditing(null)} />}
    </div>
  );
}

// ── Summary Bar ───────────────────────────────────────────────────────────────

function SummaryBar() {
  const [summary, setSummary] = useState<PurchasingSummary | null>(null);

  useEffect(() => {
    api.getPurchasingSummary().then(setSummary).catch(() => {});
  }, []);

  const openStatuses = ['draft', 'sent', 'partial'];
  const openCount = summary?.by_status.filter(s => openStatuses.includes(s.status)).reduce((a, s) => a + s.count, 0) ?? 0;
  const pendingValue = summary?.by_status.filter(s => openStatuses.includes(s.status)).reduce((a, s) => a + s.value, 0) ?? 0;
  const receivedThisMonth = summary?.by_status.find(s => s.status === 'received')?.count ?? 0;

  const stats = [
    { label: 'Total Vendors',       value: summary?.total_vendors ?? '—', icon: Building2,    color: 'text-blue-600',    bg: 'bg-blue-50' },
    { label: 'Open POs',            value: summary ? openCount : '—',     icon: ShoppingCart, color: 'text-amber-600',   bg: 'bg-amber-50' },
    { label: 'Pending Value',       value: summary ? fmtWhole(pendingValue) : '—', icon: TrendingUp, color: 'text-purple-600', bg: 'bg-purple-50' },
    { label: 'Received This Month', value: summary ? receivedThisMonth : '—', icon: CheckCircle, color: 'text-emerald-600', bg: 'bg-emerald-50' },
  ];

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
      {stats.map(s => (
        <div key={s.label} className="stat-card flex items-center gap-4">
          <div className={`w-10 h-10 rounded-xl ${s.bg} flex items-center justify-center shrink-0`}>
            <s.icon className={`w-5 h-5 ${s.color}`} />
          </div>
          <div className="min-w-0">
            <div className="text-base sm:text-2xl font-bold text-gray-900 truncate">{s.value}</div>
            <div className="text-xs text-gray-500 mt-0.5">{s.label}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function Purchasing() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [vendors, setVendors] = useState<Vendor[]>([]);

  const tab = searchParams.get('tab') === 'vendors' ? 'vendors' : 'orders';

  function setTab(t: 'orders' | 'vendors') {
    setSearchParams(t === 'vendors' ? { tab: 'vendors' } : {});
  }

  const tabs = [
    { key: 'orders' as const, label: 'Purchase Orders', icon: ShoppingCart },
    { key: 'vendors' as const, label: 'Vendors', icon: Building2 },
  ];

  return (
    <div className="min-h-screen bg-[#f8fafc] p-6">
      <div className="max-w-7xl mx-auto">
        <div className="page-header">
          <div>
            <h1 className="page-title">Purchasing</h1>
            <p className="page-subtitle">Vendor management and purchase orders</p>
          </div>
        </div>

        <SummaryBar />

        <div className="flex gap-1 bg-white rounded-xl border border-gray-100 shadow-sm p-1 mb-6 w-fit">
          {tabs.map(t => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                tab === t.key
                  ? 'text-white shadow-sm'
                  : 'text-gray-600 hover:bg-gray-50'
              }`}
              style={tab === t.key ? { backgroundColor: 'var(--accent)' } : {}}
            >
              <t.icon className="w-4 h-4" />
              {t.label}
            </button>
          ))}
        </div>

        {tab === 'orders' && <PurchaseOrdersTab vendors={vendors} />}
        {tab === 'vendors' && <VendorsTab onVendorsChange={setVendors} />}
      </div>
    </div>
  );
}

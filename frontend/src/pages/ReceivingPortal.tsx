import { useEffect, useRef, useState } from 'react';
import { api } from '../api/client';
import {
  AlertCircle, AlertTriangle, ArrowLeft, CheckCircle, ChevronDown, ChevronUp,
  ClipboardCheck, Download, MapPin, Minus, Package, Plus, Printer, RefreshCw,
  Search, Truck, User, X,
} from 'lucide-react';

// ── Types ─────────────────────────────────────────────────────────────────────

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
  status: string;
  order_date: string;
  expected_date: string;
  received_date?: string;
  lines?: POLine[];
  line_count?: number;
  total_amount: number;
  notes?: string;
}

interface ReceiptEntry {
  line_id: string;
  quantity_received: number;
  location_id?: string;
  notes?: string;
}

interface Location {
  id: string;
  name: string;
  code?: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtDate(iso?: string) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
}

function fmtTime(iso: string) {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function isOverdue(po: PurchaseOrder): boolean {
  if (!po.expected_date || po.status === 'received') return false;
  return new Date(po.expected_date) < new Date(new Date().toDateString());
}

function isDueToday(po: PurchaseOrder): boolean {
  if (!po.expected_date) return false;
  return po.expected_date.slice(0, 10) === new Date().toISOString().slice(0, 10);
}

function receivedProgress(lines: POLine[]): number {
  if (!lines.length) return 0;
  const total = lines.reduce((s, l) => s + l.quantity_ordered, 0);
  const done = lines.reduce((s, l) => s + l.quantity_received, 0);
  return total > 0 ? Math.round((done / total) * 100) : 0;
}

// ── Receipt Confirmation Modal ─────────────────────────────────────────────────

function ReceiptModal({
  po,
  receipts,
  operatorName,
  onClose,
}: {
  po: PurchaseOrder;
  receipts: ReceiptEntry[];
  operatorName: string;
  onClose: () => void;
}) {
  const lines = po.lines ?? [];
  const received = receipts.filter(r => r.quantity_received > 0);
  const now = new Date();

  const printRef = useRef<HTMLDivElement>(null);
  const handlePrint = () => {
    const content = printRef.current?.innerHTML ?? '';
    const win = window.open('', '_blank', 'width=600,height=700');
    if (!win) return;
    win.document.write(`
      <html><head><title>Receipt — ${po.po_number}</title>
      <style>body{font-family:monospace;padding:24px;color:#000}h2{margin:0 0 4px}p{margin:2px 0}table{width:100%;border-collapse:collapse;margin-top:12px}td,th{border:1px solid #ccc;padding:6px 8px;text-align:left}th{background:#f0f0f0}.total{font-weight:bold}hr{margin:12px 0}</style>
      </head><body>${content}</body></html>
    `);
    win.document.close();
    win.focus();
    win.print();
    win.close();
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4">
      <div className="bg-gray-900 rounded-2xl border border-gray-700 w-full max-w-lg shadow-2xl flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-800">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-green-500/20 flex items-center justify-center">
              <ClipboardCheck size={18} className="text-green-400" />
            </div>
            <div>
              <div className="text-white font-bold">Receipt Confirmed</div>
              <div className="text-gray-400 text-xs">{po.po_number} · {po.vendor_name}</div>
            </div>
          </div>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-300 transition-colors p-1">
            <X size={20} />
          </button>
        </div>

        {/* Content */}
        <div className="overflow-y-auto flex-1 px-5 py-4 space-y-4">
          <div ref={printRef}>
            <div className="text-center mb-4">
              <h2 className="text-white font-bold text-lg">HartMonitor — Receiving Receipt</h2>
              <p className="text-gray-400 text-xs">{now.toLocaleString()}</p>
            </div>
            <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm mb-4">
              <div className="text-gray-400">PO Number</div><div className="text-white font-mono font-bold">{po.po_number}</div>
              <div className="text-gray-400">Vendor</div><div className="text-white">{po.vendor_name}</div>
              <div className="text-gray-400">Received by</div><div className="text-white">{operatorName || '—'}</div>
              <div className="text-gray-400">Date / Time</div><div className="text-white">{fmtDate(now.toISOString())} {fmtTime(now.toISOString())}</div>
            </div>

            <div className="space-y-2">
              {received.map(r => {
                const line = lines.find(l => l.id === r.line_id);
                if (!line) return null;
                return (
                  <div key={r.line_id} className="flex items-start justify-between gap-3 bg-gray-800/60 rounded-xl px-4 py-3">
                    <div className="flex-1 min-w-0">
                      <div className="text-white font-semibold text-sm">{line.item_name}</div>
                      <div className="text-gray-400 text-xs font-mono">{line.item_sku}</div>
                      {r.notes && <div className="text-amber-400 text-xs mt-1">Note: {r.notes}</div>}
                    </div>
                    <div className="text-right flex-shrink-0">
                      <div className="text-white font-bold text-lg">{r.quantity_received}</div>
                      <div className="text-gray-500 text-xs">of {line.quantity_ordered}</div>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="mt-4 bg-gray-800/40 rounded-xl px-4 py-3 flex items-center justify-between">
              <span className="text-gray-400 text-sm">Total units received</span>
              <span className="text-white font-bold text-xl">{received.reduce((s, r) => s + r.quantity_received, 0)}</span>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex gap-3 px-5 py-4 border-t border-gray-800">
          <button
            onClick={handlePrint}
            className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl border border-gray-600 text-gray-300 hover:bg-gray-800 transition-colors text-sm font-semibold"
          >
            <Printer size={16} /> Print receipt
          </button>
          <button
            onClick={onClose}
            className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl bg-green-600 hover:bg-green-500 text-white font-bold text-sm transition-colors"
          >
            <CheckCircle size={16} /> Done
          </button>
        </div>
      </div>
    </div>
  );
}

// ── PO Card ───────────────────────────────────────────────────────────────────

function POCard({
  po,
  locations,
  operatorName,
  onReceived,
}: {
  po: PurchaseOrder;
  locations: Location[];
  operatorName: string;
  onReceived: (po: PurchaseOrder, receipts: ReceiptEntry[]) => void;
}) {
  const lines = po.lines ?? [];
  const [expanded, setExpanded] = useState(false);
  const [quantities, setQuantities] = useState<Record<string, number>>(() =>
    Object.fromEntries(lines.map(l => [l.id, Math.max(0, l.quantity_ordered - l.quantity_received)]))
  );
  const [lineNotes, setLineNotes] = useState<Record<string, string>>({});
  const [locationId, setLocationId] = useState('');
  const [receiving, setReceiving] = useState(false);
  const [error, setError] = useState('');

  const overdue = isOverdue(po);
  const today = isDueToday(po);
  const progress = receivedProgress(lines);
  const isPartial = po.status === 'partial';

  const pendingLines = lines.filter(l => l.quantity_received < l.quantity_ordered);
  const totalToReceive = Object.values(quantities).reduce((s, q) => s + q, 0);

  function fillAll() {
    setQuantities(Object.fromEntries(
      lines.map(l => [l.id, Math.max(0, l.quantity_ordered - l.quantity_received)])
    ));
  }

  function setQty(lineId: string, val: number) {
    const line = lines.find(l => l.id === lineId)!;
    const max = line.quantity_ordered - line.quantity_received;
    setQuantities(prev => ({ ...prev, [lineId]: Math.max(0, Math.min(max, val)) }));
  }

  const handleReceive = async () => {
    const receipts: ReceiptEntry[] = lines
      .map(l => ({
        line_id: l.id,
        quantity_received: quantities[l.id] ?? 0,
        location_id: locationId || undefined,
        notes: lineNotes[l.id] || undefined,
      }))
      .filter(r => r.quantity_received > 0);

    if (!receipts.length) {
      setError('Enter at least one quantity to receive.');
      return;
    }

    setReceiving(true);
    setError('');
    try {
      const updated = await api.receivePurchaseOrder(po.id, {
        receipts,
        operator_name: operatorName,
        location_id: locationId || undefined,
      });
      onReceived(updated, receipts);
    } catch (e: any) {
      setError(e.message || 'Failed to receive items');
    } finally {
      setReceiving(false);
    }
  };

  const borderColor = overdue
    ? 'border-red-500/40'
    : today
    ? 'border-amber-500/30'
    : 'border-gray-800';

  return (
    <div className={`bg-gray-900 rounded-2xl border ${borderColor} overflow-hidden`}>
      {/* Overdue / today banner */}
      {(overdue || today) && (
        <div className={`px-5 py-2 text-xs font-bold flex items-center gap-2 ${overdue ? 'bg-red-500/15 text-red-400' : 'bg-amber-500/10 text-amber-400'}`}>
          {overdue ? <AlertTriangle size={12} /> : <Truck size={12} />}
          {overdue ? `Overdue — expected ${fmtDate(po.expected_date)}` : 'Expected today'}
        </div>
      )}

      {/* Header row */}
      <button
        className="w-full text-left px-5 py-4 flex items-center gap-4"
        onClick={() => setExpanded(e => !e)}
      >
        <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${overdue ? 'bg-red-500/15' : 'bg-blue-500/15'}`}>
          <Truck size={20} className={overdue ? 'text-red-400' : 'text-blue-400'} />
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-white font-bold font-mono text-base">{po.po_number}</span>
            {isPartial && (
              <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-400 border border-amber-500/20">
                Partial {progress}%
              </span>
            )}
          </div>
          <div className="flex items-center gap-3 mt-1 text-sm text-gray-400 flex-wrap">
            <span className="font-medium text-gray-300">{po.vendor_name}</span>
            <span className="text-gray-600">·</span>
            <span>{pendingLines.length} item{pendingLines.length !== 1 ? 's' : ''} pending</span>
            {po.expected_date && !overdue && !today && (
              <>
                <span className="text-gray-600">·</span>
                <span>Due {fmtDate(po.expected_date)}</span>
              </>
            )}
          </div>

          {/* Progress bar */}
          {isPartial && (
            <div className="mt-2 h-1.5 bg-gray-700 rounded-full overflow-hidden w-48">
              <div
                className="h-full bg-amber-400 rounded-full transition-all"
                style={{ width: `${progress}%` }}
              />
            </div>
          )}
        </div>

        <div className="flex-shrink-0 text-gray-500">
          {expanded ? <ChevronUp size={20} /> : <ChevronDown size={20} />}
        </div>
      </button>

      {/* Expanded receive form */}
      {expanded && (
        <div className="border-t border-gray-800 px-5 py-4 space-y-5">
          {error && (
            <div className="flex items-center gap-2 bg-red-500/15 border border-red-500/25 text-red-300 rounded-xl px-4 py-3 text-sm">
              <AlertCircle size={16} className="flex-shrink-0" />
              {error}
            </div>
          )}

          {/* Location + fill-all row */}
          <div className="flex items-end gap-3 flex-wrap">
            {locations.length > 0 && (
              <div className="flex-1 min-w-[180px]">
                <label className="block text-xs text-gray-400 mb-1.5 flex items-center gap-1">
                  <MapPin size={11} /> Receiving location
                </label>
                <select
                  value={locationId}
                  onChange={e => setLocationId(e.target.value)}
                  className="w-full bg-gray-800 border border-gray-700 text-white rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="">— no location —</option>
                  {locations.map(loc => (
                    <option key={loc.id} value={loc.id}>
                      {loc.name}{loc.code ? ` (${loc.code})` : ''}
                    </option>
                  ))}
                </select>
              </div>
            )}

            <button
              onClick={fillAll}
              className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-blue-600/20 hover:bg-blue-600/30 border border-blue-500/25 text-blue-300 text-sm font-semibold transition-colors whitespace-nowrap"
            >
              <Download size={14} /> Fill all remaining
            </button>
          </div>

          {/* PO notes */}
          {po.notes && (
            <div className="bg-blue-500/10 border border-blue-500/20 rounded-xl px-4 py-3 text-sm text-blue-300">
              <span className="font-semibold">PO Note: </span>{po.notes}
            </div>
          )}

          {/* Line items */}
          <div className="space-y-3">
            {lines.map(line => {
              const remaining = Math.max(0, line.quantity_ordered - line.quantity_received);
              const isLineDone = remaining === 0;
              const qty = quantities[line.id] ?? 0;
              const note = lineNotes[line.id] ?? '';

              return (
                <div
                  key={line.id}
                  className={`rounded-xl border ${isLineDone ? 'border-green-500/15 bg-green-500/5' : 'border-gray-700/50 bg-gray-800/60'}`}
                >
                  <div className="p-4">
                    <div className="flex items-start gap-4 flex-wrap">
                      {/* Item info */}
                      <div className="flex-1 min-w-0">
                        <div className="text-white font-semibold">{line.item_name}</div>
                        <div className="text-gray-500 text-xs font-mono mt-0.5">{line.item_sku}</div>
                        <div className="flex gap-4 mt-2 text-sm flex-wrap">
                          <span className="text-gray-400">
                            Ordered <span className="text-white font-medium">{line.quantity_ordered}</span>
                          </span>
                          <span className="text-gray-400">
                            Already received <span className={line.quantity_received > 0 ? 'text-green-400 font-medium' : 'text-white font-medium'}>
                              {line.quantity_received}
                            </span>
                          </span>
                          {!isLineDone && (
                            <span className="text-gray-400">
                              Remaining <span className="text-amber-400 font-medium">{remaining}</span>
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Qty stepper */}
                      {isLineDone ? (
                        <div className="flex items-center gap-1.5 text-green-400 font-semibold text-sm flex-shrink-0">
                          <CheckCircle size={16} /> Complete
                        </div>
                      ) : (
                        <div className="flex-shrink-0 flex flex-col items-end gap-2">
                          <label className="text-xs text-gray-400">Receive qty</label>
                          <div className="flex items-center gap-1">
                            <button
                              onClick={() => setQty(line.id, qty - 1)}
                              className="w-10 h-10 rounded-xl bg-gray-700 hover:bg-gray-600 flex items-center justify-center text-white transition-colors"
                              disabled={qty <= 0}
                            >
                              <Minus size={16} />
                            </button>
                            <input
                              type="number"
                              min={0}
                              max={remaining}
                              value={qty}
                              onChange={e => setQty(line.id, Number(e.target.value))}
                              className="w-16 h-10 bg-gray-700 border border-gray-600 text-white text-center text-lg font-bold rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500"
                            />
                            <button
                              onClick={() => setQty(line.id, qty + 1)}
                              className="w-10 h-10 rounded-xl bg-gray-700 hover:bg-gray-600 flex items-center justify-center text-white transition-colors"
                              disabled={qty >= remaining}
                            >
                              <Plus size={16} />
                            </button>
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Condition note per line */}
                    {!isLineDone && (
                      <div className="mt-3">
                        <input
                          type="text"
                          value={note}
                          onChange={e => setLineNotes(prev => ({ ...prev, [line.id]: e.target.value }))}
                          placeholder="Condition note (damage, short ship, etc.)"
                          className="w-full bg-gray-700/60 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500/50"
                        />
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Receive button */}
          {pendingLines.length > 0 && (
            <button
              onClick={handleReceive}
              disabled={receiving || totalToReceive === 0}
              className="w-full h-14 bg-blue-600 hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed text-white rounded-xl font-bold text-lg transition-colors flex items-center justify-center gap-3 shadow-lg shadow-blue-900/30"
            >
              {receiving ? (
                <span className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              ) : (
                <>
                  <Package size={20} />
                  Receive {totalToReceive > 0 ? `${totalToReceive} unit${totalToReceive !== 1 ? 's' : ''}` : 'Items'}
                </>
              )}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ── Received Today Card ────────────────────────────────────────────────────────

function ReceivedCard({ po }: { po: PurchaseOrder }) {
  const lines = po.lines ?? [];
  const total = lines.reduce((s, l) => s + l.quantity_received, 0);

  return (
    <div className="bg-gray-900 rounded-2xl border border-green-500/20 px-5 py-4 flex items-center gap-4">
      <div className="w-10 h-10 rounded-xl bg-green-500/15 flex items-center justify-center flex-shrink-0">
        <CheckCircle size={20} className="text-green-400" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-white font-bold font-mono">{po.po_number}</div>
        <div className="text-gray-400 text-sm mt-0.5">
          {po.vendor_name} · {lines.length} item{lines.length !== 1 ? 's' : ''} · {total} units
        </div>
      </div>
      <div className="text-right flex-shrink-0">
        <div className="text-green-400 text-xs font-semibold">Received</div>
        <div className="text-gray-500 text-xs mt-0.5">
          {po.received_date ? fmtTime(po.received_date) : ''}
        </div>
      </div>
    </div>
  );
}

// ── Operator Name Modal ───────────────────────────────────────────────────────

function OperatorModal({
  initial,
  onSave,
}: {
  initial: string;
  onSave: (name: string) => void;
}) {
  const [val, setVal] = useState(initial);
  return (
    <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4">
      <div className="bg-gray-900 rounded-2xl border border-gray-700 w-full max-w-sm shadow-2xl p-6 space-y-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-blue-500/20 flex items-center justify-center">
            <User size={20} className="text-blue-400" />
          </div>
          <div>
            <div className="text-white font-bold">Who is receiving?</div>
            <div className="text-gray-400 text-xs">Your name will be recorded on receipts</div>
          </div>
        </div>
        <input
          type="text"
          autoFocus
          value={val}
          onChange={e => setVal(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && val.trim() && onSave(val.trim())}
          placeholder="Enter your name"
          className="w-full bg-gray-800 border border-gray-700 text-white rounded-xl px-4 py-3 text-base focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        <button
          onClick={() => val.trim() && onSave(val.trim())}
          disabled={!val.trim()}
          className="w-full py-3 bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white font-bold rounded-xl transition-colors"
        >
          Continue
        </button>
      </div>
    </div>
  );
}

// ── Live Clock ─────────────────────────────────────────────────────────────────

function LiveClock() {
  const [time, setTime] = useState(new Date());
  useEffect(() => {
    const id = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  return (
    <div className="text-right hidden sm:block">
      <div className="text-white font-mono font-bold text-sm">
        {time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
      </div>
      <div className="text-gray-500 text-xs">
        {time.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })}
      </div>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

const OPERATOR_KEY = 'hm_receiving_operator';

export default function ReceivingPortal() {
  const [pendingPOs, setPendingPOs] = useState<PurchaseOrder[]>([]);
  const [receivedPOs, setReceivedPOs] = useState<PurchaseOrder[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [operatorName, setOperatorName] = useState(() => localStorage.getItem(OPERATOR_KEY) ?? '');
  const [showOperatorModal, setShowOperatorModal] = useState(!localStorage.getItem(OPERATOR_KEY));
  const [receiptModal, setReceiptModal] = useState<{ po: PurchaseOrder; receipts: ReceiptEntry[] } | null>(null);
  const [tab, setTab] = useState<'pending' | 'received'>('pending');

  useEffect(() => {
    document.title = 'Receiving Portal — HartMonitor';
  }, []);

  const loadData = async () => {
    try {
      const today = new Date().toISOString().slice(0, 10);

      const [sent, partial, received, locs] = await Promise.all([
        api.getPurchaseOrders({ status: 'sent' }).catch(() => []),
        api.getPurchaseOrders({ status: 'partial' }).catch(() => []),
        api.getPurchaseOrders({ status: 'received' }).catch(() => []),
        api.getLocations().catch(() => []),
      ]);

      // Combine + de-dup pending
      const combined: PurchaseOrder[] = [...(sent ?? []), ...(partial ?? [])];
      const seen = new Set<string>();
      const unique = combined.filter(po => {
        if (seen.has(po.id)) return false;
        seen.add(po.id); return true;
      });
      unique.sort((a, b) => {
        const oa = isOverdue(a) ? 0 : isDueToday(a) ? 1 : 2;
        const ob = isOverdue(b) ? 0 : isDueToday(b) ? 1 : 2;
        if (oa !== ob) return oa - ob;
        const da = a.expected_date ? new Date(a.expected_date).getTime() : Infinity;
        const db = b.expected_date ? new Date(b.expected_date).getTime() : Infinity;
        return da - db;
      });
      setPendingPOs(unique);

      // Today's received
      const todayReceived = (received ?? []).filter(po =>
        po.received_date && po.received_date.slice(0, 10) === today
      );
      todayReceived.sort((a, b) => {
        const da = a.received_date ? new Date(a.received_date).getTime() : 0;
        const db = b.received_date ? new Date(b.received_date).getTime() : 0;
        return db - da;
      });
      setReceivedPOs(todayReceived);

      setLocations(locs ?? []);
      setError('');
    } catch (e: any) {
      setError(e.message || 'Failed to load data');
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

  const handleOperatorSave = (name: string) => {
    setOperatorName(name);
    localStorage.setItem(OPERATOR_KEY, name);
    setShowOperatorModal(false);
  };

  const handleReceived = (updatedPO: PurchaseOrder, receipts: ReceiptEntry[]) => {
    // Show receipt confirmation
    setReceiptModal({ po: updatedPO, receipts });
    // Reload data in background
    loadData();
  };

  const filtered = pendingPOs.filter(po => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return po.po_number.toLowerCase().includes(q) || po.vendor_name.toLowerCase().includes(q);
  });

  const overdueCount = pendingPOs.filter(isOverdue).length;
  const todayCount = pendingPOs.filter(isDueToday).length;

  return (
    <div className="min-h-screen bg-gray-950 flex flex-col">
      {/* Modals */}
      {showOperatorModal && (
        <OperatorModal initial={operatorName} onSave={handleOperatorSave} />
      )}
      {receiptModal && (
        <ReceiptModal
          po={receiptModal.po}
          receipts={receiptModal.receipts}
          operatorName={operatorName}
          onClose={() => { setReceiptModal(null); }}
        />
      )}

      {/* Header */}
      <header className="bg-gray-900 border-b border-gray-800 px-4 sm:px-6 py-4 sticky top-0 z-10">
        <div className="max-w-3xl mx-auto flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-500 to-blue-700 flex items-center justify-center shadow-lg flex-shrink-0">
              <Truck size={20} className="text-white" />
            </div>
            <div>
              <h1 className="text-white font-bold text-lg leading-tight">Receiving Portal</h1>
              <button
                onClick={() => setShowOperatorModal(true)}
                className="text-gray-400 hover:text-gray-200 text-xs transition-colors flex items-center gap-1"
              >
                <User size={11} />
                {operatorName || 'Set operator name'}
              </button>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <LiveClock />
            <button
              onClick={handleRefresh}
              disabled={refreshing}
              className="flex items-center gap-2 px-3 py-2 rounded-xl bg-gray-800 hover:bg-gray-700 border border-gray-700 text-gray-300 text-sm font-medium transition-colors disabled:opacity-50"
            >
              <RefreshCw size={15} className={refreshing ? 'animate-spin' : ''} />
              <span className="hidden sm:inline">Refresh</span>
            </button>
          </div>
        </div>
      </header>

      {/* Stats strip */}
      {!loading && (
        <div className="bg-gray-900/50 border-b border-gray-800/50 px-4 sm:px-6 py-3">
          <div className="max-w-3xl mx-auto flex items-center gap-4 sm:gap-6 text-sm overflow-x-auto">
            <div className="flex items-center gap-2 flex-shrink-0">
              <div className="w-2 h-2 rounded-full bg-blue-400" />
              <span className="text-gray-400">{pendingPOs.length} open PO{pendingPOs.length !== 1 ? 's' : ''}</span>
            </div>
            {overdueCount > 0 && (
              <div className="flex items-center gap-2 flex-shrink-0">
                <div className="w-2 h-2 rounded-full bg-red-400" />
                <span className="text-red-400 font-semibold">{overdueCount} overdue</span>
              </div>
            )}
            {todayCount > 0 && (
              <div className="flex items-center gap-2 flex-shrink-0">
                <div className="w-2 h-2 rounded-full bg-amber-400" />
                <span className="text-amber-400">{todayCount} due today</span>
              </div>
            )}
            {receivedPOs.length > 0 && (
              <div className="flex items-center gap-2 flex-shrink-0">
                <div className="w-2 h-2 rounded-full bg-green-400" />
                <span className="text-green-400">{receivedPOs.length} received today</span>
              </div>
            )}
          </div>
        </div>
      )}

      <main className="flex-1 px-4 sm:px-6 py-5 max-w-3xl mx-auto w-full">
        {loading ? (
          <div className="flex flex-col items-center justify-center py-24 gap-3">
            <span className="w-8 h-8 border-2 border-blue-500/30 border-t-blue-400 rounded-full animate-spin" />
            <span className="text-gray-400 text-sm">Loading…</span>
          </div>
        ) : error ? (
          <div className="flex items-center gap-3 bg-red-500/10 border border-red-500/25 text-red-300 rounded-2xl px-5 py-4">
            <AlertCircle size={20} className="flex-shrink-0" />
            <div>
              <div className="font-semibold">Could not load purchase orders</div>
              <div className="text-sm text-red-400/80 mt-0.5">{error}</div>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            {/* Tabs */}
            <div className="flex gap-1 bg-gray-900 p-1 rounded-xl border border-gray-800">
              <button
                onClick={() => setTab('pending')}
                className={`flex-1 py-2 rounded-lg text-sm font-semibold transition-colors ${tab === 'pending' ? 'bg-blue-600 text-white' : 'text-gray-400 hover:text-gray-200'}`}
              >
                Pending ({pendingPOs.length})
              </button>
              <button
                onClick={() => setTab('received')}
                className={`flex-1 py-2 rounded-lg text-sm font-semibold transition-colors ${tab === 'received' ? 'bg-green-600 text-white' : 'text-gray-400 hover:text-gray-200'}`}
              >
                Received Today ({receivedPOs.length})
              </button>
            </div>

            {tab === 'pending' && (
              <>
                {/* Search */}
                <div className="relative">
                  <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-500" />
                  <input
                    type="text"
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                    placeholder="Search by PO number or vendor…"
                    className="w-full pl-10 pr-4 py-3 bg-gray-900 border border-gray-800 text-white rounded-xl text-sm placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  />
                  {search && (
                    <button onClick={() => setSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300">
                      <X size={15} />
                    </button>
                  )}
                </div>

                {filtered.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-20 text-center gap-4">
                    {search ? (
                      <>
                        <Search size={40} className="text-gray-700" />
                        <div className="text-gray-400">No POs match "{search}"</div>
                      </>
                    ) : (
                      <>
                        <div className="w-20 h-20 rounded-full bg-green-500/10 border-2 border-green-500/20 flex items-center justify-center">
                          <CheckCircle size={40} className="text-green-400" />
                        </div>
                        <div>
                          <div className="text-white font-bold text-xl">All caught up!</div>
                          <div className="text-gray-400 text-sm mt-1">No purchase orders awaiting receipt.</div>
                        </div>
                      </>
                    )}
                  </div>
                ) : (
                  <div className="space-y-3">
                    {filtered.map(po => (
                      <POCard
                        key={po.id}
                        po={po}
                        locations={locations}
                        operatorName={operatorName}
                        onReceived={handleReceived}
                      />
                    ))}
                  </div>
                )}
              </>
            )}

            {tab === 'received' && (
              receivedPOs.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-20 text-center gap-4">
                  <Package size={40} className="text-gray-700" />
                  <div className="text-gray-400">No POs received today yet.</div>
                </div>
              ) : (
                <div className="space-y-3">
                  {receivedPOs.map(po => (
                    <ReceivedCard key={po.id} po={po} />
                  ))}
                </div>
              )
            )}
          </div>
        )}
      </main>
    </div>
  );
}

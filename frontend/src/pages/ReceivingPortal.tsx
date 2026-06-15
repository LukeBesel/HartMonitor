import { useEffect, useState } from 'react';
import { api } from '../api/client';
import {
  Package, RefreshCw, ChevronDown, ChevronUp, CheckCircle, Truck, AlertCircle,
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
  lines?: POLine[];
  line_count?: number;
  total_amount: number;
}

interface ReceiveLineEntry {
  line_id: string;
  quantity_received: number;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtDate(iso?: string) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
}

function totalOrderedQty(lines: POLine[]): number {
  return lines.reduce((s, l) => s + l.quantity_ordered, 0);
}

function isFullyReceived(lines: POLine[]): boolean {
  return lines.length > 0 && lines.every(l => l.quantity_received >= l.quantity_ordered);
}

// ── PO Card ───────────────────────────────────────────────────────────────────

function POCard({ po, onReceived }: { po: PurchaseOrder; onReceived: () => void }) {
  const lines = po.lines ?? [];
  const [expanded, setExpanded] = useState(false);
  const [quantities, setQuantities] = useState<Record<string, number>>(() =>
    Object.fromEntries(lines.map(l => [l.id, Math.max(0, l.quantity_ordered - l.quantity_received)]))
  );
  const [receiving, setReceiving] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState('');

  const fullyReceived = isFullyReceived(lines);
  const ordered = totalOrderedQty(lines);

  const handleReceive = async () => {
    const toReceive: ReceiveLineEntry[] = lines
      .map(l => ({ line_id: l.id, quantity_received: quantities[l.id] ?? 0 }))
      .filter(r => r.quantity_received > 0);

    if (toReceive.length === 0) {
      setError('Enter at least one quantity to receive.');
      return;
    }

    setReceiving(true);
    setError('');
    try {
      const res = await fetch(`/api/purchasing/orders/${po.id}/receive`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + localStorage.getItem('hm_token'),
        },
        body: JSON.stringify({ receipts: toReceive }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({ error: 'Request failed' }));
        throw new Error(data.message || data.error || 'Receive failed');
      }
      setSuccess(true);
      setTimeout(() => {
        setSuccess(false);
        onReceived();
      }, 1800);
    } catch (e: any) {
      setError(e.message || 'Failed to receive items');
    } finally {
      setReceiving(false);
    }
  };

  return (
    <div className="bg-gray-900 rounded-2xl border border-gray-800 overflow-hidden">
      {/* PO header */}
      <button
        className="w-full text-left px-5 py-4 flex items-center gap-4"
        onClick={() => setExpanded(e => !e)}
      >
        <div className="w-10 h-10 rounded-xl bg-blue-500/15 flex items-center justify-center flex-shrink-0">
          <Truck size={20} className="text-blue-400" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-3 flex-wrap">
            <span className="text-white font-bold text-base font-mono">{po.po_number}</span>
            {fullyReceived && (
              <span className="flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full bg-green-500/15 text-green-400 border border-green-500/20">
                <CheckCircle size={11} /> All Received
              </span>
            )}
            {po.status === 'partial' && !fullyReceived && (
              <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-400 border border-amber-500/20">
                Partial
              </span>
            )}
          </div>
          <div className="flex items-center gap-3 mt-1 text-sm text-gray-400 flex-wrap">
            <span>{po.vendor_name}</span>
            <span className="text-gray-600">·</span>
            <span>Expected {fmtDate(po.expected_date)}</span>
            <span className="text-gray-600">·</span>
            <span>{lines.length} item{lines.length !== 1 ? 's' : ''}</span>
            <span className="text-gray-600">·</span>
            <span>{ordered} units total</span>
          </div>
        </div>
        <div className="flex-shrink-0 text-gray-500">
          {expanded ? <ChevronUp size={20} /> : <ChevronDown size={20} />}
        </div>
      </button>

      {/* Expanded line items */}
      {expanded && (
        <div className="border-t border-gray-800 px-5 py-4 space-y-4">
          {success ? (
            <div className="flex items-center gap-3 bg-green-500/15 border border-green-500/25 rounded-xl px-4 py-4">
              <CheckCircle size={24} className="text-green-400 flex-shrink-0" />
              <div>
                <div className="text-green-300 font-bold">Items received!</div>
                <div className="text-green-400/70 text-sm">Stock levels have been updated.</div>
              </div>
            </div>
          ) : (
            <>
              {error && (
                <div className="flex items-center gap-2 bg-red-500/15 border border-red-500/25 text-red-300 rounded-xl px-4 py-3 text-sm">
                  <AlertCircle size={16} className="flex-shrink-0" />
                  {error}
                </div>
              )}

              {/* Line items table */}
              <div className="space-y-3">
                {lines.map(line => {
                  const remaining = Math.max(0, line.quantity_ordered - line.quantity_received);
                  const isLineDone = line.quantity_received >= line.quantity_ordered;
                  return (
                    <div
                      key={line.id}
                      className={`rounded-xl p-4 ${isLineDone ? 'bg-green-500/5 border border-green-500/15' : 'bg-gray-800/60 border border-gray-700/50'}`}
                    >
                      <div className="flex items-start justify-between gap-4 flex-wrap">
                        <div className="flex-1 min-w-0">
                          <div className="text-white font-semibold">{line.item_name}</div>
                          <div className="text-gray-400 text-xs mt-0.5 font-mono">{line.item_sku}</div>
                          <div className="flex gap-4 mt-2 text-sm">
                            <span className="text-gray-400">
                              Ordered: <span className="text-white font-medium">{line.quantity_ordered}</span>
                            </span>
                            <span className="text-gray-400">
                              Received: <span className={isLineDone ? 'text-green-400 font-medium' : 'text-white font-medium'}>
                                {line.quantity_received}
                              </span>
                            </span>
                            {!isLineDone && (
                              <span className="text-gray-400">
                                Remaining: <span className="text-amber-400 font-medium">{remaining}</span>
                              </span>
                            )}
                          </div>
                        </div>

                        {/* Qty input */}
                        {!isLineDone && (
                          <div className="flex-shrink-0">
                            <label className="block text-xs text-gray-400 mb-1.5 text-right">Receive qty</label>
                            <input
                              type="number"
                              min={0}
                              max={remaining}
                              value={quantities[line.id] ?? 0}
                              onChange={e => {
                                const val = Math.max(0, Math.min(remaining, Number(e.target.value)));
                                setQuantities(prev => ({ ...prev, [line.id]: val }));
                              }}
                              className="w-24 h-12 bg-gray-700 border border-gray-600 text-white text-center text-lg font-bold rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                            />
                          </div>
                        )}
                        {isLineDone && (
                          <div className="flex-shrink-0 flex items-center gap-1.5 text-green-400 text-sm font-semibold">
                            <CheckCircle size={16} /> Done
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Receive button */}
              {!fullyReceived && (
                <button
                  onClick={handleReceive}
                  disabled={receiving}
                  className="w-full h-14 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white rounded-xl font-bold text-lg transition-colors flex items-center justify-center gap-3 shadow-lg shadow-blue-900/30"
                >
                  {receiving ? (
                    <span className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  ) : (
                    <>
                      <Package size={20} />
                      Receive Items
                    </>
                  )}
                </button>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function ReceivingPortal() {
  const [pos, setPOs] = useState<PurchaseOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    document.title = 'Receiving Portal';
  }, []);

  const loadPOs = async () => {
    try {
      const [sent, partial] = await Promise.all([
        (api as any).getPurchaseOrders({ status: 'sent' }).catch(() => []),
        (api as any).getPurchaseOrders({ status: 'partial' }).catch(() => []),
      ]);
      const combined: PurchaseOrder[] = [...(sent ?? []), ...(partial ?? [])];
      // De-duplicate by id (shouldn't overlap, but be safe)
      const seen = new Set<string>();
      const unique = combined.filter(po => {
        if (seen.has(po.id)) return false;
        seen.add(po.id);
        return true;
      });
      // Sort by expected_date ascending
      unique.sort((a, b) => {
        const da = a.expected_date ? new Date(a.expected_date).getTime() : Infinity;
        const db = b.expected_date ? new Date(b.expected_date).getTime() : Infinity;
        return da - db;
      });
      setPOs(unique);
      setError('');
    } catch (e: any) {
      setError(e.message || 'Failed to load purchase orders');
    }
  };

  useEffect(() => {
    setLoading(true);
    loadPOs().finally(() => setLoading(false));
  }, []);

  const handleRefresh = async () => {
    setRefreshing(true);
    await loadPOs().finally(() => setRefreshing(false));
  };

  return (
    <div className="min-h-screen bg-gray-950 flex flex-col">
      {/* Dark header */}
      <header className="bg-gray-900 border-b border-gray-800 px-5 py-4 flex items-center justify-between flex-shrink-0 sticky top-0 z-10">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-blue-500 to-blue-700 flex items-center justify-center shadow-lg">
            <Truck size={18} className="text-white" />
          </div>
          <div>
            <h1 className="text-white font-bold text-lg leading-tight">Receiving</h1>
            <p className="text-gray-400 text-xs">Incoming goods station</p>
          </div>
        </div>
        <button
          onClick={handleRefresh}
          disabled={refreshing}
          className="flex items-center gap-2 px-3 py-2 rounded-xl bg-gray-800 hover:bg-gray-700 border border-gray-700 text-gray-300 text-sm font-medium transition-colors disabled:opacity-50"
        >
          <RefreshCw size={15} className={refreshing ? 'animate-spin' : ''} />
          Refresh
        </button>
      </header>

      {/* Content */}
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
        ) : pos.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 text-center gap-4">
            <div className="w-20 h-20 rounded-full bg-green-500/10 border-2 border-green-500/20 flex items-center justify-center">
              <CheckCircle size={40} className="text-green-400" />
            </div>
            <div>
              <div className="text-white font-bold text-xl">All caught up!</div>
              <div className="text-gray-400 text-sm mt-1">No open purchase orders awaiting receipt.</div>
            </div>
          </div>
        ) : (
          <>
            <p className="text-gray-400 text-sm mb-4">
              {pos.length} purchase order{pos.length !== 1 ? 's' : ''} awaiting receipt
            </p>
            <div className="space-y-3">
              {pos.map(po => (
                <POCard key={po.id} po={po} onReceived={handleRefresh} />
              ))}
            </div>
          </>
        )}
      </main>
    </div>
  );
}

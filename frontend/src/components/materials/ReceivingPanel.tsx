import { useCallback, useEffect, useState } from 'react';
import {
  AlertCircle, CheckCircle, ChevronDown, ChevronUp, PackageCheck, RefreshCw, Truck,
} from 'lucide-react';
import { api } from '../../api/client';
import { Skeleton, fmtNum } from './common';

// ─── Receiving (management side) ─────────────────────────────────────────────
//
// The Receiving tab of the Materials screen: every purchase order that is out
// with a vendor or partly in, with the quantities to book against it. This is
// the desk-side view. The shop-floor kiosk (pages/ReceivingPortal.tsx, route
// /receiving) is a separate full-screen surface and is untouched by this.


interface POLine {
  id: string;
  item_id: string;
  item_sku: string;
  item_name: string;
  quantity_ordered: number;
  quantity_received: number;
  unit_cost?: number;
  notes?: string;
}

interface PurchaseOrder {
  id: string;
  po_number: string;
  vendor_name: string;
  status: string;
  order_date?: string;
  expected_date?: string;
  lines?: POLine[];
  line_count?: number;
}

function fmtPoDate(iso?: string): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
}

function POReceiveCard({ po, onReceived }: { po: PurchaseOrder; onReceived: () => void }) {
  const lines = po.lines ?? [];
  const [expanded, setExpanded] = useState(false);
  const [quantities, setQuantities] = useState<Record<string, number>>(() =>
    Object.fromEntries(lines.map(l => [l.id, Math.max(0, l.quantity_ordered - l.quantity_received)]))
  );
  const [receiving, setReceiving] = useState(false);
  const [success, setSuccess]     = useState(false);
  const [error, setError]         = useState('');

  const isOverdue = po.expected_date ? new Date(po.expected_date) < new Date() : false;
  const fullyReceived = lines.length > 0 && lines.every(l => l.quantity_received >= l.quantity_ordered);

  async function handleReceive() {
    const toReceive = lines
      .map(l => ({ line_id: l.id, quantity_received: quantities[l.id] ?? 0 }))
      .filter(r => r.quantity_received > 0);

    if (toReceive.length === 0) { setError('Enter at least one quantity to receive.'); return; }

    setReceiving(true);
    setError('');
    try {
      await api.receivePurchaseOrder(po.id, { receipts: toReceive });
      setSuccess(true);
      setTimeout(() => { setSuccess(false); onReceived(); }, 1800);
    } catch (e: any) {
      setError(e.message || 'Failed to receive items');
    } finally {
      setReceiving(false);
    }
  }

  return (
    <div className="card overflow-hidden">
      {/* Card header */}
      <button
        className="w-full text-left px-5 py-4 flex items-center gap-4 hover:bg-gray-50 transition-colors"
        onClick={() => setExpanded(e => !e)}
      >
        <div className="w-10 h-10 rounded-xl bg-blue-50 flex items-center justify-center flex-shrink-0">
          <Truck size={18} className="text-blue-600" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-bold text-gray-900 font-mono">{po.po_number}</span>
            {isOverdue && !fullyReceived && (
              <span className="badge badge-red text-[10px] py-0">Overdue</span>
            )}
            {po.status === 'partial' && !fullyReceived && (
              <span className="badge badge-amber text-[10px] py-0">Partial</span>
            )}
            {po.status === 'sent' && !fullyReceived && (
              <span className="badge badge-blue text-[10px] py-0">Sent</span>
            )}
            {fullyReceived && (
              <span className="badge badge-green text-[10px] py-0">Fully Received</span>
            )}
          </div>
          <div className="text-xs text-gray-500 mt-0.5 flex items-center gap-2 flex-wrap">
            <span>{po.vendor_name}</span>
            {po.expected_date && (
              <>
                <span>·</span>
                <span>Expected {fmtPoDate(po.expected_date)}</span>
              </>
            )}
            <span>·</span>
            <span>{lines.length} line{lines.length !== 1 ? 's' : ''}</span>
          </div>
        </div>
        <div className="flex-shrink-0 text-gray-400">
          {expanded ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
        </div>
      </button>

      {/* Expanded lines */}
      {expanded && (
        <div className="border-t border-gray-100 px-5 py-4 space-y-4">
          {success ? (
            <div className="flex items-center gap-3 bg-emerald-50 border border-emerald-200 rounded-xl px-4 py-4">
              <CheckCircle size={20} className="text-emerald-600 flex-shrink-0" />
              <div>
                <div className="font-semibold text-emerald-800">Items received!</div>
                <div className="text-sm text-emerald-600">Stock levels have been updated.</div>
              </div>
            </div>
          ) : (
            <>
              {error && (
                <div className="flex items-center gap-2 bg-red-50 border border-red-200 text-red-700 rounded-xl px-4 py-3 text-sm">
                  <AlertCircle size={15} className="flex-shrink-0" />
                  {error}
                </div>
              )}

              <div className="overflow-x-auto">
                <table className="w-full text-sm min-w-[500px]">
                  <thead>
                    <tr className="border-b border-gray-100">
                      <th className="text-left py-2 px-2 text-xs font-semibold text-gray-500">Item</th>
                      <th className="text-left py-2 px-2 text-xs font-semibold text-gray-500">SKU</th>
                      <th className="text-right py-2 px-2 text-xs font-semibold text-gray-500">Ordered</th>
                      <th className="text-right py-2 px-2 text-xs font-semibold text-gray-500">Received</th>
                      <th className="text-right py-2 px-2 text-xs font-semibold text-gray-500">Receive Now</th>
                    </tr>
                  </thead>
                  <tbody>
                    {lines.map(line => {
                      const remaining = Math.max(0, line.quantity_ordered - line.quantity_received);
                      const isDone = line.quantity_received >= line.quantity_ordered;
                      return (
                        <tr key={line.id} className={`border-b border-gray-50 ${isDone ? 'opacity-60' : ''}`}>
                          <td className="py-2.5 px-2 font-medium text-gray-900">{line.item_name}</td>
                          <td className="py-2.5 px-2">
                            <span className="font-mono text-xs text-gray-500 bg-gray-100 px-1.5 py-0.5 rounded">{line.item_sku}</span>
                          </td>
                          <td className="py-2.5 px-2 text-right text-gray-700">{fmtNum(line.quantity_ordered)}</td>
                          <td className={`py-2.5 px-2 text-right font-medium ${isDone ? 'text-emerald-600' : 'text-gray-700'}`}>
                            {fmtNum(line.quantity_received)}
                          </td>
                          <td className="py-2.5 px-2 text-right">
                            {isDone ? (
                              <span className="flex items-center justify-end gap-1 text-emerald-600 text-xs font-semibold">
                                <CheckCircle size={13} /> Done
                              </span>
                            ) : (
                              <input
                                type="number"
                                min={0}
                                max={remaining}
                                value={quantities[line.id] ?? 0}
                                onChange={e => {
                                  const val = Math.max(0, Math.min(remaining, Number(e.target.value)));
                                  setQuantities(prev => ({ ...prev, [line.id]: val }));
                                }}
                                className="input-field w-24 text-right"
                              />
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {!fullyReceived && (
                <div className="flex justify-end">
                  <button
                    onClick={handleReceive}
                    disabled={receiving}
                    className="btn-primary"
                  >
                    {receiving ? <RefreshCw size={14} className="animate-spin" /> : <PackageCheck size={14} />}
                    Receive Selected
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

export interface ReceivingPanelProps {
  /** The shared filter bar's text, matched against PO number and vendor. */
  search: string;
  /** Hands the shell this panel's loader so one Refresh control serves them all. */
  onRegisterRefresh: (fn: () => Promise<void>) => void;
  /** Called after every successful load, to move the shared freshness stamp. */
  onLoaded: () => void;
  /** Sends the reader to the Purchasing tab — there is no page to link to now. */
  onOpenPurchasing: () => void;
}

export default function ReceivingPanel({
  search, onRegisterRefresh, onLoaded, onOpenPurchasing,
}: ReceivingPanelProps) {
  const [pos, setPOs]           = useState<PurchaseOrder[]>([]);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState('');

  const loadPOs = useCallback(async () => {
    try {
      const [sent, partial] = await Promise.all([
        api.getPurchaseOrders({ status: 'sent' }).catch(() => [] as PurchaseOrder[]),
        api.getPurchaseOrders({ status: 'partial' }).catch(() => [] as PurchaseOrder[]),
      ]);
      const combined: PurchaseOrder[] = [...(sent ?? []), ...(partial ?? [])];
      const seen = new Set<string>();
      const unique = combined.filter(po => {
        if (seen.has(po.id)) return false;
        seen.add(po.id);
        return true;
      });
      unique.sort((a, b) => {
        const da = a.expected_date ? new Date(a.expected_date).getTime() : Infinity;
        const db = b.expected_date ? new Date(b.expected_date).getTime() : Infinity;
        return da - db;
      });

      // Fetch lines for each PO
      const withLines = await Promise.all(
        unique.map(async po => {
          try {
            const detail = await api.getPurchaseOrder(po.id);
            return { ...po, lines: detail.lines ?? [] };
          } catch {
            return { ...po, lines: [] };
          }
        })
      );

      setPOs(withLines);
      setError('');
      onLoaded();
    } catch (e: any) {
      setError(e.message || 'Failed to load purchase orders');
    }
  }, [onLoaded]);

  useEffect(() => {
    setLoading(true);
    loadPOs().finally(() => setLoading(false));
  }, [loadPOs]);

  useEffect(() => { onRegisterRefresh(loadPOs); }, [onRegisterRefresh, loadPOs]);

  // The heading, the freshness stamp and the Refresh button all live once, in
  // the Materials header above this panel.
  const q = search.trim().toLowerCase();
  const visible = q
    ? pos.filter(po =>
        (po.po_number ?? '').toLowerCase().includes(q)
        || (po.vendor_name ?? '').toLowerCase().includes(q))
    : pos;

  return (
    <div className="space-y-4">
      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3].map(i => <Skeleton key={i} className="h-20 rounded-2xl" />)}
        </div>
      ) : error ? (
        <div className="card p-6 flex items-center gap-3 text-red-600">
          <AlertCircle size={18} className="flex-shrink-0" />
          <span className="text-sm">{error}</span>
        </div>
      ) : visible.length === 0 ? (
        <div className="card p-12 flex flex-col items-center gap-3">
          <div className="w-14 h-14 bg-emerald-50 rounded-xl flex items-center justify-center">
            <PackageCheck size={26} className="text-emerald-500" />
          </div>
          <p className="text-gray-700 font-semibold">
            {q ? 'No open orders match that search' : 'No open purchase orders'}
          </p>
          <p className="text-sm text-gray-400">
            {q
              ? 'Clear the search above to see every order that is out with a vendor.'
              : 'All purchase orders have been received or none exist yet.'}
          </p>
          {!q && (
            <button type="button" onClick={onOpenPurchasing} className="btn-secondary mt-2">
              Go to Purchasing →
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          {visible.map(po => (
            <POReceiveCard key={po.id} po={po} onReceived={() => { void loadPOs(); }} />
          ))}
        </div>
      )}
    </div>
  );
}


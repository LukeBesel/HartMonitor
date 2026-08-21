import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '../api/client';
import type { Kit, KitLine, KitLineStatus, KitStatus } from '../types';
import { useToast } from '../context/ToastContext';
import PageHeader from '../components/shared/PageHeader';
import EmptyState from '../components/shared/EmptyState';
import {
  PackageOpen, ArrowLeft, Check, CheckCircle, Flag, RotateCcw,
  AlertTriangle, X, MapPin, ChevronRight,
} from 'lucide-react';

// ── Local shapes (server rollups beyond the shared Kit type) ──────────────────

interface KitListRow extends Kit {
  n_picked?: number;
  n_short?: number;
  part_number?: string;
}

interface KitDetail extends Kit {
  lines?: KitLine[];
  part_number?: string;
  /** WO quantity snapshot — lets us show qty_required as wo_qty × qty_per. */
  wo_quantity?: number;
}

const KIT_STATUS_CHIP: Record<KitStatus, string> = {
  open:      'bg-gray-100 text-gray-600',
  picking:   'bg-blue-100 text-blue-700',
  complete:  'bg-green-100 text-green-700',
  short:     'bg-amber-100 text-amber-700',
  cancelled: 'bg-gray-50 text-gray-400 line-through',
};

const LINE_STATUS_CHIP: Record<KitLineStatus, string> = {
  pending:  'bg-gray-100 text-gray-500',
  picked:   'bg-indigo-50 text-indigo-700',
  verified: 'bg-green-100 text-green-700',
  short:    'bg-amber-100 text-amber-700',
};

const KIT_STATUS_FILTERS: ('all' | KitStatus)[] = ['all', 'open', 'picking', 'complete', 'short', 'cancelled'];

/** "120 ea (60 × 2)" — snapshot qty_required with its wo_qty × qty_per breakdown. */
function qtyBreakdown(line: KitLine, woQty?: number): string | null {
  if (!woQty || woQty <= 0) return null;
  const per = line.qty_required / woQty;
  const perStr = Number.isInteger(per) ? String(per) : per.toFixed(3).replace(/\.?0+$/, '');
  return `${woQty} × ${perStr}`;
}

// ── Short-line dialog ─────────────────────────────────────────────────────────

function ShortDialog({ line, onConfirm, onClose, busy }: {
  line: KitLine;
  onConfirm: (qtyPicked: number, reason: string) => void;
  onClose: () => void;
  busy: boolean;
}) {
  const [qty, setQty] = useState(line.qty_picked);
  const [reason, setReason] = useState(line.short_reason || '');
  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl p-5 w-full max-w-sm" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold text-gray-900 flex items-center gap-2">
            <Flag size={16} className="text-amber-500" /> Mark line short
          </h3>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100">
            <X size={16} className="text-gray-500" />
          </button>
        </div>
        <p className="text-sm text-gray-600 mb-4">
          <span className="font-medium">{line.item_name}</span>
          <span className="font-mono text-xs text-gray-400 ml-2">{line.sku}</span>
          <span className="block text-xs text-gray-400 mt-0.5 [font-variant-numeric:tabular-nums]">
            {line.qty_required} {line.unit} required
          </span>
        </p>
        <div className="space-y-3">
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Quantity actually picked</label>
            <input
              type="number" min={0} max={line.qty_required} step="any"
              className="input-field [font-variant-numeric:tabular-nums]"
              value={qty}
              onChange={e => setQty(Number(e.target.value))}
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Reason</label>
            <input
              className="input-field"
              placeholder="e.g. bin empty, damaged stock…"
              value={reason}
              onChange={e => setReason(e.target.value)}
            />
          </div>
        </div>
        <div className="flex items-center justify-end gap-3 mt-5">
          <button onClick={onClose} className="btn-secondary">Cancel</button>
          <button
            onClick={() => onConfirm(qty, reason)}
            disabled={busy || !reason.trim()}
            className="btn-primary !bg-amber-600 hover:!bg-amber-700"
          >
            {busy ? 'Saving…' : 'Mark short'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Kit detail (pick / verify board) ──────────────────────────────────────────

function KitDetailView({ kitId, onBack }: { kitId: string; onBack: () => void }) {
  const { addToast } = useToast();
  const [kit, setKit] = useState<KitDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyLineId, setBusyLineId] = useState<string | null>(null);
  const [shortTarget, setShortTarget] = useState<KitLine | null>(null);
  const [verifying, setVerifying] = useState(false);

  const load = useCallback(async () => {
    try {
      const detail = await api.getKit(kitId) as KitDetail;
      setKit(detail);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load kit');
    } finally {
      setLoading(false);
    }
  }, [kitId]);

  useEffect(() => { setLoading(true); load(); }, [load]);

  const updateLine = async (line: KitLine, status: KitLineStatus, qtyPicked?: number, shortReason?: string) => {
    setBusyLineId(line.id);
    try {
      await api.updateKitLine(kitId, line.id, {
        status,
        ...(qtyPicked !== undefined ? { qty_picked: qtyPicked } : {}),
        ...(shortReason !== undefined ? { short_reason: shortReason } : {}),
      });
      await load();
      if (status === 'picked') addToast(`Picked ${line.item_name}`, 'success');
      if (status === 'short') addToast(`${line.item_name} flagged short`, 'warning');
    } catch (e) {
      addToast(e instanceof Error ? e.message : 'Failed to update kit line', 'error');
    } finally {
      setBusyLineId(null);
      setShortTarget(null);
    }
  };

  const handleVerifyKit = async () => {
    setVerifying(true);
    try {
      await api.verifyKit(kitId);
      await load();
      addToast('Kit verified', 'success');
    } catch (e) {
      addToast(e instanceof Error ? e.message : 'Kit is not complete yet', 'error');
    } finally {
      setVerifying(false);
    }
  };

  const lines = kit?.lines ?? [];
  const nDone = lines.filter(l => l.status === 'picked' || l.status === 'verified').length;
  const nShort = lines.filter(l => l.status === 'short').length;
  const allDone = lines.length > 0 && nDone === lines.length;
  const cancelled = kit?.status === 'cancelled';

  if (loading) {
    return (
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4 space-y-3">
        {[...Array(6)].map((_, i) => <div key={i} className="h-14 animate-pulse bg-gray-100 rounded-lg" />)}
      </div>
    );
  }
  if (error || !kit) {
    return (
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm py-16 flex flex-col items-center gap-3 text-center">
        <AlertTriangle size={28} className="text-red-400" />
        <p className="text-gray-500 font-medium">Couldn't load kit</p>
        <p className="text-xs text-gray-400">{error}</p>
        <div className="flex gap-2">
          <button onClick={onBack} className="btn-secondary"><ArrowLeft size={14} /> Back</button>
          <button onClick={() => { setLoading(true); load(); }} className="btn-secondary">Retry</button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header card */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4 flex flex-wrap items-center gap-3">
        <button onClick={onBack} className="p-2 rounded-lg hover:bg-gray-100 text-gray-500 transition-colors" title="Back to kit list">
          <ArrowLeft size={16} />
        </button>
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-mono font-bold text-indigo-700">{kit.work_order_number}</span>
            <span className="font-semibold text-gray-900 truncate">{kit.part_name}</span>
            <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${KIT_STATUS_CHIP[kit.status]}`}>
              {kit.status}
            </span>
          </div>
          <div className="text-xs text-gray-400 mt-0.5 flex items-center gap-3 flex-wrap [font-variant-numeric:tabular-nums]">
            <span>BOM v{kit.bom_version}</span>
            {kit.wo_quantity !== undefined && <span>WO quantity: {kit.wo_quantity}</span>}
            {kit.location_id && <span className="flex items-center gap-1"><MapPin size={11} /> pick-from location set</span>}
          </div>
        </div>
        <div className="ml-auto flex items-center gap-3">
          <span className="text-sm text-gray-500 [font-variant-numeric:tabular-nums]">
            {nDone}/{lines.length} picked{nShort > 0 && <span className="text-amber-600 font-semibold"> · {nShort} short</span>}
          </span>
          {allDone && kit.status !== 'complete' && !cancelled && (
            <button onClick={handleVerifyKit} disabled={verifying} className="btn-primary !bg-green-600 hover:!bg-green-700">
              <CheckCircle size={15} /> {verifying ? 'Verifying…' : 'Verify kit'}
            </button>
          )}
        </div>
      </div>

      {/* Complete / short banners */}
      {kit.status === 'complete' && (
        <div className="rounded-xl border border-green-200 bg-green-50 px-4 py-3 flex items-center gap-2 text-sm text-green-700">
          <CheckCircle size={16} />
          <span className="font-semibold">Kit complete</span>
          {kit.verified_by && <span className="text-green-600">— verified by {kit.verified_by}</span>}
        </div>
      )}
      {nShort > 0 && kit.status !== 'complete' && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 flex items-center gap-2 text-sm text-amber-700">
          <Flag size={15} />
          <span><strong>{nShort}</strong> line{nShort !== 1 ? 's' : ''} short — resolve or re-pick to complete this kit.</span>
        </div>
      )}

      {/* Lines */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        {lines.length === 0 ? (
          <EmptyState icon={PackageOpen} title="No lines in this kit" description="The BOM had no lines when this kit was generated." />
        ) : (
          <div className="divide-y divide-gray-100">
            {lines.map(line => {
              const busy = busyLineId === line.id;
              const isShort = line.status === 'short';
              const done = line.status === 'picked' || line.status === 'verified';
              const breakdown = qtyBreakdown(line, kit.wo_quantity);
              return (
                <div
                  key={line.id}
                  className={`flex items-center gap-4 px-4 py-3 min-h-[64px] ${
                    isShort ? 'bg-amber-50/60' : done ? 'bg-green-50/40' : ''
                  }`}
                >
                  {/* Status icon */}
                  <div className={`w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 ${
                    line.status === 'verified' ? 'bg-green-100' :
                    line.status === 'picked' ? 'bg-indigo-50' :
                    isShort ? 'bg-amber-100' : 'bg-gray-100'
                  }`}>
                    {line.status === 'verified' ? <CheckCircle size={17} className="text-green-600" /> :
                     line.status === 'picked' ? <Check size={17} className="text-indigo-600" /> :
                     isShort ? <Flag size={16} className="text-amber-600" /> :
                     <PackageOpen size={16} className="text-gray-400" />}
                  </div>

                  {/* Item */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium text-gray-900 text-sm truncate">{line.item_name}</span>
                      <span className="font-mono text-[11px] text-gray-400 bg-gray-50 border border-gray-100 px-1.5 py-0.5 rounded">
                        {line.sku}
                      </span>
                      <span className={`text-[11px] font-semibold px-1.5 py-0.5 rounded-full ${LINE_STATUS_CHIP[line.status]}`}>
                        {line.status}
                      </span>
                    </div>
                    <div className="text-xs text-gray-400 mt-0.5 flex items-center gap-3 flex-wrap">
                      {line.reference && <span>{line.reference}</span>}
                      {isShort && line.short_reason && (
                        <span className="text-amber-600">Short: {line.short_reason}</span>
                      )}
                    </div>
                  </div>

                  {/* Quantities: snapshot qty_required shown as wo_qty × qty_per */}
                  <div className="text-right flex-shrink-0">
                    <div className="text-sm font-semibold text-gray-800 [font-variant-numeric:tabular-nums]">
                      {line.qty_picked} / {line.qty_required} {line.unit}
                    </div>
                    {breakdown && (
                      <div className="text-[11px] text-gray-400 [font-variant-numeric:tabular-nums]" title="WO quantity × qty per unit (snapshot)">
                        {breakdown}
                      </div>
                    )}
                  </div>

                  {/* Actions */}
                  {!cancelled && (
                    <div className="flex items-center gap-1.5 flex-shrink-0">
                      {line.status === 'pending' && (
                        <>
                          <button
                            onClick={() => updateLine(line, 'picked')}
                            disabled={busy}
                            className="btn-primary !py-1.5 !px-3 text-xs"
                            title="Pick full quantity — writes the consume stock movement"
                          >
                            <Check size={13} /> Pick
                          </button>
                          <button
                            onClick={() => setShortTarget(line)}
                            disabled={busy}
                            className="p-1.5 rounded-lg hover:bg-amber-50 text-gray-400 hover:text-amber-600 transition-colors"
                            title="Mark short"
                          >
                            <Flag size={14} />
                          </button>
                        </>
                      )}
                      {line.status === 'picked' && (
                        <button
                          onClick={() => setShortTarget(line)}
                          disabled={busy}
                          className="p-1.5 rounded-lg hover:bg-amber-50 text-gray-400 hover:text-amber-600 transition-colors"
                          title="Mark short"
                        >
                          <Flag size={14} />
                        </button>
                      )}
                      {isShort && (
                        <button
                          onClick={() => updateLine(line, 'picked', line.qty_required)}
                          disabled={busy}
                          className="btn-secondary !py-1.5 !px-3 text-xs"
                          title="Stock arrived — re-pick full quantity"
                        >
                          <RotateCcw size={13} /> Re-pick
                        </button>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {shortTarget && (
        <ShortDialog
          line={shortTarget}
          busy={busyLineId === shortTarget.id}
          onClose={() => setShortTarget(null)}
          onConfirm={(qty, reason) => updateLine(shortTarget, 'short', qty, reason)}
        />
      )}
    </div>
  );
}

// ── Kit list ──────────────────────────────────────────────────────────────────

function KitListView({ onOpen }: { onOpen: (id: string) => void }) {
  const [kits, setKits] = useState<KitListRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<'all' | KitStatus>('all');

  const load = useCallback(async () => {
    try {
      const rows = await api.getKits() as KitListRow[];
      setKits(rows);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load kits');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(
    () => statusFilter === 'all' ? kits : kits.filter(k => k.status === statusFilter),
    [kits, statusFilter],
  );

  if (loading) {
    return (
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4 space-y-3">
        {[...Array(6)].map((_, i) => <div key={i} className="h-12 animate-pulse bg-gray-100 rounded-lg" />)}
      </div>
    );
  }
  if (error) {
    return (
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm py-16 flex flex-col items-center gap-3 text-center">
        <AlertTriangle size={28} className="text-red-400" />
        <p className="text-gray-500 font-medium">Couldn't load kits</p>
        <p className="text-xs text-gray-400">{error}</p>
        <button onClick={() => { setLoading(true); load(); }} className="btn-secondary">Retry</button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Status filter chips */}
      <div className="flex items-center gap-2 flex-wrap">
        {KIT_STATUS_FILTERS.map(s => (
          <button
            key={s}
            onClick={() => setStatusFilter(s)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
              statusFilter === s
                ? 'bg-gray-900 text-white shadow-sm'
                : 'bg-white border border-gray-200 text-gray-600 hover:bg-gray-50'
            }`}
          >
            {s === 'all' ? 'All kits' : s.charAt(0).toUpperCase() + s.slice(1)}
            <span className="ml-1.5 text-[10px] opacity-70 [font-variant-numeric:tabular-nums]">
              {s === 'all' ? kits.length : kits.filter(k => k.status === s).length}
            </span>
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm">
          <EmptyState
            icon={PackageOpen}
            title={statusFilter === 'all' ? 'No kits yet' : `No ${statusFilter} kits`}
            description="Generate a kit from a work order on the Schedule page — the work order needs a product type with an active BOM."
          />
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm whitespace-nowrap">
              <thead className="bg-gray-50 border-b-2 border-gray-200">
                <tr>
                  {['Work order', 'Part', 'BOM', 'Progress', 'Status', 'Created', ''].map((h, i) => (
                    <th key={i} className="text-left text-[11px] font-semibold text-gray-500 uppercase tracking-wide px-4 py-2.5">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filtered.map(kit => {
                  const total = kit.n_total ?? 0;
                  const done = (kit.n_verified ?? 0) + (kit.n_picked ?? 0);
                  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
                  const hasShort = Boolean(kit.has_short);
                  return (
                    <tr
                      key={kit.id}
                      onClick={() => onOpen(kit.id)}
                      className="hover:bg-gray-50 transition-colors cursor-pointer"
                    >
                      <td className="px-4 py-3">
                        <span className="font-mono text-xs font-semibold text-indigo-700">{kit.work_order_number}</span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="font-medium text-gray-900 text-xs">{kit.part_name}</div>
                        {kit.part_number && <div className="text-xs text-gray-400">{kit.part_number}</div>}
                      </td>
                      <td className="px-4 py-3 text-xs text-gray-500 [font-variant-numeric:tabular-nums]">v{kit.bom_version}</td>
                      <td className="px-4 py-3 min-w-[140px]">
                        <div className="text-xs text-gray-700 mb-1 [font-variant-numeric:tabular-nums]">
                          {done} / {total}
                          {hasShort && (
                            <span className="ml-2 inline-flex items-center gap-0.5 text-amber-600 font-semibold">
                              <Flag size={10} /> short
                            </span>
                          )}
                        </div>
                        <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden w-24">
                          <div
                            className={`h-full rounded-full ${hasShort ? 'bg-amber-400' : pct >= 100 ? 'bg-green-500' : 'bg-indigo-500'}`}
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${KIT_STATUS_CHIP[kit.status]}`}>
                          {kit.status}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-xs text-gray-500">
                        {kit.created_at ? new Date(kit.created_at).toLocaleDateString([], { month: 'short', day: 'numeric' }) : '—'}
                      </td>
                      <td className="px-4 py-3 text-gray-300">
                        <ChevronRight size={15} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Page shell ────────────────────────────────────────────────────────────────

export default function Kitting() {
  const navigate = useNavigate();
  const { kitId } = useParams<{ kitId: string }>();

  return (
    <div className="min-h-screen bg-[#f8fafc] p-6 space-y-5">
      <PageHeader
        title="Kitting"
        subtitle="Pick and verify material kits generated from work-order BOMs"
      />
      {kitId ? (
        <KitDetailView kitId={kitId} onBack={() => navigate('/inventory/kitting')} />
      ) : (
        <KitListView onOpen={id => navigate(`/inventory/kitting/${id}`)} />
      )}
    </div>
  );
}

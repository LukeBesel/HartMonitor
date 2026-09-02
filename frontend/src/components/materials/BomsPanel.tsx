import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../../api/client';
import type { BOM, BOMLine, BOMStatus } from '../../types';
import type { BOMLineInput } from '../../api/client';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import EmptyState from '../shared/EmptyState';
import {
  Layers, Plus, ChevronDown, Search, Trash2, ArrowUp, ArrowDown,
  CheckCircle, GitBranch, Save, AlertTriangle, Package,
} from 'lucide-react';

// ── Local shapes ──────────────────────────────────────────────────────────────
// The server joins item display fields onto BOM lines under item_-prefixed keys.

interface BOMLineRow extends BOMLine {
  item_sku?: string;
  item_unit?: string;
  item_unit_cost?: number;
}

interface BOMDetail extends BOM {
  lines?: BOMLineRow[];
}

/** Editable line in local draft state — a BOMLineInput plus display-only fields. */
interface EditableLine extends BOMLineInput {
  item_name: string;
  item_sku: string;
  unit_cost: number;
  /** Local key for React lists (server re-ids lines on save). */
  key: string;
}

interface AppRow { id: string; name: string; status: string; }
interface ProductTypeRow { id: string; app_id: string; name: string; }
interface ItemRow {
  id: string; sku: string; name: string;
  unit_of_measure: string; unit_cost: number; total_quantity: number;
}
interface AppStepRef { id: string; name: string; }

const STATUS_CHIP: Record<BOMStatus, string> = {
  draft:      'bg-gray-100 text-gray-600 border border-gray-200',
  active:     'bg-amber-50 text-amber-700 border border-amber-200',
  superseded: 'bg-gray-50 text-gray-400 border border-gray-100',
};

function newKey() {
  return `l_${Math.random().toString(36).slice(2, 10)}`;
}

function toEditable(l: BOMLineRow): EditableLine {
  return {
    key: newKey(),
    item_id: l.item_id,
    qty_per: l.qty_per,
    unit: l.unit,
    reference: l.reference,
    step_id: l.step_id,
    scan_code: l.scan_code,
    sort_order: l.sort_order,
    notes: l.notes,
    item_name: l.item_name ?? '',
    item_sku: l.item_sku ?? '',
    unit_cost: l.item_unit_cost ?? 0,
  };
}

// ── Item typeahead ────────────────────────────────────────────────────────────

function ItemTypeahead({ onPick }: { onPick: (item: ItemRow) => void }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<ItemRow[]>([]);
  const [open, setOpen] = useState(false);
  const [searching, setSearching] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!query.trim()) { setResults([]); setOpen(false); return; }
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      setSearching(true);
      try {
        const rows = await api.getInventoryItems({ search: query.trim() }) as ItemRow[];
        setResults(rows.slice(0, 8));
        setOpen(true);
      } catch {
        setResults([]);
      } finally {
        setSearching(false);
      }
    }, 250);
    return () => { if (timer.current) clearTimeout(timer.current); };
  }, [query]);

  return (
    <div className="relative flex-1 min-w-[220px]">
      <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
      <input
        className="input-field pl-9"
        placeholder="Add line: search items by SKU or name…"
        value={query}
        onChange={e => setQuery(e.target.value)}
        onFocus={() => { if (results.length > 0) setOpen(true); }}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
      />
      {open && (
        <div className="absolute z-20 mt-1 left-0 right-0 bg-white rounded-xl border border-gray-200 shadow-xl overflow-hidden">
          {searching && results.length === 0 && (
            <div className="px-3 py-2.5 text-xs text-gray-400">Searching…</div>
          )}
          {!searching && results.length === 0 && (
            <div className="px-3 py-2.5 text-xs text-gray-400">No items match “{query}”</div>
          )}
          {results.map(item => (
            <button
              key={item.id}
              className="w-full text-left px-3 py-2 hover:bg-indigo-50 transition-colors flex items-center gap-2"
              onMouseDown={e => e.preventDefault()}
              onClick={() => { onPick(item); setQuery(''); setResults([]); setOpen(false); }}
            >
              <span className="font-mono text-xs font-semibold text-indigo-700 flex-shrink-0">{item.sku}</span>
              <span className="text-sm text-gray-700 truncate flex-1">{item.name}</span>
              <span className="text-xs text-gray-400 flex-shrink-0 [font-variant-numeric:tabular-nums]">
                {item.total_quantity} {item.unit_of_measure} on hand
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export interface BomsPanelProps {
  /** The Materials filter bar's text, matched against product-type names. */
  search: string;
  /** Hands the shell this panel's loader and takes back the way to withdraw
   *  it, so the shell's one Refresh control always holds a live loader. */
  onRegisterRefresh: (fn: () => Promise<void>) => () => void;
  /** Called after every load, to move (or stall) the shared freshness stamp. */
  onLoaded: (ok?: boolean) => void;
}

export default function BomsPanel({ search, onRegisterRefresh, onLoaded }: BomsPanelProps) {
  const { canEdit } = useAuth();
  const { addToast } = useToast();
  const [searchParams, setSearchParams] = useSearchParams();

  const [apps, setApps] = useState<AppRow[]>([]);
  const [selectedAppId, setSelectedAppId] = useState('');
  const [productTypes, setProductTypes] = useState<ProductTypeRow[]>([]);
  const [boms, setBoms] = useState<BOM[]>([]);            // all versions for the app
  const [selectedPtId, setSelectedPtId] = useState('');
  const [selectedBomId, setSelectedBomId] = useState('');
  const [bom, setBom] = useState<BOMDetail | null>(null);
  const [appSteps, setAppSteps] = useState<AppStepRef[]>([]);

  const [loadingApps, setLoadingApps] = useState(true);
  const [loadingSide, setLoadingSide] = useState(false);
  const [loadingBom, setLoadingBom] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Draft editing state
  const [lines, setLines] = useState<EditableLine[]>([]);
  const [notes, setNotes] = useState('');
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [acting, setActing] = useState(false);

  const isDraft = bom?.status === 'draft';
  const editable = Boolean(isDraft && canEdit);

  // ── Loaders ────────────────────────────────────────────────────────────────

  useEffect(() => {
    (async () => {
      setLoadingApps(true);
      try {
        const rows = await api.getApps() as AppRow[];
        setApps(rows);
        const urlApp = searchParams.get('app_id');
        const first = (urlApp && rows.some(a => a.id === urlApp)) ? urlApp : (rows[0]?.id ?? '');
        setSelectedAppId(prev => prev || first);
        setLoadError(null);
      } catch (e) {
        setLoadError(e instanceof Error ? e.message : 'Failed to load apps');
      } finally {
        setLoadingApps(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Deep-link params (from the builder's "BOM →" link) are only honored on the
  // first side-panel load — after that the user's clicks drive selection.
  const initialPtParam = useRef(searchParams.get('product_type_id'));

  const loadSide = useCallback(async (appId: string) => {
    if (!appId) { setProductTypes([]); setBoms([]); return; }
    setLoadingSide(true);
    try {
      const [pts, bomList, app] = await Promise.all([
        api.getProductTypes(appId) as Promise<ProductTypeRow[]>,
        api.getBOMs({ app_id: appId }),
        api.getApp(appId) as Promise<{ steps?: { id: string; name: string }[] }>,
      ]);
      setProductTypes(pts);
      setBoms(bomList);
      onLoaded();
      setAppSteps((app.steps ?? []).map(s => ({ id: s.id, name: s.name })));
      setLoadError(null);
      // Preselect: URL deep-link (once), else keep current, else first PT
      const urlPt = initialPtParam.current;
      initialPtParam.current = null;
      setSelectedPtId(prev => {
        if (urlPt && pts.some(p => p.id === urlPt)) return urlPt;
        if (prev && pts.some(p => p.id === prev)) return prev;
        return pts[0]?.id ?? '';
      });
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : 'Failed to load product types');
      onLoaded(false);
    } finally {
      setLoadingSide(false);
    }
    // `onLoaded` is stable (the shell wraps it in useCallback).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onLoaded]);

  useEffect(() => { loadSide(selectedAppId); }, [selectedAppId, loadSide]);

  const reload = useCallback(async () => { await loadSide(selectedAppId); }, [loadSide, selectedAppId]);
  useEffect(() => onRegisterRefresh(reload), [onRegisterRefresh, reload]);

  // Versions for the selected product type, newest first.
  const versions = useMemo(
    () => boms.filter(b => b.product_type_id === selectedPtId).sort((a, b) => b.version - a.version),
    [boms, selectedPtId],
  );

  // When the PT changes, pick its active version (else newest).
  useEffect(() => {
    if (!selectedPtId) { setSelectedBomId(''); return; }
    const active = versions.find(v => v.status === 'active');
    setSelectedBomId((active ?? versions[0])?.id ?? '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedPtId, boms]);

  useEffect(() => {
    if (!selectedBomId) { setBom(null); setLines([]); setNotes(''); setDirty(false); return; }
    let cancelled = false;
    (async () => {
      setLoadingBom(true);
      try {
        const detail = await api.getBOM(selectedBomId) as BOMDetail;
        if (cancelled) return;
        setBom(detail);
        setLines((detail.lines ?? []).map(toEditable));
        setNotes(detail.notes ?? '');
        setDirty(false);
      } catch (e) {
        if (!cancelled) addToast(e instanceof Error ? e.message : 'Failed to load BOM', 'error');
      } finally {
        if (!cancelled) setLoadingBom(false);
      }
    })();
    return () => { cancelled = true; };
  }, [selectedBomId, addToast]);

  const refreshBomList = useCallback(async () => {
    if (!selectedAppId) return;
    try { setBoms(await api.getBOMs({ app_id: selectedAppId })); } catch { /* keep stale list */ }
  }, [selectedAppId]);

  // ── Line edits ─────────────────────────────────────────────────────────────

  const updateLine = (key: string, patch: Partial<EditableLine>) => {
    setLines(prev => prev.map(l => (l.key === key ? { ...l, ...patch } : l)));
    setDirty(true);
  };

  const removeLine = (key: string) => {
    setLines(prev => prev.filter(l => l.key !== key));
    setDirty(true);
  };

  const moveLine = (key: string, dir: -1 | 1) => {
    setLines(prev => {
      const idx = prev.findIndex(l => l.key === key);
      const to = idx + dir;
      if (idx < 0 || to < 0 || to >= prev.length) return prev;
      const next = [...prev];
      [next[idx], next[to]] = [next[to], next[idx]];
      return next;
    });
    setDirty(true);
  };

  const addLineFromItem = (item: ItemRow) => {
    setLines(prev => [...prev, {
      key: newKey(),
      item_id: item.id,
      qty_per: 1,
      unit: item.unit_of_measure || 'ea',
      reference: '',
      step_id: '',
      scan_code: '',
      notes: '',
      item_name: item.name,
      item_sku: item.sku,
      unit_cost: item.unit_cost,
    }]);
    setDirty(true);
  };

  // ── Lifecycle actions ──────────────────────────────────────────────────────

  const selectPt = (ptId: string) => {
    setSelectedPtId(ptId);
    // Keep the URL shareable / deep-linkable from the builder.
    const next = new URLSearchParams(searchParams);
    next.set('product_type_id', ptId);
    if (selectedAppId) next.set('app_id', selectedAppId);
    setSearchParams(next, { replace: true });
  };

  const handleCreate = async () => {
    if (!selectedPtId) return;
    setActing(true);
    try {
      const created = await api.createBOM({ product_type_id: selectedPtId });
      await refreshBomList();
      setSelectedBomId(created.id);
      addToast(`BOM v${created.version} draft created`, 'success');
    } catch (e) {
      addToast(e instanceof Error ? e.message : 'Failed to create BOM', 'error');
    } finally {
      setActing(false);
    }
  };

  const handleSave = async (): Promise<boolean> => {
    if (!bom) return false;
    setSaving(true);
    try {
      const payload: BOMLineInput[] = lines.map((l, i) => ({
        item_id: l.item_id,
        qty_per: Number(l.qty_per) || 0,
        unit: l.unit,
        reference: l.reference,
        step_id: l.step_id,
        scan_code: l.scan_code,
        sort_order: i,
        notes: l.notes,
      }));
      const updated = await api.updateBOM(bom.id, { lines: payload, notes }) as BOMDetail;
      setBom(updated);
      setLines((updated.lines ?? []).map(toEditable));
      setDirty(false);
      await refreshBomList();
      addToast('BOM lines saved', 'success');
      return true;
    } catch (e) {
      addToast(e instanceof Error ? e.message : 'Failed to save BOM lines', 'error');
      return false;
    } finally {
      setSaving(false);
    }
  };

  const handleActivate = async () => {
    if (!bom) return;
    if (dirty) {
      const ok = await handleSave();
      if (!ok) return;
    }
    setActing(true);
    try {
      const updated = await api.activateBOM(bom.id) as BOMDetail;
      setBom(updated);
      setLines((updated.lines ?? []).map(toEditable));
      setDirty(false);
      await refreshBomList();
      addToast(`BOM v${updated.version} is now active`, 'success');
    } catch (e) {
      addToast(e instanceof Error ? e.message : 'Failed to activate BOM', 'error');
    } finally {
      setActing(false);
    }
  };

  const handleNewVersion = async () => {
    if (!bom) return;
    setActing(true);
    try {
      const draft = await api.newBOMVersion(bom.id);
      await refreshBomList();
      setSelectedBomId(draft.id);
      addToast(`Draft v${draft.version} created from v${bom.version}`, 'success');
    } catch (e) {
      addToast(e instanceof Error ? e.message : 'Failed to create new version', 'error');
    } finally {
      setActing(false);
    }
  };

  const handleDeleteDraft = async () => {
    if (!bom || bom.status !== 'draft') return;
    if (!window.confirm(`Delete draft v${bom.version}? This cannot be undone.`)) return;
    setActing(true);
    try {
      await api.deleteBOM(bom.id);
      await refreshBomList();
      setSelectedBomId('');
      addToast('Draft deleted', 'success');
    } catch (e) {
      addToast(e instanceof Error ? e.message : 'Failed to delete draft', 'error');
    } finally {
      setActing(false);
    }
  };

  // ── Derived display ────────────────────────────────────────────────────────

  const activeVersionByPt = useMemo(() => {
    const map = new Map<string, number>();
    for (const b of boms) if (b.status === 'active') map.set(b.product_type_id, b.version);
    return map;
  }, [boms]);

  const rolledUpCost = lines.reduce((sum, l) => sum + (Number(l.qty_per) || 0) * (l.unit_cost || 0), 0);
  const stepName = (id: string) => appSteps.find(s => s.id === id)?.name ?? '';

  // ── Render ─────────────────────────────────────────────────────────────────

  // The heading and the search box live once, in the Materials chrome above.
  const q = search.trim().toLowerCase();
  const visibleProductTypes = q
    ? productTypes.filter(pt => pt.name.toLowerCase().includes(q))
    : productTypes;

  return (
    <div className="space-y-5">
      {loadError ? (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm py-16 flex flex-col items-center gap-3 text-center">
          <AlertTriangle size={28} className="text-red-400" />
          <p className="text-gray-500 font-medium">Couldn't load BOM data</p>
          <p className="text-xs text-gray-400">{loadError}</p>
          <button onClick={() => { setLoadError(null); loadSide(selectedAppId); }} className="btn-secondary">Retry</button>
        </div>
      ) : (
        <div className="flex flex-col lg:flex-row gap-5 items-start">
          {/* ── Left: product picker ── */}
          <div className="w-full lg:w-72 flex-shrink-0 bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
            <div className="p-3 border-b border-gray-100">
              <label className="block text-[11px] font-semibold uppercase tracking-wide text-gray-400 mb-1">App</label>
              <div className="relative">
                <select
                  className="input-field appearance-none pr-8"
                  value={selectedAppId}
                  onChange={e => setSelectedAppId(e.target.value)}
                  disabled={loadingApps}
                >
                  {apps.length === 0 && <option value="">No apps</option>}
                  {apps.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                </select>
                <ChevronDown size={14} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
              </div>
            </div>

            <div className="p-2">
              <div className="px-2 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-gray-400">
                Product types
              </div>
              {(loadingApps || loadingSide) ? (
                <div className="space-y-2 p-2">
                  {[...Array(4)].map((_, i) => <div key={i} className="h-10 animate-pulse bg-gray-100 rounded-lg" />)}
                </div>
              ) : visibleProductTypes.length === 0 ? (
                <EmptyState
                  compact
                  icon={Package}
                  title={productTypes.length === 0 ? 'No product types' : 'No match'}
                  description={productTypes.length === 0
                    ? 'Add product types to this app in the App Builder, then attach a BOM to each.'
                    : 'No product type on this app matches the search above.'}
                />
              ) : (
                <div className="space-y-1">
                  {visibleProductTypes.map(pt => {
                    const activeV = activeVersionByPt.get(pt.id);
                    const selected = pt.id === selectedPtId;
                    return (
                      <button
                        key={pt.id}
                        onClick={() => selectPt(pt.id)}
                        className={`w-full text-left px-3 py-2.5 rounded-lg flex items-center gap-2 transition-colors ${
                          selected ? 'bg-amber-50 border-l-2 border-amber-400' : 'hover:bg-gray-50 border-l-2 border-transparent'
                        }`}
                      >
                        <span className={`text-sm truncate flex-1 ${selected ? 'font-semibold text-gray-900' : 'text-gray-700'}`}>
                          {pt.name}
                        </span>
                        {activeV !== undefined ? (
                          <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 flex-shrink-0 [font-variant-numeric:tabular-nums]">
                            v{activeV} active
                          </span>
                        ) : (
                          <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-400 flex-shrink-0">
                            No BOM
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          {/* ── Right: version header + lines ── */}
          <div className="flex-1 min-w-0 w-full space-y-4">
            {!selectedPtId ? (
              <div className="bg-white rounded-xl border border-gray-200 shadow-sm">
                <EmptyState
                  icon={Layers}
                  title="Pick a product type"
                  description="Choose a product type on the left to view or edit its bill of material."
                />
              </div>
            ) : versions.length === 0 ? (
              <div className="bg-white rounded-xl border border-gray-200 shadow-sm">
                <EmptyState
                  icon={Layers}
                  title="No BOM for this product type yet"
                  description="Create a draft BOM, add its component lines, then activate it to enable kit generation."
                  action={canEdit && (
                    <button onClick={handleCreate} disabled={acting} className="btn-primary">
                      <Plus size={16} /> Create BOM
                    </button>
                  )}
                />
              </div>
            ) : (
              <>
                {/* Version header */}
                <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4 flex flex-wrap items-center gap-3">
                  <div className="flex items-center gap-2 min-w-0">
                    <Layers size={18} className="text-indigo-600 flex-shrink-0" />
                    <span className="font-bold text-gray-900 truncate">
                      {productTypes.find(p => p.id === selectedPtId)?.name}
                    </span>
                    {bom && (
                      <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${STATUS_CHIP[bom.status]}`}>
                        v{bom.version} · {bom.status}
                      </span>
                    )}
                  </div>

                  <div className="relative ml-auto">
                    <select
                      className="input-field appearance-none pr-8 text-xs py-1.5 h-auto"
                      value={selectedBomId}
                      onChange={e => setSelectedBomId(e.target.value)}
                    >
                      {versions.map(v => (
                        <option key={v.id} value={v.id}>
                          v{v.version} — {v.status}{v.line_count !== undefined ? ` (${v.line_count} lines)` : ''}
                        </option>
                      ))}
                    </select>
                    <ChevronDown size={12} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
                  </div>

                  {canEdit && bom && (
                    <div className="flex items-center gap-2 flex-wrap">
                      {isDraft && (
                        <>
                          <button onClick={handleSave} disabled={saving || !dirty} className="btn-secondary">
                            <Save size={14} /> {saving ? 'Saving…' : dirty ? 'Save lines' : 'Saved'}
                          </button>
                          <button onClick={handleActivate} disabled={acting || lines.length === 0} className="btn-primary"
                            title={lines.length === 0 ? 'Add at least one line before activating' : 'Make this the active version'}>
                            <CheckCircle size={14} /> Activate
                          </button>
                          <button onClick={handleDeleteDraft} disabled={acting}
                            className="p-2 rounded-lg hover:bg-red-50 text-gray-400 hover:text-red-600 transition-colors" title="Delete draft">
                            <Trash2 size={15} />
                          </button>
                        </>
                      )}
                      {!isDraft && (
                        <button onClick={handleNewVersion} disabled={acting} className="btn-secondary"
                          title="Copy these lines into a new editable draft">
                          <GitBranch size={14} /> New version
                        </button>
                      )}
                    </div>
                  )}
                </div>

                {/* Lines card */}
                <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
                  {editable && (
                    <div className="p-3 border-b border-gray-100 flex flex-wrap items-center gap-3">
                      <ItemTypeahead onPick={addLineFromItem} />
                      <span className="text-xs text-gray-400">Search the item master to add component lines</span>
                    </div>
                  )}
                  {!isDraft && bom && (
                    <div className="px-4 py-2 bg-gray-50 border-b border-gray-100 text-xs text-gray-500">
                      {bom.status === 'active'
                        ? 'This version is active — create a new version to make changes.'
                        : 'This version is superseded and read-only.'}
                    </div>
                  )}

                  {loadingBom ? (
                    <div className="p-4 space-y-3">
                      {[...Array(5)].map((_, i) => <div key={i} className="h-10 animate-pulse bg-gray-100 rounded-lg" />)}
                    </div>
                  ) : lines.length === 0 ? (
                    <EmptyState
                      icon={Package}
                      title="No lines yet"
                      description={editable
                        ? 'Search the item master above to add the components this product consumes.'
                        : 'This BOM version has no component lines.'}
                    />
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm whitespace-nowrap">
                        <thead className="bg-gray-50 border-b-2 border-gray-200">
                          <tr>
                            {['#', 'Item', 'Qty / unit', 'Unit', 'Reference', 'Point of use', 'Scan code', ''].map((h, i) => (
                              <th key={i} className="text-left text-[11px] font-semibold text-gray-500 uppercase tracking-wide px-3 py-2.5">{h}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                          {lines.map((l, idx) => (
                            <tr key={l.key} className="hover:bg-gray-50 transition-colors">
                              <td className="px-3 py-2 text-xs text-gray-400 [font-variant-numeric:tabular-nums]">{idx + 1}</td>
                              <td className="px-3 py-2">
                                <div className="font-medium text-gray-900 text-xs">{l.item_name}</div>
                                <div className="font-mono text-[11px] text-gray-400">{l.item_sku}</div>
                              </td>
                              <td className="px-3 py-2">
                                {editable ? (
                                  <input
                                    type="number" min={0.001} step="any"
                                    className="input-field w-24 py-1 text-xs [font-variant-numeric:tabular-nums]"
                                    value={l.qty_per}
                                    onChange={e => updateLine(l.key, { qty_per: Number(e.target.value) })}
                                  />
                                ) : (
                                  <span className="[font-variant-numeric:tabular-nums] font-semibold text-gray-800">{l.qty_per}</span>
                                )}
                              </td>
                              <td className="px-3 py-2">
                                {editable ? (
                                  <input className="input-field w-16 py-1 text-xs" value={l.unit ?? ''}
                                    onChange={e => updateLine(l.key, { unit: e.target.value })} />
                                ) : (
                                  <span className="text-xs text-gray-500">{l.unit}</span>
                                )}
                              </td>
                              <td className="px-3 py-2">
                                {editable ? (
                                  <input className="input-field w-28 py-1 text-xs" placeholder="R12, R14"
                                    value={l.reference ?? ''} onChange={e => updateLine(l.key, { reference: e.target.value })} />
                                ) : (
                                  <span className="text-xs text-gray-500">{l.reference || '—'}</span>
                                )}
                              </td>
                              <td className="px-3 py-2">
                                {editable ? (
                                  <div className="relative">
                                    <select
                                      className="input-field appearance-none w-40 py-1 pr-7 text-xs"
                                      value={l.step_id ?? ''}
                                      onChange={e => updateLine(l.key, { step_id: e.target.value })}
                                    >
                                      <option value="">Whole process</option>
                                      {appSteps.map((s, i) => (
                                        <option key={s.id} value={s.id}>{i + 1}. {s.name}</option>
                                      ))}
                                    </select>
                                    <ChevronDown size={11} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
                                  </div>
                                ) : (
                                  <span className="text-xs text-gray-500">{l.step_id ? (stepName(l.step_id) || 'Unknown step') : 'Whole process'}</span>
                                )}
                              </td>
                              <td className="px-3 py-2">
                                {editable ? (
                                  <input className="input-field w-28 py-1 text-xs font-mono" placeholder={l.item_sku}
                                    value={l.scan_code ?? ''} onChange={e => updateLine(l.key, { scan_code: e.target.value })} />
                                ) : (
                                  <span className="font-mono text-[11px] text-gray-500">{l.scan_code || l.item_sku}</span>
                                )}
                              </td>
                              <td className="px-3 py-2">
                                {editable && (
                                  <div className="flex items-center gap-0.5">
                                    <button onClick={() => moveLine(l.key, -1)} disabled={idx === 0}
                                      className="p-1 rounded hover:bg-gray-100 text-gray-400 disabled:opacity-30" title="Move up">
                                      <ArrowUp size={13} />
                                    </button>
                                    <button onClick={() => moveLine(l.key, 1)} disabled={idx === lines.length - 1}
                                      className="p-1 rounded hover:bg-gray-100 text-gray-400 disabled:opacity-30" title="Move down">
                                      <ArrowDown size={13} />
                                    </button>
                                    <button onClick={() => removeLine(l.key)}
                                      className="p-1 rounded hover:bg-red-50 text-gray-400 hover:text-red-600" title="Remove line">
                                      <Trash2 size={13} />
                                    </button>
                                  </div>
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}

                  {/* Footer: rollup */}
                  <div className="px-4 py-3 bg-gray-50 border-t border-gray-200 flex flex-wrap items-center gap-4 text-xs text-gray-500">
                    <span className="[font-variant-numeric:tabular-nums]">{lines.length} line{lines.length !== 1 ? 's' : ''}</span>
                    <span className="[font-variant-numeric:tabular-nums]">
                      Rolled-up cost / unit: <strong className="text-gray-800">${rolledUpCost.toFixed(2)}</strong>
                    </span>
                    {dirty && <span className="text-amber-600 font-medium">Unsaved changes</span>}
                    <div className="ml-auto flex items-center gap-2 min-w-[220px] flex-1 max-w-md">
                      <span className="flex-shrink-0">Notes:</span>
                      {editable ? (
                        <input className="input-field py-1 text-xs flex-1" placeholder="Revision notes…"
                          value={notes} onChange={e => { setNotes(e.target.value); setDirty(true); }} />
                      ) : (
                        <span className="truncate text-gray-600">{notes || '—'}</span>
                      )}
                    </div>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

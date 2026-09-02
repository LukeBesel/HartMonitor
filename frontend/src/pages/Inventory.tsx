import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import {
  Package, Layers, PackageOpen, PackageCheck, ShoppingCart, Truck, ListChecks,
  Search, ScanLine, ChevronDown, Plus, Download, ClipboardList, ClipboardCheck,
  AlertCircle,
} from 'lucide-react';
import { api } from '../api/client';
import BarcodeScannerModal from '../components/shared/BarcodeScannerModal';
import ModuleOnboarding from '../components/shared/ModuleOnboarding';
import LastRefreshed from '../components/shared/LastRefreshed';
import SavedViewsBar from '../components/shared/SavedViewsBar';
import TabBar from '../components/shared/TabBar';
import { useAuth } from '../context/AuthContext';
import { useAutoRefresh } from '../hooks/useAutoRefresh';
import {
  MATERIALS_TABS, MATERIALS_TAB_LABELS, MATERIALS_TAB_SUBTITLES,
  canSeeMaterialsTab, isMaterialsTab, materialsTabPath, resolveMaterialsTab,
  type MaterialsTab,
} from '../components/materials/materialsTabs';
import StockPanel, { type StockView } from '../components/materials/StockPanel';
import BomsPanel from '../components/materials/BomsPanel';
import KitsPanel, { KIT_STATUS_FILTERS } from '../components/materials/KitsPanel';
import ReceivingPanel from '../components/materials/ReceivingPanel';
import PurchasingPanel, {
  PO_STATUS_FILTERS, PO_STATUS_LABEL, type PurchasingView,
} from '../components/materials/PurchasingPanel';
import ShipmentsPanel, {
  STATUS_FILTERS as SHIPMENT_STATUS_FILTERS, FILTER_LABELS as SHIPMENT_STATUS_LABELS,
} from '../components/materials/ShipmentsPanel';
import RequirementsPanel, {
  exportRequirementsCSV, type RequirementItem,
} from '../components/materials/RequirementsPanel';
import type { KitStatus } from '../types';

// ─── Materials ────────────────────────────────────────────────────────────────
//
// One screen for everything a shop's materials do. The Inventory workspace used
// to carry eight sidebar items into seven page files, each with its own heading
// and its own filter bar, for one small manufacturer's stock — which is why most
// of the people it was built for switched the module off rather than learn where
// anything lived.
//
// This is the shell. It owns the ONE heading, the ONE filter bar, the ONE
// freshness stamp and the tab row; each tab's real work lives in a panel under
// components/materials/ and takes the filters as props. Every URL the retired
// items handed out still lands on the tab that answers it — see materialsTabs.ts.

const TAB_ICONS: Record<MaterialsTab, React.ElementType> = {
  stock: Package,
  boms: Layers,
  kits: PackageOpen,
  receiving: PackageCheck,
  purchasing: ShoppingCart,
  shipments: Truck,
  requirements: ListChecks,
};

/** "No status filter", spelled the same on every tab so moving between tabs
 *  does not need to know what the last tab called its neutral value. */
const ANY_STATUS = 'all';

/** How long the search box waits before the tab re-asks the server. Long
 *  enough that a typed SKU is one request, short enough not to feel laggy. */
const SEARCH_DEBOUNCE_MS = 250;

interface StatusOption { value: string; label: string }

function capitalise(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** The status picker the shared filter bar shows for a tab, or null when the
 *  tab has no status axis (BOMs, Receiving, and the Vendors view). */
function statusOptionsFor(tab: MaterialsTab, purchasingView: PurchasingView): StatusOption[] | null {
  switch (tab) {
    case 'stock':
      return [
        { value: ANY_STATUS, label: 'All items' },
        { value: 'low', label: 'Low stock only' },
      ];
    case 'kits':
      return KIT_STATUS_FILTERS.map(s => (
        s === 'all'
          ? { value: ANY_STATUS, label: 'All kits' }
          : { value: s, label: capitalise(s) }
      ));
    case 'purchasing':
      if (purchasingView !== 'orders') return null;
      return PO_STATUS_FILTERS.map(s => (
        s === 'All'
          ? { value: ANY_STATUS, label: 'All orders' }
          : { value: s, label: PO_STATUS_LABEL[s] }
      ));
    case 'shipments':
      return SHIPMENT_STATUS_FILTERS.map(s => (
        s === 'All'
          ? { value: ANY_STATUS, label: 'All shipments' }
          : { value: s, label: SHIPMENT_STATUS_LABELS[s] }
      ));
    case 'requirements':
      return [
        { value: ANY_STATUS, label: 'All required items' },
        { value: 'short', label: 'Shortages only' },
      ];
    default:
      return null;
  }
}

const SEARCH_PLACEHOLDER: Record<MaterialsTab, string> = {
  stock: 'Search items by name or SKU…',
  boms: 'Search product types…',
  kits: 'Search kits by work order or part…',
  receiving: 'Search open orders by PO # or vendor…',
  purchasing: 'Search PO # or vendor…',
  shipments: 'Search by carrier, tracking # or origin…',
  requirements: 'Search required items…',
};

/** The saved-view shape the Stock tab reads and writes — unchanged from the
 *  Inventory Tracker, so views a customer already saved still apply. */
interface InventoryViewFilters {
  search: string;
  category: string;
  lowStockOnly: boolean;
}

/** The saved-view shape the Purchasing tab reads and writes. */
interface POViewFilters {
  statusFilter: string;
  search: string;
}

export default function Materials() {
  const location = useLocation();
  const navigate = useNavigate();
  const { canEdit, isAtLeast } = useAuth();
  // `/inventory/:id`, `/inventory/kitting/:kitId` and `/purchasing/:view` all
  // render this screen; whichever matched supplies its parameter.
  const { id: itemId, kitId, view: purchasingParam } = useParams<{
    id: string; kitId: string; view: string;
  }>();

  const params = useMemo(() => new URLSearchParams(location.search), [location.search]);

  // Three tabs ask for a supervisor. A URL to one of them from a role that
  // cannot open it lands on Stock and says so, rather than rendering an empty
  // screen or pretending the tab does not exist.
  const askedTab = resolveMaterialsTab(location.pathname, location.search);
  const mayOpen = useCallback(
    (t: MaterialsTab) => canSeeMaterialsTab(t, isAtLeast),
    [isAtLeast],
  );
  const tab = mayOpen(askedTab) ? askedTab : 'stock';
  const visibleTabs = MATERIALS_TABS.filter(mayOpen);
  const deniedParam = params.get('denied');
  const deniedTab = isMaterialsTab(deniedParam) && !mayOpen(deniedParam) ? deniedParam : null;

  useEffect(() => {
    if (mayOpen(askedTab)) return;
    // Keep the notice in the URL: this screen is mounted from nine different
    // routes, so component state would not survive the move onto /inventory.
    navigate(`/inventory?denied=${askedTab}`, { replace: true });
  }, [askedTab, mayOpen, navigate]);

  // Purchasing's two views. `/purchasing/vendors` names it in the path; the
  // Materials URL carries it as `?sub=`; `?tab=vendors` is the address the old
  // Purchasing page handed out, honoured on that page's own path only.
  const purchasingView: PurchasingView = useMemo(() => {
    const onOldPath = location.pathname.startsWith('/purchasing');
    const asked = purchasingParam
      ?? params.get('sub')
      ?? (onOldPath ? params.get('tab') : null);
    return asked === 'vendors' ? 'vendors' : 'orders';
  }, [purchasingParam, location.pathname, params]);

  // ── The one filter bar's state ──────────────────────────────────────────────
  // Seeded from the URL, so a filtered view is a link somebody can send and a
  // reload lands back on the same slice.
  const [search, setSearch] = useState(() => params.get('q') ?? '');
  const [status, setStatus] = useState(() => params.get('status') ?? ANY_STATUS);
  const [category, setCategory] = useState(() => params.get('cat') ?? '');
  const [categories, setCategories] = useState<string[]>([]);
  const [showScanner, setShowScanner] = useState(false);
  // Which of Stock's five views is open, so the shared bar can offer the
  // controls that view actually uses and none that it doesn't.
  const [stockView, setStockView] = useState<StockView>('overview');

  // ── The one freshness stamp ─────────────────────────────────────────────────
  // Each panel hands up its own loader; the header's Refresh button and the
  // background poll then drive whichever tab is on screen.
  const refreshRef = useRef<null | (() => Promise<void> | void)>(null);
  const [lastRefreshed, setLastRefreshed] = useState<Date | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);

  // A filter means something different on each tab, so it starts clean when the
  // reader moves — a "Delivered" left over from Shipments would silently empty
  // the purchase-order table. This runs DURING RENDER on purpose: an effect
  // here would fire AFTER the incoming panel's own effects (React runs child
  // effects before the parent's), so the panel would register its loader and
  // the shell would immediately throw it away — which is exactly how the
  // Refresh button and the poll came to do nothing.
  const [renderedTab, setRenderedTab] = useState(tab);
  if (renderedTab !== tab) {
    setRenderedTab(tab);
    setSearch(params.get('q') ?? '');
    setStatus(params.get('status') ?? ANY_STATUS);
    setCategory(params.get('cat') ?? '');
    setStockView('overview');
    setLastRefreshed(null);
    setLoadFailed(false);
    refreshRef.current = null;
  }

  /** A panel hands up its loader and takes back the way to withdraw it. The
   *  withdrawal is the panel's own effect cleanup, so the loader on the ref is
   *  always the one belonging to the panel currently mounted. */
  const registerRefresh = useCallback((fn: () => Promise<void> | void) => {
    refreshRef.current = fn;
    return () => { if (refreshRef.current === fn) refreshRef.current = null; };
  }, []);

  const markLoaded = useCallback((ok = true) => {
    setLoadFailed(!ok);
    if (ok) setLastRefreshed(new Date());
  }, []);

  const tick = useCallback(async () => {
    const fn = refreshRef.current;
    if (!fn) return;
    await fn();
  }, []);
  // `immediate: false` — the panel on screen loads itself on mount; this hook
  // owns only the 60s poll and the manual button, so nothing is fetched twice.
  const auto = useAutoRefresh(tick, 60_000, { immediate: false });

  // ── Header actions ──────────────────────────────────────────────────────────
  const [createOpen, setCreateOpen] = useState(false);
  const [recordOpen, setRecordOpen] = useState(false);
  const [itemCount, setItemCount] = useState(0);
  const [requirementItems, setRequirementItems] = useState<RequirementItem[]>([]);

  useEffect(() => { setCreateOpen(false); setRecordOpen(false); }, [tab, purchasingView]);

  const closeCreate = useCallback(() => setCreateOpen(false), []);
  const openCreate = useCallback(() => setCreateOpen(true), []);
  const closeRecord = useCallback(() => setRecordOpen(false), []);
  const openRecord = useCallback(() => setRecordOpen(true), []);
  const reportCategories = useCallback((next: string[]) => {
    setCategories(prev => (
      prev.length === next.length && prev.every((c, i) => c === next[i]) ? prev : next
    ));
  }, []);

  // ── Filters, debounced onto the panels and mirrored into the URL ────────────
  // Typing stays instant in the box; the panels that re-ask the server (Stock,
  // Purchasing) see one value per pause instead of one per keystroke.
  const [appliedSearch, setAppliedSearch] = useState(search);
  useEffect(() => {
    const t = setTimeout(() => setAppliedSearch(search), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [search]);

  useEffect(() => {
    const next = new URLSearchParams(location.search);
    const set = (key: string, value: string, empty: string) => {
      if (value === empty) next.delete(key);
      else next.set(key, value);
    };
    set('q', appliedSearch, '');
    set('status', status, ANY_STATUS);
    set('cat', category, '');
    if (next.toString() === new URLSearchParams(location.search).toString()) return;
    navigate({ pathname: location.pathname, search: next.toString() }, { replace: true });
  }, [appliedSearch, status, category, location.pathname, location.search, navigate]);

  function download(kind: string) {
    api.downloadExport(kind).catch((err: any) => alert(err.message || 'Export failed'));
  }

  // Stock's Overview, Movements and Locations views read nothing from the
  // shared bar — Overview is a rollup, and the other two carry their own
  // controls — so the bar offers them nothing rather than a dead search box.
  const stockUsesFilters = tab !== 'stock' || stockView === 'items' || stockView === 'minmax';
  const statusOptions = stockUsesFilters ? statusOptionsFor(tab, purchasingView) : null;
  const showCategory = tab === 'stock' && stockUsesFilters;

  const createLabel = (() => {
    if (!canEdit) return null;
    if (tab === 'stock') return 'New Item';
    if (tab === 'purchasing') return purchasingView === 'vendors' ? 'New Vendor' : 'New PO';
    if (tab === 'shipments') return 'Add Shipment';
    return null;
  })();

  const exportAction = (() => {
    if (tab === 'stock') return () => download('inventory');
    if (tab === 'purchasing' && purchasingView === 'orders') return () => download('purchase-orders');
    if (tab === 'requirements' && requirementItems.length > 0) {
      return () => exportRequirementsCSV(requirementItems);
    }
    return null;
  })();

  return (
    <div className="p-6 space-y-5 bg-[#f8fafc] min-h-full">
      <ModuleOnboarding
        moduleId="inventory"
        title="Materials"
        description="Materials is stock, BOMs, kits, receiving, purchasing, shipments and what your planned work needs, on one screen."
        steps={[
          "Add items with SKU, unit of measure, and reorder point",
          "Set up storage locations for each area of the plant",
          "Record stock movements as materials flow",
          "Reorder alerts trigger when stock falls below minimum",
        ]}
        icon={Package}
        color="#f97316"
      />

      {showScanner && (
        <BarcodeScannerModal
          title="Scan Item Barcode"
          hint="Scan a SKU barcode to search for that item"
          onClose={() => setShowScanner(false)}
          onScan={code => {
            setShowScanner(false);
            // A scanned SKU is a stock question, wherever it was scanned from —
            // and it lands on the view that lists the match, not the rollup.
            if (tab !== 'stock') navigate(materialsTabPath('stock'));
            setStockView('items');
            setSearch(code.trim());
          }}
        />
      )}

      {/* ── The one header ── */}
      <div
        data-testid="materials-header"
        className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3"
      >
        <div className="min-w-0">
          <h1 className="text-2xl font-bold text-gray-900">Materials</h1>
          <p className="text-gray-500 text-sm mt-0.5">{MATERIALS_TAB_SUBTITLES[tab]}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2 min-w-0">
          {loadFailed ? (
            // Honest about a failed poll: the stamp would otherwise sit on the
            // last good time, or on "Updating…", for as long as the tab is open.
            <button
              onClick={() => { void auto.refresh(); }}
              className="inline-flex items-center gap-1.5 text-xs font-medium text-red-600 hover:text-red-700 mr-1"
            >
              <AlertCircle size={13} />
              Could not refresh · retry
            </button>
          ) : (
            <LastRefreshed
              at={lastRefreshed}
              refreshing={auto.refreshing}
              onRefresh={() => { void auto.refresh(); }}
              className="mr-1"
            />
          )}
          {exportAction && (
            <button onClick={exportAction} className="btn-secondary whitespace-nowrap">
              <Download size={14} />
              Export CSV
            </button>
          )}
          {tab === 'receiving' && canEdit && (
            // The goods-in bench runs the same work full screen, with a
            // scanner and no sidebar. It lost its menu item when eight became
            // one, so the way to it is from the tab that shares its job.
            <button
              onClick={() => navigate('/receiving')}
              className="btn-secondary whitespace-nowrap"
            >
              <ClipboardCheck size={14} />
              Open the kiosk
            </button>
          )}
          {tab === 'stock' && canEdit && (
            <button
              onClick={openRecord}
              disabled={itemCount === 0}
              className="btn-secondary whitespace-nowrap"
            >
              <ClipboardList size={14} />
              Record Movement
            </button>
          )}
          {createLabel && (
            <button onClick={openCreate} className="btn-primary whitespace-nowrap">
              <Plus size={14} />
              {createLabel}
            </button>
          )}
        </div>
      </div>

      <TabBar
        items={visibleTabs.map(key => {
          const Icon = TAB_ICONS[key];
          return { key, label: MATERIALS_TAB_LABELS[key], icon: <Icon size={15} /> };
        })}
        active={tab}
        onSelect={key => navigate(materialsTabPath(key))}
        ariaLabel="Materials screens"
      />

      {deniedTab && (
        <div
          data-testid="materials-denied-notice"
          className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800"
        >
          <AlertCircle size={16} className="flex-shrink-0 mt-0.5" />
          <span>
            <strong className="font-semibold">{MATERIALS_TAB_LABELS[deniedTab]}</strong> is open to
            supervisors and above. Showing Stock instead — ask an administrator if you need it.
          </span>
        </div>
      )}

      {/* ── The one filter bar ── */}
      <div
        data-testid="materials-filter-bar"
        className="flex items-center gap-3 flex-wrap"
      >
        {stockUsesFilters ? (
          <div className="relative flex-1 min-w-48">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              className="input-field pl-8"
              placeholder={SEARCH_PLACEHOLDER[tab]}
              aria-label="Search Materials"
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>
        ) : (
          // Stock's Overview is a rollup, Locations is a short list, and
          // Movements carries its own type and window pickers. Saying where the
          // controls apply beats a box that looks like it filters and doesn't.
          <p className="text-xs text-gray-400 flex-1 min-w-48">
            Search and filters apply to the Items and Min / Max views.
          </p>
        )}

        {/* A control of its own rather than an icon inside the search box: a
            scanned SKU is a stock question from any tab and any Stock view,
            including the rollup, which has no box to hang it in. */}
        <button
          onClick={() => setShowScanner(true)}
          title="Scan barcode"
          aria-label="Scan barcode"
          className="btn-secondary whitespace-nowrap"
        >
          <ScanLine size={15} />
          Scan
        </button>

        {statusOptions && (
          <div className="relative">
            <select
              className="input-field pr-8 appearance-none cursor-pointer"
              aria-label="Filter by status"
              value={status}
              onChange={e => setStatus(e.target.value)}
            >
              {statusOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
            <ChevronDown size={13} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
          </div>
        )}

        {showCategory && (
          <div className="relative">
            <select
              className="input-field pr-8 appearance-none cursor-pointer"
              aria-label="Filter by category"
              value={category}
              onChange={e => setCategory(e.target.value)}
            >
              <option value="">All Categories</option>
              {categories.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
            <ChevronDown size={13} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
          </div>
        )}

        {tab === 'stock' && stockUsesFilters && (
          <SavedViewsBar<InventoryViewFilters>
            storageKey="hm_saved_views_inventory"
            currentFilters={{ search, category, lowStockOnly: status === 'low' }}
            onApply={f => {
              setSearch(f.search);
              setCategory(f.category);
              setStatus(f.lowStockOnly ? 'low' : ANY_STATUS);
            }}
          />
        )}

        {tab === 'purchasing' && purchasingView === 'orders' && (
          <SavedViewsBar<POViewFilters>
            storageKey="hm_saved_views_purchase_orders"
            currentFilters={{ statusFilter: status === ANY_STATUS ? 'All' : status, search }}
            onApply={f => {
              setSearch(f.search);
              setStatus(f.statusFilter === 'All' ? ANY_STATUS : f.statusFilter);
            }}
          />
        )}
      </div>

      {/* ── The tab on screen ── */}
      {tab === 'stock' && (
        <StockPanel
          itemId={itemId}
          view={stockView}
          onViewChange={setStockView}
          search={appliedSearch}
          category={category}
          lowStockOnly={status === 'low'}
          onCategories={reportCategories}
          onItemCount={setItemCount}
          onSelectItem={next => navigate(next ? `/inventory/${next}` : '/inventory')}
          canCreate={canEdit}
          createOpen={createOpen}
          onCreateOpen={openCreate}
          onCreateClose={closeCreate}
          recordOpen={recordOpen}
          onRecordOpen={openRecord}
          onRecordClose={closeRecord}
          onRegisterRefresh={registerRefresh}
          onLoaded={markLoaded}
        />
      )}

      {tab === 'boms' && (
        <BomsPanel
          search={appliedSearch}
          onRegisterRefresh={registerRefresh}
          onLoaded={markLoaded}
        />
      )}

      {tab === 'kits' && (
        <KitsPanel
          kitId={kitId}
          onOpenKit={next => navigate(next ? `/inventory/kitting/${next}` : '/inventory/kitting')}
          search={appliedSearch}
          statusFilter={status === ANY_STATUS ? 'all' : (status as KitStatus)}
          onRegisterRefresh={registerRefresh}
          onLoaded={markLoaded}
        />
      )}

      {tab === 'receiving' && (
        <ReceivingPanel
          search={appliedSearch}
          onRegisterRefresh={registerRefresh}
          onLoaded={markLoaded}
          onOpenPurchasing={() => navigate(materialsTabPath('purchasing'))}
        />
      )}

      {tab === 'purchasing' && (
        <PurchasingPanel
          view={purchasingView}
          onViewChange={next => navigate(
            next === 'vendors' ? '/inventory?tab=purchasing&sub=vendors' : '/inventory?tab=purchasing',
          )}
          search={appliedSearch}
          statusFilter={status === ANY_STATUS ? 'All' : status}
          canCreate={canEdit}
          createOpen={createOpen}
          onCreateOpen={openCreate}
          onCreateClose={closeCreate}
          onRegisterRefresh={registerRefresh}
          onLoaded={markLoaded}
        />
      )}

      {tab === 'shipments' && (
        <ShipmentsPanel
          search={appliedSearch}
          statusFilter={status === ANY_STATUS ? 'All' : status}
          createOpen={createOpen}
          onCreateOpen={openCreate}
          onCreateClose={closeCreate}
          onRegisterRefresh={registerRefresh}
          onLoaded={markLoaded}
        />
      )}

      {tab === 'requirements' && (
        <RequirementsPanel
          search={appliedSearch}
          showShortagesOnly={status === 'short'}
          onItems={setRequirementItems}
          onRegisterRefresh={registerRefresh}
          onLoaded={markLoaded}
        />
      )}
    </div>
  );
}

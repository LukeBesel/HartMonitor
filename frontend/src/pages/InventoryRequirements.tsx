import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { useAuth } from '../context/AuthContext';
import {
  Package, AlertTriangle, CheckCircle, ChevronDown, ChevronUp,
  Download, Filter, RefreshCw, ClipboardList,
} from 'lucide-react';

// ── Types ─────────────────────────────────────────────────────────────────────

interface RequirementItem {
  sku?: string;
  name: string;
  required_qty: number;
  on_hand_qty: number;
  shortage: number;
  work_orders: Array<{ wo_number: string; part_name: string; needed: number }>;
}

interface RequirementsSummary {
  total_items_needed: number;
  items_in_stock: number;
  items_short: number;
  work_orders_analyzed: number;
}

interface RequirementsResult {
  items: RequirementItem[];
  summary: RequirementsSummary;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function exportCSV(items: RequirementItem[]) {
  const header = ['Name', 'SKU', 'Required Qty', 'On Hand Qty', 'Shortage', 'Work Orders'];
  const rows = items.map(item => [
    `"${item.name.replace(/"/g, '""')}"`,
    item.sku ?? '',
    item.required_qty,
    item.on_hand_qty,
    item.shortage,
    `"${item.work_orders.map(wo => wo.wo_number).join('; ')}"`,
  ]);
  const csv = [header, ...rows].map(r => r.join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `inventory-requirements-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// ── KPI Card ──────────────────────────────────────────────────────────────────

function KpiCard({
  label,
  value,
  icon,
  iconBg,
  iconColor,
  highlight,
}: {
  label: string;
  value: number | string;
  icon: React.ReactNode;
  iconBg: string;
  iconColor: string;
  highlight?: boolean;
}) {
  return (
    <div className={`bg-white rounded-xl border shadow-sm p-5 flex items-center gap-4 ${
      highlight ? 'border-red-200' : 'border-gray-200'
    }`}>
      <div className={`w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0 ${iconBg}`}>
        <span className={iconColor}>{icon}</span>
      </div>
      <div className="min-w-0">
        <div className={`text-2xl font-bold leading-none ${highlight ? 'text-red-600' : 'text-gray-900'}`}>
          {value}
        </div>
        <div className="text-xs text-gray-500 mt-1">{label}</div>
      </div>
    </div>
  );
}

// ── Requirement Row ───────────────────────────────────────────────────────────

function RequirementRow({ item }: { item: RequirementItem }) {
  const [expanded, setExpanded] = useState(false);
  const isShort = item.shortage > 0;
  const coveragePct = item.required_qty > 0
    ? Math.min(100, Math.round((item.on_hand_qty / item.required_qty) * 100))
    : 100;

  return (
    <div className={`bg-white rounded-xl border shadow-sm overflow-hidden transition-shadow hover:shadow-md ${
      isShort ? 'border-red-200' : 'border-gray-200'
    }`}>
      {/* Main row */}
      <button
        className="w-full text-left px-5 py-4 flex items-center gap-4"
        onClick={() => item.work_orders.length > 0 && setExpanded(e => !e)}
      >
        {/* Status icon */}
        <div className={`w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 ${
          isShort ? 'bg-red-50' : 'bg-green-50'
        }`}>
          {isShort
            ? <AlertTriangle className="w-5 h-5 text-red-500" />
            : <CheckCircle className="w-5 h-5 text-green-500" />
          }
        </div>

        {/* Name + SKU */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold text-gray-900 truncate">{item.name}</span>
            {item.sku && (
              <span className="text-xs font-mono text-gray-400 bg-gray-50 border border-gray-100 px-1.5 py-0.5 rounded">
                {item.sku}
              </span>
            )}
            {isShort && (
              <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-red-50 text-red-600 border border-red-100">
                Short {item.shortage}
              </span>
            )}
          </div>

          {/* Progress bar */}
          <div className="mt-2 flex items-center gap-3">
            <div className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden max-w-xs">
              <div
                className={`h-full rounded-full transition-all ${
                  coveragePct >= 100 ? 'bg-green-500' : coveragePct > 50 ? 'bg-amber-400' : 'bg-red-500'
                }`}
                style={{ width: `${coveragePct}%` }}
              />
            </div>
            <span className="text-xs text-gray-500 whitespace-nowrap">
              {item.on_hand_qty} / {item.required_qty} on hand
            </span>
          </div>
        </div>

        {/* Numbers */}
        <div className="hidden sm:flex items-center gap-6 flex-shrink-0 text-sm">
          <div className="text-center">
            <div className="font-semibold text-gray-900">{item.required_qty}</div>
            <div className="text-xs text-gray-400">Required</div>
          </div>
          <div className="text-center">
            <div className={`font-semibold ${item.on_hand_qty >= item.required_qty ? 'text-green-600' : 'text-gray-700'}`}>
              {item.on_hand_qty}
            </div>
            <div className="text-xs text-gray-400">On Hand</div>
          </div>
          <div className="text-center">
            <div className={`font-bold ${isShort ? 'text-red-600' : 'text-gray-400'}`}>
              {isShort ? item.shortage : '—'}
            </div>
            <div className="text-xs text-gray-400">Shortage</div>
          </div>
        </div>

        {/* Expand chevron */}
        {item.work_orders.length > 0 && (
          <div className="flex-shrink-0 text-gray-400">
            {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </div>
        )}
      </button>

      {/* Expanded WO list */}
      {expanded && item.work_orders.length > 0 && (
        <div className="border-t border-gray-100 bg-gray-50 px-5 py-3">
          <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
            Work Orders Requiring This Item
          </div>
          <div className="space-y-2">
            {item.work_orders.map((wo, i) => (
              <div key={i} className="flex items-center justify-between gap-4 text-sm">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="font-mono font-semibold text-gray-700 flex-shrink-0">{wo.wo_number}</span>
                  <span className="text-gray-500 truncate">{wo.part_name}</span>
                </div>
                <span className="flex-shrink-0 font-semibold text-gray-700">
                  {wo.needed} needed
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function InventoryRequirements() {
  const { canEdit } = useAuth();
  const [data, setData] = useState<RequirementsResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showShortagesOnly, setShowShortagesOnly] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    document.title = 'Materials Required';
  }, []);

  const loadData = async () => {
    try {
      const result = await (api as any).getInventoryRequirements();
      setData(result);
      setError('');
    } catch (e: any) {
      setError(e.message || 'Failed to load requirements');
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

  const items = data?.items ?? [];
  const summary = data?.summary;

  const filteredItems = showShortagesOnly
    ? items.filter(i => i.shortage > 0)
    : items;

  const hasShortages = items.some(i => i.shortage > 0);
  const noWorkOrders = !loading && !error && items.length === 0;

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-[#f8fafc] p-6">
      <div className="max-w-5xl mx-auto">
        {/* Header */}
        <div className="flex items-start justify-between gap-4 mb-6 flex-wrap">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Materials Required</h1>
            <p className="text-gray-500 text-sm mt-0.5">
              Inventory needed for planned work orders
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={handleRefresh}
              disabled={refreshing}
              className="btn-secondary"
            >
              <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
              Refresh
            </button>
            {items.length > 0 && (
              <button
                className="btn-secondary"
                onClick={() => exportCSV(items)}
              >
                <Download className="w-4 h-4" />
                Export CSV
              </button>
            )}
          </div>
        </div>

        {/* KPI Cards */}
        {summary && (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
            <KpiCard
              label="Items Needed"
              value={summary.total_items_needed}
              icon={<Package className="w-5 h-5" />}
              iconBg="bg-blue-50"
              iconColor="text-blue-600"
            />
            <KpiCard
              label="Fully in Stock"
              value={summary.items_in_stock}
              icon={<CheckCircle className="w-5 h-5" />}
              iconBg="bg-green-50"
              iconColor="text-green-600"
            />
            <KpiCard
              label="Items Short"
              value={summary.items_short}
              icon={<AlertTriangle className="w-5 h-5" />}
              iconBg="bg-red-50"
              iconColor="text-red-600"
              highlight={summary.items_short > 0}
            />
            <KpiCard
              label="WOs Analyzed"
              value={summary.work_orders_analyzed}
              icon={<ClipboardList className="w-5 h-5" />}
              iconBg="bg-purple-50"
              iconColor="text-purple-600"
            />
          </div>
        )}

        {/* Filter toggle */}
        {!loading && !error && items.length > 0 && (
          <div className="flex items-center gap-3 mb-4">
            <button
              onClick={() => setShowShortagesOnly(false)}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                !showShortagesOnly
                  ? 'bg-gray-900 text-white shadow-sm'
                  : 'bg-white border border-gray-200 text-gray-600 hover:bg-gray-50'
              }`}
            >
              All Items
              <span className={`ml-1.5 text-xs px-1.5 py-0.5 rounded-full font-semibold ${
                !showShortagesOnly ? 'bg-white/20 text-white' : 'bg-gray-100 text-gray-500'
              }`}>
                {items.length}
              </span>
            </button>
            <button
              onClick={() => setShowShortagesOnly(true)}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors flex items-center gap-1.5 ${
                showShortagesOnly
                  ? 'bg-red-600 text-white shadow-sm'
                  : 'bg-white border border-gray-200 text-gray-600 hover:bg-gray-50'
              }`}
            >
              <Filter className="w-3.5 h-3.5" />
              Shortages Only
              {hasShortages && (
                <span className={`text-xs px-1.5 py-0.5 rounded-full font-semibold ${
                  showShortagesOnly ? 'bg-white/20 text-white' : 'bg-red-50 text-red-600'
                }`}>
                  {items.filter(i => i.shortage > 0).length}
                </span>
              )}
            </button>
          </div>
        )}

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
              <div className="font-semibold">Could not load requirements</div>
              <div className="text-sm text-red-600 mt-0.5">{error}</div>
            </div>
          </div>
        ) : noWorkOrders ? (
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm py-24 flex flex-col items-center justify-center text-center gap-4">
            <div className="w-16 h-16 bg-gray-50 rounded-full border-2 border-gray-100 flex items-center justify-center">
              <ClipboardList className="w-8 h-8 text-gray-300" />
            </div>
            <div>
              <div className="font-semibold text-gray-700 text-lg">No planned work orders found</div>
              <div className="text-gray-400 text-sm mt-1">
                Create work orders in planned status to see material requirements here.
              </div>
            </div>
          </div>
        ) : filteredItems.length === 0 ? (
          <div className="bg-white rounded-xl border border-green-200 shadow-sm py-16 flex flex-col items-center justify-center text-center gap-4">
            <div className="w-16 h-16 bg-green-50 rounded-full border-2 border-green-100 flex items-center justify-center">
              <CheckCircle className="w-8 h-8 text-green-500" />
            </div>
            <div>
              <div className="font-semibold text-gray-700 text-lg">All materials are covered</div>
              <div className="text-gray-400 text-sm mt-1">
                You have sufficient stock for all planned work orders.
              </div>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            {/* Sort: shortages first */}
            {[...filteredItems]
              .sort((a, b) => b.shortage - a.shortage)
              .map((item, i) => (
                <RequirementRow key={`${item.name}-${i}`} item={item} />
              ))}

            <div className="text-xs text-gray-400 text-center pt-2">
              {filteredItems.length} item{filteredItems.length !== 1 ? 's' : ''}
              {showShortagesOnly ? ' with shortages' : ' required'}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

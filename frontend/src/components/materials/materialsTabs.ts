// ─── The Materials screen's tab model ────────────────────────────────────────
//
// Eight sidebar items — Inventory Tracker, BOMs, Kitting, Receiving, Materials
// Required, Shipments, Purchasing — used to lead to seven page files, each with
// its own heading and its own filter bar, for one small shop's materials. They
// are seven tabs on ONE screen now.
//
// Every URL those items handed out still works. A tab is derived from the URL
// rather than from state, so a bookmark, a link out of the App Builder and a
// barcode printed on a kit traveller all land on the tab that answers them:
//
//   /inventory                     → Stock          (or ?tab=<key>)
//   /inventory/:itemId             → Stock, that item's detail open
//   /inventory/boms                → BOMs
//   /inventory/kitting[/:kitId]    → Kits  (the kit open when the id is there)
//   /requirements                  → Requirements
//   /shipments                     → Shipments
//   /purchasing[/:sub]             → Purchasing
//
// Clicking a tab navigates to `/inventory?tab=<key>`, so the canonical URL is
// one path with one query — the retired paths are entry points, not a second
// address space to keep in step.

export const MATERIALS_TABS = [
  'stock', 'boms', 'kits', 'receiving', 'purchasing', 'shipments', 'requirements',
] as const;

export type MaterialsTab = typeof MATERIALS_TABS[number];

export const MATERIALS_TAB_LABELS: Record<MaterialsTab, string> = {
  stock: 'Stock',
  boms: 'BOMs',
  kits: 'Kits',
  receiving: 'Receiving',
  purchasing: 'Purchasing',
  shipments: 'Shipments',
  requirements: 'Requirements',
};

/** One line under the heading, telling the reader what this tab is for. */
export const MATERIALS_TAB_SUBTITLES: Record<MaterialsTab, string> = {
  stock: 'On-hand quantities, movements and storage locations',
  boms: 'Versioned bills of material per product type',
  kits: 'Pick and verify material kits generated from work-order BOMs',
  receiving: 'Record stock receipt against sent or partly received orders',
  purchasing: 'Purchase orders and the vendors behind them',
  shipments: 'Inbound shipments and their delivery dates',
  requirements: 'Material planned work orders need, and what is short',
};

export function isMaterialsTab(value: string | null | undefined): value is MaterialsTab {
  return !!value && (MATERIALS_TABS as readonly string[]).includes(value);
}

/**
 * The tabs that ask for a supervisor, and the role they ask for.
 *
 * Collapsing eight menu items into one could have merged their gates away with
 * them: three of the retired items carried `minRole: 'supervisor'` (bills of
 * material, purchasing, requirements) and four did not. The nav item is
 * ungated so the four open tabs stay open to every role; the gate lives here
 * instead, and the screen both hides these tabs and turns their URLs away.
 */
export const MATERIALS_SUPERVISOR_TABS: readonly MaterialsTab[] = ['boms', 'purchasing', 'requirements'];
export const MATERIALS_SUPERVISOR_ROLE = 'supervisor' as const;

/** Can somebody with this role reach `tab`? `isAtLeast` is useAuth's — typed by
 *  the one role it is asked about, so the wider callback from the context
 *  satisfies it. */
export function canSeeMaterialsTab(
  tab: MaterialsTab,
  isAtLeast: (role: typeof MATERIALS_SUPERVISOR_ROLE) => boolean,
): boolean {
  return !MATERIALS_SUPERVISOR_TABS.includes(tab) || isAtLeast(MATERIALS_SUPERVISOR_ROLE);
}

/** True when `pathname` is `prefix` itself or a route underneath it. */
function under(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

/**
 * The tab a URL asks for. `search` is the raw location.search — only consulted
 * on `/inventory` itself, because every other path names its tab outright and a
 * stale `?tab=` on one of them must not override it.
 */
export function resolveMaterialsTab(pathname: string, search = ''): MaterialsTab {
  if (under(pathname, '/inventory/boms')) return 'boms';
  if (under(pathname, '/inventory/kitting')) return 'kits';
  if (under(pathname, '/purchasing')) return 'purchasing';
  if (under(pathname, '/shipments')) return 'shipments';
  if (under(pathname, '/requirements')) return 'requirements';
  if (pathname === '/inventory') {
    const asked = new URLSearchParams(search).get('tab');
    if (isMaterialsTab(asked)) return asked;
  }
  // `/inventory/<itemId>` — an item's detail panel, which lives on Stock.
  return 'stock';
}

/** Where the tab bar sends the reader. One path, one query. */
export function materialsTabPath(tab: MaterialsTab): string {
  return tab === 'stock' ? '/inventory' : `/inventory?tab=${tab}`;
}

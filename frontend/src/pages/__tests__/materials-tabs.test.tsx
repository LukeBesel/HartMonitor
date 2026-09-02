import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

// ─── Eight destinations, one Materials screen ─────────────────────────────────
//
// The Inventory workspace carried eight sidebar items into seven page files —
// Inventory Tracker, BOMs, Kitting, Receiving, Materials Required, Shipments,
// Purchasing, Reports — roughly 5,700 lines of screen for one small shop's
// materials. What this file pins:
//
//   1. Two items under Inventory: "Materials" and "Reports".
//   2. Every URL the retired items handed out still renders, on the tab that
//      answers it — including the kit URL a printed traveller barcode carries.
//   3. Exactly ONE header and ONE filter bar, on every tab.
//   4. The filter bar drives the tab that is open, and starts clean when the
//      reader moves to a tab where the same word would mean something else.

const apiCalls: Record<string, unknown[][]> = {};

/** Whatever a screen asks the server for, answered with a shape it can render.
 *  Anything unlisted answers with an empty list, which is a real state (a shop
 *  with no shipments yet) rather than a crash. */
const API_RESULTS: Record<string, unknown> = {
  getInventoryTrackerSummary: {
    total_items: 2, total_value: 1200, low_stock: 1, out_of_stock: 0,
    today_receives: 0, today_consumes: 0,
    categories: ['Raw Materials', 'Fasteners'],
    value_by_category: [{ category: 'Raw Materials', value: 900, quantity: 2, items: 1 }],
    low_stock_list: [{
      id: 'item-7', sku: 'SKU-7', name: 'Filler Rod', category: 'Raw Materials',
      unit_of_measure: 'ea', unit_cost: 4, reorder_point: 10, reorder_max: 40,
      reorder_qty: 20, total_quantity: 2,
    }],
  },
  getInventoryItems: [
    {
      id: 'item-7', sku: 'SKU-7', name: 'Filler Rod', description: 'ER70S-6',
      category: 'Raw Materials', unit_of_measure: 'ea', unit_cost: 4,
      total_quantity: 2, reorder_point: 10, reorder_max: 40,
    },
  ],
  getApps: [{ id: 'app-1', name: 'Weld Inspection', status: 'published' }],
  getApp: { id: 'app-1', name: 'Weld Inspection', steps: [{ id: 's1', name: 'Clean' }] },
  getProductTypes: [{ id: 'pt-1', app_id: 'app-1', name: 'Bracket A' }],
  getBOMs: [{ id: 'bom-1', product_type_id: 'pt-1', version: 1, status: 'active' }],
  getBOM: { id: 'bom-1', product_type_id: 'pt-1', version: 1, status: 'active', lines: [], notes: '' },
  getKits: [
    {
      id: 'kit-42', work_order_id: 'wo-1', work_order_number: 'WO-1001', part_name: 'Bracket A',
      bom_id: 'bom-1', bom_version: 1, status: 'open', location_id: null,
      created_by: 'Ana', verified_by: '', verified_at: null,
      created_at: '2026-08-01 08:00:00', updated_at: '2026-08-01 08:00:00',
      n_verified: 0, n_total: 3,
    },
  ],
  getKit: {
    id: 'kit-42', work_order_id: 'wo-1', work_order_number: 'WO-1001', part_name: 'Bracket A',
    bom_id: 'bom-1', bom_version: 1, status: 'open', location_id: null,
    created_by: 'Ana', verified_by: '', verified_at: null,
    created_at: '2026-08-01 08:00:00', updated_at: '2026-08-01 08:00:00',
    wo_quantity: 10, lines: [],
  },
  getPurchaseOrders: [
    {
      id: 'po-1', po_number: 'PO-2001', vendor_name: 'Acme Steel', status: 'sent',
      order_date: '2026-08-01', expected_date: '2026-08-20', total_amount: 500, line_count: 1,
    },
  ],
  getPurchaseOrder: {
    id: 'po-1', po_number: 'PO-2001', vendor_name: 'Acme Steel', status: 'sent',
    order_date: '2026-08-01', expected_date: '2026-08-20', total_amount: 500,
    lines: [{
      id: 'pol-1', item_id: 'item-7', item_sku: 'SKU-7', item_name: 'Filler Rod',
      quantity_ordered: 10, quantity_received: 0, unit_cost: 50,
    }],
  },
  getPurchasingSummary: { total_vendors: 1, by_status: [{ status: 'sent', count: 1, value: 500 }] },
  getVendors: [{ id: 'v-1', name: 'Acme Steel', rating: 4, payment_terms: 'net30', is_active: 1 }],
  getShipments: [{
    id: 'ship-1', carrier: 'UPS', tracking_number: '1Z999', origin: 'Acme Steel',
    status: 'in_transit', shipped_date: '2026-08-10', estimated_arrival: '2026-08-20',
    po_id: 'po-1', notes: '',
  }],
  getInventoryRequirements: {
    summary: {
      total_items_needed: 1, items_in_stock: 0, items_short: 1, work_orders_analyzed: 1,
    },
    items: [{
      sku: 'SKU-7', name: 'Filler Rod', required_qty: 10, on_hand_qty: 2, shortage: 8,
      source: 'bom', unit: 'ea', item_id: 'item-7',
      work_orders: [{ wo_number: 'WO-1001', part_name: 'Bracket A', needed: 10 }],
    }],
  },
};

vi.mock('../../api/client', () => ({
  api: new Proxy({}, {
    get(_target, prop: string) {
      return (...args: unknown[]) => {
        (apiCalls[prop] ??= []).push(args);
        const result = API_RESULTS[prop];
        return Promise.resolve(result === undefined ? [] : result);
      };
    },
  }),
}));

let canEdit = true;

vi.mock('../../context/AuthContext', () => ({
  useAuth: () => ({
    user: { id: 'u-1', email: 'a@b.c', display_name: 'Ana Diaz', role: 'manager' },
    canEdit, loading: false, isAtLeast: () => true,
  }),
}));
vi.mock('../../context/SiteContext', () => ({
  useSite: () => ({ sites: [], selectedSiteId: null, setSelectedSiteId: () => {}, loading: false, refresh: () => {} }),
}));
// One stable object, the way the real provider hands one out: `addToast` is a
// `useCallback` in ToastContext, and screens put it in effect dependency lists.
// A fresh function per render here would re-run those effects forever — a bug
// in the stand-in, not in the screen.
vi.mock('../../context/ToastContext', () => {
  const value = { addToast: () => {} };
  return { useToast: () => value };
});
vi.mock('../../components/shared/ModuleOnboarding', () => ({
  default: () => null,
  markWalkthroughSeen: () => {},
}));

import Materials from '../Inventory';
import { SECTIONS } from '../../config/navigation';
import { resolveMaterialsTab, materialsTabPath } from '../../components/materials/materialsTabs';

/** The app's real inventory route table, so a URL is resolved here exactly the
 *  way App.tsx resolves it — including which parameter each path supplies. */
function renderAt(url: string) {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        <Route path="/inventory" element={<Materials />} />
        <Route path="/inventory/boms" element={<Materials />} />
        <Route path="/inventory/kitting" element={<Materials />} />
        <Route path="/inventory/kitting/:kitId" element={<Materials />} />
        <Route path="/inventory/:id" element={<Materials />} />
        <Route path="/requirements" element={<Materials />} />
        <Route path="/shipments" element={<Materials />} />
        <Route path="/purchasing" element={<Materials />} />
        <Route path="/purchasing/:view" element={<Materials />} />
      </Routes>
    </MemoryRouter>,
  );
}

/** The tab row's currently selected tab, read the way a reader reads it. */
function activeTab(): string {
  const row = screen.getByRole('navigation', { name: 'Materials screens' });
  return within(row).getByRole('button', { current: 'page' }).textContent ?? '';
}

beforeEach(() => {
  canEdit = true;
  for (const key of Object.keys(apiCalls)) delete apiCalls[key];
  window.localStorage.clear();
});

// ── 1. Two items where there were eight ──────────────────────────────────────

describe('the Inventory workspace is two menu items', () => {
  it('lists Materials and Reports, and nothing else', () => {
    const inventory = SECTIONS.find(s => s.id === 'inventory')!;
    expect(inventory.items.map(i => i.label)).toEqual(['Materials', 'Reports']);
  });

  it('names none of the seven items it replaced', () => {
    const labels = SECTIONS.flatMap(s => s.items.map(i => i.label));
    for (const gone of [
      'Inventory Tracker', 'BOMs', 'Kitting', 'Receiving',
      'Materials Required', 'Shipments', 'Purchasing',
    ]) {
      expect(labels, `the sidebar still offers "${gone}"`).not.toContain(gone);
    }
  });
});

// ── 2. Every old URL lands on the tab that answers it ────────────────────────

describe('every URL the retired screens handed out opens its tab', () => {
  // One assertion per route, because each is a bookmark, a printed link or a
  // barcode somebody already has.
  const ROUTES: [url: string, tab: string][] = [
    ['/inventory', 'Stock'],
    ['/inventory?tab=receiving', 'Receiving'],
    ['/inventory/item-7', 'Stock'],
    ['/inventory/boms', 'BOMs'],
    ['/inventory/kitting', 'Kits'],
    ['/inventory/kitting/kit-42', 'Kits'],
    ['/requirements', 'Requirements'],
    ['/shipments', 'Shipments'],
    ['/purchasing', 'Purchasing'],
    ['/purchasing/vendors', 'Purchasing'],
  ];

  for (const [url, tab] of ROUTES) {
    it(`opens ${tab} for ${url}`, async () => {
      renderAt(url);
      await waitFor(() => expect(activeTab()).toContain(tab));
    });
  }

  it('resolves a tab from the URL without rendering anything', () => {
    // The same rule the router relies on, checked directly so a future route
    // can be added without mounting the whole screen to find out where it goes.
    expect(resolveMaterialsTab('/inventory', '')).toBe('stock');
    expect(resolveMaterialsTab('/inventory', '?tab=kits')).toBe('kits');
    expect(resolveMaterialsTab('/inventory/item-7', '')).toBe('stock');
    expect(resolveMaterialsTab('/inventory/boms', '?app_id=app-1')).toBe('boms');
    expect(resolveMaterialsTab('/inventory/kitting/kit-42', '')).toBe('kits');
    expect(resolveMaterialsTab('/purchasing/vendors', '')).toBe('purchasing');
    expect(resolveMaterialsTab('/shipments', '')).toBe('shipments');
    expect(resolveMaterialsTab('/requirements', '')).toBe('requirements');
    // A stale `?tab=` on a path that names its own tab must not override it.
    expect(resolveMaterialsTab('/shipments', '?tab=stock')).toBe('shipments');
    // Nonsense in the query falls back rather than rendering an empty screen.
    expect(resolveMaterialsTab('/inventory', '?tab=nope')).toBe('stock');
    // And the tab row's canonical addresses round-trip.
    expect(resolveMaterialsTab(materialsTabPath('purchasing').split('?')[0], '?tab=purchasing'))
      .toBe('purchasing');
  });

  it('opens the kit a printed traveller barcode names, inside the Kits tab', async () => {
    renderAt('/inventory/kitting/kit-42');
    await waitFor(() => expect(activeTab()).toContain('Kits'));
    // The detail, not the list: the barcode names one kit.
    await screen.findByText(/WO-1001/);
    expect(apiCalls.getKit?.[0]?.[0]).toBe('kit-42');
  });

  it('opens the item a stock deep link names, inside the Stock tab', async () => {
    renderAt('/inventory/item-7');
    await waitFor(() => expect(activeTab()).toContain('Stock'));
    // `/inventory/:id` forces the Items view so the detail panel is visible.
    await waitFor(() => expect(
      within(screen.getByRole('navigation', { name: 'Stock views' }))
        .getByRole('button', { current: 'page' }).textContent,
    ).toContain('Items'));
  });
});

// ── 3. One header, one filter bar, on every tab ──────────────────────────────

describe('one header and one filter bar, whichever tab is open', () => {
  const TAB_URLS = [
    '/inventory',
    '/inventory?tab=receiving',
    '/inventory/boms',
    '/inventory/kitting',
    '/inventory/kitting/kit-42',
    '/requirements',
    '/shipments',
    '/purchasing',
    '/purchasing/vendors',
  ];

  for (const url of TAB_URLS) {
    it(`has exactly one of each on ${url}`, async () => {
      renderAt(url);
      await waitFor(() => expect(screen.getAllByTestId('materials-header')).toHaveLength(1));
      expect(screen.getAllByTestId('materials-filter-bar')).toHaveLength(1);
      // One heading, and it is the screen's name — not the old page's.
      expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
      expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Materials');
      // And exactly one search box: the shared one.
      expect(screen.getAllByLabelText('Search Materials')).toHaveLength(1);
    });
  }

  it('keeps the header and filter bar single while moving between tabs', async () => {
    renderAt('/inventory');
    await waitFor(() => expect(activeTab()).toContain('Stock'));

    const row = screen.getByRole('navigation', { name: 'Materials screens' });
    for (const label of ['Shipments', 'Purchasing', 'Requirements', 'Kits', 'Stock']) {
      fireEvent.click(within(row).getByRole('button', { name: new RegExp(label) }));
      await waitFor(() => expect(activeTab()).toContain(label));
      expect(screen.getAllByTestId('materials-header')).toHaveLength(1);
      expect(screen.getAllByTestId('materials-filter-bar')).toHaveLength(1);
    }
  });
});

// ── 4. The one filter bar drives the tab that is open ────────────────────────

describe('the shared filter bar', () => {
  it('re-asks the server when the Stock search moves', async () => {
    renderAt('/inventory');
    await waitFor(() => expect(apiCalls.getInventoryItems?.length).toBeGreaterThan(0));

    fireEvent.change(screen.getByLabelText('Search Materials'), { target: { value: 'filler' } });
    await waitFor(() => {
      const calls = apiCalls.getInventoryItems!;
      const last = calls[calls.length - 1][0] as { search?: string };
      expect(last.search).toBe('filler');
    });
  });

  it('narrows the open tab rather than the whole screen', async () => {
    renderAt('/shipments');
    expect(await screen.findByText('1Z999')).toBeTruthy();

    fireEvent.change(screen.getByLabelText('Search Materials'), { target: { value: 'fedex' } });
    await waitFor(() => expect(screen.queryByText('1Z999')).toBeNull());
    // An empty result says why, instead of pretending there are no shipments.
    expect(screen.getByText(/No shipments match those filters/)).toBeTruthy();
  });

  it('offers each tab its own status list, and none where there is no status', async () => {
    renderAt('/shipments');
    await waitFor(() => expect(activeTab()).toContain('Shipments'));
    expect(screen.getByLabelText('Filter by status')).toBeTruthy();
    expect(
      Array.from(screen.getByLabelText('Filter by status').querySelectorAll('option'))
        .map(o => o.textContent),
    ).toContain('In Transit');

    const row = screen.getByRole('navigation', { name: 'Materials screens' });
    fireEvent.click(within(row).getByRole('button', { name: /BOMs/ }));
    await waitFor(() => expect(activeTab()).toContain('BOMs'));
    // BOMs has no status axis, so the bar does not offer a picker that does
    // nothing — the bar itself is still there.
    expect(screen.queryByLabelText('Filter by status')).toBeNull();
    expect(screen.getAllByTestId('materials-filter-bar')).toHaveLength(1);
  });

  it('starts clean on the next tab', async () => {
    renderAt('/shipments');
    await waitFor(() => expect(activeTab()).toContain('Shipments'));
    fireEvent.change(screen.getByLabelText('Search Materials'), { target: { value: 'ups' } });
    fireEvent.change(screen.getByLabelText('Filter by status'), { target: { value: 'delivered' } });

    const row = screen.getByRole('navigation', { name: 'Materials screens' });
    fireEvent.click(within(row).getByRole('button', { name: /Purchasing/ }));
    await waitFor(() => expect(activeTab()).toContain('Purchasing'));

    // "Delivered" is not a purchase-order status; carrying it across would have
    // emptied the table with no way to see why.
    expect((screen.getByLabelText('Search Materials') as HTMLInputElement).value).toBe('');
    expect((screen.getByLabelText('Filter by status') as HTMLSelectElement).value).toBe('all');
    expect(await screen.findByText('PO-2001')).toBeTruthy();
  });
});

// ── 5. The actions each old page carried are still reachable ─────────────────

describe('every action the seven pages carried is still on the screen', () => {
  it('offers the Stock tab its item, movement and export actions', async () => {
    renderAt('/inventory');
    await waitFor(() => expect(activeTab()).toContain('Stock'));
    const header = screen.getByTestId('materials-header');
    expect(within(header).getByRole('button', { name: /New Item/ })).toBeTruthy();
    expect(within(header).getByRole('button', { name: /Record Movement/ })).toBeTruthy();
    expect(within(header).getByRole('button', { name: /Export CSV/ })).toBeTruthy();
    // The five Stock views the Inventory Tracker had, minus Receiving, which is
    // a tab of the Materials screen itself now.
    const views = screen.getByRole('navigation', { name: 'Stock views' });
    // Overview carries the low-stock count as a badge, so labels are compared
    // with the number stripped — the count itself is measured, not decoration.
    expect(within(views).getAllByRole('button')
      .map(b => (b.textContent ?? '').replace(/\d+$/, '').trim()))
      .toEqual(['Overview', 'Items', 'Min / Max', 'Movements', 'Locations']);
  });

  it('opens the new-item form from the one header', async () => {
    renderAt('/inventory');
    await waitFor(() => expect(activeTab()).toContain('Stock'));
    fireEvent.click(within(screen.getByTestId('materials-header')).getByRole('button', { name: /New Item/ }));
    expect(await screen.findByText('New Inventory Item')).toBeTruthy();
  });

  it('offers New PO on Purchase Orders and New Vendor on Vendors', async () => {
    renderAt('/purchasing');
    await waitFor(() => expect(activeTab()).toContain('Purchasing'));
    expect(within(screen.getByTestId('materials-header')).getByRole('button', { name: /New PO/ })).toBeTruthy();

    const views = screen.getByRole('navigation', { name: 'Purchasing views' });
    fireEvent.click(within(views).getByRole('button', { name: /Vendors/ }));
    await waitFor(() => expect(
      within(screen.getByTestId('materials-header')).getByRole('button', { name: /New Vendor/ }),
    ).toBeTruthy());
  });

  it('opens the vendors view straight from /purchasing/vendors', async () => {
    renderAt('/purchasing/vendors');
    await waitFor(() => expect(activeTab()).toContain('Purchasing'));
    const views = screen.getByRole('navigation', { name: 'Purchasing views' });
    expect(within(views).getByRole('button', { current: 'page' })).toHaveTextContent('Vendors');
  });

  it('offers Add Shipment on Shipments and the receipt cards on Receiving', async () => {
    renderAt('/shipments');
    await waitFor(() => expect(activeTab()).toContain('Shipments'));
    expect(within(screen.getByTestId('materials-header')).getByRole('button', { name: /Add Shipment/ })).toBeTruthy();

    renderAt('/inventory?tab=receiving');
    await waitFor(() => expect(screen.getAllByText('PO-2001').length).toBeGreaterThan(0));
  });

  it('exports the requirement list from the same place as every other tab', async () => {
    renderAt('/requirements');
    await waitFor(() => expect(activeTab()).toContain('Requirements'));
    await waitFor(() => expect(
      within(screen.getByTestId('materials-header')).getByRole('button', { name: /Export CSV/ }),
    ).toBeTruthy());
  });

  it('keeps the barcode scanner reachable from the one filter bar', async () => {
    renderAt('/inventory');
    await waitFor(() => expect(activeTab()).toContain('Stock'));
    const bar = screen.getByTestId('materials-filter-bar');
    expect(within(bar).getByRole('button', { name: 'Scan barcode' })).toBeTruthy();
  });

  it('shows a read-only account the screen without the write actions', async () => {
    canEdit = false;
    renderAt('/inventory');
    await waitFor(() => expect(activeTab()).toContain('Stock'));
    const header = screen.getByTestId('materials-header');
    expect(within(header).queryByRole('button', { name: /New Item/ })).toBeNull();
    expect(within(header).queryByRole('button', { name: /Record Movement/ })).toBeNull();
    // Reading is still allowed, so the export stays.
    expect(within(header).getByRole('button', { name: /Export CSV/ })).toBeTruthy();
  });
});

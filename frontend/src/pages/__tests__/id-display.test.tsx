import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

// ─── The id a cell prints ─────────────────────────────────────────────────────
// A sandbox company prefixes the ids it mints with a six-hex-digit tag so two
// sandboxes can both hold "WO-1001" — the floor says WO-1001, so that is what
// the cell says, with the stored id in the title attribute.
//
// The trap, and the reason this file exists: six hex digits and a dash is also
// the shape of a real PART NUMBER. `100234-01` is a part; a rule that strips
// "the first group and a dash" turned that cell into "01" — data loss on a
// screen a planner reads. The tag is only recognised in front of an id family
// this product actually issues.

const getWorkOrders = vi.fn();
const getApps = vi.fn();
const getDepartments = vi.fn();
const getKits = vi.fn();
const getLocations = vi.fn();
const getRoutings = vi.fn();
const getStations = vi.fn();

vi.mock('../../api/client', () => ({
  api: {
    get getWorkOrders() { return getWorkOrders; },
    get getApps() { return getApps; },
    get getDepartments() { return getDepartments; },
    get getKits() { return getKits; },
    get getLocations() { return getLocations; },
    get getRoutings() { return getRoutings; },
    get getStations() { return getStations; },
    getProductTypes: vi.fn(() => Promise.resolve([])),
    getWorkOrderComments: vi.fn(() => Promise.resolve([])),
  },
}));
vi.mock('../../api/floor', () => ({ getFloorDispatch: vi.fn(() => Promise.resolve({ rows: [] })) }));
vi.mock('../../api/operator', () => ({ dispatchRowLabel: () => '' }));
vi.mock('../../components/shared/ModuleOnboarding', () => ({ default: () => null }));
vi.mock('../../components/shared/ActivityLog', () => ({ default: () => null }));
vi.mock('../../components/shared/WipSearch', () => ({ default: () => null }));
vi.mock('../../components/shared/SavedViewsBar', () => ({ default: () => null }));
vi.mock('../../context/SiteContext', () => ({ useSite: () => ({ selectedSiteId: null, sites: [] }) }));
vi.mock('../../context/ToastContext', () => ({ useToast: () => ({ addToast: () => {} }) }));
vi.mock('../../context/AuthContext', () => ({
  useAuth: () => ({
    user: { id: 'u-1', display_name: 'Ana', role: 'manager', display_role: 'Manager' },
    canEdit: true, loading: false, isAtLeast: () => true,
  }),
}));

import Schedule from '../Schedule';
import { displayId, hasCompanyTag } from '../../utils/ids';

const WO = {
  id: 'wo-1',
  work_order_number: 'B5E656-WO-1001',
  // A real part number that happens to start with six characters and a dash.
  part_number: '100234-01',
  part_name: 'Bracket',
  quantity: 10, quantity_completed: 0,
  status: 'pending', priority: 'normal',
  scheduled_start: '2026-09-01T08:00:00Z', scheduled_end: '2026-09-03T17:00:00Z',
  department_id: null, app_id: null, customer_ref: '',
};

beforeEach(() => {
  vi.clearAllMocks();
  getWorkOrders.mockResolvedValue([WO]);
  getApps.mockResolvedValue([]);
  getDepartments.mockResolvedValue([]);
  getKits.mockResolvedValue([]);
  getLocations.mockResolvedValue([]);
  getRoutings.mockResolvedValue([]);
  getStations.mockResolvedValue([]);
});

describe('displayId', () => {
  it('strips the tag only in front of an id family this product issues', () => {
    expect(displayId('B5E656-WO-1001')).toBe('WO-1001');
    expect(displayId('B5E656-NCR-101')).toBe('NCR-101');
    expect(displayId('B5E656-MWO-100')).toBe('MWO-100');
    expect(displayId('B5E656-PO-2001')).toBe('PO-2001');
    expect(displayId('B5E656-CAPA-001')).toBe('CAPA-001');
    expect(displayId('B5E656-SN-0042')).toBe('SN-0042');
  });

  it('never touches a customer part number shaped like a tag', () => {
    expect(displayId('100234-01')).toBe('100234-01');
    expect(displayId('A1B2C3-500')).toBe('A1B2C3-500');
    expect(displayId('B5E656-M6KIT-BAG')).toBe('B5E656-M6KIT-BAG');
    expect(hasCompanyTag('100234-01')).toBe(false);
    expect(hasCompanyTag('A1B2C3-500')).toBe(false);
    expect(hasCompanyTag('B5E656-WO-1001')).toBe(true);
  });
});

describe('the Schedule grid', () => {
  it('shows the work order short and the part number whole', async () => {
    render(<MemoryRouter initialEntries={['/schedule']}><Schedule /></MemoryRouter>);
    // The work order reads the way the traveller says it…
    const wo = await screen.findByText('WO-1001');
    expect(wo.getAttribute('title')).toBe('B5E656-WO-1001');
    // …and the part number is printed exactly as the planner typed it.
    expect(await screen.findByText('100234-01')).toBeTruthy();
    expect(screen.queryByText('01')).toBeNull();
    await waitFor(() => expect(getWorkOrders).toHaveBeenCalled());
  });
});


// ─── Nowhere prints the raw id ────────────────────────────────────────────────
// The rule is only worth anything if it holds on every screen, and the way it
// stopped holding was one new cell at a time — a chip on the wall board, an
// escalation line on the Andon board, an NCR number on a quality card. Each of
// those printed `B5E656-WO-1001` where the traveller says `WO-1001`, and on the
// board it was printed into a chip narrow enough that the tag pushed the actual
// number out under an ellipsis.
//
// So this reads the management screens themselves. An id field may be rendered
// only through `displayId`, or handed to a `title` attribute — which is the
// stored id, the thing a support ticket has to quote.

const ID_FIELDS = ['work_order_number', 'ncr_number', 'wo_number', 'open_wo_number', 'mwo_number', 'po_number'];

const ID_SCREENS = [
  'DepartmentTV.tsx', 'DepartmentView.tsx', 'Andon.tsx', 'AppDetail.tsx',
  'Quality.tsx', 'Routings.tsx', 'StationView.tsx', 'Maintenance.tsx', 'Dashboard.tsx',
];

describe('the management screens print the id the floor says', () => {
  it('renders every id field through displayId, with the stored id in a title', async () => {
    const fs = await import('node:fs/promises');
    const path = await import('node:path');
    const { fileURLToPath } = await import('node:url');
    const here = path.dirname(fileURLToPath(import.meta.url));

    // A JSX expression, not a `${…}` hole: the wall board builds its dedupe key
    // out of the stored id, which is exactly right — nobody reads a Map key.
    const printed = new RegExp(`(^|[^$])\\{[^{}]*\\b(${ID_FIELDS.join('|')})\\b[^{}]*\\}`);
    const raw: string[] = [];
    for (const screenFile of ID_SCREENS) {
      const src = await fs.readFile(path.join(here, '..', screenFile), 'utf8');
      src.split('\n').forEach((line, i) => {
        if (!printed.test(line)) return;
        // Allowed: through the shared helper, or into the title attribute that
        // carries the full stored id.
        if (/displayId\(/.test(line) || /title=/.test(line) || /hasCompanyTag\(/.test(line)) return;
        raw.push(`${screenFile}:${i + 1} ${line.trim().slice(0, 90)}`);
      });
    }
    expect(raw).toEqual([]);
  });

  it('imports the one helper rather than trimming the tag locally', async () => {
    const fs = await import('node:fs/promises');
    const path = await import('node:path');
    const { fileURLToPath } = await import('node:url');
    const here = path.dirname(fileURLToPath(import.meta.url));
    for (const screenFile of ID_SCREENS) {
      const src = await fs.readFile(path.join(here, '..', screenFile), 'utf8');
      if (!/displayId\(/.test(src)) continue;
      expect(src, `${screenFile} must import displayId`).toMatch(/from '\.\.\/utils\/ids'/);
      // A second local regex for the tag is how the two rules drift apart.
      expect(src, `${screenFile} must not re-implement the tag rule`).not.toMatch(/\[0-9A-F\]\{6\}/);
    }
  });

  it('leaves a part number alone — it is the customer\'s own string', () => {
    // Six characters and a dash is a shape a real part number has. The
    // Routings and Quality screens print part numbers and SKUs beside work
    // order ids, and only the ids get trimmed.
    expect(displayId('100234-01')).toBe('100234-01');
    expect(displayId('B5E656-1001')).toBe('B5E656-1001');
    expect(hasCompanyTag('100234-01')).toBe(false);
  });
});

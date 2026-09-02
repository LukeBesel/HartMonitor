import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

// ─── The Command Center is the floor, and the filter is a filter ──────────────
// This page used to ask a question before it answered one: every number, list
// and chart sat behind `{selectedDeptId && …}`, so a manager's home screen was
// a picker until they picked. Now it opens on the whole plant and a department
// narrows it.
//
// Two contracts are pinned here.
//
// The layout contract the owner asked for: Needs Attention above everything,
// the department and app filters side by side under it, then the plant.
//
// And the scope contract, which this product has broken twice: a filter that
// narrows ONE card while the headline tiles keep showing plant-wide totals,
// which a manager reads as "that is my department's number". Picking a
// department must re-fetch EVERY data source and move every section with it.

const getDailyBrief = vi.fn();
const getPlantView = vi.fn();
const getCompanySettings = vi.fn();
const getDepartments = vi.fn();
const getApps = vi.fn();
const loadSampleData = vi.fn();
const acknowledgeAndonCall = vi.fn();
const resolveAndonCall = vi.fn();
const getFloorSnapshot = vi.fn();
const getFloorDepartments = vi.fn();

vi.mock('../../api/client', () => ({
  api: {
    get getDailyBrief() { return getDailyBrief; },
    get getPlantView() { return getPlantView; },
    get getCompanySettings() { return getCompanySettings; },
    get getDepartments() { return getDepartments; },
    get getApps() { return getApps; },
    get loadSampleData() { return loadSampleData; },
    get acknowledgeAndonCall() { return acknowledgeAndonCall; },
    get resolveAndonCall() { return resolveAndonCall; },
  },
}));

vi.mock('../../api/floor', () => ({
  getFloorSnapshot: (...args: unknown[]) => getFloorSnapshot(...args),
  getFloorDepartments: (...args: unknown[]) => getFloorDepartments(...args),
}));

vi.mock('../../context/AuthContext', () => ({
  useAuth: () => ({
    user: { id: 'u-1', email: 'a@b.c', display_name: 'Ana Diaz', role: 'manager' },
    canEdit: true, isAtLeast: () => true, loading: false,
  }),
}));

vi.mock('../../context/SiteContext', () => ({
  useSite: () => ({
    sites: [], selectedSiteId: null, setSelectedSiteId: () => {}, loading: false, refresh: () => {},
  }),
}));

vi.mock('../../utils/realtime', () => ({
  subscribeRealtime: () => () => {},
  isAndonEvent: () => false,
}));

vi.mock('../../components/shared/OnboardingWizard', () => ({ default: () => null }));
vi.mock('../../components/shared/ModuleOnboarding', () => ({
  default: () => null,
  markWalkthroughSeen: () => {},
}));

import Dashboard from '../Dashboard';

// ── Fixtures ─────────────────────────────────────────────────────────────────

const DEPARTMENTS = [
  { id: 'd-weld', name: 'Welding' },
  { id: 'd-paint', name: 'Paint' },
];
const APPS = [
  { id: 'a-weld', name: 'Weld Check' },
  { id: 'a-paint', name: 'Paint Check' },
];

/** One floor snapshot, in the shape api/floor.ts describes. */
function snapshot(over: Record<string, unknown> = {}) {
  return {
    plant_date: '2026-09-02', timezone: 'UTC',
    finished_today: 12, running_now: 4,
    avg_cycle_seconds: 1080, avg_cycle_basis: 'elapsed', avg_cycle_sample: 12,
    avg_cycle_reason: null, avg_cycle_window: 'today',
    pass_rate: 96, pass_rate_sample: 25, pass_rate_reason: null,
    pass_rate_pass: 24, pass_rate_fail: 1, pass_rate_window: 'today',
    open_work_orders: 8, on_track: 6, at_risk: 1, behind: 1, overdue: 0,
    not_started: 0, completed_work_orders: 4, total_work_orders: 12,
    on_track_pct: 75, on_track_reason: null, on_track_basis: 'open_work_orders',
    scope: { site_id: null, department_id: null, app_id: null, station_id: null, valid: true },
    ...over,
  };
}

const SNAPSHOT = {
  all: snapshot(),
  weld: snapshot({
    finished_today: 7, running_now: 3,
    avg_cycle_seconds: 840, avg_cycle_sample: 7,
    pass_rate: 91, pass_rate_sample: 11,
    open_work_orders: 4, on_track: 2, on_track_pct: 50,
    scope: { site_id: null, department_id: 'd-weld', app_id: null, station_id: null, valid: true },
  }),
  // A real department that nothing has run through — every rate arrives null
  // with the reason beside it, so the page can print '—' and say why.
  empty: snapshot({
    finished_today: 0, running_now: 0,
    avg_cycle_seconds: null, avg_cycle_sample: 0, avg_cycle_reason: 'no run has finished yet',
    pass_rate: null, pass_rate_sample: 0, pass_rate_reason: 'no pass/fail result recorded yet',
    pass_rate_pass: 0, pass_rate_fail: 0,
    open_work_orders: 0, on_track: 0, at_risk: 0, behind: 0,
    completed_work_orders: 0, total_work_orders: 0,
    on_track_pct: null, on_track_reason: 'no open work order to be on track with',
    scope: { site_id: null, department_id: 'd-paint', app_id: null, station_id: null, valid: true },
  }),
};

const FLOOR_DEPARTMENTS = {
  plant_date: '2026-09-02', timezone: 'UTC',
  scope: { site_id: null, valid: true },
  departments: [
    {
      ...SNAPSHOT.weld,
      department_id: 'd-weld', department_name: 'Welding', department_color: '#f59e0b',
      avg_cycle_seconds_raw: 840.2,
    },
    {
      ...snapshot({
        finished_today: 5, running_now: 1,
        avg_cycle_seconds: 1320, avg_cycle_sample: 5,
        open_work_orders: 4, on_track: 4, at_risk: 0, behind: 0, on_track_pct: 100,
      }),
      department_id: 'd-paint', department_name: 'Paint', department_color: '#3b82f6',
      avg_cycle_seconds_raw: 1320,
    },
  ],
};

/** Everything the snapshot does NOT answer: the rows behind the numbers. */
const BRIEF = {
  all: {
    scope: { department_id: null, app_id: null },
    attention: [
      { type: 'wo_overdue', severity: 'red', label: 'WO-1 · Weldment', detail: '2/10 done · Welding', link: '/schedule' },
      { type: 'wo_overdue', severity: 'red', label: 'WO-9 · Painted Frame', detail: '0/5 done · Paint', link: '/schedule' },
      { type: 'stock_low', severity: 'amber', label: 'SKU-7 · Filler Rod', detail: '2 on hand', link: '/inventory' },
    ],
    attention_plant_wide_hidden: 0,
    attention_plant_wide_kinds: [],
    kpis: { completed_today: 12, active_now: 4, work_orders_total: 12 },
    due_soon: [
      { id: 'wo1', work_order_number: 'WO-1', part_name: 'Weldment', department_name: 'Welding', quantity: 10, quantity_completed: 2, completion_pct: 20, scheduled_end: '2026-09-01T10:00:00Z', priority: 'high', schedule_status: 'overdue' },
      { id: 'wo9', work_order_number: 'WO-9', part_name: 'Painted Frame', department_name: 'Paint', quantity: 5, quantity_completed: 0, completion_pct: 0, scheduled_end: '2026-09-01T12:00:00Z', priority: 'medium', schedule_status: 'overdue' },
    ],
    throughput_7d: [{ date: '2026-08-25', count: 12 }],
    week_avg_per_day: 9.5,
    is_pro: true,
  },
  weld: {
    scope: { department_id: 'd-weld', app_id: null },
    attention: [
      { type: 'wo_overdue', severity: 'red', label: 'WO-1 · Weldment', detail: '2/10 done · Welding', link: '/schedule' },
    ],
    attention_plant_wide_hidden: 2,
    attention_plant_wide_kinds: ['low stock', 'unrouted help requests'],
    kpis: { completed_today: 7, active_now: 3, work_orders_total: 7 },
    due_soon: [
      { id: 'wo1', work_order_number: 'WO-1', part_name: 'Weldment', department_name: 'Welding', quantity: 10, quantity_completed: 2, completion_pct: 20, scheduled_end: '2026-09-01T10:00:00Z', priority: 'high', schedule_status: 'overdue' },
    ],
    throughput_7d: [{ date: '2026-08-25', count: 7 }],
    week_avg_per_day: 5.5,
    is_pro: true,
  },
  empty: {
    scope: { department_id: 'd-paint', app_id: null },
    attention: [],
    attention_plant_wide_hidden: 3,
    attention_plant_wide_kinds: ['low stock'],
    kpis: { completed_today: 0, active_now: 0, work_orders_total: 0 },
    due_soon: [],
    throughput_7d: [{ date: '2026-08-25', count: 0 }],
    week_avg_per_day: 0,
    is_pro: true,
  },
};

const PLANT = {
  all: {
    scope: { site_id: null, department_id: null, app_id: null },
    hourly_throughput: [{ hour: '2026-08-25T09:00:00', count: 12 }],
    active_alerts: [
      { id: 'wo1', work_order_number: 'WO-1', part_name: 'Weldment', department: 'Welding', status: 'overdue', scheduled_end: '2026-09-01T10:00:00Z', completion_pct: 20 },
      { id: 'wo9', work_order_number: 'WO-9', part_name: 'Painted Frame', department: 'Paint', status: 'behind', scheduled_end: '2026-09-01T12:00:00Z', completion_pct: 0 },
    ],
    recent_completions: [
      { id: 'c1', app_name: 'Weld Check', operator_name: 'Ana', department: 'Welding', activity_at: '2026-08-25T09:30:00Z', completed_at: '2026-08-25T09:30:00Z', is_complete: true, duration_seconds: 840, status: 'completed' },
      { id: 'c2', app_name: 'Paint Check', operator_name: 'Cleo', department: 'Paint', activity_at: '2026-08-25T09:40:00Z', completed_at: '2026-08-25T09:40:00Z', is_complete: true, duration_seconds: 1320, status: 'completed' },
    ],
  },
  weld: {
    scope: { site_id: null, department_id: 'd-weld', app_id: null },
    hourly_throughput: [{ hour: '2026-08-25T09:00:00', count: 7 }],
    active_alerts: [
      { id: 'wo1', work_order_number: 'WO-1', part_name: 'Weldment', department: 'Welding', status: 'overdue', scheduled_end: '2026-09-01T10:00:00Z', completion_pct: 20 },
    ],
    recent_completions: [
      { id: 'c1', app_name: 'Weld Check', operator_name: 'Ana', department: 'Welding', activity_at: '2026-08-25T09:30:00Z', completed_at: '2026-08-25T09:30:00Z', is_complete: true, duration_seconds: 840, status: 'completed' },
    ],
  },
  empty: {
    scope: { site_id: null, department_id: 'd-paint', app_id: null },
    hourly_throughput: [],
    active_alerts: [],
    recent_completions: [],
  },
};

/** Which fixture a given scope should produce — the stand-in for the server. */
function pick(scope: { department_id?: string; app_id?: string } | undefined) {
  if (scope?.department_id === 'd-weld' || scope?.app_id === 'a-weld') return 'weld';
  if (scope?.department_id === 'd-paint' || scope?.app_id === 'a-paint') return 'empty';
  return 'all';
}

function renderPage(entry = '/dashboard') {
  return render(<MemoryRouter initialEntries={[entry]}><Dashboard /></MemoryRouter>);
}

const STORAGE_KEY = 'hm_command_center_filters_u-1';

// recharts calls `new ResizeObserver(...)`, and the shared setup's arrow-function
// stub is not constructible. A real class keeps the charts (and therefore the
// whole page) mounting.
class TestResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

beforeEach(() => {
  vi.clearAllMocks();
  (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = TestResizeObserver;
  localStorage.clear();
  getDepartments.mockResolvedValue(DEPARTMENTS);
  getApps.mockResolvedValue(APPS);
  getCompanySettings.mockResolvedValue({ company_name: 'Command Co' });
  getDailyBrief.mockImplementation(async (f?: any) => BRIEF[pick(f) as keyof typeof BRIEF]);
  getPlantView.mockImplementation(async (f?: any) => PLANT[pick(f) as keyof typeof PLANT]);
  getFloorSnapshot.mockImplementation(async (f?: any) => SNAPSHOT[pick(f) as keyof typeof SNAPSHOT]);
  getFloorDepartments.mockResolvedValue(FLOOR_DEPARTMENTS);
});

/** The picker's Department select, once the option list has arrived. */
const deptSelect = async () => await screen.findByLabelText('Department') as HTMLSelectElement;

describe('the plant is on screen before anything is chosen', () => {
  it('shows every tile, the runs, the chart and the due list with nothing selected', async () => {
    renderPage();

    // The five tiles, plant-wide.
    expect(await screen.findByTestId('kpi-finished-today')).toHaveTextContent('12');
    expect(screen.getByTestId('kpi-running-now')).toHaveTextContent('4');
    expect(screen.getByTestId('kpi-avg-cycle')).toHaveTextContent('18m');
    expect(screen.getByTestId('kpi-pass-rate')).toHaveTextContent('96%');
    expect(screen.getByTestId('kpi-on-track')).toHaveTextContent('6 of 8 open work orders on track');

    // …and the three sections that used to be hidden behind the same gate.
    expect(screen.getByText('Latest runs')).toBeInTheDocument();
    expect(screen.getByText('Output')).toBeInTheDocument();
    expect(screen.getByText('Due in the next 48 hours')).toBeInTheDocument();

    // The heading says what is being read, and it is the plant.
    expect(screen.getByRole('heading', { name: 'The whole plant' })).toBeInTheDocument();
  });

  it('offers department and app, and no site select (the site switcher owns that)', async () => {
    renderPage();
    const dept = await deptSelect();
    expect(screen.getByLabelText('App')).toBeInTheDocument();
    expect(screen.queryByLabelText('Site')).not.toBeInTheDocument();

    // The empty option is "all", because that is what the page is showing.
    expect([...dept.options].map(o => o.text)).toEqual(['All departments', 'Welding', 'Paint']);
  });

  it('makes each department card the door to that department', async () => {
    renderPage();

    await screen.findByTestId('kpi-finished-today');
    const card = await waitFor(() => {
      const el = document.querySelector('a[href="/departments/d-weld"]');
      if (!el) throw new Error('no card links to the department yet');
      return el as HTMLElement;
    });
    // Carrying that department's own figures, from the same endpoint its page
    // and its wall board read.
    expect(card).toHaveTextContent('7');
    expect(card).toHaveTextContent('14m');
    expect(card).toHaveTextContent('2 of 4 open work orders on track');
  });

  it('tells a company with no departments how to make one, and still shows the plant', async () => {
    getDepartments.mockResolvedValue([]);
    getFloorDepartments.mockResolvedValue({ ...FLOOR_DEPARTMENTS, departments: [] });
    renderPage();

    expect(await screen.findByText('No departments yet')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /create a department/i })).toHaveAttribute('href', '/settings?tab=sites');
    // The numbers are not held hostage by the empty directory.
    expect(screen.getByTestId('kpi-finished-today')).toHaveTextContent('12');
    expect(screen.getByText('Needs Attention')).toBeInTheDocument();
  });

  it('does not make a one-department shop choose from a list of one', async () => {
    getDepartments.mockResolvedValue([{ id: 'd-weld', name: 'Welding' }]);
    renderPage();

    await waitFor(() => expect(getFloorSnapshot).toHaveBeenCalled());
    // No department select at all, and the plant (which is that department plus
    // whatever ran outside it) is on screen unscoped.
    expect(screen.queryByLabelText('Department')).not.toBeInTheDocument();
    expect(getFloorSnapshot).toHaveBeenLastCalledWith({ site_id: undefined });
  });
});

describe('where things sit on the page', () => {
  /** Where a node sits in document order. */
  const positionOf = (el: Element) => [...document.querySelectorAll('*')].indexOf(el);

  it('pins Needs Attention above the scope controls, and those above the plant', async () => {
    renderPage();
    await screen.findByTestId('kpi-finished-today');

    const attention = screen.getByText('Needs Attention');
    const picker = screen.getByTestId('department-picker');
    const tiles = screen.getByTestId('kpi-finished-today');
    const cards = screen.getByRole('heading', { name: 'Departments' });

    expect(positionOf(attention)).toBeLessThan(positionOf(picker));
    expect(positionOf(picker)).toBeLessThan(positionOf(tiles));
    expect(positionOf(tiles)).toBeLessThan(positionOf(cards));
  });

  it('keeps the department and app selects on one row, side by side', async () => {
    renderPage();
    await deptSelect();

    // One flex row holding both, in that order — not two stacked controls, and
    // not the app filter marooned somewhere else on the page.
    const row = screen.getByTestId('scope-selects');
    const selects = [...row.querySelectorAll('select')].map(el => el.getAttribute('aria-label'));
    expect(selects).toEqual(['Department', 'App']);
    expect(row.className).toContain('flex');
    expect(row.className).not.toContain('flex-wrap');
  });
});

describe('the scope reaches every number on the page', () => {
  it('sends the department to EVERY data source — no section is left plant-wide', async () => {
    renderPage();
    await deptSelect();
    await waitFor(() => expect(getFloorSnapshot).toHaveBeenCalled());

    // Opening scope: no filter on the wire at all.
    expect(getDailyBrief).toHaveBeenLastCalledWith({});
    expect(getFloorSnapshot).toHaveBeenLastCalledWith({ site_id: undefined });
    expect(getPlantView).toHaveBeenLastCalledWith({ site_id: undefined });

    fireEvent.change(await deptSelect(), { target: { value: 'd-weld' } });

    await waitFor(() => {
      expect(getDailyBrief).toHaveBeenLastCalledWith({ department_id: 'd-weld' });
      expect(getFloorSnapshot).toHaveBeenLastCalledWith(expect.objectContaining({ department_id: 'd-weld' }));
      expect(getPlantView).toHaveBeenLastCalledWith(expect.objectContaining({ department_id: 'd-weld' }));
    });
  });

  it('moves every tile to the chosen department, and names it in the heading', async () => {
    renderPage();
    await screen.findByTestId('kpi-finished-today');
    const labelsBefore = ['kpi-finished-today', 'kpi-running-now', 'kpi-avg-cycle', 'kpi-pass-rate', 'kpi-on-track']
      .map(id => screen.getByTestId(id).textContent);

    fireEvent.change(await deptSelect(), { target: { value: 'd-weld' } });

    await waitFor(() => expect(screen.getByTestId('kpi-finished-today')).toHaveTextContent('7'));
    expect(screen.getByTestId('kpi-running-now')).toHaveTextContent('3');
    expect(screen.getByTestId('kpi-avg-cycle')).toHaveTextContent('14m');
    expect(screen.getByTestId('kpi-pass-rate')).toHaveTextContent('91%');
    expect(screen.getByTestId('kpi-on-track')).toHaveTextContent('2 of 4 open work orders on track');
    expect(screen.getByRole('heading', { name: 'Welding' })).toBeInTheDocument();

    // The plant-wide readings are GONE, not sitting next to the scoped ones.
    expect(screen.getByTestId('kpi-finished-today')).not.toHaveTextContent('12');
    expect(screen.getByTestId('kpi-pass-rate')).not.toHaveTextContent('96%');
    expect(screen.getByTestId('kpi-on-track')).not.toHaveTextContent('6 of 8');

    // And not one tile renamed itself on the way: same labels, new numbers.
    const labelOf = (text: string | null) => (text ?? '').replace(/[\d%]/g, '');
    const labelsAfter = ['kpi-finished-today', 'kpi-running-now', 'kpi-avg-cycle', 'kpi-pass-rate', 'kpi-on-track']
      .map(id => screen.getByTestId(id).textContent);
    for (const [i, label] of labelsBefore.entries()) {
      for (const word of ['Finished today', 'Running now', 'Average cycle time', 'Pass rate', 'Work orders on track']) {
        if (label?.includes(word)) expect(labelsAfter[i]).toContain(word);
      }
      void labelOf;
    }

    // The lists moved too: the Paint run is gone from Latest runs.
    expect(screen.getAllByText('Weld Check').length).toBeGreaterThan(0);
    expect(screen.queryByText(/WO-9 · Painted Frame/)).not.toBeInTheDocument();
  });

  it('clears back to the whole plant', async () => {
    renderPage();
    fireEvent.change(await deptSelect(), { target: { value: 'd-weld' } });
    await waitFor(() => expect(screen.getByTestId('kpi-finished-today')).toHaveTextContent('7'));

    fireEvent.change(await deptSelect(), { target: { value: '' } });

    await waitFor(() => expect(screen.getByTestId('kpi-finished-today')).toHaveTextContent('12'));
    expect(screen.getByRole('heading', { name: 'The whole plant' })).toBeInTheDocument();
  });

  it('says on screen which alerts the scope could not account for', async () => {
    renderPage();
    await deptSelect();
    await waitFor(() => expect(screen.getByText(/WO-9 · Painted Frame/)).toBeInTheDocument());
    expect(screen.queryByTestId('attention-plant-wide-note')).not.toBeInTheDocument();

    fireEvent.change(await deptSelect(), { target: { value: 'd-weld' } });

    const note = await screen.findByTestId('attention-plant-wide-note');
    expect(note).toHaveTextContent('2 plant-wide alerts');
    expect(note).toHaveTextContent('low stock, unrouted help requests');
    expect(note).toHaveTextContent('Welding');

    // And it offers the way back out.
    fireEvent.click(within(note).getByRole('button', { name: /show the whole plant/i }));
    await waitFor(() => expect(getDailyBrief).toHaveBeenLastCalledWith({}));
  });

  it('renders a dash with the payload’s own reason — never a 0 — for an empty department', async () => {
    renderPage();
    fireEvent.change(await deptSelect(), { target: { value: 'd-paint' } });

    await waitFor(() =>
      expect(screen.getByTestId('kpi-avg-cycle')).toHaveTextContent('no run has finished yet in Paint'));
    expect(screen.getByTestId('kpi-pass-rate')).toHaveTextContent('no pass/fail result recorded yet in Paint');
    expect(screen.getByTestId('kpi-on-track')).toHaveTextContent('no open work order to be on track with in Paint');
    // A count of zero is a measurement and stays a zero; the RATES are dashes.
    expect(screen.getByTestId('kpi-finished-today')).toHaveTextContent('0');
    expect(screen.getByTestId('kpi-avg-cycle')).toHaveTextContent('—');
    expect(screen.getByText('No runs recorded yet in Paint')).toBeInTheDocument();
    // An empty series makes recharts draw nothing at all, not even axes, which
    // reads as a broken card rather than a quiet day.
    expect(screen.getByText('No runs finished in the last 24 hours in Paint')).toBeInTheDocument();

    // An empty DEPARTMENT is not an empty company: the first-run CTA must not fire.
    expect(screen.queryByText(/build your first app/i)).not.toBeInTheDocument();
  });
});

describe('remembering the scope', () => {
  it('remembers it per user and opens there next time', async () => {
    const { unmount } = renderPage();
    fireEvent.change(await deptSelect(), { target: { value: 'd-weld' } });
    fireEvent.change(screen.getByLabelText('App'), { target: { value: 'a-weld' } });

    await waitFor(() =>
      expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!)).toEqual({ department_id: 'd-weld', app_id: 'a-weld' }));
    unmount();

    vi.clearAllMocks();
    getDepartments.mockResolvedValue(DEPARTMENTS);
    getApps.mockResolvedValue(APPS);
    getDailyBrief.mockImplementation(async (f?: any) => BRIEF[pick(f) as keyof typeof BRIEF]);
    getPlantView.mockImplementation(async (f?: any) => PLANT[pick(f) as keyof typeof PLANT]);
    getFloorSnapshot.mockImplementation(async (f?: any) => SNAPSHOT[pick(f) as keyof typeof SNAPSHOT]);
    getFloorDepartments.mockResolvedValue(FLOOR_DEPARTMENTS);

    renderPage();
    // The very first request already carries the remembered scope — the page
    // never flashes plant-wide numbers it is about to replace.
    await waitFor(() =>
      expect(getDailyBrief).toHaveBeenCalledWith({ department_id: 'd-weld', app_id: 'a-weld' }));
    expect(getDailyBrief).not.toHaveBeenCalledWith({});
    expect((await deptSelect()).value).toBe('d-weld');

    // Going back to all departments, then all apps, forgets it rather than
    // storing an empty object.
    fireEvent.change(await deptSelect(), { target: { value: '' } });
    fireEvent.change(screen.getByLabelText('App'), { target: { value: '' } });
    await waitFor(() => expect(localStorage.getItem(STORAGE_KEY)).toBeNull());
  });

  it('drops a remembered department the current site no longer offers', async () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ department_id: 'd-gone' }));
    renderPage();
    await deptSelect();

    // Otherwise every tile would scope to a department that isn't there and the
    // whole plant would look idle.
    await waitFor(() => expect(localStorage.getItem(STORAGE_KEY)).toBeNull());
    await waitFor(() => expect(getDailyBrief).toHaveBeenLastCalledWith({}));
    expect((await deptSelect()).value).toBe('');
  });
});

describe('what a run row is allowed to claim', () => {
  it('will not print 0s for a run the payload cannot resolve', async () => {
    // The server derives duration_seconds from a figure rounded to a tenth of a
    // minute, so a run under three seconds arrives as 0. No run takes no time.
    getPlantView.mockImplementation(async () => ({
      ...PLANT.weld,
      recent_completions: [
        { id: 'c-fast', app_name: 'Scan Check', operator_name: 'Ana', department: 'Welding', activity_at: '2026-08-25T09:30:00Z', completed_at: '2026-08-25T09:30:00Z', is_complete: true, duration_seconds: 0, duration_basis: 'elapsed', elapsed_so_far_seconds: null, status: 'completed' },
        ...PLANT.weld.recent_completions,
      ],
    }));
    renderPage();

    const row = (await screen.findByText('Scan Check')).closest('tr')!;
    expect(row.textContent).not.toContain('0s');
    expect(within(row).getByText('—')).toBeInTheDocument();
  });

  it('reports nothing at all for an abandoned run', async () => {
    // An abandoned run is never stamped finished, so the elapsed figure the
    // server reports for it keeps growing. "4h so far · running" on a job
    // somebody walked away from yesterday is an invented number.
    getPlantView.mockImplementation(async () => ({
      ...PLANT.weld,
      recent_completions: [
        { id: 'c-gone', app_name: 'Weld Check', operator_name: 'Ana', department: 'Welding', activity_at: '2026-08-25T09:30:00Z', started_at: '2026-08-25T05:30:00Z', completed_at: null, is_complete: false, duration_seconds: null, elapsed_so_far_seconds: 14400, status: 'abandoned' },
      ],
    }));
    renderPage();

    const row = (await screen.findByText('abandoned')).closest('tr')!;
    expect(row.textContent).not.toContain('4h');
    expect(row.textContent).not.toContain('so far');
    expect(within(row).getByText('—')).toBeInTheDocument();
  });

  it('counts an open run up live, labelled as elapsed rather than as a cycle time', async () => {
    // The live elapsed is the one thing the retired third floor screen did that
    // nothing else did; it lives here now.
    const startedAt = new Date(Date.now() - 180_000).toISOString().slice(0, 19).replace('T', ' ');
    getPlantView.mockImplementation(async () => ({
      ...PLANT.weld,
      recent_completions: [
        { id: 'c-live', app_name: 'Weld Check', operator_name: 'Ana', department: 'Welding', activity_at: '2026-08-25T09:20:00Z', started_at: startedAt, completed_at: null, is_complete: false, duration_seconds: null, elapsed_so_far_seconds: 180, status: 'in_progress' },
      ],
    }));
    renderPage();

    // "3m" unqualified would fold a job that has not finished into the reader's
    // sense of what a cycle costs.
    expect(await screen.findByText(/^3m( \d+s)? so far$/)).toBeInTheDocument();
    expect(screen.getByText('running')).toBeInTheDocument();
  });
});

// ─── Arriving from the player ────────────────────────────────────────────────
// The run-complete screen links to /dashboard?department_id=…&app_id=…, and the
// operator has to land on the plant narrowed to the run they just finished.

describe('the hand-off from a finished run', () => {
  it('opens the view the run belongs to, with the run on it', async () => {
    renderPage('/dashboard?department_id=d-weld&app_id=a-weld');

    await waitFor(() =>
      expect(getFloorSnapshot).toHaveBeenLastCalledWith(expect.objectContaining({ department_id: 'd-weld', app_id: 'a-weld' })));
    expect((await deptSelect()).value).toBe('d-weld');
    expect((screen.getByLabelText('App') as HTMLSelectElement).value).toBe('a-weld');

    // The run itself — app, operator and what it took — is on screen.
    expect((await screen.findAllByText('Weld Check')).length).toBeGreaterThan(0);
    expect(screen.getByText('Ana')).toBeInTheDocument();
    expect(screen.getAllByText('14m').length).toBeGreaterThan(0);
  });

  it("does not rewrite what this person's Command Center remembers", async () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ department_id: 'd-paint' }));
    renderPage('/dashboard?department_id=d-weld');

    await waitFor(() => expect((screen.getByLabelText('Department') as HTMLSelectElement).value).toBe('d-weld'));
    // A link opens a view; it does not become the scope they come back to.
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!)).toEqual({ department_id: 'd-paint' });
  });

  it('stops applying the moment the user picks a department by hand', async () => {
    renderPage('/dashboard?department_id=d-weld');
    await waitFor(() => expect((screen.getByLabelText('Department') as HTMLSelectElement).value).toBe('d-weld'));

    fireEvent.change(await deptSelect(), { target: { value: 'd-paint' } });

    await waitFor(() => expect(getDailyBrief).toHaveBeenLastCalledWith({ department_id: 'd-paint' }));
    expect((await deptSelect()).value).toBe('d-paint');
  });

  it('falls back to the whole plant when the id means nothing here', async () => {
    // Deleted, or another tenant's, or a department at a site this user is not
    // looking at. Scoping to it would empty every tile and read as a dead plant.
    renderPage('/dashboard?department_id=d-gone&app_id=a-gone');

    await waitFor(() => expect(getDailyBrief).toHaveBeenLastCalledWith({}));
    expect((await deptSelect()).value).toBe('');
    expect(screen.getByRole('heading', { name: 'The whole plant' })).toBeInTheDocument();
  });
});

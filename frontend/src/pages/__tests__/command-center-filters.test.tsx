import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

// ─── The Command Center is a department board ─────────────────────────────────
// The page asks one question first — which department are you running? — and
// then answers it. So these tests cover two things.
//
// The layout contract: Needs Attention sits above everything, nothing is chosen
// until you choose it (except in a one-department shop, where picking from a
// list of one is an insult), and the department board only exists once a
// department does.
//
// And the scope contract, which this product has broken twice: a filter that
// narrows ONE card while the headline tiles keep showing plant-wide totals,
// which a manager reads as "that is my department's number". Picking a
// department must re-fetch BOTH data sources and move every section with it.

const getDailyBrief = vi.fn();
const getPlantView = vi.fn();
const getCompanySettings = vi.fn();
const getDepartments = vi.fn();
const getApps = vi.fn();
const loadSampleData = vi.fn();
const acknowledgeAndonCall = vi.fn();
const resolveAndonCall = vi.fn();

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

/** Every number the page renders, keyed by the scope that produced it. */
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
    kpis: {
      completed_today: 12, vs_7day_avg_pct: 20, active_now: 4, pass_rate_7d: 96,
      schedule_adherence: 75, work_orders_on_track: 6, work_orders_total: 8,
    },
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
    kpis: {
      completed_today: 7, vs_7day_avg_pct: 5, active_now: 3, pass_rate_7d: 91,
      schedule_adherence: 50, work_orders_on_track: 2, work_orders_total: 4,
    },
    due_soon: [
      { id: 'wo1', work_order_number: 'WO-1', part_name: 'Weldment', department_name: 'Welding', quantity: 10, quantity_completed: 2, completion_pct: 20, scheduled_end: '2026-09-01T10:00:00Z', priority: 'high', schedule_status: 'overdue' },
    ],
    throughput_7d: [{ date: '2026-08-25', count: 7 }],
    week_avg_per_day: 5.5,
    is_pro: true,
  },
  // A real department that nothing has run through — every metric that cannot
  // be computed must arrive as null so the page can print '—' with a reason.
  empty: {
    scope: { department_id: 'd-paint', app_id: null },
    attention: [],
    attention_plant_wide_hidden: 3,
    attention_plant_wide_kinds: ['low stock'],
    kpis: {
      completed_today: 0, vs_7day_avg_pct: null, active_now: 0, pass_rate_7d: null,
      schedule_adherence: null, work_orders_on_track: 0, work_orders_total: 0,
    },
    due_soon: [],
    throughput_7d: [{ date: '2026-08-25', count: 0 }],
    week_avg_per_day: 0,
    is_pro: true,
  },
};

const PLANT = {
  all: {
    scope: { site_id: null, department_id: null, app_id: null },
    kpis: {
      total_completed_today: 12, active_now: 4, pass_rate: 96,
      avg_cycle_time: 18, avg_cycle_seconds: 1080,
      schedule_adherence: 75, work_orders_on_track: 6, work_orders_total: 8,
    },
    department_performance: [
      { id: 'd-weld', department: 'Welding', color: '#f59e0b', completion_count: 7, avg_cycle_time: 14, avg_cycle_seconds: 840, takt_time: 12, on_track_count: 2, total_count: 4, status: 'at_risk' },
      { id: 'd-paint', department: 'Paint', color: '#3b82f6', completion_count: 5, avg_cycle_time: 22, avg_cycle_seconds: 1320, takt_time: 20, on_track_count: 4, total_count: 4, status: 'on_track' },
    ],
    hourly_throughput: [{ hour: '2026-08-25T09:00:00', count: 12 }],
    work_order_summary: { on_track: 6, at_risk: 1, behind: 1, not_started: 0 },
    active_alerts: [
      { id: 'wo1', work_order_number: 'WO-1', part_name: 'Weldment', department: 'Welding', status: 'overdue', scheduled_end: '2026-09-01T10:00:00Z', completion_pct: 20 },
      { id: 'wo9', work_order_number: 'WO-9', part_name: 'Painted Frame', department: 'Paint', status: 'behind', scheduled_end: '2026-09-01T12:00:00Z', completion_pct: 0 },
    ],
    recent_completions: [
      { id: 'c1', app_name: 'Weld Check', operator_name: 'Ana', department: 'Welding', completed_at: '2026-08-25T09:30:00Z', duration_minutes: 14, duration_seconds: 840, status: 'completed' },
      { id: 'c2', app_name: 'Paint Check', operator_name: 'Cleo', department: 'Paint', completed_at: '2026-08-25T09:40:00Z', duration_minutes: 22, duration_seconds: 1320, status: 'completed' },
    ],
  },
  weld: {
    scope: { site_id: null, department_id: 'd-weld', app_id: null },
    kpis: {
      total_completed_today: 7, active_now: 3, pass_rate: 91,
      avg_cycle_time: 14, avg_cycle_seconds: 840,
      schedule_adherence: 50, work_orders_on_track: 2, work_orders_total: 4,
    },
    department_performance: [
      { id: 'd-weld', department: 'Welding', color: '#f59e0b', completion_count: 7, avg_cycle_time: 14, avg_cycle_seconds: 840, takt_time: 12, on_track_count: 2, total_count: 4, status: 'at_risk' },
    ],
    hourly_throughput: [{ hour: '2026-08-25T09:00:00', count: 7 }],
    work_order_summary: { on_track: 2, at_risk: 1, behind: 1, not_started: 0 },
    active_alerts: [
      { id: 'wo1', work_order_number: 'WO-1', part_name: 'Weldment', department: 'Welding', status: 'overdue', scheduled_end: '2026-09-01T10:00:00Z', completion_pct: 20 },
    ],
    recent_completions: [
      { id: 'c1', app_name: 'Weld Check', operator_name: 'Ana', department: 'Welding', completed_at: '2026-08-25T09:30:00Z', duration_minutes: 14, duration_seconds: 840, status: 'completed' },
    ],
  },
  empty: {
    scope: { site_id: null, department_id: 'd-paint', app_id: null },
    kpis: {
      total_completed_today: 0, active_now: 0, pass_rate: null,
      avg_cycle_time: null, avg_cycle_seconds: null,
      schedule_adherence: null, work_orders_on_track: 0, work_orders_total: 0,
    },
    department_performance: [
      { id: 'd-paint', department: 'Paint', color: '#3b82f6', completion_count: 0, avg_cycle_time: 0, avg_cycle_seconds: null, takt_time: 0, on_track_count: 0, total_count: 0, status: 'idle' },
    ],
    hourly_throughput: [],
    work_order_summary: { on_track: 0, at_risk: 0, behind: 0, not_started: 0 },
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
});

/** The picker's Department select, once the option list has arrived. */
const deptSelect = async () => await screen.findByLabelText('Department') as HTMLSelectElement;

describe('picking a department', () => {
  it('offers department and app, and no site select (the site switcher owns that)', async () => {
    renderPage();
    const dept = await deptSelect();
    expect(screen.getByLabelText('App')).toBeInTheDocument();
    expect(screen.queryByLabelText('Site')).not.toBeInTheDocument();

    // Nothing is chosen yet, and the empty option says so rather than implying
    // the page is already showing everything.
    expect([...dept.options].map(o => o.text)).toEqual(['Pick a department', 'Welding', 'Paint']);
  });

  it('shows the departments as the way in, and no department board, until one is picked', async () => {
    renderPage();
    await deptSelect();

    // The chooser: one card per department, each carrying the two numbers the
    // product exists to produce.
    expect(await screen.findByRole('heading', { name: 'Pick a department' })).toBeInTheDocument();
    expect(screen.getByText('14m')).toBeInTheDocument();   // Welding average cycle
    expect(screen.getByText('22m')).toBeInTheDocument();   // Paint average cycle
    expect(screen.getByText(/2 departments · 12 finished today · 4 running now · 18m average cycle/)).toBeInTheDocument();

    // …and none of the department board.
    expect(screen.queryByText('Latest runs')).not.toBeInTheDocument();
    expect(screen.queryByText('Average cycle time')).not.toBeInTheDocument();
    expect(screen.queryByText('Due in the next 48 hours')).not.toBeInTheDocument();

    // Needs Attention is the exception: it is above the choice, because it is
    // the one thing that should change somebody's plan whatever they run.
    expect(screen.getByText('Needs Attention')).toBeInTheDocument();
    expect(screen.getByText(/WO-9 · Painted Frame/)).toBeInTheDocument();
  });

  it('opens the board when a card is clicked, not just when the dropdown changes', async () => {
    renderPage();
    await deptSelect();
    await screen.findByRole('heading', { name: 'Pick a department' });

    // The card, not the dropdown option that shares its name.
    fireEvent.click(screen.getByRole('button', { name: /Welding/ }));

    await waitFor(() => expect(getPlantView).toHaveBeenLastCalledWith(expect.objectContaining({ department_id: 'd-weld' })));
    expect(await screen.findByText('Latest runs')).toBeInTheDocument();
  });

  it('never asks a one-department shop to choose from a list of one', async () => {
    getDepartments.mockResolvedValue([{ id: 'd-weld', name: 'Welding' }]);
    renderPage();

    // The board loads straight away, scoped, and there is no picker at all.
    await waitFor(() => expect(getDailyBrief).toHaveBeenLastCalledWith({ department_id: 'd-weld' }));
    expect(await screen.findByText('Latest runs')).toBeInTheDocument();
    expect(screen.queryByTestId('department-picker')).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Pick a department' })).not.toBeInTheDocument();
  });

  it('tells a company with no departments how to make one', async () => {
    getDepartments.mockResolvedValue([]);
    getPlantView.mockResolvedValue({ ...PLANT.all, department_performance: [], recent_completions: [] });
    renderPage();

    expect(await screen.findByText('No departments yet')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /create a department/i })).toHaveAttribute('href', '/settings?tab=sites');
    // Deliberate, not broken: the attention list is still there and still true.
    expect(screen.getByText('Needs Attention')).toBeInTheDocument();
  });
});

describe('where things sit on the page', () => {
  /** Where a node sits in document order. */
  const positionOf = (el: Element) => [...document.querySelectorAll('*')].indexOf(el);

  it('pins Needs Attention above the scope controls and the board', async () => {
    renderPage();
    fireEvent.change(await deptSelect(), { target: { value: 'd-weld' } });
    await screen.findByText('Latest runs');

    const attention = screen.getByText('Needs Attention');
    const picker = screen.getByTestId('department-picker');
    const board = screen.getByText('Latest runs');

    expect(positionOf(attention)).toBeLessThan(positionOf(picker));
    expect(positionOf(picker)).toBeLessThan(positionOf(board));
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
  it('sends the department to BOTH data sources — no section is left plant-wide', async () => {
    renderPage();
    await deptSelect();
    await waitFor(() => expect(getDailyBrief).toHaveBeenCalled());

    // Opening scope: no filter on the wire at all.
    expect(getDailyBrief).toHaveBeenLastCalledWith({});
    expect(getPlantView.mock.calls[getPlantView.mock.calls.length - 1][0]).toEqual({ site_id: undefined });

    fireEvent.change(await deptSelect(), { target: { value: 'd-weld' } });

    await waitFor(() => {
      expect(getDailyBrief).toHaveBeenLastCalledWith({ department_id: 'd-weld' });
      expect(getPlantView).toHaveBeenLastCalledWith(expect.objectContaining({ department_id: 'd-weld' }));
    });
  });

  it('every section of the board shows the chosen department, and only it', async () => {
    renderPage();
    fireEvent.change(await deptSelect(), { target: { value: 'd-weld' } });

    // Tiles — including the cycle time, which comes from the plant view while
    // the other three come from the brief. Both have to have moved.
    expect(await screen.findByText('7')).toBeInTheDocument();    // finished today
    expect(screen.getByText('3')).toBeInTheDocument();           // running now
    expect(screen.getByText('91%')).toBeInTheDocument();         // pass rate
    // 14m twice on purpose: the average, and the one run it averages.
    expect(screen.getAllByText('14m')).toHaveLength(2);
    expect(screen.getByText('2 of 4 open work orders on track in Welding')).toBeInTheDocument();
    expect(screen.getByText('1 behind or overdue')).toBeInTheDocument();

    // Lists: the Welding run is there (row + app dropdown option), the Paint
    // run is gone and only its dropdown option is left.
    expect(screen.getAllByText('Weld Check')).toHaveLength(2);
    expect(screen.getAllByText('Paint Check')).toHaveLength(1);
    expect(screen.queryByText(/WO-9 · Painted Frame/)).not.toBeInTheDocument();
    expect(screen.queryAllByText('WO-9')).toHaveLength(0);

    // And the plant-wide figures are GONE, not sitting next to the scoped ones.
    expect(screen.queryByText('12')).not.toBeInTheDocument();
    expect(screen.queryByText('96%')).not.toBeInTheDocument();
    expect(screen.queryByText('18m')).not.toBeInTheDocument();
    expect(screen.queryByText('6 of 8 open work orders on track')).not.toBeInTheDocument();

    // Only the dropdown option that lets you switch to Paint survives.
    expect(screen.getAllByText('Paint')).toHaveLength(1);
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

  it('renders a dash with a reason — never a 0 — for a department with nothing in it', async () => {
    renderPage();
    fireEvent.change(await deptSelect(), { target: { value: 'd-paint' } });

    await waitFor(() => expect(screen.getByText('no completed runs in Paint')).toBeInTheDocument());
    expect(screen.getByText('No QC results recorded in Paint')).toBeInTheDocument();
    expect(screen.getByText('No open work orders in Paint')).toBeInTheDocument();
    expect(screen.getByText('No runs recorded yet in Paint')).toBeInTheDocument();
    // An empty series makes recharts draw nothing at all, not even axes, which
    // reads as a broken card rather than a quiet day.
    expect(screen.getByText('No runs finished in the last 24 hours in Paint')).toBeInTheDocument();
    expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(2);

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

    // Otherwise every card would scope to a department that isn't there and the
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
    getPlantView.mockImplementation(async (f?: any) => ({
      ...PLANT.weld,
      recent_completions: [
        { id: 'c-fast', app_name: 'Scan Check', operator_name: 'Ana', department: 'Welding', activity_at: '2026-08-25T09:30:00Z', completed_at: '2026-08-25T09:30:00Z', is_complete: true, duration_seconds: 0, duration_basis: 'elapsed', elapsed_so_far_seconds: null, status: 'completed' },
        ...PLANT.weld.recent_completions,
      ],
      scope: { ...PLANT.weld.scope, department_id: f?.department_id ?? null },
    }));
    renderPage();
    fireEvent.change(await deptSelect(), { target: { value: 'd-weld' } });

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
        // The newer payload keeps the elapsed-so-far out of duration_seconds;
        // an abandoned run must not borrow it as a cycle time either.
        { id: 'c-gone', app_name: 'Weld Check', operator_name: 'Ana', department: 'Welding', activity_at: '2026-08-25T09:30:00Z', completed_at: null, is_complete: false, duration_seconds: null, elapsed_so_far_seconds: 14400, status: 'abandoned' },
      ],
    }));
    renderPage();
    fireEvent.change(await deptSelect(), { target: { value: 'd-weld' } });

    const row = (await screen.findByText('abandoned')).closest('tr')!;
    expect(row.textContent).not.toContain('4h');
    expect(row.textContent).not.toContain('so far');
    expect(within(row).getByText('—')).toBeInTheDocument();
  });

  it('labels a run still on the bench as elapsed, not as a cycle time', async () => {
    getPlantView.mockImplementation(async () => ({
      ...PLANT.weld,
      recent_completions: [
        // duration_seconds is null while a run is open — the elapsed-so-far
        // lives in its own field and gets its own label.
        { id: 'c-live', app_name: 'Weld Check', operator_name: 'Ana', department: 'Welding', activity_at: '2026-08-25T09:20:00Z', completed_at: null, is_complete: false, duration_seconds: null, elapsed_so_far_seconds: 180, status: 'in_progress' },
      ],
    }));
    renderPage();
    fireEvent.change(await deptSelect(), { target: { value: 'd-weld' } });

    // "3m" unqualified would fold a job that has not finished into the reader's
    // sense of what a cycle costs.
    expect(await screen.findByText('3m so far')).toBeInTheDocument();
    expect(screen.getByText('running')).toBeInTheDocument();
  });
});

// ─── Arriving from the player ────────────────────────────────────────────────
// The run-complete screen links to /dashboard?department_id=…&app_id=…, and the
// operator has to land on the board holding the run they just finished.

describe('the hand-off from a finished run', () => {
  it('opens the board the run belongs to, with the run on it', async () => {
    renderPage('/dashboard?department_id=d-weld&app_id=a-weld');

    await waitFor(() =>
      expect(getPlantView).toHaveBeenLastCalledWith(expect.objectContaining({ department_id: 'd-weld', app_id: 'a-weld' })));
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

  it('falls back silently when the id means nothing here', async () => {
    // Deleted, or another tenant's, or a department at a site this user is not
    // looking at. Scoping to it would empty every card and read as a dead plant.
    renderPage('/dashboard?department_id=d-gone&app_id=a-gone');

    await waitFor(() => expect(getDailyBrief).toHaveBeenLastCalledWith({}));
    expect((await deptSelect()).value).toBe('');
    expect(await screen.findByRole('heading', { name: 'Pick a department' })).toBeInTheDocument();
  });
});

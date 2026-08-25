import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

// ─── Command Center page scope ────────────────────────────────────────────────
// The Command Center carries the same department / app filter bar as the
// workspace Reports pages. What these tests lock down is the failure this
// product has shipped twice: a filter that narrows ONE card while the headline
// tiles keep showing plant-wide totals, which a manager reads as "that is my
// department's number".
//
// So they check that picking a department re-fetches BOTH data sources with it,
// and that every section on the page moves: the KPI tiles, Needs Attention,
// Due in 48 Hours, the 7-day output average, the floor KPI strip, department
// cards and recent completions.

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
      total_completed_today: 12, active_now: 4, pass_rate: 96, avg_cycle_time: 18,
      schedule_adherence: 75, work_orders_on_track: 6, work_orders_total: 8,
    },
    department_performance: [
      { id: 'd-weld', department: 'Welding', color: '#f59e0b', completion_count: 7, avg_cycle_time: 14, takt_time: 12, on_track_count: 2, total_count: 4, status: 'at_risk' },
      { id: 'd-paint', department: 'Paint', color: '#3b82f6', completion_count: 5, avg_cycle_time: 22, takt_time: 20, on_track_count: 4, total_count: 4, status: 'on_track' },
    ],
    hourly_throughput: [{ hour: '2026-08-25T09:00:00', count: 12 }],
    work_order_summary: { on_track: 6, at_risk: 1, behind: 1, not_started: 0 },
    active_alerts: [
      { id: 'wo1', work_order_number: 'WO-1', part_name: 'Weldment', department: 'Welding', status: 'overdue', scheduled_end: '2026-09-01T10:00:00Z', completion_pct: 20 },
      { id: 'wo9', work_order_number: 'WO-9', part_name: 'Painted Frame', department: 'Paint', status: 'behind', scheduled_end: '2026-09-01T12:00:00Z', completion_pct: 0 },
    ],
    recent_completions: [
      { id: 'c1', app_name: 'Weld Check', operator_name: 'Ana', department: 'Welding', completed_at: '2026-08-25T09:30:00Z', duration_minutes: 14, status: 'completed' },
      { id: 'c2', app_name: 'Paint Check', operator_name: 'Cleo', department: 'Paint', completed_at: '2026-08-25T09:40:00Z', duration_minutes: 22, status: 'completed' },
    ],
  },
  weld: {
    scope: { site_id: null, department_id: 'd-weld', app_id: null },
    kpis: {
      total_completed_today: 7, active_now: 3, pass_rate: 91, avg_cycle_time: 14,
      schedule_adherence: 50, work_orders_on_track: 2, work_orders_total: 4,
    },
    department_performance: [
      { id: 'd-weld', department: 'Welding', color: '#f59e0b', completion_count: 7, avg_cycle_time: 14, takt_time: 12, on_track_count: 2, total_count: 4, status: 'at_risk' },
    ],
    hourly_throughput: [{ hour: '2026-08-25T09:00:00', count: 7 }],
    work_order_summary: { on_track: 2, at_risk: 1, behind: 1, not_started: 0 },
    active_alerts: [
      { id: 'wo1', work_order_number: 'WO-1', part_name: 'Weldment', department: 'Welding', status: 'overdue', scheduled_end: '2026-09-01T10:00:00Z', completion_pct: 20 },
    ],
    recent_completions: [
      { id: 'c1', app_name: 'Weld Check', operator_name: 'Ana', department: 'Welding', completed_at: '2026-08-25T09:30:00Z', duration_minutes: 14, status: 'completed' },
    ],
  },
  empty: {
    scope: { site_id: null, department_id: 'd-paint', app_id: null },
    kpis: {
      total_completed_today: 0, active_now: 0, pass_rate: null, avg_cycle_time: null,
      schedule_adherence: null, work_orders_on_track: 0, work_orders_total: 0,
    },
    department_performance: [
      { id: 'd-paint', department: 'Paint', color: '#3b82f6', completion_count: 0, avg_cycle_time: 0, takt_time: 0, on_track_count: 0, total_count: 0, status: 'idle' },
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

function renderPage() {
  return render(<MemoryRouter><Dashboard /></MemoryRouter>);
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

describe('Command Center filter bar', () => {
  it('offers department and app, and no site select (the site switcher owns that)', async () => {
    renderPage();
    expect(await screen.findByLabelText('Department')).toBeInTheDocument();
    expect(screen.getByLabelText('App')).toBeInTheDocument();
    expect(screen.queryByLabelText('Site')).not.toBeInTheDocument();

    const dept = screen.getByLabelText('Department') as HTMLSelectElement;
    expect([...dept.options].map(o => o.text)).toEqual(['All departments', 'Welding', 'Paint']);
  });

  it('sends the department to BOTH data sources — no section is left plant-wide', async () => {
    renderPage();
    await screen.findByLabelText('Department');
    await waitFor(() => expect(getDailyBrief).toHaveBeenCalled());

    // Opening scope: no filter on the wire at all.
    expect(getDailyBrief).toHaveBeenLastCalledWith({});
    const lastPlantCall = getPlantView.mock.calls[getPlantView.mock.calls.length - 1][0];
    expect(lastPlantCall).toEqual({ site_id: undefined });

    fireEvent.change(screen.getByLabelText('Department'), { target: { value: 'd-weld' } });

    await waitFor(() => {
      expect(getDailyBrief).toHaveBeenLastCalledWith({ department_id: 'd-weld' });
      expect(getPlantView).toHaveBeenLastCalledWith(expect.objectContaining({ department_id: 'd-weld' }));
    });
  });

  it('every section on the page changes with the filter — tiles included', async () => {
    renderPage();
    await screen.findByLabelText('Department');

    // ── Plant-wide first.
    expect(await screen.findByText('12')).toBeInTheDocument();          // Completed Today
    expect(screen.getByText('75%')).toBeInTheDocument();                // Open WOs On Track
    expect(screen.getByText('96%')).toBeInTheDocument();                // Pass Rate
    expect(screen.getByText('6 of 8 open work orders')).toBeInTheDocument();
    expect(screen.getByText(/WO-9 · Painted Frame/)).toBeInTheDocument();   // Needs Attention
    expect(screen.getAllByText('WO-9').length).toBeGreaterThan(0);          // Due in 48 hours
    expect(screen.getByText('6/8')).toBeInTheDocument();                    // floor KPI strip
    // "Paint" beyond its own dropdown option: the department card and the
    // recent-completions row. "Paint Check": the app option and that same row.
    expect(screen.getAllByText('Paint')).toHaveLength(3);
    expect(screen.getAllByText('Paint Check')).toHaveLength(2);

    // ── Narrow to Welding.
    fireEvent.change(screen.getByLabelText('Department'), { target: { value: 'd-weld' } });

    await waitFor(() => expect(screen.getByText('7')).toBeInTheDocument());  // Completed Today
    expect(screen.getByText('50%')).toBeInTheDocument();                     // Open WOs On Track
    expect(screen.getByText('91%')).toBeInTheDocument();                     // Pass Rate
    expect(screen.getByText('2 of 4 open work orders in Welding')).toBeInTheDocument();
    expect(screen.getByText('2/4')).toBeInTheDocument();                     // floor KPI strip

    // The plant-wide figures are GONE, not sitting next to the scoped ones.
    expect(screen.queryByText('12')).not.toBeInTheDocument();
    expect(screen.queryByText('75%')).not.toBeInTheDocument();
    expect(screen.queryByText('96%')).not.toBeInTheDocument();
    expect(screen.queryByText('6/8')).not.toBeInTheDocument();

    // Lists too: no Paint work order, no Paint department card, no Paint run —
    // only the dropdown options that let you switch to them survive.
    expect(screen.queryByText(/WO-9 · Painted Frame/)).not.toBeInTheDocument();
    expect(screen.queryAllByText('WO-9')).toHaveLength(0);
    expect(screen.getAllByText('Paint')).toHaveLength(1);
    expect(screen.getAllByText('Paint Check')).toHaveLength(1);
    expect(screen.getAllByText('Welding').length).toBeGreaterThan(1);
  });

  it('says on screen which alerts the scope could not account for', async () => {
    renderPage();
    await screen.findByLabelText('Department');
    await waitFor(() => expect(screen.getByText(/WO-9 · Painted Frame/)).toBeInTheDocument());
    expect(screen.queryByTestId('attention-plant-wide-note')).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Department'), { target: { value: 'd-weld' } });

    const note = await screen.findByTestId('attention-plant-wide-note');
    expect(note).toHaveTextContent('2 plant-wide alerts');
    expect(note).toHaveTextContent('low stock, unrouted help requests');
    expect(note).toHaveTextContent('Welding');

    // And it offers the way back out.
    fireEvent.click(within(note).getByRole('button', { name: /show the whole plant/i }));
    await waitFor(() => expect(getDailyBrief).toHaveBeenLastCalledWith({}));
  });

  it('renders a dash with a reason — never a 0 — for a scope with nothing in it', async () => {
    renderPage();
    await screen.findByLabelText('Department');

    fireEvent.change(screen.getByLabelText('Department'), { target: { value: 'd-paint' } });

    await waitFor(() => expect(screen.getByText('No open work orders in Paint')).toBeInTheDocument());
    expect(screen.getByText('No QC results recorded in Paint')).toBeInTheDocument();
    expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(2);
    // The floor strip explains its own dashes rather than printing 0m / 0.
    expect(screen.getByText('no completed runs in Paint')).toBeInTheDocument();
    expect(screen.getByText('no open work orders in Paint')).toBeInTheDocument();
    expect(screen.getByText('No recent completions in Paint')).toBeInTheDocument();

    // An empty DEPARTMENT is not an empty company: the first-run CTA must not fire.
    expect(screen.queryByText(/build your first app/i)).not.toBeInTheDocument();
  });

  it('remembers the scope per user and opens there next time', async () => {
    const { unmount } = renderPage();
    await screen.findByLabelText('Department');

    fireEvent.change(screen.getByLabelText('Department'), { target: { value: 'd-weld' } });
    fireEvent.change(screen.getByLabelText('App'), { target: { value: 'a-weld' } });

    await waitFor(() =>
      expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!)).toEqual({ department_id: 'd-weld', app_id: 'a-weld' }));
    unmount();

    vi.clearAllMocks();
    getDepartments.mockResolvedValue(DEPARTMENTS);
    getApps.mockResolvedValue(APPS);
    getCompanySettings.mockResolvedValue({ company_name: 'Command Co' });
    getDailyBrief.mockImplementation(async (f?: any) => BRIEF[pick(f) as keyof typeof BRIEF]);
    getPlantView.mockImplementation(async (f?: any) => PLANT[pick(f) as keyof typeof PLANT]);

    renderPage();
    // The very first request already carries the remembered scope — the page
    // never flashes plant-wide numbers it is about to replace.
    await waitFor(() =>
      expect(getDailyBrief).toHaveBeenCalledWith({ department_id: 'd-weld', app_id: 'a-weld' }));
    expect(getDailyBrief).not.toHaveBeenCalledWith({});
    expect((await screen.findByLabelText('Department') as HTMLSelectElement).value).toBe('d-weld');

    // Clearing it forgets it rather than storing an empty object.
    fireEvent.click(screen.getByRole('button', { name: /clear/i }));
    await waitFor(() => expect(localStorage.getItem(STORAGE_KEY)).toBeNull());
  });

  it('drops a remembered department the current site no longer offers', async () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ department_id: 'd-gone' }));
    renderPage();
    await screen.findByLabelText('Department');

    // Otherwise every card would scope to a department that isn't there and the
    // whole plant would look idle.
    await waitFor(() => expect(localStorage.getItem(STORAGE_KEY)).toBeNull());
    await waitFor(() => expect(getDailyBrief).toHaveBeenLastCalledWith({}));
    expect((screen.getByLabelText('Department') as HTMLSelectElement).value).toBe('');
  });
});

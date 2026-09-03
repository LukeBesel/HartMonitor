import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

// ─── A filter the server would not honour is not an empty plant ───────────────
// /analytics/daily-brief answers a department, app or site id this company does
// not own with an explicitly EMPTY payload and `scope_valid: false` — it refuses
// to widen a bad filter back to plant-wide numbers.
//
// The zeros in that payload were never measured, and this page used to draw them
// anyway: a link forwarded from another tenant produced "Needs Attention: all
// good", an output chart flat on the axis and a due list saying nothing is due.
// Every one of those reads as a real, quiet plant.
//
// So the Command Center prints the reason in place of the numbers, and offers
// the way back.

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
const getWipSummary = vi.fn();
const getWip = vi.fn();

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
  getWipSummary: (...args: unknown[]) => getWipSummary(...args),
  getWip: (...args: unknown[]) => getWip(...args),
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

const DEPARTMENTS = [{ id: 'd-weld', name: 'Welding' }];
const APPS = [{ id: 'a-weld', name: 'Weld Check' }];

/** The brief for a scope the server could answer. */
const ANSWERED_BRIEF = {
  scope: { department_id: null, app_id: null },
  scope_valid: true,
  attention: [
    { type: 'wo_overdue', severity: 'red', label: 'WO-1 · Weldment', detail: '2/10 done · Welding', link: '/schedule' },
  ],
  attention_plant_wide_hidden: 0,
  attention_plant_wide_kinds: [],
  kpis: { completed_today: 12, vs_7day_avg_pct: 20, active_now: 4, work_orders_total: 12 },
  due_soon: [],
  throughput_7d: [{ date: '2026-08-25', count: 12 }],
  week_avg_per_day: 9.5,
  is_pro: true,
};

/** The brief for a scope it refused: nothing measured, and it says so. This is
 *  byte-for-byte the shape backend/src/routes/analytics.js returns. */
const REFUSED_BRIEF = {
  scope: { department_id: null, app_id: null },
  scope_valid: false,
  attention: [],
  attention_plant_wide_hidden: 0,
  attention_plant_wide_kinds: [],
  kpis: {
    completed_today: 0, vs_7day_avg_pct: null, vs_7day_sample_days: 0, vs_7day_reason: null,
    active_now: 0, pass_rate_7d: null, schedule_adherence: null,
    work_orders_on_track: 0, work_orders_total: 0,
  },
  due_soon: [],
  throughput_7d: [],
  week_avg_per_day: 0,
  week_avg_basis: 'days with any completion in the last 7',
  is_pro: true,
};

const SNAPSHOT = {
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
};

const PLANT = {
  scope: { site_id: null, department_id: null, app_id: null },
  hourly_throughput: [{ hour: '2026-09-02T08:00:00', count: 12 }],
  active_alerts: [],
  recent_completions: [],
};

// recharts calls `new ResizeObserver(...)`, and the shared setup's
// arrow-function stub is not constructible.
class TestResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

function renderPage(entry: string) {
  return render(<MemoryRouter initialEntries={[entry]}><Dashboard /></MemoryRouter>);
}

beforeEach(() => {
  vi.clearAllMocks();
  (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = TestResizeObserver;
  localStorage.clear();
  getDepartments.mockResolvedValue(DEPARTMENTS);
  getApps.mockResolvedValue(APPS);
  getCompanySettings.mockResolvedValue({ company_name: 'Command Co' });
  getPlantView.mockResolvedValue(PLANT);
  getFloorSnapshot.mockResolvedValue(SNAPSHOT);
  getFloorDepartments.mockResolvedValue({
    plant_date: '2026-09-02', timezone: 'UTC', scope: { site_id: null, valid: true }, departments: [],
  });
});

describe('the Command Center says a filter was refused instead of printing its zeros', () => {
  it('replaces every brief-driven section with the reason', async () => {
    // 'd-gone' is in the URL and in the department list, so the page's own
    // repair effect leaves it alone — only the server knows it is not ours.
    getDepartments.mockResolvedValue([...DEPARTMENTS, { id: 'd-gone', name: 'Gone' }]);
    getDailyBrief.mockResolvedValue(REFUSED_BRIEF);
    renderPage('/dashboard?department_id=d-gone');

    const note = await screen.findByTestId('scope-refused');
    // Spelled out rather than matched loosely: a sentence assembled around a
    // company name is exactly where a JSX newline eats the space beside it.
    expect(note).toHaveTextContent(
      "The department, app or site this page was asked to narrow to doesn't belong to this company — it may have been deleted");

    // None of the sections that would have drawn the empty payload as a
    // measurement are on screen at all.
    expect(screen.queryByText('Needs Attention')).not.toBeInTheDocument();
    expect(screen.queryByText('Output')).not.toBeInTheDocument();
    expect(screen.queryByText('Due in the next 48 hours')).not.toBeInTheDocument();
    expect(screen.queryByTestId('kpi-finished-today')).not.toBeInTheDocument();

    // And the page prints no number for the scope it could not read — the
    // failure this guard exists for is a confident 0.
    expect(note.textContent).not.toMatch(/\d/);
  });

  it('offers the way back, and the plant returns when the filter is cleared', async () => {
    getDepartments.mockResolvedValue([...DEPARTMENTS, { id: 'd-gone', name: 'Gone' }]);
    getDailyBrief.mockImplementation(async (f?: { department_id?: string }) =>
      (f?.department_id === 'd-gone' ? REFUSED_BRIEF : ANSWERED_BRIEF));
    renderPage('/dashboard?department_id=d-gone');

    fireEvent.click(await screen.findByRole('button', { name: 'Show the whole plant' }));

    await waitFor(() => expect(getDailyBrief).toHaveBeenLastCalledWith({ site_id: undefined }));
    expect(await screen.findByTestId('kpi-finished-today')).toHaveTextContent('12');
    expect(screen.queryByTestId('scope-refused')).not.toBeInTheDocument();
  });

  it('does not fire on a scope the server did honour', async () => {
    getDailyBrief.mockResolvedValue(ANSWERED_BRIEF);
    renderPage('/dashboard');

    expect(await screen.findByTestId('kpi-finished-today')).toHaveTextContent('12');
    expect(screen.queryByTestId('scope-refused')).not.toBeInTheDocument();
  });
});

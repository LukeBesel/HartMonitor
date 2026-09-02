import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// ─── One live-floor screen ────────────────────────────────────────────────────
//
// Four screens used to answer "what is the floor doing right now" — the Command
// Center, a Manager View, a Departments list and Facilities — and they
// disagreed at the same minute because each counted for itself. Worse, the
// Command Center answered nothing at all until a department was picked: on a
// fresh account with three completed runs it rendered two cards and no numbers.
//
// What this file pins:
//
//   1. The five tiles are on screen with NOTHING selected, and they carry the
//      snapshot's own values — the finished-today count verbatim, a '—' when
//      the payload has nothing to report, never a 0 standing in for silence.
//   2. The on-track share is one sentence, "N of M open work orders on track",
//      shared with the department page and the wall board through
//      utils/floorWording so the three cannot word it differently.
//   3. Every step of the dashboard tour points at an element that is actually
//      on this page.
//   4. The screens that disagreed are gone, and their URLs land somewhere real.

const getDailyBrief = vi.fn();
const getPlantView = vi.fn();
const getDepartments = vi.fn();
const getApps = vi.fn();
const acknowledgeAndonCall = vi.fn();
const resolveAndonCall = vi.fn();
const loadSampleData = vi.fn();
const getFloorSnapshot = vi.fn();
const getFloorDepartments = vi.fn();

vi.mock('../../api/client', () => ({
  api: {
    get getDailyBrief() { return getDailyBrief; },
    get getPlantView() { return getPlantView; },
    get getDepartments() { return getDepartments; },
    get getApps() { return getApps; },
    get acknowledgeAndonCall() { return acknowledgeAndonCall; },
    get resolveAndonCall() { return resolveAndonCall; },
    get loadSampleData() { return loadSampleData; },
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
import { WALKTHROUGHS } from '../../config/walkthroughs';
import { onTrackSentence } from '../../utils/floorWording';

// ── Fixtures ─────────────────────────────────────────────────────────────────

function snapshot(over: Record<string, unknown> = {}) {
  return {
    plant_date: '2026-09-02', timezone: 'UTC',
    finished_today: 3, running_now: 1,
    avg_cycle_seconds: 451, avg_cycle_basis: 'elapsed', avg_cycle_sample: 3,
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

const BRIEF = {
  attention: [],
  attention_plant_wide_hidden: 0,
  attention_plant_wide_kinds: [],
  kpis: { completed_today: 3, active_now: 1, work_orders_total: 12 },
  due_soon: [],
  throughput_7d: [{ date: '2026-09-01', count: 3 }],
  week_avg_per_day: 3,
  is_pro: true,
};

const PLANT = {
  hourly_throughput: [{ hour: '2026-09-02T09:00:00', count: 3 }],
  active_alerts: [],
  recent_completions: [
    { id: 'c1', app_name: 'Weld Check', operator_name: 'Ana', department: 'Welding', activity_at: '2026-09-02T09:30:00Z', completed_at: '2026-09-02T09:30:00Z', is_complete: true, duration_seconds: 451, status: 'completed' },
  ],
};

const KPI_TILES = [
  'kpi-finished-today', 'kpi-running-now', 'kpi-avg-cycle', 'kpi-pass-rate', 'kpi-on-track',
];

class TestResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

beforeEach(() => {
  vi.clearAllMocks();
  (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = TestResizeObserver;
  localStorage.clear();
  // A fresh account: an app, three finished runs, and NO departments at all.
  getDepartments.mockResolvedValue([]);
  getApps.mockResolvedValue([{ id: 'a-1', name: 'Weld Check' }]);
  getDailyBrief.mockResolvedValue(BRIEF);
  getPlantView.mockResolvedValue(PLANT);
  getFloorSnapshot.mockResolvedValue(snapshot());
  getFloorDepartments.mockResolvedValue({
    plant_date: '2026-09-02', timezone: 'UTC',
    scope: { site_id: null, valid: true },
    departments: [],
  });
});

const renderPage = () =>
  render(<MemoryRouter initialEntries={['/dashboard']}><Dashboard /></MemoryRouter>);

// ── 1. The plant is the page ─────────────────────────────────────────────────

describe('the whole plant, with nothing selected', () => {
  it('renders all five tiles on a company that has no departments at all', async () => {
    renderPage();
    await screen.findByTestId('kpi-finished-today');
    for (const id of KPI_TILES) expect(screen.getByTestId(id)).toBeInTheDocument();
  });

  it('asks the server for the plant, unscoped, before anything is chosen', async () => {
    renderPage();
    await waitFor(() => expect(getFloorSnapshot).toHaveBeenCalledWith({ site_id: undefined }));
  });

  it('prints the snapshot’s finished-today verbatim', async () => {
    renderPage();
    // Three completed runs on a fresh account: the tile says 3, not "pick a
    // department first".
    await waitFor(() => expect(screen.getByTestId('kpi-finished-today')).toHaveTextContent('3'));
  });

  it('prints a dash — not a zero — when the payload has no count to give', async () => {
    getFloorSnapshot.mockResolvedValue(snapshot({ finished_today: null, running_now: null }));
    renderPage();

    await waitFor(() => expect(screen.getByTestId('kpi-finished-today')).toHaveTextContent('—'));
    expect(screen.getByTestId('kpi-finished-today')).not.toHaveTextContent('0');
    expect(screen.getByTestId('kpi-running-now')).toHaveTextContent('—');
  });

  it('shows the three sections that used to sit behind the gate', async () => {
    renderPage();
    await screen.findByTestId('kpi-finished-today');
    expect(screen.getByRole('heading', { name: 'Latest runs' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Output' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Due in the next 48 hours' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Departments' })).toBeInTheDocument();
    // …and the run that finished, with the time it took, from the same payload.
    expect(screen.getAllByText('Weld Check').length).toBeGreaterThan(0);
    expect(screen.getAllByText('7m 31s').length).toBeGreaterThan(0);
  });

  it('gives the manager a screenful, not two cards', async () => {
    const { container } = renderPage();
    await screen.findByTestId('kpi-finished-today');
    // Needs Attention, the filters, the departments directory, Latest runs,
    // Output and Due in 48 hours.
    expect(container.querySelectorAll('.card').length).toBeGreaterThanOrEqual(5);
  });
});

// ── 2. One sentence for the on-track share ───────────────────────────────────

describe('the on-track share is one sentence', () => {
  it('reads "N of M open work orders on track"', async () => {
    renderPage();
    await waitFor(() =>
      expect(screen.getByTestId('kpi-on-track')).toHaveTextContent('6 of 8 open work orders on track'));
  });

  it('says why instead of printing 0% when nothing is open', async () => {
    getFloorSnapshot.mockResolvedValue(snapshot({
      open_work_orders: 0, on_track: 0, on_track_pct: null,
      on_track_reason: 'no open work order to be on track with',
    }));
    renderPage();

    await waitFor(() =>
      expect(screen.getByTestId('kpi-on-track')).toHaveTextContent('no open work order to be on track with'));
    expect(screen.getByTestId('kpi-on-track')).toHaveTextContent('—');
    expect(screen.getByTestId('kpi-on-track')).not.toHaveTextContent('0%');
  });

  it('is written once, so three screens cannot word it differently', () => {
    expect(onTrackSentence({ on_track: 6, open_work_orders: 8 })).toBe('6 of 8 open work orders on track');
    expect(onTrackSentence({ on_track: 0, open_work_orders: 1 })).toBe('0 of 1 open work orders on track');
    expect(onTrackSentence({ on_track: 0, open_work_orders: 0 })).toBeNull();
    expect(onTrackSentence(null)).toBeNull();
  });
});

// ── 3. The tour describes this page ──────────────────────────────────────────

describe('the dashboard tour narrates what is on screen', () => {
  it('resolves every step to an element on the page', async () => {
    renderPage();
    await screen.findByTestId('kpi-finished-today');

    const steps = WALKTHROUGHS.dashboard;
    expect(steps.length).toBeGreaterThan(0);
    for (const step of steps) {
      expect(step.target, `"${step.title}" points at nothing`).toBeTruthy();
      expect(document.querySelector(step.target!), `"${step.title}" → ${step.target}`).not.toBeNull();
    }
  });
});

// ── 4. The screens that disagreed are gone ───────────────────────────────────

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = join(HERE, '..', '..');
const read = (rel: string) => readFileSync(join(SRC, rel), 'utf8');

describe('the other floor screens are gone, and their URLs land somewhere real', () => {
  it('deletes the page files rather than orphaning them', () => {
    for (const gone of [
      'pages/ManagerView.tsx', 'pages/Departments.tsx', 'pages/LeaderboardTV.tsx',
      'pages/SQDC.tsx', 'pages/StepMetrics.tsx', 'hooks/useDashboardPrefs.ts',
    ]) {
      expect(existsSync(join(SRC, gone)), `${gone} still exists`).toBe(false);
    }
  });

  it('redirects every retired URL to the screen that answers it now', () => {
    const app = read('App.tsx');
    const redirects: [string, string][] = [
      ['/manager', '/dashboard'],
      ['/departments', '/dashboard'],
      ['/sqdc', '/dashboard'],
      ['/plant', '/dashboard'],
      ['/step-metrics', '/analytics'],
      ['/transaction-log', '/audit-log'],
      ['/leaderboard/tv', '/leaderboard?tv=1'],
    ];
    for (const [from, to] of redirects) {
      const re = new RegExp(`path="${from.replace(/\//g, '\\/')}"\\s+element=\\{<Navigate to="${to.replace(/[/?=]/g, m => '\\' + m)}"`);
      expect(re.test(app), `${from} does not redirect to ${to}`).toBe(true);
    }
    // The two screens a department still has, reached from the cards.
    expect(app).toMatch(/path="\/departments\/:id"\s+element=\{<DepartmentView/);
    expect(app).toMatch(/path="\/departments\/:id\/tv"/);
  });

  it('leaves no import, route or client method behind', () => {
    const files = ['App.tsx', 'config/navigation.tsx', 'config/pageTitles.ts', 'api/client.ts', 'pages/Dashboard.tsx'];
    for (const file of files) {
      const src = read(file);
      for (const name of ['ManagerView', 'LeaderboardTV', 'useDashboardPrefs', 'getManagerView', 'TransactionLog']) {
        expect(src.includes(name), `${file} still references ${name}`).toBe(false);
      }
    }
  });

  it('counts nothing by date for itself', () => {
    // Every "today" on this screen is the plant's own day, measured server-side
    // in plantTruth.js. A completion timestamp may be PRINTED; it may not be
    // compared against the tablet's clock to build a number.
    const src = read('pages/Dashboard.tsx');
    expect(src).not.toMatch(/completed_at[^\n]*(toDateString|slice\(0, ?10\)|startsWith|getDate|toISOString)/);
    expect(src).not.toMatch(/filter\([^)]*completed_at/);
  });
});

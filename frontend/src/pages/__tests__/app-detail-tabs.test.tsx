import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within, act } from '@testing-library/react';
import { MemoryRouter, Route, Routes, RouterProvider, createMemoryRouter } from 'react-router-dom';
import type { AppAnalyticsResponse, AppDetailResponse } from '../../api/client';
import { fmtDuration } from '../../components/apps/appModel';

// ─── One screen per app ───────────────────────────────────────────────────────
//
// One app's cycle time used to be reported on five screens, under four labels,
// at three precisions, each behind its own filter bar. What this file pins:
//
//   1. Every tab of /apps/:id renders from ?tab= — and there is EXACTLY ONE
//      filter bar on every one of them.
//   2. The filter bar drives every tab: moving the date range re-asks the API
//      with the new window and the run count on screen moves with it.
//   3. "Who ran it" is a tab on this screen, not six clicks and a dead end away.
//   4. The same measured seconds render character-for-character identically
//      here, on the cross-app comparison screen, and on the Command Center.
//   5. Nothing is invented: an untimed run reads "—", never 0s.

const getAppDetail = vi.fn();
const getAppAnalytics = vi.fn();
const getStepMetrics = vi.fn();
const downloadAppAnalyticsCsv = vi.fn();
const duplicateApp = vi.fn();
const publishApp = vi.fn();
const saveAppAsTemplate = vi.fn();

// The comparison screen and the Command Center each read their own endpoints;
// both are mocked here so the three renders can be compared side by side.
const getApps = vi.fn();
const getDepartments = vi.fn();
const getProductTypes = vi.fn();
const getOverview = vi.fn();
const getThroughput = vi.fn();
const getCycleTimes = vi.fn();
const getOperatorPerformance = vi.fn();
const getAppPerformance = vi.fn();
const getQualityData = vi.fn();
const getDailyBrief = vi.fn();
const getPlantView = vi.fn();
const getOEE = vi.fn();
const getFloorSnapshot = vi.fn();
const getFloorDepartments = vi.fn();

vi.mock('../../api/client', () => ({
  api: {
    get getAppDetail() { return getAppDetail; },
    get getAppAnalytics() { return getAppAnalytics; },
    get getStepMetrics() { return getStepMetrics; },
    get downloadAppAnalyticsCsv() { return downloadAppAnalyticsCsv; },
    get duplicateApp() { return duplicateApp; },
    get publishApp() { return publishApp; },
    get saveAppAsTemplate() { return saveAppAsTemplate; },
    get getApps() { return getApps; },
    get getDepartments() { return getDepartments; },
    get getProductTypes() { return getProductTypes; },
    get getOverview() { return getOverview; },
    get getThroughput() { return getThroughput; },
    get getCycleTimes() { return getCycleTimes; },
    get getOperatorPerformance() { return getOperatorPerformance; },
    get getAppPerformance() { return getAppPerformance; },
    get getQualityData() { return getQualityData; },
    get getDailyBrief() { return getDailyBrief; },
    get getPlantView() { return getPlantView; },
    get getOEE() { return getOEE; },
    get acknowledgeAndonCall() { return vi.fn(); },
    get resolveAndonCall() { return vi.fn(); },
    get loadSampleData() { return vi.fn(); },
  },
}));

vi.mock('../../api/floor', () => ({
  getFloorSnapshot: (...args: unknown[]) => getFloorSnapshot(...args),
  getFloorDepartments: (...args: unknown[]) => getFloorDepartments(...args),
}));

// The three things the OEE tab is gated on, switchable per test.
let planIsFree = false;
let moduleEnabled: (key: string) => boolean = () => true;
let userRole: 'manager' | 'operator' = 'manager';
const ROLE_RANK = { viewer: 1, operator: 2, supervisor: 3, manager: 4, developer: 5 } as const;

vi.mock('../../context/AuthContext', () => ({
  useAuth: () => ({
    user: { id: 'u-1', email: 'a@b.c', display_name: 'Ana Diaz', role: userRole },
    canEdit: true, loading: false,
    isAtLeast: (role: keyof typeof ROLE_RANK) => ROLE_RANK[userRole] >= ROLE_RANK[role],
  }),
}));

vi.mock('../../context/SiteContext', () => ({
  useSite: () => ({
    sites: [], selectedSiteId: null, setSelectedSiteId: () => {}, loading: false, refresh: () => {},
  }),
}));

vi.mock('../../context/ToastContext', () => ({ useToast: () => ({ addToast: () => {} }) }));
vi.mock('../../context/PlanContext', () => ({
  usePlan: () => ({ refresh: () => {}, isFree: planIsFree, isPro: !planIsFree, plan: null }),
}));
vi.mock('../../context/ModulesContext', () => ({
  useModules: () => ({ isEnabled: (key: string) => moduleEnabled(key), loading: false }),
}));
vi.mock('../../components/shared/UpgradeModal', () => ({
  default: ({ lockedFeature }: { lockedFeature?: string }) =>
    <div data-testid="upgrade-modal">{lockedFeature}</div>,
}));
vi.mock('../../components/apps/AppTrainingCoach', () => ({
  default: () => null,
  useCoachDocked: () => false,
}));
vi.mock('../../components/shared/OnboardingWizard', () => ({ default: () => null }));
vi.mock('../../components/shared/ModuleOnboarding', () => ({
  default: () => null,
  markWalkthroughSeen: () => {},
}));
vi.mock('../../components/analytics/StepMetricsPanel', () => ({ StepMetricsPanel: () => null }));
vi.mock('../../utils/realtime', () => ({ subscribeRealtime: () => () => {}, isAndonEvent: () => false }));

import AppDetail from '../AppDetail';
import Analytics from '../Analytics';
import Dashboard from '../Dashboard';

// ── Fixtures ─────────────────────────────────────────────────────────────────

/** The one measurement every screen in this file reports. 451 seconds is the
 *  value the launch audit caught rendering as "7.5h" on the Command Center. */
const CYCLE_SECONDS = 451;
const CYCLE_TEXT = fmtDuration(CYCLE_SECONDS); // "7m 31s"

function detail(over: Partial<AppDetailResponse> = {}): AppDetailResponse {
  return {
    app: {
      id: 'a-weld', name: 'Weld Inspection', description: 'Inspect the weld',
      status: 'published', steps: [
        { id: 's1', name: 'Clean', order: 0, takt_time_seconds: 65,
          widgets: [{ id: 'w1', type: 'text-input', label: 'Notes', order: 0, config: {} }] },
        { id: 's2', name: 'Inspect', order: 1, takt_time_seconds: 300,
          widgets: [{ id: 'w2', type: 'pass-fail', label: 'Weld OK', order: 0, config: {} }] },
      ],
      variables: [], created_at: '2026-01-01 00:00:00', updated_at: '2026-01-01 00:00:00',
    } as AppDetailResponse['app'],
    bindings: {
      department: null, site: null, default_station: null, stations: [],
      product_types: [], routings: [], work_orders: [], work_order_count: 0,
    },
    stats: {
      runs_total: 40, completed: 36, abandoned: 2, in_progress: 2,
      runs_7d: 5, runs_30d: 12, completed_30d: 10,
      avg_duration_s: CYCLE_SECONDS, avg_duration_30d_s: CYCLE_SECONDS,
      avg_duration_basis: 'hands_on',
      first_run_at: '2026-01-02 08:00:00', last_run_at: '2026-08-20 16:00:00',
      first_pass_yield: 96, operator_count: 2,
    },
    operators: [],
    recent_runs: [],
    ...over,
  };
}

function analytics(over: Partial<AppAnalyticsResponse> = {}): AppAnalyticsResponse {
  return {
    app_id: 'a-weld', app_name: 'Weld Inspection', days: 30,
    totals: {
      runs: 10, completed: 8, abandoned: 2,
      avg_duration_s: CYCLE_SECONDS, avg_duration_basis: 'hands_on', first_pass_yield: 96,
      best_duration_s: 381, qc_sample_size: 25,
    },
    series: [{ date: '2026-08-20', completed: 3, avg_duration_s: CYCLE_SECONDS }],
    by_operator: [
      { operator_name: 'Sam', runs: 6, avg_duration_s: CYCLE_SECONDS },
      { operator_name: 'Kim', runs: 2, avg_duration_s: null },
    ],
    fields: [
      {
        widget_id: 'w-torque', label: 'Torque reading', type: 'number-input', step_name: 'Fasten',
        kind: 'number', stats: { avg: 12.5, min: 10, max: 15, count: 8 },
        trend: [{ date: '2026-08-19', avg: 12 }, { date: '2026-08-20', avg: 13 }],
      },
      {
        widget_id: 'w-weld', label: 'Weld OK', type: 'pass-fail', step_name: 'Inspect',
        kind: 'boolean', stats: { pass: 22, fail: 3, yield_pct: 88 },
      },
    ],
    filter_options: {
      operators: ['Sam', 'Kim'],
      work_orders: [{ id: 'wo-1', work_order_number: 'WO-1' }],
      product_types: [{ id: 'pt-1', name: 'Bracket' }],
    },
    recent_runs: [
      {
        id: 'c-1', started_at: '2026-08-20 16:00:00', completed_at: '2026-08-20 16:07:31',
        status: 'completed', operator_name: 'Sam',
        duration_s: CYCLE_SECONDS, duration_basis: 'hands_on',
        work_order_number: 'WO-1', product_type_name: 'Bracket', pass_fail: 'pass',
      },
      {
        id: 'c-2', started_at: '2026-08-20 15:00:00', completed_at: '2026-08-20 15:08:00',
        status: 'completed', operator_name: 'Kim',
        duration_s: 480, duration_basis: 'hands_on',
        work_order_number: 'WO-2', product_type_name: 'Bracket', pass_fail: 'fail',
      },
      {
        id: 'c-3', started_at: '2026-08-20 14:00:00', completed_at: null,
        status: 'abandoned', operator_name: 'Ana',
        duration_s: null, duration_basis: null,
        work_order_number: null, product_type_name: null, pass_fail: null,
      },
    ],
    ...over,
  };
}

const STEP_METRICS = {
  app_id: 'a-weld', app_name: 'Weld Inspection', total_completions: 8,
  steps: [
    {
      index: 0, name: 'Clean', takt_seconds: 120, completions: 8,
      avg_seconds: 96, min_seconds: 80, max_seconds: 130, p95_seconds: 128,
      over_takt_count: 0, over_takt_pct: 0,
    },
    {
      index: 1, name: 'Inspect', takt_seconds: 300, completions: 8,
      avg_seconds: 355, min_seconds: 300, max_seconds: 420, p95_seconds: 410,
      over_takt_count: 4, over_takt_pct: 50,
    },
    // A step nobody has timed draws no bar and claims no number.
    {
      index: 2, name: 'Sign off', takt_seconds: 0, completions: 0,
      avg_seconds: 0, min_seconds: 0, max_seconds: 0, p95_seconds: 0,
      over_takt_count: 0, over_takt_pct: 0,
    },
  ],
};

function floorSnapshot(over: Record<string, unknown> = {}) {
  return {
    plant_date: '2026-09-02', timezone: 'UTC',
    finished_today: 3, running_now: 1,
    avg_cycle_seconds: CYCLE_SECONDS, avg_cycle_basis: 'hands_on', avg_cycle_sample: 3,
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

function renderDetail(url = '/apps/a-weld') {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <Routes><Route path="/apps/:id" element={<AppDetail />} /></Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  planIsFree = false;
  moduleEnabled = () => true;
  userRole = 'manager';
  getAppDetail.mockResolvedValue(detail());
  getAppAnalytics.mockResolvedValue(analytics());
  getStepMetrics.mockResolvedValue(STEP_METRICS);

  getApps.mockResolvedValue([]);
  getDepartments.mockResolvedValue([]);
  getProductTypes.mockResolvedValue([]);
  getThroughput.mockResolvedValue([]);
  getCycleTimes.mockResolvedValue([]);
  getOperatorPerformance.mockResolvedValue([]);
  getAppPerformance.mockResolvedValue([]);
  getQualityData.mockResolvedValue([]);
  getOEE.mockResolvedValue([]);
  getOverview.mockResolvedValue({
    totalCompletions: 10, todayCompletions: 3, inProgress: 1,
    totalApps: 1, publishedApps: 1, activeStations: 1,
    avgCycleTime: 8, avgCycleSeconds: CYCLE_SECONDS, passRate: 96, qcSampleSize: 25,
  });
  getFloorSnapshot.mockResolvedValue(floorSnapshot());
  getFloorDepartments.mockResolvedValue([]);
  getDailyBrief.mockResolvedValue({
    attention: [], attention_plant_wide_hidden: 0, attention_plant_wide_kinds: [],
    kpis: { completed_today: 3, active_now: 1, work_orders_total: 12 },
    due_soon: [], throughput_7d: [], week_avg_per_day: 3, is_pro: true,
  });
  getPlantView.mockResolvedValue({ hourly_throughput: [], active_alerts: [], recent_completions: [] });
});

// ── One filter bar, on every tab ─────────────────────────────────────────────

describe('/apps/:id has one filter bar and one vocabulary', () => {
  it.each([
    ['overview', 'app-metrics'],
    ['runs', 'runs-count'],
    ['who', 'who-ran-it'],
    ['steps', 'step-times'],
  ])('renders the %s tab from ?tab= behind exactly one filter bar', async (tab, marker) => {
    renderDetail(`/apps/a-weld?tab=${tab}`);
    expect(await screen.findByTestId(marker)).toBeInTheDocument();
    expect(screen.getAllByTestId('app-filter-bar')).toHaveLength(1);
  });

  it('defaults to the overview when the URL names no tab', async () => {
    renderDetail();
    expect(await screen.findByTestId('app-metrics')).toBeInTheDocument();
    expect(screen.getAllByTestId('app-filter-bar')).toHaveLength(1);
  });

  it('keeps every tab one click away — "Who ran it" included', async () => {
    renderDetail();
    await screen.findByTestId('app-metrics');

    fireEvent.click(screen.getByRole('button', { name: 'Who ran it' }));
    const rollup = await screen.findByTestId('who-ran-it');
    // Busiest first, and the person nobody timed has no average rather than a
    // zero that would name them the fastest on the floor.
    const rows = within(rollup).getAllByTestId('who-row');
    expect(rows[0]).toHaveTextContent('Sam');
    expect(rows[0]).toHaveTextContent(`avg ${CYCLE_TEXT}`);
    expect(rows[1]).toHaveTextContent('Kim');
    expect(rows[1]).toHaveTextContent('— avg');
    expect(rows[1]).not.toHaveTextContent('avg 0s');
  });

  it('labels the cycle time with the measurement behind it, in one vocabulary', async () => {
    renderDetail();
    await screen.findByTestId('app-metrics');
    expect(screen.getByText('Average cycle time · hands-on')).toBeInTheDocument();
    expect(screen.getByText('First-pass yield')).toBeInTheDocument();
    expect(screen.queryByText('Avg run time')).toBeNull();
    expect(screen.queryByText('Avg cycle time · hands-on')).toBeNull();
  });
});

// ── The filter bar drives every tab ──────────────────────────────────────────

describe('the one filter bar is read by every tab', () => {
  it('re-asks the API with the new window and moves the run count with it', async () => {
    renderDetail();
    await screen.findByTestId('app-metrics');
    await waitFor(() => expect(getAppAnalytics).toHaveBeenCalledWith('a-weld', {
      days: 30, operator: undefined, work_order_id: undefined, product_type_id: undefined,
    }));
    expect(screen.getByTestId('app-filter-summary')).toHaveTextContent('10 runs in the last 30 days');

    getAppAnalytics.mockResolvedValue(analytics({
      days: 7, totals: { runs: 4, completed: 4, abandoned: 0, avg_duration_s: CYCLE_SECONDS, avg_duration_basis: 'hands_on', first_pass_yield: 96 },
    }));
    fireEvent.click(screen.getByRole('button', { name: '7d' }));

    await waitFor(() => expect(getAppAnalytics).toHaveBeenLastCalledWith('a-weld', {
      days: 7, operator: undefined, work_order_id: undefined, product_type_id: undefined,
    }));
    await waitFor(() => expect(screen.getByTestId('app-filter-summary'))
      .toHaveTextContent('4 runs in the last 7 days'));

    // Same window on another tab: the count follows the filter, not the tab.
    fireEvent.click(screen.getByRole('button', { name: 'Runs' }));
    expect(await screen.findByTestId('app-filter-summary')).toHaveTextContent('4 runs in the last 7 days');
  });

  it('sends only the four parameters the analytics endpoint honours', async () => {
    renderDetail();
    await screen.findByTestId('app-metrics');

    fireEvent.change(await screen.findByLabelText('Operator'), { target: { value: 'Sam' } });
    await waitFor(() => expect(getAppAnalytics).toHaveBeenLastCalledWith('a-weld', {
      days: 30, operator: 'Sam', work_order_id: undefined, product_type_id: undefined,
    }));
    for (const call of getAppAnalytics.mock.calls) {
      expect(Object.keys(call[1] as object)).toEqual(['days', 'operator', 'work_order_id', 'product_type_id']);
    }
  });

  it('opens on the slice a retired deep link was carrying', async () => {
    // /apps/:id/analytics?days=7&operator=Sam redirects here with its query
    // string intact, and the screen has to honour it rather than reset.
    renderDetail('/apps/a-weld?tab=runs&days=7&operator=Sam');
    await screen.findByTestId('runs-count');
    await waitFor(() => expect(getAppAnalytics).toHaveBeenCalledWith('a-weld', {
      days: 7, operator: 'Sam', work_order_id: undefined, product_type_id: undefined,
    }));
  });
});

// ── The same number, spelled the same way, on all three screens ──────────────

describe('one measurement, one string', () => {
  it('renders the same seconds identically on /apps/:id, App comparison and /dashboard', async () => {
    const detailRender = renderDetail();
    await screen.findByTestId('app-metrics');
    const onAppScreen = screen.getByTestId('metric-avg_cycle').textContent;
    detailRender.unmount();

    const comparison = render(<MemoryRouter><Analytics /></MemoryRouter>);
    await screen.findByText('Average cycle time');
    const onComparison = await screen.findByText(CYCLE_TEXT);
    const comparisonText = onComparison.textContent;
    comparison.unmount();

    render(<MemoryRouter><Dashboard /></MemoryRouter>);
    await screen.findByText('Average cycle time');
    const onCommandCenter = (await screen.findAllByText(CYCLE_TEXT))[0].textContent;

    // Character for character, from one formatter over one measurement.
    expect(onAppScreen).toBe(CYCLE_TEXT);
    expect(comparisonText).toBe(CYCLE_TEXT);
    expect(onCommandCenter).toBe(CYCLE_TEXT);
    expect(onAppScreen).not.toContain('h');
  });
});

// ── Nothing invented ─────────────────────────────────────────────────────────

describe('/apps/:id refuses to invent numbers', () => {
  it('reads a finished run nobody timed as unknown, not as instant', async () => {
    getAppAnalytics.mockResolvedValue(analytics({
      totals: { runs: 1, completed: 1, abandoned: 0, avg_duration_s: null, avg_duration_basis: null, first_pass_yield: null },
      recent_runs: [{
        id: 'c-3', started_at: '2026-08-20 16:00:00', completed_at: '2026-08-20 16:00:00',
        status: 'completed', operator_name: 'Sam', duration_s: null, duration_basis: null,
        work_order_number: null, product_type_name: null,
      }],
    }));
    renderDetail('/apps/a-weld?tab=runs');

    const row = await screen.findByTestId('app-run-row');
    expect(row.querySelector('[title="this run was never timed"]')).not.toBeNull();
    expect(row).not.toHaveTextContent('0s');
    expect(screen.getByTestId('metric-avg_cycle')).toHaveTextContent('—');
    // Both the average and the best time say it, and both are honest.
    expect(screen.getAllByText('no finished run was timed · last 30 days').length).toBeGreaterThan(0);
  });

  it('shows a run that is still running counting up rather than calling it zero', async () => {
    getAppAnalytics.mockResolvedValue(analytics({
      recent_runs: [{
        id: 'c-live', started_at: '2026-08-20 16:00:00', completed_at: null, status: 'in_progress',
        operator_name: 'Sam', duration_s: null, duration_basis: null,
        work_order_number: null, product_type_name: null,
      }],
    }));
    renderDetail('/apps/a-weld?tab=runs');

    const row = await screen.findByTestId('app-run-row');
    expect(row).toHaveTextContent('Running now');
    expect(row).toHaveTextContent('and counting');
  });

  it('says an app has no runs in the window instead of showing 0% and an average of nothing', async () => {
    getAppAnalytics.mockResolvedValue(analytics({
      totals: { runs: 0, completed: 0, abandoned: 0, avg_duration_s: null, avg_duration_basis: null, first_pass_yield: null },
      by_operator: [], fields: [], series: [], recent_runs: [],
    }));
    renderDetail();

    expect(await screen.findByText('No runs of "Weld Inspection" in the last 30 days')).toBeInTheDocument();
    expect(screen.queryByText(/0%/)).toBeNull();
    expect(screen.getByTestId('metric-avg_cycle')).toHaveTextContent('—');
  });

  it('draws no bar for a step nobody has timed', async () => {
    renderDetail('/apps/a-weld?tab=steps');
    const panel = await screen.findByTestId('step-times');
    const rows = within(panel).getAllByTestId('step-row');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent('Clean');
    expect(rows[0]).toHaveTextContent(fmtDuration(96));
    expect(within(panel).queryByText(/Sign off/)).toBeNull();
    expect(within(panel).getByText(/1 step not shown/)).toBeInTheDocument();
  });

  it('asks for step times over the same window the filter bar names', async () => {
    renderDetail('/apps/a-weld?tab=steps&days=7');
    await screen.findByTestId('step-times');
    await waitFor(() => expect(getStepMetrics).toHaveBeenCalledWith('a-weld', 7));
  });
});

// ── The app-level actions stay on the screen ─────────────────────────────────

describe('the app-level actions are reachable from the header', () => {
  it('offers the builder, the player, duplicate, template and the CSV export', async () => {
    renderDetail();
    await screen.findByTestId('app-metrics');

    expect(screen.getByRole('link', { name: /Edit in builder/ })).toHaveAttribute('href', '/apps/a-weld/build');
    expect(screen.getByRole('link', { name: /^Run$/ })).toHaveAttribute('href', '/play/a-weld');
    expect(screen.getByRole('button', { name: /Duplicate/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Save as template/ })).toBeInTheDocument();

    fireEvent.click(screen.getAllByRole('button', { name: /Export this slice \(CSV\)/ })[0]);
    await waitFor(() => expect(downloadAppAnalyticsCsv).toHaveBeenCalledWith('a-weld', {
      days: 30, operator: undefined, work_order_id: undefined, product_type_id: undefined,
    }));
  });

  it('sends a draft to the builder to be published, and never fires the bare call', async () => {
    // Publishing is under change control now: it needs a change note, and an
    // approver when the app requires one. A header button cannot hold that
    // conversation, and the bare call is refused with CHANGE_NOTE_REQUIRED.
    getAppDetail.mockResolvedValue(detail({
      app: { ...detail().app, status: 'draft' } as AppDetailResponse['app'],
    }));
    renderDetail();
    await screen.findByTestId('app-metrics');

    expect(screen.getByRole('link', { name: /Publish in builder/ }))
      .toHaveAttribute('href', '/apps/a-weld/build');
    expect(publishApp).not.toHaveBeenCalled();
  });

  it('names the revision the floor is running, and says so when there is none', async () => {
    getAppDetail.mockResolvedValue(detail({
      app: { ...detail().app, current_revision: 4 } as AppDetailResponse['app'],
    }));
    const withRevision = renderDetail();
    expect(await screen.findByText('Rev 4 live')).toBeInTheDocument();
    withRevision.unmount();

    // Revision 0 is not revision one — it is an app that has never been
    // published under change control, and the header says that in words.
    // Revision 0 is not revision one — but it must not read as "unpublished"
    // beside a Published badge either.
    getAppDetail.mockResolvedValue(detail({
      app: { ...detail().app, current_revision: 0 } as AppDetailResponse['app'],
    }));
    const zero = renderDetail();
    expect(await screen.findByText('Revision not tracked yet')).toBeInTheDocument();
    expect(screen.queryByText('Rev 0 live')).toBeNull();
    zero.unmount();

    // A payload that carries no revisions at all says nothing rather than
    // guessing which of the two it is.
    getAppDetail.mockResolvedValue(detail());
    renderDetail();
    await screen.findByTestId('app-metrics');
    expect(screen.queryByText(/Revision/)).toBeNull();
    expect(screen.queryByText(/Rev \d+ live/)).toBeNull();
  });
});

// ── M1: from a count of failures to the runs that failed ─────────────────────

describe('every failure count is a door, not a dead end', () => {
  it('shows each run\'s result, and lets the filter bar narrow to the failures', async () => {
    renderDetail('/apps/a-weld?tab=runs');
    const rows = await screen.findAllByTestId('app-run-row');
    expect(rows).toHaveLength(3);
    expect(rows[0]).toHaveTextContent('Pass');
    expect(rows[1]).toHaveTextContent('Fail');
    // A run nobody inspected is not a run that passed.
    expect(rows[2]).not.toHaveTextContent('Pass');
    expect(rows[2]).not.toHaveTextContent('Fail');

    fireEvent.change(screen.getByLabelText('Result'), { target: { value: 'fail' } });
    await waitFor(() => expect(screen.getAllByTestId('app-run-row')).toHaveLength(1));
    expect(screen.getByTestId('app-run-row')).toHaveTextContent('Kim');
    // The rows narrowed; the server was not asked a question it cannot answer.
    for (const call of getAppAnalytics.mock.calls) {
      expect(Object.keys(call[1] as object)).toEqual(['days', 'operator', 'work_order_id', 'product_type_id']);
    }
  });

  it('links "N failed of M" to those runs, and abandoned runs to theirs', async () => {
    renderDetail();
    const failed = await screen.findByTestId('failed-check');
    expect(failed).toHaveTextContent('3 failed of 25');
    expect(failed.getAttribute('href')).toContain('tab=runs');
    expect(failed.getAttribute('href')).toContain('result=fail');

    const abandoned = screen.getByTestId('abandoned-runs');
    expect(abandoned.getAttribute('href')).toContain('status=abandoned');
  });

  it('names the runs that went wrong, each one click from its record', async () => {
    renderDetail();
    const trouble = await screen.findAllByTestId('trouble-run');
    expect(trouble.length).toBe(2);
    expect(trouble[0]).toHaveAttribute('href', '/completions/c-2');
    expect(trouble[0]).toHaveTextContent('Failed a check');
    expect(trouble[1]).toHaveAttribute('href', '/completions/c-3');
    expect(trouble[1]).toHaveTextContent('Never finished');
  });

  it('following the failure link lands on the Runs tab already narrowed', async () => {
    renderDetail('/apps/a-weld?tab=runs&result=fail');
    await waitFor(() => expect(screen.getAllByTestId('app-run-row')).toHaveLength(1));
    expect(screen.getByLabelText('Result')).toHaveValue('fail');
  });
});

// ── M2: Back is a way back ───────────────────────────────────────────────────

describe('the browser Back button returns to the last tab and filter', () => {
  /** A router with real history semantics, so Back is Back and not a re-render. */
  function renderRouted(url = '/apps/a-weld') {
    const router = createMemoryRouter(
      [{ path: '/apps/:id', element: <AppDetail /> }],
      { initialEntries: [url] },
    );
    render(<RouterProvider router={router} />);
    return router;
  }

  it('restores the previous tab', async () => {
    const router = renderRouted();
    await screen.findByTestId('app-metrics');

    fireEvent.click(screen.getByRole('button', { name: 'Who ran it' }));
    expect(await screen.findByTestId('who-ran-it')).toBeInTheDocument();

    // Back returns to the Overview instead of throwing the reader off the app.
    await act(async () => { await router.navigate(-1); });
    expect(await screen.findByTestId('app-metrics')).toBeInTheDocument();
    expect(screen.queryByTestId('who-ran-it')).toBeNull();
  });

  it('restores the previous filter', async () => {
    const router = renderRouted();
    await screen.findByTestId('app-metrics');
    fireEvent.click(screen.getByRole('button', { name: '7d' }));
    await waitFor(() => expect(getAppAnalytics).toHaveBeenLastCalledWith('a-weld', expect.objectContaining({ days: 7 })));

    await act(async () => { await router.navigate(-1); });
    await waitFor(() => expect(getAppAnalytics).toHaveBeenLastCalledWith('a-weld', expect.objectContaining({ days: 30 })));
  });

  it('does not put a redirect landing or a normalised window in the way of Back', async () => {
    // Arriving with ?days=14 rewrites the URL to the window actually used; that
    // rewrite must REPLACE, or Back would bounce between 14 and 30 forever.
    const router = renderRouted('/apps/a-weld?days=14');
    await screen.findByTestId('window-normalised');
    await waitFor(() => expect(new URLSearchParams(router.state.location.search).get('days')).toBe('30'));
    expect(router.state.historyAction).toBe('REPLACE');
  });
});

// ── M5: the numbers a supervisor asks for next ───────────────────────────────

describe('the headline row answers more than "how long on average"', () => {
  it('carries the best time, the trend, the takt comparison and the yield sample', async () => {
    renderDetail();
    await screen.findByTestId('app-metrics');

    // Best time, straight from the payload.
    expect(screen.getByTestId('metric-best_cycle')).toHaveTextContent(fmtDuration(381));
    // Against takt: the fixture app has 5s + 300s of takt on two steps.
    expect(screen.getByText(/vs takt/)).toBeInTheDocument();
    // The yield says how many inspected runs are behind it.
    expect(screen.getByText('from 25 inspected runs · last 30 days')).toBeInTheDocument();
    // And the trend is present — here as an honest "not enough to compare".
    expect(screen.getByTestId('metric-trend')).toBeInTheDocument();
  });

  it('calls a real direction when there are enough timed runs on both sides', async () => {
    const fast = Array.from({ length: 6 }, (_, i) => ({
      id: `r${i}`, started_at: '2026-08-20 16:00:00', completed_at: '2026-08-20 16:02:00',
      status: 'completed', operator_name: 'Sam',
      duration_s: i < 3 ? 100 : 200, duration_basis: 'hands_on' as const,
      work_order_number: null, product_type_name: null, pass_fail: 'pass' as const,
    }));
    getAppAnalytics.mockResolvedValue(analytics({ recent_runs: fast }));
    renderDetail();

    await waitFor(() => expect(screen.getByTestId('metric-trend')).toHaveTextContent(fmtDuration(100)));
    expect(screen.getByText('Trend · getting faster')).toBeInTheDocument();
    expect(screen.getByText('last 3 runs vs the 3 before')).toBeInTheDocument();
  });

  it('gives every tile the window it was measured over', async () => {
    renderDetail();
    await screen.findByTestId('app-metrics');
    expect(screen.getAllByText(/last 30 days/).length).toBeGreaterThanOrEqual(4);
  });
});

// ── M6: what a field actually said ───────────────────────────────────────────

describe('field details are still reachable', () => {
  it('opens the full cards — the pass/fail split and the number spread', async () => {
    renderDetail();
    await screen.findByTestId('app-metrics');
    expect(screen.queryByTestId('field-cards')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /Show field details/ }));
    const cards = await screen.findByTestId('field-cards');
    expect(within(cards).getAllByTestId('field-card')).toHaveLength(2);
    // The number field's spread, and the pass/fail field's yield.
    expect(within(cards).getByText('12.5')).toBeInTheDocument();
    expect(within(cards).getByText('88%')).toBeInTheDocument();
    expect(within(cards).getByText('25 checks')).toBeInTheDocument();
  });
});

// ── M8 / M9: a filter that was not honoured, and one that outlived its target ─

describe('no filter is applied in silence', () => {
  it('names a day window it could not offer, and normalises the URL to the one it used', async () => {
    renderDetail('/apps/a-weld?days=14');
    expect(await screen.findByTestId('window-normalised')).toHaveTextContent(/14-day window in the link was read as 30 days/);
    await waitFor(() => expect(getAppAnalytics).toHaveBeenCalledWith('a-weld', expect.objectContaining({ days: 30 })));
  });

  it('says when a filter points at something that no longer exists', async () => {
    renderDetail('/apps/a-weld?product_type_id=pt-deleted');
    const stale = await screen.findByTestId('stale-filter');
    expect(stale).toHaveTextContent('a product type that no longer exists');
    // The numbers ARE narrowed by it, which is exactly why it has to be said.
    await waitFor(() => expect(getAppAnalytics).toHaveBeenCalledWith('a-weld', expect.objectContaining({
      product_type_id: 'pt-deleted',
    })));

    fireEvent.click(within(stale).getByRole('button', { name: /Remove this filter/ }));
    await waitFor(() => expect(getAppAnalytics).toHaveBeenLastCalledWith('a-weld', expect.objectContaining({
      product_type_id: undefined,
    })));
  });
});

// ── M10 / M12: how far the table's own controls reach ────────────────────────

describe('the Runs tab says how far its controls reach', () => {
  it('states that sorting covers the loaded slice', async () => {
    getAppAnalytics.mockResolvedValue(analytics({
      totals: { runs: 101, completed: 98, abandoned: 3, avg_duration_s: CYCLE_SECONDS, avg_duration_basis: 'hands_on', first_pass_yield: 96, best_duration_s: 381, qc_sample_size: 25 },
    }));
    renderDetail('/apps/a-weld?tab=runs');
    expect(await screen.findByTestId('runs-footer'))
      .toHaveTextContent('Sorted within the latest 3 of 101 runs in this window.');
  });

  it('narrows by status, and counts what it listed', async () => {
    renderDetail('/apps/a-weld?tab=runs&status=abandoned');
    await waitFor(() => expect(screen.getAllByTestId('app-run-row')).toHaveLength(1));
    expect(screen.getByTestId('runs-count')).toHaveTextContent('1 of the latest 3 match');
    expect(screen.getByTestId('app-run-row')).toHaveTextContent('Ana');
  });

  it('narrows by free text over operator, work order and run id', async () => {
    renderDetail('/apps/a-weld?tab=runs&q=WO-2');
    await waitFor(() => expect(screen.getAllByTestId('app-run-row')).toHaveLength(1));
    expect(screen.getByTestId('app-run-row')).toHaveTextContent('Kim');
    expect(screen.getByLabelText('Search runs')).toHaveValue('WO-2');
  });

  it('blames the row filters, not the window, when they empty the table', async () => {
    renderDetail('/apps/a-weld?tab=runs&q=nobody-by-that-name');
    expect(await screen.findByText('No runs match these filters')).toBeInTheDocument();
    // The tiles still report the server's slice — 10 runs, not zero.
    expect(screen.getByTestId('metric-runs')).toHaveTextContent('10');
  });
});

// ── M11: who has ever run it, joiners included ───────────────────────────────

describe('"Who ran it" answers the window question and the all-time one', () => {
  it('keeps the two lists apart and says which is which', async () => {
    getAppDetail.mockResolvedValue(detail({
      operators: [
        { operator_name: 'Sam', runs: 40, completed: 38, joined_runs: 0, last_run_at: '2026-08-20 16:00:00', avg_duration_s: CYCLE_SECONDS },
        { operator_name: 'Jo', runs: 4, completed: 2, joined_runs: 3, last_run_at: '2026-05-02 09:00:00', avg_duration_s: null },
      ],
    }));
    renderDetail('/apps/a-weld?tab=who');

    // The window rollup counts who STARTED a run here.
    expect(await screen.findByText(/Operators who started a run in this window/)).toBeInTheDocument();
    // The all-time panel counts the joiners, and says it ignores the filters.
    const allTime = screen.getByTestId('who-all-time');
    expect(allTime).toHaveTextContent('not narrowed by the filters above');
    const rows = within(allTime).getAllByTestId('who-all-time-row');
    expect(rows[1]).toHaveTextContent('3 joined');
    expect(rows[1]).toHaveTextContent('—');
  });
});

// ── M4: the gate that came with OEE ──────────────────────────────────────────

describe('the OEE tab carries the gate the OEE nav item had', () => {
  const renderAnalytics = (url = '/analytics') =>
    render(<MemoryRouter initialEntries={[url]}><Analytics /></MemoryRouter>);

  it('shows the cards to a supervisor on Pro', async () => {
    userRole = 'manager';
    renderAnalytics('/analytics?tab=oee');
    expect(await screen.findByTestId('oee-panel')).toBeInTheDocument();
    expect(screen.queryByTestId('oee-locked')).toBeNull();
  });

  it('locks the tab on Free and offers the upgrade', async () => {
    planIsFree = true;
    renderAnalytics('/analytics?tab=oee');
    expect(await screen.findByTestId('oee-locked')).toBeInTheDocument();
    expect(screen.queryByTestId('oee-panel')).toBeNull();
    expect(getOEE).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: /Upgrade to Pro/ }));
    expect(await screen.findByTestId('upgrade-modal')).toHaveTextContent('OEE');
  });

  it('hides the tab below supervisor, and lands a deep link on Compare', async () => {
    userRole = 'operator';
    renderAnalytics('/analytics?tab=oee');
    await screen.findByText('App comparison');
    expect(screen.queryByRole('button', { name: /OEE/ })).toBeNull();
    expect(screen.queryByTestId('oee-panel')).toBeNull();
    expect(screen.queryByTestId('oee-locked')).toBeNull();
  });

  it('hides the tab when the production module is switched off', async () => {
    moduleEnabled = key => key !== 'production';
    renderAnalytics();
    await screen.findByText('App comparison');
    expect(screen.queryByRole('button', { name: /OEE/ })).toBeNull();
  });
});

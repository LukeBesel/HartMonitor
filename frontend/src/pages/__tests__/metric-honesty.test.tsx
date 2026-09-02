import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

// ─── "The numbers lie" regressions ────────────────────────────────────────────
// What these lock down on the cross-app comparison screen:
//   • a metric with nothing behind it renders "—" AND the reason, never 0,
//   • durations are formatted in the unit they deserve, so a real 12-second
//     cycle stops reading "0m".
//
// The per-app half of this used to live here too, against the retired
// /apps/:id/history page. One screen reports one app now, and the same rules
// are pinned against it in app-detail-tabs.test.tsx.

import { fmtDuration } from '../../components/apps/appModel';

const getApps = vi.fn();
const getDepartments = vi.fn();
const getProductTypes = vi.fn();
const getOverview = vi.fn();
const getThroughput = vi.fn();
const getCycleTimes = vi.fn();
const getOperatorPerformance = vi.fn();
const getAppPerformance = vi.fn();
const getQualityData = vi.fn();
const getLeaderboard = vi.fn();
const getMaintenanceSummary = vi.fn();
const getAssets = vi.fn();
const getPMSchedules = vi.fn();
const getMaintenanceWorkOrders = vi.fn();

vi.mock('../../api/client', () => ({
  api: {
    get getApps() { return getApps; },
    get getDepartments() { return getDepartments; },
    get getProductTypes() { return getProductTypes; },
    get getOverview() { return getOverview; },
    get getThroughput() { return getThroughput; },
    get getCycleTimes() { return getCycleTimes; },
    get getOperatorPerformance() { return getOperatorPerformance; },
    get getAppPerformance() { return getAppPerformance; },
    get getQualityData() { return getQualityData; },
    get getLeaderboard() { return getLeaderboard; },
    get getMaintenanceSummary() { return getMaintenanceSummary; },
    get getAssets() { return getAssets; },
    getLeaderboardDepartments: vi.fn(() => Promise.resolve({ departments: [], period_label: 'This Week' })),
  },
}));

vi.mock('../../api/maintenance', async importOriginal => ({
  ...(await importOriginal<typeof import('../../api/maintenance')>()),
  getPMSchedules: (...args: unknown[]) => getPMSchedules(...args),
  getMaintenanceWorkOrders: (...args: unknown[]) => getMaintenanceWorkOrders(...args),
}));

vi.mock('../../context/BrandingContext', () => ({
  useBranding: () => ({ companyName: 'Hart Tooling' }),
}));

vi.mock('../../components/shared/ModuleOnboarding', () => ({ default: () => null }));
// App comparison gates its OEE tab on role, plan and the production module —
// the same three the /oee nav item carried. This file is about the Compare
// tab's numbers, so the gate is simply satisfied.
vi.mock('../../context/AuthContext', () => ({
  useAuth: () => ({
    user: { id: 'u-1', email: 'a@b.c', display_name: 'Ana', role: 'manager' },
    canEdit: true, loading: false, isAtLeast: () => true,
  }),
}));
vi.mock('../../context/PlanContext', () => ({
  usePlan: () => ({ isFree: false, isPro: true, refresh: () => {}, plan: null }),
}));
vi.mock('../../context/ModulesContext', () => ({
  useModules: () => ({ isEnabled: () => true, loading: false }),
}));
vi.mock('../../components/analytics/StepMetricsPanel', () => ({ StepMetricsPanel: () => null }));

import Analytics from '../Analytics';

// ── Fixtures ─────────────────────────────────────────────────────────────────

function overview(over: Record<string, unknown> = {}) {
  return {
    totalCompletions: 1, todayCompletions: 1, inProgress: 0,
    totalApps: 1, publishedApps: 1, activeStations: 1,
    avgCycleTime: 0, avgCycleSeconds: 12, passRate: null, qcSampleSize: 0,
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  getApps.mockResolvedValue([]);
  getDepartments.mockResolvedValue([]);
  getProductTypes.mockResolvedValue([]);
  getThroughput.mockResolvedValue([]);
  getCycleTimes.mockResolvedValue([]);
  getOperatorPerformance.mockResolvedValue([]);
  getAppPerformance.mockResolvedValue([]);
  getQualityData.mockResolvedValue([]);
});

// ── The formatter ────────────────────────────────────────────────────────────

describe('fmtDuration spans seconds to hours', () => {
  it('keeps sub-minute work in seconds instead of rounding it away', () => {
    expect(fmtDuration(1)).toBe('1s');
    expect(fmtDuration(12)).toBe('12s');
    expect(fmtDuration(29)).toBe('29s');
    expect(fmtDuration(59)).toBe('59s');
  });

  it('switches unit exactly at the minute and hour boundaries', () => {
    expect(fmtDuration(60)).toBe('1m');
    expect(fmtDuration(61)).toBe('1m 1s');
    expect(fmtDuration(3599)).toBe('59m 59s');
    expect(fmtDuration(3600)).toBe('1h');
    expect(fmtDuration(3660)).toBe('1h 1m');
    expect(fmtDuration(7325)).toBe('2h 2m');
  });

  it('refuses to invent a duration it was not given', () => {
    expect(fmtDuration(null)).toBe('—');
    expect(fmtDuration(undefined)).toBe('—');
    expect(fmtDuration(-5)).toBe('—');
  });
});

// ── App comparison ───────────────────────────────────────────────────────────

describe('App comparison refuses to invent metrics', () => {
  it('renders a sub-minute cycle time in seconds rather than 0m', async () => {
    getOverview.mockResolvedValue(overview({ avgCycleSeconds: 12, avgCycleTime: 0 }));
    render(<MemoryRouter><Analytics /></MemoryRouter>);

    await screen.findByText('Average cycle time');
    await waitFor(() => expect(screen.getByText('12s')).toBeTruthy());
    expect(screen.queryByText('0m')).toBeNull();
  });

  it('shows "—" with a reason when no run has finished and none was inspected', async () => {
    getOverview.mockResolvedValue(overview({
      totalCompletions: 0, todayCompletions: 0, avgCycleSeconds: null, avgCycleTime: null, passRate: null,
    }));
    render(<MemoryRouter><Analytics /></MemoryRouter>);

    await screen.findByText('Average cycle time');
    await waitFor(() => expect(screen.getByText('no completed runs in scope')).toBeTruthy());
    expect(screen.getByText('no pass/fail checks recorded')).toBeTruthy();
    expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(2);
  });

  it('formats operator and app rollups with the same unit rules', async () => {
    getOverview.mockResolvedValue(overview({ passRate: 96, qcSampleSize: 270 }));
    getOperatorPerformance.mockResolvedValue([
      { operator_name: 'Priya Shah', completions: 92, avg_cycle_minutes: 7.9, avg_cycle_seconds: 471 },
      { operator_name: 'Nobody Yet', completions: 0, avg_cycle_minutes: null, avg_cycle_seconds: null },
    ]);
    getAppPerformance.mockResolvedValue([
      { app_id: 'a-1', app_name: 'Torque Log', completions: 3, avg_cycle_minutes: 0.2, avg_cycle_seconds: 12, abandoned_count: 0 },
    ]);
    render(<MemoryRouter><Analytics /></MemoryRouter>);

    await waitFor(() => expect(screen.getByText(/7m 51s avg/)).toBeTruthy());
    expect(screen.getByText(/— avg/)).toBeTruthy();
    expect(screen.getByText(/12s avg/)).toBeTruthy();
  });
});

// ─── One formatter, one unit ─────────────────────────────────────────────────
// The Command Center declared its own `fmtDuration(m: number)` taking MINUTES,
// which shadowed the shared seconds-based one imported everywhere else. When
// the KPI was switched to the new `avg_cycle_seconds` field, the call site
// moved but the formatter did not — so 451 seconds rendered as "7.5h" on the
// most-viewed screen in the product. This pins the unit contract.

describe('the shared duration formatter is the only one', () => {
  it('renders a seven-and-a-half-minute cycle as minutes, never hours', () => {
    // The exact value the audit measured on the public demo.
    expect(fmtDuration(451)).toBe('7m 31s');
    expect(fmtDuration(451)).not.toContain('h');
  });

  it('keeps a sub-minute cycle in seconds', () => {
    // A press, a pick-place or a visual check is routinely under a minute.
    expect(fmtDuration(6)).toBe('6s');
    expect(fmtDuration(12)).toBe('12s');
    expect(fmtDuration(59)).toBe('59s');
  });

  it('only reaches hours at an hour', () => {
    expect(fmtDuration(3599)).toBe('59m 59s');
    expect(fmtDuration(3600)).toBe('1h');
    expect(fmtDuration(27060)).toBe('7h 31m');
  });

  it('says nothing rather than zero when there is nothing to say', () => {
    expect(fmtDuration(null)).toBe('—');
    expect(fmtDuration(undefined)).toBe('—');
  });

  it('Dashboard.tsx declares no duration formatter of its own', async () => {
    // The real guard: a second formatter in that file would shadow the import
    // again, silently, and no assertion above would notice.
    //
    // Resolved from this file's own location, never from process.cwd(). The cwd
    // is whatever directory the runner was started in — `frontend/` for
    // `npm --workspace=frontend`, the repository root for
    // `vitest run --root frontend` — and this assertion is the only thing
    // standing between the codebase and the 60x cycle-time bug coming back, so
    // it has to hold whichever way somebody invokes it. It used to ENOENT under
    // the second form, which is a green suite that silently stopped guarding.
    const fs = await import('node:fs/promises');
    const path = await import('node:path');
    const { fileURLToPath } = await import('node:url');
    const here = path.dirname(fileURLToPath(import.meta.url));
    const src = await fs.readFile(path.join(here, '..', 'Dashboard.tsx'), 'utf8');
    expect(src).not.toMatch(/function\s+fmtDuration\s*\(/);
    // The import may carry other appModel helpers alongside it — what matters
    // is that fmtDuration comes from the one shared module.
    expect(src).toMatch(/import \{[^}]*\bfmtDuration\b[^}]*\} from '\.\.\/components\/apps\/appModel'/);
  });
});


// ─── The leaderboard says which board you are looking at ─────────────────────
// The wall board rotates one board per app × product type, and the server sends
// a board for the runs that named no product type at all. Titled with the bare
// app name, that board and the busy one under it read as the same board with
// two different sets of numbers, ten seconds apart. Worse, it came FIRST: the
// panel in the break room opened on "1 operators · 5 runs".

import Leaderboard from '../Leaderboard';

const LB_BUSY = {
  app_id: 'a1', app_name: 'Torque Check',
  product_type_id: 'p1', product_type_name: 'Rotor',
  qualifying_count: 311, operator_count: 12, excluded_quality_count: 0,
  all_time_best_minutes: 4,
  leaders: [{ rank: 1, operator_name: 'Ana Diaz', best_minutes: 4, avg_minutes: 5, completions: 30, is_record: true }],
};
const LB_UNTYPED = {
  app_id: 'a1', app_name: 'Torque Check',
  product_type_id: null, product_type_name: null,
  qualifying_count: 5, operator_count: 1, excluded_quality_count: 0,
  all_time_best_minutes: 6,
  leaders: [{ rank: 1, operator_name: 'Bo Chen', best_minutes: 6, avg_minutes: 7, completions: 1, is_record: false }],
};
const LB_EMPTY = {
  app_id: 'a2', app_name: 'Final Test',
  product_type_id: null, product_type_name: null,
  qualifying_count: 0, operator_count: 0, excluded_quality_count: 0,
  all_time_best_minutes: null, leaders: [],
};

function renderWallBoard() {
  return render(
    <MemoryRouter initialEntries={['/leaderboard?tv=1']}>
      <Leaderboard />
    </MemoryRouter>,
  );
}

describe('the leaderboard wall board', () => {
  beforeEach(() => {
    getLeaderboard.mockResolvedValue({
      period: 'week', period_label: 'This Week', generated_at: '', boards: [LB_UNTYPED, LB_BUSY, LB_EMPTY],
    });
  });

  it('opens on the board with the most runs, whatever order the payload came in', async () => {
    renderWallBoard();
    expect(await screen.findByText('Torque Check — Rotor')).toBeInTheDocument();
    expect(screen.getByTestId('tv-board-counts')).toHaveTextContent('12 operators · 311 runs');
  });

  it('never rotates onto a board with nothing on it', async () => {
    const { container } = renderWallBoard();
    await screen.findByText('Torque Check — Rotor');
    // Two boards have runs; the third is not in the rotation at all.
    expect(container.querySelectorAll('.rounded-full.transition-all')).toHaveLength(2);
  });

  it("puts each board's scope in its own title", async () => {
    getLeaderboard.mockResolvedValue({
      period: 'week', period_label: 'This Week', generated_at: '', boards: [LB_UNTYPED],
    });
    renderWallBoard();
    // The board of runs that named no product type is a board OF something,
    // and its title says so instead of borrowing the app's bare name.
    expect(await screen.findByText('Torque Check — All products')).toBeInTheDocument();
  });

  it('never prints "1 operators"', async () => {
    getLeaderboard.mockResolvedValue({
      period: 'week', period_label: 'This Week', generated_at: '', boards: [LB_UNTYPED],
    });
    renderWallBoard();
    expect(await screen.findByTestId('tv-board-counts')).toHaveTextContent('1 operator · 5 runs');
  });

  it('counts the same way on the desk as on the wall', async () => {
    const fs = await import('node:fs/promises');
    const path = await import('node:path');
    const { fileURLToPath } = await import('node:url');
    const here = path.dirname(fileURLToPath(import.meta.url));
    const src = await fs.readFile(path.join(here, '..', 'Leaderboard.tsx'), 'utf8');
    // One helper, read by both renderings, off the same board object — so the
    // office page and the panel on the wall cannot word or scope them apart.
    expect(src).toMatch(/function boardCounts\(/);
    expect(src).not.toMatch(/\{board\.operator_count\} operators/);
    expect(src).not.toMatch(/\{board\.qualifying_count\} runs/);
  });
});

// ─── A count and its noun ────────────────────────────────────────────────────
// "1 operators", "1 completions today", "1 stations". Every one of these was a
// hard-coded plural next to a number that can be one.

describe('no screen hard-codes a plural next to a count', () => {
  it('has no "{count} nouns" left on the management screens', async () => {
    const fs = await import('node:fs/promises');
    const path = await import('node:path');
    const { fileURLToPath } = await import('node:url');
    const here = path.dirname(fileURLToPath(import.meta.url));
    const files = [
      ['..', 'Leaderboard.tsx'], ['..', 'DepartmentView.tsx'], ['..', 'DepartmentTV.tsx'],
      ['..', 'Dashboard.tsx'], ['..', 'Andon.tsx'], ['..', 'Maintenance.tsx'],
      ['..', '..', 'components', 'analytics', 'OEEPanel.tsx'],
    ];
    // JSX expressions only — `{n} runs`. A `${…}` inside a template literal is
    // frequently a WORD rather than a count ("No ${statusFilter} calls") or a
    // denominator ("3 of 12 stations"), and flagging those is how a rule like
    // this gets deleted instead of followed.
    const NOUNS = 'operators|runs|completions|calls|stations|entries|jobs|requests|widgets';
    const bad: string[] = [];
    for (const rel of files) {
      const full = path.join(here, ...rel);
      const src = await fs.readFile(full, 'utf8');
      src.split('\n').forEach((line, i) => {
        if (new RegExp(`(^|[^$])\\{[^{}]*\\}\\s+(${NOUNS})\\b`).test(line)) {
          bad.push(`${rel[rel.length - 1]}:${i + 1} ${line.trim().slice(0, 80)}`);
        }
      });
    }
    expect(bad).toEqual([]);
  });
});


// ─── Maintenance raises JOBS, and says what its switches do ──────────────────
// The button read "New WO" on a screen whose tab is called Maintenance Jobs,
// and the PM table's "Auto" column rendered a checkbox beside a bare "0 d" —
// two controls, no words, and nothing saying what either one decided.

import Maintenance from '../Maintenance';

const PM = {
  id: 'pm-1', asset_id: 'as-1', asset_name: 'Press 2', title: 'Grease slides',
  frequency_type: 'days', frequency_value: 30,
  last_completed_at: null, next_due_at: '2026-09-10T08:00:00Z', next_due_reason: null,
  is_overdue: false, assigned_to: 'Bo Chen', estimated_hours: 1,
  auto_create_wo: true, lead_days: 3, open_wo_number: null,
};

describe('the maintenance screen', () => {
  beforeEach(() => {
    getDepartments.mockResolvedValue([]);
    getMaintenanceSummary.mockResolvedValue({
      open_wos: 0, overdue_pms: 0, assets_count: 1, critical_wos: 0, completed_today: 0,
    });
    getAssets.mockResolvedValue([]);
    getMaintenanceWorkOrders.mockResolvedValue([]);
    getPMSchedules.mockResolvedValue([PM]);
  });

  it('calls the thing it raises a job, not a WO', async () => {
    render(<MemoryRouter><Maintenance /></MemoryRouter>);
    await screen.findByRole('button', { name: /Maintenance Jobs/ });
    (await screen.findByRole('button', { name: /Maintenance Jobs/ })).click();
    expect(await screen.findByRole('button', { name: /New job/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /New WO/ })).toBeNull();
  });

  it('says what the PM auto-raise switch does, in words', async () => {
    render(<MemoryRouter><Maintenance /></MemoryRouter>);
    (await screen.findByRole('button', { name: /PM Schedules/ })).click();

    // The column names the behaviour instead of abbreviating it to "Auto"…
    expect(await screen.findByRole('columnheader', { name: /Raises its own job/ })).toBeInTheDocument();
    // …and the number in the cell says what it counts.
    const row = await screen.findByTestId('pm-row-pm-1');
    expect(row).toHaveTextContent('lead');
    expect(row).toHaveTextContent('days');
  });

  it('shows no lead time at all on a schedule nobody raises automatically', async () => {
    getPMSchedules.mockResolvedValue([{ ...PM, auto_create_wo: false, lead_days: 0 }]);
    render(<MemoryRouter><Maintenance /></MemoryRouter>);
    (await screen.findByRole('button', { name: /PM Schedules/ })).click();

    const row = await screen.findByTestId('pm-row-pm-1');
    // A greyed-out "0 d" reads as a setting; this schedule has none.
    expect(row).toHaveTextContent('raised by hand');
    expect(row).not.toHaveTextContent('lead');
  });
});

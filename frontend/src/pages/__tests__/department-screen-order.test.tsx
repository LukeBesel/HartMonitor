import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

// ─── What comes first on a department screen ─────────────────────────────────
// The Team panel is a setup panel: who gets this department's calls.
// It used to sit directly under the header, above every number on the page, and
// its empty state is tall — "Nobody is on this department yet" plus a paragraph
// plus an add-a-teammate form. On a phone that put a whole screen of scrolling
// between the reader and the work they came to look at, on the exact screen
// they open to answer "what is running right now".
//
// So this pins the order rather than the pixels: production first, Team last.
//
// It used to pin that order on a second departments LIST screen. That screen is
// gone — the Command Center is the one live-floor screen and its department
// cards are the way in — so the same rule is pinned where the panel now lives:
// a department's own page, opened from one of those cards.

const getDepartmentView = vi.fn();
const getDepartmentTV = vi.fn();
const getDepartmentMembers = vi.fn();
const getUsers = vi.fn();
const getFloorSnapshot = vi.fn();

vi.mock('../../api/client', () => ({
  api: {
    get getDepartmentView() { return getDepartmentView; },
    get getDepartmentTV() { return getDepartmentTV; },
    get getDepartmentMembers() { return getDepartmentMembers; },
    get getUsers() { return getUsers; },
  },
}));

vi.mock('../../api/floor', () => ({
  getFloorSnapshot: (...args: unknown[]) => getFloorSnapshot(...args),
}));

import DepartmentView from '../DepartmentView';
import DepartmentTV from '../DepartmentTV';

const DEPT_VIEW = {
  department: {
    id: 'd-weld', name: 'Welding', color: '#f59e0b',
    manager_name: 'Ana Diaz', description: '', headcount: 3,
  },
  stations: [],
  work_orders: [
    {
      id: 'wo1', work_order_number: 'WO-1', part_name: 'Weldment', app_name: 'Weld Check',
      quantity: 10, quantity_completed: 2, scheduled_end: '2026-09-03T08:00:00Z',
      priority: 'high', schedule_status: 'on_track', completion_pct: 20,
    },
  ],
  hourly_throughput: [{ hour: '2026-09-02T09:00:00', count: 4 }],
  recent_completions: [],
};

const SNAPSHOT = {
  plant_date: '2026-09-02', timezone: 'UTC',
  finished_today: 7, running_now: 3,
  avg_cycle_seconds: 840, avg_cycle_basis: 'elapsed', avg_cycle_sample: 7,
  avg_cycle_reason: null, avg_cycle_window: 'today',
  pass_rate: 91, pass_rate_sample: 11, pass_rate_reason: null,
  pass_rate_pass: 10, pass_rate_fail: 1, pass_rate_window: 'today',
  open_work_orders: 4, on_track: 2, at_risk: 1, behind: 1, overdue: 0,
  not_started: 0, completed_work_orders: 3, total_work_orders: 7,
  on_track_pct: 50, on_track_reason: null, on_track_basis: 'open_work_orders',
  scope: { site_id: null, department_id: 'd-weld', app_id: null, station_id: null, valid: true },
};

/** The wall board's own payload. Two of the behind-takt rows are the SAME job
 *  (two operations of it open at once) and the leaderboard is three runs by one
 *  operator plus one by another — both shapes the endpoint really returns. */
const TV_DATA = {
  department: { id: 'd-weld', name: 'Welding', color: '#f59e0b', manager_name: 'Ana Diaz' },
  date: '2026-09-02',
  status: { running: 3, completed_today: 7, upcoming: 2 },
  hourly: [{ hour: '09:00', count: 4 }],
  issues: [],
  leaderboard: [
    { operator_name: 'Ana Diaz', app_name: 'Weld Check', duration_minutes: 4, duration_seconds: 240 },
    { operator_name: 'Ana Diaz', app_name: 'Weld Check', duration_minutes: 5, duration_seconds: 300 },
    { operator_name: 'Ana Diaz', app_name: 'Weld Check', duration_minutes: 6, duration_seconds: 360 },
    { operator_name: 'Bo Chen', app_name: 'Weld Check', duration_minutes: 7, duration_seconds: 420 },
  ],
  behind_takt: [
    { work_order_number: 'B5E656-WO-1001', operator_name: 'Ana Diaz', station: 'Cell 1', takt_seconds: 360, over_by_seconds: 120, live: true },
    { work_order_number: 'B5E656-WO-1001', operator_name: 'Ana Diaz', station: 'Cell 1', takt_seconds: 360, over_by_seconds: 540, live: false },
    { work_order_number: 'B5E656-WO-1002', operator_name: 'Bo Chen', station: 'Cell 2', takt_seconds: 360, over_by_seconds: 60, live: true },
  ],
  any_behind: true,
};

beforeEach(() => {
  vi.clearAllMocks();
  // recharts calls `new ResizeObserver(...)`; the shared setup's arrow-function
  // stub is not constructible, and the chart takes the page down with it.
  (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
    observe() {} unobserve() {} disconnect() {}
  };
  getDepartmentView.mockResolvedValue(DEPT_VIEW);
  getDepartmentTV.mockResolvedValue(TV_DATA);
  getFloorSnapshot.mockResolvedValue(SNAPSHOT);
  // The state the owner hit: a department nobody has been added to yet.
  getDepartmentMembers.mockResolvedValue([]);
  getUsers.mockResolvedValue([{ id: 'u-1', display_name: 'Ana Diaz', is_active: true }]);
});

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/departments/d-weld']}>
      <Routes><Route path="/departments/:id" element={<DepartmentView />} /></Routes>
    </MemoryRouter>,
  );
}

/** Where a node sits in document order. */
function positionOf(el: Element): number {
  return [...document.querySelectorAll('*')].indexOf(el);
}

describe('a department screen', () => {
  it('puts the work first and the Team panel last', async () => {
    renderPage();

    const kpis = await screen.findByText('Finished today');
    const stations = screen.getByRole('heading', { name: 'Stations' });
    const workOrders = screen.getByText('Work Orders');
    const team = await screen.findByText('Team');

    expect(positionOf(kpis)).toBeLessThan(positionOf(stations));
    expect(positionOf(stations)).toBeLessThan(positionOf(workOrders));
    expect(positionOf(workOrders)).toBeLessThan(positionOf(team));
  });

  it('keeps the Team panel reachable, not deleted', async () => {
    renderPage();

    await waitFor(() => expect(screen.getByText('Nobody is on this department yet')).toBeInTheDocument());
    // Still fully usable where it now lives.
    expect(screen.getByLabelText('Teammate to add')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /add/i })).toBeInTheDocument();
  });

  it('reads its numbers from the plant snapshot, scoped to this department', async () => {
    renderPage();

    await waitFor(() => expect(getFloorSnapshot).toHaveBeenCalledWith({ department_id: 'd-weld' }));
    // The count and the cycle time are the snapshot's, not a local tally of
    // whatever rows the department endpoint happened to return.
    expect(await screen.findByTestId('dept-finished-today')).toHaveTextContent('7');
    expect(screen.getByText('14m')).toBeInTheDocument();
    expect(screen.getByText('91%')).toBeInTheDocument();
  });

  it('says what its average and its percentage were measured over', async () => {
    renderPage();

    // "97% Pass rate" over what? A percentage with no sample beside it cannot
    // be checked, and a window nobody names is how two screens quoting
    // different windows read as one broken system.
    expect(await screen.findByTestId('dept-pass-rate')).toHaveTextContent('11 inspected runs · today');
    expect(screen.getByTestId('dept-avg-cycle')).toHaveTextContent('7 runs · wall clock · today');
  });

  it('never prints "1 stations"', async () => {
    getDepartmentView.mockResolvedValue({
      ...DEPT_VIEW,
      stations: [{
        id: 's1', name: 'Cell 1', location: '', status: 'active',
        current_status: 'idle', current_status_since: null,
        current_app_id: null, current_app_name: null, active_completion: null,
        oee: { availability: null, performance: null, quality: null, oee: null, completions_today: 0 },
      }],
    });
    renderPage();
    expect(await screen.findByText(/1 station$/)).toBeInTheDocument();
  });

  it('words the on-track share exactly as every other floor screen does', async () => {
    renderPage();
    expect(await screen.findByTestId('dept-on-track'))
      .toHaveTextContent('2 of 4 open work orders on track');
  });

  it('says why, rather than printing a zero, when nothing has been measured', async () => {
    getFloorSnapshot.mockResolvedValue({
      ...SNAPSHOT,
      finished_today: 0, running_now: 0,
      avg_cycle_seconds: null, avg_cycle_sample: 0, avg_cycle_reason: 'no run has finished yet',
      pass_rate: null, pass_rate_sample: 0, pass_rate_reason: 'no pass/fail result recorded yet',
      open_work_orders: 0, on_track: 0, on_track_pct: null,
      on_track_reason: 'no open work order to be on track with',
    });
    renderPage();

    expect(await screen.findByText('no run has finished yet')).toBeInTheDocument();
    expect(screen.getByText('no pass/fail result recorded yet')).toBeInTheDocument();
    expect(screen.getByTestId('dept-on-track'))
      .toHaveTextContent('— no open work order to be on track with');
    // A zero cycle time reads as "instant", which is never what happened.
    expect(screen.queryByText('0m')).toBeNull();
  });
});

// ─── The wall board ───────────────────────────────────────────────────────────

function renderBoard() {
  return render(
    <MemoryRouter initialEntries={['/departments/d-weld/tv']}>
      <Routes><Route path="/departments/:id/tv" element={<DepartmentTV />} /></Routes>
    </MemoryRouter>,
  );
}

describe("a department's wall board", () => {
  it('names one operator once in Fastest Today, with their best run', async () => {
    renderBoard();

    // Ana finished three runs; the board is a leaderboard of PEOPLE, so she is
    // on it once — and at 4m, the run she would want shown.
    const board = await screen.findByTestId('tv-fastest-today');
    expect(within(board).getAllByText('Ana Diaz')).toHaveLength(1);
    expect(within(board).getByText('4m')).toBeInTheDocument();
    expect(within(board).queryByText('5m')).toBeNull();
    expect(within(board).queryByText('6m')).toBeNull();
    // And the second person is not pushed off the board by the first.
    expect(within(board).getByText('Bo Chen')).toBeInTheDocument();
  });

  it('collapses the same job into one behind-takt chip, counted', async () => {
    renderBoard();

    // Two rows, one job: one chip carrying "×2" rather than two identical ones.
    const chip = await screen.findByTitle('2 operations of this job are behind takt');
    expect(chip).toHaveTextContent('×2');
    expect(screen.getAllByText('WO-1001')).toHaveLength(1);
    // The worst overrun of the group is the one that survives.
    expect(screen.getByText('+9m')).toBeInTheDocument();
    expect(screen.queryByText('+2m')).toBeNull();
    // The banner's count matches what the banner lists: two jobs, not three rows.
    expect(screen.getByText('WO-1002')).toBeInTheDocument();
  });

  it("prints the demo work order's 365-second takt as 6m 5s, not 6m 6s", async () => {
    // sqdc.js used to pre-round the WORK ORDER's takt to a tenth of a MINUTE
    // before this board ever saw it, and the demo seeds that takt at 365s: it
    // arrived as 6.1 and fmtMinutes(6.1) printed a "6m 6s" takt, one second
    // nobody measured. The overrun sat on the same six-second grid — 63s over
    // came through as 1.1 min and read out as "1m 6s".
    // Seconds in, seconds out, through the one duration formatter.
    getDepartmentTV.mockResolvedValue({
      ...TV_DATA,
      behind_takt: [{
        work_order_number: 'B5E656-WO-1003', operator_name: 'Cleo Ruiz', station: 'Cell 3',
        takt_seconds: 365, over_by_seconds: 63, live: true,
      }],
    });
    renderBoard();

    expect(await screen.findByText(/over 6m 5s takt/)).toHaveTextContent(
      'Cleo Ruiz @ Cell 3 · over 6m 5s takt (live)');
    expect(screen.queryByText(/6m 6s/)).toBeNull();
    expect(screen.getByText('+1m 3s')).toBeInTheDocument();
    expect(screen.queryByText('+1m 6s')).toBeNull();
  });

  it('prints the id the floor says, with the stored id in the title', async () => {
    renderBoard();

    const id = await screen.findByText('WO-1001');
    expect(id).toHaveAttribute('title', 'B5E656-WO-1001');
    expect(screen.queryByText(/B5E656-WO-1001/)).toBeNull();
  });
});

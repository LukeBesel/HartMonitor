import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

// ─── What comes first on a department screen ─────────────────────────────────
// The Team panel is a setup panel: who gets this department's help requests.
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
const getDepartmentMembers = vi.fn();
const getUsers = vi.fn();
const getFloorSnapshot = vi.fn();

vi.mock('../../api/client', () => ({
  api: {
    get getDepartmentView() { return getDepartmentView; },
    get getDepartmentMembers() { return getDepartmentMembers; },
    get getUsers() { return getUsers; },
  },
}));

vi.mock('../../api/floor', () => ({
  getFloorSnapshot: (...args: unknown[]) => getFloorSnapshot(...args),
}));

import DepartmentView from '../DepartmentView';

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

beforeEach(() => {
  vi.clearAllMocks();
  // recharts calls `new ResizeObserver(...)`; the shared setup's arrow-function
  // stub is not constructible, and the chart takes the page down with it.
  (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
    observe() {} unobserve() {} disconnect() {}
  };
  getDepartmentView.mockResolvedValue(DEPT_VIEW);
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

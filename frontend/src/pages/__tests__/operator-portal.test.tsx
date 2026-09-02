import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

// ─── The portal lists what this operator should actually run ──────────────────
//
// Four things were wrong with the jobs tab, and every one of them was the same
// mistake: the tablet deciding for itself something the server already knew.
//
//   1. It listed WORK ORDERS. A published app attached to no job — 'Final QC
//      Inspection', a real station on a real floor — could not appear at all,
//      so the header said "2 jobs available" about a floor with three things to
//      do. The list is now the server's dispatch queue: ready and running
//      OPERATIONS plus the apps that need no work order, and the header counts
//      what the list shows.
//
//   2. A reload mid-run left a second completion open behind it, and the reaper
//      only closes an abandoned run after twelve hours. An operator who lost
//      signal three times came back to an uncapped pile of identical rows. They
//      are now one row per piece of work, capped, and the stamps are printed in
//      the PLANT's zone rather than raw UTC or the tablet's own guess.
//
//   3. TODAY was counted from the browser clock, so a second-shift crew's tile
//      reset at their own midnight while every management screen carried on
//      with the plant's day. It is now the snapshot's own number, printed
//      verbatim, and '—' with a reason when the server has none.
//
//   4. History rows showed no cycle time at all — on a product whose whole
//      point is gathering cycle times.

const getOperatorRoster = vi.fn();
const getStations = vi.fn();
const getWorkOrders = vi.fn();
const getCompletions = vi.fn();
const request = vi.fn();
const getFloorSnapshot = vi.fn();
const getFloorDispatch = vi.fn();

vi.mock('../../api/client', () => ({
  api: {
    get getOperatorRoster() { return getOperatorRoster; },
    get getStations() { return getStations; },
    get getWorkOrders() { return getWorkOrders; },
    get getCompletions() { return getCompletions; },
  },
  request: (...args: unknown[]) => request(...args),
}));

// api/operator is NOT mocked: dedupeRuns, stampIn and dispatchRowLabel are the
// behaviour under test. Only the two network calls underneath it are.
vi.mock('../../api/floor', () => ({
  getFloorSnapshot: (...args: unknown[]) => getFloorSnapshot(...args),
  getFloorDispatch: (...args: unknown[]) => getFloorDispatch(...args),
  getWip: vi.fn(),
  getWipSummary: vi.fn(),
}));

vi.mock('../../context/AuthContext', () => ({
  useAuth: () => ({
    user: { id: 'mgr-1', email: 'a@b.c', display_name: 'Ana Diaz', role: 'manager' },
    canEdit: true, isAtLeast: () => true, loading: false,
  }),
}));

vi.mock('../../context/MessagesContext', () => ({
  useMessages: () => ({ messages: [], unreadCount: 0, markAllRead: vi.fn(), refresh: vi.fn() }),
}));

vi.mock('../../hooks/useOnlineStatus', () => ({ useOnlineStatus: () => true }));

import OperatorPortal from '../OperatorPortal';
import { fmtDuration } from '../../components/apps/appModel';

const ZONE = 'America/Chicago';

/** One operation on the queue, in the shape /api/floor/dispatch returns. */
function operation(over: Record<string, unknown> = {}) {
  return {
    kind: 'operation',
    no_work_order: false,
    work_order_operation_id: 'op-1',
    work_order_id: 'wo-1',
    work_order_number: 'WO-2026-042',
    part_number: 'PN-BRACKET-9',
    part_name: 'Bracket',
    priority: 'critical',
    due_date: '2026-09-30',
    operation_sequence: 3,
    operation_count: 7,
    operation_name: 'Weld',
    status: 'ready',
    started_at: null,
    quantity_required: 50,
    quantity_completed: 12,
    standard_seconds: 60,
    department_id: 'd-weld',
    department_name: 'Weld',
    department_color: '#3b82f6',
    station_id: null,
    station_name: null,
    app_id: 'app-weld',
    app_name: 'Weld Cell',
    app_reason: null,
    ...over,
  };
}

/** The standing app the old portal could not list at all. */
const STANDING_APP = {
  kind: 'app',
  no_work_order: true,
  work_order_operation_id: null,
  work_order_id: null,
  work_order_number: null,
  part_number: null,
  part_name: null,
  priority: null,
  due_date: null,
  operation_sequence: null,
  operation_count: null,
  operation_name: null,
  status: 'ready',
  started_at: null,
  quantity_required: null,
  quantity_completed: null,
  standard_seconds: null,
  department_id: 'd-weld',
  department_name: 'Weld',
  department_color: '#3b82f6',
  station_id: null,
  station_name: null,
  app_id: 'app-qc',
  app_name: 'Final QC Inspection',
  app_reason: null,
  reason: 'this app needs no work order',
};

function snapshot(over: Record<string, unknown> = {}) {
  return {
    plant_date: '2026-09-02',
    timezone: ZONE,
    finished_today: 12,
    running_now: 3,
    finished_today_for_operator: 4,
    finished_today_for_operator_reason: null,
    avg_cycle_seconds: 451, avg_cycle_basis: 'hands_on', avg_cycle_sample: 12, avg_cycle_reason: null,
    avg_cycle_window: 'today',
    pass_rate: 100, pass_rate_sample: 4, pass_rate_reason: null, pass_rate_pass: 4, pass_rate_fail: 0,
    pass_rate_window: 'today',
    open_work_orders: 3, on_track: 2, at_risk: 1, behind: 0, overdue: 0, not_started: 0,
    completed_work_orders: 1, total_work_orders: 4, on_track_pct: 67, on_track_reason: null,
    on_track_basis: 'open_work_orders',
    scope: { site_id: null, department_id: null, app_id: null, station_id: null, valid: true },
    ...over,
  };
}

function dispatch(rows: unknown[]) {
  return {
    plant_date: '2026-09-02',
    timezone: ZONE,
    statuses: ['ready', 'running'],
    order: 'priority, due date (nulls last), operation sequence',
    rows,
    scope: { site_id: null, department_id: null, app_id: null, station_id: null, valid: true },
  };
}

/** Thirteen open runs over three pieces of work — one tablet reload after
 *  another, exactly what the shift actually produces. */
function thirteenOpenRuns() {
  const pairs = [
    { work_order_id: 'wo-1', work_order_operation_id: 'op-1', app_id: 'app-weld', app_name: 'Weld Cell' },
    { work_order_id: 'wo-2', work_order_operation_id: 'op-2', app_id: 'app-weld', app_name: 'Weld Cell' },
    { work_order_id: null, work_order_operation_id: null, app_id: 'app-qc', app_name: 'Final QC Inspection' },
  ];
  const runs: Record<string, unknown>[] = [];
  for (let i = 0; i < 13; i++) {
    const pair = pairs[i % 3];
    runs.push({
      id: `run-${i}`,
      ...pair,
      station_id: null,
      operator_name: 'Ada Lovelace',
      // 2026-09-02 02:30 UTC — which in Chicago is the evening of the 1st.
      started_at: `2026-09-02 02:${String(30 - i).padStart(2, '0')}:00`,
      completed_at: null,
      status: 'in_progress',
      step_times: {},
    });
  }
  return runs;
}

function renderPortal() {
  return render(
    <MemoryRouter initialEntries={['/operator']}>
      <OperatorPortal />
    </MemoryRouter>,
  );
}

/** Clock in as the one operator on the roster (no PIN configured). */
async function clockIn() {
  const tile = await screen.findByText('Ada Lovelace');
  fireEvent.click(tile);
  await screen.findByTestId('jobs-count');
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  sessionStorage.clear();
  getOperatorRoster.mockResolvedValue([
    { id: 'u-1', display_name: 'Ada Lovelace', has_pin: 0, has_badge: 0 },
  ]);
  getStations.mockResolvedValue([
    { id: 'st-1', name: 'Weld Cell A', status: 'active', department_id: 'd-weld' },
  ]);
  getWorkOrders.mockResolvedValue([]);
  getCompletions.mockResolvedValue([]);
  getFloorSnapshot.mockResolvedValue(snapshot());
  getFloorDispatch.mockResolvedValue(dispatch([
    operation(),
    operation({ work_order_operation_id: 'op-2', work_order_id: 'wo-2', work_order_number: 'WO-2026-043', operation_sequence: 1, operation_count: 4, operation_name: 'Cut', quantity_completed: 0, priority: 'high' }),
    operation({ work_order_operation_id: 'op-3', work_order_id: 'wo-3', work_order_number: 'WO-2026-044', operation_sequence: 2, operation_count: 4, operation_name: 'Deburr', priority: 'medium' }),
    STANDING_APP,
  ]));
  // The only thing api/operator asks the network for directly.
  request.mockImplementation((path: string) => {
    if (typeof path === 'string' && path.includes('status=in_progress')) return Promise.resolve([]);
    return Promise.resolve([]);
  });
});

describe('the jobs tab lists what this operator should run next', () => {
  it('lists three ready operations AND the app that needs no work order', async () => {
    renderPortal();
    await clockIn();

    const rows = await screen.findAllByTestId('job-row');
    expect(rows).toHaveLength(4);

    // The header counts what the LIST shows. It used to count work orders while
    // the list showed something else.
    expect(screen.getByTestId('jobs-count')).toHaveTextContent('4 jobs available');

    // Each operation says which one it is — a fact the job carries, not a
    // caption this screen invented.
    expect(screen.getByText('Op 3 of 7 · Weld')).toBeTruthy();
    expect(screen.getByText('Op 1 of 4 · Cut')).toBeTruthy();
    expect(screen.getByText('Op 2 of 4 · Deburr')).toBeTruthy();

    // And the standing job says it needs none, instead of being absent.
    expect(screen.getByText('No work order needed')).toBeTruthy();
    expect(rows[3].textContent).toContain('Final QC Inspection');
  });

  it('keeps the server\'s order — it does not re-sort the queue', async () => {
    renderPortal();
    await clockIn();
    const rows = await screen.findAllByTestId('job-row');
    const labels = rows.map(r => r.textContent ?? '');
    expect(labels[0]).toContain('WO-2026-042');
    expect(labels[1]).toContain('WO-2026-043');
    expect(labels[2]).toContain('WO-2026-044');
    expect(labels[3]).toContain('Final QC Inspection');
  });

  it('asks the server for the queue at the station this tablet is standing at', async () => {
    localStorage.setItem('hm_station', 'st-1');
    renderPortal();
    await clockIn();
    await waitFor(() => expect(getFloorDispatch).toHaveBeenCalled());
    expect(getFloorDispatch).toHaveBeenCalledWith(expect.objectContaining({ station_id: 'st-1' }));
  });
});

describe('an interrupted job comes back as ONE row', () => {
  beforeEach(() => {
    const runs = thirteenOpenRuns();
    request.mockImplementation((path: string) => {
      if (typeof path === 'string' && path.includes('status=in_progress')) return Promise.resolve(runs);
      return Promise.resolve([]);
    });
  });

  it('shows one Resume row per piece of work, not one per open completion', async () => {
    renderPortal();
    await clockIn();

    // Thirteen open completions over three (work order, operation, app) keys.
    const rows = await screen.findAllByTestId('resume-row');
    expect(rows).toHaveLength(3);
    expect(screen.getAllByText('Resume')).toHaveLength(3);
  });

  it('stamps them in the PLANT\'s timezone, never the tablet\'s or raw UTC', async () => {
    renderPortal();
    await clockIn();
    await screen.findAllByTestId('resume-row');

    // The newest run started 2026-09-02 02:30 UTC. In Chicago that is the
    // evening of September 1st — a different day, on the same instant.
    const stamp = new Intl.DateTimeFormat('en-US', {
      timeZone: ZONE, month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
    }).format(new Date('2026-09-02T02:30:00Z'));
    const utcStamp = new Intl.DateTimeFormat('en-US', {
      timeZone: 'UTC', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
    }).format(new Date('2026-09-02T02:30:00Z'));

    expect(stamp).not.toEqual(utcStamp);
    expect(screen.getByText(`Started ${stamp}`)).toBeTruthy();
    expect(screen.queryByText(`Started ${utcStamp}`)).toBeNull();
  });

  it('caps the list and offers the rest, rather than an uncapped pile', async () => {
    // Six distinct pieces of work — one more than the cap.
    const many = Array.from({ length: 6 }, (_, i) => ({
      id: `run-x-${i}`,
      work_order_id: `wo-x-${i}`,
      work_order_operation_id: `op-x-${i}`,
      app_id: 'app-weld',
      app_name: 'Weld Cell',
      station_id: null,
      operator_name: 'Ada Lovelace',
      started_at: `2026-09-02 0${i}:00:00`,
      completed_at: null,
      status: 'in_progress',
      step_times: {},
    }));
    request.mockImplementation((path: string) =>
      Promise.resolve(typeof path === 'string' && path.includes('status=in_progress') ? many : []));

    renderPortal();
    await clockIn();
    await waitFor(() => expect(screen.getAllByTestId('resume-row')).toHaveLength(5));

    fireEvent.click(screen.getByText('Show all 6'));
    await waitFor(() => expect(screen.getAllByTestId('resume-row')).toHaveLength(6));
  });
});

describe('TODAY is the plant\'s day, measured by the server', () => {
  it('prints the snapshot\'s own number for this operator, verbatim', async () => {
    getCompletions.mockResolvedValue([]);
    renderPortal();
    await clockIn();

    fireEvent.click(screen.getByText('History'));
    const tile = await screen.findByTestId('today-tile');
    // 4 — the server's count for Ada on the plant's day. Nothing on this screen
    // counted rows to get it.
    expect(tile).toHaveTextContent('4');
    expect(tile).toHaveTextContent('2026-09-02');
  });

  it('prints a dash and the reason when the server has no count to give', async () => {
    getFloorSnapshot.mockResolvedValue(snapshot({
      finished_today_for_operator: null,
      finished_today_for_operator_reason: 'no operator on this request',
    }));
    renderPortal();
    await clockIn();

    fireEvent.click(screen.getByText('History'));
    const tile = await screen.findByTestId('today-tile');
    expect(tile).toHaveTextContent('—');
    expect(tile).toHaveTextContent('no operator on this request');
    // A 0 here would read as "you have finished nothing today", which is a
    // different statement from "nobody measured this".
    expect(tile.textContent).not.toMatch(/\b0\b/);
  });

  it('asks the server as this operator, not as the whole plant', async () => {
    renderPortal();
    await clockIn();
    await waitFor(() => expect(getFloorSnapshot).toHaveBeenCalled());
    expect(getFloorSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({ operator_name: 'Ada Lovelace', operator_user_id: 'u-1' }),
    );
  });
});

describe('history says how long each run took', () => {
  it('renders the shared duration formatter\'s string, and its basis', async () => {
    getCompletions.mockResolvedValue([
      {
        id: 'c-1', app_id: 'app-weld', app_name: 'Weld Cell', operator_name: 'Ada Lovelace',
        work_order_id: 'wo-1', started_at: '2026-09-02 01:00:00', completed_at: '2026-09-02 01:07:31',
        status: 'completed', step_times: { 0: 200, 1: 251 },
      },
    ]);
    renderPortal();
    await clockIn();
    fireEvent.click(screen.getByText('History'));

    const duration = await screen.findByTestId('history-duration');
    // 200 + 251 = 451 seconds, through appModel's one formatter: "7m 31s".
    expect(duration).toHaveTextContent(fmtDuration(451));
    expect(duration).toHaveTextContent('7m 31s');
    expect(duration).toHaveTextContent('hands-on');
  });

  it('says — WITH A REASON when a run was never timed', async () => {
    getCompletions.mockResolvedValue([
      {
        id: 'c-2', app_id: 'app-weld', app_name: 'Weld Cell', operator_name: 'Ada Lovelace',
        work_order_id: 'wo-1', started_at: '2026-09-02 01:00:00', completed_at: null,
        status: 'in_progress', step_times: {},
      },
    ]);
    renderPortal();
    await clockIn();
    fireEvent.click(screen.getByText('History'));

    const duration = await screen.findByTestId('history-duration');
    expect(duration.textContent).toContain('—');
    expect(duration.textContent).toContain('still running');
    // Never "0s": a run nobody timed did not take no time.
    expect(duration.textContent).not.toContain('0s');
  });
});

describe('nothing on this screen decides what "today" means', () => {
  it('carries no local clock helper and no local duration formatter', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const src = fs.readFileSync(
      path.resolve(process.cwd(), 'src/pages/OperatorPortal.tsx'), 'utf8',
    );
    // The exact shapes that shipped the bug: a browser-clock "is this today?"
    // and a duration/time formatter of this screen's own.
    expect(src).not.toMatch(/function isToday/);
    expect(src).not.toMatch(/function fmt/);
    // And the tile reads the server's figure by name.
    expect(src).toContain('finished_today_for_operator');
  });
});

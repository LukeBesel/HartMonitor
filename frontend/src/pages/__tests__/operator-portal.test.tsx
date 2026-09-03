import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';

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

/**
 * One open run, in the shape GET /api/completions?status=in_progress ACTUALLY
 * returns on this branch.
 *
 * There is no `work_order_operation_id` on a completion yet — it arrives with
 * the scrap workstream, written by the player from the `op` on the deep link.
 * Every fixture here that omits it is describing today's real payload, and the
 * one that supplies it is describing the day after that column lands.
 */
function openRun(over: Record<string, unknown> = {}) {
  return {
    id: 'run-0',
    app_id: 'app-weld',
    app_name: 'Weld Cell',
    station_id: null,
    work_order_id: 'wo-1',
    operator_name: 'Ada Lovelace',
    // SQLite writes 'YYYY-MM-DD HH:MM:SS' with no zone marker. It is UTC; only
    // the reader can say so, which is the whole point of stampIn.
    started_at: '2026-09-02 02:30:00',
    completed_at: null,
    status: 'in_progress',
    data: {},
    step_times: {},
    last_session: null,
    ...over,
  };
}

/** Thirteen open runs over three pieces of work — one tablet reload after
 *  another, exactly what the shift actually produces. No operation ids: this is
 *  the payload as it is today. */
function thirteenOpenRuns() {
  const pieces = [
    { work_order_id: 'wo-1', app_id: 'app-weld', app_name: 'Weld Cell' },
    { work_order_id: 'wo-2', app_id: 'app-weld', app_name: 'Weld Cell' },
    { work_order_id: null, app_id: 'app-qc', app_name: 'Final QC Inspection' },
  ];
  return Array.from({ length: 13 }, (_, i) => openRun({
    id: `run-${i}`,
    ...pieces[i % 3],
    started_at: `2026-09-02 02:${String(30 - i).padStart(2, '0')}:00`,
  }));
}

/** The current URL, on screen, so a test can assert what a tap navigated to. */
function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location">{location.pathname + location.search}</div>;
}

function renderPortal() {
  return render(
    <MemoryRouter initialEntries={['/operator']}>
      <OperatorPortal />
      <LocationProbe />
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
  getWorkOrders.mockResolvedValue([
    { id: 'wo-1', work_order_number: 'WO-2026-042', part_number: 'PN-BRACKET-9', part_name: 'Bracket',
      quantity: 50, quantity_completed: 12, takt_time_minutes: 0, priority: 'critical',
      status: 'in_progress', app_id: 'app-weld' },
    { id: 'wo-2', work_order_number: 'WO-2026-043', part_number: 'PN-PLATE-2', part_name: 'Plate',
      quantity: 10, quantity_completed: 0, takt_time_minutes: 0, priority: 'high',
      status: 'in_progress', app_id: 'app-weld' },
  ]);
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

  it('resumes THAT run by id, so the player carries on instead of guessing', async () => {
    renderPortal();
    await clockIn();
    await screen.findAllByTestId('resume-row');

    fireEvent.click(screen.getAllByText('Resume')[0]);

    const url = new URL(screen.getByTestId('location').textContent ?? '', 'http://x');
    // run-0 is the newest run on the first (job, operation, app) key, which is
    // the one this row is offering.
    expect(url.searchParams.get('run')).toBe('run-0');
    expect(url.searchParams.get('wo')).toBe('wo-1');
    expect(url.searchParams.get('from')).toBe('operator');
    // A job with several open runs on it: the id is the whole point — without
    // it the player has only 'wo-1' and cannot tell which unit was meant.
    expect(url.pathname).toBe('/play/app-weld');
    // No `op` today: completions do not carry work_order_operation_id on this
    // branch, and inventing one on the link would be worse than omitting it.
    expect(url.searchParams.get('op')).toBeNull();
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

describe('what one Resume row collapses, before and after the operation column', () => {
  // ── M4 ──
  // completions do not carry work_order_operation_id yet; it arrives with the
  // scrap workstream, written by the player from the `op` on the deep link.
  // Both sides of that line are pinned here, so the day the column lands the
  // change in behaviour is visible rather than discovered.

  const twoOperationsOneJob = (withColumn: boolean) => [
    openRun({
      id: 'run-op1', work_order_id: 'wo-1', app_id: 'app-weld',
      started_at: '2026-09-02 02:10:00',
      ...(withColumn ? { work_order_operation_id: 'op-1' } : {}),
    }),
    openRun({
      id: 'run-op4', work_order_id: 'wo-1', app_id: 'app-weld',
      started_at: '2026-09-02 02:30:00',
      ...(withColumn ? { work_order_operation_id: 'op-4' } : {}),
    }),
  ];

  it('TODAY, with no operation on a completion, collapses op 1 and op 4 into one row', async () => {
    const runs = twoOperationsOneJob(false);
    // Sanity: this is the payload shape the API really returns right now.
    expect('work_order_operation_id' in runs[0]).toBe(false);

    request.mockImplementation((path: string) =>
      Promise.resolve(typeof path === 'string' && path.includes('status=in_progress') ? runs : []));

    renderPortal();
    await clockIn();
    await waitFor(() => expect(screen.getAllByTestId('resume-row')).toHaveLength(1));

    // The key is (work order, operation, app) and the operation is missing from
    // both, so it degrades to (work order, app). That is the right trade while
    // the column is absent — the alternative is the pile of identical rows this
    // replaced — and the newest run is the one offered.
    const url = () => new URL(screen.getByTestId('location').textContent ?? '', 'http://x');
    fireEvent.click(screen.getByText('Resume'));
    expect(url().searchParams.get('run')).toBe('run-op4');
  });

  it('AFTER the column lands, the same two runs stay two rows', async () => {
    request.mockImplementation((path: string) =>
      Promise.resolve(typeof path === 'string' && path.includes('status=in_progress')
        ? twoOperationsOneJob(true) : []));

    renderPortal();
    await clockIn();
    await waitFor(() => expect(screen.getAllByTestId('resume-row')).toHaveLength(2));
    // Two operations of one job are two pieces of work, and nothing in
    // dedupeRuns has to change for that to become true.
    expect(screen.getAllByText('Resume')).toHaveLength(2);
  });
});

describe('a Resume row says WHICH job it is', () => {
  // ── M7 ──
  // Four rows reading "Weld Cell · 9:30 PM" are indistinguishable, and the link
  // now resumes one specific run — so the row has to name the job before the
  // operator taps it.
  beforeEach(() => {
    request.mockImplementation((path: string) =>
      Promise.resolve(typeof path === 'string' && path.includes('status=in_progress')
        ? [
          openRun({ id: 'run-a', work_order_id: 'wo-1', started_at: '2026-09-02 02:30:00' }),
          openRun({ id: 'run-b', work_order_id: 'wo-2', started_at: '2026-09-02 02:20:00' }),
        ] : []));
  });

  it('names the work order, the part and the app on every row', async () => {
    renderPortal();
    await clockIn();
    const rows = await screen.findAllByTestId('resume-row');

    expect(rows[0].textContent).toContain('WO-2026-042');
    expect(rows[0].textContent).toContain('Bracket');
    expect(rows[0].textContent).toContain('PN-BRACKET-9');
    expect(rows[1].textContent).toContain('WO-2026-043');
    expect(rows[1].textContent).toContain('Plate');
    // Two rows that a person can actually tell apart.
    expect(rows[0].textContent).not.toEqual(rows[1].textContent);
  });

  it('falls back to the app when a run carries no work order at all', async () => {
    request.mockImplementation((path: string) =>
      Promise.resolve(typeof path === 'string' && path.includes('status=in_progress')
        ? [openRun({ id: 'run-q', work_order_id: null, app_id: 'app-qc', app_name: 'Final QC Inspection' })]
        : []));
    renderPortal();
    await clockIn();
    const rows = await screen.findAllByTestId('resume-row');
    expect(rows[0].textContent).toContain('Final QC Inspection');
  });
});

describe('nothing on this screen reads the tablet’s clock', () => {
  // ── M3 ──
  // The history rows went through `timeAgo`, which parses a zone-less SQLite
  // stamp as the BROWSER's local time: the same finished run read "8 minutes
  // ago" on a kiosk set to UTC and "9 hours ago" on the one somebody had left
  // on Tokyo. Same class of mistake as counting "today" in the browser, three
  // lines below a tile that no longer does.
  const FINISHED = [{
    id: 'c-1', app_id: 'app-weld', app_name: 'Weld Cell', operator_name: 'Ada Lovelace',
    work_order_id: 'wo-1', started_at: '2026-09-02 01:00:00', completed_at: '2026-09-02 01:07:31',
    status: 'completed', step_times: { 0: 200, 1: 251 },
  }];

  /** Render the history tab with the process pretending to be in `tz`. */
  async function historyTextIn(tz: string) {
    const original = process.env.TZ;
    process.env.TZ = tz;
    try {
      getCompletions.mockResolvedValue(FINISHED);
      const view = renderPortal();
      await clockIn();
      fireEvent.click(screen.getByText('History'));
      const row = await screen.findByTestId('history-row');
      const text = row.textContent ?? '';
      view.unmount();
      return text;
    } finally {
      process.env.TZ = original;
    }
  }

  it('renders the same history stamp whatever the device is set to', async () => {
    const inUtc = await historyTextIn('UTC');
    const inTokyo = await historyTextIn('Asia/Tokyo');
    expect(inUtc).toEqual(inTokyo);
    // …and it is the PLANT's zone, which the payload names: 01:07 UTC is the
    // evening of the 1st in Chicago.
    const plant = new Intl.DateTimeFormat('en-US', {
      timeZone: ZONE, month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
    }).format(new Date('2026-09-02T01:07:31Z'));
    expect(inUtc).toContain(`Finished ${plant}`);
    expect(plant).not.toEqual(new Intl.DateTimeFormat('en-US', {
      timeZone: 'UTC', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
    }).format(new Date('2026-09-02T01:07:31Z')));
  });

  it('carries no browser-clock helper of its own', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const src = fs.readFileSync(path.resolve(process.cwd(), 'src/pages/OperatorPortal.tsx'), 'utf8');
    // The exact shape that shipped the bug, kept as a cheap backstop under the
    // render assertions above — those are the real check.
    expect(src).not.toMatch(/function isToday/);
    expect(src).toContain('finished_today_for_operator');
    // Run stamps go through the plant's zone, never `timeAgo`'s local parse.
    expect(src).not.toMatch(/timeAgo\(c\./);
  });
});

describe('a queue row never says the same number twice', () => {
  it('suppresses an operation name that is only its own sequence', async () => {
    // ── MINOR (d) ──
    // The importer and the demo seed both produce routings whose steps are
    // called "Op 1", "Step 2" and so on, which rendered "Op 1 of 4 · Op 1".
    getFloorDispatch.mockResolvedValue(dispatch([
      operation({ work_order_operation_id: 'op-a', operation_sequence: 1, operation_count: 4, operation_name: 'Op 1' }),
      operation({ work_order_operation_id: 'op-b', work_order_number: 'WO-2026-043', operation_sequence: 2, operation_count: 4, operation_name: 'Weld' }),
    ]));
    renderPortal();
    await clockIn();
    await screen.findAllByTestId('job-row');

    expect(screen.getByText('Op 1 of 4')).toBeTruthy();
    expect(screen.queryByText('Op 1 of 4 · Op 1')).toBeNull();
    // A real name still shows.
    expect(screen.getByText('Op 2 of 4 · Weld')).toBeTruthy();
  });
});

describe('the history tiles count what the list shows', () => {
  it('labels the Recent tile as completed when the list also holds open runs', async () => {
    // ── MINOR (e) ──
    getCompletions.mockResolvedValue([
      { id: 'c-1', app_id: 'app-weld', app_name: 'Weld Cell', operator_name: 'Ada Lovelace',
        work_order_id: 'wo-1', started_at: '2026-09-02 01:00:00', completed_at: '2026-09-02 01:07:31',
        status: 'completed', step_times: { 0: 451 } },
      { id: 'c-2', app_id: 'app-weld', app_name: 'Weld Cell', operator_name: 'Ada Lovelace',
        work_order_id: 'wo-1', started_at: '2026-09-02 02:00:00', completed_at: null,
        status: 'in_progress', step_times: {} },
    ]);
    renderPortal();
    await clockIn();
    fireEvent.click(screen.getByText('History'));

    const tile = await screen.findByTestId('recent-tile');
    // One finished of two listed — said, rather than "1 total in history" over
    // a list of two.
    expect(tile).toHaveTextContent('1');
    expect(tile).toHaveTextContent('completed of 2 listed');
    expect(screen.getAllByTestId('history-row')).toHaveLength(2);
  });
});

// ─── Signing in, and the demo's own PINs ─────────────────────────────────────
//
// Two things a visitor dropped into a sandbox used to hit head-on:
//
//   1. The button said "Clock In". This product runs no attendance clock, and a
//      shift-hours feature it does not have is exactly what that promises.
//      Identifying yourself so the work is booked to you is SIGNING IN.
//   2. The PIN pad asked for a PIN nobody had told them. The server knows the
//      session is a sandbox and knows the PINs it minted (`demo_hints` on
//      GET /api/auth/me), so the sandbox says them. A real company sends no
//      hints and the line is not there at all.

/** A roster of one operator who DOES have a PIN, so tapping reaches the pad. */
function rosterWithPin() {
  getOperatorRoster.mockResolvedValue([
    { id: 'u-1', display_name: 'Ada Lovelace', has_pin: 1, has_badge: 0 },
  ]);
}

/** What GET /auth/me answers, alongside the one call api/operator makes. */
function me(payload: unknown) {
  request.mockImplementation((path: string) => {
    if (path === '/auth/me') return Promise.resolve(payload);
    if (typeof path === 'string' && path.includes('status=in_progress')) return Promise.resolve([]);
    return Promise.resolve([]);
  });
}

describe('the sign-in screen', () => {
  it('says Sign in — this product has no attendance clock to clock into', async () => {
    rosterWithPin();
    renderPortal();
    fireEvent.click(await screen.findByText('Ada Lovelace'));

    expect(await screen.findByRole('button', { name: /sign in/i })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /clock in/i })).toBeNull();
  });

  it('asks people to tap their name to sign in', async () => {
    rosterWithPin();
    renderPortal();
    expect(await screen.findByText('Tap your name to sign in')).toBeTruthy();
  });

  it('shows the PINs a SANDBOX hands out, exactly as the server reported them', async () => {
    rosterWithPin();
    me({ id: 'mgr-1', demo_hints: { operator_pin: '1234', supervisor_pin: '2468', manager_pin: '1357' } });
    renderPortal();
    fireEvent.click(await screen.findByText('Ada Lovelace'));

    const hint = await screen.findByTestId('demo-pin-hint');
    expect(hint).toHaveTextContent('Demo PINs · operators 1234 · supervisor 2468');
  });

  it('shows nothing at all when the server sent no hints — a real plant never sees a PIN', async () => {
    rosterWithPin();
    me({ id: 'mgr-1' });
    renderPortal();
    fireEvent.click(await screen.findByText('Ada Lovelace'));

    await screen.findByRole('button', { name: /sign in/i });
    expect(screen.queryByTestId('demo-pin-hint')).toBeNull();
  });

  it('shows nothing when /auth/me fails — a PIN printed by accident is worse than none', async () => {
    rosterWithPin();
    request.mockImplementation((path: string) => {
      if (path === '/auth/me') return Promise.reject(new Error('401'));
      return Promise.resolve([]);
    });
    renderPortal();
    fireEvent.click(await screen.findByText('Ada Lovelace'));

    await screen.findByRole('button', { name: /sign in/i });
    expect(screen.queryByTestId('demo-pin-hint')).toBeNull();
  });
});

// ─── The id on the row is the id on the traveller ────────────────────────────

describe('work order numbers on the jobs list', () => {
  it('drops the company tag a sandbox minted the id with, and keeps it in the title', async () => {
    getFloorDispatch.mockResolvedValue(dispatch([
      operation({ work_order_number: '158D03-WO-1042' }),
    ]));
    renderPortal();
    await clockIn();
    await screen.findAllByTestId('job-row');

    const idCell = screen.getByText(/WO-1042/);
    expect(idCell.textContent).toContain('WO-1042');
    expect(idCell.textContent).not.toContain('158D03');
    expect(idCell).toHaveAttribute('title', '158D03-WO-1042');
  });
});

// ─── The first tap starts the job, it does not open a setup screen ───────────
//
// The picker used to open on "All stations", and a job started with no station
// leaves the player one question still to ask — so the very first tap landed on
// the setup screen instead of step one. That is the dead end this portal exists
// to remove, one step further along.
//
// So the picker opens on the station the operator's own most recent run was
// booked to, and failing that on the only station there is. Both are DEFAULTS
// derived from what the portal has already fetched: they fill a picker nobody
// has answered, and they never talk over an answer that exists.

describe('the station picker opens where this operator actually works', () => {
  const TWO_STATIONS = [
    { id: 'st-1', name: 'Weld Cell A', status: 'active', department_id: 'd-weld' },
    { id: 'st-2', name: 'Weld Cell B', status: 'active', department_id: 'd-weld' },
  ];

  /** Their own open run, booked to a station. */
  function runAt(stationId: string | null) {
    return [openRun({ station_id: stationId })];
  }

  it('defaults to the station of the operator’s most recent run', async () => {
    getStations.mockResolvedValue(TWO_STATIONS);
    request.mockImplementation((path: string) =>
      Promise.resolve(typeof path === 'string' && path.includes('status=in_progress') ? runAt('st-2') : []));

    renderPortal();
    await clockIn();

    const picker = await screen.findByLabelText('Station') as HTMLSelectElement;
    await waitFor(() => expect(picker.value).toBe('st-2'));
    // And the list below matches the picker: a picker naming one station over a
    // queue for the whole plant is the screen contradicting itself.
    await waitFor(() =>
      expect(getFloorDispatch).toHaveBeenCalledWith(expect.objectContaining({ station_id: 'st-2' })));
  });

  it('defaults to the only station a plant has', async () => {
    // One station is not a choice, and asking for it is not a question.
    getStations.mockResolvedValue([TWO_STATIONS[0]]);
    renderPortal();
    await clockIn();

    const picker = await screen.findByLabelText('Station') as HTMLSelectElement;
    await waitFor(() => expect(picker.value).toBe('st-1'));
  });

  it('leaves the picker on All stations when nothing says where this tablet is', async () => {
    // Two stations, no run that names one: there is no answer to derive, and a
    // guess between two cells would book runs to the wrong one.
    getStations.mockResolvedValue(TWO_STATIONS);
    request.mockImplementation((path: string) =>
      Promise.resolve(typeof path === 'string' && path.includes('status=in_progress') ? runAt(null) : []));

    renderPortal();
    await clockIn();
    await screen.findAllByTestId('job-row');

    const picker = screen.getByLabelText('Station') as HTMLSelectElement;
    expect(picker.value).toBe('');
    expect(within(picker).getByRole('option', { name: 'All stations' })).toBeTruthy();
  });

  it('never talks over the station this tablet already remembers', async () => {
    getStations.mockResolvedValue(TWO_STATIONS);
    localStorage.setItem('hm_station', 'st-1');
    request.mockImplementation((path: string) =>
      Promise.resolve(typeof path === 'string' && path.includes('status=in_progress') ? runAt('st-2') : []));

    renderPortal();
    await clockIn();
    await screen.findAllByTestId('job-row');

    const picker = screen.getByLabelText('Station') as HTMLSelectElement;
    expect(picker.value).toBe('st-1');
    expect(getFloorDispatch).not.toHaveBeenCalledWith(expect.objectContaining({ station_id: 'st-2' }));
  });

  it('treats an explicit All stations as an answer, not a gap', async () => {
    // Stored empty, not absent: this operator chose the whole plant on purpose,
    // and a default that reinstated their last cell would undo it every visit.
    getStations.mockResolvedValue(TWO_STATIONS);
    localStorage.setItem('hm_station', '');
    request.mockImplementation((path: string) =>
      Promise.resolve(typeof path === 'string' && path.includes('status=in_progress') ? runAt('st-2') : []));

    renderPortal();
    await clockIn();
    await screen.findAllByTestId('job-row');

    expect((screen.getByLabelText('Station') as HTMLSelectElement).value).toBe('');
  });

  it('keeps a chosen station out of the default’s reach, and remembers it', async () => {
    getStations.mockResolvedValue(TWO_STATIONS);
    renderPortal();
    await clockIn();
    await screen.findAllByTestId('job-row');

    const picker = screen.getByLabelText('Station') as HTMLSelectElement;
    fireEvent.change(picker, { target: { value: 'st-2' } });
    await waitFor(() => expect(picker.value).toBe('st-2'));
    expect(localStorage.getItem('hm_station')).toBe('st-2');

    // Back to the whole plant: still an answer, and it is stored as one.
    fireEvent.change(picker, { target: { value: '' } });
    await waitFor(() => expect(picker.value).toBe(''));
    expect(localStorage.getItem('hm_station')).toBe('');
  });

  it('still says the station is optional', async () => {
    // The station is a filter, not a gate. Every input on this screen keeps its
    // sub-text, and this one has to say the queue narrows with it.
    getStations.mockResolvedValue(TWO_STATIONS);
    renderPortal();
    await clockIn();

    const picker = await screen.findByLabelText('Station');
    const hintId = picker.getAttribute('aria-describedby');
    expect(hintId).toBeTruthy();
    const hint = document.getElementById(hintId as string);
    expect(hint?.textContent).toMatch(/optional/i);
    expect(hint?.textContent).toMatch(/all stations/i);

    // And nothing here grabs focus: an on-screen keyboard over the jobs list is
    // the first thing an operator has to dismiss before they can work.
    expect(document.activeElement).toBe(document.body);
  });
});

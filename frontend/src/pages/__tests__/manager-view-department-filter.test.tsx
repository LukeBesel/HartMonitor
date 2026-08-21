import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

// ─── ManagerView department scoping ───────────────────────────────────────────
// The defect these tests lock down: the page used to filter ONLY the work order
// grid, so picking "Welding" left the four tiles, the live runs and the
// department summary reading plant-wide — numbers that looked like welding's.

const getManagerView = vi.fn();
const getDepartments = vi.fn();

vi.mock('../../api/client', () => ({
  api: {
    get getManagerView() { return getManagerView; },
    get getDepartments() { return getDepartments; },
  },
}));

vi.mock('../../context/SiteContext', () => ({
  useSite: () => ({
    sites: [], selectedSiteId: null, setSelectedSiteId: () => {}, loading: false, refresh: () => {},
  }),
}));

import ManagerView from '../ManagerView';

const WELDING = { id: 'd-weld', name: 'Welding', color: '#f59e0b' };
const PAINT = { id: 'd-paint', name: 'Paint', color: '#3b82f6' };

function wo(over: Record<string, unknown>) {
  return {
    id: 'wo', work_order_number: 'WO-1', part_number: 'P-1', part_name: 'Part',
    app_id: null, quantity: 10, quantity_completed: 0, completion_pct: 0,
    priority: 'medium', schedule_status: 'on_track',
    scheduled_start: '2026-01-01', scheduled_end: '2026-01-02',
    takt_time_minutes: 5, status: 'pending', notes: '',
    ...over,
  };
}

function run(over: Record<string, unknown>) {
  return {
    id: 'r', app_name: 'Weld Cell', operator_name: 'Sam', station_id: null,
    started_at: new Date().toISOString(), work_order_number: 'WO-1', work_order_id: 'wo',
    ...over,
  };
}

// Two departments, four work orders (one of them unassigned) and three live
// runs (one of them ad-hoc, with no work order and so no department).
const PAYLOAD = {
  work_orders: [
    wo({ id: 'wo1', work_order_number: 'WO-1', department_id: 'd-weld', department_name: 'Welding', schedule_status: 'on_track' }),
    wo({ id: 'wo2', work_order_number: 'WO-2', department_id: 'd-weld', department_name: 'Welding', schedule_status: 'behind' }),
    wo({ id: 'wo3', work_order_number: 'WO-3', department_id: 'd-paint', department_name: 'Paint', schedule_status: 'on_track' }),
    wo({ id: 'wo4', work_order_number: 'WO-4', department_id: null, department_name: undefined, schedule_status: 'on_track' }),
  ],
  active_completions: [
    run({ id: 'r1', department_id: 'd-weld', department_name: 'Welding' }),
    run({ id: 'r2', department_id: 'd-paint', department_name: 'Paint' }),
    run({ id: 'r3', work_order_id: null, work_order_number: null, department_id: null, department_name: null }),
  ],
  department_stats: [
    { id: 'd-weld', name: 'Welding', color: '#f59e0b', manager_name: 'Ana', active_count: 1, on_track_count: 1, behind_count: 1, total_work_orders: 2 },
    { id: 'd-paint', name: 'Paint', color: '#3b82f6', manager_name: 'Bo', active_count: 1, on_track_count: 1, behind_count: 0, total_work_orders: 1 },
  ],
};

function renderPage() {
  return render(<MemoryRouter><ManagerView /></MemoryRouter>);
}

const stat = (id: string) => screen.getByTestId(id).textContent;

describe('ManagerView department filter', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
    getManagerView.mockResolvedValue(PAYLOAD);
    getDepartments.mockResolvedValue([WELDING, PAINT]);
  });

  it('reads plant-wide until a department is picked', async () => {
    renderPage();
    await screen.findByTestId('stat-total-wos');

    expect(stat('stat-active-runs')).toBe('3');
    expect(stat('stat-on-track')).toBe('3');   // wo1, wo3, wo4
    expect(stat('stat-behind')).toBe('1');     // wo2
    expect(stat('stat-total-wos')).toBe('4');
    expect(screen.getAllByTestId('active-run')).toHaveLength(3);
    expect(screen.getByTestId('dept-summary-d-weld')).toBeInTheDocument();
    expect(screen.getByTestId('dept-summary-d-paint')).toBeInTheDocument();
  });

  it('scopes every tile, the live runs and the summary to the chosen department', async () => {
    renderPage();
    await screen.findByTestId('stat-total-wos');
    fireEvent.change(await screen.findByLabelText('Department'), { target: { value: 'd-weld' } });

    await waitFor(() => expect(stat('stat-total-wos')).toBe('2'));
    // The whole page moved, not just the grid.
    expect(stat('stat-active-runs')).toBe('1');
    expect(stat('stat-on-track')).toBe('1');
    expect(stat('stat-behind')).toBe('1');
    expect(screen.getAllByTestId('active-run')).toHaveLength(1);
    expect(screen.getByTestId('dept-summary-d-weld')).toBeInTheDocument();
    expect(screen.queryByTestId('dept-summary-d-paint')).toBeNull();
    // Only welding's work orders survive.
    expect(screen.getByText('WO-1')).toBeInTheDocument();
    expect(screen.getByText('WO-2')).toBeInTheDocument();
    expect(screen.queryByText('WO-3')).toBeNull();
    expect(screen.queryByText('WO-4')).toBeNull();
  });

  it('says how many live runs it is holding back for having no department', async () => {
    renderPage();
    await screen.findByTestId('stat-total-wos');
    fireEvent.change(await screen.findByLabelText('Department'), { target: { value: 'd-weld' } });

    // The ad-hoc run is not folded into Welding, and the page says so rather
    // than quietly dropping it.
    expect(await screen.findByText(/1 run hidden — no work order, so no department/)).toBeInTheDocument();
  });

  it('offers a way out when the chosen department is empty but the plant is not', async () => {
    getManagerView.mockResolvedValue({
      ...PAYLOAD,
      work_orders: [wo({ id: 'wo3', work_order_number: 'WO-3', department_id: 'd-paint', department_name: 'Paint' })],
      active_completions: [],
    });
    renderPage();
    await screen.findByTestId('stat-total-wos');
    fireEvent.change(await screen.findByLabelText('Department'), { target: { value: 'd-weld' } });

    expect(await screen.findByText('No work orders in Welding')).toBeInTheDocument();
    expect(screen.getByText('1 work order elsewhere in the plant')).toBeInTheDocument();

    fireEvent.click(screen.getAllByRole('button', { name: 'Show all departments' })[0]);
    await waitFor(() => expect(screen.getByText('WO-3')).toBeInTheDocument());
  });

  it('distinguishes an empty plant from an empty department', async () => {
    getManagerView.mockResolvedValue({ work_orders: [], active_completions: [], department_stats: [] });
    renderPage();

    expect(await screen.findByText('No work orders in the schedule yet')).toBeInTheDocument();
    expect(screen.getByText('No active runs at the moment')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Show all departments' })).toBeNull();
  });
});

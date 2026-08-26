import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

// ─── What comes first on a department screen ─────────────────────────────────
// The Team panel is a setup panel: who gets this department's help requests.
// It used to sit directly under the header, above every number on the page, and
// its empty state is tall — "Nobody is on this department yet" plus a paragraph
// plus an add-a-teammate form. On a phone that put a whole screen of scrolling
// between the reader and the work they came to look at, on the exact screen
// they open to answer "what is running right now".
//
// So this pins the order rather than the pixels: production first, Team last.

const getDepartments = vi.fn();
const getWorkOrders = vi.fn();
const getDepartmentMembers = vi.fn();
const getUsers = vi.fn();

vi.mock('../../api/client', () => ({
  api: {
    get getDepartments() { return getDepartments; },
    get getWorkOrders() { return getWorkOrders; },
    get getDepartmentMembers() { return getDepartmentMembers; },
    get getUsers() { return getUsers; },
  },
}));

vi.mock('../../context/SiteContext', () => ({
  useSite: () => ({
    sites: [], selectedSiteId: null, setSelectedSiteId: () => {}, loading: false, refresh: () => {},
  }),
}));

vi.mock('../../components/shared/ModuleOnboarding', () => ({ default: () => null }));

import Departments from '../Departments';

const DEPARTMENTS = [{ id: 'd-weld', name: 'Welding', color: '#f59e0b' }];

const WORK_ORDERS = [
  {
    id: 'wo1', work_order_number: 'WO-1', part_name: 'Weldment', status: 'in_progress',
    department_id: 'd-weld', quantity: 10, quantity_completed: 2,
    started_at: '2026-08-26T08:00:00Z', scheduled_start: '2026-08-26T08:00:00Z',
    scheduled_end: '2026-08-27T08:00:00Z',
  },
];

beforeEach(() => {
  vi.clearAllMocks();
  getDepartments.mockResolvedValue(DEPARTMENTS);
  getWorkOrders.mockResolvedValue(WORK_ORDERS);
  // The state the owner hit: a department nobody has been added to yet.
  getDepartmentMembers.mockResolvedValue([]);
  getUsers.mockResolvedValue([{ id: 'u-1', display_name: 'Ana Diaz', is_active: true }]);
});

/** Where a node sits in document order. */
function positionOf(el: Element): number {
  return [...document.querySelectorAll('*')].indexOf(el);
}

describe('the Departments screen', () => {
  it('puts the work first and the Team panel last', async () => {
    render(<MemoryRouter><Departments /></MemoryRouter>);

    const cards = await screen.findByText('In progress');
    const running = screen.getByText('Live Running Jobs');
    const upcoming = screen.getByText('Scheduled / Upcoming');
    const team = screen.getByText('Team');

    expect(positionOf(cards)).toBeLessThan(positionOf(running));
    expect(positionOf(running)).toBeLessThan(positionOf(upcoming));
    expect(positionOf(upcoming)).toBeLessThan(positionOf(team));
  });

  it('keeps the Team panel reachable, not deleted', async () => {
    render(<MemoryRouter><Departments /></MemoryRouter>);

    await waitFor(() => expect(screen.getByText('Nobody is on this department yet')).toBeInTheDocument());
    // Still fully usable where it now lives.
    expect(screen.getByLabelText('Teammate to add')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /add/i })).toBeInTheDocument();
  });

  it('names the work-order counters once instead of on every card', async () => {
    render(<MemoryRouter><Departments /></MemoryRouter>);

    // One caption, three short labels — not "Work Orders …" wrapped three deep
    // on a phone.
    expect(await screen.findByText('Work orders in Welding')).toBeInTheDocument();
    expect(screen.getByText('In progress')).toBeInTheDocument();
    expect(screen.getByText('Finished today')).toBeInTheDocument();
    expect(screen.getByText('Not started')).toBeInTheDocument();
  });
});

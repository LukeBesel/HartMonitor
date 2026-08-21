import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

// ─── Andon board summary scoping ──────────────────────────────────────────────
// The defect these tests lock down: GET /andon/summary took no department, so
// picking a department narrowed the cards below while the four KPI tiles kept
// counting the whole company. The page papered over it with a "Plant-wide
// totals" caption and by hiding the per-team badges. Now the endpoint honours
// department_id, so the page asks for the scope it is showing.

const getAndonCalls = vi.fn();
const getAndonSummary = vi.fn();
const getDepartments = vi.fn();

vi.mock('../../api/client', () => ({
  api: {
    get getAndonCalls() { return getAndonCalls; },
    get getAndonSummary() { return getAndonSummary; },
    get getDepartments() { return getDepartments; },
  },
}));

vi.mock('../../context/SiteContext', () => ({
  useSite: () => ({
    sites: [], selectedSiteId: null, setSelectedSiteId: () => {}, loading: false, refresh: () => {},
  }),
}));

import Andon from '../Andon';

const WELDING = { id: 'd-weld', name: 'Welding', color: '#f59e0b' };
const PAINT = { id: 'd-paint', name: 'Paint', color: '#3b82f6' };

// Plant-wide: 3 open (2 quality, 1 supervisor), 1 acknowledged, 2 resolved today.
const PLANT_SUMMARY = {
  open: 3, critical: 0, acknowledged: 1, resolved_today: 2,
  by_type: {}, by_team: { quality: 2, supervisor: 1, maintenance: 1, materials: 0 },
  avg_response_seconds_today: 120, responded_today: 2, department_id: null,
};

// Welding's own slice of the same board.
const WELD_SUMMARY = {
  open: 1, critical: 0, acknowledged: 1, resolved_today: 0,
  by_type: {}, by_team: { quality: 1, supervisor: 0, maintenance: 1, materials: 0 },
  avg_response_seconds_today: null, responded_today: 0, department_id: 'd-weld',
};

function renderPage() {
  return render(<MemoryRouter><Andon /></MemoryRouter>);
}

const stat = (id: string) => screen.getByTestId(id).textContent;

describe('Andon summary department scoping', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
    getDepartments.mockResolvedValue([WELDING, PAINT]);
    getAndonCalls.mockResolvedValue([]);
    getAndonSummary.mockImplementation((params?: { department_id?: string }) =>
      Promise.resolve(params?.department_id === 'd-weld' ? WELD_SUMMARY : PLANT_SUMMARY));
  });

  it('asks for plant-wide totals until a department is picked', async () => {
    renderPage();
    await screen.findByTestId('stat-open');

    expect(getAndonSummary).toHaveBeenCalledWith(undefined);
    expect(stat('stat-open')).toBe('3');
    expect(stat('stat-acknowledged')).toBe('1');
    expect(stat('stat-resolved-today')).toBe('2');
    expect(stat('team-count-quality')).toBe('2');
  });

  it('scopes the KPI cards and the team badges to the chosen department', async () => {
    renderPage();
    await screen.findByTestId('stat-open');
    fireEvent.change(await screen.findByLabelText('Department'), { target: { value: 'd-weld' } });

    await waitFor(() => expect(getAndonSummary).toHaveBeenLastCalledWith({ department_id: 'd-weld' }));
    // The list and the tiles now describe the same slice of the plant.
    expect(getAndonCalls).toHaveBeenLastCalledWith(expect.objectContaining({ department_id: 'd-weld' }));

    await waitFor(() => expect(stat('stat-open')).toBe('1'));
    expect(stat('stat-resolved-today')).toBe('0');
    // The badge is Welding's queue, not the plant's — and it is no longer hidden.
    expect(stat('team-count-quality')).toBe('1');
    expect(screen.queryByTestId('team-count-supervisor')).toBeNull();
  });

  it('names the scope instead of disclaiming the numbers', async () => {
    renderPage();
    await screen.findByTestId('stat-open');
    fireEvent.change(await screen.findByLabelText('Department'), { target: { value: 'd-weld' } });

    expect(await screen.findByText(/Scoped to Welding/)).toBeInTheDocument();
    expect(screen.queryByText(/Plant-wide totals/)).toBeNull();
  });

  it('still reports an unanswered department as unanswered, never as zero seconds', async () => {
    renderPage();
    await screen.findByTestId('stat-open');
    fireEvent.change(await screen.findByLabelText('Department'), { target: { value: 'd-weld' } });

    // Nothing was acknowledged in Welding today: avg_response_seconds_today is
    // null, and the card says so rather than showing a made-up 0m.
    await waitFor(() => expect(stat('stat-avg-response')).toBe('Nothing answered yet'));
  });
});

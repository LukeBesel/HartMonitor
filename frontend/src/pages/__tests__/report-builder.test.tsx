import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

// ─── One report builder ───────────────────────────────────────────────────────
// "Dashboard" used to name five things: the Command Center (/dashboard), the
// saved-report list (/dashboards), one saved report (/dashboards/:id), a
// workspace's Reports page (/reports/:category) — which rendered the SAME saved
// report behind its own header, error card and skeleton, so one object looked
// like two — and a metric literally named "Avg Cycle Time (min)" that printed
// its own separately-rounded number.
//
// What this locks down:
//   • /reports/:category and /dashboards/:id render the same view, same cards;
//   • a duration in a report card reads exactly like a duration anywhere else
//     (fmtDuration — the one formatter, the one used by the per-app screen);
//   • a metric with nothing behind it renders "—" AND says why, never 0;
//   • the list screen calls a saved thing a report, never a dashboard.

import { fmtDuration } from '../../components/apps/appModel';

const getDashboard = vi.fn();
const getDashboardData = vi.fn();
const getCategoryDashboard = vi.fn();
const getDashboards = vi.fn();
const getApps = vi.fn();
const getDepartments = vi.fn();
const getSites = vi.fn();

vi.mock('../../api/client', () => ({
  api: {
    get getDashboard() { return getDashboard; },
    get getDashboardData() { return getDashboardData; },
    get getCategoryDashboard() { return getCategoryDashboard; },
    get getDashboards() { return getDashboards; },
    get getApps() { return getApps; },
    get getDepartments() { return getDepartments; },
    get getSites() { return getSites; },
    loadSampleData: vi.fn(),
    createDashboard: vi.fn(),
    updateDashboard: vi.fn(),
    deleteDashboard: vi.fn(),
  },
}));

vi.mock('../../components/shared/ModuleOnboarding', () => ({ default: () => null }));
vi.mock('../../context/AuthContext', () => ({
  useAuth: () => ({
    user: { id: 'u-1', email: 'a@b.c', display_name: 'Ana', role: 'manager', display_role: 'Manager' },
    canEdit: true, loading: false, isAtLeast: () => true,
  }),
}));
vi.mock('../../context/PlanContext', () => ({
  usePlan: () => ({ isFree: false, isPro: true, refresh: () => {}, plan: null }),
}));

import DashboardView, { seriesValueText } from '../DashboardView';
import CategoryReports from '../CategoryReports';
import Dashboards from '../Dashboards';

// ── Fixtures ─────────────────────────────────────────────────────────────────

const REPORT_ID = 'rep-1';

// One saved report, reached two ways. The SAME row is what the category
// endpoint hands back and what /dashboards/:id loads.
const REPORT = {
  id: REPORT_ID,
  name: 'Production Reports',
  description: 'Throughput and cycle time',
  category: 'production',
  updated_at: new Date().toISOString(),
  cards: [
    { id: 'c-cycle', type: 'metric', title: 'Avg Cycle Time', metric_key: 'avg_cycle', size: 'sm' },
    { id: 'c-pass',  type: 'metric', title: 'Pass Rate',      metric_key: 'pass_rate', size: 'sm' },
    { id: 'c-trend', type: 'time_series', title: 'Cycle Time Trend', series: 'cycle_time', size: 'md' },
  ],
};

/** A 30-second average, the way the backend now reports one. */
function cardData(over: Record<string, unknown> = {}) {
  return {
    cards: [
      {
        card_id: 'c-cycle',
        data: {
          unit: 'duration', value: 0.5, seconds: 30,
          avg_cycle_seconds: 30, avg_cycle_basis: 'hands_on', sample_size: 4, suffix: 'm',
        },
      },
      {
        card_id: 'c-pass',
        data: { unit: 'percent', value: null, empty_reason: 'No pass/fail results recorded yet' },
      },
      {
        // The same 30 seconds the tile shows, as the chart carries it: minutes.
        card_id: 'c-trend',
        data: { unit: 'minutes', series: [{ name: 'Avg Cycle', data: [{ date: '2026-09-01', value: 0.5 }] }] },
      },
    ],
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  getApps.mockResolvedValue([]);
  getDepartments.mockResolvedValue([]);
  getSites.mockResolvedValue([]);
  getDashboard.mockResolvedValue(REPORT);
  getCategoryDashboard.mockResolvedValue(REPORT);
  getDashboardData.mockResolvedValue(cardData());
  getDashboards.mockResolvedValue([]);
});

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/reports/:category" element={<CategoryReports />} />
        <Route path="/dashboards/:id" element={<DashboardView />} />
        <Route path="/dashboards" element={<Dashboards />} />
      </Routes>
    </MemoryRouter>,
  );
}

/** The text of every card title on screen, in order. */
async function cardTitles(): Promise<string[]> {
  await screen.findByText('Avg Cycle Time');
  return REPORT.cards.map(c => c.title).filter(t => !!screen.queryByText(t));
}

// ── One report, one screen ───────────────────────────────────────────────────

describe('a workspace Reports page IS a saved report', () => {
  it('resolves /reports/:category to the report view, with no chrome of its own', async () => {
    renderAt('/reports/production');
    await waitFor(() => expect(getCategoryDashboard).toHaveBeenCalledWith('production'));
    // The report's own heading, from DashboardView — not a second one.
    const headings = await screen.findAllByRole('heading', { name: 'Production Reports' });
    expect(headings).toHaveLength(1);
    // And it loaded the same report id the direct URL would.
    await waitFor(() => expect(getDashboardData).toHaveBeenCalled());
    expect(getDashboardData.mock.calls[0][0]).toBe(REPORT_ID);
  });

  it('renders the same cards at /reports/production and /dashboards/<its id>', async () => {
    const viaCategory = renderAt('/reports/production');
    const fromCategory = await cardTitles();
    viaCategory.unmount();

    const viaId = renderAt(`/dashboards/${REPORT_ID}`);
    const fromId = await cardTitles();
    viaId.unmount();

    expect(fromCategory).toEqual(['Avg Cycle Time', 'Pass Rate', 'Cycle Time Trend']);
    expect(fromId).toEqual(fromCategory);
  });
});

// ── A duration is a duration ─────────────────────────────────────────────────

describe('a duration in a report card', () => {
  it('reads exactly like a duration anywhere else in the product', async () => {
    renderAt(`/dashboards/${REPORT_ID}`);
    await screen.findByText('Avg Cycle Time');
    // 30 seconds. Not "0.5m", and not a 30 with a stray "m" beside it.
    const expected = fmtDuration(30);
    expect(expected).toBe('30s');
    await waitFor(() => expect(screen.getByText(expected)).toBeTruthy());
    expect(screen.queryByText('0.5')).toBeNull();
  });

  it('reads the same in the chart beside it — axis, tooltip and tile agree', async () => {
    // jsdom gives a Recharts chart no width, so the tooltip cannot be read from
    // the DOM. Both the axis tickFormatter and the tooltip formatter are this
    // one function, and it is compared here against the string the per-app
    // screen prints for the same fixture.
    expect(seriesValueText('minutes', 0.5)).toBe(fmtDuration(30));
    expect(seriesValueText('minutes', 0.5)).toBe('30s');
    expect(seriesValueText('minutes', 6.0167)).toBe(fmtDuration(361));
    // A count is not a duration and is not dressed up as one.
    expect(seriesValueText('count', 63)).toBe('63');
    expect(seriesValueText(undefined, 63)).toBe('63');
  });

  it('formats an older payload (no unit field) exactly the same way', async () => {
    // Additive rollout: a backend from before `unit` still sends suffix 'm'
    // plus the seconds it averaged, and the card must not start re-rounding.
    getDashboardData.mockResolvedValue({
      cards: [{ card_id: 'c-cycle', data: { value: 0.5, seconds: 30, suffix: 'm' } }],
    });
    renderAt(`/dashboards/${REPORT_ID}`);
    await screen.findByText('Avg Cycle Time');
    await waitFor(() => expect(screen.getByText('30s')).toBeTruthy());
  });
});

// ── Nothing behind a number ──────────────────────────────────────────────────

describe('a metric with no data', () => {
  it('renders an em dash and the reason, never a zero', async () => {
    renderAt(`/dashboards/${REPORT_ID}`);
    const reason = await screen.findByText('No pass/fail results recorded yet');
    expect(reason).toBeTruthy();
    const card = reason.closest('div')!.parentElement!;
    expect(within(card).getByText('—')).toBeTruthy();
    expect(within(card).queryByText('0')).toBeNull();
  });
});

// ── The word on the list screen ──────────────────────────────────────────────

describe('the Report Builder list', () => {
  it('calls a saved item a report, never a dashboard', async () => {
    renderAt('/dashboards');
    await screen.findByRole('heading', { name: 'Report Builder' });
    const body = document.body.textContent ?? '';
    // "dashboard" as a noun for the saved thing is gone from this screen. The
    // Command Center keeps the word; it is not on this page.
    expect(body.toLowerCase()).not.toContain('dashboard');
    expect(body).toContain('No reports yet');
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { AppAnalyticsResponse } from '../../api/client';

// ─── Apps → Dashboard ─────────────────────────────────────────────────────────
// What these lock down: the page opens on the app you last ran (and then on the
// one you picked), and it never prints a number the data didn't earn — a
// zero-run app says so instead of showing 0% and an average of nothing.

const getApps = vi.fn();
const getAppsStats = vi.fn();
const getAppAnalytics = vi.fn();
const getDepartments = vi.fn();
const downloadAppAnalyticsCsv = vi.fn();

vi.mock('../../api/client', () => ({
  api: {
    get getApps() { return getApps; },
    get getAppsStats() { return getAppsStats; },
    get getAppAnalytics() { return getAppAnalytics; },
    get getDepartments() { return getDepartments; },
    get downloadAppAnalyticsCsv() { return downloadAppAnalyticsCsv; },
  },
}));

let currentUserId = 'u-1';

vi.mock('../../context/AuthContext', () => ({
  useAuth: () => ({
    user: { id: currentUserId, email: 'a@b.c', display_name: 'Ana', role: 'manager' },
    canEdit: true, isAtLeast: () => true, loading: false,
  }),
}));

vi.mock('../../context/ToastContext', () => ({
  useToast: () => ({ addToast: () => {} }),
}));

vi.mock('../../context/SiteContext', () => ({
  useSite: () => ({
    sites: [], selectedSiteId: null, setSelectedSiteId: () => {}, loading: false, refresh: () => {},
  }),
}));

import AppsDashboard from '../AppsDashboard';

// ── Fixtures ─────────────────────────────────────────────────────────────────

function appRow(over: Record<string, unknown>) {
  return {
    description: '', status: 'published', steps: [], variables: [],
    created_at: '2026-01-01 00:00:00', updated_at: '2026-01-01 00:00:00',
    department_id: null, ...over,
  };
}

const APPS = [
  appRow({ id: 'a-torque', name: 'Torque Check' }),
  appRow({ id: 'a-weld', name: 'Weld Inspection', department_id: 'd-weld' }),
  appRow({ id: 'a-new', name: 'Brand New App' }),
];

const STATS = {
  company_has_completions: true,
  apps: [
    { app_id: 'a-torque', runs_total: 40, runs_7d: 3, in_progress: 0, last_run_at: '2026-08-01 09:00:00' },
    // Most recently run — this is the one the page must open on.
    { app_id: 'a-weld', runs_total: 12, runs_7d: 5, in_progress: 1, last_run_at: '2026-08-20 16:00:00' },
    { app_id: 'a-new', runs_total: 0, runs_7d: 0, in_progress: 0, last_run_at: null },
  ],
};

function analytics(over: Partial<AppAnalyticsResponse> & { app_id: string }): AppAnalyticsResponse {
  return {
    app_name: 'App', days: 30,
    totals: { runs: 0, completed: 0, abandoned: 0, avg_duration_s: null, avg_duration_basis: null, first_pass_yield: null },
    series: [], by_operator: [], fields: [],
    filter_options: { operators: [], work_orders: [], product_types: [] },
    recent_runs: [],
    ...over,
  };
}

const WELD_DATA = analytics({
  app_id: 'a-weld',
  app_name: 'Weld Inspection',
  totals: { runs: 10, completed: 8, abandoned: 2, avg_duration_s: 125, avg_duration_basis: 'hands_on', first_pass_yield: 87.5 },
  by_operator: [{ operator_name: 'Sam', runs: 6, avg_duration_s: 120 }],
  fields: [{
    widget_id: 'w-torque', label: 'Torque reading', type: 'number-input', step_name: 'Fasten',
    kind: 'number', stats: { avg: 12.5, min: 10, max: 15, count: 8 },
  }],
  filter_options: {
    operators: ['Sam', 'Kim'],
    work_orders: [{ id: 'wo-1', work_order_number: 'WO-1' }],
    product_types: [{ id: 'pt-1', name: 'Bracket' }],
  },
  recent_runs: [{
    id: 'c-1', started_at: '2026-08-20 16:00:00', completed_at: '2026-08-20 16:02:05',
    status: 'completed', operator_name: 'Sam', duration_s: 125, duration_basis: 'hands_on',
    work_order_number: 'WO-1', product_type_name: 'Bracket',
  }],
});

function renderPage() {
  return render(<MemoryRouter><AppsDashboard /></MemoryRouter>);
}

const appSelect = () => screen.getByLabelText('App') as HTMLSelectElement;

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
  currentUserId = 'u-1';
  getApps.mockResolvedValue(APPS);
  getAppsStats.mockResolvedValue(STATS);
  getDepartments.mockResolvedValue([]);
  getAppAnalytics.mockImplementation((id: string) => {
    if (id === 'a-weld') return Promise.resolve(WELD_DATA);
    if (id === 'a-torque') return Promise.resolve(analytics({ app_id: 'a-torque', app_name: 'Torque Check' }));
    return Promise.resolve(analytics({ app_id: 'a-new', app_name: 'Brand New App' }));
  });
});

// ── Which app the page opens on ──────────────────────────────────────────────

describe('AppsDashboard app selector', () => {
  it('opens on the most recently run app instead of asking first', async () => {
    renderPage();
    await waitFor(() => expect(appSelect().value).toBe('a-weld'));
    expect(await screen.findByText('Torque reading')).toBeInTheDocument();
  });

  it('remembers the picked app for this user across visits', async () => {
    const first = renderPage();
    await waitFor(() => expect(appSelect().value).toBe('a-weld'));

    fireEvent.change(appSelect(), { target: { value: 'a-torque' } });
    await waitFor(() => expect(getAppAnalytics).toHaveBeenCalledWith('a-torque', expect.anything()));
    first.unmount();

    renderPage();
    await waitFor(() => expect(appSelect().value).toBe('a-torque'));
  });

  it("keeps one user's choice off another user's screen", async () => {
    const first = renderPage();
    await waitFor(() => expect(appSelect().value).toBe('a-weld'));
    fireEvent.change(appSelect(), { target: { value: 'a-torque' } });
    await waitFor(() => expect(appSelect().value).toBe('a-torque'));
    first.unmount();

    currentUserId = 'u-2';
    renderPage();
    // A different person gets the honest default, not Ana's leftover pick.
    await waitFor(() => expect(appSelect().value).toBe('a-weld'));
  });

  it('falls back to the default when the remembered app is gone', async () => {
    localStorage.setItem('hm_appdash_app_u-1', 'a-deleted');
    renderPage();
    await waitFor(() => expect(appSelect().value).toBe('a-weld'));
  });

  it("never shows the previous app's numbers under the new app's name", async () => {
    const pending: { resolve?: (value: AppAnalyticsResponse) => void } = {};
    getAppAnalytics.mockImplementation((id: string) => {
      if (id === 'a-weld') return Promise.resolve(WELD_DATA);
      return new Promise<AppAnalyticsResponse>(resolve => { pending.resolve = resolve; });
    });

    renderPage();
    expect(await screen.findByText('Torque reading')).toBeInTheDocument();

    fireEvent.change(appSelect(), { target: { value: 'a-torque' } });
    // While the new app's data is in flight the old field list is gone, not
    // relabelled under the new app.
    await waitFor(() => expect(screen.queryByText('Torque reading')).toBeNull());
    expect(screen.getByText('Loading run data…')).toBeInTheDocument();

    pending.resolve?.(analytics({ app_id: 'a-torque', app_name: 'Torque Check' }));
  });
});

// ── Honesty about missing data ───────────────────────────────────────────────

describe('AppsDashboard honesty', () => {
  it('says an app has no runs rather than showing 0% and an average of nothing', async () => {
    localStorage.setItem('hm_appdash_app_u-1', 'a-new');
    renderPage();

    expect(await screen.findByText('"Brand New App" has no runs yet')).toBeInTheDocument();
    expect(screen.queryByTestId('app-dashboard-metrics')).toBeNull();
    expect(screen.queryByText(/0%/)).toBeNull();
    expect(screen.getByRole('link', { name: /Run it in the player/ })).toHaveAttribute('href', '/play/a-new');
  });

  it('distinguishes an app that has not run lately from one that never ran', async () => {
    getAppAnalytics.mockResolvedValue(analytics({ app_id: 'a-weld', app_name: 'Weld Inspection' }));
    renderPage();

    expect(await screen.findByText('No runs of "Weld Inspection" in the last 30 days')).toBeInTheDocument();
    expect(screen.getByText(/It has run before/)).toBeInTheDocument();
    expect(screen.queryByText(/has no runs yet/)).toBeNull();
  });

  it('blames the filters when filters are what emptied the page', async () => {
    renderPage();
    await screen.findByText('Torque reading');

    getAppAnalytics.mockResolvedValue(analytics({
      app_id: 'a-weld', app_name: 'Weld Inspection', filter_options: WELD_DATA.filter_options,
    }));
    fireEvent.change(screen.getByLabelText('Operator'), { target: { value: 'Kim' } });

    expect(await screen.findByText('No runs match these filters')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Show all runs' }));
    await waitFor(() => expect(getAppAnalytics).toHaveBeenLastCalledWith('a-weld', {
      days: 30, operator: undefined, work_order_id: undefined, product_type_id: undefined,
    }));
  });

  it('reads an unmeasured yield as a dash, not a zero', async () => {
    getAppAnalytics.mockResolvedValue(analytics({
      ...WELD_DATA,
      totals: { runs: 10, completed: 8, abandoned: 2, avg_duration_s: 125, avg_duration_basis: 'hands_on', first_pass_yield: null },
    }));
    renderPage();

    await waitFor(() => expect(screen.getByTestId('metric-first_pass_yield')).toHaveTextContent('—'));
    expect(screen.getByText('no pass/fail check recorded')).toBeInTheDocument();
    // The measured numbers still read as measured.
    expect(screen.getByTestId('metric-runs')).toHaveTextContent('10');
    expect(screen.getByTestId('metric-avg_cycle')).toHaveTextContent('2m 5s');
  });

  it('leaves an unfinished run without a duration instead of calling it zero', async () => {
    getAppAnalytics.mockResolvedValue(analytics({
      ...WELD_DATA,
      recent_runs: [{
        id: 'c-2', started_at: '2026-08-20 16:00:00', completed_at: null, status: 'in_progress',
        operator_name: 'Sam', duration_s: null, duration_basis: null,
        work_order_number: null, product_type_name: null,
      }],
    }));
    renderPage();

    const row = await screen.findByTestId('dashboard-run-row');
    expect(row).toHaveTextContent('In progress');
    expect(row.querySelector('[title="run has not finished"]')).not.toBeNull();
    expect(row).not.toHaveTextContent('0s');
  });

  it('points a company with no apps at building one', async () => {
    getApps.mockResolvedValue([]);
    getAppsStats.mockResolvedValue({ company_has_completions: false, apps: [] });
    renderPage();

    expect(await screen.findByText('No apps yet')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Build an app/ })).toHaveAttribute('href', '/apps?new=1');
  });
});

// ── Filters ──────────────────────────────────────────────────────────────────

describe('AppsDashboard filters', () => {
  it('sends only the four parameters the analytics endpoint honours', async () => {
    renderPage();
    await screen.findByText('Torque reading');

    fireEvent.change(screen.getByLabelText('Operator'), { target: { value: 'Sam' } });
    fireEvent.change(screen.getByLabelText('Product type'), { target: { value: 'pt-1' } });
    fireEvent.click(screen.getByRole('button', { name: '7d' }));

    await waitFor(() => expect(getAppAnalytics).toHaveBeenLastCalledWith('a-weld', {
      days: 7, operator: 'Sam', work_order_id: undefined, product_type_id: 'pt-1',
    }));
  });

  it("drops the previous app's operator when the app changes", async () => {
    renderPage();
    await screen.findByText('Torque reading');
    fireEvent.change(screen.getByLabelText('Operator'), { target: { value: 'Sam' } });
    await waitFor(() => expect(getAppAnalytics).toHaveBeenLastCalledWith('a-weld', expect.objectContaining({ operator: 'Sam' })));

    fireEvent.change(appSelect(), { target: { value: 'a-torque' } });
    // Sam is a fact about the weld app's runs, not a choice about this one.
    await waitFor(() => expect(getAppAnalytics).toHaveBeenLastCalledWith('a-torque', {
      days: 30, operator: undefined, work_order_id: undefined, product_type_id: undefined,
    }));
  });

  it('hands the current slice to the full analytics page', async () => {
    renderPage();
    await screen.findByText('Torque reading');
    fireEvent.change(screen.getByLabelText('Operator'), { target: { value: 'Sam' } });

    await waitFor(() => expect(screen.getByRole('link', { name: /Full analytics/ }))
      .toHaveAttribute('href', '/apps/a-weld/analytics?days=30&operator=Sam'));
  });

  it('scopes the app picker by department without touching the numbers', async () => {
    getDepartments.mockResolvedValue([{ id: 'd-weld', name: 'Welding' }]);
    renderPage();
    await screen.findByText('Torque reading');

    fireEvent.change(await screen.findByLabelText('Department'), { target: { value: 'd-weld' } });

    // Only the welding app is offered, and the analytics request is unchanged —
    // the endpoint has no department dimension, so nothing fake is sent.
    await waitFor(() => expect(appSelect().options).toHaveLength(1));
    expect(appSelect().options[0].textContent).toContain('Weld Inspection');
    for (const call of getAppAnalytics.mock.calls) {
      expect(Object.keys(call[1] as object)).toEqual(['days', 'operator', 'work_order_id', 'product_type_id']);
    }
  });
});

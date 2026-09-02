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
  },
}));

vi.mock('../../components/shared/ModuleOnboarding', () => ({ default: () => null }));
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

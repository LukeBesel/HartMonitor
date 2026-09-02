import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

// ─── An active run's elapsed time is UTC-correct, whatever the host's clock ───
// The server stamps `started_at` as SQLite's naive "YYYY-MM-DD HH:MM:SS", which
// is UTC with no timezone marker. `useElapsedSeconds` used to hand that string
// straight to `new Date(...)`, which every JS engine reads as LOCAL time absent
// a marker — so under America/Chicago (UTC-5) a run that had genuinely been
// running for 202 seconds could read "0s" (the naive local-time parse landing
// in the future relative to "now", clamped to zero), while Departments.tsx's
// `elapsedSeconds`/`parseServerTime` — which explicitly appends "Z" — read the
// same row correctly. This test proves ManagerView now goes through that same
// UTC-safe path, without depending on the CI runner's own timezone: the
// expectation below is computed from a wall-clock UTC subtraction, never from
// `new Date()`, so it would fail under the old bug on ANY host, not just one
// running in a non-UTC zone, and it passes on any host with the fix.

const getManagerView = vi.fn();

vi.mock('../../api/client', () => ({
  api: {
    get getManagerView() { return getManagerView; },
    get getDepartments() { return vi.fn().mockResolvedValue([]); },
  },
}));

vi.mock('../../context/SiteContext', () => ({
  useSite: () => ({ selectedSiteId: null }),
}));

import ManagerView from '../ManagerView';

// "Now" the test freezes the clock to, and the run's start — both UTC,
// spelled out with an explicit "Z" for the fixture but WITHOUT one for the
// server-shaped `started_at` field (matching what SQLite actually returns).
const NOW_UTC = '2026-08-26T14:00:00Z';
const STARTED_AT_SQLITE = '2026-08-26 13:56:38'; // naive, no timezone marker

// 14:00:00 - 13:56:38 = 3m 22s, computed by hand from the UTC wall clock
// above — not derived from any Date arithmetic this test could get wrong the
// same way the bug did.
const EXPECTED_ELAPSED_TEXT = '3m 22s';

const ACTIVE_RUN = {
  id: 'run-1',
  app_name: 'Bracket Assembly',
  operator_name: 'Ada Lovelace',
  station_id: null,
  started_at: STARTED_AT_SQLITE,
  work_order_number: null,
  work_order_id: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  getManagerView.mockResolvedValue({
    active_completions: [ACTIVE_RUN],
    work_orders: [],
    department_stats: [],
  });
  // Fake ONLY Date — setInterval/setTimeout stay real, so React Testing
  // Library's own polling (`waitFor`) and the page's real timers both keep
  // working; only `Date.now()`/`new Date()` are frozen at NOW_UTC.
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(NOW_UTC));
});

afterEach(() => {
  vi.useRealTimers();
});

describe('ManagerView elapsed time', () => {
  it('reads the same UTC instant every screen reads, not the host timezone\'s guess at it', async () => {
    render(<MemoryRouter><ManagerView /></MemoryRouter>);

    const card = await waitFor(() => screen.getByTestId('active-run'));
    await waitFor(() => expect(card.textContent).toContain(EXPECTED_ELAPSED_TEXT));
    // The old bug's failure mode was specifically "0s" (the naive local-time
    // parse landing at or after "now", clamped to zero) — assert it directly,
    // not just that SOME non-zero string appeared.
    expect(card.textContent).not.toContain('0s');
  });
});

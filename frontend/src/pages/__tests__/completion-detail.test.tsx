import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within, fireEvent } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

// ─── /completions/:id ─────────────────────────────────────────────────────────
// The regression this file exists for: the page used to read a `step_breakdown`
// shape the API does not send (`duration_seconds` / `takt_seconds` /
// `variance_pct`), so a run whose step_times the API demonstrably holds
// — {0:55, 1:218, 2:108} — printed "Total Duration —" and "— / — / —" on every
// step, and printed the raw station UUID where the station name belongs.
//
// It now reads `step_times` for the times and the app blob for step names and
// takt (in BOTH key spellings — the analytics endpoint only knows the legacy
// `takt_time`, so v2 apps came back with no takt at all), resolves the station
// id against the station list, and keeps a run that is still running
// legible as running.

const getCompletionDetail = vi.fn();
const getCompletionWithSessions = vi.fn();
const getApp = vi.fn();
const getCompletionValues = vi.fn();
const getStations = vi.fn();
const getAppHistory = vi.fn();

vi.mock('../../api/client', () => ({
  api: {
    get getCompletionDetail() { return getCompletionDetail; },
    get getCompletionWithSessions() { return getCompletionWithSessions; },
    get getApp() { return getApp; },
    get getCompletionValues() { return getCompletionValues; },
    get getStations() { return getStations; },
    get getAppHistory() { return getAppHistory; },
  },
}));

const getAppRevision = vi.fn();
vi.mock('../../api/revisions', async () => {
  const actual = await vi.importActual<typeof import('../../api/revisions')>('../../api/revisions');
  return { ...actual, get getAppRevision() { return getAppRevision; } };
});

import CompletionDetail from '../CompletionDetail';

// ── Fixtures: exactly the shapes the live API returns ────────────────────────

const STATION_ID = 'e980a6aa-c31e-425b-b9a2-419e5b14d65f';

function runPayload(over: Record<string, unknown> = {}) {
  return {
    id: 'b92b1554-3975-4e5a-80cf-6c06d02f628b',
    app_id: 'app-1',
    app_name: 'Bracket Assembly',
    operator_name: 'Bob Operator',
    station_id: STATION_ID,
    started_at: '2026-08-26 01:48:33',
    completed_at: '2026-08-26 01:54:22',
    status: 'completed',
    abandoned_reason: '',
    data: { torque_value: 14.6, visual_ok: 'Pass' },
    step_times: { 0: 55, 1: 218, 2: 108 },
    takt_exceeded_steps: [],
    work_order: { id: 'wo-1', work_order_number: '158D03-WO-1001' },
    ...over,
  };
}

/** A v2 app: takt lives under `takt_time_seconds`, which the analytics
 *  endpoint's own step_breakdown never reads. */
function appBlob() {
  return {
    id: 'app-1',
    name: 'Bracket Assembly',
    steps: [
      { id: 's0', name: 'Safety Check', order: 0, takt_time_seconds: 60, widgets: [
        { id: 'w0', type: 'checkbox', label: 'PPE worn', config: { variableName: 'ppe_worn' } },
      ] },
      { id: 's1', name: 'Assembly', order: 1, takt_time_seconds: 240, widgets: [
        { id: 'w1', type: 'number-input', label: 'Torque value (Nm)', config: { variableName: 'torque_value' } },
      ] },
      { id: 's2', name: 'Final Inspection', order: 2, takt_time_seconds: 120, widgets: [
        { id: 'w2', type: 'pass-fail', label: 'Visual inspection', config: { variableName: 'visual_ok' } },
      ] },
    ],
  };
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/completions/b92b1554-3975-4e5a-80cf-6c06d02f628b']}>
      <Routes><Route path="/completions/:id" element={<CompletionDetail />} /></Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  getCompletionDetail.mockResolvedValue(runPayload());
  getCompletionWithSessions.mockResolvedValue({ sessions: [] });
  getApp.mockResolvedValue(appBlob());
  getCompletionValues.mockResolvedValue([]);
  getStations.mockResolvedValue([{ id: STATION_ID, name: 'Station 1' }]);
  getAppHistory.mockResolvedValue({ avg_duration: 400, completions: [] });
  getAppRevision.mockResolvedValue({
    id: 'rev-1', app_id: 'app-1', revision: 1, change_note: 'added torque check',
    steps: [{ id: 's0', name: 'Safety Check', order: 0, widgets: [] }],
    variables: [], step_groups: [], schema_version: 2,
    approval_required: 0,
    published_by_user_id: 'u1', approved_by_user_id: null,
    published_by_name: 'Dana', approved_by_name: null,
    effective_at: '2026-08-12 09:00:00', created_at: '2026-08-12 09:00:00', run_count: 3,
  });
});

// ── Durations ────────────────────────────────────────────────────────────────

describe('CompletionDetail reports the time the run actually recorded', () => {
  it('totals the step timers the API holds instead of printing a dash', async () => {
    renderPage();
    // 55 + 218 + 108 = 381s
    expect((await screen.findByTestId('run-total')).textContent).toBe('6m 21s');
  });

  it('lays each step against its own takt, reading v2 takt keys', async () => {
    renderPage();
    const table = await screen.findByRole('table');
    const assembly = within(table).getByText('Assembly').closest('tr')!;
    expect(assembly.textContent).toContain('3m 38s'); // 218s
    expect(assembly.textContent).toContain('4m');     // takt 240s
    expect(assembly.textContent).toContain('9% under');
  });

  it('names the step that ran furthest past its takt', async () => {
    getCompletionDetail.mockResolvedValue(runPayload({ step_times: { 0: 55, 1: 400, 2: 108 } }));
    renderPage();
    expect(await screen.findByText(/Slowest: Assembly/)).toBeTruthy();
  });

  it('falls back to wall clock when no step was timed, and says so', async () => {
    getCompletionDetail.mockResolvedValue(runPayload({ step_times: {} }));
    renderPage();
    // 01:48:33 → 01:54:22 is 349 seconds.
    expect((await screen.findByTestId('run-total')).textContent).toBe('5m 49s');
    expect(screen.getByText(/No step on this run was timed/)).toBeTruthy();
  });

  it('refuses to call an untimed run instant', async () => {
    getCompletionDetail.mockResolvedValue(runPayload({
      step_times: {}, completed_at: '2026-08-26 01:48:33',
    }));
    renderPage();
    expect((await screen.findByTestId('run-total')).textContent).toBe('—');
    expect(screen.getByText('nobody timed this run')).toBeTruthy();
  });
});

// ── Identity ─────────────────────────────────────────────────────────────────

describe('CompletionDetail names things a person can recognise', () => {
  it('shows the station name, never the station UUID', async () => {
    renderPage();
    expect(await screen.findByText('Station 1')).toBeTruthy();
    expect(screen.queryByText(STATION_ID)).toBeNull();
  });

  it('says a station has gone rather than falling back to its id', async () => {
    getStations.mockResolvedValue([]);
    renderPage();
    await screen.findByTestId('run-total');
    expect(screen.getByText(/station no longer exists/)).toBeTruthy();
    expect(screen.queryByText(STATION_ID)).toBeNull();
  });

  it('labels captured values with the builder label and its step', async () => {
    getCompletionValues.mockResolvedValue([
      {
        id: 'v-1', completion_id: 'c', app_id: 'app-1', step_id: 's1', widget_id: 'w1',
        variable_name: 'torque_value', value_type: 'number', value_text: null,
        value_number: 14.6, recorded_at: '2026-08-26 01:52:00',
      },
    ]);
    renderPage();
    expect(await screen.findByText('Torque value (Nm)')).toBeTruthy();
    expect(screen.getByText('14.6')).toBeTruthy();
  });

  it('calls out a failed check at the top of the run', async () => {
    getCompletionValues.mockResolvedValue([
      {
        id: 'v-2', completion_id: 'c', app_id: 'app-1', step_id: 's2', widget_id: 'w2',
        variable_name: 'visual_ok', value_type: 'pass_fail', value_text: 'fail',
        value_number: null, recorded_at: '2026-08-26 01:54:00',
      },
    ]);
    renderPage();
    expect(await screen.findByText(/Failed 1 check on this run/)).toBeTruthy();
  });
});

// ── Live ─────────────────────────────────────────────────────────────────────

describe('CompletionDetail keeps a live run legible as live', () => {
  it('reports elapsed time rather than dressing a running job as finished', async () => {
    getCompletionDetail.mockResolvedValue(runPayload({
      status: 'in_progress',
      completed_at: null,
      started_at: new Date(Date.now() - 90_000).toISOString(),
      step_times: {},
    }));
    renderPage();
    await screen.findByText('Running now');
    expect(screen.getByText(/Running for/i)).toBeTruthy();
    // Both the elapsed line and the cycle-time cell say the same thing about
    // the same run — "still running" — where one of them used to say the
    // product's own phrase, "still on the bench".
    expect(screen.getAllByText(/still running/).length).toBe(2);
    // "Still on the bench" was this product's own phrase for it. A run in
    // progress is RUNNING, in the same words the status chip and the per-app
    // screen use, and the bench is nowhere on the page.
    expect(document.body.textContent).not.toMatch(/bench/i);
    // A run that has not finished cannot be compared against an average yet.
    expect(screen.getAllByText('this run has not finished').length).toBe(2);
  });

  it('separates the step being worked from the ones not reached yet', async () => {
    getCompletionDetail.mockResolvedValue(runPayload({
      status: 'in_progress', completed_at: null, step_times: { 0: 55 },
    }));
    renderPage();
    const table = await screen.findByRole('table');
    // Step 2 is the one the operator is standing on; step 3 is still ahead.
    expect(within(table).getByText('Assembly').closest('tr')!.textContent).toContain('on it now');
    expect(within(table).getByText('Final Inspection').closest('tr')!.textContent).toContain('not reached');
    expect(screen.getByText(/The operator is on/)).toBeTruthy();
  });
});


// ── Change control ───────────────────────────────────────────────────────────
// A run is measured against the revision of the app that was live when it
// started. The regression this guards: a run with no revision recorded — every
// run that predates change control — must SAY so. Printing "Rev 1" there would
// be a fabricated fact about what an operator saw, which is the exact defect
// app revisions exist to end.

describe('CompletionDetail says which revision the operator followed', () => {
  it('reads "Revision not recorded" on a run that carries none, and never invents Rev 1', async () => {
    getCompletionWithSessions.mockResolvedValue({ sessions: [], app_revision_id: null, app_revision: null });
    renderPage();
    await screen.findByTestId('run-total');
    const block = screen.getByTestId('run-revision');
    expect(block.textContent).toContain('Revision not recorded');
    expect(block.textContent).not.toMatch(/Rev\s*1\b/);
    expect(screen.queryByText(/Ran against Rev/)).toBeNull();
    expect(getAppRevision).not.toHaveBeenCalled();
  });

  it('names the revision, when it was published and by whom', async () => {
    getCompletionWithSessions.mockResolvedValue({
      sessions: [],
      app_revision_id: 'rev-1',
      app_revision: { revision: 1, published_by_name: 'Dana', effective_at: '2026-08-12 09:00:00' },
    });
    renderPage();
    const trigger = await screen.findByRole('button', { name: /Ran against Rev 1/ });
    expect(trigger.textContent).toContain('Dana');
    expect(screen.queryByText('Revision not recorded')).toBeNull();
  });

  it('shows the steps as they were published, not as the app stands today', async () => {
    getCompletionWithSessions.mockResolvedValue({
      sessions: [],
      app_revision_id: 'rev-1',
      app_revision: { revision: 1, published_by_name: 'Dana', effective_at: '2026-08-12 09:00:00' },
    });
    // The live app has since been edited — its step is called something else.
    getApp.mockResolvedValue({
      ...appBlob(),
      steps: [{ id: 's0', name: 'Safety Check (revised)', order: 0, takt_time_seconds: 60, widgets: [] }],
    });
    renderPage();
    const trigger = await screen.findByRole('button', { name: /Ran against Rev 1/ });
    fireEvent.click(trigger);
    expect(await screen.findByText(/the steps as published/)).toBeTruthy();
    expect(getAppRevision).toHaveBeenCalledWith('app-1', 1);
    const snapshot = screen.getByTestId('run-revision');
    expect(snapshot.textContent).toContain('Safety Check');
    expect(snapshot.textContent).toContain('added torque check');
    expect(snapshot.textContent).not.toContain('Safety Check (revised)');
  });

  it('does not report a missing approver on a revision that never needed one', async () => {
    // "No approver recorded" on an app that never required approval reads as a
    // skipped signature. The revision froze the policy, so say which it was.
    getCompletionWithSessions.mockResolvedValue({
      sessions: [],
      app_revision_id: 'rev-1',
      app_revision: { revision: 1, published_by_name: 'Dana', effective_at: '2026-08-12 09:00:00' },
    });
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: /Ran against Rev 1/ }));
    expect(await screen.findByText('Approval was not required for this app')).toBeTruthy();
    expect(screen.queryByText('No approver recorded')).toBeNull();
  });

  it('names the approver on a revision that required one', async () => {
    getCompletionWithSessions.mockResolvedValue({
      sessions: [],
      app_revision_id: 'rev-1',
      app_revision: { revision: 1, published_by_name: 'Dana', effective_at: '2026-08-12 09:00:00' },
    });
    getAppRevision.mockResolvedValue({
      id: 'rev-1', app_id: 'app-1', revision: 1, change_note: 'added torque check',
      steps: [{ id: 's0', name: 'Safety Check', order: 0, widgets: [] }],
      variables: [], step_groups: [], schema_version: 2,
      approval_required: 1,
      published_by_user_id: 'u1', approved_by_user_id: 'u2',
      published_by_name: 'Dana', approved_by_name: 'Quality Lead',
      effective_at: '2026-08-12 09:00:00', created_at: '2026-08-12 09:00:00', run_count: 3,
    });
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: /Ran against Rev 1/ }));
    expect(await screen.findByText('Approved by Quality Lead')).toBeTruthy();
  });
});

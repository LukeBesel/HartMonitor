// ─── The run-start screen: nothing re-asked, nothing hidden, nothing lost ────
//
// Three promises about the first screen an operator meets, all of them things
// the player used to get wrong:
//
//   1. The Operator Portal already knows who is working, where, and on which
//      job — it puts all three in the link. When it does, the player must not
//      ask again: it starts the run and opens on step one. One tap on a job,
//      one screen.
//   2. When something genuinely has to be asked, a run already open on the SAME
//      unit is a decision to make BEFORE starting, so the warning renders above
//      the Start button in DOM order and holds it.
//   3. Stopping a run is a sheet that says what is lost — never
//      window.confirm('Stop this process?'), a browser dialog with an OK button
//      sitting one menu row from "Leave job (save progress)".
//
// The player is rendered for real against mocked API calls, because all three
// of these are properties of what actually reaches the screen.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

// ── API surface the player touches ───────────────────────────────────────────

const getApp = vi.fn();
const getWorkOrders = vi.fn();
const getProductTypes = vi.fn();
const getStations = vi.fn();
const getJobsInProgress = vi.fn();
const getDepartments = vi.fn();
const openCompletionSession = vi.fn();
const closeCompletionSession = vi.fn();
const verifyAuthorizer = vi.fn();
const flushCompletion = vi.fn();
const updateCompletion = vi.fn();
const getKits = vi.fn();
const resolveBOM = vi.fn();
const request = vi.fn();

vi.mock('../../api/client', () => ({
  api: {
    getApp: (...a: unknown[]) => getApp(...a),
    getWorkOrders: (...a: unknown[]) => getWorkOrders(...a),
    getProductTypes: (...a: unknown[]) => getProductTypes(...a),
    getStations: (...a: unknown[]) => getStations(...a),
    getJobsInProgress: (...a: unknown[]) => getJobsInProgress(...a),
    getDepartments: (...a: unknown[]) => getDepartments(...a),
    openCompletionSession: (...a: unknown[]) => openCompletionSession(...a),
    closeCompletionSession: (...a: unknown[]) => closeCompletionSession(...a),
    verifyAuthorizer: (...a: unknown[]) => verifyAuthorizer(...a),
    flushCompletion: (...a: unknown[]) => flushCompletion(...a),
    updateCompletion: (...a: unknown[]) => updateCompletion(...a),
    getCompletionValues: vi.fn(),
    saveCompletionValues: vi.fn(),
    updateKitLine: vi.fn(),
    createNCR: vi.fn(),
    createAndonCall: vi.fn(),
    getKits: (...a: unknown[]) => getKits(...a),
    resolveBOM: (...a: unknown[]) => resolveBOM(...a),
  },
  request: (...a: unknown[]) => request(...a),
  invalidateApiCache: () => {},
  setNativeToken: () => {},
}));

vi.mock('../../context/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'u1', role: 'operator', display_name: 'Alex Operator' }, canAccessReportPortal: false }),
}));

vi.mock('../../utils/realtime', () => ({
  subscribeRealtime: () => () => {},
  publishRealtime: () => {},
  isAndonEvent: () => false,
}));

import AppPlayer from '../AppPlayer';

// ── Fixtures ─────────────────────────────────────────────────────────────────

const APP_ID = 'app-qc';

function appBlob() {
  return {
    id: APP_ID,
    name: 'Final QC Inspection',
    description: 'Check the weld and record the torque.',
    status: 'published',
    schema_version: 2,
    require_run_context: false,
    steps: [
      {
        id: 's0', name: 'Weld inspection', order: 0, widgets: [
          { id: 'w0', type: 'text-input', label: 'Inspector notes', order: 0, config: {} },
        ],
      },
      { id: 's1', name: 'Torque check', order: 1, widgets: [] },
    ],
    variables: [],
  };
}

const WORK_ORDER = {
  id: 'wo-1', app_id: APP_ID, work_order_number: 'WO-1001', part_name: 'Bracket',
  part_number: 'BR-9', quantity: 10, quantity_completed: 2, status: 'in_progress',
  product_type_id: null,
};

const STATION = { id: 'st-1', name: 'Cell 3', location: 'Bay A', status: 'active', department_id: null };

function jobOnSameUnit(over: Record<string, unknown> = {}) {
  return {
    id: 'job-1', app_id: APP_ID, app_name: 'Final QC Inspection',
    operator_name: 'Alex', started_at: new Date(Date.now() - 6 * 60 * 1000).toISOString(),
    work_order_id: WORK_ORDER.id, station_id: null, data: { _step_index: 0 }, step_times: {},
    last_session: null,
    ...over,
  };
}

/** Render the player at a deep link, on the /play/:id route the app uses. */
function renderPlayer(search: string) {
  return render(
    <MemoryRouter initialEntries={[`/play/${APP_ID}${search}`]}>
      <Routes>
        <Route path="/play/:id" element={<AppPlayer />} />
        <Route path="/operator" element={<div>Operator Portal</div>} />
        <Route path="/apps" element={<div>App Library</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

let confirmSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
  getApp.mockResolvedValue(appBlob());
  getWorkOrders.mockResolvedValue([WORK_ORDER]);
  getProductTypes.mockResolvedValue([]);
  getStations.mockResolvedValue([STATION]);
  getJobsInProgress.mockResolvedValue([]);
  getDepartments.mockResolvedValue([]);
  getKits.mockResolvedValue([]);
  resolveBOM.mockResolvedValue(null);
  openCompletionSession.mockResolvedValue({ id: 'sess-1' });
  request.mockResolvedValue({ id: 'run-1', qualification_state: '' });
  // window.confirm must never be reached again. If anything calls it, the
  // spy answers false AND the assertion below fails.
  confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
});

afterEach(() => { confirmSpy.mockRestore(); });

// ─── 1. One tap from the portal ──────────────────────────────────────────────

describe('a deep link that already knows who, where and what', () => {
  it('starts the run and opens on step one with no setup form', async () => {
    renderPlayer(`?uid=u-alex&name=Alex%20Operator&station=${STATION.id}&wo=${WORK_ORDER.id}&from=operator`);

    // Step one, not a setup form.
    expect(await screen.findByText('Weld inspection')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /start process/i })).not.toBeInTheDocument();
    expect(screen.queryByPlaceholderText(/enter your name/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/badge code/i)).not.toBeInTheDocument();

    // And the run it booked carries the identity the portal verified, so the
    // completion is attributable without anyone retyping anything.
    expect(request).toHaveBeenCalledWith('/completions', expect.objectContaining({ method: 'POST' }));
    const body = JSON.parse((request.mock.calls[0][1] as { body: string }).body);
    expect(body).toMatchObject({
      app_id: APP_ID,
      operator_user_id: 'u-alex',
      operator_name: 'Alex Operator',
      station_id: STATION.id,
      work_order_id: WORK_ORDER.id,
    });
  });

  it('still asks when the link is missing the station', async () => {
    renderPlayer(`?uid=u-alex&name=Alex%20Operator&wo=${WORK_ORDER.id}&from=operator`);
    expect(await screen.findByRole('button', { name: /start process/i })).toBeInTheDocument();
    expect(request).not.toHaveBeenCalled();
  });

  it('still asks when the app offers a product type nobody has chosen', async () => {
    getProductTypes.mockResolvedValue([
      { id: 'pt-1', name: 'Variant A', description: '', takt_overrides: {} },
    ]);
    renderPlayer(`?uid=u-alex&name=Alex%20Operator&station=${STATION.id}&wo=${WORK_ORDER.id}&from=operator`);
    expect(await screen.findByRole('button', { name: /start process/i })).toBeInTheDocument();
    expect(request).not.toHaveBeenCalled();
  });
});

// ─── 2. The concurrent-run warning comes before the button ───────────────────

describe('a run already open on the same unit', () => {
  it('renders the warning ABOVE Start Process and holds the button', async () => {
    getJobsInProgress.mockResolvedValue([jobOnSameUnit()]);
    // No station in the link, so the setup screen is shown.
    renderPlayer(`?uid=u-alex&name=Alex%20Operator&wo=${WORK_ORDER.id}&from=operator`);

    const start = await screen.findByRole('button', { name: /start process/i });
    const warning = screen.getByTestId('concurrent-run-warning');

    expect(within(warning).getByText(/started this/i)).toBeInTheDocument();
    expect(within(warning).getByText(/joining will share the run/i)).toBeInTheDocument();

    // DOM order: the warning precedes the button. A warning underneath the
    // thing it warns about is read after the tap, which is too late.
    expect(warning.compareDocumentPosition(start) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    // And it is a blocking confirmation, not a note.
    expect(start).toBeDisabled();
    expect(request).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole('button', { name: /start a separate run anyway/i }));
    expect(await screen.findByRole('button', { name: /start process/i })).toBeEnabled();
  });

  it('does not auto-skip setup onto a unit somebody else has open', async () => {
    getJobsInProgress.mockResolvedValue([jobOnSameUnit()]);
    renderPlayer(`?uid=u-alex&name=Alex%20Operator&station=${STATION.id}&wo=${WORK_ORDER.id}&from=operator`);

    expect(await screen.findByTestId('concurrent-run-warning')).toBeInTheDocument();
    expect(request).not.toHaveBeenCalled();
  });

  it('says nothing when the open run is on a different unit', async () => {
    getJobsInProgress.mockResolvedValue([jobOnSameUnit({ work_order_id: 'wo-other' })]);
    renderPlayer(`?uid=u-alex&name=Alex%20Operator&wo=${WORK_ORDER.id}&from=operator`);

    await screen.findByRole('button', { name: /start process/i });
    expect(screen.queryByTestId('concurrent-run-warning')).not.toBeInTheDocument();
  });
});

// ─── 3. Abandon is a sheet, not a browser confirm ────────────────────────────

describe('stopping a run', () => {
  it('opens an in-player sheet that states what is lost, and never calls confirm()', async () => {
    renderPlayer(`?uid=u-alex&name=Alex%20Operator&station=${STATION.id}&wo=${WORK_ORDER.id}&from=operator`);
    await screen.findByText('Weld inspection');

    await userEvent.click(screen.getByRole('button', { name: 'Menu' }));
    await userEvent.click(screen.getByRole('button', { name: /abandon run/i }));

    const sheet = await screen.findByRole('dialog', { name: /stop this run/i });
    expect(within(sheet).getByText(/marked/i)).toBeInTheDocument();
    expect(within(sheet).getByText(/step 1 of 2/i)).toBeInTheDocument();
    expect(within(sheet).getByRole('button', { name: /keep working/i })).toBeInTheDocument();
    expect(within(sheet).getByRole('button', { name: /stop and discard/i })).toBeInTheDocument();

    expect(confirmSpy).not.toHaveBeenCalled();
  });
});

// ─── 4. A blocked start explains itself ──────────────────────────────────────

describe('a start refused because the operator is not signed off', () => {
  function refuse() {
    return Object.assign(new Error('Not qualified'), {
      status: 403,
      data: {
        code: 'NOT_QUALIFIED',
        error: 'Alex Operator is not signed off for Final QC Inspection.',
        app_name: 'Final QC Inspection',
        operator_name: 'Alex Operator',
        state: 'expired',
        expiry_date: '2026-07-04',
      },
    });
  }

  it('names the app, the operator and the expiry, and asks for a supervisor PIN', async () => {
    request.mockRejectedValueOnce(refuse());
    renderPlayer(`?uid=u-alex&name=Alex%20Operator&station=${STATION.id}&wo=${WORK_ORDER.id}&from=operator`);

    const sheet = await screen.findByRole('dialog', { name: /not signed off/i });
    expect(within(sheet).getByText(/Final QC Inspection/)).toBeInTheDocument();
    expect(within(sheet).getByText(/Alex Operator/)).toBeInTheDocument();
    expect(within(sheet).getByText(/expired 4 Jul/i)).toBeInTheDocument();

    const pin = within(sheet).getByLabelText(/supervisor pin/i);
    expect(pin).not.toHaveAttribute('autofocus');
  });

  it('retries the start once a supervisor PIN is accepted', async () => {
    request.mockRejectedValueOnce(refuse());
    verifyAuthorizer.mockResolvedValue({
      authorization_id: 'grant-1', user_id: 'sup-1', display_name: 'Sam Supervisor', role: 'supervisor',
    });
    renderPlayer(`?uid=u-alex&name=Alex%20Operator&station=${STATION.id}&wo=${WORK_ORDER.id}&from=operator`);

    const sheet = await screen.findByRole('dialog', { name: /not signed off/i });
    await userEvent.type(within(sheet).getByLabelText(/supervisor pin/i), '4417');
    await userEvent.click(within(sheet).getByRole('button', { name: /approve & start/i }));

    // The retry carries the single-use proof in the header, and only then does
    // the player move on to step one.
    await waitFor(() => expect(request).toHaveBeenCalledTimes(2));
    const retry = request.mock.calls[1][1] as { headers?: Record<string, string> };
    expect(retry.headers).toMatchObject({ 'X-Qualification-Override': 'grant-1' });
    expect(await screen.findByText('Weld inspection')).toBeInTheDocument();
  });
});

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

/**
 * A ROUTED job: released against a routing, so its app hangs off the OPERATION
 * (`work_order_operations.app_id`) and `work_orders.app_id` is NULL — along
 * with `product_type_id`, because the routing decides what each station runs.
 *
 * This is the shape that broke one-tap start: the picker filtered on
 * `w.app_id === id`, so the job the operator had just tapped on the dispatch
 * board was not in the list, the setup screen read "— No work order —", and the
 * player then held the run demanding a product type nobody ever recorded.
 */
const ROUTED_WO = {
  id: 'wo-routed', app_id: null, work_order_number: '158D03-WO-1042',
  part_name: 'Weldment', part_number: 'WM-3', quantity: 25, quantity_completed: 4,
  status: 'in_progress', product_type_id: null, released_at: '2026-09-01 08:00:00',
  current_operation: { id: 'op-3', sequence: 3, of: 7 },
};

/** The operation of that job that runs THIS app. */
const ROUTED_OP = {
  id: 'op-3', work_order_id: ROUTED_WO.id, sequence: 3, of: 7, name: 'Weld',
  app_id: APP_ID, app_name: 'Final QC Inspection', status: 'ready',
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

/** Every POST /completions the player made, as [path, options] pairs. */
function startCalls() {
  return request.mock.calls.filter(c => c[0] === '/completions');
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
/** What POST /completions answers next — an object to resolve, or an Error. */
let startResponse: unknown;

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
  // One mock for every typed call in api/training.ts, routed by path — the
  // approval flow is a three-request exchange and the test has to see all of it.
  startResponse = { id: 'run-1', qualification_state: '' };
  request.mockImplementation((path: string) => {
    if (path === '/operators/verify-authorizer') {
      return Promise.resolve({
        authorization_id: 'grant-1', user_id: 'sup-1', display_name: 'Sam Supervisor', role: 'supervisor',
      });
    }
    if (path === '/training/overrides') {
      return Promise.resolve({ token: 'tok-1', expires_in_seconds: 600, app_name: 'Final QC Inspection', approved_by: 'Sam Supervisor' });
    }
    if (path === '/completions') {
      const next = startResponse;
      if (next instanceof Error) return Promise.reject(next);
      return Promise.resolve(next);
    }
    if (path === `/work-orders/${ROUTED_WO.id}/operations`) return Promise.resolve([ROUTED_OP]);
    if (/^\/work-orders\/[^/]+\/operations$/.test(path)) return Promise.resolve([]);
    return Promise.resolve({});
  });
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
    const body = JSON.parse((startCalls()[0][1] as { body: string }).body);
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
    expect(startCalls()).toHaveLength(0);
  });

  it('still asks when the app offers a product type nobody has chosen', async () => {
    getProductTypes.mockResolvedValue([
      { id: 'pt-1', name: 'Variant A', description: '', takt_overrides: {} },
    ]);
    renderPlayer(`?uid=u-alex&name=Alex%20Operator&station=${STATION.id}&wo=${WORK_ORDER.id}&from=operator`);
    expect(await screen.findByRole('button', { name: /start process/i })).toBeInTheDocument();
    expect(startCalls()).toHaveLength(0);
  });

  it('does not book a run to a station only this browser remembers', async () => {
    // hm_station is the last station THIS BROWSER used. On a tablet carried to
    // another cell, or a spare picked off a bench, it is not where the operator
    // is standing — and a silently mis-attributed run is worse than one more
    // screen. It is offered as a preselected default instead.
    localStorage.setItem('hm_station', STATION.id);
    renderPlayer(`?uid=u-alex&name=Alex%20Operator&wo=${WORK_ORDER.id}&from=operator`);

    expect(await screen.findByRole('button', { name: /start process/i })).toBeInTheDocument();
    expect(startCalls()).toHaveLength(0);
    const stationSelect = screen.getByLabelText(/station/i) as HTMLSelectElement;
    expect(stationSelect.value).toBe(STATION.id);
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
    expect(startCalls()).toHaveLength(0);

    await userEvent.click(screen.getByRole('button', { name: /start a separate run anyway/i }));
    expect(await screen.findByRole('button', { name: /start process/i })).toBeEnabled();
  });

  it('does not auto-skip setup onto a unit somebody else has open', async () => {
    getJobsInProgress.mockResolvedValue([jobOnSameUnit()]);
    renderPlayer(`?uid=u-alex&name=Alex%20Operator&station=${STATION.id}&wo=${WORK_ORDER.id}&from=operator`);

    expect(await screen.findByTestId('concurrent-run-warning')).toBeInTheDocument();
    expect(startCalls()).toHaveLength(0);
  });

  it('says nothing when the open run is on a different unit', async () => {
    getJobsInProgress.mockResolvedValue([jobOnSameUnit({ work_order_id: 'wo-other' })]);
    renderPlayer(`?uid=u-alex&name=Alex%20Operator&wo=${WORK_ORDER.id}&from=operator`);

    await screen.findByRole('button', { name: /start process/i });
    expect(screen.queryByTestId('concurrent-run-warning')).not.toBeInTheDocument();
  });

  // A tablet that reloads mid-run leaves the operator's OWN run open on the
  // unit in front of them, and that is the commonest way this card appears.
  // It used to read "Someone else already has this unit open — choose whether
  // to join them", to the person who has it open. Their own run and a
  // colleague's are two different decisions, and only one of them is theirs
  // alone to make.
  it('offers the operator their OWN open run back, without blaming anyone', async () => {
    getJobsInProgress.mockResolvedValue([jobOnSameUnit({
      operator_name: 'Alex Operator',
      last_session: {
        operator_name: 'Alex Operator', operator_user_id: 'u-alex',
        started_at: new Date(Date.now() - 6 * 60 * 1000).toISOString(),
        ended_at: null, handoff_comment: '',
      },
    })]);
    renderPlayer(`?uid=u-alex&name=Alex%20Operator&wo=${WORK_ORDER.id}&from=operator`);

    const start = await screen.findByRole('button', { name: /start process/i });
    const warning = screen.getByTestId('concurrent-run-warning');

    expect(within(warning).getByText(/^You started this/)).toBeInTheDocument();
    expect(within(warning).queryByText(/joining will share the run/i)).not.toBeInTheDocument();
    expect(within(warning).getByRole('button', { name: /resume your run/i })).toBeInTheDocument();

    // The hold still holds — starting a second run on a unit you already have
    // open double-counts it — but it names the choice honestly.
    expect(start).toBeDisabled();
    expect(screen.getByText(/^You already have this unit open/)).toBeInTheDocument();
    expect(screen.queryByText(/someone else already has this unit open/i)).not.toBeInTheDocument();
    expect(startCalls()).toHaveLength(0);
  });

  // The same run, held by somebody whose name the run knows: today's wording,
  // with the colleague named instead of "Someone else".
  it('names the colleague who has it, when the run says who', async () => {
    getJobsInProgress.mockResolvedValue([jobOnSameUnit({ operator_name: 'Bo Nguyen' })]);
    renderPlayer(`?uid=u-alex&name=Alex%20Operator&wo=${WORK_ORDER.id}&from=operator`);

    await screen.findByRole('button', { name: /start process/i });
    expect(screen.getByText(/^Bo Nguyen already has this unit open/)).toBeInTheDocument();
    expect(within(screen.getByTestId('concurrent-run-warning'))
      .getByRole('button', { name: /resume their run/i })).toBeInTheDocument();
  });
});

// ─── A job with no bill of materials is not a failure ────────────────────────
//
// The player asks /boms/resolve on every start. Most routed jobs have no bill
// of materials at all — the routing decides what each station runs — so the
// route answers 200 with an explicitly empty body rather than the 404 that
// used to print a red failure in the console of an ordinary job and fire this
// caller's error path. An empty answer has no id, and no id is nothing to
// render.

describe('the bill of materials a job may not have', () => {
  /** The same app with a kit step in front — the only place a bill of
   *  materials reaches the screen at all. */
  function appWithKitStep() {
    const app = appBlob();
    app.steps = [
      { id: 's-kit', name: 'Pick parts', order: 0, step_type: 'kit', widgets: [] },
      ...app.steps,
    ] as typeof app.steps;
    return app;
  }

  const BOM_LINE = {
    id: 'bl-1', bom_id: 'bom-1', item_id: 'i-1', item_name: 'Resistor 100R',
    sku: 'RES-100', qty_per: 2, unit: 'ea', reference: 'R1', scan_code: '', step_id: '',
    notes: '', sort_order: 0,
  };

  it('renders nothing at all when the route answers 200-and-empty', async () => {
    getApp.mockResolvedValue(appWithKitStep());
    resolveBOM.mockResolvedValue({
      id: null, product_type_id: null, lines: [],
      reason: 'This job has no product type, so no bill of materials applies',
    });
    renderPlayer(`?uid=u-alex&name=Alex%20Operator&station=${STATION.id}&wo=${WORK_ORDER.id}&from=operator`);

    await screen.findByText('Pick parts');
    await waitFor(() => expect(resolveBOM).toHaveBeenCalledWith(WORK_ORDER.id));
    // No bill of materials is claimed, and nothing is reported as broken.
    expect(screen.queryByText('Bill of materials')).not.toBeInTheDocument();
    expect(screen.queryByText(/couldn't|failed/i)).not.toBeInTheDocument();
  });

  it('still shows the bill of materials when the job has one', async () => {
    getApp.mockResolvedValue(appWithKitStep());
    resolveBOM.mockResolvedValue({
      id: 'bom-1', product_type_id: 'pt-1', version: 2, status: 'active',
      notes: '', created_by: '', created_at: '', updated_at: '', lines: [BOM_LINE],
    });
    renderPlayer(`?uid=u-alex&name=Alex%20Operator&station=${STATION.id}&wo=${WORK_ORDER.id}&from=operator`);

    await screen.findByText('Pick parts');
    expect(await screen.findByText('Bill of materials')).toBeInTheDocument();
    expect(screen.getByText('Resistor 100R')).toBeInTheDocument();
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
    startResponse = refuse();
    renderPlayer(`?uid=u-alex&name=Alex%20Operator&station=${STATION.id}&wo=${WORK_ORDER.id}&from=operator`);

    const sheet = await screen.findByRole('dialog', { name: /not signed off/i });
    expect(within(sheet).getByText(/Final QC Inspection/)).toBeInTheDocument();
    expect(within(sheet).getByText(/Alex Operator/)).toBeInTheDocument();
    expect(within(sheet).getByText(/expired 4 Jul/i)).toBeInTheDocument();

    const pin = within(sheet).getByLabelText(/supervisor pin/i);
    expect(pin).not.toHaveAttribute('autofocus');
  });

  // A visitor exploring a sandbox has no supervisor to fetch and no way to
  // guess the PIN — so the sandbox says it, on the strength of the SERVER
  // calling this session a sandbox (GET /auth/me → demo_hints).
  it('tells a SANDBOX visitor the supervisor PIN, and a real plant nothing', async () => {
    startResponse = refuse();
    const withHints = (hints: unknown) => {
      const inner = request.getMockImplementation()!;
      request.mockImplementation((path: string, ...rest: unknown[]) =>
        (path === '/auth/me' ? Promise.resolve(hints) : inner(path, ...rest)));
    };

    withHints({ demo_hints: { operator_pin: '1234', supervisor_pin: '2468' } });
    const sandbox = renderPlayer(`?uid=u-alex&name=Alex%20Operator&station=${STATION.id}&wo=${WORK_ORDER.id}&from=operator`);
    const sheet = await screen.findByRole('dialog', { name: /not signed off/i });
    expect(await within(sheet).findByTestId('demo-pin-hint')).toHaveTextContent('Demo: supervisor PIN 2468');
    sandbox.unmount();

    // The same screen in a real company, where /auth/me carries no hints.
    startResponse = refuse();
    withHints({ id: 'u-alex' });
    renderPlayer(`?uid=u-alex&name=Alex%20Operator&station=${STATION.id}&wo=${WORK_ORDER.id}&from=operator`);
    const real = await screen.findByRole('dialog', { name: /not signed off/i });
    expect(within(real).queryByTestId('demo-pin-hint')).toBeNull();
  });

  it('asks for the PIN against THIS app and operator, then retries with a bound token', async () => {
    startResponse = refuse();
    renderPlayer(`?uid=u-alex&name=Alex%20Operator&station=${STATION.id}&wo=${WORK_ORDER.id}&from=operator`);

    const sheet = await screen.findByRole('dialog', { name: /not signed off/i });
    startResponse = { id: 'run-2', qualification_state: 'override' };
    await userEvent.type(within(sheet).getByLabelText(/supervisor pin/i), '4417');
    await userEvent.click(within(sheet).getByRole('button', { name: /approve & start/i }));

    await waitFor(() => expect(startCalls()).toHaveLength(2));

    // 1. The PIN is verified for a purpose naming this app AND this operator,
    //    so the grant it mints cannot be spent anywhere else — and a grant
    //    raised for an in-run NCR ('ncr') cannot be spent here.
    const verify = request.mock.calls.find(c => c[0] === '/operators/verify-authorizer');
    expect(verify).toBeTruthy();
    expect(JSON.parse((verify![1] as { body: string }).body)).toEqual({
      pin: '4417',
      purpose: `qualification_override:${APP_ID}:u:u-alex`,
    });

    // 2. The grant is exchanged for a token bound to the same pair.
    const mint = request.mock.calls.find(c => c[0] === '/training/overrides');
    expect(mint).toBeTruthy();
    expect(JSON.parse((mint![1] as { body: string }).body)).toMatchObject({
      app_id: APP_ID, user_id: 'u-alex', authorizer_proof: 'grant-1',
    });

    // 3. Only the TOKEN reaches the start header — never the raw grant.
    const retry = startCalls()[1][1] as { headers?: Record<string, string> };
    expect(retry.headers).toMatchObject({ 'X-Qualification-Override': 'tok-1' });
    expect(retry.headers!['X-Qualification-Override']).not.toBe('grant-1');

    expect(await screen.findByText('Weld inspection')).toBeInTheDocument();
  });
});

// ─── 5. A routed job starts in one tap, like every other job ─────────────────
//
// The dispatch board sends a tablet to ONE operation of a released job:
// /play/<app>?wo=…&op=…&station=…&uid=…. Everything the player needs is in that
// link, so it must open on step one — and the run it books, and every screen
// that reports it afterwards, must name the work order it is bound to.

describe('a job routed to this app through one of its operations', () => {
  beforeEach(() => {
    getWorkOrders.mockResolvedValue([WORK_ORDER, ROUTED_WO]);
    // The app offers a variant. A routed job did not pick one, and the routing
    // is what says which station runs what — so this must not hold the run.
    getProductTypes.mockResolvedValue([
      { id: 'pt-1', name: 'Variant A', description: '', takt_overrides: {} },
    ]);
    flushCompletion.mockResolvedValue({});
    updateCompletion.mockResolvedValue({ id: 'run-1', status: 'completed' });
    closeCompletionSession.mockResolvedValue({});
  });

  const link = `?uid=u-alex&name=Alex%20Operator&station=${STATION.id}&wo=${ROUTED_WO.id}&op=${ROUTED_OP.id}&from=operator`;

  it('opens on step one with no setup screen', async () => {
    renderPlayer(link);

    expect(await screen.findByText('Weld inspection')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /start process/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/no work order/i)).not.toBeInTheDocument();

    // The run is booked against the job AND the operation the queue sent it to.
    const body = JSON.parse((startCalls()[0][1] as { body: string }).body);
    expect(body).toMatchObject({
      app_id: APP_ID,
      work_order_id: ROUTED_WO.id,
      work_order_operation_id: ROUTED_OP.id,
      station_id: STATION.id,
      operator_user_id: 'u-alex',
    });
  });

  it('names the work order on the running screen, without its company tag', async () => {
    renderPlayer(link);
    await screen.findByText('Weld inspection');

    const chip = screen.getByText('WO-1042');
    expect(chip).toBeInTheDocument();
    // The stored id is one hover away; nobody has to read it on the floor.
    expect(chip).toHaveAttribute('title', '158D03-WO-1042');
    expect(screen.queryByText('158D03-WO-1042')).toBeNull();
  });

  it('names the work order on the finish summary, not "No work order"', async () => {
    renderPlayer(link);
    await screen.findByText('Weld inspection');

    await userEvent.click(screen.getByRole('button', { name: /next/i }));
    await userEvent.click(await screen.findByRole('button', { name: /^complete$/i }));
    const sheet = await screen.findByRole('dialog', { name: /units this run/i });
    await userEvent.click(within(sheet).getByRole('button', { name: /^complete$/i }));

    expect(await screen.findByText('Complete!')).toBeInTheDocument();
    expect(screen.getByText('WO-1042 · Weldment')).toBeInTheDocument();
    expect(screen.queryByText(/no work order or part number/i)).toBeNull();
  });

  it('offers the routed job in the picker, which its own app_id column never would', async () => {
    // No station in the link, so the setup screen is shown and the picker is
    // the thing under test. No ?wo= either: the only way this job can appear is
    // the operations lookup finding this app on one of its operations.
    renderPlayer('?uid=u-alex&name=Alex%20Operator&from=operator');

    const select = await screen.findByLabelText(/work order/i) as HTMLSelectElement;
    await waitFor(() => {
      expect([...select.options].some(o => o.value === ROUTED_WO.id)).toBe(true);
    });
    const option = [...select.options].find(o => o.value === ROUTED_WO.id)!;
    expect(option.textContent).toContain('WO-1042');
    expect(option.textContent).not.toContain('158D03');
    // The unrouted job is still there — nothing was traded away for this.
    expect([...select.options].some(o => o.value === WORK_ORDER.id)).toBe(true);
  });
});

// ─── 6. The words on the screen are the floor's, and they count correctly ────

describe('the setup screen describes the app in the operator\'s own words', () => {
  it('counts fields, not "widgets" — and says "1 field", never "1 fields"', async () => {
    // The app here is two steps with one input between them.
    renderPlayer('?uid=u-alex&name=Alex%20Operator&from=operator');
    expect(await screen.findByText('2 steps · 1 field')).toBeInTheDocument();
    expect(screen.queryByText(/widget/i)).toBeNull();
  });
});

describe('"Jobs in progress" names the job each run is bound to', () => {
  it('prints the work order, not "No work order", for a routed job', async () => {
    // The run is bound to a ROUTED work order — the one the old picker filter
    // dropped, which is why this card used to read "No work order" about a job
    // that plainly had one.
    getWorkOrders.mockResolvedValue([WORK_ORDER, ROUTED_WO]);
    getJobsInProgress.mockResolvedValue([
      jobOnSameUnit({ id: 'job-r', work_order_id: ROUTED_WO.id }),
    ]);
    renderPlayer('?uid=u-alex&name=Alex%20Operator&from=operator');

    await screen.findByRole('button', { name: /start process/i });
    const row = await screen.findByText('WO-1042 · Weldment');
    expect(row).toBeInTheDocument();
    expect(row).toHaveAttribute('title', '158D03-WO-1042');
    expect(screen.queryByText('No work order')).toBeNull();
  });
});

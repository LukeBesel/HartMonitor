// ─── Player exits, operator identity, and the notices the player is allowed ──
// to show. Three promises are under test here:
//   1. Done / Exit / Back send a floor tablet back to the Operator Portal —
//      never into /apps, which is an unlocked manager console with a builder.
//   2. A run is attributed to the person who ran it, or to nobody. The string
//      'Operator' is not a person and must never reach the API.
//   3. "Saved locally" stops being true the moment the outbox drains, without
//      a reload.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, render, screen } from '@testing-library/react';

const createNCR = vi.fn();
const flushCompletion = vi.fn();
const updateKitLine = vi.fn();

vi.mock('../../api/client', () => ({
  api: {
    createNCR: (...args: unknown[]) => createNCR(...args),
    flushCompletion: (...args: unknown[]) => flushCompletion(...args),
    updateKitLine: (...args: unknown[]) => updateKitLine(...args),
  },
}));

import {
  buildPlayLink, exitTarget, operatorAttribution, operatorDisplayName,
  operatorReturnLink, UNNAMED_OPERATOR,
} from '../../components/player/runtime';
import { enqueueOutbox, flushOutbox } from '../../utils/offlineQueue';
import RunSummary from '../../components/player/RunSummary';
import type { Step } from '../../types';

beforeEach(() => {
  localStorage.clear();
  createNCR.mockReset().mockResolvedValue({ id: 'n1' });
  flushCompletion.mockReset().mockResolvedValue({});
  updateKitLine.mockReset().mockResolvedValue({});
});

describe('where the player lets go', () => {
  it('returns a run entered from the Operator Portal to the Operator Portal', () => {
    expect(exitTarget({ fromOperator: true, role: 'operator' })).toBe('/operator');
    // Even a manager who started from the portal goes back to the portal —
    // they chose the floor door, so that is the door they came out of.
    expect(exitTarget({ fromOperator: true, role: 'manager' })).toBe('/operator');
  });

  it('sends an operator back to the floor however they got in', () => {
    expect(exitTarget({ fromOperator: false, role: 'operator' })).toBe('/operator');
    expect(exitTarget({ fromOperator: false, role: null })).toBe('/operator');
    expect(exitTarget({ fromOperator: false })).toBe('/operator');
    expect(exitTarget({ fromOperator: false, role: 'viewer' })).toBe('/operator');
  });

  it('only returns to the App Library for a supervisor or above who came from it', () => {
    expect(exitTarget({ fromOperator: false, role: 'supervisor' })).toBe('/apps');
    expect(exitTarget({ fromOperator: false, role: 'manager' })).toBe('/apps');
    expect(exitTarget({ fromOperator: false, role: 'developer' })).toBe('/apps');
  });
});

describe('who ran this job', () => {
  it('carries the verified user id, not just the typing', () => {
    expect(operatorAttribution('Maria Lopez', 'user-7'))
      .toEqual({ operator_name: 'Maria Lopez', operator_user_id: 'user-7' });
  });

  it('books a run to nobody rather than to a phantom', () => {
    // No name, no id → the payload carries NEITHER field. The API's own
    // default applies; the player does not invent a person.
    expect(operatorAttribution('', null)).toEqual({});
    expect(operatorAttribution(null, undefined)).toEqual({});
    expect(operatorAttribution('   ', '')).toEqual({});
  });

  it('never sends the phantom string "Operator"', () => {
    for (const [name, uid] of [['', null], ['   ', null], [null, null], [undefined, undefined]] as const) {
      const payload = operatorAttribution(name, uid);
      expect(JSON.stringify(payload)).not.toContain('Operator');
      expect(payload.operator_name).toBeUndefined();
    }
    // A typed name with no verified account is still that person's name.
    expect(operatorAttribution('  Sam  ', null)).toEqual({ operator_name: 'Sam' });
  });

  it('renders an unattributed run honestly', () => {
    expect(operatorDisplayName('')).toBe(UNNAMED_OPERATOR);
    expect(operatorDisplayName(null)).toBe('Unnamed operator');
    expect(operatorDisplayName('  Bob Operator ')).toBe('Bob Operator');
  });

  it('deep-links the identity the portal verified, and where it came from', () => {
    const link = buildPlayLink({
      appId: 'app-1', workOrderId: 'wo-2', operatorName: 'Maria Lopez',
      operatorUserId: 'user-7', stationId: 'st-3', fromOperator: true,
    });
    const [path, query] = link.split('?');
    expect(path).toBe('/play/app-1');
    const q = new URLSearchParams(query);
    expect(q.get('wo')).toBe('wo-2');
    expect(q.get('name')).toBe('Maria Lopez');
    expect(q.get('uid')).toBe('user-7');
    expect(q.get('station')).toBe('st-3');
    expect(q.get('from')).toBe('operator');
  });

  it('names the OPERATION the queue sent the operator to, not just the job', () => {
    // "Op 3 of 7" is what the dispatch list showed and what the operator
    // pressed. Sending only `wo` makes the player infer which operation that
    // was from the job's pointer, which is a different answer the moment a
    // colleague advances the job in the next minute.
    const link = buildPlayLink({
      appId: 'app-1', workOrderId: 'wo-2', operationId: 'op-9',
      operatorName: 'Maria Lopez', operatorUserId: 'user-7', stationId: 'st-3', fromOperator: true,
    });
    const q = new URLSearchParams(link.split('?')[1]);
    expect(q.get('op')).toBe('op-9');
    expect(q.get('wo')).toBe('wo-2');
    // Nothing to say about an operation ⇒ nothing on the link.
    expect(buildPlayLink({ appId: 'app-1', workOrderId: 'wo-2' })).toBe('/play/app-1?wo=wo-2');
  });

  it('says where a run was started from when it was not the portal', () => {
    // The Schedule's Dispatch queue is a MANAGER pressing Start: their own
    // identity applies, so the link carries no uid — and `from=dispatch` is
    // what tells the player it did not come from a tablet with an exit.
    const link = buildPlayLink({
      appId: 'app-1', workOrderId: 'wo-2', operationId: 'op-9', stationId: 'st-3', from: 'dispatch',
    });
    expect(link).toBe('/play/app-1?wo=wo-2&op=op-9&station=st-3&from=dispatch');
    expect(new URLSearchParams(link.split('?')[1]).get('uid')).toBeNull();
  });

  it('comes back to the portal as the person who left it', () => {
    // Without this the portal asks "Who's working?" and demands the PIN again
    // after every single unit.
    expect(operatorReturnLink('user-7', 'st-3')).toBe('/operator?uid=user-7&station=st-3');
    expect(operatorReturnLink('user-7', null)).toBe('/operator?uid=user-7');
    expect(operatorReturnLink(null, 'st-3')).toBe('/operator?station=st-3');
    expect(operatorReturnLink(null, null)).toBe('/operator');
  });

  it('omits what it does not know instead of sending blanks', () => {
    const link = buildPlayLink({ appId: 'app-1', operatorName: '', operatorUserId: null, fromOperator: true });
    expect(link).toBe('/play/app-1?from=operator');
    expect(buildPlayLink({ appId: 'app-1' })).toBe('/play/app-1');
  });
});

describe('the run summary claims only what happened', () => {
  const steps: Step[] = [{ id: 's1', name: 'Re-torque check', order: 0, widgets: [] }];
  const props = {
    appName: 'Final QC Inspection',
    operatorName: 'Maria Lopez',
    steps,
    stepTimes: { 0: 42 },
    getStepTakt: () => 60,
    taktExceededSteps: [],
    capturedCount: 2,
    kitSummary: null,
    completionId: 'c1',
    onNextUnit: () => undefined,
    onDone: () => undefined,
  };

  it('clears "Saved locally" when this run\'s own save goes up — no reload', async () => {
    enqueueOutbox('completion_update', { completionId: 'c1', body: { partial: false } }, 'completion:c1');
    render(<RunSummary {...props} savedLocally />);
    expect(screen.getByText(/Saved locally/)).toBeTruthy();

    // The reconnect flush that the player runs on the 'online' event.
    await act(async () => { await flushOutbox(); });

    expect(screen.queryByText(/Saved locally/)).toBeNull();
    expect(screen.getByText(/Synced/)).toBeTruthy();
  });

  it('reports on THIS run, not on whatever else the outbox holds', async () => {
    // Another run's queued save must not hold this run's banner up...
    enqueueOutbox('completion_update', { completionId: 'other', body: {} }, 'completion:other');
    const { unmount } = render(<RunSummary {...props} savedLocally />);
    expect(screen.queryByText(/Saved locally/)).toBeNull();
    expect(screen.getByText(/Synced/)).toBeTruthy();
    unmount();

    // ...and this run's own save must not be reported as synced because the
    // rest of the outbox happens to be empty.
    enqueueOutbox('completion_update', { completionId: 'c1', body: {} }, 'completion:c1');
    render(<RunSummary {...props} savedLocally />);
    expect(screen.getByText(/Saved locally/)).toBeTruthy();
    expect(screen.queryByText(/Synced/)).toBeNull();
  });

  it('says nothing about local saving for a run that went straight up', () => {
    render(<RunSummary {...props} savedLocally={false} />);
    expect(screen.queryByText(/Saved locally/)).toBeNull();
    expect(screen.queryByText(/Synced/)).toBeNull();
  });

  it('names an unattributed run "Unnamed operator", never "Operator"', () => {
    render(<RunSummary {...props} operatorName="" savedLocally={false} />);
    expect(screen.getByText(/Unnamed operator/)).toBeTruthy();
  });
});

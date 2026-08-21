// ─── Offline outbox tests (spec §5.7) ─────────────────────────────────────────
// Proves: typed outbox enqueue/coalesce, in-order replay on reconnect with
// per-kind failure isolation, byte-compatible NCR API surface, and migration of
// the legacy hm_offline_ncr_queue key.

import { describe, it, expect, vi, beforeEach } from 'vitest';

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
  enqueueOutbox, flushOutbox, getOutbox, pendingCount, subscribeOutbox,
  getQueuedNCRs, queueNCR, syncQueuedNCRs, removeOutboxItem,
} from '../offlineQueue';

beforeEach(() => {
  localStorage.clear();
  createNCR.mockReset().mockResolvedValue({ id: 'ncr1' });
  flushCompletion.mockReset().mockResolvedValue({});
  updateKitLine.mockReset().mockResolvedValue({});
});

describe('outbox basics', () => {
  it('enqueues typed items and counts them', () => {
    enqueueOutbox('kit_line', { kitId: 'k1', lineId: 'l1', data: { status: 'verified' } });
    enqueueOutbox('completion_update', { completionId: 'c1', body: { partial: true } });
    expect(pendingCount()).toBe(2);
    expect(pendingCount(['kit_line'])).toBe(1);
    const items = getOutbox();
    expect(items[0].kind).toBe('kit_line');
    expect(items[1].kind).toBe('completion_update');
    expect(items[0].queuedAt).toBeTruthy();
  });

  it('coalesces items with the same key, keeping position and latest payload', () => {
    enqueueOutbox('completion_update', { completionId: 'c1', body: { data: { a: 1 } } }, 'completion:c1');
    enqueueOutbox('kit_line', { kitId: 'k1', lineId: 'l1', data: { status: 'picked' } });
    enqueueOutbox('completion_update', { completionId: 'c1', body: { data: { a: 2 } } }, 'completion:c1');
    const items = getOutbox();
    expect(items).toHaveLength(2);
    expect(items[0].kind).toBe('completion_update');
    expect((items[0].payload as { body: { data: { a: number } } }).body.data.a).toBe(2);
  });

  it('notifies subscribers on change', () => {
    const spy = vi.fn();
    const unsub = subscribeOutbox(spy);
    enqueueOutbox('ncr', { title: 'x' });
    expect(spy).toHaveBeenCalled();
    unsub();
  });

  it('removes items by id', () => {
    const item = enqueueOutbox('ncr', { title: 'x' });
    removeOutboxItem(item.id);
    expect(pendingCount()).toBe(0);
  });
});

describe('flushOutbox', () => {
  it('replays items in order and clears the queue', async () => {
    const calls: string[] = [];
    flushCompletion.mockImplementation(() => { calls.push('completion'); return Promise.resolve({}); });
    updateKitLine.mockImplementation(() => { calls.push('kit'); return Promise.resolve({}); });
    enqueueOutbox('kit_line', { kitId: 'k1', lineId: 'l1', data: { status: 'verified' } });
    enqueueOutbox('completion_update', { completionId: 'c1', body: {} });
    enqueueOutbox('kit_line', { kitId: 'k1', lineId: 'l2', data: { status: 'verified' } });

    const synced = await flushOutbox();
    expect(synced).toBe(3);
    expect(calls).toEqual(['kit', 'completion', 'kit']);
    expect(pendingCount()).toBe(0);
  });

  it('keeps failed items and preserves per-kind ordering after a failure', async () => {
    updateKitLine.mockRejectedValueOnce(new Error('offline'));
    enqueueOutbox('kit_line', { kitId: 'k1', lineId: 'l1', data: { status: 'verified' } });
    enqueueOutbox('kit_line', { kitId: 'k1', lineId: 'l2', data: { status: 'verified' } });
    enqueueOutbox('ncr', { title: 'still goes through' });

    const synced = await flushOutbox();
    // First kit_line fails → second kit_line held back to preserve order; NCR unaffected
    expect(synced).toBe(1);
    expect(updateKitLine).toHaveBeenCalledTimes(1);
    expect(createNCR).toHaveBeenCalledTimes(1);
    const remaining = getOutbox();
    expect(remaining).toHaveLength(2);
    expect(remaining.every(i => i.kind === 'kit_line')).toBe(true);
    expect((remaining[0].payload as { lineId: string }).lineId).toBe('l1');
    expect((remaining[1].payload as { lineId: string }).lineId).toBe('l2');
  });

  // A flush awaits the network; the player keeps queueing during that window.
  // Writing back the array loaded at the start silently deleted anything
  // enqueued meanwhile — exactly what happens on reconnect.
  it('keeps items enqueued while the flush was awaiting the network', async () => {
    enqueueOutbox('ncr', { title: 'queued before flush' });
    createNCR.mockImplementation(async () => {
      // Simulates the player filing a second report mid-flush.
      enqueueOutbox('ncr', { title: 'queued during flush' });
      return { id: 'ncr1' };
    });

    const synced = await flushOutbox();
    expect(synced).toBe(1);
    const remaining = getOutbox();
    expect(remaining).toHaveLength(1);
    expect((remaining[0].payload as { title: string }).title).toBe('queued during flush');
  });

  it('does not delete a coalesced item that was updated mid-flight', async () => {
    enqueueOutbox('completion_update', { completionId: 'c1', body: { data: { a: 1 } } }, 'completion:c1');
    flushCompletion.mockImplementation(async () => {
      // A newer autosave lands on the same coalescing key while the PUT is out.
      enqueueOutbox('completion_update', { completionId: 'c1', body: { data: { a: 2 } } }, 'completion:c1');
      return {};
    });

    const synced = await flushOutbox();
    expect(synced).toBe(1);
    const remaining = getOutbox();
    expect(remaining).toHaveLength(1);
    expect((remaining[0].payload as { body: { data: { a: number } } }).body.data.a).toBe(2);
  });
});

describe('NCR API surface (unchanged)', () => {
  it('queueNCR returns the legacy QueuedNCR shape and getQueuedNCRs lists it', () => {
    const q = queueNCR({ title: 'Broken part', severity: 'minor' });
    expect(q.id).toBeTruthy();
    expect(q.createdAt).toBeTruthy();
    expect(q.payload.title).toBe('Broken part');
    const list = getQueuedNCRs();
    expect(list).toHaveLength(1);
    expect(list[0].payload.severity).toBe('minor');
  });

  it('syncQueuedNCRs tries each NCR independently and keeps failures', async () => {
    createNCR
      .mockRejectedValueOnce(new Error('nope'))
      .mockResolvedValueOnce({ id: 'ok' });
    queueNCR({ title: 'first' });
    queueNCR({ title: 'second' });
    const synced = await syncQueuedNCRs();
    expect(synced).toBe(1);
    const remaining = getQueuedNCRs();
    expect(remaining).toHaveLength(1);
    expect(remaining[0].payload.title).toBe('first');
  });

  it('syncQueuedNCRs leaves non-NCR outbox items alone', async () => {
    queueNCR({ title: 'ncr' });
    enqueueOutbox('kit_line', { kitId: 'k', lineId: 'l', data: { status: 'verified' } });
    const synced = await syncQueuedNCRs();
    expect(synced).toBe(1);
    expect(updateKitLine).not.toHaveBeenCalled();
    expect(pendingCount(['kit_line'])).toBe(1);
  });
});

describe('legacy key migration', () => {
  it('migrates hm_offline_ncr_queue entries into the outbox', () => {
    localStorage.setItem('hm_offline_ncr_queue', JSON.stringify([
      { id: 'legacy1', payload: { title: 'old report' }, createdAt: '2026-01-01T00:00:00Z' },
    ]));
    const list = getQueuedNCRs();
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe('legacy1');
    expect(list[0].payload.title).toBe('old report');
    expect(list[0].createdAt).toBe('2026-01-01T00:00:00Z');
    expect(localStorage.getItem('hm_offline_ncr_queue')).toBeNull();
  });
});

// ─── Offline outbox (spec §5.7) ───────────────────────────────────────────────
// Generalizes the original NCR-only offline queue into a typed outbox with the
// same localStorage + flush-on-reconnect mechanics. The NCR API surface
// (getQueuedNCRs / queueNCR / syncQueuedNCRs and the QueuedNCR shape) is
// unchanged — OperatorPortal.tsx consumes it exactly as before. Anything
// queued under the legacy key is migrated into the outbox on first load.

import { api } from '../api/client';
import type { CompletionFlushPayload, KitLineUpdate } from '../api/client';
import { v4 } from './uuid';

const LEGACY_NCR_KEY = 'hm_offline_ncr_queue';
const OUTBOX_KEY = 'hm_offline_outbox';

export type OutboxKind = 'ncr' | 'completion_update' | 'kit_line';

export interface CompletionUpdatePayload { completionId: string; body: CompletionFlushPayload; }
export interface KitLinePayload { kitId: string; lineId: string; data: KitLineUpdate; }

export interface OutboxItem {
  id: string;
  kind: OutboxKind;
  payload: Record<string, unknown>;
  queuedAt: string;
  /** Optional coalescing key: enqueueing with the same key replaces the older
   *  item in place (position preserved) instead of appending — used so repeated
   *  autosave snapshots collapse to one queued update per completion. */
  coalesceKey?: string;
}

// Legacy shape — unchanged (OperatorPortal depends on it).
export interface QueuedNCR {
  id: string;
  payload: Record<string, any>;
  createdAt: string;
}

// ─── Storage ──────────────────────────────────────────────────────────────────

interface LegacyQueuedNCR { id?: string; payload?: Record<string, unknown>; createdAt?: string; }

function migrateLegacy(): OutboxItem[] {
  try {
    const raw = localStorage.getItem(LEGACY_NCR_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as LegacyQueuedNCR[];
    localStorage.removeItem(LEGACY_NCR_KEY);
    if (!Array.isArray(parsed)) return [];
    return parsed.map(item => ({
      id: item.id || v4(),
      kind: 'ncr' as const,
      payload: item.payload ?? {},
      queuedAt: item.createdAt || new Date().toISOString(),
    }));
  } catch {
    return [];
  }
}

function load(): OutboxItem[] {
  let items: OutboxItem[] = [];
  try {
    const raw = localStorage.getItem(OUTBOX_KEY);
    items = raw ? (JSON.parse(raw) as OutboxItem[]) : [];
    if (!Array.isArray(items)) items = [];
  } catch {
    items = [];
  }
  const legacy = migrateLegacy();
  if (legacy.length > 0) {
    items = [...legacy, ...items];
    save(items);
  }
  return items;
}

function save(items: OutboxItem[]) {
  try {
    localStorage.setItem(OUTBOX_KEY, JSON.stringify(items));
  } catch {
    // storage full/unavailable — nothing else we can do
  }
  notify();
}

// ─── Change notifications (drives the header "offline — n pending" pill) ─────

type OutboxListener = () => void;
const listeners = new Set<OutboxListener>();

function notify() {
  for (const fn of listeners) {
    try { fn(); } catch { /* listener errors never break the queue */ }
  }
}

/** Subscribe to outbox changes. Returns an unsubscribe function. */
export function subscribeOutbox(fn: OutboxListener): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

// ─── Public outbox API ────────────────────────────────────────────────────────

export function getOutbox(): OutboxItem[] {
  return load();
}

export function pendingCount(kinds?: OutboxKind[]): number {
  const items = load();
  if (!kinds) return items.length;
  return items.filter(i => kinds.includes(i.kind)).length;
}

export function enqueueOutbox(
  kind: OutboxKind,
  payload: Record<string, unknown>,
  coalesceKey?: string,
): OutboxItem {
  const items = load();
  if (coalesceKey) {
    const existing = items.find(i => i.coalesceKey === coalesceKey);
    if (existing) {
      existing.payload = payload;
      existing.queuedAt = new Date().toISOString();
      save(items);
      return existing;
    }
  }
  const item: OutboxItem = { id: v4(), kind, payload, queuedAt: new Date().toISOString(), coalesceKey };
  items.push(item);
  save(items);
  return item;
}

/** Remove one item (e.g. after a caller synced it out-of-band). */
export function removeOutboxItem(id: string): void {
  const items = load();
  const next = items.filter(i => i.id !== id);
  if (next.length !== items.length) save(next);
}

async function send(item: OutboxItem): Promise<void> {
  switch (item.kind) {
    case 'ncr':
      await api.createNCR(item.payload);
      return;
    case 'completion_update': {
      const p = item.payload as unknown as CompletionUpdatePayload;
      await api.flushCompletion(p.completionId, p.body);
      return;
    }
    case 'kit_line': {
      const p = item.payload as unknown as KitLinePayload;
      await api.updateKitLine(p.kitId, p.lineId, p.data);
      return;
    }
  }
}

/**
 * Replays queued items in order (FIFO). If an item fails, later items of the
 * SAME kind are kept in place (per-kind ordering preserved) while other kinds
 * still get a chance. Returns the number successfully synced.
 */
export async function flushOutbox(): Promise<number> {
  const items = load();
  if (items.length === 0) return 0;
  let synced = 0;
  const remaining: OutboxItem[] = [];
  const failedKinds = new Set<OutboxKind>();
  for (const item of items) {
    if (failedKinds.has(item.kind)) { remaining.push(item); continue; }
    try {
      await send(item);
      synced++;
    } catch {
      failedKinds.add(item.kind);
      remaining.push(item);
    }
  }
  save(remaining);
  return synced;
}

// ─── Legacy NCR API — surface unchanged ───────────────────────────────────────

function toQueuedNCR(item: OutboxItem): QueuedNCR {
  return { id: item.id, payload: item.payload as Record<string, any>, createdAt: item.queuedAt };
}

export function getQueuedNCRs(): QueuedNCR[] {
  return load().filter(i => i.kind === 'ncr').map(toQueuedNCR);
}

export function queueNCR(payload: Record<string, any>): QueuedNCR {
  const item = enqueueOutbox('ncr', payload as Record<string, unknown>);
  return toQueuedNCR(item);
}

/** Attempts to submit every queued NCR. Returns the number successfully synced.
 *  Matches the original behavior: each NCR is tried independently and failures
 *  stay queued. Non-NCR outbox items are untouched. */
export async function syncQueuedNCRs(): Promise<number> {
  const items = load();
  const ncrs = items.filter(i => i.kind === 'ncr');
  if (ncrs.length === 0) return 0;
  let synced = 0;
  const syncedIds = new Set<string>();
  for (const item of ncrs) {
    try {
      await api.createNCR(item.payload);
      synced++;
      syncedIds.add(item.id);
    } catch {
      // keep it queued
    }
  }
  if (syncedIds.size > 0) {
    save(load().filter(i => !syncedIds.has(i.id)));
  }
  return synced;
}

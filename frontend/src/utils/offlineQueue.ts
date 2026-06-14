import { api } from '../api/client';
import { v4 } from './uuid';

const QUEUE_KEY = 'hm_offline_ncr_queue';

export interface QueuedNCR {
  id: string;
  payload: Record<string, any>;
  createdAt: string;
}

function load(): QueuedNCR[] {
  try {
    const raw = localStorage.getItem(QUEUE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function save(queue: QueuedNCR[]) {
  try {
    localStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
  } catch {
    // ignore
  }
}

export function getQueuedNCRs(): QueuedNCR[] {
  return load();
}

export function queueNCR(payload: Record<string, any>): QueuedNCR {
  const item: QueuedNCR = { id: v4(), payload, createdAt: new Date().toISOString() };
  const queue = load();
  queue.push(item);
  save(queue);
  return item;
}

/** Attempts to submit every queued NCR. Returns the number successfully synced. */
export async function syncQueuedNCRs(): Promise<number> {
  const queue = load();
  if (queue.length === 0) return 0;
  let synced = 0;
  const remaining: QueuedNCR[] = [];
  for (const item of queue) {
    try {
      await api.createNCR(item.payload);
      synced++;
    } catch {
      remaining.push(item);
    }
  }
  save(remaining);
  return synced;
}

// ─── Realtime bus ─────────────────────────────────────────────────────────────
// There is exactly ONE WebSocket per session (opened by MessagesContext). Any
// screen that wants to react to a server push subscribes here instead of opening
// a second socket. MessagesContext publishes every parsed frame; consumers
// filter by `type`.

import type { AndonCall } from '../types';

export type RealtimeEvent =
  | { type: 'andon'; action: 'created' | 'acknowledged' | 'resolved' | 'cancelled' | 'deleted'; call: AndonCall }
  | { type: string; [key: string]: unknown };

type Handler = (event: RealtimeEvent) => void;

const handlers = new Set<Handler>();

/** Subscribe to every realtime frame. Returns an unsubscribe function. */
export function subscribeRealtime(handler: Handler): () => void {
  handlers.add(handler);
  return () => { handlers.delete(handler); };
}

/** Called by MessagesContext for each frame received on the shared socket. */
export function publishRealtime(event: RealtimeEvent): void {
  for (const handler of [...handlers]) {
    try {
      handler(event);
    } catch (err) {
      // One bad subscriber must never break delivery to the others.
      console.error('[realtime] subscriber threw:', err);
    }
  }
}

/** Narrowing helper for the Andon team-call frames. */
export function isAndonEvent(
  event: RealtimeEvent,
): event is { type: 'andon'; action: 'created' | 'acknowledged' | 'resolved' | 'cancelled' | 'deleted'; call: AndonCall } {
  return event.type === 'andon';
}

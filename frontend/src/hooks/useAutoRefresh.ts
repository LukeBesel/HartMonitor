import { useCallback, useEffect, useRef, useState } from 'react';

// ─── useAutoRefresh ───────────────────────────────────────────────────────────
// One polling primitive for every operational screen, so "is this number live?"
// has the same answer everywhere.
//
// Rules it enforces for free:
//   • the tab is hidden → the timer is torn down (no background chatter, no
//     battery burn on a wall tablet), and coming back visible refreshes at once
//     so the operator never reads a stale board;
//   • fetches never stack — a slow response can't queue a pile-up behind it;
//   • every timer and listener is removed on unmount (no interval leaks);
//   • a failed poll leaves `lastRefreshed` where it was, so the header keeps
//     reading honestly stale instead of claiming fresh data.
//
// `fetchFn` MUST be referentially stable (wrap it in `useCallback`). Its
// identity is part of the schedule: when it changes — e.g. a filter moved —
// the hook refetches immediately and restarts the interval.

export interface UseAutoRefreshOptions {
  /**
   * Poll on a timer. When false the hook still fetches on mount / when
   * `fetchFn` changes and on demand via `refresh()`, but schedules no interval.
   * Default: true.
   */
  enabled?: boolean;
  /** Fetch as soon as the hook mounts and whenever `fetchFn` changes. Default: true. */
  immediate?: boolean;
}

export interface AutoRefreshState {
  /** When the last SUCCESSFUL fetch finished. Null until one has landed. */
  lastRefreshed: Date | null;
  /** True while a fetch — automatic or manual — is in flight. */
  refreshing: boolean;
  /** Manual trigger. Resolves once the fetch settles; never rejects. */
  refresh: () => Promise<void>;
  /**
   * Data-refresh trigger: increments at the start of every fetch cycle. Use it
   * as a `useEffect` dependency to pull dependent widgets along with the page.
   */
  refreshToken: number;
}

export function useAutoRefresh(
  fetchFn: () => void | Promise<void>,
  intervalMs: number,
  options: UseAutoRefreshOptions = {},
): AutoRefreshState {
  const { enabled = true, immediate = true } = options;

  const [lastRefreshed, setLastRefreshed] = useState<Date | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshToken, setRefreshToken] = useState(0);

  // Hold the freshest closure so an in-flight interval always calls current
  // code, while the schedule itself only restarts when identity actually flips.
  const fnRef = useRef(fetchFn);
  fnRef.current = fetchFn;

  const mountedRef = useRef(true);
  const inFlightRef = useRef(false);
  // A refresh asked for while one is already running is almost always a NEW
  // question — someone changed a filter. Dropping it left the controls
  // describing a slice the numbers on screen were not from, for up to a whole
  // poll interval. Remember it instead and re-ask once the current fetch lands.
  // Coalescing (a flag, not a queue) means ten rapid changes cost one re-run.
  const pendingRef = useRef(false);
  const runRef = useRef<(queueIfBusy: boolean) => Promise<void>>();

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  // `queueIfBusy` splits the two reasons a refresh gets asked for while another
  // is running. A TIMER tick is stale by definition — drop it, the next tick
  // covers it, and queuing them piles up catch-up polls behind a slow fetch.
  // An EXPLICIT call is a new question (a filter moved), so it must not be lost.
  const run = useCallback(async (queueIfBusy: boolean) => {
    if (inFlightRef.current) {
      if (queueIfBusy) pendingRef.current = true;
      return;
    }
    inFlightRef.current = true;
    if (mountedRef.current) {
      setRefreshing(true);
      setRefreshToken(t => t + 1);
    }
    try {
      await fnRef.current();
      if (mountedRef.current) setLastRefreshed(new Date());
    } catch {
      // Pages surface their own load errors; a failed poll must not blow up the
      // timer loop, and must not advance the freshness stamp.
    } finally {
      inFlightRef.current = false;
      if (mountedRef.current) setRefreshing(false);
      // Re-ask for whatever was requested mid-flight. Cleared first, so a change
      // arriving during THIS re-run schedules one more and no further.
      const queued = pendingRef.current;
      pendingRef.current = false;
      // Cleared first, so a change arriving during THIS re-run schedules one
      // more and no further.
      if (queued && mountedRef.current) void runRef.current?.(true);
    }
  }, []);

  runRef.current = run;
  const refresh = useCallback(() => run(true), [run]);
  const tick = useCallback(() => run(false), [run]);

  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | null = null;

    const stop = () => {
      if (timer !== null) { clearInterval(timer); timer = null; }
    };

    const start = () => {
      stop();
      if (!enabled || intervalMs <= 0) return;
      if (typeof document !== 'undefined' && document.hidden) return;
      timer = setInterval(() => { void tick(); }, intervalMs);
    };

    const onVisibilityChange = () => {
      if (document.hidden) { stop(); return; }
      if (!enabled) return;
      void tick();
      start();
    };

    // `refresh`, not `tick`: this effect re-runs because the INPUTS changed
    // (new filters, new id). That is an explicit new question, so it must queue
    // behind an in-flight fetch rather than be dropped like a stale timer tick.
    if (immediate) void refresh();
    start();
    document.addEventListener('visibilitychange', onVisibilityChange);

    return () => {
      stop();
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
    // `fetchFn` is intentionally a dependency even though the body reads it
    // through `fnRef`: a new callback means new inputs (filters, ids), which
    // must refetch now and restart the clock.
  }, [refresh, fetchFn, intervalMs, enabled, immediate]);

  return { lastRefreshed, refreshing, refresh, refreshToken };
}

export default useAutoRefresh;

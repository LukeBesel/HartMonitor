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

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const refresh = useCallback(async () => {
    if (inFlightRef.current) return;
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
    }
  }, []);

  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | null = null;

    const stop = () => {
      if (timer !== null) { clearInterval(timer); timer = null; }
    };

    const start = () => {
      stop();
      if (!enabled || intervalMs <= 0) return;
      if (typeof document !== 'undefined' && document.hidden) return;
      timer = setInterval(() => { void refresh(); }, intervalMs);
    };

    const onVisibilityChange = () => {
      if (document.hidden) { stop(); return; }
      if (!enabled) return;
      void refresh();
      start();
    };

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

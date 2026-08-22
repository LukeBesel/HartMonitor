import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useAutoRefresh } from '../useAutoRefresh';

// ─── useAutoRefresh ───────────────────────────────────────────────────────────
// Covers the three properties operational screens depend on: polling pauses
// while the tab is hidden (and catches up on return), every timer is released
// on unmount, and the manual trigger works independently of the clock.

let hidden = false;

function setHidden(value: boolean) {
  hidden = value;
  document.dispatchEvent(new Event('visibilitychange'));
}

beforeEach(() => {
  hidden = false;
  vi.spyOn(document, 'hidden', 'get').mockImplementation(() => hidden);
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

/** Flush pending microtasks (the awaited fetch) inside act(). */
async function flush() {
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
}

describe('useAutoRefresh', () => {
  it('fetches immediately and then once per interval', async () => {
    const fetchFn = vi.fn(async () => {});
    renderHook(() => useAutoRefresh(fetchFn, 10_000));

    await flush();
    expect(fetchFn).toHaveBeenCalledTimes(1);

    await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
    expect(fetchFn).toHaveBeenCalledTimes(2);

    await act(async () => { await vi.advanceTimersByTimeAsync(20_000); });
    expect(fetchFn).toHaveBeenCalledTimes(4);
  });

  it('skips the mount fetch when immediate is false', async () => {
    const fetchFn = vi.fn(async () => {});
    renderHook(() => useAutoRefresh(fetchFn, 10_000, { immediate: false }));

    await flush();
    expect(fetchFn).not.toHaveBeenCalled();

    await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('never schedules an interval when disabled', async () => {
    const fetchFn = vi.fn(async () => {});
    renderHook(() => useAutoRefresh(fetchFn, 10_000, { enabled: false }));

    await flush();
    expect(fetchFn).toHaveBeenCalledTimes(1); // the immediate load still runs

    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('pauses polling while the tab is hidden and refreshes on becoming visible', async () => {
    const fetchFn = vi.fn(async () => {});
    renderHook(() => useAutoRefresh(fetchFn, 10_000));

    await flush();
    expect(fetchFn).toHaveBeenCalledTimes(1);

    // Hidden: the interval is torn down, so time passing costs nothing.
    await act(async () => { setHidden(true); });
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);

    // Visible again: catch up right away, then resume the clock.
    await act(async () => { setHidden(false); });
    await flush();
    expect(fetchFn).toHaveBeenCalledTimes(2);

    await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
    expect(fetchFn).toHaveBeenCalledTimes(3);
  });

  it('does not schedule an interval when it mounts on a hidden tab', async () => {
    hidden = true;
    const fetchFn = vi.fn(async () => {});
    renderHook(() => useAutoRefresh(fetchFn, 10_000));

    await flush();
    expect(vi.getTimerCount()).toBe(0);

    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
    expect(fetchFn).toHaveBeenCalledTimes(1); // only the mount load
  });

  it('clears every timer and listener on unmount — no interval leaks', async () => {
    const fetchFn = vi.fn(async () => {});
    const removeSpy = vi.spyOn(document, 'removeEventListener');
    const { unmount } = renderHook(() => useAutoRefresh(fetchFn, 10_000));

    await flush();
    expect(vi.getTimerCount()).toBe(1);

    unmount();

    expect(vi.getTimerCount()).toBe(0);
    expect(removeSpy).toHaveBeenCalledWith('visibilitychange', expect.any(Function));

    const callsAtUnmount = fetchFn.mock.calls.length;
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    expect(fetchFn).toHaveBeenCalledTimes(callsAtUnmount);

    // A visibility flip after unmount must not resurrect polling either.
    await act(async () => { setHidden(true); setHidden(false); });
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    expect(fetchFn).toHaveBeenCalledTimes(callsAtUnmount);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('refresh() fetches on demand and advances lastRefreshed', async () => {
    const fetchFn = vi.fn(async () => {});
    const { result } = renderHook(() => useAutoRefresh(fetchFn, 60_000, { immediate: false }));

    expect(result.current.lastRefreshed).toBeNull();

    await act(async () => { await result.current.refresh(); });

    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(result.current.lastRefreshed).toBeInstanceOf(Date);
    expect(result.current.refreshToken).toBe(1);

    const first = result.current.lastRefreshed!;
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    await act(async () => { await result.current.refresh(); });
    expect(result.current.lastRefreshed!.getTime()).toBeGreaterThanOrEqual(first.getTime());
    expect(result.current.refreshToken).toBe(2);
  });

  it('reports refreshing while a fetch is in flight and never stacks fetches', async () => {
    let release: () => void = () => {};
    const fetchFn = vi.fn(() => new Promise<void>(resolve => { release = resolve; }));
    const { result } = renderHook(() => useAutoRefresh(fetchFn, 10_000));

    await flush();
    expect(result.current.refreshing).toBe(true);

    // The interval keeps ticking, but the in-flight guard drops the extra runs.
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
    expect(fetchFn).toHaveBeenCalledTimes(1);

    await act(async () => { release(); await Promise.resolve(); });
    await flush();
    expect(result.current.refreshing).toBe(false);
    expect(result.current.lastRefreshed).toBeInstanceOf(Date);
  });

  it('re-asks for a filter change made while a fetch was in flight', async () => {
    // The gap this closes: someone moves a filter mid-poll, the call is dropped,
    // and the controls sit there describing a slice the numbers are not from
    // until the next tick — up to a minute on some screens.
    const releases: Array<() => void> = [];
    const fetchFn = vi.fn(() => new Promise<void>(resolve => { releases.push(resolve); }));
    const { result } = renderHook(() => useAutoRefresh(fetchFn, 10_000));

    await flush();
    expect(fetchFn).toHaveBeenCalledTimes(1);

    // Two filter changes land while the first fetch is still open. They coalesce
    // into ONE re-ask, not two.
    await act(async () => { void result.current.refresh(); void result.current.refresh(); });
    expect(fetchFn).toHaveBeenCalledTimes(1);

    await act(async () => { releases[0](); await Promise.resolve(); });
    await flush();
    expect(fetchFn).toHaveBeenCalledTimes(2);

    await act(async () => { releases[1](); await Promise.resolve(); });
    await flush();
    expect(result.current.refreshing).toBe(false);
    expect(result.current.lastRefreshed).toBeInstanceOf(Date);
  });

  it('still drops timer ticks that land mid-fetch, so slow fetches never pile up', async () => {
    const releases: Array<() => void> = [];
    const fetchFn = vi.fn(() => new Promise<void>(resolve => { releases.push(resolve); }));
    renderHook(() => useAutoRefresh(fetchFn, 10_000));

    await flush();
    expect(fetchFn).toHaveBeenCalledTimes(1);

    // Five intervals pass while one slow fetch is open. A queued tick per
    // interval would fire a burst of catch-up polls the moment it lands.
    await act(async () => { await vi.advanceTimersByTimeAsync(50_000); });
    expect(fetchFn).toHaveBeenCalledTimes(1);

    await act(async () => { releases[0](); await Promise.resolve(); });
    await flush();
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('leaves the stamp alone when a fetch fails, and keeps polling', async () => {
    const fetchFn = vi.fn()
      .mockRejectedValueOnce(new Error('network down'))
      .mockResolvedValue(undefined);
    const { result } = renderHook(() => useAutoRefresh(fetchFn, 10_000));

    await flush();
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(result.current.lastRefreshed).toBeNull();
    expect(result.current.refreshing).toBe(false);

    await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
    await flush();
    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect(result.current.lastRefreshed).toBeInstanceOf(Date);
  });

  it('refetches immediately when the fetch callback changes (filters moved)', async () => {
    const fetchA = vi.fn(async () => {});
    const fetchB = vi.fn(async () => {});
    const { rerender } = renderHook(
      ({ fn }) => useAutoRefresh(fn, 10_000),
      { initialProps: { fn: fetchA } },
    );

    await flush();
    expect(fetchA).toHaveBeenCalledTimes(1);

    rerender({ fn: fetchB });
    await flush();
    expect(fetchB).toHaveBeenCalledTimes(1);

    // Only one interval survives the swap.
    expect(vi.getTimerCount()).toBe(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
    expect(fetchA).toHaveBeenCalledTimes(1);
    expect(fetchB).toHaveBeenCalledTimes(2);
  });
});

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// ─── staleChunk ───────────────────────────────────────────────────────────────
// This decides whether an operator's tab silently reloads onto a new build or
// sits on an error. Every direction is dangerous: never reloading strands them
// on "Something went wrong" mid-shift; reloading without a budget spins the tab
// forever when an asset is genuinely gone; and reloading during a live run
// throws away whatever they had typed.
//
// `claimedThisLoad` is module state — one claim per PAGE LOAD — so a fresh
// import is how we simulate the reload actually happening.
async function freshLoad() {
  vi.resetModules();
  return import('../staleChunk');
}

beforeEach(() => { sessionStorage.clear(); vi.restoreAllMocks(); });
afterEach(() => { vi.restoreAllMocks(); });

describe('isStaleChunkError', () => {
  it('recognises the message an operator actually saw', async () => {
    const { isStaleChunkError } = await freshLoad();
    expect(isStaleChunkError(new Error('Unable to preload CSS for /assets/AppPlayer-CfRqQE8C.css'))).toBe(true);
  });

  it('recognises the other shapes a vanished chunk arrives as', async () => {
    const { isStaleChunkError } = await freshLoad();
    for (const m of [
      'Failed to fetch dynamically imported module: https://x/assets/AppPlayer-abc.js',
      'error loading dynamically imported module',
      'Importing a module script failed.',
      'ChunkLoadError: Loading chunk 42 failed',
    ]) expect(isStaleChunkError(new Error(m))).toBe(true);
    expect(isStaleChunkError('Unable to preload CSS for /assets/x.css')).toBe(true);
  });

  it('does not swallow ordinary application errors', async () => {
    // If this returned true, a real bug would silently reload instead of being
    // reported — the failure mode that hides bugs from us.
    const { isStaleChunkError } = await freshLoad();
    expect(isStaleChunkError(new Error("Cannot read properties of undefined (reading 'bg')"))).toBe(false);
    expect(isStaleChunkError(new Error('Network request failed'))).toBe(false);
    expect(isStaleChunkError(null)).toBe(false);
    expect(isStaleChunkError(undefined)).toBe(false);
    expect(isStaleChunkError({ message: 'unable to preload css' })).toBe(false);
  });
});

describe('takeStaleChunkReload', () => {
  it('allows the reload that picks up a new deploy', async () => {
    const { takeStaleChunkReload } = await freshLoad();
    expect(takeStaleChunkReload()).toBe(true);
  });

  it('claims only once per page load', async () => {
    // The same vanished chunk surfaces twice — as the preload error and again
    // as the boundary catching React.lazy — and both must not spend the budget.
    const { takeStaleChunkReload } = await freshLoad();
    expect(takeStaleChunkReload()).toBe(true);
    expect(takeStaleChunkReload()).toBe(false);
    expect(takeStaleChunkReload()).toBe(false);
  });

  it('stops before the tab can spin forever across reloads', async () => {
    // Each fresh import is the page having actually reloaded. The sessionStorage
    // budget is what survives, and it is what breaks the loop.
    const a = await freshLoad();
    expect(a.takeStaleChunkReload()).toBe(true);
    const b = await freshLoad();
    expect(b.takeStaleChunkReload()).toBe(true);
    const c = await freshLoad();
    expect(c.takeStaleChunkReload()).toBe(false);   // third inside the window: a loop
  });

  it('forgives again once the window has passed', async () => {
    const a = await freshLoad();
    a.takeStaleChunkReload();
    const b = await freshLoad();
    b.takeStaleChunkReload();
    const c = await freshLoad();
    expect(c.takeStaleChunkReload()).toBe(false);

    // A later, unrelated deploy must not be punished for an earlier loop.
    sessionStorage.setItem('hm_stale_chunk_reload', JSON.stringify({ at: Date.now() - 61_000, count: 2 }));
    const d = await freshLoad();
    expect(d.takeStaleChunkReload()).toBe(true);
  });

  it('never reloads while an operator has a live run on screen', async () => {
    // Reloading mid-job would discard whatever they had entered since the last
    // autosave — the exact data loss this recovery exists to avoid causing.
    const { takeStaleChunkReload, setRunActive, isRunActive } = await freshLoad();
    setRunActive(true);
    expect(isRunActive()).toBe(true);
    expect(takeStaleChunkReload()).toBe(false);

    setRunActive(false);
    expect(takeStaleChunkReload()).toBe(true);   // free to recover once the run ends
  });

  it('still reloads when sessionStorage is unavailable', async () => {
    // Private mode: no budget can be tracked, but refusing would strand every
    // private-window visitor on a stale build.
    const { takeStaleChunkReload } = await freshLoad();
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('denied'); });
    try {
      expect(takeStaleChunkReload()).toBe(true);
    } finally {
      spy.mockRestore();
    }
  });

  it('survives a corrupted budget value', async () => {
    sessionStorage.setItem('hm_stale_chunk_reload', 'not json');
    const { takeStaleChunkReload } = await freshLoad();
    expect(takeStaleChunkReload()).toBe(true);
  });
});

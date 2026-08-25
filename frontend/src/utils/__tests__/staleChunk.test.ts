import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { isStaleChunkError, takeStaleChunkReload } from '../staleChunk';

// ─── staleChunk ───────────────────────────────────────────────────────────────
// This decides whether an operator's tab silently reloads onto the new build or
// sits on an error. Both failure directions are bad: never reloading strands
// them on "Something went wrong" mid-shift, and reloading without a budget
// spins the tab forever when an asset is genuinely gone.

beforeEach(() => { sessionStorage.clear(); vi.useRealTimers(); });
afterEach(() => { vi.useRealTimers(); });

describe('isStaleChunkError', () => {
  it('recognises the message an operator actually saw', () => {
    expect(isStaleChunkError(new Error('Unable to preload CSS for /assets/AppPlayer-CfRqQE8C.css'))).toBe(true);
  });

  it('recognises the other shapes a vanished chunk arrives as', () => {
    for (const m of [
      'Failed to fetch dynamically imported module: https://x/assets/AppPlayer-abc.js',
      'error loading dynamically imported module',
      'Importing a module script failed.',
      'ChunkLoadError: Loading chunk 42 failed',
    ]) expect(isStaleChunkError(new Error(m))).toBe(true);
    expect(isStaleChunkError('Unable to preload CSS for /assets/x.css')).toBe(true);
  });

  it('does not swallow ordinary application errors', () => {
    // If this ever returned true, a real bug would silently reload instead of
    // being reported — the failure mode that hides bugs from us.
    expect(isStaleChunkError(new Error("Cannot read properties of undefined (reading 'bg')"))).toBe(false);
    expect(isStaleChunkError(new Error('Network request failed'))).toBe(false);
    expect(isStaleChunkError(null)).toBe(false);
    expect(isStaleChunkError(undefined)).toBe(false);
    expect(isStaleChunkError({ message: 'unable to preload css' })).toBe(false);
  });
});

describe('takeStaleChunkReload', () => {
  it('allows the reload that picks up a new deploy', () => {
    expect(takeStaleChunkReload()).toBe(true);
  });

  it('stops before the tab can spin forever', () => {
    expect(takeStaleChunkReload()).toBe(true);
    expect(takeStaleChunkReload()).toBe(true);
    // Third attempt inside the window is a loop, not a deploy — let the error
    // through so a person can read it.
    expect(takeStaleChunkReload()).toBe(false);
    expect(takeStaleChunkReload()).toBe(false);
  });

  it('forgives again once the window has passed', () => {
    takeStaleChunkReload();
    takeStaleChunkReload();
    expect(takeStaleChunkReload()).toBe(false);

    // A later, unrelated deploy should not be punished for an earlier loop.
    const past = Date.now() - 61_000;
    sessionStorage.setItem('hm_stale_chunk_reload', JSON.stringify({ at: past, count: 2 }));
    expect(takeStaleChunkReload()).toBe(true);
  });

  it('still reloads when sessionStorage is unavailable', () => {
    // Private mode: no budget can be tracked, but refusing would strand every
    // private-window visitor on a stale build.
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('denied'); });
    expect(takeStaleChunkReload()).toBe(true);
    spy.mockRestore();
  });

  it('survives a corrupted budget value', () => {
    sessionStorage.setItem('hm_stale_chunk_reload', 'not json');
    expect(takeStaleChunkReload()).toBe(true);
  });
});

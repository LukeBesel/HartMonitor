import { describe, it, expect, beforeEach, vi } from 'vitest';
import { api, invalidateApiCache } from '../client';

// ─── What the client does when the API says "too many requests" ──────────────
// The screen the auditor saw said "Failed to load OEE data Error: Too Many
// Requests", and a completion POST simply failed. Neither is acceptable: a
// rejected request never reached its route, so nothing was written and the
// client can just ask again.

function jsonResponse(body: unknown, init: { status?: number; headers?: Record<string, string> } = {}) {
  return {
    ok: (init.status ?? 200) < 400,
    status: init.status ?? 200,
    statusText: 'Too Many Requests',
    headers: { get: (name: string) => init.headers?.[name] ?? null },
    json: async () => body,
  } as unknown as Response;
}

const rateLimited = (retryAfter?: string) => jsonResponse(
  { error: 'Too many requests. Please wait a moment and try again.', code: 'API_RATE_LIMITED' },
  { status: 429, headers: retryAfter ? { 'Retry-After': retryAfter } : {} },
);

describe('API client under rate limiting', () => {
  beforeEach(() => {
    invalidateApiCache();
    vi.mocked(global.fetch).mockReset();
  });

  it('retries a throttled GET and returns the eventual answer', async () => {
    vi.mocked(global.fetch)
      .mockResolvedValueOnce(rateLimited('0'))
      .mockResolvedValueOnce(jsonResponse([{ id: 'app-1' }]));

    await expect(api.getApps()).resolves.toEqual([{ id: 'app-1' }]);
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  it('retries a throttled completion POST rather than losing the operator run', async () => {
    vi.mocked(global.fetch)
      .mockResolvedValueOnce(rateLimited('0'))
      .mockResolvedValueOnce(jsonResponse({ id: 'run-1', status: 'in_progress' }));

    // Safe precisely because the rejection came from the limiter: the route
    // never ran, so there is no first submission to duplicate.
    await expect(api.createCompletion({ app_id: 'app-1' })).resolves.toMatchObject({ id: 'run-1' });
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  it('gives up on a wait it cannot sensibly sit through, and says how long', async () => {
    vi.mocked(global.fetch).mockResolvedValue(rateLimited('720'));

    await expect(api.getApps()).rejects.toThrow(/about 12 minutes/);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('never replays a 429 that is not the general API limiter', async () => {
    // The credential throttle sends its own code. Replaying a rejected login
    // attempt would quietly undo brute-force protection.
    vi.mocked(global.fetch).mockResolvedValue(jsonResponse(
      { error: 'Too many attempts.', code: 'RATE_LIMITED' },
      { status: 429, headers: { 'Retry-After': '30' } },
    ));

    await expect(api.getApps()).rejects.toThrow(/too many requests/i);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('surfaces the throttle as a 429 the caller can recognise', async () => {
    vi.mocked(global.fetch).mockResolvedValue(rateLimited('600'));
    await expect(api.getApps()).rejects.toMatchObject({ status: 429 });
  });
});

describe('sharing one GET between simultaneous callers', () => {
  beforeEach(() => {
    invalidateApiCache();
    vi.mocked(global.fetch).mockReset();
  });

  it('answers concurrent identical GETs from a single round trip', async () => {
    vi.mocked(global.fetch).mockResolvedValue(jsonResponse([{ id: 'app-1' }]));

    // The sidebar checklist, the training coach and the page itself all want the
    // app list on the same mount.
    const [a, b, c] = await Promise.all([api.getApps(), api.getApps(), api.getApps()]);

    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(a).toEqual([{ id: 'app-1' }]);
    expect(b).toEqual(a);
    expect(c).toEqual(a);
  });

  it('hands each caller its own copy, so one sorting in place cannot reorder another', async () => {
    vi.mocked(global.fetch).mockResolvedValue(jsonResponse([{ id: 'b' }, { id: 'a' }]));

    const [first, second] = await Promise.all([api.getApps(), api.getApps()]);
    (first as { id: string }[]).sort((x, y) => x.id.localeCompare(y.id));

    expect((second as { id: string }[])[0].id).toBe('b');
  });

  it('a write drops the shared copies, so the next read sees the change', async () => {
    vi.mocked(global.fetch)
      .mockResolvedValueOnce(jsonResponse([{ id: 'app-1' }]))
      .mockResolvedValueOnce(jsonResponse({ id: 'app-2' }))
      .mockResolvedValueOnce(jsonResponse([{ id: 'app-1' }, { id: 'app-2' }]));

    await api.getApps();
    await api.createApp({ name: 'Second' });
    await expect(api.getApps()).resolves.toHaveLength(2);
    expect(global.fetch).toHaveBeenCalledTimes(3);
  });

  it('does not remember a failed GET', async () => {
    vi.mocked(global.fetch)
      .mockResolvedValueOnce(jsonResponse({ error: 'boom' }, { status: 500 }))
      .mockResolvedValueOnce(jsonResponse([{ id: 'app-1' }]));

    await expect(api.getApps()).rejects.toThrow(/boom/);
    await expect(api.getApps()).resolves.toEqual([{ id: 'app-1' }]);
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });
});

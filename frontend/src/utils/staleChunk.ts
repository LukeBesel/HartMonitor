// ─── Stale chunk recovery ─────────────────────────────────────────────────────
// A deploy rewrites every hashed asset name. Tabs that were open across it — or
// restored from bfcache, or holding a service worker that still points at the
// old build — request files the server no longer has. The dynamic import
// rejects and the route never mounts, which is what put "Unable to preload CSS
// for /assets/AppPlayer-<hash>.css" in front of an operator mid-shift.
//
// Reloading picks up the new build. The only real hazard is a reload LOOP: if
// the asset is genuinely missing (a broken deploy, an offline device), reloading
// hits the same wall forever and the operator can never read the error. So the
// reload is rate-limited, and once the budget is spent the error is allowed
// through to the boundary where a person can see it.

const KEY = 'hm_stale_chunk_reload';
/** Two reloads inside this window is a loop, not a deploy. */
const WINDOW_MS = 60_000;
const MAX_RELOADS = 2;

interface ReloadRecord { at: number; count: number }

function read(): ReloadRecord {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return { at: 0, count: 0 };
    const parsed = JSON.parse(raw) as Partial<ReloadRecord>;
    return { at: Number(parsed.at) || 0, count: Number(parsed.count) || 0 };
  } catch {
    return { at: 0, count: 0 };   // private mode, or a value we didn't write
  }
}

/** True when a message/stack looks like a missing-chunk failure. */
export function isStaleChunkError(reason: unknown): boolean {
  const text =
    typeof reason === 'string' ? reason
    : reason instanceof Error ? `${reason.name} ${reason.message}`
    : '';
  if (!text) return false;
  return /unable to preload css/i.test(text)
    || /failed to fetch dynamically imported module/i.test(text)
    || /error loading dynamically imported module/i.test(text)
    || /importing a module script failed/i.test(text)
    || /\bChunkLoadError\b/.test(text);
}

/**
 * Claim permission to reload for a stale chunk. Returns false once the budget
 * is spent, so a genuinely broken asset surfaces as an error a person can read
 * instead of spinning the tab.
 */
export function takeStaleChunkReload(): boolean {
  const now = Date.now();
  const prev = read();
  const withinWindow = now - prev.at < WINDOW_MS;
  const count = withinWindow ? prev.count + 1 : 1;
  if (count > MAX_RELOADS) return false;
  try {
    sessionStorage.setItem(KEY, JSON.stringify({ at: now, count }));
  } catch {
    // Private mode: no budget tracking is possible. Allow exactly this one
    // reload — without storage we cannot detect a loop, and refusing outright
    // would leave every private-window user stranded on a stale build.
  }
  return true;
}

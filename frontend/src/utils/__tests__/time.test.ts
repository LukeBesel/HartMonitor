import { describe, it, expect, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { timeAgo } from '../time';
import { formatFreshness } from '../../components/shared/LastRefreshed';

// ─── One clock ────────────────────────────────────────────────────────────────
//
// `timeAgo` existed four times over: here, and privately on Quality, CAPA and
// Kaizen. They disagreed about the WORDS ("5 minutes ago" / "5m ago") and all
// four agreed on the same defect — reading SQLite's zone-less
// 'YYYY-MM-DD HH:MM:SS' with `new Date()`, which takes it for the BROWSER's
// local time. The same activity entry read "8m ago" on a tablet set to UTC and
// "9h ago" on the one somebody had left on Tokyo.

/** 2026-09-02 12:00:00 UTC — the "now" every age below is measured against. */
const NOW = Date.parse('2026-09-02T12:00:00Z');

/** Run `fn` with the process pretending to sit in `tz`, the way a tablet does. */
function inZone<T>(tz: string, fn: () => T): T {
  const original = process.env.TZ;
  process.env.TZ = tz;
  try {
    return fn();
  } finally {
    process.env.TZ = original;
  }
}

afterEach(() => { vi.useRealTimers(); });

describe('timeAgo reads the server’s clock, not the device’s', () => {
  it('gives the same age whatever zone the tablet is set to', () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    // A stamp exactly as SQLite hands it back: UTC, with nothing saying so.
    const stamp = '2026-09-02 11:30:00';
    const utc = inZone('UTC', () => timeAgo(stamp));
    const tokyo = inZone('Asia/Tokyo', () => timeAgo(stamp));
    const chicago = inZone('America/Chicago', () => timeAgo(stamp));
    expect(tokyo).toBe(utc);
    expect(chicago).toBe(utc);
    // …and the age is the one the SERVER's clock supports: 11:30 to 12:00 UTC.
    expect(utc).toBe('30m ago');
  });

  it('still reads a stamp that names its own zone', () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    expect(timeAgo('2026-09-02T09:00:00Z')).toBe('3h ago');
  });
});

describe('timeAgo says “—” rather than an age it does not have', () => {
  it('states an unreadable stamp as unknown, never “0m ago” or “NaN months ago”', () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    expect(timeAgo('not a date')).toBe('—');
    expect(timeAgo('')).toBe('—');
    expect(timeAgo(null)).toBe('—');
    expect(timeAgo(undefined)).toBe('—');
  });

  it('reads a stamp from the future as just now, not as a negative age', () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    // Two machines whose clocks differ by a minute is not an event that has
    // not happened yet.
    expect(timeAgo('2026-09-02 12:01:00')).toBe('just now');
  });
});

describe('timeAgo words an age one way', () => {
  it('runs the buckets from “just now” to months', () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    expect(timeAgo('2026-09-02 11:59:30')).toBe('just now');
    expect(timeAgo('2026-09-02 11:59:00')).toBe('1m ago');
    expect(timeAgo('2026-09-02 11:01:00')).toBe('59m ago');
    expect(timeAgo('2026-09-02 11:00:00')).toBe('1h ago');
    expect(timeAgo('2026-09-01 13:00:00')).toBe('23h ago');
    expect(timeAgo('2026-09-01 12:00:00')).toBe('1d ago');
    expect(timeAgo('2026-08-04 12:00:00')).toBe('29d ago');
    expect(timeAgo('2026-08-03 12:00:00')).toBe('1mo ago');
    expect(timeAgo('2026-03-02 12:00:00')).toBe('6mo ago');
  });
});

describe('timeAgo follows the freshness indicator’s wording, and says where it does not', () => {
  // The header of utils/time.ts claims the two agree on the buckets they share
  // and diverge at the ends on purpose. That is a claim about another file, so
  // it is read out of that file rather than trusted.
  it('spells a shared bucket exactly as formatFreshness does', () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const minute = 60_000;
    expect(timeAgo('2026-09-02 11:59:00')).toBe(formatFreshness(minute));
    expect(timeAgo('2026-09-02 11:30:00')).toBe(formatFreshness(30 * minute));
    expect(timeAgo('2026-09-02 09:00:00')).toBe(formatFreshness(180 * minute));
    expect(timeAgo('2026-08-21 12:00:00')).toBe(formatFreshness(12 * 1440 * minute));
  });

  it('parts company at the two ends, deliberately', () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    // Near end: the refresh indicator ticks in seconds under a live fetch; an
    // activity row does not, so anything under a minute is simply "just now".
    expect(formatFreshness(10_000)).toBe('10s ago');
    expect(timeAgo('2026-09-02 11:59:50')).toBe('just now');
    // Far end: a log holds last quarter, and "120d ago" is a number nobody
    // converts in their head.
    expect(formatFreshness(120 * 1440 * 60_000)).toBe('120d ago');
    expect(timeAgo('2026-05-05 12:00:00')).toBe('4mo ago');
  });
});

describe('no screen keeps a private copy of it', () => {
  // The four copies were found by reading the screens, which is exactly the
  // method that lets the fifth one back in — so it is a test.
  // Every screen the private copies lived on or were pointed at. CAPA is here
  // because it HELD one of the copies, not because it shows an age — its copy
  // was never called by anything, so CAPA must end up importing nothing.
  const SCREENS = [
    'src/pages/Quality.tsx',
    'src/pages/CAPA.tsx',
    'src/pages/Kaizen.tsx',
    'src/pages/Facilities.tsx',
    'src/components/shared/ActivityLog.tsx',
    'src/components/shared/AlertsBell.tsx',
  ];

  const IMPORTS_IT = /import \{ timeAgo \} from '\.{1,2}(\.\.)?\/*.*utils\/time'/;

  it.each(SCREENS)('%s keeps no second definition of the age', file => {
    const src = readFileSync(resolve(process.cwd(), file), 'utf-8');
    expect(src).not.toMatch(/function timeAgo/);
  });

  // Deliberately NOT "every screen imports it". Requiring the import of a
  // screen that shows no age is how a dead import gets locked in and the next
  // person to tidy the file gets a red suite for doing the right thing. The
  // rule is the two-way one: show an age and you take the shared definition;
  // show none and you carry no import for it.
  it.each(SCREENS)('%s imports the age exactly if it shows one', file => {
    const src = readFileSync(resolve(process.cwd(), file), 'utf-8');
    const uses = /\btimeAgo\(/.test(src);
    if (uses) expect(src).toMatch(IMPORTS_IT);
    else expect(src).not.toMatch(IMPORTS_IT);
  });

  it('leaves no screen guarding the stamp on timeAgo’s behalf', () => {
    // Facilities wrapped every call in its own `isNaN(new Date(when))` check —
    // the one screen that got the "—" right, using the very parse that was
    // wrong. The guard belongs inside the one definition.
    const src = readFileSync(resolve(process.cwd(), 'src/pages/Facilities.tsx'), 'utf-8');
    expect(src).not.toMatch(/isNaN\(new Date\(when\)/);
  });
});

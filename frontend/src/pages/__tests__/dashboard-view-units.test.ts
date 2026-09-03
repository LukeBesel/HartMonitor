import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { clockReading, seriesValueText } from '../DashboardView';
import { fmtMinutes } from '../../components/apps/appModel';

// ─── The card says what its number is; the view never guesses ────────────────
//
// backend/src/routes/dashboards.js puts a `unit` on every metric card, series
// and leaderboard ('count' | 'percent' | 'duration' | 'minutes', with
// `avg_cycle_seconds` carrying the exact seconds behind a duration) precisely
// so this screen does not have to read a LABEL to decide how to format. The
// label was the bug: "Admin Actions" contains "min" and is not a duration, and
// renaming a series silently changed the numbers under it.

/** Run `fn` with the process pretending to sit in `tz`, the way a PC does. */
function inZone<T>(tz: string, fn: () => T): T {
  const original = process.env.TZ;
  process.env.TZ = tz;
  try {
    return fn();
  } finally {
    process.env.TZ = original;
  }
}

const SRC = (() => {
  let dir = process.cwd();
  for (let i = 0; i < 6; i++) {
    for (const rel of ['src', join('frontend', 'src')]) {
      if (existsSync(join(dir, rel, 'App.tsx'))) return join(dir, rel);
    }
    dir = dirname(dir);
  }
  throw new Error(`Could not locate frontend/src from ${process.cwd()}`);
})();

describe('a dashboard value is formatted from its unit', () => {
  it('sends a minutes series through the one duration formatter', () => {
    // 6.5 minutes is "6m 30s" here, on the tile beside it, and on the per-app
    // screen — one formatter, one string.
    expect(seriesValueText('minutes', 6.5)).toBe(fmtMinutes(6.5));
    expect(seriesValueText('minutes', 6.5)).toBe('6m 30s');
  });

  it('prints a count as the count it is', () => {
    expect(seriesValueText('count', 12)).toBe('12');
    expect(seriesValueText('percent', 97)).toBe('97');
  });

  it('ignores the series name entirely', () => {
    // The name is not an input. A count named "(min)" is still a count, and a
    // duration named "Throughput" is still a duration.
    expect(seriesValueText('count', 45)).toBe(seriesValueText(undefined, 45));
    expect(seriesValueText('minutes', 45)).not.toBe(seriesValueText('count', 45));
  });

  it('keeps no label sniffing anywhere in the view', () => {
    const src = readFileSync(join(SRC, 'pages', 'DashboardView.tsx'), 'utf-8');
    // The exact shapes that shipped the bug: a name matched against "min", or a
    // label tested for a percent sign.
    expect(src).not.toMatch(/(?:name|label)[^\n]*\.(?:includes|match|test|indexOf)\s*\(/i);
    expect(src).not.toMatch(/\/min\//);
  });
});

describe('a start time is the server’s clock, read once', () => {
  it('reads a zone-less server stamp as UTC, whatever the PC is set to', () => {
    // The two stamps are the same instant; only one says so. `new Date()` read
    // the first as LOCAL and printed a run 5 hours out on a Chicago PC.
    const chicago = inZone('America/Chicago', () => [
      clockReading('2026-09-02 14:45:00'),
      clockReading('2026-09-02T14:45:00Z'),
    ]);
    expect(chicago[0]).toBe(chicago[1]);
    // …and that reading is genuinely the plant's afternoon shifted into
    // Chicago, not the raw digits handed back unchanged.
    expect(chicago[0]).not.toBe(inZone('UTC', () => clockReading('2026-09-02 14:45:00')));
  });

  it('says “—” for a stamp it cannot read, never a made-up time', () => {
    expect(clockReading('not a date')).toBe('—');
    expect(clockReading('')).toBe('—');
  });
});

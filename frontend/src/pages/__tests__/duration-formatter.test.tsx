import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

import { fmtDuration, durationBasisLabel, durationBasisNote } from '../../components/apps/appModel';

// ─── Exactly one duration formatter, and it takes seconds ─────────────────────
// The Command Center once declared its own `fmtDuration(m: number)` taking
// MINUTES, which shadowed the shared seconds-based one imported everywhere else.
// When a KPI switched to a seconds field the call site moved and the formatter
// did not, so 451 seconds rendered as "7.5h" on the most-viewed screen in the
// product — a 60x error that shipped because someone checked the payload and
// not the render.
//
// The old guard only watched Dashboard.tsx. Two more copies were living in
// AppAnalytics.tsx and CompletionDetail.tsx at the time it was written, and one
// of them differed: `if (!seconds) return '—'` turned a real zero into "unknown"
// and printed whole seconds only, so a measured 0.4 s read as "0s". This guard
// watches the whole tree.

const SRC = path.resolve(process.cwd(), 'src');

function walk(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return walk(full);
    return /\.(ts|tsx)$/.test(entry.name) ? [full] : [];
  });
}

const CANONICAL = path.join(SRC, 'components', 'apps', 'appModel.ts');

/**
 * Files that still carry a duration formatter of their own. Every entry is a
 * live 60x hazard and the list may only ever shrink.
 *
 * DepartmentTV.tsx declares `fmtDuration(min: number)` — the SAME NAME as the
 * shared seconds-taking one, taking MINUTES. That is the exact shape of the bug
 * that shipped: the day anyone in that file reaches for a `_seconds` field, it
 * renders sixty times too long and nothing catches it. It is held by another
 * agent as this is written, so it is named here rather than silently skipped.
 */
const KNOWN_LOCAL_FORMATTERS = ['pages/DepartmentTV.tsx'];

describe('the shared duration formatter is the only one', () => {
  it('is the only implementation — anything else must delegate to it', () => {
    const offenders = walk(SRC)
      .filter(file => {
        if (file === CANONICAL) return false;
        const src = fs.readFileSync(file, 'utf8');
        const declaresOne = /(?:function|const|let)\s+(fmt|format)Duration\b/.test(src);
        if (!declaresOne) return false;
        // A unit adapter is allowed; a second implementation is not. The
        // difference is whether the file imports the shared formatter.
        return !/import [^;]*\bfmtDuration\b[^;]*from '[^']*appModel'/s.test(src);
      })
      .map(f => path.relative(SRC, f));
    expect(offenders).toEqual(KNOWN_LOCAL_FORMATTERS);
  });

  it('is the implementation behind every duration a screen prints', () => {
    // Leaderboard re-exports a minutes-taking adapter for two screens whose
    // whole payload is in minutes. It must delegate, not reimplement.
    const src = fs.readFileSync(path.join(SRC, 'pages', 'Leaderboard.tsx'), 'utf8');
    expect(src).toMatch(/import \{ fmtDuration \} from '\.\.\/components\/apps\/appModel'/);
    expect(src).toMatch(/fmtDuration\(minutes \* 60\)/);
  });

  it('takes seconds — a seven-and-a-half-minute cycle is minutes, never hours', () => {
    expect(fmtDuration(451)).toBe('7m 31s');
    expect(fmtDuration(451)).not.toContain('h');
    expect(fmtDuration(3599)).toBe('59m 59s');
    expect(fmtDuration(3600)).toBe('1h');
    expect(fmtDuration(27060)).toBe('7h 31m');
  });

  it('keeps a sub-minute cycle in seconds', () => {
    expect(fmtDuration(6)).toBe('6s');
    expect(fmtDuration(12)).toBe('12s');
    expect(fmtDuration(59)).toBe('59s');
  });

  it('keeps a sub-second run measurable instead of printing 0s', () => {
    // A press, a scan or a go/no-go gauge is routinely under a second. Rounding
    // one to a whole second states that it took no time at all.
    expect(fmtDuration(0.4)).toBe('0.4s');
    expect(fmtDuration(3.2)).toBe('3.2s');
    expect(fmtDuration(3.56)).toBe('3.6s');
    expect(fmtDuration(0.02)).toBe('<0.1s');
    // A whole number stays whole — no cosmetic decimals.
    expect(fmtDuration(1)).toBe('1s');
    expect(fmtDuration(9)).toBe('9s');
  });

  it('says nothing rather than zero when there is nothing to say', () => {
    expect(fmtDuration(null)).toBe('—');
    expect(fmtDuration(undefined)).toBe('—');
    expect(fmtDuration(-5)).toBe('—');
    expect(fmtDuration(NaN)).toBe('—');
  });
});

describe('a duration on screen says which measurement it is', () => {
  it('labels both measurements distinguishably', () => {
    expect(durationBasisLabel('hands_on')).toBe('hands-on');
    expect(durationBasisLabel('elapsed')).toBe('wall clock');
    expect(durationBasisLabel('mixed')).toBe('mixed');
    expect(durationBasisLabel(null)).toBe('');
  });

  it('explains each one in a sentence a customer can act on', () => {
    expect(durationBasisNote('hands_on')).toMatch(/step timers/i);
    expect(durationBasisNote('elapsed')).toMatch(/wall clock/i);
    expect(durationBasisNote('mixed')).toMatch(/some/i);
    expect(durationBasisNote(null)).toMatch(/ever timed/i);
  });
});

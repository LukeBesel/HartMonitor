import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

import { fmtDuration, fmtMinutes, durationBasisLabel, durationBasisNote } from '../../components/apps/appModel';

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

// Every scan below excludes test files: a mock, a fixture, or this guard's own
// probes can legitimately declare a duration-shaped name without being a real
// screen-facing hazard, and a real one hiding behind a `.test.` filename would
// still be exercised by whatever test imports the module under test.
function isTestFile(file: string): boolean {
  return /__tests__/.test(file) || /\.test\.[jt]sx?$/.test(file);
}

function walk(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return walk(full);
    return /\.(ts|tsx)$/.test(entry.name) ? [full] : [];
  });
}

const CANONICAL = path.join(SRC, 'components', 'apps', 'appModel.ts');

/**
 * Files that still carry a `fmt*Duration`/`format*Duration` declaration of
 * their own that is a genuine second implementation (not the one allowlisted
 * adapter below) — the exact-name-shadow shape of the bug that shipped. Every
 * entry is a live 60x hazard and the list may only ever shrink.
 */
const KNOWN_LOCAL_FORMATTERS: string[] = [];

// The widened regex family, shared by both checks below: any
// fmt*/format*Duration|Dur|Elapsed|Runtime|Minutes|Mins|Seconds|Time
// declaration, anywhere outside appModel.ts and outside test files.
const WIDENED_DECLARATION_RE = /(?:function|const|let)\s+((?:fmt|format)\w*(?:Duration|Dur|Elapsed|Runtime|Minutes|Mins|Seconds|Time))\b/g;

/** `{ rel, name }` for every declaration the widened regex finds. */
function scanWidenedDeclarations(): { rel: string; name: string }[] {
  const hits: { rel: string; name: string }[] = [];
  for (const file of walk(SRC)) {
    if (file === CANONICAL || isTestFile(file)) continue;
    const src = fs.readFileSync(file, 'utf8');
    const rel = path.relative(SRC, file);
    let m: RegExpExecArray | null;
    WIDENED_DECLARATION_RE.lastIndex = 0;
    while ((m = WIDENED_DECLARATION_RE.exec(src))) {
      hits.push({ rel, name: m[1] });
    }
  }
  return hits;
}

/**
 * Declarations that match the name pattern above but are not a second
 * duration-string implementation, so they are named here instead of failing
 * the build. Every entry is `path -> identifier`, checked by exact name AND
 * exact file — not merely by file importing the right thing somewhere. An
 * earlier version of this guard exempted a whole FILE from every check the
 * moment it imported `fmtDuration`/`fmtMinutes` anywhere in it — a probe file
 * that imported `fmtMinutes` and separately declared its own minutes-taking
 * `fmtDuration` passed silently under that rule. That escape hatch is gone;
 * this list is the only one.
 *
 * `components/player/runtime.ts formatDur` is the one entry this check's
 * design calls for: a live mm:ss takt countdown clock, not a duration string
 * — it renders "07:31", never "7m 31s". It belongs to another workstream this
 * wave and is named here rather than edited out of place.
 *
 * `pages/Leaderboard.tsx formatDuration` is the single legitimate unit
 * adapter left in the tree: LeaderboardTV.tsx (outside this workstream) still
 * imports it by that name, so it stays exported, but its body is one line —
 * `return fmtMinutes(minutes);` — a re-export, not a second implementation.
 *
 * The remaining two were discovered only by actually running this wider scan
 * against the real tree, in files this workstream does not own (its remit is
 * appModel.ts, DepartmentTV/ManagerView/DashboardView/Leaderboard, not the
 * whole frontend) — so each is documented and named, never silently dropped,
 * exactly like `formatDur` above. (Two siblings this same scan found —
 * pages/Departments.tsx's `formatElapsed` and pages/Routings.tsx's
 * `formatCycleTime` — WERE genuine local duration-string reimplementations;
 * once the file-ownership conflict on those pages cleared, both were deleted
 * in favor of the shared formatter, so they no longer appear here.)
 *
 *   - `pages/ReceivingPortal.tsx fmtTime` renders a wall-clock reading
 *     ("2:45 PM" via toLocaleTimeString), the same shape as appModel's own
 *     `fmtDateTime` — not a duration. A false positive of the name heuristic,
 *     not a hazard.
 *   - `utils/time.ts fmtMinutes` rounds a raw minutes value to one decimal
 *     place ("6.1") with no unit-string conversion — not a duration-string
 *     formatter. It name-collides with the new canonical `fmtMinutes` added
 *     in this change, but predates it, and is not a 60x-shaped hazard:
 *     rounding a number is not confusing units. Left alone rather than
 *     renamed because its only consumer, pages/OperatorPortal.tsx, is being
 *     edited by another workstream right now — rename it to
 *     `roundOneDecimal` once OperatorPortal.tsx is free (coordinator
 *     follow-up), updating that one call site to match.
 */
const KNOWN_WIDENED_DECLARATIONS = [
  'components/player/runtime.ts -> formatDur',
  'pages/Leaderboard.tsx -> formatDuration',
  'pages/ReceivingPortal.tsx -> fmtTime',
  'utils/time.ts -> fmtMinutes',
].sort();

describe('the shared duration formatter is the only one', () => {
  it('is the only implementation — anything else must delegate to it', () => {
    // A subset of the widened scan: the strict `fmt*Duration`/`format*Duration`
    // name only, so the historical KNOWN_LOCAL_FORMATTERS list keeps its
    // narrower meaning. The single allowlisted entry lives in
    // KNOWN_WIDENED_DECLARATIONS, not a second list — an identifier exempted
    // there is exempted everywhere, never re-litigated per check.
    const offenders = scanWidenedDeclarations()
      .filter(h => /^(fmt|format)Duration$/.test(h.name))
      .filter(h => !KNOWN_WIDENED_DECLARATIONS.includes(`${h.rel} -> ${h.name}`))
      .map(h => h.rel);
    expect(offenders).toEqual(KNOWN_LOCAL_FORMATTERS);
  });

  it('is the implementation behind every duration a screen prints', () => {
    // Leaderboard's whole payload is in minutes; it renders through the shared
    // minutes adapter, never a local reimplementation. `formatDuration` stays
    // exported (LeaderboardTV.tsx imports it) but is now a one-line re-export.
    const src = fs.readFileSync(path.join(SRC, 'pages', 'Leaderboard.tsx'), 'utf8');
    expect(src).toMatch(/import \{ fmtMinutes \} from '\.\.\/components\/apps\/appModel'/);
    expect(src).toMatch(/return fmtMinutes\(minutes\);/);
    expect(src).not.toMatch(/fmtDuration\(minutes \* 60\)/);
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

// ─── No copy-pasted call site can rename its way around the guard ─────────────
// The narrow check above only catches a declaration literally named
// `fmt*Duration`/`format*Duration`. ManagerView.tsx's `formatElapsed` and
// DashboardView.tsx's old `toFixed(1)` renderings were both real 60x-shaped
// hazards that a Duration-only name check would never see. This widens the
// name check to the whole family of duration-shaped names, and separately
// checks for the `.toFixed(` shortcut on a duration-shaped value — the two
// ways a screen has actually shipped a wrong number in this product.

describe('no duration-shaped declaration escapes the guard by name alone', () => {
  it('names every fmt*/format* Duration|Elapsed|Runtime|Minutes|Seconds|Time declaration outside appModel.ts', () => {
    const hits = scanWidenedDeclarations().map(h => `${h.rel} -> ${h.name}`);
    expect(hits.sort()).toEqual(KNOWN_WIDENED_DECLARATIONS);
  });

  it('applies no .toFixed( to a minute-, cycle- or elapsed-named value outside appModel.ts', () => {
    // Identifier chain immediately before `.toFixed(` — e.g. `data.value`,
    // `wo.takt_time_minutes`, `a.b[0]` — matched against the same source text
    // the guard above scans.
    const CHAIN_RE = /([A-Za-z_$][\w$]*(?:\??\.[A-Za-z_$][\w$]*|\[[^\]]{0,40}\])*)\s*\.toFixed\(/g;
    // A parenthesised expression before `.toFixed(` — e.g.
    // `(elapsed / 60).toFixed(1)` — has no single identifier chain for
    // CHAIN_RE to capture (CHAIN_RE's grammar has no parens in it, by design:
    // an arbitrary expression isn't a single named value). Test whatever's
    // written in the last 40 characters before that close-paren instead.
    const PAREN_RE = /\)\s*\.toFixed\(/g;
    const TARGET_RE = /minute|_min\b|cycle|elapsed/i;
    const hits: string[] = [];
    for (const file of walk(SRC)) {
      if (file === CANONICAL || isTestFile(file)) continue;
      const src = fs.readFileSync(file, 'utf8');
      const rel = path.relative(SRC, file);

      let m: RegExpExecArray | null;
      CHAIN_RE.lastIndex = 0;
      while ((m = CHAIN_RE.exec(src))) {
        if (TARGET_RE.test(m[1])) hits.push(`${rel} -> ${m[1]}.toFixed(`);
      }

      PAREN_RE.lastIndex = 0;
      while ((m = PAREN_RE.exec(src))) {
        const preceding = src.slice(Math.max(0, m.index - 40), m.index);
        if (TARGET_RE.test(preceding)) hits.push(`${rel} -> (...${preceding.replace(/\s+/g, ' ')}).toFixed(`);
      }
    }
    // No legitimate hit exists today — every duration-shaped `.toFixed(` this
    // workstream found was a real hazard and was fixed at the call site
    // (ManagerView's ETA, DashboardView's two minute renderings). If a future
    // change adds a genuinely non-duration hit, it gets allowlisted here by
    // exact file + identifier with a comment, never by loosening TARGET_RE.
    expect(hits).toEqual([]);
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

describe('fmtMinutes is the only permitted unit conversion onto fmtDuration', () => {
  it('matches the canonical seconds-based rendering exactly', () => {
    // 7.5 minutes = 450s -> fmtDuration(450) = '7m 30s'; 0.1 minutes = 6s.
    expect(fmtMinutes(7.5)).toBe(fmtDuration(450));
    expect(fmtMinutes(7.5)).toBe('7m 30s');
    expect(fmtMinutes(0.1)).toBe(fmtDuration(6));
    expect(fmtMinutes(0.1)).toBe('6s');
  });

  it('says nothing rather than zero when there is nothing to say', () => {
    expect(fmtMinutes(null)).toBe('—');
    expect(fmtMinutes(undefined)).toBe('—');
    expect(fmtMinutes(-1)).toBe('—');
    expect(fmtMinutes(NaN)).toBe('—');
  });
});

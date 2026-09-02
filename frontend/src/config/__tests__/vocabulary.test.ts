import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';

// ─── One name per thing ───────────────────────────────────────────────────────
// A plant manager should never meet a word this product invented, and never
// meet two words for one thing. Four names for a station (Stations, WORKSTATIONS,
// "work centers", "machines"), two for a help call ("Request help" on the
// sidebar, "Call for help" on the page), two for a company ("Create Company",
// "Create Workspace"), an acronym for maintenance (CMMS) and a job title no
// plant uses for a person (developer) were all found by reading the screens —
// which is exactly the method that lets the next one back in.
//
// So the vocabulary is a test. Every entry below names a word the product does
// not use, the ONE word it uses instead, and where the second one came from.
// Adding a banned string is how a rename becomes permanent; the ALLOWLIST
// underneath it is the short, argued list of places a banned string may still
// appear, each with the reason it may.
//
// Scope: every .ts/.tsx under frontend/src except tests. Comments count. A
// comment naming a screen that no longer exists is how the old vocabulary gets
// copied back into new code by someone reading around for context.

type Banned = { term: string; instead: string };

const BANNED: Banned[] = [
  // ── One physical thing: a station ──────────────────────────────────────────
  { term: 'Workstation',   instead: 'Station' },
  { term: 'workstation',   instead: 'station' },
  { term: 'Work center',   instead: 'Station' },
  { term: 'work center',   instead: 'station' },
  // Two words, and it read as a different thing again in the Settings header.
  { term: 'Work station',  instead: 'Station' },
  { term: 'work station',  instead: 'station' },
  { term: 'Total Machines', instead: 'Stations' },
  // ── Maintenance is not an acronym ──────────────────────────────────────────
  { term: 'CMMS',          instead: 'Maintenance' },
  // ── One help call, cancelled one way ───────────────────────────────────────
  { term: 'Stand down',    instead: 'Cancel call' },
  { term: 'Request help',  instead: 'Call for help' },
  // ── A run in progress is running, not "on the bench" ───────────────────────
  { term: 'On the bench',  instead: 'Running now' },
  // ── One company, created once ──────────────────────────────────────────────
  // "Workspaces" survives for the SIDEBAR GROUPINGS (Production, Quality, …),
  // which is a different concept and the only thing Settings → Navigation calls
  // by that name. What is banned is the company being called a workspace.
  { term: 'Create Workspace', instead: 'Create Company' },
  { term: 'your workspace', instead: 'your company' },
  { term: 'Your workspace', instead: 'Your company' },
  // ── Screens that no longer exist, under the names they had ─────────────────
  { term: 'Select an operation',  instead: 'Select an app…' },
  { term: 'Operation Analytics',  instead: 'App comparison' },
  { term: 'Manager View',         instead: 'Command Center' },
  { term: 'OEE Tracker',          instead: 'the OEE tab on App comparison' },
  { term: 'Transaction Log',      instead: 'Audit Log' },
  { term: 'Leaderboard TV',       instead: 'Leaderboard' },
  { term: 'Apps Dashboard',       instead: 'App Library' },
  { term: 'App History',          instead: 'App Details' },
  { term: 'App Analytics',        instead: 'App Details' },
  // ── A duration is formatted, never labelled with its unit ──────────────────
  // The metric payload carries `unit`; the view formats seconds through
  // fmtDuration. A metric NAMED "(min)" is the label-sniffing this replaced.
  { term: 'Avg Cycle Time (min)', instead: "the metric's `unit` field" },
];

/** Where a banned string may still appear, and why. Anything not listed here
 *  is a failure — the point is that each exception is argued once, in writing,
 *  rather than discovered later in a screenshot. */
const ALLOWLIST: { file: string; terms: string[]; why: string }[] = [
  {
    file: 'pages/Landing.tsx',
    terms: ['CMMS', 'your workspace'],
    why: 'Public marketing copy, outside the product shell. A buyer searching for "CMMS" has to find the page; the plant manager inside the app never sees it.',
  },
  {
    file: 'api/client.ts',
    terms: ['CMMS', 'Transaction Log'],
    why: 'Section comments in the shared API client — no user ever reads them, and the file is owned by another workstream this wave.',
  },
  {
    file: 'App.tsx',
    terms: ['Apps Dashboard'],
    why: 'A route comment recording which retired screen a redirect exists for. The routing table is off-limits this wave; the name appears nowhere on screen.',
  },
  {
    file: 'pages/AppPlayer.tsx',
    terms: ['Request help'],
    why: 'Two code comments in the operator player (off-limits this wave). Its on-screen labels come from components/player/*, which say "Call for help".',
  },
];

const SRC = (() => {
  let dir = process.cwd();
  for (let i = 0; i < 6; i++) {
    for (const rel of ['src', join('frontend', 'src')]) {
      const candidate = join(dir, rel);
      if (existsSync(join(candidate, 'App.tsx'))) return candidate;
    }
    dir = dirname(dir);
  }
  throw new Error(`Could not locate frontend/src from ${process.cwd()}`);
})();

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === '__tests__' || entry === 'node_modules') continue;
      sourceFiles(full, out);
      continue;
    }
    if (!/\.(ts|tsx)$/.test(entry)) continue;
    if (/\.test\.tsx?$/.test(entry)) continue;
    out.push(full);
  }
  return out;
}

function allowed(relPath: string, term: string): boolean {
  const posix = relPath.split(sep).join('/');
  return ALLOWLIST.some(a => a.file === posix && a.terms.includes(term));
}

describe('product vocabulary', () => {
  const files = sourceFiles(SRC);

  it('scans the whole frontend, not a corner of it', () => {
    expect(files.length).toBeGreaterThan(100);
    expect(files.some(f => f.endsWith(`${sep}App.tsx`))).toBe(true);
  });

  it('uses one name per thing, everywhere', () => {
    const violations: string[] = [];
    for (const file of files) {
      const rel = relative(SRC, file);
      const lines = readFileSync(file, 'utf-8').split('\n');
      for (const { term, instead } of BANNED) {
        if (allowed(rel, term)) continue;
        lines.forEach((line, i) => {
          if (line.includes(term)) {
            violations.push(`${rel.split(sep).join('/')}:${i + 1} says "${term}" — this product says "${instead}"`);
          }
        });
      }
    }
    expect(violations).toEqual([]);
  });

  it('keeps every allowlist entry honest', () => {
    // An allowlist entry that no longer matches anything is a rule nobody is
    // following any more — delete it, so the list stays short enough to read.
    const stale: string[] = [];
    for (const entry of ALLOWLIST) {
      const full = join(SRC, ...entry.file.split('/'));
      const text = existsSync(full) ? readFileSync(full, 'utf-8') : '';
      for (const term of entry.terms) {
        if (!text.includes(term)) stale.push(`${entry.file} no longer contains "${term}"`);
      }
      expect(entry.why.length, `${entry.file} needs a reason`).toBeGreaterThan(20);
    }
    expect(stale).toEqual([]);
  });
});

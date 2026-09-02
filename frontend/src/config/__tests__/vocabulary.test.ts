import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';

// ─── One name per thing ───────────────────────────────────────────────────────
// A plant manager should never meet a word this product invented, and never
// meet two words for one thing. Four names for a station (Stations,
// WORKSTATIONS, "work centers", "machines"), two for a help call ("Request
// help" on the sidebar, "Call for help" on the page), two for a company
// ("Create Company", "Create Workspace"), an acronym for maintenance (CMMS) and
// a job title no plant uses for a person (developer) were all found by reading
// the screens — which is exactly the method that lets the next one back in.
//
// So the vocabulary is a test. Every entry below names a word the product does
// not use, the ONE word it uses instead, and the ALLOWLIST underneath is the
// short, argued list of places a banned word may still appear.
//
// Two rules about the scan itself:
//   • It is CASE-INSENSITIVE. "Work Center" in a heading slipped past a
//     case-sensitive list once already.
//   • COMMENTS COUNT. A comment naming a retired screen is how the old
//     vocabulary gets copied back into new code by someone reading around for
//     context — and half the strings this file bans started as one.
//
// Scope: every .ts/.tsx under frontend/src except tests.

type Banned = {
  term: string;
  instead: string;
  /** Match on word boundaries instead of as a substring. Needed where a word
   *  is also part of a legitimate identifier — `MachineStatus` is not the word
   *  "machines", and a substring scan flagged it. */
  word?: boolean;
};

const BANNED: Banned[] = [
  // ── One physical thing: a station ──────────────────────────────────────────
  { term: 'workstation',    instead: 'station' },
  { term: 'work station',   instead: 'station' },
  { term: 'work center',    instead: 'station' },
  { term: 'machines',       instead: 'stations', word: true },
  { term: 'Total Machines', instead: 'Stations' },
  // ── Maintenance is not an acronym ──────────────────────────────────────────
  { term: 'CMMS',           instead: 'Maintenance' },
  // ── One help call, cancelled one way ───────────────────────────────────────
  { term: 'Stand down',     instead: 'Cancel call' },
  { term: 'Request help',   instead: 'Call for help' },
  // ── A run in progress is running ───────────────────────────────────────────
  { term: 'on the bench',   instead: 'running' },
  // ── One company, and it is called a company ────────────────────────────────
  // "Workspace" survives for the SIDEBAR GROUPINGS (Production, Quality, …),
  // which is a different concept — see the allowlist entry that names every
  // file allowed to say it, and why. A COMPANY is never a workspace.
  { term: 'workspace',      instead: 'company' },
  // ── A role is a permission level, not a job title ──────────────────────────
  { term: 'your developer',   instead: 'the Owner' },
  { term: 'developer only',   instead: 'Owner only' },
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
  // The card payload carries `unit`; the view formats seconds through
  // fmtDuration and minutes through fmtMinutes. A metric or a chart series
  // NAMED "(min)" is the label-sniffing this replaced.
  { term: 'Avg Cycle Time (min)', instead: "the card's `unit` field" },
  { term: 'Avg Cycle (min)',      instead: "the card's `unit` field" },
];

/** Where a banned word may still appear, and why. Terms are written with the
 *  casing they actually have in the files; matching, like the scan, ignores
 *  case. One entry may cover several files when they share one reason. */
const ALLOWLIST: { files: string[]; terms: string[]; why: string }[] = [
  {
    files: ['pages/Landing.tsx'],
    terms: ['CMMS', 'workspace'],
    why: 'Public marketing copy, outside the product shell. A buyer searching for "CMMS" has to find the page; the plant manager inside the app never sees it.',
  },
  {
    files: ['api/client.ts'],
    terms: ['CMMS', 'Transaction Log', 'App Analytics', 'workspace'],
    why: 'Section comments in the shared API client — no user ever reads them, and the file is owned by another workstream this wave.',
  },
  {
    files: ['App.tsx'],
    terms: ['Apps Dashboard', 'App Analytics', 'workspace'],
    why: 'Route comments recording which retired screen a redirect exists for, and the workspace tab bar the shell renders. The routing table is off-limits this wave; neither name appears on screen.',
  },
  {
    files: ['pages/AppPlayer.tsx', 'pages/OperatorPortal.tsx'],
    terms: ['Request help', 'App History'],
    why: 'Code comments in the operator player and portal (both off-limits this wave). Their on-screen labels come from components/player/*, which say "Call for help", and neither screen prints a retired screen name.',
  },
  {
    // The ONE surviving meaning of the word: the sidebar's groupings of screens
    // (Production, Quality, Planning …), which Settings → Navigation lets a
    // company switch on and off. These files define it, render it, or explain a
    // screen's relationship to it. A COMPANY is never a workspace anywhere.
    files: [
      'config/navigation.tsx',
      'config/pageTitles.ts',
      'components/shared/Layout.tsx',
      'components/shared/TabBar.tsx',
      'components/shared/SetupChecklist.tsx',
      'components/shared/DashboardFilterBar.tsx',
      'components/apps/AppTrainingCoach.tsx',
      'context/NavPrefsContext.tsx',
      'api/settings.ts',
      'pages/settings/NavigationTab.tsx',
      'pages/settings/CompanySettings.tsx',
      'pages/settings/groups.ts',
      'pages/CategoryReports.tsx',
      'pages/DashboardView.tsx',
      'pages/AppBuilder.tsx',
      'pages/CIProjects.tsx',
      'pages/Inventory.tsx',
      'types.ts',
    ],
    terms: ['workspace'],
    why: 'The sidebar grouping of screens — a real, separate concept the product names on screen ("WORKSPACES"), switchable per company in Settings → Navigation. These files define it, render it, or say which grouping a screen belongs to.',
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

const posix = (relPath: string) => relPath.split(sep).join('/');

function allowed(relPath: string, term: string): boolean {
  const file = posix(relPath);
  const wanted = term.toLowerCase();
  return ALLOWLIST.some(a => a.files.includes(file) && a.terms.some(t => t.toLowerCase() === wanted));
}

describe('product vocabulary', () => {
  const files = sourceFiles(SRC);

  it('scans the whole frontend, not a corner of it', () => {
    expect(files.length).toBeGreaterThan(100);
    expect(files.some(f => f.endsWith(`${sep}App.tsx`))).toBe(true);
  });

  it('uses one name per thing, everywhere, whatever the casing', () => {
    const violations: string[] = [];
    for (const file of files) {
      const rel = posix(relative(SRC, file));
      const lines = readFileSync(file, 'utf-8').split('\n');
      for (const { term, instead, word } of BANNED) {
        if (allowed(rel, term)) continue;
        const needle = term.toLowerCase();
        const rx = word ? new RegExp(`\\b${needle}\\b`, 'i') : null;
        lines.forEach((line, i) => {
          if (rx ? rx.test(line) : line.toLowerCase().includes(needle)) {
            violations.push(`${rel}:${i + 1} says "${term}" — this product says "${instead}"`);
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
      expect(entry.why.length, `${entry.files[0]} needs a reason`).toBeGreaterThan(20);
      for (const file of entry.files) {
        const full = join(SRC, ...file.split('/'));
        const text = (existsSync(full) ? readFileSync(full, 'utf-8') : '').toLowerCase();
        const used = entry.terms.some(t => text.includes(t.toLowerCase()));
        if (!used) stale.push(`${file} no longer contains any of ${entry.terms.join(', ')}`);
      }
    }
    expect(stale).toEqual([]);
  });
});

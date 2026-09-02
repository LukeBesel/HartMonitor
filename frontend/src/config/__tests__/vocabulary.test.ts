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
    // "Workspace" no longer appears on any screen — the sidebar heading that
    // used it is gone (a list of sections needs no label over it), and every
    // remaining surface says "section". What is left is CODE: comments, and two
    // files this wave may not edit. The on-screen scan below is the one that
    // matters, and it allows the word in exactly one place: the marketing page.
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
      'api/client.ts',
      'App.tsx',
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
    why: 'Code comments and identifiers only — no screen prints the word any more. config/navigation.tsx and App.tsx are off-limits this wave; the rest keep it in prose comments describing the sidebar sections. The on-screen scan below bans the word for readers everywhere but the marketing page.',
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

// ─── What a person actually READS ─────────────────────────────────────────────
//
// The scan above reads whole files, comments included, which is right for words
// this product has retired outright. It is the wrong tool for a word that is a
// legitimate part of the CODE and a foreign word on the SCREEN. "Widget" is the
// type name of a thing an app step holds — `Widget`, `widgets`, `widget_id`,
// `'widget'` as a discriminator, ninety-odd times in the builder alone — and it
// is also what four screens called a FIELD in front of a plant manager who has
// never met the word. Banning it everywhere is impossible; letting it stand is
// how it came back.
//
// So this scan reads only what a reader can see:
//
//   • JSX text — the words between an element's tags,
//   • the value of an attribute a person reads (title, placeholder, aria-label,
//     alt, and the label/hint/description props this codebase passes around),
//   • the message handed to setError / addToast / confirm / alert.
//
// Everything else — identifiers, discriminators, class names, test ids, import
// paths, comments — is invisible to a customer and is left alone.
//
// The extractor is deliberately conservative: when it cannot tell whether a
// span is prose or code it drops the span. A miss is a defect this test failed
// to catch; a false positive is a rule nobody can satisfy, and that is the one
// that gets a test deleted.

/** Attributes and props whose string values a person reads. */
const VISIBLE_ATTRS = new Set([
  'title', 'placeholder', 'alt', 'aria-label', 'ariaLabel', 'aria-description',
  'label', 'tileLabel', 'hint', 'desc', 'description', 'subtext', 'heading',
  'matchNoun', 'deltaLabel', 'emptyText', 'confirmLabel', 'why',
]);

/** Calls whose first string argument is shown to a person. */
const VISIBLE_CALLS = /\b(?:setError|setSampleError|addToast|confirm|alert|setStatusText)\s*\(\s*(['"`])((?:\\.|(?!\1)[\s\S])*?)\1/g;

/** `label: 'Widget'` and friends, in an object literal rather than on a tag. */
const VISIBLE_PROPS = new RegExp(
  `\\b(${[...VISIBLE_ATTRS].filter(a => /^[a-zA-Z]+$/.test(a)).join('|')})\\s*:\\s*(['"\`])((?:\\\\.|(?!\\2)[\\s\\S])*?)\\2`,
  'g',
);

/** One readable string, and the line it is on. */
interface Readable { line: number; text: string }

const lineOf = (source: string, index: number) => source.slice(0, index).split('\n').length;

/** Blank out every comment, preserving offsets and newlines so line numbers
 *  survive. `://` is left alone — that is a URL, not a comment. */
function maskComments(source: string): string {
  const out = source.split('');
  let i = 0;
  const blank = (from: number, to: number) => {
    for (let k = from; k < to && k < out.length; k++) if (out[k] !== '\n') out[k] = ' ';
  };
  while (i < source.length) {
    const two = source.slice(i, i + 2);
    if (two === '//' && source[i - 1] !== ':') {
      const end = source.indexOf('\n', i);
      blank(i, end === -1 ? source.length : end);
      i = end === -1 ? source.length : end;
      continue;
    }
    if (two === '/*') {
      const end = source.indexOf('*/', i + 2);
      blank(i, end === -1 ? source.length : end + 2);
      i = end === -1 ? source.length : end + 2;
      continue;
    }
    if (two === '*/') { i += 2; continue; }
    i++;
  }
  return out.join('');
}

/** True when a span between a `>` and the next `<` is prose rather than the
 *  code that follows a generic type argument (`useState<Widget[]>(null);`, or
 *  a function type ending `): Promise<T>`). Punctuation prose never uses is
 *  the tell, and when in doubt the span is dropped. */
function looksLikeProse(text: string): boolean {
  if (!/[A-Za-z]{2}/.test(text)) return false;
  return !/[;={}|]/.test(text) && !text.includes('=>') && !/\?:/.test(text);
}

/** A template literal's `${…}` holes are CODE, not words — `${wo.pm_title}` is
 *  not the screen saying "WO". Blanked out before anything is matched. */
function withoutHoles(text: string): string {
  return text.replace(/\$\{[^}]*\}/g, ' ');
}

/** Everything on one file a customer can read. */
function readableText(source: string): Readable[] {
  const src = maskComments(source);
  const found: Readable[] = [];

  // JSX text: the span between a tag's `>` and the next `<`. Tags are found by
  // `<` + a tag name, which is also what a generic looks like — hence the prose
  // guard above, which throws the generics away.
  const tagOpen = /<\/?[A-Za-z][\w.]*/g;
  let m: RegExpExecArray | null;
  while ((m = tagOpen.exec(src))) {
    let i = m.index + m[0].length;
    let depth = 0;
    // Walk to this tag's own `>`, ignoring any inside braces or strings.
    while (i < src.length) {
      const c = src[i];
      if (c === '{') depth++;
      else if (c === '}') depth--;
      else if ((c === '"' || c === "'" || c === '`')) {
        const close = src.indexOf(c, i + 1);
        i = close === -1 ? src.length : close;
      } else if (c === '>' && depth <= 0) break;
      i++;
    }
    if (i >= src.length) break;
    const next = src.indexOf('<', i + 1);
    const text = src.slice(i + 1, next === -1 ? src.length : next);
    if (looksLikeProse(text)) found.push({ line: lineOf(src, i), text: withoutHoles(text) });
    tagOpen.lastIndex = i;
  }

  // Attribute values a person reads: name="…" / name='…' / name={`…`}.
  const attr = /([A-Za-z][\w-]*)\s*=\s*\{?\s*(['"`])((?:\\.|(?!\2)[\s\S])*?)\2/g;
  while ((m = attr.exec(src))) {
    if (VISIBLE_ATTRS.has(m[1])) found.push({ line: lineOf(src, m.index), text: withoutHoles(m[3]) });
  }

  for (const rx of [VISIBLE_PROPS, VISIBLE_CALLS]) {
    rx.lastIndex = 0;
    while ((m = rx.exec(src))) found.push({ line: lineOf(src, m.index), text: withoutHoles(m[m.length - 1]) });
  }

  return found;
}

/** Words no screen says, and the word every screen says instead. */
const BANNED_ON_SCREEN: Banned[] = [
  // ── The sidebar groups screens. It does not need a name for the grouping ───
  { term: 'workspace',    instead: 'nothing — the sidebar needs no label over it' },
  // ── An app step holds FIELDS. "Widget" is the type name, not the word ──────
  { term: 'widget',       instead: 'field' },
  { term: 'canvas',       instead: 'the page' },
  // ── One help call ─────────────────────────────────────────────────────────
  { term: 'help request', instead: 'call' },
  // ── A maintenance job is a job, never a WO ────────────────────────────────
  { term: 'WO',           instead: 'job', word: true },
  // ── Words from inside the machine ─────────────────────────────────────────
  { term: 'payload',      instead: 'what the screen is showing' },
  { term: 'schema',       instead: 'the plain word for the thing' },
  { term: 'token',        instead: 'the plain word for the thing' },
  { term: 'null',         instead: '— with the reason beside it', word: true },
  { term: 'prop',         instead: 'the plain word for the thing', word: true },
];

/** The one screen allowed a retired word, and why. */
const ON_SCREEN_ALLOWLIST: { files: string[]; terms: string[]; why: string }[] = [
  {
    files: ['pages/Landing.tsx'],
    terms: ['workspace', 'widget', 'WO'],
    why: 'Public marketing copy, outside the product shell. It sells to a buyer who searches with these words, and its screenshot mock-up prints a work order id verbatim; nobody inside the app meets them.',
  },
];

describe('the words on the screen', () => {
  const files = sourceFiles(SRC);

  it('reads prose and leaves the code alone', () => {
    // The extractor is only trustworthy if it can be shown to do both halves.
    const sample = [
      'const [w, setW] = useState<Widget[]>(null);',
      'export type ContextTab = \'widget\' | \'step\';',
      'const el = <p className="x">Select a field on the page</p>;',
      '<input title="Days of lead time" />',
      '// a widget comment',
      'const s = <span>Raised from PM: {`x ${widget.type} y`}</span>;',
    ].join('\n');
    const text = readableText(sample).map(r => r.text).join(' ~ ');
    expect(text).toContain('Select a field on the page');
    expect(text).toContain('Days of lead time');
    expect(text.toLowerCase()).not.toContain('widget');
  });

  it('never says a word the product invented where a customer can read it', () => {
    const violations: string[] = [];
    for (const file of files) {
      const rel = posix(relative(SRC, file));
      const readable = readableText(readFileSync(file, 'utf-8'));
      for (const { term, instead, word } of BANNED_ON_SCREEN) {
        const wanted = term.toLowerCase();
        if (ON_SCREEN_ALLOWLIST.some(a => a.files.includes(rel) && a.terms.some(t => t.toLowerCase() === wanted))) continue;
        const rx = word ? new RegExp(`\\b${wanted}\\b`, 'i') : null;
        for (const { line, text } of readable) {
          if (rx ? rx.test(text) : text.toLowerCase().includes(wanted)) {
            violations.push(`${rel}:${line} shows "${term}" to a customer — say "${instead}" (in: ${text.trim().slice(0, 60)})`);
          }
        }
      }
    }
    expect(violations).toEqual([]);
  });
});


// ─── The sidebar needs no label over it ──────────────────────────────────────
// "WORKSPACES" sat above the sidebar's sections in small caps. It named a
// concept the product invented, over a list whose every row is obviously a
// section, on the one piece of chrome that is on screen all day. The heading is
// gone rather than renamed: a grouping this obvious does not need announcing,
// and "MENU" would have been a second word for the same nothing.

describe('the sidebar', () => {
  const layout = () => readFileSync(join(SRC, 'components', 'shared', 'Layout.tsx'), 'utf-8');

  it('prints no heading above its sections', () => {
    for (const { text } of readableText(layout())) {
      expect(text.toLowerCase()).not.toContain('workspace');
      expect(text.trim().toLowerCase()).not.toBe('menu');
    }
  });

  it('still renders the sections themselves', () => {
    // The heading went; the nav did not.
    expect(layout()).toMatch(/primarySections\.map\(renderSection\)/);
    expect(layout()).toMatch(/secondarySections/);
  });
});

// ─── Player runtime helpers (spec §5.3–§5.5) ─────────────────────────────────
// Pure functions backing the player's standing validation gate, kit progress
// rollups, scan validation chain, and the rich-capture value mapping. No React,
// no DOM — unit-testable in isolation.

import type {
  Step, Widget, WidgetType, KitLine, CompletionValueInput, CompletionValueType,
} from '../../types';
import { luminance } from '../../utils/contrast';

/** Legacy formData key — unchanged from v1 (spec §5.3). */
export function legacyKey(w: Widget): string {
  return w.config.variableName || w.id;
}

/**
 * Every widget type that captures a value: they carry a variableName, they can
 * fire input_change triggers, and the builder offers each of them a "Required
 * field" switch. Declared HERE, in the leaf module, and re-exported by the
 * builder palette — the player bundle must not import the builder.
 */
export const INPUT_WIDGET_TYPES: readonly WidgetType[] = [
  'text-input', 'number-input', 'select-input', 'checkbox',
  'counter', 'pass-fail', 'signature', 'scan-input', 'photo-capture',
];

/**
 * Required means required. The gate covers exactly the set the builder offers
 * the switch on — nothing else would be defensible: an app author who ticks
 * "Required" on a pass-fail, a signature or a counter has said the run may not
 * finish without it, and until now the player let all three through. The seeded
 * QC app booked units as good with `qc_result` absent because of it.
 *
 * BEHAVIOUR CHANGE from v1, deliberately: signature, pass-fail and counter now
 * gate. Apps that ticked Required on one of those and relied on it being
 * ignored will now stop the operator there.
 */
export const REQUIRED_WIDGET_TYPES: readonly WidgetType[] = INPUT_WIDGET_TYPES;

export interface BlockItem {
  widgetId?: string;
  kind: 'required' | 'range' | 'pattern' | 'photo' | 'kit';
  message: string;
}

export interface KitGateInput {
  /** The step gates on the kit (kit step or kit-checklist present) AND a kit exists. */
  gated: boolean;
  lines: KitLine[];
  /** true = only 'verified' counts; false = 'picked' counts too (contract). */
  requireScan: boolean;
}

function isEmpty(v: unknown): boolean {
  return v === undefined || v === null || v === '';
}

/** A widget's operator-facing name, tolerating hand-authored apps that put the
 *  label inside config (the same fallback the player's renderer uses). */
export function widgetLabel(w: Widget, fallback = 'This field'): string {
  const configured = (w.config as { label?: unknown } | undefined)?.label;
  return w.label || (typeof configured === 'string' ? configured : '') || fallback;
}

/**
 * Is a required input still unanswered? "Empty" is not one shape:
 *   • checkbox — must be checked, not merely present (v1 semantics);
 *   • counter  — must have been TOUCHED. Presence in formData is the whole
 *                test: setField is the only writer, and starting a run seeds no
 *                counter defaults, so a key exists only because the operator
 *                tapped. Requiring the number to have MOVED stranded the run
 *                whenever the true answer was the initial value — "Defects
 *                found: 0" on a counter that starts at 0 and cannot go below
 *                it could never be given. CounterWidget commits on every tap,
 *                including at the ends of the range, so confirming a zero is
 *                one tap of either button.
 *   • signature— a stroke must have been captured (any non-empty signature);
 *   • the rest — a value that is not undefined / null / ''.
 */
export function requiredMissing(w: Widget, val: unknown): boolean {
  switch (w.type) {
    case 'checkbox':
      return val !== true;
    case 'counter':
      return isEmpty(val);
    default:
      return isEmpty(val);
  }
}

/** One line naming the widget and what it wants, in the operator's words. */
export function requiredMessage(w: Widget): string {
  const label = widgetLabel(w);
  switch (w.type) {
    case 'pass-fail':     return `${label} needs a result`;
    case 'signature':     return `${label} needs a signature`;
    case 'counter':       return `${label} needs a count — tap + or − to confirm`;
    case 'photo-capture': return `${label} needs a photo`;
    case 'scan-input':    return `${label} needs a scan`;
    case 'select-input':  return `${label} needs a choice`;
    case 'checkbox':      return `${label} needs to be checked`;
    default:              return `${label} is required`;
  }
}

/**
 * Standing validation gate run before any forward navigation (spec §5.5).
 * Superset of the v1 required-check: required inputs, number enforceRange,
 * scan expectedPattern, unresolved require_photo gate, incomplete kit step.
 */
export function getStepBlocks(
  step: Step | undefined,
  formData: Record<string, unknown>,
  photoGateMessage: string | null,
  kit: KitGateInput | null,
): BlockItem[] {
  if (!step) return [];
  const blocks: BlockItem[] = [];

  for (const w of step.widgets) {
    const val = formData[legacyKey(w)];

    // Required inputs empty → block (v1 behavior preserved and extended)
    if ((REQUIRED_WIDGET_TYPES as readonly string[]).includes(w.type) && w.config.required) {
      if (requiredMissing(w, val)) {
        blocks.push({ widgetId: w.id, kind: 'required', message: requiredMessage(w) });
        continue;
      }
    }

    // number-input enforceRange out of range → block
    if (w.type === 'number-input' && w.config.enforceRange && !isEmpty(val)) {
      const n = Number(val);
      const min = w.config.min;
      const max = w.config.max;
      if (Number.isNaN(n)) {
        blocks.push({ widgetId: w.id, kind: 'range', message: `${w.label || 'Value'} must be a number` });
      } else if ((min !== undefined && n < min) || (max !== undefined && n > max)) {
        const range = [min !== undefined ? `min ${min}` : '', max !== undefined ? `max ${max}` : '']
          .filter(Boolean).join(', ');
        blocks.push({ widgetId: w.id, kind: 'range', message: `${w.label || 'Value'} out of range (${range})` });
      }
    }

    // scan-input expectedPattern mismatch → block
    if (w.type === 'scan-input' && w.config.expectedPattern && !isEmpty(val)) {
      let ok = true;
      try {
        ok = new RegExp(w.config.expectedPattern).test(String(val));
      } catch {
        ok = true; // an invalid authored regex never traps the operator
      }
      if (!ok) {
        blocks.push({ widgetId: w.id, kind: 'pattern', message: `${w.label || 'Scan'} does not match the expected format` });
      }
    }
  }

  // Unresolved require_photo gate → block (resolved once any photo-capture
  // widget on this step holds at least one photo)
  if (photoGateMessage !== null) {
    const satisfied = step.widgets.some(w => w.type === 'photo-capture' && !isEmpty(formData[legacyKey(w)]));
    if (!satisfied) {
      blocks.push({ kind: 'photo', message: photoGateMessage || 'Photo required' });
    }
  }

  // Kit step incomplete → block (standing rule, spec §3.2)
  if (kit && kit.gated) {
    const p = kitProgress(kit.lines, kit.requireScan);
    if (!p.complete) {
      const parts: string[] = [];
      if (p.short > 0) parts.push(`${p.short} short`);
      if (p.remaining > 0) parts.push(`${p.remaining} to verify`);
      blocks.push({ kind: 'kit', message: `Kit incomplete — ${parts.join(', ') || 'not verified'}` });
    }
  }

  return blocks;
}

/** Footer-center reason line, e.g. "2 required fields · Kit incomplete — 1 short". */
export function summarizeBlocks(blocks: BlockItem[]): string {
  if (blocks.length === 0) return '';
  const parts: string[] = [];
  const required = blocks.filter(b => b.kind === 'required').length;
  if (required > 0) parts.push(`${required} required field${required > 1 ? 's' : ''}`);
  const range = blocks.find(b => b.kind === 'range');
  if (range) parts.push(range.message);
  const pattern = blocks.find(b => b.kind === 'pattern');
  if (pattern) parts.push(pattern.message);
  const photo = blocks.find(b => b.kind === 'photo');
  if (photo) parts.push(photo.message);
  const kit = blocks.find(b => b.kind === 'kit');
  if (kit) parts.push(kit.message);
  return parts.join(' · ');
}

// ─── Kit helpers ──────────────────────────────────────────────────────────────

export interface KitProgress {
  total: number;
  verified: number;
  /** verified + (picked when scans aren't required) */
  done: number;
  picked: number;
  short: number;
  remaining: number;
  complete: boolean;
}

/** Rollup for the summary bar and the standing kit gate. 'picked' counts as
 *  done unless requireScan (contract: requireScan strictness is the player's job). */
export function kitProgress(lines: KitLine[], requireScan: boolean): KitProgress {
  const total = lines.length;
  const verified = lines.filter(l => l.status === 'verified').length;
  const picked = lines.filter(l => l.status === 'picked').length;
  const short = lines.filter(l => l.status === 'short').length;
  const done = requireScan ? verified : verified + picked;
  return {
    total, verified, picked, short, done,
    remaining: total - done - short,
    complete: total > 0 && done === total,
  };
}

export type KitScanResult =
  | { type: 'verified'; line: KitLine }
  | { type: 'already'; line: KitLine }
  | { type: 'wrong_step'; line: KitLine }
  | { type: 'unknown' };

/** Scan validation chain (spec §5.4, Tulip kitting pattern). `visibleStepId`
 *  narrows to the current step when the checklist is step-scoped. */
export function evaluateKitScan(
  lines: KitLine[],
  code: string,
  visibleStepId: string | null,
): KitScanResult {
  const needle = code.trim().toLowerCase();
  if (!needle) return { type: 'unknown' };
  const matches = lines.filter(l =>
    (l.scan_code && l.scan_code.trim().toLowerCase() === needle) ||
    (l.sku && l.sku.trim().toLowerCase() === needle));
  if (matches.length === 0) return { type: 'unknown' };

  const inScope = visibleStepId === null
    ? matches
    : matches.filter(l => !l.step_id || l.step_id === visibleStepId);

  if (inScope.length === 0) return { type: 'wrong_step', line: matches[0] };

  const verifiable = inScope.find(l => l.status === 'pending' || l.status === 'picked');
  if (verifiable) return { type: 'verified', line: verifiable };

  const already = inScope.find(l => l.status === 'verified');
  if (already) return { type: 'already', line: already };

  // Only short lines left for this code
  return { type: 'wrong_step', line: inScope[0] };
}

/** Lines visible in a kit-checklist for the given scope. */
export function scopedKitLines(lines: KitLine[], scope: 'step' | 'all', stepId: string): KitLine[] {
  if (scope === 'all') return lines;
  return lines.filter(l => !l.step_id || l.step_id === stepId);
}

// ─── Rich capture mapping (spec §5.3 / §4.2 table) ───────────────────────────

const CAPTURE_TYPES: Partial<Record<Widget['type'], CompletionValueType>> = {
  'text-input': 'text',
  'number-input': 'number',
  'select-input': 'select',
  'checkbox': 'boolean',
  'pass-fail': 'pass_fail',
  'signature': 'signature',
  'scan-input': 'scan',
  'photo-capture': 'photo',
  'counter': 'number',
  'timer': 'timer',
};

/** Build the CompletionValueInput row for a widget's current value, or null for
 *  display-only widgets. Legacy formData keys/values are untouched — this is
 *  the parallel structured write. */
export function valueInputFor(step: Step, widget: Widget, value: unknown): CompletionValueInput | null {
  const value_type = CAPTURE_TYPES[widget.type];
  if (!value_type) return null;
  if (value === undefined || value === null || value === '') return null;

  const base = {
    step_id: step.id,
    widget_id: widget.id,
    variable_name: widget.config.variableName || '',
    value_type,
  };

  switch (value_type) {
    case 'number':
    case 'timer': {
      const n = Number(value);
      if (Number.isNaN(n)) return null;
      return { ...base, value_number: n };
    }
    case 'boolean':
      return { ...base, value_number: value === true || value === 'true' || value === 1 ? 1 : 0 };
    case 'pass_fail':
      return { ...base, value_text: String(value).toLowerCase() === 'pass' ? 'pass' : 'fail' };
    default:
      return { ...base, value_text: String(value) };
  }
}

// ─── Misc ────────────────────────────────────────────────────────────────────

export function formatDur(s: number): string {
  const m = Math.floor(Math.abs(s) / 60);
  const sec = Math.abs(s) % 60;
  return `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

/** True when the step renders the kit-verification chrome (spec §5.4). */
export function stepShowsKit(step: Step | undefined): boolean {
  if (!step) return false;
  return step.step_type === 'kit' || step.widgets.some(w => w.type === 'kit-checklist');
}

/** The kit-checklist widget driving config for a step, if any. */
export function kitWidgetFor(step: Step | undefined): Widget | undefined {
  return step?.widgets.find(w => w.type === 'kit-checklist');
}

/** All triggers for an event on a step: widget triggers (widget order) then
 *  step triggers (spec §3.2 rule 1). The engine filters by event itself. */
export function collectStepTriggers(step: Step | undefined) {
  if (!step) return [];
  const widgetTriggers = step.widgets.flatMap(w => w.triggers ?? []);
  return [...widgetTriggers, ...(step.triggers ?? [])];
}

// ═══ Player batch additions (footer nav rule · takt bar · run context · ink) ══

/** Trigger action types that advance the run (footer-hiding rule). prev_step is
 *  deliberately excluded — a back-only button still needs the footer to go
 *  forward. */
const FORWARD_NAV_ACTIONS = ['next_step', 'go_to_step', 'complete_app'] as const;

/**
 * True when the step contains a button widget that itself advances the run:
 * legacy buttonType next/complete (incl. the v1 default where buttonType is
 * absent and the button has no authored triggers), or an enabled button_press
 * trigger carrying a navigation action. Such steps hide the footer
 * Next/Complete button — exactly one way to advance, never two.
 */
export function stepHidesFooterNav(step: Step | undefined): boolean {
  if (!step) return false;
  return step.widgets.some(w => {
    if (w.type !== 'button') return false;
    const triggers = w.triggers ?? [];
    if (triggers.length > 0) {
      return triggers.some(t =>
        t.enabled !== false &&
        t.event === 'button_press' &&
        t.actions.some(a => (FORWARD_NAV_ACTIONS as readonly string[]).includes(a.type)));
    }
    // Un-normalized legacy button: absent buttonType behaves as 'next' (v1).
    const bt = w.config.buttonType ?? 'next';
    return bt === 'next' || bt === 'complete';
  });
}

// ─── Takt countdown bar (slim drain bar under the header) ────────────────────

export interface TaktBarState {
  /** Remaining fraction of the takt window, clamped to [0, 1]. */
  fraction: number;
  /** ok (>20% left) → warn (≤20% left) → over (takt expired). */
  level: 'ok' | 'warn' | 'over';
}

/** null when the step has no takt. Thresholds: green while >20% of the window
 *  remains, amber at ≤20%, red once takt hits zero. */
export function taktBarState(taktSeconds: number, elapsed: number): TaktBarState | null {
  if (!taktSeconds || taktSeconds <= 0) return null;
  const remaining = Math.max(0, taktSeconds - Math.max(0, elapsed));
  const fraction = Math.min(1, remaining / taktSeconds);
  const level: TaktBarState['level'] = remaining <= 0 ? 'over' : fraction <= 0.2 ? 'warn' : 'ok';
  return { fraction, level };
}

// ─── Run context gating (work order OR typed part number) ────────────────────

/**
 * Whether an app enforces run context, from its RAW (pre-normalizeApp) fields:
 *   • require_run_context set (true / 1)  → always enforce,
 *   • require_run_context clear (false / 0) → never enforce,
 *   • absent (null / undefined) → enforce only for schema_version >= 2 apps.
 * (normalizeApp force-upgrades schema_version in memory, so callers must pass
 * the raw server blob here.)
 *
 * The column is a NULLABLE SQLite INTEGER, so the API returns 0 / 1 — not
 * booleans. Comparing with === true/false would have sent BOTH stored values
 * down the schema_version fallback, meaning the builder's toggle silently did
 * nothing in the player.
 */
export function runContextRequired(
  raw: { require_run_context?: boolean | number | null; schema_version?: number } | null | undefined,
): boolean {
  if (!raw) return false;
  const v = raw.require_run_context;
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number') return v !== 0;
  return (raw.schema_version ?? 1) >= 2;
}

/** Step takt in seconds, tolerating the legacy v1 key. Apps built before the
 *  v2 builder (and the demo sandbox seed) store `takt_time`; v2 writes
 *  `takt_time_seconds`. Readers that only know the new key silently report a
 *  takt of zero for every legacy app. */
export function stepTaktSeconds(
  step: { takt_time_seconds?: number | null; takt_time?: number | null } | null | undefined,
): number {
  if (!step) return 0;
  // First POSITIVE value wins: a step carrying `takt_time_seconds: 0` alongside
  // a real legacy `takt_time` is a half-migrated blob, and zero has always
  // meant "no takt" here rather than "takt of zero seconds".
  for (const v of [step.takt_time_seconds, step.takt_time]) {
    const n = Number(v);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return 0;
}

export interface RunContextGate {
  ok: boolean;
  /** Short reason shown next to the disabled Start / Next-unit button. */
  reason: string;
}

/** Starting a run and "Next unit" both require a work order OR a typed part
 *  number when the app enforces run context. */
export function runContextGate(required: boolean, workOrderId: string, partNumber: string): RunContextGate {
  if (!required) return { ok: true, reason: '' };
  if (workOrderId.trim() !== '' || partNumber.trim() !== '') return { ok: true, reason: '' };
  return { ok: false, reason: 'Select a work order or enter a part number' };
}

// ─── Text-contrast helpers (dark player ink, spec §1.4) ──────────────────────

/** WCAG relative luminance of a CSS color (hex #rgb/#rrggbb or rgb()/rgba()).
 *  Returns null for un-parseable values (CSS vars, named colors). Re-exported
 *  from the shared contrast module so the player, the accent tokens and the
 *  button widget all measure with the same arithmetic. */
export function relativeLuminance(color: string | undefined | null): number | null {
  return luminance(color);
}

/** True for backgrounds that need dark ink (white cards, pastel washes). */
export function isLightColor(color: string | undefined | null): boolean {
  const lum = relativeLuminance(color);
  return lum !== null && lum > 0.45;
}

/** Ink for an instruction card given its effective background: dark ink on
 *  light configured backgrounds, light ink on dark ones. Un-parseable
 *  backgrounds keep the light ink (the player default is a dark card). */
export function instructionInk(background: string | undefined | null): string {
  return isLightColor(background) ? '#1a2433' : '#f1f5f9';
}

/**
 * Effective color for a text widget on the dark player surface. A configured
 * dark ink (authored against the light builder canvas) with no background of
 * its own would vanish on the dark shell, so it falls back to the player ink.
 * Light / un-parseable configured colors pass through untouched.
 */
export function playerTextColor(configured: string | undefined | null, fallback = 'var(--p-ink-2)'): string {
  if (!configured) return fallback;
  const lum = relativeLuminance(configured);
  if (lum !== null && lum < 0.25) return fallback;
  return configured;
}

// ─── Where the player sends people, and who it says ran the job ──────────────

/** Roles that manage from the App Library rather than working from the floor. */
const SUPERVISOR_PLUS = ['developer', 'manager', 'supervisor'];

export interface ExitContext {
  /** The run was opened from the Operator Portal (?from=operator). */
  fromOperator: boolean;
  /** The signed-in user's role, when known. */
  role?: string | null;
}

/**
 * Where "Done", "Exit" and "Back to Library" go. A floor tablet must land back
 * on the Operator Portal — sending it to /apps turns it into an unlocked
 * manager console. /apps is only for someone who came from the App Library and
 * is a supervisor or above.
 */
export function exitTarget(ctx: ExitContext): '/operator' | '/apps' {
  if (ctx.fromOperator) return '/operator';
  return SUPERVISOR_PLUS.includes(String(ctx.role ?? '')) ? '/apps' : '/operator';
}

/** Name shown for a run nobody claimed. Never a person-shaped placeholder. */
export const UNNAMED_OPERATOR = 'Unnamed operator';

/** Display name for a run's operator: the real one, or an honest blank. */
export function operatorDisplayName(name: string | null | undefined): string {
  const trimmed = (name ?? '').trim();
  return trimmed || UNNAMED_OPERATOR;
}

export interface OperatorAttribution {
  operator_name?: string;
  operator_user_id?: string;
}

/**
 * The operator fields for a completion / session / andon payload. An unknown
 * operator is OMITTED, never invented: a run booked to a phantom called
 * "Operator" ranks beside real people on the leaderboard and blames nobody who
 * exists for a bad unit.
 */
export function operatorAttribution(
  name: string | null | undefined,
  userId: string | null | undefined,
): OperatorAttribution {
  const out: OperatorAttribution = {};
  const trimmed = (name ?? '').trim();
  if (trimmed) out.operator_name = trimmed;
  if (userId) out.operator_user_id = userId;
  return out;
}

export interface PlayLinkParams {
  appId: string;
  workOrderId?: string | null;
  /** Which operation of the job the units book against (?op=). */
  operationId?: string | null;
  operatorName?: string | null;
  operatorUserId?: string | null;
  stationId?: string | null;
  /** Resume THIS run rather than starting a new one (?run=). */
  runId?: string | null;
  fromOperator?: boolean;
  /** A dispatch-board link: no uid, the follower's session identifies them. */
  fromDispatch?: boolean;
}

/**
 * Deep link into the player. THE param contract, in one place:
 *
 *   wo       the work order
 *   op       the work order OPERATION the run's units book against
 *   station  where it runs
 *   name     who (display only)
 *   uid      who, VERIFIED — only the Operator Portal, which checked a badge
 *   run      an in-progress run to resume instead of starting a new one
 *   from     'operator' (portal) or 'dispatch' (board) — decides where Exit
 *            goes, and whether the signed-in user is taken as the operator
 *
 * A dispatch link deliberately carries no `uid`: a uid in a URL is a claim
 * anybody can copy, while the portal's is one a badge reader verified. The
 * dispatch case is covered by the session instead (see setupNeeded's
 * `selfIdentified`).
 */
export function buildPlayLink(p: PlayLinkParams): string {
  const q = new URLSearchParams();
  if (p.workOrderId) q.set('wo', p.workOrderId);
  if (p.operationId) q.set('op', p.operationId);
  const name = (p.operatorName ?? '').trim();
  if (name) q.set('name', name);
  if (p.operatorUserId) q.set('uid', p.operatorUserId);
  if (p.stationId) q.set('station', p.stationId);
  if (p.runId) q.set('run', p.runId);
  if (p.fromOperator) q.set('from', 'operator');
  else if (p.fromDispatch) q.set('from', 'dispatch');
  const qs = q.toString();
  return `/play/${p.appId}${qs ? `?${qs}` : ''}`;
}

/** Who is holding the tablet, as far as the link and the session know. */
export interface RunIdentity {
  operatorUserId?: string | null;
  operatorName?: string | null;
}

/** A run in progress, as the jobs list reports it. */
export interface ResumableJob {
  id: string;
  operator_name?: string | null;
  operator_user_id?: string | null;
  last_session?: { operator_name?: string | null; operator_user_id?: string | null } | null;
}

/**
 * What a ?run= link resolved to.
 *
 *   resume — the operator's OWN run: pick it straight up.
 *   theirs — somebody else has it. Not resumed silently; the setup screen
 *            shows the concurrent-run card so the choice is made on purpose.
 *   gone   — finished, handed on, or not this app's / this company's.
 *   none   — no ?run= at all.
 */
export type ResumeTarget<J> =
  | { kind: 'resume'; job: J }
  | { kind: 'theirs'; job: J; notice: string }
  | { kind: 'none' }
  | { kind: 'gone'; notice: string };

/**
 * Is this run the current operator's own?
 *
 * The verified user id decides it whenever both sides have one — a name is
 * typed and two people on a shift can share one. The most recent stint wins
 * over whoever started the job, because that is who is holding it now.
 */
export function isOwnRun(job: ResumableJob, me: RunIdentity): boolean {
  const holderId = job.last_session?.operator_user_id ?? job.operator_user_id ?? null;
  const myId = me.operatorUserId ?? null;
  if (holderId && myId) return holderId === myId;
  const holderName = String(job.last_session?.operator_name ?? job.operator_name ?? '').trim().toLowerCase();
  const myName = String(me.operatorName ?? '').trim().toLowerCase();
  // No id on either side and no name to compare: not provably yours, so it is
  // treated as somebody else's and the choice goes to the operator.
  if (!holderName || !myName) return false;
  return holderName === myName;
}

/**
 * Resolve a ?run= parameter against the runs the SERVER says are open for this
 * app and this company.
 *
 * That list is the whole security model here: a run id that is finished,
 * abandoned, from another app or from another tenant is simply not in it, so it
 * cannot be resumed — it degrades to the normal setup flow with a plain notice
 * rather than an error nobody can act on.
 */
export function resumeTarget<J extends ResumableJob>(
  jobs: J[],
  runParam: string | null | undefined,
  me: RunIdentity = {},
): ResumeTarget<J> {
  const wanted = String(runParam ?? '').trim();
  if (!wanted) return { kind: 'none' };
  const job = jobs.find(j => j.id === wanted);
  if (!job) {
    return {
      kind: 'gone',
      notice: 'That run is no longer open — somebody finished or handed it on. Start it again below.',
    };
  }
  if (isOwnRun(job, me)) return { kind: 'resume', job };
  // Somebody else's job. Joining it is a real choice — the two of them will be
  // recording one unit together — and a link is not a place to make it
  // silently. The setup screen already has the card that asks.
  const holder = String(job.last_session?.operator_name ?? job.operator_name ?? '').trim();
  return {
    kind: 'theirs',
    job,
    notice: `${holder || 'Somebody else'} has this run open. Resume theirs to carry on together, or start a separate run.`,
  };
}

// --- One filing per problem, not one per press ------------------------------

/**
 * Stable signature of everything a step captured. Two forward taps with the
 * same answers produce the same string; changing any answer changes it.
 */
export function stepValueSignature(
  step: Step | undefined,
  formData: Record<string, unknown>,
): string {
  if (!step) return '';
  return step.widgets
    .map(w => {
      const v = formData[legacyKey(w)];
      let text: string;
      try {
        text = v === undefined ? ' ' : (JSON.stringify(v) ?? String(v));
      } catch {
        text = String(v);
      }
      return w.id + '=' + text;
    })
    .sort()
    .join('|');
}

/**
 * Identity of ONE side-effecting trigger action (create_ncr / save_record) for
 * one attempt at leaving a step: which step, with which answers, which action.
 *
 * `occurrence` is the action's position among the enqueue effects of that one
 * step_exit evaluation — the engine's enqueue effect carries no trigger id, and
 * for identical answers the same triggers match in the same order, so position
 * identifies the authored action exactly as a trigger id would.
 *
 * The interpolated PAYLOAD is deliberately not part of the key. An authored
 * title like "Failed after {{app.elapsed_seconds}}s" renders differently on
 * every press, which would make every duplicate look like a new report and
 * defeat the guard entirely.
 */
export function sideEffectKey(
  stepId: string,
  valueSignature: string,
  op: string,
  occurrence: number,
): string {
  return [stepId, valueSignature, op, String(occurrence)].join('~');
}

/**
 * A step_exit trigger that files an NCR must file it once, not once per press.
 * A blocked step keeps the forward button live (that is the point - it now
 * explains itself), so the operator naturally presses again, and every press
 * re-ran step_exit and raised ANOTHER quality record for the same failure.
 * Returns true the first time a given action+answers pair is claimed and false
 * for every repeat; changing an answer produces a new key and files again,
 * which is a genuinely different report.
 */
export function claimSideEffect(fired: Set<string>, key: string): boolean {
  if (fired.has(key)) return false;
  fired.add(key);
  return true;
}

/**
 * The way back to the Operator Portal, carrying the identity the player already
 * verified. Without it the portal asks "Who's working?" and demands the PIN
 * again after every single unit, which is the fastest way to teach a floor to
 * stop clocking in at all.
 */
export function operatorReturnLink(
  operatorUserId: string | null | undefined,
  stationId?: string | null,
): string {
  const q = new URLSearchParams();
  if (operatorUserId) q.set('uid', operatorUserId);
  if (stationId) q.set('station', stationId);
  const qs = q.toString();
  return `/operator${qs ? `?${qs}` : ''}`;
}

// ─── Nothing the portal already knows is asked twice ─────────────────────────

/** Everything a deep link into the player can carry about a run. */
export interface StartContext {
  /** Verified operator id (?uid=) — who is running it. */
  operatorUserId?: string | null;
  /** Station id (?station=) — where. */
  stationId?: string | null;
  /** Work order id (?wo=) — what. */
  workOrderId?: string | null;
  /** A typed / scanned part number, when there is no work order. */
  partNumber?: string | null;
  /** The chosen product type, when the app offers a choice. */
  productTypeId?: string | null;
}

/** What this particular app still has to be asked about. */
export interface StartChoices {
  /** How many product types this app offers. Zero means no choice to make. */
  productTypeCount: number;
  /** A work order already fixed the product type, so it is not a choice. */
  productTypeLocked: boolean;
  /** Preview always shows setup — it is the screen a builder is checking. */
  preview: boolean;
  /**
   * The person holding the tablet is already identified WITHOUT a uid in the
   * link: a signed-in manager who tapped a job on the dispatch board is
   * starting it for themselves, and their session already says who they are.
   *
   * It is a flag rather than a uid smuggled into the URL because a uid in a
   * link is a claim anybody can copy: the Operator Portal's uid is one the
   * portal VERIFIED at a badge reader, and a link that could mint one would
   * make every run's attribution guessable. The session, by contrast, is proof
   * the server already checked.
   */
  selfIdentified?: boolean;
}

/**
 * Does the player still have to show its setup screen?
 *
 * The Operator Portal already knows who is working, which station they are at
 * and which job they tapped, and it puts all three in the link. Asking for them
 * again — Operator, Badge, Station, Work Order, Product Type, then Start
 * Process below the fold — is the player refusing to believe the screen the
 * operator just came from. When every answer is already in, the run starts and
 * the player opens on step one.
 *
 * It returns TRUE (ask) whenever anything is genuinely missing, so a partial
 * link degrades to today's behaviour rather than starting a run with a hole in
 * its context.
 */
export function setupNeeded(ctx: StartContext, choices: StartChoices): boolean {
  if (choices.preview) return true;
  if (!ctx.operatorUserId && !choices.selfIdentified) return true;
  if (!ctx.stationId) return true;
  // What is being built: a work order, or a part number in its place.
  if (!ctx.workOrderId && !String(ctx.partNumber ?? '').trim()) return true;
  // A product type the app offers, nobody has chosen, and no work order fixed.
  if (choices.productTypeCount > 0 && !choices.productTypeLocked && !ctx.productTypeId) return true;
  return false;
}

/** A run already open on the same unit, and how long it has been going. */
export interface ConcurrentRun<J> {
  job: J;
  /** Who has it — the last stint's operator, or whoever started it. */
  operatorName: string;
  /** Seconds since it started, or null when the stamp is unreadable. */
  ageSeconds: number | null;
}

interface JobLike {
  id: string;
  operator_name: string;
  started_at: string;
  work_order_id: string | null;
  data?: Record<string, unknown> | null;
  last_session?: { operator_name: string; started_at: string } | null;
}

/**
 * The in-progress run on the SAME unit, if there is one.
 *
 * Two people starting the same work order is not an error — a job legitimately
 * passes between hands — but it must be a decision, not a surprise discovered
 * after both have entered data. Matching is by unit (the work order, or the
 * part number when there is no work order), never merely by app: two operators
 * running the same instruction on different units are not in each other's way.
 */
export function concurrentRun<J extends JobLike>(
  jobs: J[],
  workOrderId: string,
  partNumber: string,
  now: number = Date.now(),
): ConcurrentRun<J> | null {
  const pn = partNumber.trim().toLowerCase();
  if (!workOrderId && !pn) return null;
  const match = jobs.find(j => {
    if (workOrderId) return j.work_order_id === workOrderId;
    const jobPN = typeof j.data?._part_number === 'string' ? j.data._part_number : '';
    return !j.work_order_id && jobPN.trim().toLowerCase() === pn;
  });
  if (!match) return null;
  const startedAt = match.last_session?.started_at || match.started_at;
  const parsed = startedAt
    ? Date.parse(/[Zz]$|[+-]\d{2}:?\d{2}$/.test(startedAt) ? startedAt : `${startedAt.replace(' ', 'T')}Z`)
    : NaN;
  return {
    job: match,
    operatorName: (match.last_session?.operator_name || match.operator_name || '').trim(),
    // An unreadable stamp is stated as unknown, never rendered as "0s ago".
    ageSeconds: Number.isFinite(parsed) ? Math.max(0, Math.round((now - parsed) / 1000)) : null,
  };
}

// --- Units this run ---------------------------------------------------------

/**
 * What the operator entered on the finish step.
 *
 * `unitsRun` is how many pieces they say came off the machine — prefilled with
 * 1, which is what a run has always implicitly been. The three counts have to
 * account for every one of them.
 */
export interface UnitsEntry {
  unitsRun: number;
  good: number;
  scrap: number;
  rework: number;
  /** The coded reason. Required the moment scrap is non-zero — unless the
   *  company has no scrap reasons to pick from (see `scrapCodesOffered`). */
  scrapReasonCodeId?: string;
  /**
   * How many active scrap reasons this company offers.
   *
   * Zero means a manager has not set the list up yet, and there is nothing for
   * the operator to pick. Demanding a reason there does not produce a better
   * number — it produces an operator who cannot close a run, and a plant that
   * goes back to not counting scrap at all. Undefined is treated as "some",
   * which keeps the rule on wherever the count is unknown.
   */
  scrapCodesOffered?: number;
}

export interface UnitsCheck {
  ok: boolean;
  /** Why the run cannot close, naming the mismatch. Empty when it can. */
  reason: string;
}

/**
 * The rule that stops a run closing on numbers that do not add up.
 *
 * Good + scrap + rework must equal the units the operator says they ran. It is
 * the one arithmetic check that catches the mistake nobody notices afterwards:
 * three pieces made, two counted, one silently gone from the plant's yield
 * forever. The message NAMES the mismatch — "You entered 3 units but
 * 2 + 0 + 0 = 2" — because "invalid" tells an operator nothing about which
 * number to change.
 *
 * A run whose control was never touched does not come through here at all: it
 * sends no counts, and the server stores NULLs.
 */
export function unitsBalance(e: UnitsEntry): UnitsCheck {
  const fields: Array<[number, string]> = [
    [e.unitsRun, 'Units run'], [e.good, 'Good'], [e.scrap, 'Scrap'], [e.rework, 'Rework'],
  ];
  for (const [value, label] of fields) {
    if (!Number.isInteger(value) || value < 0) {
      return { ok: false, reason: `${label} has to be a whole number of 0 or more` };
    }
  }
  if (e.unitsRun < 1) return { ok: false, reason: 'A run has to be at least 1 unit' };
  const sum = e.good + e.scrap + e.rework;
  if (sum !== e.unitsRun) {
    return {
      ok: false,
      // "1 units" is the kind of detail that makes an operator distrust the
      // number the sentence is about.
      reason: `You entered ${e.unitsRun} ${e.unitsRun === 1 ? 'unit' : 'units'}`
        + ` but ${e.good} + ${e.scrap} + ${e.rework} = ${sum}`,
    };
  }
  const offered = e.scrapCodesOffered ?? 1;
  if (e.scrap > 0 && offered > 0 && !(e.scrapReasonCodeId || '').trim()) {
    return { ok: false, reason: 'Pick what the scrap was — scrap with no reason cannot be reported on' };
  }
  return { ok: true, reason: '' };
}

/** How the summary reads a run back: "1 good · 1 scrap · Weld porosity". */
export function unitsSummary(
  counts: { good?: number | null; scrap?: number | null; rework?: number | null },
  scrapReasonLabel?: string | null,
): string {
  const parts: string[] = [];
  if (counts.good != null) parts.push(`${counts.good} good`);
  if (counts.scrap != null && counts.scrap > 0) parts.push(`${counts.scrap} scrap`);
  if (counts.rework != null && counts.rework > 0) parts.push(`${counts.rework} rework`);
  if (parts.length === 0) return '';
  const label = (scrapReasonLabel || '').trim();
  if (label && (counts.scrap ?? 0) > 0) parts.push(label);
  return parts.join(' · ');
}

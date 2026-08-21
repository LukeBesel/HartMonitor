// ─── Player runtime helpers (spec §5.3–§5.5) ─────────────────────────────────
// Pure functions backing the player's standing validation gate, kit progress
// rollups, scan validation chain, and the rich-capture value mapping. No React,
// no DOM — unit-testable in isolation.

import type {
  Step, Widget, KitLine, CompletionValueInput, CompletionValueType,
} from '../../types';

/** Legacy formData key — unchanged from v1 (spec §5.3). */
export function legacyKey(w: Widget): string {
  return w.config.variableName || w.id;
}

/** Exact v1 set + the v2 input widgets (spec §5.5 superset). Signature stays
 *  ungated to preserve v1 outcomes (it was never gated before the remodel). */
export const REQUIRED_WIDGET_TYPES = [
  'text-input', 'number-input', 'select-input', 'checkbox',
  'scan-input', 'photo-capture',
] as const;

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
      const missing = w.type === 'checkbox' ? val !== true : isEmpty(val);
      if (missing) {
        blocks.push({ widgetId: w.id, kind: 'required', message: `${w.label || 'This field'} is required` });
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
 *  Returns null for un-parseable values (CSS vars, named colors). */
export function relativeLuminance(color: string | undefined | null): number | null {
  if (!color) return null;
  const c = color.trim();
  let r: number, g: number, b: number;
  const hex3 = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(c);
  const hex6 = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(c);
  const rgb = /^rgba?\(\s*(\d{1,3})[\s,]+(\d{1,3})[\s,]+(\d{1,3})/i.exec(c);
  if (hex3) {
    r = parseInt(hex3[1] + hex3[1], 16); g = parseInt(hex3[2] + hex3[2], 16); b = parseInt(hex3[3] + hex3[3], 16);
  } else if (hex6) {
    r = parseInt(hex6[1], 16); g = parseInt(hex6[2], 16); b = parseInt(hex6[3], 16);
  } else if (rgb) {
    r = Number(rgb[1]); g = Number(rgb[2]); b = Number(rgb[3]);
  } else {
    return null;
  }
  const lin = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
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

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

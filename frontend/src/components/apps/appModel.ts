// Pure read helpers over an app's authoring blob (`steps` / `step_groups`).
// The App Library cards, the in-depth detail page and the builder-training
// coach all describe apps from the SAME source of truth — the blob the builder
// saves — so nothing on these screens is invented or double-counted.

import type { App, Step, Widget, WidgetType } from '../../types';

/** Widget types the player captures a value for (mirrors the server's
 *  CAPTURE_WIDGET_TYPES in backend/src/routes/apps.js). */
const CAPTURE_TYPES = new Set<WidgetType>([
  'text-input', 'number-input', 'select-input', 'checkbox', 'pass-fail',
  'signature', 'scan-input', 'photo-capture', 'counter', 'timer',
]);

/** Widget types that only present information (never captured). */
const DISPLAY_TYPES = new Set<WidgetType>([
  'text', 'instruction', 'image', 'video', 'model-viewer',
  'variable-display', 'table-lookup', 'separator', 'shape',
]);

export interface AppShape {
  stepCount: number;
  widgetCount: number;
  /** Widgets that record data (inputs, checks, photos, scans, signatures). */
  captureCount: number;
  /** Widgets that only show something (instructions, images, video, 3D). */
  displayCount: number;
  /** Step- plus widget-level triggers across the whole app. */
  triggerCount: number;
  /** Steps that render the kit-verification chrome. */
  kitStepCount: number;
  /** True when at least one step holds at least one widget. */
  hasContent: boolean;
}

export function stepsOf(app: Pick<App, 'steps'> | null | undefined): Step[] {
  return Array.isArray(app?.steps) ? app!.steps : [];
}

export function widgetsOf(step: Step | null | undefined): Widget[] {
  return Array.isArray(step?.widgets) ? step!.widgets : [];
}

/** Everything the cards and detail header need to describe an app's shape. */
export function appShape(app: Pick<App, 'steps'> | null | undefined): AppShape {
  const steps = stepsOf(app);
  let widgetCount = 0;
  let captureCount = 0;
  let displayCount = 0;
  let triggerCount = 0;
  let kitStepCount = 0;

  for (const step of steps) {
    if (step?.step_type === 'kit') kitStepCount++;
    triggerCount += Array.isArray(step?.triggers) ? step.triggers.length : 0;
    for (const w of widgetsOf(step)) {
      if (!w) continue;
      widgetCount++;
      if (CAPTURE_TYPES.has(w.type)) captureCount++;
      else if (DISPLAY_TYPES.has(w.type)) displayCount++;
      triggerCount += Array.isArray(w.triggers) ? w.triggers.length : 0;
    }
  }

  return {
    stepCount: steps.length,
    widgetCount,
    captureCount,
    displayCount,
    triggerCount,
    kitStepCount,
    hasContent: steps.some(s => widgetsOf(s).length > 0),
  };
}

/** Steps in the order the operator walks them, with their group name attached. */
export function orderedSteps(app: Pick<App, 'steps' | 'step_groups'> | null | undefined): {
  step: Step; index: number; groupName: string | null;
}[] {
  const groups = Array.isArray(app?.step_groups) ? app!.step_groups! : [];
  const groupName = new Map(groups.map(g => [g.id, g.name]));
  return stepsOf(app)
    .slice()
    .sort((a, b) => (a?.order ?? 0) - (b?.order ?? 0))
    .map((step, index) => ({
      step,
      index,
      groupName: step?.group_id ? groupName.get(step.group_id) ?? null : null,
    }));
}

/** Human label for a widget type, e.g. 'number-input' → 'Number input'. */
export function widgetTypeLabel(type: WidgetType | string): string {
  const words = String(type).replace(/[-_]/g, ' ').trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** True for widget types the player records a value for. */
export function isCaptureWidget(type: WidgetType | string): boolean {
  return CAPTURE_TYPES.has(type as WidgetType);
}

// ── Formatting ───────────────────────────────────────────────────────────────

/**
 * Read a timestamp the way the server wrote it. SQLite hands back
 * "YYYY-MM-DD HH:MM:SS" in UTC; make that explicit so the browser doesn't read
 * it as local time and report a run from the future. Null for missing or
 * unparseable input.
 */
export function parseServerTime(iso: string | null | undefined): Date | null {
  if (!iso) return null;
  const normalized = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(iso)
    ? `${iso.replace(' ', 'T')}Z`
    : iso;
  const d = new Date(normalized);
  return isNaN(d.getTime()) ? null : d;
}

/** "just now" / "12m ago" / "3d ago" / "Mar 4" — null-safe. */
export function fmtRelative(iso: string | null | undefined): string {
  if (!iso) return 'Never';
  const d = parseServerTime(iso);
  if (!d) return '—';
  const diffMs = Date.now() - d.getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 0) return 'just now';
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

/** Absolute date+time for tooltips and detail rows. */
export function fmtDateTime(iso: string | null | undefined): string {
  const d = parseServerTime(iso);
  if (!d) return '—';
  return d.toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

/** 45s / 3m 20s / 1h 5m — null-safe. */
export function fmtDuration(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || seconds < 0) return '—';
  if (seconds < 60) return `${Math.round(seconds)}s`;
  if (seconds < 3600) {
    const m = Math.floor(seconds / 60);
    const s = Math.round(seconds % 60);
    return s > 0 ? `${m}m ${s}s` : `${m}m`;
  }
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

export function pluralize(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

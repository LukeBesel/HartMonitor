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

/**
 * 0.4s / 45s / 3m 20s / 1h 5m — null-safe, and the ONLY duration formatter in
 * this frontend.
 *
 * It takes SECONDS. A second formatter taking minutes once shadowed this one
 * and rendered 451 seconds as "7.5h" on the most-viewed screen in the product,
 * so `duration-formatter.test.tsx` fails the build if another one appears.
 *
 * A value under ten seconds keeps a decimal when it has one, because a real
 * operation is routinely sub-second — a press, a scan, a go/no-go gauge — and
 * whole-second rounding turns a measured 0.4 s into "0s", which reads as a run
 * that took no time at all. Unknown is "—" and never 0: see
 * backend/src/cycleTime.js for why the two must never be confused.
 */
export function fmtDuration(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || !Number.isFinite(Number(seconds))) return '—';
  const value = Number(seconds);
  if (value < 0) return '—';
  if (value < 10) {
    // Below the resolution we can honestly print, say so rather than round a
    // real measurement down to nothing.
    if (value > 0 && value < 0.05) return '<0.1s';
    // A whole number stays whole; a fraction keeps its tenth.
    return `${Math.round(value * 10) / 10}s`;
  }
  if (value < 60) return `${Math.round(value)}s`;
  if (value < 3600) {
    const m = Math.floor(value / 60);
    const s = Math.round(value % 60);
    return s > 0 ? `${m}m ${s}s` : `${m}m`;
  }
  const h = Math.floor(value / 3600);
  const m = Math.floor((value % 3600) / 60);
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

/**
 * Which measurement a duration is, as the server labels it. Two genuinely
 * different numbers exist for one run and both are legitimate; a screen showing
 * one of them has to say which, or a customer reads the gap as the system
 * contradicting itself. See backend/src/cycleTime.js for the model.
 */
/**
 * `fmtDuration`, but for a value that arrives in MINUTES instead of seconds
 * (takt times, leaderboard averages — several endpoints report minutes
 * directly). This is the ONLY permitted unit conversion onto the shared
 * formatter: `fmtDuration(minutes * 60)`, nothing else. It exists so that
 * "this field is minutes" is declared once, here, instead of a call site
 * quietly assuming it and multiplying inline — which is exactly how a
 * seconds field once got treated as minutes and rendered 60x too long. Any
 * other file that needs a duration in minutes imports this, not `fmtDuration`
 * with its own `* 60`.
 */
export function fmtMinutes(minutes: number | null | undefined): string {
  if (minutes === null || minutes === undefined || !Number.isFinite(Number(minutes))) return '—';
  if (Number(minutes) < 0) return '—';
  return fmtDuration(Number(minutes) * 60);
}

export type DurationBasis = 'hands_on' | 'elapsed' | 'mixed' | null | undefined;

/** Short label for a duration column or tile, e.g. "hands-on". */
export function durationBasisLabel(basis: DurationBasis): string {
  if (basis === 'hands_on') return 'hands-on';
  if (basis === 'elapsed') return 'wall clock';
  if (basis === 'mixed') return 'mixed';
  return '';
}

/** The sentence that explains the label, for a title/tooltip. */
export function durationBasisNote(basis: DurationBasis): string {
  if (basis === 'hands_on') return 'Per-step timers added up — the time an operator was actually working the steps, excluding pauses and handoffs.';
  if (basis === 'elapsed') return 'Wall clock from start to finish, including any time the job sat waiting.';
  if (basis === 'mixed') return 'Some of these runs recorded step timers (hands-on time) and some did not (wall clock from start to finish).';
  return 'No run behind this number was ever timed.';
}

export function pluralize(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

// ── Measured vs. unmeasured ──────────────────────────────────────────────────

/**
 * Guard for any duration a customer is about to read.
 *
 * The apps endpoints measure a run by wall clock between started_at and
 * completed_at, so a run opened and closed inside the same second comes back as
 * 0 — and an average taken over runs like that comes back as 0 too. Zero
 * seconds is not a cycle time anybody can act on; it is the shape of "nobody
 * timed this". The run-history endpoint already draws that line in SQL (it
 * averages only durations greater than zero) and its page prints "—", so
 * without this guard the same run reads "0s" on four screens and "—" on the
 * fifth. Everything reporting a measured duration passes through here first.
 *
 * Takt is configured rather than measured, so it does NOT belong here: a step
 * with no takt is already null, and this would say the same thing less clearly.
 */
export function measuredSeconds(seconds: number | null | undefined): number | null {
  if (seconds === null || seconds === undefined) return null;
  if (!Number.isFinite(seconds) || seconds <= 0) return null;
  return seconds;
}

/** Per-step timers a run recorded, keyed by step index, oldest shape included. */
export type StepTimes = Record<string | number, unknown> | null | undefined;

/** The per-step timers as seconds, indexed by step order. Unrecorded → null. */
export function stepSecondsByIndex(stepTimes: StepTimes): (number | null)[] {
  const out: (number | null)[] = [];
  for (const [key, raw] of Object.entries(stepTimes ?? {})) {
    const idx = Number(key);
    if (!Number.isInteger(idx) || idx < 0) continue;
    const value = Number(raw);
    while (out.length <= idx) out.push(null);
    out[idx] = Number.isFinite(value) ? value : null;
  }
  return out;
}

/** Sum of the per-step timers, or null when no step was ever timed. */
export function stepTimesTotal(stepTimes: StepTimes): number | null {
  let total = 0;
  for (const seconds of stepSecondsByIndex(stepTimes)) {
    if (seconds !== null && seconds > 0) total += seconds;
  }
  return measuredSeconds(total);
}

/**
 * How long one run took, by the same definition GET /completions/app/:id/history
 * uses in SQL: the per-step timers when they add up to anything, otherwise the
 * wall clock from start to finish, otherwise null. Keeping the two in step is
 * what stops a run's own page disagreeing with the history row that links to it.
 *
 * A run still on the bench is not a short run — it has no length yet. Ask
 * `elapsedSeconds` for that one.
 */
export function runDurationSeconds(run: {
  started_at?: string | null;
  completed_at?: string | null;
  step_times?: StepTimes;
  status?: string | null;
}): number | null {
  const fromSteps = stepTimesTotal(run.step_times);
  if (fromSteps !== null) return fromSteps;
  if (run.status === 'in_progress') return null;
  const started = parseServerTime(run.started_at);
  const finished = parseServerTime(run.completed_at);
  if (!started || !finished) return null;
  return measuredSeconds((finished.getTime() - started.getTime()) / 1000);
}

/** Seconds a still-open run has been on the bench, counted from `now`. */
export function elapsedSeconds(startedAt: string | null | undefined, now: number = Date.now()): number | null {
  const started = parseServerTime(startedAt);
  if (!started) return null;
  return measuredSeconds((now - started.getTime()) / 1000);
}

/**
 * Axis ticks for a duration scale, landing on values a person reads without
 * doing arithmetic: 30s, 1m, 5m, 15m, 1h — never recharts' default "1m 5s,
 * 2m 10s, 3m 15s", which is arithmetically even and humanly useless.
 *
 * Returns ticks from zero to the first step at or past `maxSeconds`, so the
 * caller can hand recharts both `ticks` and a matching `domain`.
 */
export function durationTicks(maxSeconds: number, target = 5): number[] {
  if (!Number.isFinite(maxSeconds) || maxSeconds <= 0) return [0];
  const STEPS = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600, 7200, 21600, 43200, 86400];
  const step = STEPS.find(s => maxSeconds / s <= target) ?? STEPS[STEPS.length - 1];
  const ticks: number[] = [];
  // Always step past the top of the range, so the longest bar sits inside the
  // axis rather than running off the end of it.
  for (let v = 0; ; v += step) {
    ticks.push(v);
    if (v >= maxSeconds) break;
  }
  return ticks;
}

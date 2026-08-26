// ─── Gantt geometry ───────────────────────────────────────────────────────────
// All the arithmetic behind the CI project Gantt, kept out of the component so
// it can be tested directly: a bar's position must be verifiable without a DOM.
//
// Everything works in UTC midnights. Dates in this app are stored as plain
// 'YYYY-MM-DD' strings (or full ISO timestamps); parsing them with `new Date()`
// in a browser west of Greenwich lands on the PREVIOUS day, which slides every
// bar one column left. `parseDay` truncates to the date part and pins it to UTC
// so a task that starts on the 3rd is drawn on the 3rd everywhere.

export const DAY_MS = 86_400_000;

/** The shortest window the chart will draw. A one-day project rendered edge to
 *  edge reads as "the whole project" rather than "one day of work". */
export const MIN_WINDOW_DAYS = 7;

/** Just the fields the geometry needs — the page's task type is a superset. */
export interface GanttTaskDates {
  start_date?: string | null;
  end_date?: string | null;
}

export interface GanttTimeline {
  /** UTC midnight of the first day in the window. */
  startMs: number;
  /** UTC midnight of the LAST day in the window (inclusive). */
  endMs: number;
  /** Inclusive day count: Jan 1 → Jan 7 is 7. */
  days: number;
  /** Total span in ms — `days * DAY_MS`. The denominator for every percentage. */
  totalMs: number;
}

export interface BarGeometry {
  /** Distance from the left edge of the chart, as a percentage. */
  leftPct: number;
  /** Bar width as a percentage of the whole window. Never below a hairline. */
  widthPct: number;
}

/**
 * 'YYYY-MM-DD' or an ISO timestamp → UTC-midnight epoch ms, or null when the
 * value is missing or unparseable. Never throws.
 */
export function parseDay(value?: string | null): number | null {
  if (!value) return null;
  const datePart = String(value).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(datePart)) return null;
  const ms = Date.parse(`${datePart}T00:00:00.000Z`);
  return Number.isNaN(ms) ? null : ms;
}

/** Epoch ms → 'YYYY-MM-DD' (UTC), the inverse of `parseDay`. */
export function dayKey(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/**
 * Work out the window the chart covers: the earliest of the project start and
 * every task start, through the latest of the project target and every task end.
 * A task with only one of its two dates still counts — it is real work with a
 * known edge.
 *
 * Returns null when NOTHING carries a date. That is not a zero-width chart, it
 * is a chart that cannot be drawn, and the caller says so rather than inventing
 * a window around today.
 */
export function buildTimeline(
  tasks: readonly GanttTaskDates[],
  projectStart?: string | null,
  projectTarget?: string | null,
): GanttTimeline | null {
  const marks: number[] = [];
  const push = (v?: string | null) => { const ms = parseDay(v); if (ms !== null) marks.push(ms); };

  push(projectStart);
  push(projectTarget);
  for (const t of tasks) { push(t.start_date); push(t.end_date); }

  if (marks.length === 0) return null;

  const startMs = Math.min(...marks);
  let endMs = Math.max(...marks);

  // Inclusive day count, then widen the tail until the window is worth drawing.
  let days = Math.round((endMs - startMs) / DAY_MS) + 1;
  if (days < MIN_WINDOW_DAYS) {
    days = MIN_WINDOW_DAYS;
    endMs = startMs + (days - 1) * DAY_MS;
  }

  return { startMs, endMs, days, totalMs: days * DAY_MS };
}

/**
 * Where a task's bar sits in the window, as percentages.
 *
 * Both dates are INCLUSIVE days: a task from the 3rd to the 4th occupies two
 * whole columns, so its width is 2 days, not the 1 day of naive subtraction.
 * A task with only one date is drawn as a single-day marker on that date.
 * A task with neither date has no bar — null, so the row renders as unscheduled.
 */
export function taskBar(task: GanttTaskDates, timeline: GanttTimeline): BarGeometry | null {
  const rawStart = parseDay(task.start_date);
  const rawEnd = parseDay(task.end_date);
  if (rawStart === null && rawEnd === null) return null;

  // A single-sided task collapses to the day it does know about.
  let startMs = rawStart ?? (rawEnd as number);
  let endMs = rawEnd ?? (rawStart as number);
  // Dates entered backwards would otherwise draw a negative-width bar.
  if (endMs < startMs) { const swap = startMs; startMs = endMs; endMs = swap; }

  // Clamp into the window so a stray out-of-range date can't push a bar off the
  // chart (or blow the container's width out).
  const winEndExclusive = timeline.startMs + timeline.totalMs;
  const clampedStart = Math.min(Math.max(startMs, timeline.startMs), winEndExclusive - DAY_MS);
  const clampedEnd = Math.min(Math.max(endMs + DAY_MS, clampedStart + DAY_MS), winEndExclusive);

  const leftPct = ((clampedStart - timeline.startMs) / timeline.totalMs) * 100;
  const widthPct = ((clampedEnd - clampedStart) / timeline.totalMs) * 100;
  return { leftPct, widthPct };
}

/**
 * Where today's marker goes, as a percentage — or null when today is outside
 * the window, in which case no marker is drawn rather than one pinned to an
 * edge and read as "today is the deadline".
 */
export function todayMarker(timeline: GanttTimeline, now: number = Date.now()): number | null {
  const today = parseDay(new Date(now).toISOString());
  if (today === null) return null;
  if (today < timeline.startMs || today > timeline.endMs) return null;
  // Mid-day, so the line sits in the middle of today's column.
  return ((today - timeline.startMs + DAY_MS / 2) / timeline.totalMs) * 100;
}

export interface GanttTick {
  /** UTC midnight this tick labels. */
  ms: number;
  /** Percentage offset of the tick's left edge. */
  leftPct: number;
  /** Percentage width of the span this tick heads. */
  widthPct: number;
  label: string;
  /** Secondary line (month / year) shown above dense day ticks. */
  sublabel: string;
  /** Saturday or Sunday — shaded on the grid. */
  weekend: boolean;
}

/**
 * Column headings scaled to the window: days for a short project, weeks for a
 * quarter, months for anything longer. Chosen so the axis never turns into an
 * unreadable picket fence.
 */
export function buildTicks(timeline: GanttTimeline): GanttTick[] {
  const { startMs, days, totalMs } = timeline;
  const ticks: GanttTick[] = [];

  const dayOf = (ms: number) => new Date(ms).getUTCDay();
  const fmt = (ms: number, opts: Intl.DateTimeFormatOptions) =>
    new Date(ms).toLocaleDateString('en-US', { ...opts, timeZone: 'UTC' });

  if (days <= 31) {
    for (let i = 0; i < days; i++) {
      const ms = startMs + i * DAY_MS;
      ticks.push({
        ms,
        leftPct: (i * DAY_MS / totalMs) * 100,
        widthPct: (DAY_MS / totalMs) * 100,
        label: fmt(ms, { day: 'numeric' }),
        sublabel: fmt(ms, { month: 'short' }),
        weekend: dayOf(ms) === 0 || dayOf(ms) === 6,
      });
    }
    return ticks;
  }

  if (days <= 120) {
    // Weekly, starting on the window's first day so no partial column leads.
    for (let i = 0; i < days; i += 7) {
      const ms = startMs + i * DAY_MS;
      const span = Math.min(7, days - i) * DAY_MS;
      ticks.push({
        ms,
        leftPct: (i * DAY_MS / totalMs) * 100,
        widthPct: (span / totalMs) * 100,
        label: fmt(ms, { month: 'short', day: 'numeric' }),
        sublabel: '',
        weekend: false,
      });
    }
    return ticks;
  }

  // Monthly.
  let cursor = Date.UTC(new Date(startMs).getUTCFullYear(), new Date(startMs).getUTCMonth(), 1);
  const endExclusive = startMs + totalMs;
  while (cursor < endExclusive) {
    const d = new Date(cursor);
    const next = Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1);
    const visibleStart = Math.max(cursor, startMs);
    const visibleEnd = Math.min(next, endExclusive);
    ticks.push({
      ms: visibleStart,
      leftPct: ((visibleStart - startMs) / totalMs) * 100,
      widthPct: ((visibleEnd - visibleStart) / totalMs) * 100,
      label: fmt(visibleStart, { month: 'short' }),
      sublabel: fmt(visibleStart, { year: 'numeric' }),
      weekend: false,
    });
    cursor = next;
  }
  return ticks;
}

/**
 * How wide one day should be drawn, given how long the project runs.
 *
 * It tracks `buildTicks`: a short project gets a labelled column per day and
 * needs the room for it; a quarter is labelled weekly, so a day can be much
 * narrower and the whole plan still fits a desktop panel without scrolling. A
 * fixed 44px would push a routine six-week project off the right edge of a
 * 1440px screen for no reason.
 */
export function pxPerDayFor(days: number): number {
  if (days <= 31) return 44;    // a labelled column per day
  if (days <= 120) return 22;   // weekly labels — ~154px a week
  return 9;                     // monthly labels — ~270px a month
}

/**
 * The chart body's pixel width. Percentages position bars INSIDE this width;
 * the width itself is what makes a long project scroll horizontally on a phone
 * instead of squashing every bar into a smear.
 */
export function chartWidthPx(timeline: GanttTimeline, pxPerDay?: number, minWidth = 640): number {
  return Math.max(minWidth, Math.round(timeline.days * (pxPerDay ?? pxPerDayFor(timeline.days))));
}

/**
 * Rolled-up completion across a task list — the same average the API reports,
 * recomputed locally so an optimistic edit updates the header immediately.
 * Null (not 0) for an empty list: a project with no tasks has no progress.
 */
export function rollupProgress(tasks: readonly { progress?: number | null }[]): number | null {
  if (tasks.length === 0) return null;
  const sum = tasks.reduce((acc, t) => acc + (Number(t.progress) || 0), 0);
  return Math.round(sum / tasks.length);
}

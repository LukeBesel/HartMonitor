import { describe, it, expect } from 'vitest';
import {
  DAY_MS, MIN_WINDOW_DAYS,
  parseDay, dayKey, buildTimeline, taskBar, todayMarker, buildTicks,
  chartWidthPx, pxPerDayFor, rollupProgress,
} from '../gantt';

// ─── Gantt geometry ───────────────────────────────────────────────────────────
// A bar's position IS the information the chart carries — if the arithmetic is a
// day out, the chart lies quietly. These tests pin the numbers for known dates.

describe('parseDay', () => {
  it('pins a plain date to UTC midnight, so no timezone can slide a bar a day left', () => {
    expect(parseDay('2026-03-03')).toBe(Date.UTC(2026, 2, 3));
    expect(parseDay('2026-03-03T18:45:00.000Z')).toBe(Date.UTC(2026, 2, 3));
  });

  it('returns null for anything it cannot read, rather than an Invalid Date', () => {
    expect(parseDay(null)).toBeNull();
    expect(parseDay(undefined)).toBeNull();
    expect(parseDay('')).toBeNull();
    expect(parseDay('soon')).toBeNull();
  });

  it('round-trips through dayKey', () => {
    expect(dayKey(parseDay('2026-12-31')!)).toBe('2026-12-31');
  });
});

describe('buildTimeline', () => {
  it('spans the earliest start through the latest end, inclusive', () => {
    const tl = buildTimeline(
      [{ start_date: '2026-03-03', end_date: '2026-03-06' }],
      '2026-03-01',
      '2026-03-10',
    )!;
    expect(dayKey(tl.startMs)).toBe('2026-03-01');
    expect(dayKey(tl.endMs)).toBe('2026-03-10');
    expect(tl.days).toBe(10);          // Mar 1 → Mar 10 inclusive
    expect(tl.totalMs).toBe(10 * DAY_MS);
  });

  it('widens past the project window when a task runs beyond it', () => {
    const tl = buildTimeline(
      [{ start_date: '2026-02-20', end_date: '2026-04-05' }],
      '2026-03-01',
      '2026-03-10',
    )!;
    expect(dayKey(tl.startMs)).toBe('2026-02-20');
    expect(dayKey(tl.endMs)).toBe('2026-04-05');
  });

  it('never draws a window shorter than a week', () => {
    const tl = buildTimeline([{ start_date: '2026-03-03', end_date: '2026-03-03' }])!;
    expect(tl.days).toBe(MIN_WINDOW_DAYS);
    expect(dayKey(tl.startMs)).toBe('2026-03-03');
    expect(dayKey(tl.endMs)).toBe('2026-03-09');
  });

  it('returns null when nothing carries a date — a chart that cannot be drawn, not an empty one', () => {
    expect(buildTimeline([{ start_date: null, end_date: null }], null, null)).toBeNull();
    expect(buildTimeline([])).toBeNull();
  });
});

describe('taskBar', () => {
  // A ten-day window: Mar 1 through Mar 10. Each day is exactly 10% wide.
  const tl = buildTimeline([], '2026-03-01', '2026-03-10')!;

  it('places a two-day task on the third day at 20% / 20%', () => {
    const bar = taskBar({ start_date: '2026-03-03', end_date: '2026-03-04' }, tl)!;
    expect(bar.leftPct).toBeCloseTo(20, 6);
    // Mar 3 and Mar 4 are TWO whole days — an inclusive end, not a subtraction.
    expect(bar.widthPct).toBeCloseTo(20, 6);
  });

  it('starts a task on the window\'s first day at 0%', () => {
    const bar = taskBar({ start_date: '2026-03-01', end_date: '2026-03-01' }, tl)!;
    expect(bar.leftPct).toBeCloseTo(0, 6);
    expect(bar.widthPct).toBeCloseTo(10, 6);
  });

  it('ends a task on the window\'s last day flush with the right edge', () => {
    const bar = taskBar({ start_date: '2026-03-09', end_date: '2026-03-10' }, tl)!;
    expect(bar.leftPct).toBeCloseTo(80, 6);
    expect(bar.leftPct + bar.widthPct).toBeCloseTo(100, 6);
  });

  it('draws a one-sided task as a single-day marker on the date it does know', () => {
    const startOnly = taskBar({ start_date: '2026-03-05', end_date: null }, tl)!;
    expect(startOnly.leftPct).toBeCloseTo(40, 6);
    expect(startOnly.widthPct).toBeCloseTo(10, 6);

    const endOnly = taskBar({ start_date: null, end_date: '2026-03-05' }, tl)!;
    expect(endOnly.leftPct).toBeCloseTo(40, 6);
    expect(endOnly.widthPct).toBeCloseTo(10, 6);
  });

  it('has no bar at all for a task with no dates', () => {
    expect(taskBar({ start_date: null, end_date: null }, tl)).toBeNull();
  });

  it('survives dates entered backwards instead of drawing a negative bar', () => {
    const bar = taskBar({ start_date: '2026-03-06', end_date: '2026-03-03' }, tl)!;
    expect(bar.leftPct).toBeCloseTo(20, 6);
    expect(bar.widthPct).toBeCloseTo(40, 6);
  });

  it('clamps a date outside the window instead of pushing the bar off the chart', () => {
    const bar = taskBar({ start_date: '2025-01-01', end_date: '2027-01-01' }, tl)!;
    expect(bar.leftPct).toBeCloseTo(0, 6);
    expect(bar.widthPct).toBeCloseTo(100, 6);
    expect(bar.leftPct + bar.widthPct).toBeLessThanOrEqual(100.0001);
  });
});

describe('todayMarker', () => {
  const tl = buildTimeline([], '2026-03-01', '2026-03-10')!;

  it('sits in the middle of today\'s column', () => {
    // Mar 3 is the third of ten days → its column runs 20%..30%, midpoint 25%.
    expect(todayMarker(tl, Date.UTC(2026, 2, 3, 9, 30))).toBeCloseTo(25, 6);
  });

  it('is absent when today falls outside the window, rather than pinned to an edge', () => {
    expect(todayMarker(tl, Date.UTC(2026, 1, 1))).toBeNull();
    expect(todayMarker(tl, Date.UTC(2026, 5, 1))).toBeNull();
  });
});

describe('buildTicks', () => {
  it('labels every day for a short project', () => {
    const tl = buildTimeline([], '2026-03-01', '2026-03-10')!;
    const ticks = buildTicks(tl);
    expect(ticks).toHaveLength(10);
    expect(ticks[0].leftPct).toBeCloseTo(0, 6);
    expect(ticks[0].widthPct).toBeCloseTo(10, 6);
    expect(ticks[9].leftPct).toBeCloseTo(90, 6);
    // Mar 1 2026 is a Sunday and Mar 7 a Saturday.
    expect(ticks[0].weekend).toBe(true);
    expect(ticks[6].weekend).toBe(true);
    expect(ticks[1].weekend).toBe(false);
  });

  it('thins out to weeks for a quarter and months beyond that', () => {
    const quarter = buildTimeline([], '2026-01-01', '2026-04-10')!;   // 100 days
    const weekly = buildTicks(quarter);
    expect(weekly.length).toBeLessThan(20);
    expect(weekly.length).toBeGreaterThan(10);

    const year = buildTimeline([], '2026-01-01', '2026-12-31')!;
    const monthly = buildTicks(year);
    expect(monthly).toHaveLength(12);
    expect(monthly[0].label).toBe('Jan');
    expect(monthly[11].label).toBe('Dec');
  });

  it('always covers the whole window, with no gap and no overhang', () => {
    for (const [a, b] of [['2026-03-01', '2026-03-10'], ['2026-01-01', '2026-04-10'], ['2026-01-01', '2026-12-31']]) {
      const tl = buildTimeline([], a, b)!;
      const ticks = buildTicks(tl);
      const covered = ticks.reduce((sum, t) => sum + t.widthPct, 0);
      expect(covered).toBeCloseTo(100, 4);
    }
  });
});

describe('chartWidthPx', () => {
  it('grows with the project so a long plan scrolls instead of squashing', () => {
    const short = buildTimeline([], '2026-03-01', '2026-03-10')!;
    const long = buildTimeline([], '2026-01-01', '2026-12-31')!;
    expect(chartWidthPx(long)).toBeGreaterThan(chartWidthPx(short));
    expect(chartWidthPx(long, 44)).toBe(365 * 44);
  });

  it('narrows the day as the project lengthens, so a six-week plan still fits a desktop', () => {
    expect(pxPerDayFor(10)).toBe(44);
    expect(pxPerDayFor(40)).toBeLessThan(44);
    expect(pxPerDayFor(200)).toBeLessThan(pxPerDayFor(40));
    // A 40-day project (the common case) must fit inside a 1440px window's
    // content area rather than scrolling for no reason.
    const sixWeeks = buildTimeline([], '2026-08-10', '2026-09-18')!;
    expect(chartWidthPx(sixWeeks)).toBeLessThan(1100);
  });

  it('keeps a floor so a one-week project still fills a desktop panel', () => {
    const tiny = buildTimeline([{ start_date: '2026-03-03', end_date: '2026-03-03' }])!;
    expect(chartWidthPx(tiny, 44, 640)).toBe(640);
  });
});

describe('rollupProgress', () => {
  it('averages the tasks', () => {
    expect(rollupProgress([{ progress: 100 }, { progress: 50 }])).toBe(75);
    expect(rollupProgress([{ progress: 0 }, { progress: 0 }, { progress: 100 }])).toBe(33);
  });

  it('is null — not 0 — when there is nothing to roll up', () => {
    expect(rollupProgress([])).toBeNull();
  });
});

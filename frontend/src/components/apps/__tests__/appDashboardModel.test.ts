import { describe, it, expect } from 'vitest';
import type { AppAnalyticsResponse } from '../../../api/client';
import {
  buildHeadlineMetrics, buildOperatorRollup, emptyReasonFor, fieldSampleSize,
  filtersFromQuery, filtersToQuery, hasNarrowingFilters, summariseField, DEFAULT_FILTERS,
} from '../appDashboardModel';
import type { EmptyStateApp } from '../appDashboardModel';

// ─── The per-app screen's model ───────────────────────────────────────────────
// The rule under test throughout: the screen may show numbers the server
// counted and nothing else. Every rate and average is null-checked first,
// because "never measured" and "measured zero" are different facts.

function option(over: Partial<EmptyStateApp> & { name: string }): EmptyStateApp {
  return { runsTotal: 0, lastRunAt: null, ...over };
}

function totals(over: Partial<AppAnalyticsResponse['totals']> = {}): AppAnalyticsResponse['totals'] {
  return {
    runs: 0, completed: 0, abandoned: 0,
    avg_duration_s: null, avg_duration_basis: null, first_pass_yield: null,
    ...over,
  };
}

function field(over: Partial<AppAnalyticsResponse['fields'][number]> & { kind: AppAnalyticsResponse['fields'][number]['kind'] }) {
  return {
    widget_id: 'w1', label: 'Field', type: 'number-input', step_name: 'Step 1',
    stats: {}, ...over,
  };
}

describe('buildHeadlineMetrics', () => {
  it('refuses to invent an average or a yield for an app with no runs', () => {
    const metrics = buildHeadlineMetrics(totals(), 30);
    const byKey = Object.fromEntries(metrics.map(m => [m.key, m]));

    expect(byKey.runs.value).toBe('0');
    expect(byKey.runs.note).toBe('nothing started in the last 30 days');
    // Counts stay counts; rates and averages go blank with a reason.
    expect(byKey.completed.value).toBe('0');
    expect(byKey.completed.note).toBe('no runs to complete');
    expect(byKey.avg_cycle.value).toBeNull();
    expect(byKey.first_pass_yield.value).toBeNull();
    // And no fabricated percentage anywhere in the row.
    expect(metrics.some(m => (m.value ?? '').includes('%'))).toBe(false);
  });

  it('says nothing was timed rather than reporting a zero cycle time', () => {
    // Runs started and none of them produced a measurement — and the reason
    // splits two honest ways: nothing has FINISHED, or things finished but
    // nobody timed them. Those are different facts and each gets its own words.
    const open = buildHeadlineMetrics(totals({ runs: 4, completed: 0, avg_duration_s: null }), 7);
    const avgOpen = open.find(m => m.key === 'avg_cycle');
    expect(avgOpen?.value).toBeNull();
    expect(avgOpen?.note).toBe('no run has finished yet');

    const untimed = buildHeadlineMetrics(totals({ runs: 4, completed: 4, avg_duration_s: null }), 7);
    const avgUntimed = untimed.find(m => m.key === 'avg_cycle');
    expect(avgUntimed?.value).toBeNull();
    expect(avgUntimed?.note).toBe('no finished run was timed');
  });

  it('names the measurement behind a real average', () => {
    // Hands-on step time and wall clock are two different, both-correct numbers
    // for the same runs. An unlabelled average is what made two screens look
    // like they were contradicting each other.
    const handsOn = buildHeadlineMetrics(
      totals({ runs: 4, completed: 4, avg_duration_s: 381, avg_duration_basis: 'hands_on' }), 30,
    ).find(m => m.key === 'avg_cycle');
    expect(handsOn?.label).toBe('Average cycle time · hands-on');

    const wallClock = buildHeadlineMetrics(
      totals({ runs: 4, completed: 4, avg_duration_s: 402, avg_duration_basis: 'elapsed' }), 30,
    ).find(m => m.key === 'avg_cycle');
    expect(wallClock?.label).toBe('Average cycle time · wall clock');

    // Nothing measured ⇒ nothing to name.
    const unknown = buildHeadlineMetrics(totals({ runs: 0 }), 30).find(m => m.key === 'avg_cycle');
    expect(unknown?.label).toBe('Average cycle time');
  });

  it('separates "no pass/fail check recorded" from a real zero yield', () => {
    const unmeasured = buildHeadlineMetrics(totals({ runs: 3, completed: 3, first_pass_yield: null }), 30)
      .find(m => m.key === 'first_pass_yield');
    expect(unmeasured?.value).toBeNull();
    expect(unmeasured?.note).toBe('no pass/fail check recorded');

    // Everything failing IS a measurement, and must render as 0%.
    const allFailed = buildHeadlineMetrics(totals({ runs: 3, completed: 3, first_pass_yield: 0 }), 30)
      .find(m => m.key === 'first_pass_yield');
    expect(allFailed?.value).toBe('0%');
  });

  it('reports the completion rate and cycle time the server measured', () => {
    const metrics = buildHeadlineMetrics(
      totals({ runs: 10, completed: 8, abandoned: 2, avg_duration_s: 125, first_pass_yield: 87.5 }),
      30,
    );
    const byKey = Object.fromEntries(metrics.map(m => [m.key, m]));
    expect(byKey.runs.note).toBe('2 abandoned');
    expect(byKey.completed.note).toBe('80% of runs started');
    expect(byKey.avg_cycle.value).toBe('2m 5s');
    expect(byKey.avg_cycle.note).toBe('over 8 completed runs');
    expect(byKey.first_pass_yield.value).toBe('88%');
  });
});

describe('emptyReasonFor', () => {
  const base = { appCount: 1, runsInWindow: 0, days: 30, filtersActive: false };

  it('points at building one when the company has no apps', () => {
    expect(emptyReasonFor({ ...base, appCount: 0, app: null })).toEqual({ kind: 'no-apps' });
  });

  it('says an app has never been run', () => {
    const app = option({ name: 'Weld Check', runsTotal: 0 });
    expect(emptyReasonFor({ ...base, app })).toEqual({ kind: 'never-run', appName: 'Weld Check' });
  });

  it('distinguishes "not lately" from "never"', () => {
    const app = option({ name: 'Weld Check', runsTotal: 40, lastRunAt: '2026-01-04 08:00:00' });
    expect(emptyReasonFor({ ...base, app })).toEqual({
      kind: 'no-runs-in-window', appName: 'Weld Check', days: 30, lastRunAt: '2026-01-04 08:00:00',
    });
  });

  it('does not claim "never run" when the run total is unknown', () => {
    const app = option({ name: 'Weld Check', runsTotal: null });
    expect(emptyReasonFor({ ...base, app })?.kind).toBe('no-runs-in-window');
  });

  it('blames the filters when filters are on', () => {
    const app = option({ name: 'Weld Check', runsTotal: 40 });
    expect(emptyReasonFor({ ...base, app, filtersActive: true })).toEqual({
      kind: 'no-match-filters', appName: 'Weld Check', days: 30,
    });
  });

  it('is not an empty state at all once runs exist', () => {
    const app = option({ name: 'Weld Check', runsTotal: 40 });
    expect(emptyReasonFor({ ...base, app, runsInWindow: 3 })).toBeNull();
  });

  it('waits rather than guessing while no app is resolved yet', () => {
    expect(emptyReasonFor({ ...base, app: null })).toBeNull();
  });
});

describe('filters', () => {
  it('only carries the parameters the analytics API honours', () => {
    const query = filtersToQuery({ days: 7, operator: 'Sam', workOrderId: '', productTypeId: 'pt-1' });
    const parsed = new URLSearchParams(query);
    expect([...parsed.keys()].sort()).toEqual(['days', 'operator', 'product_type_id']);
    expect(parsed.get('days')).toBe('7');
    expect(parsed.get('operator')).toBe('Sam');
    expect(parsed.get('product_type_id')).toBe('pt-1');
  });

  it('does not count the day window as a narrowing filter', () => {
    expect(hasNarrowingFilters({ ...DEFAULT_FILTERS, days: 365 })).toBe(false);
    expect(hasNarrowingFilters({ ...DEFAULT_FILTERS, operator: 'Sam' })).toBe(true);
  });

  it('reads back the slice a retired deep link was carrying', () => {
    // /apps/:id/analytics?days=7&operator=Sam&work_order_id=wo-1 was a link the
    // old Apps Dashboard handed out; the one per-app screen has to land on that
    // same slice rather than on a default.
    const round = filtersFromQuery(new URLSearchParams('days=7&operator=Sam&work_order_id=wo-1'));
    expect(round).toEqual({ days: 7, operator: 'Sam', workOrderId: 'wo-1', productTypeId: '' });
  });

  it('falls back to the default window rather than honouring one nothing offers', () => {
    expect(filtersFromQuery(new URLSearchParams('days=13')).days).toBe(DEFAULT_FILTERS.days);
    expect(filtersFromQuery(new URLSearchParams('')).days).toBe(DEFAULT_FILTERS.days);
  });
});

describe('buildOperatorRollup', () => {
  it('orders people busiest first and sizes each bar against the busiest', () => {
    const rows = buildOperatorRollup([
      { operator_name: 'Kim', runs: 2, avg_duration_s: 300 },
      { operator_name: 'Sam', runs: 8, avg_duration_s: 125 },
    ]);
    expect(rows.map(r => r.name)).toEqual(['Sam', 'Kim']);
    expect(rows[0].share).toBe(1);
    expect(rows[1].share).toBe(0.25);
    expect(rows[0].avgCycle).toBe('2m 5s');
  });

  it('has no average for somebody whose runs were never timed', () => {
    // "avg 0s" would name them the fastest person on the floor.
    const [row] = buildOperatorRollup([{ operator_name: 'Sam', runs: 3, avg_duration_s: 0 }]);
    expect(row.avgCycle).toBeNull();
    expect(row.avgNote).toBe('none of their runs was timed');
  });

  it('names an unattributed run rather than dropping it', () => {
    const [row] = buildOperatorRollup([{ operator_name: '', runs: 1, avg_duration_s: null }]);
    expect(row.name).toBe('Unknown');
    expect(row.runs).toBe(1);
  });
});

describe('summariseField', () => {
  it('describes a number field from what was actually recorded', () => {
    expect(summariseField(field({ kind: 'number', stats: { avg: 12.5, min: 10, max: 15, count: 8 } })))
      .toBe('avg 12.5 · range 10–15');
  });

  it('blanks a number field with no average rather than showing zero', () => {
    expect(summariseField(field({ kind: 'number', stats: { avg: null, count: 0 } }))).toBe('—');
  });

  it('reports pass/fail counts with the rate the server computed', () => {
    expect(summariseField(field({ kind: 'boolean', stats: { pass: 9, fail: 1, yield_pct: 90 } })))
      .toBe('9 pass · 1 fail · 90% pass rate');
  });

  it('blanks a pass/fail field nobody filled in', () => {
    expect(summariseField(field({ kind: 'boolean', stats: { pass: 0, fail: 0, yield_pct: null } }))).toBe('—');
  });

  it('lists the top option values and counts the rest', () => {
    expect(summariseField(field({
      kind: 'option',
      stats: { options: [
        { value: 'A', count: 5 }, { value: 'B', count: 3 }, { value: 'C', count: 2 }, { value: 'D', count: 1 },
      ] },
    }))).toBe('A (5) · B (3) · C (2) · +1 more');
  });

  it('counts entries for free-text, photo and signature fields', () => {
    expect(summariseField(field({ kind: 'text', stats: { count: 1 } }))).toBe('1 entry');
    expect(summariseField(field({ kind: 'text', stats: { count: 4 } }))).toBe('4 entries');
  });
});

describe('fieldSampleSize', () => {
  it('counts pass/fail checks as pass plus fail', () => {
    expect(fieldSampleSize(field({ kind: 'boolean', stats: { pass: 9, fail: 1 } }))).toBe(10);
  });

  it('uses the recorded count for every other kind', () => {
    expect(fieldSampleSize(field({ kind: 'number', stats: { count: 6 } }))).toBe(6);
    expect(fieldSampleSize(field({ kind: 'text', stats: {} }))).toBe(0);
  });
});

import { describe, it, expect, beforeEach } from 'vitest';
import type { AppAnalyticsResponse, AppRunStats } from '../../../api/client';
import type { App } from '../../../types';
import {
  appSelectionKey, buildAppOptions, buildHeadlineMetrics, emptyReasonFor, fieldSampleSize,
  filtersToQuery, hasNarrowingFilters, pickDefaultAppId, readSelectedAppId, resolveAppId,
  summariseField, writeSelectedAppId, DEFAULT_FILTERS,
} from '../appDashboardModel';
import type { DashboardAppOption } from '../appDashboardModel';

// ─── Apps Dashboard model ─────────────────────────────────────────────────────
// The rule under test throughout: the page may show numbers the server counted
// and nothing else. Every rate and average is null-checked first, because
// "never measured" and "measured zero" are different facts.

function app(over: Partial<App> & { id: string; name: string }): App {
  return {
    description: '', status: 'published', steps: [], variables: [],
    created_at: '2026-01-01 00:00:00', updated_at: '2026-01-01 00:00:00',
    ...over,
  };
}

function stat(over: Partial<AppRunStats> & { app_id: string }): AppRunStats {
  return { runs_total: 0, runs_7d: 0, in_progress: 0, last_run_at: null, ...over };
}

function option(over: Partial<DashboardAppOption> & { id: string }): DashboardAppOption {
  return {
    name: over.id, status: 'published', departmentId: null,
    runsTotal: 0, lastRunAt: null, ...over,
  };
}

function totals(over: Partial<AppAnalyticsResponse['totals']> = {}): AppAnalyticsResponse['totals'] {
  return { runs: 0, completed: 0, abandoned: 0, avg_duration_s: null, first_pass_yield: null, ...over };
}

function field(over: Partial<AppAnalyticsResponse['fields'][number]> & { kind: AppAnalyticsResponse['fields'][number]['kind'] }) {
  return {
    widget_id: 'w1', label: 'Field', type: 'number-input', step_name: 'Step 1',
    stats: {}, ...over,
  };
}

describe('buildAppOptions', () => {
  it('joins run counters onto the app list', () => {
    const options = buildAppOptions(
      [app({ id: 'a1', name: 'Weld Check', department_id: 'd-weld' })],
      [stat({ app_id: 'a1', runs_total: 12, last_run_at: '2026-08-20 10:00:00' })],
    );
    expect(options).toEqual([{
      id: 'a1', name: 'Weld Check', status: 'published', departmentId: 'd-weld',
      runsTotal: 12, lastRunAt: '2026-08-20 10:00:00',
    }]);
  });

  it('reports an unknown run total when the counters did not load', () => {
    // Unknown is not zero — the empty state must not claim "never run" because
    // a stats request dropped.
    const [only] = buildAppOptions([app({ id: 'a1', name: 'A' })], null);
    expect(only.runsTotal).toBeNull();
  });

  it('records a genuine zero when the counters loaded and had nothing to say', () => {
    const [only] = buildAppOptions([app({ id: 'a1', name: 'A' })], []);
    expect(only.runsTotal).toBe(0);
  });
});

describe('pickDefaultAppId', () => {
  it('opens on the app that was run most recently', () => {
    const id = pickDefaultAppId([
      option({ id: 'old', lastRunAt: '2026-08-01 09:00:00' }),
      option({ id: 'newest', lastRunAt: '2026-08-19 17:30:00' }),
      option({ id: 'never' }),
    ]);
    expect(id).toBe('newest');
  });

  it('falls back to the most recently edited app when nothing has ever run', () => {
    // The API hands apps back updated_at DESC, so first in the list is newest.
    expect(pickDefaultAppId([option({ id: 'first' }), option({ id: 'second' })])).toBe('first');
  });

  it('has nothing to open when there are no apps', () => {
    expect(pickDefaultAppId([])).toBeNull();
  });

  it('ignores an unparseable timestamp rather than ranking it first', () => {
    const id = pickDefaultAppId([
      option({ id: 'broken', lastRunAt: 'not-a-date' }),
      option({ id: 'real', lastRunAt: '2026-08-19 17:30:00' }),
    ]);
    expect(id).toBe('real');
  });
});

describe('resolveAppId', () => {
  const options = [option({ id: 'a' }), option({ id: 'b', lastRunAt: '2026-08-19 10:00:00' })];

  it('keeps a remembered app that is still there', () => {
    expect(resolveAppId(options, 'a')).toBe('a');
  });

  it('falls back to the default when the remembered app is gone', () => {
    expect(resolveAppId(options, 'deleted-app')).toBe('b');
  });

  it('falls back to the default when nothing is remembered', () => {
    expect(resolveAppId(options, null)).toBe('b');
  });

  it('resolves to nothing when there are no apps to pick from', () => {
    expect(resolveAppId([], 'a')).toBeNull();
  });
});

describe('selection persistence', () => {
  beforeEach(() => localStorage.clear());

  it('remembers the choice per user', () => {
    writeSelectedAppId('u-1', 'app-1');
    writeSelectedAppId('u-2', 'app-2');
    expect(readSelectedAppId('u-1')).toBe('app-1');
    expect(readSelectedAppId('u-2')).toBe('app-2');
    expect(appSelectionKey('u-1')).not.toBe(appSelectionKey('u-2'));
  });

  it('reads back nothing when the user has never picked', () => {
    expect(readSelectedAppId('u-3')).toBeNull();
  });

  it('clears the remembered app when handed null', () => {
    writeSelectedAppId('u-1', 'app-1');
    writeSelectedAppId('u-1', null);
    expect(readSelectedAppId('u-1')).toBeNull();
  });
});

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

  it('says a run is unfinished rather than reporting a zero cycle time', () => {
    const metrics = buildHeadlineMetrics(totals({ runs: 4, completed: 0, avg_duration_s: null }), 7);
    const avg = metrics.find(m => m.key === 'avg_cycle');
    expect(avg?.value).toBeNull();
    expect(avg?.note).toBe('no run has finished yet');
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
    const app = option({ id: 'a', name: 'Weld Check', runsTotal: 0 });
    expect(emptyReasonFor({ ...base, app })).toEqual({ kind: 'never-run', appName: 'Weld Check' });
  });

  it('distinguishes "not lately" from "never"', () => {
    const app = option({ id: 'a', name: 'Weld Check', runsTotal: 40, lastRunAt: '2026-01-04 08:00:00' });
    expect(emptyReasonFor({ ...base, app })).toEqual({
      kind: 'no-runs-in-window', appName: 'Weld Check', days: 30, lastRunAt: '2026-01-04 08:00:00',
    });
  });

  it('does not claim "never run" when the run total is unknown', () => {
    const app = option({ id: 'a', name: 'Weld Check', runsTotal: null });
    expect(emptyReasonFor({ ...base, app })?.kind).toBe('no-runs-in-window');
  });

  it('blames the filters when filters are on', () => {
    const app = option({ id: 'a', name: 'Weld Check', runsTotal: 40 });
    expect(emptyReasonFor({ ...base, app, filtersActive: true })).toEqual({
      kind: 'no-match-filters', appName: 'Weld Check', days: 30,
    });
  });

  it('is not an empty state at all once runs exist', () => {
    const app = option({ id: 'a', name: 'Weld Check', runsTotal: 40 });
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

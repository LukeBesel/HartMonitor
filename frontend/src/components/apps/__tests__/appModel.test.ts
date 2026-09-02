import { describe, it, expect } from 'vitest';
import {
  durationTicks, elapsedSeconds, fmtDuration, fmtMinutes, measuredSeconds, runDurationSeconds,
  stepSecondsByIndex, stepTimesTotal,
} from '../appModel';

// ─── Measured vs. unmeasured ──────────────────────────────────────────────────
// The rule these lock down: a duration of zero is not a measurement. The apps
// endpoints time a run by wall clock between start and finish, so a run opened
// and closed inside one second comes back as 0 — and an average over runs like
// that comes back as 0 too. Run History already draws that line in SQL and
// prints "—"; every other reporting screen has to agree, or the same run reads
// "0s" on one page and "unknown" on the next.

describe('measuredSeconds', () => {
  it('passes real durations straight through', () => {
    expect(measuredSeconds(1)).toBe(1);
    expect(measuredSeconds(0.4)).toBe(0.4);
    expect(measuredSeconds(3600)).toBe(3600);
  });

  it('treats zero and negatives as never measured', () => {
    expect(measuredSeconds(0)).toBeNull();
    expect(measuredSeconds(-5)).toBeNull();
  });

  it('treats missing and unusable input as never measured', () => {
    expect(measuredSeconds(null)).toBeNull();
    expect(measuredSeconds(undefined)).toBeNull();
    expect(measuredSeconds(NaN)).toBeNull();
    expect(measuredSeconds(Infinity)).toBeNull();
  });
});

describe('stepSecondsByIndex', () => {
  it('reads the player’s index-keyed blob in step order', () => {
    expect(stepSecondsByIndex({ 0: 55, 1: 218, 2: 108 })).toEqual([55, 218, 108]);
  });

  it('leaves a gap where a step was never timed', () => {
    expect(stepSecondsByIndex({ 0: 55, 2: 108 })).toEqual([55, null, 108]);
  });

  it('survives an empty or malformed blob', () => {
    expect(stepSecondsByIndex({})).toEqual([]);
    expect(stepSecondsByIndex(null)).toEqual([]);
    expect(stepSecondsByIndex({ notAnIndex: 5 })).toEqual([]);
    expect(stepSecondsByIndex({ 0: 'oops' })).toEqual([null]);
  });
});

describe('stepTimesTotal', () => {
  it('adds the timers up', () => {
    expect(stepTimesTotal({ 0: 55, 1: 218, 2: 108 })).toBe(381);
  });

  it('is null when nothing was timed, rather than zero', () => {
    expect(stepTimesTotal({})).toBeNull();
    expect(stepTimesTotal({ 0: 0, 1: 0 })).toBeNull();
    expect(stepTimesTotal(undefined)).toBeNull();
  });
});

describe('runDurationSeconds', () => {
  const started = '2026-08-26 01:48:33';
  const finished = '2026-08-26 01:54:22'; // 349s later

  it('prefers the per-step timers, matching the run-history SQL', () => {
    expect(runDurationSeconds({
      started_at: started, completed_at: finished,
      step_times: { 0: 55, 1: 218, 2: 108 }, status: 'completed',
    })).toBe(381);
  });

  it('falls back to wall clock when no step was timed', () => {
    expect(runDurationSeconds({
      started_at: started, completed_at: finished, step_times: {}, status: 'completed',
    })).toBe(349);
  });

  it('is null for a run that opened and closed in the same second', () => {
    expect(runDurationSeconds({
      started_at: started, completed_at: started, step_times: {}, status: 'completed',
    })).toBeNull();
  });

  it('gives a run still on the bench no duration at all', () => {
    expect(runDurationSeconds({
      started_at: started, completed_at: null, step_times: {}, status: 'in_progress',
    })).toBeNull();
  });

  it('still reports the step timers of a run that was abandoned part-way', () => {
    expect(runDurationSeconds({
      started_at: started, completed_at: null, step_times: { 0: 55 }, status: 'abandoned',
    })).toBe(55);
  });
});

describe('elapsedSeconds', () => {
  it('counts from the start to the moment asked about', () => {
    const now = Date.parse('2026-08-26T01:50:00Z');
    expect(elapsedSeconds('2026-08-26 01:48:33', now)).toBe(87);
  });

  it('has nothing to report without a start', () => {
    expect(elapsedSeconds(null)).toBeNull();
    expect(elapsedSeconds('not a date')).toBeNull();
  });
});

// ─── Duration axis ticks ──────────────────────────────────────────────────────

describe('durationTicks', () => {
  it('lands on round durations a person reads at a glance', () => {
    expect(durationTicks(240)).toEqual([0, 60, 120, 180, 240]);
    expect(durationTicks(45)).toEqual([0, 10, 20, 30, 40, 50]);
  });

  it('covers the top of the range so no bar runs off the axis', () => {
    const ticks = durationTicks(381);
    expect(ticks[ticks.length - 1]).toBeGreaterThanOrEqual(381);
    expect(ticks[0]).toBe(0);
  });

  it('keeps the tick count near the target', () => {
    for (const max of [12, 95, 400, 3000, 40000]) {
      expect(durationTicks(max).length).toBeLessThanOrEqual(8);
      expect(durationTicks(max).length).toBeGreaterThan(1);
    }
  });

  it('has nothing to draw without a range', () => {
    expect(durationTicks(0)).toEqual([0]);
    expect(durationTicks(NaN)).toEqual([0]);
  });
});

// ─── fmtMinutes: the one permitted unit conversion onto fmtDuration ───────────
// Some endpoints (takt times, leaderboard averages) hand back minutes
// directly. fmtMinutes is the ONLY sanctioned adapter for that — literally
// `fmtDuration(minutes * 60)` — so a call site never multiplies by 60 inline
// and never grows a second, independently-rounding implementation.

describe('fmtMinutes', () => {
  it('matches what fmtDuration renders for the equivalent seconds, exactly', () => {
    // 7.5 minutes = 450s; fmtDuration(450) = '7m 30s'.
    expect(fmtMinutes(7.5)).toBe('7m 30s');
    expect(fmtMinutes(7.5)).toBe(fmtDuration(7.5 * 60));
    // 0.1 minutes = 6s; fmtDuration(6) = '6s'.
    expect(fmtMinutes(0.1)).toBe('6s');
    expect(fmtMinutes(0.1)).toBe(fmtDuration(0.1 * 60));
  });

  it('says nothing rather than zero when there is nothing to say', () => {
    expect(fmtMinutes(null)).toBe('—');
    expect(fmtMinutes(undefined)).toBe('—');
    expect(fmtMinutes(NaN)).toBe('—');
    expect(fmtMinutes(-1)).toBe('—');
  });

  it('still reaches hours for a long enough run', () => {
    // 90 minutes = 5400s -> fmtDuration(5400) = '1h 30m'.
    expect(fmtMinutes(90)).toBe('1h 30m');
  });
});

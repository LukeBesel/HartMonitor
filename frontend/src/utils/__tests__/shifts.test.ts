import { describe, it, expect } from 'vitest';
import {
  parseDays, toMinutes, isOvernight, shiftActiveAt, currentShiftFor, formatShiftRange,
  type SiteShift,
} from '../shifts';

// Local-time date helper: year, month (1-12), day, hour, minute.
function at(y: number, mo: number, d: number, h: number, mi: number): Date {
  return new Date(y, mo - 1, d, h, mi, 0, 0);
}

// 2026-08-21 is a Friday (getDay() === 5); 2026-08-22 a Saturday.
const FRI = { y: 2026, mo: 8, d: 21 };
const SAT = { y: 2026, mo: 8, d: 22 };
const SUN = { y: 2026, mo: 8, d: 23 };

function shift(partial: Partial<SiteShift>): SiteShift {
  return {
    id: partial.id ?? 's1',
    name: partial.name ?? 'Day',
    starts_at: partial.starts_at ?? '06:00',
    ends_at: partial.ends_at ?? '14:00',
    days: partial.days ?? [0, 1, 2, 3, 4, 5, 6],
    sort_order: partial.sort_order ?? 0,
    color: partial.color ?? null,
  };
}

describe('parseDays', () => {
  it('accepts arrays and dedupes/sorts', () => {
    expect(parseDays([5, 1, 1, 3])).toEqual([1, 3, 5]);
  });
  it('parses JSON strings (server storage format)', () => {
    expect(parseDays('[1,2,3]')).toEqual([1, 2, 3]);
  });
  it('drops out-of-range or non-integer entries', () => {
    expect(parseDays([0, 7, -1, 2.5, 6])).toEqual([0, 6]);
  });
  it('returns [] for malformed input', () => {
    expect(parseDays('not json')).toEqual([]);
    expect(parseDays(undefined)).toEqual([]);
    expect(parseDays(null)).toEqual([]);
  });
});

describe('toMinutes', () => {
  it('converts HH:MM to minutes since midnight', () => {
    expect(toMinutes('00:00')).toBe(0);
    expect(toMinutes('06:30')).toBe(390);
    expect(toMinutes('23:59')).toBe(1439);
  });
  it('returns NaN for malformed times', () => {
    expect(toMinutes('24:00')).toBeNaN();
    expect(toMinutes('7:00')).toBeNaN();
    expect(toMinutes('nope')).toBeNaN();
  });
});

describe('isOvernight', () => {
  it('detects spans that cross midnight', () => {
    expect(isOvernight({ starts_at: '22:00', ends_at: '06:00' })).toBe(true);
    expect(isOvernight({ starts_at: '06:00', ends_at: '14:00' })).toBe(false);
  });
});

describe('shiftActiveAt — same-day spans', () => {
  const day = shift({ starts_at: '06:00', ends_at: '14:00', days: [1, 2, 3, 4, 5] });

  it('is active within the window on an active day', () => {
    expect(shiftActiveAt(day, at(FRI.y, FRI.mo, FRI.d, 9, 0))).toBe(true);
  });
  it('start is inclusive, end exclusive', () => {
    expect(shiftActiveAt(day, at(FRI.y, FRI.mo, FRI.d, 6, 0))).toBe(true);
    expect(shiftActiveAt(day, at(FRI.y, FRI.mo, FRI.d, 14, 0))).toBe(false);
  });
  it('is inactive outside the window and on masked-out days', () => {
    expect(shiftActiveAt(day, at(FRI.y, FRI.mo, FRI.d, 5, 59))).toBe(false);
    expect(shiftActiveAt(day, at(SAT.y, SAT.mo, SAT.d, 9, 0))).toBe(false); // Saturday not in mask
  });
});

describe('shiftActiveAt — overnight spans', () => {
  // Night shift starts Mon-Fri at 22:00 and runs to 06:00 the next morning.
  const night = shift({ starts_at: '22:00', ends_at: '06:00', days: [1, 2, 3, 4, 5] });

  it('is active on the evening side of an active start day', () => {
    expect(shiftActiveAt(night, at(FRI.y, FRI.mo, FRI.d, 23, 0))).toBe(true);
  });
  it('is active past midnight, attributed to the start day', () => {
    // Saturday 02:00 belongs to the shift that STARTED Friday.
    expect(shiftActiveAt(night, at(SAT.y, SAT.mo, SAT.d, 2, 0))).toBe(true);
  });
  it('respects the day mask on the morning side', () => {
    // Sunday 02:00 would belong to a Saturday start — Saturday is masked out.
    expect(shiftActiveAt(night, at(SUN.y, SUN.mo, SUN.d, 2, 0))).toBe(false);
  });
  it('respects the day mask on the evening side', () => {
    expect(shiftActiveAt(night, at(SAT.y, SAT.mo, SAT.d, 23, 0))).toBe(false);
  });
  it('end is exclusive after midnight', () => {
    expect(shiftActiveAt(night, at(SAT.y, SAT.mo, SAT.d, 6, 0))).toBe(false);
    expect(shiftActiveAt(night, at(SAT.y, SAT.mo, SAT.d, 5, 59))).toBe(true);
  });
  it('is inactive in the mid-day gap', () => {
    expect(shiftActiveAt(night, at(FRI.y, FRI.mo, FRI.d, 12, 0))).toBe(false);
  });
});

describe('shiftActiveAt — malformed data', () => {
  it('never matches with bad times, empty mask, or zero-length span', () => {
    const bad = shift({ starts_at: 'xx:00' });
    const empty = shift({ days: [] });
    const zero = shift({ starts_at: '08:00', ends_at: '08:00' });
    const when = at(FRI.y, FRI.mo, FRI.d, 9, 0);
    expect(shiftActiveAt(bad, when)).toBe(false);
    expect(shiftActiveAt(empty, when)).toBe(false);
    expect(shiftActiveAt(zero, when)).toBe(false);
  });
  it('handles days delivered as a JSON string', () => {
    const s = shift({ days: '[5]' as unknown as number[] });
    expect(shiftActiveAt(s, at(FRI.y, FRI.mo, FRI.d, 9, 0))).toBe(true);
    expect(shiftActiveAt(s, at(SAT.y, SAT.mo, SAT.d, 9, 0))).toBe(false);
  });
});

describe('currentShiftFor', () => {
  const first = shift({ id: 'a', name: 'First', starts_at: '06:00', ends_at: '14:00', sort_order: 0 });
  const second = shift({ id: 'b', name: 'Second', starts_at: '14:00', ends_at: '22:00', sort_order: 1 });
  const night = shift({ id: 'c', name: 'Night', starts_at: '22:00', ends_at: '06:00', sort_order: 2 });

  it('picks the shift covering the given time', () => {
    expect(currentShiftFor([first, second, night], at(FRI.y, FRI.mo, FRI.d, 15, 30))?.id).toBe('b');
    expect(currentShiftFor([first, second, night], at(SAT.y, SAT.mo, SAT.d, 1, 0))?.id).toBe('c');
  });
  it('returns null when nothing matches or list is empty', () => {
    const weekdayOnly = shift({ days: [1, 2, 3, 4, 5] });
    expect(currentShiftFor([weekdayOnly], at(SAT.y, SAT.mo, SAT.d, 9, 0))).toBeNull();
    expect(currentShiftFor([], at(FRI.y, FRI.mo, FRI.d, 9, 0))).toBeNull();
  });
  it('prefers lower sort_order when shifts overlap', () => {
    const a = shift({ id: 'hi', starts_at: '06:00', ends_at: '18:00', sort_order: 5 });
    const b = shift({ id: 'lo', starts_at: '08:00', ends_at: '16:00', sort_order: 1 });
    expect(currentShiftFor([a, b], at(FRI.y, FRI.mo, FRI.d, 10, 0))?.id).toBe('lo');
  });
});

describe('formatShiftRange', () => {
  it('formats plain and overnight ranges', () => {
    expect(formatShiftRange({ starts_at: '06:00', ends_at: '14:00' })).toBe('06:00 – 14:00');
    expect(formatShiftRange({ starts_at: '22:00', ends_at: '06:00' })).toBe('22:00 – 06:00 +1');
  });
});

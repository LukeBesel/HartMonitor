// ─── Facility shift helpers ───────────────────────────────────────────────────
// Pure helpers for the per-facility shift builder (site_shifts). A shift is a
// named HH:MM time range with an active-days mask (0-6, Sunday-Saturday).
// Overnight spans — where ends_at < starts_at — roll into the next day and are
// attributed to the day the shift STARTS: a Fri 22:00-06:00 shift is active
// Sat 02:00 only when Friday (5) is in the days mask.

export interface SiteShift {
  id: string;
  site_id?: string;
  company_id?: string;
  name: string;
  /** 'HH:MM' 24h */
  starts_at: string;
  /** 'HH:MM' 24h — may be earlier than starts_at (overnight span) */
  ends_at: string;
  /** Active days of week, 0 (Sun) – 6 (Sat). May arrive as a JSON string. */
  days: number[] | string;
  color?: string | null;
  sort_order?: number;
  created_at?: string;
}

export const DAY_LETTERS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'] as const;
export const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const;

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Parses a days mask that may be an array or a JSON string. Invalid or
 *  malformed input yields an empty mask (shift never active). */
export function parseDays(days: SiteShift['days'] | null | undefined): number[] {
  let list: unknown = days;
  if (typeof days === 'string') {
    try { list = JSON.parse(days); } catch { return []; }
  }
  if (!Array.isArray(list)) return [];
  return [...new Set(list.filter((d): d is number => Number.isInteger(d) && d >= 0 && d <= 6))].sort((a, b) => a - b);
}

/** 'HH:MM' → minutes since midnight, or NaN when malformed. */
export function toMinutes(hhmm: string): number {
  if (typeof hhmm !== 'string' || !TIME_RE.test(hhmm)) return NaN;
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

/** True when the shift crosses midnight (ends_at earlier than starts_at). */
export function isOvernight(shift: Pick<SiteShift, 'starts_at' | 'ends_at'>): boolean {
  const start = toMinutes(shift.starts_at);
  const end = toMinutes(shift.ends_at);
  return Number.isFinite(start) && Number.isFinite(end) && end < start;
}

/** True when `date` falls inside the shift's time range on an active day.
 *  Start is inclusive, end exclusive. Handles overnight spans and day masks. */
export function shiftActiveAt(shift: SiteShift, date: Date): boolean {
  const start = toMinutes(shift.starts_at);
  const end = toMinutes(shift.ends_at);
  if (!Number.isFinite(start) || !Number.isFinite(end) || start === end) return false;

  const days = parseDays(shift.days);
  if (days.length === 0) return false;

  const day = date.getDay();
  const minutes = date.getHours() * 60 + date.getMinutes();

  if (start < end) {
    // Same-day span: active day + within [start, end).
    return days.includes(day) && minutes >= start && minutes < end;
  }

  // Overnight span: the evening side belongs to today's mask; the morning
  // side belongs to the PREVIOUS day's mask (the day the shift started).
  if (minutes >= start) return days.includes(day);
  if (minutes < end) return days.includes((day + 6) % 7);
  return false;
}

/** Returns the shift active at `date` (defaults to now), preferring lower
 *  sort_order (then start time) when shifts overlap. Null when none match. */
export function currentShiftFor(shifts: SiteShift[], date: Date = new Date()): SiteShift | null {
  const sorted = [...(shifts || [])].sort((a, b) =>
    (a.sort_order ?? 0) - (b.sort_order ?? 0) || (toMinutes(a.starts_at) || 0) - (toMinutes(b.starts_at) || 0)
  );
  for (const shift of sorted) {
    if (shiftActiveAt(shift, date)) return shift;
  }
  return null;
}

/** '06:00 – 14:30' with a next-day marker for overnight spans: '22:00 – 06:00 +1'. */
export function formatShiftRange(shift: Pick<SiteShift, 'starts_at' | 'ends_at'>): string {
  return `${shift.starts_at} – ${shift.ends_at}${isOvernight(shift) ? ' +1' : ''}`;
}

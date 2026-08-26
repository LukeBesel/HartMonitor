'use strict';

// ─── The plant's day, not Greenwich's ─────────────────────────────────────────
// SQLite's `date('now')` is UTC. Every "completed today" tile, every OEE shift
// window and every "runs today" count was therefore measured against a day that
// rolls over at midnight UTC — 8pm in Detroit, 7pm in Chicago, 5pm in
// California. A plant on second shift watched its counters reset to zero in the
// middle of the shift, and the morning crew read a number that still had the
// back half of yesterday evening folded into it.
//
// The fix is a modifier applied to BOTH sides of a comparison, so `now` and the
// stored timestamp are shifted onto the same local clock:
//
//     date(completed_at, ?) = date('now', ?)
//
// The offset is read from the company's own `timezone` setting and computed for
// the current instant, so it follows daylight saving rather than being pinned to
// a number that goes wrong twice a year. An unset or unrecognised zone falls
// back to UTC, which is exactly the old behaviour — this can never be worse than
// what it replaces.
//
// Note this shifts the *day boundary*, not the stored data. Timestamps stay in
// UTC in the database, which is the only sane thing to store.

const db = require('./db');

/**
 * How far the wall clock in `timeZone` is ahead of UTC, in minutes, at `at`.
 * Positive east of Greenwich. Returns 0 for a zone the runtime doesn't know.
 */
function offsetMinutes(timeZone, at = new Date()) {
  if (!timeZone) return 0;
  try {
    const parts = Object.fromEntries(
      new Intl.DateTimeFormat('en-US', {
        timeZone,
        hour12: false,
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit',
      })
        .formatToParts(at)
        .map(p => [p.type, p.value]),
    );
    // `hour12: false` reports midnight as "24" in some ICU versions.
    const hour = Number(parts.hour) % 24;
    const localAsUTC = Date.UTC(
      Number(parts.year), Number(parts.month) - 1, Number(parts.day),
      hour, Number(parts.minute), Number(parts.second),
    );
    return Math.round((localAsUTC - at.getTime()) / 60000);
  } catch {
    // An unrecognised zone name: fall back to UTC rather than guessing.
    return 0;
  }
}

/** The company's configured timezone, or '' when it has never set one. */
function companyTimeZone(companyId) {
  const row = db
    .prepare("SELECT value FROM org_settings WHERE company_id = ? AND key = 'timezone'")
    .get(companyId);
  return row?.value || '';
}

/**
 * A SQLite date modifier that moves a UTC timestamp onto the plant's clock —
 * e.g. '-240 minutes'. Bind it to both sides of a day comparison.
 *
 * Minutes, not hours, because a handful of real plants sit on half-hour and
 * quarter-hour offsets (India, Newfoundland, Nepal, parts of Australia).
 */
function plantDayShift(companyId) {
  const minutes = offsetMinutes(companyTimeZone(companyId));
  return `${minutes >= 0 ? '+' : '-'}${Math.abs(minutes)} minutes`;
}

/**
 * True when the runtime recognises `tz` as an IANA zone name.
 *
 * Worth checking before a zone is stored, because a name the runtime does not
 * know does not fail loudly — plantDayShift() falls back to UTC, so a typo in
 * Settings quietly moves the whole plant to Greenwich and nothing says so.
 */
function isValidTimeZone(tz) {
  if (typeof tz !== 'string' || !tz.trim()) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz.trim() });
    return true;
  } catch {
    return false;
  }
}

/**
 * Today's calendar date at the plant, as 'YYYY-MM-DD'.
 *
 * Some screens are addressed by a day rather than filtered by one — the SQDC
 * board takes ?date=, the TV board reads whatever day it was opened on. Those
 * need the plant's date to default to, not the server's; `new Date()
 * .toISOString().slice(0, 10)` is the UTC date, which is tomorrow for a plant
 * in Auckland and still yesterday for one in California all evening.
 */
function plantToday(companyId, at = new Date()) {
  const shifted = new Date(at.getTime() + offsetMinutes(companyTimeZone(companyId), at) * 60000);
  return shifted.toISOString().slice(0, 10);
}

/**
 * Reads a stored timestamp as UTC whatever shape it is in.
 *
 * SQLite's own `datetime('now')` writes 'YYYY-MM-DD HH:MM:SS' with no zone
 * marker, while rows written through the API carry a full ISO string ending in
 * Z. Both are UTC, but only the second says so — and `new Date()` reads a bare
 * space-separated stamp as the *server's* local time, which slides a day on any
 * host that is not itself set to UTC.
 */
function asUtcDate(ts) {
  if (!ts) return null;
  const s = String(ts).trim().replace(' ', 'T');
  const d = new Date(/[Zz]$|[+-]\d{2}:?\d{2}$/.test(s) ? s : `${s}Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * A function that turns a stored UTC timestamp into the calendar date it fell
 * on at the plant, 'YYYY-MM-DD'. The company's offset is resolved once, so a
 * loop over a day's rows does not re-read the setting per row.
 *
 * Use this wherever a comparison happens in JavaScript rather than in SQL; the
 * SQL side wants plantDayShift() instead.
 */
function plantDateFn(companyId, at = new Date()) {
  const shiftMs = offsetMinutes(companyTimeZone(companyId), at) * 60000;
  return (ts) => {
    const d = asUtcDate(ts);
    return d ? new Date(d.getTime() + shiftMs).toISOString().slice(0, 10) : null;
  };
}

module.exports = {
  plantDayShift, plantToday, plantDateFn, asUtcDate,
  offsetMinutes, companyTimeZone, isValidTimeZone,
};

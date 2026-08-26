'use strict';

// ─── How long a run took ──────────────────────────────────────────────────────
//
// This module is the ONLY place in the backend that decides how long a run
// took. Every screen that shows a duration reads it from here, so the same run
// can no longer report 6m 21s on App History and 6m 42s on the Command Center
// with nothing on either screen to explain the gap.
//
// THE MODEL — a run carries two genuinely different measurements, and they are
// different facts, not disagreeing answers:
//
//   hands_on_seconds  The per-step timers added up. The time an operator was
//                     actually working the steps. It excludes the pauses,
//                     handoffs and the tablet sitting on the bench between
//                     steps. NULL when the app records no step timers, or the
//                     run stopped before any of them ran.
//
//   elapsed_seconds   Wall clock, started_at → completed_at. What the unit cost
//                     the line, idle time included. NULL until the run finishes
//                     — a run in progress has an elapsed-SO-FAR, which is a
//                     different thing again and must never be printed in a
//                     column headed "Duration" next to finished runs.
//
// Both are legitimate, so both ship on the payload, and any screen showing one
// of them says which one it is showing.
//
//   duration_seconds  The canonical run duration: hands_on when the run has it,
//                     else elapsed. This is the number a "Duration" column
//                     shows on EVERY screen, so one run reads the same
//                     everywhere. `duration_basis` says which measurement it
//                     came from, so the screen can label it.
//
// THREE RULES this module exists to enforce:
//
//   1. Unknown is NULL, never 0. A run nobody timed did not take zero seconds,
//      and it must not drag an average toward zero. Both measurements are NULL
//      rather than 0 when there is nothing behind them, and every average here
//      is taken over the runs that actually have a measurement.
//
//      A non-positive elapsed is unknown, not zero: you cannot start and finish
//      a unit in the same instant. It means the two timestamps are too coarse
//      to separate, which is a missing measurement.
//
//   2. Round ONCE, at the edge, and never off an already-rounded number. The
//      Command Center used to derive its seconds from a tenth-of-a-minute it
//      had already rounded, so eight runs measuring 3.20–3.56 s all printed
//      "6s" — 70–90 % overstated and quantised to six-second steps — beside a
//      department average computed at full precision. Everything here stays at
//      full precision until `roundSeconds` takes it to a tenth of a second,
//      exactly once, on its way out of the process.
//
//   3. The unit is in the name. Every field this module produces ends in
//      `_seconds`, so a value can never be fed to a formatter expecting
//      minutes (that mistake once rendered 451 seconds as "7.5h" on the most
//      viewed screen in the product).
//
// The SQL builders take a table alias so a query can use `completions` or `c`;
// the JS twins take a row that is already in memory. They must agree — the
// unit test in backend/test/cycle-time.test.js holds them to it.

/** Seconds in a day — the julianday() difference is in days. */
const SECONDS_PER_DAY = 86400;

/**
 * Round a duration exactly once, on the way out, and never round a real
 * measurement away to nothing.
 *
 * A tenth of a second rather than a whole one, because a real operation is
 * routinely sub-second — a press, a scan, a go/no-go gauge — and whole-second
 * rounding turns a measured 0.4 s into a fabricated "0s", the same class of lie
 * as a fabricated average.
 *
 * Below a second it keeps milliseconds, which is the actual resolution of the
 * timestamps behind these numbers. That matters because rounding is the LAST
 * place a zero can be invented: a run measured at 0.02 s rounded to a tenth is
 * 0.0, and a 0 on the payload is indistinguishable from "this took no time".
 *
 * A positive value finer than the clock that produced it — under half a
 * millisecond — is not a measurement of a very fast run, it is two timestamps
 * the clock could not separate. That is unknown, so it comes back null, which
 * is the one honest answer and keeps it out of every average.
 */
function roundSeconds(value) {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  if (n === 0) return 0;
  const rounded = Math.abs(n) >= 1 ? Math.round(n * 10) / 10 : Math.round(n * 1000) / 1000;
  return rounded === 0 ? null : rounded;
}

// ─── SQL builders ─────────────────────────────────────────────────────────────

/**
 * Sum of the per-step timers, in seconds. NULL when the blob holds no timers,
 * is unparseable, or adds to nothing — all of which mean "not timed", not zero.
 * json_valid() guards json_each() so one malformed legacy blob cannot abort the
 * surrounding query.
 */
function handsOnSecondsSQL(a = 'c') {
  return `(
    SELECT CASE WHEN SUM(CAST(je.value AS REAL)) > 0 THEN SUM(CAST(je.value AS REAL)) END
    FROM json_each(${a}.step_times) je WHERE json_valid(${a}.step_times)
  )`;
}

/**
 * Wall clock from start to finish, in seconds, at full precision. NULL while
 * the run is unfinished and NULL for a non-positive span (see rule 1).
 */
function elapsedSecondsSQL(a = 'c') {
  return `(
    CASE WHEN ${a}.completed_at IS NOT NULL AND ${a}.started_at IS NOT NULL
              AND (julianday(${a}.completed_at) - julianday(${a}.started_at)) > 0
         THEN (julianday(${a}.completed_at) - julianday(${a}.started_at)) * ${SECONDS_PER_DAY}
    END
  )`;
}

/** Elapsed so far on a run still open — never a "duration", always its own column. */
function elapsedSoFarSecondsSQL(a = 'c') {
  return `(
    CASE WHEN ${a}.completed_at IS NULL AND ${a}.started_at IS NOT NULL
              AND (julianday('now') - julianday(${a}.started_at)) > 0
         THEN (julianday('now') - julianday(${a}.started_at)) * ${SECONDS_PER_DAY}
    END
  )`;
}

/** The canonical run duration: hands-on when the run has it, else wall clock. */
function runSecondsSQL(a = 'c') {
  return `COALESCE(${handsOnSecondsSQL(a)}, ${elapsedSecondsSQL(a)})`;
}

/** Which measurement runSecondsSQL landed on: 'hands_on' | 'elapsed' | NULL. */
function runBasisSQL(a = 'c') {
  return `(
    CASE WHEN ${handsOnSecondsSQL(a)} IS NOT NULL THEN 'hands_on'
         WHEN ${elapsedSecondsSQL(a)} IS NOT NULL THEN 'elapsed'
    END
  )`;
}

/**
 * Average canonical run duration. NULL when no run in scope carries a
 * measurement — AVG() already skips NULLs, which is precisely the behaviour
 * rule 1 asks for, so no `?? 0` may ever be wrapped around this.
 */
function avgRunSecondsSQL(a = 'c') {
  return `AVG(${runSecondsSQL(a)})`;
}

/**
 * What the runs behind an average were measured with: 'hands_on', 'elapsed', or
 * 'mixed' when the group holds some of each. A screen showing the average needs
 * this to label it truthfully — "mixed" is a fact about the data, not a defect.
 */
function avgRunBasisSQL(a = 'c') {
  const basis = runBasisSQL(a);
  return `(CASE WHEN MIN(${basis}) = MAX(${basis}) THEN MIN(${basis})
                WHEN MIN(${basis}) IS NULL THEN NULL
                ELSE 'mixed' END)`;
}

// ─── JS twins, for rows already in memory ─────────────────────────────────────

/** Parse a step_times blob (string or object) into a seconds total, or null. */
function handsOnSecondsOf(stepTimes) {
  let parsed = stepTimes;
  if (typeof parsed === 'string') {
    try { parsed = JSON.parse(parsed); } catch { return null; }
  }
  if (!parsed || typeof parsed !== 'object') return null;
  let total = 0;
  for (const value of Object.values(parsed)) {
    const n = Number(value);
    if (Number.isFinite(n)) total += n;
  }
  return total > 0 ? total : null;
}

/**
 * SQLite hands back "YYYY-MM-DD HH:MM:SS" with no zone, which `new Date()`
 * reads as LOCAL time — a run would appear to take hours, or to finish before
 * it started, purely from the server's offset. Read it as UTC, which is how it
 * was written.
 */
function parseStoredTime(value) {
  if (!value) return null;
  const normalized = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value)
    ? `${value.replace(' ', 'T')}Z`
    : value;
  const t = Date.parse(normalized);
  return Number.isNaN(t) ? null : t;
}

function elapsedSecondsOf(startedAt, completedAt) {
  const start = parseStoredTime(startedAt);
  const end = parseStoredTime(completedAt);
  if (start === null || end === null) return null;
  const seconds = (end - start) / 1000;
  return seconds > 0 ? seconds : null;
}

function elapsedSoFarSecondsOf(startedAt, completedAt, now = Date.now()) {
  if (completedAt) return null;
  const start = parseStoredTime(startedAt);
  if (start === null) return null;
  const seconds = (now - start) / 1000;
  return seconds > 0 ? seconds : null;
}

/**
 * Every duration one completion row can honestly report, rounded once. Give it
 * a raw `completions` row (step_times may be a blob or an object).
 *
 * `duration_seconds` is the one a "Duration" column shows; `duration_basis`
 * names the measurement so the screen can label it rather than leaving a
 * customer to guess why two screens differ.
 */
function runDurations(row, now = Date.now()) {
  const handsOn = handsOnSecondsOf(row?.step_times);
  const elapsed = elapsedSecondsOf(row?.started_at, row?.completed_at);
  const duration = handsOn ?? elapsed;
  return {
    hands_on_seconds: roundSeconds(handsOn),
    elapsed_seconds: roundSeconds(elapsed),
    elapsed_so_far_seconds: roundSeconds(elapsedSoFarSecondsOf(row?.started_at, row?.completed_at, now)),
    duration_seconds: roundSeconds(duration),
    duration_basis: handsOn != null ? 'hands_on' : (elapsed != null ? 'elapsed' : null),
  };
}

/**
 * Takt for one step of an authoring blob, in seconds. v1 apps store it as
 * `takt_time`, v2 as `takt_time_seconds`; neither present means no takt was
 * ever configured, which is not the same as a takt of zero.
 */
function stepTaktSeconds(step) {
  const raw = Number(step?.takt_time_seconds ?? step?.takt_time);
  return Number.isFinite(raw) && raw > 0 ? raw : null;
}

module.exports = {
  SECONDS_PER_DAY,
  roundSeconds,
  handsOnSecondsSQL,
  elapsedSecondsSQL,
  elapsedSoFarSecondsSQL,
  runSecondsSQL,
  runBasisSQL,
  avgRunSecondsSQL,
  avgRunBasisSQL,
  handsOnSecondsOf,
  elapsedSecondsOf,
  elapsedSoFarSecondsOf,
  parseStoredTime,
  runDurations,
  stepTaktSeconds,
};

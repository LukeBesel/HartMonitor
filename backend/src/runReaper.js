'use strict';

// ─── Stale-run reaper ─────────────────────────────────────────────────────────
//
// A run row is created the moment an operator opens an app and is only closed
// when something explicitly closes it: Complete, or the Abandon button. Nothing
// closed the unclean exits — a tablet whose battery died, a browser that
// crashed, a shift that ended with the app still open, an operator who walked
// away. Those rows sit at 'in_progress' forever, so Run History shows runs that
// have been "in progress" for weeks and the completion rate on the App
// Dashboard divides by a denominator full of ghosts.
//
// ── Why twelve hours ──────────────────────────────────────────────────────────
// The rule has to satisfy two things at once: never kill a run somebody is
// still working on, and never let yesterday's leftovers count as today's work
// in progress.
//
// The clock runs on SILENCE, not on age. The player flushes the run on autosave,
// on every step change, and once more on pagehide (api.flushCompletionOnUnload),
// and each of those stamps last_activity_at. So a genuinely long job — a
// twelve-hour build, a run paused at 2pm and picked up again at 2:05 — keeps
// resetting the clock and is never a candidate. Only a run that nobody has
// touched at all is.
//
// Twelve hours of silence is longer than the longest shift anyone works in one
// stretch, so no live run can reach it; and it is short enough that a run left
// open when the evening shift walked out is closed before the morning shift
// reads its numbers. A shorter window (say two hours) would kill runs left open
// over a long lunch or a line stoppage; a longer one (twenty-four hours) leaves
// last night's ghosts in this morning's "active" count, which is the exact
// problem being fixed.
//
// ── What reaping does and does not do ─────────────────────────────────────────
// It flips status to 'abandoned' and nothing else. Every value the operator
// entered, every step time, every row in completion_values stays exactly where
// it is — the unload flush exists precisely so that partial work is banked, and
// throwing it away here would defeat it. 'abandoned' is also forced on us: the
// status column's CHECK allows exactly in_progress / completed / abandoned and
// a CHECK cannot be altered in place, so a new word would be a 500. The reason
// is recorded separately in abandoned_reason ('stale_timeout' here, 'operator'
// when a person pressed the button), which is what tells the two apart.

const db = require('./db');
const { logActivity } = require('./activity');

const STALE_AFTER_HOURS = 12;

// Runs every hour, and shortly after boot so a server that was down overnight
// catches up instead of waiting a full interval.
const SWEEP_INTERVAL_MS = 60 * 60 * 1000;
const FIRST_SWEEP_DELAY_MS = 45 * 1000;

/**
 * Closes every run that nobody has touched for STALE_AFTER_HOURS.
 *
 * Idempotent: the UPDATE only matches status = 'in_progress', so a second pass
 * over the same rows changes nothing. Tenant-safe: it is a system job that
 * spans every company by design, but it never mixes them — each row is closed
 * and logged against its own company_id, and no company's data is read into
 * another's response.
 *
 * Returns the number of runs closed.
 */
function reapStaleRuns() {
  const cutoff = `-${STALE_AFTER_HOURS} hours`;

  // Read the candidates first so each one can be logged against its own
  // company. COALESCE because last_activity_at is NULL on rows written before
  // the column existed — for those, the start time is the only signal we have.
  const stale = db.prepare(`
    SELECT id, company_id, app_id, app_name, operator_name, station_id
      FROM completions
     WHERE status = 'in_progress'
       AND COALESCE(last_activity_at, started_at) < datetime('now', ?)
  `).all(cutoff);

  if (stale.length === 0) return 0;

  const close = db.prepare(`
    UPDATE completions
       SET status = 'abandoned', abandoned_reason = 'stale_timeout'
     WHERE id = ? AND company_id = ? AND status = 'in_progress'
  `);
  // Any operator stint still open on a reaped run is closed with it, otherwise
  // the multi-operator roster keeps showing someone as being on the job.
  const closeSessions = db.prepare(`
    UPDATE completion_sessions
       SET ended_at = datetime('now')
     WHERE completion_id = ? AND company_id = ? AND ended_at IS NULL
  `);

  let closed = 0;
  for (const run of stale) {
    if (!run.company_id) continue;   // orphan row with no tenant — leave it alone
    const done = db.transaction(() => {
      const result = close.run(run.id, run.company_id);
      if (result.changes !== 1) return false;
      closeSessions.run(run.id, run.company_id);
      return true;
    })();
    if (!done) continue;
    closed++;
    try {
      logActivity(
        run.company_id, 'completion', run.id,
        `Closed an abandoned run of ${run.app_name} — no activity for over ${STALE_AFTER_HOURS} hours`,
        'System',
        { station_id: run.station_id || null },
      );
    } catch (err) {
      // The run is already closed; a missing audit line must not undo that.
      console.error('[reaper] activity log failed for', run.id, '-', err.message);
    }
  }

  if (closed > 0) console.log(`[reaper] closed ${closed} stale run(s)`);
  return closed;
}

let started = false;

/** Starts the hourly sweep. Safe to call more than once. */
function startRunReaper() {
  if (started) return;
  started = true;
  const sweep = () => {
    try { reapStaleRuns(); } catch (e) { console.error('[reaper] sweep failed:', e.message); }
  };
  // unref() so a test or script that merely requires this module is not kept
  // alive by the timers.
  setTimeout(sweep, FIRST_SWEEP_DELAY_MS).unref();
  setInterval(sweep, SWEEP_INTERVAL_MS).unref();
}

module.exports = { reapStaleRuns, startRunReaper, STALE_AFTER_HOURS };

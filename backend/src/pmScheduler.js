'use strict';

// ─── A PM that raises its own job ────────────────────────────────────────────
//
// pm_schedules only ever moved when a human opened the Maintenance screen and
// clicked "Mark Complete". Nothing watched next_due_at. So a PM that came due
// was a row in a table nobody had a reason to open: no work order, no assignee,
// nothing on anyone's list — the schedule was a reminder that reminded no one.
//
// This sweeper closes that gap. Once an hour it looks for schedules that are
// due (or due within their lead_days) and raises ONE preventive work order for
// each, linked back by pm_schedule_id and stamped raised_by = 'system'. The job
// then lives where every other job lives: the work-order queue.
//
// The three rules that keep it from becoming a spam generator:
//
//   1. ONE OPEN JOB PER SCHEDULE. The query skips any schedule that already has
//      a maintenance work order neither completed nor cancelled. So the second
//      sweep of the same due PM raises nothing, and a plant that leaves a PM
//      job open for a fortnight gets one job, not fourteen.
//   2. THE PLANT'S DAY DECIDES. Due-ness is a calendar comparison, and the
//      calendar is the plant's, not Greenwich's — plantDayShift() is bound on
//      BOTH sides. A PM due tomorrow morning must not be raised all of this
//      evening because a server in California thinks it is already tomorrow.
//   3. ONLY TIME-BASED SCHEDULES. days / weeks / months can be projected
//      forward from a date. hours and cycles cannot: they need a meter reading
//      nothing in the product records yet, so those schedules are left alone
//      and the API says why instead of returning a silent null.

const { v4: uuidv4 } = require('uuid');
const db = require('./db');
const { logActivity } = require('./activity');
const { plantDayShift } = require('./plantDay');
const { deliverWebhooks } = require('./webhooks');

/** Frequencies a due date can be computed from. hours/cycles need a meter. */
const RAISABLE_FREQUENCIES = ['days', 'weeks', 'months'];

/** Why a meter-based schedule has no next due date. One string, used by the
 *  sweeper's filter and by the API's `next_due_reason`, so the screen and the
 *  scheduler can never give two different answers about the same row. */
const METER_REASON = 'needs a meter reading';

const SWEEP_INTERVAL_MS = 60 * 60 * 1000;
const FIRST_SWEEP_DELAY_MS = 30 * 1000;

/** A work order that is still somebody's problem. */
const OPEN_WO_STATUSES = "('completed','cancelled')";

/**
 * The next MWO number for a company. Lives here rather than in the route
 * because the sweeper and the "New WO" button must not invent two different
 * numbering schemes — one definition, imported by both.
 */
function nextWONumber(companyId) {
  const year = new Date().getFullYear();
  const prefix = `MWO-${year}-`;
  // Numeric max of the trailing sequence, not a lexical ORDER BY — otherwise
  // MWO-2026-1000 sorts before MWO-2026-999 and the number collides.
  const row = db.prepare(
    `SELECT MAX(CAST(substr(wo_number, ?) AS INTEGER)) AS max_seq
       FROM maintenance_work_orders WHERE company_id = ? AND wo_number LIKE ?`
  ).get(prefix.length + 1, companyId, prefix + '%');
  const last = row && row.max_seq ? row.max_seq : 0;
  return `${prefix}${String(last + 1).padStart(3, '0')}`;
}

/** The SQL predicate for "this PM is overdue", in the plant's own day. Shared
 *  by the list, the summary tile and this sweeper so the three can never
 *  disagree about how many PMs are late. Binds the shift twice. */
const OVERDUE_SQL = "date(next_due_at, ?) < date('now', ?)";

/**
 * Schedules that should raise a job right now, for one company.
 *
 * Due-or-within-lead: `date(next_due_at) <= date('now', +lead_days)`. A PM with
 * lead_days = 0 raises on the day it is due; lead_days = 3 raises three days
 * early, which is how a plant orders a part before the machine stops.
 */
function dueSchedules(companyId) {
  const day = plantDayShift(companyId);
  return db.prepare(`
    SELECT p.*, a.name AS asset_name, a.asset_number,
           CASE WHEN ${OVERDUE_SQL.replace(/next_due_at/g, 'p.next_due_at')} THEN 1 ELSE 0 END AS is_overdue
      FROM pm_schedules p
      LEFT JOIN assets a ON a.id = p.asset_id
     WHERE p.company_id = ?
       AND p.auto_create_wo = 1
       AND p.frequency_type IN (${RAISABLE_FREQUENCIES.map(f => `'${f}'`).join(',')})
       AND p.next_due_at IS NOT NULL
       AND date(p.next_due_at, ?) <= date('now', ?, '+' || COALESCE(p.lead_days, 0) || ' days')
       AND NOT EXISTS (
             SELECT 1 FROM maintenance_work_orders w
              WHERE w.pm_schedule_id = p.id
                AND w.company_id = p.company_id
                AND w.status NOT IN ${OPEN_WO_STATUSES}
           )
     ORDER BY p.next_due_at ASC
  `).all(day, day, companyId, day, day);
}

/**
 * Raises the one work order a due schedule is owed. Returns the new row, or
 * null when another sweep beat us to it (the NOT EXISTS is re-checked inside
 * the transaction, so two sweeps racing produce one job, not two).
 */
function raiseFor(schedule) {
  const companyId = schedule.company_id;
  const now = new Date().toISOString();
  const id = uuidv4();
  const title = schedule.title;
  // An already-overdue PM is not the same job as one raised in its lead window.
  const priority = schedule.is_overdue ? 'high' : 'medium';
  const description = [
    `Raised automatically from PM schedule: ${title}.`,
    schedule.description || '',
  ].filter(Boolean).join('\n');

  const created = db.transaction(() => {
    const stillNeeded = db.prepare(`
      SELECT 1 FROM maintenance_work_orders
       WHERE pm_schedule_id = ? AND company_id = ? AND status NOT IN ${OPEN_WO_STATUSES}
    `).get(schedule.id, companyId);
    if (stillNeeded) return null;

    const wo_number = nextWONumber(companyId);
    db.prepare(`
      INSERT INTO maintenance_work_orders (
        id, company_id, number, wo_number, asset_id, type, title, description, priority,
        assigned_to, requested_by, due_date, scheduled_date, estimated_hours,
        pm_schedule_id, raised_by, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, 'preventive', ?, ?, ?, ?, 'System', ?, ?, ?, ?, 'system', ?, ?)
    `).run(
      id, companyId, wo_number, wo_number, schedule.asset_id || null, title, description, priority,
      schedule.assigned_to || '', schedule.next_due_at, schedule.next_due_at,
      schedule.estimated_hours ?? null, schedule.id, now, now,
    );
    db.prepare('UPDATE pm_schedules SET last_raised_wo_id = ?, last_raised_at = ? WHERE id = ? AND company_id = ?')
      .run(id, now, schedule.id, companyId);
    return wo_number;
  })();
  if (!created) return null;

  try {
    logActivity(
      companyId, 'maintenance', id,
      `WO ${created} raised automatically from PM: ${title}`,
      'System',
    );
  } catch (e) {
    console.error('[pm-scheduler] activity log failed for', id, '-', e.message);
  }

  const row = db.prepare(`
    SELECT m.*, a.name AS asset_name FROM maintenance_work_orders m
    LEFT JOIN assets a ON a.id = m.asset_id WHERE m.id = ?
  `).get(id);
  try {
    deliverWebhooks(companyId, 'maintenance.pm_raised', {
      work_order: row,
      pm_schedule: { id: schedule.id, title, next_due_at: schedule.next_due_at, asset_id: schedule.asset_id },
    });
  } catch (e) {
    console.error('[pm-scheduler] webhook failed:', e.message);
  }
  return row;
}

/**
 * One sweep across every company. Returns the work orders raised.
 *
 * Exported so a suite drives it directly — "raises one job on the first sweep
 * and none on the second" is the whole behaviour, and a timer cannot be asked
 * to prove it.
 */
function runOnce() {
  const companies = db.prepare(
    'SELECT DISTINCT company_id FROM pm_schedules WHERE company_id IS NOT NULL AND auto_create_wo = 1'
  ).all();
  const raised = [];
  for (const { company_id } of companies) {
    let due = [];
    try {
      due = dueSchedules(company_id);
    } catch (e) {
      console.error('[pm-scheduler] could not read schedules for', company_id, '-', e.message);
      continue;
    }
    for (const schedule of due) {
      try {
        const wo = raiseFor(schedule);
        if (wo) raised.push(wo);
      } catch (e) {
        console.error('[pm-scheduler] could not raise for schedule', schedule.id, '-', e.message);
      }
    }
  }
  if (raised.length) console.log(`[pm-scheduler] raised ${raised.length} preventive work order(s)`);
  return raised;
}

let started = false;

/**
 * Starts the hourly sweep. Safe to call more than once.
 *
 * Off under NODE_ENV=test unless PM_SWEEP_MS asks for it: a suite calls
 * runOnce() itself, and a sweeper writing work orders into a test database
 * between two assertions is a flake, not a feature.
 */
function startPmScheduler() {
  if (started) return;
  started = true;
  const configured = Number(process.env.PM_SWEEP_MS) || 0;
  if (process.env.NODE_ENV === 'test' && !configured) return;
  const every = configured > 0 ? configured : SWEEP_INTERVAL_MS;
  const sweep = () => {
    try { runOnce(); } catch (e) { console.error('[pm-scheduler] sweep failed:', e.message); }
  };
  // unref() so requiring this module never keeps a process alive.
  setTimeout(sweep, Math.min(every, FIRST_SWEEP_DELAY_MS)).unref();
  setInterval(sweep, every).unref();
}

module.exports = {
  runOnce, startPmScheduler, dueSchedules, raiseFor, nextWONumber,
  RAISABLE_FREQUENCIES, METER_REASON, OVERDUE_SQL, OPEN_WO_STATUSES,
};

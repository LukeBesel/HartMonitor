const express = require('express');
const db = require('../db');
const { plantDayShift } = require('../plantDay');
const { runSecondsSQL } = require('../cycleTime');
// finished-today, running-now and on-track come from the one module that
// defines them, so the board and the department page it links to cannot report
// different days for the same shift.
const plantTruth = require('../plantTruth');

const router = express.Router();

// ─── Helpers ──────────────────────────────────────────────────────────────────

// "Today" here has to mean the same day the Command Center, the department page
// and the TV board mean, or one tenant reads four different numbers off four
// screens for the same shift. Two things were wrong.
//
// The boundary was `datetime('now', 'start of day')`, which is midnight UTC —
// 8pm in Detroit, 5pm in California. The board reset in the middle of second
// shift and then carried the back half of the previous evening into the morning.
// It now shifts onto the plant's clock, the same modifier analytics.js and
// oee.js bind (see ../plantDay.js).
//
// And the window was measured on `started_at`, while every other screen counts a
// run on the day it FINISHED. A run begun at 23:50 and finished at 00:10 landed
// on opposite days depending on which screen you were standing in front of. The
// leaderboard is a board of finished runs — the quality clause below already
// insists on `completed_at IS NOT NULL`, and every figure it reports (best
// cycle, average cycle, last completed) is about a run that ended. So the window
// is measured on `completed_at` too.
//
// The parameter is bound, not interpolated, so each clause carries its own
// placeholder count — periodParams() keeps the two in step.
const PERIODS = {
  today: "AND date(c.completed_at, ?) = date('now', ?)",
  week:  "AND c.completed_at >= datetime('now', '-7 days')",
  month: "AND c.completed_at >= datetime('now', '-30 days')",
  all:   '',
};

/** The bindings `PERIODS[period]` expects, in order. */
function periodParams(period, day) {
  return period === 'today' ? [day, day] : [];
}

// A pile of runs that belongs to no department. Not a place, so never ranked
// against places, and never called "Unassigned" — a word that reads on the board
// as the name of a department nobody can find on the floor.
const NO_DEPARTMENT_LABEL = 'No department';

const PERIOD_LABELS = {
  today: 'Today',
  week: 'This Week',
  month: 'This Month',
  all: 'All Time',
};

// Minutes, because this board's whole payload and both screens reading it are
// in minutes — but the seconds behind it come from backend/src/cycleTime.js,
// the one place that decides how long a run took. A plant record has to be the
// same number here as it is on the run's own history page.
const CYCLE_TIME_SQL = `(${runSecondsSQL('c')} / 60.0)`;

// A completion only counts toward the leaderboard if it finished cleanly
// (status='completed') and has no quality issue (no NCR raised against it).
const QUALITY_CLAUSE = `
  c.status = 'completed' AND c.completed_at IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM ncrs n WHERE n.completion_id = c.id)
`;

// A completion attributes to a department through its work order, falling back
// to its station's department when it ran without a work order. Shared by the
// department-grouped board and the per-department drill-down.
const DEPT_JOIN = `
  LEFT JOIN work_orders wo ON wo.id = c.work_order_id
  LEFT JOIN stations    st ON st.id = c.station_id
`;
const DEPT_EXPR = 'COALESCE(wo.department_id, st.department_id)';

// ─── GET /departments — Level 1: leaderboard ranked BY DEPARTMENT ─────────────
// Each department becomes a card with aggregate stats (completions, operators,
// avg cycle, best clean run, rough throughput/day). Scoped to req.companyId.

router.get('/departments', (req, res) => {
  const cid = req.companyId;
  // hasOwn guard: a lookup like ?period=constructor would otherwise hit an
  // inherited Object.prototype member and inject "[object Object]" into the SQL.
  const period = Object.hasOwn(PERIODS, req.query.period) ? req.query.period : 'week';
  const periodFilter = PERIODS[period];
  const day = plantDayShift(cid);
  const periodArgs = periodParams(period, day);
  const periodDays = { today: 1, week: 7, month: 30, all: null }[period];

  const rows = db.prepare(`
    SELECT ${DEPT_EXPR} AS department_id,
           COUNT(*) AS completions,
           COUNT(DISTINCT c.operator_name) AS operator_count,
           ROUND(AVG(${CYCLE_TIME_SQL}), 2) AS avg_minutes,
           ROUND(MIN(${CYCLE_TIME_SQL}), 2) AS best_minutes,
           MAX(c.completed_at) AS last_completed_at,
           COUNT(DISTINCT date(c.completed_at, ?)) AS active_days
    FROM completions c
    JOIN apps a ON a.id = c.app_id
    ${DEPT_JOIN}
    WHERE c.company_id = ? AND a.status = 'published'
      AND ${QUALITY_CLAUSE} ${periodFilter}
    GROUP BY ${DEPT_EXPR}
    HAVING completions > 0
  `).all(day, cid, ...periodArgs);

  const deptInfo = db.prepare('SELECT id, name, color FROM departments WHERE company_id = ?').all(cid);
  const deptMap = Object.fromEntries(deptInfo.map(d => [d.id, d]));

  // Today's live figures per department, in one query set, from the module that
  // owns the definition of them. The board's own `completions` counts something
  // narrower on purpose — runs of a PUBLISHED app with no NCR against them, over
  // the chosen period — so `finished_today` rides alongside it rather than
  // replacing it, and the two are labelled rather than confused.
  const snapshots = plantTruth.departmentSnapshots(cid);
  const snapshotById = Object.fromEntries(snapshots.departments.map(d => [d.department_id, d]));

  function shape(r) {
    const info = r.department_id ? deptMap[r.department_id] : null;
    const span = periodDays || Math.max(1, r.active_days);
    const snap = r.department_id ? snapshotById[r.department_id] : null;
    return {
      department_id: r.department_id,
      department_name: info ? info.name : (r.department_id ? 'Unknown' : NO_DEPARTMENT_LABEL),
      department_color: info ? info.color : '#6b7280',
      completions: r.completions,
      operator_count: r.operator_count,
      avg_minutes: r.avg_minutes,
      best_minutes: r.best_minutes,
      last_completed_at: r.last_completed_at,
      throughput_per_day: Math.round((r.completions / Math.max(1, span)) * 10) / 10,
      // ── The canonical figures. Null on the no-department bucket, which is a
      // pile of runs rather than a place: it has no work orders, so it has no
      // on-track share to state and must not print 0.
      finished_today:   snap ? snap.finished_today : null,
      running_now:      snap ? snap.running_now : null,
      on_track:         snap ? snap.on_track : null,
      open_work_orders: snap ? snap.open_work_orders : null,
      on_track_pct:     snap ? snap.on_track_pct : null,
      on_track_basis:   'open_work_orders',
    };
  }

  // Most productive department first; faster average cycle breaks ties.
  const departments = rows.filter(r => r.department_id != null).map(shape);
  departments.sort((a, b) =>
    b.completions - a.completions || (a.avg_minutes ?? 1e9) - (b.avg_minutes ?? 1e9));
  departments.forEach((d, i) => { d.rank = i + 1; });

  // Runs that belong to no department are not a department, so they are not
  // ranked against departments. Sorted by output alone they took #1 on a board
  // headed by department name and read as a real place called "Unassigned" that
  // was beating every real one. They come last, with no rank and a name that
  // says what the row is.
  for (const r of rows.filter(r => r.department_id == null)) {
    departments.push({ ...shape(r), rank: null });
  }

  res.json({
    period,
    period_label: PERIOD_LABELS[period],
    generated_at: new Date().toISOString(),
    /** The day the canonical figures on each row were measured on. */
    plant_date: snapshots.plant_date,
    departments,
  });
});

// ─── GET / — leaderboards for every (app, product) combo ──────────────────────
// Optional query params (backward-compatible, scoped by req.companyId):
//   department_id — restrict to completions in one department (Level 2 drill-down)
//   app_id        — restrict to a single app/operation
router.get('/', (req, res) => {
  const cid = req.companyId;
  const period = Object.hasOwn(PERIODS, req.query.period) ? req.query.period : 'week';
  const periodFilter = PERIODS[period];
  const day = plantDayShift(cid);
  const periodArgs = periodParams(period, day);

  // Optional drill-down scoping. A department scope joins through the work
  // order / station to attribute the completion, matching the board above.
  const departmentId = req.query.department_id || null;
  const appIdFilter = req.query.app_id || null;
  const scopeJoin = departmentId ? DEPT_JOIN : '';
  const scopeClauses = [];
  const scopeParams = [];
  if (departmentId) { scopeClauses.push(`${DEPT_EXPR} = ?`); scopeParams.push(departmentId); }
  if (appIdFilter)  { scopeClauses.push('c.app_id = ?');     scopeParams.push(appIdFilter); }
  const scopeFilter = scopeClauses.length ? ' AND ' + scopeClauses.join(' AND ') : '';

  const groups = db.prepare(`
    SELECT c.app_id, a.name as app_name, c.product_type_id, pt.name as product_type_name,
           COUNT(*) as qualifying_count,
           COUNT(DISTINCT c.operator_name) as operator_count
    FROM completions c
    JOIN apps a ON a.id = c.app_id
    LEFT JOIN product_types pt ON pt.id = c.product_type_id
    ${scopeJoin}
    WHERE c.company_id = ? AND a.status = 'published'
      AND ${QUALITY_CLAUSE} ${periodFilter} ${scopeFilter}
    GROUP BY c.app_id, c.product_type_id
    HAVING qualifying_count > 0
    ORDER BY a.name ASC, pt.name ASC
  `).all(cid, ...periodArgs, ...scopeParams);

  const boards = groups.map(g => {
    const leaders = db.prepare(`
      SELECT operator_name,
             ROUND(MIN(${CYCLE_TIME_SQL}), 2) as best_minutes,
             ROUND(AVG(${CYCLE_TIME_SQL}), 2) as avg_minutes,
             COUNT(*) as completions,
             MAX(c.completed_at) as last_completed_at
      FROM completions c
      ${scopeJoin}
      WHERE c.company_id = ? AND c.app_id = ?
        AND (c.product_type_id = ? OR (c.product_type_id IS NULL AND ? IS NULL))
        AND ${QUALITY_CLAUSE} ${periodFilter} ${scopeFilter}
      GROUP BY operator_name
      ORDER BY best_minutes ASC, completions DESC
      LIMIT 10
    `).all(cid, g.app_id, g.product_type_id, g.product_type_id, ...periodArgs, ...scopeParams);

    const excluded = db.prepare(`
      SELECT COUNT(*) as c FROM completions c
      ${scopeJoin}
      WHERE c.company_id = ? AND c.app_id = ?
        AND (c.product_type_id = ? OR (c.product_type_id IS NULL AND ? IS NULL))
        AND c.status = 'completed' AND c.completed_at IS NOT NULL
        AND EXISTS (SELECT 1 FROM ncrs n WHERE n.completion_id = c.id)
        ${periodFilter} ${scopeFilter}
    `).get(cid, g.app_id, g.product_type_id, g.product_type_id, ...periodArgs, ...scopeParams).c;

    const allTimeBest = db.prepare(`
      SELECT ROUND(MIN(${CYCLE_TIME_SQL}), 2) as best
      FROM completions c
      ${scopeJoin}
      WHERE c.company_id = ? AND c.app_id = ?
        AND (c.product_type_id = ? OR (c.product_type_id IS NULL AND ? IS NULL))
        AND ${QUALITY_CLAUSE} ${scopeFilter}
    `).get(cid, g.app_id, g.product_type_id, g.product_type_id, ...scopeParams).best;

    return {
      app_id: g.app_id,
      app_name: g.app_name,
      product_type_id: g.product_type_id,
      product_type_name: g.product_type_name,
      qualifying_count: g.qualifying_count,
      operator_count: g.operator_count,
      excluded_quality_count: excluded,
      all_time_best_minutes: allTimeBest,
      leaders: leaders.map((l, i) => ({
        rank: i + 1,
        operator_name: l.operator_name,
        best_minutes: l.best_minutes,
        avg_minutes: l.avg_minutes,
        completions: l.completions,
        last_completed_at: l.last_completed_at,
        is_record: allTimeBest != null && l.best_minutes <= allTimeBest,
      })),
    };
  });

  // Distinct apps (operations) present in this scope — drives the Level 2
  // operation/app dropdown. Ignores the app_id filter so the picker keeps every
  // option available even after one is chosen.
  const appScopeJoin = departmentId ? DEPT_JOIN : '';
  const appScopeFilter = departmentId ? ` AND ${DEPT_EXPR} = ?` : '';
  const appScopeParams = departmentId ? [departmentId] : [];
  const apps = db.prepare(`
    SELECT DISTINCT c.app_id, a.name AS app_name
    FROM completions c
    JOIN apps a ON a.id = c.app_id
    ${appScopeJoin}
    WHERE c.company_id = ? AND a.status = 'published'
      AND ${QUALITY_CLAUSE} ${periodFilter} ${appScopeFilter}
    ORDER BY a.name ASC
  `).all(cid, ...periodArgs, ...appScopeParams);

  res.json({
    period,
    period_label: PERIOD_LABELS[period],
    generated_at: new Date().toISOString(),
    department_id: departmentId,
    app_id: appIdFilter,
    apps,
    boards,
  });
});

module.exports = router;

'use strict';

// ─── One definition of "today" ────────────────────────────────────────────────
//
// The same company, read at the same minute, used to report three different
// plants. The Command Center said "62 finished today / 67% of work orders on
// track", Manager View said "1 active / 33% on track", and the department
// drill-down said "2 of 3 on track". Nobody was lying on purpose: "finished
// today", "running now", "average cycle", "pass rate" and "on track" were each
// re-derived, slightly differently, on about a dozen screens — and one of them
// counted the day off the tablet's own browser clock.
//
// This module is the single server-side answer. Every screen that reports one
// of those five numbers reads it from here, so two screens can disagree only if
// they are deliberately asking different questions (a 7-day pass rate is not
// the same question as today's), and when they do, the window is a parameter
// here rather than arithmetic copied into a route.
//
// THE FIVE RULES it enforces:
//
//   1. The day is the PLANT'S day. Every "today" comparison binds the modifier
//      from plantDay.js to BOTH sides — `date(completed_at, ?) = date('now', ?)`
//      — so a second-shift crew's counters do not reset at 8pm Detroit time.
//      `plant_date` rides on every answer so a screen can print the day it is
//      actually reporting instead of guessing.
//
//   2. Unknown is NULL, never 0, and every number carries its sample. A plant
//      that has inspected nothing has no pass rate — 0% reads as "everything
//      failed". A plant with no open work orders has no on-track percentage —
//      0% reads as "everything is late". Each null ships with a sibling reason
//      string the screen can print instead of a dash nobody can interpret.
//
//      Counts stay counts: `finished_today: 0` means zero runs finished, which
//      is a measurement. The RATES (`avg_cycle_seconds`, `pass_rate`,
//      `on_track_pct`) are the ones that go null, next to the sample that made
//      them null.
//
//   3. "On track" is imported, never re-implemented. calcScheduleStatus lives
//      in routes/workorders.js and there is exactly one of it. It is required
//      lazily inside the function that uses it so this module can never form a
//      require cycle with the router layer.
//
//   4. Durations come from cycleTime.js, the one place that decides how long a
//      run took, and are rounded exactly once on the way out.
//
//   5. A scope is either valid or empty — never widened. A department, site,
//      app or station id belonging to another company resolves to an empty
//      scope: every count is 0, every rate is null, and no name from the other
//      tenant can appear in the answer.
//
// ATTRIBUTION (unchanged from the queries this replaces): a completion belongs
// to its work order's department, falling back to its station's department when
// it ran without a work order. A completion with neither belongs to no
// department and appears only in the plant-wide view. A record with no SITE
// belongs to the whole company and stays visible under every site — otherwise
// picking the auto-created primary site empties the page for the many companies
// that never used sites.

const db = require('./db');
const { plantDayShift, plantToday, companyTimeZone } = require('./plantDay');
const {
  avgRunSecondsSQL, avgRunBasisSQL, runSecondsSQL, roundSeconds,
} = require('./cycleTime');

// ─── Reasons ──────────────────────────────────────────────────────────────────
// What a screen prints where a number would be. "—" with no explanation is how
// a missing measurement gets mistaken for a bad one.

const REASONS = {
  avg_cycle: 'no run has finished yet',
  pass_rate: 'no pass/fail result recorded yet',
  on_track: 'no open work order to be on track with',
};

// ─── Scope ────────────────────────────────────────────────────────────────────

/** Does this id exist in THIS company? Returns the id, or null. */
function ownedId(table, id, companyId) {
  if (!id) return null;
  const row = db.prepare(`SELECT id FROM ${table} WHERE id = ? AND company_id = ?`).get(id, companyId);
  return row ? row.id : null;
}

/**
 * Turn the filter a screen asked for into a scope this module can answer.
 *
 * An id belonging to another company (or to nothing at all) does not widen the
 * answer and does not 404 — it makes the scope EMPTY, so every number comes
 * back 0/null and no name from the other tenant is ever read, let alone
 * returned. `valid: false` says so on the payload.
 */
function resolveScope(companyId, opts = {}) {
  const {
    siteId = null, departmentId = null, appId = null,
    stationId = null, productTypeId = null,
  } = opts;

  const scope = {
    site_id: null,
    department_id: null,
    app_id: null,
    station_id: null,
    product_type_id: productTypeId || null,
    /** The department the WORK-ORDER side is scoped to (a station's, when the
     *  caller scoped by station). Work orders have no station of their own. */
    work_order_department_id: null,
    /** False when the work-order side of the answer has nothing to select. */
    work_orders_valid: true,
    valid: true,
  };

  if (departmentId) {
    scope.department_id = ownedId('departments', departmentId, companyId);
    if (!scope.department_id) scope.valid = false;
    scope.work_order_department_id = scope.department_id;
  }
  if (siteId) {
    scope.site_id = ownedId('sites', siteId, companyId);
    if (!scope.site_id) scope.valid = false;
  }
  if (appId) {
    scope.app_id = ownedId('apps', appId, companyId);
    if (!scope.app_id) scope.valid = false;
  }
  if (stationId) {
    const station = db.prepare('SELECT id, department_id FROM stations WHERE id = ? AND company_id = ?')
      .get(stationId, companyId);
    if (!station) {
      scope.valid = false;
    } else {
      scope.station_id = station.id;
      // A station's work orders are its department's. A station in no
      // department has no work-order scope at all — reporting the whole
      // plant's on-track figure under one station's name would be a lie.
      if (!scope.work_order_department_id) {
        if (station.department_id) scope.work_order_department_id = station.department_id;
        else scope.work_orders_valid = false;
      }
    }
  }
  return scope;
}

/**
 * The scope of ONE station whose row is already in hand.
 *
 * Skips the ownership lookup because the caller has already selected the row
 * with `company_id = ?` — the per-station OEE loop would otherwise pay for one
 * extra query per station on the busiest read in the product.
 */
function stationScope(station) {
  return {
    site_id: null,
    department_id: null,
    app_id: null,
    product_type_id: null,
    station_id: station.id,
    // A station's work orders are its department's; a station in no department
    // has none of its own and must not borrow the whole plant's.
    work_order_department_id: station.department_id || null,
    work_orders_valid: !!station.department_id,
    valid: true,
  };
}

/** The scope a request asked for, read from the query string. */
function scopeFromQuery(req, extra = {}) {
  return resolveScope(req.companyId, {
    siteId: req.query.site_id,
    departmentId: req.query.department_id,
    appId: req.query.app_id,
    productTypeId: req.query.product_type_id,
    ...extra,
  });
}

// ─── Completion-side SQL ──────────────────────────────────────────────────────

// Both joins are always present because both dimensions fall back through them
// (department: work order → station; site: work order → station).
const COMPLETIONS_FROM = `
  FROM completions c
  LEFT JOIN work_orders wo ON wo.id = c.work_order_id
  LEFT JOIN stations    st ON st.id = c.station_id
`;

function completionWhere(companyId, scope) {
  const clauses = ['c.company_id = ?'];
  const params = [companyId];
  // An id from another tenant selects nothing rather than everything.
  if (!scope.valid) clauses.push('1 = 0');
  if (scope.department_id) {
    clauses.push('COALESCE(wo.department_id, st.department_id) = ?');
    params.push(scope.department_id);
  }
  if (scope.site_id) {
    clauses.push('(COALESCE(wo.site_id, st.site_id) = ? OR COALESCE(wo.site_id, st.site_id) IS NULL)');
    params.push(scope.site_id);
  }
  if (scope.app_id)          { clauses.push('c.app_id = ?');          params.push(scope.app_id); }
  if (scope.product_type_id) { clauses.push('c.product_type_id = ?'); params.push(scope.product_type_id); }
  if (scope.station_id)      { clauses.push('c.station_id = ?');      params.push(scope.station_id); }
  return { sql: clauses.join(' AND '), params };
}

/**
 * The measurement window for the metrics that have one.
 *
 *   'today' — the plant's day, bound on both sides (rule 1).
 *   '7d'    — a rolling week, what the floor screens have always shown.
 *   'all'   — everything the company has ever recorded.
 *
 * It is a parameter rather than a constant because "today's pass rate" and
 * "this month's pass rate" are different QUESTIONS, not disagreeing answers.
 * What must never differ is how either one is computed, which is why they are
 * both computed here.
 */
function windowClause(window, column, day) {
  if (window === 'today') return { sql: ` AND date(${column}, ?) = date('now', ?)`, params: [day, day] };
  if (window === '7d')    return { sql: ` AND ${column} >= datetime('now', '-7 days')`, params: [] };
  if (window === '30d')   return { sql: ` AND ${column} >= datetime('now', '-30 days')`, params: [] };
  return { sql: '', params: [] };
}

// ─── The five numbers ─────────────────────────────────────────────────────────

/** Runs that FINISHED on the plant's own calendar day. */
function finishedToday(companyId, scope, day = plantDayShift(companyId)) {
  const w = completionWhere(companyId, scope);
  return db.prepare(`
    SELECT COUNT(*) AS n ${COMPLETIONS_FROM}
    WHERE ${w.sql} AND c.status = 'completed' AND date(c.completed_at, ?) = date('now', ?)
  `).get(...w.params, day, day).n;
}

/** Runs open on the floor at this instant. Not a day measure — a live one. */
function runningNow(companyId, scope) {
  const w = completionWhere(companyId, scope);
  return db.prepare(`
    SELECT COUNT(*) AS n ${COMPLETIONS_FROM} WHERE ${w.sql} AND c.status = 'in_progress'
  `).get(...w.params).n;
}

/**
 * Average canonical run duration over the runs that carry a measurement.
 *
 * `sample` is how many runs that was. Zero means nobody has finished a timed
 * run in this scope and window — so `seconds` is null, never 0, and `reason`
 * says why. `basis` labels what the average was measured with ('hands_on',
 * 'elapsed' or 'mixed'), because a screen showing the number has to say.
 */
function avgCycle(companyId, scope, window = 'all', day = plantDayShift(companyId)) {
  const w = completionWhere(companyId, scope);
  const win = windowClause(window, 'c.completed_at', day);
  const row = db.prepare(`
    SELECT ${avgRunSecondsSQL('c')} AS avg_seconds,
           ${avgRunBasisSQL('c')}   AS basis,
           COUNT(${runSecondsSQL('c')}) AS sample
    ${COMPLETIONS_FROM}
    WHERE ${w.sql} AND c.status = 'completed' AND c.completed_at IS NOT NULL${win.sql}
  `).get(...w.params, ...win.params);

  const sample = row?.sample || 0;
  const raw = sample > 0 ? row.avg_seconds : null;
  const seconds = roundSeconds(raw);
  return {
    /** Rounded once, on the way out. Null when nothing was measured. */
    seconds,
    /** Full precision, for a caller that needs to convert (e.g. to minutes). */
    raw,
    basis: sample > 0 ? (row.basis ?? null) : null,
    sample,
    reason: sample > 0 ? null : REASONS.avg_cycle,
  };
}

/**
 * Pass rate over the runs that actually recorded a verdict.
 *
 * A run with no Pass/Fail step was never inspected, so it is not in the
 * denominator — counting it as good is how a plant that inspects nothing
 * reports 100% quality. A run carrying both counts once, as a fail.
 *
 * The blob is parsed rather than queried so one malformed legacy `data` value
 * cannot 500 the page a supervisor is reading; an unreadable blob is simply an
 * uninspected run.
 */
function passRate(companyId, scope, window = 'today', day = plantDayShift(companyId)) {
  const w = completionWhere(companyId, scope);
  const win = windowClause(window, 'c.completed_at', day);
  const rows = db.prepare(`
    SELECT c.data AS data ${COMPLETIONS_FROM}
    WHERE ${w.sql} AND c.status = 'completed'${win.sql}
  `).all(...w.params, ...win.params);

  let pass = 0, fail = 0;
  for (const row of rows) {
    let values;
    try { values = Object.values(JSON.parse(row.data || '{}')); } catch { continue; }
    if (values.some(v => v === 'Fail')) fail++;
    else if (values.some(v => v === 'Pass')) pass++;
  }
  const sample = pass + fail;
  return {
    rate: sample > 0 ? Math.round((pass / sample) * 100) : null,
    sample,
    pass,
    fail,
    reason: sample > 0 ? null : REASONS.pass_rate,
  };
}

// ─── Work-order side: the one "on track" rule ─────────────────────────────────

const WORK_ORDER_SELECT = `
  SELECT wo.*, d.name AS department_name, d.color AS department_color, a.name AS app_name
  FROM work_orders wo
  LEFT JOIN departments d ON d.id = wo.department_id
  LEFT JOIN apps        a ON a.id = wo.app_id
`;

function workOrderWhere(companyId, scope) {
  const clauses = ['wo.company_id = ?', "wo.status != 'cancelled'"];
  const params = [companyId];
  if (!scope.valid || !scope.work_orders_valid) clauses.push('1 = 0');
  if (scope.work_order_department_id) { clauses.push('wo.department_id = ?'); params.push(scope.work_order_department_id); }
  if (scope.app_id)                   { clauses.push('wo.app_id = ?');        params.push(scope.app_id); }
  // A work order with no site is not ambiguous, it simply predates sites, so it
  // stays visible under every one.
  if (scope.site_id) { clauses.push('(wo.site_id = ? OR wo.site_id IS NULL)'); params.push(scope.site_id); }
  return { sql: clauses.join(' AND '), params };
}

/**
 * The single on-track rule, imported.
 *
 * calcScheduleStatus is defined once, in routes/workorders.js, and this module
 * requires it LAZILY: a top-level require would make plantTruth depend on the
 * router layer at load time, and the routers depend on plantTruth. A cycle
 * there does not fail loudly — it hands one side a half-built module and the
 * function comes back `undefined` on whichever require happens to run first.
 */
function scheduleStatusOf(wo) {
  const { calcScheduleStatus } = require('./routes/workorders');
  return calcScheduleStatus(wo);
}

/** Tally a set of already-statused work orders into the canonical counts. */
function tallyWorkOrders(rows) {
  const counts = { on_track: 0, at_risk: 0, behind: 0, overdue: 0, not_started: 0, completed: 0 };
  for (const wo of rows) {
    if (counts[wo.schedule_status] !== undefined) counts[wo.schedule_status]++;
    else counts.behind++;
  }
  const total = rows.length;
  const open = total - counts.completed;
  return {
    counts,
    total_work_orders: total,
    /** The denominator "on track" is a share OF. A finished order is not
     *  something you can still be on track with. */
    open_work_orders: open,
    on_track: counts.on_track,
    at_risk: counts.at_risk,
    behind: counts.behind,
    overdue: counts.overdue,
    not_started: counts.not_started,
    completed_work_orders: counts.completed,
    /** Null, not 0%, when there is nothing open — 0% reads as "all late". */
    on_track_pct: open > 0 ? Math.round((counts.on_track / open) * 100) : null,
    on_track_reason: open > 0 ? null : REASONS.on_track,
    /** The older, wider share the floor screens already print: on-track OR
     *  already finished, over every non-cancelled order. Kept here so the two
     *  are computed in one place and each screen can say which it shows. */
    adherence_pct: total > 0 ? Math.round(((counts.on_track + counts.completed) / total) * 100) : null,
  };
}

/**
 * Every non-cancelled work order in scope, each carrying its schedule status,
 * plus the canonical tally. Callers that need the rows (alerts, tables) and the
 * counts get both from one query instead of counting them a second way.
 */
function workOrderStates(companyId, scope) {
  const w = workOrderWhere(companyId, scope);
  const rows = db.prepare(`${WORK_ORDER_SELECT} WHERE ${w.sql}`).all(...w.params).map(wo => ({
    ...wo,
    schedule_status: scheduleStatusOf(wo),
    completion_pct: wo.quantity > 0 ? Math.round((wo.quantity_completed / wo.quantity) * 100) : 0,
  }));
  return { rows, ...tallyWorkOrders(rows) };
}

// ─── The snapshot ─────────────────────────────────────────────────────────────

/**
 * The plant's true state, for the plant's own day, in one answer.
 *
 * Optional scope: { siteId, departmentId, appId } (plus stationId /
 * productTypeId for the drill-downs). An id from another company yields an
 * empty scope — zeros, nulls and no name.
 */
function floorSnapshot(companyId, opts = {}) {
  return snapshotOf(companyId, resolveScope(companyId, opts));
}

/**
 * The snapshot for a scope that has already been resolved — what a route uses
 * when it needs the scope for something else as well (the work-order rows, say)
 * and must not resolve it twice.
 */
function snapshotOf(companyId, scope) {
  const day = plantDayShift(companyId);

  const cycle = avgCycle(companyId, scope, 'today', day);
  const quality = passRate(companyId, scope, 'today', day);
  const wos = workOrderStates(companyId, scope);

  return {
    /** The calendar date at the plant right now — what "today" means here. */
    plant_date: plantToday(companyId),
    /** The zone that date was computed in. 'UTC' when the company set none. */
    timezone: companyTimeZone(companyId) || 'UTC',

    finished_today: finishedToday(companyId, scope, day),
    running_now: runningNow(companyId, scope),

    avg_cycle_seconds: cycle.seconds,
    avg_cycle_basis: cycle.basis,
    avg_cycle_sample: cycle.sample,
    avg_cycle_reason: cycle.reason,

    pass_rate: quality.rate,
    pass_rate_sample: quality.sample,
    pass_rate_reason: quality.reason,
    pass_rate_pass: quality.pass,
    pass_rate_fail: quality.fail,

    open_work_orders: wos.open_work_orders,
    on_track: wos.on_track,
    at_risk: wos.at_risk,
    behind: wos.behind,
    overdue: wos.overdue,
    not_started: wos.not_started,
    completed_work_orders: wos.completed_work_orders,
    total_work_orders: wos.total_work_orders,
    on_track_pct: wos.on_track_pct,
    on_track_reason: wos.on_track_reason,
    /** What the on-track counts are a share of. Named so a screen cannot
     *  quietly print them over a different denominator. */
    on_track_basis: 'open_work_orders',

    /** Echoed so a client can prove what the server actually applied. */
    scope: {
      site_id: scope.site_id,
      department_id: scope.department_id,
      app_id: scope.app_id,
      station_id: scope.station_id,
      valid: scope.valid,
    },
  };
}

// ─── Every department, in one query set ───────────────────────────────────────

/** Group rows by a key column into a plain lookup. */
function indexBy(rows, key = 'dept_id') {
  const out = {};
  for (const row of rows) if (row[key] != null) out[row[key]] = row;
  return out;
}

/**
 * The same snapshot, per department, for a whole site — computed in a fixed
 * number of queries rather than one set per department.
 *
 * opts: { siteId, departmentId, appId, productTypeId, cycleWindow, passWindow }.
 * The two windows default to 'today'; a caller whose screen has always shown a
 * wider average says so rather than quietly getting a different number.
 *
 * The department list used to cost four queries per card and the Command
 * Center's department strip cost two more; a plant with thirty departments paid
 * for a hundred and eighty round trips to draw one screen.
 */
function departmentSnapshots(companyId, opts = {}) {
  const scope = resolveScope(companyId, opts);
  const day = plantDayShift(companyId);
  // The measured metrics take a window for the same reason the single snapshot
  // does: "today's average" and "this department's average ever" are different
  // questions. Both default to today, which is what a floor screen means.
  const cycleWindow = opts.cycleWindow || 'today';
  const passWindow = opts.passWindow || 'today';
  const cycleWin = windowClause(cycleWindow, 'c.completed_at', day);
  const passWin = windowClause(passWindow, 'c.completed_at', day);
  const plantDate = plantToday(companyId);
  const timezone = companyTimeZone(companyId) || 'UTC';

  // Scoping the page to one department narrows this list to that one card —
  // showing six cards under a one-department filter would contradict every
  // other number on the screen.
  const deptSql = `SELECT id, name, color FROM departments WHERE company_id = ?`
    + (scope.site_id ? ' AND (site_id = ? OR site_id IS NULL)' : '')
    + (scope.department_id ? ' AND id = ?' : '')
    + ' ORDER BY name';
  const departments = scope.valid
    ? db.prepare(deptSql).all(
      companyId,
      ...(scope.site_id ? [scope.site_id] : []),
      ...(scope.department_id ? [scope.department_id] : []),
    )
    : [];

  const w = completionWhere(companyId, scope);
  const DEPT = 'COALESCE(wo.department_id, st.department_id)';

  // 1 — finished today, per department.
  const finished = indexBy(db.prepare(`
    SELECT ${DEPT} AS dept_id, COUNT(*) AS n ${COMPLETIONS_FROM}
    WHERE ${w.sql} AND c.status = 'completed' AND date(c.completed_at, ?) = date('now', ?)
    GROUP BY ${DEPT}
  `).all(...w.params, day, day));

  // 2 — running now, per department.
  const running = indexBy(db.prepare(`
    SELECT ${DEPT} AS dept_id, COUNT(*) AS n ${COMPLETIONS_FROM}
    WHERE ${w.sql} AND c.status = 'in_progress'
    GROUP BY ${DEPT}
  `).all(...w.params));

  // 3 — the average cycle for the requested window, per department.
  const cycles = indexBy(db.prepare(`
    SELECT ${DEPT} AS dept_id,
           ${avgRunSecondsSQL('c')} AS avg_seconds,
           ${avgRunBasisSQL('c')}   AS basis,
           COUNT(${runSecondsSQL('c')}) AS sample
    ${COMPLETIONS_FROM}
    WHERE ${w.sql} AND c.status = 'completed' AND c.completed_at IS NOT NULL${cycleWin.sql}
    GROUP BY ${DEPT}
  `).all(...w.params, ...cycleWin.params));

  // 4 — the verdicts for the requested window, per department (parsed here,
  //     under the same rule as passRate()).
  const verdicts = {};
  for (const row of db.prepare(`
    SELECT ${DEPT} AS dept_id, c.data AS data ${COMPLETIONS_FROM}
    WHERE ${w.sql} AND c.status = 'completed'${passWin.sql}
  `).all(...w.params, ...passWin.params)) {
    if (row.dept_id == null) continue;
    let values;
    try { values = Object.values(JSON.parse(row.data || '{}')); } catch { continue; }
    const bucket = (verdicts[row.dept_id] ??= { pass: 0, fail: 0 });
    if (values.some(v => v === 'Fail')) bucket.fail++;
    else if (values.some(v => v === 'Pass')) bucket.pass++;
  }

  // 5 — every work order in scope, statused once and grouped in memory.
  const woRows = workOrderStates(companyId, scope).rows;
  const woByDept = {};
  for (const wo of woRows) {
    if (!wo.department_id) continue;   // no department ⇒ no department's card
    (woByDept[wo.department_id] ??= []).push(wo);
  }

  return {
    plant_date: plantDate,
    timezone,
    departments: departments.map(dept => {
      const cycle = cycles[dept.id];
      const cycleSample = cycle?.sample || 0;
      const cycleRaw = cycleSample > 0 ? cycle.avg_seconds : null;
      const verdict = verdicts[dept.id] || { pass: 0, fail: 0 };
      const qcSample = verdict.pass + verdict.fail;
      const tally = tallyWorkOrders(woByDept[dept.id] || []);

      return {
        department_id: dept.id,
        department_name: dept.name,
        department_color: dept.color,
        plant_date: plantDate,
        timezone,

        finished_today: finished[dept.id]?.n || 0,
        running_now: running[dept.id]?.n || 0,

        avg_cycle_seconds: roundSeconds(cycleRaw),
        /** Full precision, for a caller converting to another unit. Rounding a
         *  rounded number is how the Command Center once turned 3.2 s into 6 s. */
        avg_cycle_seconds_raw: cycleRaw,
        avg_cycle_basis: cycleSample > 0 ? (cycle.basis ?? null) : null,
        avg_cycle_sample: cycleSample,
        avg_cycle_reason: cycleSample > 0 ? null : REASONS.avg_cycle,

        pass_rate: qcSample > 0 ? Math.round((verdict.pass / qcSample) * 100) : null,
        pass_rate_sample: qcSample,
        pass_rate_reason: qcSample > 0 ? null : REASONS.pass_rate,
        pass_rate_pass: verdict.pass,
        pass_rate_fail: verdict.fail,

        open_work_orders: tally.open_work_orders,
        on_track: tally.on_track,
        at_risk: tally.at_risk,
        behind: tally.behind,
        overdue: tally.overdue,
        not_started: tally.not_started,
        completed_work_orders: tally.completed_work_orders,
        total_work_orders: tally.total_work_orders,
        on_track_pct: tally.on_track_pct,
        on_track_reason: tally.on_track_reason,
        on_track_basis: 'open_work_orders',
      };
    }),
    scope: { site_id: scope.site_id, valid: scope.valid },
  };
}

module.exports = {
  REASONS,
  resolveScope,
  stationScope,
  scopeFromQuery,
  finishedToday,
  runningNow,
  avgCycle,
  passRate,
  workOrderStates,
  tallyWorkOrders,
  floorSnapshot,
  snapshotOf,
  departmentSnapshots,
};

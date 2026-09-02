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
// here — and named on the payload — rather than arithmetic copied into a route.
//
// THE FIVE RULES it enforces:
//
//   1. The day is the PLANT'S day. Every "today" comparison binds the modifier
//      from plantDay.js to BOTH sides — `date(completed_at, ?) = date('now', ?)`
//      — so a second-shift crew's counters do not reset at 8pm Detroit time.
//      `plant_date` rides on every answer so a screen can print the day it is
//      actually reporting instead of guessing. The day, the date and the zone
//      are resolved ONCE per request into a context (see plantContext) and
//      threaded through every query, rather than each query re-reading the
//      company's timezone setting for itself.
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
//      app, station or product type belonging to another company resolves to an
//      empty scope: every count is 0, every rate is null, and no name from the
//      other tenant can appear in the answer.
//
// ATTRIBUTION (one rule, written once, exported so the routers share it rather
// than each keeping their own copy):
//
//   department — a completion belongs to its work order's department, falling
//                back to its station's department when it ran without a work
//                order. A completion with neither belongs to no department and
//                appears only in the plant-wide view.
//   site       — the same fallback: the work order's site, else the station's.
//                A record whose effective site is NULL belongs to the whole
//                company and stays visible under every site, so picking the
//                auto-created primary site never empties the page for the many
//                companies that never used sites. A record belonging to a
//                DIFFERENT site is excluded.

const db = require('./db');
// plantDay.js owns the plant's day. This module reads the company's zone and
// the offset from it and resolves both derived values ONCE per request (see
// plantContext); test/plant-truth.test.js asserts the result equals
// plantDayShift() and plantToday() on every run, so the definition stays there.
const { companyTimeZone, offsetMinutes } = require('./plantDay');
const {
  avgRunSecondsSQL, avgRunBasisSQL, runSecondsSQL, roundSeconds,
} = require('./cycleTime');
// Where a released job STANDS is workOrderOperations' answer and nobody else's.
// Required at the top, not lazily: that module reads db.js and vocab.js only, so
// there is no cycle to break — unlike routes/workorders.js below, which requires
// this file back.
const woOps = require('./workOrderOperations');

// ─── Reasons ──────────────────────────────────────────────────────────────────
// What a screen prints where a number would be. "—" with no explanation is how
// a missing measurement gets mistaken for a bad one.

const REASONS = {
  avg_cycle: 'no run has finished yet',
  pass_rate: 'no pass/fail result recorded yet',
  on_track: 'no open work order to be on track with',
  no_operator: 'no operator on this request',
};

/** The measurement windows a caller may ask for. Named on every payload. */
const WINDOWS = ['today', '7d', '30d', 'all'];

// ─── The plant's day, resolved once ───────────────────────────────────────────

/**
 * The day context for ONE request: the SQL modifier, the calendar date and the
 * zone, resolved together and threaded through every query below.
 *
 * It exists because the alternative is what this file replaced: eight or ten
 * calls to plantDayShift()/plantToday() per request, each of which re-reads the
 * company's timezone out of org_settings, and any one of which could be reading
 * a different instant from its neighbours — which is precisely how a screen
 * ends up with two "todays" on it.
 *
 * The values still come from plantDay.js. This resolves them; it does not
 * redefine them.
 */
function plantContext(companyId, at = new Date()) {
  // ONE read of the company's zone, and one offset computed from it, rather
  // than a settings read per figure on the page. plantDayShift() and
  // plantToday() each re-read org_settings internally, which is fine once and
  // wasteful eight times — and, worse, two of those reads can straddle midnight
  // and put two different "todays" on one screen.
  //
  // The two values below are plantDay's, not new rules: the modifier is
  // plantDayShift's, the date is plantToday's, and test/plant-truth.test.js
  // asserts this context equals BOTH on every run, so neither can drift.
  const timeZone = companyTimeZone(companyId);
  const minutes = offsetMinutes(timeZone, at);
  return {
    company_id: companyId,
    at,
    /** e.g. '-240 minutes' — bind to BOTH sides of a day comparison. */
    day: `${minutes >= 0 ? '+' : '-'}${Math.abs(minutes)} minutes`,
    /** 'YYYY-MM-DD' at the plant right now. */
    plant_date: new Date(at.getTime() + minutes * 60000).toISOString().slice(0, 10),
    /** The zone the two above were computed in; 'UTC' when none is set. */
    timezone: timeZone || 'UTC',
  };
}

/** Accept either a context or a bare company id, so call sites stay readable. */
function asContext(ctxOrCompanyId) {
  if (ctxOrCompanyId && typeof ctxOrCompanyId === 'object' && ctxOrCompanyId.day) return ctxOrCompanyId;
  return plantContext(ctxOrCompanyId);
}

// ─── Scope ────────────────────────────────────────────────────────────────────

/**
 * Express hands back an ARRAY when a parameter is repeated — `?site_id=1&site_id=2`
 * arrives as ['1','2']. Bound straight into a statement that is a 500 ("Too many
 * parameter values"), which is a crash a caller can trigger from the address
 * bar. Take the first value and carry on: a repeated filter is a malformed
 * request, not a server fault.
 */
function one(value) {
  const v = Array.isArray(value) ? value[0] : value;
  return typeof v === 'string' || typeof v === 'number' ? String(v) : null;
}

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
 * returned. `valid: false` says so on the payload, and the routes that carry
 * lists as well as counts empty those too.
 */
function resolveScope(ctxOrCompanyId, opts = {}) {
  const companyId = typeof ctxOrCompanyId === 'string' ? ctxOrCompanyId : ctxOrCompanyId.company_id;

  const siteId = one(opts.siteId);
  const departmentId = one(opts.departmentId);
  const appId = one(opts.appId);
  const stationId = one(opts.stationId);
  const productTypeId = one(opts.productTypeId);

  const scope = {
    site_id: null,
    department_id: null,
    app_id: null,
    station_id: null,
    product_type_id: null,
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
  if (productTypeId) {
    scope.product_type_id = ownedId('product_types', productTypeId, companyId);
    if (!scope.product_type_id) scope.valid = false;
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

// ─── Attribution SQL, shared with the routers ─────────────────────────────────

/**
 * A completion's SITE, written without depending on any join, so the same rule
 * can be spliced into a query that has the work-order/station joins and one
 * that does not. `p` is the qualifier for the `completions` columns ('c.',
 * 'completions.' or '').
 *
 * This is the ONE site rule. analytics.js used to carry a second one that
 * differed in a single case — a completion whose work order has no site but
 * whose station belongs to ANOTHER site — so the Command Center's KPI strip and
 * its throughput chart could disagree about whether that run was on this site.
 * The rule below is the fallback rule stated everywhere else in the product:
 * the work order's site, else the station's, and only a genuinely site-less
 * record belongs to every site.
 */
function siteCompletionClause(p = '') {
  return `(
    ${p}work_order_id IN (SELECT id FROM work_orders WHERE company_id = ? AND site_id = ?)
    OR (
      (${p}work_order_id IS NULL
       OR ${p}work_order_id NOT IN (SELECT id FROM work_orders WHERE company_id = ? AND site_id IS NOT NULL))
      AND (
        ${p}station_id IS NULL
        OR ${p}station_id IN (SELECT id FROM stations WHERE company_id = ? AND (site_id = ? OR site_id IS NULL))
      )
    )
  )`;
}

/** The bindings siteCompletionClause() expects, in order. */
function siteCompletionParams(companyId, siteId) {
  return [
    companyId, siteId,   // the work order's own site
    companyId,           // …unless that work order has one at all
    companyId, siteId,   // …then fall back to the station's
  ];
}

/**
 * A completion's DEPARTMENT, same fallback, same alias-agnostic shape: the work
 * order's department, else the station's.
 */
function departmentCompletionClause(p = '') {
  return `(
    ${p}work_order_id IN (SELECT id FROM work_orders WHERE company_id = ? AND department_id = ?)
    OR (
      (${p}work_order_id IS NULL
       OR ${p}work_order_id NOT IN (SELECT id FROM work_orders WHERE company_id = ? AND department_id IS NOT NULL))
      AND ${p}station_id IN (SELECT id FROM stations WHERE company_id = ? AND department_id = ?)
    )
  )`;
}

/** The bindings departmentCompletionClause() expects, in order. */
function departmentCompletionParams(companyId, departmentId) {
  return [companyId, departmentId, companyId, companyId, departmentId];
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
 *   '30d'   — a rolling month.
 *   'all'   — everything the company has ever recorded.
 *
 * It is a parameter rather than a constant because "today's pass rate" and
 * "this month's pass rate" are different QUESTIONS, not disagreeing answers.
 * What must never differ is how either one is computed, which is why they are
 * both computed here — and every payload names the window it used, so a reader
 * never has to guess which question a tile answered.
 */
function windowClause(window, column, day) {
  if (window === 'today') return { sql: ` AND date(${column}, ?) = date('now', ?)`, params: [day, day] };
  if (window === '7d')    return { sql: ` AND ${column} >= datetime('now', '-7 days')`, params: [] };
  if (window === '30d')   return { sql: ` AND ${column} >= datetime('now', '-30 days')`, params: [] };
  return { sql: '', params: [] };
}

// ─── The five numbers ─────────────────────────────────────────────────────────

/** Runs that FINISHED on the plant's own calendar day. */
function finishedToday(ctxOrCompanyId, scope) {
  const ctx = asContext(ctxOrCompanyId);
  const w = completionWhere(ctx.company_id, scope);
  return db.prepare(`
    SELECT COUNT(*) AS n ${COMPLETIONS_FROM}
    WHERE ${w.sql} AND c.status = 'completed' AND date(c.completed_at, ?) = date('now', ?)
  `).get(...w.params, ctx.day, ctx.day).n;
}

/** Runs open on the floor at this instant. Not a day measure — a live one. */
function runningNow(ctxOrCompanyId, scope) {
  const ctx = asContext(ctxOrCompanyId);
  const w = completionWhere(ctx.company_id, scope);
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
function avgCycle(ctxOrCompanyId, scope, window = 'all') {
  const ctx = asContext(ctxOrCompanyId);
  const w = completionWhere(ctx.company_id, scope);
  const win = windowClause(window, 'c.completed_at', ctx.day);
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
    /** The question this answered. On the payload, so nobody has to guess. */
    window,
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
function passRate(ctxOrCompanyId, scope, window = 'today') {
  const ctx = asContext(ctxOrCompanyId);
  const w = completionWhere(ctx.company_id, scope);
  const win = windowClause(window, 'c.completed_at', ctx.day);
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
    window,
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
function workOrderStates(ctxOrCompanyId, scope) {
  const ctx = asContext(ctxOrCompanyId);
  const w = workOrderWhere(ctx.company_id, scope);
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
function floorSnapshot(ctxOrCompanyId, opts = {}) {
  const ctx = asContext(ctxOrCompanyId);
  // `operator` is not a scope — it does not narrow the plant's numbers, it adds
  // one more beside them ("…and 4 of those are yours").
  return snapshotOf(ctx, resolveScope(ctx, opts), { operator: opts.operator });
}

/**
 * The snapshot for a scope that has already been resolved — what a route uses
 * when it needs the scope for something else as well (the work-order rows, say)
 * and must not resolve it twice.
 *
 * `opts.workOrderStates` lets a caller that has ALREADY run workOrderStates()
 * for this exact scope hand the result in, so the work-order select runs once
 * per request rather than once per consumer of it.
 */
function snapshotOf(ctxOrCompanyId, scope, opts = {}) {
  const ctx = asContext(ctxOrCompanyId);
  const cycle = avgCycle(ctx, scope, 'today');
  const quality = passRate(ctx, scope, 'today');
  const wos = opts.workOrderStates || workOrderStates(ctx, scope);
  // One operator's own share of the day, when the caller said who is asking.
  // The SAME plant day as every other figure here — the portal's TODAY tile
  // reads this instead of counting the tablet's own midnight.
  const mine = finishedTodayForOperator(ctx, scope, opts.operator || {});

  return {
    /** The calendar date at the plant right now — what "today" means here. */
    plant_date: ctx.plant_date,
    /** The zone that date was computed in. 'UTC' when the company set none. */
    timezone: ctx.timezone,

    finished_today: finishedToday(ctx, scope),
    running_now: runningNow(ctx, scope),

    /** What ONE operator finished on this same plant day, when the request
     *  named one. Null with a reason when it did not — never 0. */
    finished_today_for_operator: mine.count,
    finished_today_for_operator_reason: mine.reason,

    avg_cycle_seconds: cycle.seconds,
    avg_cycle_basis: cycle.basis,
    avg_cycle_sample: cycle.sample,
    avg_cycle_reason: cycle.reason,
    /** Which question the average answered: 'today' | '7d' | '30d' | 'all'. */
    avg_cycle_window: cycle.window,

    pass_rate: quality.rate,
    pass_rate_sample: quality.sample,
    pass_rate_reason: quality.reason,
    pass_rate_pass: quality.pass,
    pass_rate_fail: quality.fail,
    pass_rate_window: quality.window,

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

/**
 * The snapshot of a scope with nothing in it — same keys, honest values.
 *
 * A caller that KNOWS the answer is empty (a department created one millisecond
 * ago, a scope that matched nothing) uses this instead of running six queries to
 * be told so. It is the same shape, so a screen never has to branch between "a
 * real snapshot" and "no snapshot": zeros where something was counted, nulls
 * with reasons where nothing was measured.
 */
function emptySnapshot(ctxOrCompanyId, scope = null) {
  const ctx = asContext(ctxOrCompanyId);
  const wos = tallyWorkOrders([]);
  return {
    plant_date: ctx.plant_date,
    timezone: ctx.timezone,
    finished_today: 0,
    running_now: 0,
    finished_today_for_operator: null,
    finished_today_for_operator_reason: REASONS.no_operator,
    avg_cycle_seconds: null,
    avg_cycle_basis: null,
    avg_cycle_sample: 0,
    avg_cycle_reason: REASONS.avg_cycle,
    avg_cycle_window: 'today',
    pass_rate: null,
    pass_rate_sample: 0,
    pass_rate_reason: REASONS.pass_rate,
    pass_rate_pass: 0,
    pass_rate_fail: 0,
    pass_rate_window: 'today',
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
    on_track_basis: 'open_work_orders',
    scope: {
      site_id: scope?.site_id ?? null,
      department_id: scope?.department_id ?? null,
      app_id: scope?.app_id ?? null,
      station_id: scope?.station_id ?? null,
      valid: scope ? scope.valid : true,
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
 * opts: { siteId, departmentId, appId, productTypeId, cycleWindow, passWindow,
 *         scope, workOrderRows }.
 *
 * The two windows default to 'today'; a caller whose screen has always shown a
 * wider average says so rather than quietly getting a different number, and the
 * window it got is named on every entry.
 *
 * `scope` and `workOrderRows` are for a route that has ALREADY resolved the
 * scope and already run workOrderStates() over it: passing them in is what
 * stops /plant-view and /manager-view running the work-order select twice per
 * request. The rows MUST come from the same scope — they are grouped by
 * department here, not re-filtered.
 */
function departmentSnapshots(ctxOrCompanyId, opts = {}) {
  const ctx = asContext(ctxOrCompanyId);
  const companyId = ctx.company_id;
  const scope = opts.scope || resolveScope(ctx, opts);
  const cycleWindow = opts.cycleWindow || 'today';
  const passWindow = opts.passWindow || 'today';
  const cycleWin = windowClause(cycleWindow, 'c.completed_at', ctx.day);
  const passWin = windowClause(passWindow, 'c.completed_at', ctx.day);

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
  `).all(...w.params, ctx.day, ctx.day));

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

  // 5 — every work order in scope, statused once and grouped in memory. Handed
  //     in by a caller that already has them, so the select runs once.
  const woRows = opts.workOrderRows || workOrderStates(ctx, scope).rows;
  const woByDept = {};
  for (const wo of woRows) {
    if (!wo.department_id) continue;   // no department ⇒ no department's card
    (woByDept[wo.department_id] ??= []).push(wo);
  }

  return {
    plant_date: ctx.plant_date,
    timezone: ctx.timezone,
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
        plant_date: ctx.plant_date,
        timezone: ctx.timezone,

        finished_today: finished[dept.id]?.n || 0,
        running_now: running[dept.id]?.n || 0,

        avg_cycle_seconds: roundSeconds(cycleRaw),
        /** Full precision, for a caller converting to another unit. Rounding a
         *  rounded number is how the Command Center once turned 3.2 s into 6 s. */
        avg_cycle_seconds_raw: cycleRaw,
        avg_cycle_basis: cycleSample > 0 ? (cycle.basis ?? null) : null,
        avg_cycle_sample: cycleSample,
        avg_cycle_reason: cycleSample > 0 ? null : REASONS.avg_cycle,
        avg_cycle_window: cycleWindow,

        pass_rate: qcSample > 0 ? Math.round((verdict.pass / qcSample) * 100) : null,
        pass_rate_sample: qcSample,
        pass_rate_reason: qcSample > 0 ? null : REASONS.pass_rate,
        pass_rate_pass: verdict.pass,
        pass_rate_fail: verdict.fail,
        pass_rate_window: passWindow,

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

// ─── Dispatch: what should run next, here ─────────────────────────────────────
//
// The keystone put the data in place — a released work order carries ordered
// operations, each with its own app, department, station and quantities — and
// no screen read it. "Where is WO-1042?" was answered by opening the Schedule,
// finding the row, opening the drawer and counting the operations list.
//
// The three reads below are that question, answered by the server, under the
// same rules as every other number in this module: the plant's own day, a scope
// that is valid or empty (never widened), and null-with-a-reason wherever
// nothing was measured.

/**
 * Work-order priority as an ORDER BY key, written out rather than left to
 * SQLite's alphabet — which sorts 'critical' after 'behind' and 'low' before
 * 'medium', i.e. exactly backwards. Anything unrecognised sorts last, so a bad
 * value cannot jump the queue.
 */
const PRIORITY_RANK = `CASE wo.priority
  WHEN 'critical' THEN 0
  WHEN 'high'     THEN 1
  WHEN 'medium'   THEN 2
  WHEN 'low'      THEN 3
  ELSE 4 END`;

/**
 * A due date sorts ascending with NULLS LAST. SQLite sorts NULL first, which
 * puts every job nobody promised a date for ahead of the one due tomorrow.
 */
const DUE_DATE_RANK = `CASE WHEN wo.due_date IS NULL OR wo.due_date = '' THEN 1 ELSE 0 END`;

/**
 * An operation's department: its OWN, falling back to its work order's. A
 * routing step may name no department (a small shop routes by station, or by
 * nothing at all), and such an operation belongs where the job belongs rather
 * than nowhere.
 */
const OP_DEPARTMENT = 'COALESCE(o.department_id, wo.department_id)';

/** The two statuses a dispatch list may offer. 'queued' is ordered but not yet
 *  startable; 'complete'/'skipped' are over; 'on_hold' is stopped on purpose. */
const DISPATCHABLE_STATUSES = Object.freeze(['ready', 'running']);

/** Work-order statuses that mean the job is over — nothing on one is dispatched. */
const CLOSED_WORK_ORDERS = Object.freeze(['completed', 'cancelled']);

const DISPATCH_REASONS = {
  no_app: 'no app on this operation',
  no_work_order: 'this app needs no work order',
  not_counted: 'not counted yet',
  // Stated once, in REASONS, so the snapshot's key and this one cannot drift.
  no_operator: REASONS.no_operator,
  unknown_operator: 'that operator is not on this company\'s roster',
};

/**
 * Does this app need a work order to run?
 *
 * The SERVER side of components/player/runtime.ts `runContextRequired`, and
 * deliberately the same rule rather than a new one: the app's own
 * `require_run_context` setting when the author has made a choice, and
 * otherwise the schema version — v2 apps require run context, v1 apps (and the
 * seeded demo apps) do not. An app that needs no work order is exactly what the
 * portal was unable to list: 'Final QC Inspection' is published, runnable and
 * attached to no job, and the old jobs tab could not see it at all.
 */
function requiresWorkOrder(app) {
  const v = app && app.require_run_context;
  if (v === null || v === undefined) return Number(app && app.schema_version || 1) >= 2;
  return Number(v) !== 0;
}

/** The station a caller scoped to, with the department it sits in. */
function scopedStation(companyId, stationId) {
  if (!stationId) return null;
  return db.prepare('SELECT id, name, department_id FROM stations WHERE id = ? AND company_id = ?')
    .get(stationId, companyId) || null;
}

/**
 * THE STATION RULE, stated once and applied to both halves of the dispatch
 * list: a row belongs to a station when it names that station, OR when it names
 * no station at all and belongs to that station's department. A routing step
 * that says "Weld" without saying which welder still has to appear on the
 * welder's tablet, or filtering by station empties the screen for every shop
 * that routes by department — which is most of them.
 *
 * A station in no department can only match rows that name it explicitly:
 * borrowing the whole plant's queue under one station's name would be a lie,
 * the same call resolveScope() already makes for work orders.
 */
function stationClause(station, column, departmentExpr) {
  if (station.department_id) {
    return {
      sql: `(${column} = ? OR (${column} IS NULL AND ${departmentExpr} = ?))`,
      params: [station.id, station.department_id],
    };
  }
  return { sql: `${column} = ?`, params: [station.id] };
}

/**
 * What to run next in this department / at this station: every operation that
 * is READY or RUNNING, in the order a supervisor would call them — priority,
 * then due date, then the job's own sequence — UNIONed with the published apps
 * that need no work order at all.
 *
 * opts: { siteId, departmentId, stationId, appId } (or a resolved `scope`).
 *
 * Every row carries `kind` ('operation' | 'app') and `no_work_order`, so a
 * screen never has to guess which of the two it is drawing. An operation whose
 * routing step named no app is listed WITH `app_id: null` and a reason — it is
 * still the next thing to happen on that job, and hiding it is how a routing
 * mistake becomes an invisible stall.
 */
function dispatchQueue(ctxOrCompanyId, opts = {}) {
  const ctx = asContext(ctxOrCompanyId);
  const companyId = ctx.company_id;
  const scope = opts.scope || resolveScope(ctx, opts);

  const answer = (rows) => ({
    plant_date: ctx.plant_date,
    timezone: ctx.timezone,
    /** The statuses this list is built from. Named so a reader never has to
     *  guess whether 'queued' was included. */
    statuses: [...DISPATCHABLE_STATUSES],
    /** The order the rows are in, in words. */
    order: 'priority, due date (nulls last), operation sequence',
    rows,
    scope: {
      site_id: scope.site_id,
      department_id: scope.department_id,
      app_id: scope.app_id,
      station_id: scope.station_id,
      valid: scope.valid,
    },
  });

  // An id from another company narrows to nothing — no rows, and no name from
  // the other tenant read, let alone returned.
  if (!scope.valid) return answer([]);

  const station = scopedStation(companyId, scope.station_id);

  // ── The operations ─────────────────────────────────────────────────────────
  const clauses = [
    'o.company_id = ?',
    `o.status IN (${DISPATCHABLE_STATUSES.map(() => '?').join(',')})`,
    `wo.status NOT IN (${CLOSED_WORK_ORDERS.map(() => '?').join(',')})`,
  ];
  const params = [companyId, ...DISPATCHABLE_STATUSES, ...CLOSED_WORK_ORDERS];

  if (scope.department_id) { clauses.push(`${OP_DEPARTMENT} = ?`); params.push(scope.department_id); }
  if (station) {
    const st = stationClause(station, 'o.station_id', OP_DEPARTMENT);
    clauses.push(st.sql); params.push(...st.params);
  }
  // A job with no site predates sites and stays visible under every one.
  if (scope.site_id) { clauses.push('(wo.site_id = ? OR wo.site_id IS NULL)'); params.push(scope.site_id); }
  if (scope.app_id)  { clauses.push('o.app_id = ?'); params.push(scope.app_id); }

  const operations = db.prepare(`
    SELECT o.id                AS work_order_operation_id,
           o.work_order_id     AS work_order_id,
           o.sequence          AS operation_sequence,
           o.name              AS operation_name,
           o.status            AS status,
           o.app_id            AS app_id,
           o.station_id        AS station_id,
           o.quantity_required AS quantity_required,
           o.quantity_completed AS quantity_completed,
           o.standard_seconds  AS standard_seconds,
           o.started_at        AS started_at,
           ${OP_DEPARTMENT}    AS department_id,
           d.name              AS department_name,
           d.color             AS department_color,
           s.name              AS station_name,
           a.name              AS app_name,
           wo.work_order_number AS work_order_number,
           wo.part_number      AS part_number,
           wo.part_name        AS part_name,
           wo.priority         AS priority,
           wo.due_date         AS due_date,
           (SELECT COUNT(*) FROM work_order_operations x
             WHERE x.work_order_id = o.work_order_id AND x.company_id = o.company_id) AS operation_count
    FROM work_order_operations o
    JOIN work_orders wo ON wo.id = o.work_order_id AND wo.company_id = o.company_id
    LEFT JOIN departments d ON d.id = ${OP_DEPARTMENT}
    LEFT JOIN stations    s ON s.id = o.station_id
    LEFT JOIN apps        a ON a.id = o.app_id
    WHERE ${clauses.join(' AND ')}
    ORDER BY ${PRIORITY_RANK} ASC,
             ${DUE_DATE_RANK} ASC,
             wo.due_date ASC,
             o.sequence ASC,
             wo.work_order_number ASC
  `).all(...params).map(row => ({
    kind: 'operation',
    no_work_order: false,
    ...row,
    /** Null app is a routing gap, not an empty row: say so where the app name
     *  would be, rather than dropping the operation off the list. */
    app_reason: row.app_id ? null : DISPATCH_REASONS.no_app,
  }));

  // ── The apps that need no work order ───────────────────────────────────────
  // Scoped the same way the operations are, and de-duplicated against them: an
  // app already offered as somebody's operation is started from that job, not
  // twice.
  const onAnOperation = new Set(operations.map(r => r.app_id).filter(Boolean));

  const appClauses = ['ap.company_id = ?', "ap.status = 'published'"];
  const appParams = [companyId];
  if (scope.department_id) { appClauses.push('ap.department_id = ?'); appParams.push(scope.department_id); }
  if (station) {
    const st = stationClause(station, 'ap.station_id', 'ap.department_id');
    appClauses.push(st.sql); appParams.push(...st.params);
  }
  if (scope.site_id) { appClauses.push('(ap.site_id = ? OR ap.site_id IS NULL)'); appParams.push(scope.site_id); }
  if (scope.app_id)  { appClauses.push('ap.id = ?'); appParams.push(scope.app_id); }

  const appRows = db.prepare(`
    SELECT ap.id, ap.name, ap.department_id, ap.station_id,
           ap.require_run_context, ap.schema_version,
           d.name AS department_name, d.color AS department_color, s.name AS station_name
    FROM apps ap
    LEFT JOIN departments d ON d.id = ap.department_id
    LEFT JOIN stations    s ON s.id = ap.station_id
    WHERE ${appClauses.join(' AND ')}
    ORDER BY ap.name COLLATE NOCASE ASC
  `).all(...appParams)
    .filter(app => !requiresWorkOrder(app) && !onAnOperation.has(app.id))
    .map(app => ({
      kind: 'app',
      no_work_order: true,
      work_order_operation_id: null,
      work_order_id: null,
      work_order_number: null,
      part_number: null,
      part_name: null,
      priority: null,
      due_date: null,
      operation_sequence: null,
      operation_count: null,
      operation_name: null,
      /** Nothing has been started, so nothing is running. */
      status: 'ready',
      started_at: null,
      /** No job means no ordered quantity — null, never a 0 that reads as
       *  "none of them are done". */
      quantity_required: null,
      quantity_completed: null,
      standard_seconds: null,
      department_id: app.department_id,
      department_name: app.department_name ?? null,
      department_color: app.department_color ?? null,
      station_id: app.station_id,
      station_name: app.station_name ?? null,
      app_id: app.id,
      app_name: app.name,
      app_reason: null,
      reason: DISPATCH_REASONS.no_work_order,
    }));

  // Jobs first — they are what the plant promised somebody — then the
  // standing apps, alphabetically.
  return answer([...operations, ...appRows]);
}

// ─── "Where is WO-1042?" ──────────────────────────────────────────────────────

/**
 * The candidate spellings of a work-order number. A floor asks for "1042", the
 * traveller says "WO-2026-042" and the barcode scanner hands over whatever is
 * printed: matching only the exact string is how a search box answers "not
 * found" about a job that is on the screen behind it.
 */
function workOrderNumberCandidates(query) {
  const q = query.trim();
  const stripped = q.replace(/^wo[-\s]*/i, '');
  return [...new Set([q, `WO-${stripped}`, stripped].map(s => s.toUpperCase()).filter(Boolean))];
}

/**
 * Where ONE job stands, in the shape the search box prints.
 *
 * Where it stands is workOrderOperations.currentOperationFor's answer, imported
 * rather than re-derived — the drawer on the Schedule, the work-order API and
 * this search box must not be able to disagree about which operation a job is
 * on.
 */
function wipRow(ctx, wo) {
  const op = woOps.currentOperationFor(ctx.company_id, wo);
  const released = !!wo.released_at && !!op;

  if (!released) {
    return {
      work_order_id: wo.id,
      work_order_number: wo.work_order_number,
      part_number: wo.part_number,
      part_name: wo.part_name,
      operation_sequence: null,
      /** A count: this job has no operations, which is a measurement. */
      operation_count: 0,
      operation_name: null,
      department_name: wo.department_name ?? null,
      quantity_completed: wo.quantity_completed,
      quantity_required: wo.quantity,
      status: wo.status,
      started_at: null,
      released: false,
      answer: `${wo.work_order_number} is not released: at ${wo.status}`,
    };
  }

  const where = op.department_name ? ` (${op.department_name})` : '';
  return {
    work_order_id: wo.id,
    work_order_number: wo.work_order_number,
    part_number: wo.part_number,
    part_name: wo.part_name,
    operation_sequence: op.sequence,
    operation_count: op.of,
    operation_name: op.name,
    department_name: op.department_name ?? null,
    quantity_completed: op.quantity_completed,
    quantity_required: op.quantity_required,
    status: op.status,
    started_at: op.started_at ?? null,
    released: true,
    answer: `${wo.work_order_number} is at operation ${op.sequence} of ${op.of}`
      + `${where}, ${op.quantity_completed} of ${op.quantity_required} done`,
  };
}

/**
 * Answer "where is WO-1042?" in one sentence.
 *
 * A work-order number wins over a part number — somebody typing a job number is
 * asking about that job. A part number can match several open jobs, and then
 * the answer is the list rather than a guess at which one they meant.
 *
 * Company-scoped at the SELECT: another tenant's work order is not "found and
 * hidden", it is simply not found, and no name of theirs is ever read.
 */
function wipSearch(ctxOrCompanyId, rawQuery) {
  const ctx = asContext(ctxOrCompanyId);
  const companyId = ctx.company_id;
  const query = (one(rawQuery) || '').trim();

  const base = {
    plant_date: ctx.plant_date,
    timezone: ctx.timezone,
    query,
    match: 'none',
    result: null,
    results: [],
    answer: null,
    reason: null,
  };

  if (!query) return { ...base, reason: 'type a work order or part number' };

  const SELECT = `
    SELECT wo.*, d.name AS department_name
    FROM work_orders wo
    LEFT JOIN departments d ON d.id = wo.department_id
  `;

  const candidates = workOrderNumberCandidates(query);
  const byNumber = db.prepare(`
    ${SELECT}
    WHERE wo.company_id = ?
      AND UPPER(wo.work_order_number) IN (${candidates.map(() => '?').join(',')})
    ORDER BY wo.created_at DESC
  `).all(companyId, ...candidates);

  if (byNumber.length > 0) {
    const results = byNumber.map(wo => wipRow(ctx, wo));
    return {
      ...base,
      match: 'work_order',
      result: results[0],
      results,
      answer: results[0].answer,
    };
  }

  const byPart = db.prepare(`
    ${SELECT}
    WHERE wo.company_id = ?
      AND UPPER(wo.part_number) = ?
      AND wo.status != 'cancelled'
    ORDER BY wo.due_date IS NULL, wo.due_date ASC, wo.work_order_number ASC
  `).all(companyId, query.toUpperCase());

  if (byPart.length === 1) {
    const results = byPart.map(wo => wipRow(ctx, wo));
    return { ...base, match: 'part_number', result: results[0], results, answer: results[0].answer };
  }
  if (byPart.length > 1) {
    const results = byPart.map(wo => wipRow(ctx, wo));
    return {
      ...base,
      match: 'part_number',
      result: null,
      results,
      answer: `${results.length} work orders carry part ${byPart[0].part_number}`,
    };
  }

  return { ...base, reason: `no work order or part number matches "${query}"` };
}

// ─── WIP by operation, per department ─────────────────────────────────────────

/**
 * Do the completions rows carry per-unit good/scrap counts yet?
 *
 * They arrive with the scrap/rework workstream. Until they do, this reads the
 * PRAGMA rather than the column, because SELECTing a column SQLite does not
 * have is not a null — it is a 500 on the busiest screen in the product. Read
 * once: the schema cannot change under a running process.
 */
let _countColumns = null;
function completionCountColumns() {
  if (_countColumns === null) {
    const cols = db.prepare('PRAGMA table_info(completions)').all().map(c => c.name);
    _countColumns = {
      good: cols.includes('quantity_good'),
      scrap: cols.includes('quantity_scrap'),
    };
  }
  return _countColumns;
}

/**
 * WIP by operation: how much work is running and how much is waiting in each
 * department, plus today's good and scrap where anybody counted them.
 *
 * "queued" is READY + QUEUED — everything ordered and not yet running. The
 * basis is named on the payload rather than left to a reader who would
 * otherwise have to guess whether 12 waiting jobs means 12 startable ones.
 *
 * good/scrap are null WITH A REASON until the counts exist. A plant that has
 * never recorded a scrap count has not made zero scrap.
 */
function wipSummary(ctxOrCompanyId, opts = {}) {
  const ctx = asContext(ctxOrCompanyId);
  const companyId = ctx.company_id;
  const scope = opts.scope || resolveScope(ctx, opts);
  const counts = completionCountColumns();

  const departments = scope.valid
    ? db.prepare(
      'SELECT id, name, color FROM departments WHERE company_id = ?'
      + (scope.site_id ? ' AND (site_id = ? OR site_id IS NULL)' : '')
      + (scope.department_id ? ' AND id = ?' : '')
      + ' ORDER BY name'
    ).all(
      companyId,
      ...(scope.site_id ? [scope.site_id] : []),
      ...(scope.department_id ? [scope.department_id] : []),
    )
    : [];

  // 1 — operations on the floor, by department and status.
  const opClauses = [
    'o.company_id = ?',
    `wo.status NOT IN (${CLOSED_WORK_ORDERS.map(() => '?').join(',')})`,
    "o.status IN ('running','ready','queued')",
  ];
  const opParams = [companyId, ...CLOSED_WORK_ORDERS];
  if (scope.department_id) { opClauses.push(`${OP_DEPARTMENT} = ?`); opParams.push(scope.department_id); }
  if (scope.site_id)       { opClauses.push('(wo.site_id = ? OR wo.site_id IS NULL)'); opParams.push(scope.site_id); }

  const byDept = {};
  if (scope.valid) {
    for (const row of db.prepare(`
      SELECT ${OP_DEPARTMENT} AS dept_id, o.status AS status, COUNT(*) AS n
      FROM work_order_operations o
      JOIN work_orders wo ON wo.id = o.work_order_id AND wo.company_id = o.company_id
      WHERE ${opClauses.join(' AND ')}
      GROUP BY dept_id, o.status
    `).all(...opParams)) {
      const bucket = (byDept[row.dept_id] ??= { running: 0, queued: 0 });
      if (row.status === 'running') bucket.running += row.n;
      else bucket.queued += row.n;
    }
  }

  // 2 — today's counted units, by department, when the columns exist.
  const quantities = {};
  if (scope.valid && (counts.good || counts.scrap)) {
    const w = completionWhere(companyId, scope);
    const DEPT = 'COALESCE(wo.department_id, st.department_id)';
    const goodSum   = counts.good  ? 'SUM(COALESCE(c.quantity_good, 0))'  : 'NULL';
    const scrapSum  = counts.scrap ? 'SUM(COALESCE(c.quantity_scrap, 0))' : 'NULL';
    const goodSeen  = counts.good  ? 'SUM(CASE WHEN c.quantity_good  IS NOT NULL THEN 1 ELSE 0 END)' : '0';
    const scrapSeen = counts.scrap ? 'SUM(CASE WHEN c.quantity_scrap IS NOT NULL THEN 1 ELSE 0 END)' : '0';
    for (const row of db.prepare(`
      SELECT ${DEPT} AS dept_id,
             ${goodSum} AS good, ${scrapSum} AS scrap,
             ${goodSeen} AS good_sample, ${scrapSeen} AS scrap_sample
      ${COMPLETIONS_FROM}
      WHERE ${w.sql} AND c.status = 'completed' AND date(c.completed_at, ?) = date('now', ?)
      GROUP BY ${DEPT}
    `).all(...w.params, ctx.day, ctx.day)) {
      quantities[row.dept_id] = row;
    }
  }

  const rows = departments.map(dept => {
    const ops = byDept[dept.id] || { running: 0, queued: 0 };
    const q = quantities[dept.id];
    const goodSample  = counts.good  ? (q?.good_sample  || 0) : 0;
    const scrapSample = counts.scrap ? (q?.scrap_sample || 0) : 0;
    return {
      department_id: dept.id,
      department_name: dept.name,
      department_color: dept.color,
      running: ops.running,
      queued: ops.queued,
      /** What "queued" counted. Named, so it cannot quietly change meaning. */
      queued_basis: 'ready + queued operations',
      good_today: goodSample > 0 ? (q.good || 0) : null,
      good_today_sample: goodSample,
      good_today_reason: goodSample > 0 ? null : DISPATCH_REASONS.not_counted,
      scrap_today: scrapSample > 0 ? (q.scrap || 0) : null,
      scrap_today_sample: scrapSample,
      scrap_today_reason: scrapSample > 0 ? null : DISPATCH_REASONS.not_counted,
    };
  });

  const sum = (key) => rows.reduce((n, r) => n + (r[key] || 0), 0);
  const goodSampleTotal  = rows.reduce((n, r) => n + r.good_today_sample, 0);
  const scrapSampleTotal = rows.reduce((n, r) => n + r.scrap_today_sample, 0);

  return {
    plant_date: ctx.plant_date,
    timezone: ctx.timezone,
    departments: rows,
    totals: {
      running: sum('running'),
      queued: sum('queued'),
      queued_basis: 'ready + queued operations',
      good_today: goodSampleTotal > 0 ? sum('good_today') : null,
      good_today_sample: goodSampleTotal,
      good_today_reason: goodSampleTotal > 0 ? null : DISPATCH_REASONS.not_counted,
      scrap_today: scrapSampleTotal > 0 ? sum('scrap_today') : null,
      scrap_today_sample: scrapSampleTotal,
      scrap_today_reason: scrapSampleTotal > 0 ? null : DISPATCH_REASONS.not_counted,
    },
    scope: { site_id: scope.site_id, department_id: scope.department_id, valid: scope.valid },
  };
}

// ─── One operator's own day ───────────────────────────────────────────────────

/**
 * How many runs THIS operator finished on the plant's day.
 *
 * The portal's TODAY tile used to count this in the browser, off the tablet's
 * own clock, which is the exact bug rule 1 of this module exists to prevent: a
 * second-shift tablet in Detroit reset the operator's counter at 8pm while
 * every management screen carried on with the plant's day.
 *
 * Returns null WITH A REASON when nobody said who is asking — the tile then
 * prints the reason rather than a 0 that reads as "you have finished nothing".
 */
function finishedTodayForOperator(ctxOrCompanyId, scope, operator = {}) {
  const ctx = asContext(ctxOrCompanyId);
  const userId = one(operator.userId);
  const name = one(operator.name);
  if (!userId && !name) return { count: null, reason: DISPATCH_REASONS.no_operator };

  let clause, value;
  if (userId) {
    // Another company's user id identifies nobody here, and no name of theirs
    // is read to say so.
    const owned = ownedId('users', userId, ctx.company_id);
    if (!owned) return { count: null, reason: DISPATCH_REASONS.unknown_operator };
    clause = 'c.operator_user_id = ?';
    value = owned;
  } else {
    clause = 'c.operator_name = ?';
    value = name.trim();
  }

  const w = completionWhere(ctx.company_id, scope);
  const count = db.prepare(`
    SELECT COUNT(*) AS n ${COMPLETIONS_FROM}
    WHERE ${w.sql} AND c.status = 'completed'
      AND date(c.completed_at, ?) = date('now', ?)
      AND ${clause}
  `).get(...w.params, ctx.day, ctx.day, value).n;

  return { count, reason: null };
}

module.exports = {
  REASONS,
  WINDOWS,
  plantContext,
  asContext,
  resolveScope,
  stationScope,
  scopeFromQuery,
  siteCompletionClause,
  siteCompletionParams,
  departmentCompletionClause,
  departmentCompletionParams,
  finishedToday,
  runningNow,
  avgCycle,
  passRate,
  workOrderStates,
  tallyWorkOrders,
  floorSnapshot,
  snapshotOf,
  emptySnapshot,
  departmentSnapshots,
  // ── Dispatch, WIP and one operator's day ──
  DISPATCHABLE_STATUSES,
  DISPATCH_REASONS,
  requiresWorkOrder,
  dispatchQueue,
  wipSearch,
  wipSummary,
  finishedTodayForOperator,
};

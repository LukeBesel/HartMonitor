const express = require('express');
const db = require('../db');
const { plantDayShift, plantToday } = require('../plantDay');
const { calcScheduleStatus } = require('./workorders');
// The one server-side answer to finished-today, running-now, average cycle,
// pass rate and on-track. Every figure below that reports one of those five
// comes from here, so the Command Center and the department drill-down cannot
// describe different plants at the same minute. The WINDOW
// each screen asks for is still its own (all-time, 7 days, today) — what is
// shared is how any of them is measured, and which day "today" is.
const plantTruth = require('../plantTruth');
const { calcOEE } = require('./oee');
const { teamOf: andonTeamOf, teamLabel: andonTeamLabel } = require('../andonTeams');
const {
  roundSeconds, runDurations, stepTaktSeconds,
  avgRunSecondsSQL, avgRunBasisSQL, runSecondsSQL, runBasisSQL,
  handsOnSecondsSQL, elapsedSecondsSQL, elapsedSoFarSecondsSQL,
} = require('../cycleTime');

const router = express.Router();


// ─── Filter helper ────────────────────────────────────────────────────────────
// Builds an optional `AND …` clause from the query string so completion-based
// analytics can be scoped to a specific app, product (part) type and/or
// department. Returns the SQL fragment plus ordered params.
//
// The fragment is spliced into whatever query the caller wrote, so every column
// it names must exist on `completions` itself (`app_id`, `product_type_id`,
// `work_order_id`, `station_id`). Callers alias the table differently (or not at
// all), so the qualifier is a parameter: pass the alias the caller used, or
// nothing when the query has no other table in scope. A qualifier that does not
// match the caller's alias is a 500 on a page a customer is reading — and an
// UNqualified `app_id` in a query that also joins `work_orders` is an
// "ambiguous column name" 500 for exactly the same reason.
//
// The DEPARTMENT and SITE rules themselves are not written here. They live in
// src/plantTruth.js with every other definition this product must only have one
// of, and are imported alias-agnostic. This file used to carry its own copy of
// the site rule, and the copy had drifted: a completion whose work order has no
// site but whose station belongs to ANOTHER site was counted here and not by the
// KPI tile above it, so one page disagreed with itself.

/**
 * @param req   the request, read for ?app_id / ?product_type_id / ?department_id
 * @param alias table alias (or table name) to qualify the columns with. Pass it
 *              whenever the caller's query joins another table that also has an
 *              `app_id` column — `work_orders` does, and an unqualified
 *              `app_id = ?` against that join is an "ambiguous column name" 500.
 */
function completionFilter(req, alias = '') {
  const p = alias ? `${alias}.` : '';
  const clauses = [];
  const params = [];
  if (req.query.app_id) { clauses.push(`${p}app_id = ?`); params.push(req.query.app_id); }
  if (req.query.product_type_id) { clauses.push(`${p}product_type_id = ?`); params.push(req.query.product_type_id); }
  if (req.query.department_id) {
    clauses.push(plantTruth.departmentCompletionClause(p));
    params.push(...plantTruth.departmentCompletionParams(req.companyId, req.query.department_id));
  }
  if (req.query.site_id) {
    clauses.push(plantTruth.siteCompletionClause(p));
    params.push(...plantTruth.siteCompletionParams(req.companyId, req.query.site_id));
  }
  return { clause: clauses.length ? ' AND ' + clauses.join(' AND ') : '', params };
}

/** True when the request asked for anything narrower than the whole plant. */
function isScoped(req) {
  return !!(req.query.department_id || req.query.app_id);
}

// Clamp a user-supplied ?days= value to a sane integer — parseInt('abc') is NaN
// and better-sqlite3 throws a TypeError when binding NaN (500 for the client).
function safeDays(value, fallback) {
  return Math.min(Math.max(parseInt(value, 10) || fallback, 1), 3650);
}

// ─── GET /overview ────────────────────────────────────────────────────────────

router.get('/overview', (req, res) => {
  const cid = req.companyId;
  const f = completionFilter(req);
  // The plant's day and the plant's counts, from the one module that defines
  // them. This used to bind its own date modifier and count its own runs, which
  // is how the same company read 62 here and 1 on the floor screen.
  // The plant's day, its date and its zone: resolved ONCE per request and
  // threaded through every query below. Each of the calls this replaced re-read
  // the company's timezone from org_settings, and two of them could land on
  // different instants — which is how one page ends up with two "todays".
  const ctx = plantTruth.plantContext(cid);
  const scope = plantTruth.scopeFromQuery(req);

  // ── An id this company does not own narrows to NOTHING, and says so ────────
  // Same contract as /plant-view: a site, department, app or product type from
  // another tenant (or one that simply does not exist) is not quietly dropped —
  // dropping it WIDENS the answer to the whole plant while the page still shows
  // the filter as applied, which is how a scoped screen prints plant-wide
  // numbers under a department's name. Every figure is empty and `scope_valid`
  // is false, so the client can say which filter it could not honour.
  if (!scope.valid) {
    return res.json({
      scope: { site_id: null, department_id: null, app_id: null, product_type_id: null },
      /** False when an id in the request belongs to no record this company owns. */
      scope_valid: false,
      totalCompletions: 0, todayCompletions: 0, inProgress: 0,
      totalApps: 0, publishedApps: 0, activeStations: 0,
      avgCycleTime: null, avgCycleSeconds: null, avgCycleBasis: null, avgCycleSample: 0,
      passRate: null, qcSampleSize: 0,
      avg_cycle_reason: plantTruth.REASONS.avg_cycle,
      pass_rate_reason: plantTruth.REASONS.pass_rate,
      avg_cycle_window: 'all',
      pass_rate_window: 'all',
      plant_date: ctx.plant_date,
      timezone: ctx.timezone,
    });
  }

  const totalCompletions  = db.prepare(`SELECT COUNT(*) as c FROM completions WHERE company_id = ? AND status='completed'${f.clause}`).get(cid, ...f.params).c;
  const todayCompletions  = plantTruth.finishedToday(ctx, scope);
  const inProgress        = plantTruth.runningNow(ctx, scope);
  const totalApps         = db.prepare("SELECT COUNT(*) as c FROM apps WHERE company_id = ?").get(cid).c;
  const publishedApps     = db.prepare("SELECT COUNT(*) as c FROM apps WHERE company_id = ? AND status='published'").get(cid).c;
  const activeStations    = db.prepare("SELECT COUNT(*) as c FROM stations WHERE company_id = ? AND status='active'").get(cid).c;

  // This page's window is ALL TIME — a different question from the floor
  // screens' today, deliberately, and the difference is now the argument rather
  // than a second copy of the arithmetic.
  //
  // Report the average in SECONDS. Rounding to whole minutes threw away the only
  // precision a short operation has: a press, a pick-and-place or a visual check
  // averaging twelve seconds came back as 0 and the page printed "0m" for a run
  // that plainly took time. The client picks the unit.
  //
  // `avgCycleTime` (whole minutes) stays on the payload for anything already
  // reading it, but nothing should render it — it is 0 for every sub-30-second
  // operation, which is exactly the lie above.
  const cycle = plantTruth.avgCycle(ctx, scope, 'all');
  const avgCycleSeconds = cycle.seconds;
  const avgCycleTime = avgCycleSeconds === null ? null : Math.round(cycle.raw / 60);

  // Pass rate over every completed run that recorded a QC result (a run with
  // both a Pass and a Fail counts once, as a fail). No QC results = null, so
  // the UI can say "no data" instead of showing a 0% nobody measured.
  const quality = plantTruth.passRate(ctx, scope, 'all');

  res.json({
    /** What the server actually applied, so a client never has to assume a
     *  parameter it sent was honoured. */
    scope: {
      site_id: scope.site_id, department_id: scope.department_id,
      app_id: scope.app_id, product_type_id: scope.product_type_id ?? null,
    },
    scope_valid: true,
    totalCompletions, todayCompletions, inProgress, totalApps, publishedApps, activeStations,
    avgCycleTime, avgCycleSeconds,
    /** 'hands_on' | 'elapsed' | 'mixed' | null — what the average was measured with. */
    avgCycleBasis: cycle.basis,
    /** How many runs are behind that average. 0 ⇒ avgCycleSeconds is null. */
    avgCycleSample: cycle.sample,
    passRate: quality.rate,
    qcSampleSize: quality.sample,
    /** Why a null number is null, for the screen to print instead of a bare dash. */
    avg_cycle_reason: cycle.reason,
    pass_rate_reason: quality.reason,
    /** Which question each number answered — this page's window is all time. */
    avg_cycle_window: cycle.window,
    pass_rate_window: quality.window,
    /** The day this company is having — what "today" means in todayCompletions. */
    plant_date: ctx.plant_date,
    timezone: ctx.timezone,
  });
});

// ─── GET /throughput ──────────────────────────────────────────────────────────

router.get('/throughput', (req, res) => {
  const days = Math.min(365, parseInt(req.query.days) || 30);
  const f = completionFilter(req);
  // Each bar on this chart is a day, and it has to be the same day the "today"
  // tile counts — otherwise the rightmost bar disagrees with the number printed
  // above it for the four hours after midnight UTC.
  const day = plantDayShift(req.companyId);
  const rows = db.prepare(`
    SELECT date(completed_at, ?) as date, COUNT(*) as count
    FROM completions
    WHERE company_id = ? AND status='completed' AND date(completed_at, ?) >= date('now', ?, '-' || ? || ' days')${f.clause}
    GROUP BY 1
    ORDER BY date ASC
    LIMIT 10000
  `).all(day, req.companyId, day, day, days, ...f.params);
  res.json(rows);
});

// ─── GET /cycle-times ─────────────────────────────────────────────────────────

router.get('/cycle-times', (req, res) => {
  const days = Math.min(365, parseInt(req.query.days) || 30);
  const f = completionFilter(req);
  const day = plantDayShift(req.companyId);
  const rows = db.prepare(`
    SELECT
      date(completed_at, ?) as date,
      ROUND(${avgRunSecondsSQL('completions')} / 60.0, 1) as avg_minutes,
      ROUND(MIN(${runSecondsSQL('completions')}) / 60.0, 1) as min_minutes,
      ROUND(MAX(${runSecondsSQL('completions')}) / 60.0, 1) as max_minutes,
      ${avgRunSecondsSQL('completions')} as avg_seconds,
      MIN(${runSecondsSQL('completions')}) as min_seconds,
      MAX(${runSecondsSQL('completions')}) as max_seconds
    FROM completions
    WHERE company_id = ? AND status='completed' AND completed_at IS NOT NULL
      AND date(completed_at, ?) >= date('now', ?, '-' || ? || ' days')${f.clause}
    GROUP BY 1
    ORDER BY date ASC
    LIMIT 10000
  `).all(day, req.companyId, day, day, days, ...f.params).map(r => ({
    ...r,
    avg_seconds: roundSeconds(r.avg_seconds),
    min_seconds: roundSeconds(r.min_seconds),
    max_seconds: roundSeconds(r.max_seconds),
  }));
  res.json(rows);
});

// ─── GET /operator-performance ────────────────────────────────────────────────

router.get('/operator-performance', (req, res) => {
  const f = completionFilter(req);
  const rows = db.prepare(`
    SELECT
      operator_name,
      COUNT(*) as completions,
      ROUND(${avgRunSecondsSQL('completions')} / 60.0, 1) as avg_cycle_minutes,
      ${avgRunSecondsSQL('completions')} as avg_cycle_seconds,
      ${avgRunBasisSQL('completions')}   as avg_cycle_basis
    FROM completions
    WHERE company_id = ? AND status='completed' AND completed_at IS NOT NULL${f.clause}
    GROUP BY operator_name
    ORDER BY completions DESC
    LIMIT 20
  `).all(req.companyId, ...f.params).map(r => ({ ...r, avg_cycle_seconds: roundSeconds(r.avg_cycle_seconds) }));
  res.json(rows);
});

// ─── GET /app-performance ─────────────────────────────────────────────────────

router.get('/app-performance', (req, res) => {
  const f = completionFilter(req);
  const rows = db.prepare(`
    SELECT
      app_id,
      app_name,
      COUNT(*) as completions,
      ROUND(${avgRunSecondsSQL('completions')} / 60.0, 1) as avg_cycle_minutes,
      ${avgRunSecondsSQL('completions')} as avg_cycle_seconds,
      ${avgRunBasisSQL('completions')}   as avg_cycle_basis,
      COUNT(CASE WHEN status='abandoned' THEN 1 END) as abandoned_count
    FROM completions
    WHERE company_id = ?${f.clause}
    GROUP BY app_id, app_name
    ORDER BY completions DESC
  `).all(req.companyId, ...f.params).map(r => ({ ...r, avg_cycle_seconds: roundSeconds(r.avg_cycle_seconds) }));
  res.json(rows);
});

// ─── GET /quality ─────────────────────────────────────────────────────────────

router.get('/quality', (req, res) => {
  const { days = 30 } = req.query;
  const f = completionFilter(req);
  const day = plantDayShift(req.companyId);
  const rows = db.prepare(`
    SELECT date(completed_at, ?) as date, data
    FROM completions
    WHERE company_id = ? AND status='completed' AND date(completed_at, ?) >= date('now', ?, '-' || ? || ' days')${f.clause}
    ORDER BY completed_at ASC
  `).all(day, req.companyId, day, day, safeDays(days, 30), ...f.params);

  const byDate = {};
  for (const row of rows) {
    const data = JSON.parse(row.data);
    if (!byDate[row.date]) byDate[row.date] = { date: row.date, pass: 0, fail: 0 };
    const vals = Object.values(data);
    // Only count a run that actually recorded a QC result. A run with no
    // Pass/Fail step was never inspected — counting it as a pass (the old
    // `else pass++`) invented an 87% chart next to an 80% KPI, and drew
    // "100% pass" bars for departments that inspect nothing.
    if (vals.some(v => v === 'Fail')) byDate[row.date].fail++;
    else if (vals.some(v => v === 'Pass')) byDate[row.date].pass++;
  }
  res.json(Object.values(byDate).sort((a, b) => a.date.localeCompare(b.date)));
});

// ─── GET /plant-view ──────────────────────────────────────────────────────────
//
// Scope: ?site_id (as before) plus ?department_id and ?app_id — the Command
// Center's page filter. EVERY figure in the response honours all three. A
// half-scoped floor view — department cards narrowed while the headline tiles
// stay plant-wide — reads to a manager as "that is my department's number",
// which is worse than offering no filter at all.

router.get('/plant-view', (req, res) => {
  const cid = req.companyId;
  const { site_id, department_id, app_id } = req.query;

  // Page scope for the sections that are NOT one of the shared five (hourly
  // throughput, the recent-completions table). Expressed twice because two of
  // those queries join `work_orders` (which has an `app_id` of its own): once
  // qualified for the query that reads `completions` by table name, once for
  // the one that aliases it `c`.
  const cf  = completionFilter(req, 'completions');
  const cfc = completionFilter(req, 'c');

  // The plant's day, date and zone: resolved ONCE and threaded through.
  const ctx = plantTruth.plantContext(cid);

  // The page scope, resolved once by the module that owns the definition of it.
  // An id from another tenant narrows to nothing here rather than widening.
  const scope = plantTruth.scopeFromQuery(req);

  // …and when it matched nothing this company owns, EVERY section is empty —
  // not just the tiles. The KPI strip used to go to zero through the resolved
  // scope while the throughput chart, the alert list and the recent-completions
  // table kept using the raw parameter, so a foreign site id produced "0
  // completed today" above six completions. A half-empty page is worse than an
  // empty one: it reads as a real answer.
  if (!scope.valid) {
    return res.json({
      scope: { site_id: null, department_id: null, app_id: null },
      /** False when an id in the request belongs to no record this company owns. */
      scope_valid: false,
      plant_date: ctx.plant_date,
      timezone: ctx.timezone,
      kpis: {
        total_completed_today: 0,
        active_now: 0,
        pass_rate: null,
        pass_rate_sample: 0,
        pass_rate_reason: plantTruth.REASONS.pass_rate,
        pass_rate_window: '7d',
        avg_cycle_time: null,
        avg_cycle_seconds: null,
        avg_cycle_basis: null,
        avg_cycle_sample: 0,
        avg_cycle_reason: plantTruth.REASONS.avg_cycle,
        avg_cycle_window: 'all',
        schedule_adherence: null,
        work_orders_on_track: 0,
        work_orders_total: 0,
        on_track: 0,
        open_work_orders: 0,
        on_track_pct: null,
        on_track_reason: plantTruth.REASONS.on_track,
        on_track_basis: 'open_work_orders',
      },
      department_performance: [],
      hourly_throughput: [],
      work_order_summary: { on_track: 0, at_risk: 0, behind: 0, not_started: 0, completed: 0 },
      active_alerts: [],
      recent_completions: [],
    });
  }

  // Site filter for the queries below that are NOT part of the shared five
  // (hourly throughput, recent completions). A completion's "site" is its work
  // order's site, falling back to its station's. Records never assigned to a
  // site belong to the whole company and stay visible under every site.
  const siteJoin = site_id
    ? `LEFT JOIN work_orders wo ON wo.id = completions.work_order_id
       LEFT JOIN stations    st ON st.id = completions.station_id`
    : '';
  const siteClause = site_id ? ' AND (COALESCE(wo.site_id, st.site_id) = ? OR COALESCE(wo.site_id, st.site_id) IS NULL)' : '';
  const siteParams = site_id ? [site_id] : [];

  // ── The five shared numbers ────────────────────────────────────────────────
  // Counted once, in src/plantTruth.js, against the plant's own day. This block
  // used to bind its own date modifier, run its own AVG and parse its own
  // pass/fail blobs — three copies of arithmetic that had already drifted apart
  // from the department page's copies by the time anyone noticed.
  const todayCompleted = plantTruth.finishedToday(ctx, scope);
  const activeNow      = plantTruth.runningNow(ctx, scope);

  // Seconds, for the same reason as /overview: rounding to whole minutes first
  // renders every sub-30-second operation as "0m", and a press, a pick-place or
  // a visual check is routinely under a minute. `avg_cycle_time` stays on the
  // payload in minutes for anything already reading it; nothing should render it.
  const cycle = plantTruth.avgCycle(ctx, scope, 'all');
  const avgCycleSeconds = cycle.seconds;
  const avgCycleTime = avgCycleSeconds === null ? null : Math.round(cycle.raw / 60);

  // Pass rate over the last 7 days — this screen's window, unchanged, but no
  // longer its own implementation of what a pass rate is.
  const quality = plantTruth.passRate(ctx, scope, '7d');
  const passRate = quality.rate;

  // Share of this site's work orders currently on track (or already finished).
  // Deliberately NOT called "schedule adherence" in the UI — that term means
  // on-time delivery against plan, which is a different measure.
  //
  // One query, one pass of the one on-track rule: the rows feed the alert list
  // and the department cards below, and the tally feeds the KPI strip, so the
  // strip and the cards can no longer count the same work orders differently.
  const woStates = plantTruth.workOrderStates(ctx, scope);
  const allWOs = woStates.rows;

  // `work_order_summary` has always folded overdue into behind (it has no
  // overdue bucket of its own and the screen reads five keys). Preserved
  // exactly, from the canonical counts.
  const woSummary = {
    on_track:    woStates.counts.on_track,
    at_risk:     woStates.counts.at_risk,
    behind:      woStates.counts.behind + woStates.counts.overdue,
    not_started: woStates.counts.not_started,
    completed:   woStates.counts.completed,
  };
  const scheduleAdherence = woStates.adherence_pct;

  // Department performance. Every card is one entry of the same snapshot the
  // KPI strip above was built from — one query set for the whole strip, not two
  // queries per department, and no second opinion about what "today" is.
  // Picking one department in the page filter narrows this list to that card:
  // showing six cards under a one-department scope would contradict every other
  // number on the page.
  const deptSnapshots = plantTruth.departmentSnapshots(ctx, {
    // The scope is already resolved and the work orders are already selected
    // and statused, so neither happens a second time for the cards.
    scope,
    workOrderRows: allWOs,
    // This card's average has always been over ALL of a department's finished
    // runs, printed next to a count of today's. Left exactly as it was — wave 2
    // decides what the card should say, and quietly changing what a number
    // means is the failure this work exists to end.
    cycleWindow: 'all',
  }).departments;

  const departmentPerformance = deptSnapshots.map(snap => {
    const deptWOs = allWOs.filter(wo => wo.department_id === snap.department_id);

    // "On track" on this card has always included work orders already finished,
    // over every non-cancelled order. That is a wider question than the floor
    // snapshot's on_track (open orders only) — both now come from the same
    // tally, and both are on the payload so a screen can say which it shows.
    const onTrack = snap.on_track + snap.completed_work_orders;
    const onTrackPct = snap.total_work_orders > 0
      ? Math.round((onTrack / snap.total_work_orders) * 100)
      : null;
    // A department with no work orders is 'idle', not a green "on track" — there
    // is nothing to be on track with.
    const status = snap.total_work_orders === 0 ? 'idle'
      : onTrackPct >= 80 ? 'on_track'
      : onTrackPct >= 50 ? 'at_risk' : 'behind';

    const taktTimes = deptWOs.map(wo => wo.takt_time_minutes).filter(t => t > 0);
    // No work order in this department carries a takt ⇒ there is no takt to
    // report. A 0 here renders as a target of zero minutes per unit.
    const taktTime = taktTimes.length
      ? Math.round((taktTimes.reduce((sum, t) => sum + t, 0) / taktTimes.length) * 10) / 10
      : null;

    return {
      id:               snap.department_id,
      department:       snap.department_name,
      color:            snap.department_color,
      completion_count: snap.finished_today,
      /** Whole minutes, and null when nothing finished. Do not render it. */
      avg_cycle_time:   snap.avg_cycle_seconds_raw == null ? null : Math.round(snap.avg_cycle_seconds_raw / 60),
      /** The one to render. null when nothing in this department has finished. */
      avg_cycle_seconds: snap.avg_cycle_seconds,
      /** 'hands_on' | 'elapsed' | 'mixed' | null — the label the card must carry. */
      avg_cycle_basis:  snap.avg_cycle_basis,
      /** How many runs are behind that average. 0 ⇒ avg_cycle_seconds is null. */
      avg_cycle_sample: snap.avg_cycle_sample,
      takt_time:        taktTime,
      on_track_count:   onTrack,
      total_count:      snap.total_work_orders,
      status,
      // ── The canonical figures, added beside the legacy ones. Wave 2 reads
      // these; nothing renders them yet.
      finished_today:    snap.finished_today,
      running_now:       snap.running_now,
      on_track:          snap.on_track,
      open_work_orders:  snap.open_work_orders,
      on_track_basis:    'open_work_orders',
    };
  });

  // Hourly throughput for last 24 hours
  const hourlyThroughput = db.prepare(`
    SELECT
      strftime('%Y-%m-%dT%H:00:00', completions.completed_at) as hour,
      COUNT(*) as count
    FROM completions ${siteJoin}
    WHERE completions.company_id = ? AND completions.status = 'completed'
      AND completions.completed_at >= datetime('now', '-24 hours')${siteClause}${cf.clause}
    GROUP BY strftime('%Y-%m-%dT%H:00:00', completions.completed_at)
    ORDER BY hour ASC
  `).all(cid, ...siteParams, ...cf.params);

  // Active alerts: work orders running behind or past their scheduled end
  const activeAlerts = allWOs
    .filter(wo => wo.schedule_status === 'behind' || wo.schedule_status === 'overdue')
    .sort((a, b) => new Date(a.scheduled_end) - new Date(b.scheduled_end))
    .slice(0, 10)
    .map(wo => ({
      id:                wo.id,
      work_order_number: wo.work_order_number,
      part_name:         wo.part_name,
      department:        wo.department_name || 'Unassigned',
      status:            wo.schedule_status === 'overdue' ? 'overdue' : 'behind',
      scheduled_end:     wo.scheduled_end,
      completion_pct:    wo.quantity > 0 ? Math.round((wo.quantity_completed / wo.quantity) * 100) : 0,
    }));

  // Recent / in-progress completions across the plant
  const recentCompletions = db.prepare(`
    SELECT
      c.id, c.app_name, c.operator_name, c.status, c.started_at, c.completed_at,
      d.name AS department_name,
      -- The canonical run duration and both measurements behind it, computed by
      -- the shared model rather than re-derived here. Selecting them in SQL
      -- keeps the step_times blob out of the response.
      ${runSecondsSQL('c')}          AS duration_seconds,
      ${runBasisSQL('c')}            AS duration_basis,
      ${handsOnSecondsSQL('c')}      AS hands_on_seconds,
      ${elapsedSecondsSQL('c')}      AS elapsed_seconds,
      ${elapsedSoFarSecondsSQL('c')} AS elapsed_so_far_seconds
    FROM completions c
    LEFT JOIN work_orders wo ON wo.id = c.work_order_id
    LEFT JOIN stations st    ON st.id = c.station_id
    LEFT JOIN departments d  ON d.id  = COALESCE(wo.department_id, st.department_id)
    WHERE c.company_id = ?${site_id ? ' AND (COALESCE(wo.site_id, st.site_id) = ? OR COALESCE(wo.site_id, st.site_id) IS NULL)' : ''}${cfc.clause}
    ORDER BY datetime(COALESCE(c.completed_at, c.started_at)) DESC
    LIMIT 15
  `).all(cid, ...siteParams, ...cfc.params).map(c => {
    // Durations come from backend/src/cycleTime.js, the one place that decides
    // how long a run took. This used to derive its seconds from a
    // tenth-of-a-minute it had ALREADY rounded — eight runs measuring
    // 3.20-3.56 s all printed "6s", 70-90 % overstated and quantised to
    // six-second steps, next to a department average computed at full
    // precision. And it clocked an unfinished run against `new Date()`, so a
    // job still on the bench appeared in a table headed RECENT COMPLETIONS
    // with 27m 48s in its Duration column. A run in progress has no duration;
    // it has an elapsed-so-far, which lives in its own field and is the
    // screen's job to label as such.
    const finished = c.status === 'completed' && !!c.completed_at;
    return {
      id:               c.id,
      app_name:         c.app_name,
      operator_name:    c.operator_name,
      department:       c.department_name || 'Unassigned',
      /** The real finish time, or null. It used to fall back to started_at,
       *  which put a completion time on a job still on the bench. */
      completed_at:     c.completed_at,
      started_at:       c.started_at,
      /** What the row's timestamp column should show: when this run last did
       *  something. Finished ⇒ its completion; still open ⇒ its start. */
      activity_at:      c.completed_at || c.started_at,
      /** Null until the run finishes — never an elapsed-so-far in disguise. */
      duration_seconds: finished ? roundSeconds(c.duration_seconds) : null,
      duration_basis:   finished ? (c.duration_basis ?? null) : null,
      hands_on_seconds: finished ? roundSeconds(c.hands_on_seconds) : null,
      elapsed_seconds:  finished ? roundSeconds(c.elapsed_seconds) : null,
      /** Set only while the run is open. Not a cycle time. */
      elapsed_so_far_seconds: roundSeconds(c.elapsed_so_far_seconds),
      status:           c.status,
      /** True for the rows a "completions" table may count as completions. */
      is_complete:      finished,
    };
  });

  res.json({
    // Echoed back so the client can prove what the server actually applied
    // rather than assuming a parameter it sent was honoured.
    scope: {
      site_id:       site_id || null,
      department_id: department_id || null,
      app_id:        app_id || null,
    },
    /** False when an id in the request belongs to no record this company owns. */
    scope_valid: true,
    /** The day these tiles are reporting, and the clock it was read on. */
    plant_date: ctx.plant_date,
    timezone:   ctx.timezone,
    kpis: {
      total_completed_today: todayCompleted,
      active_now:            activeNow,
      /** Pass rate over the last SEVEN DAYS — this screen's window, not today's. */
      pass_rate:             passRate,
      /** How many inspected runs are behind it. 0 ⇒ pass_rate is null. */
      pass_rate_sample:      quality.sample,
      pass_rate_reason:      quality.reason,
      pass_rate_window:      quality.window,
      avg_cycle_time:        avgCycleTime,
      avg_cycle_seconds:     avgCycleSeconds,
      /** 'hands_on' | 'elapsed' | 'mixed' | null — the label the tile must carry. */
      avg_cycle_basis:       cycle.basis,
      /** How many finished runs are behind it. 0 ⇒ avg_cycle_seconds is null. */
      avg_cycle_sample:      cycle.sample,
      avg_cycle_reason:      cycle.reason,
      /** This tile's average is over ALL time, not today. Named, not guessed. */
      avg_cycle_window:      cycle.window,
      /** On track OR already finished, over every non-cancelled work order. */
      schedule_adherence:    scheduleAdherence,
      work_orders_on_track:  woSummary.on_track,
      work_orders_total:     allWOs.length,
      // ── The canonical pair, added beside them: on track out of the orders
      // that are still OPEN, which is the only set an order can still be on
      // track with. Wave 2 renders these.
      on_track:              woStates.on_track,
      open_work_orders:      woStates.open_work_orders,
      on_track_pct:          woStates.on_track_pct,
      on_track_reason:       woStates.on_track_reason,
      on_track_basis:        'open_work_orders',
    },
    department_performance: departmentPerformance,
    hourly_throughput:       hourlyThroughput,
    work_order_summary:      woSummary,
    active_alerts:           activeAlerts,
    recent_completions:      recentCompletions,
  });
});

// ─── GET /step-metrics/:appId - per-step timing analytics ────────────────────

router.get('/step-metrics/:appId', (req, res) => {
  const { appId } = req.params;
  const days = safeDays(req.query.days, 90);

  const app = db.prepare('SELECT id, name, steps FROM apps WHERE id = ? AND company_id = ?').get(appId, req.companyId);
  if (!app) return res.status(404).json({ error: 'App not found' });

  const steps = JSON.parse(app.steps || '[]');

  const day = plantDayShift(req.companyId);
  const rows = db.prepare(`
    SELECT step_times, takt_exceeded_steps, date(completed_at, ?) as date
    FROM completions
    WHERE company_id = ? AND app_id = ? AND status = 'completed' AND completed_at IS NOT NULL
      AND date(completed_at, ?) >= date('now', ?, '-' || ? || ' days')
    ORDER BY completed_at ASC
  `).all(day, req.companyId, appId, day, day, days);

  const stepStats = steps.map((step, idx) => {
    const times = [];
    const dateMap = {};

    for (const row of rows) {
      const st = JSON.parse(row.step_times || '{}');
      const t = st[idx] !== undefined ? Number(st[idx]) : null;
      if (t !== null && t > 0) {
        times.push(t);
        if (!dateMap[row.date]) dateMap[row.date] = [];
        dateMap[row.date].push(t);
      }
    }

    const sorted = [...times].sort((a, b) => a - b);
    const avg = times.length ? Math.round(times.reduce((s, v) => s + v, 0) / times.length) : 0;
    const min = times.length ? sorted[0] : 0;
    const max = times.length ? sorted[sorted.length - 1] : 0;
    const p95 = times.length ? (sorted[Math.floor(sorted.length * 0.95)] ?? max) : 0;

    const taktSeconds = step.takt_time_seconds || step.takt_time || 0;
    const exceededCount = rows.filter(row => {
      const te = JSON.parse(row.takt_exceeded_steps || '[]');
      return te.includes(idx) || te.includes(String(idx));
    }).length;

    const trend = Object.entries(dateMap)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, vals]) => ({
        date,
        avg_seconds: Math.round(vals.reduce((s, v) => s + v, 0) / vals.length),
        count: vals.length,
      }));

    return {
      index: idx,
      name: step.name,
      takt_seconds: taktSeconds,
      completions: times.length,
      avg_seconds: avg,
      min_seconds: min,
      max_seconds: max,
      p95_seconds: p95,
      over_takt_count: exceededCount,
      over_takt_pct: times.length > 0 ? Math.round((exceededCount / times.length) * 100) : 0,
      trend,
    };
  });

  res.json({
    app_id: appId,
    app_name: app.name,
    total_completions: rows.length,
    steps: stepStats,
  });
});

// ─── GET /capacity - capacity planning data ───────────────────────────────────

router.get('/capacity', (req, res) => {
  const workOrders = db.prepare(`
    SELECT wo.*, d.name AS department_name, d.color AS department_color, a.name AS app_name
    FROM work_orders wo
    LEFT JOIN departments d ON d.id = wo.department_id
    LEFT JOIN apps a ON a.id = wo.app_id
    WHERE wo.company_id = ? AND wo.status NOT IN ('completed', 'cancelled')
    ORDER BY wo.priority DESC, wo.scheduled_end ASC
  `).all(req.companyId);

  // Average cycle time per work order, computed in one grouped pass instead of a
  // query per work order (an N+1 that scaled with the open-work-order count).
  const avgCycleByWO = {};
  for (const r of db.prepare(`
    SELECT work_order_id,
           ${avgRunSecondsSQL('completions')} AS avg_seconds
    FROM completions
    WHERE company_id = ? AND status = 'completed' AND completed_at IS NOT NULL
      AND work_order_id IS NOT NULL
    GROUP BY work_order_id
  `).all(req.companyId)) {
    // Same definition of "how long a run took" the rest of the product uses, so
    // a planning number cannot silently disagree with the runs behind it.
    avgCycleByWO[r.work_order_id] = r.avg_seconds == null ? null : r.avg_seconds / 60;
  }

  const enriched = workOrders.map(wo => {
    const avgMinutes = avgCycleByWO[wo.id];

    const avgCycleMinutes = avgMinutes
      ? Math.round(avgMinutes * 10) / 10
      : (wo.takt_time_minutes || 20);

    const remaining = Math.max(0, wo.quantity - wo.quantity_completed);
    const hoursRequired = (remaining * avgCycleMinutes) / 60;

    let daysRemaining = null;
    if (wo.scheduled_end) {
      const end = new Date(wo.scheduled_end);
      const now = new Date();
      daysRemaining = Math.max(0, Math.ceil((end - now) / (1000 * 60 * 60 * 24)));
    }

    const operatorsNeeded = daysRemaining && daysRemaining > 0
      ? Math.round((hoursRequired / (daysRemaining * 8)) * 10) / 10
      : Math.round((hoursRequired / 8) * 10) / 10;

    const dailyHours = Math.round((hoursRequired / Math.max(1, daysRemaining ?? 1)) * 10) / 10;

    return {
      id: wo.id,
      work_order_number: wo.work_order_number,
      part_name: wo.part_name,
      part_number: wo.part_number,
      quantity: wo.quantity,
      quantity_completed: wo.quantity_completed,
      remaining,
      takt_time_minutes: wo.takt_time_minutes,
      avg_cycle_minutes: avgCycleMinutes,
      hours_required: Math.round(hoursRequired * 10) / 10,
      daily_hours: dailyHours,
      operators_needed_8h: operatorsNeeded,
      days_remaining: daysRemaining,
      scheduled_end: wo.scheduled_end,
      priority: wo.priority,
      status: wo.status,
      department_id: wo.department_id || null,
      department_name: wo.department_name || 'Unassigned',
      department_color: wo.department_color || '#6b7280',
    };
  });

  // Lay each work order's remaining hours out across the days until its due
  // date (overdue work lands entirely on today), so demand can be compared
  // against real headcount per day over the planning horizon.
  const HORIZON_DAYS = 14;
  const days = [];
  {
    // Column zero is today where the plant is. Walking the calendar with
    // setDate() on a `new Date()` counts in the SERVER's timezone and then reads
    // the result back as UTC, which slides the whole grid a day on a host that
    // is not itself on UTC.
    const start = new Date(`${plantToday(req.companyId)}T00:00:00Z`);
    for (let i = 0; i < HORIZON_DAYS; i++) {
      const d = new Date(start);
      d.setUTCDate(d.getUTCDate() + i);
      days.push(d.toISOString().slice(0, 10));
    }
  }

  // Aggregate demand by department *id*, not by name. Two departments can share
  // a name (or one can be renamed between a page load and a save), so a name key
  // would merge their loads into one card and — worse — leave the frontend no way
  // to write headcount back to the right row. Each card therefore carries its
  // own department_id; work orders with no department fold into one id-less
  // "Unassigned" bucket that is never editable.
  const allDepts = db.prepare('SELECT * FROM departments WHERE company_id = ? ORDER BY name').all(req.companyId);
  const blankDept = (department_id, name, color, headcount) => ({
    department_id, name, color,
    headcount: headcount || 0,
    hours_required: 0,
    work_order_count: 0,
    demand_by_day: Object.fromEntries(days.map(d => [d, 0])),
  });
  const deptMap = {};
  for (const d of allDepts) deptMap[d.id] = blankDept(d.id, d.name, d.color, d.headcount);
  let unassigned = null;

  for (const wo of enriched) {
    if (wo.hours_required <= 0) continue;
    let dept;
    if (wo.department_id && deptMap[wo.department_id]) {
      dept = deptMap[wo.department_id];
    } else {
      if (!unassigned) unassigned = blankDept(null, 'Unassigned', '#6b7280', 0);
      dept = unassigned;
    }
    dept.hours_required += wo.hours_required;
    dept.work_order_count += 1;

    const spreadDays = Math.min(HORIZON_DAYS, Math.max(1, wo.days_remaining ?? 1));
    const perDay = wo.hours_required / spreadDays;
    for (let i = 0; i < spreadDays; i++) dept.demand_by_day[days[i]] += perDay;
  }

  const departments = [...Object.values(deptMap), ...(unassigned ? [unassigned] : [])]
    .filter(d => d.work_order_count > 0 || d.headcount > 0)
    .map(d => {
      const availablePerDay = d.headcount * 8;
      const demandDays = days.map(day => ({ date: day, hours: Math.round(d.demand_by_day[day] * 10) / 10 }));
      const peakHours = Math.max(0, ...demandDays.map(x => x.hours));
      const peakUtilization = availablePerDay > 0 ? Math.round((peakHours / availablePerDay) * 100) : (peakHours > 0 ? null : 0);
      const operatorsGap = Math.ceil(peakHours / 8) - d.headcount;
      const status =
        (availablePerDay === 0 && peakHours > 0) || (peakUtilization !== null && peakUtilization > 100) ? 'over' :
        peakUtilization !== null && peakUtilization >= 85 ? 'tight' : 'ok';
      return {
        department_id: d.department_id,
        name: d.name,
        color: d.color,
        headcount: d.headcount,
        hours_required: Math.round(d.hours_required * 10) / 10,
        work_order_count: d.work_order_count,
        available_hours_per_day: availablePerDay,
        demand_by_day: demandDays,
        peak_day_hours: Math.round(peakHours * 10) / 10,
        peak_utilization_pct: peakUtilization,
        operators_gap: operatorsGap,
        status,
      };
    });

  // Plant-wide demand timeline, one stacked segment per department. The segment
  // is keyed by department_id (falling back to the name for the id-less
  // Unassigned bucket) so two same-named departments stay distinct series
  // instead of one overwriting the other.
  const timeline = days.map(day => {
    const row = { date: day };
    for (const d of departments) {
      const segKey = d.department_id || d.name;
      const hours = d.demand_by_day.find(x => x.date === day)?.hours ?? 0;
      if (hours > 0 || d.work_order_count > 0) row[segKey] = hours;
    }
    return row;
  });

  const totalHeadcount = departments.reduce((s, d) => s + d.headcount, 0);
  const totalAvailablePerDay = totalHeadcount * 8;
  const plantPeak = Math.max(0, ...timeline.map(row =>
    Object.entries(row).reduce((s, [k, v]) => k === 'date' ? s : s + v, 0)
  ));

  res.json({
    work_orders: enriched,
    summary: {
      total_hours_required: Math.round(enriched.reduce((s, wo) => s + wo.hours_required, 0) * 10) / 10,
      total_operators_needed_8h: Math.round(enriched.reduce((s, wo) => s + wo.operators_needed_8h, 0) * 10) / 10,
      total_headcount: totalHeadcount,
      total_available_hours_per_day: totalAvailablePerDay,
      plant_peak_day_hours: Math.round(plantPeak * 10) / 10,
      plant_peak_utilization_pct: totalAvailablePerDay > 0 ? Math.round((plantPeak / totalAvailablePerDay) * 100) : null,
      horizon_days: HORIZON_DAYS,
      timeline,
      departments,
    },
  });
});

// ─── GET /completion/:id - detailed single completion with step breakdown ──────

router.get('/completion/:id', (req, res) => {
  const completion = db.prepare('SELECT * FROM completions WHERE id = ? AND company_id = ?').get(req.params.id, req.companyId);
  if (!completion) return res.status(404).json({ error: 'Completion not found' });

  // Fetch app steps to map step index to name and takt_time
  const app = db.prepare('SELECT id, name, steps FROM apps WHERE id = ? AND company_id = ?').get(completion.app_id, req.companyId);
  const appSteps = app ? JSON.parse(app.steps) : [];

  const stepTimes       = JSON.parse(completion.step_times || '{}');
  const taktExceeded    = JSON.parse(completion.takt_exceeded_steps || '[]');
  const data            = JSON.parse(completion.data || '{}');

  // Every duration on this page comes from backend/src/cycleTime.js, the one
  // place that decides how long a run took. This endpoint used to hold the step
  // times and never send a total, so Completion Detail printed "Total Duration
  // —" over a run whose steps it was already listing, one click after App
  // History had printed the very same seconds as a real number.
  const durations = runDurations(completion);

  // Build per-step breakdown, in the shape the page renders: seconds in every
  // field name, and null — not zero — wherever a step went unmeasured or the
  // app never configured a takt for it.
  const stepBreakdown = appSteps.map((step, idx) => {
    const raw = stepTimes[idx] ?? stepTimes[String(idx)];
    const durationSeconds = roundSeconds(Number.isFinite(Number(raw)) ? Number(raw) : null);
    const taktSeconds = stepTaktSeconds(step);
    const variancePct = (taktSeconds && durationSeconds != null)
      ? Math.round(((durationSeconds - taktSeconds) / taktSeconds) * 100)
      : null;
    return {
      step_id:          step.id ?? String(idx),
      step_index:       idx,
      step_order:       idx + 1,
      step_name:        step.name,
      /** Seconds, or null when this step was never timed. */
      duration_seconds: durationSeconds,
      /** Seconds, or null when no takt was ever configured for this step. */
      takt_seconds:     taktSeconds,
      variance_pct:     variancePct,
      // No takt ⇒ no verdict. Painting an untargeted step green or red states a
      // judgement nobody ever set a target for.
      status:           variancePct === null ? 'unknown'
                        : variancePct <= 0 ? 'under'
                        : variancePct <= 10 ? 'on_target' : 'over',
      takt_exceeded:    taktExceeded.includes(idx) || taktExceeded.includes(String(idx)),
      pct_of_takt:      (taktSeconds && durationSeconds != null)
                          ? Math.round((durationSeconds / taktSeconds) * 100) : null,
      // Legacy field names, kept for anything already reading them.
      takt_time:        taktSeconds,
      actual_time:      durationSeconds,
    };
  });

  // Work order info if linked. Tenant-scoped: a completion's work_order_id is
  // written company-checked, but the read must not rely on that.
  let workOrder = null;
  if (completion.work_order_id) {
    workOrder = db.prepare(`
      SELECT wo.*, d.name AS department_name, d.color AS department_color
      FROM work_orders wo
      LEFT JOIN departments d ON d.id = wo.department_id
      WHERE wo.id = ? AND wo.company_id = ?
    `).get(completion.work_order_id, req.companyId);
  }

  // The page had a station UUID where the station's name belongs — the id is
  // the join key, not something to show a person.
  const station = completion.station_id
    ? db.prepare('SELECT id, name, location FROM stations WHERE id = ? AND company_id = ?')
        .get(completion.station_id, req.companyId)
    : null;

  // Other runs of the same app, so the page can put this one in context. Same
  // canonical duration as every other screen, so a run cannot read one way here
  // and another way in App History.
  const relatedCompletions = db.prepare(`
    SELECT c.id, c.operator_name, c.started_at, c.completed_at, c.status,
           ${runSecondsSQL('c')} AS total_duration_seconds,
           ${runBasisSQL('c')}   AS duration_basis
    FROM completions c
    WHERE c.app_id = ? AND c.company_id = ?
    ORDER BY datetime(COALESCE(c.completed_at, c.started_at)) DESC
    LIMIT 6
  `).all(completion.app_id, req.companyId).map(r => ({
    ...r,
    total_duration_seconds: roundSeconds(r.total_duration_seconds),
    duration_basis: r.duration_basis ?? null,
  }));

  res.json({
    ...completion,
    data,
    /** What the operator actually entered — the page's "Captured Data" grid. */
    captured_data:    data,
    step_times:       stepTimes,
    takt_exceeded_steps: taktExceeded,
    step_breakdown:   stepBreakdown,
    /** The canonical run duration. See backend/src/cycleTime.js for the model. */
    total_duration_seconds: durations.duration_seconds,
    /** 'hands_on' | 'elapsed' | null — which measurement the total above is. */
    duration_basis:   durations.duration_basis,
    hands_on_seconds: durations.hands_on_seconds,
    elapsed_seconds:  durations.elapsed_seconds,
    elapsed_so_far_seconds: durations.elapsed_so_far_seconds,
    /** Whole minutes, kept for anything already reading it. Do not render it. */
    cycle_time_minutes: durations.elapsed_seconds == null
      ? null : Math.round(durations.elapsed_seconds / 60),
    app_name:         app?.name || completion.app_name,
    station_id:       completion.station_id,
    station_name:     station?.name ?? null,
    station_location: station?.location ?? null,
    work_order:       workOrder,
    work_order_number: workOrder?.work_order_number ?? null,
    related_completions: relatedCompletions,
  });
});

// ─── GET /daily-brief — cross-module morning briefing for the dashboard ──────
//
// Scope: ?department_id and ?app_id — the Command Center's page filter. Every
// number and every list below honours both, so the page can never show a
// department's KPI tiles next to a plant-wide attention list.
//
// Rows that carry no value for a filtered dimension are set aside rather than
// filed under whichever department or app happens to be on screen (the same
// rule the completion filter above follows). Low stock, late POs and — under an
// app filter — down stations have no such dimension at all, so they can only be
// set aside; `attention_plant_wide_hidden` counts exactly how many, and the
// Command Center says so on screen instead of quietly dropping them.

router.get('/daily-brief', (req, res) => {
  const cid = req.companyId;
  // The plant's day, not Greenwich's: bound to both sides of every "today"
  // comparison so a second-shift crew's counters don't reset mid-shift.
  const day = plantDayShift(cid);
  const planRow = db.prepare('SELECT tier FROM plan WHERE company_id = ?').get(cid);
  const { config: appConfig } = require('../config');
  const isPro = appConfig.earlyAccess || (planRow && planRow.tier !== 'free');

  const deptId = req.query.department_id || null;
  const appId  = req.query.app_id || null;
  const siteId = req.query.site_id || null;
  // `scoped` drives the set-aside counting below, and site deliberately does not
  // set it: a row with no site is not ambiguous evidence the way a row with no
  // department is — it simply predates sites and stays visible under every one.
  const scoped = !!(deptId || appId);
  const cf = completionFilter(req); // no joins in the KPI queries — no alias needed

  // What the filter had to set aside for having no department / no app at all.
  let hiddenCount = 0;
  const hiddenKinds = new Set();
  const setAside = (n, kind) => { if (n > 0) { hiddenCount += n; hiddenKinds.add(kind); } };

  // ── Needs attention: everything that should change someone's plan today
  const attention = [];

  const activeWOs = db.prepare(`
    SELECT wo.*, d.name AS department_name
    FROM work_orders wo
    LEFT JOIN departments d ON d.id = wo.department_id
    WHERE wo.company_id = ? AND wo.status NOT IN ('completed', 'cancelled')
      ${siteId ? 'AND (wo.site_id = ? OR wo.site_id IS NULL)' : ''}
  `).all(cid, ...(siteId ? [siteId] : []));

  // A work order with no department is not evidence about any one department;
  // same for one with no app. It drops out of a specific scope and is counted.
  const woInScope = wo => (!deptId || wo.department_id === deptId) && (!appId || wo.app_id === appId);
  const woDimensionless = wo => (!!deptId && !wo.department_id) || (!!appId && !wo.app_id);
  const scopedWOs = activeWOs.filter(woInScope);

  // Late work orders, most urgent first (overdue before behind, then by due date)
  // and capped — a triage list a supervisor can actually work through beats a
  // hundred-row wall. Anything beyond the cap is summarised in one honest row.
  const WO_ATTENTION_CAP = 6;
  const isLate = ss => ss === 'overdue' || ss === 'behind';
  const lateWOs = scopedWOs
    .map(wo => ({ wo, ss: calcScheduleStatus(wo) }))
    .filter(({ ss }) => isLate(ss))
    .sort((a, b) =>
      (a.ss === 'overdue' ? 0 : 1) - (b.ss === 'overdue' ? 0 : 1) ||
      String(a.wo.scheduled_end ?? '').localeCompare(String(b.wo.scheduled_end ?? '')));
  if (scoped) {
    setAside(
      activeWOs.filter(wo => woDimensionless(wo) && isLate(calcScheduleStatus(wo))).length,
      'unassigned work orders',
    );
  }

  for (const { wo, ss } of lateWOs.slice(0, WO_ATTENTION_CAP)) {
    attention.push({
      type: ss === 'overdue' ? 'wo_overdue' : 'wo_behind',
      severity: ss === 'overdue' ? 'red' : 'amber',
      label: `${wo.work_order_number} · ${wo.part_name}`,
      detail: `${wo.quantity_completed}/${wo.quantity} done${wo.department_name ? ` · ${wo.department_name}` : ''} · due ${new Date(wo.scheduled_end).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`,
      link: `/schedule?highlight=${wo.id}`,
    });
  }
  if (lateWOs.length > WO_ATTENTION_CAP) {
    const rest = lateWOs.length - WO_ATTENTION_CAP;
    attention.push({
      type: 'more',
      severity: 'amber',
      label: `${rest} more work order${rest === 1 ? '' : 's'} behind schedule`,
      detail: 'Open the schedule to review them all',
      link: '/schedule',
    });
  }

  // Open help requests (Andon) — someone on the floor is waiting for a person.
  // These outrank most things: they are a human standing still.
  // A call's department is its own, falling back to its station's — the same
  // COALESCE the Andon board uses. Scoped in SQL because the list is capped:
  // filtering after the LIMIT would under-report a busy department.
  const callDeptExpr = 'COALESCE(a.department_id, s.department_id)';
  const callSiteExpr = 'COALESCE(wo.site_id, s.site_id)';
  const callScope = [
    deptId ? `${callDeptExpr} = ?` : null,
    appId  ? 'a.app_id = ?' : null,
    siteId ? `(${callSiteExpr} = ? OR ${callSiteExpr} IS NULL)` : null,
  ].filter(Boolean);
  // dept, then app, then site — the same order every scoped query binds them in
  const scopeParams = [deptId, appId, siteId].filter(Boolean);
  const openCalls = db.prepare(`
    SELECT a.id, a.team, a.type, a.target_type, a.status, a.title, a.step_name, a.created_by,
           a.department_id, d.name AS department_name, s.name AS station_name,
           wo.work_order_number, ap.name AS app_name, a.assigned_to, a.acknowledged_by,
           CAST((julianday('now') - julianday(a.created_at)) * 86400 AS INTEGER) AS age_seconds
    FROM andon_calls a
    LEFT JOIN departments d  ON d.id  = a.department_id
    LEFT JOIN stations s     ON s.id  = a.station_id
    LEFT JOIN work_orders wo ON wo.id = a.work_order_id
    LEFT JOIN apps ap        ON ap.id = a.app_id
    WHERE a.company_id = ? AND a.status IN ('open', 'acknowledged')
      ${callScope.length ? 'AND ' + callScope.join(' AND ') : ''}
    ORDER BY a.created_at ASC LIMIT 20
  `).all(cid, ...scopeParams);
  if (scoped) {
    const missing = [
      deptId ? `${callDeptExpr} IS NULL` : null,
      appId  ? 'a.app_id IS NULL' : null,
    ].filter(Boolean);
    setAside(db.prepare(`
      SELECT COUNT(*) AS c FROM andon_calls a
      LEFT JOIN stations s ON s.id = a.station_id
      WHERE a.company_id = ? AND a.status IN ('open', 'acknowledged') AND (${missing.join(' OR ')})
    `).get(cid).c, 'unrouted help requests');
  }
  for (const c of openCalls) {
    const team = andonTeamOf(c);
    const isDept = c.target_type === 'department' && !!c.department_name;
    const targetLabel = isDept ? c.department_name : andonTeamLabel(team);
    const mins = Math.max(0, Math.round((c.age_seconds ?? 0) / 60));
    const location = c.station_name || (isDept ? '' : c.department_name) || '';
    const responder = c.assigned_to || c.acknowledged_by || '';
    attention.push({
      type: 'andon_call',
      severity: c.status === 'open' ? 'red' : 'amber',
      label: `${targetLabel} needed${location ? ` · ${location}` : ''}`,
      detail: [
        c.status === 'open' ? `waiting ${mins}m` : `${responder || 'Someone'} on the way · ${mins}m`,
        c.work_order_number && `WO ${c.work_order_number}`,
        c.app_name && c.step_name ? `${c.app_name} · ${c.step_name}` : c.app_name,
        c.created_by && `raised by ${c.created_by}`,
      ].filter(Boolean).join(' · '),
      link: isDept ? `/andon?department_id=${c.department_id}` : `/andon?team=${team}`,
      team,
      team_label: andonTeamLabel(team),
      target_type: isDept ? 'department' : 'team',
      target_label: targetLabel,
      department_id: isDept ? c.department_id : null,
      call_id: c.id,
      call_status: c.status,
      age_minutes: mins,
      location,
    });
  }

  // Capped and ordered: longest-down first, so the list stays a triage list.
  // A station belongs to a department but to no app — under an app filter the
  // whole category is set aside rather than shown as if it were that app's.
  const downStations = appId ? [] : db.prepare(`
    SELECT id, name, current_status, current_status_since FROM stations
    WHERE company_id = ? AND current_status = 'down'${deptId ? ' AND department_id = ?' : ''}
      ${siteId ? 'AND (site_id = ? OR site_id IS NULL)' : ''}
    ORDER BY current_status_since ASC LIMIT 10
  `).all(cid, ...(deptId ? [deptId] : []), ...(siteId ? [siteId] : []));
  if (scoped) {
    // Under an app filter every down station is set aside (a station has no app),
    // narrowed to the chosen department when there is one. Under a department
    // filter alone only the stations that belong to no department are set aside.
    const downHidden = appId
      ? (deptId ? ' AND department_id = ?' : '')
      : ' AND department_id IS NULL';
    setAside(db.prepare(`
      SELECT COUNT(*) AS c FROM stations
      WHERE company_id = ? AND current_status = 'down'${downHidden}
    `).get(cid, ...(appId && deptId ? [deptId] : [])).c,
    appId ? 'down stations' : 'stations with no department');
  }
  for (const st of downStations) {
    const mins = st.current_status_since ? Math.floor((Date.now() - new Date(st.current_status_since).getTime()) / 60000) : null;
    attention.push({
      type: 'station_down',
      severity: 'red',
      label: `${st.name} is down`,
      detail: mins !== null ? `for ${mins >= 60 ? `${Math.floor(mins / 60)}h ${mins % 60}m` : `${mins}m`}` : '',
      link: `/stations/${st.id}`,
    });
  }

  if (isPro) {
    // An NCR's department comes from its work order, falling back to the
    // department its app belongs to; its app from the NCR itself, falling back
    // to its work order's.
    const ncrDeptExpr = 'COALESCE(wo.department_id, ap.department_id)';
    const ncrAppExpr  = 'COALESCE(n.app_id, wo.app_id)';
    const ncrSiteExpr = 'wo.site_id';
    const ncrScope = [
      deptId ? `${ncrDeptExpr} = ?` : null,
      appId  ? `${ncrAppExpr} = ?` : null,
      siteId ? `(${ncrSiteExpr} = ? OR ${ncrSiteExpr} IS NULL)` : null,
    ].filter(Boolean);
    const criticalNCRs = db.prepare(`
      SELECT n.id, n.ncr_number, n.title, n.due_date
      FROM ncrs n
      LEFT JOIN work_orders wo ON wo.id = n.work_order_id
      LEFT JOIN apps ap        ON ap.id = COALESCE(n.app_id, wo.app_id)
      WHERE n.company_id = ? AND n.severity = 'critical' AND n.status NOT IN ('resolved', 'closed')
        ${ncrScope.length ? 'AND ' + ncrScope.join(' AND ') : ''}
      ORDER BY n.created_at DESC LIMIT 10
    `).all(cid, ...scopeParams);
    if (scoped) {
      const missing = [
        deptId ? `${ncrDeptExpr} IS NULL` : null,
        appId  ? `${ncrAppExpr} IS NULL` : null,
      ].filter(Boolean);
      setAside(db.prepare(`
        SELECT COUNT(*) AS c FROM ncrs n
        LEFT JOIN work_orders wo ON wo.id = n.work_order_id
        LEFT JOIN apps ap        ON ap.id = COALESCE(n.app_id, wo.app_id)
        WHERE n.company_id = ? AND n.severity = 'critical' AND n.status NOT IN ('resolved', 'closed')
          AND (${missing.join(' OR ')})
      `).get(cid).c, 'unlinked critical NCRs');
    }
    for (const n of criticalNCRs) {
      attention.push({
        type: 'ncr_critical',
        severity: 'red',
        label: `${n.ncr_number} · ${n.title}`,
        detail: n.due_date ? `critical NCR · due ${new Date(n.due_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}` : 'critical NCR',
        link: `/quality/${n.id}`,
      });
    }

    // Stock and purchasing carry neither a department nor an app. There is no
    // honest way to show them under a narrowed scope, so they are set aside and
    // counted — the page tells the manager they exist.
    const lowStock = scoped ? [] : db.prepare(`
      SELECT i.id, i.sku, i.name, i.reorder_point, COALESCE(SUM(sl.quantity), 0) as on_hand
      FROM items i
      LEFT JOIN stock_levels sl ON sl.item_id = i.id
      WHERE i.company_id = ? AND i.is_active = 1 AND i.reorder_point > 0
      GROUP BY i.id
      HAVING on_hand <= i.reorder_point
      ORDER BY (on_hand / i.reorder_point) ASC
      LIMIT 10
    `).all(cid);
    if (scoped) {
      setAside(db.prepare(`
        SELECT COUNT(*) AS c FROM (
          SELECT i.id, i.reorder_point, COALESCE(SUM(sl.quantity), 0) as on_hand
          FROM items i
          LEFT JOIN stock_levels sl ON sl.item_id = i.id
          WHERE i.company_id = ? AND i.is_active = 1 AND i.reorder_point > 0
          GROUP BY i.id
          HAVING on_hand <= i.reorder_point
        )
      `).get(cid).c, 'low stock');
    }
    for (const item of lowStock) {
      attention.push({
        type: 'stock_low',
        severity: item.on_hand <= 0 ? 'red' : 'amber',
        label: `${item.sku} · ${item.name}`,
        detail: `${item.on_hand} on hand (reorder at ${item.reorder_point})`,
        link: `/inventory/${item.id}`,
      });
    }

    const latePOs = scoped ? [] : db.prepare(`
      SELECT po.id, po.po_number, po.expected_date, v.name AS vendor_name
      FROM purchase_orders po
      LEFT JOIN vendors v ON v.id = po.vendor_id
      WHERE po.company_id = ? AND po.status IN ('sent', 'partial') AND po.expected_date < date('now', ?)
      ORDER BY po.expected_date ASC LIMIT 10
    `).all(cid, day);
    if (scoped) {
      setAside(db.prepare(`
        SELECT COUNT(*) AS c FROM purchase_orders po
        WHERE po.company_id = ? AND po.status IN ('sent', 'partial') AND po.expected_date < date('now', ?)
      `).get(cid, day).c, 'late purchase orders');
    }
    for (const po of latePOs) {
      attention.push({
        type: 'po_late',
        severity: 'amber',
        label: `${po.po_number}${po.vendor_name ? ` · ${po.vendor_name}` : ''}`,
        detail: `expected ${new Date(po.expected_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}, not received`,
        link: `/purchasing?highlight=${po.id}`,
      });
    }
  }

  // Red before amber; within a band, a team call outranks everything else —
  // someone is standing at a machine waiting for a person.
  const attnRank = i => (i.severity === 'red' ? 0 : 2) + (i.type === 'andon_call' ? 0 : 1);
  attention.sort((a, b) => attnRank(a) - attnRank(b));

  // ── KPIs with deltas
  const completedToday = db.prepare(`
    SELECT COUNT(*) as c FROM completions
    WHERE company_id = ? AND status='completed' AND date(completed_at, ?)=date('now', ?)${cf.clause}
  `).get(cid, day, day, ...cf.params).c;
  // ── "vs the 7-day average" — over the days the plant actually ran ──────────
  //
  // The divisor used to be a flat 7. A company three days old, or a plant that
  // runs Monday to Wednesday, therefore had four or five ZERO days folded into
  // its own baseline: the average came out roughly half of what the plant
  // really does in a day, and today read "+108% vs 7-day average" on an
  // entirely ordinary shift. Nobody can see that number is wrong.
  //
  // So the baseline is output per DAY WITH OUTPUT — a plant day on which
  // anything at all was finished — and the payload says how many days that was,
  // so a reader can judge it. Fewer than two such days is not an average and is
  // reported as null with the reason, never as a percentage.
  const weekAvgRow = db.prepare(`
    SELECT COUNT(*) AS runs, COUNT(DISTINCT date(completed_at, ?)) AS days
    FROM completions
    WHERE company_id = ? AND status='completed' AND date(completed_at, ?) >= date('now', ?, '-7 days') AND date(completed_at, ?) < date('now', ?)${cf.clause}
  `).get(day, cid, day, day, day, day, ...cf.params);
  const weekDays = weekAvgRow?.days || 0;
  const weekAvg = weekDays > 0 ? (weekAvgRow.runs / weekDays) : 0;
  const MIN_BASELINE_DAYS = 2;
  const vsAvgReason = weekDays < MIN_BASELINE_DAYS
    ? (weekDays === 0
      ? 'nothing was finished in the seven days before today'
      : 'only one day in the last seven has any output — not yet an average')
    : null;
  const vsAvgPct = (!vsAvgReason && weekAvg > 0)
    ? Math.round(((completedToday - weekAvg) / weekAvg) * 100)
    : null;

  const activeNow = db.prepare(`
    SELECT COUNT(*) as c FROM completions
    WHERE company_id = ? AND status='in_progress'${cf.clause}
  `).get(cid, ...cf.params).c;

  const pfRows = db.prepare(`
    SELECT data FROM completions
    WHERE company_id = ? AND status='completed' AND completed_at >= datetime('now', '-7 days')${cf.clause}
  `).all(cid, ...cf.params);
  let pass = 0, fail = 0;
  for (const row of pfRows) {
    const vals = Object.values(JSON.parse(row.data));
    if (vals.some(v => v === 'Fail')) fail++;
    else if (vals.some(v => v === 'Pass')) pass++;
  }
  const passRate7d = (pass + fail) > 0 ? Math.round((pass / (pass + fail)) * 100) : null;

  const woSummary = { on_track: 0, completed: 0, total: 0 };
  for (const wo of scopedWOs) {
    const ss = calcScheduleStatus(wo);
    woSummary.total++;
    if (ss === 'on_track' || ss === 'completed') woSummary.on_track++;
  }
  const scheduleAdherence = woSummary.total > 0 ? Math.round((woSummary.on_track / woSummary.total) * 100) : null;

  // ── Due in the next 48 hours
  const dueSoon = scopedWOs
    .filter(wo => {
      if (!wo.scheduled_end) return false;
      const hours = (new Date(wo.scheduled_end) - Date.now()) / 3600000;
      return hours <= 48; // includes already-late WOs
    })
    .map(wo => ({
      id: wo.id,
      work_order_number: wo.work_order_number,
      part_name: wo.part_name,
      department_name: wo.department_name,
      quantity: wo.quantity,
      quantity_completed: wo.quantity_completed,
      completion_pct: wo.quantity > 0 ? Math.round((wo.quantity_completed / wo.quantity) * 100) : 0,
      scheduled_end: wo.scheduled_end,
      priority: wo.priority,
      schedule_status: calcScheduleStatus(wo),
    }))
    .sort((a, b) => new Date(a.scheduled_end) - new Date(b.scheduled_end))
    .slice(0, 8);

  // ── 7-day throughput with the week's average for a reference line
  const throughput = db.prepare(`
    SELECT date(completed_at, ?) as date, COUNT(*) as count
    FROM completions
    WHERE company_id = ? AND status='completed' AND date(completed_at, ?) >= date('now', ?, '-6 days')${cf.clause}
    GROUP BY 1
    ORDER BY date ASC
  `).all(day, cid, day, day, ...cf.params);
  const days7 = [];
  {
    // The last bar is today's, and it must carry the same number as the
    // "Completed Today" KPI above it — so both the buckets and these labels are
    // plant days, walked in UTC arithmetic so no server clock can shift them.
    const end = new Date(`${plantToday(cid)}T00:00:00Z`);
    for (let i = 6; i >= 0; i--) {
      const d = new Date(end);
      d.setUTCDate(d.getUTCDate() - i);
      const key = d.toISOString().slice(0, 10);
      days7.push({ date: key, count: throughput.find(t => t.date === key)?.count ?? 0 });
    }
  }

  res.json({
    // Echoed so the client can prove what the server actually applied instead of
    // assuming a parameter it sent was honoured.
    scope: { department_id: deptId, app_id: appId },
    attention,
    attention_plant_wide_hidden: hiddenCount,
    attention_plant_wide_kinds: [...hiddenKinds],
    kpis: {
      completed_today: completedToday,
      vs_7day_avg_pct: vsAvgPct,
      /** How many of the seven days before today the baseline is built from —
       *  days the plant finished anything, not calendar days. */
      vs_7day_sample_days: weekDays,
      /** Why the comparison is null, when it is. Printed instead of a bare dash. */
      vs_7day_reason: vsAvgReason,
      active_now: activeNow,
      pass_rate_7d: passRate7d,
      schedule_adherence: scheduleAdherence,
      work_orders_on_track: woSummary.on_track,
      work_orders_total: woSummary.total,
    },
    due_soon: dueSoon,
    throughput_7d: days7,
    /** Output per day WITH output over the last seven days — the same baseline
     *  vs_7day_avg_pct is measured against, and 0 when nothing ran at all. */
    week_avg_per_day: Math.round(weekAvg * 10) / 10,
    week_avg_basis: 'days with any completion in the last 7',
    is_pro: !!isPro,
  });
});

// ─── GET /department/:id — live drill-down for one department ────────────────

router.get('/department/:id', (req, res) => {
  const cid = req.companyId;
  const dept = db.prepare('SELECT * FROM departments WHERE id = ? AND company_id = ?').get(req.params.id, cid);
  if (!dept) return res.status(404).json({ error: 'Department not found' });

  // Completions attribute to a department via their work order, falling back
  // to their station's department when run without a work order.
  const DEPT_COMPLETION_JOIN = `
    FROM completions c
    LEFT JOIN work_orders wo ON wo.id = c.work_order_id
    LEFT JOIN stations st    ON st.id = c.station_id
    WHERE c.company_id = ? AND COALESCE(wo.department_id, st.department_id) = ?
  `;

  // ── The five shared numbers, for this department ───────────────────────────
  // From src/plantTruth.js, so this page and the Command Center cannot report
  // different departments. The windows are this page's own (all-time average, a
  // 7-day pass rate) and unchanged — what is shared is how each is measured and
  // which day "today" is.
  const ctx = plantTruth.plantContext(cid);
  const scope = plantTruth.resolveScope(ctx, { departmentId: dept.id });

  // Work orders for this department, each carrying the one schedule status —
  // selected once and handed to the snapshot rather than selected again by it.
  const woStates = plantTruth.workOrderStates(ctx, scope);
  const snapshot = plantTruth.snapshotOf(ctx, scope, { workOrderStates: woStates });

  const completedToday = snapshot.finished_today;
  const activeNow      = snapshot.running_now;

  // Seconds, for the same reason as /overview — see the note there.
  const cycle = plantTruth.avgCycle(ctx, scope, 'all');
  const avgCycleSeconds = cycle.seconds;
  const avgCycleTime = avgCycleSeconds === null ? null : Math.round(cycle.raw / 60);

  const quality = plantTruth.passRate(ctx, scope, '7d');
  const passRate = quality.rate;
  const workOrders = woStates.rows.slice()
    .sort((a, b) => String(a.scheduled_end || '').localeCompare(String(b.scheduled_end || '')));
  // The page's existing pair: on track OR already finished, over every
  // non-cancelled order. The canonical pair (open orders only) ships beside it.
  const wosOnTrack = woStates.counts.on_track + woStates.counts.completed;

  // Stations in this department with live state. The per-station "active run"
  // and "current app name" lookups are done in one grouped pass each rather than
  // two queries per station (an N+1); calcOEE stays per-station as it reads that
  // station's own live event/completion history.
  const stationRows = db.prepare('SELECT * FROM stations WHERE company_id = ? AND department_id = ? ORDER BY name').all(cid, dept.id);
  const stationIds = stationRows.map(s => s.id);

  const activeByStation = {};
  if (stationIds.length) {
    const ph = stationIds.map(() => '?').join(',');
    // Ordered newest-first; the first row seen per station is its latest run.
    for (const r of db.prepare(`
      SELECT id, station_id, operator_name, app_name, started_at
      FROM completions
      WHERE company_id = ? AND status = 'in_progress' AND station_id IN (${ph})
      ORDER BY datetime(started_at) DESC
    `).all(cid, ...stationIds)) {
      if (!activeByStation[r.station_id]) {
        activeByStation[r.station_id] = {
          id: r.id, operator_name: r.operator_name, app_name: r.app_name, started_at: r.started_at,
        };
      }
    }
  }

  const currentAppIds = [...new Set(stationRows.map(s => s.current_app_id).filter(Boolean))];
  const appNameById = {};
  if (currentAppIds.length) {
    const ph = currentAppIds.map(() => '?').join(',');
    for (const a of db.prepare(`SELECT id, name FROM apps WHERE company_id = ? AND id IN (${ph})`).all(cid, ...currentAppIds)) {
      appNameById[a.id] = a.name;
    }
  }

  const stations = stationRows.map(st => ({
    id: st.id,
    name: st.name,
    location: st.location,
    status: st.status,
    current_status: st.current_status || 'idle',
    current_status_since: st.current_status_since,
    current_app_id: st.current_app_id,
    current_app_name: st.current_app_id ? (appNameById[st.current_app_id] || null) : null,
    active_completion: activeByStation[st.id] || null,
    oee: calcOEE(st, ctx),
  }));

  const hourlyThroughput = db.prepare(`
    SELECT strftime('%Y-%m-%dT%H:00:00', c.completed_at) as hour, COUNT(*) as count
    ${DEPT_COMPLETION_JOIN} AND c.status='completed' AND c.completed_at >= datetime('now', '-24 hours')
    GROUP BY strftime('%Y-%m-%dT%H:00:00', c.completed_at)
    ORDER BY hour ASC
  `).all(cid, dept.id);

  const recentCompletions = db.prepare(`
    SELECT c.id, c.app_name, c.operator_name, c.status, c.started_at, c.completed_at, st.name AS station_name
    ${DEPT_COMPLETION_JOIN}
    ORDER BY datetime(COALESCE(c.completed_at, c.started_at)) DESC
    LIMIT 15
  `).all(cid, dept.id).map(c => {
    const end = c.completed_at ? new Date(c.completed_at) : new Date();
    return {
      ...c,
      completed_at: c.completed_at || c.started_at,
      duration_minutes: Math.round(((end - new Date(c.started_at)) / 60000) * 10) / 10,
    };
  });

  res.json({
    department: {
      id: dept.id, name: dept.name, color: dept.color,
      manager_name: dept.manager_name, description: dept.description,
      headcount: dept.headcount || 0,
    },
    /** The day this page is reporting, and the clock it was read on. */
    plant_date: snapshot.plant_date,
    timezone:   snapshot.timezone,
    kpis: {
      completed_today: completedToday,
      active_now:      activeNow,
      /** Pass rate over the last SEVEN DAYS — this page's window, not today's. */
      pass_rate:       passRate,
      pass_rate_sample: quality.sample,
      pass_rate_reason: quality.reason,
      pass_rate_window: quality.window,
      avg_cycle_time:  avgCycleTime,
      avg_cycle_seconds: avgCycleSeconds,
      /** 'hands_on' | 'elapsed' | 'mixed' | null — the label the tile must carry. */
      avg_cycle_basis: cycle.basis,
      avg_cycle_sample: cycle.sample,
      avg_cycle_reason: cycle.reason,
      /** This tile's average is over ALL time, not today. Named, not guessed. */
      avg_cycle_window: cycle.window,
      /** On track OR already finished, over every non-cancelled order. */
      wos_on_track:    wosOnTrack,
      wos_total:       workOrders.length,
      // ── The canonical pair, added beside them: on track out of the orders
      // still OPEN. Identical to GET /api/floor/snapshot?department_id=… .
      on_track:            snapshot.on_track,
      open_work_orders:    snapshot.open_work_orders,
      on_track_pct:        snapshot.on_track_pct,
      on_track_reason:     snapshot.on_track_reason,
      on_track_basis:      'open_work_orders',
      finished_today:      snapshot.finished_today,
      running_now:         snapshot.running_now,
    },
    stations,
    work_orders:        workOrders,
    hourly_throughput:  hourlyThroughput,
    recent_completions: recentCompletions,
  });
});

// ─── GET /station/:id — live drill-down for one station ──────────────────────

router.get('/station/:id', (req, res) => {
  const st = db.prepare(`
    SELECT s.*, d.name AS department_name, d.color AS department_color
    FROM stations s LEFT JOIN departments d ON d.id = s.department_id
    WHERE s.id = ? AND s.company_id = ?
  `).get(req.params.id, req.companyId);
  if (!st) return res.status(404).json({ error: 'Station not found' });

  const activeCompletion = db.prepare(`
    SELECT c.id, c.operator_name, c.app_name, c.app_id, c.started_at, c.work_order_id,
           wo.work_order_number, wo.part_name
    FROM completions c
    LEFT JOIN work_orders wo ON wo.id = c.work_order_id
    WHERE c.station_id = ? AND c.status = 'in_progress'
    ORDER BY datetime(c.started_at) DESC LIMIT 1
  `).get(st.id) || null;

  const currentApp = st.current_app_id ? db.prepare('SELECT id, name FROM apps WHERE id = ?').get(st.current_app_id) : null;

  const recentCompletions = db.prepare(`
    SELECT c.id, c.app_name, c.operator_name, c.status, c.started_at, c.completed_at, c.data,
           wo.work_order_number
    FROM completions c
    LEFT JOIN work_orders wo ON wo.id = c.work_order_id
    WHERE c.station_id = ?
    ORDER BY datetime(COALESCE(c.completed_at, c.started_at)) DESC
    LIMIT 20
  `).all(st.id).map(c => {
    const end = c.completed_at ? new Date(c.completed_at) : new Date();
    const vals = Object.values(JSON.parse(c.data || '{}'));
    const qc = vals.some(v => v === 'Fail') ? 'fail' : vals.some(v => v === 'Pass') ? 'pass' : null;
    return {
      id: c.id,
      app_name: c.app_name,
      operator_name: c.operator_name,
      status: c.status,
      work_order_number: c.work_order_number,
      completed_at: c.completed_at || c.started_at,
      duration_minutes: Math.round(((end - new Date(c.started_at)) / 60000) * 10) / 10,
      qc_result: qc,
    };
  });

  const recentEvents = db.prepare(`
    SELECT * FROM machine_events
    WHERE station_id = ?
    ORDER BY datetime(started_at) DESC
    LIMIT 20
  `).all(st.id);

  // This station's share of the plant's day, from the same module as every
  // other screen. The station page used to print an OEE block and a table and
  // leave the reader to count the rows for "how many today"; the tiles wave 2
  // adds read these. Work-order figures follow the station's department — a
  // station in no department has no work orders of its own, and says so with
  // zeros rather than borrowing the whole plant's.
  const snapshot = plantTruth.floorSnapshot(plantTruth.plantContext(req.companyId), { stationId: st.id });

  res.json({
    plant_date: snapshot.plant_date,
    timezone:   snapshot.timezone,
    kpis:       snapshot,
    station: {
      id: st.id,
      name: st.name,
      description: st.description,
      location: st.location,
      status: st.status,
      current_status: st.current_status || 'idle',
      current_status_since: st.current_status_since,
      department_id: st.department_id,
      department_name: st.department_name,
      department_color: st.department_color,
      planned_hours_per_day: st.planned_hours_per_day,
      ideal_cycle_seconds: st.ideal_cycle_seconds,
    },
    current_app:       currentApp,
    active_completion: activeCompletion,
    oee:               calcOEE(st),
    recent_completions: recentCompletions,
    recent_events:      recentEvents,
  });
});

module.exports = router;

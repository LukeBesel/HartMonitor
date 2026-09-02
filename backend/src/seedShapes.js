'use strict';

// ─── Shared demo-shape seeding: routings, scrap/downtime, andon escalation,   ─
// ─── app revisions, and a training override ───────────────────────────────────
//
// Two seeders need the SAME shape: the no-sign-in sandbox (src/sandbox.js,
// every visitor) and loadSampleDataForCompany (src/db.js, a real signup that
// clicks "Load sample data"). Rather than let the second copy drift from the
// first, the wave-3/4 pieces both of them need to show alive — a routed job
// with operations, coded scrap and a downtime Pareto, an andon call that
// climbed the ladder, a change-controlled app on Rev 2, and a training
// override — live here ONCE and are called from both places with the ids each
// caller already created (its own departments, stations, apps, users).
//
// Every writer below prefers the product's OWN function over a raw INSERT
// (workOrderOperations.instantiate/advance, appRevisions.publish,
// qualification.setEnforcementMode) so the seed can never drift from what
// those modules actually do. Two exceptions, both documented at the point
// they matter:
//   - reason_codes: routes/andon.js keeps its own seedReasonCodes() as a
//     module-private function, not exported, so this file carries a second
//     copy of the same default list. A test compares the two byte for byte.
//   - andon escalation on a REAL company's seeded data (loadSampleDataForCompany)
//     never calls andonEscalation.escalateOne() — that function emails and
//     webhooks whoever it resolves, and a real signup's sample data must not
//     fire either at a real customer's already-configured integration. The
//     sandbox path (nothing real is listening on a throwaway demo org) does
//     call the real function; see seedEscalatedAndonCall() below.

const { v4: uuidv4 } = require('uuid');
const db = require('./db');
const workOrderOperations = require('./workOrderOperations');
const appRevisions = require('./appRevisions');
const andonEscalation = require('./andonEscalation');
const qualification = require('./qualification');
const { logActivity } = require('./activity');
const { REASON_KIND } = require('./vocab');
const { offsetMinutes, companyTimeZone } = require('./plantDay');

// ─── Timing helpers: "N minutes ago", safe against the plant's OWN midnight ──
//
// The sandbox is always UTC, but loadSampleDataForCompany seeds into whatever
// timezone the signing company chose — so "today" for a Pareto or a WIP tile
// has to be judged on ITS clock, not the server's.
function minutesSincePlantMidnight(companyId) {
  const offset = offsetMinutes(companyTimeZone(companyId));
  const utcMinutesToday = db.prepare(
    `SELECT CAST((julianday('now') - julianday(date('now'))) * 1440 AS INTEGER) AS m`
  ).get().m;
  return ((utcMinutesToday + offset) % 1440 + 1440) % 1440;
}

/** Clamp a single desired "N minutes ago" so it never reaches back past the
 *  plant's own local midnight. Fine for a lone instant (an andon call's
 *  created_at); NOT fine for a group of durations that must stay
 *  non-overlapping and non-zero relative to EACH OTHER — see layOutAgo(). */
function safeMinutesAgo(companyId, desired) {
  const sinceMidnight = minutesSincePlantMidnight(companyId);
  return Math.max(1, Math.min(desired, sinceMidnight - 1 >= 1 ? sinceMidnight - 1 : 1));
}

const ago = m => `-${Math.max(0, Math.round(m))} minutes`;

/**
 * Lays out a station's timeline of events — each with its own duration,
 * OLDEST first — as non-overlapping, always-at-least-one-minute-long windows
 * ending `tailMin` minutes ago, scaled AS A WHOLE (never one boundary at a
 * time) to fit inside how far the plant is into today.
 *
 * Clamping each event's start and end independently (what safeMinutesAgo()
 * does, correctly, for a single instant) is wrong for a group: two starts
 * can independently clamp to the SAME value and produce a zero-length run,
 * or two events on one station can clamp into overlapping windows. Scaling
 * the whole group together preserves the property that matters — every
 * event is real, ordered, and does not collide with its neighbour — even
 * when the plant's day is only minutes old.
 *
 * @param {string} companyId
 * @param {number[]} durationsMin  minutes, OLDEST event first
 * @param {number} [tailMin]       how many minutes before "now" the newest
 *        event ends (a live board rarely shows a stop that just this second
 *        ended)
 * @returns {{startAgo: number, endAgo: number, durationMin: number}[]}
 *          same order as the input, startAgo > endAgo, non-overlapping
 */
function layOutAgo(companyId, durationsMin, tailMin = 2) {
  const gap = 1;
  const available = Math.max(durationsMin.length, minutesSincePlantMidnight(companyId) - tailMin);
  const totalNeeded = durationsMin.reduce((a, d) => a + d, 0) + gap * durationsMin.length;
  const scale = totalNeeded > available ? available / totalNeeded : 1;
  const scaled = durationsMin.map(d => Math.max(1, Math.round(d * scale)));

  // Placed newest-first (closest to `tailMin`) so a forced compression always
  // shortens the OLDEST events (least visible) rather than the most recent.
  let cursor = tailMin;
  const windows = new Array(scaled.length);
  for (let i = scaled.length - 1; i >= 0; i--) {
    const endAgo = cursor;
    const startAgo = endAgo + scaled[i];
    windows[i] = { startAgo, endAgo, durationMin: scaled[i] };
    cursor = startAgo + gap;
  }
  return windows;
}

// ─── Coded reasons (scrap / rework / downtime) ────────────────────────────────
//
// The same default list GET /api/andon/reason-codes seeds on a company's first
// read (routes/andon.js seedReasonCodes). That function only ever runs off an
// HTTP request and is not exported, so it cannot be called directly from a
// seed — reported to the coordinator as a small gap in an earlier wave (the
// fix is to export it, e.g. `router.seedReasonCodes = seedReasonCodes`).
// Until then this is a second copy of the same table, kept byte-for-byte
// identical to routes/andon.js's REASON_DEFAULTS; demo-seed-truth.test.js
// parses routes/andon.js's own source and diffs the two so they cannot drift
// without a test failing.
const REASON_DEFAULTS = Object.freeze({
  scrap: [
    ['weld_porosity', 'Weld porosity', ''],
    ['dimensional', 'Dimensional out of tolerance', ''],
    ['surface_defect', 'Surface defect', ''],
    ['material_defect', 'Material defect', ''],
    ['setup_scrap', 'Setup scrap', ''],
    ['handling_damage', 'Handling damage', ''],
  ],
  rework: [
    ['weld_repair', 'Weld repair', ''],
    ['dimensional_touch_up', 'Dimensional touch-up', ''],
    ['refinish', 'Surface refinish', ''],
    ['reassemble', 'Reassembly', ''],
    ['retest', 'Retest after adjustment', ''],
  ],
  downtime: [
    ['breakdown', 'Breakdown', 'breakdown'],
    ['changeover', 'Changeover / setup', 'setup_adjustment'],
    ['no_material', 'No material', 'minor_stop'],
    ['no_operator', 'No operator', 'minor_stop'],
    ['jam', 'Jam', 'minor_stop'],
    ['running_slow', 'Running slow', 'speed_loss'],
    ['startup_reject', 'Startup reject', 'startup_reject'],
    ['process_reject', 'Process reject', 'process_reject'],
  ],
});

/** Seeds the three default reason-code lists, exactly as a company's first
 *  GET /api/andon/reason-codes would — keyed on the company having none at all,
 *  so it is safe to call unconditionally at seed time. Returns { kind: { code:
 *  id } } so the caller can stamp scrap_reason_code_id / reason_code_id without
 *  a second query. */
function seedReasonCodes(companyId) {
  const byKindCode = {};
  for (const kind of REASON_KIND) byKindCode[kind] = {};

  const existing = db.prepare('SELECT id, kind, code FROM reason_codes WHERE company_id = ?').all(companyId);
  if (existing.length > 0) {
    for (const r of existing) byKindCode[r.kind][r.code] = r.id;
    return byKindCode;
  }

  const insert = db.prepare(`
    INSERT OR IGNORE INTO reason_codes (id, company_id, kind, code, label, loss_bucket, sort_order)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  db.transaction(() => {
    for (const kind of REASON_KIND) {
      (REASON_DEFAULTS[kind] || []).forEach(([code, label, bucket], i) => {
        const id = uuidv4();
        insert.run(id, companyId, kind, code, label, bucket, (i + 1) * 10);
        byKindCode[kind][code] = id;
      });
    }
  })();
  return byKindCode;
}

// ─── Widget index — variableName → { step_id, widget_id, type } ─────────────
// The same tiny helper sandbox.js keeps inline for its own apps, exported
// here so loadSampleDataForCompany's app (a different set of steps entirely)
// can stamp real completion_values rows too, instead of only the two callers
// that happen to have written their own copy.
function widgetIndex(steps) {
  const byVar = {};
  for (const step of steps) {
    for (const w of (step.widgets || [])) {
      const v = w.config && w.config.variableName;
      if (v) byVar[v] = { step_id: step.id, widget_id: w.id, type: w.type };
    }
  }
  return byVar;
}

/** One completion_values row per key of `data` that the app's widgets
 *  actually carry — silently skips anything the app has no widget for,
 *  which is the correct behaviour for two different apps' worth of variable
 *  names sharing one seeding function. */
function stampCompletionValues(companyId, appId, completionId, widgets, data, agoMinutes) {
  if (!widgets) return;
  const insValue = db.prepare(`
    INSERT INTO completion_values (id, completion_id, company_id, app_id, step_id, widget_id, variable_name, value_type, value_text, value_number, recorded_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now', ?))
  `);
  for (const [varName, raw] of Object.entries(data)) {
    const w = widgets[varName];
    if (!w) continue;
    let type = 'text', text = null, num = null;
    if (w.type === 'checkbox')          { type = 'boolean';   num = raw ? 1 : 0; }
    else if (w.type === 'number-input' || w.type === 'counter') { type = 'number'; num = raw; }
    else if (w.type === 'pass-fail')    { type = 'pass_fail'; text = String(raw).toLowerCase(); }
    else                                { type = 'text';      text = String(raw); }
    insValue.run(uuidv4(), completionId, companyId, appId, w.step_id, w.widget_id, varName, type, text, num, ago(agoMinutes));
  }
}

// ─── A routed job: "Bracket Line" (Cut → Weld → Paint → Inspect) ─────────────
//
// Released through workOrderOperations.instantiate()/advance() — never a
// hand-written work_order_operations row — so the seed can never drift from
// what releasing and booking a job actually do.
//
// Two things the operations model does NOT do on its own, that this function
// does explicitly, mirroring routes/completions.js's own finish path
// (~line 679: a completed run rolls its good units onto work_orders.
// quantity_completed and flips pending → in_progress):
//   1. Operation 1 (Cut)'s 50 good units are seeded as real completions
//      against op 1's own work_order_operation_id BEFORE op 1 is advance()d,
//      so "operation.quantity_completed == SUM(its runs' quantity_good)"
//      holds for op 1 exactly as it does for op 2 — not an operation with a
//      round number and no runs behind it.
//   2. work_orders.quantity_completed / status are synced by hand, because
//      nothing else here ever touches them. The figure used is the good
//      count at the operation the job is CURRENTLY standing on (12 of the
//      Weld operation's 50) — not a sum across every operation's own
//      booking, which would count the same 50 pieces once at Cut and again
//      at Weld and read the job as finished before it has reached Inspect.
//
// @param {object} opts
// @param {string} opts.tag              uniquifies the (globally-unique) work
//                                        order numbers
// @param {string} opts.deptId           department every step runs in
// @param {string|null} opts.weldAppId   app for the Weld step
// @param {string|null} opts.inspectAppId app for the Inspect step
// @param {string|null} opts.weldStationId
// @param {string|null} opts.inspectStationId
// @param {string|null} [opts.cutAppId]  app for the Cut step's own runs —
//        defaults to the Weld app, reused, since a completion's app_id can
//        never be null and this seed does not want to invent a THIRD app.
// @param {string|null} [opts.cutStationId]  defaults to the Weld station.
// @param {string} [opts.cutOperatorName]
// @param {string|null} [opts.cutOperatorUserId]
// @param {string|null} opts.siteId
// @returns {{ routingId, inProgress: {workOrderId, op1Id, op2Id},
//             justReleased: {workOrderId, op1Id} }}
function seedBracketLineRouting(companyId, opts) {
  const {
    tag, deptId, weldAppId = null, inspectAppId = null,
    weldStationId = null, inspectStationId = null, siteId = null,
    cutAppId = weldAppId, cutStationId = weldStationId,
    cutOperatorName = 'Operator', cutOperatorUserId = null,
  } = opts;

  const routingId = uuidv4();
  db.prepare(`
    INSERT INTO product_routings (id, company_id, name, description)
    VALUES (?, ?, 'Bracket Line', 'Cut, weld, paint and inspect a standard bracket.')
  `).run(routingId, companyId);

  const steps = [
    { name: 'Cut',     app_id: cutAppId,     station_id: cutStationId,   seconds: 90 },
    { name: 'Weld',    app_id: weldAppId,    station_id: weldStationId,  seconds: 365 },
    { name: 'Paint',   app_id: null,         station_id: null,           seconds: 150 },
    { name: 'Inspect', app_id: inspectAppId, station_id: inspectStationId, seconds: 65 },
  ];
  const insStep = db.prepare(`
    INSERT INTO routing_steps (id, routing_id, company_id, step_number, name, app_id, department_id, station_id, estimated_cycle_seconds)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  steps.forEach((s, i) => insStep.run(uuidv4(), routingId, companyId, i + 1, s.name, s.app_id, deptId, s.station_id, s.seconds));

  // scheduled_start/scheduled_end drive routes/workorders.js calcScheduleStatus
  // (on_track/at_risk/behind/overdue) — a column this file has to set for
  // itself: work_order_operations tracks progress per OPERATION, but the
  // schedule-status math still reads the job's own scheduled_start/
  // scheduled_end/quantity_completed, none of which workOrderOperations.
  // instantiate()/advance() ever touch. Left NULL, `new Date(null)` is the
  // Unix epoch — a job "due next week" would read as decades overdue on the
  // Command Center the moment it was released. scheduled_end mirrors due_date
  // so the two numbers the UI shows ("due next week" / schedule status) agree.
  const insWO = db.prepare(`
    INSERT INTO work_orders
      (id, work_order_number, part_number, part_name, quantity, quantity_completed,
       department_id, status, priority, due_date, scheduled_start, scheduled_end,
       customer_ref, external_id, company_id, site_id)
    VALUES (?, ?, 'BRKT-100', 'Standard Bracket', ?, 0, ?, ?, 'high',
            date('now', ?), datetime('now', ?), datetime('now', ?),
            ?, ?, ?, ?)
  `);

  // Job 1: released, will stand on operation 2 of 4 (Weld), 12 of 50 booked —
  // due next week, with the customer paperwork a planner reads off an ERP
  // row. scheduled_start is "now" (the release instant): calcScheduleStatus
  // treats ANY elapsed time against a job with zero recorded quantity as
  // "behind" (it rounds the expected-by-now quantity UP to at least one
  // unit), so the job-level quantity_completed synced below is what actually
  // keeps it reading on_track rather than behind the moment it is released.
  const wo1Id = uuidv4();
  insWO.run(wo1Id, `${tag}-WO-3001`, 50, deptId, 'in_progress', '+7 days', '+0 minutes', '+7 days', 'ACME-4471', 'ERP-1042', companyId, siteId);
  const release1 = workOrderOperations.instantiate(companyId, wo1Id, routingId);
  const op1 = release1.operations[0];   // Cut

  // Op 1's 50 good units, as real completions against op 1's own
  // work_order_operation_id, spread over the days before today — a batch
  // already finished, unlike Weld's runs, which are today's. Seeded BEFORE
  // advance() closes op 1, so its quantity_completed and the sum of these
  // runs' quantity_good are the same fact stated twice, not two numbers that
  // happen to agree.
  const cutAppRow = cutAppId
    ? db.prepare('SELECT name FROM apps WHERE id = ? AND company_id = ?').get(cutAppId, companyId)
    : null;
  if (cutAppRow) {
    const insCut = db.prepare(`
      INSERT INTO completions
        (id, app_id, app_name, station_id, operator_name, operator_user_id, work_order_id,
         work_order_operation_id, started_at, completed_at, status, data, step_times,
         quantity_good, quantity_scrap, quantity_rework, company_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now', ?), datetime('now', ?), 'completed', ?, ?, ?, 0, 0, ?)
    `);
    const batches = [10, 10, 10, 10, 10]; // 5 days, 10 a day, 50 total
    batches.forEach((good, i) => {
      const daysAgo = batches.length - i; // 5, 4, 3, 2, 1 — oldest first
      insCut.run(
        uuidv4(), cutAppId, cutAppRow.name, cutStationId, cutOperatorName, cutOperatorUserId,
        wo1Id, op1.id, `-${daysAgo} days -25 minutes`, `-${daysAgo} days`,
        JSON.stringify({ batch: i + 1, note: 'Cut to length' }),
        JSON.stringify({ 0: 55 + i * 3 }),
        good, companyId,
      );
    });
  }
  workOrderOperations.advance(companyId, op1.id, { good: 50 });
  const afterOp1 = workOrderOperations.listOperations(companyId, wo1Id);
  const op2 = afterOp1.find(o => o.sequence === 2);   // Weld
  // { good: 12, scrap: 1 } — matching the two runs seedWeldScrapRuns() books
  // against this exact operation, so quantity_scrapped is not left at 0
  // while its own runs carry real scrap.
  workOrderOperations.advance(companyId, op2.id, { good: 12, scrap: 1 });

  // Sync the job-level counters routes/completions.js's finish path would
  // have written had a real operator tapped "Complete" — see the function
  // doc comment above for why this is 12, not a sum across every operation.
  db.prepare(`
    UPDATE work_orders SET quantity_completed = ?, status = 'in_progress', updated_at = datetime('now')
    WHERE id = ? AND company_id = ?
  `).run(12, wo1Id, companyId);

  // Job 2: just released, standing on operation 1 of 4 (Cut), nothing
  // booked. scheduled_start is in the FUTURE — calcScheduleStatus reads
  // `now < scheduled_start` as 'not_started' before it ever reaches the
  // "quantity behind schedule" math, which is what a job that has not been
  // handed to anyone yet actually is.
  const wo2Id = uuidv4();
  insWO.run(wo2Id, `${tag}-WO-3002`, 20, deptId, 'pending', '+14 days', '+2 days', '+14 days', null, null, companyId, siteId);
  const release2 = workOrderOperations.instantiate(companyId, wo2Id, routingId);

  return {
    routingId,
    inProgress: { workOrderId: wo1Id, op1Id: op1.id, op2Id: op2.id },
    justReleased: { workOrderId: wo2Id, op1Id: release2.operations[0].id },
  };
}

// ─── Scrap with a coded reason, booked against operation 2 (Weld) ────────────
//
// Two runs of the app the Weld step names, each carrying real
// quantity_good/scrap/rework and work_order_operation_id — so
// "operation.quantity_completed = SUM(runs.quantity_good)" is an actual fact
// about the seed. 6 + 6 good = the 12 the operation was advance()d to; one
// run's 1 unit of scrap carries a coded reason and matches the operation's
// own quantity_scrapped.
//
// @param opts.widgets    widgetIndex(steps) for the app named by `appId` —
//        when given, each run's `data` is also written as real
//        completion_values rows (whichever keys the app actually has
//        widgets for), the same structured capture every other seeded run
//        carries.
// @returns {{ completionIds: string[] }}
function seedWeldScrapRuns(companyId, opts) {
  const {
    appId, stationId, workOrderId, workOrderOperationId, productTypeId = null,
    operatorUserId, operatorName, scrapReasonCodeId, tag = '', widgets = null,
  } = opts;

  const appRow = db.prepare('SELECT name FROM apps WHERE id = ? AND company_id = ?').get(appId, companyId);
  const appName = appRow ? appRow.name : '';

  const insCompletion = db.prepare(`
    INSERT INTO completions
      (id, app_id, app_name, station_id, operator_name, operator_user_id, work_order_id,
       product_type_id, work_order_operation_id, started_at, completed_at, status,
       data, step_times, quantity_good, quantity_scrap, quantity_rework, scrap_reason_code_id, company_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now', ?), datetime('now', ?), 'completed', ?, ?, ?, ?, ?, ?, ?)
  `);

  // Non-overlapping, always real-duration windows, scaled to fit inside
  // today even if the plant's day just started (layOutAgo — see above).
  const windows = layOutAgo(companyId, [8, 8], 16);

  const runs = [
    { good: 6, scrap: 1, rework: 0, reason: scrapReasonCodeId, serial: `${tag}-WELD-9001`, torque: 14.7 },
    { good: 6, scrap: 0, rework: 0, reason: null,              serial: `${tag}-WELD-9002`, torque: 15.1 },
  ];
  const ids = runs.map((r, i) => {
    const id = uuidv4();
    const w = windows[i];
    const data = {
      ppe_worn: true, area_clear: true,
      torque_value: r.torque, serial_number: r.serial,
      visual_ok: 'Pass', function_ok: 'Pass',
    };
    insCompletion.run(
      id, appId, appName, stationId, operatorName, operatorUserId, workOrderId, productTypeId,
      workOrderOperationId, ago(w.startAgo), ago(w.endAgo),
      JSON.stringify(data),
      JSON.stringify({ 0: 5 + i, 1: Math.max(1, w.durationMin - 1) * 60 - (5 + i) }),
      r.good, r.scrap, r.rework, r.reason, companyId,
    );
    stampCompletionValues(companyId, appId, id, widgets, data, w.endAgo);
    return id;
  });
  return { completionIds: ids };
}

// ─── Downtime across three loss buckets, on ONE of the demo's stations ─────
//
// Three finished stops, each coded, spanning breakdown / setup_adjustment /
// minor_stop — GET /api/oee/losses groups on exactly this column, so three
// coded reasons in three different buckets is what puts three named bars on
// the Pareto rather than one lumped "unclassified" bar.
//
// All three land on ONE station — the LAST one `stationIds` names — never
// split across every station given. The demo's own Station 1 is seeded
// elsewhere as the one clean, zero-downtime station its OEE story depends on
// ("Availability 100% — nothing logged at Station 1 today"); spreading these
// stops onto whichever station happens to be first in the caller's list would
// silently break that invariant the moment a caller passes Station 1 first
// (which every caller here does, since it is also the Weld station). Landing
// them all on ONE station also means one call to layOutAgo() lays all three
// out together, so none of them can ever overlap.
//
// @param opts.stationIds  the demo's stations; only the LAST one is used
// @param opts.reasonIds   { breakdown, changeover, jam } reason_codes.id (kind='downtime')
function seedDowntimePareto(companyId, { stationIds, reasonIds }) {
  const stations = stationIds.filter(Boolean);
  const station = stations[stations.length - 1] || stations[0];
  const insEvent = db.prepare(`
    INSERT INTO machine_events (id, station_id, event_type, reason, reason_code_id, started_at, ended_at, duration_minutes)
    VALUES (?, ?, 'down', ?, ?, datetime('now', ?), datetime('now', ?), ?)
  `);

  // Oldest first: Breakdown, then Changeover, then Jam — one shared layout so
  // none of the three can collide on this one station's timeline.
  const windows = layOutAgo(companyId, [22, 9, 6], 15);
  const stops = [
    { label: 'Breakdown',          reason: reasonIds.breakdown,  w: windows[0] },
    { label: 'Changeover / setup', reason: reasonIds.changeover, w: windows[1] },
    { label: 'Jam',                reason: reasonIds.jam,        w: windows[2] },
  ];
  for (const s of stops) {
    insEvent.run(uuidv4(), station, s.label, s.reason, ago(s.w.startAgo), ago(s.w.endAgo), s.w.durationMin);
  }
}

/** Codes a pre-existing, uncoded machine_events row (kind='downtime') with a
 *  reason so it joins the Pareto as a named bar instead of the "Not coded"
 *  one. Used on sandbox.js's own "Conveyor drive jam" stop, seeded before
 *  reason codes existed in this file's plan for the seed — coding it here
 *  keeps that call site a one-line addition rather than a rewrite. */
function codeDowntimeEvent(machineEventId, reasonCodeId) {
  db.prepare(`UPDATE machine_events SET reason_code_id = ? WHERE id = ?`).run(reasonCodeId, machineEventId);
}

// ─── Andon: one call that climbed the ladder, one answered inside target ────
//
// The escalated call is raised as a QUALITY call (escalate_to supervisor,
// then management) so climbing it twice is a genuine two-rung ladder: level
// 1 resolves to a real supervisor (a department_members row is written for
// them here, so the resolution has someone to find), level 2 resolves to
// company management, excluding whoever level 1 already reached. A SAFETY
// call escalates straight to management on its first rung, so a second climb
// re-resolves the exact same tier it just excluded everyone from — recipients
// come back empty, and escalateOne() logs "Nobody to escalate to" and leaves
// the call stuck at level 1 forever. Two genuinely different rungs is what a
// real two-level escalation needs.
//
// `driveLive` chooses HOW the climb is written:
//   true   drives the real andonEscalation.escalateOne() — the same function
//          the production sweep calls, so who it reaches, what gets logged
//          and what messages go out are the real product's answers. Used by
//          the sandbox, where nothing real is listening on a throwaway org.
//   false  writes only the DB rows escalateOne() would leave behind
//          (andon_calls columns, one in-app `messages` row per climb,
//          activity_log) and skips escalateOne() entirely — no outbound
//          email, no webhook delivery, no notification_log row. A real
//          signup's sample data must never fire either against a customer's
//          already-configured integration.
//
// @returns {{ escalatedCallId: string, acknowledgedCallId: string }}
function seedAndonCalls(companyId, opts) {
  const {
    deptId, stationId, raiserUserId, raiserName,
    supervisorUserId, responderUserId, responderName, driveLive = false,
  } = opts;

  // A real supervisor for the first rung to resolve to.
  if (supervisorUserId) {
    db.prepare(`
      INSERT OR IGNORE INTO department_members (id, company_id, department_id, user_id, team_role, notify_email, notify_in_app)
      VALUES (?, ?, ?, ?, 'supervisor', 1, 1)
    `).run(uuidv4(), companyId, deptId, supervisorUserId);
  }

  // ── The escalated call ──────────────────────────────────────────────────
  const escId = uuidv4();
  const createdAgo = safeMinutesAgo(companyId, 45);
  db.prepare(`
    INSERT INTO andon_calls
      (id, company_id, department_id, station_id, type, team, target_type, priority,
       status, title, description, raised_by, created_by_user_id,
       escalation_level, created_at)
    VALUES (?, ?, ?, ?, 'quality', 'quality', 'team', 'high', 'open', ?, ?, ?, ?, 0, datetime('now', ?))
  `).run(
    escId, companyId, deptId, stationId,
    'Quality needed at the weld bench', 'Suspect porosity found downstream — needs a second look before it ships',
    raiserName, raiserUserId, ago(createdAgo),
  );

  const target = andonEscalation.targetFor(companyId, 'quality', 'high');
  // Backdated far enough that the escalate window (20 minutes for quality)
  // has ALSO already elapsed by the time the second climb runs "now" — so
  // the final respond_by (the last rung never pushes it forward again)
  // lands in the past, the honest state for a call nobody has answered.
  const firstClimbAgo = Math.max(target.escalate_minutes + 5, Math.min(createdAgo - 1, 30));
  const firstClimbAt = new Date(Date.now() - firstClimbAgo * 60000);

  if (driveLive) {
    andonEscalation.escalateOne(db.prepare('SELECT * FROM andon_calls WHERE id = ?').get(escId), firstClimbAt);
    andonEscalation.escalateOne(db.prepare('SELECT * FROM andon_calls WHERE id = ?').get(escId), new Date());
  } else {
    const row = db.prepare('SELECT * FROM andon_calls WHERE id = ?').get(escId);
    const respondBy1 = new Date(firstClimbAt.getTime() + target.escalate_minutes * 60000).toISOString();

    const lvl1 = andonEscalation.resolveTier(companyId, 'supervisor', row, [raiserUserId].filter(Boolean));
    const r1 = lvl1.recipients.find(r => r.user_id) || null;
    writeEscalationState(companyId, row, {
      tier: 'supervisor', level: 1, recipientUserId: r1 && r1.user_id,
      escalatedAt: firstClimbAt.toISOString(), respondBy: respondBy1,
    });

    const exclude2 = [raiserUserId, r1 && r1.user_id].filter(Boolean);
    const managers = andonEscalation.resolveManagers(companyId, exclude2);
    const r2 = managers.find(r => r.user_id) || null;
    writeEscalationState(companyId, row, {
      tier: andonEscalation.MANAGER_TIER, level: 2, recipientUserId: r2 && r2.user_id,
      // The ladder's last rung — respond_by stays at what climb 1 set.
      escalatedAt: new Date().toISOString(), respondBy: respondBy1,
    });
  }

  // ── The acknowledged call: answered comfortably inside its target, by
  // somebody OTHER than the person who raised it ─────────────────────────
  const ackId = uuidv4();
  const ackCreatedAgo = safeMinutesAgo(companyId, 8);
  const ackRespondedAgo = Math.max(0, ackCreatedAgo - 3);
  const qualityTarget = andonEscalation.targetFor(companyId, 'quality', 'normal');
  const ackRespondBy = new Date(Date.now() - (ackCreatedAgo - qualityTarget.respond_minutes) * 60000).toISOString();
  db.prepare(`
    INSERT INTO andon_calls
      (id, company_id, department_id, station_id, type, team, target_type, priority,
       status, title, description, raised_by, created_by_user_id,
       acknowledged_by, acknowledged_by_user_id, acknowledged_at, respond_by,
       escalation_level, created_at)
    VALUES (?, ?, ?, ?, 'quality', 'quality', 'team', 'normal', 'acknowledged', ?, ?, ?, ?, ?, ?, datetime('now', ?), ?, 0, datetime('now', ?))
  `).run(
    ackId, companyId, deptId, stationId,
    'Quality needed at the pack-out bench', 'Suspect porosity — please double-check before it ships',
    raiserName, raiserUserId, responderName, responderUserId, ago(ackRespondedAgo),
    ackRespondBy, ago(ackCreatedAgo),
  );

  return { escalatedCallId: escId, acknowledgedCallId: ackId };
}

/** Persists exactly what andonEscalation.escalateOne() would persist for one
 *  climb — the andon_calls columns, one in-app message to the person
 *  reached, and one activity_log line — and NOTHING it would additionally
 *  send: no email (sendAndonAlertEmail), no notification_log row, no
 *  webhook (deliverWebhooks), no ws broadcast. See seedAndonCalls()'s
 *  `driveLive` doc comment for why. */
function writeEscalationState(companyId, call, { tier, level, recipientUserId, escalatedAt, respondBy }) {
  db.prepare(`
    UPDATE andon_calls SET escalation_level = ?, escalated_at = ?, escalated_to_user_id = ?, respond_by = ?
    WHERE id = ? AND company_id = ?
  `).run(level, escalatedAt, recipientUserId || null, respondBy, call.id, companyId);

  const label = andonEscalation.tierLabel(tier);
  const action = `Escalated to ${label} — no acknowledgement within target (level ${level})`;
  if (recipientUserId) {
    db.prepare(`
      INSERT INTO messages (id, company_id, sender_id, sender_name, sender_role, body, severity, recipient_id, created_at)
      VALUES (?, ?, NULL, ?, 'system', ?, ?, ?, ?)
    `).run(
      uuidv4(), companyId, `${label} — escalation ${level}`, action,
      call.priority === 'critical' ? 'urgent' : 'warning', recipientUserId, escalatedAt,
    );
  }
  logActivity(companyId, 'andon', call.id, action, 'System', {
    department_id: call.department_id || null, station_id: call.station_id || null,
  });
}

// ─── Two app revisions, cut through appRevisions.publish() ───────────────────
//
// requires_approval is set BEFORE either publish() call — appRevisions.
// publish() freezes the POLICY THAT APPLIED at the moment a revision was cut
// (approval_required) onto the revision row itself, not just the app; set
// after the fact, Rev 1 would freeze approval_required = 0 and permanently
// misreport that its approval was optional when it was not.
//
// @returns {{ rev1: {revision, id}, rev2: {revision, id} }}
function seedTwoRevisions(companyId, { appId, publisherUserId, approverUserId }) {
  db.prepare(`UPDATE apps SET requires_approval = 1 WHERE id = ? AND company_id = ?`).run(appId, companyId);
  const rev1 = appRevisions.publish(companyId, appId, {
    userId: publisherUserId, changeNote: 'First release', approverUserId,
  });
  const rev2 = appRevisions.publish(companyId, appId, {
    userId: publisherUserId, changeNote: 'Added torque check', approverUserId,
  });
  return { rev1, rev2 };
}

// ─── Training: one expired record, one supervisor override ───────────────────
//
// setEnforcementMode() is qualification.js's own writer, so the mode lands
// exactly as it would from the Training screen. 'block' — not 'warn' — is
// the mode the override exists for: qualification.js's enforceQualification
// only ever looks for (and spends) an override proof when `mode === 'block'
// && state !== 'certified'`; under 'warn' nothing is ever blocked, so no
// override could ever have been sought, and a completion stamped
// qualification_state = 'override' under 'warn' is a state the product
// itself cannot produce. The qualification_overrides row is written straight
// into the table in the shape qualification.js's recordOverride() writes —
// that function itself is only reachable by redeeming a live, ten-minute
// PIN-grant token, which a seed cannot honestly hold.
//
// @param opts.completionId  the trainee's OWN run — stamped
//        qualification_state = 'override' to match. Must belong to
//        operatorUserId; callers seed a dedicated completion for the
//        trainee rather than borrowing an existing run by someone else.
// @param opts.alsoCertify  [{userId, name}] — anyone else who might start
//        this app while 'block' is on (an existing test driving the app live,
//        the account that will demo it) gets a clean, current certification
//        so the block is real for the trainee and invisible to everyone else.
function seedTrainingOverride(companyId, opts) {
  const {
    appId, operatorUserId, operatorName, certifierUserId,
    supervisorUserId, supervisorName, completionId, alsoCertify = [],
  } = opts;

  qualification.setEnforcementMode(companyId, 'block');

  db.prepare(`
    INSERT INTO training_records
      (id, company_id, user_id, app_id, status, certified_date, expiry_date, certified_by, score, attempts, notes)
    VALUES (?, ?, ?, ?, 'expired', date('now', '-190 days'), date('now', '-10 days'), ?, 91, 1, 'Certification lapsed — pending refresher')
  `).run(uuidv4(), companyId, operatorUserId, appId, certifierUserId);

  const overrideId = uuidv4();
  db.prepare(`
    INSERT INTO qualification_overrides
      (id, company_id, completion_id, app_id, user_id, operator_name, approved_by_user_id, approved_by_name, reason)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'Cover for absence')
  `).run(overrideId, companyId, completionId, appId, operatorUserId, operatorName, supervisorUserId, supervisorName);

  if (completionId) {
    db.prepare(`UPDATE completions SET qualification_state = 'override' WHERE id = ? AND company_id = ?`)
      .run(completionId, companyId);
  }

  const insCert = db.prepare(`
    INSERT INTO training_records
      (id, company_id, user_id, app_id, status, certified_date, expiry_date, certified_by, score, attempts, notes)
    VALUES (?, ?, ?, ?, 'certified', date('now', '-60 days'), date('now', '+300 days'), ?, 96, 1, '')
  `);
  for (const person of alsoCertify) {
    if (!person || !person.userId) continue;
    const already = db.prepare(
      'SELECT 1 FROM training_records WHERE company_id = ? AND user_id = ? AND app_id = ?'
    ).get(companyId, person.userId, appId);
    if (already) continue;
    insCert.run(uuidv4(), companyId, person.userId, appId, certifierUserId);
  }

  return { overrideId };
}

module.exports = {
  seedReasonCodes,
  seedBracketLineRouting,
  seedWeldScrapRuns,
  seedDowntimePareto,
  codeDowntimeEvent,
  seedAndonCalls,
  seedTwoRevisions,
  seedTrainingOverride,
  widgetIndex,
  stampCompletionValues,
  minutesSincePlantMidnight,
  safeMinutesAgo,
  layOutAgo,
  REASON_DEFAULTS,
};

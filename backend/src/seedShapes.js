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
// andonEscalation.escalateOne, qualification.setEnforcementMode) so the seed
// can never drift from what those modules actually do. The exception is
// reason_codes: routes/andon.js keeps its own seedReasonCodes() as a
// module-private function, not exported, so this file carries a second copy
// of the same default list rather than reaching into the route file. See the
// comment on seedReasonCodes() below — that is a small gap in an earlier
// wave, not a decision made here.

const { v4: uuidv4 } = require('uuid');
const db = require('./db');
const workOrderOperations = require('./workOrderOperations');
const appRevisions = require('./appRevisions');
const andonEscalation = require('./andonEscalation');
const qualification = require('./qualification');
const { REASON_KIND } = require('./vocab');
const { offsetMinutes, companyTimeZone } = require('./plantDay');

// ─── Timing helper: "N minutes ago", safe against the plant's OWN midnight ────
//
// The sandbox is always UTC, but loadSampleDataForCompany seeds into whatever
// timezone the signing company chose — so "today" for a Pareto or a WIP tile
// has to be judged on ITS clock, not the server's. Everything this file seeds
// as "today" asks for at most a couple of hours ago, which is always safe
// except in the few minutes after the plant's own local midnight; clamp there
// so a seed run in that window still lands on today's plant day rather than
// spilling into yesterday's.
function minutesSincePlantMidnight(companyId) {
  const offset = offsetMinutes(companyTimeZone(companyId));
  const utcMinutesToday = db.prepare(
    `SELECT CAST((julianday('now') - julianday(date('now'))) * 1440 AS INTEGER) AS m`
  ).get().m;
  return ((utcMinutesToday + offset) % 1440 + 1440) % 1440;
}

/** Clamp a desired "N minutes ago" so it never reaches back past the plant's
 *  own local midnight — the seed's "today" events must stay on today. */
function safeMinutesAgo(companyId, desired) {
  const sinceMidnight = minutesSincePlantMidnight(companyId);
  return Math.max(1, Math.min(desired, sinceMidnight - 1 >= 1 ? sinceMidnight - 1 : 1));
}

const ago = m => `-${Math.max(0, Math.round(m))} minutes`;

// ─── Coded reasons (scrap / rework / downtime) ────────────────────────────────
//
// The same default list GET /api/andon/reason-codes seeds on a company's first
// read (routes/andon.js seedReasonCodes). That function only ever runs off an
// HTTP request and is not exported, so it cannot be called directly from a
// seed — reported to the coordinator as a small gap in an earlier wave (the
// fix is to export it, e.g. `router.seedReasonCodes = seedReasonCodes`).
// Until then this is a second copy of the same table, kept byte-for-byte
// identical to routes/andon.js's REASON_DEFAULTS so the two cannot silently
// diverge; a test compares them.
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

// ─── A routed job: "Bracket Line" (Cut → Weld → Paint → Inspect) ─────────────
//
// Released through workOrderOperations.instantiate()/advance() — never a
// hand-written work_order_operations row — so the seed can never drift from
// what releasing and booking a job actually do.
//
// @param {object} opts
// @param {string} opts.tag              uniquifies the (globally-unique) work
//                                        order numbers
// @param {string} opts.deptId           department every step runs in
// @param {string|null} opts.weldAppId   app for the Weld step (null = no app)
// @param {string|null} opts.inspectAppId app for the Inspect step
// @param {string|null} opts.weldStationId
// @param {string|null} opts.inspectStationId
// @param {string|null} opts.siteId
// @returns {{ routingId, inProgress: {workOrderId, op1Id, op2Id},
//             justReleased: {workOrderId, op1Id} }}
function seedBracketLineRouting(companyId, opts) {
  const {
    tag, deptId, weldAppId = null, inspectAppId = null,
    weldStationId = null, inspectStationId = null, siteId = null,
  } = opts;

  const routingId = uuidv4();
  db.prepare(`
    INSERT INTO product_routings (id, company_id, name, description)
    VALUES (?, ?, 'Bracket Line', 'Cut, weld, paint and inspect a standard bracket.')
  `).run(routingId, companyId);

  const steps = [
    { name: 'Cut',     app_id: null,         station_id: null,           seconds: 90 },
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
            date('now', ?), datetime('now'), datetime('now', ?),
            ?, ?, ?, ?)
  `);

  // Job 1: released, standing on operation 2 of 4 (Weld), 12 of 50 booked —
  // due next week, with the customer paperwork a planner reads off an ERP row.
  const wo1Id = uuidv4();
  insWO.run(wo1Id, `${tag}-WO-3001`, 50, deptId, 'in_progress', '+7 days', '+7 days', 'ACME-4471', 'ERP-1042', companyId, siteId);
  const release1 = workOrderOperations.instantiate(companyId, wo1Id, routingId);
  const op1 = release1.operations[0];   // Cut — no app, closes in one booking
  workOrderOperations.advance(companyId, op1.id, { good: 50 });
  const afterOp1 = workOrderOperations.listOperations(companyId, wo1Id);
  const op2 = afterOp1.find(o => o.sequence === 2);   // Weld
  workOrderOperations.advance(companyId, op2.id, { good: 12 });

  // Job 2: just released, standing on operation 1 of 4 (Cut), nothing booked.
  const wo2Id = uuidv4();
  insWO.run(wo2Id, `${tag}-WO-3002`, 20, deptId, 'pending', '+14 days', '+14 days', null, null, companyId, siteId);
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
// about the seed, not an assertion that happens to hold. 6 + 6 good = the 12
// the operation was advance()d to; one run's 1 unit of scrap carries a coded
// reason.
//
// @returns {{ completionIds: string[], scrapReasonCodeId: string }}
function seedWeldScrapRuns(companyId, opts) {
  const {
    appId, stationId, workOrderId, workOrderOperationId, productTypeId = null,
    operatorUserId, operatorName, scrapReasonCodeId,
  } = opts;

  const insCompletion = db.prepare(`
    INSERT INTO completions
      (id, app_id, app_name, station_id, operator_name, operator_user_id, work_order_id,
       product_type_id, work_order_operation_id, started_at, completed_at, status,
       data, quantity_good, quantity_scrap, quantity_rework, scrap_reason_code_id, company_id)
    VALUES (?, ?, 'Bracket Assembly', ?, ?, ?, ?, ?, ?, datetime('now', ?), datetime('now', ?), 'completed', ?, ?, ?, ?, ?, ?)
  `);

  const runs = [
    { good: 6, scrap: 1, rework: 0, reason: scrapReasonCodeId, agoStart: 42, agoEnd: 34 },
    { good: 6, scrap: 0, rework: 0, reason: null,              agoStart: 26, agoEnd: 18 },
  ];
  const ids = runs.map(r => {
    const id = uuidv4();
    insCompletion.run(
      id, appId, stationId, operatorName, operatorUserId, workOrderId, productTypeId,
      workOrderOperationId, ago(safeMinutesAgo(companyId, r.agoStart)), ago(safeMinutesAgo(companyId, r.agoEnd)),
      JSON.stringify({ torque_value: 15.0, serial_number: 'weld-run', visual_ok: 'Pass', function_ok: 'Pass' }),
      r.good, r.scrap, r.rework, r.reason, companyId,
    );
    return id;
  });
  return { completionIds: ids };
}

// ─── Downtime across three loss buckets, on the demo's own stations ─────────
//
// Three finished stops, each coded, spanning breakdown / setup_adjustment /
// minor_stop — GET /api/oee/losses groups on exactly this column, so three
// coded reasons in three different buckets is what puts three named bars on
// the Pareto rather than one lumped "unclassified" bar.
//
// @param opts.stationIds  at least one station id; stops are spread across them
// @param opts.reasonIds   { breakdown, changeover, jam } reason_codes.id (kind='downtime')
function seedDowntimePareto(companyId, { stationIds, reasonIds }) {
  const stations = stationIds.filter(Boolean);
  const at = i => stations[i % stations.length];
  const insEvent = db.prepare(`
    INSERT INTO machine_events (id, station_id, event_type, reason, reason_code_id, started_at, ended_at, duration_minutes)
    VALUES (?, ?, 'down', ?, ?, datetime('now', ?), datetime('now', ?), ?)
  `);
  const stops = [
    { label: 'Breakdown',           reason: reasonIds.breakdown,  station: at(0), agoStart: 95, mins: 22 },
    { label: 'Changeover / setup',  reason: reasonIds.changeover, station: at(0), agoStart: 55, mins: 9 },
    { label: 'Jam',                 reason: reasonIds.jam,        station: at(1), agoStart: 30, mins: 6 },
  ];
  for (const s of stops) {
    const start = safeMinutesAgo(companyId, s.agoStart);
    const end = Math.max(0, start - s.mins);
    insEvent.run(
      uuidv4(), s.station, s.label, s.reason,
      ago(start), ago(end), start - end,
    );
  }
}

// ─── Andon: one call that climbed the ladder, one answered inside target ────
//
// The escalated call is raised as an ordinary 'open' row and then handed to
// andonEscalation.escalateOne() TWICE — the SAME function the minute sweep
// calls in production — so who it reaches, what gets logged and what message
// goes out are the real product's answers, not a guess this file makes on its
// behalf.
//
// Twice, not once, and deliberately: escalateOne() always hands a
// non-final level a FRESH deadline (`respond_by` moves to `at + escalate
// window`, so the newly-alerted tier gets its own window to answer) and only
// STOPS pushing it forward at the ladder's last rung, MAX_ESCALATION_LEVEL.
// A single escalation is therefore never a call whose respond_by reads
// overdue a moment later — that would defeat the point of the fresh window.
// Escalating to the top of the ladder (passing an `at` in the past for the
// first climb, so the fresh window it grants has ALSO already elapsed by the
// second) is what leaves the call sitting exactly where the board shows a
// call nobody has answered at all: past its target, escalated, still open.
//
// @returns {{ escalatedCallId: string, acknowledgedCallId: string }}
function seedAndonCalls(companyId, opts) {
  const {
    deptId, stationId, raiserUserId, raiserName,
  } = opts;

  // ── The escalated call: a safety call nobody has answered ──────────────────
  const escId = uuidv4();
  const createdAgo = 20; // minutes ago
  db.prepare(`
    INSERT INTO andon_calls
      (id, company_id, department_id, station_id, type, team, target_type, priority,
       status, title, description, raised_by, created_by_user_id,
       escalation_level, created_at)
    VALUES (?, ?, ?, ?, 'safety', '', 'team', 'high', 'open', ?, ?, ?, ?, 0, datetime('now', ?))
  `).run(
    escId, companyId, deptId, stationId,
    'Safety needed at the weld bench', 'Guard interlock tripped — line stopped',
    raiserName, raiserUserId, ago(createdAgo),
  );
  // First climb, backdated 10 minutes: its fresh window (the safety team's
  // 5-minute escalate interval) has therefore also already elapsed by now.
  const firstClimbAt = new Date(Date.now() - 10 * 60000);
  andonEscalation.escalateOne(db.prepare('SELECT * FROM andon_calls WHERE id = ?').get(escId), firstClimbAt);
  // Second climb, at the real "now": this is the ladder's last rung
  // (MAX_ESCALATION_LEVEL), so respond_by is NOT pushed forward again — it
  // stays at the already-past instant the first climb set, which is the
  // honest "past its target" state a call nobody has answered is in.
  andonEscalation.escalateOne(db.prepare('SELECT * FROM andon_calls WHERE id = ?').get(escId), new Date());

  // ── The acknowledged call: answered comfortably inside its target
  // (quality/normal defaults to a 10-minute target; this one was answered in 3).
  const ackId = uuidv4();
  const ackCreatedAgo = 8;
  const ackRespondedAgo = 5;
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
    'Quality needed at the weld bench', 'Suspect porosity — please double-check before it ships',
    raiserName, raiserUserId, raiserName, raiserUserId, ago(ackRespondedAgo),
    ackRespondBy, ago(ackCreatedAgo),
  );

  return { escalatedCallId: escId, acknowledgedCallId: ackId };
}

// ─── Two app revisions, cut through appRevisions.publish() ───────────────────
//
// @returns {{ rev1: {revision, id}, rev2: {revision, id} }}
function seedTwoRevisions(companyId, { appId, publisherUserId, approverUserId }) {
  const rev1 = appRevisions.publish(companyId, appId, {
    userId: publisherUserId, changeNote: 'First release', approverUserId,
  });
  const rev2 = appRevisions.publish(companyId, appId, {
    userId: publisherUserId, changeNote: 'Added torque check', approverUserId,
  });
  db.prepare(`UPDATE apps SET requires_approval = 1 WHERE id = ? AND company_id = ?`).run(appId, companyId);
  return { rev1, rev2 };
}

// ─── Training: one expired record, one supervisor override ───────────────────
//
// setEnforcementMode() is qualification.js's own writer, so the 'warn' row
// lands exactly as it would from the Training screen. The override row is
// written straight into qualification_overrides in the shape
// qualification.js's recordOverride() writes — that function itself is only
// reachable by redeeming a live, ten-minute PIN-grant token, which a seed
// cannot honestly hold, so this is the same columns, filled in directly.
//
// @param opts.completionId  the run the override let through — stamped
//        qualification_state = 'override' to match.
function seedTrainingOverride(companyId, opts) {
  const {
    appId, operatorUserId, operatorName, certifierUserId,
    supervisorUserId, supervisorName, completionId,
  } = opts;

  qualification.setEnforcementMode(companyId, 'warn');

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
  return { overrideId };
}

module.exports = {
  seedReasonCodes,
  seedBracketLineRouting,
  seedWeldScrapRuns,
  seedDowntimePareto,
  seedAndonCalls,
  seedTwoRevisions,
  seedTrainingOverride,
  minutesSincePlantMidnight,
  safeMinutesAgo,
  REASON_DEFAULTS,
};

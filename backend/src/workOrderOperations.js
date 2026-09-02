'use strict';

// ─── Operations on a work order ───────────────────────────────────────────────
//
// One place that knows how a job made of N operations moves. Everything a route
// needs is here, so /api/work-orders, the ERP import and (from wave 4) the
// operator screens all advance a job the same way rather than each writing its
// own UPDATE.
//
// The three rules this file exists to hold:
//
//   1. RELEASE IS A SNAPSHOT. instantiate() COPIES routing_steps into
//      work_order_operations. It does not join. A planner who fixes a typo in a
//      routing next month must not silently rewrite the standard time of a job
//      the floor is halfway through, and a routing that gets deleted must not
//      erase the history of what was actually run.
//   2. EVERY STATEMENT CARRIES company_id. An operation id is a UUID a caller
//      supplies; without the tenant in the WHERE clause, guessing one would
//      book quantity onto another company's job. The work order is re-checked
//      too, so an operation whose parent belongs to someone else is invisible.
//   3. ONE TRANSACTION PER MOVE. Releasing writes N operation rows AND the work
//      order's current_operation_id/released_at; advancing writes the booked
//      operation AND readies the next AND moves the pointer. A half-applied
//      release is a job with four operations of seven and no way to tell.
//
// Nothing here ever backfills. A work order released before this module existed
// does not exist: released_at is NULL on every row that was already there, and
// only an explicit release writes operations.

const { v4: uuidv4 } = require('uuid');
const db = require('./db');
const { isValid, OPERATION_STATUS } = require('./vocab');

/**
 * An error a route can turn straight into a response. `status` is the HTTP code
 * and `code` the machine-readable reason; the message never quotes a row from
 * another tenant (that is how a 400 leaks a competitor's routing name).
 */
class OperationError extends Error {
  constructor(status, code, message) {
    super(message);
    this.name = 'OperationError';
    this.status = status;
    this.code = code;
  }
}

/** Statuses that mean "this operation is finished with". */
const CLOSED = Object.freeze(['complete', 'skipped']);

// ─── Reads ────────────────────────────────────────────────────────────────────

const SELECT_OPERATIONS = `
  SELECT o.*,
         d.name AS department_name,
         a.name AS app_name,
         s.name AS station_name
  FROM work_order_operations o
  LEFT JOIN departments d ON d.id = o.department_id
  LEFT JOIN apps        a ON a.id = o.app_id
  LEFT JOIN stations    s ON s.id = o.station_id
`;

/** The work order, or null when it is not this company's. */
function workOrder(companyId, workOrderId) {
  return db.prepare('SELECT * FROM work_orders WHERE id = ? AND company_id = ?')
    .get(workOrderId, companyId) || null;
}

/**
 * Every operation on a work order, in sequence, each carrying `of` (how many
 * operations the job has) so a row can print "3 of 7" without a second call.
 * An unreleased work order has none — an empty array, never a fabricated step.
 *
 * @param {string} companyId
 * @param {string} workOrderId
 * @returns {object[]}
 */
function listOperations(companyId, workOrderId) {
  const rows = db.prepare(
    `${SELECT_OPERATIONS} WHERE o.work_order_id = ? AND o.company_id = ? ORDER BY o.sequence ASC`
  ).all(workOrderId, companyId);
  const of = rows.length;
  return rows.map(r => ({ ...r, of }));
}

/**
 * The operation the job is standing on, or null when it has not been released.
 * The work order's own pointer is the answer; the lowest open operation is the
 * fallback for a row whose pointer was cleared.
 *
 * @param {string} companyId
 * @param {string} workOrderId
 * @returns {object|null} the operation row plus department_name/app_name and `of`
 */
function currentOperation(companyId, workOrderId) {
  const wo = workOrder(companyId, workOrderId);
  if (!wo) return null;
  return currentOperationFor(companyId, wo);
}

/** currentOperation() for a work order row already fetched (and already this
 *  company's) — the list endpoint has hundreds of them and must not re-read. */
function currentOperationFor(companyId, wo) {
  const total = db.prepare(
    'SELECT COUNT(*) AS c FROM work_order_operations WHERE work_order_id = ? AND company_id = ?'
  ).get(wo.id, companyId).c;
  if (total === 0) return null;

  let row = null;
  if (wo.current_operation_id) {
    row = db.prepare(`${SELECT_OPERATIONS} WHERE o.id = ? AND o.company_id = ? AND o.work_order_id = ?`)
      .get(wo.current_operation_id, companyId, wo.id) || null;
  }
  if (!row) {
    row = db.prepare(
      `${SELECT_OPERATIONS} WHERE o.work_order_id = ? AND o.company_id = ? AND o.status NOT IN ('complete','skipped')
       ORDER BY o.sequence ASC LIMIT 1`
    ).get(wo.id, companyId) || null;
  }
  if (!row) {
    // Every operation is closed: the job stands on its last one, which is the
    // honest answer ("7 of 7, complete") rather than "not released".
    row = db.prepare(`${SELECT_OPERATIONS} WHERE o.work_order_id = ? AND o.company_id = ? ORDER BY o.sequence DESC LIMIT 1`)
      .get(wo.id, companyId) || null;
  }
  return row ? { ...row, of: total } : null;
}

/**
 * Where a job stands: { sequence, of }. null when the work order carries no
 * operations, so a caller prints nothing rather than "1 of 0".
 *
 * @param {string} companyId
 * @param {object|string} workOrder  the work order row, or its id
 * @returns {{ sequence: number, of: number }|null}
 */
function positionOf(companyId, wo) {
  const row = typeof wo === 'string' ? workOrder(companyId, wo) : wo;
  if (!row) return null;
  const op = currentOperationFor(companyId, row);
  return op ? { sequence: op.sequence, of: op.of } : null;
}

/**
 * The compact shape the work-order API hangs off every row. null for a job that
 * was never released — the screens read that as "no operations", and a zeroed
 * object would read as "operation 0 of 0", which is a number nobody measured.
 */
function currentOperationSummary(companyId, wo) {
  const op = currentOperationFor(companyId, wo);
  if (!op) return null;
  return {
    id: op.id,
    sequence: op.sequence,
    of: op.of,
    name: op.name,
    department_name: op.department_name ?? null,
    qty_good: op.quantity_completed,
    qty_required: op.quantity_required,
    standard_seconds: op.standard_seconds,
    status: op.status,
  };
}

// ─── Release ──────────────────────────────────────────────────────────────────

/** routing_steps in step order, this company's only. */
function routingSteps(companyId, routingId) {
  return db.prepare(
    'SELECT * FROM routing_steps WHERE routing_id = ? AND company_id = ? ORDER BY step_number ASC, rowid ASC'
  ).all(routingId, companyId);
}

/**
 * Release a work order against a routing: copy its steps into
 * work_order_operations, ready the first one, and point the job at it.
 *
 * Sequence 1 is 'ready' (someone may start it now) and the rest are 'queued'
 * (they exist, they are ordered, nobody may start them yet) — the distinction
 * the whole dispatch list is built on.
 *
 * @param {string} companyId
 * @param {string} workOrderId
 * @param {string} [routingId]  defaults to the work order's own routing_id
 * @returns {{ work_order: object, operations: object[] }}
 * @throws {OperationError} 404 work_order_not_found, 409 already_released,
 *         400 no_routing / routing_not_found / routing_has_no_steps
 */
function instantiate(companyId, workOrderId, routingId) {
  const wo = workOrder(companyId, workOrderId);
  if (!wo) throw new OperationError(404, 'work_order_not_found', 'Work order not found');

  // Released once, ever. A second release would either duplicate the sequence
  // (the UNIQUE index refuses) or silently discard what the floor has booked.
  if (wo.released_at) {
    throw new OperationError(409, 'already_released',
      `Work order ${wo.work_order_number} was already released.`);
  }

  const wanted = routingId || wo.routing_id || null;
  if (!wanted) {
    throw new OperationError(400, 'no_routing',
      'Pick a routing before releasing this work order.');
  }

  // Company-scoped: a routing id from another tenant is simply "not found", and
  // the message never echoes a name we would have had to read to know it.
  const routing = db.prepare('SELECT id, name FROM product_routings WHERE id = ? AND company_id = ?')
    .get(wanted, companyId);
  if (!routing) {
    throw new OperationError(400, 'routing_not_found', 'Routing not found');
  }

  const steps = routingSteps(companyId, routing.id);
  if (steps.length === 0) {
    throw new OperationError(400, 'routing_has_no_steps',
      `Routing "${routing.name}" has no steps, so there is nothing to release.`);
  }

  const hasStationColumn = routingStepsHaveStation();
  const quantity = Number(wo.quantity) || 0;

  const insert = db.prepare(`
    INSERT INTO work_order_operations
      (id, company_id, work_order_id, routing_step_id, sequence, name,
       app_id, department_id, station_id, standard_seconds,
       quantity_required, quantity_completed, quantity_scrapped, quantity_rework, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 0, ?)
  `);

  const release = db.transaction(() => {
    let firstId = null;
    steps.forEach((step, i) => {
      const id = uuidv4();
      if (i === 0) firstId = id;
      insert.run(
        id, companyId, wo.id, step.id, i + 1,
        step.name || `Step ${i + 1}`,
        step.app_id || null,
        step.department_id || null,
        hasStationColumn ? (step.station_id || null) : null,
        Number(step.estimated_cycle_seconds) || 0,
        quantity,
        i === 0 ? 'ready' : 'queued',
      );
    });
    db.prepare(`
      UPDATE work_orders
      SET routing_id = ?, current_operation_id = ?, released_at = datetime('now'),
          updated_at = datetime('now')
      WHERE id = ? AND company_id = ?
    `).run(routing.id, firstId, wo.id, companyId);
  });
  release();

  return {
    work_order: workOrder(companyId, wo.id),
    operations: listOperations(companyId, wo.id),
  };
}

/** Does routing_steps carry station_id? Read once — the schema cannot change
 *  under a running process, and this is on the release path. */
let _stationColumn = null;
function routingStepsHaveStation() {
  if (_stationColumn === null) {
    _stationColumn = db.prepare('PRAGMA table_info(routing_steps)').all().some(c => c.name === 'station_id');
  }
  return _stationColumn;
}

// ─── Advance ──────────────────────────────────────────────────────────────────

/**
 * Book output against one operation.
 *
 * `scrap` and `rework` are accepted and STORED today even though nothing writes
 * them yet: wave 4's coded scrap/rework screens call this, and a count with
 * nowhere to go is a count that gets folded into "good".
 *
 * An operation is complete when good + scrap reaches what was required —
 * reworked pieces are still in the job, so they do not close it. Completing one
 * readies the next in sequence and moves the work order's pointer; the last
 * operation leaves the pointer on itself, so a finished job reads "7 of 7"
 * rather than falling back to "not released".
 *
 * @param {string} companyId
 * @param {string} operationId
 * @param {{ good?: number, scrap?: number, rework?: number }} [counts]
 * @returns {{ operation: object, next: object|null, work_order: object }}
 * @throws {OperationError} 404 operation_not_found, 409 operation_closed,
 *         400 bad_count
 */
function advance(companyId, operationId, counts = {}) {
  const op = db.prepare('SELECT * FROM work_order_operations WHERE id = ? AND company_id = ?')
    .get(operationId, companyId);
  if (!op) throw new OperationError(404, 'operation_not_found', 'Operation not found');

  const wo = workOrder(companyId, op.work_order_id);
  if (!wo) throw new OperationError(404, 'work_order_not_found', 'Work order not found');

  const num = (v, label) => {
    if (v === undefined || v === null || v === '') return 0;
    const n = Number(v);
    if (!Number.isInteger(n) || n < 0) {
      throw new OperationError(400, 'bad_count', `${label} must be a whole number of 0 or more`);
    }
    return n;
  };
  const good   = num(counts.good, 'good');
  const scrap  = num(counts.scrap, 'scrap');
  const rework = num(counts.rework, 'rework');

  if (CLOSED.includes(op.status)) {
    throw new OperationError(409, 'operation_closed',
      `Operation ${op.sequence} is ${op.status}; nothing more can be booked against it.`);
  }

  const completed = op.quantity_completed + good;
  const scrapped  = op.quantity_scrapped + scrap;
  const reworked  = op.quantity_rework + rework;
  const required  = op.quantity_required;
  const done      = required > 0 && (completed + scrapped) >= required;

  const apply = db.transaction(() => {
    db.prepare(`
      UPDATE work_order_operations
      SET quantity_completed = ?, quantity_scrapped = ?, quantity_rework = ?,
          status = ?,
          started_at   = COALESCE(started_at, datetime('now')),
          completed_at = CASE WHEN ? = 1 THEN datetime('now') ELSE completed_at END,
          updated_at   = datetime('now')
      WHERE id = ? AND company_id = ?
    `).run(completed, scrapped, reworked, done ? 'complete' : 'running', done ? 1 : 0,
           op.id, companyId);

    if (done) readyNext(companyId, wo.id, op.sequence);
    else {
      db.prepare(`UPDATE work_orders SET current_operation_id = ?, updated_at = datetime('now')
                  WHERE id = ? AND company_id = ?`).run(op.id, wo.id, companyId);
    }
  });
  apply();

  const updated = db.prepare(`${SELECT_OPERATIONS} WHERE o.id = ? AND o.company_id = ?`).get(op.id, companyId);
  const refreshed = workOrder(companyId, wo.id);
  const next = refreshed.current_operation_id && refreshed.current_operation_id !== op.id
    ? db.prepare(`${SELECT_OPERATIONS} WHERE o.id = ? AND o.company_id = ?`).get(refreshed.current_operation_id, companyId)
    : null;
  const of = db.prepare('SELECT COUNT(*) AS c FROM work_order_operations WHERE work_order_id = ? AND company_id = ?')
    .get(wo.id, companyId).c;

  return {
    operation: { ...updated, of },
    next: next ? { ...next, of } : null,
    work_order: refreshed,
  };
}

/**
 * Hand the job to the operation after `afterSequence`: the next one still
 * queued becomes ready and the work order points at it. When there is none, the
 * pointer stays where it is — a job that has run out of operations is finished,
 * not unreleased. Caller owns the transaction.
 */
function readyNext(companyId, workOrderId, afterSequence) {
  const next = db.prepare(`
    SELECT * FROM work_order_operations
    WHERE work_order_id = ? AND company_id = ? AND sequence > ? AND status NOT IN ('complete','skipped')
    ORDER BY sequence ASC LIMIT 1
  `).get(workOrderId, companyId, afterSequence);

  if (!next) return null;
  if (next.status === 'queued') {
    db.prepare(`UPDATE work_order_operations SET status = 'ready', updated_at = datetime('now')
                WHERE id = ? AND company_id = ?`).run(next.id, companyId);
  }
  db.prepare(`UPDATE work_orders SET current_operation_id = ?, updated_at = datetime('now')
              WHERE id = ? AND company_id = ?`).run(next.id, workOrderId, companyId);
  return next;
}

// ─── Ad-hoc operations and status changes ────────────────────────────────────

/**
 * Append one operation to the end of a released job — the rework loop, the
 * extra inspection, the thing the routing did not know about. It joins as
 * 'queued' unless it is the only open operation left.
 *
 * @param {string} companyId
 * @param {string} workOrderId
 * @param {{ name?: string, app_id?: string, department_id?: string,
 *           station_id?: string, standard_seconds?: number,
 *           quantity_required?: number }} input
 * @returns {object} the created operation
 */
function appendOperation(companyId, workOrderId, input = {}) {
  const wo = workOrder(companyId, workOrderId);
  if (!wo) throw new OperationError(404, 'work_order_not_found', 'Work order not found');

  const name = String(input.name ?? '').trim();
  if (!name) throw new OperationError(400, 'name_required', 'name is required');

  const maxRow = db.prepare(
    'SELECT MAX(sequence) AS m FROM work_order_operations WHERE work_order_id = ? AND company_id = ?'
  ).get(workOrderId, companyId);
  const sequence = (maxRow.m ?? 0) + 1;

  const id = uuidv4();
  const qty = input.quantity_required === undefined || input.quantity_required === null
    ? (Number(wo.quantity) || 0)
    : Number(input.quantity_required);
  if (!Number.isInteger(qty) || qty < 0) {
    throw new OperationError(400, 'bad_quantity', 'quantity_required must be a whole number of 0 or more');
  }

  db.prepare(`
    INSERT INTO work_order_operations
      (id, company_id, work_order_id, routing_step_id, sequence, name,
       app_id, department_id, station_id, standard_seconds,
       quantity_required, quantity_completed, quantity_scrapped, quantity_rework, status)
    VALUES (?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, 0, 0, 0, ?)
  `).run(
    id, companyId, workOrderId, sequence, name,
    ownedOrNull('apps', input.app_id, companyId),
    ownedOrNull('departments', input.department_id, companyId),
    ownedOrNull('stations', input.station_id, companyId),
    Number(input.standard_seconds) || 0,
    qty,
    sequence === 1 ? 'ready' : 'queued',
  );

  // The first operation on a job nobody released still needs a pointer, or the
  // work order reads as unreleased while carrying an operation.
  if (!wo.current_operation_id) {
    db.prepare(`UPDATE work_orders SET current_operation_id = ?, updated_at = datetime('now')
                WHERE id = ? AND company_id = ?`).run(id, workOrderId, companyId);
  }

  const of = db.prepare('SELECT COUNT(*) AS c FROM work_order_operations WHERE work_order_id = ? AND company_id = ?')
    .get(workOrderId, companyId).c;
  return { ...db.prepare(`${SELECT_OPERATIONS} WHERE o.id = ? AND o.company_id = ?`).get(id, companyId), of };
}

/**
 * Move one operation by hand: its status (from vocab.OPERATION_STATUS only) and
 * the station it runs on. Skipping or completing it hands the job to the next
 * one, which is the whole reason a supervisor presses Skip.
 *
 * @returns {object} the updated operation
 */
function setOperation(companyId, operationId, patch = {}) {
  const op = db.prepare('SELECT * FROM work_order_operations WHERE id = ? AND company_id = ?')
    .get(operationId, companyId);
  if (!op) throw new OperationError(404, 'operation_not_found', 'Operation not found');

  let status = op.status;
  if (patch.status !== undefined) {
    if (!isValid('OPERATION_STATUS', patch.status)) {
      throw new OperationError(400, 'bad_status',
        `status must be one of: ${OPERATION_STATUS.join(', ')}`);
    }
    status = patch.status;
  }

  const stationId = patch.station_id !== undefined
    ? ownedOrNull('stations', patch.station_id, companyId)
    : op.station_id;

  const apply = db.transaction(() => {
    db.prepare(`
      UPDATE work_order_operations
      SET status = ?, station_id = ?,
          started_at   = CASE WHEN ? IN ('running','complete') THEN COALESCE(started_at, datetime('now')) ELSE started_at END,
          completed_at = CASE WHEN ? IN ('complete','skipped') THEN COALESCE(completed_at, datetime('now')) ELSE completed_at END,
          updated_at   = datetime('now')
      WHERE id = ? AND company_id = ?
    `).run(status, stationId, status, status, op.id, companyId);

    if (CLOSED.includes(status) && !CLOSED.includes(op.status)) {
      readyNext(companyId, op.work_order_id, op.sequence);
    } else if (!CLOSED.includes(status)) {
      db.prepare(`UPDATE work_orders SET current_operation_id = ?, updated_at = datetime('now')
                  WHERE id = ? AND company_id = ?`).run(op.id, op.work_order_id, companyId);
    }
  });
  apply();

  const of = db.prepare('SELECT COUNT(*) AS c FROM work_order_operations WHERE work_order_id = ? AND company_id = ?')
    .get(op.work_order_id, companyId).c;
  return { ...db.prepare(`${SELECT_OPERATIONS} WHERE o.id = ? AND o.company_id = ?`).get(op.id, companyId), of };
}

/** Returns the id if that row is this company's, else null. Same guard the
 *  work-order and routing routes use — a reference across tenants leaks the
 *  other tenant's name through the JOINs above. */
function ownedOrNull(table, id, companyId) {
  if (!id) return null;
  const row = db.prepare(`SELECT id FROM ${table} WHERE id = ? AND company_id = ?`).get(id, companyId);
  return row ? id : null;
}

/**
 * Open work orders running on a routing, each with where it currently stands.
 * This is what makes the Routings screen true: "used by 3 open work orders",
 * with the operation each one is on.
 *
 * @param {string} companyId
 * @param {string} routingId
 * @returns {object[]}
 */
function openWorkOrdersOnRouting(companyId, routingId) {
  const rows = db.prepare(`
    SELECT wo.id, wo.work_order_number, wo.part_number, wo.part_name, wo.quantity,
           wo.quantity_completed, wo.status, wo.priority, wo.due_date,
           wo.released_at, wo.hold_reason, wo.current_operation_id
    FROM work_orders wo
    WHERE wo.company_id = ? AND wo.routing_id = ? AND wo.status NOT IN ('completed','cancelled')
    ORDER BY wo.created_at DESC
  `).all(companyId, routingId);

  return rows.map(wo => ({
    ...wo,
    current_operation: currentOperationSummary(companyId, wo),
  }));
}

/** How many open work orders run on each routing of this company, as a map
 *  routing_id → count. One query for the whole Routings list. */
function openCountsByRouting(companyId) {
  const rows = db.prepare(`
    SELECT routing_id, COUNT(*) AS c
    FROM work_orders
    WHERE company_id = ? AND routing_id IS NOT NULL AND status NOT IN ('completed','cancelled')
    GROUP BY routing_id
  `).all(companyId);
  const out = {};
  for (const r of rows) out[r.routing_id] = r.c;
  return out;
}

module.exports = {
  OperationError,
  instantiate,
  advance,
  currentOperation,
  currentOperationFor,
  currentOperationSummary,
  positionOf,
  listOperations,
  appendOperation,
  setOperation,
  openWorkOrdersOnRouting,
  openCountsByRouting,
};

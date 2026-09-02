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

/** Operation statuses output may be booked against. A 'queued' operation has
 *  not been handed to anyone yet and an 'on_hold' one is deliberately stopped;
 *  booking against either is how a job runs out of order without anybody
 *  deciding it should. */
const BOOKABLE = Object.freeze(['ready', 'running']);

/** Work-order statuses that mean "this job is over". Nothing is released onto
 *  one of these; reopening it on the Schedule comes first. */
const CLOSED_WORK_ORDER_STATUSES = Object.freeze(['completed', 'cancelled']);

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
  return op ? summarize(op) : null;
}

function summarize(op) {
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

/**
 * currentOperationSummary() for a whole page of work orders, in AT MOST THREE
 * statements no matter how many rows there are.
 *
 * The row-at-a-time version costs a COUNT and a lookup per work order: a
 * hundred-job Schedule was three hundred round trips behind one list request,
 * which is the shape of slowness that only shows up on a customer's database.
 *
 *   1. one GROUP BY for "how many operations does each of these jobs have",
 *   2. one lookup of the pointer rows by id,
 *   3. one sweep, only for the jobs whose pointer is missing or stale, of their
 *      operations — the fallback currentOperationFor() applies one at a time.
 *
 * @param {string} companyId
 * @param {Array<{id: string, current_operation_id?: string|null}>} workOrders
 * @returns {Map<string, object|null>} work_order_id → summary (or null)
 */
function currentOperationSummaries(companyId, workOrders) {
  const out = new Map();
  const rows = Array.isArray(workOrders) ? workOrders : [];
  for (const wo of rows) out.set(wo.id, null);
  if (rows.length === 0) return out;

  const ids = rows.map(w => w.id);
  const counts = new Map();
  for (const chunk of chunked(ids)) {
    const q = `SELECT work_order_id, COUNT(*) AS c FROM work_order_operations
               WHERE company_id = ? AND work_order_id IN (${placeholders(chunk.length)})
               GROUP BY work_order_id`;
    for (const r of db.prepare(q).all(companyId, ...chunk)) counts.set(r.work_order_id, r.c);
  }
  if (counts.size === 0) return out;   // nothing released: one statement, done

  // The pointer rows, in one lookup.
  const withOps = rows.filter(w => counts.has(w.id));
  const pointerIds = withOps.map(w => w.current_operation_id).filter(Boolean);
  const byId = new Map();
  for (const chunk of chunked(pointerIds)) {
    const q = `${SELECT_OPERATIONS} WHERE o.company_id = ? AND o.id IN (${placeholders(chunk.length)})`;
    for (const r of db.prepare(q).all(companyId, ...chunk)) byId.set(r.id, r);
  }

  const resolved = new Set();
  for (const wo of withOps) {
    const row = wo.current_operation_id ? byId.get(wo.current_operation_id) : null;
    // A pointer that resolves to another job's operation is not this job's
    // pointer, however it got written.
    if (row && row.work_order_id === wo.id) {
      out.set(wo.id, summarize({ ...row, of: counts.get(wo.id) }));
      resolved.add(wo.id);
    }
  }

  // Only the stragglers: a job whose pointer was cleared or never set falls
  // back to its lowest open operation, then to its last one.
  const missing = withOps.filter(w => !resolved.has(w.id)).map(w => w.id);
  if (missing.length > 0) {
    const all = new Map();
    for (const chunk of chunked(missing)) {
      const q = `${SELECT_OPERATIONS} WHERE o.company_id = ? AND o.work_order_id IN (${placeholders(chunk.length)})
                 ORDER BY o.work_order_id, o.sequence ASC`;
      for (const r of db.prepare(q).all(companyId, ...chunk)) {
        if (!all.has(r.work_order_id)) all.set(r.work_order_id, []);
        all.get(r.work_order_id).push(r);
      }
    }
    for (const id of missing) {
      const list = all.get(id) || [];
      if (list.length === 0) continue;
      const open = list.find(o => !CLOSED.includes(o.status));
      const pick = open || list[list.length - 1];
      out.set(id, summarize({ ...pick, of: counts.get(id) }));
    }
  }

  return out;
}

/** SQLite caps a statement at 999 bound parameters; one company's page of work
 *  orders is far below that, but a batch is not a place to find out. */
function chunked(list, size = 400) {
  const out = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

function placeholders(n) {
  return new Array(n).fill('?').join(',');
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

  // A finished or cancelled job is not something to start. Release cannot be
  // undone, so releasing one would leave seven operations nobody will ever run
  // attached to a job the plant considers closed — and the Routings screen
  // would count it as live work.
  if (CLOSED_WORK_ORDER_STATUSES.includes(wo.status)) {
    throw new OperationError(409, 'work_order_closed',
      `Work order ${wo.work_order_number} is ${wo.status} — reopen it before releasing.`);
  }

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
  try {
    release();
  } catch (err) {
    // UNIQUE(work_order_id, sequence) is what two simultaneous releases race
    // on: one commits its rows, the other collides. That is a conflict, not a
    // server fault, and it has to read like one.
    if (isConstraintFailure(err)) {
      throw new OperationError(409, 'already_released',
        `Work order ${wo.work_order_number} was already released.`);
    }
    throw err;
  }

  return {
    work_order: workOrder(companyId, wo.id),
    operations: listOperations(companyId, wo.id),
  };
}

/** A SQLite constraint violation, whatever better-sqlite3 chose to call it. */
function isConstraintFailure(err) {
  const code = String(err && err.code || '');
  const message = String(err && err.message || '');
  return code.startsWith('SQLITE_CONSTRAINT') || message.includes('constraint failed');
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

  // ── What state may be booked against ──────────────────────────────────────
  // In order, because each says something different to the person holding the
  // tablet: this operation is finished; this operation is stopped on purpose;
  // this operation has not been handed to you yet.
  if (CLOSED.includes(op.status)) {
    throw new OperationError(409, 'operation_closed',
      `Operation ${op.sequence} is ${op.status}; nothing more can be booked against it.`);
  }
  if (op.status === 'on_hold') {
    throw new OperationError(409, 'operation_on_hold',
      `Operation ${op.sequence} is on hold. Clear the hold before booking against it.`);
  }
  if (!BOOKABLE.includes(op.status)) {
    throw new OperationError(409, 'operation_not_ready',
      `Operation ${op.sequence} is ${op.status} — operation ${op.sequence - 1} has to finish first.`);
  }

  const required  = op.quantity_required;
  const booked    = op.quantity_completed + op.quantity_scrapped;
  // An operation cannot produce more than the order asked for. Without this,
  // 6 good twice on a quantity of 10 completes at 12/10 and every downstream
  // number — yield, scrap rate, OEE — is computed against a total that never
  // existed. Rework is not counted here: a reworked piece is the same piece.
  const remaining = Math.max(required - booked, 0);
  if (good + scrap > remaining) {
    throw new OperationError(400, 'bad_count',
      remaining === 0
        ? `Operation ${op.sequence} already has all ${required} accounted for.`
        : `only ${remaining} left on this operation`);
  }

  const completed = op.quantity_completed + good;
  const scrapped  = op.quantity_scrapped + scrap;
  const reworked  = op.quantity_rework + rework;
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
  // Defaults to the job's quantity, and may never be zero: an operation that
  // requires nothing can never reach 'complete', so it would sit at the head of
  // the job forever and the sequence would never move past it.
  const qty = input.quantity_required === undefined || input.quantity_required === null || input.quantity_required === ''
    ? (Number(wo.quantity) || 0)
    : Number(input.quantity_required);
  if (!Number.isInteger(qty) || qty < 1) {
    throw new OperationError(400, 'bad_quantity', 'quantity_required must be a whole number of 1 or more');
  }

  db.prepare(`
    INSERT INTO work_order_operations
      (id, company_id, work_order_id, routing_step_id, sequence, name,
       app_id, department_id, station_id, standard_seconds,
       quantity_required, quantity_completed, quantity_scrapped, quantity_rework, status)
    VALUES (?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, 0, 0, 0, ?)
  `).run(
    id, companyId, workOrderId, sequence, name,
    ownedOrFail('apps', input.app_id, companyId, 'app'),
    ownedOrFail('departments', input.department_id, companyId, 'department'),
    ownedOrFail('stations', input.station_id, companyId, 'station'),
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
    ? ownedOrFail('stations', patch.station_id, companyId, 'station')
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
 * Like ownedOrNull, but a supplied id that does not resolve is an ERROR rather
 * than a silent null. Quietly dropping the department off an operation because
 * the id came from another tenant produces an operation nobody is responsible
 * for and no message saying why — the caller believes it set a department.
 *
 * The message names the FIELD, never the row: "department not found" is all a
 * caller learns, whether the id is a typo or a competitor's.
 */
function ownedOrFail(table, id, companyId, label) {
  if (id === undefined || id === null || id === '') return null;
  const row = db.prepare(`SELECT id FROM ${table} WHERE id = ? AND company_id = ?`).get(id, companyId);
  if (!row) throw new OperationError(400, `${label}_not_found`, `${label} not found`);
  return id;
}

/**
 * Move every unfinished operation to a new order quantity.
 *
 * Raising a released job's quantity used to leave its operations requiring the
 * old number, so a job for 80 completed at 50 and the extra 30 had nowhere to
 * be booked. Refused outright once any operation is COMPLETE: that operation
 * ran to a number that is now wrong, and quietly reopening finished work is
 * worse than making the planner split the order.
 *
 * An operation never drops below what has already been booked against it —
 * 12 good and 3 scrapped cannot become a requirement of 10.
 *
 * @param {string} companyId
 * @param {string} workOrderId
 * @param {number} quantity  the work order's new quantity
 * @returns {{ resized: number, floored: Array<{sequence:number, quantity_required:number}> }}
 * @throws {OperationError} 409 operation_complete
 */
function resizeOperations(companyId, workOrderId, quantity) {
  const rows = db.prepare(
    'SELECT * FROM work_order_operations WHERE work_order_id = ? AND company_id = ? ORDER BY sequence ASC'
  ).all(workOrderId, companyId);
  if (rows.length === 0) return { resized: 0, floored: [] };

  const finished = rows.filter(r => r.status === 'complete');
  if (finished.length > 0) {
    throw new OperationError(409, 'operation_complete',
      `Operation ${finished[0].sequence} (${finished[0].name}) is already complete, so the quantity cannot be changed. Raise a second work order for the extra units.`);
  }

  const target = Number(quantity);
  if (!Number.isInteger(target) || target < 1) {
    throw new OperationError(400, 'bad_quantity', 'quantity must be a whole number of 1 or more');
  }

  const floored = [];
  const upd = db.prepare(
    "UPDATE work_order_operations SET quantity_required = ?, updated_at = datetime('now') WHERE id = ? AND company_id = ?"
  );
  let resized = 0;
  const apply = db.transaction(() => {
    for (const r of rows) {
      if (r.status === 'skipped') continue;          // nobody will run it
      const booked = r.quantity_completed + r.quantity_scrapped;
      const next = Math.max(target, booked);
      if (next === r.quantity_required) continue;
      upd.run(next, r.id, companyId);
      resized++;
      if (next !== target) floored.push({ sequence: r.sequence, quantity_required: next });
    }
  });
  apply();
  return { resized, floored };
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

  // Batched, for the same reason the work-order list is: a routing with fifty
  // open jobs was fifty COUNTs and fifty lookups behind one screen.
  const summaries = currentOperationSummaries(companyId, rows);
  return rows.map(wo => ({
    ...wo,
    current_operation: summaries.get(wo.id) ?? null,
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
  ownedOrFail,
  instantiate,
  advance,
  currentOperation,
  currentOperationFor,
  currentOperationSummary,
  currentOperationSummaries,
  positionOf,
  listOperations,
  appendOperation,
  setOperation,
  resizeOperations,
  openWorkOrdersOnRouting,
  openCountsByRouting,
};

const express = require('express');
const { v4: uuidv4 } = require('uuid');
const db = require('../db');
const { logActivity } = require('../activity');
const { plantDayShift } = require('../plantDay');
const {
  startPmScheduler, runOnce: sweepPmSchedules, nextWONumber,
  RAISABLE_FREQUENCIES, METER_REASON, OVERDUE_SQL, OPEN_WO_STATUSES,
} = require('../pmScheduler');

const router = express.Router();

// A PM that comes due has to raise its own job, or the schedule is a reminder
// nobody receives. This module owns the maintenance lifecycle, so the hourly
// sweeper starts here — the same shape as the stale-run reaper in
// routes/completions.js. Guarded against a double start, timers unref'd, and
// off under NODE_ENV=test unless PM_SWEEP_MS asks for it.
startPmScheduler();

function ownedAsset(req) {
  return db.prepare('SELECT * FROM assets WHERE id = ? AND company_id = ?').get(req.params.id, req.companyId) || null;
}

function ownedWO(req) {
  return db.prepare('SELECT * FROM maintenance_work_orders WHERE id = ? AND company_id = ?').get(req.params.id, req.companyId) || null;
}

function computeNextDue(lastCompleted, frequencyType, frequencyValue) {
  if (!lastCompleted) return null;
  const d = new Date(lastCompleted);
  if (frequencyType === 'days') d.setDate(d.getDate() + frequencyValue);
  else if (frequencyType === 'weeks') d.setDate(d.getDate() + frequencyValue * 7);
  else if (frequencyType === 'months') d.setMonth(d.getMonth() + frequencyValue);
  else return null;
  return d.toISOString();
}

// ─── Assets ───────────────────────────────────────────────────────────────────

router.get('/assets', (req, res) => {
  const { department_id, status, search } = req.query;
  let sql = `
    SELECT a.*, d.name as department_name
    FROM assets a
    LEFT JOIN departments d ON d.id = a.department_id
    WHERE a.company_id = ?
  `;
  const params = [req.companyId];
  if (department_id) { sql += ' AND a.department_id = ?'; params.push(department_id); }
  if (status) { sql += ' AND a.status = ?'; params.push(status); }
  if (search) { sql += ' AND (a.name LIKE ? OR a.asset_number LIKE ?)'; params.push(`%${search}%`, `%${search}%`); }
  sql += ' ORDER BY a.name ASC';
  res.json(db.prepare(sql).all(...params));
});

router.post('/assets', (req, res) => {
  const { asset_number, name, description = '', type = '', make = '', model = '', serial_number = '', department_id, location = '', status = 'active', install_date, purchase_cost = 0, notes = '' } = req.body;
  if (!asset_number?.trim() || !name?.trim()) return res.status(400).json({ error: 'asset_number and name required' });
  const id = uuidv4();
  const now = new Date().toISOString();
  db.prepare(`INSERT INTO assets (id, company_id, asset_number, name, description, type, make, model, serial_number, department_id, location, status, install_date, purchase_cost, notes, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(id, req.companyId, asset_number.trim(), name.trim(), description, type, make, model, serial_number, department_id || null, location, status, install_date || null, purchase_cost, notes, now, now);
  logActivity(req.companyId, 'asset', id, `Asset created: ${name}`, req.user?.display_name);
  res.status(201).json(db.prepare('SELECT a.*, d.name as department_name FROM assets a LEFT JOIN departments d ON d.id = a.department_id WHERE a.id = ?').get(id));
});

router.put('/assets/:id', (req, res) => {
  if (!ownedAsset(req)) return res.status(404).json({ error: 'Not found' });
  const { asset_number, name, description, type, make, model, serial_number, department_id, location, status, install_date, purchase_cost, notes } = req.body;
  db.prepare(`UPDATE assets SET asset_number = COALESCE(?, asset_number), name = COALESCE(?, name), description = COALESCE(?, description), type = COALESCE(?, type), make = COALESCE(?, make), model = COALESCE(?, model), serial_number = COALESCE(?, serial_number), department_id = COALESCE(?, department_id), location = COALESCE(?, location), status = COALESCE(?, status), install_date = COALESCE(?, install_date), purchase_cost = COALESCE(?, purchase_cost), notes = COALESCE(?, notes), updated_at = datetime('now') WHERE id = ?`)
    .run(asset_number, name, description, type, make, model, serial_number, department_id, location, status, install_date, purchase_cost, notes, req.params.id);
  res.json(db.prepare('SELECT a.*, d.name as department_name FROM assets a LEFT JOIN departments d ON d.id = a.department_id WHERE a.id = ?').get(req.params.id));
});

router.delete('/assets/:id', (req, res) => {
  if (!ownedAsset(req)) return res.status(404).json({ error: 'Not found' });
  db.prepare('DELETE FROM assets WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// ─── PM Schedules ─────────────────────────────────────────────────────────────

// ─── PM read shape ────────────────────────────────────────────────────────────
// A schedule measured in hours or cycles cannot be projected onto a calendar:
// it needs a meter reading, and nothing in the product records one yet. It used
// to come back with next_due_at silently null, which reads on screen as "no
// date" — indistinguishable from a bug. It now says WHY, in the same words the
// sweeper uses to skip it.
function decoratePM(row) {
  const meter = !RAISABLE_FREQUENCIES.includes(row.frequency_type);
  return {
    ...row,
    auto_create_wo: !!row.auto_create_wo,
    lead_days: row.lead_days ?? 0,
    next_due_at: meter ? null : (row.next_due_at || null),
    next_due_reason: meter ? METER_REASON : null,
    // Overdue is decided server-side, in the PLANT's day, by the same predicate
    // the summary tile counts with — so the tile and the list can never
    // disagree about how many PMs are late.
    is_overdue: !meter && !!row.is_overdue,
  };
}

function listPMs(req, res) {
  const { asset_id, overdue } = req.query;
  // next_due_at is a full ISO instant (computeNextDue writes toISOString), so
  // both sides of the day comparison shift onto the plant clock — a PM due
  // tomorrow morning must not read as overdue all of this evening.
  const day = plantDayShift(req.companyId);
  let sql = `
    SELECT p.*, a.name as asset_name, a.asset_number,
           CASE WHEN date(p.next_due_at, ?) < date('now', ?) THEN 1 ELSE 0 END AS is_overdue,
           (SELECT w.id FROM maintenance_work_orders w
             WHERE w.pm_schedule_id = p.id AND w.company_id = p.company_id
               AND w.status NOT IN ${OPEN_WO_STATUSES}
             ORDER BY w.created_at DESC LIMIT 1) AS open_wo_id,
           (SELECT w.wo_number FROM maintenance_work_orders w
             WHERE w.pm_schedule_id = p.id AND w.company_id = p.company_id
               AND w.status NOT IN ${OPEN_WO_STATUSES}
             ORDER BY w.created_at DESC LIMIT 1) AS open_wo_number
    FROM pm_schedules p
    LEFT JOIN assets a ON a.id = p.asset_id
    WHERE p.company_id = ?
  `;
  const params = [day, day, req.companyId];
  if (asset_id) { sql += ' AND p.asset_id = ?'; params.push(asset_id); }
  // Due strictly before today is overdue; due today still has the day to run.
  if (overdue === 'true') { sql += ` AND ${OVERDUE_SQL.replace(/next_due_at/g, 'p.next_due_at')}`; params.push(day, day); }
  sql += ' ORDER BY p.next_due_at ASC NULLS LAST';
  res.json(db.prepare(sql).all(...params).map(decoratePM));
}

// `/pm-schedules` is the name the screens and the API docs use; `/pm` is the
// path the shipped client already calls. Both reach the same handler rather
// than one of them being a redirect nobody remembers to follow.
router.get(['/pm', '/pm-schedules'], listPMs);

// The PM form speaks in cadence words (daily/weekly/monthly/quarterly/yearly)
// while pm_schedules.frequency_type CHECK allows days/weeks/months/hours/cycles.
// Every option in that picker therefore failed the constraint — the screen could
// not create a schedule at all. Quarterly and yearly have no unit of their own,
// so they become a MULTIPLE of months; returning just 'months' would silently
// turn a yearly PM into a monthly one.
const FREQUENCY_ALIAS = {
  daily: { type: 'days', factor: 1 },
  weekly: { type: 'weeks', factor: 1 },
  monthly: { type: 'months', factor: 1 },
  quarterly: { type: 'months', factor: 3 },
  yearly: { type: 'months', factor: 12 },
  annually: { type: 'months', factor: 12 },
};
function normalizeFrequency(type, value) {
  const alias = FREQUENCY_ALIAS[type];
  const count = Number(value) || 1;
  if (!alias) return { frequency_type: type, frequency_value: count };
  return { frequency_type: alias.type, frequency_value: count * alias.factor };
}

// Same drift on the work-order type picker: the form offers 'pm' where the
// column allows 'preventive'.
const normalizeWOType = t => (t === 'pm' ? 'preventive' : t);

// One row by id, in the same shape the list returns (so a create/update reply
// and a list row can never describe the same schedule differently).
function onePM(id, companyId) {
  const day = plantDayShift(companyId);
  const row = db.prepare(`
    SELECT p.*, a.name as asset_name, a.asset_number,
           CASE WHEN date(p.next_due_at, ?) < date('now', ?) THEN 1 ELSE 0 END AS is_overdue,
           (SELECT w.id FROM maintenance_work_orders w
             WHERE w.pm_schedule_id = p.id AND w.company_id = p.company_id
               AND w.status NOT IN ${OPEN_WO_STATUSES}
             ORDER BY w.created_at DESC LIMIT 1) AS open_wo_id,
           (SELECT w.wo_number FROM maintenance_work_orders w
             WHERE w.pm_schedule_id = p.id AND w.company_id = p.company_id
               AND w.status NOT IN ${OPEN_WO_STATUSES}
             ORDER BY w.created_at DESC LIMIT 1) AS open_wo_number
      FROM pm_schedules p
      LEFT JOIN assets a ON a.id = p.asset_id
     WHERE p.id = ? AND p.company_id = ?
  `).get(day, day, id, companyId);
  return row ? decoratePM(row) : null;
}

/** 0-365 days of warning, as an integer. A PM cannot be raised a negative
 *  number of days early, and a year of lead time is not a lead time. */
function cleanLeadDays(value, fallback = 0) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(365, Math.max(0, Math.round(n)));
}

/** A first due date the planner typed, as a full ISO instant. Anything that is
 *  not a date is ignored rather than stored — a PM due "next Tuesday-ish" is a
 *  PM the sweeper cannot reason about. */
function cleanDueDate(value) {
  if (!value) return null;
  const d = new Date(String(value).length === 10 ? `${value}T00:00:00.000Z` : String(value));
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function createPM(req, res) {
  const {
    asset_id, title, description = '', frequency_type = 'days', frequency_value = 30,
    assigned_to = '', estimated_hours = 0, auto_create_wo = 1, lead_days = 0,
  } = req.body;
  if (!asset_id || !title?.trim()) return res.status(400).json({ error: 'asset_id and title required' });
  // Verify asset belongs to company
  if (!db.prepare('SELECT id FROM assets WHERE id = ? AND company_id = ?').get(asset_id, req.companyId)) {
    return res.status(404).json({ error: 'Asset not found' });
  }
  const id = uuidv4();
  const freq = normalizeFrequency(frequency_type, frequency_value);
  // A planner can say when the PM is FIRST due ("the annual inspection is in
  // March"); left out, the first one falls one full period from today.
  const next_due_at = cleanDueDate(req.body.next_due_at)
    || computeNextDue(new Date().toISOString(), freq.frequency_type, freq.frequency_value);
  db.prepare(`INSERT INTO pm_schedules (id, company_id, asset_id, title, description, frequency_type, frequency_value, next_due_at, assigned_to, estimated_hours, auto_create_wo, lead_days) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(id, req.companyId, asset_id, title.trim(), description, freq.frequency_type, freq.frequency_value, next_due_at, assigned_to, estimated_hours, auto_create_wo ? 1 : 0, cleanLeadDays(lead_days));
  res.status(201).json(onePM(id, req.companyId));
}
router.post(['/pm', '/pm-schedules'], createPM);

function updatePM(req, res) {
  const pm = db.prepare('SELECT * FROM pm_schedules WHERE id = ? AND company_id = ?').get(req.params.id, req.companyId);
  if (!pm) return res.status(404).json({ error: 'Not found' });
  const { title, description, frequency_type, frequency_value, assigned_to, estimated_hours } = req.body;
  // Edits arrive from the same cadence picker as create, so normalise here too —
  // otherwise changing a schedule to "quarterly" 500s on a row that created fine.
  const freq = frequency_type === undefined && frequency_value === undefined
    ? { frequency_type: undefined, frequency_value: undefined }
    : normalizeFrequency(frequency_type ?? pm.frequency_type, frequency_value ?? pm.frequency_value);
  // The two switches on the PM row: whether it raises its own job, and how many
  // days early. COALESCE cannot carry a deliberate 0, so both are resolved here.
  const autoCreate = req.body.auto_create_wo === undefined ? pm.auto_create_wo : (req.body.auto_create_wo ? 1 : 0);
  const leadDays = req.body.lead_days === undefined ? pm.lead_days : cleanLeadDays(req.body.lead_days, pm.lead_days);
  // Rescheduling is a real thing a planner does — the machine is down this week,
  // do the PM next week — so next_due_at is editable, but only ever to a date.
  const nextDue = req.body.next_due_at === undefined ? null : cleanDueDate(req.body.next_due_at);
  db.prepare(`UPDATE pm_schedules SET title = COALESCE(?, title), description = COALESCE(?, description), frequency_type = COALESCE(?, frequency_type), frequency_value = COALESCE(?, frequency_value), assigned_to = COALESCE(?, assigned_to), estimated_hours = COALESCE(?, estimated_hours), auto_create_wo = ?, lead_days = ?, next_due_at = COALESCE(?, next_due_at) WHERE id = ?`)
    .run(title, description, freq.frequency_type, freq.frequency_value, assigned_to, estimated_hours, autoCreate, leadDays, nextDue, req.params.id);
  res.json(onePM(req.params.id, req.companyId));
}
router.put(['/pm/:id', '/pm-schedules/:id'], updatePM);

/** Rolls a schedule forward and re-arms it. One definition, called both by the
 *  Complete button and by the completion of the job the schedule raised — the
 *  two must move the PM identically or the next due date depends on which
 *  button somebody happened to press. */
function completeSchedule(pm, at = new Date().toISOString()) {
  const next = computeNextDue(at, pm.frequency_type, pm.frequency_value);
  db.prepare('UPDATE pm_schedules SET last_completed_at = ?, next_due_at = ? WHERE id = ?').run(at, next, pm.id);
  return next;
}

function completePM(req, res) {
  const pm = db.prepare('SELECT * FROM pm_schedules WHERE id = ? AND company_id = ?').get(req.params.id, req.companyId);
  if (!pm) return res.status(404).json({ error: 'Not found' });
  const now = new Date().toISOString();
  completeSchedule(pm, now);

  // The job this PM raised is the same piece of work: finishing the PM finishes
  // the job, or the queue keeps showing a task that is already done.
  const job = db.prepare(`
    SELECT * FROM maintenance_work_orders
     WHERE pm_schedule_id = ? AND company_id = ? AND status NOT IN ${OPEN_WO_STATUSES}
     ORDER BY created_at DESC LIMIT 1
  `).get(pm.id, req.companyId);
  if (job) {
    db.prepare(`
      UPDATE maintenance_work_orders
         SET status = 'completed', completed_at = ?, updated_at = ?,
             resolution = CASE WHEN resolution IS NULL OR resolution = '' THEN ? ELSE resolution END
       WHERE id = ? AND company_id = ?
    `).run(now, now, `Closed with PM: ${pm.title}`, job.id, req.companyId);
    logActivity(req.companyId, 'maintenance', job.id, `WO ${job.wo_number || job.number} closed with its PM: ${pm.title}`, req.user?.display_name);
  }

  logActivity(req.companyId, 'pm', req.params.id, `PM completed: ${pm.title}`, req.user?.display_name);
  res.json({ ...onePM(req.params.id, req.companyId), closed_work_order_id: job?.id || null });
}
router.post(['/pm/:id/complete', '/pm-schedules/:id/complete'], completePM);

// ─── POST /maintenance/pm-sweep — drive one PM sweep (test harness only) ─────
// The sweeper runs hourly in production and is off under NODE_ENV=test, so a
// suite can prove "one job on the first sweep, none on the second" instead of
// waiting an hour. Outside a test environment the route does not exist.
router.post('/pm-sweep', (req, res) => {
  if (process.env.NODE_ENV !== 'test') return res.status(404).json({ error: 'Not found', code: 'NOT_FOUND' });
  const raised = sweepPmSchedules();
  const mine = raised.filter(w => w.company_id === req.companyId);
  res.json({ raised: mine, count: mine.length, swept: raised.length });
});

// ─── Maintenance Work Orders ───────────────────────────────────────────────────

router.get('/work-orders', (req, res) => {
  const { status, asset_id, type, priority } = req.query;
  // The PM that raised a job travels with it, so the card can say "Raised
  // automatically from PM: 500-hour service" and link back to the schedule
  // instead of the job appearing out of nowhere with no author.
  let sql = `
    SELECT m.*, a.name as asset_name, a.asset_number,
           pm.title AS pm_title, pm.frequency_type AS pm_frequency_type, pm.frequency_value AS pm_frequency_value
    FROM maintenance_work_orders m
    LEFT JOIN assets a ON a.id = m.asset_id
    LEFT JOIN pm_schedules pm ON pm.id = m.pm_schedule_id
    WHERE m.company_id = ?
  `;
  const params = [req.companyId];
  if (status) { sql += ' AND m.status = ?'; params.push(status); }
  if (asset_id) { sql += ' AND m.asset_id = ?'; params.push(asset_id); }
  if (req.query.pm_schedule_id) { sql += ' AND m.pm_schedule_id = ?'; params.push(req.query.pm_schedule_id); }
  if (type) { sql += ' AND m.type = ?'; params.push(type); }
  if (priority) { sql += ' AND m.priority = ?'; params.push(priority); }
  sql += ' ORDER BY CASE m.priority WHEN \'critical\' THEN 0 WHEN \'high\' THEN 1 WHEN \'medium\' THEN 2 ELSE 3 END, m.created_at DESC';
  res.json(db.prepare(sql).all(...params));
});

// The stored vocabularies are fixed by CHECK constraints that cannot be altered
// in place: priority IN ('low','medium','high','critical') and status IN
// ('open','in_progress','on_hold','completed','cancelled'). Earlier clients say
// 'normal' and 'complete' for the same two values, and sending either failed the
// constraint with a 500 — so a maintenance work order could not be created with
// the default priority, nor ever marked finished. Accept both spellings, store
// the one the database defines.
const normalizePriority = p => (p === 'normal' ? 'medium' : p);
const normalizeWOStatus = s => (s === 'complete' ? 'completed' : s);

router.post('/work-orders', (req, res) => {
  const { asset_id, type = 'corrective', title, description = '', priority = 'medium', assigned_to = '', requested_by = '', department_id, due_date, scheduled_date, notes = '' } = req.body;
  if (!title?.trim()) return res.status(400).json({ error: 'title required' });
  const id = uuidv4();
  const wo_number = nextWONumber(req.companyId);
  const now = new Date().toISOString();
  // `number` is the original NOT NULL column and `wo_number` the name the rest
  // of this route family reads; both carry the same value so neither the
  // constraint nor the reader is disappointed.
  // raised_by names who put the job there: '' for one a person typed, 'system'
  // for one the PM sweeper raised. A job with no author is a job nobody trusts.
  db.prepare(`INSERT INTO maintenance_work_orders (id, company_id, number, wo_number, asset_id, type, title, description, priority, assigned_to, requested_by, department_id, due_date, scheduled_date, notes, raised_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '', ?, ?)`)
    .run(id, req.companyId, wo_number, wo_number, asset_id || null, normalizeWOType(type), title.trim(), description, normalizePriority(priority), assigned_to, requested_by, department_id || null, due_date || null, scheduled_date || null, notes, now, now);
  logActivity(req.companyId, 'maintenance', id, `WO ${wo_number} created: ${title}`, req.user?.display_name);
  res.status(201).json(db.prepare('SELECT m.*, a.name as asset_name FROM maintenance_work_orders m LEFT JOIN assets a ON a.id = m.asset_id WHERE m.id = ?').get(id));
});

router.put('/work-orders/:id', (req, res) => {
  if (!ownedWO(req)) return res.status(404).json({ error: 'Not found' });
  const prev = ownedWO(req);
  const { type, title, description, assigned_to, due_date, actual_hours, parts_cost, labor_cost, notes, resolution } = req.body;
  const status = normalizeWOStatus(req.body.status);
  const priority = normalizePriority(req.body.priority);
  const now = new Date().toISOString();
  const completed_at = status === 'completed' && prev.status !== 'completed' ? now : prev.completed_at;
  const started_at = status === 'in_progress' && !prev.started_at ? now : prev.started_at;
  db.prepare(`UPDATE maintenance_work_orders SET status = COALESCE(?, status), type = COALESCE(?, type), title = COALESCE(?, title), description = COALESCE(?, description), priority = COALESCE(?, priority), assigned_to = COALESCE(?, assigned_to), due_date = COALESCE(?, due_date), actual_hours = COALESCE(?, actual_hours), parts_cost = COALESCE(?, parts_cost), labor_cost = COALESCE(?, labor_cost), notes = COALESCE(?, notes), resolution = COALESCE(?, resolution), completed_at = ?, started_at = COALESCE(?, started_at), updated_at = ? WHERE id = ?`)
    .run(status, type, title, description, priority, assigned_to, due_date, actual_hours, parts_cost, labor_cost, notes, resolution, completed_at, started_at, now, req.params.id);

  // Finishing the job a PM raised IS doing the PM. Rolling the schedule here is
  // what makes auto-raise a loop rather than a one-shot: the next due date moves
  // forward, so the sweeper's "already has an open job" guard lifts and the next
  // cycle raises the next job, once.
  if (status === 'completed' && prev.status !== 'completed' && prev.pm_schedule_id) {
    const pm = db.prepare('SELECT * FROM pm_schedules WHERE id = ? AND company_id = ?').get(prev.pm_schedule_id, req.companyId);
    if (pm) {
      const next = completeSchedule(pm, now);
      logActivity(
        req.companyId, 'pm', pm.id,
        `PM completed with WO ${prev.wo_number || prev.number}: ${pm.title}${next ? ` — next due ${next.slice(0, 10)}` : ''}`,
        req.user?.display_name,
      );
    }
  }

  res.json(db.prepare(`
    SELECT m.*, a.name as asset_name, pm.title AS pm_title
      FROM maintenance_work_orders m
      LEFT JOIN assets a ON a.id = m.asset_id
      LEFT JOIN pm_schedules pm ON pm.id = m.pm_schedule_id
     WHERE m.id = ?
  `).get(req.params.id));
});

router.delete('/work-orders/:id', (req, res) => {
  if (!ownedWO(req)) return res.status(404).json({ error: 'Not found' });
  db.prepare('DELETE FROM maintenance_work_orders WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// ─── Summary ──────────────────────────────────────────────────────────────────

router.get('/summary', (req, res) => {
  const day = plantDayShift(req.companyId);
  const open_wos = db.prepare("SELECT COUNT(*) as n FROM maintenance_work_orders WHERE company_id = ? AND status NOT IN ('completed','cancelled')").get(req.companyId).n;
  const critical_wos = db.prepare("SELECT COUNT(*) as n FROM maintenance_work_orders WHERE company_id = ? AND priority = 'critical' AND status NOT IN ('completed','cancelled')").get(req.companyId).n;
  // EXACTLY the predicate GET /pm-schedules?overdue=true filters on (and the
  // one the sweeper reads), so this tile and that list can never show two
  // different numbers for the same plant on the same day.
  const overdue_pms = db.prepare(`SELECT COUNT(*) as n FROM pm_schedules WHERE company_id = ? AND ${OVERDUE_SQL}`).get(req.companyId, day, day).n;
  const assets_count = db.prepare("SELECT COUNT(*) as n FROM assets WHERE company_id = ? AND status = 'active'").get(req.companyId).n;
  const completed_today = db.prepare("SELECT COUNT(*) as n FROM maintenance_work_orders WHERE company_id = ? AND status = 'completed' AND date(completed_at, ?) = date('now', ?)").get(req.companyId, day, day).n;
  res.json({ open_wos, critical_wos, overdue_pms, assets_count, completed_today });
});

module.exports = router;

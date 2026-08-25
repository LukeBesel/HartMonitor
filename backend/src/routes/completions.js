const express = require('express');
const { v4: uuidv4 } = require('uuid');
const db = require('../db');
const { logActivity } = require('../activity');
const { startRunReaper } = require('../runReaper');

const router = express.Router();

// Runs that nobody ever closed have to be closed for them, or Run History fills
// up with jobs that have been "in progress" since a tablet died last month and
// every completion-rate number is divided by ghosts. The sweeper has no route
// of its own and this is the module that owns run lifecycle, so starting it
// here is what guarantees it is running whenever the API is.
startRunReaper();

// Resolve the department a completion belongs to: its work order's department,
// falling back to its station's department when it ran without a work order.
// Used so production-advance log entries can be filtered by department.
function resolveDepartmentId(completion) {
  if (completion.work_order_id) {
    const wo = db.prepare('SELECT department_id FROM work_orders WHERE id = ?').get(completion.work_order_id);
    if (wo && wo.department_id) return wo.department_id;
  }
  if (completion.station_id) {
    const st = db.prepare('SELECT department_id FROM stations WHERE id = ?').get(completion.station_id);
    if (st && st.department_id) return st.department_id;
  }
  return null;
}

router.get('/', (req, res) => {
  const { limit = 50, status, operator_name, app_id } = req.query;
  let query = 'SELECT * FROM completions WHERE company_id = ?';
  const params = [req.companyId];
  if (status) { query += ' AND status = ?'; params.push(status); }
  if (operator_name) { query += ' AND operator_name = ?'; params.push(operator_name); }
  if (app_id) { query += ' AND app_id = ?'; params.push(app_id); }
  query += ' ORDER BY started_at DESC LIMIT ?';
  // Guard against NaN (better-sqlite3 throws on NaN bindings) and cap the page size.
  params.push(Math.min(Math.max(parseInt(limit, 10) || 50, 1), 500));
  const completions = db.prepare(query).all(...params);
  // Jobs-in-progress listing (player setup screen): attach the most recent
  // operator session per run so the picker can show who touched it last, when,
  // and any handoff comment left for the next operator.
  const attachLastSession = status === 'in_progress';
  const lastSessionStmt = attachLastSession
    ? db.prepare(`
        SELECT operator_name, operator_user_id, started_at, ended_at, handoff_comment
        FROM completion_sessions
        WHERE completion_id = ? AND company_id = ?
        ORDER BY started_at DESC, rowid DESC LIMIT 1
      `)
    : null;
  res.json(completions.map(c => ({
    ...c,
    data: JSON.parse(c.data),
    step_times: JSON.parse(c.step_times),
    ...(attachLastSession ? { last_session: lastSessionStmt.get(c.id, req.companyId) || null } : {}),
  })));
});

// ── App run history (feeds the AppHistory page) ──────────────────────────────
// GET /api/completions/app/:appId/history?page=1&limit=25
// Aggregates per-app run stats + per-step averages, and returns one page of
// runs newest-first. Tenant-scoped like every other completions query.
router.get('/app/:appId/history', (req, res) => {
  const { appId } = req.params;
  const app = db.prepare('SELECT id, name, steps FROM apps WHERE id = ? AND company_id = ?').get(appId, req.companyId);
  if (!app) return res.status(404).json({ error: 'App not found' });

  const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 25, 1), 100);

  // ── Everything below is paged/aggregated IN SQLITE ──────────────────────────
  // This endpoint used to SELECT every completion for the app and JSON.parse two
  // blobs per row on every request, then slice a 25-row page out of it — so page
  // 40 of a long-running production app blocked the single Node process for as
  // long as page 1 did, and got worse forever. Now the page query is LIMIT/OFFSET
  // and the rollups are SQL aggregates over json_each().
  //
  // `duration` keeps its original definition: the summed step_times when they add
  // up to anything, else the wall clock between started_at and completed_at.
  // json_valid() guards every json_each() so one malformed legacy blob can't
  // abort the whole query.
  //
  // A run we cannot time — one still in progress, or an old blob with neither
  // step times nor a completed_at — falls through to NULL, not 0. Zero seconds
  // is a measurement ("this took no time"); NULL is the truth ("we never timed
  // it"), and it also keeps those runs out of AVG() instead of dragging the
  // average toward zero.
  const DURATION_SQL = `
    CASE
      WHEN COALESCE((SELECT SUM(CAST(je.value AS REAL)) FROM json_each(c.step_times) je
                     WHERE json_valid(c.step_times)), 0) > 0
        THEN CAST(ROUND((SELECT SUM(CAST(je.value AS REAL)) FROM json_each(c.step_times) je
                         WHERE json_valid(c.step_times))) AS INTEGER)
      WHEN c.completed_at IS NOT NULL AND c.started_at IS NOT NULL
           AND (julianday(c.completed_at) - julianday(c.started_at)) > 0
        THEN CAST(ROUND((julianday(c.completed_at) - julianday(c.started_at)) * 86400) AS INTEGER)
      ELSE NULL
    END`;
  // Legacy runs record Pass/Fail as plain values inside the data blob.
  const HAS_FAIL = `EXISTS (SELECT 1 FROM json_each(c.data) jd WHERE json_valid(c.data) AND jd.value = 'Fail')`;
  const HAS_PASS = `EXISTS (SELECT 1 FROM json_each(c.data) jd WHERE json_valid(c.data) AND jd.value = 'Pass')`;
  const PASS_FAIL_SQL = `CASE WHEN ${HAS_FAIL} THEN 'fail' WHEN ${HAS_PASS} THEN 'pass' ELSE NULL END`;

  const scope = 'c.app_id = ? AND c.company_id = ?';
  const scopeArgs = [appId, req.companyId];

  const totals = db.prepare(`
    SELECT COUNT(*) AS total FROM completions c WHERE ${scope}
  `).get(...scopeArgs);

  const agg = db.prepare(`
    SELECT
      COUNT(*)                                                  AS total_runs,
      -- Averaged over the SAME runs best_time is taken from. Averaging
      -- unfiltered while the minimum filtered out zeros gave the same missing
      -- data two different answers on one screen: "0s Avg Hands-On Time"
      -- sitting next to "— Best Time · no run has been timed yet". A run with
      -- no recorded duration was never timed; it is not a run that took zero
      -- seconds, and it must not drag an average toward zero.
      AVG(CASE WHEN ${DURATION_SQL} > 0 THEN ${DURATION_SQL} END) AS avg_duration,
      MIN(CASE WHEN ${DURATION_SQL} > 0 THEN ${DURATION_SQL} END) AS best_time,
      SUM(CASE WHEN ${HAS_FAIL} THEN 1 ELSE 0 END)              AS fail_count,
      SUM(CASE WHEN ${HAS_FAIL} THEN 0 WHEN ${HAS_PASS} THEN 1 ELSE 0 END) AS pass_count
    FROM completions c
    WHERE ${scope} AND c.status = 'completed'
  `).get(...scopeArgs);

  const stepRows = db.prepare(`
    SELECT CAST(je.key AS INTEGER) AS idx,
           AVG(CAST(je.value AS REAL)) AS avg_seconds,
           COUNT(*) AS n
    FROM completions c, json_each(c.step_times) je
    WHERE ${scope} AND c.status = 'completed' AND json_valid(c.step_times)
    GROUP BY idx
  `).all(...scopeArgs);
  const stepAgg = new Map(stepRows.map(r => [r.idx, r]));

  const pageRows = db.prepare(`
    SELECT c.id, c.operator_name, c.started_at, c.completed_at, c.status,
           wo.work_order_number,
           ${DURATION_SQL} AS total_duration_seconds,
           ${PASS_FAIL_SQL} AS pass_fail
      FROM completions c
      LEFT JOIN work_orders wo ON wo.id = c.work_order_id
     WHERE ${scope}
     ORDER BY c.started_at DESC
     LIMIT ? OFFSET ?
  `).all(...scopeArgs, limit, (page - 1) * limit);

  let steps = [];
  try { steps = JSON.parse(app.steps) || []; } catch { steps = []; }

  const totalRuns = agg?.total_runs || 0;
  const qcTotal = (agg?.pass_count || 0) + (agg?.fail_count || 0);
  // Every rollup below is null when nothing measured it. An app whose steps
  // carry no Pass/Fail widget has no pass rate — reporting 0% there paints a
  // red "everything failed" on a run that nobody ever inspected. Same for a
  // duration nobody timed and a takt nobody configured: the screen says "—"
  // and why, which is the truth, instead of a number we invented.
  res.json({
    app_id: app.id,
    app_name: app.name,
    total_runs: totalRuns,
    avg_duration: agg?.avg_duration != null ? Math.round(agg.avg_duration) : null,
    best_time: agg?.best_time ?? null,
    pass_rate: qcTotal > 0 ? Math.round((agg.pass_count / qcTotal) * 100) : null,
    qc_sample_size: qcTotal,
    step_averages: steps.map((s, i) => ({
      step_id: s.id,
      step_name: s.name,
      step_order: i,
      avg_duration_seconds: stepAgg.has(i) ? Math.round(stepAgg.get(i).avg_seconds || 0) : null,
      // Legacy v1 blobs store step takt as `takt_time`, v2 as `takt_time_seconds`.
      // Neither present = no takt was ever set for this step, which is not the
      // same as a takt of zero.
      takt_seconds: Number(s.takt_time_seconds ?? s.takt_time) || null,
      completion_count: stepAgg.has(i) ? stepAgg.get(i).n : 0,
    })),
    completions: pageRows.map(r => ({
      id: r.id,
      operator_name: r.operator_name,
      started_at: r.started_at,
      completed_at: r.completed_at,
      total_duration_seconds: r.total_duration_seconds ?? null,
      status: r.status,
      work_order_number: r.work_order_number || null,
      pass_fail: r.pass_fail || null,
    })),
    total: totals.total,
  });
});

router.post('/', (req, res) => {
  const { app_id, station_id, operator_name = 'Unknown', work_order_id, product_type_id, operator_user_id } = req.body;
  if (!app_id) return res.status(400).json({ error: 'app_id required' });
  const app = db.prepare('SELECT name FROM apps WHERE id = ? AND company_id = ?').get(app_id, req.companyId);
  if (!app) return res.status(404).json({ error: 'App not found' });
  // Linked records must belong to this company — otherwise downstream JOINs
  // (v1 API, exports, dashboards) would leak another tenant's station / work
  // order details, and department attribution would cross tenants.
  const ownedOrNull = (table, value) => {
    if (!value) return null;
    const row = db.prepare(`SELECT id FROM ${table} WHERE id = ? AND company_id = ?`).get(value, req.companyId);
    return row ? value : null;
  };
  const safeStationId = ownedOrNull('stations', station_id);
  const safeWorkOrderId = ownedOrNull('work_orders', work_order_id);
  const safeProductTypeId = ownedOrNull('product_types', product_type_id);
  // Verified operator identity (badge/PIN login) — must be a user in this company.
  const safeOperatorUserId = ownedOrNull('users', operator_user_id);
  // Auto-attach the work order's kit (if one was generated) for genealogy-lite.
  let kitId = null;
  if (safeWorkOrderId) {
    const kit = db.prepare(`SELECT id FROM kits WHERE work_order_id = ? AND company_id = ? AND status != 'cancelled'`)
      .get(safeWorkOrderId, req.companyId);
    kitId = kit ? kit.id : null;
  }
  const id = uuidv4();
  db.prepare(`INSERT INTO completions (id, app_id, app_name, station_id, operator_name, work_order_id, product_type_id, operator_user_id, kit_id, company_id, last_activity_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`)
    .run(id, app_id, app.name, safeStationId, operator_name, safeWorkOrderId, safeProductTypeId, safeOperatorUserId, kitId, req.companyId);
  const completion = db.prepare('SELECT * FROM completions WHERE id = ?').get(id);

  // Production advance: an operator started a job. Logged so the Transaction Log
  // shows shop-floor activity in real time.
  logActivity(req.companyId, 'completion', id, `Started ${app.name}`, operator_name, {
    department_id: resolveDepartmentId(completion),
    station_id: safeStationId,
  });

  res.status(201).json({ ...completion, data: JSON.parse(completion.data), step_times: JSON.parse(completion.step_times) });
});

// Structured per-widget capture: value types accepted into completion_values.
const VALUE_TYPES = ['text', 'number', 'boolean', 'photo', 'signature', 'scan', 'timer', 'pass_fail', 'select'];

// Upsert a batch of CompletionValueInput rows for one completion. The
// UNIQUE(completion_id, widget_id) constraint makes autosave idempotent —
// the latest value wins per widget.
const upsertValueStmt = () => db.prepare(`
  INSERT INTO completion_values (id, completion_id, company_id, app_id, step_id, widget_id, variable_name, value_type, value_text, value_number, recorded_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
  ON CONFLICT(completion_id, widget_id) DO UPDATE SET
    step_id = excluded.step_id,
    variable_name = excluded.variable_name,
    value_type = excluded.value_type,
    value_text = excluded.value_text,
    value_number = excluded.value_number,
    recorded_at = excluded.recorded_at
`);

function validateValues(values) {
  if (!Array.isArray(values)) return 'values must be an array';
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (!v || typeof v !== 'object') return `values[${i}] must be an object`;
    if (!v.widget_id || typeof v.widget_id !== 'string') return `values[${i}].widget_id required`;
    if (v.value_type !== undefined && !VALUE_TYPES.includes(v.value_type)) {
      return `values[${i}].value_type must be one of: ${VALUE_TYPES.join(', ')}`;
    }
    if (v.value_number !== undefined && v.value_number !== null && !Number.isFinite(Number(v.value_number))) {
      return `values[${i}].value_number must be a number`;
    }
  }
  return null;
}

router.put('/:id', (req, res) => {
  const { status, data, step_times, takt_exceeded_steps, values, partial } = req.body;
  const completion = db.prepare('SELECT * FROM completions WHERE id = ? AND company_id = ?').get(req.params.id, req.companyId);
  if (!completion) return res.status(404).json({ error: 'Not found' });

  if (values !== undefined) {
    const problem = validateValues(values);
    if (problem) return res.status(400).json({ error: problem });
  }

  // A finished run is IMMUTABLE to autosave. `partial:true` is a background
  // flush from the player's timer. If it lands after the run is already
  // completed or abandoned — a stale tablet, or a handoff where another operator
  // has since finished the job — writing it would silently overwrite the final
  // data, the captured values, the step times, and the completion timestamp
  // (corrupting every duration/OEE/cycle metric derived from completed_at).
  // Leave the terminal run untouched and return it as-is.
  if (partial === true && (completion.status === 'completed' || completion.status === 'abandoned')) {
    return res.json({ ...completion, data: JSON.parse(completion.data), step_times: JSON.parse(completion.step_times) });
  }

  // Guard the status vocabulary. The column's CHECK allows exactly these three;
  // an out-of-set value would abort the transaction as a raw 500 (leaking SQL in
  // dev). Reject it as a 400 instead. A partial flush never carries a status.
  const ALLOWED_STATUS = ['in_progress', 'completed', 'abandoned'];
  if (partial !== true && status !== undefined && !ALLOWED_STATUS.includes(status)) {
    return res.status(400).json({ error: `status must be one of: ${ALLOWED_STATUS.join(', ')}` });
  }

  // Merge the multi-operator roster rather than trusting the client's copy. The
  // player seeds `_operators` into its local formData and sends it on every
  // flush, so a stale tablet would otherwise REPLACE the server roster and drop
  // whoever joined after that tablet loaded. Union stored ∪ incoming, first-seen
  // order preserved — the roster only ever grows.
  if (data && typeof data === 'object' && !Array.isArray(data)) {
    let prevRoster = [];
    try { const prev = JSON.parse(completion.data); if (Array.isArray(prev?._operators)) prevRoster = prev._operators; }
    catch { /* unparsable legacy blob */ }
    const incoming = Array.isArray(data._operators) ? data._operators : [];
    if (prevRoster.length || incoming.length) {
      const merged = [];
      for (const op of [...prevRoster, ...incoming]) if (op != null && !merged.includes(op)) merged.push(op);
      data._operators = merged;
    }
  }

  // partial:true = autosave flush — it must never flip the run's status.
  const effectiveStatus = partial === true ? completion.status : (status ?? completion.status);

  const updates = {
    status: effectiveStatus,
    data: data !== undefined ? JSON.stringify(data) : completion.data,
    step_times: step_times !== undefined ? JSON.stringify(step_times) : completion.step_times,
    takt_exceeded_steps: takt_exceeded_steps !== undefined ? JSON.stringify(takt_exceeded_steps) : completion.takt_exceeded_steps,
    // Stamp completed_at ONLY on the real transition into 'completed' — never on
    // a re-send or a later flush, which would rewrite the finish time and skew
    // every duration/OEE/cycle-time number computed from it.
    completed_at: (effectiveStatus === 'completed' && completion.status !== 'completed')
      ? new Date().toISOString() : completion.completed_at,
    // A person pressing Abandon and the sweeper closing a forgotten run both
    // land on status 'abandoned' — the CHECK constraint allows no other word —
    // so the reason is what tells them apart afterwards. Only stamp it on the
    // real transition, never overwrite a reason already on the row.
    abandoned_reason: (effectiveStatus === 'abandoned' && completion.status !== 'abandoned')
      ? 'operator' : (completion.abandoned_reason || ''),
  };

  // Legacy blob update (dual-write — byte-identical to the pre-v2 behavior)
  // plus the structured completion_values upsert, atomically.
  const applyUpdate = db.transaction(() => {
    // last_activity_at is stamped on EVERY write, autosave flushes included —
    // that is what tells the stale-run reaper the difference between a job
    // someone is still working and one a dead tablet left open.
    db.prepare(`UPDATE completions
                   SET status=?, data=?, step_times=?, takt_exceeded_steps=?, completed_at=?,
                       abandoned_reason=?, last_activity_at=datetime('now')
                 WHERE id=?`)
      .run(updates.status, updates.data, updates.step_times, updates.takt_exceeded_steps,
           updates.completed_at, updates.abandoned_reason, req.params.id);

    if (Array.isArray(values) && values.length > 0) {
      const upsert = upsertValueStmt();
      for (const v of values) {
        upsert.run(
          uuidv4(), completion.id, req.companyId, completion.app_id,
          String(v.step_id ?? ''), String(v.widget_id), String(v.variable_name ?? ''),
          v.value_type || 'text',
          v.value_text !== undefined && v.value_text !== null ? String(v.value_text) : null,
          v.value_number !== undefined && v.value_number !== null ? Number(v.value_number) : null
        );
      }
    }
  });
  applyUpdate();

  // A run transitioning to 'completed' is a production advance: log the job
  // finish and (when linked) the unit counted against its work order.
  const justFinished = effectiveStatus === 'completed' && completion.status !== 'completed';
  if (justFinished) {
    const departmentId = resolveDepartmentId(completion);
    logActivity(req.companyId, 'completion', req.params.id, `Finished ${completion.app_name}`, completion.operator_name, {
      department_id: departmentId,
      station_id: completion.station_id || null,
    });

    // Completing a run counts one unit against its work order
    if (completion.work_order_id) {
      const wo = db.prepare('SELECT * FROM work_orders WHERE id = ? AND company_id = ?').get(completion.work_order_id, req.companyId);
      if (wo) {
        const newQty    = Math.min(wo.quantity_completed + 1, wo.quantity);
        const newStatus = newQty >= wo.quantity
          ? 'completed'
          : (wo.status === 'pending' ? 'in_progress' : wo.status);
        db.prepare(`UPDATE work_orders SET quantity_completed=?, status=?, updated_at=datetime('now') WHERE id=?`)
          .run(newQty, newStatus, wo.id);

        logActivity(req.companyId, 'work_order', wo.id,
          `Quantity advanced to ${newQty}/${wo.quantity}${newStatus === 'completed' ? ' (work order completed)' : ''}`,
          completion.operator_name, { department_id: wo.department_id || departmentId || null });
      }
    }
  }

  const updated = db.prepare('SELECT * FROM completions WHERE id = ?').get(req.params.id);
  res.json({ ...updated, data: JSON.parse(updated.data), step_times: JSON.parse(updated.step_times) });
});

// ─── GET /:id/values — structured per-widget values for one run ───────────────
// Powers the AppHistory detail view and the CSV v2 export. Read-only, so any
// authenticated member (viewer+) may call it; company-scoped like everything else.

router.get('/:id/values', (req, res) => {
  const completion = db.prepare('SELECT id FROM completions WHERE id = ? AND company_id = ?')
    .get(req.params.id, req.companyId);
  if (!completion) return res.status(404).json({ error: 'Not found' });
  const rows = db.prepare(`
    SELECT * FROM completion_values
    WHERE completion_id = ? AND company_id = ?
    ORDER BY recorded_at ASC, step_id ASC, widget_id ASC
  `).all(req.params.id, req.companyId);
  res.json(rows);
});

// ─── Player batch: multi-operator sessions on a completion ────────────────────
// A completion_sessions row is one operator's stint on a run. The player opens
// a session on start/resume and closes it on pause-and-leave, abandon, or
// complete (optionally leaving a handoff comment for the next operator). All
// routes are company-scoped; cross-tenant completion ids 404 like everywhere else.

const listSessionsStmt = () => db.prepare(`
  SELECT * FROM completion_sessions
  WHERE completion_id = ? AND company_id = ?
  ORDER BY started_at ASC, rowid ASC
`);

// GET /:id — one completion, with its operator sessions attached.
router.get('/:id', (req, res) => {
  const completion = db.prepare('SELECT * FROM completions WHERE id = ? AND company_id = ?')
    .get(req.params.id, req.companyId);
  if (!completion) return res.status(404).json({ error: 'Not found' });
  const sessions = listSessionsStmt().all(req.params.id, req.companyId);
  res.json({
    ...completion,
    data: JSON.parse(completion.data),
    step_times: JSON.parse(completion.step_times),
    sessions,
  });
});

// POST /:id/sessions — open a session (run start or resume by any operator).
// Body: { operator_name, operator_user_id? }. Any still-open session on the run
// is closed first (tablet crash / battery death must never wedge a job), so at
// most one session per completion is ever open.
router.post('/:id/sessions', (req, res) => {
  const completion = db.prepare('SELECT * FROM completions WHERE id = ? AND company_id = ?')
    .get(req.params.id, req.companyId);
  if (!completion) return res.status(404).json({ error: 'Not found' });
  const { operator_name, operator_user_id } = req.body || {};
  if (!operator_name || typeof operator_name !== 'string' || !operator_name.trim()) {
    return res.status(400).json({ error: 'operator_name required' });
  }
  // Verified identity must belong to this company or it is dropped (spoof guard).
  const safeUserId = operator_user_id
    ? (db.prepare('SELECT id FROM users WHERE id = ? AND company_id = ?').get(operator_user_id, req.companyId) ? operator_user_id : null)
    : null;

  const id = uuidv4();
  const open = db.transaction(() => {
    db.prepare(`
      UPDATE completion_sessions SET ended_at = datetime('now')
      WHERE completion_id = ? AND company_id = ? AND ended_at IS NULL
    `).run(completion.id, req.companyId);
    db.prepare(`
      INSERT INTO completion_sessions (id, company_id, completion_id, operator_user_id, operator_name)
      VALUES (?, ?, ?, ?, ?)
    `).run(id, req.companyId, completion.id, safeUserId, operator_name.trim());

    // Dual-write the distinct operator roster into completions.data._operators
    // so the legacy blob (exports, history views) knows every hand on the unit.
    let data;
    try { data = JSON.parse(completion.data); } catch { data = {}; }
    if (!data || typeof data !== 'object' || Array.isArray(data)) data = {};
    const names = Array.isArray(data._operators) ? data._operators.map(String) : [];
    if (!names.includes(operator_name.trim())) names.push(operator_name.trim());
    data._operators = names;
    // Opening a session is a resume — it counts as activity, so a job picked
    // back up after a long pause gets its reaper clock reset.
    db.prepare("UPDATE completions SET data = ?, last_activity_at = datetime('now') WHERE id = ?")
      .run(JSON.stringify(data), completion.id);
  });
  open();

  logActivity(req.companyId, 'completion', completion.id,
    `${operator_name.trim()} joined ${completion.app_name}`, operator_name.trim(), {
      department_id: resolveDepartmentId(completion),
      station_id: completion.station_id || null,
    });

  const session = db.prepare('SELECT * FROM completion_sessions WHERE id = ?').get(id);
  res.status(201).json(session);
});

// PUT /:id/sessions/close — close the run's open session (pause-and-leave,
// abandon, or complete). Body: { handoff_comment? } — shown to the next
// operator as a banner when they resume the job.
router.put('/:id/sessions/close', (req, res) => {
  const completion = db.prepare('SELECT id FROM completions WHERE id = ? AND company_id = ?')
    .get(req.params.id, req.companyId);
  if (!completion) return res.status(404).json({ error: 'Not found' });
  const { handoff_comment } = req.body || {};
  const open = db.prepare(`
    SELECT id FROM completion_sessions
    WHERE completion_id = ? AND company_id = ? AND ended_at IS NULL
    ORDER BY started_at DESC, rowid DESC LIMIT 1
  `).get(completion.id, req.companyId);
  if (!open) return res.status(404).json({ error: 'No open session for this run' });
  db.prepare(`
    UPDATE completion_sessions
    SET ended_at = datetime('now'), handoff_comment = ?
    WHERE id = ?
  `).run(typeof handoff_comment === 'string' ? handoff_comment : '', open.id);
  // A clean pause-and-leave is still someone deliberately touching the run.
  db.prepare("UPDATE completions SET last_activity_at = datetime('now') WHERE id = ? AND company_id = ?")
    .run(completion.id, req.companyId);
  res.json(db.prepare('SELECT * FROM completion_sessions WHERE id = ?').get(open.id));
});

module.exports = router;

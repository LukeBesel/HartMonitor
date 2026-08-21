const express = require('express');
const { v4: uuidv4 } = require('uuid');
const db = require('../db');
const { logActivity } = require('../activity');

const router = express.Router();

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
  const { limit = 50, status, operator_name } = req.query;
  let query = 'SELECT * FROM completions WHERE company_id = ?';
  const params = [req.companyId];
  if (status) { query += ' AND status = ?'; params.push(status); }
  if (operator_name) { query += ' AND operator_name = ?'; params.push(operator_name); }
  query += ' ORDER BY started_at DESC LIMIT ?';
  // Guard against NaN (better-sqlite3 throws on NaN bindings) and cap the page size.
  params.push(Math.min(Math.max(parseInt(limit, 10) || 50, 1), 500));
  const completions = db.prepare(query).all(...params);
  res.json(completions.map(c => ({ ...c, data: JSON.parse(c.data), step_times: JSON.parse(c.step_times) })));
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
  db.prepare('INSERT INTO completions (id, app_id, app_name, station_id, operator_name, work_order_id, product_type_id, operator_user_id, kit_id, company_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
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

  // partial:true = autosave flush — it must never flip the run's status.
  const effectiveStatus = partial === true ? completion.status : status;

  const updates = {
    status: effectiveStatus ?? completion.status,
    data: data !== undefined ? JSON.stringify(data) : completion.data,
    step_times: step_times !== undefined ? JSON.stringify(step_times) : completion.step_times,
    takt_exceeded_steps: takt_exceeded_steps !== undefined ? JSON.stringify(takt_exceeded_steps) : completion.takt_exceeded_steps,
    completed_at: effectiveStatus === 'completed' ? new Date().toISOString() : completion.completed_at,
  };

  // Legacy blob update (dual-write — byte-identical to the pre-v2 behavior)
  // plus the structured completion_values upsert, atomically.
  const applyUpdate = db.transaction(() => {
    db.prepare('UPDATE completions SET status=?, data=?, step_times=?, takt_exceeded_steps=?, completed_at=? WHERE id=?')
      .run(updates.status, updates.data, updates.step_times, updates.takt_exceeded_steps, updates.completed_at, req.params.id);

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

module.exports = router;

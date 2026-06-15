const express = require('express');
const db = require('../db');

const router = express.Router();

// ─── Helpers ──────────────────────────────────────────────────────────────────

// A completion belongs to its work order's department, falling back to its
// station's department when it ran without a work order. Mirrors the convention
// used throughout analytics.js (COALESCE(wo.department_id, st.department_id)).
const COMPLETION_DEPT = 'COALESCE(wo.department_id, st.department_id)';

// Inspect a completion's recorded data for explicit Pass/Fail QC results.
// Returns 'fail' if any value is 'Fail', 'pass' if any value is 'Pass', else null.
function passFailOf(dataStr) {
  let data;
  try { data = JSON.parse(dataStr || '{}'); } catch { return null; }
  const vals = Object.values(data);
  if (vals.some(v => v === 'Fail')) return 'fail';
  if (vals.some(v => v === 'Pass')) return 'pass';
  return null;
}

function isValidDate(s) {
  return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
}

// ─── GET /api/sqdc?date=YYYY-MM-DD&department_id= ──────────────────────────────
// Aggregates the four classic lean board metrics for a single day, scoped to the
// company (and optionally a department) — Safety, Quality, Delivery, Cost.

router.get('/', (req, res) => {
  const cid = req.companyId;
  const date = isValidDate(req.query.date) ? req.query.date : new Date().toISOString().slice(0, 10);
  const deptId = req.query.department_id || null;

  // Hourly labor rate used for the labor-cost estimate. Pulled from org/company
  // settings when present, otherwise a sensible default.
  const rateSetting =
    db.prepare("SELECT value FROM org_settings WHERE company_id = ? AND key = 'labor_rate_per_hour'").get(cid)?.value ??
    db.prepare("SELECT value FROM company_settings WHERE key = 'labor_rate_per_hour'").get()?.value;
  const laborRate = Number(rateSetting) > 0 ? Number(rateSetting) : 45;

  const deptClause = deptId ? ` AND ${COMPLETION_DEPT} = ?` : '';
  const deptParam = deptId ? [deptId] : [];

  // ─── SAFETY ──────────────────────────────────────────────────────────────
  // Safety NCRs are those whose source is 'safety' (case-insensitive). We also
  // surface NCRs created on the date so the board reflects "what happened today".
  const safetyOnDate = db.prepare(`
    SELECT id, ncr_number, title, severity, status, source, created_at
    FROM ncrs
    WHERE company_id = ? AND lower(source) = 'safety' AND date(created_at) = ?
    ORDER BY CASE severity WHEN 'critical' THEN 1 WHEN 'major' THEN 2 ELSE 3 END, created_at DESC
  `).all(cid, date);

  // Days since the most recent safety incident (relative to the selected date).
  const lastSafety = db.prepare(`
    SELECT date(created_at) AS d FROM ncrs
    WHERE company_id = ? AND lower(source) = 'safety' AND date(created_at) <= ?
    ORDER BY created_at DESC LIMIT 1
  `).get(cid, date);
  let daysSinceIncident = null;
  if (lastSafety?.d) {
    const diff = Math.round((new Date(date + 'T00:00:00').getTime() - new Date(lastSafety.d + 'T00:00:00').getTime()) / 86400000);
    daysSinceIncident = Math.max(0, diff);
  }

  const safety = {
    incidents_on_date: safetyOnDate.length,
    days_since_last_incident: daysSinceIncident, // null = no safety incident ever recorded
    incidents: safetyOnDate,
  };

  // ─── QUALITY ─────────────────────────────────────────────────────────────
  // Pass/first-pass yield from completions finished on the date.
  const qcRows = db.prepare(`
    SELECT c.data
    FROM completions c
    LEFT JOIN work_orders wo ON wo.id = c.work_order_id
    LEFT JOIN stations    st ON st.id = c.station_id
    WHERE c.company_id = ? AND c.status = 'completed' AND date(c.completed_at) = ?${deptClause}
  `).all(cid, date, ...deptParam);

  let pass = 0, fail = 0;
  for (const r of qcRows) {
    const pf = passFailOf(r.data);
    if (pf === 'pass') pass++;
    else if (pf === 'fail') fail++;
  }
  const inspected = pass + fail;
  const passRate = inspected > 0 ? Math.round((pass / inspected) * 100) : null;

  const ncrsOpened = db.prepare(
    `SELECT COUNT(*) AS c FROM ncrs WHERE company_id = ? AND date(created_at) = ?`
  ).get(cid, date).c;
  const ncrsClosed = db.prepare(
    `SELECT COUNT(*) AS c FROM ncrs WHERE company_id = ? AND status IN ('resolved','closed') AND date(resolved_at) = ?`
  ).get(cid, date).c;

  const quality = {
    pass_rate: passRate,            // null = nothing inspected on the date
    first_pass_yield: passRate,     // single-pass proxy: same as pass rate here
    units_inspected: inspected,
    pass_count: pass,
    fail_count: fail,
    ncrs_opened: ncrsOpened,
    ncrs_closed: ncrsClosed,
  };

  // ─── DELIVERY ────────────────────────────────────────────────────────────
  // Work orders scheduled to finish on the date (due) vs. those completed.
  const woDeptClause = deptId ? ' AND wo.department_id = ?' : '';
  const dueRows = db.prepare(`
    SELECT wo.id, wo.work_order_number, wo.part_name, wo.status,
           wo.scheduled_end, wo.quantity, wo.quantity_completed, wo.updated_at
    FROM work_orders wo
    WHERE wo.company_id = ? AND date(wo.scheduled_end) = ? AND wo.status != 'cancelled'${woDeptClause}
  `).all(cid, date, ...deptParam);

  const dueCount = dueRows.length;
  const completedOfDue = dueRows.filter(w => w.status === 'completed').length;
  // On-time = completed and the completion (updated_at) landed on/before the due day.
  const onTime = dueRows.filter(
    w => w.status === 'completed' && w.updated_at && w.updated_at.slice(0, 10) <= w.scheduled_end.slice(0, 10)
  ).length;
  const onTimePct = dueCount > 0 ? Math.round((onTime / dueCount) * 100) : null;

  // Overdue right now: past their due date, not finished. Counted against the date.
  const overdue = db.prepare(`
    SELECT COUNT(*) AS c FROM work_orders wo
    WHERE wo.company_id = ? AND wo.status NOT IN ('completed','cancelled')
      AND wo.scheduled_end IS NOT NULL AND date(wo.scheduled_end) < ?${woDeptClause}
  `).get(cid, date, ...deptParam).c;

  // Completed on the date (regardless of original due date) — throughput signal.
  const completedOnDate = db.prepare(`
    SELECT COUNT(*) AS c FROM work_orders wo
    WHERE wo.company_id = ? AND wo.status = 'completed' AND date(wo.updated_at) = ?${woDeptClause}
  `).get(cid, date, ...deptParam).c;

  const delivery = {
    due_count: dueCount,
    completed_of_due: completedOfDue,
    completed_on_date: completedOnDate,
    on_time_pct: onTimePct,        // null = nothing due on the date
    overdue_count: overdue,
    due_orders: dueRows.map(w => ({
      id: w.id,
      work_order_number: w.work_order_number,
      part_name: w.part_name,
      status: w.status,
      on_time: w.status === 'completed' && w.updated_at && w.updated_at.slice(0, 10) <= w.scheduled_end.slice(0, 10),
    })),
  };

  // ─── COST ────────────────────────────────────────────────────────────────
  // Labor hours = sum of completion durations on the date. Units = completed runs.
  const costRow = db.prepare(`
    SELECT
      COUNT(*) AS units,
      SUM(MAX(0, (julianday(c.completed_at) - julianday(c.started_at)) * 24)) AS labor_hours
    FROM completions c
    LEFT JOIN work_orders wo ON wo.id = c.work_order_id
    LEFT JOIN stations    st ON st.id = c.station_id
    WHERE c.company_id = ? AND c.status = 'completed'
      AND c.completed_at IS NOT NULL AND date(c.completed_at) = ?${deptClause}
  `).get(cid, date, ...deptParam);

  const laborHours = Math.round((costRow?.labor_hours || 0) * 10) / 10;
  const units = costRow?.units || 0;
  const laborCost = Math.round(laborHours * laborRate * 100) / 100;
  const costPerUnit = units > 0 ? Math.round((laborCost / units) * 100) / 100 : null;

  const cost = {
    labor_hours: laborHours,
    labor_rate: laborRate,
    labor_cost: laborCost,
    units_produced: units,
    cost_per_unit: costPerUnit,
  };

  // ─── 7-day trend (ending on the selected date) for small sparklines ───────
  const trend = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(date + 'T00:00:00');
    d.setDate(d.getDate() - i);
    const ds = d.toISOString().slice(0, 10);

    const tQc = db.prepare(`
      SELECT c.data FROM completions c
      LEFT JOIN work_orders wo ON wo.id = c.work_order_id
      LEFT JOIN stations    st ON st.id = c.station_id
      WHERE c.company_id = ? AND c.status = 'completed' AND date(c.completed_at) = ?${deptClause}
    `).all(cid, ds, ...deptParam);
    let p = 0, fl = 0;
    for (const r of tQc) {
      const pf = passFailOf(r.data);
      if (pf === 'pass') p++; else if (pf === 'fail') fl++;
    }

    const tCompleted = db.prepare(`
      SELECT COUNT(*) AS c FROM completions c
      LEFT JOIN work_orders wo ON wo.id = c.work_order_id
      LEFT JOIN stations    st ON st.id = c.station_id
      WHERE c.company_id = ? AND c.status = 'completed' AND date(c.completed_at) = ?${deptClause}
    `).get(cid, ds, ...deptParam).c;

    const tSafety = db.prepare(
      `SELECT COUNT(*) AS c FROM ncrs WHERE company_id = ? AND lower(source) = 'safety' AND date(created_at) = ?`
    ).get(cid, ds).c;

    trend.push({
      date: ds,
      pass_rate: (p + fl) > 0 ? Math.round((p / (p + fl)) * 100) : 0,
      units: tCompleted,
      safety_incidents: tSafety,
    });
  }

  res.json({ date, department_id: deptId, safety, quality, delivery, cost, trend });
});

// ─── GET /api/sqdc/department/:id?date= ───────────────────────────────────────
// Per-department day snapshot for the TV view: live status counts, hourly
// throughput, issues, and the fastest-completion leaderboard for the date.

router.get('/department/:id', (req, res) => {
  const cid = req.companyId;
  const deptId = req.params.id;
  const date = isValidDate(req.query.date) ? req.query.date : new Date().toISOString().slice(0, 10);

  const dept = db.prepare('SELECT id, name, color, manager_name FROM departments WHERE id = ? AND company_id = ?').get(deptId, cid);
  if (!dept) return res.status(404).json({ error: 'Department not found' });

  // Live work-order status counts for the department.
  const running = db.prepare(
    `SELECT COUNT(*) AS c FROM work_orders WHERE company_id = ? AND department_id = ? AND status = 'in_progress'`
  ).get(cid, deptId).c;
  const upcoming = db.prepare(
    `SELECT COUNT(*) AS c FROM work_orders WHERE company_id = ? AND department_id = ? AND status = 'pending'`
  ).get(cid, deptId).c;

  const completedToday = db.prepare(`
    SELECT COUNT(*) AS c FROM completions c
    LEFT JOIN work_orders wo ON wo.id = c.work_order_id
    LEFT JOIN stations    st ON st.id = c.station_id
    WHERE c.company_id = ? AND ${COMPLETION_DEPT} = ? AND c.status = 'completed' AND date(c.completed_at) = ?
  `).get(cid, deptId, date).c;

  // Hourly throughput for the date.
  const hourlyRows = db.prepare(`
    SELECT CAST(strftime('%H', c.completed_at) AS INTEGER) AS hour, COUNT(*) AS count
    FROM completions c
    LEFT JOIN work_orders wo ON wo.id = c.work_order_id
    LEFT JOIN stations    st ON st.id = c.station_id
    WHERE c.company_id = ? AND ${COMPLETION_DEPT} = ? AND c.status = 'completed' AND date(c.completed_at) = ?
    GROUP BY hour
  `).all(cid, deptId, date);
  const hourMap = {};
  for (const r of hourlyRows) hourMap[r.hour] = r.count;
  const hourly = [];
  for (let h = 6; h <= 18; h++) {
    hourly.push({ hour: `${String(h).padStart(2, '0')}:00`, count: hourMap[h] || 0 });
  }

  // Issues: overdue/behind work orders + open NCRs touching this department.
  const overdueWOs = db.prepare(`
    SELECT work_order_number, part_name, scheduled_end
    FROM work_orders
    WHERE company_id = ? AND department_id = ? AND status NOT IN ('completed','cancelled')
      AND scheduled_end IS NOT NULL AND scheduled_end < datetime('now')
    ORDER BY scheduled_end ASC LIMIT 6
  `).all(cid, deptId);

  const openNcrs = db.prepare(`
    SELECT DISTINCT n.ncr_number, n.title, n.severity
    FROM ncrs n
    LEFT JOIN work_orders wo ON wo.id = n.work_order_id
    WHERE n.company_id = ? AND n.status NOT IN ('resolved','closed') AND wo.department_id = ?
    ORDER BY CASE n.severity WHEN 'critical' THEN 1 WHEN 'major' THEN 2 ELSE 3 END LIMIT 6
  `).all(cid, deptId);

  const issues = [
    ...overdueWOs.map(w => ({ type: 'overdue', label: w.work_order_number, detail: w.part_name || 'Overdue work order' })),
    ...openNcrs.map(n => ({ type: 'ncr', label: n.ncr_number, detail: `${n.title} (${n.severity})` })),
  ];

  // Leaderboard: fastest completions in the department for the date.
  const leaderboardRows = db.prepare(`
    SELECT c.operator_name, c.app_name,
           ROUND((julianday(c.completed_at) - julianday(c.started_at)) * 24 * 60, 1) AS duration_minutes
    FROM completions c
    LEFT JOIN work_orders wo ON wo.id = c.work_order_id
    LEFT JOIN stations    st ON st.id = c.station_id
    WHERE c.company_id = ? AND ${COMPLETION_DEPT} = ? AND c.status = 'completed'
      AND c.completed_at IS NOT NULL AND date(c.completed_at) = ?
      AND (julianday(c.completed_at) - julianday(c.started_at)) > 0
    ORDER BY duration_minutes ASC LIMIT 5
  `).all(cid, deptId, date);

  res.json({
    department: dept,
    date,
    status: { running, completed_today: completedToday, upcoming },
    hourly,
    issues,
    leaderboard: leaderboardRows,
  });
});

module.exports = router;

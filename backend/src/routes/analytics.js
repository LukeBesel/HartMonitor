const express = require('express');
const db = require('../db');
const { calcScheduleStatus } = require('./workorders');
const { calcOEE } = require('./oee');

const router = express.Router();

// ─── GET /overview ────────────────────────────────────────────────────────────

router.get('/overview', (req, res) => {
  const totalCompletions  = db.prepare("SELECT COUNT(*) as c FROM completions WHERE status='completed'").get().c;
  const todayCompletions  = db.prepare("SELECT COUNT(*) as c FROM completions WHERE status='completed' AND date(completed_at)=date('now')").get().c;
  const inProgress        = db.prepare("SELECT COUNT(*) as c FROM completions WHERE status='in_progress'").get().c;
  const totalApps         = db.prepare("SELECT COUNT(*) as c FROM apps").get().c;
  const publishedApps     = db.prepare("SELECT COUNT(*) as c FROM apps WHERE status='published'").get().c;
  const activeStations    = db.prepare("SELECT COUNT(*) as c FROM stations WHERE status='active'").get().c;

  const cycleTimeResult = db.prepare(`
    SELECT AVG((julianday(completed_at) - julianday(started_at)) * 24 * 60) as avg_minutes
    FROM completions WHERE status='completed' AND completed_at IS NOT NULL
  `).get();
  const avgCycleTime = cycleTimeResult?.avg_minutes ? Math.round(cycleTimeResult.avg_minutes) : 0;

  const passFailData = db.prepare(`SELECT data FROM completions WHERE status='completed' LIMIT 500`).all();
  let passCount = 0, failCount = 0;
  for (const row of passFailData) {
    const data = JSON.parse(row.data);
    const vals = Object.values(data);
    if (vals.some(v => v === 'Pass')) passCount++;
    if (vals.some(v => v === 'Fail')) failCount++;
  }
  const totalQC  = passCount + failCount;
  const passRate = totalQC > 0 ? Math.round((passCount / totalQC) * 100) : 0;

  res.json({ totalCompletions, todayCompletions, inProgress, totalApps, publishedApps, activeStations, avgCycleTime, passRate });
});

// ─── GET /throughput ──────────────────────────────────────────────────────────

router.get('/throughput', (req, res) => {
  const { days = 30 } = req.query;
  const rows = db.prepare(`
    SELECT date(completed_at) as date, COUNT(*) as count
    FROM completions
    WHERE status='completed' AND completed_at >= date('now', '-' || ? || ' days')
    GROUP BY date(completed_at)
    ORDER BY date ASC
  `).all(parseInt(days));
  res.json(rows);
});

// ─── GET /cycle-times ─────────────────────────────────────────────────────────

router.get('/cycle-times', (req, res) => {
  const { days = 30 } = req.query;
  const rows = db.prepare(`
    SELECT
      date(completed_at) as date,
      ROUND(AVG((julianday(completed_at) - julianday(started_at)) * 24 * 60), 1) as avg_minutes,
      ROUND(MIN((julianday(completed_at) - julianday(started_at)) * 24 * 60), 1) as min_minutes,
      ROUND(MAX((julianday(completed_at) - julianday(started_at)) * 24 * 60), 1) as max_minutes
    FROM completions
    WHERE status='completed' AND completed_at IS NOT NULL
      AND completed_at >= date('now', '-' || ? || ' days')
    GROUP BY date(completed_at)
    ORDER BY date ASC
  `).all(parseInt(days));
  res.json(rows);
});

// ─── GET /operator-performance ────────────────────────────────────────────────

router.get('/operator-performance', (req, res) => {
  const rows = db.prepare(`
    SELECT
      operator_name,
      COUNT(*) as completions,
      ROUND(AVG((julianday(completed_at) - julianday(started_at)) * 24 * 60), 1) as avg_cycle_minutes
    FROM completions
    WHERE status='completed' AND completed_at IS NOT NULL
    GROUP BY operator_name
    ORDER BY completions DESC
    LIMIT 20
  `).all();
  res.json(rows);
});

// ─── GET /app-performance ─────────────────────────────────────────────────────

router.get('/app-performance', (req, res) => {
  const rows = db.prepare(`
    SELECT
      app_id,
      app_name,
      COUNT(*) as completions,
      ROUND(AVG((julianday(completed_at) - julianday(started_at)) * 24 * 60), 1) as avg_cycle_minutes,
      COUNT(CASE WHEN status='abandoned' THEN 1 END) as abandoned_count
    FROM completions
    GROUP BY app_id, app_name
    ORDER BY completions DESC
  `).all();
  res.json(rows);
});

// ─── GET /quality ─────────────────────────────────────────────────────────────

router.get('/quality', (req, res) => {
  const { days = 30 } = req.query;
  const rows = db.prepare(`
    SELECT date(completed_at) as date, data
    FROM completions
    WHERE status='completed' AND completed_at >= date('now', '-' || ? || ' days')
    ORDER BY completed_at ASC
  `).all(parseInt(days));

  const byDate = {};
  for (const row of rows) {
    const data = JSON.parse(row.data);
    if (!byDate[row.date]) byDate[row.date] = { date: row.date, pass: 0, fail: 0 };
    const vals = Object.values(data);
    if (vals.some(v => v === 'Fail')) byDate[row.date].fail++;
    else byDate[row.date].pass++;
  }
  res.json(Object.values(byDate).sort((a, b) => a.date.localeCompare(b.date)));
});

// ─── GET /manager-view ────────────────────────────────────────────────────────

router.get('/manager-view', (req, res) => {
  // Active (in-progress) completions joined with app and work order info
  const activeCompletions = db.prepare(`
    SELECT
      c.id, c.app_id, c.app_name, c.station_id, c.operator_name,
      c.started_at, c.status, c.work_order_id,
      a.name AS app_name_joined,
      wo.work_order_number, wo.part_name, wo.part_number,
      wo.quantity, wo.quantity_completed, wo.status AS wo_status,
      wo.priority, wo.department_id,
      d.name AS department_name, d.color AS department_color
    FROM completions c
    LEFT JOIN apps        a  ON a.id  = c.app_id
    LEFT JOIN work_orders wo ON wo.id = c.work_order_id
    LEFT JOIN departments d  ON d.id  = wo.department_id
    WHERE c.status = 'in_progress'
    ORDER BY c.started_at DESC
  `).all();

  // All non-cancelled work orders enriched with schedule_status
  const allWorkOrders = db.prepare(`
    SELECT
      wo.*,
      d.name  AS department_name,
      d.color AS department_color,
      a.name  AS app_name
    FROM work_orders wo
    LEFT JOIN departments d ON d.id = wo.department_id
    LEFT JOIN apps        a ON a.id = wo.app_id
    WHERE wo.status != 'cancelled'
    ORDER BY wo.priority DESC, wo.scheduled_end ASC
  `).all();

  const workOrders = allWorkOrders.map(wo => ({
    ...wo,
    schedule_status: calcScheduleStatus(wo),
    completion_pct: wo.quantity > 0 ? Math.round((wo.quantity_completed / wo.quantity) * 100) : 0,
  }));

  // Per-department stats
  const depts = db.prepare('SELECT * FROM departments').all();
  const departmentStats = depts.map(dept => {
    const deptWOs = workOrders.filter(wo => wo.department_id === dept.id);
    const activeCount   = deptWOs.filter(wo => wo.status === 'in_progress').length;
    const onTrackCount  = deptWOs.filter(wo => wo.schedule_status === 'on_track').length;
    const behindCount   = deptWOs.filter(wo => ['behind', 'overdue'].includes(wo.schedule_status)).length;
    return {
      id:           dept.id,
      name:         dept.name,
      color:        dept.color,
      manager_name: dept.manager_name,
      active_count: activeCount,
      on_track_count: onTrackCount,
      behind_count: behindCount,
      total_work_orders: deptWOs.length,
    };
  });

  res.json({
    active_completions: activeCompletions,
    work_orders:        workOrders,
    department_stats:   departmentStats,
  });
});

// ─── GET /plant-view ──────────────────────────────────────────────────────────

router.get('/plant-view', (req, res) => {
  // KPIs
  const todayCompleted = db.prepare("SELECT COUNT(*) as c FROM completions WHERE status='completed' AND date(completed_at)=date('now')").get().c;
  const activeNow      = db.prepare("SELECT COUNT(*) as c FROM completions WHERE status='in_progress'").get().c;

  const ctRow = db.prepare(`
    SELECT AVG((julianday(completed_at) - julianday(started_at)) * 24 * 60) as avg_minutes
    FROM completions WHERE status='completed' AND completed_at IS NOT NULL
  `).get();
  const avgCycleTime = ctRow?.avg_minutes ? Math.round(ctRow.avg_minutes) : 0;

  // Pass rate over the last 7 days, counting only completions with explicit QC results
  const pfRows = db.prepare(`
    SELECT data FROM completions
    WHERE status='completed' AND completed_at >= datetime('now', '-7 days')
  `).all();
  let pass = 0, fail = 0;
  for (const row of pfRows) {
    const vals = Object.values(JSON.parse(row.data));
    if (vals.some(v => v === 'Fail')) fail++;
    else if (vals.some(v => v === 'Pass')) pass++;
  }
  const passRate = (pass + fail) > 0 ? Math.round((pass / (pass + fail)) * 100) : 0;

  // Schedule adherence: % of work orders currently on_track or completed
  const allWOs = db.prepare(`
    SELECT wo.*, d.name AS department_name, d.color AS department_color, a.name AS app_name
    FROM work_orders wo
    LEFT JOIN departments d ON d.id = wo.department_id
    LEFT JOIN apps        a ON a.id = wo.app_id
    WHERE wo.status != 'cancelled'
  `).all().map(wo => ({ ...wo, schedule_status: calcScheduleStatus(wo) }));

  const woSummary = { on_track: 0, at_risk: 0, behind: 0, not_started: 0, completed: 0 };
  for (const wo of allWOs) {
    if (woSummary[wo.schedule_status] !== undefined) woSummary[wo.schedule_status]++;
    else woSummary.behind++;
  }
  const adherenceBase = allWOs.length;
  const scheduleAdherence = adherenceBase > 0
    ? Math.round(((woSummary.on_track + woSummary.completed) / adherenceBase) * 100)
    : 0;

  // Department performance. A completion belongs to its work order's department,
  // falling back to its station's department when it ran without a work order.
  const depts = db.prepare('SELECT * FROM departments').all();
  const departmentPerformance = depts.map(dept => {
    const deptWOs = allWOs.filter(wo => wo.department_id === dept.id);

    const completionCountToday = db.prepare(`
      SELECT COUNT(*) as c
      FROM completions c
      LEFT JOIN work_orders wo ON wo.id = c.work_order_id
      LEFT JOIN stations st    ON st.id = c.station_id
      WHERE COALESCE(wo.department_id, st.department_id) = ?
        AND c.status = 'completed' AND date(c.completed_at) = date('now')
    `).get(dept.id).c;

    const ctDept = db.prepare(`
      SELECT AVG((julianday(c.completed_at) - julianday(c.started_at)) * 24 * 60) as avg_minutes
      FROM completions c
      LEFT JOIN work_orders wo ON wo.id = c.work_order_id
      LEFT JOIN stations st    ON st.id = c.station_id
      WHERE COALESCE(wo.department_id, st.department_id) = ?
        AND c.status = 'completed' AND c.completed_at IS NOT NULL
    `).get(dept.id);
    const avgCycleDept = ctDept?.avg_minutes ? Math.round(ctDept.avg_minutes) : 0;

    const onTrack = deptWOs.filter(wo => wo.schedule_status === 'on_track' || wo.schedule_status === 'completed').length;
    const onTrackPct = deptWOs.length > 0 ? Math.round((onTrack / deptWOs.length) * 100) : 100;
    const status = deptWOs.length === 0 ? 'on_track' : onTrackPct >= 80 ? 'on_track' : onTrackPct >= 50 ? 'at_risk' : 'behind';

    const taktTimes = deptWOs.map(wo => wo.takt_time_minutes).filter(t => t > 0);
    const taktTime = taktTimes.length ? Math.round((taktTimes.reduce((s, t) => s + t, 0) / taktTimes.length) * 10) / 10 : 0;

    return {
      id:               dept.id,
      department:       dept.name,
      color:            dept.color,
      completion_count: completionCountToday,
      avg_cycle_time:   avgCycleDept,
      takt_time:        taktTime,
      on_track_count:   onTrack,
      total_count:      deptWOs.length,
      status,
    };
  });

  // Hourly throughput for last 24 hours
  const hourlyThroughput = db.prepare(`
    SELECT
      strftime('%Y-%m-%dT%H:00:00', completed_at) as hour,
      COUNT(*) as count
    FROM completions
    WHERE status = 'completed'
      AND completed_at >= datetime('now', '-24 hours')
    GROUP BY strftime('%Y-%m-%dT%H:00:00', completed_at)
    ORDER BY hour ASC
  `).all();

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
      d.name AS department_name
    FROM completions c
    LEFT JOIN work_orders wo ON wo.id = c.work_order_id
    LEFT JOIN stations st    ON st.id = c.station_id
    LEFT JOIN departments d  ON d.id  = COALESCE(wo.department_id, st.department_id)
    ORDER BY datetime(COALESCE(c.completed_at, c.started_at)) DESC
    LIMIT 15
  `).all().map(c => {
    const end = c.completed_at ? new Date(c.completed_at) : new Date();
    const durationMinutes = Math.round(((end - new Date(c.started_at)) / 60000) * 10) / 10;
    return {
      id:               c.id,
      app_name:         c.app_name,
      operator_name:    c.operator_name,
      department:       c.department_name || 'Unassigned',
      completed_at:     c.completed_at || c.started_at,
      duration_minutes: durationMinutes,
      status:           c.status,
    };
  });

  res.json({
    kpis: {
      total_completed_today: todayCompleted,
      active_now:            activeNow,
      pass_rate:             passRate,
      avg_cycle_time:        avgCycleTime,
      schedule_adherence:    scheduleAdherence,
      work_orders_on_track:  woSummary.on_track,
      work_orders_total:     allWOs.length,
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
  const days = parseInt(req.query.days || '90');

  const app = db.prepare('SELECT id, name, steps FROM apps WHERE id = ?').get(appId);
  if (!app) return res.status(404).json({ error: 'App not found' });

  const steps = JSON.parse(app.steps || '[]');

  const rows = db.prepare(`
    SELECT step_times, takt_exceeded_steps, date(completed_at) as date
    FROM completions
    WHERE app_id = ? AND status = 'completed' AND completed_at IS NOT NULL
      AND completed_at >= date('now', '-' || ? || ' days')
    ORDER BY completed_at ASC
  `).all(appId, days);

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
    WHERE wo.status NOT IN ('completed', 'cancelled')
    ORDER BY wo.priority DESC, wo.scheduled_end ASC
  `).all();

  const enriched = workOrders.map(wo => {
    const ctRow = db.prepare(`
      SELECT AVG((julianday(completed_at) - julianday(started_at)) * 24 * 60) AS avg_minutes
      FROM completions
      WHERE work_order_id = ? AND status = 'completed' AND completed_at IS NOT NULL
    `).get(wo.id);

    const avgCycleMinutes = ctRow?.avg_minutes
      ? Math.round(ctRow.avg_minutes * 10) / 10
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
      operators_needed_8h: operatorsNeeded,
      days_remaining: daysRemaining,
      scheduled_end: wo.scheduled_end,
      priority: wo.priority,
      status: wo.status,
      department_name: wo.department_name || 'Unassigned',
      department_color: wo.department_color || '#6b7280',
    };
  });

  const deptMap = {};
  for (const wo of enriched) {
    const dept = wo.department_name;
    if (!deptMap[dept]) deptMap[dept] = {
      name: dept,
      color: wo.department_color,
      hours_required: 0,
      operators_needed: 0,
      work_order_count: 0,
    };
    deptMap[dept].hours_required += wo.hours_required;
    deptMap[dept].operators_needed += wo.operators_needed_8h;
    deptMap[dept].work_order_count += 1;
  }

  const departments = Object.values(deptMap).map(d => ({
    ...d,
    hours_required: Math.round(d.hours_required * 10) / 10,
    operators_needed: Math.round(d.operators_needed * 10) / 10,
  }));

  res.json({
    work_orders: enriched,
    summary: {
      total_hours_required: Math.round(enriched.reduce((s, wo) => s + wo.hours_required, 0) * 10) / 10,
      total_operators_needed_8h: Math.round(enriched.reduce((s, wo) => s + wo.operators_needed_8h, 0) * 10) / 10,
      departments,
    },
  });
});

// ─── GET /completion/:id - detailed single completion with step breakdown ──────

router.get('/completion/:id', (req, res) => {
  const completion = db.prepare('SELECT * FROM completions WHERE id = ?').get(req.params.id);
  if (!completion) return res.status(404).json({ error: 'Completion not found' });

  // Fetch app steps to map step index to name and takt_time
  const app = db.prepare('SELECT id, name, steps FROM apps WHERE id = ?').get(completion.app_id);
  const appSteps = app ? JSON.parse(app.steps) : [];

  const stepTimes       = JSON.parse(completion.step_times || '{}');
  const taktExceeded    = JSON.parse(completion.takt_exceeded_steps || '[]');
  const data            = JSON.parse(completion.data || '{}');

  // Build per-step breakdown
  const stepBreakdown = appSteps.map((step, idx) => {
    const timeSeconds = stepTimes[idx] !== undefined ? stepTimes[idx] : null;
    const taktSeconds = step.takt_time || null;
    return {
      step_index:    idx,
      step_name:     step.name,
      takt_time:     taktSeconds,
      actual_time:   timeSeconds,
      takt_exceeded: taktExceeded.includes(idx) || taktExceeded.includes(String(idx)),
      pct_of_takt:   (taktSeconds && timeSeconds) ? Math.round((timeSeconds / taktSeconds) * 100) : null,
    };
  });

  // Work order info if linked
  let workOrder = null;
  if (completion.work_order_id) {
    workOrder = db.prepare(`
      SELECT wo.*, d.name AS department_name, d.color AS department_color
      FROM work_orders wo
      LEFT JOIN departments d ON d.id = wo.department_id
      WHERE wo.id = ?
    `).get(completion.work_order_id);
  }

  // Cycle time in minutes
  let cycleTimeMinutes = null;
  if (completion.started_at && completion.completed_at) {
    cycleTimeMinutes = Math.round(
      (new Date(completion.completed_at) - new Date(completion.started_at)) / 60000
    );
  }

  res.json({
    ...completion,
    data,
    step_times:       stepTimes,
    takt_exceeded_steps: taktExceeded,
    step_breakdown:   stepBreakdown,
    cycle_time_minutes: cycleTimeMinutes,
    app_name:         app?.name || completion.app_name,
    work_order:       workOrder,
  });
});

// ─── GET /department/:id — live drill-down for one department ────────────────

router.get('/department/:id', (req, res) => {
  const dept = db.prepare('SELECT * FROM departments WHERE id = ?').get(req.params.id);
  if (!dept) return res.status(404).json({ error: 'Department not found' });

  // Completions attribute to a department via their work order, falling back
  // to their station's department when run without a work order.
  const DEPT_COMPLETION_JOIN = `
    FROM completions c
    LEFT JOIN work_orders wo ON wo.id = c.work_order_id
    LEFT JOIN stations st    ON st.id = c.station_id
    WHERE COALESCE(wo.department_id, st.department_id) = ?
  `;

  const completedToday = db.prepare(`SELECT COUNT(*) as c ${DEPT_COMPLETION_JOIN} AND c.status='completed' AND date(c.completed_at)=date('now')`).get(dept.id).c;
  const activeNow      = db.prepare(`SELECT COUNT(*) as c ${DEPT_COMPLETION_JOIN} AND c.status='in_progress'`).get(dept.id).c;

  const ctRow = db.prepare(`
    SELECT AVG((julianday(c.completed_at) - julianday(c.started_at)) * 24 * 60) as avg_minutes
    ${DEPT_COMPLETION_JOIN} AND c.status='completed' AND c.completed_at IS NOT NULL
  `).get(dept.id);
  const avgCycleTime = ctRow?.avg_minutes ? Math.round(ctRow.avg_minutes) : 0;

  const pfRows = db.prepare(`SELECT c.data ${DEPT_COMPLETION_JOIN} AND c.status='completed' AND c.completed_at >= datetime('now', '-7 days')`).all(dept.id);
  let pass = 0, fail = 0;
  for (const row of pfRows) {
    const vals = Object.values(JSON.parse(row.data));
    if (vals.some(v => v === 'Fail')) fail++;
    else if (vals.some(v => v === 'Pass')) pass++;
  }
  const passRate = (pass + fail) > 0 ? Math.round((pass / (pass + fail)) * 100) : 0;

  // Work orders for this department
  const workOrders = db.prepare(`
    SELECT wo.*, a.name AS app_name
    FROM work_orders wo
    LEFT JOIN apps a ON a.id = wo.app_id
    WHERE wo.department_id = ? AND wo.status != 'cancelled'
    ORDER BY wo.scheduled_end ASC
  `).all(dept.id).map(wo => ({
    ...wo,
    schedule_status: calcScheduleStatus(wo),
    completion_pct: wo.quantity > 0 ? Math.round((wo.quantity_completed / wo.quantity) * 100) : 0,
  }));
  const wosOnTrack = workOrders.filter(wo => ['on_track', 'completed'].includes(wo.schedule_status)).length;

  // Stations in this department with live state
  const stations = db.prepare('SELECT * FROM stations WHERE department_id = ? ORDER BY name').all(dept.id).map(st => {
    const activeCompletion = db.prepare(`
      SELECT id, operator_name, app_name, started_at
      FROM completions WHERE station_id = ? AND status = 'in_progress'
      ORDER BY datetime(started_at) DESC LIMIT 1
    `).get(st.id) || null;
    const currentApp = st.current_app_id ? db.prepare('SELECT name FROM apps WHERE id = ?').get(st.current_app_id) : null;
    return {
      id: st.id,
      name: st.name,
      location: st.location,
      status: st.status,
      current_status: st.current_status || 'idle',
      current_status_since: st.current_status_since,
      current_app_id: st.current_app_id,
      current_app_name: currentApp?.name || null,
      active_completion: activeCompletion,
      oee: calcOEE(st),
    };
  });

  const hourlyThroughput = db.prepare(`
    SELECT strftime('%Y-%m-%dT%H:00:00', c.completed_at) as hour, COUNT(*) as count
    ${DEPT_COMPLETION_JOIN} AND c.status='completed' AND c.completed_at >= datetime('now', '-24 hours')
    GROUP BY strftime('%Y-%m-%dT%H:00:00', c.completed_at)
    ORDER BY hour ASC
  `).all(dept.id);

  const recentCompletions = db.prepare(`
    SELECT c.id, c.app_name, c.operator_name, c.status, c.started_at, c.completed_at, st.name AS station_name
    ${DEPT_COMPLETION_JOIN}
    ORDER BY datetime(COALESCE(c.completed_at, c.started_at)) DESC
    LIMIT 15
  `).all(dept.id).map(c => {
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
    kpis: {
      completed_today: completedToday,
      active_now:      activeNow,
      pass_rate:       passRate,
      avg_cycle_time:  avgCycleTime,
      wos_on_track:    wosOnTrack,
      wos_total:       workOrders.length,
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
    WHERE s.id = ?
  `).get(req.params.id);
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

  res.json({
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

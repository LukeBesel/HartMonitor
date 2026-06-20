const express = require('express');
const db = require('../db');
const { calcScheduleStatus } = require('./workorders');
const { calcOEE } = require('./oee');

const router = express.Router();

// ─── Filter helper ────────────────────────────────────────────────────────────
// Builds an optional `AND app_id = ? AND product_type_id = ?` clause from the
// query string so completion-based analytics can be scoped to a specific app
// and/or product (part) type. Returns the SQL fragment plus ordered params.
function completionFilter(req) {
  const clauses = [];
  const params = [];
  if (req.query.app_id) { clauses.push('app_id = ?'); params.push(req.query.app_id); }
  if (req.query.product_type_id) { clauses.push('product_type_id = ?'); params.push(req.query.product_type_id); }
  return { clause: clauses.length ? ' AND ' + clauses.join(' AND ') : '', params };
}

// ─── GET /overview ────────────────────────────────────────────────────────────

router.get('/overview', (req, res) => {
  const cid = req.companyId;
  const f = completionFilter(req);
  const totalCompletions  = db.prepare(`SELECT COUNT(*) as c FROM completions WHERE company_id = ? AND status='completed'${f.clause}`).get(cid, ...f.params).c;
  const todayCompletions  = db.prepare(`SELECT COUNT(*) as c FROM completions WHERE company_id = ? AND status='completed' AND date(completed_at)=date('now')${f.clause}`).get(cid, ...f.params).c;
  const inProgress        = db.prepare(`SELECT COUNT(*) as c FROM completions WHERE company_id = ? AND status='in_progress'${f.clause}`).get(cid, ...f.params).c;
  const totalApps         = db.prepare("SELECT COUNT(*) as c FROM apps WHERE company_id = ?").get(cid).c;
  const publishedApps     = db.prepare("SELECT COUNT(*) as c FROM apps WHERE company_id = ? AND status='published'").get(cid).c;
  const activeStations    = db.prepare("SELECT COUNT(*) as c FROM stations WHERE company_id = ? AND status='active'").get(cid).c;

  const cycleTimeResult = db.prepare(`
    SELECT AVG((julianday(completed_at) - julianday(started_at)) * 24 * 60) as avg_minutes
    FROM completions WHERE company_id = ? AND status='completed' AND completed_at IS NOT NULL${f.clause}
  `).get(cid, ...f.params);
  const avgCycleTime = cycleTimeResult?.avg_minutes ? Math.round(cycleTimeResult.avg_minutes) : 0;

  const passFailData = db.prepare(`SELECT data FROM completions WHERE company_id = ? AND status='completed'${f.clause} LIMIT 500`).all(cid, ...f.params);
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
  const days = Math.min(365, parseInt(req.query.days) || 30);
  const f = completionFilter(req);
  const rows = db.prepare(`
    SELECT date(completed_at) as date, COUNT(*) as count
    FROM completions
    WHERE company_id = ? AND status='completed' AND completed_at >= date('now', '-' || ? || ' days')${f.clause}
    GROUP BY date(completed_at)
    ORDER BY date ASC
    LIMIT 10000
  `).all(req.companyId, days, ...f.params);
  res.json(rows);
});

// ─── GET /cycle-times ─────────────────────────────────────────────────────────

router.get('/cycle-times', (req, res) => {
  const days = Math.min(365, parseInt(req.query.days) || 30);
  const f = completionFilter(req);
  const rows = db.prepare(`
    SELECT
      date(completed_at) as date,
      ROUND(AVG((julianday(completed_at) - julianday(started_at)) * 24 * 60), 1) as avg_minutes,
      ROUND(MIN((julianday(completed_at) - julianday(started_at)) * 24 * 60), 1) as min_minutes,
      ROUND(MAX((julianday(completed_at) - julianday(started_at)) * 24 * 60), 1) as max_minutes
    FROM completions
    WHERE company_id = ? AND status='completed' AND completed_at IS NOT NULL
      AND completed_at >= date('now', '-' || ? || ' days')${f.clause}
    GROUP BY date(completed_at)
    ORDER BY date ASC
    LIMIT 10000
  `).all(req.companyId, days, ...f.params);
  res.json(rows);
});

// ─── GET /operator-performance ────────────────────────────────────────────────

router.get('/operator-performance', (req, res) => {
  const f = completionFilter(req);
  const rows = db.prepare(`
    SELECT
      operator_name,
      COUNT(*) as completions,
      ROUND(AVG((julianday(completed_at) - julianday(started_at)) * 24 * 60), 1) as avg_cycle_minutes
    FROM completions
    WHERE company_id = ? AND status='completed' AND completed_at IS NOT NULL${f.clause}
    GROUP BY operator_name
    ORDER BY completions DESC
    LIMIT 20
  `).all(req.companyId, ...f.params);
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
      ROUND(AVG((julianday(completed_at) - julianday(started_at)) * 24 * 60), 1) as avg_cycle_minutes,
      COUNT(CASE WHEN status='abandoned' THEN 1 END) as abandoned_count
    FROM completions
    WHERE company_id = ?${f.clause}
    GROUP BY app_id, app_name
    ORDER BY completions DESC
  `).all(req.companyId, ...f.params);
  res.json(rows);
});

// ─── GET /quality ─────────────────────────────────────────────────────────────

router.get('/quality', (req, res) => {
  const { days = 30 } = req.query;
  const f = completionFilter(req);
  const rows = db.prepare(`
    SELECT date(completed_at) as date, data
    FROM completions
    WHERE company_id = ? AND status='completed' AND completed_at >= date('now', '-' || ? || ' days')${f.clause}
    ORDER BY completed_at ASC
  `).all(req.companyId, parseInt(days), ...f.params);

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
    WHERE c.company_id = ? AND c.status = 'in_progress'
    ORDER BY c.started_at DESC
  `).all(req.companyId);

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
    WHERE wo.company_id = ? AND wo.status != 'cancelled'
    ORDER BY wo.priority DESC, wo.scheduled_end ASC
  `).all(req.companyId);

  const workOrders = allWorkOrders.map(wo => ({
    ...wo,
    schedule_status: calcScheduleStatus(wo),
    completion_pct: wo.quantity > 0 ? Math.round((wo.quantity_completed / wo.quantity) * 100) : 0,
  }));

  // Per-department stats
  const depts = db.prepare('SELECT * FROM departments WHERE company_id = ?').all(req.companyId);
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
  const cid = req.companyId;
  const { site_id } = req.query;

  // Site filter for completions, joined through their work order or station
  // (a completion's "site" = its work order's site, falling back to its station's site).
  const siteJoin = site_id
    ? `LEFT JOIN work_orders wo ON wo.id = completions.work_order_id
       LEFT JOIN stations    st ON st.id = completions.station_id`
    : '';
  const siteClause = site_id ? ' AND COALESCE(wo.site_id, st.site_id) = ?' : '';
  const siteParams = site_id ? [site_id] : [];

  // KPIs
  const todayCompleted = db.prepare(`
    SELECT COUNT(*) as c FROM completions ${siteJoin}
    WHERE completions.company_id = ? AND completions.status='completed' AND date(completions.completed_at)=date('now')${siteClause}
  `).get(cid, ...siteParams).c;
  const activeNow = db.prepare(`
    SELECT COUNT(*) as c FROM completions ${siteJoin}
    WHERE completions.company_id = ? AND completions.status='in_progress'${siteClause}
  `).get(cid, ...siteParams).c;

  const ctRow = db.prepare(`
    SELECT AVG((julianday(completions.completed_at) - julianday(completions.started_at)) * 24 * 60) as avg_minutes
    FROM completions ${siteJoin}
    WHERE completions.company_id = ? AND completions.status='completed' AND completions.completed_at IS NOT NULL${siteClause}
  `).get(cid, ...siteParams);
  const avgCycleTime = ctRow?.avg_minutes ? Math.round(ctRow.avg_minutes) : 0;

  // Pass rate over the last 7 days, counting only completions with explicit QC results
  const pfRows = db.prepare(`
    SELECT completions.data as data FROM completions ${siteJoin}
    WHERE completions.company_id = ? AND completions.status='completed' AND completions.completed_at >= datetime('now', '-7 days')${siteClause}
  `).all(cid, ...siteParams);
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
    WHERE wo.company_id = ? AND wo.status != 'cancelled'${site_id ? ' AND wo.site_id = ?' : ''}
  `).all(cid, ...siteParams).map(wo => ({ ...wo, schedule_status: calcScheduleStatus(wo) }));

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
  const depts = db.prepare(`SELECT * FROM departments WHERE company_id = ?${site_id ? ' AND site_id = ?' : ''}`).all(cid, ...siteParams);
  const departmentPerformance = depts.map(dept => {
    const deptWOs = allWOs.filter(wo => wo.department_id === dept.id);

    const completionCountToday = db.prepare(`
      SELECT COUNT(*) as c
      FROM completions c
      LEFT JOIN work_orders wo ON wo.id = c.work_order_id
      LEFT JOIN stations st    ON st.id = c.station_id
      WHERE c.company_id = ? AND COALESCE(wo.department_id, st.department_id) = ?
        AND c.status = 'completed' AND date(c.completed_at) = date('now')
    `).get(cid, dept.id).c;

    const ctDept = db.prepare(`
      SELECT AVG((julianday(c.completed_at) - julianday(c.started_at)) * 24 * 60) as avg_minutes
      FROM completions c
      LEFT JOIN work_orders wo ON wo.id = c.work_order_id
      LEFT JOIN stations st    ON st.id = c.station_id
      WHERE c.company_id = ? AND COALESCE(wo.department_id, st.department_id) = ?
        AND c.status = 'completed' AND c.completed_at IS NOT NULL
    `).get(cid, dept.id);
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
      strftime('%Y-%m-%dT%H:00:00', completions.completed_at) as hour,
      COUNT(*) as count
    FROM completions ${siteJoin}
    WHERE completions.company_id = ? AND completions.status = 'completed'
      AND completions.completed_at >= datetime('now', '-24 hours')${siteClause}
    GROUP BY strftime('%Y-%m-%dT%H:00:00', completions.completed_at)
    ORDER BY hour ASC
  `).all(cid, ...siteParams);

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
    WHERE c.company_id = ?${site_id ? ' AND COALESCE(wo.site_id, st.site_id) = ?' : ''}
    ORDER BY datetime(COALESCE(c.completed_at, c.started_at)) DESC
    LIMIT 15
  `).all(cid, ...siteParams).map(c => {
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

  const app = db.prepare('SELECT id, name, steps FROM apps WHERE id = ? AND company_id = ?').get(appId, req.companyId);
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
    WHERE wo.company_id = ? AND wo.status NOT IN ('completed', 'cancelled')
    ORDER BY wo.priority DESC, wo.scheduled_end ASC
  `).all(req.companyId);

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
      department_name: wo.department_name || 'Unassigned',
      department_color: wo.department_color || '#6b7280',
    };
  });

  // Lay each work order's remaining hours out across the days until its due
  // date (overdue work lands entirely on today), so demand can be compared
  // against real headcount per day over the planning horizon.
  const HORIZON_DAYS = 14;
  const days = [];
  for (let i = 0; i < HORIZON_DAYS; i++) {
    const d = new Date();
    d.setDate(d.getDate() + i);
    days.push(d.toISOString().slice(0, 10));
  }

  const allDepts = db.prepare('SELECT * FROM departments WHERE company_id = ? ORDER BY name').all(req.companyId);
  const deptMap = {};
  const ensureDept = (name, color, headcount) => {
    if (!deptMap[name]) deptMap[name] = {
      name, color,
      headcount: headcount || 0,
      hours_required: 0,
      work_order_count: 0,
      demand_by_day: Object.fromEntries(days.map(d => [d, 0])),
    };
    return deptMap[name];
  };
  for (const d of allDepts) ensureDept(d.name, d.color, d.headcount);

  for (const wo of enriched) {
    if (wo.hours_required <= 0) continue;
    const dept = ensureDept(wo.department_name, wo.department_color, 0);
    dept.hours_required += wo.hours_required;
    dept.work_order_count += 1;

    const spreadDays = Math.min(HORIZON_DAYS, Math.max(1, wo.days_remaining ?? 1));
    const perDay = wo.hours_required / spreadDays;
    for (let i = 0; i < spreadDays; i++) dept.demand_by_day[days[i]] += perDay;
  }

  const departments = Object.values(deptMap)
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

  // Plant-wide demand timeline, one stacked segment per department
  const timeline = days.map(day => {
    const row = { date: day };
    for (const d of departments) {
      const hours = d.demand_by_day.find(x => x.date === day)?.hours ?? 0;
      if (hours > 0 || d.work_order_count > 0) row[d.name] = hours;
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

// ─── GET /daily-brief — cross-module morning briefing for the dashboard ──────

router.get('/daily-brief', (req, res) => {
  const cid = req.companyId;
  const planRow = db.prepare('SELECT tier FROM plan WHERE company_id = ?').get(cid);
  const isPro = planRow && planRow.tier !== 'free';

  // ── Needs attention: everything that should change someone's plan today
  const attention = [];

  const activeWOs = db.prepare(`
    SELECT wo.*, d.name AS department_name
    FROM work_orders wo
    LEFT JOIN departments d ON d.id = wo.department_id
    WHERE wo.company_id = ? AND wo.status NOT IN ('completed', 'cancelled')
  `).all(cid);
  for (const wo of activeWOs) {
    const ss = calcScheduleStatus(wo);
    if (ss === 'overdue' || ss === 'behind') {
      attention.push({
        type: ss === 'overdue' ? 'wo_overdue' : 'wo_behind',
        severity: ss === 'overdue' ? 'red' : 'amber',
        label: `${wo.work_order_number} · ${wo.part_name}`,
        detail: `${wo.quantity_completed}/${wo.quantity} done${wo.department_name ? ` · ${wo.department_name}` : ''} · due ${new Date(wo.scheduled_end).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`,
        link: `/schedule?highlight=${wo.id}`,
      });
    }
  }

  const downStations = db.prepare(`SELECT id, name, current_status, current_status_since FROM stations WHERE company_id = ? AND current_status = 'down'`).all(cid);
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
    const criticalNCRs = db.prepare(`
      SELECT id, ncr_number, title, due_date FROM ncrs
      WHERE company_id = ? AND severity = 'critical' AND status NOT IN ('resolved', 'closed')
      ORDER BY created_at DESC LIMIT 10
    `).all(cid);
    for (const n of criticalNCRs) {
      attention.push({
        type: 'ncr_critical',
        severity: 'red',
        label: `${n.ncr_number} · ${n.title}`,
        detail: n.due_date ? `critical NCR · due ${new Date(n.due_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}` : 'critical NCR',
        link: `/quality/${n.id}`,
      });
    }

    const lowStock = db.prepare(`
      SELECT i.id, i.sku, i.name, i.reorder_point, COALESCE(SUM(sl.quantity), 0) as on_hand
      FROM items i
      LEFT JOIN stock_levels sl ON sl.item_id = i.id
      WHERE i.company_id = ? AND i.is_active = 1 AND i.reorder_point > 0
      GROUP BY i.id
      HAVING on_hand <= i.reorder_point
      ORDER BY (on_hand / i.reorder_point) ASC
      LIMIT 10
    `).all(cid);
    for (const item of lowStock) {
      attention.push({
        type: 'stock_low',
        severity: item.on_hand <= 0 ? 'red' : 'amber',
        label: `${item.sku} · ${item.name}`,
        detail: `${item.on_hand} on hand (reorder at ${item.reorder_point})`,
        link: `/inventory/${item.id}`,
      });
    }

    const latePOs = db.prepare(`
      SELECT po.id, po.po_number, po.expected_date, v.name AS vendor_name
      FROM purchase_orders po
      LEFT JOIN vendors v ON v.id = po.vendor_id
      WHERE po.company_id = ? AND po.status IN ('sent', 'partial') AND po.expected_date < date('now')
      ORDER BY po.expected_date ASC LIMIT 10
    `).all(cid);
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

  attention.sort((a, b) => (a.severity === 'red' ? 0 : 1) - (b.severity === 'red' ? 0 : 1));

  // ── KPIs with deltas
  const completedToday = db.prepare("SELECT COUNT(*) as c FROM completions WHERE company_id = ? AND status='completed' AND date(completed_at)=date('now')").get(cid).c;
  const weekAvgRow = db.prepare(`
    SELECT COUNT(*) / 7.0 as avg
    FROM completions
    WHERE company_id = ? AND status='completed' AND date(completed_at) >= date('now', '-7 days') AND date(completed_at) < date('now')
  `).get(cid);
  const weekAvg = weekAvgRow?.avg || 0;
  const vsAvgPct = weekAvg > 0 ? Math.round(((completedToday - weekAvg) / weekAvg) * 100) : null;

  const activeNow = db.prepare("SELECT COUNT(*) as c FROM completions WHERE company_id = ? AND status='in_progress'").get(cid).c;

  const pfRows = db.prepare(`
    SELECT data FROM completions
    WHERE company_id = ? AND status='completed' AND completed_at >= datetime('now', '-7 days')
  `).all(cid);
  let pass = 0, fail = 0;
  for (const row of pfRows) {
    const vals = Object.values(JSON.parse(row.data));
    if (vals.some(v => v === 'Fail')) fail++;
    else if (vals.some(v => v === 'Pass')) pass++;
  }
  const passRate7d = (pass + fail) > 0 ? Math.round((pass / (pass + fail)) * 100) : null;

  const woSummary = { on_track: 0, completed: 0, total: 0 };
  for (const wo of activeWOs) {
    const ss = calcScheduleStatus(wo);
    woSummary.total++;
    if (ss === 'on_track' || ss === 'completed') woSummary.on_track++;
  }
  const scheduleAdherence = woSummary.total > 0 ? Math.round((woSummary.on_track / woSummary.total) * 100) : null;

  // ── Due in the next 48 hours
  const dueSoon = activeWOs
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
    SELECT date(completed_at) as date, COUNT(*) as count
    FROM completions
    WHERE company_id = ? AND status='completed' AND date(completed_at) >= date('now', '-6 days')
    GROUP BY date(completed_at)
    ORDER BY date ASC
  `).all(cid);
  const days7 = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const key = d.toISOString().slice(0, 10);
    days7.push({ date: key, count: throughput.find(t => t.date === key)?.count ?? 0 });
  }

  res.json({
    attention,
    kpis: {
      completed_today: completedToday,
      vs_7day_avg_pct: vsAvgPct,
      active_now: activeNow,
      pass_rate_7d: passRate7d,
      schedule_adherence: scheduleAdherence,
      work_orders_on_track: woSummary.on_track,
      work_orders_total: woSummary.total,
    },
    due_soon: dueSoon,
    throughput_7d: days7,
    week_avg_per_day: Math.round(weekAvg * 10) / 10,
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

  const completedToday = db.prepare(`SELECT COUNT(*) as c ${DEPT_COMPLETION_JOIN} AND c.status='completed' AND date(c.completed_at)=date('now')`).get(cid, dept.id).c;
  const activeNow      = db.prepare(`SELECT COUNT(*) as c ${DEPT_COMPLETION_JOIN} AND c.status='in_progress'`).get(cid, dept.id).c;

  const ctRow = db.prepare(`
    SELECT AVG((julianday(c.completed_at) - julianday(c.started_at)) * 24 * 60) as avg_minutes
    ${DEPT_COMPLETION_JOIN} AND c.status='completed' AND c.completed_at IS NOT NULL
  `).get(cid, dept.id);
  const avgCycleTime = ctRow?.avg_minutes ? Math.round(ctRow.avg_minutes) : 0;

  const pfRows = db.prepare(`SELECT c.data ${DEPT_COMPLETION_JOIN} AND c.status='completed' AND c.completed_at >= datetime('now', '-7 days')`).all(cid, dept.id);
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

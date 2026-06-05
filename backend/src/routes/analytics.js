const express = require('express');
const db = require('../db');

const router = express.Router();

router.get('/overview', (req, res) => {
  const totalCompletions = db.prepare("SELECT COUNT(*) as c FROM completions WHERE status='completed'").get().c;
  const todayCompletions = db.prepare("SELECT COUNT(*) as c FROM completions WHERE status='completed' AND date(completed_at)=date('now')").get().c;
  const inProgress = db.prepare("SELECT COUNT(*) as c FROM completions WHERE status='in_progress'").get().c;
  const totalApps = db.prepare("SELECT COUNT(*) as c FROM apps").get().c;
  const publishedApps = db.prepare("SELECT COUNT(*) as c FROM apps WHERE status='published'").get().c;
  const activeStations = db.prepare("SELECT COUNT(*) as c FROM stations WHERE status='active'").get().c;

  const cycleTimeResult = db.prepare(`
    SELECT AVG((julianday(completed_at) - julianday(started_at)) * 24 * 60) as avg_minutes
    FROM completions WHERE status='completed' AND completed_at IS NOT NULL
  `).get();
  const avgCycleTime = cycleTimeResult?.avg_minutes ? Math.round(cycleTimeResult.avg_minutes) : 0;

  const passFailData = db.prepare(`
    SELECT data FROM completions WHERE status='completed' LIMIT 500
  `).all();

  let passCount = 0, failCount = 0;
  for (const row of passFailData) {
    const data = JSON.parse(row.data);
    const vals = Object.values(data);
    if (vals.some(v => v === 'Pass')) passCount++;
    if (vals.some(v => v === 'Fail')) failCount++;
  }
  const totalQC = passCount + failCount;
  const passRate = totalQC > 0 ? Math.round((passCount / totalQC) * 100) : 0;

  res.json({
    totalCompletions,
    todayCompletions,
    inProgress,
    totalApps,
    publishedApps,
    activeStations,
    avgCycleTime,
    passRate,
  });
});

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

module.exports = router;

const express = require('express');
const { v4: uuidv4 } = require('uuid');
const db = require('../db');
const { notify } = require('../notifications');
const { deliverWebhooks } = require('../webhooks');
const { requireRole } = require('../middleware/auth');

const router = express.Router();

// ─── OEE calculation helper ───────────────────────────────────────────────────

function calcOEE(station) {
  const plannedMinutes = (station.planned_hours_per_day || 8) * 60;

  // Sum all downtime/maintenance events today that have ended
  const downtimeRows = db.prepare(`
    SELECT COALESCE(SUM(duration_minutes), 0) as total
    FROM machine_events
    WHERE station_id = ? AND event_type IN ('down','maintenance')
      AND started_at >= date('now') AND duration_minutes IS NOT NULL
  `).get(station.id);

  // Also count ongoing downtime/maintenance event if current_status is down/maintenance
  let ongoingDowntime = 0;
  if (['down', 'maintenance'].includes(station.current_status) && station.current_status_since) {
    ongoingDowntime = Math.max(0,
      (Date.now() - new Date(station.current_status_since).getTime()) / 60000
    );
  }

  const downtimeMinutes = (downtimeRows.total || 0) + ongoingDowntime;
  const uptimeMinutes = Math.max(0, plannedMinutes - downtimeMinutes);
  const availability = plannedMinutes > 0 ? uptimeMinutes / plannedMinutes : 0;

  // Completions today for this station
  const completionRow = db.prepare(`
    SELECT COUNT(*) as c FROM completions
    WHERE station_id = ? AND status = 'completed' AND date(completed_at) = date('now')
  `).get(station.id);
  const completionsToday = completionRow.c;

  // Performance: actual vs ideal
  let performance = 0;
  if (station.ideal_cycle_seconds > 0 && uptimeMinutes > 0) {
    performance = Math.min(1, (completionsToday * station.ideal_cycle_seconds) / (uptimeMinutes * 60));
  } else if (completionsToday > 0 && uptimeMinutes > 0) {
    // Estimate from actual avg cycle time
    const ctRow = db.prepare(`
      SELECT AVG((julianday(completed_at)-julianday(started_at))*24*3600) as avg_secs
      FROM completions
      WHERE station_id = ? AND status='completed' AND date(completed_at)=date('now') AND completed_at IS NOT NULL
    `).get(station.id);
    if (ctRow?.avg_secs) {
      const actualRate = 1 / ctRow.avg_secs;
      const idealRate = 1 / ctRow.avg_secs; // without ideal, use actual as 100%
      performance = Math.min(1, idealRate / actualRate);
    }
    performance = performance || 0.9; // default assumption when no ideal cycle set
  }

  // Quality: pass rate today
  const todayRows = db.prepare(`
    SELECT data FROM completions
    WHERE station_id = ? AND status='completed' AND date(completed_at)=date('now')
  `).all(station.id);

  let pass = 0;
  for (const row of todayRows) {
    const vals = Object.values(JSON.parse(row.data || '{}'));
    if (!vals.some(v => v === 'Fail')) pass++;
  }
  const quality = todayRows.length > 0 ? pass / todayRows.length : 1;

  const oeeVal = availability * performance * quality;

  return {
    availability: Math.round(availability * 100),
    performance: Math.round(performance * 100),
    quality: Math.round(quality * 100),
    oee: Math.round(oeeVal * 100),
    uptime_minutes: Math.round(uptimeMinutes),
    downtime_minutes: Math.round(downtimeMinutes),
    planned_minutes: Math.round(plannedMinutes),
    completions_today: completionsToday,
  };
}

// ─── GET / - all machines with live OEE ───────────────────────────────────────

router.get('/', (req, res) => {
  const stations = db.prepare('SELECT * FROM stations WHERE company_id = ? ORDER BY name ASC').all(req.companyId);
  const result = stations.map(s => ({
    id: s.id,
    name: s.name,
    description: s.description,
    location: s.location,
    status: s.status,
    current_status: s.current_status || 'idle',
    current_status_since: s.current_status_since || null,
    planned_hours_per_day: s.planned_hours_per_day || 8,
    ideal_cycle_seconds: s.ideal_cycle_seconds || 0,
    oee: calcOEE(s),
  }));
  res.json(result);
});

// ─── GET /:id - single machine detail ─────────────────────────────────────────

router.get('/:id', (req, res) => {
  const s = db.prepare('SELECT * FROM stations WHERE id = ? AND company_id = ?').get(req.params.id, req.companyId);
  if (!s) return res.status(404).json({ error: 'Not found' });
  res.json({
    id: s.id, name: s.name, description: s.description, location: s.location,
    current_status: s.current_status || 'idle',
    current_status_since: s.current_status_since,
    planned_hours_per_day: s.planned_hours_per_day || 8,
    ideal_cycle_seconds: s.ideal_cycle_seconds || 0,
    oee: calcOEE(s),
  });
});

// ─── POST /:id/event - log status change ──────────────────────────────────────

router.post('/:id/event', requireRole('operator'), (req, res) => {
  const station = db.prepare('SELECT * FROM stations WHERE id = ? AND company_id = ?').get(req.params.id, req.companyId);
  if (!station) return res.status(404).json({ error: 'Not found' });

  const { event_type: rawEventType, reason = '' } = req.body;
  // Accept 'running' as alias for 'up'
  const event_type = rawEventType === 'running' ? 'up' : rawEventType;
  const validTypes = ['up', 'running', 'down', 'maintenance', 'idle'];
  if (!validTypes.includes(rawEventType)) {
    return res.status(400).json({ error: `event_type must be one of: ${validTypes.join(', ')}` });
  }

  const now = new Date().toISOString();

  // Close any open event for this station
  const openEvent = db.prepare(`
    SELECT id, started_at FROM machine_events
    WHERE station_id = ? AND ended_at IS NULL
    ORDER BY started_at DESC LIMIT 1
  `).get(station.id);

  if (openEvent) {
    const startedMs = new Date(openEvent.started_at).getTime();
    const durationMinutes = (Date.now() - startedMs) / 60000;
    db.prepare(`UPDATE machine_events SET ended_at=?, duration_minutes=? WHERE id=?`)
      .run(now, Math.round(durationMinutes * 10) / 10, openEvent.id);
  }

  // Create new event
  const eventId = uuidv4();
  db.prepare(`INSERT INTO machine_events (id, station_id, event_type, reason, started_at) VALUES (?, ?, ?, ?, ?)`)
    .run(eventId, station.id, event_type, reason, now);

  // Map event_type to current_status
  const statusMap = { up: 'running', down: 'down', maintenance: 'maintenance', idle: 'idle' };
  db.prepare(`UPDATE stations SET current_status=?, current_status_since=? WHERE id=?`)
    .run(statusMap[event_type], now, station.id);

  const updated = db.prepare('SELECT * FROM stations WHERE id = ?').get(station.id);

  if (event_type === 'down' && station.current_status !== 'down') {
    notify(req.companyId, 'station.down', {
      body: `Station "${station.name}" went down${reason ? ` (${reason})` : ''}.`,
    });
    deliverWebhooks(req.companyId, 'station.down', { id: station.id, name: station.name, reason });
  }

  res.json({
    id: updated.id, name: updated.name, current_status: updated.current_status,
    current_status_since: updated.current_status_since,
    oee: calcOEE(updated),
  });
});

// ─── PUT /:id/settings - update OEE settings ──────────────────────────────────

router.put('/:id/settings', requireRole('supervisor'), (req, res) => {
  const station = db.prepare('SELECT * FROM stations WHERE id = ? AND company_id = ?').get(req.params.id, req.companyId);
  if (!station) return res.status(404).json({ error: 'Not found' });

  const { planned_hours_per_day, ideal_cycle_seconds } = req.body;
  const hours = planned_hours_per_day ?? station.planned_hours_per_day ?? 8;
  const cycle = ideal_cycle_seconds ?? station.ideal_cycle_seconds ?? 0;
  if (!Number.isFinite(Number(hours)) || Number(hours) < 0 || Number(hours) > 24) {
    return res.status(400).json({ error: 'planned_hours_per_day must be a number between 0 and 24' });
  }
  if (!Number.isFinite(Number(cycle)) || Number(cycle) < 0) {
    return res.status(400).json({ error: 'ideal_cycle_seconds must be a non-negative number' });
  }
  db.prepare(`UPDATE stations SET planned_hours_per_day=?, ideal_cycle_seconds=? WHERE id=?`)
    .run(Number(hours), Number(cycle), station.id);
  const updated = db.prepare('SELECT * FROM stations WHERE id = ?').get(station.id);
  res.json({ ...updated, oee: calcOEE(updated) });
});

// ─── GET /:id/history - event history ─────────────────────────────────────────

router.get('/:id/history', (req, res) => {
  const { limit = 50 } = req.query;
  const owned = db.prepare('SELECT id FROM stations WHERE id = ? AND company_id = ?').get(req.params.id, req.companyId);
  if (!owned) return res.status(404).json({ error: 'Not found' });
  const events = db.prepare(`
    SELECT * FROM machine_events
    WHERE station_id = ?
    ORDER BY started_at DESC
    LIMIT ?
  `).all(req.params.id, Math.min(Math.max(parseInt(limit, 10) || 50, 1), 500));
  res.json(events);
});

// ─── GET /analytics/trend - plant-wide OEE trend (last 30 days) ───────────────

router.get('/analytics/trend', (req, res) => {
  const stations = db.prepare('SELECT id FROM stations WHERE company_id = ?').all(req.companyId);
  // For now return per-day throughput and uptime summary
  const trend = db.prepare(`
    SELECT
      date(completed_at) as date,
      COUNT(*) as completions,
      COUNT(DISTINCT station_id) as active_stations
    FROM completions
    WHERE company_id = ? AND status='completed' AND completed_at >= date('now','-30 days')
    GROUP BY date(completed_at) ORDER BY date ASC
  `).all(req.companyId);
  res.json({ station_count: stations.length, trend });
});

module.exports = router;
module.exports.calcOEE = calcOEE;

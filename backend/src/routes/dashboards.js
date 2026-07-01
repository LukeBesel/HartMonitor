const express = require('express');
const { v4: uuidv4 } = require('uuid');
const db = require('../db');
const { logActivity } = require('../activity');

const router = express.Router();

// ─── CRUD ─────────────────────────────────────────────────────────────────────

router.get('/', (req, res) => {
  const rows = db.prepare('SELECT * FROM dashboards WHERE company_id = ? ORDER BY updated_at DESC').all(req.companyId);
  res.json(rows.map(r => ({ ...r, cards: JSON.parse(r.cards || '[]') })));
});

router.post('/', (req, res) => {
  const { name, description = '', cards = [] } = req.body;
  if (!name) return res.status(400).json({ error: 'name required' });

  // Plan limit check — base tier limit plus purchased add-on slots
  const { getPlanRow } = require('./config');
  const plan = getPlanRow(req.companyId);
  if (plan && plan.dashboard_limit >= 0) {
    const effectiveLimit = plan.dashboard_limit + (plan.extra_dashboard_slots || 0);
    const count = db.prepare('SELECT COUNT(*) as c FROM dashboards WHERE company_id = ?').get(req.companyId).c;
    if (count >= effectiveLimit) {
      return res.status(402).json({
        error: 'plan_limit',
        message: `Your plan is limited to ${effectiveLimit} dashboards. Upgrade to Pro for unlimited dashboards, or purchase a custom dashboard slot.`,
        limit: effectiveLimit, current: count,
      });
    }
  }

  const id = uuidv4();
  db.prepare(`INSERT INTO dashboards (id, name, description, cards, company_id) VALUES (?, ?, ?, ?, ?)`)
    .run(id, name, description, JSON.stringify(cards), req.companyId);
  logActivity(req.companyId, 'dashboard', id, `Dashboard "${name}" created`, req.user?.display_name);
  const d = db.prepare('SELECT * FROM dashboards WHERE id = ?').get(id);
  res.status(201).json({ ...d, cards: JSON.parse(d.cards) });
});

router.get('/:id', (req, res) => {
  const d = db.prepare('SELECT * FROM dashboards WHERE id = ? AND company_id = ?').get(req.params.id, req.companyId);
  if (!d) return res.status(404).json({ error: 'Not found' });
  res.json({ ...d, cards: JSON.parse(d.cards || '[]') });
});

router.put('/:id', (req, res) => {
  const d = db.prepare('SELECT * FROM dashboards WHERE id = ? AND company_id = ?').get(req.params.id, req.companyId);
  if (!d) return res.status(404).json({ error: 'Not found' });
  const { name, description, cards } = req.body;
  db.prepare(`UPDATE dashboards SET name=?, description=?, cards=?, updated_at=datetime('now') WHERE id=?`)
    .run(
      name ?? d.name,
      description ?? d.description,
      cards !== undefined ? JSON.stringify(cards) : d.cards,
      req.params.id
    );
  const updated = db.prepare('SELECT * FROM dashboards WHERE id = ?').get(req.params.id);
  res.json({ ...updated, cards: JSON.parse(updated.cards) });
});

router.delete('/:id', (req, res) => {
  const d = db.prepare('SELECT * FROM dashboards WHERE id = ? AND company_id = ?').get(req.params.id, req.companyId);
  if (!d) return res.status(404).json({ error: 'Not found' });
  db.prepare('DELETE FROM dashboards WHERE id = ?').run(req.params.id);
  logActivity(req.companyId, 'dashboard', req.params.id, `Dashboard "${d.name}" deleted`, req.user?.display_name);
  res.json({ success: true });
});

// ─── GET /:id/data - compute all card data ────────────────────────────────────

router.get('/:id/data', (req, res) => {
  const d = db.prepare('SELECT * FROM dashboards WHERE id = ? AND company_id = ?').get(req.params.id, req.companyId);
  if (!d) return res.status(404).json({ error: 'Not found' });

  const cards = JSON.parse(d.cards || '[]');
  const results = cards.map(card => {
    try {
      return { card_id: card.id, data: computeCardData(card, req.companyId) };
    } catch (e) {
      return { card_id: card.id, data: null, error: e.message };
    }
  });

  res.json({ dashboard_id: req.params.id, cards: results });
});

// ─── Card data computation ────────────────────────────────────────────────────

function computeCardData(card, companyId) {
  const days = card.period_days || 30;
  const appFilter = card.app_id ? ' AND app_id = ?' : '';
  const appParams = card.app_id ? [card.app_id] : [];

  switch (card.type) {

    case 'metric': {
      switch (card.metric_key) {
        case 'total_completions':
          return { value: db.prepare(`SELECT COUNT(*) as c FROM completions WHERE company_id = ? AND status='completed'${appFilter}`).get(companyId, ...appParams).c };
        case 'today_completions':
          return { value: db.prepare(`SELECT COUNT(*) as c FROM completions WHERE company_id = ? AND status='completed' AND date(completed_at)=date('now')${appFilter}`).get(companyId, ...appParams).c };
        case 'active_runs':
          return { value: db.prepare(`SELECT COUNT(*) as c FROM completions WHERE company_id = ? AND status='in_progress'${appFilter}`).get(companyId, ...appParams).c };
        case 'pass_rate': {
          const rows = db.prepare(`SELECT data FROM completions WHERE company_id = ? AND status='completed'${appFilter} LIMIT 500`).all(companyId, ...appParams);
          let pass = 0, total = 0;
          for (const r of rows) { const v = Object.values(JSON.parse(r.data||'{}')); total++; if (!v.some(x => x==='Fail')) pass++; }
          return { value: total > 0 ? Math.round((pass/total)*100) : 100, suffix: '%' };
        }
        case 'avg_cycle': {
          const row = db.prepare(`SELECT AVG((julianday(completed_at)-julianday(started_at))*24*60) as v FROM completions WHERE company_id = ? AND status='completed' AND completed_at IS NOT NULL${appFilter}`).get(companyId, ...appParams);
          return { value: row?.v ? Math.round(row.v * 10) / 10 : 0, suffix: 'm' };
        }
        case 'period_completions':
          return { value: db.prepare(`SELECT COUNT(*) as c FROM completions WHERE company_id = ? AND status='completed' AND completed_at >= date('now','-'||?||' days')${appFilter}`).get(companyId, days, ...appParams).c };
        default:
          return { value: 0 };
      }
    }

    case 'time_series': {
      const metric = card.series || 'throughput';
      if (metric === 'throughput') {
        const rows = db.prepare(`
          SELECT date(completed_at) as date, COUNT(*) as count
          FROM completions WHERE company_id = ? AND status='completed'
            AND completed_at >= date('now','-'||?||' days')${appFilter}
          GROUP BY date(completed_at) ORDER BY date ASC
        `).all(companyId, days, ...appParams);
        return { series: [{ name: 'Completions', data: rows.map(r => ({ date: r.date, value: r.count })) }] };
      }
      if (metric === 'cycle_time') {
        const rows = db.prepare(`
          SELECT date(completed_at) as date,
            ROUND(AVG((julianday(completed_at)-julianday(started_at))*24*60),1) as value
          FROM completions WHERE company_id = ? AND status='completed' AND completed_at IS NOT NULL
            AND completed_at >= date('now','-'||?||' days')${appFilter}
          GROUP BY date(completed_at) ORDER BY date ASC
        `).all(companyId, days, ...appParams);
        return { series: [{ name: 'Avg Cycle (min)', data: rows }] };
      }
      if (metric === 'quality') {
        const rows = db.prepare(`
          SELECT date(completed_at) as date, data
          FROM completions WHERE company_id = ? AND status='completed'
            AND completed_at >= date('now','-'||?||' days')${appFilter}
          ORDER BY completed_at ASC
        `).all(companyId, days, ...appParams);
        const byDate = {};
        for (const r of rows) {
          const d = r.date; if (!byDate[d]) byDate[d] = { pass: 0, total: 0 };
          byDate[d].total++;
          const vals = Object.values(JSON.parse(r.data||'{}'));
          if (!vals.some(v=>v==='Fail')) byDate[d].pass++;
        }
        const data = Object.entries(byDate).sort(([a],[b])=>a.localeCompare(b))
          .map(([date, v]) => ({ date, value: v.total > 0 ? Math.round((v.pass/v.total)*100) : 100 }));
        return { series: [{ name: 'Pass Rate %', data }] };
      }
      return { series: [] };
    }

    case 'distribution': {
      const groupBy = card.group_by || 'operator';
      if (groupBy === 'operator') {
        const rows = db.prepare(`
          SELECT operator_name as label, COUNT(*) as value FROM completions
          WHERE company_id = ? AND status='completed'${appFilter}
          GROUP BY operator_name ORDER BY value DESC LIMIT 10
        `).all(companyId, ...appParams);
        return { data: rows };
      }
      if (groupBy === 'app') {
        const rows = db.prepare(`
          SELECT app_name as label, COUNT(*) as value FROM completions
          WHERE company_id = ? AND status='completed'${appFilter}
          GROUP BY app_name ORDER BY value DESC LIMIT 10
        `).all(companyId, ...appParams);
        return { data: rows };
      }
      if (groupBy === 'quality') {
        const rows = db.prepare(`SELECT data FROM completions WHERE company_id = ? AND status='completed'${appFilter} LIMIT 500`).all(companyId, ...appParams);
        let pass = 0, fail = 0;
        for (const r of rows) { const vals = Object.values(JSON.parse(r.data||'{}')); if (vals.some(v=>v==='Fail')) fail++; else pass++; }
        return { data: [{ label: 'Pass', value: pass }, { label: 'Fail', value: fail }] };
      }
      if (groupBy === 'department') {
        const appFilterC = card.app_id ? ' AND c.app_id = ?' : '';
        const rows = db.prepare(`
          SELECT d.name as label, COUNT(c.id) as value
          FROM completions c
          JOIN work_orders wo ON wo.id = c.work_order_id AND wo.company_id = c.company_id
          JOIN departments d ON d.id = wo.department_id AND d.company_id = c.company_id
          WHERE c.company_id = ? AND c.status='completed'${appFilterC}
          GROUP BY d.name ORDER BY value DESC
        `).all(companyId, ...appParams);
        return { data: rows };
      }
      return { data: [] };
    }

    case 'leaderboard': {
      const metric = card.leaderboard_metric || 'completions';
      // card.limit is user-controlled JSON — never interpolate it into SQL.
      const limit = Math.min(Math.max(parseInt(card.limit, 10) || 10, 1), 100);
      if (metric === 'completions') {
        const rows = db.prepare(`
          SELECT operator_name as name, COUNT(*) as value
          FROM completions WHERE company_id = ? AND status='completed'${appFilter}
          GROUP BY operator_name ORDER BY value DESC LIMIT ?
        `).all(companyId, ...appParams, limit);
        return { rows, label: 'Completions' };
      }
      if (metric === 'cycle_time') {
        const rows = db.prepare(`
          SELECT operator_name as name,
            ROUND(AVG((julianday(completed_at)-julianday(started_at))*24*60),1) as value
          FROM completions WHERE company_id = ? AND status='completed' AND completed_at IS NOT NULL${appFilter}
          GROUP BY operator_name HAVING COUNT(*) >= 3 ORDER BY value ASC LIMIT ?
        `).all(companyId, ...appParams, limit);
        return { rows, label: 'Avg Cycle (min)', lower_is_better: true };
      }
      return { rows: [] };
    }

    case 'wo_status': {
      const statuses = ['pending','in_progress','completed','overdue','cancelled'];
      const counts = {};
      for (const s of statuses) {
        counts[s] = db.prepare(`SELECT COUNT(*) as c FROM work_orders WHERE company_id = ? AND status=?`).get(companyId, s).c;
      }
      return { counts };
    }

    case 'table': {
      const limit = Math.min(Math.max(parseInt(card.limit, 10) || 10, 1), 100);
      const appFilterC = card.app_id ? ' AND c.app_id = ?' : '';
      const rows = db.prepare(`
        SELECT c.id, c.app_name, c.operator_name, c.started_at, c.completed_at,
          c.status, c.work_order_id, w.work_order_number
        FROM completions c
        LEFT JOIN work_orders w ON w.id = c.work_order_id
        WHERE c.company_id = ?${appFilterC}
        ORDER BY c.started_at DESC LIMIT ?
      `).all(companyId, ...appParams, limit);
      return { rows };
    }

    default:
      return null;
  }
}

module.exports = router;

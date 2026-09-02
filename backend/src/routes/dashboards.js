const express = require('express');
const { v4: uuidv4 } = require('uuid');
const db = require('../db');
const { avgRunSecondsSQL, avgRunBasisSQL, roundSeconds } = require('../cycleTime');
const { logActivity } = require('../activity');
const { plantDayShift } = require('../plantDay');

const router = express.Router();

// ─── Migration: per-category report dashboards ────────────────────────────────
// Additive, guarded column. A dashboard tagged with a category is the company's
// "Reports" page for that workspace (production, quality, …); untagged rows are
// ordinary custom dashboards and behave exactly as before.
{
  const cols = db.prepare('PRAGMA table_info(dashboards)').all().map(r => r.name);
  if (!cols.includes('category')) db.exec('ALTER TABLE dashboards ADD COLUMN category TEXT');
}

// ─── CRUD ─────────────────────────────────────────────────────────────────────

router.get('/', (req, res) => {
  const rows = db.prepare('SELECT * FROM dashboards WHERE company_id = ? ORDER BY updated_at DESC').all(req.companyId);
  res.json(rows.map(r => ({ ...r, cards: JSON.parse(r.cards || '[]') })));
});

router.post('/', (req, res) => {
  const { name, description = '', cards = [] } = req.body;
  if (!name) return res.status(400).json({ error: 'name required' });

  const dup = db.prepare('SELECT id FROM dashboards WHERE company_id = ? AND LOWER(name) = LOWER(?)').get(req.companyId, name);
  if (dup) return res.status(409).json({ error: 'duplicate_name', message: `A dashboard named "${name}" already exists` });

  // Plan limit check — base tier limit plus purchased add-on slots
  // (skipped entirely during early access — no limits while EARLY_ACCESS is on)
  const { config: appCfg } = require('../config');
  const { getPlanRow } = require('./config');
  const plan = getPlanRow(req.companyId);
  if (!appCfg.earlyAccess && plan && plan.dashboard_limit >= 0) {
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
  if (name !== undefined && name !== d.name) {
    const dup = db.prepare('SELECT id FROM dashboards WHERE company_id = ? AND LOWER(name) = LOWER(?) AND id != ?').get(req.companyId, name, req.params.id);
    if (dup) return res.status(409).json({ error: 'duplicate_name', message: `A dashboard named "${name}" already exists` });
  }
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

// ─── Page-level filters ───────────────────────────────────────────────────────
// GET /:id/data accepts optional `department_id`, `app_id` and `site_id` query
// params. Each is validated against the caller's OWN rows: an id that belongs
// to another tenant, or no longer exists, is dropped (and reported back in
// `ignored_filters`) rather than rejected — a stale bookmark degrades to
// "unfiltered" instead of a 500, and tenant scoping is untouched either way.
//
// WHICH FILTER APPLIES WHERE  (· = ignored: the underlying data has no
// meaningful join to that dimension, so filtering it would invent a number)
//
//   card / metric                    department_id            app_id       site_id
//   ────────────────────────────────────────────────────────────────────────────
//   metric: total/today/active/       ✓ COALESCE(wo,st)        ✓            ✓ COALESCE(wo,st)
//     period_completions,
//     pass_rate, avg_cycle
//   metric: open_ncrs                 ✓ via work order         ✓ ncr.app_id ✓ via work order
//   metric: low_stock_items           ·                        ·            ·  (stock is
//                                       company-wide; a per-site on-hand sum would
//                                       flag items that are stocked elsewhere)
//   metric: open_maintenance_wos      ✓ mwo.department_id      ·            ·
//   metric: pm_due                    ✓ via asset              ·            ·
//   metric: training_coverage         ✓ via user               ✓            ·
//   time_series: throughput,          ✓ COALESCE(wo,st)        ✓            ✓ COALESCE(wo,st)
//     cycle_time, quality
//   time_series: ncr_trend            ✓ via work order         ✓            ✓ via work order
//   time_series: stock_movements      ·                        ·            ✓ via location
//   distribution: operator, app,      ✓ COALESCE(wo,st)        ✓            ✓ COALESCE(wo,st)
//     quality, department
//   distribution: station_status      ✓ station.department_id  ·            ✓ station.site_id
//   distribution: kaizen_status       ✓ idea.department_id     ·            ·
//   distribution: training_status     ✓ via user               ✓            ·
//   leaderboard: completions,         ✓ COALESCE(wo,st)        ✓            ✓ COALESCE(wo,st)
//     cycle_time
//   wo_status                         ✓ wo.department_id       ✓ wo.app_id  ✓ wo.site_id
//   table (recent runs)               ✓ COALESCE(wo,st)        ✓            ✓ COALESCE(wo,st)

const FILTER_SOURCES = {
  department_id: 'departments',
  app_id: 'apps',
  site_id: 'sites',
};

/** Keep only filter ids the company actually owns; report the rest as ignored. */
function resolveFilters(query, companyId) {
  const applied = {};
  const ignored = [];
  for (const [key, table] of Object.entries(FILTER_SOURCES)) {
    const raw = typeof query[key] === 'string' ? query[key].trim() : '';
    if (!raw) continue;
    // `table` is a literal from FILTER_SOURCES — never user input.
    const row = db.prepare(`SELECT id FROM ${table} WHERE id = ? AND company_id = ?`).get(raw, companyId);
    if (row) applied[key] = row.id;
    else ignored.push(key);
  }
  return { applied, ignored };
}

// A card pinned to one app plus a page filter for a different app is an empty
// intersection. A sentinel id that matches no row keeps every query shape and
// parameter binding identical instead of special-casing each card type.
const NO_MATCH = ' no-match';

function effectiveAppId(card, filters) {
  if (card.app_id && filters.app_id && card.app_id !== filters.app_id) return NO_MATCH;
  return filters.app_id || card.app_id || null;
}

/**
 * Filter fragment for queries rooted at `completions c`. Department and site
 * resolve through the run's work order first, then the station it ran at — the
 * same COALESCE the analytics endpoints use, so runs stay attributed the way
 * the rest of the app attributes them.
 */
function completionScope(appId, filters) {
  const needsJoin = !!(filters.department_id || filters.site_id);
  const join = needsJoin
    ? ' LEFT JOIN work_orders wo ON wo.id = c.work_order_id LEFT JOIN stations st ON st.id = c.station_id'
    : '';
  const clauses = [];
  const params = [];
  if (appId)                 { clauses.push('c.app_id = ?');                              params.push(appId); }
  if (filters.department_id) { clauses.push('COALESCE(wo.department_id, st.department_id) = ?'); params.push(filters.department_id); }
  if (filters.site_id)       { clauses.push('COALESCE(wo.site_id, st.site_id) = ?');       params.push(filters.site_id); }
  return { join, where: clauses.length ? ` AND ${clauses.join(' AND ')}` : '', params };
}

/** Filter fragment for queries rooted at `ncrs n` (department/site via the WO). */
function ncrScope(appId, filters) {
  const needsJoin = !!(filters.department_id || filters.site_id);
  const join = needsJoin ? ' LEFT JOIN work_orders wo ON wo.id = n.work_order_id' : '';
  const clauses = [];
  const params = [];
  if (appId)                 { clauses.push('n.app_id = ?');          params.push(appId); }
  if (filters.department_id) { clauses.push('wo.department_id = ?');  params.push(filters.department_id); }
  if (filters.site_id)       { clauses.push('wo.site_id = ?');        params.push(filters.site_id); }
  return { join, where: clauses.length ? ` AND ${clauses.join(' AND ')}` : '', params };
}

/** Filter fragment for queries rooted at `training_records tr` (dept via user). */
function trainingScope(appId, filters) {
  const join = filters.department_id ? ' LEFT JOIN users u ON u.id = tr.user_id' : '';
  const clauses = [];
  const params = [];
  if (appId)                 { clauses.push('tr.app_id = ?');       params.push(appId); }
  if (filters.department_id) { clauses.push('u.department_id = ?'); params.push(filters.department_id); }
  return { join, where: clauses.length ? ` AND ${clauses.join(' AND ')}` : '', params };
}

// ─── GET /:id/data - compute all card data ────────────────────────────────────

router.get('/:id/data', (req, res) => {
  const d = db.prepare('SELECT * FROM dashboards WHERE id = ? AND company_id = ?').get(req.params.id, req.companyId);
  if (!d) return res.status(404).json({ error: 'Not found' });

  const { applied: filters, ignored } = resolveFilters(req.query, req.companyId);

  const cards = JSON.parse(d.cards || '[]');
  const results = cards.map(card => {
    try {
      return { card_id: card.id, data: computeCardData(card, req.companyId, filters) };
    } catch (e) {
      return { card_id: card.id, data: null, error: e.message };
    }
  });

  res.json({
    dashboard_id: req.params.id,
    filters,
    ignored_filters: ignored,
    cards: results,
  });
});

// ─── Card data computation ────────────────────────────────────────────────────

function computeCardData(card, companyId, filters = {}) {
  const days = card.period_days || 30;
  const appId = effectiveAppId(card, filters);
  const scope = completionScope(appId, filters);

  switch (card.type) {

    // Every metric card carries a `unit` saying what its number IS — 'count',
    // 'percent' or 'duration' — so the view formats it instead of sniffing the
    // card's title for the word "min". A duration also carries the seconds it
    // averaged (`avg_cycle_seconds`) and what those runs were measured on
    // (`avg_cycle_basis`), which is what lets a report card print a duration
    // through the same formatter as every other screen.
    case 'metric': {
      switch (card.metric_key) {
        case 'total_completions':
          return { unit: 'count', value: db.prepare(`SELECT COUNT(*) as c FROM completions c${scope.join} WHERE c.company_id = ? AND c.status='completed'${scope.where}`).get(companyId, ...scope.params).c };
        case 'today_completions': {
          // The plant's today, so a custom dashboard tile agrees with the
          // Command Center tile beside it instead of rolling over at midnight UTC.
          const day = plantDayShift(companyId);
          return { unit: 'count', value: db.prepare(`SELECT COUNT(*) as c FROM completions c${scope.join} WHERE c.company_id = ? AND c.status='completed' AND date(c.completed_at, ?)=date('now', ?)${scope.where}`).get(companyId, day, day, ...scope.params).c };
        }
        case 'active_runs':
          return { unit: 'count', value: db.prepare(`SELECT COUNT(*) as c FROM completions c${scope.join} WHERE c.company_id = ? AND c.status='in_progress'${scope.where}`).get(companyId, ...scope.params).c };
        case 'pass_rate': {
          // Only runs that actually recorded a Pass/Fail count — runs with no QC
          // step are not silently scored as passes, and no QC data at all reports
          // "no data" rather than a flattering 100%.
          const rows = db.prepare(`SELECT c.data FROM completions c${scope.join} WHERE c.company_id = ? AND c.status='completed'${scope.where} LIMIT 500`).all(companyId, ...scope.params);
          let pass = 0, total = 0;
          for (const r of rows) {
            const v = Object.values(JSON.parse(r.data || '{}'));
            if (v.some(x => x === 'Fail')) total++;
            else if (v.some(x => x === 'Pass')) { total++; pass++; }
          }
          return total > 0
            ? { unit: 'percent', value: Math.round((pass / total) * 100), suffix: '%', sample_size: total }
            : { unit: 'percent', value: null, empty_reason: 'No pass/fail results recorded yet' };
        }
        case 'avg_cycle': {
          const row = db.prepare(`
            SELECT ${avgRunSecondsSQL('c')}    as v,
                   ${avgRunBasisSQL('c')}      as basis,
                   COUNT(*)                    as n
            FROM completions c${scope.join}
            WHERE c.company_id = ? AND c.status='completed' AND c.completed_at IS NOT NULL${scope.where}
          `).get(companyId, ...scope.params);
          // Null-checked, not truthiness-checked: a line averaging a few seconds
          // per unit is a fast line, not an empty one, and `row?.v ? …` filed it
          // under "No completed runs yet".
          //
          // Seconds are the number; the rounded minutes (`value`/`suffix`) stay
          // for one release so an older client keeps rendering. A new client
          // reads `unit` + `avg_cycle_seconds` and never re-rounds.
          return row?.v != null
            ? {
                unit: 'duration',
                value: Math.round((row.v / 60) * 10) / 10,
                seconds: roundSeconds(row.v),
                avg_cycle_seconds: roundSeconds(row.v),
                avg_cycle_basis: row.basis ?? null,
                sample_size: row.n,
                suffix: 'm',
              }
            : {
                unit: 'duration',
                value: null,
                seconds: null,
                avg_cycle_seconds: null,
                avg_cycle_basis: null,
                empty_reason: 'No completed runs yet',
              };
        }
        case 'period_completions':
          return { unit: 'count', value: db.prepare(`SELECT COUNT(*) as c FROM completions c${scope.join} WHERE c.company_id = ? AND c.status='completed' AND c.completed_at >= date('now','-'||?||' days')${scope.where}`).get(companyId, days, ...scope.params).c };
        // Workspace-report metrics (seeded by the /category/:category endpoint)
        case 'low_stock_items':
          // Deliberately unfiltered: reorder points are company-wide, so slicing
          // on-hand by site would report items as short that are stocked elsewhere.
          return { unit: 'count', value: db.prepare(`
            SELECT COUNT(*) as c FROM items i
            WHERE i.company_id = ? AND i.is_active = 1 AND i.reorder_point > 0
              AND COALESCE((SELECT SUM(sl.quantity) FROM stock_levels sl WHERE sl.item_id = i.id), 0) <= i.reorder_point
          `).get(companyId).c };
        case 'open_ncrs': {
          const n = ncrScope(appId, filters);
          return { unit: 'count', value: db.prepare(`SELECT COUNT(*) as c FROM ncrs n${n.join} WHERE n.company_id = ? AND n.status NOT IN ('resolved','closed')${n.where}`).get(companyId, ...n.params).c };
        }
        case 'open_maintenance_wos': {
          const where = filters.department_id ? ' AND department_id = ?' : '';
          const params = filters.department_id ? [filters.department_id] : [];
          return { unit: 'count', value: db.prepare(`SELECT COUNT(*) as c FROM maintenance_work_orders WHERE company_id = ? AND status IN ('open','in_progress','on_hold')${where}`).get(companyId, ...params).c };
        }
        case 'pm_due': {
          const join = filters.department_id ? ' LEFT JOIN assets a ON a.id = p.asset_id' : '';
          const where = filters.department_id ? ' AND a.department_id = ?' : '';
          const params = filters.department_id ? [filters.department_id] : [];
          return { unit: 'count', value: db.prepare(`
            SELECT COUNT(*) as c FROM pm_schedules p${join}
            WHERE p.company_id = ? AND p.next_due_at IS NOT NULL
              AND date(p.next_due_at) <= date('now', ?, '+7 days')${where}
          `).get(companyId, plantDayShift(companyId), ...params).c };
        }
        case 'training_coverage': {
          const t = trainingScope(appId, filters);
          const row = db.prepare(`
            SELECT COUNT(*) as total, COALESCE(SUM(CASE WHEN tr.status = 'certified' THEN 1 ELSE 0 END), 0) as certified
            FROM training_records tr${t.join} WHERE tr.company_id = ?${t.where}
          `).get(companyId, ...t.params);
          return row.total > 0
            ? { unit: 'percent', value: Math.round((row.certified / row.total) * 100), suffix: '%', sample_size: row.total }
            : { unit: 'percent', value: null, empty_reason: 'No training records yet' };
        }
        default:
          // An unknown metric key is a configuration problem, not a zero.
          return { unit: 'count', value: null, empty_reason: `Unknown metric "${card.metric_key}"` };
      }
    }

    case 'time_series': {
      const metric = card.series || 'throughput';
      if (metric === 'throughput') {
        const rows = db.prepare(`
          SELECT date(c.completed_at) as date, COUNT(*) as count
          FROM completions c${scope.join} WHERE c.company_id = ? AND c.status='completed'
            AND c.completed_at >= date('now','-'||?||' days')${scope.where}
          GROUP BY date(c.completed_at) ORDER BY date ASC
        `).all(companyId, days, ...scope.params);
        return { unit: 'count', series: [{ name: 'Completions', data: rows.map(r => ({ date: r.date, value: r.count })) }] };
      }
      if (metric === 'cycle_time') {
        const rows = db.prepare(`
          SELECT date(c.completed_at) as date,
            ROUND(${avgRunSecondsSQL('c')} / 60.0, 1) as value
          FROM completions c${scope.join} WHERE c.company_id = ? AND c.status='completed' AND c.completed_at IS NOT NULL
            AND c.completed_at >= date('now','-'||?||' days')${scope.where}
          GROUP BY date(c.completed_at) ORDER BY date ASC
        `).all(companyId, days, ...scope.params);
        // The values are minutes; `unit` says so, so the chart formats them
        // through the one duration formatter instead of the view sniffing the
        // series NAME for the word "min". A tooltip reading "30s" beside a tile
        // reading "30s" is the whole point.
        return { unit: 'minutes', series: [{ name: 'Avg Cycle', data: rows }] };
      }
      if (metric === 'quality') {
        const rows = db.prepare(`
          SELECT date(c.completed_at) as date, c.data
          FROM completions c${scope.join} WHERE c.company_id = ? AND c.status='completed'
            AND c.completed_at >= date('now','-'||?||' days')${scope.where}
          ORDER BY c.completed_at ASC
        `).all(companyId, days, ...scope.params);
        // Days are plotted only from runs that recorded a Pass/Fail — a day of
        // runs with no QC step is absent rather than charted as a 100% day.
        const byDate = {};
        for (const r of rows) {
          const vals = Object.values(JSON.parse(r.data||'{}'));
          const failed = vals.some(v => v === 'Fail');
          const passed = !failed && vals.some(v => v === 'Pass');
          if (!failed && !passed) continue;
          const d = r.date; if (!byDate[d]) byDate[d] = { pass: 0, total: 0 };
          byDate[d].total++;
          if (passed) byDate[d].pass++;
        }
        const data = Object.entries(byDate).sort(([a],[b])=>a.localeCompare(b))
          .map(([date, v]) => ({ date, value: Math.round((v.pass/v.total)*100) }));
        return { unit: 'percent', series: [{ name: 'Pass Rate %', data }] };
      }
      // Workspace-report series (seeded by the /category/:category endpoint)
      if (metric === 'ncr_trend') {
        const n = ncrScope(appId, filters);
        const rows = db.prepare(`
          SELECT date(n.created_at) as date, COUNT(*) as value
          FROM ncrs n${n.join}
          WHERE n.company_id = ? AND n.created_at >= date('now','-'||?||' days')${n.where}
          GROUP BY date(n.created_at) ORDER BY date ASC
        `).all(companyId, days, ...n.params);
        return { unit: 'count', series: [{ name: 'NCRs Opened', data: rows }] };
      }
      if (metric === 'stock_movements') {
        // Movements carry a location, so only site is meaningful here.
        const join = filters.site_id ? ' LEFT JOIN locations l ON l.id = m.location_id' : '';
        const where = filters.site_id ? ' AND l.site_id = ?' : '';
        const params = filters.site_id ? [filters.site_id] : [];
        const rows = db.prepare(`
          SELECT date(m.created_at) as date, COUNT(*) as value
          FROM stock_movements m JOIN items i ON i.id = m.item_id${join}
          WHERE i.company_id = ? AND m.created_at >= date('now','-'||?||' days')${where}
          GROUP BY date(m.created_at) ORDER BY date ASC
        `).all(companyId, days, ...params);
        return { unit: 'count', series: [{ name: 'Stock Movements', data: rows }] };
      }
      return { unit: 'count', series: [] };
    }

    case 'distribution': {
      const groupBy = card.group_by || 'operator';
      if (groupBy === 'operator') {
        const rows = db.prepare(`
          SELECT c.operator_name as label, COUNT(*) as value FROM completions c${scope.join}
          WHERE c.company_id = ? AND c.status='completed'${scope.where}
          GROUP BY c.operator_name ORDER BY value DESC LIMIT 10
        `).all(companyId, ...scope.params);
        return { data: rows };
      }
      if (groupBy === 'app') {
        const rows = db.prepare(`
          SELECT c.app_name as label, COUNT(*) as value FROM completions c${scope.join}
          WHERE c.company_id = ? AND c.status='completed'${scope.where}
          GROUP BY c.app_name ORDER BY value DESC LIMIT 10
        `).all(companyId, ...scope.params);
        return { data: rows };
      }
      if (groupBy === 'quality') {
        // Counts explicit QC results only — runs without a pass/fail step are
        // not counted as passes.
        const rows = db.prepare(`SELECT c.data FROM completions c${scope.join} WHERE c.company_id = ? AND c.status='completed'${scope.where} LIMIT 500`).all(companyId, ...scope.params);
        let pass = 0, fail = 0;
        for (const r of rows) {
          const vals = Object.values(JSON.parse(r.data||'{}'));
          if (vals.some(v => v === 'Fail')) fail++;
          else if (vals.some(v => v === 'Pass')) pass++;
        }
        return { data: pass + fail > 0 ? [{ label: 'Pass', value: pass }, { label: 'Fail', value: fail }] : [] };
      }
      if (groupBy === 'department') {
        // Rooted at the work order, so `wo` is always joined here — the shared
        // completion scope would duplicate it.
        const clauses = [];
        const params = [];
        if (appId)                 { clauses.push('c.app_id = ?');         params.push(appId); }
        if (filters.department_id) { clauses.push('wo.department_id = ?'); params.push(filters.department_id); }
        if (filters.site_id)       { clauses.push('wo.site_id = ?');       params.push(filters.site_id); }
        const where = clauses.length ? ` AND ${clauses.join(' AND ')}` : '';
        const rows = db.prepare(`
          SELECT d.name as label, COUNT(c.id) as value
          FROM completions c
          JOIN work_orders wo ON wo.id = c.work_order_id AND wo.company_id = c.company_id
          JOIN departments d ON d.id = wo.department_id AND d.company_id = c.company_id
          WHERE c.company_id = ? AND c.status='completed'${where}
          GROUP BY d.name ORDER BY value DESC
        `).all(companyId, ...params);
        return { data: rows };
      }
      // Workspace-report groupings (seeded by the /category/:category endpoint)
      if (groupBy === 'station_status') {
        const clauses = [];
        const params = [];
        if (filters.department_id) { clauses.push('department_id = ?'); params.push(filters.department_id); }
        if (filters.site_id)       { clauses.push('site_id = ?');       params.push(filters.site_id); }
        const where = clauses.length ? ` AND ${clauses.join(' AND ')}` : '';
        const rows = db.prepare(`
          SELECT COALESCE(NULLIF(current_status, ''), 'idle') as label, COUNT(*) as value
          FROM stations WHERE company_id = ?${where}
          GROUP BY label ORDER BY value DESC
        `).all(companyId, ...params);
        return { data: rows };
      }
      if (groupBy === 'kaizen_status') {
        const where = filters.department_id ? ' AND department_id = ?' : '';
        const params = filters.department_id ? [filters.department_id] : [];
        const rows = db.prepare(`
          SELECT status as label, COUNT(*) as value FROM kaizen_ideas
          WHERE company_id = ?${where} GROUP BY status ORDER BY value DESC
        `).all(companyId, ...params);
        return { data: rows };
      }
      if (groupBy === 'training_status') {
        const t = trainingScope(appId, filters);
        const rows = db.prepare(`
          SELECT tr.status as label, COUNT(*) as value FROM training_records tr${t.join}
          WHERE tr.company_id = ?${t.where} GROUP BY tr.status ORDER BY value DESC
        `).all(companyId, ...t.params);
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
          SELECT c.operator_name as name, COUNT(*) as value
          FROM completions c${scope.join} WHERE c.company_id = ? AND c.status='completed'${scope.where}
          GROUP BY c.operator_name ORDER BY value DESC LIMIT ?
        `).all(companyId, ...scope.params, limit);
        return { rows, label: 'Completions', unit: 'count' };
      }
      if (metric === 'cycle_time') {
        const rows = db.prepare(`
          SELECT c.operator_name as name,
            ROUND(${avgRunSecondsSQL('c')} / 60.0, 1) as value
          FROM completions c${scope.join} WHERE c.company_id = ? AND c.status='completed' AND c.completed_at IS NOT NULL${scope.where}
          GROUP BY c.operator_name HAVING COUNT(*) >= 3 ORDER BY value ASC LIMIT ?
        `).all(companyId, ...scope.params, limit);
        // `unit` is the fact; the label no longer has to smuggle it in as the
        // word "min" for the view to sniff back out.
        return { rows, label: 'Avg Cycle', unit: 'minutes', lower_is_better: true };
      }
      return { rows: [], unit: 'count' };
    }

    case 'wo_status': {
      // Work orders carry all three dimensions directly.
      const clauses = [];
      const params = [];
      if (appId)                 { clauses.push('app_id = ?');        params.push(appId); }
      if (filters.department_id) { clauses.push('department_id = ?'); params.push(filters.department_id); }
      if (filters.site_id)       { clauses.push('site_id = ?');       params.push(filters.site_id); }
      const where = clauses.length ? ` AND ${clauses.join(' AND ')}` : '';
      const statuses = ['pending','in_progress','completed','overdue','cancelled'];
      const counts = {};
      const stmt = db.prepare(`SELECT COUNT(*) as c FROM work_orders WHERE company_id = ? AND status=?${where}`);
      for (const s of statuses) {
        counts[s] = stmt.get(companyId, s, ...params).c;
      }
      return { counts };
    }

    case 'table': {
      const limit = Math.min(Math.max(parseInt(card.limit, 10) || 10, 1), 100);
      // Always joins the work order for its number; add the station only when a
      // department/site filter needs the fallback attribution.
      const stJoin = (filters.department_id || filters.site_id) ? ' LEFT JOIN stations st ON st.id = c.station_id' : '';
      const clauses = [];
      const params = [];
      if (appId)                 { clauses.push('c.app_id = ?');                                    params.push(appId); }
      if (filters.department_id) { clauses.push('COALESCE(w.department_id, st.department_id) = ?');  params.push(filters.department_id); }
      if (filters.site_id)       { clauses.push('COALESCE(w.site_id, st.site_id) = ?');              params.push(filters.site_id); }
      const where = clauses.length ? ` AND ${clauses.join(' AND ')}` : '';
      const rows = db.prepare(`
        SELECT c.id, c.app_name, c.operator_name, c.started_at, c.completed_at,
          c.status, c.work_order_id, w.work_order_number
        FROM completions c
        LEFT JOIN work_orders w ON w.id = c.work_order_id${stJoin}
        WHERE c.company_id = ?${where}
        ORDER BY c.started_at DESC LIMIT ?
      `).all(companyId, ...params, limit);
      return { rows };
    }

    default:
      return null;
  }
}

// ─── Per-category Reports dashboards ──────────────────────────────────────────
// Each workspace (production, inventory, …) gets exactly one editable Reports
// dashboard per company, auto-created on first access with sensible defaults.
// All seeded cards use card types/configs the engine above already handles, so
// they render and stay editable through the normal dashboard editor.

const REPORT_CATEGORIES = {
  production: {
    name: 'Production Reports',
    description: 'Throughput, cycle time and station status for the Production workspace.',
    defaultCards: () => [
      { id: uuidv4(), type: 'metric',       title: "Today's Completions", metric_key: 'today_completions', size: 'sm', color: '#3b82f6' },
      { id: uuidv4(), type: 'metric',       title: 'Avg Cycle Time',      metric_key: 'avg_cycle', size: 'sm', color: '#8b5cf6' },
      // The question a production report has to answer first: where do the work
      // orders stand? Throughput and cycle time explain the "why" underneath.
      { id: uuidv4(), type: 'wo_status',    title: 'Work Orders by Status', size: 'md' },
      { id: uuidv4(), type: 'time_series',  title: 'Daily Throughput',    series: 'throughput', period_days: 30, size: 'md' },
      { id: uuidv4(), type: 'time_series',  title: 'Cycle Time Trend',    series: 'cycle_time', period_days: 30, size: 'md' },
      { id: uuidv4(), type: 'distribution', title: 'Output by Department', group_by: 'department', size: 'md' },
      { id: uuidv4(), type: 'distribution', title: 'Station Status',      group_by: 'station_status', size: 'md' },
    ],
  },
  inventory: {
    name: 'Inventory Reports',
    description: 'Low stock alerts and recent movements for the Inventory workspace.',
    defaultCards: () => [
      { id: uuidv4(), type: 'metric',      title: 'Low Stock Items',      metric_key: 'low_stock_items', size: 'sm', color: '#ef4444' },
      { id: uuidv4(), type: 'time_series', title: 'Recent Stock Movements', series: 'stock_movements', period_days: 30, size: 'lg' },
    ],
  },
  quality: {
    name: 'Quality Reports',
    description: 'NCR trend and pass rate for the Quality workspace.',
    defaultCards: () => [
      { id: uuidv4(), type: 'metric',       title: 'Pass Rate',    metric_key: 'pass_rate', size: 'sm', color: '#10b981' },
      { id: uuidv4(), type: 'metric',       title: 'Open NCRs',    metric_key: 'open_ncrs', size: 'sm', color: '#ef4444' },
      { id: uuidv4(), type: 'time_series',  title: 'NCR Trend',    series: 'ncr_trend', period_days: 30, size: 'md' },
      { id: uuidv4(), type: 'distribution', title: 'Pass vs Fail', group_by: 'quality', size: 'md' },
    ],
  },
  kaizen: {
    name: 'Kaizen Reports',
    description: 'Improvement ideas by status for the Kaizen workspace.',
    defaultCards: () => [
      { id: uuidv4(), type: 'distribution', title: 'Ideas by Status', group_by: 'kaizen_status', size: 'lg' },
    ],
  },
  maintenance: {
    name: 'Maintenance Reports',
    description: 'Open maintenance work orders and upcoming PMs for the Maintenance workspace.',
    defaultCards: () => [
      { id: uuidv4(), type: 'metric', title: 'Open Maintenance WOs', metric_key: 'open_maintenance_wos', size: 'sm', color: '#f59e0b' },
      { id: uuidv4(), type: 'metric', title: 'PM Due (next 7 days)', metric_key: 'pm_due', size: 'sm', color: '#3b82f6' },
    ],
  },
  people: {
    name: 'People Reports',
    description: 'Training coverage for the People workspace.',
    defaultCards: () => [
      { id: uuidv4(), type: 'metric',       title: 'Training Coverage',  metric_key: 'training_coverage', size: 'sm', color: '#14b8a6' },
      { id: uuidv4(), type: 'distribution', title: 'Training by Status', group_by: 'training_status', size: 'md' },
    ],
  },
};

// GET /api/dashboards/category/:category — fetch (auto-creating once per
// company) the workspace's Reports dashboard. Idempotent and tenant-scoped;
// system-managed, so it does not count against the custom-dashboard plan limit.
router.get('/category/:category', (req, res) => {
  const { category } = req.params;
  const spec = REPORT_CATEGORIES[category];
  if (!spec) {
    return res.status(400).json({ error: `invalid category — must be one of: ${Object.keys(REPORT_CATEGORIES).join(', ')}` });
  }

  const existing = db.prepare('SELECT * FROM dashboards WHERE company_id = ? AND category = ?').get(req.companyId, category);
  if (existing) return res.json({ ...existing, cards: JSON.parse(existing.cards || '[]') });

  const id = uuidv4();
  db.prepare(`INSERT INTO dashboards (id, name, description, cards, company_id, category) VALUES (?, ?, ?, ?, ?, ?)`)
    .run(id, spec.name, spec.description, JSON.stringify(spec.defaultCards()), req.companyId, category);
  logActivity(req.companyId, 'dashboard', id, `Dashboard "${spec.name}" created`, req.user?.display_name);
  const d = db.prepare('SELECT * FROM dashboards WHERE id = ?').get(id);
  res.json({ ...d, cards: JSON.parse(d.cards) });
});

module.exports = router;

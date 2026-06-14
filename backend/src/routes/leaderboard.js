const express = require('express');
const db = require('../db');

const router = express.Router();

// ─── Helpers ──────────────────────────────────────────────────────────────────

const PERIODS = {
  today: "AND c.started_at >= datetime('now', 'start of day')",
  week:  "AND c.started_at >= datetime('now', '-7 days')",
  month: "AND c.started_at >= datetime('now', '-30 days')",
  all:   '',
};

const PERIOD_LABELS = {
  today: 'Today',
  week: 'This Week',
  month: 'This Month',
  all: 'All Time',
};

const CYCLE_TIME_SQL = "(julianday(c.completed_at) - julianday(c.started_at)) * 1440";

// A completion only counts toward the leaderboard if it finished cleanly
// (status='completed') and has no quality issue (no NCR raised against it).
const QUALITY_CLAUSE = `
  c.status = 'completed' AND c.completed_at IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM ncrs n WHERE n.completion_id = c.id)
`;

// ─── GET / — leaderboards for every (app, product) combo ──────────────────────

router.get('/', (req, res) => {
  const cid = req.companyId;
  const period = PERIODS[req.query.period] !== undefined ? req.query.period : 'week';
  const periodFilter = PERIODS[period];

  const groups = db.prepare(`
    SELECT c.app_id, a.name as app_name, c.product_type_id, pt.name as product_type_name,
           COUNT(*) as qualifying_count,
           COUNT(DISTINCT c.operator_name) as operator_count
    FROM completions c
    JOIN apps a ON a.id = c.app_id
    LEFT JOIN product_types pt ON pt.id = c.product_type_id
    WHERE c.company_id = ? AND a.status = 'published'
      AND ${QUALITY_CLAUSE} ${periodFilter}
    GROUP BY c.app_id, c.product_type_id
    HAVING qualifying_count > 0
    ORDER BY a.name ASC, pt.name ASC
  `).all(cid);

  const boards = groups.map(g => {
    const leaders = db.prepare(`
      SELECT operator_name,
             ROUND(MIN(${CYCLE_TIME_SQL}), 2) as best_minutes,
             ROUND(AVG(${CYCLE_TIME_SQL}), 2) as avg_minutes,
             COUNT(*) as completions,
             MAX(c.completed_at) as last_completed_at
      FROM completions c
      WHERE c.company_id = ? AND c.app_id = ?
        AND (c.product_type_id = ? OR (c.product_type_id IS NULL AND ? IS NULL))
        AND ${QUALITY_CLAUSE} ${periodFilter}
      GROUP BY operator_name
      ORDER BY best_minutes ASC, completions DESC
      LIMIT 10
    `).all(cid, g.app_id, g.product_type_id, g.product_type_id);

    const excluded = db.prepare(`
      SELECT COUNT(*) as c FROM completions c
      WHERE c.company_id = ? AND c.app_id = ?
        AND (c.product_type_id = ? OR (c.product_type_id IS NULL AND ? IS NULL))
        AND c.status = 'completed' AND c.completed_at IS NOT NULL
        AND EXISTS (SELECT 1 FROM ncrs n WHERE n.completion_id = c.id)
        ${periodFilter}
    `).get(cid, g.app_id, g.product_type_id, g.product_type_id).c;

    const allTimeBest = db.prepare(`
      SELECT ROUND(MIN(${CYCLE_TIME_SQL}), 2) as best
      FROM completions c
      WHERE c.company_id = ? AND c.app_id = ?
        AND (c.product_type_id = ? OR (c.product_type_id IS NULL AND ? IS NULL))
        AND ${QUALITY_CLAUSE}
    `).get(cid, g.app_id, g.product_type_id, g.product_type_id).best;

    return {
      app_id: g.app_id,
      app_name: g.app_name,
      product_type_id: g.product_type_id,
      product_type_name: g.product_type_name,
      qualifying_count: g.qualifying_count,
      operator_count: g.operator_count,
      excluded_quality_count: excluded,
      all_time_best_minutes: allTimeBest,
      leaders: leaders.map((l, i) => ({
        rank: i + 1,
        operator_name: l.operator_name,
        best_minutes: l.best_minutes,
        avg_minutes: l.avg_minutes,
        completions: l.completions,
        last_completed_at: l.last_completed_at,
        is_record: allTimeBest != null && l.best_minutes <= allTimeBest,
      })),
    };
  });

  res.json({
    period,
    period_label: PERIOD_LABELS[period],
    generated_at: new Date().toISOString(),
    boards,
  });
});

module.exports = router;

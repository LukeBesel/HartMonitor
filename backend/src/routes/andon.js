// ─── Andon — the ONE "request help" mechanism ────────────────────────────────
// Every help request in the product (the player's Request-help sheet, the
// Request-help action in the app shell, the Andon Board's own form) writes one
// andon_calls row. A request is tagged with the TARGET being alerted — one of
// the four function teams (quality / supervisor / maintenance / materials) or
// one of the company's own departments — and carries whatever run context it
// came from (work order, app, step, completion, station, department) so
// responders know where to go without asking. Nothing here dials anyone: this
// is an alert/notify system. Creation, acknowledgement and resolution all
// broadcast over the company WebSocket so open dashboards update live.

const express = require('express');
const { v4: uuidv4 } = require('uuid');
const db = require('../db');
const { plantDayShift } = require('../plantDay');
const { logActivity } = require('../activity');
const { broadcast } = require('../ws');
const { notify } = require('../notifications');
const { deliverWebhooks } = require('../webhooks');
const { TEAMS, TEAM_BY_TYPE, teamOf, teamLabel } = require('../andonTeams');
const { deliverAlert } = require('../andonRouting');
const { isValid, REASON_KIND, LOSS_BUCKET } = require('../vocab');
const { ROLE_LEVELS } = require('../middleware/auth');
const {
  startAndonEscalation, runOnce, listTargets, seedTargets, targetTeamOf, respondByFor,
  tierLabel, PRIORITIES, ESCALATE_TO_OPTIONS, MANAGER_TIER, MAX_ESCALATION_LEVEL,
} = require('../andonEscalation');

const router = express.Router();

// A call that nobody acknowledges has to chase someone; nothing else in the
// product owns the andon lifecycle, so the sweeper is started here — the same
// way routes/completions.js starts the stale-run reaper. Guarded against a
// double start, its timers are unref'd, and it stays off under NODE_ENV=test
// unless ANDON_SWEEP_MS asks for it (suites call runOnce() a tick at a time).
startAndonEscalation();

// Managers own the response targets and the coded reason list; supervisors and
// operators read them. index.js already gates every write on this router at
// 'operator', so this is the extra step up for configuration, not the only gate.
function canManage(req) {
  return (ROLE_LEVELS[req.user?.role] ?? 0) >= ROLE_LEVELS.manager;
}

// Returns the id if the row exists in this company, else null (cross-tenant FK guard).
function ownedOrNull(table, id, companyId) {
  if (!id) return null;
  const row = db.prepare(`SELECT id FROM ${table} WHERE id = ? AND company_id = ?`).get(id, companyId);
  return row ? id : null;
}

// ─── Shared read shape ────────────────────────────────────────────────────────
// Time deltas are computed in SQLite (julianday handles both the naked
// 'YYYY-MM-DD HH:MM:SS' UTC stamps written by DEFAULT and the ISO-8601 stamps
// written by the route) so clients never have to guess a timezone.

const SELECT_CALL = `
  SELECT a.*,
         d.name  AS department_name,
         s.name  AS station_name,
         wo.work_order_number,
         wo.part_name,
         ap.name AS app_name,
         CAST((julianday('now') - julianday(a.created_at)) * 86400 AS INTEGER) AS age_seconds,
         CAST((julianday(a.acknowledged_at) - julianday(a.created_at)) * 86400 AS INTEGER) AS response_seconds,
         CAST((julianday(a.resolved_at) - julianday(a.created_at)) * 86400 AS INTEGER) AS resolution_seconds,
         CAST((julianday(a.respond_by) - julianday('now')) * 86400 AS INTEGER) AS respond_in_seconds
  FROM andon_calls a
  LEFT JOIN departments d  ON d.id  = a.department_id
  LEFT JOIN stations s     ON s.id  = a.station_id
  LEFT JOIN work_orders wo ON wo.id = a.work_order_id
  LEFT JOIN apps ap        ON ap.id = a.app_id
`;

// Normalizes legacy rows onto the current contract: pre-team rows get a team
// from their type, and pre-title rows fall back to their description.
// `target_label` is the single string every surface renders — the department
// name when a department was alerted, the function team's name otherwise.
// The company's response targets, read once per request and keyed
// `team|priority`, so decorating a hundred rows is one query rather than a
// hundred. Seeds the defaults on the way past (first read for a new company).
function targetMap(companyId) {
  const map = new Map();
  for (const t of listTargets(companyId)) map.set(`${t.team}|${t.priority}`, t);
  return map;
}

function decorate(row, targets) {
  if (!row) return row;
  const team = teamOf(row);
  const targetType = row.target_type === 'department' && row.department_name ? 'department' : 'team';
  const targetLabel = targetType === 'department' ? row.department_name : teamLabel(team);
  // The target a call is measured against: its own team's row, except a safety
  // call, which is measured on the (much shorter) safety clock.
  const target = targets?.get(`${targetTeamOf(row)}|${row.priority || 'normal'}`) || null;
  const level = Number(row.escalation_level || 0);
  // The ladder: level 1 climbs to the team's own escalate_to, level 2 always
  // ends at management. Reading escalate_to for a level-2 call would label the
  // badge with the rung below the one that was actually told.
  const escalateTeam = level >= MAX_ESCALATION_LEVEL
    ? MANAGER_TIER
    : (target?.escalate_to_team || 'supervisor');
  const respondIn = row.respond_by ? (row.respond_in_seconds ?? null) : null;
  return {
    ...row,
    team,
    team_label: teamLabel(team),
    target_type: targetType,
    target_label: targetLabel,
    title: row.title || row.description || `${targetLabel} needed`,
    message: row.message || '',
    created_by: row.created_by || row.raised_by || '',
    assigned_to: row.assigned_to || row.acknowledged_by || '',
    age_seconds: Math.max(0, row.age_seconds ?? 0),
    response_seconds: row.response_seconds == null ? null : Math.max(0, row.response_seconds),
    resolution_seconds: row.resolution_seconds == null ? null : Math.max(0, row.resolution_seconds),
    location: row.station_name || row.department_name || '',
    // ── The clock ──
    respond_by: row.respond_by || null,
    // Seconds left before the target is missed; negative once it has been.
    // Null on a legacy row raised before targets existed — the board prints the
    // reason rather than inventing a countdown.
    respond_in_seconds: respondIn,
    target_seconds: target ? target.respond_minutes * 60 : null,
    target_reason: target ? null : 'no response target set for this team',
    escalation_level: level,
    escalated_at: row.escalated_at || null,
    escalated_to_user_id: row.escalated_to_user_id || null,
    escalated_to_team: level > 0 ? escalateTeam : null,
    escalated_to_label: level > 0 ? tierLabel(escalateTeam) : null,
    // Open, past its target, and nobody has said "on my way".
    overdue: row.status === 'open' && respondIn != null && respondIn < 0,
    // Measured, never estimated: null until somebody actually acknowledged.
    within_target: row.response_seconds == null || !target
      ? null
      : row.response_seconds <= target.respond_minutes * 60,
  };
}

function getCall(id, companyId) {
  const row = db.prepare(`${SELECT_CALL} WHERE a.id = ? AND a.company_id = ?`).get(id, companyId);
  return row ? decorate(row, targetMap(companyId)) : row;
}

function ownedCall(req) {
  return db.prepare('SELECT * FROM andon_calls WHERE id = ? AND company_id = ?')
    .get(req.params.id, req.companyId) || null;
}

// Every state change pushes the whole request to the company's open dashboards.
function publish(companyId, action, call) {
  broadcast(companyId, { type: 'andon', action, call });
}

// ─── GET /andon ────────────────────────────────────────────────────────────────

router.get('/', (req, res) => {
  const { status, department_id, type, team, station_id, limit = 100 } = req.query;
  let sql = `${SELECT_CALL} WHERE a.company_id = ?`;
  const params = [req.companyId];
  if (status) { sql += ' AND a.status = ?'; params.push(status); }
  if (department_id) { sql += ' AND a.department_id = ?'; params.push(department_id); }
  if (station_id) { sql += ' AND a.station_id = ?'; params.push(station_id); }
  if (type) { sql += ' AND a.type = ?'; params.push(type); }
  // Team filter matches rows tagged with the team AND legacy rows whose type
  // maps onto it, so filtering never hides history.
  if (team && TEAMS[team]) {
    sql += ' AND (a.team = ? OR ((a.team IS NULL OR a.team = \'\') AND a.type = ?))';
    params.push(team, TEAMS[team].type);
  }
  sql += ' ORDER BY CASE a.priority WHEN \'critical\' THEN 0 WHEN \'high\' THEN 1 WHEN \'normal\' THEN 2 ELSE 3 END, a.created_at DESC LIMIT ?';
  params.push(Number(limit) || 100);
  const targets = targetMap(req.companyId);
  res.json(db.prepare(sql).all(...params).map(row => decorate(row, targets)));
});

// ─── GET /andon/teams ──────────────────────────────────────────────────────────
// The routing vocabulary, so the player and the board never hard-code it twice.

router.get('/teams', (_req, res) => {
  res.json(Object.entries(TEAMS).map(([id, t]) => ({ id, label: t.label, type: t.type })));
});

// ─── GET /andon/summary ────────────────────────────────────────────────────────

// Optional ?department_id=… scopes every number here to one department, exactly
// as GET /andon scopes the list (same column, `andon_calls.department_id`), so
// the board's KPI cards and team badges can be read as that department's rather
// than the plant's. Without the parameter the counts stay company-wide.
// The `company_id = ?` on every statement still bounds the query, so a
// department id from another tenant matches nothing instead of widening it.

router.get('/summary', (req, res) => {
  const deptId = req.query.department_id || null;
  const dept = deptId ? ' AND department_id = ?' : '';
  const deptParams = deptId ? [deptId] : [];
  const cid = req.companyId;
  // "Today" on this board is the plant's day, the same one the Command Center
  // and the department screens count on. It used to be the UTC date, so a call
  // answered at 8pm in Detroit was already tomorrow's news.
  const day = plantDayShift(cid);

  const open = db.prepare(`SELECT COUNT(*) as n FROM andon_calls WHERE company_id = ? AND status = 'open'${dept}`).get(cid, ...deptParams).n;
  const critical = db.prepare(`SELECT COUNT(*) as n FROM andon_calls WHERE company_id = ? AND status = 'open' AND priority = 'critical'${dept}`).get(cid, ...deptParams).n;
  const acknowledged = db.prepare(`SELECT COUNT(*) as n FROM andon_calls WHERE company_id = ? AND status = 'acknowledged'${dept}`).get(cid, ...deptParams).n;
  const resolved_today = db.prepare(`SELECT COUNT(*) as n FROM andon_calls WHERE company_id = ? AND status = 'resolved' AND date(resolved_at, ?) = date('now', ?)${dept}`).get(cid, day, day, ...deptParams).n;
  const byType = db.prepare(`SELECT type, COUNT(*) as n FROM andon_calls WHERE company_id = ? AND status != 'resolved'${dept} GROUP BY type`).all(cid, ...deptParams);
  const by_type = Object.fromEntries(byType.map(r => [r.type, r.n]));

  // Live per-team load + today's median-ish response time (mean, in seconds).
  const teamRows = db.prepare(`
    SELECT type, team, status FROM andon_calls WHERE company_id = ? AND status != 'resolved'${dept}
  `).all(cid, ...deptParams);
  const by_team = Object.fromEntries(Object.keys(TEAMS).map(t => [t, 0]));
  for (const r of teamRows) by_team[teamOf(r)] = (by_team[teamOf(r)] || 0) + 1;

  const respRow = db.prepare(`
    SELECT AVG((julianday(acknowledged_at) - julianday(created_at)) * 86400) AS avg_s, COUNT(*) AS n
    FROM andon_calls
    WHERE company_id = ? AND acknowledged_at IS NOT NULL AND date(created_at, ?) = date('now', ?)${dept}
  `).get(cid, day, day, ...deptParams);

  // ── Against target ────────────────────────────────────────────────────────
  // A response time means nothing on its own: four minutes is excellent for a
  // materials call and far too slow for a safety one. Every call is therefore
  // measured against ITS OWN team+priority target, and the board reports the
  // share that made it — never a bare average pretending to be a verdict.
  const targets = targetMap(cid);
  const targetSecondsFor = row => {
    const t = targets.get(`${targetTeamOf(row)}|${row.priority || 'normal'}`);
    return t ? t.respond_minutes * 60 : null;
  };

  const overdue = db.prepare(`
    SELECT COUNT(*) as n FROM andon_calls
     WHERE company_id = ? AND status = 'open' AND respond_by IS NOT NULL
       AND julianday(respond_by) < julianday('now')${dept}
  `).get(cid, ...deptParams).n;
  const escalated_open = db.prepare(`
    SELECT COUNT(*) as n FROM andon_calls
     WHERE company_id = ? AND status = 'open' AND escalation_level > 0${dept}
  `).get(cid, ...deptParams).n;

  const answered = db.prepare(`
    SELECT type, team, priority,
           CAST((julianday(acknowledged_at) - julianday(created_at)) * 86400 AS INTEGER) AS response_seconds
      FROM andon_calls
     WHERE company_id = ? AND acknowledged_at IS NOT NULL
       AND date(created_at, ?) = date('now', ?)${dept}
  `).all(cid, day, day, ...deptParams);
  const measured = answered.filter(r => targetSecondsFor(r) != null);
  const withinCount = measured.filter(r => Math.max(0, r.response_seconds ?? 0) <= targetSecondsFor(r)).length;
  // Null, not 0%. "0% within target" says every call was late; "—, nothing has
  // been acknowledged today" says nothing has been measured. The board prints
  // the reason where the number would go.
  const within_target_pct = measured.length ? Math.round((withinCount / measured.length) * 100) : null;
  const within_target_reason = measured.length
    ? null
    : (answered.length ? 'no response target set for the calls answered today' : 'nothing has been acknowledged today');
  const target_seconds = measured.length
    ? Math.round(measured.reduce((sum, r) => sum + targetSecondsFor(r), 0) / measured.length)
    : null;

  res.json({
    open, critical, acknowledged, resolved_today, by_type, by_team,
    avg_response_seconds_today: respRow?.n ? Math.round(respRow.avg_s) : null,
    responded_today: respRow?.n ?? 0,
    // Open calls that have already missed their target, and how many of those
    // have been escalated at least once.
    overdue,
    escalated_open,
    // The target today's answered calls were measured against (mean seconds),
    // and the share that met it. Both null together, with a stated reason.
    target_seconds,
    within_target_pct,
    within_target_reason,
    within_target_sample: measured.length,
    // Echoed so a caller (and the board) can tell a scoped payload from a
    // plant-wide one without re-deriving it from its own state.
    department_id: deptId,
  });
});

// ─── GET/PUT /andon/targets — the response clock, per team and priority ──────
// respond_minutes is how long somebody has to say "on my way" before the call
// escalates; escalate_minutes is how long the next tier gets before it climbs
// again (twice at most). Defaults are seeded on the first read, so a company
// that never opens this panel still has a working clock.

router.get('/targets', (req, res) => {
  res.json(listTargets(req.companyId).map(t => ({
    ...t,
    team_label: TEAMS[t.team] ? teamLabel(t.team) : (t.team === 'safety' ? 'Safety' : t.team),
    escalate_to_label: tierLabel(t.escalate_to_team || 'supervisor'),
    // The rungs this row may be pointed at, so the panel's picker and the
    // validator below cannot offer and refuse different things.
    escalate_to_options: ESCALATE_TO_OPTIONS.map(id => ({ id, label: tierLabel(id) })),
  })));
});

router.put('/targets', (req, res) => {
  if (!canManage(req)) return res.status(403).json({ error: 'Requires manager role or higher', code: 'FORBIDDEN' });
  const { team, priority } = req.body || {};
  if (!team || !PRIORITIES.includes(priority)) {
    return res.status(400).json({ error: `team and priority (${PRIORITIES.join(', ')}) required` });
  }
  seedTargets(req.companyId);
  const existing = db.prepare('SELECT * FROM andon_targets WHERE company_id = ? AND team = ? AND priority = ?')
    .get(req.companyId, team, priority);
  if (!existing) return res.status(404).json({ error: 'Not found' });

  // A refused value is a 400, never a quiet substitution. Coercing 0 to the old
  // number and answering 200 tells the manager their edit was saved, leaves the
  // rejected figure sitting in the input, and hides the fact that the plant's
  // escalation policy is not what the screen says it is.
  const minutes = (value) => {
    const n = Number(value);
    return Number.isInteger(n) && n >= 1 && n <= 24 * 60 ? n : null;
  };
  const field = (name) => {
    if (req.body[name] === undefined) return { ok: true, value: existing[name] };
    const value = minutes(req.body[name]);
    return value === null ? { ok: false } : { ok: true, value };
  };
  const respondField = field('respond_minutes');
  if (!respondField.ok) {
    return res.status(400).json({ error: 'Respond must be a whole number of minutes, from 1 to 1440.' });
  }
  const escalateField = field('escalate_minutes');
  if (!escalateField.ok) {
    return res.status(400).json({ error: 'Escalate after must be a whole number of minutes, from 1 to 1440.' });
  }
  const respond = respondField.value;
  const escalate = escalateField.value;
  // Escalating sooner than the target is asked for is a contradiction: the call
  // would climb before anyone was late.
  if (respond >= escalate) {
    return res.status(400).json({
      error: `Respond (${respond} min) has to be shorter than escalate after (${escalate} min) — a call cannot climb before its response target has run out.`,
    });
  }
  let escalateTo = existing.escalate_to_team;
  if (req.body.escalate_to_team !== undefined) {
    if (!ESCALATE_TO_OPTIONS.includes(req.body.escalate_to_team)) {
      return res.status(400).json({ error: `Escalates to must be one of: ${ESCALATE_TO_OPTIONS.join(', ')}.` });
    }
    escalateTo = req.body.escalate_to_team;
  }

  db.prepare(`
    UPDATE andon_targets SET respond_minutes = ?, escalate_minutes = ?, escalate_to_team = ?
     WHERE id = ? AND company_id = ?
  `).run(respond, escalate, escalateTo, existing.id, req.companyId);
  logActivity(req.companyId, 'andon', existing.id,
    `Response target changed — ${team} / ${priority}: respond ${respond}m, escalate ${escalate}m`,
    req.user?.display_name);
  const saved = db.prepare('SELECT * FROM andon_targets WHERE id = ?').get(existing.id);
  res.json({
    ...saved,
    team_label: TEAMS[saved.team] ? teamLabel(saved.team) : (saved.team === 'safety' ? 'Safety' : saved.team),
    escalate_to_label: tierLabel(saved.escalate_to_team || 'supervisor'),
  });
});

// ─── /andon/reason-codes — the company's ONE coded reason list ───────────────
// Three streams capture a reason (scrap, rework, downtime) and every one of
// them reads this list, so a plant codes "no material" once and every screen —
// and every report — spells it the same way. A downtime reason additionally
// carries the OEE loss bucket it rolls into, which is what makes two plants'
// numbers comparable; a scrap or rework reason carries '' because it maps to no
// loss bucket at all.
//
// The defaults below are seeded the first time a company reads the list, so the
// capture screens are never handed an empty picker.

const REASON_DEFAULTS = {
  scrap: [
    ['weld_porosity', 'Weld porosity', ''],
    ['dimensional', 'Dimensional out of tolerance', ''],
    ['surface_defect', 'Surface defect', ''],
    ['material_defect', 'Material defect', ''],
    ['setup_scrap', 'Setup scrap', ''],
    ['handling_damage', 'Handling damage', ''],
  ],
  rework: [
    ['weld_repair', 'Weld repair', ''],
    ['dimensional_touch_up', 'Dimensional touch-up', ''],
    ['refinish', 'Surface refinish', ''],
    ['reassemble', 'Reassembly', ''],
    ['retest', 'Retest after adjustment', ''],
  ],
  downtime: [
    ['breakdown', 'Breakdown', 'breakdown'],
    ['changeover', 'Changeover / setup', 'setup_adjustment'],
    ['no_material', 'No material', 'minor_stop'],
    ['no_operator', 'No operator', 'minor_stop'],
    ['jam', 'Jam', 'minor_stop'],
    ['running_slow', 'Running slow', 'speed_loss'],
    ['startup_reject', 'Startup reject', 'startup_reject'],
    ['process_reject', 'Process reject', 'process_reject'],
  ],
};

/** Seeds the three default lists the first time a company reads any of them.
 *  Keyed on the company having NO codes at all, so deleting or deactivating one
 *  never resurrects it on the next read. */
function seedReasonCodes(companyId) {
  const existing = db.prepare('SELECT COUNT(*) as n FROM reason_codes WHERE company_id = ?').get(companyId).n;
  if (existing > 0) return;
  const insert = db.prepare(`
    INSERT OR IGNORE INTO reason_codes (id, company_id, kind, code, label, loss_bucket, sort_order)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  db.transaction(() => {
    for (const kind of REASON_KIND) {
      (REASON_DEFAULTS[kind] || []).forEach(([code, label, bucket], i) => {
        insert.run(uuidv4(), companyId, kind, code, label, bucket, (i + 1) * 10);
      });
    }
  })();
}

const reasonRow = r => ({ ...r, is_active: !!r.is_active });

router.get('/reason-codes', (req, res) => {
  seedReasonCodes(req.companyId);
  const { kind, include_inactive } = req.query;
  if (kind && !isValid('REASON_KIND', kind)) {
    return res.status(400).json({ error: `kind must be one of ${REASON_KIND.join(', ')}` });
  }
  let sql = 'SELECT * FROM reason_codes WHERE company_id = ?';
  const params = [req.companyId];
  if (kind) { sql += ' AND kind = ?'; params.push(kind); }
  if (include_inactive !== 'true') sql += ' AND is_active = 1';
  sql += ' ORDER BY kind ASC, sort_order ASC, label ASC';
  res.json(db.prepare(sql).all(...params).map(reasonRow));
});

router.post('/reason-codes', (req, res) => {
  if (!canManage(req)) return res.status(403).json({ error: 'Requires manager role or higher', code: 'FORBIDDEN' });
  seedReasonCodes(req.companyId);
  const { kind, code, label, loss_bucket = '', sort_order = 0 } = req.body || {};
  if (!isValid('REASON_KIND', kind)) {
    return res.status(400).json({ error: `kind must be one of ${REASON_KIND.join(', ')}` });
  }
  const trimmedCode = String(code || '').trim();
  const trimmedLabel = String(label || '').trim();
  if (!trimmedCode || !trimmedLabel) return res.status(400).json({ error: 'code and label required' });
  // '' is a legitimate bucket — a scrap reason rolls into no OEE loss. Anything
  // else has to be one of the six, because the CHECK on the column says so and
  // a 400 reads better than the 500 the constraint would raise.
  const bucket = String(loss_bucket || '');
  if (bucket && !isValid('LOSS_BUCKET', bucket)) {
    return res.status(400).json({ error: `loss_bucket must be empty or one of ${LOSS_BUCKET.join(', ')}` });
  }
  const dup = db.prepare('SELECT id FROM reason_codes WHERE company_id = ? AND kind = ? AND code = ?')
    .get(req.companyId, kind, trimmedCode);
  if (dup) return res.status(409).json({ error: 'That code already exists for this kind' });

  const id = uuidv4();
  db.prepare(`
    INSERT INTO reason_codes (id, company_id, kind, code, label, loss_bucket, sort_order)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(id, req.companyId, kind, trimmedCode, trimmedLabel, bucket, Number(sort_order) || 0);
  logActivity(req.companyId, 'reason_code', id, `Reason code added — ${kind}: ${trimmedLabel}`, req.user?.display_name);
  res.status(201).json(reasonRow(db.prepare('SELECT * FROM reason_codes WHERE id = ?').get(id)));
});

router.put('/reason-codes/:id', (req, res) => {
  if (!canManage(req)) return res.status(403).json({ error: 'Requires manager role or higher', code: 'FORBIDDEN' });
  const row = db.prepare('SELECT * FROM reason_codes WHERE id = ? AND company_id = ?')
    .get(req.params.id, req.companyId);
  if (!row) return res.status(404).json({ error: 'Not found' });

  const bucket = req.body?.loss_bucket !== undefined ? String(req.body.loss_bucket || '') : row.loss_bucket;
  if (bucket && !isValid('LOSS_BUCKET', bucket)) {
    return res.status(400).json({ error: `loss_bucket must be empty or one of ${LOSS_BUCKET.join(', ')}` });
  }
  const code = req.body?.code !== undefined ? String(req.body.code).trim() : row.code;
  const label = req.body?.label !== undefined ? String(req.body.label).trim() : row.label;
  if (!code || !label) return res.status(400).json({ error: 'code and label required' });
  if (code !== row.code) {
    const dup = db.prepare('SELECT id FROM reason_codes WHERE company_id = ? AND kind = ? AND code = ? AND id != ?')
      .get(req.companyId, row.kind, code, row.id);
    if (dup) return res.status(409).json({ error: 'That code already exists for this kind' });
  }
  const isActive = req.body?.is_active !== undefined ? (req.body.is_active ? 1 : 0) : row.is_active;
  const sortOrder = req.body?.sort_order !== undefined ? (Number(req.body.sort_order) || 0) : row.sort_order;

  db.prepare(`
    UPDATE reason_codes SET code = ?, label = ?, loss_bucket = ?, is_active = ?, sort_order = ?
     WHERE id = ? AND company_id = ?
  `).run(code, label, bucket, isActive, sortOrder, row.id, req.companyId);
  res.json(reasonRow(db.prepare('SELECT * FROM reason_codes WHERE id = ?').get(row.id)));
});

// ─── DELETE /andon/reason-codes/:id — retire a code, never erase it ─────────
// A soft delete on purpose: scrap and downtime rows recorded against a code
// have to keep reading correctly for as long as they are kept, and a hard
// delete would leave last quarter's Pareto chart pointing at nothing. The code
// leaves the picker (is_active = 0) and stays in history.

router.delete('/reason-codes/:id', (req, res) => {
  if (!canManage(req)) return res.status(403).json({ error: 'Requires manager role or higher', code: 'FORBIDDEN' });
  const row = db.prepare('SELECT * FROM reason_codes WHERE id = ? AND company_id = ?')
    .get(req.params.id, req.companyId);
  if (!row) return res.status(404).json({ error: 'Not found' });
  db.prepare('UPDATE reason_codes SET is_active = 0 WHERE id = ? AND company_id = ?').run(row.id, req.companyId);
  logActivity(req.companyId, 'reason_code', row.id, `Reason code retired — ${row.kind}: ${row.label}`, req.user?.display_name);
  res.json({ ...reasonRow(db.prepare('SELECT * FROM reason_codes WHERE id = ?').get(row.id)), retired: true });
});

// ─── POST /andon/sweep — drive one escalation tick (test harness only) ───────
// The sweeper runs on a timer in production and is deliberately off under
// NODE_ENV=test, so a suite can prove "escalates on the first tick, sends
// nothing on the second" instead of sleeping and hoping. Outside a test
// environment this route does not exist at all — the same 404 an unrouted path
// gives, so nothing advertises it.
//
// `backdate_call_id` moves one call's respond_by into the past first, which is
// how a suite (or a sandbox demo) reaches an overdue call without waiting out a
// ten-minute target.

router.post('/sweep', (req, res) => {
  if (process.env.NODE_ENV !== 'test') return res.status(404).json({ error: 'Not found', code: 'NOT_FOUND' });
  const { backdate_call_id, backdate_seconds = 60 } = req.body || {};
  if (backdate_call_id) {
    const seconds = Math.max(1, Math.round(Number(backdate_seconds) || 60));
    db.prepare(`
      UPDATE andon_calls SET respond_by = datetime('now', ?) WHERE id = ? AND company_id = ?
    `).run(`-${seconds} seconds`, backdate_call_id, req.companyId);
  }
  // Scoped to the caller's company even here: a test harness that sweeps every
  // tenant on the box is a harness that can make another suite's assertions
  // come true, and it is the one route in the file that would not be caught by
  // the tenant-isolation tests.
  const { escalated, stalled } = runOnce(new Date(), req.companyId);
  res.json({
    escalated, count: escalated.length,
    // Calls that are past target with nobody above them to tell.
    stalled, stalled_count: stalled.length,
  });
});

// ─── POST /andon — raise a help request ───────────────────────────────────────
// Accepts the legacy shape ({ type, title, … }), a function-team request
// ({ team, note, work_order_id, app_id, step_name, completion_id, … }) or a
// department request ({ target_type: 'department', department_id, … }). Raised
// from inside a run the context columns are filled; raised from the app shell
// they are simply absent — every one of them is nullable.

router.post('/', (req, res) => {
  const {
    team: rawTeam, type: rawType, target_type: rawTargetType,
    priority = 'normal', title = '', message = '', note = '',
    department_id, station_id, work_order_id, app_id, completion_id,
    step_name = '', created_by, operator_name,
  } = req.body;

  const team = TEAMS[rawTeam] ? rawTeam : null;
  const type = team ? TEAMS[team].type
    : (['help', 'quality', 'material', 'maintenance', 'safety'].includes(rawType) ? rawType : 'help');
  const resolvedTeam = team || TEAM_BY_TYPE[type] || 'supervisor';

  // Cross-tenant FK guards — a request may only point at this company's rows.
  const deptId = ownedOrNull('departments', department_id, req.companyId);
  const stationId = ownedOrNull('stations', station_id, req.companyId);
  const woId = ownedOrNull('work_orders', work_order_id, req.companyId);
  const appId = ownedOrNull('apps', app_id, req.companyId);
  const completionIdOwned = ownedOrNull('completions', completion_id, req.companyId);

  const station = stationId ? db.prepare('SELECT name FROM stations WHERE id = ?').get(stationId) : null;
  const dept = deptId ? db.prepare('SELECT name FROM departments WHERE id = ?').get(deptId) : null;

  // Alerting a whole department only counts when the department is really ours;
  // otherwise the request falls back to the function team it named.
  const targetType = rawTargetType === 'department' && dept ? 'department' : 'team';
  const targetLabel = targetType === 'department' ? dept.name : teamLabel(resolvedTeam);
  // A department alert's "where" is the station; naming the department twice
  // ("Assembly needed at Assembly") helps nobody.
  const where = targetType === 'department' ? (station?.name || '') : (station?.name || dept?.name || '');

  // A targeted request needs no typed title — who is needed plus where it came
  // from IS the title. Only a bare legacy request still requires one.
  const autoTitle = (team || targetType === 'department')
    ? `${targetLabel} needed${where ? ` at ${where}` : ''}`
    : '';
  const finalTitle = (title || '').trim() || autoTitle;
  if (!finalTitle) return res.status(400).json({ error: 'title required' });

  const finalPriority = ['normal', 'high', 'critical'].includes(priority) ? priority : 'normal';
  const body = (message || note || '').trim();
  const raisedBy = (operator_name || created_by || req.user?.display_name || '').trim();

  // Every call gets a clock at birth. respond_by is the instant the company's
  // own target for this team + priority runs out; the sweeper in
  // andonEscalation.js is what acts on it, and the board counts down to it.
  const { respond_by } = respondByFor(req.companyId, { type, team: resolvedTeam, priority: finalPriority });

  const id = uuidv4();
  db.prepare(`
    INSERT INTO andon_calls (
      id, company_id, type, team, target_type, priority, title, message, description,
      department_id, station_id, work_order_id, app_id, completion_id, step_name,
      created_by, created_by_user_id, raised_by, respond_by
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id, req.companyId, type, resolvedTeam, targetType, finalPriority, finalTitle, body, finalTitle,
    deptId, stationId, woId, appId, completionIdOwned, String(step_name || ''),
    raisedBy, req.user?.id || null, raisedBy, respond_by,
  );

  const call = getCall(id, req.companyId);
  logActivity(req.companyId, 'andon', id, `Help requested — ${targetLabel}: ${finalTitle}`, req.user?.display_name);
  publish(req.companyId, 'created', call);

  // Who was alerted leads the subject, so an email or SMS is actionable at a glance.
  const contextBits = [
    where && `at ${where}`,
    call.work_order_number && `WO ${call.work_order_number}`,
    call.app_name && call.step_name && `${call.app_name} · ${call.step_name}`,
  ].filter(Boolean).join(' · ');
  // Company-wide subscription (Settings → Notifications), unchanged.
  notify(req.companyId, 'andon.alert', {
    subject: `${targetLabel} alerted — ${finalTitle}`,
    body: `${targetLabel} has been alerted${raisedBy ? ` by ${raisedBy}` : ''}.\n${finalTitle}${contextBits ? `\n${contextBits}` : ''}${body ? `\nNote: ${body}` : ''}`,
  });
  // Per-person routing: the department's members for this team, else the
  // company's, else the company alert address. Emails them and drops a targeted
  // in-app message so the right people are pinged, not just the board.
  const routed = deliverAlert(req.companyId, call);
  deliverWebhooks(req.companyId, 'andon.alert', call);

  res.status(201).json({
    ...call,
    // Honest feedback for the raiser: who this actually reached.
    notified: routed.recipients
      .filter(r => r.user_id)
      .map(r => ({ user_id: r.user_id, display_name: r.display_name, team_role: r.team_role })),
    notify_scope: routed.scope,
  });
});

// ─── PUT /andon/:id/acknowledge — "On my way" ─────────────────────────────────

router.put('/:id/acknowledge', (req, res) => {
  const call = ownedCall(req);
  if (!call) return res.status(404).json({ error: 'Not found' });
  if (call.status !== 'open') return res.status(409).json({ error: 'Request is not open' });
  const now = new Date().toISOString();
  const responder = (req.body?.responder || req.user?.display_name || '').trim();
  db.prepare(`
    UPDATE andon_calls
    SET status = 'acknowledged', assigned_to = ?, acknowledged_by = ?,
        acknowledged_by_user_id = ?, acknowledged_at = ?
    WHERE id = ?
  `).run(responder, responder, req.user?.id || null, now, req.params.id);

  const updated = getCall(req.params.id, req.companyId);
  logActivity(req.companyId, 'andon', req.params.id, `On my way — ${updated.target_label} alert acknowledged`, req.user?.display_name);
  publish(req.companyId, 'acknowledged', updated);
  res.json(updated);
});

// ─── PUT /andon/:id/resolve ────────────────────────────────────────────────────

router.put('/:id/resolve', (req, res) => {
  const call = ownedCall(req);
  if (!call) return res.status(404).json({ error: 'Not found' });
  if (call.status === 'resolved') return res.status(409).json({ error: 'Already resolved' });
  const now = new Date().toISOString();
  const { resolution = '' } = req.body || {};
  const responder = (req.user?.display_name || '').trim();
  db.prepare(`
    UPDATE andon_calls
    SET status = 'resolved', resolution = ?, resolved_at = ?, resolved_by = ?, resolved_by_user_id = ?
    WHERE id = ?
  `).run(String(resolution || ''), now, responder, req.user?.id || null, req.params.id);

  const updated = getCall(req.params.id, req.companyId);
  logActivity(req.companyId, 'andon', req.params.id, `Help request resolved`, req.user?.display_name);
  publish(req.companyId, 'resolved', updated);
  res.json(updated);
});

// ─── PUT /andon/:id/cancel — the requester stood the alert down ──────────────
// Kept as a distinct action (rather than a delete) so the board keeps an honest
// record of who was alerted and why the request went away.

router.put('/:id/cancel', (req, res) => {
  const call = ownedCall(req);
  if (!call) return res.status(404).json({ error: 'Not found' });
  if (call.status === 'resolved') return res.status(409).json({ error: 'Already resolved' });
  const now = new Date().toISOString();
  const who = (req.body?.cancelled_by || req.user?.display_name || '').trim();
  const reason = (req.body?.reason || '').trim();
  db.prepare(`
    UPDATE andon_calls
    SET status = 'resolved', resolved_at = ?, resolved_by = ?, resolved_by_user_id = ?,
        resolution = ?
    WHERE id = ?
  `).run(
    now, who, req.user?.id || null,
    `Stood down${who ? ` by ${who}` : ''} — help no longer needed${reason ? `: ${reason}` : ''}`,
    req.params.id,
  );

  const updated = getCall(req.params.id, req.companyId);
  logActivity(req.companyId, 'andon', req.params.id, `Help request stood down`, req.user?.display_name);
  publish(req.companyId, 'cancelled', updated);
  res.json(updated);
});

// ─── DELETE /andon/:id ─────────────────────────────────────────────────────────

router.delete('/:id', (req, res) => {
  const call = ownedCall(req);
  if (!call) return res.status(404).json({ error: 'Not found' });
  db.prepare('DELETE FROM andon_calls WHERE id = ?').run(req.params.id);
  publish(req.companyId, 'deleted', { id: req.params.id });
  res.json({ ok: true });
});

module.exports = router;

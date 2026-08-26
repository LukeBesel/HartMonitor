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

const router = express.Router();

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
         CAST((julianday(a.resolved_at) - julianday(a.created_at)) * 86400 AS INTEGER) AS resolution_seconds
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
function decorate(row) {
  if (!row) return row;
  const team = teamOf(row);
  const targetType = row.target_type === 'department' && row.department_name ? 'department' : 'team';
  const targetLabel = targetType === 'department' ? row.department_name : teamLabel(team);
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
  };
}

function getCall(id, companyId) {
  return decorate(db.prepare(`${SELECT_CALL} WHERE a.id = ? AND a.company_id = ?`).get(id, companyId));
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
  res.json(db.prepare(sql).all(...params).map(decorate));
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

  res.json({
    open, critical, acknowledged, resolved_today, by_type, by_team,
    avg_response_seconds_today: respRow?.n ? Math.round(respRow.avg_s) : null,
    responded_today: respRow?.n ?? 0,
    // Echoed so a caller (and the board) can tell a scoped payload from a
    // plant-wide one without re-deriving it from its own state.
    department_id: deptId,
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

  const id = uuidv4();
  db.prepare(`
    INSERT INTO andon_calls (
      id, company_id, type, team, target_type, priority, title, message, description,
      department_id, station_id, work_order_id, app_id, completion_id, step_name,
      created_by, created_by_user_id, raised_by
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id, req.companyId, type, resolvedTeam, targetType, finalPriority, finalTitle, body, finalTitle,
    deptId, stationId, woId, appId, completionIdOwned, String(step_name || ''),
    raisedBy, req.user?.id || null, raisedBy,
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

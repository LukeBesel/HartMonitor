const express = require('express');
const { v4: uuidv4 } = require('uuid');
const db = require('../db');
const { TEAM_ROLES, isTeamRole } = require('../andonTeams');
// One definition of finished-today / running-now / average cycle / pass rate /
// on-track, shared with the Command Center, the department drill-down, the
// leaderboard and GET /api/floor. This list used to carry counts of its own that
// nothing else in the product agreed with.
const plantTruth = require('../plantTruth');

const router = express.Router();

/**
 * The canonical figures for one department, in the shape this list adds beside
 * its existing counts. Nothing renders them yet — wave 2 does — but they are on
 * the payload now so no screen has to compute them for itself again.
 */
function canonicalFields(snap) {
  return {
    plant_date:        snap.plant_date,
    finished_today:    snap.finished_today,
    running_now:       snap.running_now,
    avg_cycle_seconds: snap.avg_cycle_seconds,
    avg_cycle_basis:   snap.avg_cycle_basis,
    avg_cycle_sample:  snap.avg_cycle_sample,
    avg_cycle_reason:  snap.avg_cycle_reason,
    pass_rate:         snap.pass_rate,
    pass_rate_sample:  snap.pass_rate_sample,
    pass_rate_reason:  snap.pass_rate_reason,
    on_track:          snap.on_track,
    at_risk:           snap.at_risk,
    behind:            snap.behind,
    overdue:           snap.overdue,
    open_work_orders:  snap.open_work_orders,
    on_track_pct:      snap.on_track_pct,
    on_track_reason:   snap.on_track_reason,
    on_track_basis:    'open_work_orders',
  };
}

function deptCounts(deptId) {
  const woCount = db.prepare(
    `SELECT COUNT(*) as c FROM work_orders WHERE department_id = ? AND status != 'cancelled'`
  ).get(deptId).c;

  const completionCount = db.prepare(`
    SELECT COUNT(*) as c
    FROM completions c
    JOIN work_orders wo ON wo.id = c.work_order_id
    WHERE wo.department_id = ? AND c.status = 'completed'
  `).get(deptId).c;

  const activeCount = db.prepare(
    `SELECT COUNT(*) as c FROM work_orders WHERE department_id = ? AND status = 'in_progress'`
  ).get(deptId).c;

  const stationCount = db.prepare(
    `SELECT COUNT(*) as c FROM stations WHERE department_id = ?`
  ).get(deptId).c;

  return { work_order_count: woCount, completion_count: completionCount, active_work_orders: activeCount, station_count: stationCount };
}

// ─── GET / - list departments with work order and completion counts ────────────

router.get('/', (req, res) => {
  let sql = 'SELECT * FROM departments WHERE company_id = ?';
  const params = [req.companyId];
  // Unassigned records (site_id IS NULL) belong to the whole company, so they
  // stay visible under every site — otherwise picking a site empties the page
  // for the (very common) company that never assigned its departments to one.
  if (req.query.site_id) { sql += ' AND (site_id = ? OR site_id IS NULL)'; params.push(req.query.site_id); }
  sql += ' ORDER BY name';
  const depts = db.prepare(sql).all(...params);

  // Every department's live figures in ONE query set, not one set per card.
  const snapshots = plantTruth.departmentSnapshots(req.companyId, { siteId: req.query.site_id });
  const byId = Object.fromEntries(snapshots.departments.map(d => [d.department_id, d]));

  res.json(depts.map(dept => ({
    ...dept,
    ...deptCounts(dept.id),
    ...(byId[dept.id] ? canonicalFields(byId[dept.id]) : {}),
  })));
});

// ─── POST / - create department ──────────────────────────────────────────────

router.post('/', (req, res) => {
  const {
    name,
    description   = '',
    manager_name  = '',
    color         = '#3b82f6',
    headcount     = 0,
    site_id       = null,
  } = req.body;

  if (!name) return res.status(400).json({ error: 'name is required' });

  const dup = db.prepare('SELECT id FROM departments WHERE company_id = ? AND LOWER(name) = LOWER(?)').get(req.companyId, name);
  if (dup) return res.status(409).json({ error: 'duplicate_name', message: `A department named "${name}" already exists` });

  const id = uuidv4();
  db.prepare(`INSERT INTO departments (id, name, description, manager_name, color, headcount, site_id, company_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(id, name, description, manager_name, color, Math.max(0, parseInt(headcount) || 0), site_id || null, req.companyId);

  const dept = db.prepare('SELECT * FROM departments WHERE id = ?').get(id);
  res.status(201).json({
    ...dept, work_order_count: 0, completion_count: 0, active_work_orders: 0,
    ...canonicalFields(plantTruth.floorSnapshot(req.companyId, { departmentId: id })),
  });
});

// ─── PUT /:id - update department ────────────────────────────────────────────

router.put('/:id', (req, res) => {
  const dept = db.prepare('SELECT * FROM departments WHERE id = ? AND company_id = ?').get(req.params.id, req.companyId);
  if (!dept) return res.status(404).json({ error: 'Department not found' });

  if (req.body.name !== undefined && req.body.name !== dept.name) {
    const dup = db.prepare('SELECT id FROM departments WHERE company_id = ? AND LOWER(name) = LOWER(?) AND id != ?').get(req.companyId, req.body.name, req.params.id);
    if (dup) return res.status(409).json({ error: 'duplicate_name', message: `A department named "${req.body.name}" already exists` });
  }

  const updates = {
    name:         req.body.name         !== undefined ? req.body.name         : dept.name,
    description:  req.body.description  !== undefined ? req.body.description  : dept.description,
    manager_name: req.body.manager_name !== undefined ? req.body.manager_name : dept.manager_name,
    color:        req.body.color        !== undefined ? req.body.color        : dept.color,
    headcount:    req.body.headcount    !== undefined ? Math.max(0, parseInt(req.body.headcount) || 0) : (dept.headcount || 0),
    site_id:      req.body.site_id      !== undefined ? (req.body.site_id || null) : dept.site_id,
  };

  db.prepare(`UPDATE departments SET name=?, description=?, manager_name=?, color=?, headcount=?, site_id=? WHERE id=?`)
    .run(updates.name, updates.description, updates.manager_name, updates.color, updates.headcount, updates.site_id, req.params.id);

  const updated = db.prepare('SELECT * FROM departments WHERE id = ?').get(req.params.id);
  res.json({
    ...updated,
    ...deptCounts(req.params.id),
    ...canonicalFields(plantTruth.floorSnapshot(req.companyId, { departmentId: req.params.id })),
  });
});

// ─── Department members — who gets this department's Andon alerts ────────────
// A person can belong to several departments with a different role in each.
// `team_role` shares its vocabulary with the alert teams, so routing an alert
// is a direct lookup (see andonRouting.js).

const SELECT_MEMBER = `
  SELECT dm.id, dm.department_id, dm.user_id, dm.team_role,
         dm.notify_email, dm.notify_in_app, dm.created_at,
         u.display_name, u.email, u.role, u.job_title, u.is_active,
         d.name AS department_name
  FROM department_members dm
  JOIN users u ON u.id = dm.user_id
  LEFT JOIN departments d ON d.id = dm.department_id
`;

function shapeMember(row) {
  return row && { ...row, notify_email: !!row.notify_email, notify_in_app: !!row.notify_in_app, is_active: !!row.is_active };
}

function ownedDepartment(req, id) {
  return db.prepare('SELECT * FROM departments WHERE id = ? AND company_id = ?').get(id, req.companyId) || null;
}

// GET /departments/members?team_role=quality — routing lookups across the company.
// Declared before /:id/... so "members" is never read as a department id.
router.get('/members', (req, res) => {
  let sql = `${SELECT_MEMBER} WHERE dm.company_id = ?`;
  const params = [req.companyId];
  if (req.query.team_role) { sql += ' AND dm.team_role = ?'; params.push(req.query.team_role); }
  if (req.query.user_id)   { sql += ' AND dm.user_id = ?';   params.push(req.query.user_id); }
  if (req.query.active_only === 'true') sql += ' AND u.is_active = 1';
  sql += ' ORDER BY d.name, u.display_name';
  res.json(db.prepare(sql).all(...params).map(shapeMember));
});

// GET /departments/:id/members
router.get('/:id/members', (req, res) => {
  if (!ownedDepartment(req, req.params.id)) return res.status(404).json({ error: 'Department not found' });
  const rows = db.prepare(`${SELECT_MEMBER} WHERE dm.company_id = ? AND dm.department_id = ? ORDER BY u.display_name`)
    .all(req.companyId, req.params.id);
  res.json(rows.map(shapeMember));
});

// POST /departments/:id/members — add a teammate to this department
router.post('/:id/members', (req, res) => {
  if (!ownedDepartment(req, req.params.id)) return res.status(404).json({ error: 'Department not found' });
  const { user_id, team_role = 'operator', notify_email = true, notify_in_app = true } = req.body;
  if (!user_id) return res.status(400).json({ error: 'user_id is required' });
  if (!isTeamRole(team_role)) {
    return res.status(400).json({ error: 'invalid_team_role', message: `team_role must be one of: ${TEAM_ROLES.join(', ')}` });
  }
  // Cross-tenant guard: only this company's people can join its departments.
  const user = db.prepare('SELECT id FROM users WHERE id = ? AND company_id = ?').get(user_id, req.companyId);
  if (!user) return res.status(400).json({ error: 'Unknown teammate' });

  const dup = db.prepare('SELECT id FROM department_members WHERE company_id = ? AND department_id = ? AND user_id = ?')
    .get(req.companyId, req.params.id, user_id);
  if (dup) return res.status(409).json({ error: 'duplicate_member', message: 'They are already on this department' });

  const id = uuidv4();
  db.prepare(`
    INSERT INTO department_members (id, company_id, department_id, user_id, team_role, notify_email, notify_in_app)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(id, req.companyId, req.params.id, user_id, team_role, notify_email ? 1 : 0, notify_in_app ? 1 : 0);

  res.status(201).json(shapeMember(db.prepare(`${SELECT_MEMBER} WHERE dm.id = ?`).get(id)));
});

// PUT /departments/members/:memberId — change a role or the notify preferences
router.put('/members/:memberId', (req, res) => {
  const member = db.prepare('SELECT * FROM department_members WHERE id = ? AND company_id = ?')
    .get(req.params.memberId, req.companyId);
  if (!member) return res.status(404).json({ error: 'Member not found' });

  const teamRole = req.body.team_role !== undefined ? req.body.team_role : member.team_role;
  if (!isTeamRole(teamRole)) {
    return res.status(400).json({ error: 'invalid_team_role', message: `team_role must be one of: ${TEAM_ROLES.join(', ')}` });
  }
  const notifyEmail = req.body.notify_email !== undefined ? (req.body.notify_email ? 1 : 0) : member.notify_email;
  const notifyInApp = req.body.notify_in_app !== undefined ? (req.body.notify_in_app ? 1 : 0) : member.notify_in_app;

  db.prepare('UPDATE department_members SET team_role = ?, notify_email = ?, notify_in_app = ? WHERE id = ?')
    .run(teamRole, notifyEmail, notifyInApp, req.params.memberId);

  res.json(shapeMember(db.prepare(`${SELECT_MEMBER} WHERE dm.id = ?`).get(req.params.memberId)));
});

// DELETE /departments/members/:memberId
router.delete('/members/:memberId', (req, res) => {
  const member = db.prepare('SELECT id FROM department_members WHERE id = ? AND company_id = ?')
    .get(req.params.memberId, req.companyId);
  if (!member) return res.status(404).json({ error: 'Member not found' });
  db.prepare('DELETE FROM department_members WHERE id = ?').run(req.params.memberId);
  res.json({ success: true });
});

// ─── DELETE /:id ──────────────────────────────────────────────────────────────

router.delete('/:id', (req, res) => {
  const dept = db.prepare('SELECT id FROM departments WHERE id = ? AND company_id = ?').get(req.params.id, req.companyId);
  if (!dept) return res.status(404).json({ error: 'Department not found' });
  db.prepare('DELETE FROM departments WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

module.exports = router;

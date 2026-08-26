'use strict';
// ─── CI Projects ──────────────────────────────────────────────────────────────
// A Kaizen idea is where improvement work STARTS. A CI project is where it gets
// executed: an owner, a department, a window, a savings target, and a task list
// that drives the Gantt chart on the Projects screen.
//
// Two rules this file exists to hold:
//   • the stored vocabulary is the ONLY vocabulary. PROJECT_STATUSES and
//     TASK_STATUSES below are exactly the CHECK constraints in db.js; a word
//     outside them is rejected with a 400 here rather than reaching SQLite and
//     coming back as an opaque 500.
//   • a project's progress is a ROLLUP, never a default. A project with no tasks
//     has `progress: null` and `task_count: 0` — the screen renders "—" and says
//     why. Sending 0 would be inventing a number.

const express = require('express');
const { v4: uuidv4 } = require('uuid');
const db = require('../db');
const { logActivity } = require('../activity');
const { buildUpdate, nextValue } = require('../patch');

const router = express.Router();

// Exactly the CHECK constraint on ci_projects.status.
const PROJECT_STATUSES = ['planning', 'active', 'on_hold', 'complete', 'cancelled'];
// Exactly the CHECK constraint on ci_project_tasks.status.
const TASK_STATUSES = ['not_started', 'in_progress', 'blocked', 'done'];

// Columns PUT /ci-projects/:id may write. Everything else on the row (id,
// number, company_id, created_by, timestamps) belongs to the server.
const PROJECT_EDITABLE = [
  'name', 'description', 'status', 'department_id', 'owner_name',
  'kaizen_idea_id', 'start_date', 'target_date',
  'estimated_savings', 'actual_savings',
];

const TASK_EDITABLE = [
  'name', 'status', 'assignee_name', 'start_date', 'end_date',
  'progress', 'depends_on', 'sort_order',
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function nextProjectNumber(companyId) {
  const year = new Date().getFullYear();
  const prefix = `CIP-${year}-`;
  // NUMERIC max of the trailing sequence. A lexical `ORDER BY number DESC`
  // reads "CIP-2026-999" as larger than "CIP-2026-1000" and re-mints 1000
  // forever; this repo has fixed that class everywhere and must not reintroduce it.
  const row = db.prepare(
    'SELECT MAX(CAST(substr(number, ?) AS INTEGER)) AS max_seq FROM ci_projects WHERE company_id = ? AND number LIKE ?'
  ).get(prefix.length + 1, companyId, prefix + '%');
  const last = row && row.max_seq ? row.max_seq : 0;
  return `${prefix}${String(last + 1).padStart(3, '0')}`;
}

/** The rollup subquery every project read shares. Bind companyId once. */
const TASK_ROLLUP = `
  LEFT JOIN (
    SELECT project_id,
           COUNT(*) AS task_count,
           SUM(CASE WHEN status = 'done'    THEN 1 ELSE 0 END) AS done_count,
           SUM(CASE WHEN status = 'blocked' THEN 1 ELSE 0 END) AS blocked_count,
           AVG(progress) AS avg_progress,
           MIN(start_date) AS first_task_start,
           MAX(end_date)   AS last_task_end
    FROM ci_project_tasks
    WHERE company_id = ?
    GROUP BY project_id
  ) t ON t.project_id = p.id
`;

const PROJECT_SELECT = `
  SELECT p.*,
         d.name AS department_name,
         COALESCE(k.idea_number, k.number) AS kaizen_idea_number,
         k.title AS kaizen_idea_title,
         t.task_count, t.done_count, t.blocked_count,
         t.avg_progress, t.first_task_start, t.last_task_end
  FROM ci_projects p
  LEFT JOIN departments  d ON d.id = p.department_id
  LEFT JOIN kaizen_ideas k ON k.id = p.kaizen_idea_id AND k.company_id = p.company_id
  ${TASK_ROLLUP}
`;

/**
 * Shape a raw project row for the wire. `progress` is null — not 0 — when the
 * project has no tasks, because a project nobody has planned yet has no percent
 * complete to report.
 */
function shapeProject(row) {
  if (!row) return null;
  const taskCount = row.task_count || 0;
  const { avg_progress, ...rest } = row;
  return {
    ...rest,
    task_count: taskCount,
    done_count: row.done_count || 0,
    blocked_count: row.blocked_count || 0,
    progress: taskCount > 0 ? Math.round(avg_progress) : null,
  };
}

function projectById(id, companyId) {
  const row = db.prepare(`${PROJECT_SELECT} WHERE p.id = ? AND p.company_id = ?`)
    .get(companyId, id, companyId);
  return shapeProject(row);
}

/** The bare row, for guards — no joins, no rollup. */
function ownedProject(id, companyId) {
  return db.prepare('SELECT * FROM ci_projects WHERE id = ? AND company_id = ?').get(id, companyId) || null;
}

function ownedTask(taskId, projectId, companyId) {
  return db.prepare('SELECT * FROM ci_project_tasks WHERE id = ? AND project_id = ? AND company_id = ?')
    .get(taskId, projectId, companyId) || null;
}

function tasksOf(projectId, companyId) {
  return db.prepare(`
    SELECT t.*, dep.name AS depends_on_name
    FROM ci_project_tasks t
    LEFT JOIN ci_project_tasks dep ON dep.id = t.depends_on AND dep.company_id = t.company_id
    WHERE t.project_id = ? AND t.company_id = ?
    ORDER BY t.sort_order, t.created_at
  `).all(projectId, companyId);
}

/**
 * Validate every client-supplied foreign key and enum the body mentions.
 * Returns an error string, or null when the body is safe to write.
 * Absent keys are not checked — a PATCH-shaped body only owns what it names.
 */
function validateProjectBody(body, companyId) {
  const has = (k) => Object.prototype.hasOwnProperty.call(body, k);

  if (has('status') && body.status != null && body.status !== '' && !PROJECT_STATUSES.includes(body.status)) {
    return `status must be one of: ${PROJECT_STATUSES.join(', ')}`;
  }
  if (has('department_id') && body.department_id) {
    const dept = db.prepare('SELECT id FROM departments WHERE id = ? AND company_id = ?')
      .get(body.department_id, companyId);
    if (!dept) return 'department_id not found';
  }
  if (has('kaizen_idea_id') && body.kaizen_idea_id) {
    const idea = db.prepare('SELECT id FROM kaizen_ideas WHERE id = ? AND company_id = ?')
      .get(body.kaizen_idea_id, companyId);
    if (!idea) return 'kaizen_idea_id not found';
  }
  return null;
}

function validateTaskBody(body, projectId, companyId, selfId) {
  const has = (k) => Object.prototype.hasOwnProperty.call(body, k);

  if (has('status') && body.status != null && body.status !== '' && !TASK_STATUSES.includes(body.status)) {
    return `status must be one of: ${TASK_STATUSES.join(', ')}`;
  }
  if (has('progress') && body.progress != null && body.progress !== '') {
    const n = Number(body.progress);
    if (!Number.isFinite(n) || n < 0 || n > 100) return 'progress must be between 0 and 100';
  }
  if (has('depends_on') && body.depends_on) {
    if (selfId && body.depends_on === selfId) return 'a task cannot depend on itself';
    // Finish-to-start only, and only inside the same project — a dependency on
    // another tenant's task would leak the fact that it exists.
    const dep = ownedTask(body.depends_on, projectId, companyId);
    if (!dep) return 'depends_on not found in this project';
  }
  return null;
}

// ─── GET /ci-projects ─────────────────────────────────────────────────────────

router.get('/', (req, res) => {
  const { status, department_id, kaizen_idea_id, search } = req.query;
  let sql = `${PROJECT_SELECT} WHERE p.company_id = ?`;
  const params = [req.companyId, req.companyId];
  if (status) {
    if (!PROJECT_STATUSES.includes(status)) {
      return res.status(400).json({ error: `status must be one of: ${PROJECT_STATUSES.join(', ')}` });
    }
    sql += ' AND p.status = ?'; params.push(status);
  }
  if (department_id)  { sql += ' AND p.department_id = ?';  params.push(department_id); }
  if (kaizen_idea_id) { sql += ' AND p.kaizen_idea_id = ?'; params.push(kaizen_idea_id); }
  if (search) {
    sql += ' AND (p.name LIKE ? OR p.number LIKE ? OR p.owner_name LIKE ?)';
    params.push(`%${search}%`, `%${search}%`, `%${search}%`);
  }
  sql += ' ORDER BY p.created_at DESC';
  res.json(db.prepare(sql).all(...params).map(shapeProject));
});

// ─── GET /ci-projects/summary ─────────────────────────────────────────────────
// Registered before /:id so "summary" is never read as a project id.

router.get('/summary', (req, res) => {
  const counts = Object.fromEntries(PROJECT_STATUSES.map(s => [s, 0]));
  for (const row of db.prepare('SELECT status, COUNT(*) AS n FROM ci_projects WHERE company_id = ? GROUP BY status').all(req.companyId)) {
    if (Object.prototype.hasOwnProperty.call(counts, row.status)) counts[row.status] = row.n;
  }
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  const savings = db.prepare(`
    SELECT SUM(estimated_savings) AS est, SUM(CASE WHEN status = 'complete' THEN actual_savings ELSE 0 END) AS act
    FROM ci_projects WHERE company_id = ?
  `).get(req.companyId);
  const overdue = db.prepare(`
    SELECT COUNT(*) AS n FROM ci_projects
    WHERE company_id = ? AND target_date IS NOT NULL AND target_date < date('now')
      AND status IN ('planning','active','on_hold')
  `).get(req.companyId).n;
  const from_ideas = db.prepare('SELECT COUNT(*) AS n FROM ci_projects WHERE company_id = ? AND kaizen_idea_id IS NOT NULL').get(req.companyId).n;

  res.json({
    total,
    by_status: counts,
    active: counts.active,
    complete: counts.complete,
    overdue,
    from_ideas,
    estimated_savings: savings.est || 0,
    actual_savings: savings.act || 0,
  });
});

// ─── GET /ci-projects/:id ─────────────────────────────────────────────────────

router.get('/:id', (req, res) => {
  const project = projectById(req.params.id, req.companyId);
  if (!project) return res.status(404).json({ error: 'Not found' });
  res.json({ ...project, tasks: tasksOf(req.params.id, req.companyId) });
});

// ─── POST /ci-projects ────────────────────────────────────────────────────────

router.post('/', (req, res) => {
  const {
    name, description = '', status = 'planning', department_id, owner_name = '',
    kaizen_idea_id, start_date, target_date, estimated_savings = 0, actual_savings = 0,
  } = req.body || {};

  if (!name || !String(name).trim()) return res.status(400).json({ error: 'name required' });
  const invalid = validateProjectBody(req.body || {}, req.companyId);
  if (invalid) return res.status(400).json({ error: invalid });
  if (!PROJECT_STATUSES.includes(status)) {
    return res.status(400).json({ error: `status must be one of: ${PROJECT_STATUSES.join(', ')}` });
  }

  const id = uuidv4();
  const number = nextProjectNumber(req.companyId);
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO ci_projects (
      id, company_id, number, name, description, status, department_id, owner_name,
      kaizen_idea_id, start_date, target_date, completed_at, estimated_savings,
      actual_savings, created_by, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id, req.companyId, number, String(name).trim(), description, status,
    department_id || null, owner_name, kaizen_idea_id || null,
    start_date || null, target_date || null,
    status === 'complete' ? now : null,
    Number(estimated_savings) || 0, Number(actual_savings) || 0,
    req.user?.display_name || '', now, now,
  );

  logActivity(req.companyId, 'ci_project', id, `CI project ${number} created: ${String(name).trim()}`, req.user?.display_name, { department_id: department_id || null });
  res.status(201).json({ ...projectById(id, req.companyId), tasks: [] });
});

// ─── PUT /ci-projects/:id ─────────────────────────────────────────────────────

router.put('/:id', (req, res) => {
  const existing = ownedProject(req.params.id, req.companyId);
  if (!existing) return res.status(404).json({ error: 'Not found' });

  const body = req.body || {};
  const invalid = validateProjectBody(body, req.companyId);
  if (invalid) return res.status(400).json({ error: invalid });

  const { sql, params } = buildUpdate(body, PROJECT_EDITABLE);
  const status = nextValue(body, 'status', existing.status);
  // Stamp completion the first time it lands on 'complete', and clear it when
  // the project is reopened — otherwise a reopened project reads as finished.
  let completed_at = existing.completed_at;
  if (status === 'complete' && existing.status !== 'complete') completed_at = new Date().toISOString();
  else if (status !== 'complete') completed_at = null;

  const now = new Date().toISOString();
  db.prepare(`UPDATE ci_projects SET ${sql ? sql + ', ' : ''}completed_at = ?, updated_at = ? WHERE id = ? AND company_id = ?`)
    .run(...params, completed_at, now, req.params.id, req.companyId);

  if (status !== existing.status) {
    logActivity(req.companyId, 'ci_project', req.params.id, `CI project ${existing.number} → ${status}`, req.user?.display_name);
  }
  res.json({ ...projectById(req.params.id, req.companyId), tasks: tasksOf(req.params.id, req.companyId) });
});

// ─── DELETE /ci-projects/:id ──────────────────────────────────────────────────

router.delete('/:id', (req, res) => {
  const existing = ownedProject(req.params.id, req.companyId);
  if (!existing) return res.status(404).json({ error: 'Not found' });
  // Tasks cascade with the project (FK ON DELETE CASCADE), but foreign keys are
  // not guaranteed to be on for every connection — delete them explicitly so a
  // project can never leave orphaned tasks behind.
  db.prepare('DELETE FROM ci_project_tasks WHERE project_id = ? AND company_id = ?').run(req.params.id, req.companyId);
  db.prepare('DELETE FROM ci_projects WHERE id = ? AND company_id = ?').run(req.params.id, req.companyId);
  res.json({ ok: true });
});

// ─── GET /ci-projects/:id/tasks ───────────────────────────────────────────────

router.get('/:id/tasks', (req, res) => {
  if (!ownedProject(req.params.id, req.companyId)) return res.status(404).json({ error: 'Not found' });
  res.json(tasksOf(req.params.id, req.companyId));
});

// ─── POST /ci-projects/:id/tasks ──────────────────────────────────────────────

router.post('/:id/tasks', (req, res) => {
  const project = ownedProject(req.params.id, req.companyId);
  if (!project) return res.status(404).json({ error: 'Not found' });

  const body = req.body || {};
  const {
    name, status = 'not_started', assignee_name = '', start_date, end_date,
    progress = 0, depends_on, sort_order,
  } = body;
  if (!name || !String(name).trim()) return res.status(400).json({ error: 'name required' });
  const invalid = validateTaskBody(body, req.params.id, req.companyId, null);
  if (invalid) return res.status(400).json({ error: invalid });
  if (!TASK_STATUSES.includes(status)) {
    return res.status(400).json({ error: `status must be one of: ${TASK_STATUSES.join(', ')}` });
  }

  const id = uuidv4();
  const now = new Date().toISOString();
  const order = Number.isFinite(Number(sort_order))
    ? Number(sort_order)
    : (db.prepare('SELECT COALESCE(MAX(sort_order), -1) + 1 AS n FROM ci_project_tasks WHERE project_id = ? AND company_id = ?')
        .get(req.params.id, req.companyId).n);

  db.prepare(`
    INSERT INTO ci_project_tasks (
      id, company_id, project_id, name, status, assignee_name,
      start_date, end_date, progress, depends_on, sort_order, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id, req.companyId, req.params.id, String(name).trim(), status, assignee_name,
    start_date || null, end_date || null,
    // 'done' with a progress nobody set means 100 — a finished task at 0% would
    // drag the project rollup down and read as a lie on the Gantt bar.
    status === 'done' && (progress === 0 || progress == null) ? 100 : Math.round(Number(progress) || 0),
    depends_on || null, order, now, now,
  );

  res.status(201).json(db.prepare('SELECT * FROM ci_project_tasks WHERE id = ?').get(id));
});

// ─── PUT /ci-projects/:id/tasks/:taskId ───────────────────────────────────────

router.put('/:id/tasks/:taskId', (req, res) => {
  if (!ownedProject(req.params.id, req.companyId)) return res.status(404).json({ error: 'Not found' });
  const task = ownedTask(req.params.taskId, req.params.id, req.companyId);
  if (!task) return res.status(404).json({ error: 'Not found' });

  const body = req.body || {};
  const invalid = validateTaskBody(body, req.params.id, req.companyId, req.params.taskId);
  if (invalid) return res.status(400).json({ error: invalid });

  const { sql, params } = buildUpdate(body, TASK_EDITABLE);
  const status = nextValue(body, 'status', task.status);
  const progressNamed = Object.prototype.hasOwnProperty.call(body, 'progress');
  const now = new Date().toISOString();

  db.prepare(`UPDATE ci_project_tasks SET ${sql ? sql + ', ' : ''}updated_at = ? WHERE id = ? AND company_id = ?`)
    .run(...params, now, req.params.taskId, req.companyId);

  // Marking a task done without touching the slider means done — 100%. The
  // reverse holds too: dragging progress to 100 does not silently close a task
  // the planner still considers open, so status is left alone there.
  if (status === 'done' && !progressNamed) {
    db.prepare('UPDATE ci_project_tasks SET progress = 100 WHERE id = ? AND company_id = ?').run(req.params.taskId, req.companyId);
  }

  res.json(db.prepare('SELECT * FROM ci_project_tasks WHERE id = ? AND company_id = ?').get(req.params.taskId, req.companyId));
});

// ─── DELETE /ci-projects/:id/tasks/:taskId ────────────────────────────────────

router.delete('/:id/tasks/:taskId', (req, res) => {
  if (!ownedProject(req.params.id, req.companyId)) return res.status(404).json({ error: 'Not found' });
  if (!ownedTask(req.params.taskId, req.params.id, req.companyId)) return res.status(404).json({ error: 'Not found' });
  // Anything that depended on this task loses its predecessor rather than
  // pointing at a task that no longer exists.
  db.prepare('UPDATE ci_project_tasks SET depends_on = NULL WHERE depends_on = ? AND company_id = ?').run(req.params.taskId, req.companyId);
  db.prepare('DELETE FROM ci_project_tasks WHERE id = ? AND company_id = ?').run(req.params.taskId, req.companyId);
  res.json({ ok: true });
});

module.exports = router;
module.exports.PROJECT_STATUSES = PROJECT_STATUSES;
module.exports.TASK_STATUSES = TASK_STATUSES;

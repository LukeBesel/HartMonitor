const express = require('express');
const { v4: uuidv4 } = require('uuid');
const db = require('../db');

const router = express.Router();

// ─── GET /summary ─────────────────────────────────────────────────────────────

router.get('/summary', (req, res) => {
  const cid = req.companyId;

  // Operators + supervisors count
  const total_operators = db.prepare(
    `SELECT COUNT(*) as c FROM users WHERE company_id = ? AND role IN ('operator','supervisor') AND is_active = 1`
  ).get(cid).c;

  // Total certified training records
  const certified_count = db.prepare(
    `SELECT COUNT(*) as c FROM training_records WHERE company_id = ? AND status = 'certified'`
  ).get(cid).c;

  // Active apps count for coverage denominator
  const active_apps = db.prepare(
    `SELECT COUNT(*) as c FROM apps WHERE company_id = ? AND status = 'published'`
  ).get(cid).c;

  const total_possible = total_operators * active_apps;
  const coverage_pct = total_possible > 0
    ? Math.round((certified_count / total_possible) * 100 * 10) / 10
    : 0;

  // Records expiring within 30 days (training_records + certifications)
  const expiring_tr = db.prepare(
    `SELECT COUNT(*) as c FROM training_records
     WHERE company_id = ? AND expiry_date IS NOT NULL
       AND date(expiry_date) BETWEEN date('now') AND date('now', '+30 days')`
  ).get(cid).c;

  const expiring_cert = db.prepare(
    `SELECT COUNT(*) as c FROM certifications
     WHERE company_id = ? AND expiry_date IS NOT NULL
       AND date(expiry_date) BETWEEN date('now') AND date('now', '+30 days')`
  ).get(cid).c;

  const expiring_soon = expiring_tr + expiring_cert;

  // Overdue training plans
  const overdue_plans = db.prepare(
    `SELECT COUNT(*) as c FROM training_plans
     WHERE company_id = ? AND status IN ('pending','in_progress')
       AND target_date IS NOT NULL AND date(target_date) < date('now')`
  ).get(cid).c;

  // Uncertified operators: operators who have fewer certified apps than total active apps
  const operators = db.prepare(
    `SELECT u.id, u.display_name FROM users u
     WHERE u.company_id = ? AND u.role IN ('operator','supervisor') AND u.is_active = 1`
  ).all(cid);

  const uncertified_operators = operators.map(op => {
    const certified_apps = db.prepare(
      `SELECT COUNT(*) as c FROM training_records
       WHERE company_id = ? AND user_id = ? AND status = 'certified'`
    ).get(cid, op.id).c;
    return { id: op.id, display_name: op.display_name, certified_apps, total_apps: active_apps };
  }).filter(op => op.certified_apps < op.total_apps);

  // Department coverage
  const departments = db.prepare(
    `SELECT id, name FROM departments WHERE company_id = ?`
  ).all(cid);

  const department_coverage = departments.map(dept => {
    const operator_count = db.prepare(
      `SELECT COUNT(*) as c FROM users WHERE company_id = ? AND department_id = ? AND role IN ('operator','supervisor') AND is_active = 1`
    ).get(cid, dept.id).c;
    const dept_certified = db.prepare(
      `SELECT COUNT(*) as c FROM training_records tr
       JOIN users u ON u.id = tr.user_id
       WHERE tr.company_id = ? AND u.department_id = ? AND tr.status = 'certified'`
    ).get(cid, dept.id).c;
    const dept_possible = operator_count * active_apps;
    const dept_coverage_pct = dept_possible > 0
      ? Math.round((dept_certified / dept_possible) * 100 * 10) / 10
      : 0;
    return { id: dept.id, name: dept.name, operator_count, coverage_pct: dept_coverage_pct };
  });

  res.json({
    total_operators,
    certified_count,
    total_possible,
    coverage_pct,
    expiring_soon,
    overdue_plans,
    uncertified_operators,
    department_coverage,
  });
});

// ─── GET /matrix ──────────────────────────────────────────────────────────────

router.get('/matrix', (req, res) => {
  const cid = req.companyId;
  const { department_id } = req.query;

  let opSql = `SELECT u.id, u.display_name, u.email, u.role, u.department_id, d.name as department_name
               FROM users u
               LEFT JOIN departments d ON d.id = u.department_id
               WHERE u.company_id = ? AND u.role IN ('operator','supervisor') AND u.is_active = 1`;
  const opParams = [cid];
  if (department_id) { opSql += ' AND u.department_id = ?'; opParams.push(department_id); }
  opSql += ' ORDER BY u.display_name';

  const operators = db.prepare(opSql).all(...opParams);

  let appSql = `SELECT id, name, category, department_id FROM apps WHERE company_id = ? AND status = 'published'`;
  const appParams = [cid];
  if (department_id) { appSql += ' AND (department_id = ? OR department_id IS NULL)'; appParams.push(department_id); }
  appSql += ' ORDER BY category, name';

  const apps = db.prepare(appSql).all(...appParams);

  const records = db.prepare(
    `SELECT tr.user_id, tr.app_id, tr.status, tr.certified_date, tr.expiry_date, tr.score
     FROM training_records tr WHERE tr.company_id = ?`
  ).all(cid);

  res.json({ operators, apps, records });
});

// ─── GET /records ─────────────────────────────────────────────────────────────

router.get('/records', (req, res) => {
  const cid = req.companyId;
  const { user_id, app_id, status } = req.query;

  let sql = `
    SELECT tr.*, u.display_name, a.name as app_name
    FROM training_records tr
    JOIN users u ON u.id = tr.user_id
    JOIN apps a ON a.id = tr.app_id
    WHERE tr.company_id = ?
  `;
  const params = [cid];

  if (user_id)  { sql += ' AND tr.user_id = ?'; params.push(user_id); }
  if (app_id)   { sql += ' AND tr.app_id = ?';  params.push(app_id); }
  if (status)   { sql += ' AND tr.status = ?';  params.push(status); }

  sql += ' ORDER BY u.display_name, a.name';

  res.json(db.prepare(sql).all(...params));
});

// ─── POST /records ────────────────────────────────────────────────────────────

router.post('/records', (req, res) => {
  const cid = req.companyId;
  const { user_id, app_id, status = 'not_started', certified_date, expiry_date, score, notes = '' } = req.body;

  if (!user_id || !app_id) return res.status(400).json({ error: 'user_id and app_id required' });

  const existing = db.prepare(
    'SELECT id FROM training_records WHERE company_id = ? AND user_id = ? AND app_id = ?'
  ).get(cid, user_id, app_id);

  if (existing) {
    // Update existing record
    db.prepare(`
      UPDATE training_records
      SET status = ?, certified_date = ?, expiry_date = ?, score = ?, notes = ?,
          attempts = attempts + 1, updated_at = datetime('now')
      WHERE id = ?
    `).run(status, certified_date || null, expiry_date || null, score ?? null, notes, existing.id);

    return res.json(db.prepare(`
      SELECT tr.*, u.display_name, a.name as app_name
      FROM training_records tr JOIN users u ON u.id = tr.user_id JOIN apps a ON a.id = tr.app_id
      WHERE tr.id = ?
    `).get(existing.id));
  }

  const id = uuidv4();
  db.prepare(`
    INSERT INTO training_records (id, company_id, user_id, app_id, status, certified_date, expiry_date, score, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, cid, user_id, app_id, status, certified_date || null, expiry_date || null, score ?? null, notes);

  res.status(201).json(db.prepare(`
    SELECT tr.*, u.display_name, a.name as app_name
    FROM training_records tr JOIN users u ON u.id = tr.user_id JOIN apps a ON a.id = tr.app_id
    WHERE tr.id = ?
  `).get(id));
});

// ─── PUT /records/:id ─────────────────────────────────────────────────────────

router.put('/records/:id', (req, res) => {
  const cid = req.companyId;
  const rec = db.prepare('SELECT id FROM training_records WHERE id = ? AND company_id = ?').get(req.params.id, cid);
  if (!rec) return res.status(404).json({ error: 'Not found' });

  const fields = ['status', 'certified_date', 'expiry_date', 'certified_by', 'score', 'attempts', 'notes'];
  const updates = {};
  for (const f of fields) if (req.body[f] !== undefined) updates[f] = req.body[f];

  if (Object.keys(updates).length > 0) {
    const sets = Object.keys(updates).map(k => `${k} = ?`).join(', ');
    db.prepare(`UPDATE training_records SET ${sets}, updated_at = datetime('now') WHERE id = ?`)
      .run(...Object.values(updates), req.params.id);
  }

  res.json(db.prepare(`
    SELECT tr.*, u.display_name, a.name as app_name
    FROM training_records tr JOIN users u ON u.id = tr.user_id JOIN apps a ON a.id = tr.app_id
    WHERE tr.id = ?
  `).get(req.params.id));
});

// ─── DELETE /records/:id ──────────────────────────────────────────────────────

router.delete('/records/:id', (req, res) => {
  const rec = db.prepare('SELECT id FROM training_records WHERE id = ? AND company_id = ?').get(req.params.id, req.companyId);
  if (!rec) return res.status(404).json({ error: 'Not found' });
  db.prepare('DELETE FROM training_records WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

// ─── GET /certifications ──────────────────────────────────────────────────────

router.get('/certifications', (req, res) => {
  const cid = req.companyId;
  const { user_id } = req.query;

  let sql = `
    SELECT c.*, u.display_name
    FROM certifications c JOIN users u ON u.id = c.user_id
    WHERE c.company_id = ?
  `;
  const params = [cid];

  if (user_id) { sql += ' AND c.user_id = ?'; params.push(user_id); }
  sql += ' ORDER BY u.display_name, c.name';

  res.json(db.prepare(sql).all(...params));
});

// ─── POST /certifications ─────────────────────────────────────────────────────

router.post('/certifications', (req, res) => {
  const cid = req.companyId;
  const { user_id, name, issuer = '', cert_number = '', issued_date, expiry_date, document_url = '', notes = '' } = req.body;

  if (!user_id || !name) return res.status(400).json({ error: 'user_id and name required' });

  const id = uuidv4();
  db.prepare(`
    INSERT INTO certifications (id, company_id, user_id, name, issuer, cert_number, issued_date, expiry_date, document_url, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, cid, user_id, name, issuer, cert_number, issued_date || null, expiry_date || null, document_url, notes);

  res.status(201).json(db.prepare(`
    SELECT c.*, u.display_name FROM certifications c JOIN users u ON u.id = c.user_id WHERE c.id = ?
  `).get(id));
});

// ─── PUT /certifications/:id ──────────────────────────────────────────────────

router.put('/certifications/:id', (req, res) => {
  const cid = req.companyId;
  const cert = db.prepare('SELECT id FROM certifications WHERE id = ? AND company_id = ?').get(req.params.id, cid);
  if (!cert) return res.status(404).json({ error: 'Not found' });

  const fields = ['name', 'issuer', 'cert_number', 'issued_date', 'expiry_date', 'document_url', 'notes'];
  const updates = {};
  for (const f of fields) if (req.body[f] !== undefined) updates[f] = req.body[f];

  if (Object.keys(updates).length > 0) {
    const sets = Object.keys(updates).map(k => `${k} = ?`).join(', ');
    db.prepare(`UPDATE certifications SET ${sets}, updated_at = datetime('now') WHERE id = ?`)
      .run(...Object.values(updates), req.params.id);
  }

  res.json(db.prepare(`
    SELECT c.*, u.display_name FROM certifications c JOIN users u ON u.id = c.user_id WHERE c.id = ?
  `).get(req.params.id));
});

// ─── DELETE /certifications/:id ───────────────────────────────────────────────

router.delete('/certifications/:id', (req, res) => {
  const cert = db.prepare('SELECT id FROM certifications WHERE id = ? AND company_id = ?').get(req.params.id, req.companyId);
  if (!cert) return res.status(404).json({ error: 'Not found' });
  db.prepare('DELETE FROM certifications WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

// ─── GET /plans ───────────────────────────────────────────────────────────────

router.get('/plans', (req, res) => {
  const cid = req.companyId;

  // Auto-mark overdue: pending/in_progress plans past their target_date
  db.prepare(`
    UPDATE training_plans
    SET status = 'overdue', updated_at = datetime('now')
    WHERE company_id = ? AND status IN ('pending','in_progress')
      AND target_date IS NOT NULL AND date(target_date) < date('now')
  `).run(cid);

  const plans = db.prepare(`
    SELECT tp.*,
      u.display_name  as operator_name,
      a.name          as app_name,
      ab.display_name as assigned_by_name
    FROM training_plans tp
    JOIN users u ON u.id = tp.user_id
    LEFT JOIN apps a ON a.id = tp.app_id
    LEFT JOIN users ab ON ab.id = tp.assigned_by
    WHERE tp.company_id = ?
    ORDER BY tp.target_date ASC, u.display_name
  `).all(cid);

  res.json(plans);
});

// ─── POST /plans ──────────────────────────────────────────────────────────────

router.post('/plans', (req, res) => {
  const cid = req.companyId;
  const { user_id, app_id, target_date, notes = '' } = req.body;

  if (!user_id) return res.status(400).json({ error: 'user_id required' });

  const id = uuidv4();
  const assigned_by = req.user ? req.user.id : null;

  db.prepare(`
    INSERT INTO training_plans (id, company_id, user_id, app_id, assigned_by, target_date, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(id, cid, user_id, app_id || null, assigned_by, target_date || null, notes);

  res.status(201).json(db.prepare(`
    SELECT tp.*, u.display_name as operator_name, a.name as app_name, ab.display_name as assigned_by_name
    FROM training_plans tp
    JOIN users u ON u.id = tp.user_id
    LEFT JOIN apps a ON a.id = tp.app_id
    LEFT JOIN users ab ON ab.id = tp.assigned_by
    WHERE tp.id = ?
  `).get(id));
});

// ─── PUT /plans/:id ───────────────────────────────────────────────────────────

router.put('/plans/:id', (req, res) => {
  const cid = req.companyId;
  const plan = db.prepare('SELECT id FROM training_plans WHERE id = ? AND company_id = ?').get(req.params.id, cid);
  if (!plan) return res.status(404).json({ error: 'Not found' });

  const fields = ['status', 'target_date', 'notes'];
  const updates = {};
  for (const f of fields) if (req.body[f] !== undefined) updates[f] = req.body[f];

  if (Object.keys(updates).length > 0) {
    const sets = Object.keys(updates).map(k => `${k} = ?`).join(', ');
    db.prepare(`UPDATE training_plans SET ${sets}, updated_at = datetime('now') WHERE id = ?`)
      .run(...Object.values(updates), req.params.id);
  }

  res.json(db.prepare(`
    SELECT tp.*, u.display_name as operator_name, a.name as app_name, ab.display_name as assigned_by_name
    FROM training_plans tp
    JOIN users u ON u.id = tp.user_id
    LEFT JOIN apps a ON a.id = tp.app_id
    LEFT JOIN users ab ON ab.id = tp.assigned_by
    WHERE tp.id = ?
  `).get(req.params.id));
});

// ─── DELETE /plans/:id ────────────────────────────────────────────────────────

router.delete('/plans/:id', (req, res) => {
  const plan = db.prepare('SELECT id FROM training_plans WHERE id = ? AND company_id = ?').get(req.params.id, req.companyId);
  if (!plan) return res.status(404).json({ error: 'Not found' });
  db.prepare('DELETE FROM training_plans WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

module.exports = router;

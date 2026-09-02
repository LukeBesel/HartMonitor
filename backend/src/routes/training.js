const express = require('express');
const { v4: uuidv4 } = require('uuid');
const db = require('../db');
const vocab = require('../vocab');
const { plantDayShift } = require('../plantDay');
const { requireRole } = require('../middleware/auth');
const { logActivity } = require('../activity');
const { redeemGrant } = require('../authorization');
const {
  enforcementMode, setEnforcementMode, checkQualification, overridePurpose,
  issueOverrideToken, blockedStartsByApp, OVERRIDE_TTL_MS,
} = require('../qualification');

const router = express.Router();

// ─── The three routes that must NOT sit behind this file's own mount ─────────
//
// `/api/training` is mounted in index.js behind requirePlan('pro') AND
// writeRole('supervisor'). Both are right for a training module and both are
// wrong for these three:
//
//   GET/PUT /enforcement — the plan gate would build a TRAPDOOR. A company on
//     Pro sets Block, then downgrades to Free; the gate keeps stopping every
//     start, and the one screen that could turn it off answers 402. The plant
//     is locked out of its own floor by a billing state. A safety switch has to
//     be reachable in both directions, always.
//   POST /overrides — the supervisor write role would put the override door
//     out of reach of the very session that needs it. A tablet signed in as an
//     operator is exactly the case the override exists for; an override an
//     operator can never obtain is not an override.
//
// So they live on their own router, mounted one line earlier in index.js, each
// carrying the role it actually needs. Everything else keeps both gates.
const gateRouter = express.Router();

// ─── The enforcement gate ─────────────────────────────────────────────────────
// Everything in this section serves ONE promise: a company that has not chosen
// an enforcement mode is unaffected by all of it. Reading the mode of a company
// that never set one returns 'off', and 'off' is a hard short circuit in
// backend/src/qualification.js — no training row is read at run start at all.

// GET /enforcement — what this company does when someone unqualified starts.
gateRouter.get('/enforcement', (req, res) => {
  res.json({
    enforcement: enforcementMode(req.companyId),
    options: vocab.values('TRAINING_ENFORCEMENT'),
  });
});

// PUT /enforcement — manager and above. Supervisors run the floor; deciding
// that the floor can be STOPPED by a missing certificate is a plant policy.
gateRouter.put('/enforcement', requireRole('manager'), (req, res) => {
  const value = req.body?.enforcement;
  if (!vocab.isValid('TRAINING_ENFORCEMENT', value)) {
    return res.status(400).json({
      error: `enforcement must be one of: ${vocab.values('TRAINING_ENFORCEMENT').join(', ')}`,
    });
  }
  setEnforcementMode(req.companyId, value);
  logActivity(req.companyId, 'settings', req.companyId,
    `Training enforcement set to ${value}`, req.user?.display_name);
  res.json({ enforcement: value, options: vocab.values('TRAINING_ENFORCEMENT') });
});

// GET /records/check?app_id=&user_id=|operator_name= — exactly what the gate
// would decide for this person and this app, without starting anything. The
// player can ask before it offers a job; a supervisor can ask before a shift.
router.get('/records/check', (req, res) => {
  const { app_id, user_id, operator_name } = req.query;
  if (!app_id) return res.status(400).json({ error: 'app_id required' });
  res.json(checkQualification(req.companyId, {
    userId: user_id || null,
    operatorName: operator_name || '',
    appId: String(app_id),
  }));
});

// POST /overrides — a supervisor lets one uncertified start through.
//
// The PIN is NOT checked here. POST /api/operators/verify-authorizer already
// does that (roster scan, role gate, brute-force lockout) and mints a single
// use grant; this endpoint redeems that grant and hands back a token scoped to
// one app and one operator for ten minutes. Reusing the existing proof is the
// point: there is one place in this codebase that compares a PIN.
//
// The grant is redeemed for the purpose it was RAISED for, and that purpose
// names this app and this operator (overridePurpose). Three things follow, and
// all three matter:
//
//   • a grant minted for an in-run NCR sign-off ('ncr') buys nothing here, so
//     one quality sign-off is not a twelve-hour licence to start any app;
//   • a qualification grant raised for Cara on app 2 cannot be spent on Maria
//     on app 1 — the strings differ and redeemGrant refuses;
//   • the supervisor's PIN prompt and the thing it authorizes are the same
//     statement, which is what makes the audit row honest.
gateRouter.post('/overrides', requireRole('operator'), (req, res) => {
  const { app_id, user_id, operator_name = '', authorizer_proof, reason = '' } = req.body || {};
  if (!app_id) return res.status(400).json({ error: 'app_id required' });
  if (!user_id && !String(operator_name).trim()) {
    return res.status(400).json({ error: 'user_id or operator_name required' });
  }
  if (!authorizer_proof) {
    return res.status(400).json({
      error: 'authorizer_proof required — verify a supervisor PIN at POST /api/operators/verify-authorizer first',
    });
  }
  const app = db.prepare('SELECT id, name FROM apps WHERE id = ? AND company_id = ?')
    .get(app_id, req.companyId);
  if (!app) return res.status(404).json({ error: 'App not found' });

  // Recomputed here from OUR body, never taken from the client: the grant only
  // opens if the supervisor was asked about this exact app and this exact
  // person.
  const purpose = overridePurpose(app.id, user_id || null, operator_name);
  const grant = redeemGrant(authorizer_proof, req.companyId, purpose);
  if (!grant) {
    return res.status(403).json({
      error: 'That supervisor authorization is not valid for this app and operator, '
        + 'has expired, or has already been used.',
      code: 'AUTHORIZATION_INVALID',
    });
  }

  const token = issueOverrideToken({
    companyId: req.companyId,
    appId: app.id,
    userId: user_id || null,
    operatorName: String(operator_name || ''),
    approvedBy: { user_id: grant.user_id, display_name: grant.display_name },
    reason: String(reason || ''),
  });

  res.status(201).json({
    token,
    expires_in_seconds: Math.round(OVERRIDE_TTL_MS / 1000),
    app_id: app.id,
    app_name: app.name,
    approved_by: grant.display_name,
  });
});

// GET /overrides — every exception that was actually used, newest first. This
// is the record an auditor asks for: who ran what without a sign-off, who let
// them, and which run it was.
router.get('/overrides', (req, res) => {
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 100, 1), 500);
  res.json(db.prepare(`
    SELECT o.*,
           a.name  AS app_name,
           u.display_name AS operator_display_name
    FROM qualification_overrides o
    LEFT JOIN apps  a ON a.id = o.app_id
    LEFT JOIN users u ON u.id = o.user_id
    WHERE o.company_id = ?
    ORDER BY o.created_at DESC, o.rowid DESC
    LIMIT ?
  `).all(req.companyId, limit));
});

// GET /blocked-starts?days=7 — what the setting is costing, per app.
//
// An app that has refused nobody is reported with blocked: null, not 0. "No
// starts were blocked" and "nothing has been measured here" are different
// facts and the screen prints '—' for the second.
router.get('/blocked-starts', (req, res) => {
  const days = Math.min(Math.max(parseInt(req.query.days, 10) || 7, 1), 365);
  const counts = blockedStartsByApp(req.companyId, days);
  const apps = db.prepare(
    `SELECT id, name FROM apps WHERE company_id = ? AND status = 'published' ORDER BY name`
  ).all(req.companyId);
  const measured = Object.keys(counts).length > 0;
  res.json({
    days,
    enforcement: enforcementMode(req.companyId),
    // Nothing has ever been refused anywhere: say so once, rather than printing
    // a column of confident zeroes for a gate that may never have been on.
    empty_reason: measured ? null : 'no starts have been blocked yet',
    // Per app, absence is the answer. An app that has refused nobody reads '—'
    // even while the app beside it reads 4 — writing 0 there would claim the
    // gate has been watching this app and found nothing, which is a different
    // and unproven statement.
    apps: apps.map(a => ({
      app_id: a.id,
      app_name: a.name,
      blocked: Object.hasOwn(counts, a.id) ? counts[a.id] : null,
    })),
  });
});

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

  // "Required" = every active operator against every published app. With
  // either at zero there is nothing to certify against — not 0% coverage,
  // which reads as "everyone is behind" when the truth is nothing was ever
  // asked of anyone yet.
  const total_possible = total_operators * active_apps;
  const coverage_pct = total_possible > 0
    ? Math.round((certified_count / total_possible) * 100 * 10) / 10
    : null;
  const empty_reason = total_possible > 0 ? null : 'no certifications required yet';

  // Expiry and target dates are calendar dates, so they are compared as stored.
  // Only "today" moves onto the plant's clock — an expiry lapses at the start of
  // the plant's day, not at midnight in Greenwich.
  const day = plantDayShift(cid);

  // Records expiring within 30 days (training_records + certifications)
  const expiring_tr = db.prepare(
    `SELECT COUNT(*) as c FROM training_records
     WHERE company_id = ? AND expiry_date IS NOT NULL
       AND date(expiry_date) BETWEEN date('now', ?) AND date('now', ?, '+30 days')`
  ).get(cid, day, day).c;

  const expiring_cert = db.prepare(
    `SELECT COUNT(*) as c FROM certifications
     WHERE company_id = ? AND expiry_date IS NOT NULL
       AND date(expiry_date) BETWEEN date('now', ?) AND date('now', ?, '+30 days')`
  ).get(cid, day, day).c;

  const expiring_soon = expiring_tr + expiring_cert;

  // Overdue training plans
  const overdue_plans = db.prepare(
    `SELECT COUNT(*) as c FROM training_plans
     WHERE company_id = ? AND status IN ('pending','in_progress')
       AND target_date IS NOT NULL AND date(target_date) < date('now', ?)`
  ).get(cid, day).c;

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

  // Department coverage. Department rows can be duplicated by name (e.g. two
  // 'Assembly' rows from a double-seed) — merge same-named departments into a
  // single entry so the coverage list shows each department exactly once.
  const departments = db.prepare(
    `SELECT id, name FROM departments WHERE company_id = ? ORDER BY name, id`
  ).all(cid);

  const deptGroups = new Map();
  for (const dept of departments) {
    const key = (dept.name || '').trim().toLowerCase();
    const group = deptGroups.get(key);
    if (group) group.ids.push(dept.id);
    else deptGroups.set(key, { id: dept.id, name: dept.name, ids: [dept.id] });
  }

  const department_coverage = [...deptGroups.values()].map(group => {
    let operator_count = 0;
    let dept_certified = 0;
    for (const deptId of group.ids) {
      operator_count += db.prepare(
        `SELECT COUNT(*) as c FROM users WHERE company_id = ? AND department_id = ? AND role IN ('operator','supervisor') AND is_active = 1`
      ).get(cid, deptId).c;
      dept_certified += db.prepare(
        `SELECT COUNT(*) as c FROM training_records tr
         JOIN users u ON u.id = tr.user_id
         WHERE tr.company_id = ? AND u.department_id = ? AND tr.status = 'certified'`
      ).get(cid, deptId).c;
    }
    const dept_possible = operator_count * active_apps;
    const dept_coverage_pct = dept_possible > 0
      ? Math.round((dept_certified / dept_possible) * 100 * 10) / 10
      : null;
    // Two different reasons produce the same zero denominator, and they are
    // not the same fact: no operators here yet vs. this department has people
    // but the plant has nothing published for anyone to certify against.
    const dept_empty_reason = dept_possible > 0
      ? null
      : operator_count === 0
        ? 'no operators in this department yet'
        : 'no certifications required yet';
    return {
      id: group.id, name: group.name, operator_count, coverage_pct: dept_coverage_pct,
      empty_reason: dept_empty_reason,
    };
  });

  res.json({
    total_operators,
    certified_count,
    total_possible,
    coverage_pct,
    empty_reason,
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

  // NB: `apps` has no `category` column — selecting one made this endpoint 500
  // for every company, which the Skills Matrix rendered as a false "no apps yet".
  let appSql = `SELECT id, name, department_id FROM apps WHERE company_id = ? AND status = 'published'`;
  const appParams = [cid];
  if (department_id) { appSql += ' AND (department_id = ? OR department_id IS NULL)'; appParams.push(department_id); }
  appSql += ' ORDER BY name';

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
      AND target_date IS NOT NULL AND date(target_date) < date('now', ?)
  `).run(cid, plantDayShift(cid));

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
// Mounted one line earlier in index.js, outside the plan gate and the
// supervisor write role. See the comment at the top of this file.
module.exports.gateRouter = gateRouter;

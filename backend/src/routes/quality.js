const express = require('express');
const { v4: uuidv4 } = require('uuid');
const db = require('../db');
const { logActivity } = require('../activity');
const { notify } = require('../notifications');
const { deliverWebhooks } = require('../webhooks');
const { requireRole } = require('../middleware/auth');

const router = express.Router();

const NCR_STATUS_LABELS = {
  open: 'Open', investigating: 'Investigating', resolved: 'Resolved', closed: 'Closed',
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function nextNCRNumber(companyId) {
  const year = new Date().getFullYear();
  const row = db.prepare(`SELECT ncr_number FROM ncrs WHERE company_id = ? AND ncr_number LIKE 'NCR-${year}-%' ORDER BY ncr_number DESC LIMIT 1`).get(companyId);
  if (!row) return `NCR-${year}-001`;
  const last = parseInt(row.ncr_number.split('-')[2]) || 0;
  return `NCR-${year}-${String(last + 1).padStart(3, '0')}`;
}

function getNCRWithDetails(id, companyId) {
  const ncr = db.prepare(`
    SELECT n.*,
      a.name as app_name,
      wo.work_order_number,
      i.name as item_name, i.sku as item_sku
    FROM ncrs n
    LEFT JOIN apps a ON a.id = n.app_id
    LEFT JOIN work_orders wo ON wo.id = n.work_order_id
    LEFT JOIN items i ON i.id = n.item_id
    WHERE n.id = ? AND n.company_id = ?
  `).get(id, companyId);
  if (!ncr) return null;
  const comments = db.prepare('SELECT * FROM ncr_comments WHERE ncr_id = ? ORDER BY created_at ASC').all(id);
  return { ...ncr, comments };
}

// Returns the id if the row exists in this company, else null
function ownedOrNull(table, id, companyId) {
  if (!id) return null;
  const row = db.prepare(`SELECT id FROM ${table} WHERE id = ? AND company_id = ?`).get(id, companyId);
  return row ? id : null;
}

// ─── GET /ncrs ────────────────────────────────────────────────────────────────

router.get('/ncrs', (req, res) => {
  const { status, severity, source, search, app_id } = req.query;
  let sql = `
    SELECT n.*,
      a.name as app_name,
      wo.work_order_number,
      i.name as item_name, i.sku as item_sku,
      (SELECT COUNT(*) FROM ncr_comments WHERE ncr_id = n.id) as comment_count
    FROM ncrs n
    LEFT JOIN apps a ON a.id = n.app_id
    LEFT JOIN work_orders wo ON wo.id = n.work_order_id
    LEFT JOIN items i ON i.id = n.item_id
    WHERE n.company_id = ?
  `;
  const params = [req.companyId];
  if (status)   { sql += ' AND n.status = ?';   params.push(status); }
  if (severity) { sql += ' AND n.severity = ?'; params.push(severity); }
  if (source)   { sql += ' AND n.source = ?';   params.push(source); }
  if (app_id)   { sql += ' AND n.app_id = ?';   params.push(app_id); }
  if (search)   { sql += ' AND (n.title LIKE ? OR n.ncr_number LIKE ? OR n.description LIKE ?)'; params.push(`%${search}%`, `%${search}%`, `%${search}%`); }
  sql += ' ORDER BY CASE n.severity WHEN \'critical\' THEN 1 WHEN \'major\' THEN 2 ELSE 3 END, n.created_at DESC';
  res.json(db.prepare(sql).all(...params));
});

// ─── GET /ncrs/summary ────────────────────────────────────────────────────────

router.get('/summary', (req, res) => {
  const cid = req.companyId;
  const total    = db.prepare('SELECT COUNT(*) as c FROM ncrs WHERE company_id = ?').get(cid).c;
  const open     = db.prepare("SELECT COUNT(*) as c FROM ncrs WHERE company_id = ? AND status = 'open'").get(cid).c;
  const investigating = db.prepare("SELECT COUNT(*) as c FROM ncrs WHERE company_id = ? AND status = 'investigating'").get(cid).c;
  const resolved = db.prepare("SELECT COUNT(*) as c FROM ncrs WHERE company_id = ? AND status = 'resolved'").get(cid).c;
  const closed   = db.prepare("SELECT COUNT(*) as c FROM ncrs WHERE company_id = ? AND status = 'closed'").get(cid).c;
  const critical = db.prepare("SELECT COUNT(*) as c FROM ncrs WHERE company_id = ? AND severity = 'critical' AND status NOT IN ('closed')").get(cid).c;
  const overdue  = db.prepare("SELECT COUNT(*) as c FROM ncrs WHERE company_id = ? AND due_date < date('now') AND status NOT IN ('resolved','closed')").get(cid).c;
  const by_source = db.prepare("SELECT source, COUNT(*) as count FROM ncrs WHERE company_id = ? GROUP BY source ORDER BY count DESC").all(cid);
  const by_severity = db.prepare("SELECT severity, COUNT(*) as count FROM ncrs WHERE company_id = ? AND status NOT IN ('closed') GROUP BY severity").all(cid);
  res.json({ total, open, investigating, resolved, closed, critical, overdue, by_source, by_severity });
});

// ─── POST /ncrs ───────────────────────────────────────────────────────────────

router.post('/ncrs', (req, res) => {
  const {
    title, description = '', severity = 'minor', source = 'production',
    app_id, completion_id, work_order_id, item_id,
    assigned_to = '', due_date
  } = req.body;
  if (!title) return res.status(400).json({ error: 'title required' });
  if (!['minor', 'major', 'critical'].includes(severity)) {
    return res.status(400).json({ error: 'severity must be one of: minor, major, critical' });
  }
  const cid = req.companyId;
  const id = uuidv4();
  const ncr_number = nextNCRNumber(cid);
  db.prepare(`
    INSERT INTO ncrs (id, ncr_number, title, description, severity, status, source, app_id, completion_id, work_order_id, item_id, assigned_to, due_date, company_id)
    VALUES (?, ?, ?, ?, ?, 'open', ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id, ncr_number, title, description, severity, source,
    ownedOrNull('apps', app_id, cid),
    ownedOrNull('completions', completion_id, cid),
    ownedOrNull('work_orders', work_order_id, cid),
    ownedOrNull('items', item_id, cid),
    assigned_to, due_date || null, cid
  );
  logActivity(cid, 'ncr', id, 'NCR created', req.user?.display_name);

  const created = getNCRWithDetails(id, cid);
  notify(cid, 'ncr.created', {
    body: `NCR ${ncr_number} raised: "${title}" (${severity}).`,
  });
  deliverWebhooks(cid, 'ncr.created', created);

  res.status(201).json(created);
});

// ─── GET /ncrs/:id ────────────────────────────────────────────────────────────

router.get('/ncrs/:id', (req, res) => {
  const ncr = getNCRWithDetails(req.params.id, req.companyId);
  if (!ncr) return res.status(404).json({ error: 'Not found' });
  res.json(ncr);
});

// ─── PUT /ncrs/:id ────────────────────────────────────────────────────────────

router.put('/ncrs/:id', requireRole('supervisor'), (req, res) => {
  const ncr = db.prepare('SELECT * FROM ncrs WHERE id = ? AND company_id = ?').get(req.params.id, req.companyId);
  if (!ncr) return res.status(404).json({ error: 'Not found' });

  // Strip fields that must never be overwritten from client input
  const FORBIDDEN_FIELDS = ['id', 'company_id', 'created_at', 'created_by'];
  for (const f of FORBIDDEN_FIELDS) {
    if (f in req.body) delete req.body[f];
  }

  const { severity, status } = req.body;
  const VALID_SEVERITIES = ['minor', 'major', 'critical'];
  const VALID_STATUSES = ['open', 'investigating', 'resolved', 'closed'];
  if (severity && !VALID_SEVERITIES.includes(severity)) {
    return res.status(400).json({ error: 'severity must be one of: minor, major, critical' });
  }
  if (status && !VALID_STATUSES.includes(status)) {
    return res.status(400).json({ error: 'status must be one of: open, investigating, resolved, closed' });
  }

  const fields = ['title','description','severity','status','source','app_id','work_order_id','item_id','assigned_to','root_cause','corrective_action','due_date','resolved_at'];
  const updates = {};
  for (const f of fields) if (req.body[f] !== undefined) updates[f] = req.body[f];

  // Validate enum fields so bad values can't corrupt summaries/reporting.
  if (updates.status !== undefined && !Object.keys(NCR_STATUS_LABELS).includes(updates.status)) {
    return res.status(400).json({ error: `status must be one of: ${Object.keys(NCR_STATUS_LABELS).join(', ')}` });
  }
  if (updates.severity !== undefined && !['minor', 'major', 'critical'].includes(updates.severity)) {
    return res.status(400).json({ error: 'severity must be one of: minor, major, critical' });
  }

  // Linked records must belong to this company — otherwise the detail view's
  // JOINs would leak another tenant's work order / item / app names.
  if (updates.app_id !== undefined)        updates.app_id        = ownedOrNull('apps', updates.app_id, req.companyId);
  if (updates.work_order_id !== undefined) updates.work_order_id = ownedOrNull('work_orders', updates.work_order_id, req.companyId);
  if (updates.item_id !== undefined)       updates.item_id       = ownedOrNull('items', updates.item_id, req.companyId);

  // Auto-set resolved_at when status moves to resolved
  if (updates.status === 'resolved' && !ncr.resolved_at && !updates.resolved_at) {
    updates.resolved_at = new Date().toISOString();
  }

  if (!Object.keys(updates).length) return res.json(getNCRWithDetails(req.params.id, req.companyId));
  const sets = Object.keys(updates).map(k => `${k} = ?`).join(', ');
  db.prepare(`UPDATE ncrs SET ${sets}, updated_at = datetime('now') WHERE id = ?`).run(...Object.values(updates), req.params.id);

  const changes = [];
  if (updates.status !== undefined && updates.status !== ncr.status) {
    changes.push(`Status changed from ${NCR_STATUS_LABELS[ncr.status] || ncr.status} to ${NCR_STATUS_LABELS[updates.status] || updates.status}`);
  }
  if (updates.severity !== undefined && updates.severity !== ncr.severity) {
    changes.push(`Severity changed from ${ncr.severity} to ${updates.severity}`);
  }
  if (updates.assigned_to !== undefined && updates.assigned_to !== ncr.assigned_to) {
    changes.push(`Assigned to ${updates.assigned_to || 'nobody'}`);
  }
  if (updates.root_cause !== undefined && updates.root_cause && updates.root_cause !== ncr.root_cause) {
    changes.push('Root cause updated');
  }
  if (updates.corrective_action !== undefined && updates.corrective_action && updates.corrective_action !== ncr.corrective_action) {
    changes.push('Corrective action updated');
  }
  for (const change of changes) {
    logActivity(req.companyId, 'ncr', req.params.id, change, req.user?.display_name);
  }

  res.json(getNCRWithDetails(req.params.id, req.companyId));
});

// ─── POST /ncrs/:id/comments ──────────────────────────────────────────────────

router.post('/ncrs/:id/comments', (req, res) => {
  const ncr = db.prepare('SELECT id FROM ncrs WHERE id = ? AND company_id = ?').get(req.params.id, req.companyId);
  if (!ncr) return res.status(404).json({ error: 'Not found' });
  const { author, body } = req.body;
  if (!author || !body) return res.status(400).json({ error: 'author and body required' });
  const id = uuidv4();
  db.prepare(`INSERT INTO ncr_comments (id, ncr_id, author, body) VALUES (?, ?, ?, ?)`).run(id, req.params.id, author, body);
  db.prepare("UPDATE ncrs SET updated_at = datetime('now') WHERE id = ?").run(req.params.id);
  logActivity(req.companyId, 'ncr', req.params.id, 'Comment added', author);
  res.status(201).json(db.prepare('SELECT * FROM ncr_comments WHERE id = ?').get(id));
});

// ─── DELETE /ncrs/:id ─────────────────────────────────────────────────────────

router.delete('/ncrs/:id', requireRole('supervisor'), (req, res) => {
  const ncr = db.prepare('SELECT * FROM ncrs WHERE id = ? AND company_id = ?').get(req.params.id, req.companyId);
  if (!ncr) return res.status(404).json({ error: 'Not found' });
  db.prepare('DELETE FROM ncrs WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

module.exports = router;

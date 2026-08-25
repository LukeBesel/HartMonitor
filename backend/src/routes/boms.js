// ─── BOMs: per-product-type, versioned bills of material ─────────────────────
// Mounted at /api/boms behind requireAuth (req.companyId set). Every query is
// company-scoped and every cross-table reference is validated company-owned
// before insert (same pattern as completions.js).
//
// Lifecycle: draft → active → superseded. Drafts are editable; activating a
// version supersedes any sibling active version for the same product type.

const express = require('express');
const { v4: uuidv4 } = require('uuid');
const db = require('../db');
const { requireRole } = require('../middleware/auth');
const { logActivity } = require('../activity');

const router = express.Router();

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getBomHeader(id, companyId) {
  return db.prepare(`
    SELECT b.*, pt.name AS product_type_name, pt.app_id
    FROM boms b
    JOIN product_types pt ON pt.id = b.product_type_id
    WHERE b.id = ? AND b.company_id = ?
  `).get(id, companyId);
}

function getBomLines(bomId) {
  return db.prepare(`
    SELECT bl.*, i.name AS item_name, i.sku AS item_sku, i.unit_of_measure AS item_unit, i.unit_cost AS item_unit_cost
    FROM bom_lines bl
    JOIN items i ON i.id = bl.item_id
    WHERE bl.bom_id = ?
    ORDER BY bl.sort_order ASC, i.sku ASC
  `).all(bomId);
}

function bomWithLines(id, companyId) {
  const bom = getBomHeader(id, companyId);
  if (!bom) return null;
  return { ...bom, lines: getBomLines(id) };
}

// ─── GET / — list BOM headers + line counts ───────────────────────────────────
// Filters: product_type_id, app_id (via the product type's app).

router.get('/', (req, res) => {
  const { product_type_id, app_id } = req.query;
  const conditions = ['b.company_id = ?'];
  const params = [req.companyId];
  if (product_type_id) { conditions.push('b.product_type_id = ?'); params.push(product_type_id); }
  if (app_id)          { conditions.push('pt.app_id = ?');         params.push(app_id); }

  // One grouped join instead of a correlated COUNT subquery per BOM header.
  const rows = db.prepare(`
    SELECT b.*, pt.name AS product_type_name, pt.app_id,
           COUNT(bl.id) AS line_count
    FROM boms b
    JOIN product_types pt ON pt.id = b.product_type_id
    LEFT JOIN bom_lines bl ON bl.bom_id = b.id
    WHERE ${conditions.join(' AND ')}
    GROUP BY b.id
    ORDER BY pt.name ASC, b.version DESC
  `).all(...params);
  res.json(rows);
});

// ─── GET /resolve?work_order_id= — runtime join: WO → product type → active BOM
// Must be declared before /:id so "resolve" isn't captured as an id.

router.get('/resolve', requireRole('operator'), (req, res) => {
  const { work_order_id } = req.query;
  if (!work_order_id) return res.status(400).json({ error: 'work_order_id required' });

  const wo = db.prepare('SELECT id, product_type_id FROM work_orders WHERE id = ? AND company_id = ?')
    .get(work_order_id, req.companyId);
  if (!wo) return res.status(404).json({ error: 'Work order not found' });
  if (!wo.product_type_id) return res.status(404).json({ error: 'Work order has no product type, so no BOM resolves', code: 'NO_BOM' });

  const bom = db.prepare(`
    SELECT b.*, pt.name AS product_type_name, pt.app_id
    FROM boms b JOIN product_types pt ON pt.id = b.product_type_id
    WHERE b.company_id = ? AND b.product_type_id = ? AND b.status = 'active'
    ORDER BY b.version DESC LIMIT 1
  `).get(req.companyId, wo.product_type_id);
  if (!bom) return res.status(404).json({ error: 'No active BOM for this product type', code: 'NO_BOM' });

  res.json({ ...bom, lines: getBomLines(bom.id) });
});

// ─── POST / — create a draft BOM (v1, or next version number) ─────────────────

router.post('/', requireRole('supervisor'), (req, res) => {
  const { product_type_id, notes = '' } = req.body || {};
  if (!product_type_id) return res.status(400).json({ error: 'product_type_id required' });

  const pt = db.prepare('SELECT id FROM product_types WHERE id = ? AND company_id = ?')
    .get(product_type_id, req.companyId);
  if (!pt) return res.status(404).json({ error: 'Product type not found' });

  const maxVersion = db.prepare(
    'SELECT COALESCE(MAX(version), 0) AS v FROM boms WHERE company_id = ? AND product_type_id = ?'
  ).get(req.companyId, product_type_id).v;

  const id = uuidv4();
  db.prepare(`
    INSERT INTO boms (id, company_id, product_type_id, version, status, notes, created_by)
    VALUES (?, ?, ?, ?, 'draft', ?, ?)
  `).run(id, req.companyId, product_type_id, maxVersion + 1, String(notes), req.user?.display_name || '');

  logActivity(req.companyId, 'bom', id, `BOM v${maxVersion + 1} draft created`, req.user?.display_name);
  res.status(201).json(bomWithLines(id, req.companyId));
});

// ─── GET /:id — header + lines ────────────────────────────────────────────────

router.get('/:id', (req, res) => {
  const bom = bomWithLines(req.params.id, req.companyId);
  if (!bom) return res.status(404).json({ error: 'Not found' });
  res.json(bom);
});

// ─── PUT /:id — replace lines + notes (draft only) ────────────────────────────

router.put('/:id', requireRole('supervisor'), (req, res) => {
  const bom = getBomHeader(req.params.id, req.companyId);
  if (!bom) return res.status(404).json({ error: 'Not found' });
  if (bom.status !== 'draft') {
    return res.status(409).json({ error: 'Only draft BOMs are editable', code: 'NOT_DRAFT' });
  }

  const { lines, notes } = req.body || {};
  if (lines !== undefined && !Array.isArray(lines)) {
    return res.status(400).json({ error: 'lines must be an array' });
  }

  // Validate every referenced item is company-owned before any write.
  const cleanLines = [];
  if (Array.isArray(lines)) {
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i] || {};
      if (!l.item_id) return res.status(400).json({ error: `lines[${i}].item_id required` });
      const item = db.prepare('SELECT id, unit_of_measure FROM items WHERE id = ? AND company_id = ?')
        .get(l.item_id, req.companyId);
      if (!item) return res.status(400).json({ error: `lines[${i}]: item not found in this organization` });
      const qtyPer = Number(l.qty_per);
      if (!Number.isFinite(qtyPer) || qtyPer <= 0) {
        return res.status(400).json({ error: `lines[${i}].qty_per must be a positive number` });
      }
      cleanLines.push({
        id: uuidv4(),
        item_id: l.item_id,
        qty_per: qtyPer,
        unit: typeof l.unit === 'string' && l.unit ? l.unit : (item.unit_of_measure || 'ea'),
        reference: String(l.reference ?? ''),
        step_id: String(l.step_id ?? ''),
        scan_code: String(l.scan_code ?? ''),
        sort_order: Number.isFinite(Number(l.sort_order)) ? Number(l.sort_order) : i,
        notes: String(l.notes ?? ''),
      });
    }
  }

  const apply = db.transaction(() => {
    if (Array.isArray(lines)) {
      db.prepare('DELETE FROM bom_lines WHERE bom_id = ? AND company_id = ?').run(bom.id, req.companyId);
      const ins = db.prepare(`
        INSERT INTO bom_lines (id, bom_id, company_id, item_id, qty_per, unit, reference, step_id, scan_code, sort_order, notes)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      for (const l of cleanLines) {
        ins.run(l.id, bom.id, req.companyId, l.item_id, l.qty_per, l.unit, l.reference, l.step_id, l.scan_code, l.sort_order, l.notes);
      }
    }
    db.prepare(`UPDATE boms SET notes = ?, updated_at = datetime('now') WHERE id = ?`)
      .run(notes !== undefined ? String(notes) : bom.notes, bom.id);
  });
  apply();

  res.json(bomWithLines(bom.id, req.companyId));
});

// ─── POST /:id/activate — this → active, sibling actives → superseded ─────────

router.post('/:id/activate', requireRole('supervisor'), (req, res) => {
  const bom = getBomHeader(req.params.id, req.companyId);
  if (!bom) return res.status(404).json({ error: 'Not found' });
  if (bom.status === 'active') return res.json(bomWithLines(bom.id, req.companyId));

  const apply = db.transaction(() => {
    db.prepare(`
      UPDATE boms SET status = 'superseded', updated_at = datetime('now')
      WHERE company_id = ? AND product_type_id = ? AND status = 'active' AND id != ?
    `).run(req.companyId, bom.product_type_id, bom.id);
    db.prepare(`UPDATE boms SET status = 'active', updated_at = datetime('now') WHERE id = ?`).run(bom.id);
  });
  apply();

  logActivity(req.companyId, 'bom', bom.id, `BOM v${bom.version} activated`, req.user?.display_name);
  res.json(bomWithLines(bom.id, req.companyId));
});

// ─── POST /:id/new-version — copy lines into a new draft (version = max+1) ────

router.post('/:id/new-version', requireRole('supervisor'), (req, res) => {
  const bom = getBomHeader(req.params.id, req.companyId);
  if (!bom) return res.status(404).json({ error: 'Not found' });

  const maxVersion = db.prepare(
    'SELECT COALESCE(MAX(version), 0) AS v FROM boms WHERE company_id = ? AND product_type_id = ?'
  ).get(req.companyId, bom.product_type_id).v;

  const newId = uuidv4();
  const apply = db.transaction(() => {
    db.prepare(`
      INSERT INTO boms (id, company_id, product_type_id, version, status, notes, created_by)
      VALUES (?, ?, ?, ?, 'draft', ?, ?)
    `).run(newId, req.companyId, bom.product_type_id, maxVersion + 1, bom.notes, req.user?.display_name || '');

    const ins = db.prepare(`
      INSERT INTO bom_lines (id, bom_id, company_id, item_id, qty_per, unit, reference, step_id, scan_code, sort_order, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const l of db.prepare('SELECT * FROM bom_lines WHERE bom_id = ? ORDER BY sort_order ASC').all(bom.id)) {
      ins.run(uuidv4(), newId, req.companyId, l.item_id, l.qty_per, l.unit, l.reference, l.step_id, l.scan_code, l.sort_order, l.notes);
    }
  });
  apply();

  logActivity(req.companyId, 'bom', newId, `BOM v${maxVersion + 1} draft created from v${bom.version}`, req.user?.display_name);
  res.status(201).json(bomWithLines(newId, req.companyId));
});

// ─── DELETE /:id — draft only (manager+) ──────────────────────────────────────

router.delete('/:id', requireRole('manager'), (req, res) => {
  const bom = getBomHeader(req.params.id, req.companyId);
  if (!bom) return res.status(404).json({ error: 'Not found' });
  if (bom.status !== 'draft') {
    return res.status(409).json({ error: 'Only draft BOMs can be deleted', code: 'NOT_DRAFT' });
  }
  db.prepare('DELETE FROM boms WHERE id = ? AND company_id = ?').run(bom.id, req.companyId);
  logActivity(req.companyId, 'bom', bom.id, `BOM v${bom.version} draft deleted`, req.user?.display_name);
  res.json({ success: true });
});

module.exports = router;

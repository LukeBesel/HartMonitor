const express = require('express');
const { v4: uuidv4 } = require('uuid');
const db = require('../db');
const { notify } = require('../notifications');
const { deliverWebhooks } = require('../webhooks');

const router = express.Router();

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getItemWithStock(id, companyId) {
  const item = db.prepare('SELECT * FROM items WHERE id = ? AND company_id = ?').get(id, companyId);
  if (!item) return null;
  const stock = db.prepare(`
    SELECT sl.quantity, sl.updated_at, l.id as location_id, l.name as location_name, l.code as location_code
    FROM stock_levels sl JOIN locations l ON sl.location_id = l.id
    WHERE sl.item_id = ?
  `).all(id);
  const total_quantity = stock.reduce((s, r) => s + r.quantity, 0);
  return { ...item, stock_by_location: stock, total_quantity };
}

function updateStockLevel(itemId, locationId, deltaQty) {
  const existing = db.prepare('SELECT id, quantity FROM stock_levels WHERE item_id = ? AND location_id = ?').get(itemId, locationId);
  if (existing) {
    db.prepare("UPDATE stock_levels SET quantity = quantity + ?, updated_at = datetime('now') WHERE id = ?")
      .run(deltaQty, existing.id);
  } else {
    db.prepare("INSERT INTO stock_levels (id, item_id, location_id, quantity) VALUES (?, ?, ?, ?)").run(uuidv4(), itemId, locationId, Math.max(0, deltaQty));
  }
}

// ─── GET /items ───────────────────────────────────────────────────────────────

router.get('/items', (req, res) => {
  const { category, search, low_stock } = req.query;

  let sql = `
    SELECT i.*,
      COALESCE(SUM(sl.quantity), 0) as total_quantity,
      COALESCE(SUM(sl.quantity * i.unit_cost), 0) as total_value
    FROM items i
    LEFT JOIN stock_levels sl ON sl.item_id = i.id
  `;
  const params = [req.companyId];
  const where = ['i.company_id = ?'];

  if (category) { where.push('i.category = ?'); params.push(category); }
  if (search)   { where.push('(i.name LIKE ? OR i.sku LIKE ?)'); params.push(`%${search}%`, `%${search}%`); }

  sql += ` WHERE ${where.join(' AND ')} GROUP BY i.id`;

  if (low_stock === '1') sql += ' HAVING total_quantity <= i.reorder_point AND i.is_active = 1';
  sql += ' ORDER BY i.category, i.name';

  const items = db.prepare(sql).all(...params);
  res.json(items);
});

// ─── GET /items/summary ───────────────────────────────────────────────────────

router.get('/items/summary', (req, res) => {
  const cid = req.companyId;
  const total_items = db.prepare('SELECT COUNT(*) as c FROM items WHERE is_active = 1 AND company_id = ?').get(cid).c;
  const total_value = db.prepare(`
    SELECT COALESCE(SUM(sl.quantity * i.unit_cost), 0) as v
    FROM stock_levels sl JOIN items i ON i.id = sl.item_id WHERE i.is_active = 1 AND i.company_id = ?
  `).get(cid).v;
  const low_stock = db.prepare(`
    SELECT COUNT(*) as c FROM (
      SELECT i.id FROM items i
      LEFT JOIN stock_levels sl ON sl.item_id = i.id
      WHERE i.is_active = 1 AND i.company_id = ?
      GROUP BY i.id HAVING COALESCE(SUM(sl.quantity), 0) <= i.reorder_point
    )
  `).get(cid).c;
  const categories = db.prepare('SELECT DISTINCT category FROM items WHERE is_active = 1 AND company_id = ? ORDER BY category').all(cid).map(r => r.category);
  const today_receives = db.prepare(`
    SELECT COUNT(*) as c FROM stock_movements sm JOIN items i ON i.id = sm.item_id
    WHERE i.company_id = ? AND sm.movement_type = 'receive' AND date(sm.created_at) = date('now')
  `).get(cid).c;
  const today_consumes = db.prepare(`
    SELECT ABS(COALESCE(SUM(sm.quantity),0)) as c FROM stock_movements sm JOIN items i ON i.id = sm.item_id
    WHERE i.company_id = ? AND sm.movement_type = 'consume' AND date(sm.created_at) = date('now')
  `).get(cid).c;
  res.json({ total_items, total_value, low_stock, categories, today_receives, today_consumes });
});

// ─── GET /items/:id ───────────────────────────────────────────────────────────

router.get('/items/:id', (req, res) => {
  const item = getItemWithStock(req.params.id, req.companyId);
  if (!item) return res.status(404).json({ error: 'Not found' });
  const movements = db.prepare(`
    SELECT sm.*, l.name as location_name, l.code as location_code
    FROM stock_movements sm LEFT JOIN locations l ON l.id = sm.location_id
    WHERE sm.item_id = ? ORDER BY sm.created_at DESC LIMIT 50
  `).all(req.params.id);
  res.json({ ...item, movements });
});

// ─── POST /items ──────────────────────────────────────────────────────────────

router.post('/items', (req, res) => {
  const { sku, name, description = '', category = 'General', unit_of_measure = 'ea',
          unit_cost = 0, reorder_point = 0, reorder_qty = 0, lead_time_days = 7 } = req.body;
  if (!sku || !name) return res.status(400).json({ error: 'sku and name required' });
  const existing = db.prepare('SELECT id FROM items WHERE sku = ? AND company_id = ?').get(sku, req.companyId);
  if (existing) return res.status(409).json({ error: 'SKU already exists' });
  const id = uuidv4();
  db.prepare(`INSERT INTO items (id, sku, name, description, category, unit_of_measure, unit_cost, reorder_point, reorder_qty, lead_time_days, company_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(id, sku, name, description, category, unit_of_measure, unit_cost, reorder_point, reorder_qty, lead_time_days, req.companyId);
  res.status(201).json(getItemWithStock(id, req.companyId));
});

// ─── PUT /items/:id ───────────────────────────────────────────────────────────

router.put('/items/:id', (req, res) => {
  const item = db.prepare('SELECT * FROM items WHERE id = ? AND company_id = ?').get(req.params.id, req.companyId);
  if (!item) return res.status(404).json({ error: 'Not found' });
  const fields = ['sku','name','description','category','unit_of_measure','unit_cost','reorder_point','reorder_qty','lead_time_days','is_active'];
  const updates = {};
  for (const f of fields) if (req.body[f] !== undefined) updates[f] = req.body[f];
  if (Object.keys(updates).length === 0) return res.json(getItemWithStock(req.params.id, req.companyId));
  const sets = Object.keys(updates).map(k => `${k} = ?`).join(', ');
  db.prepare(`UPDATE items SET ${sets}, updated_at = datetime('now') WHERE id = ?`).run(...Object.values(updates), req.params.id);
  res.json(getItemWithStock(req.params.id, req.companyId));
});

// ─── DELETE /items/:id ────────────────────────────────────────────────────────

router.delete('/items/:id', (req, res) => {
  const item = db.prepare('SELECT * FROM items WHERE id = ? AND company_id = ?').get(req.params.id, req.companyId);
  if (!item) return res.status(404).json({ error: 'Not found' });
  db.prepare("UPDATE items SET is_active = 0, updated_at = datetime('now') WHERE id = ?").run(req.params.id);
  res.json({ success: true });
});

// ─── GET /locations ───────────────────────────────────────────────────────────

router.get('/locations', (req, res) => {
  let sql = `
    SELECT l.*, COUNT(DISTINCT sl.item_id) as item_count, COALESCE(SUM(sl.quantity), 0) as total_units
    FROM locations l LEFT JOIN stock_levels sl ON sl.location_id = l.id
    WHERE l.is_active = 1 AND l.company_id = ?
  `;
  const params = [req.companyId];
  if (req.query.site_id) { sql += ' AND l.site_id = ?'; params.push(req.query.site_id); }
  sql += ' GROUP BY l.id ORDER BY l.name';
  const locs = db.prepare(sql).all(...params);
  res.json(locs);
});

// ─── POST /locations ──────────────────────────────────────────────────────────

router.post('/locations', (req, res) => {
  const { name, code, description = '', type = 'warehouse', site_id = null } = req.body;
  if (!name || !code) return res.status(400).json({ error: 'name and code required' });
  const existing = db.prepare('SELECT id FROM locations WHERE code = ? AND company_id = ?').get(code, req.companyId);
  if (existing) return res.status(409).json({ error: 'Location code already exists' });
  const id = uuidv4();
  db.prepare(`INSERT INTO locations (id, name, code, description, type, company_id, site_id) VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .run(id, name, code, description, type, req.companyId, site_id || null);
  res.status(201).json(db.prepare('SELECT * FROM locations WHERE id = ?').get(id));
});

// ─── PUT /locations/:id ───────────────────────────────────────────────────────

router.put('/locations/:id', (req, res) => {
  const loc = db.prepare('SELECT * FROM locations WHERE id = ? AND company_id = ?').get(req.params.id, req.companyId);
  if (!loc) return res.status(404).json({ error: 'Not found' });
  const { name, code, description, type, is_active } = req.body;
  const site_id = req.body.site_id !== undefined ? (req.body.site_id || null) : loc.site_id;
  db.prepare(`UPDATE locations SET name=COALESCE(?,name), code=COALESCE(?,code), description=COALESCE(?,description), type=COALESCE(?,type), is_active=COALESCE(?,is_active), site_id=? WHERE id=?`)
    .run(name, code, description, type, is_active, site_id, req.params.id);
  res.json(db.prepare('SELECT * FROM locations WHERE id = ?').get(req.params.id));
});

// ─── DELETE /locations/:id ────────────────────────────────────────────────────

router.delete('/locations/:id', (req, res) => {
  db.prepare("UPDATE locations SET is_active = 0 WHERE id = ? AND company_id = ?").run(req.params.id, req.companyId);
  res.json({ success: true });
});

// ─── POST /movements ──────────────────────────────────────────────────────────

router.post('/movements', (req, res) => {
  const { item_id, location_id, movement_type, quantity, unit_cost = 0,
          reference_type = '', reference_id = '', notes = '', operator_name = '' } = req.body;
  if (!item_id || !movement_type || quantity === undefined) {
    return res.status(400).json({ error: 'item_id, movement_type, quantity required' });
  }
  const item = db.prepare('SELECT * FROM items WHERE id = ? AND company_id = ?').get(item_id, req.companyId);
  if (!item) return res.status(404).json({ error: 'Item not found' });
  if (location_id) {
    const loc = db.prepare('SELECT id FROM locations WHERE id = ? AND company_id = ?').get(location_id, req.companyId);
    if (!loc) return res.status(404).json({ error: 'Location not found' });
  }

  const validTypes = ['receive', 'consume', 'adjust', 'transfer', 'ship', 'scrap', 'return'];
  if (!validTypes.includes(movement_type)) return res.status(400).json({ error: `movement_type must be one of: ${validTypes.join(', ')}` });

  const id = uuidv4();
  const qty = parseFloat(quantity);
  const signedQty = ['receive', 'return'].includes(movement_type) ? Math.abs(qty)
    : ['consume', 'ship', 'scrap'].includes(movement_type) ? -Math.abs(qty)
    : qty; // adjust and transfer use signed quantity as-is

  db.prepare(`INSERT INTO stock_movements (id, item_id, location_id, movement_type, quantity, unit_cost, reference_type, reference_id, notes, operator_name) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(id, item_id, location_id || null, movement_type, signedQty, unit_cost, reference_type, reference_id, notes, operator_name);

  if (location_id) updateStockLevel(item_id, location_id, signedQty);

  // Fire a low-stock alert the moment total quantity crosses at-or-below the reorder point.
  if (item.reorder_point > 0) {
    const totalAfter = db.prepare('SELECT COALESCE(SUM(quantity),0) as q FROM stock_levels WHERE item_id = ?').get(item_id).q;
    const totalBefore = totalAfter - signedQty;
    if (totalBefore > item.reorder_point && totalAfter <= item.reorder_point) {
      notify(req.companyId, 'inventory.low_stock', {
        body: `${item.name} (${item.sku}) fell to ${totalAfter} ${item.unit_of_measure}, at or below its reorder point of ${item.reorder_point}.`,
      });
      deliverWebhooks(req.companyId, 'inventory.low_stock', { ...item, total_quantity: totalAfter });
    }
  }

  const mov = db.prepare(`
    SELECT sm.*, l.name as location_name FROM stock_movements sm
    LEFT JOIN locations l ON l.id = sm.location_id WHERE sm.id = ?
  `).get(id);
  res.status(201).json(mov);
});

// ─── GET /movements ───────────────────────────────────────────────────────────

router.get('/movements', (req, res) => {
  const { item_id, movement_type, days = 30, limit = 100 } = req.query;
  let sql = `
    SELECT sm.*, i.name as item_name, i.sku, l.name as location_name, l.code as location_code
    FROM stock_movements sm
    JOIN items i ON i.id = sm.item_id
    LEFT JOIN locations l ON l.id = sm.location_id
    WHERE i.company_id = ? AND sm.created_at >= datetime('now', ?)
  `;
  const params = [req.companyId, `-${days} days`];
  if (item_id)       { sql += ' AND sm.item_id = ?';        params.push(item_id); }
  if (movement_type) { sql += ' AND sm.movement_type = ?';  params.push(movement_type); }
  sql += ` ORDER BY sm.created_at DESC LIMIT ?`;
  params.push(parseInt(limit));
  res.json(db.prepare(sql).all(...params));
});

module.exports = router;

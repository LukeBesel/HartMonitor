const express = require('express');
const { v4: uuidv4 } = require('uuid');
const db = require('../db');
const { logActivity } = require('../activity');

const router = express.Router();

const PO_STATUS_LABELS = {
  draft: 'Draft', sent: 'Sent', partial: 'Partially Received', received: 'Received', cancelled: 'Cancelled',
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getPOWithDetails(id, companyId) {
  const po = db.prepare(`
    SELECT po.*, v.name as vendor_name, v.code as vendor_code, v.contact_name, v.email as vendor_email
    FROM purchase_orders po JOIN vendors v ON v.id = po.vendor_id
    WHERE po.id = ? AND po.company_id = ?
  `).get(id, companyId);
  if (!po) return null;
  const lines = db.prepare(`
    SELECT pl.*, i.name as item_name, i.sku, i.unit_of_measure
    FROM po_lines pl JOIN items i ON i.id = pl.item_id
    WHERE pl.po_id = ?
  `).all(id);
  const total_amount = lines.reduce((s, l) => s + l.quantity_ordered * l.unit_cost, 0);
  const total_received = lines.reduce((s, l) => s + l.quantity_received * l.unit_cost, 0);
  return { ...po, lines, total_amount, total_received };
}

function nextPONumber(companyId) {
  const year = new Date().getFullYear();
  const row = db.prepare(`SELECT po_number FROM purchase_orders WHERE company_id = ? AND po_number LIKE 'PO-${year}-%' ORDER BY po_number DESC LIMIT 1`).get(companyId);
  if (!row) return `PO-${year}-001`;
  const last = parseInt(row.po_number.split('-')[2]) || 0;
  return `PO-${year}-${String(last + 1).padStart(3, '0')}`;
}

function ownedPO(req) {
  return db.prepare('SELECT * FROM purchase_orders WHERE id = ? AND company_id = ?').get(req.params.id, req.companyId);
}

// ─── Vendors ─────────────────────────────────────────────────────────────────

router.get('/vendors', (req, res) => {
  const { search, active_only = '1' } = req.query;
  let sql = `
    SELECT v.*, COUNT(po.id) as po_count,
      COALESCE(SUM(CASE WHEN po.status NOT IN ('draft','cancelled') THEN 1 ELSE 0 END), 0) as active_po_count
    FROM vendors v LEFT JOIN purchase_orders po ON po.vendor_id = v.id
  `;
  const where = ['v.company_id = ?'];
  const params = [req.companyId];
  if (active_only === '1') { where.push('v.is_active = 1'); }
  if (search) { where.push('(v.name LIKE ? OR v.code LIKE ?)'); params.push(`%${search}%`, `%${search}%`); }
  sql += ` WHERE ${where.join(' AND ')}`;
  sql += ' GROUP BY v.id ORDER BY v.name';
  res.json(db.prepare(sql).all(...params));
});

router.post('/vendors', (req, res) => {
  const { name, code, contact_name = '', email = '', phone = '', address = '',
          payment_terms = 'net30', lead_time_days = 14, rating = 3, notes = '' } = req.body;
  if (!name || !code) return res.status(400).json({ error: 'name and code required' });
  const existing = db.prepare('SELECT id FROM vendors WHERE code = ? AND company_id = ?').get(code, req.companyId);
  if (existing) return res.status(409).json({ error: 'Vendor code already exists' });
  const id = uuidv4();
  db.prepare(`INSERT INTO vendors (id, name, code, contact_name, email, phone, address, payment_terms, lead_time_days, rating, notes, company_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(id, name, code, contact_name, email, phone, address, payment_terms, lead_time_days, rating, notes, req.companyId);
  res.status(201).json(db.prepare('SELECT * FROM vendors WHERE id = ?').get(id));
});

router.get('/vendors/:id', (req, res) => {
  const v = db.prepare('SELECT * FROM vendors WHERE id = ? AND company_id = ?').get(req.params.id, req.companyId);
  if (!v) return res.status(404).json({ error: 'Not found' });
  const orders = db.prepare('SELECT * FROM purchase_orders WHERE vendor_id = ? ORDER BY order_date DESC LIMIT 20').all(req.params.id);
  res.json({ ...v, orders });
});

router.put('/vendors/:id', (req, res) => {
  const v = db.prepare('SELECT * FROM vendors WHERE id = ? AND company_id = ?').get(req.params.id, req.companyId);
  if (!v) return res.status(404).json({ error: 'Not found' });
  const fields = ['name','code','contact_name','email','phone','address','payment_terms','lead_time_days','rating','notes','is_active'];
  const updates = {};
  for (const f of fields) if (req.body[f] !== undefined) updates[f] = req.body[f];
  if (!Object.keys(updates).length) return res.json(v);
  const sets = Object.keys(updates).map(k => `${k} = ?`).join(', ');
  db.prepare(`UPDATE vendors SET ${sets}, updated_at = datetime('now') WHERE id = ?`).run(...Object.values(updates), req.params.id);
  res.json(db.prepare('SELECT * FROM vendors WHERE id = ?').get(req.params.id));
});

router.delete('/vendors/:id', (req, res) => {
  const v = db.prepare('SELECT id FROM vendors WHERE id = ? AND company_id = ?').get(req.params.id, req.companyId);
  if (!v) return res.status(404).json({ error: 'Not found' });
  const hasPOs = db.prepare("SELECT id FROM purchase_orders WHERE vendor_id = ? AND status NOT IN ('cancelled') LIMIT 1").get(req.params.id);
  if (hasPOs) return res.status(409).json({ error: 'Cannot delete vendor with active purchase orders. Deactivate instead.' });
  db.prepare("UPDATE vendors SET is_active = 0, updated_at = datetime('now') WHERE id = ?").run(req.params.id);
  res.json({ success: true });
});

// ─── Purchase Orders ──────────────────────────────────────────────────────────

router.get('/orders', (req, res) => {
  const { status, vendor_id, search } = req.query;
  let sql = `
    SELECT po.*, v.name as vendor_name, v.code as vendor_code,
      COUNT(pl.id) as line_count,
      COALESCE(SUM(pl.quantity_ordered * pl.unit_cost), 0) as total_amount
    FROM purchase_orders po
    JOIN vendors v ON v.id = po.vendor_id
    LEFT JOIN po_lines pl ON pl.po_id = po.id
  `;
  const where = ['po.company_id = ?'];
  const params = [req.companyId];
  if (status)    { where.push('po.status = ?');   params.push(status); }
  if (vendor_id) { where.push('po.vendor_id = ?');params.push(vendor_id); }
  if (search)    { where.push('(po.po_number LIKE ? OR v.name LIKE ?)'); params.push(`%${search}%`, `%${search}%`); }
  sql += ` WHERE ${where.join(' AND ')}`;
  sql += ' GROUP BY po.id ORDER BY po.order_date DESC';
  res.json(db.prepare(sql).all(...params));
});

router.post('/orders', (req, res) => {
  const { vendor_id, expected_date, notes = '', shipping_cost = 0, lines = [] } = req.body;
  if (!vendor_id) return res.status(400).json({ error: 'vendor_id required' });
  const vendor = db.prepare('SELECT id FROM vendors WHERE id = ? AND company_id = ?').get(vendor_id, req.companyId);
  if (!vendor) return res.status(404).json({ error: 'Vendor not found' });

  const id = uuidv4();
  const po_number = nextPONumber(req.companyId);
  const order_date = new Date().toISOString().slice(0, 10);
  db.prepare(`INSERT INTO purchase_orders (id, po_number, vendor_id, status, order_date, expected_date, shipping_cost, notes, company_id) VALUES (?, ?, ?, 'draft', ?, ?, ?, ?, ?)`)
    .run(id, po_number, vendor_id, order_date, expected_date || null, shipping_cost, notes, req.companyId);

  const ownedItem = db.prepare('SELECT id FROM items WHERE id = ? AND company_id = ?');
  for (const line of lines) {
    if (!line.item_id || !line.quantity_ordered) continue;
    if (!ownedItem.get(line.item_id, req.companyId)) continue;
    db.prepare(`INSERT INTO po_lines (id, po_id, item_id, quantity_ordered, unit_cost, notes) VALUES (?, ?, ?, ?, ?, ?)`)
      .run(uuidv4(), id, line.item_id, line.quantity_ordered, line.unit_cost || 0, line.notes || '');
  }

  logActivity(req.companyId, 'purchase_order', id, 'Purchase order created', req.user?.display_name);
  res.status(201).json(getPOWithDetails(id, req.companyId));
});

router.get('/orders/:id', (req, res) => {
  const po = getPOWithDetails(req.params.id, req.companyId);
  if (!po) return res.status(404).json({ error: 'Not found' });
  res.json(po);
});

router.put('/orders/:id', (req, res) => {
  const po = ownedPO(req);
  if (!po) return res.status(404).json({ error: 'Not found' });
  const { vendor_id, status, expected_date, shipping_cost, notes } = req.body;
  db.prepare(`UPDATE purchase_orders SET vendor_id=COALESCE(?,vendor_id), status=COALESCE(?,status), expected_date=COALESCE(?,expected_date), shipping_cost=COALESCE(?,shipping_cost), notes=COALESCE(?,notes), updated_at=datetime('now') WHERE id=?`)
    .run(vendor_id, status, expected_date, shipping_cost, notes, req.params.id);

  const changes = [];
  if (status !== undefined && status !== po.status) {
    changes.push(`Status changed from ${PO_STATUS_LABELS[po.status] || po.status} to ${PO_STATUS_LABELS[status] || status}`);
  }
  if (expected_date !== undefined && expected_date !== po.expected_date) {
    changes.push(`Expected date changed to ${expected_date || 'not set'}`);
  }
  if (vendor_id !== undefined && vendor_id !== po.vendor_id) {
    const vendorName = db.prepare('SELECT name FROM vendors WHERE id = ?').get(vendor_id)?.name || 'Unknown';
    changes.push(`Vendor changed to ${vendorName}`);
  }
  for (const change of changes) {
    logActivity(req.companyId, 'purchase_order', req.params.id, change, req.user?.display_name);
  }

  res.json(getPOWithDetails(req.params.id, req.companyId));
});

router.delete('/orders/:id', (req, res) => {
  const po = ownedPO(req);
  if (!po) return res.status(404).json({ error: 'Not found' });
  if (!['draft','cancelled'].includes(po.status)) return res.status(409).json({ error: 'Only draft or cancelled orders can be deleted' });
  db.prepare('DELETE FROM purchase_orders WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

// ─── PO Lines ─────────────────────────────────────────────────────────────────

router.post('/orders/:id/lines', (req, res) => {
  const po = ownedPO(req);
  if (!po) return res.status(404).json({ error: 'Not found' });
  if (po.status === 'received') return res.status(409).json({ error: 'Cannot modify a fully received order' });
  const { item_id, quantity_ordered, unit_cost = 0, notes = '' } = req.body;
  if (!item_id || !quantity_ordered) return res.status(400).json({ error: 'item_id and quantity_ordered required' });
  const item = db.prepare('SELECT id FROM items WHERE id = ? AND company_id = ?').get(item_id, req.companyId);
  if (!item) return res.status(404).json({ error: 'Item not found' });
  const lineId = uuidv4();
  db.prepare(`INSERT INTO po_lines (id, po_id, item_id, quantity_ordered, unit_cost, notes) VALUES (?, ?, ?, ?, ?, ?)`)
    .run(lineId, req.params.id, item_id, quantity_ordered, unit_cost, notes);
  db.prepare("UPDATE purchase_orders SET updated_at = datetime('now') WHERE id = ?").run(req.params.id);

  const itemName = db.prepare('SELECT name FROM items WHERE id = ?').get(item_id)?.name || 'item';
  logActivity(req.companyId, 'purchase_order', req.params.id, `Added line: ${quantity_ordered} × ${itemName}`, req.user?.display_name);

  res.status(201).json(getPOWithDetails(req.params.id, req.companyId));
});

router.delete('/orders/:id/lines/:lineId', (req, res) => {
  const po = ownedPO(req);
  if (!po) return res.status(404).json({ error: 'Not found' });
  if (po.status === 'received') return res.status(409).json({ error: 'Cannot modify a fully received order' });
  db.prepare('DELETE FROM po_lines WHERE id = ? AND po_id = ?').run(req.params.lineId, req.params.id);
  res.json(getPOWithDetails(req.params.id, req.companyId));
});

// ─── POST /orders/:id/send ────────────────────────────────────────────────────

router.post('/orders/:id/send', (req, res) => {
  const po = ownedPO(req);
  if (!po) return res.status(404).json({ error: 'Not found' });
  if (po.status !== 'draft') return res.status(409).json({ error: 'Only draft orders can be sent' });
  const lines = db.prepare('SELECT COUNT(*) as c FROM po_lines WHERE po_id = ?').get(req.params.id);
  if (lines.c === 0) return res.status(400).json({ error: 'Cannot send an order with no line items' });
  db.prepare("UPDATE purchase_orders SET status = 'sent', updated_at = datetime('now') WHERE id = ?").run(req.params.id);

  const vendorName = db.prepare('SELECT name FROM vendors WHERE id = ?').get(po.vendor_id)?.name || 'vendor';
  logActivity(req.companyId, 'purchase_order', req.params.id, `Sent to ${vendorName}`, req.user?.display_name);

  res.json(getPOWithDetails(req.params.id, req.companyId));
});

// ─── POST /orders/:id/receive ─────────────────────────────────────────────────

router.post('/orders/:id/receive', (req, res) => {
  const po = ownedPO(req);
  if (!po) return res.status(404).json({ error: 'Not found' });
  if (['draft','cancelled','received'].includes(po.status)) {
    return res.status(409).json({ error: `Cannot receive items on a ${po.status} order` });
  }

  // receipts: array of { line_id, quantity_received, location_id }
  const { receipts = [], operator_name = '', location_id } = req.body;
  if (!receipts.length) return res.status(400).json({ error: 'receipts array required' });

  const now = new Date().toISOString();
  const receivedDescriptions = [];

  for (const r of receipts) {
    if (!r.line_id || !r.quantity_received) continue;
    const line = db.prepare('SELECT * FROM po_lines WHERE id = ? AND po_id = ?').get(r.line_id, req.params.id);
    if (!line) continue;

    const qty = Math.min(r.quantity_received, line.quantity_ordered - line.quantity_received);
    if (qty <= 0) continue;

    db.prepare('UPDATE po_lines SET quantity_received = quantity_received + ? WHERE id = ?').run(qty, r.line_id);

    const itemName = db.prepare('SELECT name FROM items WHERE id = ?').get(line.item_id)?.name || 'item';
    receivedDescriptions.push(`${qty} × ${itemName}`);

    const locId = r.location_id || location_id;
    if (locId) {
      const existing = db.prepare('SELECT id, quantity FROM stock_levels WHERE item_id = ? AND location_id = ?').get(line.item_id, locId);
      if (existing) {
        db.prepare("UPDATE stock_levels SET quantity = quantity + ?, updated_at = datetime('now') WHERE id = ?").run(qty, existing.id);
      } else {
        db.prepare("INSERT INTO stock_levels (id, item_id, location_id, quantity) VALUES (?, ?, ?, ?)").run(uuidv4(), line.item_id, locId, qty);
      }
      db.prepare(`INSERT INTO stock_movements (id, item_id, location_id, movement_type, quantity, unit_cost, reference_type, reference_id, notes, operator_name, created_at) VALUES (?, ?, ?, 'receive', ?, ?, 'purchase_order', ?, ?, ?, ?)`)
        .run(uuidv4(), line.item_id, locId, qty, line.unit_cost, req.params.id, `Received on ${po.po_number}`, operator_name, now);
    }
  }

  // Check if all lines are fully received
  const remaining = db.prepare('SELECT SUM(quantity_ordered - quantity_received) as rem FROM po_lines WHERE po_id = ?').get(req.params.id).rem;
  const newStatus = remaining <= 0 ? 'received' : 'partial';
  db.prepare(`UPDATE purchase_orders SET status = ?, received_date = ?, updated_at = datetime('now') WHERE id = ?`)
    .run(newStatus, remaining <= 0 ? now : po.received_date, req.params.id);

  if (receivedDescriptions.length) {
    const suffix = newStatus === 'received' ? ' (order fully received)' : '';
    logActivity(req.companyId, 'purchase_order', req.params.id, `Received ${receivedDescriptions.join(', ')}${suffix}`, req.user?.display_name || operator_name);
  }

  res.json(getPOWithDetails(req.params.id, req.companyId));
});

// ─── GET /summary ─────────────────────────────────────────────────────────────

router.get('/summary', (req, res) => {
  const by_status = db.prepare(`
    SELECT status, COUNT(*) as count,
      COALESCE(SUM(pl.quantity_ordered * pl.unit_cost), 0) as value
    FROM purchase_orders po LEFT JOIN po_lines pl ON pl.po_id = po.id
    WHERE po.company_id = ?
    GROUP BY status
  `).all(req.companyId);
  const total_vendors = db.prepare('SELECT COUNT(*) as c FROM vendors WHERE is_active = 1 AND company_id = ?').get(req.companyId).c;
  const open_pos = db.prepare("SELECT COUNT(*) as c FROM purchase_orders WHERE company_id = ? AND status IN ('draft','sent','partial')").get(req.companyId).c;
  res.json({ by_status, total_vendors, open_pos });
});

module.exports = router;

// ─── Kits: one per work order, generated from the active BOM ─────────────────
// Mounted at /api/kits behind requireAuth (req.companyId set). Quantities, SKUs
// and scan codes are snapshotted at generation (Katana MO pattern) so later BOM
// edits never mutate an in-flight kit.
//
// Stock consumption reuses the existing stock_movements ledger:
//   movement_type='consume', reference_type='kit', reference_id=kit_id.
// Consumption is exactly-once per line — written on the first transition into
// picked/verified with qty > 0 (detected via a per-line marker in the movement
// notes), so verifying an already-picked line writes no second movement.

const express = require('express');
const { v4: uuidv4 } = require('uuid');
const db = require('../db');
const { requireRole } = require('../middleware/auth');
const { logActivity } = require('../activity');
const { deliverWebhooks } = require('../webhooks');

const router = express.Router();

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getKitHeader(id, companyId) {
  return db.prepare(`
    SELECT k.*, wo.work_order_number, wo.part_name, wo.part_number, wo.quantity AS wo_quantity
    FROM kits k
    JOIN work_orders wo ON wo.id = k.work_order_id
    WHERE k.id = ? AND k.company_id = ?
  `).get(id, companyId);
}

function getKitLines(kitId) {
  return db.prepare('SELECT * FROM kit_lines WHERE kit_id = ? ORDER BY sort_order ASC').all(kitId);
}

function kitWithLines(id, companyId) {
  const kit = getKitHeader(id, companyId);
  if (!kit) return null;
  return { ...kit, lines: getKitLines(id) };
}

// Recompute the kit's rollup status from its lines:
//   'complete' when every line is verified/picked; 'short' if any line short;
//   'picking' once any progress exists; 'open' while everything is pending.
function recomputeKitStatus(kitId) {
  const lines = db.prepare('SELECT status FROM kit_lines WHERE kit_id = ?').all(kitId);
  let status = 'open';
  if (lines.length > 0) {
    if (lines.some(l => l.status === 'short')) status = 'short';
    else if (lines.every(l => l.status === 'verified' || l.status === 'picked')) status = 'complete';
    else if (lines.some(l => l.status !== 'pending')) status = 'picking';
  }
  db.prepare(`UPDATE kits SET status = ?, updated_at = datetime('now') WHERE id = ?`).run(status, kitId);
  return status;
}

function actorName(req) {
  const bodyActor = req.body && typeof req.body.actor === 'string' ? req.body.actor.trim() : '';
  return bodyActor || req.user?.display_name || req.user?.email || '';
}

// ─── POST /generate — create kit + lines from the WO's active BOM ─────────────

router.post('/generate', requireRole('supervisor'), (req, res) => {
  const { work_order_id, location_id } = req.body || {};
  if (!work_order_id) return res.status(400).json({ error: 'work_order_id required' });

  const wo = db.prepare('SELECT * FROM work_orders WHERE id = ? AND company_id = ?')
    .get(work_order_id, req.companyId);
  if (!wo) return res.status(404).json({ error: 'Work order not found' });

  const existing = db.prepare('SELECT * FROM kits WHERE work_order_id = ? AND company_id = ?')
    .get(work_order_id, req.companyId);
  if (existing && existing.status !== 'cancelled') {
    return res.status(409).json({ error: 'A kit already exists for this work order', code: 'KIT_EXISTS', kit_id: existing.id });
  }

  if (!wo.product_type_id) {
    return res.status(422).json({ error: 'Work order has no product type — cannot resolve a BOM', code: 'NO_PRODUCT_TYPE' });
  }

  const bom = db.prepare(`
    SELECT * FROM boms
    WHERE company_id = ? AND product_type_id = ? AND status = 'active'
    ORDER BY version DESC LIMIT 1
  `).get(req.companyId, wo.product_type_id);
  if (!bom) {
    return res.status(422).json({ error: 'No active BOM for this work order’s product type', code: 'NO_ACTIVE_BOM' });
  }

  let safeLocationId = null;
  if (location_id) {
    const loc = db.prepare('SELECT id FROM locations WHERE id = ? AND company_id = ?').get(location_id, req.companyId);
    if (!loc) return res.status(404).json({ error: 'Location not found' });
    safeLocationId = location_id;
  }

  const bomLines = db.prepare(`
    SELECT bl.*, i.name AS item_name, i.sku AS item_sku
    FROM bom_lines bl JOIN items i ON i.id = bl.item_id
    WHERE bl.bom_id = ? ORDER BY bl.sort_order ASC
  `).all(bom.id);

  const kitId = uuidv4();
  const createdBy = req.user?.display_name || '';
  const apply = db.transaction(() => {
    // A cancelled kit (zero picks by invariant) is replaced in-place so the
    // one-kit-per-WO UNIQUE(company_id, work_order_id) constraint holds.
    if (existing) db.prepare('DELETE FROM kits WHERE id = ?').run(existing.id);

    db.prepare(`
      INSERT INTO kits (id, company_id, work_order_id, bom_id, bom_version, status, location_id, created_by)
      VALUES (?, ?, ?, ?, ?, 'open', ?, ?)
    `).run(kitId, req.companyId, work_order_id, bom.id, bom.version, safeLocationId, createdBy);

    const ins = db.prepare(`
      INSERT INTO kit_lines (id, kit_id, company_id, bom_line_id, item_id, item_name, sku,
                             qty_required, unit, scan_code, reference, step_id, sort_order, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const bl of bomLines) {
      ins.run(
        uuidv4(), kitId, req.companyId, bl.id, bl.item_id, bl.item_name, bl.item_sku,
        wo.quantity * bl.qty_per, bl.unit || 'ea',
        bl.scan_code || bl.item_sku,           // resolved at generation
        bl.reference || '', bl.step_id || '', bl.sort_order, bl.notes || ''
      );
    }
  });
  apply();

  const kit = kitWithLines(kitId, req.companyId);
  logActivity(req.companyId, 'kit', kitId, `Kit generated for ${wo.work_order_number} (BOM v${bom.version})`, createdBy);
  deliverWebhooks(req.companyId, 'kit.generated', kit);
  res.status(201).json(kit);
});

// ─── GET / — list kits with progress rollup ───────────────────────────────────

router.get('/', requireRole('operator'), (req, res) => {
  const { work_order_id, status } = req.query;
  const conditions = ['k.company_id = ?'];
  const params = [req.companyId];
  if (work_order_id) { conditions.push('k.work_order_id = ?'); params.push(work_order_id); }
  if (status)        { conditions.push('k.status = ?');        params.push(status); }

  // One grouped join over kit_lines instead of four correlated COUNT subqueries
  // per kit row — the status rollup falls out of conditional aggregation.
  const rows = db.prepare(`
    SELECT k.*, wo.work_order_number, wo.part_name, wo.part_number,
           COUNT(kl.id) AS n_total,
           COALESCE(SUM(CASE WHEN kl.status = 'verified' THEN 1 ELSE 0 END), 0) AS n_verified,
           COALESCE(SUM(CASE WHEN kl.status = 'picked'   THEN 1 ELSE 0 END), 0) AS n_picked,
           COALESCE(SUM(CASE WHEN kl.status = 'short'    THEN 1 ELSE 0 END), 0) AS n_short
    FROM kits k
    JOIN work_orders wo ON wo.id = k.work_order_id
    LEFT JOIN kit_lines kl ON kl.kit_id = k.id
    WHERE ${conditions.join(' AND ')}
    GROUP BY k.id
    ORDER BY k.created_at DESC
  `).all(...params);
  res.json(rows.map(r => ({ ...r, has_short: r.n_short > 0 })));
});

// ─── GET /:id — header + lines ────────────────────────────────────────────────

router.get('/:id', requireRole('operator'), (req, res) => {
  const kit = kitWithLines(req.params.id, req.companyId);
  if (!kit) return res.status(404).json({ error: 'Not found' });
  res.json(kit);
});

// ─── PUT /:id/lines/:lineId — pick / verify / short a line ────────────────────
// Legal transitions: pending→picked|verified|short, picked→verified|short,
// short→picked. The first pick/verify with qty>0 writes the consume movement
// and stock decrement in the same transaction (exactly-once per line).

const LINE_TRANSITIONS = {
  pending:  ['picked', 'verified', 'short'],
  picked:   ['verified', 'short'],
  short:    ['picked'],
  verified: [],
};

router.put('/:id/lines/:lineId', requireRole('operator'), (req, res) => {
  const kit = db.prepare('SELECT * FROM kits WHERE id = ? AND company_id = ?').get(req.params.id, req.companyId);
  if (!kit) return res.status(404).json({ error: 'Not found' });
  if (kit.status === 'cancelled') return res.status(409).json({ error: 'Kit is cancelled', code: 'KIT_CANCELLED' });

  const line = db.prepare('SELECT * FROM kit_lines WHERE id = ? AND kit_id = ? AND company_id = ?')
    .get(req.params.lineId, kit.id, req.companyId);
  if (!line) return res.status(404).json({ error: 'Not found' });

  const { status, qty_picked, short_reason } = req.body || {};
  if (!status || !Object.prototype.hasOwnProperty.call(LINE_TRANSITIONS, status)) {
    return res.status(400).json({ error: `status must be one of: ${Object.keys(LINE_TRANSITIONS).join(', ')}` });
  }
  if (status !== line.status && !LINE_TRANSITIONS[line.status].includes(status)) {
    return res.status(409).json({
      error: `Illegal transition ${line.status} → ${status}`,
      code: 'ILLEGAL_TRANSITION', from: line.status, to: status,
    });
  }

  let qty = line.qty_picked;
  if (qty_picked !== undefined) {
    qty = Number(qty_picked);
    if (!Number.isFinite(qty) || qty < 0) return res.status(400).json({ error: 'qty_picked must be a non-negative number' });
  } else if ((status === 'picked' || status === 'verified') && line.qty_picked === 0) {
    qty = line.qty_required;           // default: full pick
  }

  const actor = actorName(req);
  const now = new Date().toISOString();
  const consumeMarker = `kit_line:${line.id}`;

  const apply = db.transaction(() => {
    const updates = {
      status,
      qty_picked: qty,
      short_reason: status === 'short' ? String(short_reason ?? '') : line.short_reason,
      picked_by: line.picked_by,
      picked_at: line.picked_at,
      verified_by: line.verified_by,
      verified_at: line.verified_at,
    };
    if ((status === 'picked' || status === 'verified') && line.status !== 'picked' && line.status !== 'verified') {
      updates.picked_by = actor;
      updates.picked_at = now;
    }
    if (status === 'verified') {
      updates.verified_by = actor;
      updates.verified_at = now;
    }
    db.prepare(`
      UPDATE kit_lines SET status=?, qty_picked=?, short_reason=?, picked_by=?, picked_at=?, verified_by=?, verified_at=?
      WHERE id=?
    `).run(updates.status, updates.qty_picked, updates.short_reason, updates.picked_by, updates.picked_at,
           updates.verified_by, updates.verified_at, line.id);

    // ── Inventory reconciliation (idempotent, delta-based) ───────────────────
    // The ledger must always agree with the line: whatever quantity the line
    // says was physically taken from the bin is what inventory shows consumed.
    // A SHORT line with a partial qty_picked still consumed that material, and
    // revising a quantity down (picked 10 → short 4) must give the difference
    // back. So instead of a one-shot "consume once" marker we compute the net
    // already booked against this line and post only the delta.
    const netBooked = db.prepare(`
      SELECT COALESCE(SUM(quantity), 0) AS q FROM stock_movements
      WHERE reference_type = 'kit' AND reference_id = ? AND notes = ?
    `).get(kit.id, consumeMarker).q;
    const consumedSoFar = -netBooked;                  // movements are signed (consume < 0)
    // pending lines have released nothing; every other state owns qty_picked.
    const targetConsumed = status === 'pending' ? 0 : Math.max(0, qty);
    const delta = targetConsumed - consumedSoFar;      // >0 take more, <0 give back

    if (Math.abs(delta) > 1e-9) {
      db.prepare(`
        INSERT INTO stock_movements (id, item_id, location_id, movement_type, quantity, unit_cost,
                                     reference_type, reference_id, notes, operator_name, created_by)
        VALUES (?, ?, ?, ?, ?, 0, 'kit', ?, ?, ?, ?)
      `).run(uuidv4(), line.item_id, kit.location_id || null,
             delta > 0 ? 'consume' : 'return', -delta, kit.id, consumeMarker, actor, actor);

      if (kit.location_id) {
        const sl = db.prepare('SELECT id FROM stock_levels WHERE item_id = ? AND location_id = ?')
          .get(line.item_id, kit.location_id);
        if (sl) {
          db.prepare(`UPDATE stock_levels SET quantity = quantity - ?, updated_at = datetime('now') WHERE id = ?`)
            .run(delta, sl.id);
        } else {
          db.prepare('INSERT INTO stock_levels (id, item_id, location_id, quantity) VALUES (?, ?, ?, ?)')
            .run(uuidv4(), line.item_id, kit.location_id, -delta);
        }
      }
    }
  });
  apply();

  const prevKitStatus = kit.status;
  const newKitStatus = recomputeKitStatus(kit.id);
  const fresh = kitWithLines(kit.id, req.companyId);

  if (newKitStatus !== prevKitStatus) {
    if (newKitStatus === 'short')    deliverWebhooks(req.companyId, 'kit.short', fresh);
    if (newKitStatus === 'complete') deliverWebhooks(req.companyId, 'kit.completed', fresh);
  }
  if (status === 'short') {
    logActivity(req.companyId, 'kit', kit.id, `Line ${line.sku || line.item_name} marked short`, actor);
  }

  res.json({ ...fresh, line: fresh.lines.find(l => l.id === line.id) });
});

// ─── POST /:id/verify — final check + stamp ───────────────────────────────────

router.post('/:id/verify', requireRole('operator'), (req, res) => {
  const kit = db.prepare('SELECT * FROM kits WHERE id = ? AND company_id = ?').get(req.params.id, req.companyId);
  if (!kit) return res.status(404).json({ error: 'Not found' });

  const lines = getKitLines(kit.id);
  const offending = lines.filter(l => l.status !== 'verified' && l.status !== 'picked');
  if (offending.length > 0) {
    return res.status(409).json({
      error: 'Kit is not complete',
      code: 'KIT_INCOMPLETE',
      offending_lines: offending.map(l => ({ id: l.id, sku: l.sku, item_name: l.item_name, status: l.status })),
    });
  }

  const actor = actorName(req);
  db.prepare(`UPDATE kits SET status='complete', verified_by=?, verified_at=?, updated_at=datetime('now') WHERE id=?`)
    .run(actor, new Date().toISOString(), kit.id);

  const fresh = kitWithLines(kit.id, req.companyId);
  if (kit.status !== 'complete') deliverWebhooks(req.companyId, 'kit.completed', fresh);
  logActivity(req.companyId, 'kit', kit.id, 'Kit verified', actor);
  res.json(fresh);
});

// ─── DELETE /:id — cancel (only open, zero picks) ─────────────────────────────

router.delete('/:id', requireRole('supervisor'), (req, res) => {
  const kit = db.prepare('SELECT * FROM kits WHERE id = ? AND company_id = ?').get(req.params.id, req.companyId);
  if (!kit) return res.status(404).json({ error: 'Not found' });

  const picks = db.prepare(`
    SELECT COUNT(*) AS c FROM kit_lines WHERE kit_id = ? AND (status != 'pending' OR qty_picked > 0)
  `).get(kit.id).c;
  if (kit.status !== 'open' || picks > 0) {
    return res.status(409).json({ error: 'Only an open kit with zero picks can be cancelled', code: 'KIT_IN_PROGRESS' });
  }

  db.prepare(`UPDATE kits SET status='cancelled', updated_at=datetime('now') WHERE id=?`).run(kit.id);
  logActivity(req.companyId, 'kit', kit.id, 'Kit cancelled', req.user?.display_name);
  res.json({ success: true, status: 'cancelled' });
});

module.exports = router;

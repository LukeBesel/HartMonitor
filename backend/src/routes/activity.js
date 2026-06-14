const express = require('express');
const db = require('../db');

const router = express.Router();

const VALID_TYPES = ['work_order', 'purchase_order', 'ncr'];

// ─── GET /:entityType/:entityId - activity history for one entity ────────────

router.get('/:entityType/:entityId', (req, res) => {
  const { entityType, entityId } = req.params;
  if (!VALID_TYPES.includes(entityType)) return res.status(400).json({ error: 'Invalid entity type' });

  const rows = db.prepare(`
    SELECT id, action, actor, created_at FROM activity_log
    WHERE entity_type = ? AND entity_id = ? AND company_id = ?
    ORDER BY created_at DESC
  `).all(entityType, entityId, req.companyId);

  res.json(rows);
});

module.exports = router;

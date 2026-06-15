const { v4: uuidv4 } = require('uuid');
const db = require('./db');

// Records a human-readable activity entry for a work order, purchase order, or NCR.
// `meta` optionally scopes the entry to a department/station so the transaction log
// can be filtered by those dimensions.
function logActivity(companyId, entityType, entityId, action, actor, meta = {}) {
  db.prepare(`
    INSERT INTO activity_log (id, company_id, entity_type, entity_id, action, actor, department_id, station_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    uuidv4(), companyId, entityType, entityId, action, actor || 'System',
    meta.department_id || null, meta.station_id || null,
  );
}

module.exports = { logActivity };

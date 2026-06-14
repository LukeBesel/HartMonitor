const { v4: uuidv4 } = require('uuid');
const db = require('./db');

// Records a human-readable activity entry for a work order, purchase order, or NCR.
function logActivity(companyId, entityType, entityId, action, actor) {
  db.prepare(`
    INSERT INTO activity_log (id, company_id, entity_type, entity_id, action, actor)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(uuidv4(), companyId, entityType, entityId, action, actor || 'System');
}

module.exports = { logActivity };

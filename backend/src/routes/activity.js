const express = require('express');
const db = require('../db');
const { requireRole } = require('../middleware/auth');

const router = express.Router();

const VALID_TYPES = [
  'work_order', 'purchase_order', 'ncr', 'site', 'app', 'dashboard',
  'station', 'department', 'user', 'plan', 'inventory_item', 'vendor',
  'webhook', 'api_key', 'settings',
];

// ─── CSV helpers ──────────────────────────────────────────────────────────────

function escapeCSV(val) {
  if (val === null || val === undefined) return '';
  const s = String(val);
  if (s.includes(',') || s.includes('"') || s.includes('\n')) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function toCSV(rows, columns) {
  if (!rows.length) return columns.join(',') + '\n';
  const header = columns.join(',');
  const body = rows.map(r => columns.map(c => escapeCSV(r[c])).join(',')).join('\n');
  return `${header}\n${body}`;
}

// ─── GET / - org-wide audit log, filterable (supervisor+) ──────────────────────
// Query params: entity_type, actor, from (date), to (date), department_id, station_id, limit

router.get('/', requireRole('supervisor'), (req, res) => {
  const { entity_type, actor, from, to, department_id, station_id } = req.query;
  const limit = Math.min(parseInt(req.query.limit) || 100, 1000);

  const clauses = ['company_id = ?'];
  const params = [req.companyId];
  if (entity_type && VALID_TYPES.includes(entity_type)) { clauses.push('entity_type = ?'); params.push(entity_type); }
  if (actor) { clauses.push('actor LIKE ?'); params.push(`%${actor}%`); }
  if (from) { clauses.push('created_at >= ?'); params.push(from); }
  if (to) { clauses.push('created_at <= ?'); params.push(to); }
  if (department_id) { clauses.push('department_id = ?'); params.push(department_id); }
  if (station_id) { clauses.push('station_id = ?'); params.push(station_id); }
  params.push(limit);

  const rows = db.prepare(`
    SELECT id, entity_type, entity_id, action, actor, created_at FROM activity_log
    WHERE ${clauses.join(' AND ')}
    ORDER BY created_at DESC LIMIT ?
  `).all(...params);

  res.json(rows);
});

// ─── GET /export - audit log as CSV (supervisor+) ──────────────────────────────

router.get('/export', requireRole('supervisor'), (req, res) => {
  const { entity_type, actor, from, to, department_id, station_id } = req.query;

  const clauses = ['company_id = ?'];
  const params = [req.companyId];
  if (entity_type && VALID_TYPES.includes(entity_type)) { clauses.push('entity_type = ?'); params.push(entity_type); }
  if (actor) { clauses.push('actor LIKE ?'); params.push(`%${actor}%`); }
  if (from) { clauses.push('created_at >= ?'); params.push(from); }
  if (to) { clauses.push('created_at <= ?'); params.push(to); }
  if (department_id) { clauses.push('department_id = ?'); params.push(department_id); }
  if (station_id) { clauses.push('station_id = ?'); params.push(station_id); }

  const rows = db.prepare(`
    SELECT created_at, entity_type, entity_id, action, actor FROM activity_log
    WHERE ${clauses.join(' AND ')}
    ORDER BY created_at DESC LIMIT 10000
  `).all(...params);

  const csv = toCSV(rows, ['created_at', 'entity_type', 'entity_id', 'action', 'actor']);
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="audit-log-${new Date().toISOString().slice(0,10)}.csv"`);
  res.send('﻿' + csv);
});

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

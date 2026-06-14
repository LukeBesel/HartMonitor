const express = require('express');
const db = require('../db');

const router = express.Router();

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

function sendCSV(res, filename, csv) {
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send('﻿' + csv); // BOM for Excel UTF-8 compatibility
}

// ─── GET /completions ─────────────────────────────────────────────────────────

router.get('/completions', (req, res) => {
  const { days = 90 } = req.query;
  const rows = db.prepare(`
    SELECT c.id, c.app_name, s.name as station_name, c.operator_name,
           c.started_at, c.completed_at, c.status,
           ROUND((julianday(c.completed_at)-julianday(c.started_at))*1440, 1) as cycle_time_minutes,
           wo.work_order_number, c.takt_exceeded_steps
    FROM completions c
    LEFT JOIN stations s ON s.id = c.station_id
    LEFT JOIN work_orders wo ON wo.id = c.work_order_id
    WHERE c.company_id = ? AND c.started_at >= datetime('now', ?)
    ORDER BY c.started_at DESC
  `).all(req.companyId, `-${days} days`);
  const cols = ['id','app_name','station_name','operator_name','started_at','completed_at','status','cycle_time_minutes','work_order_number','takt_exceeded_steps'];
  sendCSV(res, `completions-${new Date().toISOString().slice(0,10)}.csv`, toCSV(rows, cols));
});

// ─── GET /work-orders ─────────────────────────────────────────────────────────

router.get('/work-orders', (req, res) => {
  const rows = db.prepare(`
    SELECT wo.work_order_number, wo.part_number, wo.part_name, wo.quantity, wo.quantity_completed,
           wo.status, wo.priority, wo.scheduled_start, wo.scheduled_end, wo.takt_time_minutes,
           d.name as department, a.name as app_name, wo.notes, wo.created_at, wo.updated_at
    FROM work_orders wo
    LEFT JOIN departments d ON d.id = wo.department_id
    LEFT JOIN apps a ON a.id = wo.app_id
    WHERE wo.company_id = ?
    ORDER BY wo.created_at DESC
  `).all(req.companyId);
  const cols = ['work_order_number','part_number','part_name','quantity','quantity_completed','status','priority','scheduled_start','scheduled_end','takt_time_minutes','department','app_name','notes','created_at','updated_at'];
  sendCSV(res, `work-orders-${new Date().toISOString().slice(0,10)}.csv`, toCSV(rows, cols));
});

// ─── GET /inventory ───────────────────────────────────────────────────────────

router.get('/inventory', (req, res) => {
  const rows = db.prepare(`
    SELECT i.sku, i.name, i.description, i.category, i.unit_of_measure,
           i.unit_cost, COALESCE(SUM(sl.quantity),0) as total_quantity,
           ROUND(i.unit_cost * COALESCE(SUM(sl.quantity),0), 2) as total_value,
           i.reorder_point, i.reorder_qty, i.lead_time_days,
           CASE WHEN COALESCE(SUM(sl.quantity),0) <= i.reorder_point THEN 'LOW STOCK' ELSE 'OK' END as stock_status,
           i.created_at, i.updated_at
    FROM items i LEFT JOIN stock_levels sl ON sl.item_id = i.id
    WHERE i.is_active = 1 AND i.company_id = ? GROUP BY i.id ORDER BY i.category, i.name
  `).all(req.companyId);
  const cols = ['sku','name','description','category','unit_of_measure','unit_cost','total_quantity','total_value','reorder_point','reorder_qty','lead_time_days','stock_status','created_at','updated_at'];
  sendCSV(res, `inventory-${new Date().toISOString().slice(0,10)}.csv`, toCSV(rows, cols));
});

// ─── GET /stock-movements ─────────────────────────────────────────────────────

router.get('/stock-movements', (req, res) => {
  const { days = 90 } = req.query;
  const rows = db.prepare(`
    SELECT sm.created_at, i.sku, i.name as item_name, l.name as location, sm.movement_type,
           sm.quantity, sm.unit_cost, sm.reference_type, sm.reference_id, sm.notes, sm.operator_name
    FROM stock_movements sm
    JOIN items i ON i.id = sm.item_id
    LEFT JOIN locations l ON l.id = sm.location_id
    WHERE i.company_id = ? AND sm.created_at >= datetime('now', ?)
    ORDER BY sm.created_at DESC
  `).all(req.companyId, `-${days} days`);
  const cols = ['created_at','sku','item_name','location','movement_type','quantity','unit_cost','reference_type','reference_id','notes','operator_name'];
  sendCSV(res, `stock-movements-${new Date().toISOString().slice(0,10)}.csv`, toCSV(rows, cols));
});

// ─── GET /purchase-orders ─────────────────────────────────────────────────────

router.get('/purchase-orders', (req, res) => {
  const rows = db.prepare(`
    SELECT po.po_number, v.name as vendor, po.status, po.order_date, po.expected_date, po.received_date,
           i.sku, i.name as item_name, pl.quantity_ordered, pl.quantity_received,
           pl.unit_cost, ROUND(pl.quantity_ordered * pl.unit_cost, 2) as line_total,
           po.shipping_cost, po.notes
    FROM purchase_orders po
    JOIN vendors v ON v.id = po.vendor_id
    JOIN po_lines pl ON pl.po_id = po.id
    JOIN items i ON i.id = pl.item_id
    WHERE po.company_id = ?
    ORDER BY po.order_date DESC, po.po_number
  `).all(req.companyId);
  const cols = ['po_number','vendor','status','order_date','expected_date','received_date','sku','item_name','quantity_ordered','quantity_received','unit_cost','line_total','shipping_cost','notes'];
  sendCSV(res, `purchase-orders-${new Date().toISOString().slice(0,10)}.csv`, toCSV(rows, cols));
});

// ─── GET /ncrs ────────────────────────────────────────────────────────────────

router.get('/ncrs', (req, res) => {
  const rows = db.prepare(`
    SELECT n.ncr_number, n.title, n.severity, n.status, n.source,
           a.name as app_name, wo.work_order_number, i.sku as item_sku,
           n.assigned_to, n.root_cause, n.corrective_action,
           n.due_date, n.resolved_at, n.created_at, n.updated_at
    FROM ncrs n
    LEFT JOIN apps a ON a.id = n.app_id
    LEFT JOIN work_orders wo ON wo.id = n.work_order_id
    LEFT JOIN items i ON i.id = n.item_id
    WHERE n.company_id = ?
    ORDER BY n.created_at DESC
  `).all(req.companyId);
  const cols = ['ncr_number','title','severity','status','source','app_name','work_order_number','item_sku','assigned_to','root_cause','corrective_action','due_date','resolved_at','created_at','updated_at'];
  sendCSV(res, `ncrs-${new Date().toISOString().slice(0,10)}.csv`, toCSV(rows, cols));
});

// ─── GET /oee-events ─────────────────────────────────────────────────────────

router.get('/oee-events', (req, res) => {
  const { days = 30 } = req.query;
  const rows = db.prepare(`
    SELECT s.name as station_name, s.location, me.event_type, me.reason,
           me.started_at, me.ended_at, ROUND(me.duration_minutes, 1) as duration_minutes
    FROM machine_events me JOIN stations s ON s.id = me.station_id
    WHERE s.company_id = ? AND me.started_at >= datetime('now', ?)
    ORDER BY me.started_at DESC
  `).all(req.companyId, `-${days} days`);
  const cols = ['station_name','location','event_type','reason','started_at','ended_at','duration_minutes'];
  sendCSV(res, `oee-events-${new Date().toISOString().slice(0,10)}.csv`, toCSV(rows, cols));
});

// ─── GET /apps/:appId/completions — single-app completions CSV ────────────────

router.get('/apps/:appId/completions', (req, res) => {
  const app = db.prepare('SELECT id, name FROM apps WHERE id = ? AND company_id = ?').get(req.params.appId, req.companyId);
  if (!app) return res.status(404).json({ error: 'App not found' });

  const rows = db.prepare(`
    SELECT c.id, c.operator_name, s.name as station_name, c.started_at, c.completed_at, c.status,
           ROUND((julianday(c.completed_at)-julianday(c.started_at))*1440, 1) as cycle_time_minutes,
           wo.work_order_number, c.takt_exceeded_steps, c.data, c.step_times
    FROM completions c
    LEFT JOIN stations s ON s.id = c.station_id
    LEFT JOIN work_orders wo ON wo.id = c.work_order_id
    WHERE c.app_id = ? AND c.company_id = ?
    ORDER BY c.started_at DESC
  `).all(req.params.appId, req.companyId);
  const cols = ['id','operator_name','station_name','started_at','completed_at','status','cycle_time_minutes','work_order_number','takt_exceeded_steps','data','step_times'];
  const safeName = app.name.replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '').toLowerCase() || 'app';
  sendCSV(res, `${safeName}-export-${new Date().toISOString().slice(0,10)}.csv`, toCSV(rows, cols));
});

// ─── GET /apps/:appId/bundle — full JSON bundle for a single app ──────────────

router.get('/apps/:appId/bundle', (req, res) => {
  const app = db.prepare('SELECT * FROM apps WHERE id = ? AND company_id = ?').get(req.params.appId, req.companyId);
  if (!app) return res.status(404).json({ error: 'App not found' });

  const completions = db.prepare(`
    SELECT c.id, c.operator_name, c.station_id, s.name as station_name, c.started_at, c.completed_at, c.status,
           ROUND((julianday(c.completed_at)-julianday(c.started_at))*1440, 1) as cycle_time_minutes,
           wo.work_order_number, c.takt_exceeded_steps, c.data, c.step_times
    FROM completions c
    LEFT JOIN stations s ON s.id = c.station_id
    LEFT JOIN work_orders wo ON wo.id = c.work_order_id
    WHERE c.app_id = ? AND c.company_id = ?
    ORDER BY c.started_at DESC
  `).all(req.params.appId, req.companyId);

  const bundle = {
    exported_at: new Date().toISOString(),
    app: {
      id: app.id, name: app.name, description: app.description, status: app.status,
      steps: JSON.parse(app.steps || '[]'),
      created_at: app.created_at, updated_at: app.updated_at,
    },
    completions: completions.map(c => ({
      ...c,
      takt_exceeded_steps: JSON.parse(c.takt_exceeded_steps || '[]'),
      data: JSON.parse(c.data || '{}'),
      step_times: JSON.parse(c.step_times || '{}'),
    })),
  };
  const safeName = app.name.replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '').toLowerCase() || 'app';
  res.setHeader('Content-Disposition', `attachment; filename="${safeName}-bundle-${new Date().toISOString().slice(0,10)}.json"`);
  res.setHeader('Content-Type', 'application/json');
  res.json(bundle);
});

// ─── GET /all — full JSON bundle ──────────────────────────────────────────────

router.get('/all', (req, res) => {
  const cid = req.companyId;
  const bundle = {
    exported_at: new Date().toISOString(),
    company: (() => {
      const rows = db.prepare('SELECT key, value FROM org_settings WHERE company_id = ?').all(cid);
      const o = {};
      for (const r of rows) o[r.key] = r.value;
      return o;
    })(),
    apps: db.prepare('SELECT id, name, description, status, created_at, updated_at FROM apps WHERE company_id = ?').all(cid),
    work_orders: db.prepare(`
      SELECT wo.*, d.name as department_name, a.name as app_name
      FROM work_orders wo LEFT JOIN departments d ON d.id = wo.department_id LEFT JOIN apps a ON a.id = wo.app_id
      WHERE wo.company_id = ?
      ORDER BY wo.created_at DESC
    `).all(cid),
    completions: db.prepare(`
      SELECT c.id, c.app_name, c.operator_name, c.started_at, c.completed_at, c.status,
             ROUND((julianday(c.completed_at)-julianday(c.started_at))*1440,1) as cycle_time_minutes,
             wo.work_order_number
      FROM completions c LEFT JOIN work_orders wo ON wo.id = c.work_order_id
      WHERE c.company_id = ? AND c.completed_at >= datetime('now', '-90 days')
      ORDER BY c.started_at DESC
    `).all(cid),
    inventory: db.prepare(`
      SELECT i.*, COALESCE(SUM(sl.quantity),0) as total_quantity
      FROM items i LEFT JOIN stock_levels sl ON sl.item_id = i.id WHERE i.is_active=1 AND i.company_id = ? GROUP BY i.id
    `).all(cid),
    vendors: db.prepare('SELECT * FROM vendors WHERE is_active = 1 AND company_id = ?').all(cid),
    purchase_orders: db.prepare(`
      SELECT po.*, v.name as vendor_name FROM purchase_orders po JOIN vendors v ON v.id = po.vendor_id
      WHERE po.company_id = ? ORDER BY po.order_date DESC
    `).all(cid),
    ncrs: db.prepare('SELECT * FROM ncrs WHERE company_id = ? ORDER BY created_at DESC').all(cid),
  };
  res.setHeader('Content-Disposition', `attachment; filename="hartmonitor-export-${new Date().toISOString().slice(0,10)}.json"`);
  res.setHeader('Content-Type', 'application/json');
  res.json(bundle);
});

module.exports = router;

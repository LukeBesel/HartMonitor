// ─── Composable MES: per-company module registry & toggles ────────────────────
// HartMonitor is composed of independent modules a company can switch on/off,
// so a small shop can run Production + Quality only while a big plant enables
// everything. The registry below is the single source of truth for the module
// keys — the frontend mirrors it in frontend/src/context/ModulesContext.tsx
// (keys MUST stay identical between the two).
//
// Semantics:
//   • Absence of a company_modules row  → module ENABLED (default-on, so
//     existing customers see no change).
//   • Core modules (production, analytics) can never be disabled.

const fs = require('fs');
const path = require('path');
const express = require('express');
const db = require('../db');
const { logActivity } = require('../activity');
const { requireRole } = require('../middleware/auth');

// Apply the migration idempotently at load time (db.js owns the rest of the
// schema; this table ships with its own migration file).
db.exec(fs.readFileSync(path.join(__dirname, '..', 'db', 'migrations', '005_company_modules.sql'), 'utf8'));

const router = express.Router();

// ─── Module registry ──────────────────────────────────────────────────────────
// `icon` is a lucide icon name the frontend resolves to a component.
// `minTier` mirrors the plan gating used elsewhere (requirePlan) and only
// drives the `includedInPlan` flag — enable/disable itself is plan-agnostic.

const MODULES = [
  { key: 'production',  name: 'Production',   icon: 'factory',        core: true,  minTier: 'free',
    description: 'Work orders, stations, scheduling, and OEE' },
  { key: 'quality',     name: 'Quality',      icon: 'shield-check',   core: false, minTier: 'pro',
    description: 'NCRs, CAPA, and SQDC boards' },
  { key: 'inventory',   name: 'Inventory',    icon: 'boxes',          core: false, minTier: 'pro',
    description: 'Items, stock, receiving, purchasing, and shipments' },
  { key: 'maintenance', name: 'Maintenance',  icon: 'wrench',         core: false, minTier: 'pro',
    description: 'Assets, PM schedules, and maintenance work orders' },
  { key: 'andon',       name: 'Andon',        icon: 'siren',          core: false, minTier: 'free',
    description: 'Andon calls and alerting' },
  { key: 'kaizen',      name: 'Kaizen',       icon: 'lightbulb',      core: false, minTier: 'free',
    description: 'Continuous improvement ideas' },
  { key: 'training',    name: 'Training',     icon: 'graduation-cap', core: false, minTier: 'pro',
    description: 'Training records and certifications' },
  { key: 'shifts',      name: 'Shifts',       icon: 'clipboard-list', core: false, minTier: 'free',
    description: 'Shift notes and handoff' },
  { key: 'analytics',   name: 'Analytics',    icon: 'bar-chart-3',    core: true,  minTier: 'free',
    description: 'Analytics, capacity planning, and leaderboards' },
  { key: 'apps',        name: 'Apps & Data',  icon: 'app-window',     core: false, minTier: 'free',
    description: 'Custom app builder, tables, and dashboards' },
];

const MODULE_MAP = new Map(MODULES.map(m => [m.key, m]));
const TIER_LEVELS = { free: 0, pro: 1, enterprise: 2 };

// Returns true when the given module is enabled for the company.
// Exported so other routes/middleware can consult module state if needed.
function isModuleEnabled(companyId, key) {
  const mod = MODULE_MAP.get(key);
  if (!mod) return true;              // unknown keys never block anything
  if (mod.core) return true;          // core modules can't be off
  const row = db.prepare(
    'SELECT enabled FROM company_modules WHERE company_id = ? AND module_key = ?'
  ).get(companyId, key);
  return row ? row.enabled === 1 : true;  // no row = enabled (default-on)
}

function listModules(companyId) {
  const tier = db.prepare('SELECT tier FROM plan WHERE company_id = ?').get(companyId)?.tier || 'free';
  const tierLevel = TIER_LEVELS[tier] ?? 0;
  const rows = db.prepare('SELECT module_key, enabled FROM company_modules WHERE company_id = ?').all(companyId);
  const overrides = new Map(rows.map(r => [r.module_key, r.enabled === 1]));

  return MODULES.map(m => ({
    key: m.key,
    name: m.name,
    description: m.description,
    icon: m.icon,
    core: m.core,
    enabled: m.core ? true : (overrides.has(m.key) ? overrides.get(m.key) : true),
    includedInPlan: tierLevel >= (TIER_LEVELS[m.minTier] ?? 0),
  }));
}

// ─── GET /api/modules ─────────────────────────────────────────────────────────
// Any authenticated user — the frontend needs this to build the nav.

router.get('/', (req, res) => {
  res.json(listModules(req.companyId));
});

// ─── PUT /api/modules/:key ────────────────────────────────────────────────────
// Manager+ only. Body: { enabled: boolean }. Core modules cannot be disabled.

router.put('/:key', requireRole('manager'), (req, res) => {
  const key = String(req.params.key || '');
  const mod = MODULE_MAP.get(key);
  if (!mod) return res.status(404).json({ error: 'Unknown module', code: 'UNKNOWN_MODULE' });

  const enabled = req.body?.enabled;
  if (typeof enabled !== 'boolean') {
    return res.status(400).json({ error: 'enabled must be a boolean', code: 'INVALID_BODY' });
  }
  if (mod.core && !enabled) {
    return res.status(400).json({ error: `${mod.name} is a core module and cannot be disabled`, code: 'CORE_MODULE' });
  }

  db.prepare(`
    INSERT INTO company_modules (company_id, module_key, enabled, updated_at)
    VALUES (?, ?, ?, datetime('now'))
    ON CONFLICT(company_id, module_key)
    DO UPDATE SET enabled = excluded.enabled, updated_at = datetime('now')
  `).run(req.companyId, key, enabled ? 1 : 0);

  logActivity(
    req.companyId, 'module', key,
    `Module "${mod.name}" ${enabled ? 'enabled' : 'disabled'}`,
    req.user?.display_name,
  );

  res.json(listModules(req.companyId).find(m => m.key === key));
});

module.exports = router;
module.exports.MODULES = MODULES;
module.exports.isModuleEnabled = isModuleEnabled;

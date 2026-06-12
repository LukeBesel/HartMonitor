const express = require('express');
const { v4: uuidv4 } = require('uuid');
const db = require('../db');
const { requireRole } = require('../middleware/auth');

const router = express.Router();

// ─── Pricing catalog ──────────────────────────────────────────────────────────
// Single source of truth for what each tier and add-on costs. The frontend
// renders directly from this so prices never drift between UI and billing.

const PRICING = {
  tiers: {
    free: {
      name: 'Free',
      monthly_price: 0,
      app_limit: 3,
      dashboard_limit: 2,
      features: ['App Builder (3 apps)', '2 Dashboards', 'Work Orders & Scheduling', 'OEE Tracking', 'Basic Analytics', 'Operator Portal', 'CSV Export'],
    },
    pro: {
      name: 'Pro',
      monthly_price: 299,
      app_limit: -1,
      dashboard_limit: -1,
      features: ['Unlimited Apps', 'Unlimited Dashboards', 'Inventory Management', 'Purchasing & Vendors', 'Quality / NCR Management', 'Full Data Export (CSV/JSON)', 'Advanced Analytics', 'Priority Support'],
    },
    enterprise: {
      name: 'Enterprise',
      monthly_price: null, // contact sales
      app_limit: -1,
      dashboard_limit: -1,
      features: ['Everything in Pro', 'Custom Branding', 'SSO / SAML', 'Dedicated Instance', 'SLA Guarantee', 'API Access', 'Custom Integrations', 'Dedicated CSM'],
    },
  },
  addons: {
    app_slot:       { name: 'Extra App Slot',        monthly_price: 29, description: 'Add one production app beyond your plan limit' },
    dashboard_slot: { name: 'Custom Dashboard Slot', monthly_price: 19, description: 'Add one custom dashboard beyond your plan limit' },
  },
};

function getPlanRow() {
  let plan = db.prepare('SELECT * FROM plan WHERE id = 1').get();
  if (!plan) {
    db.prepare(`INSERT INTO plan (id, tier, app_limit, dashboard_limit) VALUES (1, 'free', 3, 2)`).run();
    plan = db.prepare('SELECT * FROM plan WHERE id = 1').get();
  }
  return plan;
}

// Effective limit = base tier limit + purchased add-on slots (-1 = unlimited).
function effectiveLimits(plan) {
  return {
    effective_app_limit:       plan.app_limit < 0 ? -1 : plan.app_limit + (plan.extra_app_slots || 0),
    effective_dashboard_limit: plan.dashboard_limit < 0 ? -1 : plan.dashboard_limit + (plan.extra_dashboard_slots || 0),
  };
}

function monthlyTotal(plan) {
  const tier = PRICING.tiers[plan.tier] || PRICING.tiers.free;
  let total = tier.monthly_price || 0;
  // Add-on slots only bill while on a limited tier
  if (plan.app_limit >= 0) {
    total += (plan.extra_app_slots || 0) * PRICING.addons.app_slot.monthly_price;
    total += (plan.extra_dashboard_slots || 0) * PRICING.addons.dashboard_slot.monthly_price;
  }
  return total;
}

function planResponse() {
  const plan = getPlanRow();
  const app_count        = db.prepare('SELECT COUNT(*) as c FROM apps').get().c;
  const dashboard_count  = db.prepare('SELECT COUNT(*) as c FROM dashboards').get().c;
  const completion_count = db.prepare('SELECT COUNT(*) as c FROM completions').get().c;
  const billing = db.prepare('SELECT * FROM billing_history ORDER BY created_at DESC LIMIT 50').all();

  return {
    ...plan,
    ...effectiveLimits(plan),
    monthly_total: monthlyTotal(plan),
    app_count,
    dashboard_count,
    completion_count,
    features: (PRICING.tiers[plan.tier] || PRICING.tiers.free).features,
    pricing: PRICING,
    billing_history: billing,
  };
}

// ─── GET / — all company settings ────────────────────────────────────────────

router.get('/', (req, res) => {
  const rows = db.prepare('SELECT key, value FROM company_settings').all();
  const settings = {};
  for (const r of rows) settings[r.key] = r.value;
  res.json(settings);
});

// ─── PUT / — bulk update settings (manager+) ──────────────────────────────────

router.put('/', requireRole('manager'), (req, res) => {
  const ins = db.prepare(`INSERT INTO company_settings (key, value, updated_at) VALUES (?, ?, datetime('now')) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`);
  const upsertAll = db.transaction((data) => {
    for (const [key, value] of Object.entries(data)) {
      if (typeof value !== 'undefined') ins.run(key, String(value));
    }
  });
  upsertAll(req.body);
  const rows = db.prepare('SELECT key, value FROM company_settings').all();
  const settings = {};
  for (const r of rows) settings[r.key] = r.value;
  res.json(settings);
});

// ─── GET /plan — plan info + usage + pricing + billing history ────────────────

router.get('/plan', (req, res) => {
  res.json(planResponse());
});

// ─── PUT /plan — change tier (manager+) ───────────────────────────────────────

router.put('/plan', requireRole('manager'), (req, res) => {
  const { tier } = req.body;
  const validTiers = Object.keys(PRICING.tiers);
  if (!tier || !validTiers.includes(tier)) {
    return res.status(400).json({ error: `tier must be one of: ${validTiers.join(', ')}` });
  }

  const current = getPlanRow();
  if (current.tier === tier) return res.json(planResponse());

  const def = PRICING.tiers[tier];
  db.prepare(`UPDATE plan SET tier=?, app_limit=?, dashboard_limit=?, updated_at=datetime('now') WHERE id=1`)
    .run(tier, def.app_limit, def.dashboard_limit);

  const price = def.monthly_price ?? 0;
  db.prepare(`INSERT INTO billing_history (id, type, description, quantity, unit_price, amount) VALUES (?, 'tier_change', ?, 1, ?, ?)`)
    .run(uuidv4(), `Plan changed to ${def.name}${price ? ` — $${price}/mo` : ''}`, price, price);

  res.json(planResponse());
});

// ─── POST /plan/purchase — buy à-la-carte add-on slots (manager+) ─────────────
// Demo checkout: records the purchase and unlocks capacity instantly.

router.post('/plan/purchase', requireRole('manager'), (req, res) => {
  const { type, quantity = 1 } = req.body;
  const addon = PRICING.addons[type];
  if (!addon) return res.status(400).json({ error: `type must be one of: ${Object.keys(PRICING.addons).join(', ')}` });

  const qty = Math.floor(Number(quantity));
  if (!Number.isFinite(qty) || qty < 1 || qty > 50) return res.status(400).json({ error: 'quantity must be between 1 and 50' });

  const plan = getPlanRow();
  if (plan.app_limit < 0) {
    return res.status(409).json({ error: 'Your plan already includes unlimited capacity — add-on slots are only for the Free tier' });
  }

  const col = type === 'app_slot' ? 'extra_app_slots' : 'extra_dashboard_slots';
  db.prepare(`UPDATE plan SET ${col} = ${col} + ?, updated_at = datetime('now') WHERE id = 1`).run(qty);

  const amount = addon.monthly_price * qty;
  db.prepare(`INSERT INTO billing_history (id, type, description, quantity, unit_price, amount) VALUES (?, ?, ?, ?, ?, ?)`)
    .run(uuidv4(), type, `${addon.name} ×${qty} — $${addon.monthly_price}/mo each`, qty, addon.monthly_price, amount);

  res.status(201).json(planResponse());
});

// ─── DELETE /plan/addon — remove add-on slots (manager+) ──────────────────────

router.delete('/plan/addon', requireRole('manager'), (req, res) => {
  const { type, quantity = 1 } = req.body;
  const addon = PRICING.addons[type];
  if (!addon) return res.status(400).json({ error: `type must be one of: ${Object.keys(PRICING.addons).join(', ')}` });

  const plan = getPlanRow();
  const col = type === 'app_slot' ? 'extra_app_slots' : 'extra_dashboard_slots';
  const owned = plan[col] || 0;
  const qty = Math.min(Math.floor(Number(quantity)) || 1, owned);
  if (qty < 1) return res.status(409).json({ error: 'No add-on slots of this type to remove' });

  // Don't allow removing capacity that's already in use
  const usage = type === 'app_slot'
    ? db.prepare('SELECT COUNT(*) as c FROM apps').get().c
    : db.prepare('SELECT COUNT(*) as c FROM dashboards').get().c;
  const baseLimit = type === 'app_slot' ? plan.app_limit : plan.dashboard_limit;
  if (baseLimit >= 0 && usage > baseLimit + owned - qty) {
    return res.status(409).json({ error: `Cannot remove: ${usage} in use exceeds remaining capacity of ${baseLimit + owned - qty}. Delete some first.` });
  }

  db.prepare(`UPDATE plan SET ${col} = ${col} - ?, updated_at = datetime('now') WHERE id = 1`).run(qty);
  db.prepare(`INSERT INTO billing_history (id, type, description, quantity, unit_price, amount) VALUES (?, 'refund', ?, ?, ?, ?)`)
    .run(uuidv4(), `Removed ${addon.name} ×${qty}`, qty, addon.monthly_price, -addon.monthly_price * qty);

  res.json(planResponse());
});

module.exports = router;
module.exports.PRICING = PRICING;
module.exports.effectiveLimits = effectiveLimits;

const express = require('express');
const { v4: uuidv4 } = require('uuid');
const db = require('../db');
const { requireRole } = require('../middleware/auth');
const { getStripe, isConfigured, billingMode, currency } = require('../stripe');
const { PRICING } = require('../pricing');
const { logActivity } = require('../activity');

const router = express.Router();

function getPlanRow(companyId) {
  let plan = db.prepare('SELECT * FROM plan WHERE company_id = ?').get(companyId);
  if (!plan) {
    db.prepare(`INSERT INTO plan (tier, app_limit, dashboard_limit, company_id) VALUES ('free', 5, 2, ?)`).run(companyId);
    plan = db.prepare('SELECT * FROM plan WHERE company_id = ?').get(companyId);
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

// ─── Reusable plan mutators (shared by demo routes + Stripe webhook) ──────────

function setTier(companyId, tier) {
  const def = PRICING.tiers[tier];
  if (!def) return;
  db.prepare(`UPDATE plan SET tier=?, app_limit=?, dashboard_limit=?, updated_at=datetime('now') WHERE company_id=?`)
    .run(tier, def.app_limit, def.dashboard_limit, companyId);
}

function addAddonSlots(companyId, type, qty) {
  const col = type === 'app_slot' ? 'extra_app_slots' : 'extra_dashboard_slots';
  db.prepare(`UPDATE plan SET ${col} = ${col} + ?, updated_at = datetime('now') WHERE company_id = ?`).run(qty, companyId);
}

function recordBilling(companyId, { type, description, quantity = 1, unit_price = 0, amount = 0 }) {
  db.prepare(`INSERT INTO billing_history (id, type, description, quantity, unit_price, amount, company_id) VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .run(uuidv4(), type, description, quantity, unit_price, amount, companyId);
}

// Base URL for Checkout redirects — prefers APP_URL, then the forwarded host.
function appUrl(req) {
  if (process.env.APP_URL) return process.env.APP_URL.replace(/\/$/, '');
  const proto = req.headers['x-forwarded-proto'] || req.protocol || 'http';
  return `${proto}://${req.get('host')}`;
}

function planResponse(companyId) {
  const plan = getPlanRow(companyId);
  const app_count        = db.prepare('SELECT COUNT(*) as c FROM apps WHERE company_id = ?').get(companyId).c;
  const dashboard_count  = db.prepare('SELECT COUNT(*) as c FROM dashboards WHERE company_id = ?').get(companyId).c;
  const completion_count = db.prepare('SELECT COUNT(*) as c FROM completions WHERE company_id = ?').get(companyId).c;
  const billing = db.prepare('SELECT * FROM billing_history WHERE company_id = ? ORDER BY created_at DESC LIMIT 50').all(companyId);

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
  const rows = db.prepare('SELECT key, value FROM org_settings WHERE company_id = ?').all(req.companyId);
  const settings = {};
  for (const r of rows) settings[r.key] = r.value;
  res.json(settings);
});

// ─── PUT / — bulk update settings (manager+) ──────────────────────────────────

router.put('/', requireRole('manager'), (req, res) => {
  const ins = db.prepare(`INSERT INTO org_settings (company_id, key, value, updated_at) VALUES (?, ?, ?, datetime('now')) ON CONFLICT(company_id, key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`);
  const upsertAll = db.transaction((data) => {
    for (const [key, value] of Object.entries(data)) {
      if (typeof value !== 'undefined') ins.run(req.companyId, key, String(value));
    }
  });
  upsertAll(req.body);
  logActivity(req.companyId, 'settings', req.companyId, `Organization settings updated (${Object.keys(req.body).join(', ')})`, req.user.display_name);
  const rows = db.prepare('SELECT key, value FROM org_settings WHERE company_id = ?').all(req.companyId);
  const settings = {};
  for (const r of rows) settings[r.key] = r.value;
  res.json(settings);
});

// ─── POST /sample-data — load demo apps, stations, work orders, etc (manager+) ─
// Powers the "Load Sample Data" empty-state CTA so trial accounts can see what
// a populated workspace looks like without entering data by hand.

router.post('/sample-data', requireRole('manager'), (req, res) => {
  const result = db.loadSampleDataForCompany(req.companyId);
  logActivity(req.companyId, 'settings', req.companyId, 'Sample data loaded', req.user.display_name);
  res.status(201).json(result);
});

// ─── GET /plan — plan info + usage + pricing + billing history ────────────────

router.get('/plan', (req, res) => {
  res.json(planResponse(req.companyId));
});

// ─── PUT /plan — change tier (manager+) ───────────────────────────────────────

router.put('/plan', requireRole('manager'), (req, res) => {
  const { tier } = req.body;
  const validTiers = Object.keys(PRICING.tiers);
  if (!tier || !validTiers.includes(tier)) {
    return res.status(400).json({ error: `tier must be one of: ${validTiers.join(', ')}` });
  }

  const current = getPlanRow(req.companyId);
  if (current.tier === tier) return res.json(planResponse(req.companyId));

  const def = PRICING.tiers[tier];
  db.prepare(`UPDATE plan SET tier=?, app_limit=?, dashboard_limit=?, updated_at=datetime('now') WHERE company_id=?`)
    .run(tier, def.app_limit, def.dashboard_limit, req.companyId);

  const price = def.monthly_price ?? 0;
  db.prepare(`INSERT INTO billing_history (id, type, description, quantity, unit_price, amount, company_id) VALUES (?, 'tier_change', ?, 1, ?, ?, ?)`)
    .run(uuidv4(), `Plan changed to ${def.name}${price ? ` — $${price}/mo` : ''}`, price, price, req.companyId);

  logActivity(req.companyId, 'plan', req.companyId, `Plan changed from ${current.tier} to ${tier}`, req.user.display_name);

  res.json(planResponse(req.companyId));
});

// ─── POST /plan/purchase — buy à-la-carte add-on slots (manager+) ─────────────
// Demo checkout: records the purchase and unlocks capacity instantly.

router.post('/plan/purchase', requireRole('manager'), (req, res) => {
  const { type, quantity = 1 } = req.body;
  const addon = PRICING.addons[type];
  if (!addon) return res.status(400).json({ error: `type must be one of: ${Object.keys(PRICING.addons).join(', ')}` });

  const qty = Math.floor(Number(quantity));
  if (!Number.isFinite(qty) || qty < 1 || qty > 50) return res.status(400).json({ error: 'quantity must be between 1 and 50' });

  const plan = getPlanRow(req.companyId);
  if (plan.app_limit < 0) {
    return res.status(409).json({ error: 'Your plan already includes unlimited capacity — add-on slots are only for the Free tier' });
  }

  const col = type === 'app_slot' ? 'extra_app_slots' : 'extra_dashboard_slots';
  db.prepare(`UPDATE plan SET ${col} = ${col} + ?, updated_at = datetime('now') WHERE company_id = ?`).run(qty, req.companyId);

  const amount = addon.monthly_price * qty;
  db.prepare(`INSERT INTO billing_history (id, type, description, quantity, unit_price, amount, company_id) VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .run(uuidv4(), type, `${addon.name} ×${qty} — $${addon.monthly_price}/mo each`, qty, addon.monthly_price, amount, req.companyId);

  res.status(201).json(planResponse(req.companyId));
});

// ─── DELETE /plan/addon — remove add-on slots (manager+) ──────────────────────

router.delete('/plan/addon', requireRole('manager'), (req, res) => {
  const { type, quantity = 1 } = req.body;
  const addon = PRICING.addons[type];
  if (!addon) return res.status(400).json({ error: `type must be one of: ${Object.keys(PRICING.addons).join(', ')}` });

  const plan = getPlanRow(req.companyId);
  const col = type === 'app_slot' ? 'extra_app_slots' : 'extra_dashboard_slots';
  const owned = plan[col] || 0;
  const qty = Math.min(Math.floor(Number(quantity)) || 1, owned);
  if (qty < 1) return res.status(409).json({ error: 'No add-on slots of this type to remove' });

  // Don't allow removing capacity that's already in use
  const usage = type === 'app_slot'
    ? db.prepare('SELECT COUNT(*) as c FROM apps WHERE company_id = ?').get(req.companyId).c
    : db.prepare('SELECT COUNT(*) as c FROM dashboards WHERE company_id = ?').get(req.companyId).c;
  const baseLimit = type === 'app_slot' ? plan.app_limit : plan.dashboard_limit;
  if (baseLimit >= 0 && usage > baseLimit + owned - qty) {
    return res.status(409).json({ error: `Cannot remove: ${usage} in use exceeds remaining capacity of ${baseLimit + owned - qty}. Delete some first.` });
  }

  db.prepare(`UPDATE plan SET ${col} = ${col} - ?, updated_at = datetime('now') WHERE company_id = ?`).run(qty, req.companyId);
  db.prepare(`INSERT INTO billing_history (id, type, description, quantity, unit_price, amount, company_id) VALUES (?, 'refund', ?, ?, ?, ?, ?)`)
    .run(uuidv4(), `Removed ${addon.name} ×${qty}`, qty, addon.monthly_price, -addon.monthly_price * qty, req.companyId);

  res.json(planResponse(req.companyId));
});

// ─── GET /plan/billing-config — does this deployment take real money? ─────────

router.get('/plan/billing-config', (req, res) => {
  res.json({ configured: isConfigured(), mode: billingMode() });
});

// ─── GET /integrations — live/demo status + the exact URLs to register ────────
// Powers the Settings → Developer "Integrations" panel so an admin can wire up
// Stripe and SSO without digging through docs. Never returns any secret value.
router.get('/integrations', requireRole('manager'), (req, res) => {
  const { PROVIDERS, isConfigured: ssoConfigured } = require('../sso');
  const base = appUrl(req);
  res.json({
    app_url: base,
    app_url_explicit: !!process.env.APP_URL,
    payments: {
      configured: isConfigured(),
      mode: billingMode(),
      webhook_url: `${base}/api/webhooks/stripe`,
      events: ['checkout.session.completed', 'customer.subscription.updated', 'customer.subscription.deleted', 'invoice.paid'],
      env_vars: ['STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET'],
    },
    sso: Object.keys(PROVIDERS).map(id => ({
      id,
      name: PROVIDERS[id].name,
      configured: ssoConfigured(id),
      redirect_uri: `${base}/api/auth/sso/${id}/callback`,
      env_vars: [PROVIDERS[id].clientIdEnv, PROVIDERS[id].clientSecretEnv],
    })),
  });
});

// ─── POST /plan/checkout — start a real Stripe Checkout session (manager+) ────
// Returns { url } to redirect the browser to Stripe's hosted, PCI-compliant
// payment page. Works for a tier upgrade or an à-la-carte add-on, both billed
// as monthly subscriptions. Falls back with a clear error if Stripe is off.

router.post('/plan/checkout', requireRole('manager'), async (req, res) => {
  const stripe = getStripe();
  if (!stripe) {
    return res.status(400).json({ error: 'not_configured', message: 'Live payments are not enabled on this deployment.' });
  }

  try {
    const { tier, addon, quantity = 1 } = req.body;
    const metadata = { company_id: req.companyId };
    let line;

    if (tier) {
      const t = PRICING.tiers[tier];
      if (!t || !t.monthly_price) return res.status(400).json({ error: 'A purchasable tier is required' });
      line = {
        price_data: {
          currency: currency(),
          product_data: { name: `HartMonitor ${t.name} Plan` },
          unit_amount: Math.round(t.monthly_price * 100),
          recurring: { interval: 'month' },
        },
        quantity: 1,
      };
      metadata.kind = 'tier';
      metadata.tier = tier;
    } else if (addon) {
      const a = PRICING.addons[addon];
      if (!a) return res.status(400).json({ error: 'Unknown add-on' });
      const qty = Math.max(1, Math.min(50, Math.floor(Number(quantity)) || 1));
      line = {
        price_data: {
          currency: currency(),
          product_data: { name: a.name },
          unit_amount: Math.round(a.monthly_price * 100),
          recurring: { interval: 'month' },
        },
        quantity: qty,
      };
      metadata.kind = 'addon';
      metadata.addon = addon;
      metadata.quantity = String(qty);
    } else {
      return res.status(400).json({ error: 'tier or addon is required' });
    }

    // Reuse or create a Stripe customer for this company.
    const plan = getPlanRow(req.companyId);
    let customerId = plan.stripe_customer_id;
    if (!customerId) {
      const org = db.prepare('SELECT * FROM organizations WHERE id = ?').get(req.companyId);
      const customer = await stripe.customers.create({
        name: org?.name || undefined,
        email: plan.billing_email || undefined,
        metadata: { company_id: req.companyId },
      });
      customerId = customer.id;
      db.prepare('UPDATE plan SET stripe_customer_id = ? WHERE company_id = ?').run(customerId, req.companyId);
    }

    const base = appUrl(req);
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      customer: customerId,
      line_items: [line],
      allow_promotion_codes: true,
      success_url: `${base}/settings?tab=plan&checkout=success`,
      cancel_url: `${base}/settings?tab=plan&checkout=cancel`,
      metadata,
      subscription_data: { metadata },
    });

    res.json({ url: session.url });
  } catch (e) {
    console.error('[stripe] checkout error:', e.message);
    res.status(502).json({ error: 'checkout_failed', message: e.message });
  }
});

// ─── POST /plan/portal — open Stripe billing portal to manage/cancel ──────────

router.post('/plan/portal', requireRole('manager'), async (req, res) => {
  const stripe = getStripe();
  if (!stripe) return res.status(400).json({ error: 'not_configured' });
  try {
    const plan = getPlanRow(req.companyId);
    if (!plan.stripe_customer_id) {
      return res.status(400).json({ error: 'no_customer', message: 'No billing account yet — make a purchase first.' });
    }
    const session = await stripe.billingPortal.sessions.create({
      customer: plan.stripe_customer_id,
      return_url: `${appUrl(req)}/settings?tab=plan`,
    });
    res.json({ url: session.url });
  } catch (e) {
    console.error('[stripe] portal error:', e.message);
    res.status(502).json({ error: 'portal_failed', message: e.message });
  }
});

// ─── GET /export-data — self-service full data export (any auth role) ─────────
// Legal/trust requirement: customers must be able to extract all their data.
// Returns a JSON file containing every table scoped to the authenticated company.

router.get('/export-data', (req, res) => {
  const cid = req.companyId;
  const date = new Date().toISOString().slice(0, 10);

  const bundle = {
    exported_at: new Date().toISOString(),
    company_id: cid,
    tables: {
      work_orders: db.prepare('SELECT * FROM work_orders WHERE company_id = ? ORDER BY created_at DESC').all(cid),
      completions: db.prepare('SELECT * FROM completions WHERE company_id = ? ORDER BY started_at DESC').all(cid),
      departments: db.prepare('SELECT * FROM departments WHERE company_id = ? ORDER BY name').all(cid),
      stations: db.prepare('SELECT * FROM stations WHERE company_id = ? ORDER BY name').all(cid),
      users: db.prepare('SELECT id, email, display_name, role, is_active, department_id, job_title, last_login, created_at, updated_at FROM users WHERE company_id = ? ORDER BY created_at').all(cid),
      items: db.prepare('SELECT * FROM items WHERE company_id = ? ORDER BY sku').all(cid),
      stock_movements: db.prepare('SELECT sm.* FROM stock_movements sm JOIN items i ON i.id = sm.item_id WHERE i.company_id = ? ORDER BY sm.created_at DESC').all(cid),
      purchase_orders: db.prepare('SELECT * FROM purchase_orders WHERE company_id = ? ORDER BY order_date DESC').all(cid),
      ncrs: db.prepare('SELECT * FROM ncrs WHERE company_id = ? ORDER BY created_at DESC').all(cid),
      andon_calls: (() => {
        try { return db.prepare('SELECT * FROM andon_calls WHERE company_id = ? ORDER BY created_at DESC').all(cid); } catch { return []; }
      })(),
      capa_items: (() => {
        try { return db.prepare('SELECT * FROM capa_items WHERE company_id = ? ORDER BY created_at DESC').all(cid); } catch { return []; }
      })(),
      kaizen_ideas: (() => {
        try { return db.prepare('SELECT * FROM kaizen_ideas WHERE company_id = ? ORDER BY created_at DESC').all(cid); } catch { return []; }
      })(),
      shift_notes: (() => {
        try { return db.prepare('SELECT * FROM shift_notes WHERE company_id = ? ORDER BY created_at DESC').all(cid); } catch { return []; }
      })(),
      maintenance_work_orders: (() => {
        try { return db.prepare('SELECT * FROM maintenance_work_orders WHERE company_id = ? ORDER BY created_at DESC').all(cid); } catch { return []; }
      })(),
      assets: (() => {
        try { return db.prepare('SELECT * FROM assets WHERE company_id = ? ORDER BY created_at DESC').all(cid); } catch { return []; }
      })(),
    },
  };

  res.setHeader('Content-Disposition', `attachment; filename="hartmonitor-export-${date}.json"`);
  res.setHeader('Content-Type', 'application/json');
  res.json(bundle);
});

module.exports = router;
module.exports.PRICING = PRICING;
module.exports.effectiveLimits = effectiveLimits;
module.exports.getPlanRow = getPlanRow;
module.exports.setTier = setTier;
module.exports.addAddonSlots = addAddonSlots;
module.exports.recordBilling = recordBilling;

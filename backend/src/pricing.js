// ─── Pricing catalog ──────────────────────────────────────────────────────────
// Single source of truth for what each tier and add-on costs. Both the in-app
// billing flow (routes/config.js) and the public marketing site render from
// this, so prices never drift between the website, the settings page, and what
// actually gets billed.

const PRICING = {
  tiers: {
    free: {
      name: 'Free',
      monthly_price: 0,
      app_limit: 5,
      dashboard_limit: 2,
      features: ['App Builder (5 apps)', '2 Dashboards', 'Work Orders & Scheduling', 'OEE Tracking', 'Basic Analytics', 'Operator Portal', 'CSV Export'],
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

module.exports = { PRICING };

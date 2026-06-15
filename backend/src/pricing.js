// ─── Pricing catalog ──────────────────────────────────────────────────────────
// Single source of truth for what each tier and add-on costs. Both the in-app
// billing flow (routes/config.js) and the public marketing site render from
// this, so prices never drift between the website, the settings page, and
// what actually gets billed.
//
// Module add-ons let Free customers unlock individual pro modules without
// upgrading to the full Pro tier. Pro includes all modules automatically.

const PRICING = {
  tiers: {
    free: {
      name: 'Free',
      monthly_price: 0,
      app_limit: 5,
      dashboard_limit: 2,
      modules: [],
      features: [
        'App Builder (up to 5 apps)',
        '2 Custom Dashboards',
        'Work Orders & Scheduling',
        'OEE Tracking',
        'Basic Analytics',
        'Operator Portal',
        'CSV Export',
      ],
    },
    pro: {
      name: 'Pro',
      monthly_price: 299,
      app_limit: 100,
      dashboard_limit: 20,
      modules: ['manufacturing', 'inventory', 'quality', 'training'],
      features: [
        'Everything in Free',
        'Up to 100 Production Apps',
        'Up to 20 Custom Dashboards',
        'Manufacturing Pro (Routings, Advanced Scheduling)',
        'Inventory Pro (Min/Max, Receiving, MRP)',
        'Quality Pro (NCR, CAPA, Audits)',
        'Training Pro (Skills Matrix, Certifications)',
        'Full Data Export (CSV / JSON)',
        'Advanced Analytics',
        'Priority Support',
      ],
    },
    enterprise: {
      name: 'Enterprise',
      monthly_price: null, // contact sales
      app_limit: -1,
      dashboard_limit: -1,
      modules: ['manufacturing', 'inventory', 'quality', 'training'],
      features: [
        'Everything in Pro',
        'Unlimited Apps & Dashboards',
        'Custom Branding',
        'SSO / SAML',
        'Dedicated Instance',
        'SLA Guarantee',
        'REST API Access',
        'Custom Integrations',
        'Dedicated Customer Success Manager',
      ],
    },
  },

  // Per-module add-ons — purchasable individually on top of Free tier.
  // Pro tier automatically includes all modules; purchasing a module add-on
  // while on Pro is a no-op (idempotent).
  modules: {
    manufacturing: {
      name: 'Manufacturing Pro',
      monthly_price: 79,
      description: 'Advanced routings, product configurator, and scheduling tools',
      features: [
        'Advanced Product Routings',
        'Visual Scheduling Board',
        'Product Configurator',
        'Shift Startup Checklists',
        'First-Piece Inspection',
      ],
    },
    inventory: {
      name: 'Inventory Pro',
      monthly_price: 59,
      description: 'Min/max management, PO receiving, MRP requirements, and shipment tracking',
      features: [
        'Min / Max Replenishment',
        'Purchase Order Receiving',
        'MRP Requirements Engine',
        'Shipment Tracker',
        'Multi-Location Inventory',
      ],
    },
    quality: {
      name: 'Quality Pro',
      monthly_price: 49,
      description: 'NCR management, CAPA workflow, layered process audits, and 5S',
      features: [
        'NCR / Non-Conformance',
        'CAPA Workflow',
        'Layered Process Audits',
        '5S Audits',
        'Quality Metrics Dashboard',
      ],
    },
    training: {
      name: 'Training Pro',
      monthly_price: 49,
      description: 'Skills matrix, operator certifications, and training plan management',
      features: [
        'Skills Matrix',
        'Operator Certifications',
        'Training Plans & Due Dates',
        'Department Coverage Reports',
        'Certification Export',
      ],
    },
  },

  // Slot add-ons for individual resource bumps without changing tier
  addons: {
    app_slot: {
      name: 'Extra App Slot',
      monthly_price: 15,
      description: 'Add one production app beyond your plan limit',
    },
    dashboard_slot: {
      name: 'Extra Dashboard Slot',
      monthly_price: 10,
      description: 'Add one custom dashboard beyond your plan limit',
    },
  },
};

module.exports = { PRICING };

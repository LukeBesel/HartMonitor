// ─── Stripe integration ────────────────────────────────────────────────────────
// Real payment processing. This module is intentionally defensive: when no
// STRIPE_SECRET_KEY is present the whole app keeps working in "demo" mode and
// the billing routes fall back to the instant mock checkout. Add the key (and a
// webhook secret) and the same UI starts taking real money.
//
// Required environment variables to go live:
//   STRIPE_SECRET_KEY      sk_live_… (or sk_test_… for testing)
//   STRIPE_WEBHOOK_SECRET  whsec_…  (from the webhook endpoint you register)
// Optional:
//   APP_URL                Base URL used for Checkout success/cancel redirects
//                          (defaults to the request origin, then localhost)
//   BILLING_CURRENCY       Three-letter currency code (default: usd)

let stripe = null;
let initialized = false;

function getStripe() {
  if (!initialized) {
    initialized = true;
    const key = process.env.STRIPE_SECRET_KEY;
    if (key) {
      try {
        // Lazy require so the dependency is only loaded when configured.
        // No apiVersion pin — use the installed SDK's default so the two never
        // drift out of sync.
        const Stripe = require('stripe');
        stripe = new Stripe(key);
      } catch (e) {
        console.error('[stripe] Failed to initialize Stripe client:', e.message);
        stripe = null;
      }
    }
  }
  return stripe;
}

function isConfigured() {
  return !!getStripe();
}

// Reports the mode so the UI can label the checkout honestly.
function billingMode() {
  const key = process.env.STRIPE_SECRET_KEY || '';
  if (!key) return 'demo';
  return key.startsWith('sk_live') ? 'live' : 'test';
}

function currency() {
  return (process.env.BILLING_CURRENCY || 'usd').toLowerCase();
}

function webhookSecret() {
  return process.env.STRIPE_WEBHOOK_SECRET || '';
}

module.exports = { getStripe, isConfigured, billingMode, currency, webhookSecret };

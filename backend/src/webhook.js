// ─── Stripe webhook handler ─────────────────────────────────────────────────
// Mounted in index.js BEFORE the JSON body parser and OUTSIDE auth, because
// Stripe signs the raw request body and never carries our JWT. This is where
// payments become durable: when Stripe confirms a successful checkout or a
// recurring invoice, we update the company's plan to match.

const db = require('./db');
const { getStripe, webhookSecret } = require('./stripe');
const { PRICING, setTier, addAddonSlots, recordBilling } = require('./routes/config');
const { sendPaymentFailedEmail, sendTrialEndingEmail, sendSubscriptionCancelledEmail } = require('./email');

// Look up the primary admin for a company to send billing emails to.
function getCompanyAdmin(companyId) {
  return db.prepare(
    "SELECT email, display_name AS name FROM users WHERE company_id = ? AND role IN ('developer','manager') AND is_active = 1 ORDER BY created_at LIMIT 1"
  ).get(companyId);
}

function findCompanyId(obj) {
  // Prefer explicit metadata; fall back to the customer linkage we stored.
  if (obj?.metadata?.company_id) return obj.metadata.company_id;
  const customer = obj?.customer;
  if (customer) {
    const row = db.prepare('SELECT company_id FROM plan WHERE stripe_customer_id = ?').get(customer);
    if (row) return row.company_id;
  }
  return null;
}

function handleCheckoutCompleted(session) {
  const companyId = findCompanyId(session);
  if (!companyId) return;
  const md = session.metadata || {};

  if (session.subscription) {
    db.prepare('UPDATE plan SET stripe_subscription_id = ?, subscription_status = ? WHERE company_id = ?')
      .run(session.subscription, 'active', companyId);
  }

  if (md.kind === 'tier' && md.tier) {
    const t = PRICING.tiers[md.tier];
    if (t) {
      setTier(companyId, md.tier);
      recordBilling(companyId, {
        type: 'tier_change',
        description: `Subscribed to ${t.name} — $${t.monthly_price}/mo`,
        unit_price: t.monthly_price,
        amount: t.monthly_price,
      });
    }
  } else if (md.kind === 'addon' && md.addon) {
    const a = PRICING.addons[md.addon];
    const qty = Math.max(1, parseInt(md.quantity || '1', 10));
    if (a) {
      addAddonSlots(companyId, md.addon, qty);
      recordBilling(companyId, {
        type: md.addon,
        description: `${a.name} ×${qty} — $${a.monthly_price}/mo each`,
        quantity: qty,
        unit_price: a.monthly_price,
        amount: a.monthly_price * qty,
      });
    }
  }
}

function handleSubscriptionChange(sub) {
  const companyId = findCompanyId(sub);
  if (!companyId) return;
  const dead = ['canceled', 'unpaid', 'incomplete_expired'];
  db.prepare('UPDATE plan SET subscription_status = ? WHERE company_id = ?').run(sub.status || '', companyId);

  if (dead.includes(sub.status)) {
    // Subscription ended — drop back to Free and clear add-on slots.
    setTier(companyId, 'free');
    db.prepare("UPDATE plan SET extra_app_slots = 0, extra_dashboard_slots = 0, stripe_subscription_id = '' WHERE company_id = ?").run(companyId);
    recordBilling(companyId, { type: 'refund', description: 'Subscription canceled — reverted to Free', amount: 0 });

    // Notify the admin
    const admin = getCompanyAdmin(companyId);
    if (admin) {
      sendSubscriptionCancelledEmail({ to: admin.email, name: admin.name || admin.email }).catch(console.error);
    }
  }
}

function handleInvoicePaymentFailed(invoice) {
  const companyId = findCompanyId(invoice);
  if (!companyId) return;
  const admin = getCompanyAdmin(companyId);
  if (admin) {
    sendPaymentFailedEmail({ to: admin.email, name: admin.name || admin.email }).catch(console.error);
  }
}

function handleTrialWillEnd(sub) {
  const companyId = findCompanyId(sub);
  if (!companyId) return;
  // Stripe fires this 7 days and 3 days before trial end. Use the provided
  // trial_end timestamp to compute how many days are left.
  let daysLeft = 7;
  if (sub.trial_end) {
    const ms = sub.trial_end * 1000 - Date.now();
    daysLeft = Math.max(1, Math.ceil(ms / (1000 * 60 * 60 * 24)));
  }
  const admin = getCompanyAdmin(companyId);
  if (admin) {
    sendTrialEndingEmail({ to: admin.email, name: admin.name || admin.email, daysLeft }).catch(console.error);
  }
}

function handleInvoicePaid(invoice) {
  // Record recurring renewals (skip the first invoice already logged at checkout).
  if (invoice.billing_reason !== 'subscription_cycle') return;
  const companyId = findCompanyId(invoice);
  if (!companyId) return;
  const amount = (invoice.amount_paid || 0) / 100;
  recordBilling(companyId, {
    type: 'tier_change',
    description: `Subscription renewal — $${amount}/mo`,
    unit_price: amount,
    amount,
  });
}

function stripeWebhook(req, res) {
  const stripe = getStripe();
  const secret = webhookSecret();
  if (!stripe || !secret) {
    return res.status(503).json({ error: 'Webhooks not configured' });
  }

  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, req.headers['stripe-signature'], secret);
  } catch (e) {
    console.error('[stripe] webhook signature verification failed:', e.message);
    return res.status(400).send(`Webhook Error: ${e.message}`);
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed':
        handleCheckoutCompleted(event.data.object);
        break;
      case 'customer.subscription.updated':
      case 'customer.subscription.deleted':
        handleSubscriptionChange(event.data.object);
        break;
      case 'customer.subscription.trial_will_end':
        handleTrialWillEnd(event.data.object);
        break;
      case 'invoice.paid':
        handleInvoicePaid(event.data.object);
        break;
      case 'invoice.payment_failed':
        handleInvoicePaymentFailed(event.data.object);
        break;
      default:
        break;
    }
  } catch (e) {
    console.error('[stripe] webhook handler error:', e.message);
    // Still 200 so Stripe doesn't hammer retries for a non-signature error.
  }

  res.json({ received: true });
}

module.exports = { stripeWebhook };

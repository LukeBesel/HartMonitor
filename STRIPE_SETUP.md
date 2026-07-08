# Stripe Setup Guide

## 1. Create your Stripe account

Go to [stripe.com](https://stripe.com) and create an account. Use **test mode** while setting up — toggle it in the top-right of the dashboard.

---

## 2. Create Products and Prices

In the Stripe Dashboard, go to **Products** and create the following:

### Pro Plan ($299/month)
- Product name: `HartMonitor Pro`
- Price: `$299.00` / month (recurring)
- Copy the **Price ID** (starts with `price_...`) → set as `STRIPE_PRICE_PRO`

### Free Plan (optional, for tracking)
- Product name: `HartMonitor Free`
- Price: `$0.00` / month
- Copy the **Price ID** → set as `STRIPE_PRICE_FREE`

### Enterprise Plan
- Product name: `HartMonitor Enterprise`
- Price: Custom / contact sales
- Skip or set manually per customer

### Add-On: Extra App Slot
- Product name: `Extra App Slot`
- Price: `$9.00` / month (recurring)
- Copy the **Price ID** → set as `STRIPE_PRICE_ADDON_APP`

### Add-On: Extra Dashboard Slot
- Product name: `Extra Dashboard Slot`
- Price: `$9.00` / month (recurring)
- Copy the **Price ID** → set as `STRIPE_PRICE_ADDON_DASHBOARD`

---

## 3. Create a Webhook Endpoint

In Stripe Dashboard, go to **Developers → Webhooks → Add endpoint**.

**URL:**
```
https://YOUR-DOMAIN/api/webhooks/stripe
```

**Select these events to listen for:**
- `checkout.session.completed`
- `customer.subscription.created`
- `customer.subscription.updated`
- `customer.subscription.deleted`
- `invoice.payment_succeeded`
- `invoice.payment_failed`
- `customer.subscription.trial_will_end`

After creating the endpoint, click **Reveal** next to the Signing Secret and copy it → set as `STRIPE_WEBHOOK_SECRET`.

---

## 4. Environment Variables to Set

Add these to your **Render dashboard** (or `.env` for local dev):

```env
STRIPE_SECRET_KEY=sk_live_...          # or sk_test_... for test mode
STRIPE_WEBHOOK_SECRET=whsec_...
STRIPE_PRICE_PRO=price_...
STRIPE_PRICE_FREE=price_...
STRIPE_PRICE_ADDON_APP=price_...
STRIPE_PRICE_ADDON_DASHBOARD=price_...
```

For **local development**, also install the Stripe CLI and forward webhooks:
```bash
stripe listen --forward-to localhost:3001/api/webhooks/stripe
```
This gives you a local `whsec_...` webhook secret to use in `.env`.

---

## 5. Test the Integration

Use these **Stripe test card numbers** (any future expiry, any CVC):

| Card number           | Result                  |
|-----------------------|-------------------------|
| `4242 4242 4242 4242` | Payment succeeds        |
| `4000 0000 0000 9995` | Payment fails           |
| `4000 0025 0000 3155` | Requires 3D Secure      |
| `4000 0000 0000 0341` | Card declined           |

Test the full checkout flow:
1. Sign up for a new account
2. Navigate to Settings → Billing → Upgrade to Pro
3. Complete checkout with a test card
4. Verify the webhook fires in Stripe Dashboard → Webhooks → recent deliveries
5. Verify the account is upgraded in the database

---

## 6. Go Live

When you are ready to accept real payments:

1. In the Stripe Dashboard, switch from **Test mode** to **Live mode**
2. Create the same Products and Prices again in live mode (they are separate)
3. Update your Render environment variables with **live keys**:
   - `STRIPE_SECRET_KEY=sk_live_...`
   - `STRIPE_WEBHOOK_SECRET=whsec_...` (from a new live webhook endpoint)
   - All `STRIPE_PRICE_*` values with live price IDs
4. Create a new **live webhook endpoint** pointing to your production domain
5. Deploy and verify with a real low-value transaction

---

## 7. Troubleshooting

**Webhook signature verification fails:**
- Make sure `STRIPE_WEBHOOK_SECRET` matches the endpoint's signing secret exactly
- Do not parse the body before passing it to `stripe.webhooks.constructEvent` — use the raw body

**Subscription not updating after payment:**
- Check the webhook delivery logs in Stripe Dashboard
- Ensure the `customer.subscription.updated` event handler updates the database

**Trial end emails not sending:**
- Add `customer.subscription.trial_will_end` to your webhook events
- This fires 3 days before the trial ends by default (configurable in Stripe settings)

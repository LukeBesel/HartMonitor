# Go-Live Checklist

A focused checklist for taking HartMonitor from "deployed" to "ready for paying
customers." Most of the product works out of the box in **demo mode**; this list
is about flipping the parts that need real credentials or a one-time setup.

For full hosting/deploy instructions, see [`HOSTING.md`](./HOSTING.md). For the
complete, commented environment-variable list, see
[`backend/.env.example`](./backend/.env.example).

---

## 1. Core (required)

Set these in your host's dashboard (Railway/Render/etc.):

| Variable | Why |
| --- | --- |
| `NODE_ENV=production` | Enables production hardening (CORS lockdown, etc.) |
| `APP_URL=https://your-domain` | Used for password-reset links, Stripe + SSO redirects |
| `DATABASE_PATH=/data/mes.db` | Point SQLite at a **persistent volume** so data survives redeploys |
| `BACKUP_DIR=/data/backups` | Enables automated backups (every 6h, keeps latest 14) |

> ⚠️ Make sure `SEED_DEMO_DATA` is **unset** (or `false`) in production — it ships
> known demo credentials. New customers populate their own data via the in-app
> **"Load Sample Data"** button instead.

---

## 2. Payments — Stripe (to charge real money)

The billing code (Checkout, customer portal, subscription webhooks) is fully
implemented. To activate:

1. Create a Stripe account and finish **Activate payments** (bank + business verification).
2. Copy your secret key — `sk_test_…` while testing, `sk_live_…` when live.
3. In the Stripe Dashboard → **Developers → Webhooks → Add endpoint**, point it at:
   ```
   https://YOUR_DOMAIN/api/webhooks/stripe
   ```
   Subscribe to these events:
   - `checkout.session.completed`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
   - `invoice.paid`
4. Copy the endpoint's **signing secret** (`whsec_…`).
5. Set on your host and redeploy:
   ```
   STRIPE_SECRET_KEY=sk_live_xxx
   STRIPE_WEBHOOK_SECRET=whsec_xxx
   BILLING_CURRENCY=usd
   ```
6. Verify: the startup banner logs **payments: LIVE**, and a test checkout upgrades
   the plan (Stripe Test mode → use card `4242 4242 4242 4242`).

Without these, billing stays in **demo mode** (upgrades apply instantly, no charge) —
useful for trials and internal use.

---

## 3. Email — SMTP (password resets + alerts)

Required for **"Forgot password"** emails to actually send, and for alert
notifications (downtime, NCRs, low stock, schedule changes).

```
SMTP_HOST=smtp.sendgrid.net
SMTP_PORT=587
SMTP_USER=apikey
SMTP_PASS=your-smtp-password
SMTP_FROM=no-reply@yourdomain.com
SMTP_SECURE=false
```

- Works with any provider (SendGrid, Postmark, Amazon SES, Mailgun, …).
- **Without SMTP:** password-reset still works for self-hosted/testing — the reset
  link is written to the server logs and returned to the requester so you can
  complete the flow manually. Set SMTP before onboarding real customers.

---

## 4. Operator floor identity (PINs / badges)

Operators clock into the **Operator Portal** with a numeric PIN (or a scannable
badge) so floor work is attributed to a verified person — not free-typed text.

1. In **Settings → Users**, add each operator (role: `operator`).
2. For each operator, use **PIN / Badge** to set a 4–8 digit PIN (and optionally a
   badge code their scanner reads).
3. On the shop-floor tablet, open the Operator Portal: operators tap their name and
   enter their PIN (or scan their badge) to start logging work.

No setup yet? The portal still works — staff can continue without a PIN until you
configure them.

---

## 5. SSO — Google / Microsoft (optional)

Let users sign in with their work account. Register this callback with the provider
and set the client id/secret:

```
https://YOUR_DOMAIN/api/auth/sso/google/callback
https://YOUR_DOMAIN/api/auth/sso/microsoft/callback
```
```
GOOGLE_CLIENT_ID=xxx.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=xxx
MICROSOFT_CLIENT_ID=xxx
MICROSOFT_CLIENT_SECRET=xxx
```

---

## 6. Final pre-sale polish

- Replace legal placeholders in `frontend/src/pages/Terms.tsx` / `Privacy.tsx`
  (governing-law state, legal entity name, contact emails) — have a lawyer review.
- Rebrand: search the repo for `HartMonitor` / `hartmonitor.io`.
- Confirm the startup banner shows the right **LIVE vs demo** status for payments,
  email, SMS, and SSO.
- Smoke test: sign up → load sample data → run an app in the Operator Portal →
  check the Command Center, Leaderboard, and Transaction Log light up.

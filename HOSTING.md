# HartMonitor — Hosting & Launch Guide

This is the practical, step-by-step guide to putting HartMonitor online, taking
payments, and onboarding paying customers. No prior DevOps experience assumed.

> **The 10,000-ft view:** HartMonitor is one app. The backend (Node) serves both
> the API **and** the website on a single port. You deploy it once, point a URL
> at it, and customers sign up themselves through the website. Payments are
> handled by Stripe. That's the whole model.

---

## 1. Run it on your own computer first (5 minutes)

This is the fastest way to see everything working before you put it online.

```bash
# From the project root:
npm run install:all     # installs all dependencies
npm run dev             # starts backend (:3001) and frontend (:5173) together
```

Then open **http://localhost:5173** in your browser.

- Locally, demo data is seeded (because `backend/.env` has `SEED_DEMO_DATA=true`).
- Log in with **admin@hartmonitor.demo** / **Admin123!** to explore as an admin,
  or click **Get started** to create a fresh workspace like a real customer would.

> Demo accounts exist **only** locally. They are never created in production.

To run the production build locally (backend serves the built website on one port):

```bash
npm run build           # builds the website into frontend/dist
npm start               # serves everything on http://localhost:3001
```

---

## 2. Put it online (Railway — recommended, ~15 minutes)

Railway is the simplest host. Your repo is already configured for it
(`railway.json`). You'll get a free `*.up.railway.app` URL to start.

### Step-by-step

1. **Push your code to GitHub** (see Section 6 — it's already there if you've been
   committing).
2. Go to **https://railway.app** → sign in with GitHub → **New Project** →
   **Deploy from GitHub repo** → pick this repository.
3. Railway reads `railway.json`, builds the app, and starts it. Wait for the first
   deploy to finish (green checkmark).
4. **Add a persistent volume** (so your data survives redeploys — critical):
   - In the service, go to **Variables / Settings → Volumes → New Volume**.
   - Mount path: **`/data`**.
5. **Set environment variables** (service → **Variables**). At minimum:

   | Variable        | Value                                  | Why |
   |-----------------|----------------------------------------|-----|
   | `NODE_ENV`      | `production`                           | Enables prod security |
   | `DATABASE_PATH` | `/data/mes.db`                         | Store data on the volume |
   | `BACKUP_DIR`    | `/data/backups`                        | Automatic backups |
   | `APP_URL`       | your Railway URL (see next step)       | Correct redirects + CORS |

6. **Get your URL:** service → **Settings → Networking → Generate Domain**. You'll
   get something like `https://hartmonitor-production.up.railway.app`. Copy it into
   the `APP_URL` variable, then **redeploy**.

✅ **That's your live website.** Open the URL — you'll see the marketing site. This
is the link you give to customers.

> **Sanity check:** visiting `https://YOUR_URL/api/health` should return
> `{"status":"ok",...}`. If it does, the server is healthy.

### Alternatives (same app, your choice)
- **Render:** import the repo as a *Blueprint*; it reads `render.yaml` (already
  includes the `/data` disk + env vars). Set `APP_URL` after the first deploy.
- **Any VPS / Docker host:** a `Dockerfile` is included.
  ```bash
  docker build -t hartmonitor .
  docker run -d -p 80:3001 \
    -e NODE_ENV=production -e APP_URL=https://yourdomain.com \
    -e DATABASE_PATH=/data/mes.db -e BACKUP_DIR=/data/backups \
    -v hartmonitor_data:/data hartmonitor
  ```

---

## 3. How customers access and start using it

There is **nothing to install** for customers — it's a website.

1. You share your URL (e.g. `https://app.hartmonitor.io` or your Railway URL).
2. A customer clicks **Get started**, enters their company name, name, email, and
   password, and gets their **own private workspace**. The first user becomes the
   **owner/admin** automatically.
3. Their data is completely isolated from every other company (multi-tenant).
4. On first login they get a setup wizard and can click **Load Sample Data** to
   explore, or start from a clean slate.
5. The admin invites their team under **Settings → Users & Access** (operators,
   supervisors, managers). Operators can use the touch-friendly **Operator Portal**.

That's it — they're using the product. New signups start on the **Free** plan.

---

## 4. Turn on real payments (Stripe)

Until you add Stripe keys, billing runs in **demo mode**: "upgrades" apply
instantly with no money changing hands (great for testing). To take real money:

1. Create an account at **https://dashboard.stripe.com** and complete **Activate
   payments** (add your business details + bank account — this is how you get paid;
   Stripe deposits your earnings to that bank automatically).
2. Copy your **Secret key** (`sk_live_…`) from Stripe → Developers → API keys.
3. Create a **webhook**: Stripe → Developers → Webhooks → **Add endpoint**:
   - Endpoint URL: **`https://YOUR_URL/api/webhooks/stripe`**
   - Events to send: `checkout.session.completed`,
     `customer.subscription.updated`, `customer.subscription.deleted`,
     `invoice.paid`
   - After creating it, copy the **Signing secret** (`whsec_…`).
4. Add both to your host's environment variables and redeploy:
   - `STRIPE_SECRET_KEY=sk_live_…`
   - `STRIPE_WEBHOOK_SECRET=whsec_…`

Now when a customer upgrades, they're sent to Stripe Checkout, pay by card, and the
webhook activates their new plan automatically.

> **Tip:** test the whole flow first with Stripe **test mode** keys (`sk_test_…`)
> and test card `4242 4242 4242 4242`, any future expiry, any CVC.

---

## 4b. Turn on real Google / Microsoft sign-in (SSO)

Until you add OAuth credentials, the "Continue with Google / Microsoft" buttons
run in **demo mode** (they sign into the sample demo account). To enable real
sign-in, register an OAuth app with each provider and add its credentials.

> **Prerequisite:** `APP_URL` must be set to your real public URL (e.g.
> `https://app.yourcompany.com`). The OAuth **redirect URIs** below are built from
> it, and they must match *exactly* or the provider will reject the login.

**Google:**
1. Go to **https://console.cloud.google.com** → APIs & Services → **Credentials**.
2. **Create Credentials → OAuth client ID** → Application type **Web application**.
3. Under **Authorized redirect URIs**, add exactly:
   `https://YOUR_URL/api/auth/sso/google/callback`
4. Copy the **Client ID** and **Client secret**, then set in your host's env vars:
   - `GOOGLE_CLIENT_ID=…`
   - `GOOGLE_CLIENT_SECRET=…`

**Microsoft:**
1. Go to **https://portal.azure.com** → **Microsoft Entra ID** → **App registrations** → **New registration**.
2. Set **Redirect URI** (platform: Web) to exactly:
   `https://YOUR_URL/api/auth/sso/microsoft/callback`
3. Under **Certificates & secrets**, create a **client secret** and copy its value.
4. Copy the **Application (client) ID**, then set in your host's env vars:
   - `MICROSOFT_CLIENT_ID=…`
   - `MICROSOFT_CLIENT_SECRET=…`

Redeploy. The boot banner will show `SSO: Google LIVE, Microsoft LIVE` once the
keys are picked up. New users who sign in via SSO get their own organization
automatically (same as a normal signup); existing users are matched by email.

---

## 5. How customers pay to expand (the revenue model)

The plans and pricing are already built in. Customers manage everything themselves
under **Settings → Plan & Billing**:

| Plan | Price | What they get |
|------|-------|---------------|
| **Free** | $0 | 5 apps, 2 dashboards, work orders, basic analytics, operator portal |
| **Pro** | $299/mo | 50 apps, 10 dashboards, routings, OEE, inventory, purchasing, quality/NCR, full export, advanced analytics |
| **Enterprise** | Custom | Everything in Pro + custom branding, SSO/SAML, API access & webhooks, SLA |

Plus **add-ons** (à-la-carte): extra app slots ($29/mo each) and extra dashboard
slots ($19/mo each).

The upgrade path for a customer:
1. They hit a limit (e.g. try to create a 6th app on Free) or open **Settings →
   Plan & Billing**.
2. They click **Upgrade**, pay via Stripe Checkout, and their capabilities expand
   immediately when the payment succeeds.
3. To change pricing or features, edit `backend/src/pricing.js` and redeploy.

> Enterprise features like the **Developer** tab (API keys + webhooks) and **SSO**
> unlock automatically when a company is on the Enterprise tier.

---

## 6. Keep GitHub up to date

All your work lives on the `claude/trusting-fermat-KIymW` branch. To deploy a
change: commit, push, and your host redeploys automatically.

```bash
git add -A
git commit -m "describe your change"
git push
```

When you're happy, merge that branch into `main` on GitHub (open a Pull Request, or
merge locally) so `main` is your production line.

---

## 7. Things to customize before a real sale

These are quick edits, but worth doing:

- **Legal pages:** `frontend/src/pages/Terms.tsx` and `Privacy.tsx` are solid
  starting templates. Replace the governing-law state, company legal name, and
  contact emails (`legal@`, `privacy@`, `security@hartmonitor.io`) with yours, and
  have a lawyer review before signing paying customers.
- **Brand name / emails:** search the repo for `hartmonitor.io` and `HartMonitor`
  to rebrand.
- **Pricing:** `backend/src/pricing.js`.
- **Custom domain:** on Railway/Render, add your domain in the dashboard and follow
  their DNS instructions (they issue SSL automatically). Then update `APP_URL`.

---

## 8. Operations cheat-sheet

- **Health check:** `GET /api/health` → should be `{"status":"ok"}`.
- **Backups:** automatic every 6h to `BACKUP_DIR`, keeping the latest 14. To
  restore, stop the app and copy a `mes-*.db` file over `DATABASE_PATH`.
- **Logs:** viewable in your host's dashboard. API requests are logged with status
  and latency.
- **Run the tests:** `npm test` (auth, tenant isolation, rate limiting, health).
- **Startup banner:** on boot the logs show exactly what's LIVE vs demo (payments,
  email, SMS, SSO) — a fast way to confirm your keys are picked up.

---

### Environment variables reference

See `backend/.env.example` for the complete, commented list. The essentials for a
production deploy are `NODE_ENV`, `DATABASE_PATH`, `BACKUP_DIR`, and `APP_URL`;
everything else (Stripe, SMTP, Twilio, SSO) is optional and activates its feature
when present.

# HartMonitor MES — Deployment Guide (Render.com)

This guide walks you through deploying HartMonitor MES to Render.com from scratch. It takes about 30 minutes for a first-time deployment.

---

## Section 1: Prerequisites

Before you begin, make sure you have:

- **Render.com account** — free to sign up at render.com. A paid plan ("Starter", ~$7/month) is required for persistent disk storage.
- **Stripe account** — for billing. Sign up at stripe.com. You can start in test mode and switch to live later.
- **Domain name** (optional but recommended) — any registrar works. You'll add it after the initial deploy.
- **SMTP provider** — for email notifications (sign-up confirmation, alerts). [SendGrid](https://sendgrid.com) free tier (100 emails/day) is a good starting point. [Postmark](https://postmarkapp.com) and [Resend](https://resend.com) are alternatives.
- **GitHub account** — Render deploys directly from a GitHub repository.

---

## Section 2: First-time deployment on Render

### Step 1: Push the repo to GitHub

Fork or push this repository to your GitHub account. Render will pull from it automatically on every push.

### Step 2: Create a new Web Service on Render

1. Log in to the [Render Dashboard](https://dashboard.render.com).
2. Click **New** → **Web Service**.
3. Select **Connect a repository** and choose your GitHub repo.
4. Click **Connect**.

### Step 3: Configure the Web Service

| Field | Value |
|---|---|
| **Name** | `hartmonitor` (or your preferred name) |
| **Region** | Closest to your users |
| **Branch** | `main` |
| **Root Directory** | *(leave blank — build runs from the repo root)* |
| **Runtime** | **Node** |
| **Build Command** | `npm ci && npm run build --workspace=frontend` |
| **Start Command** | `node backend/src/index.js` |
| **Plan** | **Starter** (required for disk) |

> **Why build from the root?** This is an npm workspace. The single `package-lock.json` lives at the root. Running `npm ci` in a subdirectory won't find it.

### Step 4: Add a persistent disk

The SQLite database must survive redeploys. Without a disk, all data is lost each time Render restarts your service.

1. In your Web Service settings, scroll to **Disks**.
2. Click **Add Disk**.
3. Set **Name**: `hartmonitor-data`
4. Set **Mount Path**: `/data`
5. Set **Size**: `5 GB` (you can resize later if needed)
6. Click **Save**.

### Step 5: Set environment variables

In the **Environment** tab of your Web Service, add each of the following:

#### Required — the service will not start without these

| Variable | Description | Example |
|---|---|---|
| `NODE_ENV` | Runtime environment | `production` |
| `PORT` | Port the Express server listens on (Render sets this automatically, but explicit is safer) | `3001` |
| `JWT_SECRET` | Secret for signing JSON Web Tokens. **Must be unique and secret.** | *(generate below)* |
| `SESSION_SECRET` | Secret for session cookies. **Must be unique and secret.** | *(generate below)* |
| `APP_URL` | Public URL of your deployment (no trailing slash) | `https://hartmonitor.onrender.com` |
| `DATABASE_PATH` | Path to the SQLite database file on the persistent disk | `/data/mes.db` |
| `BACKUP_DIR` | Directory for automated database backups | `/data/backups` |
| `SEED_DEMO_DATA` | Whether to seed demo company + sample accounts on first run | `false` |

**Generate secrets** by running this command locally (or in any Node.js environment):

```bash
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
```

Run it twice — once for `JWT_SECRET` and once for `SESSION_SECRET`. Never reuse the same value for both.

#### Stripe (required for billing)

| Variable | Description | Example |
|---|---|---|
| `STRIPE_SECRET_KEY` | Your Stripe secret key (live or test) | `sk_live_...` or `sk_test_...` |
| `STRIPE_WEBHOOK_SECRET` | Webhook signing secret (from Stripe dashboard) | `whsec_...` |

#### Email / SMTP (required for notifications)

| Variable | Description | Example |
|---|---|---|
| `SMTP_HOST` | SMTP server hostname | `smtp.sendgrid.net` |
| `SMTP_PORT` | SMTP port | `587` |
| `SMTP_USER` | SMTP username | `apikey` (for SendGrid) |
| `SMTP_PASS` | SMTP password or API key | `SG.xxxxxxxx...` |
| `SMTP_FROM` | "From" address for outgoing emails | `noreply@yourdomain.com` |

#### Optional integrations

| Variable | Description |
|---|---|
| `TWILIO_ACCOUNT_SID` | For SMS alerts |
| `TWILIO_AUTH_TOKEN` | For SMS alerts |
| `TWILIO_FROM_NUMBER` | Twilio phone number for SMS |
| `GOOGLE_CLIENT_ID` | For Google SSO |
| `GOOGLE_CLIENT_SECRET` | For Google SSO |
| `MICROSOFT_CLIENT_ID` | For Microsoft/Azure SSO |
| `MICROSOFT_CLIENT_SECRET` | For Microsoft/Azure SSO |

### Step 6: Deploy

Click **Create Web Service**. Render will:

1. Clone your repo
2. Run `npm ci && npm run build --workspace=frontend` (installs deps + builds the React app)
3. Start `node backend/src/index.js`
4. Run database migrations automatically on first startup
5. Serve the frontend and API from the same process

The first deploy typically takes 3–5 minutes. Watch the **Logs** tab for the startup banner.

---

## Section 3: Stripe Setup

> **No products to create.** Prices are defined in code (`backend/src/pricing.js`). You only need a Stripe account, your secret key, and a webhook — no manual product or price configuration.

### Step 1: Get your Stripe secret key

1. Sign up or log in at [dashboard.stripe.com](https://dashboard.stripe.com).
2. Complete **Activate payments** (add your bank account and business details — this is how Stripe deposits your earnings).
3. Go to **Developers → API keys**.
4. Copy your **Secret key** (`sk_live_…` for live, `sk_test_…` for testing).
5. Set it as `STRIPE_SECRET_KEY` in your Render environment.

### Step 2: Create a webhook endpoint

1. Go to **Developers** → **Webhooks** → **Add endpoint**.
2. Set the endpoint URL: `https://YOUR-DOMAIN/api/webhooks/stripe`
3. Select the following events:
   - `checkout.session.completed`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
   - `invoice.payment_failed`
   - `customer.subscription.trial_will_end`
4. Click **Add endpoint**.
5. Copy the **Signing secret** (starts with `whsec_`).
6. Add it to your Render environment as `STRIPE_WEBHOOK_SECRET`.

### Step 3: Test in test mode first

Use `sk_test_...` keys and Stripe's test card numbers (`4242 4242 4242 4242`) before switching to live keys. The webhook endpoint works the same in both modes.

---

## Section 4: Custom Domain

### Step 1: Add the domain on Render

1. In your Web Service settings, go to **Settings** → **Custom Domains**.
2. Click **Add Custom Domain**.
3. Enter your domain (e.g., `app.yourdomain.com`).
4. Render will show you a CNAME record to add.

### Step 2: Add the DNS record

At your domain registrar (GoDaddy, Namecheap, Cloudflare, etc.):

1. Add a **CNAME record**:
   - **Name/Host**: `app` (or `@` for the root domain)
   - **Value/Target**: the value Render showed you (e.g., `hartmonitor.onrender.com`)
   - **TTL**: 300 (5 minutes)

DNS changes can take a few minutes to an hour to propagate.

### Step 3: Update APP_URL

Once the domain is active, update your `APP_URL` environment variable to your custom domain:

```
APP_URL=https://app.yourdomain.com
```

Trigger a redeploy so the new URL takes effect (Stripe redirects and OAuth callbacks need it).

---

## Section 5: Verify deployment

After deployment completes, run through this checklist:

- [ ] Visit `https://YOUR-DOMAIN/api/health` — response should include `"status":"ok"` and show `version`, `nodeVersion`, `memoryMB`
- [ ] Visit the app root `https://YOUR-DOMAIN/` — the login page should load
- [ ] Sign up for a new account
- [ ] Confirm the trial is active (14 days from signup)
- [ ] Test a Stripe checkout using Stripe test mode (`sk_test_...`) with card `4242 4242 4242 4242`
- [ ] Confirm the webhook fires (check Stripe Dashboard → Webhooks → Recent deliveries)
- [ ] Send a test email notification (if SMTP is configured)
- [ ] Check the **Logs** tab in Render for any errors

---

## Section 6: Safe updates (deploying new versions)

Deploying updates is safe and non-disruptive:

1. **Push to main** — Render auto-deploys on every push to the configured branch. No manual steps needed.
2. **Database migrations run automatically** on startup — the migration runner in `backend/src/db/migrate.js` applies any new migrations before the server accepts traffic. Migrations are strictly additive (no destructive changes), so your data is never at risk.
3. **Zero downtime strategy** — Render starts the new instance before shutting down the old one. In-flight requests finish gracefully (10-second shutdown timeout).
4. **Frontend cache-busting** — the built frontend assets are fingerprinted by content hash (e.g., `index-a3f9b2.js`). The `index.html` is served with `no-cache` so users always get the latest pointer on the next page load.
5. **Active users** — users with the app open will see a "New version available" banner prompting them to refresh. No forced interruption.

---

## Section 7: Rollback

If a deployment causes issues, roll back to the previous working version:

### Option A: Revert via Render Dashboard (fastest)

1. Go to your Web Service in the Render Dashboard.
2. Click the **Deploys** tab.
3. Find the last successful deploy.
4. Click **Rollback to this deploy**.

The previous version restarts immediately. No code changes needed.

### Option B: Revert via git

```bash
# Find the commit you want to go back to
git log --oneline -10

# Create a revert commit (safe — doesn't rewrite history)
git revert <bad-commit-hash>
git push origin main
```

Render will auto-deploy the revert commit.

### Database note

Database migrations are never rolled back automatically. If a new migration caused data issues, you have two options:

1. **Restore from backup** — automated backups are stored in `/data/backups`. Connect to your Render instance via Shell and copy the backup file:
   ```bash
   cp /data/backups/mes-backup-<timestamp>.db /data/mes.db
   ```
   Then restart the service.

2. **Manual fix** — connect via Render Shell and run SQLite commands to fix the specific data issue.

---

## Appendix: Useful commands

```bash
# Generate a secure random secret
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"

# Check health endpoint
curl https://YOUR-DOMAIN/api/health | jq

# Check service logs (via Render Dashboard → Logs tab)
# or using the Render CLI:
render logs --service=hartmonitor --tail
```

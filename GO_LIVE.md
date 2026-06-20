# HartMonitor — Complete Go-Live & Monetization Plan

This is your master checklist to take HartMonitor from "code is ready" to
"paying customers using it in production." Work top to bottom. Each phase has
**exact steps**, what it costs, and how long it takes.

Detailed companion docs:
- `DEPLOYMENT.md` — Railway/host deploy details
- `STRIPE_SETUP.md` — payment setup
- `MIGRATIONS.md` / `UPGRADING.md` — changing the app later without losing data
- `LAUNCH.md` — pre-launch QA checklist

Legend: ✅ = done in code · 🟡 = needs your action · ⏱ = rough time

---

## Phase 0 — Accounts you need (do first)

| Service | Why | Required? | Cost |
|---|---|---|---|
| **Railway** | Hosting | ✅ Required | ~$5–20/mo |
| **Stripe** | Collect money | ✅ Required to charge | 2.9% + 30¢ per charge |
| **Domain registrar** (Namecheap/Cloudflare) | Your URL | 🟡 Strongly recommended | ~$12/yr |
| **Business entity** (LLC) + business bank | Legitimately take revenue | 🟡 Required to monetize legally | varies |
| SendGrid/Postmark (SMTP) | Customer emails | Optional (app works without) | Free tier OK |

⏱ ~1–2 hours to create accounts; LLC formation can take days.

---

## Phase 1 — Deploy the code to Railway

Railway deploys from your `main` branch. All the new work is in **PR #18**, which
is not merged yet. **Set up Railway first, then merge.**

### 1.1 Attach a persistent Volume 🟡 (CRITICAL — protects customer data)
Without this, Railway wipes the database on every redeploy.
1. Railway → your service → **Settings → Volumes → + New Volume**
2. Mount path: `/data`
3. Save (triggers a redeploy)

### 1.2 Set environment variables 🟡
Railway → service → **Variables**:

| Variable | Value | Required |
|---|---|---|
| `DATABASE_PATH` | `/data/mes.db` | ✅ |
| `BACKUP_DIR` | `/data/backups` | ✅ |
| `JWT_SECRET` | `node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"` | ✅ |
| `SESSION_SECRET` | run that command again (different value) | ✅ |
| `APP_URL` | your final URL (e.g. `https://app.yourdomain.com`) | ✅ |
| `NODE_ENV` | `production` | ✅ |
| `SEED_DEMO_DATA` | `false` | ✅ never true in prod |
| `PORT` | `3001` (or leave for Railway to inject) | ✅ |
| `STRIPE_SECRET_KEY` | from Stripe (Phase 3) | for payments |
| `STRIPE_WEBHOOK_SECRET` | from Stripe (Phase 3) | for payments |
| `SMTP_*` | from SendGrid | optional |

The app **refuses to boot** if `JWT_SECRET`/`SESSION_SECRET` are missing — by design.

### 1.3 Merge PR #18 🟡
After the Volume + required vars are set, merge the PR. Railway auto-builds
(`npm install && npm run build`) and starts (`node backend/src/index.js`).

### 1.4 Verify 🟡
- `https://YOUR-URL/api/health` → `{"status":"ok",...}`
- Sign up → you land in the app with a 14-day trial
- Redeploy once, confirm your account still exists (proves the Volume works)

⏱ 30–45 min.

---

## Phase 2 — Custom domain

1. Buy a domain (e.g. `hartmonitor.io`).
2. Railway → service → **Settings → Networking → Custom Domain** → add
   `app.yourdomain.com`.
3. Add the CNAME record Railway shows you at your registrar.
4. Update `APP_URL` to the new domain and redeploy.

⏱ 15 min + DNS propagation.

---

## Phase 3 — Stripe (collect money)

Full steps in `STRIPE_SETUP.md`. Short version — **you do NOT create products or
prices; they're defined in code.**

### 3.1 Start in test mode
1. Stripe dashboard → copy **test** secret key (`sk_test_...`) → set as
   `STRIPE_SECRET_KEY` in Railway.
2. Stripe → **Developers → Webhooks → Add endpoint**
   - URL: `https://YOUR-URL/api/webhooks/stripe`
   - Events: `checkout.session.completed`, `customer.subscription.updated`,
     `customer.subscription.deleted`, `invoice.payment_failed`,
     `customer.subscription.trial_will_end`
   - Copy the **Signing secret** (`whsec_...`) → set as `STRIPE_WEBHOOK_SECRET`.
3. Test a checkout with card `4242 4242 4242 4242`. Confirm the plan upgrades.

### 3.2 Go live
1. Activate your Stripe account (business details, bank account for payouts).
2. Swap to **live** keys (`sk_live_...`, new `whsec_...`) in Railway.
3. Do one real low-risk transaction to confirm payouts work.

⏱ 1–2 hours (plus Stripe account verification, which can take a day).

---

## Phase 4 — Legal & business (required to monetize legitimately)

This is the part code can't do for you. *Not legal advice — consult a
professional for your situation.* See `PROJECT_PLAN.md` for the visual version
with dropdowns.

> **Start this NOW, in parallel with the technical track** — the LLC has the
> longest lead time (days to ~2 weeks). You do NOT need it to deploy or run a
> free private beta; you DO need it before taking real recurring revenue.

### 4.1 Form an LLC + get an EIN 🟡 (start first)
- [ ] Pick where to form (home state simplest; Delaware common for SaaS)
- [ ] File: **DIY** via state site (~$50–500), a **service** (Northwest,
      LegalZoom), or **Stripe Atlas** (~$500, entity + EIN + bank in one flow)
- [ ] Get a free **EIN** from the IRS (online, ~10 min)
- [ ] (Recommended) An operating agreement, even for a single-member LLC

### 4.2 Open a business bank account 🟡
- [ ] Use LLC docs + EIN at a bank or online (Mercury/Novo are SaaS-friendly)
- [ ] Keep ALL business money separate from personal (preserves liability shield)
- [ ] This is the account Stripe pays out to

### 4.3 Terms of Service + Privacy Policy 🟡
- [ ] Draft via Termly/iubenda/GetTerms, or a lawyer
- [ ] Cover: subscription terms, data ownership (customers own their data),
      30-day retention after cancellation (already built), liability limits,
      refund policy
- [ ] Replace placeholder text on the in-app `/terms` and `/privacy` pages

### 4.4 Stripe business activation + tax 🟡
- [ ] Complete Stripe activation (business details, EIN, bank)
- [ ] Connect business bank for payouts
- [ ] (Recommended) Enable **Stripe Tax** to auto-calculate sales tax/VAT
- [ ] Security posture for manufacturer buyers: you already have per-tenant
      isolation, httpOnly cookie auth, RBAC, audit log, and data export

⏱ Filing is quick; **LLC approval is the long pole** (days–2 weeks). Run a free
private beta meanwhile, but don't switch Stripe to live until entity + bank +
ToS are in place.

---

## Phase 5 — Backups & data safety

- ✅ Automated SQLite backups run on a schedule to `BACKUP_DIR` (`/data/backups`).
- 🟡 **Off-volume backups:** the Volume is one failure domain. Periodically copy
  `/data/backups` off Railway (download, or add a job to push to S3/Backblaze).
- 🟡 **Test a restore once** before you have customers: download a backup, spin up
  locally, point `DATABASE_PATH` at it, confirm data loads.

⏱ 30 min now; recurring.

---

## Phase 6 — Updating the app later WITHOUT disrupting customers

This was a key requirement. Here's exactly how it works (full detail in
`UPGRADING.md`):

- ✅ **Database changes are additive-only and automatic.** Add a numbered `.sql`
  file in `backend/src/db/migrations/`; it runs once on the next deploy, wrapped
  in a transaction. **Never** drop/rename columns — only add. Existing customer
  data and anything they built is untouched.
- ✅ **Code deploys are zero-touch for data.** Push to `main` → Railway redeploys
  → the Volume (and the DB on it) persists across the redeploy.
- ✅ **Frontend "new version" handling.** Web users get the new build on next load;
  a PWA update prompt surfaces when a new version is available, so they refresh on
  their terms. Native (App Store) users update through normal store updates.
- 🟡 **Your release routine** for every change:
  1. Open a PR from a feature branch (not `main`).
  2. CI must be green (tests + typecheck + build).
  3. Merge to `main` → Railway deploys.
  4. Check `/api/health` and smoke-test one flow.
  5. If something's wrong, Railway → Deployments → **Redeploy** a previous build
     (instant rollback; data is safe on the Volume).

> If you ever want customers to **opt in** to updates rather than auto-receive
> them, the clean way is a staging service (separate Railway service + Volume) you
> deploy to first, then promote to production. Ask and I'll set that up — it's the
> one thing I deliberately left out to keep you to a single service for launch.

---

## Phase 7 — First customer onboarding

- ✅ Self-serve signup creates the org, first admin user, a Main Site, and a free
  plan with a 14-day trial.
- ✅ In-app **setup checklist** guides new accounts (add department → station →
  work order → invite team).
- ✅ Welcome email on signup (if SMTP set; otherwise it's logged).
- 🟡 Decide your **trial → paid** funnel: trial is 14 days, then the account needs
  a paid plan. The billing banner already nudges them.
- 🟡 If SMTP is off, password resets appear in `/admin → System → Pending Resets`
  for you to send manually. Turn on SMTP once you have >a handful of users.

---

## Phase 8 — Monitoring & support

- ✅ `/api/health` for uptime checks — point a free monitor (UptimeRobot,
  Better Stack) at it; alert if it goes down.
- ✅ Structured JSON logs (viewable in Railway logs).
- 🟡 Optional: set `SENTRY_DSN` for error tracking.
- 🟡 Set up a support inbox (the app footer/contact can point to it).

---

## Phase 9 — Mobile apps (optional, later)

- ✅ Capacitor is configured (`frontend/capacitor.config.ts`) for iOS + Android.
- 🟡 Requires Apple Developer ($99/yr) and Google Play ($25 one-time) accounts.
- 🟡 Run `npm run cap:add:ios` / `cap:add:android`, build in Xcode/Android Studio,
  submit. The web app already works on phones as a PWA, so this is not required to
  launch.

---

## The critical path (minimum to take your first paying customer)

1. Railway: Volume + required env vars (Phase 1.1–1.2)
2. Merge PR #18, verify health + signup (Phase 1.3–1.4)
3. Custom domain (Phase 2)
4. Stripe live keys + webhook (Phase 3)
5. LLC + business bank + ToS/Privacy (Phase 4)
6. Off-volume backup + one restore test (Phase 5)

Everything else (SMTP, Sentry, mobile apps, staging service) can come after you
have your first customers.

---

## Quick reference — what's already done vs. what's on you

**Done in code (✅):** multi-tenant MES with all modules, RBAC, Stripe billing
with in-code prices + trials + grace period, admin dashboard, additive migration
system, automated backups, data export, transactional emails, health checks,
security hardening, CI with passing tests, Railway + Capacitor config.

**On you (🟡):** Railway Volume + env vars, merge the PR, domain, Stripe live
activation, business entity + bank + ToS/Privacy, off-volume backup copies,
ongoing release routine.

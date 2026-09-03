# HartMonitor — Project Brief

> **Purpose of this file:** the complete context for HartMonitor in one place. Paste it into any AI session, or hand it to a developer, and they will understand what this software is, why it exists, how it's built, and what the rules are. Keep it updated as the product evolves.

---

## 1. Mission

**Build and sell a production-ready, composable Manufacturing Execution System (MES) as a SaaS product.**

HartMonitor gives small and mid-size manufacturers the shop-floor software that today only large factories can afford. One subscription replaces paper travelers, whiteboards, and spreadsheet trackers with a live system for running production — and each factory composes exactly the MES it needs by toggling modules on and off.

The owner (Luke) is a solo founder. The product must therefore be:
- **Self-serve** — customers sign up, onboard, and pay without human intervention
- **Low-ops** — minimal external services (Railway for hosting, Stripe for payments; everything else optional)
- **Safe to update** — code ships continuously without ever disrupting customer data

## 2. Who it's for

Small/mid-size manufacturers (5–200 employees): machine shops, fabricators, assembly plants, food producers. The buyer is a plant manager or owner; daily users are operators on tablets at work stations, supervisors, and quality/maintenance staff.

## 3. Business model

SaaS subscription via Stripe, priced per company (not per seat):

| Plan / Add-on | Price |
|---|---|
| Pro (everything) | $299/mo |
| Manufacturing module | $79/mo |
| Inventory module | $59/mo |
| Quality module | $49/mo |
| Training module | $49/mo |
| Custom app slot | $29/mo |
| Dashboard slot | $19/mo |

- **14-day free trial**, no credit card required; trial grants Pro access
- **7-day grace period** after a failed payment before downgrade
- Free tier remains usable (limited apps/dashboards) as a permanent on-ramp
- Prices are **defined in code** (`backend/src/pricing.js` + checkout `price_data`) — no Stripe Products to configure; only `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` are needed

## 4. The product — composable modules

Every company toggles modules in **Settings → Modules** (manager+ only). Disabled modules vanish from navigation and their URLs redirect. Defaults: everything on. `production` and `analytics` are core and cannot be disabled.

| Module | What it does |
|---|---|
| **Production** (core) | Work orders, stations, departments, scheduling, OEE, operator portal |
| **Analytics** (core) | Throughput, cycle times, capacity planning, leaderboards |
| **Quality** | NCRs, CAPA tracker, SQDC boards, inspections |
| **Inventory** | Items, stock levels, receiving, purchasing, shipments, min/max |
| **Maintenance** | CMMS: assets, PM schedules, maintenance work orders |
| **Andon** | Line-stop calls and real-time alerting |
| **Kaizen** | Continuous-improvement idea pipeline |
| **Training** | Skills matrix, certifications, training plans |
| **Shifts** | Shift notes and handoff summaries |
| **Apps** | No-code app builder (custom forms/procedures with images, video, 3D models), custom tables, dashboards |

Differentiators: the **no-code app builder** (operators run guided procedures built by their own supervisors), **composability**, tablet-first operator portal with offline queueing, and PWA + Capacitor wrappers for iOS/Android app stores.

## 5. Architecture

**Stack:** Node.js + Express + better-sqlite3 (WAL) · React 18 + TypeScript + Vite + Tailwind · npm workspaces (single root lockfile).

- **Multi-tenant:** every table carries `company_id`; every query filters by it; middleware sets `req.companyId` from the session. Cross-tenant reference validation on all foreign keys.
- **Auth:** httpOnly cookie (`hm_token`) on web; OS-keychain token via Capacitor Preferences + Authorization header on native; API keys for `/api/v1`. Sessions expire; role changes invalidate sessions.
- **RBAC:** developer > manager > supervisor > operator > viewer. GET open to members; writes role-gated (`writeRole`).
- **Database:** SQLite on a persistent volume (`DATABASE_PATH=/data/mes.db`). This is deliberate — production-grade at this scale, zero external DB service. A Prisma/Postgres schema + RLS migrations exist in `backend/prisma/` and `supabase/` as a documented future path if scale demands it.
- **Migrations:** numbered `.sql` files in `backend/src/db/migrations/`, run automatically at startup inside transactions, tracked in `_schema_migrations`. **Additive-only** — never DROP/RENAME.
- **Payments:** Stripe Checkout + Billing Portal + signature-verified webhooks (`/api/webhooks/stripe`); handles checkout, renewal, payment-failure (grace period), trial-ending, cancellation.
- **Email:** SMTP if configured (welcome, reset, trial-ending, payment-failed); degrades to console logging. Without SMTP, admins copy password-reset links from `/admin → System`.
- **Backups:** automatic SQLite backups to `BACKUP_DIR` on the volume.
- **Admin:** `/admin` (developer role) — all customers, plan overrides, users, activity, system health, pending resets.
- **Uploads:** base64 JSON → `/api/upload/image` → served from `/uploads/` (on the volume). Images ≤15MB, models ≤50MB, video ≤200MB; SVG active-content rejected; HEIC rejected with guidance.
- **Observability:** `/api/health` (status, version, memory, DB size), Pino JSON logs, optional Sentry via `SENTRY_DSN`.

## 6. Non-negotiable engineering rules

1. **Never lose customer data.** Migrations are additive-only. Never DROP/RENAME tables or columns. (See `UPGRADING.md`.)
2. **Never leak across tenants.** Every query filters by `company_id`; foreign-key references are ownership-checked. Regression tests in `backend/test/`.
3. **Never commit secrets.** Env vars only. The server **refuses to boot in production** without `JWT_SECRET`/`SESSION_SECRET`.
4. **`SEED_DEMO_DATA` must never be `true` in production** (ships known credentials).
5. **All work goes through PRs with green CI** (backend tests, frontend typecheck + tests + build).
6. **Errors are visible.** No silent catches in user flows; failures surface with actionable messages.

## 7. Deployment & operations

- **Hosting:** Railway, auto-deploys `main`. Build `npm install && npm run build`; start `node backend/src/index.js`; healthcheck `/api/health` (`railway.json`).
- **Required env vars:** `JWT_SECRET`, `SESSION_SECRET`, `NODE_ENV=production`, `APP_URL`, `DATABASE_PATH=/data/mes.db`, `BACKUP_DIR=/data/backups`, `SEED_DEMO_DATA=false`. Payments: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`. Optional: `SMTP_*`, SSO client IDs, `TWILIO_*`, `SENTRY_DSN`. (Railway injects `PORT`.)
- **A Railway Volume mounted at `/data` is mandatory** — it holds the database, uploads, and backups across deploys.
- **Release flow:** feature branch → PR → CI green → merge `main` → Railway deploys → check `/api/health`. Rollback = redeploy previous build (data is safe on the volume). Optional staging service documented in `STAGING.md`.
- Deployment runbooks: `DEPLOYMENT.md`, `GO_LIVE.md`, `PROJECT_PLAN.md` (visual), `STRIPE_SETUP.md`, `LAUNCH.md`.

## 8. Current state (September 2026)

**Live** at hartmonitorapp.com; `main` auto-deploys to Railway with the database, uploads and
backups on a `/data` volume. Early access is ON, so every module is free and no billing prompt
appears.

**Done and merged to `main`:** every module listed above; the composable module system;
multi-tenant auth and RBAC hardening; Stripe billing with trial and grace; transactional email
through Resend; the admin dashboard; additive numbered migrations with a runner
(`backend/src/db/migrations/`, rules in `MIGRATIONS.md`); automated backups; customer data
export; the visual design system; and a five-wave improvement program (PRs #32-#36) that gave
the product its spine:

- one definition of the plant day, of a duration, and of "what is running now" — so two screens
  can no longer disagree about the same shift;
- routings that execute: release a work order and its operations advance with good, scrap and
  rework counted at the operation;
- instructions with revisions, a change note and an approver who is not the author, and the
  revision that produced each run stamped on the run;
- coded scrap and coded downtime feeding quality, OEE and a loss Pareto;
- one vocabulary on every screen, one report builder, and a demo seed in which every module is
  visibly alive — verified by an independent hostile audit (NO-GO, fixed, then GO).

**Test baseline:** 740 backend tests, 884 frontend tests, a 57-route fit crawl at 390/768/1920
with zero overflow, typecheck and build clean, and a boot against a copy of the production
database that applies migrations 001-012 with zero backfill. CI runs all of it on every push.

**Remaining — owner's checklist:**
1. Railway: set `PLATFORM_STAFF_EMAILS`; set `PROD_URL` as a GitHub Actions variable
2. Rotate any key that was pasted into a chat (Railway, Cloudflare, Resend, Stripe test)
3. Stripe: live keys + webhook endpoint — only when you start charging
4. Business: LLC + EIN + business bank + real Terms/Privacy text (pages exist at `/terms`, `/privacy`)
5. Off-platform backup copies and one restore drill
6. Run a real job on your own floor: a real routing, real part numbers, one real shift
7. Optional: Sentry, a staging service, app-store submissions

## 9. Working on this codebase

- Branch from `main`; open a PR; CI must pass. Root `npm ci`; run with `npm run dev`; tests: `npm test --workspace=backend`, `npm test --workspace=frontend`, `npm run typecheck --workspace=frontend`.
- Schema changes: new numbered file in `backend/src/db/migrations/` (additive only).
- New pages follow existing patterns: Skeleton loaders, EmptyState, useToast errors, module gating via `ModulesContext`/`ModuleGate`, nav in `frontend/src/config/navigation.tsx` with a `module` key.
- Docs index: `README.md` · `PROJECT_BRIEF.md` (this file) · `PROJECT_PLAN.md` · `GO_LIVE.md` · `DEPLOYMENT.md` · `STAGING.md` · `STRIPE_SETUP.md` · `UPGRADING.md` · `MIGRATIONS.md` · `LAUNCH.md` · `HOSTING.md`

# HartMonitor — Continuation Plan for Opus-Class Agents

> **Who this is for:** future Claude sessions (Opus-class) continuing HartMonitor with limited prior context. Read `PROJECT_BRIEF.md` first for what the product is. This file is the WORK PLAN: current state, operating protocol, and a mission queue with acceptance criteria. Execute missions with parallel worktree sub-agents where scoped; the coordinator merges, verifies, ships.

---

## 1. Current state (as of this file's commit)

- **Production** (Railway → hartmonitorapp.com + www, DNS on Cloudflare, TLS via Railway) runs `main` at PR #22: analytics + audit fixes + slim demo banner. Volume mounted at `/data`; DB/uploads/backups live there. `EARLY_ACCESS` defaults ON (everything free, no billing prompts). Secrets self-heal on boot (`.hm-secrets.json` beside the DB) — explicit env vars win.
- **Branch `claude/trusting-fermat-KIymW`** (UNSHIPPED, all tests green: 152 backend / ~163 frontend / build) contains the full wave: two-level navigation (workspaces sidebar + route-derived screen tabs, logo→Command Center, AlertsBubble removed, AlertsBell in sidebar), builder UX (ribbon widget tabs, pinned "+ New step", collapsible context panel, run-requirements toggle), player batch (contrast, single-nav rule, takt countdown bar + flash, WO/part-number run gating, in-run NCR with supervisor-PIN authorizer, multi-operator sessions with handoff comments + jobs-in-progress resume), per-workspace editable Reports pages, app templates (+ built-in model templates), facility shift builder, duplicate-name 409s, full-coverage demo seed (BOMs/kit-with-shortage/NCRs/CAPA/maintenance/andon/training/late-PO/analytics data), Kaizen crash guard, `require_run_context` persisted server-side.
- **Email**: Resend live and domain-verified (`noreply@hartmonitorapp.com`); `RESEND_API_KEY` + `EMAIL_FROM` set in Railway. Test email delivered.
- **Railway API access**: project token in the owner's chat history; IDs — project `531029d3-79ff-497d-ad78-7a655ad72eb2`, env `0577bb97-2495-43bd-b8b5-39b51f054610`, service `f6a8e76d-2fe6-4a42-8796-934bd754a8c0`. GraphQL at `backboard.railway.app/graphql/v2` with `Project-Access-Token` header. Cloudflare zone `b580de7184699a955822c37f85e9a8e3` (token in chat; NEVER commit tokens).
- **Task ledger** (session task list #6–#17): everything through #16 is BUILT on the branch; #17 (in-app team call system) and the two newest asks (freshness indicators, dashboard filters) are NOT yet built — they are missions below.

## 2. Operating protocol (hard-won; follow exactly)

1. **Worktree discipline**: every sub-agent works in an isolated git worktree branched from the CURRENT branch tip; commits locally; NEVER pushes (the git proxy 503s non-`claude/*` branch pushes). The coordinator merges local worktree branches.
2. **Merge hygiene — the #1 failure mode**: after EVERY `git merge`, run `grep -rln "^<<<<<<< " backend/src frontend/src` and `git status --short | grep -E "^(UU|AA)"` BEFORE committing. A sealed conflict marker took production-candidate tests from 145-pass to 93-fail once. Resolve `db.js` conflicts by keeping BOTH additive blocks and checking backtick balance (template literals!). `client.ts`/`types.ts` conflicts: stack labeled append-blocks inside the `api` object / after it — watch that a block doesn't land inside an interface.
3. **Verification with REAL exit codes** (pipes eat failures): run each as its own command and check `$?` or `&& echo OK || echo FAIL` — never `cmd | grep` as the last word:
   - `cd backend && node --test test/*.test.js` (152+ tests)
   - `npm run typecheck --workspace=frontend`, `npm test --workspace=frontend`, `npm run build --workspace=frontend` (workspace root)
4. **Backend test ports registry** (server-spawning suites; unique per file): 3185 sandbox-seed · 3186 shifts-validation · 3187 app-templates · 3188 category-reports · 3189 player-batch · 3190 app-analytics · 3191 table-import · 3192 completion-values · 3193 boms-kits · 3195 audit · 3196 modules · 3197 tenant-isolation · 3198 launch-features · 3199 smoke. New suites take 3184 downward. **Agent scratch servers** (manual browser checks, not test suites) take 3201 upward, one per concurrent agent — a collision here silently *cancels* another agent's tests and still exits 0.
5. **Shared UI primitives — reach for these before hand-rolling**: `useDepartmentFilter(scope)` + `<DepartmentFilter/>` (department scoping on management screens), `useAutoRefresh` + `<LastRefreshed/>` (polling and freshness), `<DashboardFilterBar/>` (department/app/site scoping on dashboards), `<EmptyState/>`, `<PageHeader/>`. A page that grows its own private version of one of these is how the same filter ends up behaving three different ways.
6. **Non-negotiables**: additive-only migrations (guarded PRAGMA/IF NOT EXISTS in `db.js` — no runMigrations dir on this lineage); tenant scoping (`company_id = req.companyId`) + FK ownership checks; TypeScript strict, no `any` in new code; v1 app blobs keep working (`normalizeApp`); every enum rendered by a page config map MUST have a fallback (see Kaizen `catOf`/`statusOf`) — and seeds must use page-known values; existing tests pass unmodified.
7. **Browser E2E pattern**: build frontend; boot backend (`NODE_ENV=test PORT=32xx DATABASE_PATH=/tmp/... SEED_DEMO_DATA=false`); it serves `frontend/dist`; `POST /api/auth/demo` gives a fully-seeded sandbox; Playwright via `npm install playwright-core` in a scratch dir with `executablePath: '/opt/pw-browsers/chromium'`. Read your screenshots.
8. **Shipping**: PR to `main` → CI green (both workflows) → merge → Railway auto-deploys → check `https://hartmonitorapp.com/api/health`, then click through the changed surfaces on production.

## 3. Mission queue

Execute roughly in order; M0 first, M-numbered groups may parallelize where file scopes don't overlap. Each mission = one focused agent (or small crew) + coordinator merge/verify.

### M0 — Ship the wave (coordinator, first action)
The branch is green and pushed. Open/refresh the PR to `main`, wait for CI, merge, verify production: health, demo sandbox opens populated (BOMs, kit shortage on Kitting, critical NCR on dashboard attention, analytics charts non-empty), new nav works, builder ribbon tabs, player runs a job. **Done when** production serves the wave with no console errors on the main paths.

### M1 — Product-goal review: every screen must make sense (high judgment)
Walk EVERY screen as a manufacturing plant manager would (use the demo sandbox): does the screen answer a real question? Are the metrics honest and derived from real data (no placeholder/nonsense numbers — owner explicitly hates invented stats)? Is the primary action obvious? Specifically scrutinize: Command Center KPIs vs what a plant manager needs at 6am; per-workspace Reports defaults; OEE/StepMetrics/CapacityPlanning (older pages — do they still fit the new data model?); Leaderboard relevance; ManagerView/DepartmentView overlap. Produce a findings doc, then FIX the top issues (relabel, re-derive, remove, or redesign). **Done when** a written screen-by-screen verdict exists and every "doesn't make sense" finding is fixed or explicitly deferred with reason.

### M2 — Full UI audit round 3 (post-wave)
Playwright at 1440×900 / 834×1112 / 390×844 across every page INCLUDING the new surfaces (two-level nav tabs, ribbon builder, collapsible panel, Reports pages, BOMs/Kitting, Facilities shifts, templates picker, player: kit step, NCR sheet, handoff, jobs-in-progress). Hunt overlaps, clipping, contrast, z-index, focus states, console errors. Also confirm on-screen data updates: pages that poll actually refresh. Fix everything; screenshot-verify each fix. **Done when** a clean three-viewport pass with zero console errors exists.

### M3 — Codex + review sweep
Enumerate ALL PR review comments (Codex and human) across open AND recently merged PRs (`gh` unavailable — use the GitHub MCP tools: `list_pull_requests`, `pull_request_read.get_review_comments`). Address every unresolved comment: fix or reply with reasoning. **Done when** zero unaddressed comments remain.

### M4 — Auth truth test (real emails, real flows)
Against a LOCAL prod-mode boot first, then PRODUCTION: signup (welcome email actually delivered via Resend — verify with the Resend API `GET /emails/{id}` status, key in Railway vars), sign-in, sign-out, forgot-password → email link → reset → old sessions invalidated → login with new password; password change; badge/PIN operator login; kiosk lock on/off routing; session expiry behavior; demo sandbox → "Keep my work" upgrade path (does converting a sandbox to a real account work? If it just links to signup and abandons sandbox data, DECIDE and implement the honest behavior). Email templates: render check (dark-theme HTML in real clients — send to a test inbox), links must point at `https://hartmonitorapp.com`. **Done when** every auth path is browser-verified end-to-end with real delivered emails, and bugs found are fixed + regression-tested.

### M5 — "Real plant" dogfood (the big one)
Build a complete, realistic plant IN THE PRODUCT (fresh real account, not the sandbox): 2 facilities with shift schedules; 4+ departments; 8+ stations; 15+ operators with PINs/badges across roles; item master (~30 items) with locations/min-max; product types with versioned BOMs; 4+ apps built FROM the builder (use templates + build one complex canvas app with triggers, kit step, photo evidence, scan input); routings; a week of work orders; generate kits (leave one short); run 15+ player jobs including: multi-operator handoff mid-job, in-run NCR with PIN, takt overrun, offline-queue flush, Next-unit chains. Then judge the OUTPUT surfaces: do Command Center, App Analytics, Reports, OEE, Leaderboard, Kitting, Materials Required reflect this plant truthfully? File and fix everything broken or nonsensical. This mission validates the PRODUCT GOAL, not just code. **Done when** the plant exists, the run data reads true on every analytics surface, and all found defects are fixed.

### M6 — In-app team call system (task #17, spec already written)
Build on Andon: player "Call for help" (Quality / Supervisor / Maintenance / Materials + note) → `andon_calls` extended additively (team, work_order_id, app_id, step_name, completion_id) → WebSocket broadcast → Command Center attention + Andon Board team chips + AlertsBell badge + `notifications.js` event. Ack ("On my way", responder recorded) + resolve; response-time metrics on the board. Tests: lifecycle, team filter, tenant isolation, WS emit. Player files are now unowned — safe.

### M7 — Live-data freshness indicators
Shared `useAutoRefresh(fetch, intervalMs)` hook + a small `LastRefreshed` header element ("Updated 12s ago" ticking, subtle pulse dot while fetching, manual refresh button). Apply to: Command Center, Andon Board, Kitting, OEE, Department/Manager/Station views, Inventory, Jobs-in-progress (player setup). Keep intervals sane (10–60s) and pause when the tab is hidden (`visibilitychange`). **Done when** every operational screen shows verifiable freshness and no interval leaks (unmount cleanup tested).

### M8 — Dashboard & report filters
Page-level filter bar (department, app, site, date range where sensible) on custom dashboards AND category Reports: backend card-data endpoints accept `department_id`/`app_id`/`site_id` filters (each card type applies what's meaningful; ignore where not), frontend filter bar persists per dashboard (localStorage), cards visibly reload on change. Tests per card type with filters + tenant isolation. **Done when** a user can filter Production Reports to one department and every card honors it.

### M9 — Vocabulary reconciliation (schema CHECK vs UI)
`kaizen_ideas` CHECK allows `under_review` but UI vocabulary is `reviewing` (aliased in UI for now); CAPA actions CHECK uses `done` vs page `complete`. Since CHECK constraints can't be altered additively, standardize the APP on the CHECK-legal sets: update page config maps and any writers to the canonical values, keep render aliases for legacy rows, and add a test asserting every page enum map covers its table's CHECK set. Sweep ALL enum-bearing tables (grep `CHECK(` in db.js) against their page maps. **Done when** the test suite locks page-maps ⊇ CHECK-sets everywhere.

### M10 — Performance & volume pass
Seed a company with 5k completions / 50k completion_values / 500 WOs locally; measure the hot endpoints (dashboard brief, analytics, completions list, kitting list) — fix N+1s and missing indexes (additive `CREATE INDEX IF NOT EXISTS` only); confirm UI stays responsive (pagination/virtualization where lists render unbounded). **Done when** hot endpoints stay under ~300ms at that volume locally and no unbounded list renders.

### M11 — Mobile & PWA/native pass
Full phone-width pass of the operator-critical paths (player, operator portal, kitting) + verify the PWA install/update flow and Capacitor config still build (`npm run cap:sync` dry run at least). Check `start_url: '/operator'` still makes sense with kiosk lock. **Done when** an operator can run a full job flawlessly on a 390px phone.

### M12 — Docs & release
Update `PROJECT_BRIEF.md` (current-state section), `GO_LIVE.md` checklist state, and this file's §1. Final Codex sweep (M3 re-run on the new PRs), ship everything (M0 protocol), and tag `v1.0.0` on main. **Done when** main == deployed == documented reality.

## 4. Standing decisions & gotchas (do not relearn)

- Owner insists: NO invented numbers anywhere customer-visible (marketing stats were rewritten to honest product facts — keep it that way).
- SQDC is deliberately shelved (route redirects; code intact). Do not resurrect without an owner ask.
- `flowInkColor` in PlayerWidgets is superseded by `playerTextColor` (runtime.ts) at the text/instruction call sites; remove the dead helper when convenient.
- Settings → Sidebar tab still has stale "Default view" copy from the pre-two-level nav era — reword/remove during M1.
- The sandbox login persists `hm_user` to localStorage BEFORE redirect (AuthContext only probes `/auth/me` when a session marker exists — do not remove that guard; anonymous marketing visits must never 401-probe).
- Kit consume movements: exactly-once via `notes='kit_line:<lineId>'` marker, `reference_type='kit'`; regenerating a kit after cancel hard-replaces the cancelled row (UNIQUE company/WO).
- Trigger JSON is validated server-side on app save (`INVALID_TRIGGER` with path, ≤1 navigation action per trigger, 2MB cap).
- `require_run_context`: nullable column; absent = legacy; player enforces absent-default only for schema_version ≥ 2.
- Railway healthcheck timeout is 180s; boot self-heals missing JWT/SESSION secrets by persisting beside the DB.
- Cloudflare DNS records for Railway MUST stay DNS-only (proxied=false) or TLS loops.

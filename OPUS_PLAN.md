# HartMonitor — Continuation Plan for Opus-Class Agents

> **Who this is for:** future Claude sessions (Opus-class) continuing HartMonitor with limited prior context. Read `PROJECT_BRIEF.md` first for what the product is. This file is the WORK PLAN: current state, operating protocol, and a mission queue with acceptance criteria. Execute missions with parallel worktree sub-agents where scoped; the coordinator merges, verifies, ships.

---

## 1. Current state (as of this file's commit)

- **Production** (Railway → hartmonitorapp.com + www, DNS on Cloudflare, TLS via Railway) auto-deploys `main`. A volume at `/data` holds the database, uploads and backups. `EARLY_ACCESS` defaults ON (everything free, no billing prompts). Secrets self-heal on boot (`.hm-secrets.json` beside the DB) — explicit env vars win.
- **Railway API access**: project token in the owner's chat history; IDs — project `531029d3-79ff-497d-ad78-7a655ad72eb2`, env `0577bb97-2495-43bd-b8b5-39b51f054610`, service `f6a8e76d-2fe6-4a42-8796-934bd754a8c0`. GraphQL at `backboard.railway.app/graphql/v2` with a `Project-Access-Token` header. Cloudflare zone `b580de7184699a955822c37f85e9a8e3`. **NEVER commit a token.**
- **Shipped**: everything through PR #31 (launch readiness), then the five-wave **improvement program** — PRs #32-#36, all merged to `main` and deployed:
  - **#32 wave 1** — numbered migrations with a runner and written rules (`backend/src/db/migrations/` + `runMigrations.js` + `MIGRATIONS.md`), ONE definition of the plant day (`plantDay.js`), ONE duration model (`cycleTime.js` server-side, the `appModel.ts` formatters client-side), a player that enforces takt and explains itself, one in-product guide.
  - **#33 wave 2** — one floor screen (`plantTruth.js`: snapshot / departments / dispatch / WIP search) served from `/api/floor`, settings that fit every device, the ERP door (`/api/v1`), andon escalation, preventive-maintenance auto-raise.
  - **#34 wave 3** — routings that execute (`workOrderOperations.js`: release → operations, `advance()` with good/scrap/rework and the ready-running-on_hold rules), apps as two screens, instruction revisions with a change note and an approver who is not the author (`appRevisions.js`), one-tap run start gated by qualification (`qualification.js`).
  - **#35 wave 4** — counted completions (`quantity_good/scrap/rework` + coded scrap reasons, advance inside the completion transaction), coded downtime feeding the OEE quality basis and a loss Pareto, dispatch + the operator portal, one Materials screen.
  - **#36 wave 5** — one vocabulary on every screen (enforced by `frontend/src/config/__tests__/vocabulary.test.ts`), one report builder, one demo seed (`seedShapes.js`) in which every module is visibly alive, plus the fixes from a hostile end-to-end audit — its first verdict was NO-GO on three demo dead ends, the re-audit was GO.
- **Test baseline** (at the #36 merge): **740 backend** across 62 files, **884 frontend** across 48 files, **fit crawl 57/57** at 390/768/1920 with zero overflow, typecheck and build clean, and a real-database boot against a copy of production `mes.db` that applies migrations 001-012 with zero backfill. CI runs both workflows on every push.
- **Standing guards to know before you write anything**: `backend/test/migration-discipline.test.js` (applies every shipped `.sql` through db.js), `schema-drift.test.js` (walks every INSERT/UPDATE against the live schema AND presses the create endpoints for 5xx), `partial-update.test.js` (absent vs cleared), `tenant-isolation.test.js`, `frontend/src/pages/__tests__/duration-formatter.test.tsx` (one duration formatter, allowlisted exceptions only), `vocabulary.test.ts` (banned words in frontend source), `frontend/test/viewport-fit.check.mjs` (every route at three widths; `FIT_ROUTES` narrows it and failures print the widest element).
- **Email**: Resend live and domain-verified (`noreply@hartmonitorapp.com`); `RESEND_API_KEY` + `EMAIL_FROM` set in Railway.
- **Owner's standing priorities**, in order: (1) the software must be SIMPLE — the floor's paths are one tap; (2) cycle times captured by apps, reported live and historically, are the whole point of the product; (3) NEVER an invented customer-visible number — unknown prints `—` with a reason, never 0, never 100%; (4) every screen fits every device; (5) never auto-focus an input or open the keyboard; (6) every input keeps its sub-text.
- **Owner-side items still open**: `PLATFORM_STAFF_EMAILS` on Railway, `PROD_URL` as a GitHub Actions variable, rotation of the keys pasted in chat, and the Stripe webhook secret (only when selling starts).

## 1b. Deferred follow-ups (real, not blocking; verify before acting)

- **Two widget renderers by step MODE** — stacked `components/player/PlayerWidgets.tsx` vs free-form `components/app/WidgetView.tsx`. Converting a step between modes changes what the operator sees.
- **Capacity's department filter still matches by NAME** — `/capacity` summary rows carry `department_name` and no id, so the shared predicate falls back to the name (documented at `frontend/src/pages/CapacityPlanning.tsx:104`). Emit `department_id` and switch the picker.
- **`next*Number` helpers are read-then-write** (`db.js`, `pmScheduler.js`, `routes/capa.js`, `ci-projects.js`, `kaizen.js`, `purchasing.js`) — a `UNIQUE(company_id, number)` or an atomic allocate closes the concurrent-duplicate race.
- **API keys carry no scopes** — an existing key can write work orders through `/api/v1`.
- **Contrast round 2** (`.btn-primary` white-on-accent, the operator green primary button, oversized coloured stat numbers, PRO badges, dark-mode `text-gray-500` on the lighter "running job" cards, the OEE amber hint). These were measured before the theme work; re-measure before touching tokens, and remember that a fixed-dark surface inverts the rule.
- **`review-fixes.test.js`** was flaky under a full parallel run (port 3180 contention). Not seen in the last four full runs; stagger server startups if it returns.

## 2. Operating protocol (hard-won; follow exactly)

1. **Worktree discipline**: every sub-agent works in an isolated git worktree branched from the CURRENT branch tip; commits locally; NEVER pushes (the git proxy 503s non-`claude/*` branch pushes). The coordinator merges local worktree branches.
2. **Merge hygiene — the #1 failure mode**: after EVERY `git merge`, run `grep -rln "^<<<<<<< " backend/src frontend/src` and `git status --short | grep -E "^(UU|AA)"` BEFORE committing. A sealed conflict marker took production-candidate tests from 145-pass to 93-fail once. Resolve `db.js` conflicts by keeping BOTH additive blocks and checking backtick balance (template literals!). `client.ts`/`types.ts` conflicts: stack labeled append-blocks inside the `api` object / after it — watch that a block doesn't land inside an interface.
3. **Verification with REAL exit codes** (pipes eat failures): run each as its own command and check `$?` or `&& echo OK || echo FAIL` — never `cmd | grep` as the last word:
   - `cd backend && node --test test/*.test.js` (740 tests, 62 files — never from the repo root, and never two agents at once: the suites bind fixed ports and a collision silently CANCELS a suite while still exiting 0)
   - `npm run typecheck --workspace=frontend`, `npm test --workspace=frontend`, `npm run build --workspace=frontend` (workspace root)
4. **Backend test ports registry** (server-spawning suites; unique per file — a shared port silently *cancels* the other suite's tests while the run still exits `0`, so verify `# cancelled 0` and that the total went UP): 3176 team-calls · 3177 dashboard-filters · 3178 schema-drift · 3179 partial-update · 3180 review-fixes · 3181 app-detail · 3182 alert-routing · 3183 auth-flows · 3184 screen-data-honesty · 3185 sandbox-seed · 3186 shifts-validation · 3187 app-templates · 3188 category-reports · 3189 player-batch · 3190 app-analytics · 3191 table-import · 3192 completion-values · 3193 boms-kits · 3194 analytics-department-filter · 3195 audit · 3196 modules · 3197 tenant-isolation · 3198 launch-features · 3199 smoke. New suites no longer take 3175 downward: **`MIGRATIONS.md` now holds the port registry** and reserves 3401-3415, one per workstream of the improvement program — claim your port there, not here. Check with `grep -rhoE "PORT = 3[0-9]{3}" backend/test/*.js | sort | uniq -c` before claiming one. **Agent scratch servers** (manual browser checks, not test suites) take **3501 upward**, one per concurrent agent.
5. **Shared UI primitives — reach for these before hand-rolling**: `useDepartmentFilter(scope)` + `<DepartmentFilter/>` (department scoping on management screens), `useAutoRefresh` + `<LastRefreshed/>` (polling and freshness), `<DashboardFilterBar/>` (department/app/site scoping on dashboards), `<EmptyState/>`, `<PageHeader/>`. A page that grows its own private version of one of these is how the same filter ends up behaving three different ways.
6. **Non-negotiables**: additive-only migrations — numbered `.sql` files in `backend/src/db/migrations/`, applied transactionally by `runMigrations.js` at `require('./db.js')` time AFTER every CREATE block; the rules and the reserved-number/port registry live in `MIGRATIONS.md`; tenant scoping (`company_id = req.companyId`) + FK ownership checks; TypeScript strict, no `any` in new code; v1 app blobs keep working (`normalizeApp`); every enum rendered by a page config map MUST have a fallback (see Kaizen `catOf`/`statusOf`) — and seeds must use page-known values; existing tests pass unmodified.
7. **Browser E2E pattern**: build frontend; boot backend (`NODE_ENV=test PORT=32xx DATABASE_PATH=/tmp/... SEED_DEMO_DATA=false`); it serves `frontend/dist`; `POST /api/auth/demo` gives a fully-seeded sandbox; Playwright via `npm install playwright-core` in a scratch dir with `executablePath: '/opt/pw-browsers/chromium'`. Read your screenshots.
8. **Shipping**: PR to `main` → CI green (both workflows) → merge → Railway auto-deploys → check `https://hartmonitorapp.com/api/health`, then click through the changed surfaces on production.

## 3. Mission queue

### Status (updated with this file)

- **M0-M4 and M6-M10 are shipped.** M1's `SCREEN_REVIEW.md` findings and M9's enum/vocabulary work were superseded and completed by the improvement program's waves 2-5, which is the authoritative record.
- **M5 (real-plant dogfood)** is the owner's step, not an agent's: it needs a real routing, real part numbers and a real shift on the owner's own floor. Nothing in the code blocks it.
- **M11 (mobile & PWA/native)**: the 390px phone width is now covered continuously by `npm run test:fit` on every route, so the manual phone pass is no longer the guard. Still unverified: the Capacitor `cap:sync` dry run and the PWA install/update flow.
- **M12 (docs & release)**: this section and §1 are that update. `v1.0.0` is NOT tagged, and `package.json` still says 1.0.0 while `main` is far past it — pick a version scheme before tagging.


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

### M9 — Vocabulary reconciliation (schema CHECK vs UI) — MOSTLY DONE
Turned out to be one bug family with two shapes, both of which shipped: **a route writing a column the table never had**, and **a route writing a value its own CHECK forbids**. Five endpoints 500'd on every database — maintenance assets, maintenance work orders, CAPA items, CAPA actions and shift handoff — while demo workspaces looked healthy, because the sandbox seed inserts the OLDER column names directly, so read paths had data while write paths were dead. Fixed by adding the columns additively (backfilled from whichever column each renamed) and standardising routes + pages on the CHECK-legal words (`medium` not `normal`, `completed`/`done` not `complete`), accepting the old spellings inbound so a stale tab keeps working.

Two standing guards now live in `backend/test/schema-drift.test.js`: one walks every INSERT/UPDATE in `backend/src` against the live migrated schema, the other presses all 34 create endpoints and fails on any 5xx (with a floor of 30 successes so a renamed route can't silently make it stop guarding).

**The render-side half is now closed too.** It was worse than "unreachable": Kaizen offered `reviewing` and `on_hold`, neither of which its column accepts, so picking Reviewing — the page's own word — 500'd. Shift notes sent `draft` where the column stores `active`, so a note was created and the page could never find it (the modal closed and nothing appeared, which is how it was reported). Both now speak the stored vocabulary and normalise the old spelling inbound. Every other CHECK-constrained screen was swept and matches. `backend/test/schema-drift.test.js` walks every status a screen can pick and asserts it round-trips.

A static detector for this was tried and thrown away: a TypeScript union cannot be attributed to a table by name alone, so it produced three false positives on `completions.status` and found nothing real. Read the page, or add the screen's statuses to the round-trip test.

### M9b — Known defects found but deliberately not fixed (carry forward)
_PR #28 cleared the five ✅-marked items below; the rest still stand._
- **Two renderers still exist for the same widget, split by STEP MODE.** Stacked/flow steps render through `PlayerWidget`; free-form/canvas steps render through `WidgetView`. Builder and player agree within each mode (that was PR #26), but a checkbox is a dark 64px card in stacked mode and a white bordered row in free-form — so converting a step between modes changes what the operator sees. Pre-existing and a much bigger job than the flow-mode unification was.
- **`AppPlayer.tsx` is ~2080 lines** with the step-render block inline. `BuilderStage` had to re-declare that layout (`space-y-4 max-w-2xl`) rather than reuse it. Extracting the block would let both surfaces share one layout as well as one widget renderer.
- Free-form steps deliberately ignore the player's dark theme (white slide on dark ground, consistent between builder and player) — but text authored in the default `#374151` ink there is not remapped by `playerTextColor` the way stacked-mode text is.
- The seeded sandbox ships ONE app, so the App Dashboard's app picker is trivially populated on a fresh demo. Worth seeding a second app so the picker demonstrates itself.
- ✅ FIXED in #28 — `CapacityPlanning.tsx` `DeptCapacityCard.save()` resolved departments **by name** (`depts.find(d => d.name === dept.name)`) because `/analytics/capacity` emits no `department_id`. Two same-named departments, or a rename between load and save, writes headcount to the wrong row or to none. Real fix: emit `department_id` from that endpoint.
- ✅ FIXED in #28 — `GET /routings` returned no department data, so the routings **list** could not be department-filtered without an N+1. A `department_id` param using `EXISTS (SELECT 1 FROM routing_steps …)` fixes it in a few lines. (The picker currently filters the open routing's *steps*.)
- ✅ FIXED in #28 (all `next*Number` helpers) — `kaizen.js nextIdeaNumber` ordered a 3-digit-padded number as text; it misnumbers past `KZN-YYYY-999`. Same shape likely in the other `next*Number` helpers.
- ✅ FIXED in #28 — `CAPADetailPanel.loadDetail` called `getCAPAItemActions(capaId)` even though `GET /capa/:id` already returns `actions` inline.
- ✅ FIXED in #28 — the Andon empty state ignored the **status** filter — filter to Resolved with nothing resolved and it still says "All clear / No open help requests."
- `analytics.js` `manager-view` selects both `c.app_name` and `a.name AS app_name_joined`; the frontend reads neither of the second. Dead weight.
- `/analytics/step-metrics/:appId` takes no department, so Step Metrics stays plant-wide (the page now says so rather than looking filtered).

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
- **A green demo workspace proves nothing about the write paths.** `sandbox.js` INSERTs rows directly, so a route can be dead while its screen shows seeded data. Five 500s hid behind exactly this. When adding a module, press its create endpoint yourself — or add it to the create-everything guard in `backend/test/schema-drift.test.js`.
- **CHECK constraints cannot be altered additively**, so when a route and a table disagree on a word, the TABLE wins: change the route and the page to the stored vocabulary and normalise the old spelling on the way in (see `normalizePriority` / `normalizeWOStatus` in `routes/maintenance.js`). Never store the route's word.
- **`COALESCE(?, col)` in a PUT cannot express "clear this field."** Absent and emptied both arrive as NULL, so the clear is silently discarded and the old value returns on reload. Use `buildUpdate(req.body, EDITABLE_COLUMNS)` from `src/patch.js`, which writes only the columns the body names and bounds the route to an explicit column list.
- A filter must scope the WHOLE page or say on screen that it doesn't. Narrowing a table while the headline numbers above it stay plant-wide is worse than no filter — the manager reads those numbers as that department's. Analytics' department dropdown shipped as a complete no-op for exactly this reason.
- When a screen is dark regardless of theme (Andon board, TV boards, player), pass `onDark` to `<LastRefreshed/>` / `<DepartmentFilter/>` rather than hardcoding a second colour set.
- The `.dark` override layer must remap a tint step and its paired text step TOGETHER. It covered `-50`/`-100` backgrounds and `-600..-800` text but not `-200`/`-900`, which made every louder badge pale-on-pale (the Dashboard's "Behind" chip measured 1.16:1). Adding a new Tailwind colour step means adding it to all three groups: background, border, text.

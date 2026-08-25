# HartMonitor — Continuation Plan for Opus-Class Agents

> **Who this is for:** future Claude sessions (Opus-class) continuing HartMonitor with limited prior context. Read `PROJECT_BRIEF.md` first for what the product is. This file is the WORK PLAN: current state, operating protocol, and a mission queue with acceptance criteria. Execute missions with parallel worktree sub-agents where scoped; the coordinator merges, verifies, ships.

---

## 1. Current state (as of this file's commit)

- **Production** (Railway → hartmonitorapp.com + www, DNS on Cloudflare, TLS via Railway) auto-deploys `main`. Volume mounted at `/data`; DB/uploads/backups live there. `EARLY_ACCESS` defaults ON (everything free, no billing prompts). Secrets self-heal on boot (`.hm-secrets.json` beside the DB) — explicit env vars win.
- **Shipped** through PR #24 (Apps-first wave), PR #25 (department filters; five modules that 500'd on every database; dark-mode chip contrast) and PR #26 (**builder canvas renders real player widgets** — preview now differs only by being full screen; **App Dashboard** at `/apps/dashboard`; nav reordered to Production / Apps / Quality / Maintenance / People with the rest under "More"; shift notes that actually open; Kaizen "Reviewing" no longer 500s).
- **Test baseline**: 269 backend / 298 frontend, typecheck + build clean. Two standing guards worth knowing about: `backend/test/schema-drift.test.js` walks every INSERT/UPDATE against the live schema AND presses all 34 create endpoints for 5xx; `backend/test/partial-update.test.js` pins the absent-vs-cleared contract.
- **Email**: Resend live and domain-verified (`noreply@hartmonitorapp.com`); `RESEND_API_KEY` + `EMAIL_FROM` set in Railway. Test email delivered.
- **Railway API access**: project token in the owner's chat history; IDs — project `531029d3-79ff-497d-ad78-7a655ad72eb2`, env `0577bb97-2495-43bd-b8b5-39b51f054610`, service `f6a8e76d-2fe6-4a42-8796-934bd754a8c0`. GraphQL at `backboard.railway.app/graphql/v2` with `Project-Access-Token` header. Cloudflare zone `b580de7184699a955822c37f85e9a8e3` (token in chat; NEVER commit tokens).
- **Owner's standing priority**: apps first. A new account lands on `/apps`, meets a "Build your first app" hero and a seven-step in-product training coach. Everything else is secondary to that path working well — verify it after any nav or onboarding change.

## 1b. Full-sweep wave (this session) — shipped to the branch

An 8-agent sweep (4 fixers in worktrees + 4 read-only auditors) plus coordinator
work. All merged, tested, pushed. Highlights:

- **Data integrity (correctness audit):** a stale autosave could overwrite a
  finished run's data/values, rewrite completed_at (skewing every duration/OEE),
  and shrink the multi-operator roster. Terminal runs are now immutable to a
  partial flush; completed_at stamps only on the real transition; the roster only
  grows. (`completions.js`, `backend/test/completion-integrity.test.js`)
- **Security (audit):** CRITICAL — forgot-password returned the reset token in
  the response (account takeover); now never returned, recovery via admin
  endpoint only. HIGH — SSRF via customer webhooks; now blocks private/reserved
  targets by DNS resolution at registration + delivery. MED — PIN endpoints had
  no lockout and a viewer could call verify-authorizer; added per-company/IP
  lockout + operator+ gate. MED — free self-upgrade to Enterprise; now requires
  checkout when billing is configured. (`auth.js`, `webhooks.js`, `operators.js`,
  `config.js`, + regression suites)
- **Quality honesty (dogfood):** "no Pass/Fail recorded" was counted as a pass
  across /analytics/quality, OEE quality, the SQDC trend, and app per-field
  stats; all now count only inspected runs / return null. avgCycleTime returns
  null (renders "—") for empty slices. (`analytics.js`, `oee.js`, `sqdc.js`,
  `apps.js`, `quality-honesty.test.js`)
- **Carried-forward defects:** capacity headcount saved to the wrong department
  (now keyed by id), every next*Number helper misnumbered past 999 (now numeric
  max), routings list department filter, N+1s collapsed in inventory/kits/BOM/PO
  and analytics, redundant CAPA fetch, status-aware Andon empty state.
- **UI audit (58 screens × 3 viewports × 2 themes):** fixed the CompletionDetail
  hard crash (undefined variance_pct), the light-in-dark mobile header (1.01→16:1)
  and demo button (1.96→8.3:1), and lifted secondary page text to AA in light
  mode (2.43→4.6:1, scoped to `main` so the dark sidebar is untouched).
- **Perf:** volume pass at 5k completions — every hot endpoint 3-104ms; added
  the company-first analytics indexes + routing_steps department index the audits
  justified. Second demo app seeded so the App Dashboard picker isn't trivial.

### Deferred follow-ups (real, not blocking; do carefully)
- **Contrast pass round 2 (UI audit medium items):** `.btn-primary` white-on-accent
  3.53:1; the operator green primary button 2.28:1; oversized colored stat numbers
  ~2.5:1 (large-text 3.0 floor); PRO badges 2.86:1; dark-mode `text-gray-500` on
  the lighter slate "running job" cards 2.25:1; OEE amber hint 1.59:1. These are
  component/token-level — change `.btn-primary`, StatCard, the player button, and
  the dark card token, and re-measure. Don't blanket-sed; the sidebar taught us a
  fixed-dark surface inverts the rule.
- **Two widget renderers by step MODE** (stacked `PlayerWidget` vs free-form
  `WidgetView`) — converting a step between modes changes the operator's view.
- **"On track" defined differently** across Plant/Command vs Manager view
  (completed WOs counted in one, not the other) — pick one definition.
- **Capacity VIEW filter still matches department by name** — now that /capacity
  emits department_id, switch the picker to id.
- **review-fixes.test.js is flaky under the full parallel `npm test`** (port-3180
  server contention at startup) — passes in isolation and on rerun. Stagger
  server startups or give it a unique port; three agents independently hit it.
- **next*Number is still read-then-write** (TOCTOU) — a UNIQUE(company_id, number)
  or atomic allocate would close the concurrent-duplicate race.

## 2. Operating protocol (hard-won; follow exactly)

1. **Worktree discipline**: every sub-agent works in an isolated git worktree branched from the CURRENT branch tip; commits locally; NEVER pushes (the git proxy 503s non-`claude/*` branch pushes). The coordinator merges local worktree branches.
2. **Merge hygiene — the #1 failure mode**: after EVERY `git merge`, run `grep -rln "^<<<<<<< " backend/src frontend/src` and `git status --short | grep -E "^(UU|AA)"` BEFORE committing. A sealed conflict marker took production-candidate tests from 145-pass to 93-fail once. Resolve `db.js` conflicts by keeping BOTH additive blocks and checking backtick balance (template literals!). `client.ts`/`types.ts` conflicts: stack labeled append-blocks inside the `api` object / after it — watch that a block doesn't land inside an interface.
3. **Verification with REAL exit codes** (pipes eat failures): run each as its own command and check `$?` or `&& echo OK || echo FAIL` — never `cmd | grep` as the last word:
   - `cd backend && node --test test/*.test.js` (152+ tests)
   - `npm run typecheck --workspace=frontend`, `npm test --workspace=frontend`, `npm run build --workspace=frontend` (workspace root)
4. **Backend test ports registry** (server-spawning suites; unique per file — a shared port silently *cancels* the other suite's tests while the run still exits `0`, so verify `# cancelled 0` and that the total went UP): 3176 team-calls · 3177 dashboard-filters · 3178 schema-drift · 3179 partial-update · 3180 review-fixes · 3181 app-detail · 3182 alert-routing · 3183 auth-flows · 3184 screen-data-honesty · 3185 sandbox-seed · 3186 shifts-validation · 3187 app-templates · 3188 category-reports · 3189 player-batch · 3190 app-analytics · 3191 table-import · 3192 completion-values · 3193 boms-kits · 3194 analytics-department-filter · 3195 audit · 3196 modules · 3197 tenant-isolation · 3198 launch-features · 3199 smoke. New suites take 3175 downward. Check with `grep -rhoE "PORT = 3[0-9]{3}" backend/test/*.js | sort | uniq -c` before claiming one. **Agent scratch servers** (manual browser checks, not test suites) take 3201 upward, one per concurrent agent.
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

### M9 — Vocabulary reconciliation (schema CHECK vs UI) — MOSTLY DONE
Turned out to be one bug family with two shapes, both of which shipped: **a route writing a column the table never had**, and **a route writing a value its own CHECK forbids**. Five endpoints 500'd on every database — maintenance assets, maintenance work orders, CAPA items, CAPA actions and shift handoff — while demo workspaces looked healthy, because the sandbox seed inserts the OLDER column names directly, so read paths had data while write paths were dead. Fixed by adding the columns additively (backfilled from whichever column each renamed) and standardising routes + pages on the CHECK-legal words (`medium` not `normal`, `completed`/`done` not `complete`), accepting the old spellings inbound so a stale tab keeps working.

Two standing guards now live in `backend/test/schema-drift.test.js`: one walks every INSERT/UPDATE in `backend/src` against the live migrated schema, the other presses all 34 create endpoints and fails on any 5xx (with a floor of 30 successes so a renamed route can't silently make it stop guarding).

**The render-side half is now closed too.** It was worse than "unreachable": Kaizen offered `reviewing` and `on_hold`, neither of which its column accepts, so picking Reviewing — the page's own word — 500'd. Shift notes sent `draft` where the column stores `active`, so a note was created and the page could never find it (the modal closed and nothing appeared, which is how it was reported). Both now speak the stored vocabulary and normalise the old spelling inbound. Every other CHECK-constrained screen was swept and matches. `backend/test/schema-drift.test.js` walks every status a screen can pick and asserts it round-trips.

A static detector for this was tried and thrown away: a TypeScript union cannot be attributed to a table by name alone, so it produced three false positives on `completions.status` and found nothing real. Read the page, or add the screen's statuses to the round-trip test.

### M9b — Known defects found but deliberately not fixed (carry forward)
- **Two renderers still exist for the same widget, split by STEP MODE.** Stacked/flow steps render through `PlayerWidget`; free-form/canvas steps render through `WidgetView`. Builder and player agree within each mode (that was PR #26), but a checkbox is a dark 64px card in stacked mode and a white bordered row in free-form — so converting a step between modes changes what the operator sees. Pre-existing and a much bigger job than the flow-mode unification was.
- **`AppPlayer.tsx` is ~2080 lines** with the step-render block inline. `BuilderStage` had to re-declare that layout (`space-y-4 max-w-2xl`) rather than reuse it. Extracting the block would let both surfaces share one layout as well as one widget renderer.
- Free-form steps deliberately ignore the player's dark theme (white slide on dark ground, consistent between builder and player) — but text authored in the default `#374151` ink there is not remapped by `playerTextColor` the way stacked-mode text is.
- The seeded sandbox ships ONE app, so the App Dashboard's app picker is trivially populated on a fresh demo. Worth seeding a second app so the picker demonstrates itself.
- `CapacityPlanning.tsx` `DeptCapacityCard.save()` resolves departments **by name** (`depts.find(d => d.name === dept.name)`) because `/analytics/capacity` emits no `department_id`. Two same-named departments, or a rename between load and save, writes headcount to the wrong row or to none. Real fix: emit `department_id` from that endpoint.
- `GET /routings` returns no department data, so the routings **list** can't be department-filtered without an N+1. A `department_id` param using `EXISTS (SELECT 1 FROM routing_steps …)` fixes it in a few lines. (The picker currently filters the open routing's *steps*.)
- `kaizen.js nextIdeaNumber` orders a 3-digit-padded number as text; it misnumbers past `KZN-YYYY-999`. Same shape likely in the other `next*Number` helpers.
- `CAPADetailPanel.loadDetail` calls `getCAPAItemActions(capaId)` even though `GET /capa/:id` already returns `actions` inline.
- The Andon empty state ignores the **status** filter — filter to Resolved with nothing resolved and it still says "All clear / No open help requests."
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

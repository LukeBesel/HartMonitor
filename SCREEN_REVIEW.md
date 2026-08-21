# HartMonitor — Screen-by-screen product review (Mission M1)

Walked every screen in a real Chromium session against a seeded demo sandbox
(`NODE_ENV=test PORT=3301 DATABASE_PATH=/tmp/m1.db SEED_DEMO_DATA=false`,
`POST /api/auth/demo`), reading each screenshot as a plant manager would. Four
questions per screen:

1. Does it answer a question a plant manager / supervisor / operator actually has?
2. Are the metrics **honest** — derived from real rows, no invented numbers, no
   percentages computed from empty sets?
3. Is the primary action obvious?
4. Is it redundant with another screen?

---

## The five findings that mattered most

| # | Finding | Impact | Status |
|---|---|---|---|
| 1 | **Selecting a site hid every unassigned record.** Every company gets an auto-created primary site that the site picker auto-selects, but departments/stations created without a site were then filtered out. The Stations page said "No stations yet" with two stations on file; the Departments page showed an empty picker; the Command Center's department performance said "No department data" while the same page listed completions in Assembly. | 3 screens unusable for most companies | **Fixed** |
| 2 | **OEE invented its own numbers.** `calcOEE` fell back to a hardcoded `performance = 0.9` "default assumption when no ideal cycle set", scored `quality = 100%` for stations with zero runs today, and multiplied those into a headline OEE. Plant-wide OEE averaged the fabrications, printing "0.5%" in red. | Flagship metric was fiction | **Fixed** |
| 3 | **"Schedule Adherence" was not schedule adherence.** The Command Center KPI labelled % of *currently open* work orders that are on track as an on-time-delivery measure — and read 0% for a plant with no open WOs. | Misleading headline KPI | **Fixed (relabelled + honest empty state)** |
| 4 | **Training → Skills Matrix was broken for every customer.** `GET /api/training/matrix` selected `apps.category`, a column that does not exist → 500 on every call; the page swallowed the error and rendered "No apps to show — create work instruction apps", which was false. | Whole tab of a paid module dead + a lie | **Fixed (query + visible error state)** |
| 5 | **Per-workspace Reports threw you out of your workspace.** `/reports/production` redirected to `/dashboards/:id`, so the sidebar jumped from Production to Reporting and the screen tabs changed under the user. | Two-level nav broke on 6 screens | **Fixed (renders in place)** |

---

## Verdict table

| Screen | Purpose it should serve | Verdict | Findings | Action taken |
|---|---|---|---|---|
| **Command Center** (`/dashboard`) | "What do I do first this morning?" | **FIX → good** | Needs Attention was well-built and correctly red-first (station down → critical NCR → WO behind → low stock → late PO), but the late-WO loop was **unbounded** — a plant with 50 late WOs gets a 50-row wall. "Schedule Adherence 0%" mislabelled and computed over open WOs only. Live Floor View re-stated 4 of the 5 KPI cards already above it. Department performance empty (finding #1). Departments with no work orders showed a green "On Track" pill and "0% on track". | Capped late WOs at the 6 most urgent + an honest "N more work orders behind schedule → /schedule" row; relabelled the KPI to **Open WOs On Track** with "0 of 2 open work orders" / "No open work orders"; Pass Rate now says "No QC results recorded yet" instead of a bare "—"; Live Floor tiles reduced to the three that are *not* duplicated (Avg Cycle, Work Orders On Track, Behind or Overdue); site filter fixed; empty departments render a neutral "No work" pill, "No work orders", "no runs yet". |
| **Production Reports** (`/reports/production`) | "How did production run this month?" | **FIX → good** | Redirect broke workspace context (#5). Cards answered *throughput* but never *where do my work orders stand* — the first question of a production report. | Renders `DashboardView` in place (URL, sidebar and tabs stay on Production; Edit toggles inline instead of routing away). Defaults now seed **Work Orders by Status** and **Output by Department** alongside throughput / cycle time / station status. |
| **Inventory Reports** | Stock risk at a glance | GOOD | Low-stock count + movement trend are real and useful; thin but honest. | Metric-card empty states now honest (below). |
| **Quality Reports** | Escapes and NCR load | **FIX → good** | `pass_rate` counted every run with no `Fail` value as a pass — including runs from apps with **no QC step at all** — and returned **100%** when there were no completions whatsoever. Same inflation in the Pass-vs-Fail distribution and the quality trend series. | Pass rate now counts only runs with an explicit Pass/Fail, reports `null` + "No pass/fail results recorded yet" when there are none, and shows its sample size ("from 8 recorded results"). |
| **Kaizen Reports** | Idea pipeline | GOOD (thin) | One card (ideas by status). Honest; no fabricated numbers. | Left as-is — noted as a candidate for a savings-trend card once a series metric exists. |
| **Maintenance Reports** | PM load and backlog | GOOD (thin) | Two real metric cards, no trend available in the card engine. | Left as-is; deferred (needs a new series type — out of M1 scope). |
| **People Reports** | Training coverage | **FIX → good** | `training_coverage` returned **0%** when a company had no training records at all — reads "nobody is trained". | Returns `null` + "No training records yet". |
| **OEE Tracker** (`/oee`) | "Which machine is losing me time?" | **FIX → good** | See finding #2. Also nothing told the user OEE is measured against the station's *planned day*, so the numbers looked broken rather than sparse. | `calcOEE` now returns `null` for factors it cannot measure and exposes `measurable` + `missing`; the card shows "—" with "Needs ideal cycle time and runs completed today"; bars read "not measured"; plant-wide OEE averages **only** measurable machines and says "averaged over 1 of 2 machines"; subtitle spells out the measurement window. Same nulls handled on Station View and Department View. |
| **Step Metrics** (`/step-metrics`) | "Which step is my bottleneck?" | **DEAD → merged** | Genuinely excellent screen (per-step avg/best/max/p95, takt adherence, trend) and **nothing anywhere in the app linked to it** — no nav entry, no link, no tab bar when you deep-linked. Meanwhile Operation Analytics promised "drill into step timing" and hid its own drill-down behind picking a department. Takt adherence read **100%** when no step had a takt time. | Standalone page removed (route redirects to `/analytics`); `StepMetricsPanel` — the good part — is now always visible on Operation Analytics, no department required. Takt adherence reports "—" with "No takt times set on these steps" and otherwise states how many steps it covers. |
| **Capacity Planning** (`/capacity`) | "Do I have the people to finish on time?" | **GOOD** | The best-behaved analytical screen in the app: Peak Utilization already renders "—%" when headcount is 0, assumptions are printed on the page, and the fix (set headcount) is inline on the department card. | None. |
| **Leaderboard** (`/leaderboard`) | Shop-floor recognition | **FIX → keep** | Not noise: the backend only ranks operators **within the same app + product type**, excludes runs with an NCR, and reports how many were excluded — a genuinely fair design. But the top-level framing ("Departments ranked by output") invites comparing unlike work across departments. | Reworded to describe what is counted: "Clean runs completed per department — open one to rank operators within the same operation". |
| **Operation Analytics** (`/analytics`) | Plant-wide throughput/cycle/quality | **FIX → good** | Real data throughout. Pass-rate donut was drawn from the inflated `/overview` pass rate and would render a 100/0 split from zero inspections. Subtitle promised a drill-down that was gated behind departments. | Pass rate null-safe with an explicit "No pass/fail results recorded yet" panel and a sample-size line; step-metrics drill-down ungated; subtitle now matches what the page does. |
| **App Analytics** (`/apps/:id/analytics`) | "How is this one job performing?" | **GOOD** | The strongest screen in the product — per-field yields, per-operator runs, captured-value stats, all with explicit counts ("9 checks", "8 entries captured"). **Not** redundant with Operation Analytics: that one is plant-wide across apps, this one is one app deep. | None. |
| **Manager View** (`/manager`) | Live floor triage for a supervisor | **FIX → keep** | Overlaps the Command Center's Live Floor View but earns its place (live run timers, per-WO cards, department roll-up). Two dishonest numbers: ETA fell back to **15 minutes per unit** when no takt was set (a WO with "0m takt" displayed "ETA ~2.5h"), and departments with zero work orders showed a red "0% on track" bar. | ETA renders "—" with "Set a takt time…" when there is no takt, and the chip says "no takt set"; empty departments read "No work orders assigned" with a neutral pill and no bar. |
| **Departments** (`/departments`) | "What is my area running right now?" | **FIX → keep** | Landed on a permanently empty "Select a department to view its jobs" because the site filter returned no departments (#1). The far richer drill-down at `/departments/:id` (stations, live OEE, hourly output, QC) was reachable only by clicking a running job. KPI labels ("Completed Today") counted *work orders* while the identically-named Command Center KPI counts *runs*. | Site filter fixed so it auto-selects the first department again; added explicit **Full department view** and **Stations** entry points; KPIs relabelled "Work Orders In Progress / Finished Today / Not Started"; the always-empty elapsed clock on running-job cards is hidden when there is no start time. |
| **Department View** (`/departments/:id`) | Area drill-down | GOOD | Rich and real. Pass Rate (7d) rendered "0%" with no QC data; station chip showed the fabricated OEE. | Pass rate → "—"; OEE chip → "—" with a tooltip. |
| **Stations** (`/stations`) | Create/configure workstations | **FIX → keep** | Said "No stations yet · Create workstations…" while two stations existed (#1). Also had **no nav entry at all** — a new customer cannot find where to create a station. | Site filter fixed (now lists both stations); reachable from the Departments screen via a labelled **Stations** button. (Left out of the sidebar deliberately: `navigation.test.ts` pins the current workspace map, and Departments is the natural parent.) |
| **Schedule** (`/schedule`) | Plan and track work orders | **GOOD** | Clean list/Gantt, real dates, kit-shortage chips pulled from the Kitting module, obvious primary action ("+ New Work Order"). | None. |
| **Inventory Tracker** (`/inventory`) | Stock levels and value | **GOOD** | Real SKU counts, stock value, below-reorder count, gauges, low-stock alerts. Primary actions are clear (New Item / Record Movement / Export). | None. |
| **Materials Required** (`/requirements`) | "What do I need to buy to finish the schedule?" | **FIX → keep** | Excellent BOM-derived math with honest "—" for no shortage — but a shortage row was a dead end: no way to act on it. | Shortage rows now offer **Raise a purchase order** and **View stock and locations**, restating the shortage next to the action. |
| **Kitting / BOMs / Receiving / Shipments / Purchasing** | Material flow | GOOD | Real derived data throughout (kit progress "3 / 4 · short", PO pending value $360 from real lines). | None. |
| **Quality (NCR)** / **CAPA** | Track and close non-conformances | GOOD | Counts are real; overdue/critical breakdowns match the rows below. | None. |
| **Maintenance (CMMS)** | Asset uptime and PM load | GOOD | Real counts, honest "No overdue PMs" empty state. | None. |
| **Andon Board** | Live line-stop calls | GOOD | Real open/critical/acknowledged/resolved counts. | None. |
| **Kaizen / CI** | Improvement pipeline | **FIX → keep** | "Total Savings" summed **actual** savings on implemented ideas (honest) but printed "$0" when nothing had been recorded, which reads as "we saved nothing". | Relabelled **Savings Recorded**; shows "—" when nothing has been recorded. |
| **Training** (`/training`) | Skills coverage and certs | **FIX → keep** | Skills Matrix tab 500'd for every customer and displayed a false empty state (#4). Overview showed a red "0%" coverage bar for departments with no operators. | Query fixed (`apps.category` removed); the tab now surfaces load failures with a Retry instead of swallowing them; empty departments read "No operators assigned". |
| **Shift Notes** | Handoff between shifts | GOOD | Honest empty state with the primary action repeated in it. | None. |
| **Dashboards** (`/dashboards`) | Custom analytics | **FIX → good** | Card engine returned placeholder values for empty sets: `pass_rate` → 100, `avg_cycle` → 0m, `training_coverage` → 0%, and an unknown metric key silently rendered 0. | All four now return `null` + an `empty_reason`; the metric card renders "—" with the reason, and shows the sample size when there is one. |
| **Facilities** | Multi-site roll-up | **FIX → keep** | Showed "0 departments / 0 work centers / 2 open work orders" — technically true (nothing is *assigned* to the site) but reads like a bug next to a company that clearly has both. | Labels now say "departments assigned" / "work centers assigned". |
| **Tables / Transaction Log / Audit Log / Admin** | Data + traceability | GOOD | Real rows, no derived stats to get wrong. | None. |
| **Settings → Sidebar tab** | Tailor the navigation | **DEAD → removed** | "Default view — which workspace the sidebar opens to. You can switch anytime from the buttons at the top of the sidebar." Stale on both counts: there are no buttons at the top of the sidebar since the two-level nav, and the setting was **completely inert** — `focus` was written to `localStorage` and read by nothing (the workspace is derived from the route in `Layout`). | Section removed, along with the dead `focus`/`setFocus` plumbing in `NavPrefsContext`. |
| **Plant View** (`frontend/src/pages/PlantView.tsx`) | — | **DEAD → deleted** | Superseded by the Command Center's Live Floor View; `/plant` already redirected to `/dashboard` and nothing imported the file. | File deleted. |

---

## Deliberately left alone

- **Manager View vs Command Center Live Floor View** — they overlap but serve
  different jobs (supervisor triage with live run timers vs the 6am one-screen
  briefing). Deduplicating the *numbers* was the right fix; deleting a screen
  was not.
- **Operation Analytics vs App Analytics** — not redundant. Plant-wide across
  apps vs one app in depth. Both kept, and the step-timing drill-down that
  bridges them is now reachable.
- **Station 1 showing 1.0% OEE in the demo** — that is the textbook formula
  applied to a station that ran 2 jobs against an 8-hour planned day. It is
  real, so it stays; the page now states the measurement window so a sparse
  number does not read as a broken one.
- **SQDC** — shelved by standing decision; route still redirects, code intact.
- **Maintenance / Kaizen report defaults staying thin** — the card engine has
  no maintenance-trend or savings-trend series yet. Adding one is a feature,
  not a relabel; deferred rather than faked.

---

## Regression cover added

`backend/test/screen-data-honesty.test.js` (port 3184) locks in the two rules
this review turned up:

- site filtering keeps unassigned departments/stations/floor data visible;
- metrics with no data behind them return `null` — OEE factors, pass rate,
  open-WO percentage and dashboard metric cards — plus the attention-list cap
  and its overflow row.

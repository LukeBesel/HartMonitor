import {
  LayoutDashboard,
  AppWindow,
  Building2,
  LayoutGrid,
  Calendar,
  GitBranch,
  BarChart2,
  Package,
  Monitor,
  ShieldCheck,
  Gauge,
  Trophy,
  ScrollText,
  UserCog,
  Sparkles,
  Bell,
  Filter,
  TrendingUp,
  Search,
  Play,
  Plus,
  Eye,
  CheckCircle2,
  AlertTriangle,
  SlidersHorizontal,
  Clock,
  MapPin,
} from 'lucide-react';

/**
 * A single page in a guided walkthrough. Rendered one at a time by
 * <ModuleOnboarding/> with Back/Next/Finish controls.
 */
export interface WalkthroughStep {
  /** Short heading for this step. */
  title: string;
  /** One or two sentences describing the area and what to do. */
  body: string;
  /** Optional icon for the step header. Falls back to the module icon. */
  icon?: React.ElementType;
  /** Optional bullet list of concrete things to look at or do. */
  bullets?: string[];
}

/**
 * Per-module guided walkthrough content, keyed by the `moduleId` that each
 * page passes to <ModuleOnboarding/>. When a key exists here the component
 * renders a multi-step paged tour; otherwise it falls back to the legacy
 * single-card behavior using the page's own props.
 */
export const WALKTHROUGHS: Record<string, WalkthroughStep[]> = {
  // ───────────────────────────── Command Center ─────────────────────────────
  dashboard: [
    {
      title: 'Welcome to your Command Center',
      body: "This is your home base for running the shop floor. It pulls live data from every module into one screen so you always know what's happening right now and what to do next.",
      icon: LayoutDashboard,
      bullets: [
        'Everything here updates in near real time',
        'Use it to start your shift and triage problems',
        'Each section can be turned on or off to fit how you work',
      ],
    },
    {
      title: 'Greeting & shift KPIs',
      body: 'The top of the page greets you and shows the headline numbers for the current shift. Scan these first to gauge how the day is going at a glance.',
      icon: TrendingUp,
      bullets: [
        'Units produced and completions so far this shift',
        'Active stations and people currently working',
        'Hit Refresh any time to pull the latest figures',
      ],
    },
    {
      title: 'Needs Attention',
      body: 'This panel surfaces the issues that matter most — anything that is blocking output or about to. Work it top to bottom to clear problems fast.',
      icon: AlertTriangle,
      bullets: [
        'Down stations, overdue work orders, and low stock',
        'Open quality flags and non-conformances',
        'Click an item to jump straight to where you fix it',
      ],
    },
    {
      title: 'Live Floor View',
      body: 'Each card represents a department running right now. The cards give you a live read on who is busy and where work is piling up.',
      icon: Building2,
      bullets: [
        'See active jobs and operators per department',
        'Throughput shows current pace against plan',
        'Color cues highlight departments that need help',
      ],
    },
    {
      title: 'Throughput & alerts',
      body: 'Below the floor cards, throughput trends and the alert feed give you the bigger picture of momentum across the plant during the shift.',
      icon: Bell,
      bullets: [
        'Throughput charts show the production trend over time',
        'The alert feed lists recent events as they happen',
        'Use it to spot a slowdown before it becomes a stoppage',
      ],
    },
    {
      title: 'Make it yours',
      body: 'Use the Customize button in the header to show or hide any section. Set it up once and the Command Center remembers your layout.',
      icon: SlidersHorizontal,
      bullets: [
        'Toggle sections on or off from the Customize panel',
        'Reset to defaults at any time',
        "Your layout is saved per device — you're all set!",
      ],
    },
  ],

  // ─────────────────────────────── App Library ──────────────────────────────
  apps: [
    {
      title: 'What the App Library is',
      body: 'Apps are digital work instructions and data-collection forms. Build one once and run it on any station — operators always see the latest published version.',
      icon: AppWindow,
    },
    {
      title: 'Browse & search',
      body: 'The library lists every app you have. Use search and any filters to find the one you need across all your products and processes.',
      icon: Search,
      bullets: [
        'Each card shows the app name and status',
        'Look for the Published badge — that is what operators run',
        'Search by name to narrow a long list quickly',
      ],
    },
    {
      title: 'Preview an app',
      body: 'Click any app to open it and step through exactly what an operator will see, including instructions, prompts, and data fields.',
      icon: Eye,
      bullets: [
        'Walk the steps in order to validate the flow',
        'Check that prompts and fields read clearly',
        'Confirm the right inputs are being captured',
      ],
    },
    {
      title: 'Build or edit',
      body: 'Open the App Builder to create a new app or change an existing one. Drag in steps, add fields, and arrange the sequence operators follow.',
      icon: Plus,
      bullets: [
        'Add steps for each part of the work instruction',
        'Attach inputs like pass/fail, numbers, photos, or notes',
        'Reorder steps until the flow matches the real process',
      ],
    },
    {
      title: 'Publish to the floor',
      body: 'When an app is ready, publish it. Stations pick up the new version instantly, so operators never run outdated instructions.',
      icon: CheckCircle2,
      bullets: [
        'Publishing makes the app live on assigned stations',
        'Edits stay in draft until you publish again',
        "You're ready to put apps to work!",
      ],
    },
  ],

  // ───────────────────────────── Department View ────────────────────────────
  departments: [
    {
      title: 'Monitor by department',
      body: 'Department View gives you a live read on a single department — what is running, what is queued next, and how it is performing.',
      icon: Building2,
    },
    {
      title: 'Pick a department',
      body: 'Start by choosing a department from the dropdown. Everything on the page refocuses on the area you select.',
      icon: Filter,
      bullets: [
        'Switch departments any time from the selector',
        'The view remembers your last choice',
      ],
    },
    {
      title: 'Live & upcoming work',
      body: 'See jobs currently in progress alongside the work scheduled to come next, so you can keep the area flowing without gaps.',
      icon: Clock,
      bullets: [
        'Running jobs show operator and progress',
        'Upcoming work is queued in priority order',
        'Spot idle time before it costs you output',
      ],
    },
    {
      title: 'Department metrics',
      body: 'Key numbers for the selected department summarize throughput and performance so you can compare areas fairly.',
      icon: BarChart2,
      bullets: [
        'Output and pace for the current period',
        'Use it during stand-ups and shift handoffs',
      ],
    },
    {
      title: 'Always current',
      body: 'The page auto-refreshes about every 30 seconds, so leaving it open on a screen gives the floor a living status board.',
      icon: TrendingUp,
      bullets: [
        'No need to reload manually',
        'Great for a wall display in the department',
        "You're set — pick an area and keep an eye on it!",
      ],
    },
  ],

  // ─────────────────────────────── SQDC Board ───────────────────────────────
  sqdc: [
    {
      title: 'Your daily lean board',
      body: 'SQDC tracks the four classic lean metrics — Safety, Quality, Delivery, and Cost — for any day. It is built to run your daily stand-up from one screen.',
      icon: LayoutGrid,
    },
    {
      title: 'Choose the day',
      body: 'Pick a date to review. It defaults to today, but you can look back at any day to discuss trends or follow up on past issues.',
      icon: Calendar,
      bullets: [
        'Defaults to the current date',
        'Step back to review yesterday or last week',
      ],
    },
    {
      title: 'Filter by department',
      body: 'Optionally narrow the board to a single department so each area can run its own focused stand-up.',
      icon: Filter,
      bullets: [
        'Leave it on All for a plant-wide view',
        'Pick one department for a team huddle',
      ],
    },
    {
      title: 'Read the four panels',
      body: 'Each of the S, Q, D, and C panels turns green, amber, or red against its target — a quick visual of where you stand.',
      icon: ShieldCheck,
      bullets: [
        'Green means on target, red means action needed',
        'Use the colors to drive the conversation',
        'Assign owners to anything not green',
      ],
    },
    {
      title: 'Dig into the detail',
      body: 'Within each panel, review the headline number plus the supporting detail rows to understand what is driving the result.',
      icon: Search,
      bullets: [
        'Headline number is the at-a-glance metric',
        'Detail rows explain the why behind it',
        "You're ready to run a sharp daily stand-up!",
      ],
    },
  ],

  // ──────────────────────────────── Schedule ────────────────────────────────
  schedule: [
    {
      title: 'Plan your production',
      body: 'Schedule is where you plan production runs and assign work orders across your team and stations so the right work happens in the right order.',
      icon: Calendar,
    },
    {
      title: 'Create a work order',
      body: 'Add a work order for each production job. This becomes the unit of work operators pick up and complete on the floor.',
      icon: Plus,
      bullets: [
        'One work order per job or batch',
        'It links the schedule to actual completions',
      ],
    },
    {
      title: 'Fill in the details',
      body: 'Set the quantity, the app operators will run, the department, and the due date so everyone knows what, where, and by when.',
      icon: SlidersHorizontal,
      bullets: [
        'Quantity drives progress tracking',
        'App defines the instructions operators follow',
        'Department and due date drive sequencing',
      ],
    },
    {
      title: 'Sequence the work',
      body: 'Drag work orders to reschedule them or adjust priorities. Keep the highest-value and most time-sensitive jobs at the front.',
      icon: TrendingUp,
      bullets: [
        'Drag to move a job to a new slot',
        'Reprioritize as demand shifts',
      ],
    },
    {
      title: 'Track to completion',
      body: 'As operators complete runs, progress updates here automatically so you always know what is done, in progress, and at risk.',
      icon: CheckCircle2,
      bullets: [
        'Watch progress fill as work finishes',
        'Spot at-risk due dates early',
        "You're ready to schedule the floor!",
      ],
    },
  ],

  // ──────────────────────────────── Routings ────────────────────────────────
  routings: [
    {
      title: 'Define how things are made',
      body: 'A routing is a reusable sequence of manufacturing steps. Define the flow once, then apply it across many work orders for the same product.',
      icon: GitBranch,
    },
    {
      title: 'Create a routing',
      body: 'Start a new routing with a clear name and description so anyone can recognize the process it represents.',
      icon: Plus,
      bullets: [
        'Name it after the product or process',
        'Pick an existing routing on the left to edit it',
      ],
    },
    {
      title: 'Add ordered steps',
      body: 'Build the routing by adding steps in the order work is performed. Each step can be linked to an app for operator instructions.',
      icon: LayoutGrid,
      bullets: [
        'One step per operation in the process',
        'Link a step to an app to drive the work',
        'Assign a department where the step runs',
      ],
    },
    {
      title: 'Set cycle times',
      body: 'Give each step an estimated cycle time. These feed capacity planning and OEE targets so your plans are grounded in reality.',
      icon: Clock,
      bullets: [
        'Estimated time per unit for the step',
        'Used to plan capacity and measure efficiency',
      ],
    },
    {
      title: 'Refine as you go',
      body: 'Use the arrows to reorder steps as your process evolves. A routing is a living document — keep it matching the floor.',
      icon: TrendingUp,
      bullets: [
        'Reorder steps with the up/down arrows',
        'Update times as the process improves',
        "You're ready to map out your processes!",
      ],
    },
  ],

  // ──────────────────────────────── Analytics ───────────────────────────────
  analytics: [
    {
      title: 'Turn data into insight',
      body: 'Operation Analytics converts your completion data into clear insights about throughput, efficiency, and trends so you can find where to improve.',
      icon: BarChart2,
    },
    {
      title: 'Scope your analysis',
      body: 'Choose an app and a date range to analyze. Everything below recalculates for exactly the slice of production you select.',
      icon: Filter,
      bullets: [
        'Pick the app or operation to study',
        'Set a date range that matches your question',
      ],
    },
    {
      title: 'Actual vs. ideal',
      body: 'Compare real cycle times against the ideal targets from your routings to see how close you are running to plan.',
      icon: TrendingUp,
      bullets: [
        'Gaps to ideal reveal lost efficiency',
        'Consistent overruns point to a real constraint',
      ],
    },
    {
      title: 'Drill into a step',
      body: 'Click into an operation to break performance down step by step. This is where bottlenecks and overtime stations become obvious.',
      icon: Search,
      bullets: [
        'Step drill-down isolates the slow operation',
        'Spot the one step dragging the whole flow',
        'Use it to target your next improvement',
      ],
    },
    {
      title: 'Share the findings',
      body: 'Export the data for offline reporting or to share with your team, so the insight turns into action off-screen too.',
      icon: CheckCircle2,
      bullets: [
        'Export for reports and reviews',
        "You're ready to dig into your numbers!",
      ],
    },
  ],

  // ──────────────────────────────── Dashboards ──────────────────────────────
  dashboards: [
    {
      title: 'Build custom views',
      body: 'Dashboards are customizable views assembled from live data widgets. Compose the exact screen each audience needs — operators, managers, or a TV wall.',
      icon: LayoutGrid,
    },
    {
      title: 'Create a dashboard',
      body: 'Click the + button to start a fresh dashboard. Give it a purpose — a line, a shift, an executive summary — and build from there.',
      icon: Plus,
      bullets: [
        'Start blank and add what matters',
        'Make one dashboard per audience',
      ],
    },
    {
      title: 'Add widgets',
      body: 'Drop in widgets to show your data: charts, KPIs, tables, and status cards each pull live numbers from the system.',
      icon: BarChart2,
      bullets: [
        'KPIs for headline numbers',
        'Charts for trends, tables for detail',
        'Status cards for live floor state',
      ],
    },
    {
      title: 'Arrange the layout',
      body: 'Drag widgets to arrange the layout until the most important information sits where the eye lands first.',
      icon: SlidersHorizontal,
      bullets: [
        'Drag to reposition any widget',
        'Put the headline at the top-left',
      ],
    },
    {
      title: 'Share or display',
      body: 'Share the dashboard URL with managers, or open it on a TV for an always-on floor display that the whole team can see.',
      icon: Monitor,
      bullets: [
        'Send the link to stakeholders',
        'Run it full-screen on a wall display',
        "You're ready to compose your views!",
      ],
    },
  ],

  // ─────────────────────────────── Leaderboard ──────────────────────────────
  leaderboard: [
    {
      title: 'Celebrate performance',
      body: 'The Leaderboard ranks operators and teams by their production performance to recognize top performers and add a bit of friendly competition.',
      icon: Trophy,
    },
    {
      title: 'Choose what to rank',
      body: 'Pick the metric and time period to rank by — output, efficiency, or quality over a shift, day, or week.',
      icon: Filter,
      bullets: [
        'Switch metrics to highlight what matters now',
        'Compare over the period you care about',
      ],
    },
    {
      title: 'Read the rankings',
      body: 'The list shows who is leading and by how much. Use it in stand-ups to recognize wins and spark momentum.',
      icon: TrendingUp,
      bullets: [
        'Top of the list is your standout performer',
        'Look at gaps to see how tight the race is',
      ],
    },
    {
      title: 'Keep it fair & fun',
      body: 'Pair recognition with context — volume, mix, and difficulty vary. Use the board to motivate, not just to measure.',
      icon: ShieldCheck,
      bullets: [
        'Recognize improvement, not just raw totals',
        'Display it on a TV to keep energy high',
        "You're ready to celebrate your team!",
      ],
    },
  ],

  // ──────────────────────────────── Inventory ───────────────────────────────
  inventory: [
    {
      title: 'Track every material',
      body: 'Inventory tracks raw materials, work in progress, and finished goods across all your storage locations so you always know what you have and where.',
      icon: Package,
    },
    {
      title: 'Add items',
      body: 'Create items with a SKU, unit of measure, and reorder point. The reorder point is what powers automatic low-stock alerts.',
      icon: Plus,
      bullets: [
        'SKU uniquely identifies the item',
        'Unit of measure keeps counts consistent',
        'Reorder point triggers replenishment alerts',
      ],
    },
    {
      title: 'Set up locations',
      body: 'Define storage locations for each area of the plant so stock is tracked where it physically lives, not just in total.',
      icon: MapPin,
      bullets: [
        'Map locations to real shelves, bins, or zones',
        'Know exactly where to send someone to pick',
      ],
    },
    {
      title: 'Record movements',
      body: 'Log stock movements as materials flow in, between locations, and out. Accurate movements keep on-hand counts trustworthy.',
      icon: TrendingUp,
      bullets: [
        'Receive, transfer, and consume stock',
        'Movements keep balances live and accurate',
      ],
    },
    {
      title: 'Stay ahead of stockouts',
      body: 'When stock falls below an item’s minimum, reorder alerts fire automatically so you replenish before the line ever stops.',
      icon: AlertTriangle,
      bullets: [
        'Alerts surface items at or below reorder point',
        'Act on them before a shortage hits the floor',
        "You're ready to keep materials flowing!",
      ],
    },
  ],

  // ───────────────────────────────── Quality ────────────────────────────────
  quality: [
    {
      title: 'Own quality from the floor',
      body: 'Quality captures pass/fail results and non-conformance reports as work happens, so issues are caught and tracked instead of slipping through.',
      icon: ShieldCheck,
    },
    {
      title: 'Review inspection results',
      body: 'See pass/fail outcomes captured by operators during their work. Trends here tell you whether quality is holding steady.',
      icon: CheckCircle2,
      bullets: [
        'Pass/fail rolls up from app inspections',
        'Watch first-pass yield over time',
      ],
    },
    {
      title: 'Log a non-conformance',
      body: 'Create an NCR when something is out of spec. Capture what happened, where, and the disposition so nothing is lost.',
      icon: AlertTriangle,
      bullets: [
        'Record the defect and affected items',
        'Assign disposition: rework, scrap, or use-as-is',
        'Tie it back to the job and station',
      ],
    },
    {
      title: 'Filter and find issues',
      body: 'Filter by product, department, or date to focus on a specific quality problem and see whether it is recurring.',
      icon: Filter,
      bullets: [
        'Narrow to one product or area',
        'Spot repeat offenders fast',
      ],
    },
    {
      title: 'Drive to closure',
      body: 'Track each issue through to resolution so corrective actions actually happen and the same defect does not return.',
      icon: TrendingUp,
      bullets: [
        'Follow open NCRs until they are closed',
        'Use trends to prevent the next defect',
        "You're ready to keep quality high!",
      ],
    },
  ],

  // ───────────────────────────────── Stations ───────────────────────────────
  stations: [
    {
      title: 'Set up your work centers',
      body: 'Stations are your physical workstations linked to apps. Configure each one so the floor knows what to run and the system can measure it.',
      icon: Monitor,
    },
    {
      title: 'Create a station',
      body: 'Add a station for each physical workstation on your floor. This is the bridge between a real machine or bench and the system.',
      icon: Plus,
      bullets: [
        'One station per physical work center',
        'Name it to match the floor signage',
      ],
    },
    {
      title: 'Assign an app',
      body: 'Link an app to the station to define exactly what operators see and do when they sit down to work there.',
      icon: AppWindow,
      bullets: [
        'The assigned app drives operator instructions',
        'Swap apps as the station’s work changes',
      ],
    },
    {
      title: 'Set the ideal cycle time',
      body: 'Enter the ideal cycle time and shift hours. These are the baselines OEE uses to measure performance and availability.',
      icon: Clock,
      bullets: [
        'Ideal cycle time anchors OEE performance',
        'Shift hours define expected run time',
      ],
    },
    {
      title: 'Watch it live',
      body: 'Once configured, monitor each station’s status from Plant View or the Command Center to see what is running, idle, or down.',
      icon: TrendingUp,
      bullets: [
        'Track live status across the floor',
        'Catch idle and down stations quickly',
        "You're ready to wire up the floor!",
      ],
    },
  ],

  // ───────────────────────────────── OEE ────────────────────────────────────
  oee: [
    {
      title: 'Measure true productivity',
      body: 'OEE (Overall Equipment Effectiveness) combines Availability, Performance, and Quality into one score that shows how productive your equipment really is.',
      icon: Gauge,
    },
    {
      title: 'The three factors',
      body: 'OEE multiplies three numbers. Knowing which one is dragging your score tells you exactly where to focus.',
      icon: SlidersHorizontal,
      bullets: [
        'Availability — is the station actually running?',
        'Performance — is it running at the ideal pace?',
        'Quality — are the parts good the first time?',
      ],
    },
    {
      title: 'Pick station and period',
      body: 'Choose a station and time range to analyze. OEE only means something against a defined window and a known ideal cycle time.',
      icon: Filter,
      bullets: [
        'Select the station to evaluate',
        'Set the shift, day, or week to score',
      ],
    },
    {
      title: 'Read the score',
      body: 'Review the overall OEE percentage and the breakdown by factor. The lowest factor is your biggest opportunity to improve.',
      icon: TrendingUp,
      bullets: [
        'Headline OEE is the single productivity number',
        'Drill into the weakest of the three factors',
      ],
    },
    {
      title: 'Close the loss',
      body: 'Use the losses behind each factor — downtime, slow cycles, defects — to launch targeted improvements and watch the score climb.',
      icon: CheckCircle2,
      bullets: [
        'Attack downtime, speed, and quality losses',
        'Re-check OEE after each change',
        "You're ready to chase 100%!",
      ],
    },
  ],

  // ────────────────────────────── Plant View ────────────────────────────────
  plant: [
    {
      title: 'See the whole floor',
      body: 'Plant View maps your facility in real time. At a glance you can tell which stations are running, idle, or down across the entire plant.',
      icon: Building2,
    },
    {
      title: 'Read the station cards',
      body: 'Each card represents a physical station. Together they form a live map of activity across your facility.',
      icon: LayoutGrid,
      bullets: [
        'One card per configured station',
        'Layout mirrors your floor at a glance',
      ],
    },
    {
      title: 'Know the colors',
      body: 'Status color tells the story instantly so you can spot trouble from across the room.',
      icon: ShieldCheck,
      bullets: [
        'Green — running and producing',
        'Yellow — idle and waiting for work',
        'Red — down and needs attention',
      ],
    },
    {
      title: 'Open a station',
      body: 'Click any station to see its current app and live output, so you can drill from the big picture down to a single work center.',
      icon: Eye,
      bullets: [
        'View the running app and current numbers',
        'Confirm a station is on the right job',
      ],
    },
    {
      title: 'Log downtime',
      body: 'Use the status buttons to log downtime events when a station stops. Accurate downtime is what makes your OEE and analytics trustworthy.',
      icon: AlertTriangle,
      bullets: [
        'Mark a station down and record the reason',
        'Clean downtime data sharpens every report',
        "You're ready to run the floor live!",
      ],
    },
  ],

  // ────────────────────────────── Manager View ──────────────────────────────
  manager: [
    {
      title: 'Your supervisor cockpit',
      body: 'Manager View rolls up the metrics a supervisor needs — output, exceptions, and team status — into one place to run the shift.',
      icon: UserCog,
    },
    {
      title: 'Scan the headline numbers',
      body: 'Start with the summary KPIs to judge how the shift is tracking against plan before you dive into any detail.',
      icon: TrendingUp,
      bullets: [
        'Output and pace versus target',
        'A quick gut-check on the shift',
      ],
    },
    {
      title: 'Watch the exceptions',
      body: 'The exceptions area highlights what is off-plan — late jobs, down stations, quality flags — so you spend your time where it counts.',
      icon: AlertTriangle,
      bullets: [
        'Late and at-risk work orders',
        'Stations needing attention',
        'Open quality issues',
      ],
    },
    {
      title: 'Check on the team',
      body: 'See who is working and where, so you can balance load and step in before a bottleneck forms.',
      icon: Building2,
      bullets: [
        'Operator activity across stations',
        'Rebalance work when an area lags',
      ],
    },
    {
      title: 'Act and follow up',
      body: 'Jump from any item straight to the module where you resolve it, then come back to confirm the shift is back on track.',
      icon: CheckCircle2,
      bullets: [
        'Click through to fix issues at the source',
        'Return to verify the numbers recover',
        "You're ready to run a smooth shift!",
      ],
    },
  ],

  // ──────────────────────────────── Audit Log ───────────────────────────────
  audit: [
    {
      title: 'A complete history',
      body: 'The Transaction Log records every meaningful action in the system — who did what, and when. It is your single source of truth for traceability.',
      icon: ScrollText,
    },
    {
      title: 'Read an entry',
      body: 'Each row captures one event: the user, the action, the affected record, and a timestamp. Together they form an unbroken audit trail.',
      icon: Search,
      bullets: [
        'Who performed the action',
        'What changed and on which record',
        'Exactly when it happened',
      ],
    },
    {
      title: 'Filter to what matters',
      body: 'Use filters to narrow the log by user, action type, or date range so you can find a specific event in seconds.',
      icon: Filter,
      bullets: [
        'Filter by user or action type',
        'Bracket the time window you care about',
      ],
    },
    {
      title: 'Investigate with confidence',
      body: 'When something looks off, trace it back through the log to understand the full sequence of events and stay audit-ready.',
      icon: ShieldCheck,
      bullets: [
        'Reconstruct what led to an issue',
        'Support compliance and traceability requests',
        "You're ready to keep a clean record!",
      ],
    },
  ],
};

/** Aliases so a page can use a different moduleId for the same content. */
const ALIASES: Record<string, string> = {
  'transaction-log': 'audit',
  auditlog: 'audit',
  'audit-log': 'audit',
  'plant-view': 'plant',
  'manager-view': 'manager',
  oeetracker: 'oee',
};

/** Resolve a moduleId to its canonical walkthrough key, applying aliases. */
function resolveKey(moduleId: string): string {
  const id = moduleId?.toLowerCase?.() ?? moduleId;
  if (WALKTHROUGHS[id]) return id;
  if (ALIASES[id] && WALKTHROUGHS[ALIASES[id]]) return ALIASES[id];
  return moduleId;
}

/** Get the walkthrough steps for a module, or undefined when none exist. */
export function getWalkthrough(moduleId: string): WalkthroughStep[] | undefined {
  return WALKTHROUGHS[resolveKey(moduleId)];
}

// Re-exported icons kept referenced so the registry stays the single home for
// module iconography (used by callers that build their own launchers).
export const WALKTHROUGH_ICONS = { Sparkles, Play };

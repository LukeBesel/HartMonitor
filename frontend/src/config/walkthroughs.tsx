import {
  LayoutDashboard,
  AppWindow,
  Calendar,
  BarChart2,
  Package,
  Monitor,
  Sparkles,
  Filter,
  TrendingUp,
  Search,
  Play,
  Plus,
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
  /**
   * The element on the page this step is talking about, as a CSS selector.
   *
   * A tour is only honest if every sentence in it points at something that is
   * actually on screen — the dashboard tour used to narrate two sections that
   * had been deleted and a Customize button that no longer exists. Elements
   * carry `data-tour="…"` for exactly this, and a scripted check resolves
   * every selector here against the live page.
   */
  target?: string;
}

/**
 * Per-module guided walkthrough content, keyed by the `moduleId` that each page
 * passes to <ModuleOnboarding/>. A key here gives that page a "Show me around"
 * button; NO key means the page shows no button at all, which is the right
 * answer for most screens.
 *
 * FIVE keys, deliberately. There were fifteen, they opened themselves on first
 * visit, and five of them narrated screens the product no longer has. A tour
 * nobody asked for that describes furniture nobody can find is worse than
 * silence, so the list is now the handful of screens where a walk-through
 * genuinely helps, and every one of them opens only when someone asks for it.
 */
export const WALKTHROUGHS: Record<string, WalkthroughStep[]> = {
  // ───────────────────────────── Command Center ─────────────────────────────
  // Seven sentences about the seven things on the screen, in the order they
  // are read, each one pointing at an element that exists (`data-tour` on
  // Dashboard.tsx). A tour of furniture nobody can find is worse than silence.
  dashboard: [
    {
      title: 'Everything that needs you, first',
      body: 'The top of the page is the only block that can change your plan today: work orders behind or overdue, stations down, low stock, and help requests raised from the floor. Answer a help request right here, or click a row to open the screen where you fix it.',
      icon: AlertTriangle,
      target: '[data-tour="attention"]',
    },
    {
      title: 'The whole plant, with nothing selected',
      body: 'Under it sits your plant as it is right now. You do not pick anything to see it — it loads plant-wide, and the heading always names what you are reading.',
      icon: LayoutDashboard,
      target: '[data-tour="scope-heading"]',
    },
    {
      title: 'Five numbers, measured not guessed',
      body: 'How many runs finished today, how many are running this second, how long an average run takes, the pass rate over inspected runs, and how many open work orders are on track. A number nobody measured shows a dash and says why — never a zero that reads as bad news.',
      icon: TrendingUp,
      target: '[data-tour="kpis"]',
    },
    {
      title: 'Narrow it to one department',
      body: 'Choosing a department or an app filters every number, list and chart below it at once. Clear the choice and you are back to the whole plant.',
      icon: Filter,
      target: '[data-tour="filters"]',
    },
    {
      title: 'Each area of the floor',
      body: 'One card per department, showing that area with the same figures in the same words. Open a card for its stations, its wall board and the people on it.',
      icon: MapPin,
      target: '[data-tour="departments"]',
    },
    {
      title: 'Runs as they land',
      body: 'Every run your apps record appears here with the time it took, and anything still on the bench counts up live so you can see what is taking longer than it should.',
      icon: Clock,
      target: '[data-tour="latest-runs"]',
    },
    {
      title: 'Output, and what is due',
      body: 'The chart shows what finished across the last 24 hours or the last 7 days, and the card under it lists the work orders due in the next two days. Hit Refresh in the header whenever you want the latest.',
      icon: BarChart2,
      target: '[data-tour="output"]',
    },
  ],

  // The App Library has no entry here on purpose: <AppTrainingCoach/> walks
  // people through building and running an app in the product itself, and a
  // second guide on the same screen would compete with it.

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

  // ──────────────────────────────── Analytics ───────────────────────────────
  analytics: [
    {
      title: 'Turn data into insight',
      body: 'App comparison converts your completion data into clear insights about throughput, efficiency, and trends across every app, so you can find where to improve.',
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
      body: 'Once configured, monitor each station’s status from the Command Center or the station’s own page to see what is running, idle, or down.',
      icon: TrendingUp,
      bullets: [
        'Track live status across the floor',
        'Catch idle and down stations quickly',
        "You're ready to wire up the floor!",
      ],
    },
  ],
};

// There are no aliases any more. Every alias this file used to carry pointed at
// a tour for a screen that has since been retired (plant, manager, oee, audit),
// so an alias table could only ever resolve a page to a tour of somewhere else.
/** Resolve a moduleId to its walkthrough key. */
function resolveKey(moduleId: string): string {
  const id = moduleId?.toLowerCase?.() ?? moduleId;
  return WALKTHROUGHS[id] ? id : moduleId;
}

/** Get the walkthrough steps for a module, or undefined when none exist. */
export function getWalkthrough(moduleId: string): WalkthroughStep[] | undefined {
  return WALKTHROUGHS[resolveKey(moduleId)];
}

// Re-exported icons kept referenced so the registry stays the single home for
// module iconography (used by callers that build their own launchers).
export const WALKTHROUGH_ICONS = { Sparkles, Play };

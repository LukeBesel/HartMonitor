import { useMemo } from 'react';
import {
  LayoutDashboard, AppWindow, Database, BarChart3,
  Calendar, Trophy,
  Users, Cpu, LayoutGrid,
  Package, ShoppingCart, ShieldCheck,
  Factory, CalendarRange, Layers, Tablet, Network, GitBranch,
  Boxes, PackageCheck, PackageOpen, Truck, ListChecks,
  GraduationCap,
  Bell, AlertTriangle, Wrench, ClipboardCheck, Lightbulb, BookOpen,
  FolderKanban,
} from 'lucide-react';
import { useModules } from '../context/ModulesContext';

export type NavItem = {
  to: string; icon: React.ElementType; label: string;
  exact?: boolean; proOnly?: boolean; minRole?: string;
  /** Items that can't be hidden and always show regardless of workspace. */
  pinned?: boolean;
  /** Opens a full-screen experience outside the management shell (e.g. the
   *  operator kiosk) — navigated to as a normal link, no sidebar around it. */
  standalone?: boolean;
  /** Only shown to Enterprise-tier accounts. */
  enterpriseOnly?: boolean;
  /** Composable-MES module this item belongs to (key from the module registry
   *  in ModulesContext). Items without a module are always shown. */
  module?: string;
  /** HartMonitor's own operator tooling — never a customer's to see, whatever
   *  role their workspace gave them. Gated on the user's is_platform_staff
   *  flag, deliberately not on `minRole`: 'developer' is the role every brand
   *  new signup's first user gets, so a role gate would show this to every
   *  customer owner on their first visit. */
  platformStaffOnly?: boolean;
};

// Listed in sidebar order: the five primary workspaces, then the four that sit
// under "More".
export type SectionId =
  | 'production'
  | 'apps'
  | 'quality_ops'
  | 'maintenance_ops'
  | 'people'
  | 'planning'
  | 'inventory'
  | 'kaizen'
  | 'reporting';

export type NavSection = {
  id: SectionId;
  label: string;
  icon: React.ElementType;
  description: string;
  items: NavItem[];
  /** Whole section is part of the paid plan — hidden for Free accounts until they
   *  need it (hit a plan limit) or upgrade. Keeps the default nav lean. */
  proOnly?: boolean;
  /** Lives under "More" in the sidebar rather than in the always-visible list.
   *  Five workspaces is what someone scans without reading; the rest are real,
   *  one click away, and can be switched off outright in Settings → Modules. */
  secondary?: boolean;
};

// Nothing is permanently pinned anymore — the Command Center lives in Production.
export const PINNED_ITEMS: NavItem[] = [];

// Two-level navigation: the sidebar (level 1) lists only these workspaces; the
// content-header tab bar (level 2) lists the focused workspace's screens.
// Multi-tab pages (Training, Maintenance/CMMS, Purchasing) get exactly ONE nav
// item each — their page-internal tabs are the sub-navigation.
export const SECTIONS: NavSection[] = [
  {
    id: 'production',
    label: 'Production',
    icon: Factory,
    description: 'Run the floor day to day',
    items: [
      // ONE live-floor entry. The Command Center is the whole plant, live, and
      // narrows to a department on request; a department's own page is reached
      // from the cards on it. Two more menu items leading to two more screens
      // that answered "what is the floor doing" differently at the same minute
      // is the bug this section no longer has.
      { to: '/dashboard',   icon: LayoutDashboard, label: 'Command Center', exact: true, module: 'production' },
      { to: '/andon',       icon: Bell,       label: 'Andon Board',     module: 'andon' },
      { to: '/shift-notes', icon: BookOpen,   label: 'Shift Notes',     module: 'shifts' },
      { to: '/reports/production', icon: BarChart3, label: 'Reports',   module: 'production' },
    ],
  },
  // Apps sits directly under Production: Production is where a manager starts
  // the day, and Apps is what produces everything Production reports on. New
  // accounts still LAND here (see FirstRunLanding) and the guided training
  // teaches this workspace before anything else.
  {
    id: 'apps',
    label: 'Apps',
    icon: AppWindow,
    description: 'Build guided procedures, run them on the floor',
    items: [
      { to: '/apps',           icon: AppWindow,       label: 'App Library',     module: 'apps' },
      { to: '/apps/dashboard', icon: LayoutDashboard, label: 'Dashboard',       module: 'apps' },
      { to: '/operator',       icon: Tablet,          label: 'Operator Portal', standalone: true, module: 'production' },
    ],
  },
  {
    id: 'quality_ops',
    label: 'Quality',
    icon: ShieldCheck,
    description: 'NCRs and corrective action',
    items: [
      { to: '/quality',  icon: ShieldCheck,   label: 'NCR / Quality',    proOnly: true, module: 'quality' },
      { to: '/capa',     icon: ClipboardCheck,label: 'CAPA Tracker',     proOnly: true, module: 'quality' },
      { to: '/reports/quality', icon: BarChart3, label: 'Reports',       module: 'quality' },
    ],
  },
  {
    id: 'maintenance_ops',
    label: 'Maintenance',
    icon: Wrench,
    description: 'Assets, PM schedules, maintenance work orders',
    proOnly: true,
    items: [
      { to: '/maintenance',  icon: Wrench,    label: 'CMMS',    proOnly: true, module: 'maintenance' },
      { to: '/reports/maintenance', icon: BarChart3, label: 'Reports', module: 'maintenance' },
    ],
  },
  {
    id: 'people',
    label: 'People',
    icon: Users,
    description: 'Training, skills, and certifications',
    proOnly: true,
    items: [
      // Training is one screen — its internal Overview/Skills/Certs/Plans tabs
      // are the sub-navigation, so it gets a single nav item here.
      { to: '/training',       icon: GraduationCap, label: 'Training', proOnly: true, minRole: 'supervisor', module: 'training' },
      { to: '/reports/people', icon: BarChart3,     label: 'Reports',  module: 'training' },
    ],
  },
  {
    id: 'planning',
    secondary: true,
    label: 'Planning',
    icon: CalendarRange,
    description: 'Schedule work and resources',
    items: [
      { to: '/schedule',    icon: Calendar,      label: 'Schedule',      module: 'production' },
      { to: '/routings',    icon: GitBranch,     label: 'Routings',      proOnly: true, minRole: 'supervisor', module: 'production' },
      { to: '/capacity',    icon: Users,         label: 'Capacity Plan', minRole: 'manager', module: 'analytics' },
    ],
  },
  {
    id: 'inventory',
    secondary: true,
    label: 'Inventory',
    icon: Boxes,
    description: 'Track stock and purchasing',
    items: [
      // exact — so the Tracker link doesn't also light up on /inventory/boms & /inventory/kitting
      { to: '/inventory',     icon: Package,       label: 'Inventory Tracker', exact: true, proOnly: true, module: 'inventory' },
      { to: '/inventory/boms',    icon: Layers,       label: 'BOMs',           minRole: 'supervisor', module: 'inventory' },
      { to: '/inventory/kitting', icon: PackageOpen,  label: 'Kitting',        module: 'inventory' },
      { to: '/receiving',     icon: PackageCheck,  label: 'Receiving',         proOnly: false, module: 'inventory' },
      { to: '/requirements',  icon: ListChecks,    label: 'Materials Required', proOnly: true, minRole: 'supervisor', module: 'inventory' },
      { to: '/shipments',     icon: Truck,         label: 'Shipments',          proOnly: true, module: 'inventory' },
      { to: '/purchasing',    icon: ShoppingCart,  label: 'Purchasing',         proOnly: true, minRole: 'supervisor', module: 'inventory' },
      { to: '/reports/inventory', icon: BarChart3, label: 'Reports',            module: 'inventory' },
    ],
  },
  {
    id: 'kaizen',
    secondary: true,
    label: 'Kaizen / CI',
    icon: Lightbulb,
    description: 'Improvement ideas and projects',
    items: [
      { to: '/kaizen',         icon: Lightbulb,   label: 'Kaizen / CI Ideas', module: 'kaizen' },
      // Ideas are where improvement work starts; projects are where it gets
      // scheduled, tracked and closed out — same workspace, same module gate.
      { to: '/ci-projects',    icon: FolderKanban, label: 'Projects',          module: 'kaizen' },
      { to: '/reports/kaizen', icon: BarChart3,    label: 'Reports',           module: 'kaizen' },
    ],
  },
  {
    id: 'reporting',
    secondary: true,
    label: 'Reporting',
    icon: BarChart3,
    description: 'Analyze results and quality',
    items: [
      { to: '/dashboards',       icon: LayoutGrid,  label: 'Dashboards',       module: 'apps' },
      // Tables are the lookup data an app READS (part specs, torque windows)
      // and where a "save a record" trigger WRITES. They sat in the Apps tab
      // row looking like a spreadsheet feature nobody asked for; they belong
      // next to Dashboards, with the rest of the build-it-yourself data tools.
      { to: '/tables',           icon: Database,    label: 'Tables',           minRole: 'supervisor', proOnly: true, module: 'apps' },
      { to: '/leaderboard',      icon: Trophy,      label: 'Leaderboard',      module: 'analytics' },
      { to: '/oee',              icon: Cpu,         label: 'OEE Tracker',      minRole: 'supervisor', proOnly: true, module: 'production' },
      { to: '/analytics',        icon: BarChart3,   label: 'Operation Analytics', module: 'analytics' },
      { to: '/facilities',       icon: Network,     label: 'Facilities',       minRole: 'manager', enterpriseOnly: true, module: 'production' },
      { to: '/audit-log',        icon: AlertTriangle, label: 'Audit Log',      minRole: 'supervisor' },
      { to: '/admin',            icon: ShieldCheck, label: 'Admin Dashboard',   platformStaffOnly: true },
    ],
  },
];

// ─── Composable-MES filtering ─────────────────────────────────────────────────
// Filters nav sections down to the modules a company has enabled. Items with
// no `module` key always survive; sections left with zero items are dropped.
export function filterNavByModules(
  sections: NavSection[],
  isEnabled: (key: string) => boolean,
): NavSection[] {
  return sections
    .map(s => ({ ...s, items: s.items.filter(i => !i.module || isEnabled(i.module)) }))
    .filter(s => s.items.length > 0);
}

/** SECTIONS filtered to this company's enabled modules. Drop-in replacement
 *  for the static SECTIONS export anywhere inside the ModulesProvider tree —
 *  Layout.tsx only needs to swap `SECTIONS` for `useVisibleSections()`. */
export function useVisibleSections(): NavSection[] {
  const { isEnabled } = useModules();
  return useMemo(() => filterNavByModules(SECTIONS, isEnabled), [isEnabled]);
}

// ─── Route → workspace derivation ─────────────────────────────────────────────
// The focused workspace is derived from the CURRENT ROUTE, never from manual
// state, so deep links always highlight the right sidebar section and tab.
// Longest-prefix wins so `/inventory/kitting/123` resolves via the Kitting item
// rather than the Inventory Tracker item, and legacy deep links like
// `/training/certs` still resolve to People through the `/training` item.

/** True when `pathname` is `itemPath` itself or a sub-route of it. */
function pathMatchesItem(pathname: string, itemPath: string): boolean {
  return pathname === itemPath || pathname.startsWith(`${itemPath}/`);
}

/**
 * Detail screens that have no menu item of their own, and the workspace they
 * belong to. A department's page is opened from a card on the Command Center
 * rather than from the sidebar, and the sidebar still has to light up
 * Production while somebody is reading it — otherwise clicking through from
 * the Command Center appears to leave the app.
 */
const PATH_SECTIONS: { prefix: string; section: SectionId }[] = [
  { prefix: '/departments', section: 'production' },
];

/** The section that owns `pathname`, or null for routes outside the nav
 *  (e.g. /settings). Pure — pass any section list (tests use SECTIONS,
 *  Layout passes the module-filtered list). */
export function findSectionForPath(
  pathname: string,
  sections: NavSection[] = SECTIONS,
): NavSection | null {
  let best: NavSection | null = null;
  let bestLen = -1;
  for (const section of sections) {
    for (const item of section.items) {
      if (pathMatchesItem(pathname, item.to) && item.to.length > bestLen) {
        best = section;
        bestLen = item.to.length;
      }
    }
  }
  if (best) return best;

  for (const alias of PATH_SECTIONS) {
    if (!pathMatchesItem(pathname, alias.prefix)) continue;
    const section = sections.find(s => s.id === alias.section);
    if (section) return section;
  }
  return null;
}

// Every nav item a CUSTOMER can be given, which is what the per-role permission
// grid in Settings edits. Platform-staff items are excluded on purpose: no role
// permission can grant HartMonitor's own tooling, so offering a toggle for it
// would be a lie — and putting the row on screen at all would tell every
// customer that the console exists.
export const ALL_SECTION_ITEMS: NavItem[] =
  SECTIONS.flatMap(s => s.items).filter(i => !i.platformStaffOnly);

// Icon used for the "All" workspace option (kept for backwards compatibility but not used in UI).
export const ALL_WORKSPACE_ICON = Layers;

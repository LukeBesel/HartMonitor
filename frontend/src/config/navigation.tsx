import {
  LayoutDashboard, AppWindow, Database, BarChart3, Monitor,
  Calendar, ClipboardList, Trophy,
  Timer, Users, Cpu, LayoutGrid,
  Package, ShoppingCart, ShieldCheck, Building2,
  Factory, CalendarRange, Layers, History, Tablet, Network, GitBranch,
} from 'lucide-react';

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
};

export type SectionId = 'production' | 'planning' | 'reporting';

export type NavSection = {
  id: SectionId;
  label: string;
  icon: React.ElementType;
  description: string;
  items: NavItem[];
  /** Whole section is part of the paid plan — hidden for Free accounts until they
   *  need it (hit a plan limit) or upgrade. Keeps the default nav lean. */
  proOnly?: boolean;
};

// Always visible, independent of the chosen workspace.
export const PINNED_ITEMS: NavItem[] = [
  { to: '/dashboard', icon: LayoutDashboard, label: 'Command Center', exact: true, pinned: true },
  { to: '/operator',  icon: Tablet,          label: 'Operator Portal', pinned: true, standalone: true },
];

// The app is organised into three plain-language workspaces so a new user can
// pick the one that matches their job instead of scanning every feature.
export const SECTIONS: NavSection[] = [
  {
    id: 'production',
    label: 'Production',
    icon: Factory,
    description: 'Run the floor day to day',
    items: [
      { to: '/apps',        icon: AppWindow,  label: 'App Library' },
      { to: '/departments', icon: Building2,  label: 'Departments' },
      { to: '/stations',    icon: Monitor,    label: 'Stations' },
    ],
  },
  {
    id: 'planning',
    label: 'Planning',
    icon: CalendarRange,
    description: 'Schedule work and resources',
    proOnly: true,
    items: [
      { to: '/schedule',   icon: Calendar,     label: 'Schedule' },
      { to: '/routings',   icon: GitBranch,    label: 'Routings',       proOnly: true, minRole: 'supervisor' },
      { to: '/manager',    icon: ClipboardList, label: 'Manager View',  minRole: 'manager' },
      { to: '/capacity',   icon: Users,        label: 'Capacity Plan',  minRole: 'manager' },
      { to: '/inventory',  icon: Package,      label: 'Inventory',      proOnly: true },
      { to: '/purchasing', icon: ShoppingCart, label: 'Purchasing',     proOnly: true, minRole: 'supervisor' },
    ],
  },
  {
    id: 'reporting',
    label: 'Reporting',
    icon: BarChart3,
    description: 'Analyse results and quality',
    items: [
      { to: '/dashboards',       icon: LayoutGrid,  label: 'Dashboards' },
      { to: '/leaderboard',      icon: Trophy,      label: 'Leaderboard' },
      { to: '/oee',              icon: Cpu,         label: 'OEE Tracker',      minRole: 'supervisor', proOnly: true },
      { to: '/step-metrics',     icon: Timer,       label: 'Step Metrics',     minRole: 'supervisor' },
      { to: '/analytics',        icon: BarChart3,   label: 'Analytics' },
      { to: '/quality',          icon: ShieldCheck, label: 'NCR / Quality',    proOnly: true },
      { to: '/facilities',       icon: Network,     label: 'Facilities',       minRole: 'manager', enterpriseOnly: true },
      { to: '/tables',           icon: Database,    label: 'Tables',           minRole: 'supervisor', proOnly: true },
      { to: '/transaction-log',  icon: History,     label: 'Transaction Log',  minRole: 'supervisor' },
    ],
  },
];

export const ALL_SECTION_ITEMS: NavItem[] = SECTIONS.flatMap(s => s.items);

// Icon used for the "All" workspace option (kept for backwards compatibility but not used in UI).
export const ALL_WORKSPACE_ICON = Layers;

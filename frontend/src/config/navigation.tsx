import {
  LayoutDashboard, AppWindow, Database, BarChart3, Monitor,
  Calendar, ClipboardList, Trophy,
  Timer, Users, Cpu, LayoutGrid,
  Package, ShoppingCart, ShieldCheck, Building2,
  Factory, CalendarRange, Layers, History,
} from 'lucide-react';

export type NavItem = {
  to: string; icon: React.ElementType; label: string;
  exact?: boolean; proOnly?: boolean; minRole?: string;
  /** Items that can't be hidden and always show regardless of workspace. */
  pinned?: boolean;
};

export type SectionId = 'production' | 'planning' | 'reporting';

export type NavSection = {
  id: SectionId;
  label: string;
  icon: React.ElementType;
  description: string;
  items: NavItem[];
};

// Always visible, independent of the chosen workspace.
export const PINNED_ITEMS: NavItem[] = [
  { to: '/dashboard', icon: LayoutDashboard, label: 'Command Center', exact: true, pinned: true },
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
      { to: '/apps',     icon: AppWindow, label: 'App Library' },
      { to: '/plant',    icon: Building2, label: 'Plant View' },
      { to: '/stations', icon: Monitor,   label: 'Stations' },
    ],
  },
  {
    id: 'planning',
    label: 'Planning',
    icon: CalendarRange,
    description: 'Schedule work and resources',
    items: [
      { to: '/schedule',   icon: Calendar,     label: 'Schedule' },
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
      { to: '/dashboards',   icon: LayoutGrid,  label: 'Dashboards' },
      { to: '/leaderboard',  icon: Trophy,      label: 'Leaderboard' },
      { to: '/oee',          icon: Cpu,         label: 'OEE Tracker',  minRole: 'supervisor' },
      { to: '/step-metrics', icon: Timer,       label: 'Step Metrics', minRole: 'supervisor' },
      { to: '/analytics',    icon: BarChart3,   label: 'Analytics' },
      { to: '/quality',      icon: ShieldCheck, label: 'NCR / Quality', proOnly: true },
      { to: '/tables',       icon: Database,    label: 'Tables',        minRole: 'supervisor' },
      { to: '/audit-log',    icon: History,     label: 'Audit Log',     minRole: 'supervisor' },
    ],
  },
];

export const ALL_SECTION_ITEMS: NavItem[] = SECTIONS.flatMap(s => s.items);

// Icon used for the "All" workspace option.
export const ALL_WORKSPACE_ICON = Layers;

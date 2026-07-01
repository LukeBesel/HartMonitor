import { useMemo } from 'react';
import {
  LayoutDashboard, AppWindow, Database, BarChart3,
  Calendar, ClipboardList, Trophy,
  Users, Cpu, LayoutGrid,
  Package, ShoppingCart, ShieldCheck, Building2,
  Factory, CalendarRange, Layers, History, Tablet, Network, GitBranch,
  HeartPulse, Boxes, PackageCheck, Truck, ListChecks,
  GraduationCap, Award,
  Bell, AlertTriangle, Wrench, ClipboardCheck, Lightbulb, BookOpen,
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
};

export type SectionId = 'production' | 'planning' | 'reporting' | 'inventory' | 'people' | 'quality_ops' | 'maintenance_ops';

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

// Nothing is permanently pinned anymore — the Command Center lives in Production.
export const PINNED_ITEMS: NavItem[] = [];

// The app is organised into plain-language workspaces so a new user can pick the
// one that matches their job instead of scanning every feature.
export const SECTIONS: NavSection[] = [
  {
    id: 'production',
    label: 'Production',
    icon: Factory,
    description: 'Run the floor day to day',
    items: [
      { to: '/dashboard',   icon: LayoutDashboard, label: 'Command Center', exact: true, module: 'production' },
      { to: '/apps',        icon: AppWindow,  label: 'App Library',     module: 'apps' },
      { to: '/departments', icon: Building2,  label: 'Departments',     module: 'production' },
      { to: '/sqdc',        icon: HeartPulse, label: 'SQDC',            module: 'quality' },
      { to: '/andon',       icon: Bell,       label: 'Andon Board',     module: 'andon' },
      { to: '/shift-notes', icon: BookOpen,   label: 'Shift Notes',     module: 'shifts' },
      { to: '/operator',    icon: Tablet,     label: 'Operator Portal', standalone: true, module: 'production' },
    ],
  },
  {
    id: 'planning',
    label: 'Planning',
    icon: CalendarRange,
    description: 'Schedule work and resources',
    proOnly: true,
    items: [
      { to: '/schedule',   icon: Calendar,     label: 'Schedule',       module: 'production' },
      { to: '/routings',   icon: GitBranch,    label: 'Routings',       proOnly: true, minRole: 'supervisor', module: 'production' },
      { to: '/manager',    icon: ClipboardList, label: 'Manager View',  minRole: 'manager', module: 'production' },
      { to: '/capacity',   icon: Users,        label: 'Capacity Plan',  minRole: 'manager', module: 'analytics' },
    ],
  },
  {
    id: 'inventory',
    label: 'Inventory',
    icon: Boxes,
    description: 'Track stock and purchasing',
    items: [
      { to: '/inventory',     icon: Package,       label: 'Inventory Tracker', proOnly: true, module: 'inventory' },
      { to: '/receiving',     icon: PackageCheck,  label: 'Receiving',         proOnly: false, module: 'inventory' },
      { to: '/requirements',  icon: ListChecks,    label: 'Materials Required', proOnly: true, minRole: 'supervisor', module: 'inventory' },
      { to: '/shipments',     icon: Truck,         label: 'Shipments',          proOnly: true, module: 'inventory' },
      { to: '/purchasing',    icon: ShoppingCart,  label: 'Purchasing',         proOnly: true, minRole: 'supervisor', module: 'inventory' },
    ],
  },
  {
    id: 'quality_ops',
    label: 'Quality & CI',
    icon: ShieldCheck,
    description: 'CAPA, NCR, and continuous improvement',
    items: [
      { to: '/quality',  icon: ShieldCheck,   label: 'NCR / Quality',    proOnly: true, module: 'quality' },
      { to: '/capa',     icon: ClipboardCheck,label: 'CAPA Tracker',     proOnly: true, module: 'quality' },
      { to: '/kaizen',   icon: Lightbulb,     label: 'Kaizen / CI Ideas', module: 'kaizen' },
    ],
  },
  {
    id: 'maintenance_ops',
    label: 'Maintenance',
    icon: Wrench,
    description: 'Assets, PM schedules, maintenance work orders',
    proOnly: true,
    items: [
      { to: '/maintenance',  icon: Wrench,        label: 'CMMS',           proOnly: true, module: 'maintenance' },
    ],
  },
  {
    id: 'people',
    label: 'People',
    icon: Users,
    description: 'Training, skills, and certifications',
    proOnly: true,
    items: [
      { to: '/training',      icon: GraduationCap, label: 'Skills Matrix',      proOnly: true, minRole: 'supervisor', module: 'training' },
      { to: '/training/certs',icon: Award,         label: 'Certifications',     proOnly: true, minRole: 'supervisor', module: 'training' },
      { to: '/training/plans',icon: ClipboardList, label: 'Training Plans',     proOnly: true, minRole: 'supervisor', module: 'training' },
    ],
  },
  {
    id: 'reporting',
    label: 'Reporting',
    icon: BarChart3,
    description: 'Analyze results and quality',
    items: [
      { to: '/dashboards',       icon: LayoutGrid,  label: 'Dashboards',       module: 'apps' },
      { to: '/leaderboard',      icon: Trophy,      label: 'Leaderboard',      module: 'analytics' },
      { to: '/oee',              icon: Cpu,         label: 'OEE Tracker',      minRole: 'supervisor', proOnly: true, module: 'production' },
      { to: '/analytics',        icon: BarChart3,   label: 'Operation Analytics', module: 'analytics' },
      { to: '/facilities',       icon: Network,     label: 'Facilities',       minRole: 'manager', enterpriseOnly: true, module: 'production' },
      { to: '/tables',           icon: Database,    label: 'Tables',           minRole: 'supervisor', proOnly: true, module: 'apps' },
      { to: '/transaction-log',  icon: History,     label: 'Transaction Log',  minRole: 'supervisor', module: 'analytics' },
      { to: '/audit-log',        icon: AlertTriangle, label: 'Audit Log',      minRole: 'supervisor' },
      { to: '/admin',            icon: ShieldCheck, label: 'Admin Dashboard',   minRole: 'developer' },
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

export const ALL_SECTION_ITEMS: NavItem[] = SECTIONS.flatMap(s => s.items);

// Icon used for the "All" workspace option (kept for backwards compatibility but not used in UI).
export const ALL_WORKSPACE_ICON = Layers;

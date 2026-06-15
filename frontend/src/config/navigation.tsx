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
      { to: '/dashboard',   icon: LayoutDashboard, label: 'Command Center', exact: true },
      { to: '/apps',        icon: AppWindow,  label: 'App Library' },
      { to: '/departments', icon: Building2,  label: 'Departments' },
      { to: '/sqdc',        icon: HeartPulse, label: 'SQDC' },
      { to: '/andon',       icon: Bell,       label: 'Andon Board' },
      { to: '/shift-notes', icon: BookOpen,   label: 'Shift Notes' },
      { to: '/operator',    icon: Tablet,     label: 'Operator Portal', standalone: true },
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
    ],
  },
  {
    id: 'inventory',
    label: 'Inventory',
    icon: Boxes,
    description: 'Track stock and purchasing',
    items: [
      { to: '/inventory',     icon: Package,       label: 'Inventory Tracker', proOnly: true },
      { to: '/receiving',     icon: PackageCheck,  label: 'Receiving',         proOnly: false },
      { to: '/requirements',  icon: ListChecks,    label: 'Materials Required', proOnly: true, minRole: 'supervisor' },
      { to: '/shipments',     icon: Truck,         label: 'Shipments',          proOnly: true },
      { to: '/purchasing',    icon: ShoppingCart,  label: 'Purchasing',         proOnly: true, minRole: 'supervisor' },
    ],
  },
  {
    id: 'quality_ops',
    label: 'Quality & CI',
    icon: ShieldCheck,
    description: 'CAPA, NCR, and continuous improvement',
    items: [
      { to: '/quality',  icon: ShieldCheck,   label: 'NCR / Quality',    proOnly: true },
      { to: '/capa',     icon: ClipboardCheck,label: 'CAPA Tracker',     proOnly: true },
      { to: '/kaizen',   icon: Lightbulb,     label: 'Kaizen / CI Ideas' },
    ],
  },
  {
    id: 'maintenance_ops',
    label: 'Maintenance',
    icon: Wrench,
    description: 'Assets, PM schedules, maintenance work orders',
    proOnly: true,
    items: [
      { to: '/maintenance',  icon: Wrench,        label: 'CMMS',           proOnly: true },
    ],
  },
  {
    id: 'people',
    label: 'People',
    icon: Users,
    description: 'Training, skills, and certifications',
    proOnly: true,
    items: [
      { to: '/training',      icon: GraduationCap, label: 'Skills Matrix',      proOnly: true, minRole: 'supervisor' },
      { to: '/training/certs',icon: Award,         label: 'Certifications',     proOnly: true, minRole: 'supervisor' },
      { to: '/training/plans',icon: ClipboardList, label: 'Training Plans',     proOnly: true, minRole: 'supervisor' },
    ],
  },
  {
    id: 'reporting',
    label: 'Reporting',
    icon: BarChart3,
    description: 'Analyze results and quality',
    items: [
      { to: '/dashboards',       icon: LayoutGrid,  label: 'Dashboards' },
      { to: '/leaderboard',      icon: Trophy,      label: 'Leaderboard' },
      { to: '/oee',              icon: Cpu,         label: 'OEE Tracker',      minRole: 'supervisor', proOnly: true },
      { to: '/analytics',        icon: BarChart3,   label: 'Operation Analytics' },
      { to: '/facilities',       icon: Network,     label: 'Facilities',       minRole: 'manager', enterpriseOnly: true },
      { to: '/tables',           icon: Database,    label: 'Tables',           minRole: 'supervisor', proOnly: true },
      { to: '/transaction-log',  icon: History,     label: 'Transaction Log',  minRole: 'supervisor' },
      { to: '/audit-log',        icon: AlertTriangle, label: 'Audit Log',      minRole: 'supervisor' },
    ],
  },
];

export const ALL_SECTION_ITEMS: NavItem[] = SECTIONS.flatMap(s => s.items);

// Icon used for the "All" workspace option (kept for backwards compatibility but not used in UI).
export const ALL_WORKSPACE_ICON = Layers;

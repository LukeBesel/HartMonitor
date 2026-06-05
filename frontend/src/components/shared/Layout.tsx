import { useState, useEffect } from 'react';
import { Outlet, NavLink, Link, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard, AppWindow, Database, BarChart3, Monitor,
  Calendar, Settings, Activity, Building2, ClipboardList,
  Timer, Users, Cpu, LayoutGrid, ChevronLeft, ChevronRight,
  Package, ShoppingCart, ShieldCheck, LogOut, ChevronDown,
} from 'lucide-react';
import { usePlan } from '../../context/PlanContext';
import { useAuth } from '../../context/AuthContext';

type NavItem = {
  to: string; icon: React.ElementType; label: string;
  exact?: boolean; proOnly?: boolean; minRole?: string;
};

const NAV: { group: string; items: NavItem[] }[] = [
  {
    group: 'Operations',
    items: [
      { to: '/',         icon: LayoutDashboard, label: 'Command Center',  exact: true },
      { to: '/apps',     icon: AppWindow,       label: 'App Library' },
      { to: '/schedule', icon: Calendar,        label: 'Schedule' },
    ]
  },
  {
    group: 'Monitoring',
    items: [
      { to: '/plant',    icon: Building2,       label: 'Plant View' },
      { to: '/manager',  icon: ClipboardList,   label: 'Manager View',  minRole: 'manager' },
      { to: '/oee',      icon: Cpu,             label: 'OEE Tracker',   minRole: 'supervisor' },
      { to: '/stations', icon: Monitor,         label: 'Stations' },
    ]
  },
  {
    group: 'Inventory & Supply',
    items: [
      { to: '/inventory',  icon: Package,      label: 'Inventory',   proOnly: true },
      { to: '/purchasing', icon: ShoppingCart, label: 'Purchasing',  proOnly: true, minRole: 'supervisor' },
    ]
  },
  {
    group: 'Quality',
    items: [
      { to: '/quality', icon: ShieldCheck, label: 'NCR / Quality', proOnly: true },
    ]
  },
  {
    group: 'Analytics',
    items: [
      { to: '/dashboards',   icon: LayoutGrid, label: 'Dashboards' },
      { to: '/step-metrics', icon: Timer,      label: 'Step Metrics',  minRole: 'supervisor' },
      { to: '/capacity',     icon: Users,      label: 'Capacity Plan', minRole: 'manager' },
      { to: '/analytics',    icon: BarChart3,  label: 'Analytics' },
      { to: '/tables',       icon: Database,   label: 'Tables',        minRole: 'supervisor' },
    ]
  },
];

function ProBadge() {
  return (
    <span className="ml-auto text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-amber-500/20 text-amber-400 leading-none">
      PRO
    </span>
  );
}

const ROLE_LEVELS: Record<string, number> = { developer: 5, manager: 4, supervisor: 3, operator: 2, viewer: 1 };

export default function Layout() {
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem('hm_sidebar') === 'collapsed');
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const { isFree } = usePlan();
  const { user, logout, isAtLeast } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    localStorage.setItem('hm_sidebar', collapsed ? 'collapsed' : 'open');
  }, [collapsed]);

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  const sidebarW = collapsed ? 'w-14' : 'w-56';

  return (
    <div className="flex h-screen overflow-hidden bg-slate-50">
      <aside
        className={`${sidebarW} flex-shrink-0 flex flex-col transition-all duration-200`}
        style={{ backgroundColor: 'var(--sidebar-bg)' }}
      >
        <Link
          to="/"
          className={`flex items-center border-b border-white/10 hover:bg-white/5 transition-colors flex-shrink-0 ${collapsed ? 'justify-center p-3' : 'gap-3 p-4'}`}
        >
          <div
            className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 shadow-lg"
            style={{ background: 'linear-gradient(135deg, var(--accent), var(--accent-dark))' }}
          >
            <Activity size={18} className="text-white" />
          </div>
          {!collapsed && (
            <div>
              <div className="text-white font-bold text-base leading-tight tracking-tight">HartMonitor</div>
              <div className="text-blue-300/70 text-[11px] font-medium">Manufacturing Intelligence</div>
            </div>
          )}
        </Link>

        <nav className="flex-1 p-2 overflow-y-auto space-y-4 mt-1">
          {NAV.map(({ group, items }) => {
            const visibleItems = items.filter(item => {
              if (item.minRole && !isAtLeast(item.minRole as any)) return false;
              return true;
            });
            if (visibleItems.length === 0) return null;
            return (
              <div key={group}>
                {!collapsed && (
                  <div className="text-[10px] font-semibold uppercase tracking-widest text-gray-500 px-3 mb-1.5">{group}</div>
                )}
                <div className="space-y-0.5">
                  {visibleItems.map((item) => {
                    const { to, icon: Icon, label, exact, proOnly } = item;
                    const isLocked = proOnly && isFree;
                    return (
                      <NavLink
                        key={to}
                        to={to}
                        end={exact}
                        title={collapsed ? label : undefined}
                        className={({ isActive }) =>
                          `flex items-center rounded-xl text-sm font-medium transition-all ${
                            collapsed ? 'justify-center p-2.5' : 'gap-2.5 px-3 py-2.5'
                          } ${
                            isLocked
                              ? 'text-gray-600 hover:text-gray-500 hover:bg-white/5'
                              : isActive
                                ? 'text-white shadow-sm'
                                : 'text-gray-400 hover:text-white hover:bg-white/8'
                          }`
                        }
                        style={({ isActive }) => (!isLocked && isActive) ? { backgroundColor: 'var(--nav-active)' } : {}}
                      >
                        <Icon size={15} className="flex-shrink-0" />
                        {!collapsed && (
                          <>
                            <span className="flex-1">{label}</span>
                            {isLocked && <ProBadge />}
                          </>
                        )}
                      </NavLink>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </nav>

        <div className="p-2 border-t border-white/10 flex-shrink-0 space-y-0.5">
          {isAtLeast('manager') && (
            <NavLink
              to="/settings"
              title={collapsed ? 'Settings' : undefined}
              className={({ isActive }) =>
                `flex items-center rounded-xl text-sm font-medium text-gray-500 hover:text-white hover:bg-white/8 transition-all ${
                  collapsed ? 'justify-center p-2.5' : 'gap-2.5 px-3 py-2.5'
                } ${isActive ? 'text-white' : ''}`
              }
              style={({ isActive }) => isActive ? { backgroundColor: 'var(--nav-active)' } : {}}
            >
              <Settings size={15} className="flex-shrink-0" />
              {!collapsed && 'Settings'}
            </NavLink>
          )}

          <button
            onClick={() => setCollapsed(c => !c)}
            title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            className={`flex items-center rounded-xl text-sm font-medium text-gray-600 hover:text-white hover:bg-white/8 transition-all w-full ${
              collapsed ? 'justify-center p-2.5' : 'gap-2.5 px-3 py-2.5'
            }`}
          >
            {collapsed ? <ChevronRight size={14} /> : <><ChevronLeft size={14} /> <span>Collapse</span></>}
          </button>

          {/* User section */}
          {!collapsed ? (
            <div className="relative mt-1">
              <button
                onClick={() => setUserMenuOpen(o => !o)}
                className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl hover:bg-white/8 transition-all"
              >
                <div className="w-7 h-7 rounded-full flex items-center justify-center text-white text-xs font-bold flex-shrink-0"
                  style={{ background: 'linear-gradient(135deg, var(--accent), var(--accent-dark))' }}>
                  {user?.display_name?.[0]?.toUpperCase() ?? '?'}
                </div>
                <div className="flex-1 min-w-0 text-left">
                  <div className="text-xs font-medium text-white/90 truncate">{user?.display_name}</div>
                  <div className="text-[10px] text-gray-500 capitalize">{user?.role}</div>
                </div>
                <ChevronDown size={12} className="text-gray-500 flex-shrink-0" />
              </button>
              {userMenuOpen && (
                <div className="absolute bottom-full left-0 right-0 mb-1 bg-white rounded-xl shadow-xl border border-gray-100 overflow-hidden z-50">
                  <div className="px-3 py-2.5 border-b border-gray-100">
                    <div className="text-xs font-semibold text-gray-800 truncate">{user?.display_name}</div>
                    <div className="text-[11px] text-gray-500 truncate">{user?.email}</div>
                  </div>
                  {isAtLeast('manager') && (
                    <NavLink to="/settings" onClick={() => setUserMenuOpen(false)}
                      className="flex items-center gap-2.5 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 transition-colors w-full">
                      <Settings size={14} />Account Settings
                    </NavLink>
                  )}
                  <button onClick={handleLogout}
                    className="flex items-center gap-2.5 px-3 py-2 text-sm text-red-600 hover:bg-red-50 transition-colors w-full">
                    <LogOut size={14} />Sign Out
                  </button>
                </div>
              )}
            </div>
          ) : (
            <button
              onClick={handleLogout}
              title="Sign out"
              className="flex items-center justify-center p-2.5 rounded-xl text-gray-600 hover:text-red-400 hover:bg-white/8 transition-all w-full"
            >
              <LogOut size={15} />
            </button>
          )}
        </div>
      </aside>

      <main className="flex-1 overflow-auto">
        <Outlet />
      </main>
    </div>
  );
}

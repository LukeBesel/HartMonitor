import { useState, useEffect } from 'react';
import { Outlet, NavLink, Link } from 'react-router-dom';
import {
  LayoutDashboard, AppWindow, Database, BarChart3, Monitor,
  Calendar, Settings, Activity, Building2, ClipboardList,
  Tablet, Timer, Users, Cpu, LayoutGrid, ChevronLeft, ChevronRight
} from 'lucide-react';

const NAV = [
  {
    group: 'Operations',
    items: [
      { to: '/', icon: LayoutDashboard, label: 'Dashboard', exact: true },
      { to: '/apps', icon: AppWindow, label: 'App Library' },
      { to: '/schedule', icon: Calendar, label: 'Schedule' },
      { to: '/operator', icon: Tablet, label: 'Operator Portal' },
    ]
  },
  {
    group: 'Monitoring',
    items: [
      { to: '/plant', icon: Building2, label: 'Plant View' },
      { to: '/manager', icon: ClipboardList, label: 'Manager View' },
      { to: '/oee', icon: Cpu, label: 'OEE Tracker' },
      { to: '/stations', icon: Monitor, label: 'Stations' },
    ]
  },
  {
    group: 'Analytics & Reports',
    items: [
      { to: '/dashboards', icon: LayoutGrid, label: 'Dashboards' },
      { to: '/step-metrics', icon: Timer, label: 'Step Metrics' },
      { to: '/capacity', icon: Users, label: 'Capacity Plan' },
      { to: '/analytics', icon: BarChart3, label: 'Analytics' },
      { to: '/tables', icon: Database, label: 'Tables' },
    ]
  },
];

export default function Layout() {
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem('hm_sidebar') === 'collapsed');

  useEffect(() => {
    localStorage.setItem('hm_sidebar', collapsed ? 'collapsed' : 'open');
  }, [collapsed]);

  const sidebarW = collapsed ? 'w-14' : 'w-56';

  return (
    <div className="flex h-screen overflow-hidden bg-slate-50">
      {/* Sidebar */}
      <aside
        className={`${sidebarW} flex-shrink-0 flex flex-col transition-all duration-200`}
        style={{ backgroundColor: 'var(--sidebar-bg)' }}
      >
        {/* Logo */}
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

        {/* Nav */}
        <nav className="flex-1 p-2 overflow-y-auto space-y-4 mt-1">
          {NAV.map(({ group, items }) => (
            <div key={group}>
              {!collapsed && (
                <div className="text-[10px] font-semibold uppercase tracking-widest text-gray-500 px-3 mb-1.5">{group}</div>
              )}
              <div className="space-y-0.5">
                {items.map(({ to, icon: Icon, label, exact }) => (
                  <NavLink
                    key={to}
                    to={to}
                    end={exact}
                    title={collapsed ? label : undefined}
                    className={({ isActive }) =>
                      `flex items-center rounded-xl text-sm font-medium transition-all ${
                        collapsed ? 'justify-center p-2.5' : 'gap-2.5 px-3 py-2.5'
                      } ${
                        isActive
                          ? 'text-white shadow-sm'
                          : 'text-gray-400 hover:text-white hover:bg-white/8'
                      }`
                    }
                    style={({ isActive }) => isActive ? { backgroundColor: 'var(--nav-active)' } : {}}
                  >
                    <Icon size={15} className="flex-shrink-0" />
                    {!collapsed && label}
                  </NavLink>
                ))}
              </div>
            </div>
          ))}
        </nav>

        {/* Footer */}
        <div className="p-2 border-t border-white/10 flex-shrink-0">
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

          {/* Collapse toggle */}
          <button
            onClick={() => setCollapsed(c => !c)}
            title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            className={`mt-0.5 flex items-center rounded-xl text-sm font-medium text-gray-600 hover:text-white hover:bg-white/8 transition-all w-full ${
              collapsed ? 'justify-center p-2.5' : 'gap-2.5 px-3 py-2.5'
            }`}
          >
            {collapsed ? <ChevronRight size={14} /> : <><ChevronLeft size={14} /> <span>Collapse</span></>}
          </button>

          {!collapsed && (
            <div className="mt-2 px-3 py-2.5 rounded-xl bg-white/5">
              <div className="text-[10px] text-gray-500 mb-0.5">Version</div>
              <div className="text-xs text-gray-400 font-medium">HartMonitor v2.0</div>
            </div>
          )}
        </div>
      </aside>

      {/* Main */}
      <main className="flex-1 overflow-auto">
        <Outlet />
      </main>
    </div>
  );
}

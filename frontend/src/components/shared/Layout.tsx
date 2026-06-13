import { useState, useEffect } from 'react';
import { Outlet, NavLink, Link, useNavigate } from 'react-router-dom';
import {
  Settings, Activity, ChevronLeft, ChevronRight,
  LogOut, ChevronDown,
} from 'lucide-react';
import { usePlan } from '../../context/PlanContext';
import { useAuth } from '../../context/AuthContext';
import { useBranding } from '../../context/BrandingContext';
import { useNavPrefs } from '../../context/NavPrefsContext';
import { PINNED_ITEMS, SECTIONS, ALL_WORKSPACE_ICON, NavItem } from '../../config/navigation';
import NotificationBell from './NotificationBell';

function ProBadge() {
  return (
    <span className="ml-auto text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-amber-500/20 text-amber-400 leading-none">
      PRO
    </span>
  );
}

function WorkspacePill({ label, icon: Icon, active, onClick }: {
  label: string; icon: React.ElementType; active: boolean; onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center justify-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-semibold whitespace-nowrap transition-all ${
        active ? 'bg-white/15 text-white shadow-sm' : 'text-gray-400 hover:text-white hover:bg-white/8'
      }`}
    >
      <Icon size={12} className="flex-shrink-0" />
      <span>{label}</span>
    </button>
  );
}

export default function Layout() {
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem('hm_sidebar') === 'collapsed');
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const { isFree } = usePlan();
  const { user, logout, isAtLeast } = useAuth();
  const { companyName, logoUrl } = useBranding();
  const { isItemHidden, isSectionHidden, focus, setFocus } = useNavPrefs();
  const [logoError, setLogoError] = useState(false);
  const navigate = useNavigate();

  // Sections the user has kept enabled in Settings.
  const enabledSections = SECTIONS.filter(s => !isSectionHidden(s.id));
  // The focused workspace falls back to "all" if its section was turned off.
  const effectiveFocus = (focus !== 'all' && enabledSections.some(s => s.id === focus)) ? focus : 'all';
  const visibleSections = effectiveFocus === 'all'
    ? enabledSections
    : enabledSections.filter(s => s.id === effectiveFocus);

  const canShow = (item: NavItem) => {
    if (item.minRole && !isAtLeast(item.minRole as any)) return false;
    if (!item.pinned && isItemHidden(item.to)) return false;
    return true;
  };

  const renderItem = (item: NavItem) => {
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
  };

  useEffect(() => {
    localStorage.setItem('hm_sidebar', collapsed ? 'collapsed' : 'open');
  }, [collapsed]);

  useEffect(() => {
    setLogoError(false);
  }, [logoUrl]);

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
          {logoUrl && !logoError ? (
            <img
              src={logoUrl}
              alt={companyName || 'Company logo'}
              className="w-9 h-9 rounded-xl object-contain flex-shrink-0 bg-white/5"
              onError={() => setLogoError(true)}
            />
          ) : (
            <div
              className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 shadow-lg"
              style={{ background: 'linear-gradient(135deg, var(--accent), var(--secondary))' }}
            >
              <Activity size={18} className="text-white" />
            </div>
          )}
          {!collapsed && (
            <div className="min-w-0">
              <div className="text-white font-bold text-base leading-tight tracking-tight truncate">
                {companyName || 'HartMonitor'}
              </div>
              <div className="text-blue-300/70 text-[11px] font-medium truncate">
                {companyName ? 'Powered by HartMonitor' : 'Manufacturing Intelligence'}
              </div>
            </div>
          )}
        </Link>

        {/* Workspace switcher — focus the sidebar on one area at a time */}
        {!collapsed && enabledSections.length > 1 && (
          <div className="px-2 pt-2.5">
            <div className="flex flex-wrap gap-1 bg-black/20 rounded-xl p-1">
              <WorkspacePill
                label="All"
                icon={ALL_WORKSPACE_ICON}
                active={effectiveFocus === 'all'}
                onClick={() => setFocus('all')}
              />
              {enabledSections.map(s => (
                <WorkspacePill
                  key={s.id}
                  label={s.label}
                  icon={s.icon}
                  active={effectiveFocus === s.id}
                  onClick={() => setFocus(s.id)}
                />
              ))}
            </div>
          </div>
        )}

        <nav className="flex-1 p-2 overflow-y-auto space-y-4 mt-1">
          {/* Pinned items (e.g. Command Center) — always shown */}
          <div className="space-y-0.5">
            {PINNED_ITEMS.filter(canShow).map(renderItem)}
          </div>

          {visibleSections.map(section => {
            const items = section.items.filter(canShow);
            if (items.length === 0) return null;
            return (
              <div key={section.id}>
                {!collapsed && effectiveFocus === 'all' && (
                  <div className="flex items-center gap-1.5 px-3 mb-1.5 text-[10px] font-semibold uppercase tracking-widest text-gray-500">
                    <section.icon size={11} />
                    {section.label}
                  </div>
                )}
                <div className="space-y-0.5">
                  {items.map(renderItem)}
                </div>
              </div>
            );
          })}
        </nav>

        <div className="p-2 border-t border-white/10 flex-shrink-0 space-y-0.5">
          <NotificationBell collapsed={collapsed} />

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
                  style={{ background: 'linear-gradient(135deg, var(--accent), var(--secondary))' }}>
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
                  <NavLink to="/settings" onClick={() => setUserMenuOpen(false)}
                    className="flex items-center gap-2.5 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 transition-colors w-full">
                    <Settings size={14} />Account Settings
                  </NavLink>
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

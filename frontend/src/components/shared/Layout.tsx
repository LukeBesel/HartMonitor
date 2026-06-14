import { useState, useEffect } from 'react';
import { Outlet, NavLink, Link, useNavigate, useLocation } from 'react-router-dom';
import {
  Settings, Activity, ChevronLeft, ChevronRight,
  LogOut, ChevronDown, Menu, X,
} from 'lucide-react';
import { usePlan } from '../../context/PlanContext';
import { useAuth } from '../../context/AuthContext';
import { useBranding } from '../../context/BrandingContext';
import { useNavPrefs } from '../../context/NavPrefsContext';
import { usePermissions } from '../../context/PermissionsContext';
import { PINNED_ITEMS, SECTIONS, ALL_WORKSPACE_ICON, NavItem } from '../../config/navigation';
import NotificationBell from './NotificationBell';
import MessagesBell from './MessagesBell';
import SiteSwitcher from './SiteSwitcher';

function ProBadge() {
  return (
    <span className="ml-auto text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-amber-500/20 text-amber-400 leading-none">
      PRO
    </span>
  );
}

// Tracks whether the viewport is at the desktop (lg) breakpoint, so we can
// fall back to an expanded sidebar layout inside the mobile drawer even when
// the desktop "collapsed" preference is on.
function useIsDesktop() {
  const [isDesktop, setIsDesktop] = useState(() => window.matchMedia('(min-width: 1024px)').matches);
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 1024px)');
    const handler = (e: MediaQueryListEvent) => setIsDesktop(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);
  return isDesktop;
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
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const { isFree } = usePlan();
  const { user, logout } = useAuth();
  const { companyName, logoUrl } = useBranding();
  const { isItemHidden, isSectionHidden, focus, setFocus } = useNavPrefs();
  const { canShowNavItem } = usePermissions();
  const [logoError, setLogoError] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  const isDesktop = useIsDesktop();
  // On mobile the drawer is always shown expanded, regardless of the
  // desktop-only "collapsed" preference.
  const effectiveCollapsed = collapsed && isDesktop;

  // Sections the user has kept enabled in Settings.
  const enabledSections = SECTIONS.filter(s => !isSectionHidden(s.id));
  // The focused workspace falls back to "all" if its section was turned off.
  const effectiveFocus = (focus !== 'all' && enabledSections.some(s => s.id === focus)) ? focus : 'all';
  const visibleSections = effectiveFocus === 'all'
    ? enabledSections
    : enabledSections.filter(s => s.id === effectiveFocus);

  const canShow = (item: NavItem) => {
    if (!canShowNavItem(item)) return false;
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
        title={effectiveCollapsed ? label : undefined}
        className={({ isActive }) =>
          `flex items-center rounded-xl text-sm font-medium transition-all ${
            effectiveCollapsed ? 'justify-center p-2.5' : 'gap-2.5 px-3 py-2.5'
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
        {!effectiveCollapsed && (
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

  // Close the mobile drawer whenever the route changes.
  useEffect(() => {
    setMobileNavOpen(false);
  }, [location.pathname]);

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  const sidebarW = effectiveCollapsed ? 'w-14' : (isDesktop ? 'w-56' : 'w-64');

  return (
    <div className="flex h-screen overflow-hidden bg-slate-50">
      {/* Mobile backdrop — closes the drawer when tapped */}
      {mobileNavOpen && (
        <div
          className="fixed inset-0 bg-black/40 z-30 lg:hidden"
          onClick={() => setMobileNavOpen(false)}
        />
      )}

      <aside
        className={`${sidebarW} fixed inset-y-0 left-0 z-40 flex-shrink-0 flex flex-col transition-all duration-200 lg:static lg:z-auto lg:translate-x-0 ${
          mobileNavOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
        style={{ backgroundColor: 'var(--sidebar-bg)' }}
      >
        {/* Close button for the mobile drawer */}
        <button
          onClick={() => setMobileNavOpen(false)}
          aria-label="Close navigation menu"
          className="lg:hidden absolute top-3 right-3 p-1.5 rounded-lg text-gray-400 hover:text-white hover:bg-white/10 transition-colors z-10"
        >
          <X size={18} />
        </button>

        <Link
          to="/dashboard"
          className={`flex items-center border-b border-white/10 hover:bg-white/5 transition-colors flex-shrink-0 ${effectiveCollapsed ? 'justify-center p-3' : 'gap-3 p-4'}`}
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
          {!effectiveCollapsed && (
            <div className="min-w-0 pr-8 lg:pr-0">
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
        {!effectiveCollapsed && enabledSections.length > 1 && (
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

        {/* Site switcher — only rendered for multi-site orgs */}
        {!effectiveCollapsed && (
          <div className="px-2 pt-2">
            <SiteSwitcher />
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
                {!effectiveCollapsed && effectiveFocus === 'all' && (
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
          <NotificationBell collapsed={effectiveCollapsed} />
          <MessagesBell collapsed={effectiveCollapsed} />

          <NavLink
            to="/settings"
            title={effectiveCollapsed ? 'Settings' : undefined}
            className={({ isActive }) =>
              `flex items-center rounded-xl text-sm font-medium text-gray-500 hover:text-white hover:bg-white/8 transition-all ${
                effectiveCollapsed ? 'justify-center p-2.5' : 'gap-2.5 px-3 py-2.5'
              } ${isActive ? 'text-white' : ''}`
            }
            style={({ isActive }) => isActive ? { backgroundColor: 'var(--nav-active)' } : {}}
          >
            <Settings size={15} className="flex-shrink-0" />
            {!effectiveCollapsed && 'Settings'}
          </NavLink>

          {/* Collapse toggle is a desktop-only concept — the mobile drawer is always expanded */}
          <button
            onClick={() => setCollapsed(c => !c)}
            title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            className={`hidden lg:flex items-center rounded-xl text-sm font-medium text-gray-600 hover:text-white hover:bg-white/8 transition-all w-full ${
              collapsed ? 'justify-center p-2.5' : 'gap-2.5 px-3 py-2.5'
            }`}
          >
            {collapsed ? <ChevronRight size={14} /> : <><ChevronLeft size={14} /> <span>Collapse</span></>}
          </button>

          {/* User section */}
          {!effectiveCollapsed ? (
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

      <div className="flex-1 flex flex-col overflow-hidden min-w-0">
        {/* Mobile header — hamburger to open the drawer, desktop hides this entirely */}
        <header className="lg:hidden flex items-center gap-3 px-4 py-3 border-b border-gray-200 bg-white flex-shrink-0">
          <button
            onClick={() => setMobileNavOpen(true)}
            aria-label="Open navigation menu"
            className="p-1.5 -ml-1.5 rounded-lg text-gray-600 hover:bg-gray-100 transition-colors"
          >
            <Menu size={20} />
          </button>
          {logoUrl && !logoError ? (
            <img
              src={logoUrl}
              alt={companyName || 'Company logo'}
              className="w-7 h-7 rounded-lg object-contain flex-shrink-0 bg-gray-50"
            />
          ) : (
            <div
              className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0"
              style={{ background: 'linear-gradient(135deg, var(--accent), var(--secondary))' }}
            >
              <Activity size={14} className="text-white" />
            </div>
          )}
          <div className="font-bold text-sm text-gray-800 truncate">
            {companyName || 'HartMonitor'}
          </div>
        </header>

        <main className="flex-1 overflow-auto">
          <Outlet />
        </main>
      </div>
    </div>
  );
}

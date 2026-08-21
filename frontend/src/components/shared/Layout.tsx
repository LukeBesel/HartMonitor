import { useState, useEffect } from 'react';
import { Outlet, NavLink, Link, useNavigate, useLocation } from 'react-router-dom';
import {
  Settings, Activity, ChevronLeft, ChevronRight,
  LogOut, ChevronDown, Menu, X, Download,
} from 'lucide-react';
import { usePlan } from '../../context/PlanContext';
import { useAuth } from '../../context/AuthContext';
import { useBranding } from '../../context/BrandingContext';
import { useNavPrefs } from '../../context/NavPrefsContext';
import { usePermissions } from '../../context/PermissionsContext';
import { NavItem, NavSection, useVisibleSections, findSectionForPath } from '../../config/navigation';
import SiteSwitcher from './SiteSwitcher';
import AlertsBell from './AlertsBell';
import RequestHelpButton from './RequestHelpButton';
import UpgradeModal from './UpgradeModal';
import PWAUpdatePrompt from './PWAUpdatePrompt';
import { BillingBanner } from './BillingBanner';
import { SetupChecklist } from './SetupChecklist';

// "Jane Doe" -> "JD", "admin" -> "A". Keeps the avatar chip looking finished.
function initialsOf(name?: string | null): string {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  const first = parts[0][0] ?? '';
  const last = parts.length > 1 ? (parts[parts.length - 1][0] ?? '') : '';
  return (first + last).toUpperCase() || '?';
}

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

export default function Layout() {
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem('hm_sidebar') === 'collapsed');
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  // Set to a feature label when a Free user clicks a locked Pro nav item.
  const [lockedModal, setLockedModal] = useState<string | null>(null);
  // PWA install prompt
  const [installPrompt, setInstallPrompt] = useState<any>(null);
  const { isFree, isEnterprise } = usePlan();
  const { user, logout } = useAuth();
  const { companyName, logoUrl } = useBranding();
  const { isItemHidden, isSectionHidden, itemOrder } = useNavPrefs();
  const { canShowNavItem } = usePermissions();
  const [logoError, setLogoError] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  const isDesktop = useIsDesktop();
  // On mobile the drawer is always shown expanded, regardless of the
  // desktop-only "collapsed" preference.
  const effectiveCollapsed = collapsed && isDesktop;

  // Apply any developer-defined custom ordering to a section's items.
  const orderItems = (sectionId: string, items: NavItem[]): NavItem[] => {
    const order = itemOrder[sectionId];
    if (!order || order.length === 0) return items;
    return [...items].sort((a, b) => {
      const ia = order.indexOf(a.to); const ib = order.indexOf(b.to);
      if (ia === -1 && ib === -1) return 0;
      if (ia === -1) return 1;
      if (ib === -1) return -1;
      return ia - ib;
    });
  };

  // Sections filtered to this company's enabled modules, then to the user's
  // Settings toggles for the sidebar list.
  const moduleSections = useVisibleSections();
  const enabledSections = moduleSections.filter(s => !isSectionHidden(s.id));

  const canShow = (item: NavItem) => {
    if (!canShowNavItem(item)) return false;
    if (!item.pinned && isItemHidden(item.to)) return false;
    // Enterprise-only features are hidden entirely below that tier.
    if (item.enterpriseOnly && !isEnterprise) return false;
    // Pro-only items are always shown — clicking them opens the upgrade modal for free users.
    return true;
  };

  // LEVEL 1/2 focus is derived from the CURRENT ROUTE — never manual state —
  // so deep links always highlight the right workspace and screen tab.
  // Derived from moduleSections (not enabledSections) so a deep link into a
  // workspace the user hid from the sidebar still gets its screen tabs.
  const activeSection = findSectionForPath(location.pathname, moduleSections);

  // The focused workspace's visible screens — rendered as the level-2 tab bar.
  const sectionScreens = (section: NavSection): NavItem[] =>
    orderItems(section.id, section.items).filter(canShow);

  const tabItems = activeSection ? sectionScreens(activeSection) : [];

  // Clicking a workspace in the sidebar navigates to its first visible screen.
  // Prefer a screen that isn't Pro-locked and doesn't leave the shell
  // (standalone kiosk); fall back gracefully, else open the upgrade modal.
  const openSection = (section: NavSection) => {
    const items = sectionScreens(section);
    const target =
      items.find(i => !(i.proOnly && isFree) && !i.standalone)
      ?? items.find(i => !(i.proOnly && isFree));
    setMobileNavOpen(false);
    if (target) navigate(target.to);
    else setLockedModal(section.label);
  };

  // A level-1 sidebar entry: icon + label with the accent bar when the current
  // route lives inside this workspace.
  const renderSection = (section: NavSection) => {
    const items = sectionScreens(section);
    if (items.length === 0) return null;
    const Icon = section.icon;
    const isActive = activeSection?.id === section.id;
    const lockedForFree = isFree && section.proOnly && items.every(i => i.proOnly);
    return (
      <button
        key={section.id}
        onClick={() => openSection(section)}
        title={effectiveCollapsed ? section.label : undefined}
        aria-current={isActive ? 'page' : undefined}
        className={`relative w-full flex items-center rounded-xl text-sm font-medium transition-all ${
          effectiveCollapsed ? 'justify-center p-2.5' : 'gap-2.5 px-3 py-2.5'
        } ${
          isActive
            ? 'text-white bg-white/10'
            : 'text-gray-400 hover:text-white hover:bg-white/8'
        }`}
      >
        {/* Left accent bar marks the active workspace */}
        {isActive && (
          <span
            aria-hidden
            className="absolute left-0 top-1/2 -translate-y-1/2 h-5 w-[3px] rounded-r-full"
            style={{ backgroundColor: 'var(--accent)', boxShadow: '0 0 8px -1px var(--accent)' }}
          />
        )}
        <Icon size={15} className="flex-shrink-0" />
        {!effectiveCollapsed && (
          <>
            <span className="flex-1 text-left">{section.label}</span>
            {lockedForFree && <ProBadge />}
          </>
        )}
      </button>
    );
  };

  // A level-2 tab: underline-style NavLink for the focused workspace's screens.
  // Pro-locked screens open the upgrade modal for Free users, exactly like the
  // sidebar used to.
  const renderTab = (item: NavItem) => {
    const { to, icon: Icon, label, exact, proOnly } = item;
    const isLocked = proOnly && isFree;
    if (isLocked) {
      return (
        <button
          key={to}
          onClick={() => setLockedModal(label)}
          className="flex items-center gap-1.5 whitespace-nowrap px-3 py-2.5 text-[13px] font-medium border-b-2 border-transparent text-gray-400 hover:text-gray-600 transition-colors"
        >
          <Icon size={14} className="flex-shrink-0" />
          {label}
          <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-600 leading-none">PRO</span>
        </button>
      );
    }
    return (
      <NavLink
        key={to}
        to={to}
        end={exact}
        className={({ isActive }) =>
          `flex items-center gap-1.5 whitespace-nowrap px-3 py-2.5 text-[13px] font-medium border-b-2 transition-colors ${
            isActive ? '' : 'border-transparent text-gray-500 hover:text-gray-800'
          }`
        }
        style={({ isActive }) => (isActive ? { borderColor: 'var(--accent)', color: 'var(--accent)' } : undefined)}
      >
        <Icon size={14} className="flex-shrink-0" />
        {label}
      </NavLink>
    );
  };

  useEffect(() => {
    localStorage.setItem('hm_sidebar', collapsed ? 'collapsed' : 'open');
  }, [collapsed]);

  useEffect(() => {
    const handler = (e: Event) => { e.preventDefault(); setInstallPrompt(e); };
    window.addEventListener('beforeinstallprompt', handler);
    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

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
          className="fixed inset-0 bg-black/50 backdrop-blur-sm z-30 lg:hidden animate-fade-in"
          onClick={() => setMobileNavOpen(false)}
        />
      )}

      <aside
        className={`${sidebarW} fixed inset-y-0 left-0 z-40 flex-shrink-0 flex flex-col transition-all duration-300 ease-in-out lg:static lg:z-auto lg:translate-x-0 ${
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

        {/* Company logo/name — always navigates to the Command Center */}
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

        {/* LEVEL 1 — workspace sections only. Screens live in the content
            header's tab bar (level 2). */}
        <nav className="flex-1 p-2 overflow-y-auto mt-1">
          {!effectiveCollapsed && (
            <div className="px-3 mb-1.5 text-[10px] font-semibold uppercase tracking-widest text-gray-500 select-none">
              Workspaces
            </div>
          )}
          <div className="space-y-0.5">
            {enabledSections.map(renderSection)}
          </div>

          {/* The setup checklist scrolls WITH the workspaces rather than sitting
              below them. As a sibling it claimed ~270px of fixed height, which
              pushed three or four workspaces off a 900px screen on a new
              account — the one session where the product most needs to look
              complete. Inside the scroller, navigation always comes first. */}
          {!effectiveCollapsed && <SetupChecklist />}
        </nav>

        <div className="p-2 border-t border-white/10 flex-shrink-0 space-y-0.5">
          {/* Site switcher — the active plant, anchored at the bottom of the bar */}
          {!effectiveCollapsed && (
            <div className="pb-1.5">
              <SiteSwitcher />
            </div>
          )}

          {/* Install App button — shows when browser supports PWA install */}
          {installPrompt && (
            <button
              onClick={async () => {
                installPrompt.prompt();
                const { outcome } = await installPrompt.userChoice;
                if (outcome === 'accepted') setInstallPrompt(null);
              }}
              title="Install HartMonitor as an app"
              className={`flex items-center rounded-xl text-sm font-medium text-gray-400 hover:text-white hover:bg-white/8 transition-all w-full ${
                effectiveCollapsed ? 'justify-center p-2.5' : 'gap-2.5 px-3 py-2.5'
              }`}
            >
              <Download size={14} className="flex-shrink-0" />
              {!effectiveCollapsed && <span>Install App</span>}
            </button>
          )}

          {/* Request help — the same Andon mechanism the player uses, reachable
              from anywhere in the app, next to where the alerts land */}
          <RequestHelpButton collapsed={effectiveCollapsed} />

          {/* Alerts — the floating bubble is gone; the bell is the alerts home */}
          <AlertsBell collapsed={effectiveCollapsed} />

          {/* Collapse toggle is a desktop-only concept — the mobile drawer is always expanded */}
          <button
            onClick={() => setCollapsed(c => !c)}
            title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            className={`hidden lg:flex items-center rounded-xl text-sm font-medium text-gray-400 hover:text-white hover:bg-white/8 transition-all w-full ${
              collapsed ? 'justify-center p-2.5' : 'gap-2.5 px-3 py-2.5'
            }`}
          >
            {collapsed ? <ChevronRight size={14} /> : <><ChevronLeft size={14} /> <span>Collapse</span></>}
          </button>

          {/* User section — clicking avatar opens menu with Settings & Sign Out */}
          {!effectiveCollapsed ? (
            <div className="relative mt-1">
              <button
                onClick={() => setUserMenuOpen(o => !o)}
                className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl hover:bg-white/8 transition-all"
              >
                <div className="w-7 h-7 rounded-full flex items-center justify-center text-white text-[10px] font-bold flex-shrink-0 ring-2 ring-white/10"
                  style={{ background: 'linear-gradient(135deg, var(--accent), var(--secondary))' }}>
                  {initialsOf(user?.display_name)}
                </div>
                <div className="flex-1 min-w-0 text-left">
                  <div className="text-xs font-semibold text-white/90 truncate">{user?.display_name}</div>
                  <div className="text-[10px] text-gray-500 capitalize truncate">{user?.role}</div>
                </div>
                <ChevronDown size={12} className={`text-gray-500 flex-shrink-0 transition-transform ${userMenuOpen ? 'rotate-180' : ''}`} />
              </button>
              {userMenuOpen && (
                <div className="absolute bottom-full left-0 right-0 mb-1.5 popover z-50 animate-slide-up">
                  <div className="px-3 py-2.5 border-b border-gray-100">
                    <div className="text-xs font-semibold text-gray-800 truncate">{user?.display_name}</div>
                    <div className="text-[11px] text-gray-500 truncate">{user?.email}</div>
                  </div>
                  <NavLink to="/settings" onClick={() => setUserMenuOpen(false)}
                    className="flex items-center gap-2.5 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 transition-colors w-full">
                    <Settings size={14} />Settings
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
        <header className="lg:hidden flex items-center gap-3 h-14 px-4 border-b border-gray-200 bg-white/95 backdrop-blur flex-shrink-0">
          <button
            onClick={() => setMobileNavOpen(true)}
            aria-label="Open navigation menu"
            className="p-2.5 -ml-2 rounded-lg text-gray-600 hover:bg-gray-100 active:bg-gray-200 transition-colors"
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

        <BillingBanner />

        {/* LEVEL 2 — the focused workspace's screens as underline tabs. Hidden
            on routes that don't belong to any workspace (e.g. /settings). */}
        {activeSection && tabItems.length > 0 && (
          <div className="bg-white border-b border-gray-200 flex-shrink-0">
            <nav
              aria-label={`${activeSection.label} screens`}
              className="flex items-center gap-1 px-3 sm:px-5 -mb-px overflow-x-auto"
            >
              {tabItems.map(renderTab)}
            </nav>
          </div>
        )}

        <main className="flex-1 overflow-auto">
          <Outlet />
        </main>
      </div>

      {lockedModal && (
        <UpgradeModal
          lockedFeature={lockedModal}
          onClose={() => setLockedModal(null)}
          onPurchased={() => setLockedModal(null)}
        />
      )}

      <PWAUpdatePrompt />
    </div>
  );
}

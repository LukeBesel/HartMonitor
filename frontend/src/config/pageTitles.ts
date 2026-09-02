import { matchPath } from 'react-router-dom';

// Every route's browser-tab title, resolved in one place.
//
// A plant manager works with Schedule, Quality, Maintenance and the Command
// Center open in parallel tabs, so the tab label has to say which screen it is.
// Doing that with a `useEffect` in each of the ~50 page files is how you end up
// with the handful that had one and the four dozen that didn't, so the mapping
// lives here and `<DocumentTitle />` applies it on every navigation.
//
// Two rules:
//   1. A screen is named the way the sidebar names it, so the tab label matches
//      the menu item the reader clicked. `pageTitles.test.ts` checks every nav
//      item against this table.
//   2. Everything carries the same ` — HartMonitor` suffix. The one exception is
//      the marketing home page, which leads with the product name the way a
//      site's front door normally does (and matches its og:title).

export const TITLE_SUFFIX = 'HartMonitor';

/** The marketing home page — the front door, not a screen inside the product. */
export const HOME_TITLE = 'HartMonitor — Manufacturing Execution System';

/** Shown for a URL that matches nothing. Pairs with the NotFound page. */
export const NOT_FOUND_SCREEN = 'Page Not Found';

type Params = Record<string, string | undefined>;

interface TitleRoute {
  /** React Router path pattern, matched with `matchPath`. */
  path: string;
  /** The screen name, or a function of the route params that returns one. */
  screen: string | ((params: Params) => string);
}

/** "production" → "Production". Derived from the URL, never invented. */
function titleCase(segment: string): string {
  return segment
    .split(/[-_]/)
    .filter(Boolean)
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

// Matched top to bottom, first hit wins, so a route with a static segment is
// listed above the parameterised route it would otherwise be swallowed by.
const TITLE_ROUTES: TitleRoute[] = [
  // ── Public marketing + auth ────────────────────────────────────────────────
  { path: '/pricing', screen: 'Pricing' },
  { path: '/terms', screen: 'Terms of Service' },
  { path: '/privacy', screen: 'Privacy Policy' },
  { path: '/login', screen: 'Sign In' },
  { path: '/forgot-password', screen: 'Reset Your Password' },
  { path: '/reset-password', screen: 'Choose a New Password' },
  { path: '/sso/callback', screen: 'Signing In' },

  // ── Full-screen surfaces outside the management shell ──────────────────────
  { path: '/play/:id', screen: 'Operator Player' },
  { path: '/operator', screen: 'Operator Portal' },
  { path: '/departments/:id/tv', screen: 'Department TV' },

  // ── Production ─────────────────────────────────────────────────────────────
  { path: '/dashboard', screen: 'Command Center' },
  { path: '/departments/:id', screen: 'Department' },
  { path: '/andon', screen: 'Andon Board' },
  { path: '/shift-notes', screen: 'Shift Notes' },

  // ── Apps ───────────────────────────────────────────────────────────────────
  // "Dashboard" on its own would read as the Command Center in a tab strip, so
  // this one is qualified with the workspace it lives in.
  { path: '/apps/dashboard', screen: 'Apps Dashboard' },
  { path: '/apps/:id/build', screen: 'App Builder' },
  { path: '/apps/:id/history', screen: 'App History' },
  { path: '/apps/:id/analytics', screen: 'App Analytics' },
  { path: '/apps/:id', screen: 'App Details' },
  { path: '/apps', screen: 'App Library' },

  // ── Quality ────────────────────────────────────────────────────────────────
  { path: '/quality/:id', screen: 'NCR Detail' },
  { path: '/quality', screen: 'NCR / Quality' },
  { path: '/capa', screen: 'CAPA Tracker' },

  // ── Maintenance ────────────────────────────────────────────────────────────
  { path: '/maintenance/:tab', screen: 'CMMS' },
  { path: '/maintenance', screen: 'CMMS' },

  // ── People ─────────────────────────────────────────────────────────────────
  { path: '/training/:tab', screen: 'Training' },
  { path: '/training', screen: 'Training' },

  // ── Planning ───────────────────────────────────────────────────────────────
  { path: '/schedule', screen: 'Schedule' },
  { path: '/routings', screen: 'Routings' },
  { path: '/capacity', screen: 'Capacity Plan' },
  { path: '/stations/:id', screen: 'Station' },
  { path: '/stations', screen: 'Stations' },
  { path: '/completions/:id', screen: 'Run Record' },

  // ── Inventory ──────────────────────────────────────────────────────────────
  { path: '/inventory/boms', screen: 'BOMs' },
  { path: '/inventory/kitting/:kitId', screen: 'Kitting' },
  { path: '/inventory/kitting', screen: 'Kitting' },
  { path: '/inventory/:id', screen: 'Inventory Tracker' },
  { path: '/inventory', screen: 'Inventory Tracker' },
  { path: '/receiving', screen: 'Receiving' },
  { path: '/requirements', screen: 'Materials Required' },
  { path: '/shipments', screen: 'Shipments' },
  { path: '/purchasing/:tab', screen: 'Purchasing' },
  { path: '/purchasing', screen: 'Purchasing' },

  // ── Kaizen / CI ────────────────────────────────────────────────────────────
  { path: '/kaizen', screen: 'Kaizen / CI Ideas' },
  { path: '/ci-projects/:id', screen: 'CI Projects' },
  { path: '/ci-projects', screen: 'CI Projects' },

  // ── Reporting ──────────────────────────────────────────────────────────────
  // Six sidebar items all read "Reports" under their own workspace; flattened
  // into a tab label they need the workspace back, taken from the URL.
  { path: '/reports/:category/:mode', screen: p => `${titleCase(p.category || '')} Reports`.trim() },
  { path: '/reports/:category', screen: p => `${titleCase(p.category || '')} Reports`.trim() },
  { path: '/dashboards/:id/:mode', screen: 'Dashboard' },
  { path: '/dashboards/:id', screen: 'Dashboard' },
  { path: '/dashboards', screen: 'Dashboards' },
  { path: '/tables/:id', screen: 'Table' },
  { path: '/tables', screen: 'Tables' },
  { path: '/leaderboard', screen: 'Leaderboard' },
  { path: '/oee', screen: 'OEE Tracker' },
  { path: '/analytics', screen: 'Operation Analytics' },
  { path: '/facilities', screen: 'Facilities' },
  { path: '/audit-log', screen: 'Audit Log' },
  { path: '/admin', screen: 'Admin Dashboard' },

  { path: '/settings', screen: 'Settings' },

  // ── Retired routes that redirect ───────────────────────────────────────────
  // They are listed with their destination's title purely so the tab doesn't
  // blink "Page Not Found" during the redirect. Four of them are the screens
  // that used to answer "what is the floor doing right now" alongside the
  // Command Center, plus the log that carried a second name.
  { path: '/sqdc', screen: 'Command Center' },
  { path: '/plant', screen: 'Command Center' },
  { path: '/manager', screen: 'Command Center' },
  { path: '/departments', screen: 'Command Center' },
  { path: '/leaderboard/tv', screen: 'Leaderboard' },
  { path: '/transaction-log', screen: 'Audit Log' },
  { path: '/step-metrics', screen: 'Operation Analytics' },
];

/** The screen name for a path, without the brand suffix. */
export function resolveScreenName(pathname: string): string {
  for (const route of TITLE_ROUTES) {
    const match = matchPath({ path: route.path, end: true }, pathname);
    if (match) {
      return typeof route.screen === 'function' ? route.screen(match.params) : route.screen;
    }
  }
  return NOT_FOUND_SCREEN;
}

/** The full `document.title` for a path. */
export function resolvePageTitle(pathname: string): string {
  if (pathname === '/') return HOME_TITLE;
  return `${resolveScreenName(pathname)} — ${TITLE_SUFFIX}`;
}

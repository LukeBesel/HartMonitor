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
  // One screen per app: its runs, its operators and its step times are tabs on
  // /apps/:id, so there is one title for all of them.
  { path: '/apps/:id/build', screen: 'App Builder' },
  // Retired, and redirecting: /apps/dashboard → /apps, and the two per-app
  // screens → their tab on /apps/:id. Listed above the parameterised route so
  // the static segment is not swallowed by it, and titled with where they land
  // so the tab does not blink "Page Not Found" mid-redirect.
  { path: '/apps/dashboard', screen: 'App Library' },
  { path: '/apps/:id/history', screen: 'App Details' },
  { path: '/apps/:id/analytics', screen: 'App Details' },
  { path: '/apps/:id', screen: 'App Details' },
  { path: '/apps', screen: 'App Library' },

  // ── Quality ────────────────────────────────────────────────────────────────
  { path: '/quality/:id', screen: 'NCR Detail' },
  { path: '/quality', screen: 'NCR / Quality' },
  { path: '/capa', screen: 'CAPA Tracker' },

  // ── Maintenance ────────────────────────────────────────────────────────────
  // "Maintenance" on the menu, in the tab and on the page — never the acronym
  // the industry's software uses, which is not a word a plant manager asked for.
  { path: '/maintenance/:tab', screen: 'Maintenance' },
  { path: '/maintenance', screen: 'Maintenance' },

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

  // ── Materials ──────────────────────────────────────────────────────────────
  // One screen, one title. Seven screens' worth of URLs still route here — each
  // opens its own tab — but which tab is a `?tab=` query, and this table sees
  // only the path, so naming them apart here would be guessing. The tab row on
  // screen says which one is open.
  //
  // The receiving KIOSK is the exception: it is a separate full-screen surface
  // on /receiving, not the Receiving tab, and keeps its own name.
  { path: '/inventory/boms', screen: 'Materials' },
  { path: '/inventory/kitting/:kitId', screen: 'Materials' },
  { path: '/inventory/kitting', screen: 'Materials' },
  { path: '/inventory/:id', screen: 'Materials' },
  { path: '/inventory', screen: 'Materials' },
  { path: '/receiving', screen: 'Receiving' },
  { path: '/requirements', screen: 'Materials' },
  { path: '/shipments', screen: 'Materials' },
  { path: '/purchasing/:view', screen: 'Materials' },
  { path: '/purchasing', screen: 'Materials' },

  // ── Kaizen / CI ────────────────────────────────────────────────────────────
  { path: '/kaizen', screen: 'Kaizen / CI Ideas' },
  { path: '/ci-projects/:id', screen: 'CI Projects' },
  { path: '/ci-projects', screen: 'CI Projects' },

  // ── Reporting ──────────────────────────────────────────────────────────────
  // Six sidebar items all read "Reports" under their own workspace; flattened
  // into a tab label they need the workspace back, taken from the URL.
  { path: '/reports/:category/:mode', screen: p => `${titleCase(p.category || '')} Reports`.trim() },
  { path: '/reports/:category', screen: p => `${titleCase(p.category || '')} Reports`.trim() },
  // A saved custom report is a REPORT; /dashboards is the one place to build
  // and read one. "Dashboard" names exactly one screen in this product — the
  // Command Center at /dashboard — and nothing else.
  { path: '/dashboards/:id/:mode', screen: 'Report' },
  { path: '/dashboards/:id', screen: 'Report' },
  { path: '/dashboards', screen: 'Report Builder' },
  { path: '/tables/:id', screen: 'Table' },
  { path: '/tables', screen: 'Tables' },
  { path: '/leaderboard', screen: 'Leaderboard' },
  { path: '/analytics', screen: 'App comparison' },
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
  { path: '/step-metrics', screen: 'App comparison' },
  // OEE is a tab on App comparison now, not a screen of its own.
  { path: '/oee', screen: 'App comparison' },
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

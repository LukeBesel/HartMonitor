import { lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useLocation, useParams } from 'react-router-dom';
import Layout from './components/shared/Layout';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import { ThemeProvider } from './context/ThemeContext';
import { PlanProvider } from './context/PlanContext';
import { ModulesProvider, useModules } from './context/ModulesContext';
import { AuthProvider, useAuth } from './context/AuthContext';
import { BrandingProvider } from './context/BrandingContext';
import { NavPrefsProvider } from './context/NavPrefsContext';
import { SiteProvider } from './context/SiteContext';
import { PermissionsProvider } from './context/PermissionsContext';
import { MessagesProvider } from './context/MessagesContext';
import { ToastProvider } from './context/ToastContext';
import { ErrorBoundary } from './components/shared/ErrorBoundary';
import MessageToast from './components/shared/MessageToast';
import FirstRunLanding from './components/apps/FirstRunLanding';
import AppTrainingCoach from './components/apps/AppTrainingCoach';
import AppLoading from './components/shared/AppLoading';
import DocumentTitle from './components/shared/DocumentTitle';

// Code-split the rest of the pages so the initial load only ships the shell,
// login, and landing dashboard. Heavy chart pages load on demand.
const AppsLibrary      = lazy(() => import('./pages/AppsLibrary'));
const AppDetail        = lazy(() => import('./pages/AppDetail'));
const AppBuilder       = lazy(() => import('./pages/AppBuilder'));
const AppPlayer        = lazy(() => import('./pages/AppPlayer'));
const Tables           = lazy(() => import('./pages/Tables'));
const TableDetail      = lazy(() => import('./pages/TableDetail'));
const Analytics        = lazy(() => import('./pages/Analytics'));
const Stations         = lazy(() => import('./pages/Stations'));
const Schedule         = lazy(() => import('./pages/Schedule'));
const DepartmentView   = lazy(() => import('./pages/DepartmentView'));
const DepartmentTV     = lazy(() => import('./pages/DepartmentTV'));
const StationView      = lazy(() => import('./pages/StationView'));
const CompletionDetail = lazy(() => import('./pages/CompletionDetail'));
const CapacityPlanning = lazy(() => import('./pages/CapacityPlanning'));
const OperatorPortal   = lazy(() => import('./pages/OperatorPortal'));
const SettingsPage     = lazy(() => import('./pages/Settings'));
const Dashboards       = lazy(() => import('./pages/Dashboards'));
const DashboardView    = lazy(() => import('./pages/DashboardView'));
const CategoryReports  = lazy(() => import('./pages/CategoryReports'));
const Inventory        = lazy(() => import('./pages/Inventory'));
const Purchasing       = lazy(() => import('./pages/Purchasing'));
const Quality          = lazy(() => import('./pages/Quality'));
const Leaderboard      = lazy(() => import('./pages/Leaderboard'));
const Landing          = lazy(() => import('./pages/Landing'));
const Pricing          = lazy(() => import('./pages/Pricing'));
const Terms            = lazy(() => import('./pages/Terms'));
const Privacy          = lazy(() => import('./pages/Privacy'));
const SSOCallback      = lazy(() => import('./pages/SSOCallback'));
const ForgotPassword   = lazy(() => import('./pages/ForgotPassword'));
const ResetPassword    = lazy(() => import('./pages/ResetPassword'));
const AuditLog         = lazy(() => import('./pages/AuditLog'));
const Facilities       = lazy(() => import('./pages/Facilities'));
const Routings             = lazy(() => import('./pages/Routings'));
const ReceivingPortal      = lazy(() => import('./pages/ReceivingPortal'));
const ShipmentTracker      = lazy(() => import('./pages/ShipmentTracker'));
const InventoryRequirements = lazy(() => import('./pages/InventoryRequirements'));
const BOMs                 = lazy(() => import('./pages/BOMs'));
const Kitting              = lazy(() => import('./pages/Kitting'));
const Training             = lazy(() => import('./pages/Training'));
const Andon                = lazy(() => import('./pages/Andon'));
const CAPA                 = lazy(() => import('./pages/CAPA'));
const Maintenance          = lazy(() => import('./pages/Maintenance'));
const ShiftNotes           = lazy(() => import('./pages/ShiftNotes'));
const Kaizen               = lazy(() => import('./pages/Kaizen'));
const CIProjects           = lazy(() => import('./pages/CIProjects'));
const Admin                = lazy(() => import('./pages/Admin'));
const NotFound             = lazy(() => import('./pages/NotFound'));

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return <AppLoading />;
  if (!user) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

// The management/report portal. Operators are shop-floor only — bounce them to
// the Operator Portal instead of analytics, settings, etc.
function ReportPortalRoute({ children }: { children: React.ReactNode }) {
  const { user, loading, canAccessReportPortal } = useAuth();
  if (loading) return <AppLoading />;
  if (!user) return <Navigate to="/login" replace />;
  if (!canAccessReportPortal) return <Navigate to="/operator" replace />;
  return <>{children}</>;
}

/** Sends a retired per-app URL to the tab that replaced it, KEEPING the query
 *  string it arrived with. /apps/:id/analytics?days=7&operator=Sam was a real
 *  link the old Apps Dashboard handed out, and the one per-app screen reads
 *  those same four parameters — so the slice survives the redirect instead of
 *  being reset to a default nobody asked for. */
function AppTabRedirect({ tab }: { tab: string }) {
  const { id } = useParams<{ id: string }>();
  const { search } = useLocation();
  const params = new URLSearchParams(search);
  params.set('tab', tab);
  return <Navigate to={`/apps/${id}?${params.toString()}`} replace />;
}

// Composable MES: hides routes belonging to a module the company has switched
// off. Visiting a disabled module's URL bounces to the Command Center.
function ModuleGate({ module, children }: { module: string; children: React.ReactNode }) {
  const { isEnabled, loading } = useModules();
  if (loading) return <AppLoading />;
  if (!isEnabled(module)) return <Navigate to="/dashboard" replace />;
  return <>{children}</>;
}

// The Operator Portal. Open to every role except view-only viewers.
function OperatorRoute({ children }: { children: React.ReactNode }) {
  const { user, loading, canAccessOperatorPortal } = useAuth();
  if (loading) return <AppLoading />;
  if (!user) return <Navigate to="/login" replace />;
  if (!canAccessOperatorPortal) return <Navigate to="/dashboard" replace />;
  return <>{children}</>;
}

/** Every route in the app. Split out of <App/> so it can read the location:
 *  `/leaderboard?tv=1` is mounted outside the management shell (a wall board
 *  has no sidebar), and which of the two declarations exists is decided here,
 *  once, per navigation. */
function AppRoutes() {
  const location = useLocation();
  const tvLeaderboard = location.pathname === '/leaderboard'
    && new URLSearchParams(location.search).get('tv') === '1';

  return (
    <Routes>
      {/* Public marketing site */}
      <Route path="/" element={<Landing />} />
      <Route path="/pricing" element={<Pricing />} />
      <Route path="/terms" element={<Terms />} />
      <Route path="/privacy" element={<Privacy />} />

      <Route path="/login" element={<Login />} />
      <Route path="/forgot-password" element={<ForgotPassword />} />
      <Route path="/reset-password" element={<ResetPassword />} />
      <Route path="/sso/callback" element={<SSOCallback />} />
      <Route path="/play/:id" element={<OperatorRoute><AppPlayer /></OperatorRoute>} />
      <Route path="/operator" element={<OperatorRoute><OperatorPortal /></OperatorRoute>} />
      <Route path="/departments/:id/tv" element={<ProtectedRoute><DepartmentTV /></ProtectedRoute>} />
      {/* The leaderboard's wall board is the leaderboard with ?tv=1 —
          one page, one set of numbers — and a board hangs on a wall
          with no sidebar beside it, so on that one query it is mounted
          HERE, outside the management shell, instead of inside it. The
          two declarations are mutually exclusive by construction: when
          tv=1 the shell's copy below is not declared at all, so the
          router never has to break a tie between them. */}
      {tvLeaderboard && (
        <Route path="/leaderboard" element={<ProtectedRoute><Leaderboard /></ProtectedRoute>} />
      )}
      {/* Retired boards, kept as redirects so a bookmark or a wall
          browser pointed at the old URL still lands somewhere real. */}
      <Route path="/leaderboard/tv" element={<Navigate to="/leaderboard?tv=1" replace />} />

      {/* Management / report portal — operators are redirected to the floor */}
      <Route element={<ReportPortalRoute><Layout /></ReportPortalRoute>}>
        {/* New accounts land on Apps instead of an empty Command Center
            — see FirstRunLanding for the (one question, once per tab) rule. */}
        <Route path="/dashboard" element={<FirstRunLanding><Dashboard /></FirstRunLanding>} />
        <Route path="/apps" element={<ModuleGate module="apps"><AppsLibrary /></ModuleGate>} />
        {/* One screen per app. Run history, app analytics and the Apps
            Dashboard were three more screens reporting the same app's cycle
            time under three labels behind three filter bars; they are tabs on
            /apps/:id now, and their URLs redirect onto the right tab. The
            static segment is declared first for readers; the router ranks it
            above the param either way. */}
        <Route path="/apps/dashboard" element={<Navigate to="/apps" replace />} />
        <Route path="/apps/:id" element={<ModuleGate module="apps"><AppDetail /></ModuleGate>} />
        <Route path="/apps/:id/build" element={<ModuleGate module="apps"><AppBuilder /></ModuleGate>} />
        <Route path="/apps/:id/history" element={<AppTabRedirect tab="runs" />} />
        <Route path="/apps/:id/analytics" element={<AppTabRedirect tab="overview" />} />
        <Route path="/tables" element={<ModuleGate module="apps"><Tables /></ModuleGate>} />
        <Route path="/tables/:id" element={<ModuleGate module="apps"><TableDetail /></ModuleGate>} />
        <Route path="/analytics" element={<Analytics />} />
        {/* SQDC is shelved for now — route redirects until it returns */}
        <Route path="/sqdc" element={<Navigate to="/dashboard" replace />} />
        <Route path="/stations" element={<Stations />} />
        <Route path="/stations/:id" element={<StationView />} />
        <Route path="/schedule" element={<Schedule />} />
        <Route path="/routings" element={<Routings />} />
        <Route path="/plant" element={<Navigate to="/dashboard" replace />} />
        {/* One live-floor screen. The Command Center answers "what is
            the floor doing right now" for the whole plant and narrows
            to a department on request, so the two screens that used to
            answer it differently at the same minute are redirects into
            it. A department still has its own page and wall board —
            reached from the cards on the Command Center. */}
        <Route path="/departments" element={<Navigate to="/dashboard" replace />} />
        <Route path="/manager" element={<Navigate to="/dashboard" replace />} />
        <Route path="/departments/:id" element={<DepartmentView />} />
        {/* Step metrics live inside Operation Analytics — the old
            standalone page had no link into it from anywhere. */}
        <Route path="/step-metrics" element={<Navigate to="/analytics" replace />} />
        <Route path="/capacity" element={<CapacityPlanning />} />
        <Route path="/completions/:id" element={<CompletionDetail />} />
        {/* OEE is a tab on the app-comparison screen. A single-site shop
            never needed a top-level menu item for it, and the per-station
            card on a station's own page is still the drill-down. */}
        <Route path="/oee" element={<Navigate to="/analytics?tab=oee" replace />} />
        <Route path="/dashboards" element={<ModuleGate module="apps"><Dashboards /></ModuleGate>} />
        <Route path="/dashboards/:id" element={<ModuleGate module="apps"><DashboardView /></ModuleGate>} />
        <Route path="/dashboards/:id/:mode" element={<ModuleGate module="apps"><DashboardView /></ModuleGate>} />
        <Route path="/reports/:category" element={<CategoryReports />} />
        {/* Edit mode stays on the workspace route (DashboardView reads :mode). */}
        <Route path="/reports/:category/:mode" element={<CategoryReports />} />
        <Route path="/inventory" element={<ModuleGate module="inventory"><Inventory /></ModuleGate>} />
        <Route path="/inventory/boms" element={<ModuleGate module="inventory"><BOMs /></ModuleGate>} />
        <Route path="/inventory/kitting" element={<ModuleGate module="inventory"><Kitting /></ModuleGate>} />
        <Route path="/inventory/kitting/:kitId" element={<ModuleGate module="inventory"><Kitting /></ModuleGate>} />
        <Route path="/inventory/:id" element={<ModuleGate module="inventory"><Inventory /></ModuleGate>} />
        <Route path="/receiving" element={<ModuleGate module="inventory"><ReceivingPortal /></ModuleGate>} />
        <Route path="/requirements" element={<ModuleGate module="inventory"><InventoryRequirements /></ModuleGate>} />
        <Route path="/shipments" element={<ModuleGate module="inventory"><ShipmentTracker /></ModuleGate>} />
        <Route path="/purchasing" element={<ModuleGate module="inventory"><Purchasing /></ModuleGate>} />
        <Route path="/purchasing/:tab" element={<ModuleGate module="inventory"><Purchasing /></ModuleGate>} />
        <Route path="/quality" element={<ModuleGate module="quality"><Quality /></ModuleGate>} />
        <Route path="/quality/:id" element={<ModuleGate module="quality"><Quality /></ModuleGate>} />
        <Route path="/training" element={<ModuleGate module="training"><Training /></ModuleGate>} />
        <Route path="/training/:tab" element={<ModuleGate module="training"><Training /></ModuleGate>} />
        {!tvLeaderboard && <Route path="/leaderboard" element={<Leaderboard />} />}
        <Route path="/facilities" element={<Facilities />} />
        <Route path="/audit-log" element={<AuditLog />} />
        {/* One log, one name. This route was a second lazy import of
            the same page under a different heading. */}
        <Route path="/transaction-log" element={<Navigate to="/audit-log" replace />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="/andon" element={<ModuleGate module="andon"><Andon /></ModuleGate>} />
        <Route path="/capa" element={<ModuleGate module="quality"><CAPA /></ModuleGate>} />
        <Route path="/maintenance" element={<ModuleGate module="maintenance"><Maintenance /></ModuleGate>} />
        <Route path="/maintenance/:tab" element={<ModuleGate module="maintenance"><Maintenance /></ModuleGate>} />
        <Route path="/shift-notes" element={<ModuleGate module="shifts"><ShiftNotes /></ModuleGate>} />
        <Route path="/kaizen" element={<ModuleGate module="kaizen"><Kaizen /></ModuleGate>} />
        <Route path="/ci-projects" element={<ModuleGate module="kaizen"><CIProjects /></ModuleGate>} />
        <Route path="/ci-projects/:id" element={<ModuleGate module="kaizen"><CIProjects /></ModuleGate>} />
        <Route path="/admin" element={<Admin />} />
        {/* A URL that matches nothing says so, instead of quietly
            landing people on the Command Center as though their stale
            bookmark had worked. Still inside the auth guard above, so a
            signed-out visitor gets the login screen, not a 404. */}
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <ThemeProvider>
        <BrandingProvider>
        <PlanProvider>
        <ModulesProvider>
        <SiteProvider>
        <PermissionsProvider>
        <NavPrefsProvider>
        <MessagesProvider>
        <ToastProvider>
          <BrowserRouter>
            <DocumentTitle />
            <MessageToast />
            {/* Builder-first guided training. Self-gating: it only shows on the
                apps surfaces, for people who can build, until it is finished
                or dismissed. */}
            <AppTrainingCoach />
            <Suspense fallback={<AppLoading />}>
            <ErrorBoundary>
              <AppRoutes />
            </ErrorBoundary>
            </Suspense>
          </BrowserRouter>
        </ToastProvider>
        </MessagesProvider>
        </NavPrefsProvider>
        </PermissionsProvider>
        </SiteProvider>
        </ModulesProvider>
        </PlanProvider>
        </BrandingProvider>
      </ThemeProvider>
    </AuthProvider>
  );
}

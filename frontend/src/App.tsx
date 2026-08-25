import { lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
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
const AppsDashboard    = lazy(() => import('./pages/AppsDashboard'));
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
const Departments      = lazy(() => import('./pages/Departments'));
const StationView      = lazy(() => import('./pages/StationView'));
const ManagerView      = lazy(() => import('./pages/ManagerView'));
const CompletionDetail = lazy(() => import('./pages/CompletionDetail'));
const AppHistory       = lazy(() => import('./pages/AppHistory'));
const AppAnalytics     = lazy(() => import('./pages/AppAnalytics'));
const CapacityPlanning = lazy(() => import('./pages/CapacityPlanning'));
const OperatorPortal   = lazy(() => import('./pages/OperatorPortal'));
const SettingsPage     = lazy(() => import('./pages/Settings'));
const OEETracker       = lazy(() => import('./pages/OEETracker'));
const Dashboards       = lazy(() => import('./pages/Dashboards'));
const DashboardView    = lazy(() => import('./pages/DashboardView'));
const CategoryReports  = lazy(() => import('./pages/CategoryReports'));
const Inventory        = lazy(() => import('./pages/Inventory'));
const Purchasing       = lazy(() => import('./pages/Purchasing'));
const Quality          = lazy(() => import('./pages/Quality'));
const Leaderboard      = lazy(() => import('./pages/Leaderboard'));
const LeaderboardTV    = lazy(() => import('./pages/LeaderboardTV'));
const Landing          = lazy(() => import('./pages/Landing'));
const Pricing          = lazy(() => import('./pages/Pricing'));
const Terms            = lazy(() => import('./pages/Terms'));
const Privacy          = lazy(() => import('./pages/Privacy'));
const SSOCallback      = lazy(() => import('./pages/SSOCallback'));
const ForgotPassword   = lazy(() => import('./pages/ForgotPassword'));
const ResetPassword    = lazy(() => import('./pages/ResetPassword'));
const AuditLog         = lazy(() => import('./pages/AuditLog'));
const TransactionLog   = lazy(() => import('./pages/AuditLog'));
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
              <Route path="/leaderboard/tv" element={<ProtectedRoute><LeaderboardTV /></ProtectedRoute>} />

              {/* Management / report portal — operators are redirected to the floor */}
              <Route element={<ReportPortalRoute><Layout /></ReportPortalRoute>}>
                {/* New accounts land on Apps instead of an empty Command Center
                    — see FirstRunLanding for the (one question, once per tab) rule. */}
                <Route path="/dashboard" element={<FirstRunLanding><Dashboard /></FirstRunLanding>} />
                <Route path="/apps" element={<ModuleGate module="apps"><AppsLibrary /></ModuleGate>} />
                {/* Static segment, so it must out-rank /apps/:id — declared first
                    for readers; the router ranks it above the param either way. */}
                <Route path="/apps/dashboard" element={<ModuleGate module="apps"><AppsDashboard /></ModuleGate>} />
                <Route path="/apps/:id" element={<ModuleGate module="apps"><AppDetail /></ModuleGate>} />
                <Route path="/apps/:id/build" element={<ModuleGate module="apps"><AppBuilder /></ModuleGate>} />
                <Route path="/apps/:id/history" element={<ModuleGate module="apps"><AppHistory /></ModuleGate>} />
                <Route path="/apps/:id/analytics" element={<ModuleGate module="apps"><AppAnalytics /></ModuleGate>} />
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
                <Route path="/departments" element={<Departments />} />
                <Route path="/departments/:id" element={<DepartmentView />} />
                <Route path="/manager" element={<ManagerView />} />
                {/* Step metrics live inside Operation Analytics — the old
                    standalone page had no link into it from anywhere. */}
                <Route path="/step-metrics" element={<Navigate to="/analytics" replace />} />
                <Route path="/capacity" element={<CapacityPlanning />} />
                <Route path="/completions/:id" element={<CompletionDetail />} />
                <Route path="/oee" element={<OEETracker />} />
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
                <Route path="/leaderboard" element={<Leaderboard />} />
                <Route path="/facilities" element={<Facilities />} />
                <Route path="/audit-log" element={<AuditLog />} />
                <Route path="/transaction-log" element={<TransactionLog />} />
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

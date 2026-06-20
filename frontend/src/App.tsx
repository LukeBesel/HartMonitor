import { lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import Layout from './components/shared/Layout';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import { ThemeProvider } from './context/ThemeContext';
import { PlanProvider } from './context/PlanContext';
import { AuthProvider, useAuth } from './context/AuthContext';
import { BrandingProvider } from './context/BrandingContext';
import { NavPrefsProvider } from './context/NavPrefsContext';
import { SiteProvider } from './context/SiteContext';
import { PermissionsProvider } from './context/PermissionsContext';
import { MessagesProvider } from './context/MessagesContext';
import { ToastProvider } from './context/ToastContext';
import { ErrorBoundary } from './components/shared/ErrorBoundary';
import MessageToast from './components/shared/MessageToast';

// Code-split the rest of the pages so the initial load only ships the shell,
// login, and landing dashboard. Heavy chart pages load on demand.
const AppsLibrary      = lazy(() => import('./pages/AppsLibrary'));
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
const SQDC             = lazy(() => import('./pages/SQDC'));
const StationView      = lazy(() => import('./pages/StationView'));
const ManagerView      = lazy(() => import('./pages/ManagerView'));
const CompletionDetail = lazy(() => import('./pages/CompletionDetail'));
const AppHistory       = lazy(() => import('./pages/AppHistory'));
const StepMetrics      = lazy(() => import('./pages/StepMetrics'));
const CapacityPlanning = lazy(() => import('./pages/CapacityPlanning'));
const OperatorPortal   = lazy(() => import('./pages/OperatorPortal'));
const SettingsPage     = lazy(() => import('./pages/Settings'));
const OEETracker       = lazy(() => import('./pages/OEETracker'));
const Dashboards       = lazy(() => import('./pages/Dashboards'));
const DashboardView    = lazy(() => import('./pages/DashboardView'));
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
const Training             = lazy(() => import('./pages/Training'));
const Andon                = lazy(() => import('./pages/Andon'));
const CAPA                 = lazy(() => import('./pages/CAPA'));
const Maintenance          = lazy(() => import('./pages/Maintenance'));
const ShiftNotes           = lazy(() => import('./pages/ShiftNotes'));
const Kaizen               = lazy(() => import('./pages/Kaizen'));

function Spinner() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" />
    </div>
  );
}

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return <Spinner />;
  if (!user) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

// The management/report portal. Operators are shop-floor only — bounce them to
// the Operator Portal instead of analytics, settings, etc.
function ReportPortalRoute({ children }: { children: React.ReactNode }) {
  const { user, loading, canAccessReportPortal } = useAuth();
  if (loading) return <Spinner />;
  if (!user) return <Navigate to="/login" replace />;
  if (!canAccessReportPortal) return <Navigate to="/operator" replace />;
  return <>{children}</>;
}

// The Operator Portal. Open to every role except view-only viewers.
function OperatorRoute({ children }: { children: React.ReactNode }) {
  const { user, loading, canAccessOperatorPortal } = useAuth();
  if (loading) return <Spinner />;
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
        <SiteProvider>
        <PermissionsProvider>
        <NavPrefsProvider>
        <MessagesProvider>
        <ToastProvider>
          <BrowserRouter>
            <MessageToast />
            <Suspense fallback={<Spinner />}>
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
                <Route path="/dashboard" element={<Dashboard />} />
                <Route path="/apps" element={<AppsLibrary />} />
                <Route path="/apps/:id/build" element={<AppBuilder />} />
                <Route path="/apps/:id/history" element={<AppHistory />} />
                <Route path="/tables" element={<Tables />} />
                <Route path="/tables/:id" element={<TableDetail />} />
                <Route path="/analytics" element={<Analytics />} />
                <Route path="/sqdc" element={<SQDC />} />
                <Route path="/stations" element={<Stations />} />
                <Route path="/stations/:id" element={<StationView />} />
                <Route path="/schedule" element={<Schedule />} />
                <Route path="/routings" element={<Routings />} />
                <Route path="/plant" element={<Navigate to="/dashboard" replace />} />
                <Route path="/departments" element={<Departments />} />
                <Route path="/departments/:id" element={<DepartmentView />} />
                <Route path="/manager" element={<ManagerView />} />
                <Route path="/step-metrics" element={<StepMetrics />} />
                <Route path="/capacity" element={<CapacityPlanning />} />
                <Route path="/completions/:id" element={<CompletionDetail />} />
                <Route path="/oee" element={<OEETracker />} />
                <Route path="/dashboards" element={<Dashboards />} />
                <Route path="/dashboards/:id" element={<DashboardView />} />
                <Route path="/dashboards/:id/:mode" element={<DashboardView />} />
                <Route path="/inventory" element={<Inventory />} />
                <Route path="/inventory/:id" element={<Inventory />} />
                <Route path="/receiving" element={<ReceivingPortal />} />
                <Route path="/requirements" element={<InventoryRequirements />} />
                <Route path="/shipments" element={<ShipmentTracker />} />
                <Route path="/purchasing" element={<Purchasing />} />
                <Route path="/purchasing/:tab" element={<Purchasing />} />
                <Route path="/quality" element={<Quality />} />
                <Route path="/quality/:id" element={<Quality />} />
                <Route path="/training" element={<Training />} />
                <Route path="/training/:tab" element={<Training />} />
                <Route path="/leaderboard" element={<Leaderboard />} />
                <Route path="/facilities" element={<Facilities />} />
                <Route path="/audit-log" element={<AuditLog />} />
                <Route path="/transaction-log" element={<TransactionLog />} />
                <Route path="/settings" element={<SettingsPage />} />
                <Route path="/andon" element={<Andon />} />
                <Route path="/capa" element={<CAPA />} />
                <Route path="/maintenance" element={<Maintenance />} />
                <Route path="/maintenance/:tab" element={<Maintenance />} />
                <Route path="/shift-notes" element={<ShiftNotes />} />
                <Route path="/kaizen" element={<Kaizen />} />
                <Route path="*" element={<Navigate to="/dashboard" replace />} />
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
        </PlanProvider>
        </BrandingProvider>
      </ThemeProvider>
    </AuthProvider>
  );
}

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
import { MessagesProvider } from './context/MessagesContext';
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
const PlantView        = lazy(() => import('./pages/PlantView'));
const DepartmentView   = lazy(() => import('./pages/DepartmentView'));
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

export default function App() {
  return (
    <AuthProvider>
      <ThemeProvider>
        <BrandingProvider>
        <PlanProvider>
        <NavPrefsProvider>
        <MessagesProvider>
          <BrowserRouter>
            <MessageToast />
            <Suspense fallback={<Spinner />}>
            <Routes>
              <Route path="/login" element={<Login />} />
              <Route path="/play/:id" element={<ProtectedRoute><AppPlayer /></ProtectedRoute>} />
              <Route path="/operator" element={<ProtectedRoute><OperatorPortal /></ProtectedRoute>} />
              <Route path="/leaderboard/tv" element={<ProtectedRoute><LeaderboardTV /></ProtectedRoute>} />
              <Route path="/" element={<ProtectedRoute><Layout /></ProtectedRoute>}>
                <Route index element={<Dashboard />} />
                <Route path="apps" element={<AppsLibrary />} />
                <Route path="apps/:id/build" element={<AppBuilder />} />
                <Route path="apps/:id/history" element={<AppHistory />} />
                <Route path="tables" element={<Tables />} />
                <Route path="tables/:id" element={<TableDetail />} />
                <Route path="analytics" element={<Analytics />} />
                <Route path="stations" element={<Stations />} />
                <Route path="stations/:id" element={<StationView />} />
                <Route path="schedule" element={<Schedule />} />
                <Route path="plant" element={<PlantView />} />
                <Route path="departments/:id" element={<DepartmentView />} />
                <Route path="manager" element={<ManagerView />} />
                <Route path="step-metrics" element={<StepMetrics />} />
                <Route path="capacity" element={<CapacityPlanning />} />
                <Route path="completions/:id" element={<CompletionDetail />} />
                <Route path="oee" element={<OEETracker />} />
                <Route path="dashboards" element={<Dashboards />} />
                <Route path="dashboards/:id" element={<DashboardView />} />
                <Route path="dashboards/:id/:mode" element={<DashboardView />} />
                <Route path="inventory" element={<Inventory />} />
                <Route path="inventory/:id" element={<Inventory />} />
                <Route path="purchasing" element={<Purchasing />} />
                <Route path="purchasing/:tab" element={<Purchasing />} />
                <Route path="quality" element={<Quality />} />
                <Route path="quality/:id" element={<Quality />} />
                <Route path="leaderboard" element={<Leaderboard />} />
                <Route path="settings" element={<SettingsPage />} />
                <Route path="*" element={<Navigate to="/" replace />} />
              </Route>
            </Routes>
            </Suspense>
          </BrowserRouter>
        </MessagesProvider>
        </NavPrefsProvider>
        </PlanProvider>
        </BrandingProvider>
      </ThemeProvider>
    </AuthProvider>
  );
}

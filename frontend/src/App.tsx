import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import Layout from './components/shared/Layout';
import Dashboard from './pages/Dashboard';
import AppsLibrary from './pages/AppsLibrary';
import AppBuilder from './pages/AppBuilder';
import AppPlayer from './pages/AppPlayer';
import Tables from './pages/Tables';
import TableDetail from './pages/TableDetail';
import Analytics from './pages/Analytics';
import Stations from './pages/Stations';

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/play/:id" element={<AppPlayer />} />
        <Route path="/" element={<Layout />}>
          <Route index element={<Dashboard />} />
          <Route path="apps" element={<AppsLibrary />} />
          <Route path="apps/:id/build" element={<AppBuilder />} />
          <Route path="tables" element={<Tables />} />
          <Route path="tables/:id" element={<TableDetail />} />
          <Route path="analytics" element={<Analytics />} />
          <Route path="stations" element={<Stations />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}

import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { api } from '../api/client';
import { AlertTriangle } from 'lucide-react';
import DashboardView from './DashboardView';

// Per-workspace Reports pages (/reports/:category). Each category resolves to
// the company's dedicated report dashboard — auto-created server-side on first
// visit with sensible defaults — then hands off to the existing DashboardView
// experience (grid, card editor, persistence) rather than forking it.
//
// DashboardView is RENDERED HERE, never redirected to. Navigating to
// /dashboards/:id would re-file the page under the Reporting workspace
// (findSectionForPath matches the /dashboards nav item), so the Production /
// Inventory / Quality screen tabs the user came from would vanish and the
// sidebar would jump. Staying on /reports/:category keeps every workspace's
// Reports tab where it belongs.

const CATEGORY_LABELS: Record<string, string> = {
  production: 'Production Reports',
  inventory: 'Inventory Reports',
  quality: 'Quality Reports',
  kaizen: 'Kaizen Reports',
  maintenance: 'Maintenance Reports',
  people: 'People Reports',
};

export default function CategoryReports() {
  const { category } = useParams<{ category: string }>();
  const [dashboardId, setDashboardId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [retryKey, setRetryKey] = useState(0);
  const isValid = !!category && category in CATEGORY_LABELS;

  useEffect(() => {
    if (!isValid || !category) return;
    let cancelled = false;
    setError('');
    setDashboardId(null);
    api.getCategoryDashboard(category)
      .then(d => { if (!cancelled) setDashboardId(d.id); })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load reports');
      });
    return () => { cancelled = true; };
  }, [category, isValid, retryKey]);

  if (!isValid) {
    return (
      <div className="p-6 flex flex-col items-center justify-center py-24 gap-3 text-center">
        <AlertTriangle size={40} className="text-red-400" />
        <div>
          <p className="font-medium text-gray-500">Unknown reports workspace</p>
          <p className="text-sm text-gray-400 mt-1">
            "{category}" is not a valid workspace — try production, inventory, quality, kaizen, maintenance or people.
          </p>
        </div>
        <Link to="/dashboard" className="text-blue-600 text-sm hover:underline">← Back to Command Center</Link>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6 flex flex-col items-center justify-center py-24 gap-3 text-center">
        <AlertTriangle size={40} className="text-red-400" />
        <div>
          <p className="font-medium text-gray-500">Couldn't load {CATEGORY_LABELS[category!]}</p>
          <p className="text-sm text-gray-400 mt-1">{error}</p>
        </div>
        <button className="btn-secondary" onClick={() => setRetryKey(k => k + 1)}>Retry</button>
        <Link to="/dashboard" className="text-blue-600 text-sm hover:underline">← Back to Command Center</Link>
      </div>
    );
  }

  if (!dashboardId) {
    // Same skeleton shape DashboardView shows while loading.
    return (
      <div className="p-6 space-y-5">
        <div className="h-9 w-64 animate-pulse bg-gray-200 rounded-lg" />
        <div className="grid grid-cols-4 gap-4">
          {[1, 2, 3, 4].map(i => (
            <div key={i} className="col-span-2 h-48 animate-pulse bg-white border border-gray-200 rounded-2xl" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <DashboardView
      dashboardId={dashboardId}
      basePath={`/reports/${category}`}
      backTo={{ to: '/dashboard', label: 'Back to Command Center' }}
    />
  );
}

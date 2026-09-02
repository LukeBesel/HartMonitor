import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api } from '../api/client';
import DashboardView, { ReportSkeleton, ReportLoadFailed } from './DashboardView';

// ─── /reports/:category — a resolver, and nothing else ────────────────────────
// Each workspace's Reports screen IS the company's saved report for that
// workspace (auto-created server-side on first visit). This file's whole job is
// to turn the category in the URL into that report's id and hand it to the one
// report view — no header, no error card, no skeleton of its own. When it had
// its own chrome, one saved report looked like two different objects depending
// on whether you opened it from a workspace's Reports tab or from the Report
// Builder; the cards, the filter bar and the edit toggle all come from
// DashboardView either way.
//
// It resolves IN PLACE rather than redirecting to /dashboards/:id, which is
// what keeps the URL — and therefore the sidebar workspace and its tab bar — on
// the workspace whose Reports tab the reader clicked.

export default function CategoryReports() {
  const { category } = useParams<{ category: string }>();
  const [reportId, setReportId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [retryKey, setRetryKey] = useState(0);

  useEffect(() => {
    if (!category) return;
    let cancelled = false;
    setError('');
    setReportId(null);
    api.getCategoryDashboard(category)
      .then(d => { if (!cancelled) setReportId(d.id); })
      // An unknown category answers with the server's own list of the real
      // ones, so this screen never keeps a second copy of that list.
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load this report');
      });
    return () => { cancelled = true; };
  }, [category, retryKey]);

  if (error) return <ReportLoadFailed message={error} onRetry={() => setRetryKey(k => k + 1)} />;
  if (!reportId) return <ReportSkeleton />;
  return <DashboardView dashboardId={reportId} />;
}

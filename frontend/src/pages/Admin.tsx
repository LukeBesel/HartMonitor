import { useState, useEffect, useCallback } from 'react';
import { Shield, Copy, Check, AlertTriangle, RefreshCw } from 'lucide-react';
import { useAuth } from '../context/AuthContext';

// ─── Types ────────────────────────────────────────────────────────────────────

interface PendingReset {
  id: string;
  user_email: string;
  reset_url: string;
  expires_at: string;
  created_at: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatExpiry(isoString: string): string {
  const d = new Date(isoString + (isoString.endsWith('Z') ? '' : 'Z'));
  return d.toLocaleString();
}

// ─── Admin Page ───────────────────────────────────────────────────────────────

export default function AdminPage() {
  const { user } = useAuth();
  const [pendingResets, setPendingResets] = useState<PendingReset[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [activeTab] = useState<'system'>('system');

  const loadPendingResets = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const token = localStorage.getItem('hm_token');
      const res = await fetch('/api/admin/pending-resets', {
        headers: { Authorization: `Bearer ${token ?? ''}` },
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || 'Failed to load pending resets');
      }
      const data: PendingReset[] = await res.json();
      setPendingResets(data);
    } catch (err: any) {
      setError(err?.message || 'Failed to load pending resets');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadPendingResets();
  }, [loadPendingResets]);

  const handleCopy = async (reset: PendingReset) => {
    try {
      await navigator.clipboard.writeText(reset.reset_url);
      setCopiedId(reset.id);
      setTimeout(() => setCopiedId(null), 2000);
    } catch {
      // Fallback for browsers without clipboard API
      const el = document.createElement('textarea');
      el.value = reset.reset_url;
      document.body.appendChild(el);
      el.select();
      document.execCommand('copy');
      document.body.removeChild(el);
      setCopiedId(reset.id);
      setTimeout(() => setCopiedId(null), 2000);
    }
  };

  // Only developers can access this page.
  if (!user || user.role !== 'developer') {
    return (
      <div className="p-6 text-center text-gray-500 text-sm">
        <Shield size={32} className="mx-auto mb-3 text-gray-300" />
        Admin panel is restricted to developers.
      </div>
    );
  }

  return (
    <div className="p-6 bg-[#f8fafc] min-h-full">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <div className="w-9 h-9 rounded-xl flex items-center justify-center shadow-sm bg-red-100 text-red-600">
          <Shield size={18} />
        </div>
        <div>
          <h1 className="text-xl font-bold text-gray-900 tracking-tight">Admin Panel</h1>
          <p className="text-xs text-gray-500 mt-0.5">Developer-only tools and system management</p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-6 bg-white border border-gray-200 rounded-xl p-1 w-fit shadow-sm">
        <button
          className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all text-white shadow-sm"
          style={{ backgroundColor: 'var(--accent)' }}
        >
          <Shield size={15} />
          System
        </button>
      </div>

      {activeTab === 'system' && (
        <div className="space-y-6 max-w-2xl">
          {/* Pending Password Resets */}
          <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-6">
            <div className="flex items-center justify-between mb-2">
              <div>
                <h2 className="text-sm font-semibold text-gray-800">Pending Password Resets</h2>
                <p className="text-xs text-gray-500 mt-0.5">
                  These links are shown here because email is not configured. Share them securely with the user.
                </p>
              </div>
              <button
                onClick={loadPendingResets}
                disabled={loading}
                className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors disabled:opacity-40"
                title="Refresh"
              >
                <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
              </button>
            </div>

            {error && (
              <div className="flex items-center gap-2 text-xs text-red-600 bg-red-50 rounded-xl px-3 py-2 mb-3 border border-red-100">
                <AlertTriangle size={13} className="flex-shrink-0" />
                {error}
              </div>
            )}

            {loading && !error && (
              <div className="py-8 text-center text-sm text-gray-400">
                <div className="w-5 h-5 border-2 border-gray-300 border-t-gray-600 rounded-full animate-spin mx-auto mb-2" />
                Loading…
              </div>
            )}

            {!loading && !error && pendingResets.length === 0 && (
              <div className="py-8 text-center rounded-xl border border-dashed border-gray-200">
                <Check size={20} className="mx-auto text-emerald-400 mb-2" />
                <p className="text-sm text-gray-400">No pending password resets</p>
                <p className="text-xs text-gray-400 mt-0.5">
                  {window.location.hostname === 'localhost'
                    ? 'When a user requests a reset via the login page, the link will appear here.'
                    : 'When SMTP is not configured, reset links appear here for manual delivery.'}
                </p>
              </div>
            )}

            {!loading && pendingResets.length > 0 && (
              <div className="space-y-3 mt-3">
                <div className="flex items-start gap-2 text-xs bg-amber-50 text-amber-800 rounded-xl px-3 py-2.5 border border-amber-100">
                  <AlertTriangle size={13} className="flex-shrink-0 mt-0.5" />
                  <span>
                    Email delivery is not configured. Copy each link below and send it directly to the user via a
                    secure channel (e.g., Slack, Teams, or SMS). These links expire after 24 hours.
                  </span>
                </div>

                {pendingResets.map(reset => (
                  <div
                    key={reset.id}
                    className="rounded-xl border border-gray-200 bg-gray-50 p-4"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-medium text-gray-800 mb-0.5">{reset.user_email}</div>
                        <div className="text-xs text-gray-400 mb-2">
                          Requested: {formatExpiry(reset.created_at)} &nbsp;·&nbsp; Expires: {formatExpiry(reset.expires_at)}
                        </div>
                        <div className="font-mono text-xs text-gray-500 bg-white border border-gray-200 rounded-lg px-2 py-1.5 break-all">
                          {reset.reset_url}
                        </div>
                      </div>
                      <button
                        onClick={() => handleCopy(reset)}
                        className={`flex-shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                          copiedId === reset.id
                            ? 'bg-emerald-100 text-emerald-700'
                            : 'bg-white border border-gray-200 text-gray-600 hover:bg-gray-100'
                        }`}
                      >
                        {copiedId === reset.id ? (
                          <><Check size={12} /> Copied</>
                        ) : (
                          <><Copy size={12} /> Copy Link</>
                        )}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

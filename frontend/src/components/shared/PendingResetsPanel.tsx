import { useState, useEffect, useCallback } from 'react';
import { RefreshCw, Copy, Check } from 'lucide-react';
import { api, type PendingReset } from '../../api/client';

// Password recovery for a deployment with no SMTP configured. The server never
// emails the link and never returns it to the person who asked for it (that was
// an account-takeover hole), so the only way back in for a locked-out user is
// for an admin of their own company to read the link here and hand it over.
//
// This lives in Settings → Users & Access because it is a customer's own job.
// It used to sit on the platform Admin Dashboard, which no customer can reach
// any more — leaving it there would have quietly removed the only self-hosted
// recovery path there is.
//
// Renders nothing at all when there is nothing pending: on a hosted deployment
// email handles resets and the server always returns an empty list, so a
// permanent "No pending resets" box would just be noise in the settings page.

export default function PendingResetsPanel() {
  const [resets, setResets] = useState<PendingReset[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setResets(await api.getPendingResets());
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to load pending resets');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleCopy = async (reset: PendingReset) => {
    try {
      await navigator.clipboard.writeText(reset.reset_url);
    } catch {
      // Clipboard API needs a secure context; a self-hosted box on plain http
      // does not have one, and this is exactly where the panel matters most.
      const el = document.createElement('textarea');
      el.value = reset.reset_url;
      document.body.appendChild(el);
      el.select();
      document.execCommand('copy');
      document.body.removeChild(el);
    }
    setCopiedId(reset.id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  if (loading) return null;
  if (!error && resets.length === 0) return null;

  return (
    <div className="bg-white border border-gray-200 rounded-xl p-4 mt-8">
      <div className="flex items-center justify-between mb-3">
        <div>
          <h3 className="text-sm font-semibold text-gray-900">Pending Password Resets</h3>
          <p className="text-xs text-gray-500 mt-0.5">
            These links are shown here because email is not configured. Share them securely with the user.
          </p>
        </div>
        <button
          onClick={load}
          className="p-1.5 rounded-lg text-gray-500 hover:text-gray-900 hover:bg-gray-100 transition-colors"
          title="Refresh"
        >
          <RefreshCw size={13} />
        </button>
      </div>

      {error && <p className="text-xs text-red-700">{error}</p>}

      {!error && resets.map(r => (
        <div key={r.id} className="mb-2 bg-gray-100 rounded-lg p-3 flex items-start gap-3">
          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium text-gray-900 truncate">{r.user_email}</div>
            <div className="text-xs text-gray-500 mt-0.5">
              Expires: {new Date(r.expires_at + (r.expires_at.endsWith('Z') ? '' : 'Z')).toLocaleString()}
            </div>
            <div className="font-mono text-xs text-gray-500 mt-1 break-all">{r.reset_url}</div>
          </div>
          <button
            onClick={() => handleCopy(r)}
            className={`flex-shrink-0 flex items-center gap-1 px-2 py-1 rounded text-xs font-medium transition-colors ${
              copiedId === r.id
                ? 'bg-emerald-50 text-emerald-700'
                : 'bg-gray-100 hover:bg-gray-200 text-gray-700'
            }`}
          >
            {copiedId === r.id ? (<><Check size={11} />Copied</>) : (<><Copy size={11} />Copy</>)}
          </button>
        </div>
      ))}
    </div>
  );
}

import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { Zap, X, Check, Loader2 } from 'lucide-react';

// ─── "Keep my work — create a free account" ──────────────────────────────────
// The demo banner's promise, kept literally: POST /auth/claim-sandbox promotes
// the CURRENT sandbox organisation into a real account in place, so every app,
// run, work order and setting the visitor touched stays exactly where it is.
//
// The copy below is deliberately explicit about what carries over — the sample
// plant data comes with it, because it lives in the same workspace. Telling
// someone their demo "becomes their account" while quietly dropping half of it
// would be the same lie in a new costume.

interface Props {
  onClose: () => void;
}

export function ClaimSandboxModal({ onClose }: Props) {
  const { claimSandbox } = useAuth();
  const navigate = useNavigate();
  const [companyName, setCompanyName] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setError('');
    setBusy(true);
    try {
      await claimSandbox(companyName.trim(), displayName.trim(), email.trim(), password);
      navigate('/dashboard', { replace: true });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create your account');
      setBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="claim-sandbox-title"
    >
      <div className="w-full max-w-md rounded-2xl bg-white shadow-2xl overflow-hidden">
        <div className="flex items-start gap-3 px-6 pt-6 pb-4">
          <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-amber-100 text-amber-600">
            <Zap size={18} />
          </span>
          <div className="flex-1">
            <h2 id="claim-sandbox-title" className="text-lg font-bold text-gray-900">Keep this workspace</h2>
            <p className="mt-1 text-sm text-gray-600">
              This exact demo workspace becomes your free account — nothing is copied or reset.
            </p>
          </div>
          <button
            onClick={onClose}
            disabled={busy}
            className="shrink-0 p-1 text-gray-400 hover:text-gray-600 disabled:opacity-40"
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </div>

        <ul className="mx-6 mb-4 space-y-1.5 rounded-xl bg-gray-50 p-3.5 text-xs text-gray-600">
          <li className="flex gap-2">
            <Check size={14} className="mt-0.5 shrink-0 text-green-600" />
            Everything you built here stays — apps, runs, work orders and settings.
          </li>
          <li className="flex gap-2">
            <Check size={14} className="mt-0.5 shrink-0 text-green-600" />
            The sample plant data comes with it. Clear what you don't need whenever you like.
          </li>
          <li className="flex gap-2">
            <Check size={14} className="mt-0.5 shrink-0 text-green-600" />
            The 24-hour demo timer is switched off. No card required.
          </li>
        </ul>

        <form onSubmit={submit} className="px-6 pb-6 space-y-3">
          <div>
            <label htmlFor="claim-company" className="block text-xs font-semibold text-gray-700 mb-1">Company name</label>
            <input
              id="claim-company" className="input w-full" required
              value={companyName} onChange={e => setCompanyName(e.target.value)}
              placeholder="Hart Machining"
            />
          </div>
          <div>
            <label htmlFor="claim-name" className="block text-xs font-semibold text-gray-700 mb-1">Your name</label>
            <input
              id="claim-name" className="input w-full" required
              value={displayName} onChange={e => setDisplayName(e.target.value)}
              placeholder="Luke Hart"
            />
          </div>
          <div>
            <label htmlFor="claim-email" className="block text-xs font-semibold text-gray-700 mb-1">Work email</label>
            <input
              id="claim-email" type="email" className="input w-full" required
              value={email} onChange={e => setEmail(e.target.value)}
              placeholder="you@company.com" autoComplete="email"
            />
          </div>
          <div>
            <label htmlFor="claim-password" className="block text-xs font-semibold text-gray-700 mb-1">Password</label>
            <input
              id="claim-password" type="password" className="input w-full" required minLength={8}
              value={password} onChange={e => setPassword(e.target.value)}
              placeholder="At least 8 characters" autoComplete="new-password"
            />
          </div>

          {error && (
            <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>
          )}

          <button type="submit" disabled={busy} className="btn-primary w-full justify-center disabled:opacity-60">
            {busy ? (<><Loader2 size={15} className="animate-spin" /> Creating your account…</>) : 'Create my free account'}
          </button>
          <p className="text-center text-[11px] text-gray-400">
            Free tier: 5 apps and 2 dashboards. Everything else stays unlocked during early access.
          </p>
        </form>
      </div>
    </div>
  );
}

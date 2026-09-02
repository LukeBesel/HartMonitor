import { useAuth } from '../../context/AuthContext';
import { usePlan } from '../../context/PlanContext';
import { api } from '../../api/client';
import { AlertTriangle, Zap, X, Home } from 'lucide-react';
import { useState } from 'react';
import { ClaimSandboxModal } from './ClaimSandboxModal';
import { Link } from 'react-router-dom';

export function BillingBanner() {
  const { user } = useAuth();
  const { isOnTrial, trialDaysRemaining, isPastDue } = usePlan();
  const [dismissed, setDismissed] = useState(false);
  const [loading, setLoading] = useState(false);
  const [claiming, setClaiming] = useState(false);

  if (!user || dismissed) return null;

  // Throwaway sandbox company — steer visitors toward keeping their work.
  // "Keep my work" opens the claim dialog, which promotes THIS company into a
  // real account. It used to link to plain signup, which started an empty
  // organisation and left everything the visitor built to be swept in 24 hours.
  if (user.email?.endsWith('@sandbox.hartmonitor.local')) {
    return (
      <>
        <div className="flex items-center gap-2 sm:gap-3 px-3 sm:px-4 py-1.5 sm:py-2 bg-amber-50 dark:bg-amber-500/15 border-b border-amber-300 dark:border-amber-500/30 text-amber-900 dark:text-amber-200 text-xs sm:text-sm">
          {/* amber-400 is a dark-mode value; on the amber-50 ground this banner
              uses in light mode it measures 1.61:1 — the icon simply is not
              there. Both icons follow the banner's own text colour, which
              already clears AA on either ground. */}
          <Zap size={14} className="shrink-0" />
          {/* The long sentence only appears where it actually fits. At 640px it
              was chosen and then truncated to "explore ever…", which loses the
              one fact the banner exists to state — that the demo resets. */}
          <span className="flex-1 min-w-0 truncate">
            <span className="lg:hidden"><strong>Demo</strong> — resets in 24h</span>
            <span className="hidden lg:inline">
              You're in a <strong>demo company</strong> — explore everything freely. It resets after 24 hours.
            </span>
          </span>
          {/* Back to the marketing site. `/` renders the landing page even while
              signed in, so this is a way OUT of the demo and back to the product
              pages without ending the session or losing anything — there was no
              route back short of editing the URL. */}
          <Link
            to="/"
            className="shrink-0 px-2 sm:px-2.5 py-1 rounded-lg border border-amber-400/60 text-amber-900 dark:text-amber-200 font-semibold text-xs hover:bg-amber-400/20 transition-colors whitespace-nowrap inline-flex items-center gap-1"
            title="Back to hartmonitorapp.com"
          >
            <Home size={12} />
            <span className="hidden sm:inline">Website</span>
          </Link>
          <button
            onClick={() => setClaiming(true)}
            className="shrink-0 px-2.5 sm:px-3 py-1 rounded-lg bg-amber-500 text-[#111827] font-semibold text-xs hover:bg-amber-400 transition-colors whitespace-nowrap"
          >
            <span className="lg:hidden">Keep my work</span>
            <span className="hidden lg:inline">Keep my work — create a free account</span>
          </button>
          <button onClick={() => setDismissed(true)} className="shrink-0 p-1 text-amber-800 dark:text-amber-300 hover:text-amber-950 dark:hover:text-amber-100" aria-label="Dismiss">
            <X size={14} />
          </button>
        </div>
        {claiming && <ClaimSandboxModal onClose={() => setClaiming(false)} />}
      </>
    );
  }

  const handleUpgrade = async () => {
    setLoading(true);
    try {
      const { url } = await api.createCheckout('pro');
      window.location.href = url;
    } catch { setLoading(false); }
  };

  const handlePortal = async () => {
    setLoading(true);
    try {
      const { url } = await api.openBillingPortal();
      window.location.href = url;
    } catch { setLoading(false); }
  };

  if (isPastDue) {
    return (
      <div className="bg-red-900/80 border-b border-red-700 px-4 py-2 flex items-center justify-between">
        <div className="flex items-center gap-2 text-red-100 text-sm">
          <AlertTriangle className="w-4 h-4 flex-shrink-0" />
          <span>Your payment failed. Update your payment method to keep access.</span>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={handlePortal} disabled={loading}
            className="text-xs bg-red-700 hover:bg-red-600 text-white px-3 py-1 rounded-lg transition-colors">
            {loading ? 'Opening...' : 'Update Payment'}
          </button>
          <button onClick={() => setDismissed(true)} className="text-red-300 hover:text-red-100">
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>
    );
  }

  if (isOnTrial && trialDaysRemaining <= 7) {
    return (
      <div className="bg-blue-900/80 border-b border-blue-700 px-4 py-2 flex items-center justify-between">
        <div className="flex items-center gap-2 text-blue-100 text-sm">
          <Zap className="w-4 h-4 flex-shrink-0" />
          <span>
            {trialDaysRemaining <= 0
              ? 'Your free trial has ended. Upgrade to keep access.'
              : `${trialDaysRemaining} day${trialDaysRemaining !== 1 ? 's' : ''} left in your free trial.`}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={handleUpgrade} disabled={loading}
            className="text-xs bg-blue-600 hover:bg-blue-500 text-white px-3 py-1 rounded-lg transition-colors">
            {loading ? 'Loading...' : 'Upgrade Now'}
          </button>
          <button onClick={() => setDismissed(true)} className="text-blue-300 hover:text-blue-100">
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>
    );
  }

  return null;
}

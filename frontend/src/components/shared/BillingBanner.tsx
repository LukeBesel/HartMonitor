import { useAuth } from '../../context/AuthContext';
import { usePlan } from '../../context/PlanContext';
import { api } from '../../api/client';
import { AlertTriangle, Zap, X } from 'lucide-react';
import { useState } from 'react';

export function BillingBanner() {
  const { user } = useAuth();
  const { isOnTrial, trialDaysRemaining, isPastDue } = usePlan();
  const [dismissed, setDismissed] = useState(false);
  const [loading, setLoading] = useState(false);

  if (!user || dismissed) return null;

  // Throwaway sandbox workspace — steer visitors toward keeping their work.
  if (user.email?.endsWith('@sandbox.hartmonitor.local')) {
    return (
      // flex-wrap: on narrow screens the CTA drops to its own row instead of
      // squeezing the copy into a one-word-per-line column / clipping off-screen.
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-4 py-2 bg-amber-50 dark:bg-amber-500/15 border-b border-amber-300 dark:border-amber-500/30 text-amber-900 dark:text-amber-200 text-sm">
        <Zap size={15} className="shrink-0 text-amber-400" />
        <span className="flex-1 min-w-[200px]">
          You're in a <strong>demo workspace</strong> — explore everything freely. It resets after 24 hours.
        </span>
        <span className="flex items-center gap-2 ml-auto">
          <a href="/login?mode=signup" className="shrink-0 px-3 py-1 rounded-lg bg-amber-500 text-gray-900 font-semibold text-xs hover:bg-amber-400 transition-colors whitespace-nowrap">
            Keep my work — create a free account
          </a>
          <button onClick={() => setDismissed(true)} className="shrink-0 p-1 text-amber-400/70 hover:text-amber-200" aria-label="Dismiss">
            <X size={14} />
          </button>
        </span>
      </div>
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

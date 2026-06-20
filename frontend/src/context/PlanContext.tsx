import { createContext, useContext, useEffect, useState, ReactNode, useCallback } from 'react';
import { api } from '../api/client';
import type { Plan } from '../types';
import { useAuth } from './AuthContext';

interface PlanContextValue {
  plan: Plan | null;
  loading: boolean;
  refresh: () => void;
  canCreateApp: boolean;
  canCreateDashboard: boolean;
  isPro: boolean;
  isEnterprise: boolean;
  isFree: boolean;
  /** Whether Pro-only nav items / upsells should be shown to a Free account.
   *  Always true so customers can see what's available and upgrade per-module. */
  showProFeatures: boolean;
  /** Current plan tier */
  tier: 'free' | 'pro' | 'enterprise';
  /** True if the account is within an active trial period */
  isOnTrial: boolean;
  /** Days remaining in trial (0 if expired or no trial) */
  trialDaysRemaining: number;
  /** True if subscription_status is 'past_due' */
  isPastDue: boolean;
  /** True if account has an active paid subscription or is on trial */
  isActive: boolean;
}

const PlanContext = createContext<PlanContextValue | null>(null);

export function PlanProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [plan, setPlan] = useState<Plan | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(() => {
    api.getPlan().then(p => setPlan(p)).catch(() => {}).finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (user) refresh();
    else { setPlan(null); setLoading(false); }
  }, [user, refresh]);

  const isPro        = plan?.tier === 'pro' || plan?.tier === 'enterprise';
  const isEnterprise = plan?.tier === 'enterprise';
  const isFree       = plan?.tier === 'free' || !plan;
  const tier         = (plan?.tier ?? 'free') as 'free' | 'pro' | 'enterprise';

  // Effective limits include purchased à-la-carte add-on slots
  const appLimit  = plan?.effective_app_limit ?? plan?.app_limit ?? -1;
  const dashLimit = plan?.effective_dashboard_limit ?? plan?.dashboard_limit ?? -1;
  const canCreateApp = !plan || appLimit < 0 || (plan.app_count ?? 0) < appLimit;
  const canCreateDashboard = !plan || dashLimit < 0 || (plan.dashboard_count ?? 0) < dashLimit;

  // Always show all modules so customers can see what's available and upgrade
  // per-module. Locked items show an upgrade prompt instead of being hidden.
  const showProFeatures = true;

  // Trial status
  const trialEndsAt = (plan as any)?.trial_ends_at ? new Date((plan as any).trial_ends_at) : null;
  const isOnTrial = trialEndsAt ? trialEndsAt > new Date() : false;
  const trialDaysRemaining = isOnTrial && trialEndsAt
    ? Math.max(0, Math.ceil((trialEndsAt.getTime() - Date.now()) / (1000 * 60 * 60 * 24)))
    : 0;

  // Payment status
  const isPastDue = (plan as any)?.subscription_status === 'past_due';

  // Active = paid subscription or on trial
  const isActive = isPro || isOnTrial;

  return (
    <PlanContext.Provider value={{
      plan, loading, refresh, canCreateApp, canCreateDashboard,
      isPro, isEnterprise, isFree, showProFeatures,
      tier, isOnTrial, trialDaysRemaining, isPastDue, isActive,
    }}>
      {children}
    </PlanContext.Provider>
  );
}

export function usePlan(): PlanContextValue {
  const ctx = useContext(PlanContext);
  if (!ctx) throw new Error('usePlan must be used within PlanProvider');
  return ctx;
}

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
   *  Stays hidden to keep the app simple until the team actually needs more
   *  (hits an app or dashboard limit), at which point upgrading becomes relevant. */
  showProFeatures: boolean;
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

  // Effective limits include purchased à-la-carte add-on slots
  const appLimit  = plan?.effective_app_limit ?? plan?.app_limit ?? -1;
  const dashLimit = plan?.effective_dashboard_limit ?? plan?.dashboard_limit ?? -1;
  const canCreateApp = !plan || appLimit < 0 || (plan.app_count ?? 0) < appLimit;
  const canCreateDashboard = !plan || dashLimit < 0 || (plan.dashboard_count ?? 0) < dashLimit;

  // Free accounts only see Pro-only nav items/sections once they've hit a
  // limit (and would actually benefit from upgrading). Pro/Enterprise always see them.
  const showProFeatures = !isFree || !canCreateApp || !canCreateDashboard;

  return (
    <PlanContext.Provider value={{ plan, loading, refresh, canCreateApp, canCreateDashboard, isPro, isEnterprise, isFree, showProFeatures }}>
      {children}
    </PlanContext.Provider>
  );
}

export function usePlan(): PlanContextValue {
  const ctx = useContext(PlanContext);
  if (!ctx) throw new Error('usePlan must be used within PlanProvider');
  return ctx;
}

// Where a new account lands.
//
// The Command Center is a great screen once there is production to command —
// on a brand-new account it is a grid of zeroes. So the FIRST time someone
// arrives at /dashboard in a browsing session we ask the server one question:
// has this company ever started a run? If not, we send them to Apps, which is
// where the product actually starts.
//
// Deliberately narrow: it fires once per tab, only when the answer is "no
// runs at all", and never fights a user who clicks Command Center afterwards.

import { useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { api } from '../../api/client';
import { useAuth } from '../../context/AuthContext';
import { useModules } from '../../context/ModulesContext';

const SESSION_FLAG = 'hm_first_run_landing_checked';

function alreadyChecked(): boolean {
  try { return sessionStorage.getItem(SESSION_FLAG) === '1'; } catch { return true; }
}

function markChecked(): void {
  try { sessionStorage.setItem(SESSION_FLAG, '1'); } catch { /* private mode — check again next route */ }
}

export default function FirstRunLanding({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const { isEnabled, loading: modulesLoading } = useModules();
  const [decision, setDecision] = useState<'checking' | 'stay' | 'apps'>(
    () => (alreadyChecked() ? 'stay' : 'checking'),
  );

  useEffect(() => {
    if (decision !== 'checking') return;
    if (!user || modulesLoading) return;
    // Apps switched off for this company — the Command Center IS their home.
    if (!isEnabled('apps')) { markChecked(); setDecision('stay'); return; }

    let cancelled = false;
    markChecked();
    api.getAppsStats()
      .then(stats => { if (!cancelled) setDecision(stats?.company_has_completions ? 'stay' : 'apps'); })
      .catch(() => { if (!cancelled) setDecision('stay'); });
    return () => { cancelled = true; };
  }, [decision, user, modulesLoading, isEnabled]);

  if (decision === 'apps') return <Navigate to="/apps" replace />;
  if (decision === 'checking') {
    // One short beat instead of flashing an empty dashboard we are about to leave.
    return (
      <div className="flex items-center justify-center py-24">
        <div className="w-7 h-7 border-2 border-gray-200 border-t-gray-400 rounded-full animate-spin" />
      </div>
    );
  }
  return <>{children}</>;
}

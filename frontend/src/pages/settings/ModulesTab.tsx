// ─── Modules ────────────────────────────────────────────────────────────────
import Toggle from '../../components/shared/Toggle';
import { useState, useRef } from 'react';
import { Star, Key, Lock } from 'lucide-react';
import { usePlan } from '../../context/PlanContext';
import { useModules, ModuleKey } from '../../context/ModulesContext';
import { useAuth } from '../../context/AuthContext';
import { SectionHeader, Toast } from './shared';

// ─── Tab: Modules (Composable MES) ────────────────────────────────────────────
// Turn individual MES modules on/off for the whole company. Core modules
// (Production, Analytics) are locked on. Toggles apply optimistically and the
// nav/routes react instantly via ModulesContext.

export function ModulesTab() {
  const { modules, loading, toggle } = useModules();
  const { isAtLeast } = useAuth();
  const { isFree } = usePlan();
  const canManage = isAtLeast('manager');
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showToast = (message: string, type: 'success' | 'error' = 'success') => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast({ message, type });
    toastTimer.current = setTimeout(() => setToast(null), 3000);
  };

  const handleToggle = async (key: ModuleKey, name: string, enabled: boolean) => {
    try {
      await toggle(key, enabled);
      showToast(`${name} module ${enabled ? 'enabled' : 'disabled'}`);
    } catch (err: any) {
      showToast(err?.message || `Failed to update ${name}`, 'error');
    }
  };

  if (loading) {
    return <div className="flex items-center justify-center py-20 text-gray-400 text-sm">Loading modules…</div>;
  }

  const enabledCount = modules.filter(m => m.enabled).length;

  return (
    <div className="space-y-6 max-w-4xl">
      <SectionHeader
        title="Compose your MES"
        subtitle={`Turn modules on or off for your whole company — hidden modules disappear from navigation for everyone. ${enabledCount} of ${modules.length} modules enabled.`}
      />

      {!canManage && (
        <div className="flex items-center gap-2 px-3 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-xs text-gray-500">
          <Key size={13} className="text-gray-400 flex-shrink-0" />
          Only managers can change which modules are enabled.
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {modules.map(m => {
          const Icon = m.icon;
          return (
            <div
              key={m.key}
              className={`card p-5 flex flex-col gap-3 transition-opacity ${m.enabled ? '' : 'opacity-60'}`}
            >
              <div className="flex items-start justify-between gap-3">
                <div
                  className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
                  style={{ backgroundColor: 'var(--accent-light)', color: 'var(--accent)' }}
                >
                  <Icon size={18} />
                </div>
                {m.core ? (
                  <span
                    className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full bg-gray-100 text-gray-500"
                    title="Core modules are always on"
                  >
                    <Lock size={9} /> Core
                  </span>
                ) : (
                  <Toggle
                    checked={m.enabled}
                    onChange={v => { if (canManage) handleToggle(m.key, m.name, v); }}
                  />
                )}
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold text-gray-800">{m.name}</span>
                  {!m.includedInPlan && isFree && (
                    <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 inline-flex items-center gap-1">
                      <Star size={9} /> Pro
                    </span>
                  )}
                </div>
                <p className="text-xs text-gray-500 mt-0.5 leading-relaxed">{m.description}</p>
              </div>
              <div className={`text-[11px] font-medium mt-auto ${m.enabled ? 'text-emerald-600' : 'text-gray-400'}`}>
                {m.core ? 'Always on' : m.enabled ? 'Enabled' : 'Disabled — hidden from navigation'}
              </div>
            </div>
          );
        })}
      </div>

      <p className="text-xs text-gray-400">
        Disabling a module hides its pages and navigation entries for everyone in your company.
        No data is deleted — re-enable a module at any time to pick up exactly where you left off.
      </p>

      {toast && <Toast message={toast.message} type={toast.type} onDismiss={() => setToast(null)} />}
    </div>
  );
}

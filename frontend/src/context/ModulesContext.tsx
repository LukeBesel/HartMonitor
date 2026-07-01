import { createContext, useContext, useEffect, useState, useCallback, ReactNode } from 'react';
import {
  Factory, ShieldCheck, Boxes, Wrench, Siren, Lightbulb,
  GraduationCap, ClipboardList, BarChart3, AppWindow,
} from 'lucide-react';
import { useAuth } from './AuthContext';

// ─── Composable MES: module registry ─────────────────────────────────────────
// Mirrors backend/src/routes/modules.js — the module KEYS must stay identical.
// The backend is authoritative for enabled/core/plan state; this local registry
// supplies the icons (lucide components can't travel over JSON) and acts as the
// fallback when the API is unreachable (fail-open: everything enabled).

export type ModuleKey =
  | 'production' | 'quality' | 'inventory' | 'maintenance' | 'andon'
  | 'kaizen' | 'training' | 'shifts' | 'analytics' | 'apps';

export interface ModuleDef {
  key: ModuleKey;
  name: string;
  description: string;
  icon: React.ElementType;
  core: boolean;
}

export const MODULE_REGISTRY: ModuleDef[] = [
  { key: 'production',  name: 'Production',  icon: Factory,       core: true,  description: 'Work orders, stations, scheduling, and OEE' },
  { key: 'quality',     name: 'Quality',     icon: ShieldCheck,   core: false, description: 'NCRs, CAPA, and SQDC boards' },
  { key: 'inventory',   name: 'Inventory',   icon: Boxes,         core: false, description: 'Items, stock, receiving, purchasing, and shipments' },
  { key: 'maintenance', name: 'Maintenance', icon: Wrench,        core: false, description: 'Assets, PM schedules, and maintenance work orders' },
  { key: 'andon',       name: 'Andon',       icon: Siren,         core: false, description: 'Andon calls and alerting' },
  { key: 'kaizen',      name: 'Kaizen',      icon: Lightbulb,     core: false, description: 'Continuous improvement ideas' },
  { key: 'training',    name: 'Training',    icon: GraduationCap, core: false, description: 'Training records and certifications' },
  { key: 'shifts',      name: 'Shifts',      icon: ClipboardList, core: false, description: 'Shift notes and handoff' },
  { key: 'analytics',   name: 'Analytics',   icon: BarChart3,     core: true,  description: 'Analytics, capacity planning, and leaderboards' },
  { key: 'apps',        name: 'Apps & Data', icon: AppWindow,     core: false, description: 'Custom app builder, tables, and dashboards' },
];

const REGISTRY_MAP = new Map(MODULE_REGISTRY.map(m => [m.key, m]));

/** A module merged with its live per-company state from the API. */
export interface ModuleState extends ModuleDef {
  enabled: boolean;
  includedInPlan: boolean;
}

interface ModulesContextValue {
  modules: ModuleState[];
  loading: boolean;
  /** True when the module is on for this company (core modules are always on).
   *  Unknown keys and the loading state fail open so nothing ever vanishes. */
  isEnabled: (key: string) => boolean;
  /** Optimistically toggles a module on/off. Throws (after reverting) on failure. */
  toggle: (key: ModuleKey, enabled: boolean) => Promise<void>;
  refresh: () => void;
}

const defaultModules = (): ModuleState[] =>
  MODULE_REGISTRY.map(m => ({ ...m, enabled: true, includedInPlan: true }));

const ModulesContext = createContext<ModulesContextValue | null>(null);

// Minimal authenticated fetch — mirrors api/client.ts conventions without
// touching the shared client (this context owns its own two endpoints).
async function moduleRequest<T>(path: string, options?: RequestInit): Promise<T> {
  const token = localStorage.getItem('hm_token');
  const res = await fetch(`/api${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options?.headers || {}),
    },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw Object.assign(new Error(err.message || err.error || 'Request failed'), { status: res.status, data: err });
  }
  return res.json();
}

export function ModulesProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [modules, setModules] = useState<ModuleState[]>(defaultModules);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(() => {
    moduleRequest<Array<{ key: ModuleKey; enabled: boolean; core: boolean; includedInPlan: boolean }>>('/modules')
      .then(rows => {
        // Merge server state onto the local registry (icons live client-side).
        setModules(MODULE_REGISTRY.map(def => {
          const row = rows.find(r => r.key === def.key);
          return {
            ...def,
            enabled: def.core ? true : (row?.enabled ?? true),
            includedInPlan: row?.includedInPlan ?? true,
          };
        }));
      })
      .catch(() => setModules(defaultModules()))   // fail open: everything on
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (user) { setLoading(true); refresh(); }
    else { setModules(defaultModules()); setLoading(false); }
  }, [user, refresh]);

  const isEnabled = useCallback((key: string) => {
    const def = REGISTRY_MAP.get(key as ModuleKey);
    if (!def) return true;                 // unknown key → never hide anything
    if (def.core || loading) return true;  // core always on; fail open while loading
    return modules.find(m => m.key === key)?.enabled ?? true;
  }, [modules, loading]);

  const toggle = useCallback(async (key: ModuleKey, enabled: boolean) => {
    const prev = modules;
    // Optimistic flip for a snappy settings UI.
    setModules(ms => ms.map(m => (m.key === key ? { ...m, enabled } : m)));
    try {
      await moduleRequest(`/modules/${key}`, { method: 'PUT', body: JSON.stringify({ enabled }) });
    } catch (err) {
      setModules(prev);                    // revert on failure
      throw err;
    }
  }, [modules]);

  return (
    <ModulesContext.Provider value={{ modules, loading, isEnabled, toggle, refresh }}>
      {children}
    </ModulesContext.Provider>
  );
}

export function useModules(): ModulesContextValue {
  const ctx = useContext(ModulesContext);
  if (!ctx) throw new Error('useModules must be used within ModulesProvider');
  return ctx;
}

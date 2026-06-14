import { createContext, useContext, useEffect, useState, ReactNode, useCallback } from 'react';
import { api } from '../api/client';
import type { RolePermissionMap } from '../types';
import type { NavItem } from '../config/navigation';
import { useAuth } from './AuthContext';

const ROLE_LEVELS: Record<string, number> = { manager: 4, supervisor: 3, operator: 2, viewer: 1 };

interface PermissionsContextValue {
  permissions: RolePermissionMap | null;
  loading: boolean;
  refresh: () => void;
  canShowNavItem: (item: NavItem) => boolean;
}

const PermissionsContext = createContext<PermissionsContextValue | null>(null);

export function PermissionsProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [permissions, setPermissions] = useState<RolePermissionMap | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(() => {
    api.getPermissions().then(p => setPermissions(p)).catch(() => {}).finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (user) refresh();
    else { setPermissions(null); setLoading(false); }
  }, [user, refresh]);

  const canShowNavItem = useCallback((item: NavItem): boolean => {
    if (!user) return false;
    if (user.role === 'developer') return true;

    const userLevel = ROLE_LEVELS[user.role] ?? 0;
    const requiredLevel = item.minRole ? (ROLE_LEVELS[item.minRole] ?? 99) : 0;
    const defaultVisible = !item.minRole || userLevel >= requiredLevel;

    const override = permissions?.[user.role as keyof RolePermissionMap]?.[item.to];
    if (override !== undefined) return !!override;
    return defaultVisible;
  }, [user, permissions]);

  return (
    <PermissionsContext.Provider value={{ permissions, loading, refresh, canShowNavItem }}>
      {children}
    </PermissionsContext.Provider>
  );
}

export function usePermissions(): PermissionsContextValue {
  const ctx = useContext(PermissionsContext);
  if (!ctx) throw new Error('usePermissions must be used within PermissionsProvider');
  return ctx;
}

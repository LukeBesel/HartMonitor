import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { api } from '../api/client';

interface User {
  id: string;
  email: string;
  display_name: string;
  role: 'developer' | 'manager' | 'supervisor' | 'operator' | 'viewer';
  company_name?: string;
}

interface AuthContextValue {
  user: User | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  signup: (companyName: string, displayName: string, email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  isAtLeast: (role: 'developer' | 'manager' | 'supervisor' | 'operator' | 'viewer') => boolean;
  /** The management/report portal (dashboards, analytics, settings). Operators are
   *  shop-floor only and cannot reach it; everyone else can (viewers read-only). */
  canAccessReportPortal: boolean;
  /** The shop-floor Operator Portal. Open to all roles except view-only viewers. */
  canAccessOperatorPortal: boolean;
  /** Viewers can see the report portal but cannot create, edit, or delete anything. */
  canEdit: boolean;
}

const ROLE_LEVELS: Record<string, number> = { developer: 5, manager: 4, supervisor: 3, operator: 2, viewer: 1 };

const AuthContext = createContext<AuthContextValue>(null!);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(() => {
    const stored = localStorage.getItem('hm_user');
    return stored ? JSON.parse(stored) : null;
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = localStorage.getItem('hm_token');
    if (!token) { setLoading(false); return; }
    api.getMe()
      .then(u => { setUser(u); localStorage.setItem('hm_user', JSON.stringify(u)); })
      .catch(() => { localStorage.removeItem('hm_token'); localStorage.removeItem('hm_user'); setUser(null); })
      .finally(() => setLoading(false));
  }, []);

  const login = async (email: string, password: string) => {
    const data = await api.login(email, password);
    localStorage.setItem('hm_token', data.token);
    localStorage.setItem('hm_user', JSON.stringify(data.user));
    setUser(data.user);
    // Fetch full user info (includes company_name)
    const full = await api.getMe().catch(() => data.user);
    setUser(full);
    localStorage.setItem('hm_user', JSON.stringify(full));
  };

  const signup = async (companyName: string, displayName: string, email: string, password: string) => {
    const data = await api.signup(companyName, displayName, email, password);
    localStorage.setItem('hm_token', data.token);
    localStorage.setItem('hm_user', JSON.stringify(data.user));
    setUser(data.user);
    const full = await api.getMe().catch(() => data.user);
    setUser(full);
    localStorage.setItem('hm_user', JSON.stringify(full));
  };

  const logout = async () => {
    await api.logout().catch(() => {});
    localStorage.removeItem('hm_token');
    localStorage.removeItem('hm_user');
    setUser(null);
  };

  const isAtLeast = (role: string) => {
    if (!user) return false;
    return (ROLE_LEVELS[user.role] ?? 0) >= (ROLE_LEVELS[role] ?? 99);
  };

  // Portal access is role-shaped, not a simple ladder: operators live on the
  // shop floor, viewers live in the office. Everyone above them gets both.
  const canAccessReportPortal = !!user && user.role !== 'operator';
  const canAccessOperatorPortal = !!user && user.role !== 'viewer';
  const canEdit = !!user && user.role !== 'viewer' && user.role !== 'operator'
    ? (ROLE_LEVELS[user.role] ?? 0) >= ROLE_LEVELS.supervisor
    : false;

  return (
    <AuthContext.Provider value={{
      user, loading, login, signup, logout, isAtLeast,
      canAccessReportPortal, canAccessOperatorPortal, canEdit,
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);

import { createContext, useContext, useEffect, useRef, useState, ReactNode } from 'react';
import { Capacitor } from '@capacitor/core';
import { Preferences } from '@capacitor/preferences';
import { api, setNativeToken } from '../api/client';

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
  canAccessReportPortal: boolean;
  canAccessOperatorPortal: boolean;
  canEdit: boolean;
  getToken: () => string | null;
}

const ROLE_LEVELS: Record<string, number> = { developer: 5, manager: 4, supervisor: 3, operator: 2, viewer: 1 };
const IS_NATIVE = Capacitor.isNativePlatform();
const PREFS_TOKEN_KEY = 'hm_token';

const AuthContext = createContext<AuthContextValue>(null!);

async function saveToken(token: string) {
  if (IS_NATIVE) {
    await Preferences.set({ key: PREFS_TOKEN_KEY, value: token });
  }
  setNativeToken(IS_NATIVE ? token : null);
}

async function clearToken() {
  if (IS_NATIVE) {
    await Preferences.remove({ key: PREFS_TOKEN_KEY });
  }
  setNativeToken(null);
}

async function loadToken(): Promise<string | null> {
  if (!IS_NATIVE) return null;
  const { value } = await Preferences.get({ key: PREFS_TOKEN_KEY });
  return value;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(() => {
    const stored = localStorage.getItem('hm_user');
    return stored ? JSON.parse(stored) : null;
  });
  const [loading, setLoading] = useState(true);
  const tokenRef = useRef<string | null>(null);

  useEffect(() => {
    (async () => {
      // On native: restore token from secure storage and inject into API client
      if (IS_NATIVE) {
        const saved = await loadToken();
        if (saved) {
          tokenRef.current = saved;
          setNativeToken(saved);
        }
      }

      api.getMe()
        .then(u => { setUser(u); localStorage.setItem('hm_user', JSON.stringify(u)); })
        .catch(() => { localStorage.removeItem('hm_user'); clearToken(); setUser(null); })
        .finally(() => setLoading(false));
    })();
  }, []);

  const login = async (email: string, password: string) => {
    const data = await api.login(email, password);
    if (data.token) {
      tokenRef.current = data.token;
      await saveToken(data.token);
    }
    localStorage.setItem('hm_user', JSON.stringify(data.user));
    setUser(data.user);
    const full = await api.getMe().catch(() => data.user);
    setUser(full);
    localStorage.setItem('hm_user', JSON.stringify(full));
  };

  const signup = async (companyName: string, displayName: string, email: string, password: string) => {
    const data = await api.signup(companyName, displayName, email, password);
    if (data.token) {
      tokenRef.current = data.token;
      await saveToken(data.token);
    }
    localStorage.setItem('hm_user', JSON.stringify(data.user));
    setUser(data.user);
    const full = await api.getMe().catch(() => data.user);
    setUser(full);
    localStorage.setItem('hm_user', JSON.stringify(full));
  };

  const logout = async () => {
    await api.logout().catch(() => {});
    tokenRef.current = null;
    await clearToken();
    localStorage.removeItem('hm_user');
    setUser(null);
  };

  const isAtLeast = (role: string) => {
    if (!user) return false;
    return (ROLE_LEVELS[user.role] ?? 0) >= (ROLE_LEVELS[role] ?? 99);
  };

  const getToken = () => tokenRef.current;

  const canAccessReportPortal = !!user && user.role !== 'operator';
  const canAccessOperatorPortal = !!user && user.role !== 'viewer';
  const canEdit = !!user && (ROLE_LEVELS[user.role] ?? 0) >= ROLE_LEVELS.supervisor;

  return (
    <AuthContext.Provider value={{
      user, loading, login, signup, logout, isAtLeast,
      canAccessReportPortal, canAccessOperatorPortal, canEdit, getToken,
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);

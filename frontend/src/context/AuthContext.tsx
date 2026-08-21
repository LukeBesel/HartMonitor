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

      // Only validate a session that plausibly exists (stored user on web,
      // SSO-callback token marker, or saved token on native). Anonymous
      // visitors on public pages otherwise fire a guaranteed-401 /auth/me
      // probe that litters the console.
      const hasStoredSession = (IS_NATIVE && tokenRef.current)
        || !!localStorage.getItem('hm_user')
        || !!localStorage.getItem('hm_token');
      if (!hasStoredSession) { setLoading(false); return; }

      api.getMe()
        .then(u => { setUser(u); localStorage.setItem('hm_user', JSON.stringify(u)); })
        .catch((err: unknown) => {
          // Only a real 401 invalidates the session. Transient failures
          // (rate limit, offline, server hiccup) keep the stored user —
          // logging people out on a network blip is worse than a stale name.
          if ((err as { status?: number })?.status === 401) {
            localStorage.removeItem('hm_user');
            localStorage.removeItem('hm_token'); // stale SSO marker
            clearToken();
            setUser(null);
          }
        })
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
    localStorage.removeItem('hm_token'); // SSO marker
    setUser(null);
  };

  const isAtLeast = (role: string) => {
    if (!user) return false;
    return (ROLE_LEVELS[user.role] ?? 0) >= (ROLE_LEVELS[role] ?? 99);
  };

  const getToken = () => tokenRef.current;

  // Operators can move freely between the shop-floor views and the management
  // portal UNLESS the company has turned on the kiosk lock (Settings → Company),
  // which confines operator-role accounts to the Operator Portal / App Player.
  const kioskLock = !!(user as any)?.kiosk_lock;
  const canAccessReportPortal = !!user && (user.role !== 'operator' || !kioskLock);
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

import { createContext, useContext, useEffect, useState, ReactNode, useCallback } from 'react';
import { api } from '../api/client';
import type { Site } from '../types';
import { useAuth } from './AuthContext';

const STORAGE_KEY = 'hm_selected_site';

interface SiteContextValue {
  sites: Site[];
  selectedSiteId: string | null;
  setSelectedSiteId: (id: string | null) => void;
  loading: boolean;
  refresh: () => void;
}

const SiteContext = createContext<SiteContextValue | null>(null);

export function SiteProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [sites, setSites] = useState<Site[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedSiteId, setSelectedSiteIdState] = useState<string | null>(() => {
    return localStorage.getItem(STORAGE_KEY) || null;
  });

  const setSelectedSiteId = useCallback((id: string | null) => {
    setSelectedSiteIdState(id);
    if (id) localStorage.setItem(STORAGE_KEY, id);
    else localStorage.removeItem(STORAGE_KEY);
  }, []);

  const refresh = useCallback(() => {
    api.getSites().then(s => setSites(s)).catch(() => {}).finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (user) refresh();
    else { setSites([]); setLoading(false); }
  }, [user, refresh]);

  // If the persisted site no longer exists once sites have loaded, reset to "All Sites".
  useEffect(() => {
    if (loading) return;
    if (selectedSiteId && !sites.some(s => s.id === selectedSiteId)) {
      setSelectedSiteId(null);
    }
  }, [loading, sites, selectedSiteId, setSelectedSiteId]);

  return (
    <SiteContext.Provider value={{ sites, selectedSiteId, setSelectedSiteId, loading, refresh }}>
      {children}
    </SiteContext.Provider>
  );
}

export function useSite(): SiteContextValue {
  const ctx = useContext(SiteContext);
  if (!ctx) throw new Error('useSite must be used within SiteProvider');
  return ctx;
}

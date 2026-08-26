import { createContext, useContext, useEffect, useState, useCallback, ReactNode } from 'react';
import { api } from '../api/client';
import { useAuthUserId } from './AuthContext';

/** Company settings as GET /api/config returns them: a flat key/value bag. */
export type CompanySettings = Record<string, string>;

/** Where the shared settings load has got to. Readers that must not act on a
 *  default need to tell "not yet" apart from "asked, and it failed". */
export type SettingsStatus = 'loading' | 'ready' | 'error';

interface BrandingContextValue {
  companyName: string;
  logoUrl: string;
  /** The whole settings bag, so nothing else has to fetch /api/config to read
   *  one flag off it. Null until the first load lands (or when signed out). */
  settings: CompanySettings | null;
  status: SettingsStatus;
  loading: boolean;
  refresh: () => void;
}

const BrandingContext = createContext<BrandingContextValue>({
  companyName: '',
  logoUrl: '',
  settings: null,
  status: 'loading',
  loading: true,
  refresh: () => {},
});

export function BrandingProvider({ children }: { children: ReactNode }) {
  const userId = useAuthUserId();
  const [settings, setSettings] = useState<CompanySettings | null>(null);
  const [status, setStatus] = useState<SettingsStatus>('loading');

  const refresh = useCallback(() => {
    api.getCompanySettings()
      .then((data: CompanySettings) => { setSettings(data || {}); setStatus('ready'); })
      .catch(() => setStatus('error'));
  }, []);

  useEffect(() => {
    if (userId) {
      refresh();
    } else {
      setSettings(null);
      setStatus('ready');
    }
  }, [userId, refresh]);

  return (
    <BrandingContext.Provider value={{
      companyName: settings?.company_name || '',
      logoUrl: settings?.logo_url || '',
      settings,
      status,
      loading: status === 'loading',
      refresh,
    }}>
      {children}
    </BrandingContext.Provider>
  );
}

export const useBranding = () => useContext(BrandingContext);

/**
 * One company-settings flag, read from the copy the branding provider already
 * loaded. `status` says whether that copy has arrived — callers that must not
 * act on a default (the first-run welcome, the builder coach) have to wait for
 * it, and each decides for itself what a failed load should mean.
 *
 * This exists because those callers each used to fetch /api/config for
 * themselves, so opening any screen asked the server for the same key/value bag
 * three separate times.
 */
export function useCompanySetting(key: string): { value: string | undefined; status: SettingsStatus } {
  const { settings, status } = useBranding();
  return { value: settings?.[key], status };
}

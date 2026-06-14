import { createContext, useContext, useEffect, useState, useCallback, ReactNode } from 'react';
import { api } from '../api/client';
import { useAuth } from './AuthContext';

interface BrandingContextValue {
  companyName: string;
  logoUrl: string;
  loading: boolean;
  refresh: () => void;
}

const BrandingContext = createContext<BrandingContextValue>({
  companyName: '',
  logoUrl: '',
  loading: true,
  refresh: () => {},
});

export function BrandingProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [companyName, setCompanyName] = useState('');
  const [logoUrl, setLogoUrl] = useState('');
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(() => {
    api.getCompanySettings()
      .then((data: Record<string, string>) => {
        setCompanyName(data.company_name || '');
        setLogoUrl(data.logo_url || '');
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (user) {
      refresh();
    } else {
      setCompanyName('');
      setLogoUrl('');
      setLoading(false);
    }
  }, [user, refresh]);

  return (
    <BrandingContext.Provider value={{ companyName, logoUrl, loading, refresh }}>
      {children}
    </BrandingContext.Provider>
  );
}

export const useBranding = () => useContext(BrandingContext);

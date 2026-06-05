import { createContext, useContext, useEffect, useState, ReactNode } from 'react';

export interface Theme {
  accent: string;
  accentDark: string;
  accentLight: string;
  sidebarBg: string;
  name: string;
}

export const THEME_PRESETS: Theme[] = [
  { name: 'blue',   accent: '#3b82f6', accentDark: '#2563eb', accentLight: '#eff6ff', sidebarBg: '#0a1628' },
  { name: 'indigo', accent: '#6366f1', accentDark: '#4f46e5', accentLight: '#eef2ff', sidebarBg: '#0f0e2b' },
  { name: 'purple', accent: '#8b5cf6', accentDark: '#7c3aed', accentLight: '#f5f3ff', sidebarBg: '#170a2d' },
  { name: 'teal',   accent: '#14b8a6', accentDark: '#0d9488', accentLight: '#f0fdfa', sidebarBg: '#041e1c' },
  { name: 'green',  accent: '#10b981', accentDark: '#059669', accentLight: '#f0fdf4', sidebarBg: '#04200f' },
  { name: 'orange', accent: '#f59e0b', accentDark: '#d97706', accentLight: '#fffbeb', sidebarBg: '#1c1003' },
  { name: 'rose',   accent: '#f43f5e', accentDark: '#e11d48', accentLight: '#fff1f2', sidebarBg: '#200508' },
  { name: 'slate',  accent: '#64748b', accentDark: '#475569', accentLight: '#f8fafc', sidebarBg: '#0f172a' },
];

const LS_KEY = 'hm_theme';

function applyTheme(theme: Theme) {
  const root = document.documentElement;
  root.style.setProperty('--accent', theme.accent);
  root.style.setProperty('--accent-dark', theme.accentDark);
  root.style.setProperty('--accent-light', theme.accentLight);
  root.style.setProperty('--sidebar-bg', theme.sidebarBg);
}

function loadTheme(): Theme {
  try {
    const saved = localStorage.getItem(LS_KEY);
    if (saved) {
      const found = THEME_PRESETS.find(t => t.name === saved);
      if (found) return found;
    }
  } catch {
    // ignore
  }
  return THEME_PRESETS[0]; // default: blue
}

interface ThemeContextValue {
  theme: Theme;
  setTheme: (theme: Theme) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(loadTheme);

  useEffect(() => {
    applyTheme(theme);
  }, []);

  const setTheme = (newTheme: Theme) => {
    setThemeState(newTheme);
    applyTheme(newTheme);
    try {
      localStorage.setItem(LS_KEY, newTheme.name);
    } catch {
      // ignore
    }
  };

  return (
    <ThemeContext.Provider value={{ theme, setTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used within a ThemeProvider');
  return ctx;
}

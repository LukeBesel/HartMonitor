import { createContext, useContext, useEffect, useState, ReactNode } from 'react';

export interface Theme {
  accent: string;
  accentDark: string;
  accentLight: string;
  sidebarBg: string;
  /** Secondary brand color — drives the end-stop of branded gradients. */
  secondary: string;
  secondaryDark: string;
  secondaryLight: string;
  name: string;
}

export const THEME_PRESETS: Theme[] = [
  // Default: deep midnight navy sidebar with a vivid, glowing pink accent.
  { name: 'midnight', accent: '#ec4899', accentDark: '#db2777', accentLight: '#fdf2f8', sidebarBg: '#0a0e27', secondary: '#6366f1', secondaryDark: '#4f46e5', secondaryLight: '#eef2ff' },
  { name: 'blue',   accent: '#3b82f6', accentDark: '#2563eb', accentLight: '#eff6ff', sidebarBg: '#0a1628', secondary: '#6366f1', secondaryDark: '#4f46e5', secondaryLight: '#eef2ff' },
  { name: 'indigo', accent: '#6366f1', accentDark: '#4f46e5', accentLight: '#eef2ff', sidebarBg: '#0f0e2b', secondary: '#8b5cf6', secondaryDark: '#7c3aed', secondaryLight: '#f5f3ff' },
  { name: 'purple', accent: '#8b5cf6', accentDark: '#7c3aed', accentLight: '#f5f3ff', sidebarBg: '#170a2d', secondary: '#d946ef', secondaryDark: '#c026d3', secondaryLight: '#fdf4ff' },
  { name: 'teal',   accent: '#14b8a6', accentDark: '#0d9488', accentLight: '#f0fdfa', sidebarBg: '#041e1c', secondary: '#06b6d4', secondaryDark: '#0891b2', secondaryLight: '#ecfeff' },
  { name: 'green',  accent: '#10b981', accentDark: '#059669', accentLight: '#f0fdf4', sidebarBg: '#04200f', secondary: '#14b8a6', secondaryDark: '#0d9488', secondaryLight: '#f0fdfa' },
  { name: 'orange', accent: '#f59e0b', accentDark: '#d97706', accentLight: '#fffbeb', sidebarBg: '#1c1003', secondary: '#f97316', secondaryDark: '#ea580c', secondaryLight: '#fff7ed' },
  { name: 'rose',   accent: '#f43f5e', accentDark: '#e11d48', accentLight: '#fff1f2', sidebarBg: '#200508', secondary: '#ec4899', secondaryDark: '#db2777', secondaryLight: '#fdf2f8' },
  { name: 'slate',  accent: '#64748b', accentDark: '#475569', accentLight: '#f8fafc', sidebarBg: '#0f172a', secondary: '#0ea5e9', secondaryDark: '#0284c7', secondaryLight: '#f0f9ff' },
];

const LS_KEY = 'hm_theme';
const LS_DARK_KEY = 'hm_dark_mode';

// ─── Color helpers for custom accent generation ───────────────────────────────

function hexToRgb(hex: string): [number, number, number] {
  let h = hex.replace('#', '').trim();
  if (h.length === 3) h = h.split('').map(c => c + c).join('');
  const num = parseInt(h, 16);
  return [(num >> 16) & 255, (num >> 8) & 255, num & 255];
}

function rgbToHex(r: number, g: number, b: number): string {
  const clamp = (v: number) => Math.max(0, Math.min(255, Math.round(v)));
  return '#' + [r, g, b].map(v => clamp(v).toString(16).padStart(2, '0')).join('');
}

// Blend a hex color toward a target RGB by `amount` (0-1).
function mix(hex: string, target: [number, number, number], amount: number): string {
  const [r, g, b] = hexToRgb(hex);
  return rgbToHex(
    r + (target[0] - r) * amount,
    g + (target[1] - g) * amount,
    b + (target[2] - b) * amount,
  );
}

const BLACK: [number, number, number] = [0, 0, 0];
const WHITE: [number, number, number] = [255, 255, 255];

// Build a full Theme from an accent color (and optional secondary), deriving
// the rest of the palette. If no secondary is given it defaults to the accent.
export function buildCustomTheme(accent: string, secondary?: string): Theme {
  const sec = secondary || accent;
  return {
    name: 'custom',
    accent,
    accentDark: mix(accent, BLACK, 0.2),
    accentLight: mix(accent, WHITE, 0.92),
    sidebarBg: mix(accent, BLACK, 0.9),
    secondary: sec,
    secondaryDark: mix(sec, BLACK, 0.2),
    secondaryLight: mix(sec, WHITE, 0.92),
  };
}

// Return a copy of `base` with a new secondary color (and derived shades),
// keeping the accent palette intact. Used by the secondary color picker.
export function applySecondary(base: Theme, secondary: string): Theme {
  return {
    ...withSecondary(base),
    secondary,
    secondaryDark: mix(secondary, BLACK, 0.2),
    secondaryLight: mix(secondary, WHITE, 0.92),
  };
}

// Backfill secondary fields for themes saved before secondary colors existed.
function withSecondary(t: Theme): Theme {
  if (t.secondary) return t;
  return {
    ...t,
    secondary: t.accent,
    secondaryDark: t.accentDark,
    secondaryLight: t.accentLight,
  };
}

function applyTheme(theme: Theme) {
  const t = withSecondary(theme);
  const root = document.documentElement;
  root.style.setProperty('--accent', t.accent);
  root.style.setProperty('--accent-dark', t.accentDark);
  root.style.setProperty('--accent-light', t.accentLight);
  root.style.setProperty('--sidebar-bg', t.sidebarBg);
  root.style.setProperty('--secondary', t.secondary);
  root.style.setProperty('--secondary-dark', t.secondaryDark);
  root.style.setProperty('--secondary-light', t.secondaryLight);
}

function loadDarkMode(): boolean {
  try {
    const saved = localStorage.getItem(LS_DARK_KEY);
    if (saved != null) return saved === 'true';
  } catch {
    // ignore
  }
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false;
}

function applyDarkMode(dark: boolean) {
  document.documentElement.classList.toggle('dark', dark);
}

function isValidTheme(t: any): t is Theme {
  return t && typeof t.accent === 'string' && typeof t.accentDark === 'string'
    && typeof t.accentLight === 'string' && typeof t.sidebarBg === 'string';
}

function loadTheme(): Theme {
  try {
    const saved = localStorage.getItem(LS_KEY);
    if (saved) {
      // New format: full theme object stored as JSON (presets + custom colors)
      try {
        const parsed = JSON.parse(saved);
        if (isValidTheme(parsed)) return withSecondary(parsed);
      } catch {
        // Old format: just the preset name as a plain string
        const found = THEME_PRESETS.find(t => t.name === saved);
        if (found) return found;
      }
    }
  } catch {
    // ignore
  }
  return THEME_PRESETS[0]; // default: midnight
}

interface ThemeContextValue {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  darkMode: boolean;
  setDarkMode: (dark: boolean) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(loadTheme);
  const [darkMode, setDarkModeState] = useState<boolean>(loadDarkMode);

  useEffect(() => {
    applyTheme(theme);
    applyDarkMode(darkMode);
  }, []);

  const setTheme = (newTheme: Theme) => {
    setThemeState(newTheme);
    applyTheme(newTheme);
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(newTheme));
    } catch {
      // ignore
    }
  };

  const setDarkMode = (dark: boolean) => {
    setDarkModeState(dark);
    applyDarkMode(dark);
    try {
      localStorage.setItem(LS_DARK_KEY, String(dark));
    } catch {
      // ignore
    }
  };

  return (
    <ThemeContext.Provider value={{ theme, setTheme, darkMode, setDarkMode }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used within a ThemeProvider');
  return ctx;
}

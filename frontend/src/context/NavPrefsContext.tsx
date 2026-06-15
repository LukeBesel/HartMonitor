import { createContext, useContext, useState, ReactNode } from 'react';
import type { SectionId } from '../config/navigation';

const HIDDEN_KEY = 'hm_hidden_nav';
const HIDDEN_SECTIONS_KEY = 'hm_hidden_sections';
const FOCUS_KEY = 'hm_nav_focus';

export type Focus = SectionId;

function loadSet(key: string): Set<string> {
  try {
    const raw = localStorage.getItem(key);
    if (raw) return new Set(JSON.parse(raw));
  } catch {
    // ignore
  }
  return new Set();
}

function saveSet(key: string, set: Set<string>) {
  try {
    localStorage.setItem(key, JSON.stringify([...set]));
  } catch {
    // ignore
  }
}

interface NavPrefsContextValue {
  // Individual item visibility (advanced)
  hiddenItems: Set<string>;
  isItemHidden: (to: string) => boolean;
  toggleItem: (to: string) => void;
  // Whole-workspace visibility
  hiddenSections: Set<string>;
  isSectionHidden: (id: SectionId) => boolean;
  toggleSection: (id: SectionId) => void;
  // Which workspace is currently focused (also the persisted default)
  focus: Focus;
  setFocus: (f: Focus) => void;
  resetNavPrefs: () => void;
}

const NavPrefsContext = createContext<NavPrefsContextValue | null>(null);

export function NavPrefsProvider({ children }: { children: ReactNode }) {
  const [hiddenItems, setHiddenItems] = useState<Set<string>>(() => loadSet(HIDDEN_KEY));
  const [hiddenSections, setHiddenSections] = useState<Set<string>>(() => loadSet(HIDDEN_SECTIONS_KEY));
  const [focus, setFocusState] = useState<Focus>(() => {
    try {
      const stored = localStorage.getItem(FOCUS_KEY);
      if (stored && stored !== 'all') return stored as Focus;
    } catch { /* ignore */ }
    return 'production';
  });

  const toggleItem = (to: string) => {
    setHiddenItems(prev => {
      const next = new Set(prev);
      if (next.has(to)) next.delete(to);
      else next.add(to);
      saveSet(HIDDEN_KEY, next);
      return next;
    });
  };

  const toggleSection = (id: SectionId) => {
    setHiddenSections(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      saveSet(HIDDEN_SECTIONS_KEY, next);
      return next;
    });
  };

  const setFocus = (f: Focus) => {
    setFocusState(f);
    try { localStorage.setItem(FOCUS_KEY, f); } catch { /* ignore */ }
  };

  const resetNavPrefs = () => {
    setHiddenItems(new Set());
    setHiddenSections(new Set());
    setFocusState('production');
    saveSet(HIDDEN_KEY, new Set());
    saveSet(HIDDEN_SECTIONS_KEY, new Set());
    try { localStorage.setItem(FOCUS_KEY, 'production'); } catch { /* ignore */ }
  };

  return (
    <NavPrefsContext.Provider
      value={{
        hiddenItems,
        isItemHidden: (to) => hiddenItems.has(to),
        toggleItem,
        hiddenSections,
        isSectionHidden: (id) => hiddenSections.has(id),
        toggleSection,
        focus,
        setFocus,
        resetNavPrefs,
      }}
    >
      {children}
    </NavPrefsContext.Provider>
  );
}

export function useNavPrefs(): NavPrefsContextValue {
  const ctx = useContext(NavPrefsContext);
  if (!ctx) throw new Error('useNavPrefs must be used within a NavPrefsProvider');
  return ctx;
}

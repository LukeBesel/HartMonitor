import { createContext, useContext, useState, ReactNode } from 'react';
import type { SectionId } from '../config/navigation';

const HIDDEN_KEY = 'hm_hidden_nav';
const HIDDEN_SECTIONS_KEY = 'hm_hidden_sections';
const FOCUS_KEY = 'hm_nav_focus';
const ORDER_KEY = 'hm_nav_order';
const PRO_SIDEBAR_KEY = 'hm_show_pro_sidebar';

export type Focus = SectionId;

function loadSet(key: string, fallback: string[] = []): Set<string> {
  try {
    const raw = localStorage.getItem(key);
    if (raw) return new Set(JSON.parse(raw));
  } catch {
    // ignore
  }
  return new Set(fallback);
}

function saveSet(key: string, set: Set<string>) {
  try {
    localStorage.setItem(key, JSON.stringify([...set]));
  } catch {
    // ignore
  }
}

function loadOrder(): Record<string, string[]> {
  try {
    const raw = localStorage.getItem(ORDER_KEY);
    if (raw) return JSON.parse(raw);
  } catch { /* ignore */ }
  return {};
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
  // Custom item ordering per section (developer-controlled). Maps sectionId →
  // an ordered list of item `to` paths. Items not listed keep their natural order.
  itemOrder: Record<string, string[]>;
  moveItem: (sectionId: string, to: string, direction: 'up' | 'down', currentOrder: string[]) => void;
  // Developer preview: show Pro-locked items in the sidebar even on Free.
  showProSidebar: boolean;
  setShowProSidebar: (v: boolean) => void;
  resetNavPrefs: () => void;
}

const NavPrefsContext = createContext<NavPrefsContextValue | null>(null);

export function NavPrefsProvider({ children }: { children: ReactNode }) {
  const [hiddenItems, setHiddenItems] = useState<Set<string>>(() => loadSet(HIDDEN_KEY));
  // Planning is off by default — it stays out of the sidebar until the user
  // explicitly enables it in Settings (then the toggle reveals it).
  const [hiddenSections, setHiddenSections] = useState<Set<string>>(() => loadSet(HIDDEN_SECTIONS_KEY, ['planning']));
  const [itemOrder, setItemOrder] = useState<Record<string, string[]>>(() => loadOrder());
  const [showProSidebar, setShowProSidebarState] = useState<boolean>(() => {
    try { return localStorage.getItem(PRO_SIDEBAR_KEY) === 'true'; } catch { return false; }
  });
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

  const setShowProSidebar = (v: boolean) => {
    setShowProSidebarState(v);
    try {
      if (v) localStorage.setItem(PRO_SIDEBAR_KEY, 'true');
      else localStorage.removeItem(PRO_SIDEBAR_KEY);
    } catch { /* ignore */ }
  };

  // Reorder one item within a section. `currentOrder` is the section's current
  // displayed order of item paths; we swap the target with its neighbour and persist.
  const moveItem = (sectionId: string, to: string, direction: 'up' | 'down', currentOrder: string[]) => {
    const order = [...currentOrder];
    const i = order.indexOf(to);
    if (i === -1) return;
    const j = direction === 'up' ? i - 1 : i + 1;
    if (j < 0 || j >= order.length) return;
    [order[i], order[j]] = [order[j], order[i]];
    setItemOrder(prev => {
      const next = { ...prev, [sectionId]: order };
      try { localStorage.setItem(ORDER_KEY, JSON.stringify(next)); } catch { /* ignore */ }
      return next;
    });
  };

  const resetNavPrefs = () => {
    setHiddenItems(new Set());
    setHiddenSections(new Set(['planning']));
    setItemOrder({});
    setFocusState('production');
    saveSet(HIDDEN_KEY, new Set());
    saveSet(HIDDEN_SECTIONS_KEY, new Set(['planning']));
    try {
      localStorage.setItem(FOCUS_KEY, 'production');
      localStorage.removeItem(ORDER_KEY);
    } catch { /* ignore */ }
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
        itemOrder,
        moveItem,
        showProSidebar,
        setShowProSidebar,
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

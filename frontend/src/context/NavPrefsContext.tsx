import { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';
import type { SectionId } from '../config/navigation';
import { useAuth, useAuthUserId } from './AuthContext';
import {
  fetchNavHiddenSections, saveNavHiddenSections, parseHiddenSections,
} from '../api/settings';

const HIDDEN_KEY = 'hm_hidden_nav';
const HIDDEN_SECTIONS_KEY = 'hm_hidden_sections';
const ORDER_KEY = 'hm_nav_order';

// Which workspaces this plant shows is a fact about the plant, so it lives in
// org_settings and follows the company onto every screen and every device (see
// api/settings.ts). The two switches below it — per-item visibility and the
// developer-only item order — stay on the device: they are one person tuning
// their own sidebar, and they were never the thing that surprised a second
// tablet with a different navigation.


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
  // Whole-workspace visibility — company-wide, saved in org_settings.
  hiddenSections: Set<string>;
  isSectionHidden: (id: SectionId) => boolean;
  toggleSection: (id: SectionId) => void;
  /** True until the company's saved workspaces have been read back. */
  sectionsLoading: boolean;
  /** Set when the last write was refused (an operator, or the server said no). */
  sectionsError: string | null;
  // Custom item ordering per section (developer-controlled). Maps sectionId →
  // an ordered list of item `to` paths. Items not listed keep their natural order.
  itemOrder: Record<string, string[]>;
  moveItem: (sectionId: string, to: string, direction: 'up' | 'down', currentOrder: string[]) => void;
  resetNavPrefs: () => void;
}

const NavPrefsContext = createContext<NavPrefsContextValue | null>(null);

export function NavPrefsProvider({ children }: { children: ReactNode }) {
  const { isAtLeast } = useAuth();
  const userId = useAuthUserId();
  const [hiddenItems, setHiddenItems] = useState<Set<string>>(() => loadSet(HIDDEN_KEY));
  // All workspaces are visible by default; a manager can hide the ones the
  // plant does not use from Settings. (The retired 'planning' section may
  // linger in stored prefs — it no longer matches a section id, so it is
  // simply ignored.)
  const [hiddenSections, setHiddenSections] = useState<Set<string>>(new Set());
  const [sectionsLoading, setSectionsLoading] = useState(true);
  const [sectionsError, setSectionsError] = useState<string | null>(null);
  const [itemOrder, setItemOrder] = useState<Record<string, string[]>>(() => loadOrder());

  // Read the company's answer once a session exists. Signed out, there is no
  // company to ask and no sidebar to hide anything from.
  useEffect(() => {
    let cancelled = false;
    if (!userId) {
      setHiddenSections(new Set());
      setSectionsLoading(false);
      return;
    }
    setSectionsLoading(true);
    (async () => {
      try {
        const stored = await fetchNavHiddenSections();
        if (cancelled) return;
        if (stored !== null) {
          setHiddenSections(new Set(stored));
          // The company has an answer, so this device's old copy is history.
          try { localStorage.removeItem(HIDDEN_SECTIONS_KEY); } catch { /* ignore */ }
        } else {
          // First run against a company that has never saved: adopt whatever
          // this device was carrying, hand it to the company once, and forget
          // the local copy. A member who may not write simply keeps showing it
          // until somebody who may does.
          const local = parseHiddenSections(localStorage.getItem(HIDDEN_SECTIONS_KEY));
          setHiddenSections(new Set(local));
          if (isAtLeast('manager')) {
            try {
              await saveNavHiddenSections(local);
              try { localStorage.removeItem(HIDDEN_SECTIONS_KEY); } catch { /* ignore */ }
            } catch { /* the local value stays until a write succeeds */ }
          }
        }
      } catch {
        // No answer from the server is not a reason to hide workspaces.
        if (!cancelled) setHiddenSections(new Set());
      } finally {
        if (!cancelled) setSectionsLoading(false);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  const toggleItem = (to: string) => {
    setHiddenItems(prev => {
      const next = new Set(prev);
      if (next.has(to)) next.delete(to);
      else next.add(to);
      saveSet(HIDDEN_KEY, next);
      return next;
    });
  };

  // Company-wide: show the change straight away, then persist it. If the
  // server refuses (an operator may not rearrange the plant's navigation) the
  // sidebar goes back to what the company actually has saved.
  const persistSections = useCallback(async (next: Set<string>, previous: Set<string>) => {
    setSectionsError(null);
    try {
      await saveNavHiddenSections([...next]);
    } catch (err: any) {
      setHiddenSections(previous);
      setSectionsError(err?.message || 'Could not save which workspaces this company shows.');
    }
  }, []);

  const toggleSection = (id: SectionId) => {
    setHiddenSections(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      void persistSections(next, prev);
      return next;
    });
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
    setItemOrder({});
    saveSet(HIDDEN_KEY, new Set());
    setHiddenSections(prev => {
      void persistSections(new Set(), prev);
      return new Set();
    });
    try {
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
        sectionsLoading,
        sectionsError,
        itemOrder,
        moveItem,
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

import {
  createContext, useContext, useState, useEffect, useRef, useCallback, ReactNode,
} from 'react';
import type { SectionId } from '../config/navigation';
import { useAuth, useAuthUserId } from './AuthContext';
import {
  fetchNavHiddenSections, saveNavHiddenSections, parseHiddenSections,
} from '../api/settings';

const HIDDEN_KEY = 'hm_hidden_nav';
const HIDDEN_SECTIONS_KEY = 'hm_hidden_sections';
const ORDER_KEY = 'hm_nav_order';
// Not a preference: a copy of the last answer the SERVER gave this device, so
// the sidebar's first paint after a reload is the company's real navigation
// rather than "everything, briefly". The server always wins once it answers.
const SECTIONS_CACHE_KEY = 'hm_nav_sections_cache';

// Which workspaces this plant shows is a fact about the plant, so it lives in
// org_settings and follows the company onto every screen and every device (see
// api/settings.ts). The two switches beside it — per-item visibility and the
// developer-only item order — stay on the device: they are one person tuning
// their own sidebar, they are open to every role, and they were never the
// thing that surprised a second tablet with a different navigation.

/** How long to let a run of toggles settle before saving them as one change. */
const SAVE_DEBOUNCE_MS = 500;

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

/** The last server answer this device saw, or the pre-move local value. */
function loadCachedSections(): { ids: string[]; had: boolean } {
  try {
    const cached = localStorage.getItem(SECTIONS_CACHE_KEY);
    if (cached !== null) return { ids: parseHiddenSections(cached), had: true };
    const legacy = localStorage.getItem(HIDDEN_SECTIONS_KEY);
    if (legacy !== null) return { ids: parseHiddenSections(legacy), had: true };
  } catch { /* ignore */ }
  return { ids: [], had: false };
}

function cacheSections(ids: Iterable<string>) {
  try { localStorage.setItem(SECTIONS_CACHE_KEY, JSON.stringify([...ids])); } catch { /* ignore */ }
}

interface NavPrefsContextValue {
  // Individual item visibility — this device only, every role.
  hiddenItems: Set<string>;
  isItemHidden: (to: string) => boolean;
  toggleItem: (to: string) => void;
  // Whole-workspace visibility — company-wide, saved in org_settings.
  hiddenSections: Set<string>;
  isSectionHidden: (id: SectionId) => boolean;
  toggleSection: (id: SectionId) => void;
  /** True until the company's saved workspaces have been read back, and no
   *  cached answer from a previous visit is standing in for them. */
  sectionsLoading: boolean;
  /** Set when the last write was refused (an operator, or the server said no). */
  sectionsError: string | null;
  // Custom item ordering per section (developer-controlled). Maps sectionId →
  // an ordered list of item `to` paths. Items not listed keep their natural order.
  itemOrder: Record<string, string[]>;
  moveItem: (sectionId: string, to: string, direction: 'up' | 'down', currentOrder: string[]) => void;
  /** Show every workspace again — for the whole company. Manager and above. */
  resetWorkspaces: () => void;
  /** Undo this device's own per-item hiding and ordering. Any role. */
  resetMyNavPrefs: () => void;
}

const NavPrefsContext = createContext<NavPrefsContextValue | null>(null);

export function NavPrefsProvider({ children }: { children: ReactNode }) {
  const { isAtLeast } = useAuth();
  const userId = useAuthUserId();
  const [hiddenItems, setHiddenItems] = useState<Set<string>>(() => loadSet(HIDDEN_KEY));
  // Seeded from the last answer this device saw so the sidebar does not paint
  // workspaces the company has turned off and then snatch them away.
  const seed = useRef(loadCachedSections()).current;
  const [hiddenSections, setHiddenSections] = useState<Set<string>>(() => new Set(seed.ids));
  const [sectionsLoading, setSectionsLoading] = useState(!seed.had);
  const [sectionsError, setSectionsError] = useState<string | null>(null);
  const [itemOrder, setItemOrder] = useState<Record<string, string[]>>(() => loadOrder());

  // What the server has actually confirmed, so a refused write can put the
  // switches back to the truth rather than to whatever was on screen.
  const confirmed = useRef<Set<string>>(new Set(seed.ids));
  // The set a debounced save will send, and its timer.
  const pending = useRef<Set<string> | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flush = useCallback(async () => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    const next = pending.current;
    if (!next) return;
    pending.current = null;
    try {
      await saveNavHiddenSections([...next]);
      confirmed.current = next;
      cacheSections(next);
      setSectionsError(null);
    } catch (err: any) {
      setHiddenSections(confirmed.current);
      setSectionsError(err?.message || 'Could not save which sections this company shows.');
    }
  }, []);

  // One PUT for a run of toggles, not one per switch: flicking four workspaces
  // off is one decision, and it used to be four writes and four activity rows.
  const scheduleSave = useCallback((next: Set<string>) => {
    pending.current = next;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => { void flush(); }, SAVE_DEBOUNCE_MS);
  }, [flush]);

  // Read the company's answer once a session exists. Signed out, there is no
  // company to ask and no sidebar to hide anything from.
  useEffect(() => {
    let cancelled = false;
    if (!userId) {
      setHiddenSections(new Set());
      confirmed.current = new Set();
      setSectionsLoading(false);
      return;
    }
    (async () => {
      try {
        const stored = await fetchNavHiddenSections();
        if (cancelled) return;
        if (stored !== null) {
          const next = new Set(stored);
          setHiddenSections(next);
          confirmed.current = next;
          cacheSections(next);
          // The company has an answer, so this device's old copy is history.
          try { localStorage.removeItem(HIDDEN_SECTIONS_KEY); } catch { /* ignore */ }
        } else {
          // First run against a company that has never saved: adopt whatever
          // this device was carrying, hand it to the company once, and forget
          // the local copy. A member who may not write simply keeps showing it
          // until somebody who may does.
          const local = parseHiddenSections(localStorage.getItem(HIDDEN_SECTIONS_KEY));
          const next = new Set(local);
          setHiddenSections(next);
          confirmed.current = next;
          cacheSections(next);
          if (isAtLeast('manager')) {
            try {
              await saveNavHiddenSections(local);
              try { localStorage.removeItem(HIDDEN_SECTIONS_KEY); } catch { /* ignore */ }
            } catch { /* the local value stays until a write succeeds */ }
          }
        }
      } catch {
        // No answer from the server is not a reason to change what is on
        // screen: the cached answer from last time is the better guess.
      } finally {
        if (!cancelled) setSectionsLoading(false);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  // A toggle a second before navigating away is still a decision. Send it.
  useEffect(() => () => { void flush(); }, [flush]);

  const toggleItem = (to: string) => {
    const next = new Set(hiddenItems);
    if (next.has(to)) next.delete(to);
    else next.add(to);
    setHiddenItems(next);
    saveSet(HIDDEN_KEY, next);
  };

  // Company-wide: show the change straight away, then persist it once the
  // clicking stops. If the server refuses (an operator may not rearrange the
  // plant's navigation) the switches go back to what the company has saved.
  const toggleSection = (id: SectionId) => {
    const next = new Set(hiddenSections);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setHiddenSections(next);
    scheduleSave(next);
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
    const next = { ...itemOrder, [sectionId]: order };
    setItemOrder(next);
    try { localStorage.setItem(ORDER_KEY, JSON.stringify(next)); } catch { /* ignore */ }
  };

  const resetWorkspaces = () => {
    const next = new Set<string>();
    setHiddenSections(next);
    scheduleSave(next);
  };

  const resetMyNavPrefs = () => {
    setHiddenItems(new Set());
    setItemOrder({});
    saveSet(HIDDEN_KEY, new Set());
    try { localStorage.removeItem(ORDER_KEY); } catch { /* ignore */ }
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
        resetWorkspaces,
        resetMyNavPrefs,
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

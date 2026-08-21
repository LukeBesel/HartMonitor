// Builder-first guided training — the state layer.
//
// This is a REAL walkthrough, not a help article: every milestone below is
// derived from what the company has actually built and run (the apps blob and
// the completions table), so ticking a box requires doing the thing. The only
// locally-tracked milestone is the last one ("look at what got captured"),
// which is a navigation event and has nothing in the database to read.
//
// Progress therefore follows the account, not the browser. Only the user's
// own dismiss / collapse preferences live in localStorage.

import { useCallback, useEffect, useState } from 'react';
import { api } from '../../api/client';
import type { App } from '../../types';
import { appShape } from './appModel';

export type TrainingStepId =
  | 'create' | 'steps' | 'widgets' | 'trigger' | 'publish' | 'run' | 'data';

export interface TrainingStepDef {
  id: TrainingStepId;
  title: string;
  /** One or two sentences: what to do and why it matters. */
  body: string;
  /** Label for the button that takes the user to the right screen. */
  cta: string;
}

export const TRAINING_STEPS: TrainingStepDef[] = [
  {
    id: 'create',
    title: 'Create your first app',
    body: 'An app is a guided procedure your operators run on a tablet. Start from a HartMonitor model template — it comes with real steps you can edit — or from a blank app.',
    cta: 'Pick a starting point',
  },
  {
    id: 'steps',
    title: 'Add a step',
    body: 'Steps are the screens an operator walks through, one at a time. Add a second step in the builder’s step list so the app has a sequence.',
    cta: 'Open the builder',
  },
  {
    id: 'widgets',
    title: 'Add widgets to a step',
    body: 'Widgets are what an operator sees and fills in — instructions, photos, pass/fail checks, numbers, scans. Drop a couple onto the canvas from the palette above it.',
    cta: 'Add widgets',
  },
  {
    id: 'trigger',
    title: 'Set one trigger',
    body: 'Triggers are the no-code logic: When this happens → If this is true → Then do that. Open the Triggers tab in the right-hand panel and add one, e.g. "when the check fails, block with an error".',
    cta: 'Open Triggers',
  },
  {
    id: 'publish',
    title: 'Preview, then publish',
    body: 'Preview walks the app exactly as an operator sees it. When it reads right, publish — stations pick up the new version instantly.',
    cta: 'Preview & publish',
  },
  {
    id: 'run',
    title: 'Run it in the player',
    body: 'Open the operator player and complete a run yourself. This is the screen your floor actually uses, so it is worth doing once end to end.',
    cta: 'Run the app',
  },
  {
    id: 'data',
    title: 'See the captured data',
    body: 'Every value an operator enters is stored against the run. Open the app’s analytics to see the numbers, pass rates and per-run records you just created.',
    cta: 'See the data',
  },
];

export interface TrainingMilestone {
  def: TrainingStepDef;
  done: boolean;
}

export interface AppTrainingState {
  loading: boolean;
  error: string | null;
  milestones: TrainingMilestone[];
  doneCount: number;
  total: number;
  /** Index of the first unfinished milestone, or -1 when everything is done. */
  activeIndex: number;
  complete: boolean;
  dismissed: boolean;
  collapsed: boolean;
  /** The app the training is following (most recently edited), if any. */
  targetApp: App | null;
  /** A published app to run, preferring the app being taught with. */
  runnableApp: App | null;
  setCollapsed: (v: boolean) => void;
  dismiss: () => void;
  restart: () => void;
  refresh: () => void;
}

// ── Per-user preferences (dismiss / collapse / "data seen") ──────────────────

interface Prefs { dismissed: boolean; collapsed: boolean; dataSeen: boolean }

const DEFAULT_PREFS: Prefs = { dismissed: false, collapsed: false, dataSeen: false };
const PREFS_EVENT = 'hm:app-training-prefs';

function prefsKey(userId: string | undefined): string {
  return `hm_app_training_${userId || 'anon'}`;
}

function readPrefs(userId: string | undefined): Prefs {
  try {
    const raw = localStorage.getItem(prefsKey(userId));
    if (!raw) return DEFAULT_PREFS;
    const parsed = JSON.parse(raw) as Partial<Prefs>;
    return {
      dismissed: !!parsed.dismissed,
      collapsed: !!parsed.collapsed,
      dataSeen: !!parsed.dataSeen,
    };
  } catch {
    return DEFAULT_PREFS;
  }
}

function writePrefs(userId: string | undefined, prefs: Prefs): void {
  try {
    localStorage.setItem(prefsKey(userId), JSON.stringify(prefs));
  } catch {
    /* private mode — training still works, it just won't remember */
  }
  try {
    window.dispatchEvent(new CustomEvent(PREFS_EVENT));
  } catch {
    /* older browsers — the local component state already updated */
  }
}

/** Called by the analytics / run-history surfaces: the user has now seen the
 *  data a run captured, which is the final training milestone. */
export function markTrainingDataSeen(userId: string | undefined): void {
  const prefs = readPrefs(userId);
  if (prefs.dataSeen) return;
  writePrefs(userId, { ...prefs, dataSeen: true });
}

/** Reset a user's training so the coach reappears from step one. */
export function restartTraining(userId: string | undefined): void {
  writePrefs(userId, { dismissed: false, collapsed: false, dataSeen: false });
}

// ── The hook ─────────────────────────────────────────────────────────────────

/** Derives training progress from real account data. `watchKey` (usually the
 *  current pathname) re-checks progress whenever the user moves around, so
 *  finishing a step in the builder ticks the box when they come back.
 *  `enabled` false skips the network entirely — the coach is mounted app-wide,
 *  and nobody should pay for progress checks on screens that never show it. */
export function useAppTraining(
  userId: string | undefined,
  watchKey?: string,
  enabled = true,
): AppTrainingState {
  const [prefs, setPrefs] = useState<Prefs>(() => readPrefs(userId));
  const [apps, setApps] = useState<App[]>([]);
  const [hasCompletions, setHasCompletions] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

  useEffect(() => { setPrefs(readPrefs(userId)); }, [userId]);

  // Keep multiple mounted readers (coach + any page badge) in sync.
  useEffect(() => {
    const sync = () => setPrefs(readPrefs(userId));
    window.addEventListener(PREFS_EVENT, sync);
    window.addEventListener('storage', sync);
    return () => {
      window.removeEventListener(PREFS_EVENT, sync);
      window.removeEventListener('storage', sync);
    };
  }, [userId]);

  useEffect(() => {
    if (!userId || !enabled || prefs.dismissed) { setLoading(false); return; }
    let cancelled = false;
    setError(null);
    Promise.all([api.getApps(), api.getAppsStats()])
      .then(([appList, stats]) => {
        if (cancelled) return;
        setApps(Array.isArray(appList) ? (appList as App[]) : []);
        setHasCompletions(!!stats?.company_has_completions);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : 'Could not check your progress');
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [userId, watchKey, nonce, enabled, prefs.dismissed]);

  const shapes = apps.map(a => appShape(a));
  const hasApp = apps.length > 0;
  const hasSteps = shapes.some(s => s.stepCount >= 2);
  const hasWidgets = shapes.some(s => s.widgetCount >= 1);
  const hasTrigger = shapes.some(s => s.triggerCount >= 1);
  const hasPublished = apps.some(a => a.status === 'published');

  const doneById: Record<TrainingStepId, boolean> = {
    create: hasApp,
    steps: hasSteps,
    widgets: hasWidgets,
    trigger: hasTrigger,
    publish: hasPublished,
    run: hasCompletions,
    // Only truthful once there is data to have looked at.
    data: hasCompletions && prefs.dataSeen,
  };

  const milestones = TRAINING_STEPS.map(def => ({ def, done: doneById[def.id] }));
  const doneCount = milestones.filter(m => m.done).length;
  const activeIndex = milestones.findIndex(m => !m.done);

  // getApps() sorts by updated_at DESC, so apps[0] is what the user last touched.
  const targetApp = apps[0] ?? null;
  const runnableApp =
    (targetApp && targetApp.status === 'published' ? targetApp : null)
    ?? apps.find(a => a.status === 'published')
    ?? null;

  const update = useCallback((patch: Partial<Prefs>) => {
    setPrefs(prev => {
      const next = { ...prev, ...patch };
      writePrefs(userId, next);
      return next;
    });
  }, [userId]);

  return {
    loading,
    error,
    milestones,
    doneCount,
    total: milestones.length,
    activeIndex,
    complete: activeIndex === -1,
    dismissed: prefs.dismissed,
    collapsed: prefs.collapsed,
    targetApp,
    runnableApp,
    setCollapsed: (v: boolean) => update({ collapsed: v }),
    dismiss: () => update({ dismissed: true }),
    restart: () => update({ dismissed: false, collapsed: false, dataSeen: false }),
    refresh: () => setNonce(n => n + 1),
  };
}

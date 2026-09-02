import { useState, useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { CheckCircle, Circle, ChevronDown, ChevronUp, X } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useModules } from '../../context/ModulesContext';
import { api } from '../../api/client';
import type { App } from '../../types';
import {
  readTrainingPrefs, trainingGraduated, TRAINING_PREFS_EVENT,
} from '../apps/useAppTraining';

interface ChecklistItem {
  id: string;
  label: string;
  done: boolean;
  /** Where the item is actually done. Rendered as a link while it is open. */
  to?: string;
}

// Apps-first on purpose: the fastest route to a working HartMonitor is build →
// publish → run.
//
// Those three used to be three separate boxes here, and the last two both
// pointed at /apps — the screen you are usually already looking at when you
// read them. They read like instructions and behaved like nothing. The guided
// training coach teaches that arc properly, one step at a time, with a button
// that goes to the right place at each step, so this list keeps a single box
// for the whole arc and leaves the teaching to the coach. What remains here is
// the account setup the coach never covers.
//
// "Set up a work station" used to sit between the app and the team. The publish
// modal in AppBuilder says "You can leave these blank to publish without a
// target", and the player's start screen labels the field "Station (optional)"
// — so this list was raising, as an unticked setup step, the exact thing the
// product had just told the same person they could skip. Two screens, opposite
// advice, one account. The other two are right, so the box is gone.
//
// Every box below ticks itself from real data.
const INITIAL_ITEMS: ChecklistItem[] = [
  { id: 'account',  label: 'Create account',               done: true },
  { id: 'app',      label: 'Build and run your first app', done: false, to: '/apps' },
  { id: 'team',     label: 'Invite a team member',         done: false, to: '/settings?tab=users' },
];

type LoadState = 'loading' | 'ready' | 'error';

export function SetupChecklist() {
  const { user, canEdit } = useAuth();
  const { isEnabled } = useModules();
  const { pathname } = useLocation();
  const [items, setItems] = useState<ChecklistItem[]>(INITIAL_ITEMS);
  const [loadState, setLoadState] = useState<LoadState>('loading');
  const [coachRunning, setCoachRunning] = useState(false);
  const [expanded, setExpanded] = useState(true);
  const [dismissed, setDismissed] = useState(false);

  const appsEnabled = isEnabled('apps');

  useEffect(() => {
    // Check localStorage for dismissed state
    const key = `setup_dismissed_${user?.id}`;
    if (localStorage.getItem(key)) { setDismissed(true); return; }

    let cancelled = false;

    // Check which items are actually done
    (async () => {
      try {
        const [apps, stats, users] = await Promise.all([
          api.getApps(),
          api.getAppsStats().catch(() => null),
          api.getUsers(),
        ]);
        if (cancelled) return;
        const ranOnFloor = !!stats?.company_has_completions;
        setItems(prev => prev.map(item => {
          // Built, published AND run. Anything short of that is not yet a
          // working app on the floor, which is what this box claims.
          if (item.id === 'app')  return { ...item, done: ranOnFloor };
          if (item.id === 'team') return { ...item, done: users.length > 1 };
          return item;
        }));

        // Two progress trackers with different denominators on screen at the
        // same time ("2/6 complete" here, "3 of 6 done" in the coach) is
        // confusing even though each is right about its own thing. The coach is
        // the deeper of the two and it is the one actively teaching, so this
        // list stands down until the training is finished or dismissed.
        // Same question the coach asks itself, so the two can never both be on
        // screen and can never both be absent: the coach is running until the
        // account has a published app and a completed run (or the user
        // dismissed it), and this list waits for exactly that moment.
        const prefs = readTrainingPrefs(user?.id);
        const graduated = trainingGraduated(Array.isArray(apps) ? (apps as App[]) : [], ranOnFloor);
        setCoachRunning(canEdit && appsEnabled && !prefs.dismissed && !graduated);
        setLoadState('ready');
      } catch {
        // No progress read means there is nothing truthful to show. An
        // all-unticked list in front of someone who has already built ten apps
        // is worse than no list.
        if (!cancelled) setLoadState('error');
      }
    })();

    return () => { cancelled = true; };
  }, [user?.id, canEdit, appsEnabled]);

  // Dismissing or finishing the coach hands this list back over straight away.
  useEffect(() => {
    const sync = () => {
      if (readTrainingPrefs(user?.id).dismissed) setCoachRunning(false);
    };
    window.addEventListener(TRAINING_PREFS_EVENT, sync);
    window.addEventListener('storage', sync);
    return () => {
      window.removeEventListener(TRAINING_PREFS_EVENT, sync);
      window.removeEventListener('storage', sync);
    };
  }, [user?.id]);

  const allDone = items.every(i => i.done);
  const doneCount = items.filter(i => i.done).length;

  if (dismissed || allDone || coachRunning || loadState !== 'ready') return null;

  const dismiss = () => {
    localStorage.setItem(`setup_dismissed_${user?.id}`, '1');
    setDismissed(true);
  };

  return (
    // Lives inside the nav's scroll container, below the workspaces, so it can
    // stay expanded at any viewport height without hiding navigation. It used
    // to guess from window.innerHeight whether there was room, and the guess
    // was wrong on every common laptop size.
    <div className="mt-3 mb-1 bg-blue-950/60 border border-blue-700/40 rounded-lg overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between p-3 text-left"
      >
        <div>
          <p className="text-xs font-semibold text-blue-300">Setup checklist</p>
          <p className="text-xs text-blue-400">{doneCount}/{items.length} complete</p>
        </div>
        <div className="flex items-center gap-1">
          {expanded ? <ChevronUp size={14} className="text-blue-400" /> : <ChevronDown size={14} className="text-blue-400" />}
        </div>
      </button>
      {expanded && (
        <div className="px-3 pb-3 space-y-2">
          {items.map(item => {
            const icon = item.done
              ? <CheckCircle size={14} className="text-green-400 shrink-0" />
              : <Circle size={14} className="text-blue-500/50 shrink-0" />;
            const label = (
              <span className={`text-xs ${item.done ? 'text-gray-400 line-through' : 'text-blue-200'}`}>
                {item.label}
              </span>
            );
            // A link to the screen you are already reading it on is a step that
            // does nothing when you follow it. Those render as plain text.
            const isHere = !!item.to && pathname === item.to.split('?')[0];
            if (item.done || !item.to || isHere) {
              return <div key={item.id} className="flex items-center gap-2">{icon}{label}</div>;
            }
            return (
              <Link key={item.id} to={item.to} className="flex items-center gap-2 group">
                {icon}
                <span className="group-hover:underline underline-offset-2">{label}</span>
              </Link>
            );
          })}
          <button onClick={dismiss} className="flex items-center gap-1 text-xs text-blue-500 hover:text-blue-300 mt-2">
            <X size={12} /> Dismiss
          </button>
        </div>
      )}
    </div>
  );
}

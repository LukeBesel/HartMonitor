import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { CheckCircle, Circle, ChevronDown, ChevronUp, X } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { api } from '../../api/client';

interface ChecklistItem {
  id: string;
  label: string;
  done: boolean;
  /** Where the item is actually done. Rendered as a link while it is open. */
  to?: string;
}

// Apps-first on purpose: the fastest route to a working HartMonitor is build →
// publish → run, and every one of these boxes ticks itself from real data.
const INITIAL_ITEMS: ChecklistItem[] = [
  { id: 'account',  label: 'Create account',        done: true },
  { id: 'app',      label: 'Build your first app',  done: false, to: '/apps?new=1' },
  { id: 'publish',  label: 'Publish it',            done: false, to: '/apps' },
  { id: 'run',      label: 'Run it on the floor',   done: false, to: '/apps' },
  { id: 'station',  label: 'Set up a work station', done: false, to: '/stations' },
  { id: 'team',     label: 'Invite a team member',  done: false, to: '/settings?tab=users' },
];

export function SetupChecklist() {
  const { user } = useAuth();
  const [items, setItems] = useState<ChecklistItem[]>(INITIAL_ITEMS);
  // Start collapsed on short (laptop) viewports so the checklist never crowds
  // the nav — expanding is one tap away.
  const [expanded, setExpanded] = useState(() => {
    try { return window.innerHeight >= 800; } catch { return true; }
  });
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    // Check localStorage for dismissed state
    const key = `setup_dismissed_${user?.id}`;
    if (localStorage.getItem(key)) { setDismissed(true); return; }

    // Check which items are actually done
    (async () => {
      try {
        const [apps, stats, stations, users] = await Promise.all([
          api.getApps(),
          api.getAppsStats().catch(() => null),
          api.getStations(),
          api.getUsers(),
        ]);
        const published = (apps as { status?: string }[]).some(a => a.status === 'published');
        setItems(prev => prev.map(item => {
          if (item.id === 'app')     return { ...item, done: apps.length > 0 };
          if (item.id === 'publish') return { ...item, done: published };
          if (item.id === 'run')     return { ...item, done: !!stats?.company_has_completions };
          if (item.id === 'station') return { ...item, done: stations.length > 0 };
          if (item.id === 'team')    return { ...item, done: users.length > 1 };
          return item;
        }));
      } catch { /* ignore */ }
    })();
  }, [user?.id]);

  const allDone = items.every(i => i.done);
  const doneCount = items.filter(i => i.done).length;

  if (dismissed || allDone) return null;

  const dismiss = () => {
    localStorage.setItem(`setup_dismissed_${user?.id}`, '1');
    setDismissed(true);
  };

  return (
    // flex-shrink-0 keeps the card its natural size; the nav above scrolls
    // instead of the checklist being crushed into overlapping it.
    <div className="mx-3 mb-3 flex-shrink-0 bg-blue-950/60 border border-blue-700/40 rounded-lg overflow-hidden">
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
            if (item.done || !item.to) {
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

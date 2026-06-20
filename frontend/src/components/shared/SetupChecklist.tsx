import { useState, useEffect } from 'react';
import { CheckCircle, Circle, ChevronDown, ChevronUp, X } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { api } from '../../api/client';

interface ChecklistItem {
  id: string;
  label: string;
  done: boolean;
}

export function SetupChecklist() {
  const { user } = useAuth();
  const [items, setItems] = useState<ChecklistItem[]>([
    { id: 'account', label: 'Create account', done: true },
    { id: 'department', label: 'Add a department', done: false },
    { id: 'station', label: 'Set up a work station', done: false },
    { id: 'workorder', label: 'Create your first work order', done: false },
    { id: 'team', label: 'Invite a team member', done: false },
  ]);
  const [expanded, setExpanded] = useState(true);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    // Check localStorage for dismissed state
    const key = `setup_dismissed_${user?.id}`;
    if (localStorage.getItem(key)) { setDismissed(true); return; }

    // Check which items are actually done
    (async () => {
      try {
        const [depts, stations, workOrders, users] = await Promise.all([
          api.getDepartments(),
          api.getStations(),
          api.getWorkOrders(),
          api.getUsers(),
        ]);
        setItems(prev => prev.map(item => {
          if (item.id === 'department') return { ...item, done: depts.length > 0 };
          if (item.id === 'station') return { ...item, done: stations.length > 0 };
          if (item.id === 'workorder') return { ...item, done: workOrders.length > 0 };
          if (item.id === 'team') return { ...item, done: users.length > 1 };
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
    <div className="mx-3 mb-3 bg-blue-950/60 border border-blue-700/40 rounded-lg overflow-hidden">
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
          {items.map(item => (
            <div key={item.id} className="flex items-center gap-2">
              {item.done
                ? <CheckCircle size={14} className="text-green-400 shrink-0" />
                : <Circle size={14} className="text-blue-500/50 shrink-0" />}
              <span className={`text-xs ${item.done ? 'text-gray-400 line-through' : 'text-blue-200'}`}>
                {item.label}
              </span>
            </div>
          ))}
          <button onClick={dismiss} className="flex items-center gap-1 text-xs text-blue-500 hover:text-blue-300 mt-2">
            <X size={12} /> Dismiss
          </button>
        </div>
      )}
    </div>
  );
}

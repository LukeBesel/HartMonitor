import { useEffect, useState } from 'react';
import { History } from 'lucide-react';
import { api } from '../../api/client';
import { timeAgo } from '../../utils/time';

interface ActivityEntry {
  id: string;
  action: string;
  actor: string;
  created_at: string;
}

export default function ActivityLog({ entityType, entityId }: {
  entityType: 'work_order' | 'purchase_order' | 'ncr';
  entityId: string;
}) {
  const [entries, setEntries] = useState<ActivityEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api.getActivityLog(entityType, entityId)
      .then(rows => { if (!cancelled) setEntries(rows); })
      .catch(() => { if (!cancelled) setEntries([]); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [entityType, entityId]);

  if (loading) {
    return <div className="text-sm text-gray-400 py-3">Loading activity…</div>;
  }

  if (entries.length === 0) {
    return (
      <div className="text-sm text-gray-400 py-3 flex items-center gap-2">
        <History size={14} />
        No activity recorded yet
      </div>
    );
  }

  return (
    <ul className="space-y-3">
      {entries.map((entry, i) => (
        <li key={entry.id} className="relative pl-5">
          <span
            className={`absolute left-0 top-1.5 w-2 h-2 rounded-full ${i === 0 ? 'bg-blue-500' : 'bg-gray-300'}`}
          />
          {i < entries.length - 1 && (
            <span className="absolute left-[3px] top-3.5 bottom-[-12px] w-px bg-gray-200" />
          )}
          <div className="text-sm text-gray-800">{entry.action}</div>
          <div className="text-xs text-gray-400 mt-0.5">
            {entry.actor || 'System'} · {timeAgo(entry.created_at)}
          </div>
        </li>
      ))}
    </ul>
  );
}

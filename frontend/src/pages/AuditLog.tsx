import { useEffect, useState, useCallback } from 'react';
import { ScrollText, Download, AlertCircle, Search } from 'lucide-react';
import { api } from '../api/client';
import type { AuditLogEntry } from '../types';

// ── Entity type options ───────────────────────────────────────────────────────

const ENTITY_TYPES: { id: AuditLogEntry['entity_type']; label: string }[] = [
  { id: 'work_order',      label: 'Work Order' },
  { id: 'purchase_order',  label: 'Purchase Order' },
  { id: 'ncr',             label: 'NCR' },
  { id: 'site',            label: 'Site' },
  { id: 'app',             label: 'App' },
  { id: 'dashboard',       label: 'Dashboard' },
  { id: 'station',         label: 'Station' },
  { id: 'department',      label: 'Department' },
  { id: 'user',            label: 'User' },
  { id: 'plan',            label: 'Plan' },
  { id: 'inventory_item',  label: 'Inventory Item' },
  { id: 'vendor',          label: 'Vendor' },
  { id: 'webhook',         label: 'Webhook' },
  { id: 'api_key',         label: 'API Key' },
  { id: 'settings',        label: 'Settings' },
];

const ENTITY_LABELS: Record<string, string> = ENTITY_TYPES.reduce(
  (acc, t) => ({ ...acc, [t.id]: t.label }),
  {} as Record<string, string>,
);

const ENTITY_BADGE_COLORS: Record<string, string> = {
  work_order:     'badge-blue',
  purchase_order: 'badge-purple',
  ncr:            'badge-red',
  site:           'badge-green',
  app:            'badge-blue',
  dashboard:      'badge-purple',
  station:        'badge-amber',
  department:     'badge-green',
  user:           'badge-gray',
  plan:           'badge-purple',
  inventory_item: 'badge-amber',
  vendor:         'badge-blue',
  webhook:        'badge-gray',
  api_key:        'badge-gray',
  settings:       'badge-gray',
};

function entityLabel(entityType: string): string {
  return ENTITY_LABELS[entityType] || entityType;
}

function entityBadgeClass(entityType: string): string {
  return ENTITY_BADGE_COLORS[entityType] || 'badge-gray';
}

function truncateId(id: string): string {
  if (!id) return '—';
  return id.length > 8 ? `${id.slice(0, 8)}…` : id;
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function AuditLog() {
  const [entries, setEntries] = useState<AuditLogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [exporting, setExporting] = useState(false);

  const [entityType, setEntityType] = useState('');
  const [actor, setActor] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  const filters = {
    entity_type: entityType || undefined,
    actor: actor || undefined,
    from: from || undefined,
    to: to || undefined,
    limit: 200,
  };

  useEffect(() => {
    setLoading(true);
    setError('');
    api.getAuditLog(filters)
      .then(setEntries)
      .catch(err => setError(err.message || 'Failed to load audit log'))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entityType, actor, from, to]);

  const handleExport = useCallback(() => {
    setExporting(true);
    api.downloadAuditLog({
      entity_type: entityType || undefined,
      actor: actor || undefined,
      from: from || undefined,
      to: to || undefined,
    })
      .catch(err => setError(err.message || 'Failed to export audit log'))
      .finally(() => setExporting(false));
  }, [entityType, actor, from, to]);

  const hasFilters = !!(entityType || actor || from || to);

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl flex items-center justify-center shadow-sm"
            style={{ backgroundColor: 'var(--accent-light)', color: 'var(--accent)' }}>
            <ScrollText size={18} />
          </div>
          <div>
            <h1 className="text-xl font-bold text-gray-900 tracking-tight">Audit Log</h1>
            <p className="text-xs text-gray-500 mt-0.5">
              Timestamped history of changes for compliance and review.
            </p>
          </div>
        </div>
        <button
          onClick={handleExport}
          disabled={exporting}
          className="btn-secondary whitespace-nowrap"
        >
          <Download size={14} /> {exporting ? 'Exporting…' : 'Export CSV'}
        </button>
      </div>

      {/* Filter bar */}
      <div className="card p-4 flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-gray-500">Entity type</label>
          <select
            className="input-field w-48"
            value={entityType}
            onChange={e => setEntityType(e.target.value)}
          >
            <option value="">All Types</option>
            {ENTITY_TYPES.map(t => (
              <option key={t.id} value={t.id}>{t.label}</option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-gray-500">Actor</label>
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              className="input-field pl-8 w-48"
              placeholder="Search by name…"
              value={actor}
              onChange={e => setActor(e.target.value)}
            />
          </div>
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-gray-500">From</label>
          <input
            type="date"
            className="input-field w-40"
            value={from}
            onChange={e => setFrom(e.target.value)}
          />
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-gray-500">To</label>
          <input
            type="date"
            className="input-field w-40"
            value={to}
            onChange={e => setTo(e.target.value)}
          />
        </div>
      </div>

      {error && (
        <div className="flex items-center gap-2 text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">
          <AlertCircle size={14} /> {error}
        </div>
      )}

      {/* Results table */}
      {loading ? (
        <div className="space-y-2">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="card h-12 animate-pulse bg-gray-100" />
          ))}
        </div>
      ) : entries.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-24 text-gray-400 gap-3">
          <ScrollText size={48} className="text-gray-200" />
          <div className="text-center">
            <p className="font-semibold text-gray-500">
              {hasFilters ? 'No results match your filters' : 'No activity recorded yet'}
            </p>
          </div>
        </div>
      ) : (
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-[11px] text-gray-400 uppercase tracking-wide border-b border-gray-100">
                  <th className="text-left font-medium px-4 py-2.5">Timestamp</th>
                  <th className="text-left font-medium px-4 py-2.5">Entity Type</th>
                  <th className="text-left font-medium px-4 py-2.5">Entity ID</th>
                  <th className="text-left font-medium px-4 py-2.5">Action</th>
                  <th className="text-left font-medium px-4 py-2.5">Actor</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {entries.map(entry => (
                  <tr key={entry.id} className="hover:bg-gray-50">
                    <td className="px-4 py-2.5 text-gray-600 whitespace-nowrap">
                      {new Date(entry.created_at).toLocaleString()}
                    </td>
                    <td className="px-4 py-2.5">
                      <span className={entityBadgeClass(entry.entity_type)}>
                        {entityLabel(entry.entity_type)}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 font-mono text-xs text-gray-500">
                      {truncateId(entry.entity_id)}
                    </td>
                    <td className="px-4 py-2.5 text-gray-800">{entry.action}</td>
                    <td className="px-4 py-2.5 text-gray-600">{entry.actor}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

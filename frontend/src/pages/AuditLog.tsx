import { useEffect, useState, useCallback, useRef } from 'react';
import { ScrollText, Download, AlertCircle, Search } from 'lucide-react';
import { api } from '../api/client';
import type { AuditLogEntry } from '../types';

const REFRESH_INTERVAL_MS = 10_000;

// ── Entity type options ───────────────────────────────────────────────────────
// The Transaction Log is a production log: it only surfaces shop-floor events
// (jobs started/finished, units logged against work orders, NCRs, station
// downtime, safety). Settings/admin entity types are intentionally excluded
// from the dropdown, and the backend defaults to scope=production to match.

const ENTITY_TYPES: { id: string; label: string }[] = [
  { id: 'work_order',  label: 'Work Order' },
  { id: 'completion',  label: 'Production Run' },
  { id: 'ncr',         label: 'NCR' },
  { id: 'station',     label: 'Station / Downtime' },
  { id: 'safety',      label: 'Safety' },
];

const ENTITY_LABELS: Record<string, string> = ENTITY_TYPES.reduce(
  (acc, t) => ({ ...acc, [t.id]: t.label }),
  {} as Record<string, string>,
);

const ENTITY_BADGE_COLORS: Record<string, string> = {
  work_order:     'badge-blue',
  completion:     'badge-green',
  ncr:            'badge-red',
  station:        'badge-amber',
  safety:         'badge-purple',
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
  const [departmentId, setDepartmentId] = useState('');
  const [stationId, setStationId] = useState('');

  const [departments, setDepartments] = useState<{ id: string; name: string }[]>([]);
  const [stations, setStations] = useState<{ id: string; name: string }[]>([]);

  // Keep a ref to the current filters so the polling interval always reads
  // the latest values without being recreated on every keystroke.
  const filterValues = {
    entity_type: entityType || undefined,
    // Always scope to production events; an explicit entity_type still narrows
    // within that set on the backend.
    scope: 'production' as const,
    actor: actor || undefined,
    from: from || undefined,
    to: to || undefined,
    department_id: departmentId || undefined,
    station_id: stationId || undefined,
  };
  const filtersRef = useRef(filterValues);
  filtersRef.current = filterValues;

  // Load filter option lists once.
  useEffect(() => {
    api.getDepartments().then(setDepartments).catch(() => {});
    api.getStations().then(setStations).catch(() => {});
  }, []);

  const fetchEntries = useCallback((options?: { silent?: boolean }) => {
    if (!options?.silent) setLoading(true);
    return api.getAuditLog({ ...filtersRef.current, limit: 200 })
      .then(rows => { setEntries(rows); setError(''); })
      .catch(err => setError(err.message || 'Failed to load audit log'))
      .finally(() => { if (!options?.silent) setLoading(false); });
  }, []);

  // Reload (with skeleton) whenever a filter changes, then poll silently.
  useEffect(() => {
    fetchEntries();
    const id = setInterval(() => fetchEntries({ silent: true }), REFRESH_INTERVAL_MS);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entityType, actor, from, to, departmentId, stationId]);

  const handleExport = useCallback(() => {
    setExporting(true);
    api.downloadAuditLog(filtersRef.current)
      .catch(err => setError(err.message || 'Failed to export audit log'))
      .finally(() => setExporting(false));
  }, []);

  const hasFilters = !!(entityType || actor || from || to || departmentId || stationId);

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
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-bold text-gray-900 tracking-tight">Transaction Log</h1>
              <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-green-600 bg-green-50 rounded-full px-2 py-0.5">
                <span className="relative flex h-2 w-2">
                  <span className="absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75 animate-ping" />
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500" />
                </span>
                Live
              </span>
            </div>
            <p className="text-xs text-gray-500 mt-0.5">
              Live record of production activity — jobs started and finished, units logged, NCRs,
              downtime and safety events. Auto-refreshes every 10s.
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
          <label className="text-xs font-medium text-gray-500">Event type</label>
          <select
            className="input-field w-48"
            value={entityType}
            onChange={e => setEntityType(e.target.value)}
          >
            <option value="">All Production Events</option>
            {ENTITY_TYPES.map(t => (
              <option key={t.id} value={t.id}>{t.label}</option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-gray-500">Department</label>
          <select
            className="input-field w-48"
            value={departmentId}
            onChange={e => setDepartmentId(e.target.value)}
          >
            <option value="">All Departments</option>
            {departments.map(d => (
              <option key={d.id} value={d.id}>{d.name}</option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-gray-500">Workstation</label>
          <select
            className="input-field w-48"
            value={stationId}
            onChange={e => setStationId(e.target.value)}
          >
            <option value="">All Workstations</option>
            {stations.map(s => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-gray-500">Operator</label>
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
                  <th className="text-left font-medium px-4 py-2.5">Event Type</th>
                  <th className="text-left font-medium px-4 py-2.5">Reference</th>
                  <th className="text-left font-medium px-4 py-2.5">Action</th>
                  <th className="text-left font-medium px-4 py-2.5">Operator</th>
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

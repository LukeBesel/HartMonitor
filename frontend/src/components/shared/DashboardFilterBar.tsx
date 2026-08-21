import { Filter, X } from 'lucide-react';
import type { DashboardFilters } from '../../api/client';

// ─── DashboardFilterBar ───────────────────────────────────────────────────────
// Page-level scope for a dashboard or a workspace Reports page: department, app
// and site. Each select is omitted when the company has nothing to pick from
// (a single-site shop never sees a Site dropdown), so the bar only ever asks a
// question the data can answer.

export interface FilterOption {
  id: string;
  name: string;
}

export interface DashboardFilterBarProps {
  departments: FilterOption[];
  apps: FilterOption[];
  sites: FilterOption[];
  value: DashboardFilters;
  onChange: (next: DashboardFilters) => void;
  /** Shown while the filtered card data is being fetched. */
  refreshing?: boolean;
  className?: string;
}

const FIELDS: { key: keyof DashboardFilters; label: string; all: string }[] = [
  { key: 'department_id', label: 'Department', all: 'All departments' },
  { key: 'app_id',        label: 'App',        all: 'All apps' },
  { key: 'site_id',       label: 'Site',       all: 'All sites' },
];

export function countActiveFilters(value: DashboardFilters): number {
  return FIELDS.filter(f => value[f.key]).length;
}

export default function DashboardFilterBar({
  departments, apps, sites, value, onChange, refreshing = false, className = '',
}: DashboardFilterBarProps) {
  const options: Record<keyof DashboardFilters, FilterOption[]> = {
    department_id: departments,
    app_id: apps,
    site_id: sites,
  };

  const visible = FIELDS.filter(f => options[f.key].length > 0);
  if (visible.length === 0) return null;

  const activeCount = countActiveFilters(value);

  const set = (key: keyof DashboardFilters, id: string) => {
    const next = { ...value };
    if (id) next[key] = id;
    else delete next[key];
    onChange(next);
  };

  return (
    <div
      className={`flex items-center gap-3 flex-wrap rounded-2xl border border-gray-200 bg-white px-4 py-3 shadow-sm ${className}`}
      data-testid="dashboard-filter-bar"
    >
      <span className="flex items-center gap-1.5 text-xs font-semibold text-gray-500">
        <Filter size={13} />
        Filter
      </span>

      {visible.map(field => (
        <label key={field.key} className="flex items-center gap-2 text-xs text-gray-500">
          <span className="sr-only">{field.label}</span>
          <select
            className="input-field text-sm py-1.5 w-auto min-w-[9.5rem]"
            aria-label={field.label}
            value={value[field.key] ?? ''}
            onChange={e => set(field.key, e.target.value)}
          >
            <option value="">{field.all}</option>
            {options[field.key].map(o => (
              <option key={o.id} value={o.id}>{o.name}</option>
            ))}
          </select>
        </label>
      ))}

      {activeCount > 0 && (
        <button
          type="button"
          onClick={() => onChange({})}
          className="flex items-center gap-1 text-xs font-medium text-gray-500 hover:text-gray-800 px-2 py-1 rounded-md hover:bg-gray-100 transition-colors"
        >
          <X size={12} />
          Clear
        </button>
      )}

      {refreshing && activeCount > 0 && (
        <span className="text-[11px] text-gray-400">Updating cards…</span>
      )}
    </div>
  );
}

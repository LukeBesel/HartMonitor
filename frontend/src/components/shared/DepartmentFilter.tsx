import { Building2, X } from 'lucide-react';
import type { DepartmentFilterState } from '../../hooks/useDepartmentFilter';

// ─── DepartmentFilter ─────────────────────────────────────────────────────────
// The one department picker used across the management screens. Drop it in a
// page header next to LastRefreshed and pass the state from useDepartmentFilter.
//
// It renders nothing when the company has no departments yet — a shop with a
// single unnamed floor should not be asked to narrow it down.

export interface DepartmentFilterProps {
  filter: DepartmentFilterState;
  /** Shown as the "everything" option. */
  allLabel?: string;
  /** How many rows survive the filter — shown next to the picker when set. */
  matchCount?: number;
  /** Noun for the count, e.g. "work orders". */
  matchNoun?: string;
  className?: string;
}

export default function DepartmentFilter({
  filter, allLabel = 'All departments', matchCount, matchNoun, className = '',
}: DepartmentFilterProps) {
  const { departments, departmentId, setDepartmentId, active, clear } = filter;
  if (departments.length === 0) return null;

  return (
    <div className={`flex items-center gap-2 ${className}`} data-testid="department-filter">
      <label className="flex items-center gap-1.5">
        <Building2 size={13} className="text-gray-400" aria-hidden="true" />
        <span className="sr-only">Department</span>
        <select
          aria-label="Department"
          className="input-field text-sm py-1.5 w-auto min-w-[10rem]"
          value={departmentId}
          onChange={e => setDepartmentId(e.target.value)}
        >
          <option value="">{allLabel}</option>
          {departments.map(d => (
            <option key={d.id} value={d.id}>{d.name}</option>
          ))}
        </select>
      </label>

      {active && typeof matchCount === 'number' && (
        <span className="text-xs text-gray-500 tabular-nums whitespace-nowrap">
          {matchCount} {matchNoun ?? (matchCount === 1 ? 'match' : 'matches')}
        </span>
      )}

      {active && (
        <button
          type="button"
          onClick={clear}
          className="flex items-center gap-1 text-xs font-medium text-gray-500 hover:text-gray-800 px-2 py-1 rounded-md hover:bg-gray-100 transition-colors"
        >
          <X size={12} />
          Clear
        </button>
      )}
    </div>
  );
}

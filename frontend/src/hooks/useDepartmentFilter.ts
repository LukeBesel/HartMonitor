import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../api/client';
import { useSite } from '../context/SiteContext';

// ─── useDepartmentFilter ──────────────────────────────────────────────────────
// One department picker, shared by every management screen. It loads the active
// site's departments once, remembers the manager's choice per screen, and hands
// back a `matches` predicate that copes with the two record shapes the API
// returns: some rows carry `department_id`, older ones only `department_name`.
//
// Records with no department at all stay visible under "All departments" and
// disappear once a specific department is chosen — an unassigned work order is
// not evidence about any one department.

export interface DepartmentOption {
  id: string;
  name: string;
  color?: string;
}

/** Anything with a department on it, under either of the two field names. */
export interface HasDepartment {
  department_id?: string | null;
  department_name?: string | null;
  department?: string | null;
}

export interface DepartmentFilterState {
  departments: DepartmentOption[];
  /** Empty string means "All departments". */
  departmentId: string;
  setDepartmentId: (id: string) => void;
  /** The selected department, or null while "All departments" is active. */
  selected: DepartmentOption | null;
  /** True when a specific department is selected. */
  active: boolean;
  clear: () => void;
  loading: boolean;
  /** Predicate for `Array.filter` — passes everything when nothing is selected. */
  matches: (record: HasDepartment | null | undefined) => boolean;
}

/**
 * @param scope A stable key for the screen (e.g. `'andon'`). The manager's
 *              choice is remembered per screen so switching tabs doesn't reset
 *              it, and picking a department on Andon doesn't silently re-scope
 *              an unrelated page.
 */
export function useDepartmentFilter(scope: string): DepartmentFilterState {
  const { selectedSiteId } = useSite();
  const storageKey = `hm_deptfilter_${scope}`;

  const [departments, setDepartments] = useState<DepartmentOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [departmentId, setDepartmentIdState] = useState<string>(() => {
    try { return localStorage.getItem(storageKey) || ''; } catch { return ''; }
  });

  const setDepartmentId = useCallback((id: string) => {
    setDepartmentIdState(id);
    try {
      if (id) localStorage.setItem(storageKey, id);
      else localStorage.removeItem(storageKey);
    } catch { /* private mode — the filter just won't persist */ }
  }, [storageKey]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api.getDepartments(selectedSiteId ? { site_id: selectedSiteId } : undefined)
      .then((rows: any[]) => {
        if (cancelled) return;
        setDepartments((rows ?? []).map(d => ({ id: d.id, name: d.name, color: d.color })));
      })
      .catch(() => { if (!cancelled) setDepartments([]); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [selectedSiteId]);

  // A remembered department that belongs to another site (or has since been
  // deleted) would filter every row away and look like an empty screen.
  useEffect(() => {
    if (loading || !departmentId) return;
    if (!departments.some(d => d.id === departmentId)) setDepartmentId('');
  }, [loading, departments, departmentId, setDepartmentId]);

  const selected = useMemo(
    () => departments.find(d => d.id === departmentId) ?? null,
    [departments, departmentId],
  );

  const matches = useCallback((record: HasDepartment | null | undefined) => {
    if (!departmentId) return true;
    if (!record) return false;
    if (record.department_id) return record.department_id === departmentId;
    const name = record.department_name ?? record.department;
    if (name && selected) return name === selected.name;
    return false;
  }, [departmentId, selected]);

  return {
    departments,
    departmentId,
    setDepartmentId,
    selected,
    active: !!departmentId,
    clear: () => setDepartmentId(''),
    loading,
    matches,
  };
}

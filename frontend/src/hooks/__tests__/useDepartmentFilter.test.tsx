import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useDepartmentFilter } from '../useDepartmentFilter';

// ─── useDepartmentFilter ──────────────────────────────────────────────────────
// The shared department picker behind every management screen. What matters is
// that it never silently empties a page: a remembered department belonging to
// another site is dropped rather than filtering every row away, and records
// carrying only a department NAME still match a selection made by ID.

const getDepartments = vi.fn();
let selectedSiteId: string | null = 'site-1';

vi.mock('../../api/client', () => ({
  api: { getDepartments: (...args: unknown[]) => getDepartments(...args) },
}));

vi.mock('../../context/SiteContext', () => ({
  useSite: () => ({ selectedSiteId, sites: [], setSelectedSiteId: () => {}, loading: false, refresh: () => {} }),
}));

const WELDING = { id: 'dept-weld', name: 'Welding', color: '#f59e0b' };
const ASSEMBLY = { id: 'dept-asm', name: 'Assembly', color: '#3b82f6' };

beforeEach(() => {
  localStorage.clear();
  selectedSiteId = 'site-1';
  getDepartments.mockReset();
  getDepartments.mockResolvedValue([WELDING, ASSEMBLY]);
});

afterEach(() => { vi.restoreAllMocks(); });

/** Render and wait for the departments fetch to settle. */
async function renderFilter(scope = 'test') {
  const view = renderHook(() => useDepartmentFilter(scope));
  await waitFor(() => expect(view.result.current.loading).toBe(false));
  return view;
}

describe('useDepartmentFilter', () => {
  it('loads the active site\'s departments', async () => {
    const { result } = await renderFilter();
    expect(getDepartments).toHaveBeenCalledWith({ site_id: 'site-1' });
    expect(result.current.departments).toEqual([WELDING, ASSEMBLY]);
    expect(result.current.active).toBe(false);
  });

  it('passes everything through while no department is selected', async () => {
    const { result } = await renderFilter();
    expect(result.current.matches({ department_id: 'dept-weld' })).toBe(true);
    expect(result.current.matches({ department_name: 'Anything' })).toBe(true);
    expect(result.current.matches({})).toBe(true);
    expect(result.current.matches(null)).toBe(true);
  });

  it('matches on department_id when the record has one', async () => {
    const { result } = await renderFilter();
    act(() => { result.current.setDepartmentId('dept-weld'); });

    expect(result.current.active).toBe(true);
    expect(result.current.selected).toEqual(WELDING);
    expect(result.current.matches({ department_id: 'dept-weld' })).toBe(true);
    expect(result.current.matches({ department_id: 'dept-asm' })).toBe(false);
  });

  it('falls back to the department name for rows that carry no id', async () => {
    const { result } = await renderFilter();
    act(() => { result.current.setDepartmentId('dept-weld'); });

    // Older endpoints return a display name only, under either field name.
    expect(result.current.matches({ department_name: 'Welding' })).toBe(true);
    expect(result.current.matches({ department: 'Welding' })).toBe(true);
    expect(result.current.matches({ department_name: 'Assembly' })).toBe(false);
  });

  it('prefers the id over the name when a row carries both', async () => {
    const { result } = await renderFilter();
    act(() => { result.current.setDepartmentId('dept-weld'); });

    // A renamed department must not resurface by its stale label.
    expect(result.current.matches({ department_id: 'dept-asm', department_name: 'Welding' })).toBe(false);
    expect(result.current.matches({ department_id: 'dept-weld', department_name: 'Weld Cell' })).toBe(true);
  });

  it('hides unassigned records once a department is chosen', async () => {
    const { result } = await renderFilter();
    act(() => { result.current.setDepartmentId('dept-weld'); });

    // An unassigned work order is not evidence about any one department.
    expect(result.current.matches({})).toBe(false);
    expect(result.current.matches({ department_id: null, department_name: null })).toBe(false);
    expect(result.current.matches(null)).toBe(false);
  });

  it('remembers the choice per screen and restores it', async () => {
    const first = await renderFilter('andon');
    act(() => { first.result.current.setDepartmentId('dept-asm'); });
    expect(localStorage.getItem('hm_deptfilter_andon')).toBe('dept-asm');
    first.unmount();

    const reopened = await renderFilter('andon');
    expect(reopened.result.current.departmentId).toBe('dept-asm');

    // A different screen keeps its own scope.
    const other = await renderFilter('capa');
    expect(other.result.current.departmentId).toBe('');
  });

  it('clears back to all departments', async () => {
    const { result } = await renderFilter('stations');
    act(() => { result.current.setDepartmentId('dept-weld'); });
    act(() => { result.current.clear(); });

    expect(result.current.departmentId).toBe('');
    expect(result.current.active).toBe(false);
    expect(localStorage.getItem('hm_deptfilter_stations')).toBeNull();
    expect(result.current.matches({ department_id: 'dept-asm' })).toBe(true);
  });

  it('drops a remembered department that the current site does not have', async () => {
    // Saved while looking at another plant — keeping it would filter every row
    // away and read as "this screen is empty".
    localStorage.setItem('hm_deptfilter_manager', 'dept-from-other-site');
    getDepartments.mockResolvedValue([WELDING]);

    const { result } = await renderFilter('manager');
    await waitFor(() => expect(result.current.departmentId).toBe(''));
    expect(result.current.matches({ department_id: 'dept-weld' })).toBe(true);
    expect(localStorage.getItem('hm_deptfilter_manager')).toBeNull();
  });

  it('degrades to an empty list when departments cannot be loaded', async () => {
    getDepartments.mockRejectedValue(new Error('offline'));
    const { result } = await renderFilter();

    expect(result.current.departments).toEqual([]);
    // Nothing selectable means nothing filtered — the page still shows its data.
    expect(result.current.matches({ department_id: 'dept-weld' })).toBe(true);
  });

  it('omits the site parameter when no site is selected', async () => {
    selectedSiteId = null;
    await renderFilter();
    expect(getDepartments).toHaveBeenCalledWith(undefined);
  });
});

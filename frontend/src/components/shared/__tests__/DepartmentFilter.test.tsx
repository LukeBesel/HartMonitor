import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import DepartmentFilter from '../DepartmentFilter';
import type { DepartmentFilterState } from '../../../hooks/useDepartmentFilter';

const WELDING = { id: 'dept-weld', name: 'Welding' };
const ASSEMBLY = { id: 'dept-asm', name: 'Assembly' };

function state(over: Partial<DepartmentFilterState> = {}): DepartmentFilterState {
  const departmentId = over.departmentId ?? '';
  return {
    departments: [WELDING, ASSEMBLY],
    departmentId,
    setDepartmentId: vi.fn(),
    selected: [WELDING, ASSEMBLY].find(d => d.id === departmentId) ?? null,
    active: !!departmentId,
    clear: vi.fn(),
    loading: false,
    matches: () => true,
    ...over,
  };
}

describe('DepartmentFilter', () => {
  it('lists every department plus an all-departments option', () => {
    render(<DepartmentFilter filter={state()} />);

    const select = screen.getByLabelText('Department') as HTMLSelectElement;
    expect(Array.from(select.options).map(o => o.textContent))
      .toEqual(['All departments', 'Welding', 'Assembly']);
    expect(select.value).toBe('');
  });

  it('stays out of the way when the company has no departments', () => {
    // A single-floor shop should not be asked to narrow anything down.
    const { container } = render(<DepartmentFilter filter={state({ departments: [] })} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('reports the picked department to the caller', () => {
    const filter = state();
    render(<DepartmentFilter filter={filter} />);

    fireEvent.change(screen.getByLabelText('Department'), { target: { value: 'dept-asm' } });
    expect(filter.setDepartmentId).toHaveBeenCalledWith('dept-asm');
  });

  it('offers a way out only once a department is selected', () => {
    const { rerender } = render(<DepartmentFilter filter={state()} />);
    expect(screen.queryByRole('button', { name: /clear/i })).not.toBeInTheDocument();

    const filtered = state({ departmentId: 'dept-weld' });
    rerender(<DepartmentFilter filter={filtered} />);

    fireEvent.click(screen.getByRole('button', { name: /clear/i }));
    expect(filtered.clear).toHaveBeenCalled();
  });

  it('says how much survived the filter', () => {
    render(<DepartmentFilter filter={state({ departmentId: 'dept-weld' })} matchCount={3} matchNoun="work orders" />);
    expect(screen.getByText('3 work orders')).toBeInTheDocument();
  });

  it('does not show a count while every record is showing', () => {
    render(<DepartmentFilter filter={state()} matchCount={42} matchNoun="work orders" />);
    expect(screen.queryByText('42 work orders')).not.toBeInTheDocument();
  });

  it('accepts a caller-supplied label for the everything option', () => {
    render(<DepartmentFilter filter={state()} allLabel="Whole plant" />);
    expect(screen.getByRole('option', { name: 'Whole plant' })).toBeInTheDocument();
  });
});

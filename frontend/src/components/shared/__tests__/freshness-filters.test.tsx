import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import LastRefreshed, { formatFreshness } from '../LastRefreshed';
import DashboardFilterBar from '../DashboardFilterBar';

describe('formatFreshness', () => {
  it('reads as a plant manager would say it', () => {
    expect(formatFreshness(0)).toBe('just now');
    expect(formatFreshness(4_000)).toBe('just now');
    expect(formatFreshness(12_000)).toBe('12s ago');
    expect(formatFreshness(59_000)).toBe('59s ago');
    expect(formatFreshness(90_000)).toBe('1m ago');
    expect(formatFreshness(3 * 60_000)).toBe('3m ago');
    expect(formatFreshness(2 * 3_600_000)).toBe('2h ago');
    expect(formatFreshness(50 * 3_600_000)).toBe('2d ago');
    expect(formatFreshness(-5_000)).toBe('just now');
  });
});

describe('LastRefreshed', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('ticks the age on screen without a new fetch', () => {
    const at = new Date();
    render(<LastRefreshed at={at} />);
    expect(screen.getByText('Updated just now')).toBeInTheDocument();

    act(() => { vi.advanceTimersByTime(12_000); });
    expect(screen.getByText('Updated 12s ago')).toBeInTheDocument();

    act(() => { vi.advanceTimersByTime(60_000); });
    expect(screen.getByText('Updated 1m ago')).toBeInTheDocument();
  });

  it('says it is updating before the first load lands', () => {
    render(<LastRefreshed at={null} refreshing />);
    expect(screen.getByText('Updating…')).toBeInTheDocument();
  });

  it('exposes a manual refresh button that is disabled mid-fetch', () => {
    const onRefresh = vi.fn();
    const { rerender } = render(<LastRefreshed at={new Date()} onRefresh={onRefresh} />);

    const button = screen.getByRole('button', { name: 'Refresh now' });
    fireEvent.click(button);
    expect(onRefresh).toHaveBeenCalledTimes(1);

    rerender(<LastRefreshed at={new Date()} onRefresh={onRefresh} refreshing />);
    expect(screen.getByRole('button', { name: 'Refresh now' })).toBeDisabled();
  });

  it('renders no button when no handler is given', () => {
    render(<LastRefreshed at={new Date()} />);
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('scopes the dark token palette to itself on dark surfaces', () => {
    const { rerender } = render(<LastRefreshed at={new Date()} />);
    expect(screen.getByTestId('last-refreshed').className).not.toContain('dark');

    rerender(<LastRefreshed at={new Date()} onDark />);
    expect(screen.getByTestId('last-refreshed').className).toContain('dark');
  });

  it('releases its ticker on unmount', () => {
    const { unmount } = render(<LastRefreshed at={new Date()} />);
    expect(vi.getTimerCount()).toBe(1);
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('DashboardFilterBar', () => {
  const departments = [{ id: 'd1', name: 'Weld' }, { id: 'd2', name: 'Paint' }];
  const apps = [{ id: 'a1', name: 'Weld Check' }];
  const sites = [{ id: 's1', name: 'Main' }, { id: 's2', name: 'North' }];

  it('omits a select when its list is empty', () => {
    render(
      <DashboardFilterBar departments={departments} apps={apps} sites={[]} value={{}} onChange={() => {}} />
    );
    expect(screen.getByLabelText('Department')).toBeInTheDocument();
    expect(screen.getByLabelText('App')).toBeInTheDocument();
    expect(screen.queryByLabelText('Site')).toBeNull();
  });

  it('renders nothing at all when there is nothing to filter by', () => {
    const { container } = render(
      <DashboardFilterBar departments={[]} apps={[]} sites={[]} value={{}} onChange={() => {}} />
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('reports a selection and keeps the others intact', () => {
    const onChange = vi.fn();
    render(
      <DashboardFilterBar
        departments={departments} apps={apps} sites={sites}
        value={{ app_id: 'a1' }} onChange={onChange}
      />
    );
    fireEvent.change(screen.getByLabelText('Department'), { target: { value: 'd2' } });
    expect(onChange).toHaveBeenCalledWith({ app_id: 'a1', department_id: 'd2' });
  });

  it('drops a filter when the "all" option is chosen', () => {
    const onChange = vi.fn();
    render(
      <DashboardFilterBar
        departments={departments} apps={apps} sites={sites}
        value={{ department_id: 'd1', app_id: 'a1' }} onChange={onChange}
      />
    );
    fireEvent.change(screen.getByLabelText('Department'), { target: { value: '' } });
    expect(onChange).toHaveBeenCalledWith({ app_id: 'a1' });
  });

  it('offers Clear only while something is filtered', () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <DashboardFilterBar departments={departments} apps={apps} sites={sites} value={{}} onChange={onChange} />
    );
    expect(screen.queryByRole('button', { name: /clear/i })).toBeNull();

    rerender(
      <DashboardFilterBar
        departments={departments} apps={apps} sites={sites}
        value={{ department_id: 'd1' }} onChange={onChange}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: /clear/i }));
    expect(onChange).toHaveBeenCalledWith({});
  });

  it('shows the reload signal while filtered cards are being fetched', () => {
    const { rerender } = render(
      <DashboardFilterBar
        departments={departments} apps={apps} sites={sites}
        value={{ department_id: 'd1' }} onChange={() => {}} refreshing
      />
    );
    expect(screen.getByText('Updating cards…')).toBeInTheDocument();

    rerender(
      <DashboardFilterBar
        departments={departments} apps={apps} sites={sites}
        value={{ department_id: 'd1' }} onChange={() => {}}
      />
    );
    expect(screen.queryByText('Updating cards…')).toBeNull();
  });
});

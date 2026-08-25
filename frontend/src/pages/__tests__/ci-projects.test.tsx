import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

// ─── CI Projects screen ───────────────────────────────────────────────────────
// Two things are pinned here:
//   • the Gantt's geometry survives the trip through the component — a bar's
//     left/width really are the percentages the arithmetic produced;
//   • the empty states tell "nothing exists yet" apart from "nothing matches
//     what you asked for", and offer the matching way out of each.

const getCIProjects = vi.fn();
const getCIProjectSummary = vi.fn();
const getCIProject = vi.fn();
const getDepartments = vi.fn();

vi.mock('../../api/client', () => ({
  api: {
    get getCIProjects() { return getCIProjects; },
    get getCIProjectSummary() { return getCIProjectSummary; },
    get getCIProject() { return getCIProject; },
    get getDepartments() { return getDepartments; },
  },
}));

vi.mock('../../context/SiteContext', () => ({
  useSite: () => ({ sites: [], selectedSiteId: null, setSelectedSiteId: () => {}, loading: false, refresh: () => {} }),
}));

import CIProjects from '../CIProjects';
import GanttChart from '../../components/ci/GanttChart';
import type { CIProject, CIProjectTask } from '../../types';

const SUMMARY = {
  total: 0,
  by_status: { planning: 0, active: 0, on_hold: 0, complete: 0, cancelled: 0 },
  active: 0, complete: 0, overdue: 0, from_ideas: 0,
  estimated_savings: 0, actual_savings: 0,
};

function project(over: Partial<CIProject> = {}): CIProject {
  return {
    id: 'p1', number: 'CIP-2026-001', name: 'Cut changeover time', description: 'SMED on Line 2',
    status: 'planning', department_id: null, department_name: null, owner_name: 'Dana',
    kaizen_idea_id: null, start_date: '2026-03-01', target_date: '2026-03-31', completed_at: null,
    estimated_savings: 12000, actual_savings: 0, created_by: 'Admin',
    created_at: '2026-02-20T00:00:00.000Z', updated_at: '2026-02-20T00:00:00.000Z',
    task_count: 0, done_count: 0, blocked_count: 0, progress: null,
    ...over,
  };
}

function task(over: Partial<CIProjectTask> = {}): CIProjectTask {
  return {
    id: 't1', project_id: 'p1', name: 'Time study', status: 'in_progress', assignee_name: 'Ravi',
    start_date: '2026-03-03', end_date: '2026-03-04', progress: 50, depends_on: null,
    depends_on_name: null, sort_order: 0,
    created_at: '2026-02-20T00:00:00.000Z', updated_at: '2026-02-20T00:00:00.000Z',
    ...over,
  };
}

function renderList() {
  return render(<MemoryRouter initialEntries={['/ci-projects']}><CIProjects /></MemoryRouter>);
}

beforeEach(() => {
  vi.clearAllMocks();
  try { localStorage.clear(); } catch { /* ignore */ }
  getDepartments.mockResolvedValue([]);
  getCIProjectSummary.mockResolvedValue(SUMMARY);
  getCIProjects.mockResolvedValue([]);
});

describe('CI Projects list — empty states', () => {
  it('offers to CREATE when the company has no projects at all', async () => {
    renderList();
    expect(await screen.findByTestId('ci-empty-none')).toBeInTheDocument();
    expect(screen.getByText('No CI projects yet')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /create your first project/i })).toBeInTheDocument();
    // "Nothing here yet" must never offer to clear a filter nobody set.
    expect(screen.queryByRole('button', { name: /clear filters/i })).not.toBeInTheDocument();
  });

  it('offers to CLEAR when projects exist but none match the filter', async () => {
    getCIProjects.mockResolvedValue([project()]);
    getCIProjectSummary.mockResolvedValue({ ...SUMMARY, total: 1 });
    renderList();

    // The row is there under "All"…
    expect(await screen.findByText('Cut changeover time')).toBeInTheDocument();

    // …and gone once a status nothing matches is selected.
    fireEvent.click(screen.getByRole('button', { name: /^Active/ }));
    expect(await screen.findByTestId('ci-empty-filters')).toBeInTheDocument();
    expect(screen.getByText('No matching projects')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /clear filters/i })).toBeInTheDocument();
    expect(screen.queryByText('No CI projects yet')).not.toBeInTheDocument();

    // Clearing puts the row back.
    fireEvent.click(screen.getByRole('button', { name: /clear filters/i }));
    await waitFor(() => expect(screen.getByText('Cut changeover time')).toBeInTheDocument());
  });

  it('reports a project with no tasks as "—", never as 0%', async () => {
    getCIProjects.mockResolvedValue([
      project({ id: 'p1', name: 'Unplanned', task_count: 0, progress: null }),
      project({ id: 'p2', number: 'CIP-2026-002', name: 'Underway', task_count: 4, progress: 60 }),
    ]);
    renderList();
    expect(await screen.findByText('Underway')).toBeInTheDocument();
    expect(screen.getByText('no tasks yet')).toBeInTheDocument();
    expect(screen.getByText('60%')).toBeInTheDocument();
    expect(screen.queryByText('0%')).not.toBeInTheDocument();
  });
});

describe('GanttChart', () => {
  // Mar 1 → Mar 31 is a 31-day window; each day is 100/31 % wide.
  const DAY_PCT = 100 / 31;

  it('positions a bar at the percentages the geometry produced', () => {
    render(
      <GanttChart
        tasks={[task({ start_date: '2026-03-03', end_date: '2026-03-04' })]}
        projectStart="2026-03-01"
        projectTarget="2026-03-31"
        now={Date.UTC(2026, 2, 10)}
      />,
    );
    const bar = screen.getByTestId('gantt-bar');
    // Two days in, two days long.
    expect(Number(bar.getAttribute('data-left-pct'))).toBeCloseTo(2 * DAY_PCT, 3);
    expect(Number(bar.getAttribute('data-width-pct'))).toBeCloseTo(2 * DAY_PCT, 3);
    expect(bar).toHaveStyle({ left: `${2 * DAY_PCT}%` });
  });

  it('draws the today marker inside the window and omits it outside', () => {
    const { rerender } = render(
      <GanttChart tasks={[task()]} projectStart="2026-03-01" projectTarget="2026-03-31" now={Date.UTC(2026, 2, 10)} />,
    );
    expect(screen.getAllByTestId('gantt-today').length).toBeGreaterThan(0);

    rerender(
      <GanttChart tasks={[task()]} projectStart="2026-03-01" projectTarget="2026-03-31" now={Date.UTC(2027, 2, 10)} />,
    );
    expect(screen.queryByTestId('gantt-today')).not.toBeInTheDocument();
  });

  it('draws a connector for a finish-to-start dependency and names it on the row', () => {
    render(
      <GanttChart
        tasks={[
          task({ id: 't1', name: 'First', start_date: '2026-03-02', end_date: '2026-03-04' }),
          task({ id: 't2', name: 'Second', start_date: '2026-03-05', end_date: '2026-03-08', depends_on: 't1', depends_on_name: 'First' }),
        ]}
        projectStart="2026-03-01"
        projectTarget="2026-03-31"
        now={Date.UTC(2026, 2, 10)}
      />,
    );
    expect(screen.getByTestId('gantt-links')).toBeInTheDocument();
    expect(screen.getByTestId('gantt-links').querySelectorAll('polyline')).toHaveLength(1);
    expect(screen.getByText(/after First/)).toBeInTheDocument();
  });

  it('says a task is unscheduled rather than parking its bar at day one', () => {
    render(
      <GanttChart
        tasks={[
          task({ id: 't1', name: 'Scheduled' }),
          task({ id: 't2', name: 'Floating', start_date: null, end_date: null }),
        ]}
        projectStart="2026-03-01"
        projectTarget="2026-03-31"
        now={Date.UTC(2026, 2, 10)}
      />,
    );
    expect(screen.getAllByTestId('gantt-bar')).toHaveLength(1);
    const floating = screen.getByTestId('gantt-unscheduled');
    expect(floating.getAttribute('data-task-id')).toBe('t2');
    expect(floating).toHaveTextContent(/no dates/i);
  });

  it('distinguishes "no tasks" from "no dates" — different facts, different copy', () => {
    const { rerender } = render(<GanttChart tasks={[]} projectStart="2026-03-01" projectTarget="2026-03-31" />);
    expect(screen.getByTestId('gantt-no-tasks')).toHaveTextContent(/no tasks on this project yet/i);

    rerender(
      <GanttChart
        tasks={[task({ start_date: null, end_date: null })]}
        projectStart={null}
        projectTarget={null}
      />,
    );
    expect(screen.getByTestId('gantt-no-dates')).toHaveTextContent(/nothing is scheduled yet/i);
  });

  it('keeps its own horizontal scroll port, so the page body never scrolls sideways', () => {
    render(
      <GanttChart
        tasks={[task({ start_date: '2026-01-05', end_date: '2026-11-20' })]}
        projectStart="2026-01-01"
        projectTarget="2026-12-31"
        now={Date.UTC(2026, 2, 10)}
      />,
    );
    const port = screen.getByTestId('gantt-scroll');
    expect(port.className).toContain('overflow-x-auto');
    // A year-long project is far wider than any phone; the width lives INSIDE
    // the scroll port rather than pushing the page out.
    const inner = port.firstElementChild as HTMLElement;
    expect(parseInt(inner.style.minWidth, 10)).toBeGreaterThan(1000);
  });
});

// ─── Builder UX overhaul tests ────────────────────────────────────────────────
// Covers: ribbon-tab widget palette (category switching + localStorage
// persistence + keyboard nav), the prominent "+ New step" button, the
// collapsible context panel preference, and the run-requirements toggle
// round-tripping through the saveApp payload (app.require_run_context).

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { App } from '../../../types';

// The global test-setup mocks ResizeObserver with an arrow function, which
// dnd-kit invokes with `new`. Override with a constructable class here.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
global.ResizeObserver = ResizeObserverStub as unknown as typeof ResizeObserver;

const saveApp = vi.fn().mockResolvedValue({});

vi.mock('../../../api/client', () => ({
  api: {
    getApp: vi.fn(() => Promise.resolve(v1App())),
    getProductTypes: vi.fn(() => Promise.resolve([])),
    getDepartments: vi.fn(() => Promise.resolve([])),
    getStations: vi.fn(() => Promise.resolve([])),
    getTables: vi.fn(() => Promise.resolve([])),
    getTable: vi.fn(() => Promise.resolve({ id: 't1', name: 'T', fields: [] })),
    saveApp: (...args: unknown[]) => saveApp(...args),
    publishApp: vi.fn(() => Promise.resolve({})),
    uploadImage: vi.fn(),
    createProductType: vi.fn(),
    updateProductType: vi.fn(),
    deleteProductType: vi.fn(),
  },
}));

// The builder edits the DRAFT, so it loads through getAppDraft (GET
// /api/apps/:id?draft=1) rather than the plain app read every other screen
// uses — plain GET now serves the live revision's frozen snapshot.
vi.mock('../../../api/revisions', () => ({
  getAppDraft: vi.fn(() => Promise.resolve(v1App())),
  getRevisionDiff: vi.fn(() => Promise.resolve({ current_revision: 0, next_revision: 1, diff: null, has_unpublished_changes: false })),
  publishRevision: vi.fn(() => Promise.resolve({ revision: 1, current_revision: 1, diff: null })),
  setRequiresApproval: vi.fn(() => Promise.resolve({ requires_approval: 0 })),
  getAppRevision: vi.fn(),
  getAppRevisions: vi.fn(),
  describeDiff: () => null,
}));

vi.mock('../../../context/AuthContext', () => ({
  useAuth: () => ({ canEdit: true }),
}));

function v1App(): App {
  return {
    id: 'app1',
    name: 'Legacy Assembly',
    description: '',
    status: 'published',
    created_at: '', updated_at: '',
    variables: undefined as unknown as App['variables'],
    schema_version: 1,
    steps: [
      {
        id: 's1', name: 'Torque check', order: 0,
        layoutMode: 'canvas', canvasHeight: 560,
        widgets: [
          { id: 'w1', type: 'text-input', label: 'Serial', order: 0, config: { variableName: 'serial_number' }, layout: { x: 40, y: 40, width: 380, height: 84 } },
        ],
      },
    ],
  };
}

function renderBuilder() {
  return render(
    <MemoryRouter initialEntries={['/builder/app1']}>
      <Routes>
        <Route path="/builder/:id" element={<AppBuilder />} />
      </Routes>
    </MemoryRouter>
  );
}

// Import after mocks are registered.
import AppBuilder from '../../../pages/AppBuilder';
import WidgetPalette, { PALETTE_TAB_STORAGE_KEY } from '../WidgetPalette';
import { PANEL_COLLAPSE_STORAGE_KEY, effectiveRequireRunContext, requireRunContextValue } from '../ContextPanel';

beforeEach(() => {
  saveApp.mockClear();
  localStorage.clear();
});

// ─── 1) Ribbon tabs ───────────────────────────────────────────────────────────

describe('WidgetPalette ribbon tabs', () => {
  it('shows only the active category, switches on tab click, and calls onAdd', () => {
    const onAdd = vi.fn();
    render(<WidgetPalette onAdd={onAdd} />);

    // Display is the default tab.
    expect(screen.getByRole('tab', { name: 'Display' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('button', { name: 'Video' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Scan' })).toBeNull();

    // Switching to Inputs swaps the button set.
    fireEvent.click(screen.getByRole('tab', { name: 'Inputs' }));
    expect(screen.getByRole('tab', { name: 'Inputs' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('button', { name: 'Scan' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Video' })).toBeNull();

    // Production category renders its own set too.
    fireEvent.click(screen.getByRole('tab', { name: 'Production' }));
    expect(screen.getByRole('button', { name: 'Kit Checklist' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Scan' })).toBeNull();

    // Clicking a widget button adds that widget type.
    fireEvent.click(screen.getByRole('button', { name: 'Pass / Fail' }));
    expect(onAdd).toHaveBeenCalledWith('pass-fail');
  });

  it('persists the active tab in localStorage and restores it on remount', () => {
    const onAdd = vi.fn();
    const { unmount } = render(<WidgetPalette onAdd={onAdd} />);
    fireEvent.click(screen.getByRole('tab', { name: 'Inputs' }));
    expect(localStorage.getItem(PALETTE_TAB_STORAGE_KEY)).toBe('Inputs');
    unmount();

    render(<WidgetPalette onAdd={onAdd} />);
    expect(screen.getByRole('tab', { name: 'Inputs' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('button', { name: 'Scan' })).toBeInTheDocument();
  });

  it('is keyboard navigable — arrow keys move the active tab', () => {
    render(<WidgetPalette onAdd={vi.fn()} />);
    const display = screen.getByRole('tab', { name: 'Display' });
    expect(display).toHaveAttribute('tabindex', '0');
    fireEvent.keyDown(display, { key: 'ArrowRight' });
    expect(screen.getByRole('tab', { name: 'Inputs' })).toHaveAttribute('aria-selected', 'true');
    fireEvent.keyDown(screen.getByRole('tab', { name: 'Inputs' }), { key: 'ArrowLeft' });
    expect(screen.getByRole('tab', { name: 'Display' })).toHaveAttribute('aria-selected', 'true');
  });
});

// ─── 2) Prominent add step ────────────────────────────────────────────────────

describe('add step button', () => {
  it('"+ New step" appends a step and selects it', async () => {
    renderBuilder();
    await screen.findByDisplayValue('Legacy Assembly');
    expect(screen.getByText('Step 1 of 1')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /new step/i }));

    // A second step appears in the list and becomes the active step.
    expect(await screen.findByText('Step 2 of 2')).toBeInTheDocument();
    expect(screen.getAllByText('Step 2').length).toBeGreaterThan(0);
  });

  it('empty canvas hint points at both the widget toolbar and "+ New step"', async () => {
    renderBuilder();
    await screen.findByDisplayValue('Legacy Assembly');
    fireEvent.click(screen.getByRole('button', { name: /new step/i }));
    // The freshly added step has no widgets — hint mentions widgets AND steps.
    expect(await screen.findByText(/Add widgets from the toolbar above/)).toBeInTheDocument();
    expect(screen.getByText(/New step.*in the left panel/)).toBeInTheDocument();
  });
});

// ─── 3) Collapsible context panel ─────────────────────────────────────────────

describe('collapsible context panel', () => {
  it('collapses to an icon rail, persists the preference, and re-expands', async () => {
    const { unmount } = renderBuilder();
    await screen.findByDisplayValue('Legacy Assembly');

    // Expanded by default — text tabs visible.
    expect(screen.getByRole('button', { name: 'Triggers' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Collapse panel' }));
    expect(localStorage.getItem(PANEL_COLLAPSE_STORAGE_KEY)).toBe('1');
    // Rail shows the expand control; the collapse control is gone.
    expect(screen.getByRole('button', { name: 'Expand panel' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Collapse panel' })).toBeNull();
    unmount();

    // Preference persists across a fresh mount.
    renderBuilder();
    await screen.findByDisplayValue('Legacy Assembly');
    expect(screen.getByRole('button', { name: 'Expand panel' })).toBeInTheDocument();

    // Clicking a rail icon re-expands onto that tab.
    fireEvent.click(screen.getByRole('button', { name: 'App' }));
    expect(localStorage.getItem(PANEL_COLLAPSE_STORAGE_KEY)).toBe('0');
    expect(screen.getByRole('button', { name: 'Collapse panel' })).toBeInTheDocument();
    expect(await screen.findByText('App Name')).toBeInTheDocument();
  });
});

// ─── 4) Run requirements toggle ───────────────────────────────────────────────

describe('run requirements (require_run_context)', () => {
  it('defaults ON for apps with no explicit value (schema_version >= 2 after normalize)', async () => {
    renderBuilder();
    await screen.findByDisplayValue('Legacy Assembly');
    fireEvent.click(screen.getByRole('button', { name: 'App' }));

    const toggle = screen.getByRole('switch', { name: 'Require a work order or part number to run' });
    expect(toggle).toHaveAttribute('aria-checked', 'true');

    fireEvent.click(screen.getByRole('button', { name: /^save$/i }));
    await waitFor(() => expect(saveApp).toHaveBeenCalledTimes(1));
    const [, payload] = saveApp.mock.calls[0] as [string, { require_run_context: boolean; schema_version: number }];
    expect(payload.require_run_context).toBe(true);
    expect(payload.schema_version).toBe(2);
  });

  it('toggling OFF round-trips false through the save payload and shows the effective state', async () => {
    renderBuilder();
    await screen.findByDisplayValue('Legacy Assembly');
    fireEvent.click(screen.getByRole('button', { name: 'App' }));

    const toggle = screen.getByRole('switch', { name: 'Require a work order or part number to run' });
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-checked', 'false');
    expect(screen.getByText(/not required/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /^save$/i }));
    await waitFor(() => expect(saveApp).toHaveBeenCalledTimes(1));
    const [, payload] = saveApp.mock.calls[0] as [string, { require_run_context: boolean }];
    expect(payload.require_run_context).toBe(false);

    // Toggling back ON round-trips true.
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-checked', 'true');
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }));
    await waitFor(() => expect(saveApp).toHaveBeenCalledTimes(2));
    const [, payload2] = saveApp.mock.calls[1] as [string, { require_run_context: boolean }];
    expect(payload2.require_run_context).toBe(true);
  });

  it('helper contract: absent = default by schema_version; explicit value always wins', () => {
    const base = v1App();
    // v1 blob, untouched: no explicit value, legacy default OFF.
    expect(requireRunContextValue(base)).toBeUndefined();
    expect(effectiveRequireRunContext(base)).toBe(false);
    // v2 app with no explicit value: default ON.
    expect(effectiveRequireRunContext({ ...base, schema_version: 2 })).toBe(true);
    // Explicit value wins in both directions (booleans and SQLite 0/1).
    const withFlag = (v: boolean | number) => ({ ...base, schema_version: 2, require_run_context: v } as App);
    expect(effectiveRequireRunContext(withFlag(false))).toBe(false);
    expect(effectiveRequireRunContext(withFlag(0))).toBe(false);
    expect(effectiveRequireRunContext(withFlag(1))).toBe(true);
    expect(requireRunContextValue(withFlag(true))).toBe(true);
  });
});

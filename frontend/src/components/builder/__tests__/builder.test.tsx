// ─── Builder remodel smoke tests (spec §8 Task C "done when") ────────────────
// A v1 app blob opens through normalizeApp, renders the four-region layout,
// auto-registers legacy variable names, and saves as schema_version 2 through
// the typed saveApp client method.

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

// A representative legacy (schema_version 1) blob: free-text variableName,
// buttonType button, parts_list, no triggers/groups/variables.
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
        takt_time_seconds: 90,
        layoutMode: 'canvas', canvasHeight: 560,
        parts_list: [{ name: 'M8 bolt', sku: 'M8-01', quantity: 4, unit: 'ea' }],
        widgets: [
          { id: 'w1', type: 'text-input', label: 'Serial', order: 0, config: { variableName: 'serial_number', required: true }, layout: { x: 40, y: 40, width: 380, height: 84 } },
          { id: 'w2', type: 'button', label: '', order: 1, config: { buttonText: 'Done', buttonType: 'complete' }, layout: { x: 40, y: 160, width: 220, height: 56 } },
        ],
      },
    ],
  };
}

function renderBuilder() {
  return render(
    <MemoryRouter initialEntries={['/builder/app1']}>
      <Routes>
        <Route path="/builder/:id" element={<AppBuilderLazy />} />
      </Routes>
    </MemoryRouter>
  );
}

// Import after mocks are registered.
import AppBuilder from '../../../pages/AppBuilder';
const AppBuilderLazy = AppBuilder;

describe('AppBuilder remodel', () => {
  beforeEach(() => saveApp.mockClear());

  it('opens a v1 app in the four-region layout', async () => {
    renderBuilder();
    // Top bar app name (inline edit input)
    expect(await screen.findByDisplayValue('Legacy Assembly')).toBeInTheDocument();
    // Left step list row
    expect(await screen.findAllByText('Torque check')).toBeTruthy();
    // Widget toolbar groups
    expect(screen.getByText('Display')).toBeInTheDocument();
    expect(screen.getByText('Inputs')).toBeInTheDocument();
    expect(screen.getByText('Actions')).toBeInTheDocument();
    expect(screen.getByText('Production')).toBeInTheDocument();
    // Context panel tabs
    expect(screen.getByRole('button', { name: 'Widget' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Triggers' })).toBeInTheDocument();
  });

  it('saves a v1 app as schema_version 2 through saveApp, with auto-registered variables and synthesized legacy trigger', async () => {
    renderBuilder();
    await screen.findByDisplayValue('Legacy Assembly');

    fireEvent.click(screen.getByRole('button', { name: /save/i }));

    await waitFor(() => expect(saveApp).toHaveBeenCalledTimes(1));
    const [id, payload] = saveApp.mock.calls[0] as [string, {
      schema_version: number;
      step_groups: unknown[];
      variables: { name: string; type: string }[];
      steps: App['steps'];
    }];
    expect(id).toBe('app1');
    expect(payload.schema_version).toBe(2);
    expect(payload.step_groups).toEqual([]);
    // Legacy free-text variableName auto-registered (spec §4.1)
    expect(payload.variables.map(v => v.name)).toContain('serial_number');
    // Legacy buttonType button carries its synthesized trigger (spec §2.4)
    const button = payload.steps[0].widgets.find(w => w.type === 'button');
    expect(button?.triggers?.[0]?.actions).toEqual([{ type: 'complete_app' }]);
    // parts_list preserved byte-for-byte
    expect(payload.steps[0].parts_list).toEqual([{ name: 'M8 bolt', sku: 'M8-01', quantity: 4, unit: 'ea' }]);
  });
});

// ─── The publish modal is where change control is made ───────────────────────
//
// Publishing used to be a button that flipped a status. It is now the moment a
// numbered revision is cut, so this file pins the four things the modal must
// not get wrong:
//
//   1. A change note is mandatory — Publish stays disabled without one.
//   2. The approver list carries authority: never the author, never an
//      inactive account, never a viewer or an operator.
//   3. The diff it shows is the SERVER'S diff, printed as words a publisher can
//      check ("1 step added, 1 renamed"), and "First revision" when there is
//      nothing to compare against.
//   4. A published app with an edited draft says so, permanently, in a banner —
//      because operators keep running the old revision until somebody publishes.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { App } from '../../types';

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
global.ResizeObserver = ResizeObserverStub as unknown as typeof ResizeObserver;

const getUsers = vi.fn();
const saveApp = vi.fn().mockResolvedValue({});

vi.mock('../../api/client', () => ({
  api: {
    getApp: vi.fn(() => Promise.resolve(publishedApp())),
    getProductTypes: vi.fn(() => Promise.resolve([])),
    getDepartments: vi.fn(() => Promise.resolve([])),
    getStations: vi.fn(() => Promise.resolve([])),
    getTables: vi.fn(() => Promise.resolve([])),
    getTable: vi.fn(() => Promise.resolve({ id: 't1', name: 'T', fields: [] })),
    get getUsers() { return getUsers; },
    saveApp: (...args: unknown[]) => saveApp(...args),
    uploadImage: vi.fn(),
    createProductType: vi.fn(),
    updateProductType: vi.fn(),
    deleteProductType: vi.fn(),
  },
}));

const getAppDraft = vi.fn();
const getRevisionDiff = vi.fn();
const publishRevision = vi.fn();
const setRequiresApproval = vi.fn();

vi.mock('../../api/revisions', async () => {
  const actual = await vi.importActual<typeof import('../../api/revisions')>('../../api/revisions');
  return {
    ...actual,
    get getAppDraft() { return getAppDraft; },
    get getRevisionDiff() { return getRevisionDiff; },
    get publishRevision() { return publishRevision; },
    get setRequiresApproval() { return setRequiresApproval; },
  };
});

vi.mock('../../context/AuthContext', () => ({
  useAuth: () => ({
    canEdit: true,
    user: { id: 'me', display_name: 'Dana Publisher', role: 'manager' },
    isAtLeast: (role: string) => ['supervisor', 'operator', 'viewer', 'manager'].includes(role),
  }),
}));

import AppBuilder from '../AppBuilder';

/** A published app whose draft has NOT moved on. */
function publishedApp(over: Record<string, unknown> = {}): App {
  return {
    id: 'app1',
    name: 'Final QC Inspection',
    description: '',
    status: 'published',
    created_at: '', updated_at: '',
    schema_version: 2,
    variables: [],
    step_groups: [],
    steps: [
      {
        id: 's1', name: 'Torque check', order: 0, layoutMode: 'canvas', canvasHeight: 560,
        widgets: [
          { id: 'w1', type: 'text-input', label: 'Serial', order: 0, config: { variableName: 'serial' }, layout: { x: 40, y: 40, width: 380, height: 84 } },
        ],
      },
    ],
    current_revision: 2,
    requires_approval: 0,
    has_unpublished_changes: false,
    ...over,
  } as unknown as App;
}

function renderBuilder(path = '/builder/app1') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes><Route path="/builder/:id" element={<AppBuilder />} /></Routes>
    </MemoryRouter>,
  );
}

const COMPANY = [
  { id: 'me', display_name: 'Dana Publisher', role: 'manager', is_active: 1 },
  { id: 'u-sup', display_name: 'Sue Supervisor', role: 'supervisor', is_active: 1 },
  { id: 'u-op', display_name: 'Olga Operator', role: 'operator', is_active: 1 },
  { id: 'u-view', display_name: 'Vic Viewer', role: 'viewer', is_active: 1 },
  { id: 'u-gone', display_name: 'Gus Gone', role: 'manager', is_active: 0 },
];

beforeEach(() => {
  vi.clearAllMocks();
  saveApp.mockResolvedValue({});
  getUsers.mockResolvedValue(COMPANY);
  getAppDraft.mockResolvedValue(publishedApp());
  getRevisionDiff.mockResolvedValue({
    current_revision: 2, next_revision: 3,
    diff: { added: ['Torque audit'], removed: [], renamed: [{ from: 'A', to: 'B' }], moved: [], changed_widgets: 0 },
    has_unpublished_changes: true,
  });
  publishRevision.mockResolvedValue({ revision: 3, current_revision: 3, diff: null });
});

async function openModal() {
  renderBuilder();
  await screen.findByDisplayValue('Final QC Inspection');
  fireEvent.click(screen.getByRole('button', { name: /^Publish$/ }));
  return screen.findByTestId('publish-diff');
}

describe('The publish modal will not publish without a change note', () => {
  it('keeps Publish disabled until something is typed, and enables it after', async () => {
    await openModal();
    const button = screen.getByRole('button', { name: /Publish Rev 3/ });
    expect(button).toBeDisabled();
    fireEvent.change(screen.getByRole('textbox', { name: /What changed/ }), {
      target: { value: 'added torque check' },
    });
    expect(button).not.toBeDisabled();
    fireEvent.click(button);
    await waitFor(() => expect(publishRevision).toHaveBeenCalled());
    expect(publishRevision.mock.calls[0][1]).toEqual({
      change_note: 'added torque check', approved_by_user_id: null,
    });
  });

  it('takes no autoFocus anywhere in the dialog', async () => {
    const panel = await openModal();
    const dialog = panel.closest('div')!.parentElement!;
    expect(dialog.querySelectorAll('[autofocus]').length).toBe(0);
  });
});

describe('The publish modal shows the diff the server computed', () => {
  it('names the revisions and what changed between them', async () => {
    const panel = await openModal();
    await waitFor(() => expect(panel.textContent).toContain('Rev 2 → Rev 3'));
    expect(panel.textContent).toContain('1 step added, 1 renamed');
  });

  it('reports a pure reorder as a move rather than as nothing', async () => {
    getRevisionDiff.mockResolvedValue({
      current_revision: 2, next_revision: 3,
      diff: { added: [], removed: [], renamed: [], moved: ['Torque check'], changed_widgets: 0 },
      has_unpublished_changes: true,
    });
    const panel = await openModal();
    await waitFor(() => expect(panel.textContent).toContain('1 step moved'));
    expect(panel.textContent).not.toContain('no step changes');
  });

  it('says "First revision" on an app that has never been published', async () => {
    getAppDraft.mockResolvedValue(publishedApp({ current_revision: 0, status: 'draft' }));
    const panel = await openModal();
    expect(panel.textContent).toContain('First revision');
    expect(getRevisionDiff).not.toHaveBeenCalled();
  });
});

describe('The approver list carries authority', () => {
  it('excludes the author, inactive accounts, and anyone below supervisor', async () => {
    getAppDraft.mockResolvedValue(publishedApp({ requires_approval: 1 }));
    await openModal();
    const select = await screen.findByRole('combobox', { name: /Approved by/ });
    const names = Array.from(select.querySelectorAll('option')).map(o => o.textContent);
    expect(names.some(n => n?.includes('Sue Supervisor'))).toBe(true);
    expect(names.some(n => n?.includes('Dana Publisher'))).toBe(false);
    expect(names.some(n => n?.includes('Olga Operator'))).toBe(false);
    expect(names.some(n => n?.includes('Vic Viewer'))).toBe(false);
    expect(names.some(n => n?.includes('Gus Gone'))).toBe(false);
  });

  it('will not publish a gated app until an approver is chosen', async () => {
    getAppDraft.mockResolvedValue(publishedApp({ requires_approval: 1 }));
    await openModal();
    fireEvent.change(screen.getByRole('textbox', { name: /What changed/ }), {
      target: { value: 'issue 2' },
    });
    const button = screen.getByRole('button', { name: /Publish Rev 3/ });
    expect(button).toBeDisabled();
    fireEvent.change(await screen.findByRole('combobox', { name: /Approved by/ }), {
      target: { value: 'u-sup' },
    });
    expect(button).not.toBeDisabled();
    fireEvent.click(button);
    await waitFor(() => expect(publishRevision).toHaveBeenCalled());
    expect(publishRevision.mock.calls[0][1].approved_by_user_id).toBe('u-sup');
  });
});

describe('A published app with an edited draft says so', () => {
  it('shows the banner naming the revision operators are still running', async () => {
    getAppDraft.mockResolvedValue(publishedApp({ has_unpublished_changes: true }));
    renderBuilder();
    const banner = await screen.findByTestId('unpublished-changes-banner');
    expect(banner.textContent).toContain('Editing draft — revision 2 is live');
  });

  it('shows no banner when the draft matches the live revision', async () => {
    renderBuilder();
    await screen.findByDisplayValue('Final QC Inspection');
    expect(screen.queryByTestId('unpublished-changes-banner')).toBeNull();
  });

  it('opens straight into the modal from a ?publish=1 deep link', async () => {
    renderBuilder('/builder/app1?publish=1');
    expect(await screen.findByTestId('publish-diff')).toBeTruthy();
  });
});

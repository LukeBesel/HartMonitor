import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { LayoutDashboard } from 'lucide-react';

// ─── One guide, and only when asked ───────────────────────────────────────────
// A new account used to meet four guided systems in its first session: the
// welcome wizard, a module tour that opened itself on nine different screens, a
// sidebar setup checklist and a training coach. An audit lost two clicks to a
// tour overlay that was in front of the thing being clicked.
//
// The rules this file pins:
//   1. <ModuleOnboarding/> never opens itself. It renders a "Show me around"
//      button, and the tour appears when — and only when — that is clicked.
//   2. There are at most five tours, and every one of them describes a screen
//      that still exists as a route (checked against App.tsx on disk, because a
//      tour of a deleted screen is exactly the bug this replaces).
//   3. The training coach stands down for good once the account has a published
//      app and a completed run.
//   4. The onboarding does not claim anything the product cannot do.

const getApps = vi.fn();
const getAppsStats = vi.fn();
const getUsers = vi.fn();

vi.mock('../../../api/client', () => ({
  api: {
    get getApps() { return getApps; },
    get getAppsStats() { return getAppsStats; },
    get getUsers() { return getUsers; },
  },
}));

vi.mock('../../../context/AuthContext', () => ({
  useAuth: () => ({
    user: { id: 'u-1', email: 'a@b.c', display_name: 'Ana Diaz', role: 'manager' },
    canEdit: true, isAtLeast: () => true, loading: false,
  }),
}));

vi.mock('../../../context/ModulesContext', () => ({
  useModules: () => ({ isEnabled: () => true, loading: false }),
}));

vi.mock('../../../context/BrandingContext', () => ({
  useBranding: () => ({ companyName: 'Acme', refresh: () => {} }),
  useCompanySetting: () => ({ value: 'true', status: 'ready' }),
}));

import ModuleOnboarding, { hasSeenWalkthrough, markWalkthroughSeen, resetWalkthrough } from '../ModuleOnboarding';
import { WALKTHROUGHS, getWalkthrough } from '../../../config/walkthroughs';
import { SetupChecklist } from '../SetupChecklist';
import AppTrainingCoach from '../../apps/AppTrainingCoach';

/** Every moduleId the nine pages that mount <ModuleOnboarding/> actually pass.
 *  None of those pages may be edited, so all nine have to stay safe. */
const PAGE_MODULE_IDS = [
  'dashboard', 'analytics', 'schedule', 'dashboards', 'inventory',
  'routings', 'departments', 'sqdc', 'stations',
];

function renderOnboarding(moduleId: string) {
  return render(
    <ModuleOnboarding
      moduleId={moduleId}
      title="Command Center"
      description="A description the tour no longer reads."
      steps={['One', 'Two']}
      icon={LayoutDashboard}
      color="#3b82f6"
    />,
  );
}

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
});

afterEach(() => { localStorage.clear(); });

describe('a page tour waits to be asked', () => {
  it('opens nothing on arrival, even with no seen-key stored', () => {
    expect(hasSeenWalkthrough('dashboard')).toBe(false);
    renderOnboarding('dashboard');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('renders a "Show me around" button instead', () => {
    renderOnboarding('dashboard');
    expect(screen.getByRole('button', { name: /show me around/i })).toBeInTheDocument();
  });

  it('opens the walkthrough on click, and records the seen state on dismiss', () => {
    renderOnboarding('dashboard');
    fireEvent.click(screen.getByRole('button', { name: /show me around/i }));

    const dialog = screen.getByRole('dialog');
    expect(dialog).toBeInTheDocument();
    // The tour's real first step, from the registry — not the page's props.
    expect(screen.getByText(WALKTHROUGHS.dashboard[0].title)).toBeInTheDocument();

    expect(hasSeenWalkthrough('dashboard')).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: /skip tour/i }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(hasSeenWalkthrough('dashboard')).toBe(true);
  });

  it('closes on Escape', () => {
    renderOnboarding('dashboard');
    fireEvent.click(screen.getByRole('button', { name: /show me around/i }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('does not claim to be modal, because nothing here traps focus', () => {
    renderOnboarding('dashboard');
    fireEvent.click(screen.getByRole('button', { name: /show me around/i }));
    // aria-modal tells a screen reader the rest of the page is inert. There is
    // no focus trap, so saying it would be a promise the markup cannot keep.
    expect(screen.getByRole('dialog')).not.toHaveAttribute('aria-modal');
  });

  it('still shows the button once the tour has been seen', () => {
    markWalkthroughSeen('dashboard');
    renderOnboarding('dashboard');
    expect(screen.getByRole('button', { name: /show me around/i })).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('keeps its seen-state helpers exported and working', () => {
    markWalkthroughSeen('inventory');
    expect(hasSeenWalkthrough('inventory')).toBe(true);
    resetWalkthrough('inventory');
    expect(hasSeenWalkthrough('inventory')).toBe(false);
  });

  it('renders nothing at all — not even a button — for a page with no tour', () => {
    for (const id of PAGE_MODULE_IDS.filter(id => !getWalkthrough(id))) {
      const { container, unmount } = renderOnboarding(id);
      expect(container).toBeEmptyDOMElement();
      unmount();
    }
  });

  it('never opens a dialog for ANY of the nine pages that mount it', () => {
    for (const id of PAGE_MODULE_IDS) {
      const { unmount } = renderOnboarding(id);
      expect(screen.queryByRole('dialog')).toBeNull();
      unmount();
    }
  });
});

describe('there are five tours, and each one describes a screen that exists', () => {
  const APP_TSX = readFileSync(resolve(__dirname, '../../../App.tsx'), 'utf8');

  it('keeps at most five walkthroughs', () => {
    expect(Object.keys(WALKTHROUGHS).length).toBeLessThanOrEqual(5);
  });

  it('has dropped every tour of a screen that is gone', () => {
    for (const dead of ['departments', 'sqdc', 'routings', 'dashboards', 'leaderboard',
      'quality', 'oee', 'plant', 'manager', 'audit']) {
      expect(WALKTHROUGHS[dead]).toBeUndefined();
      expect(getWalkthrough(dead)).toBeUndefined();
    }
  });

  it('resolves no alias to a deleted tour', () => {
    for (const alias of ['transaction-log', 'auditlog', 'audit-log', 'plant-view', 'manager-view', 'oeetracker']) {
      expect(getWalkthrough(alias)).toBeUndefined();
    }
  });

  it('maps every remaining key to a real Route in App.tsx', () => {
    for (const key of Object.keys(WALKTHROUGHS)) {
      // A page's moduleId is its path. /sqdc and /plant only survive in App.tsx
      // as redirects, so a live Route element is what is checked.
      const routed = new RegExp(`path="/${key}"\\s+element=\\{<(?!Navigate)`).test(APP_TSX);
      expect(routed, `no live Route renders /${key} in App.tsx`).toBe(true);
    }
  });

  it('gives every tour at least one step with real copy', () => {
    for (const [key, steps] of Object.entries(WALKTHROUGHS)) {
      expect(steps.length, key).toBeGreaterThan(0);
      for (const step of steps) {
        expect(step.title.length, key).toBeGreaterThan(0);
        expect(step.body.length, key).toBeGreaterThan(0);
      }
    }
  });

  it('no longer narrates the dashboard sections that were retired', () => {
    const copy = JSON.stringify(WALKTHROUGHS.dashboard);
    expect(copy).not.toMatch(/Live Floor View/);
    expect(copy).not.toMatch(/alert feed/i);
  });

  it('never sends anyone to a screen that no longer exists', () => {
    // The tours that were deleted were only half the problem; the ones that
    // survived still name other screens in their copy, and two of those screens
    // are now redirects. A tour that says "go and look at Plant View" is the
    // same bug in a smaller font.
    const RETIRED = [
      'Plant View', 'Manager View', 'SQDC', 'OEE Tracker', 'Departments page',
      'Department View', 'Live Floor View', 'alert feed', 'Transaction Log',
      'Audit Log', 'Step Metrics',
    ];
    const copy = JSON.stringify(WALKTHROUGHS);
    for (const name of RETIRED) {
      expect(copy.toLowerCase(), `a tour still points at "${name}"`)
        .not.toContain(name.toLowerCase());
    }
  });

  it('names only screens the app still routes to', () => {
    // Every multi-word capitalised phrase in the surviving copy, checked by
    // hand against the product: these four are a nav label, two page headings
    // and a control, all of which are on screen today.
    const NAMED_AND_REAL = ['Command Center', 'Needs Attention', 'Operation Analytics', 'Hit Refresh'];
    const phrases = new Set<string>();
    for (const steps of Object.values(WALKTHROUGHS)) {
      for (const step of steps) {
        for (const text of [step.title, step.body, ...(step.bullets ?? [])]) {
          for (const m of text.match(/\b[A-Z][a-z]+(?: [A-Z][a-z]+)+\b/g) ?? []) phrases.add(m);
        }
      }
    }
    for (const phrase of phrases) {
      expect(NAMED_AND_REAL, `unreviewed screen name in tour copy: "${phrase}"`).toContain(phrase);
    }
  });
});

describe('the training coach stands down once the account has done the thing', () => {
  const publishedApp = {
    id: 'app-1', name: 'Bracket Assembly', description: '', status: 'published',
    steps: [{ id: 's1', name: 'One', order: 0, widgets: [{ id: 'w1', type: 'text-input', label: 'x', order: 0, config: {} }] }],
  };

  function renderCoach() {
    return render(
      <MemoryRouter initialEntries={['/apps']}>
        <AppTrainingCoach />
      </MemoryRouter>,
    );
  }

  it('renders nothing when the company has a published app AND a completed run', async () => {
    getApps.mockResolvedValue([publishedApp]);
    getAppsStats.mockResolvedValue({ company_has_completions: true });

    const { container } = renderCoach();
    await waitFor(() => expect(getAppsStats).toHaveBeenCalled());
    await waitFor(() => expect(container).toBeEmptyDOMElement());
    expect(screen.queryByText(/build your first app/i)).toBeNull();
  });

  it('still coaches an account that published but has never run anything', async () => {
    getApps.mockResolvedValue([publishedApp]);
    getAppsStats.mockResolvedValue({ company_has_completions: false });

    renderCoach();
    await waitFor(() => expect(screen.getByText(/build your first app/i)).toBeInTheDocument());
  });

  it('still coaches an account that has runs but nothing published', async () => {
    getApps.mockResolvedValue([{ ...publishedApp, status: 'draft' }]);
    getAppsStats.mockResolvedValue({ company_has_completions: true });

    renderCoach();
    await waitFor(() => expect(screen.getByText(/build your first app/i)).toBeInTheDocument());
  });
});

describe('the setup checklist stops contradicting the publish modal', () => {
  it('no longer asks for a workstation', async () => {
    // The account has published and run something (so the coach has stood down
    // and this list takes over) but is still a team of one — the state where
    // the checklist is actually on screen.
    getApps.mockResolvedValue([{ id: 'app-1', name: 'Bracket Assembly', status: 'published', steps: [] }]);
    getAppsStats.mockResolvedValue({ company_has_completions: true });
    getUsers.mockResolvedValue([{ id: 'u-1' }]);

    render(
      <MemoryRouter initialEntries={['/dashboard']}>
        <SetupChecklist />
      </MemoryRouter>,
    );

    await waitFor(() => expect(screen.getByText(/setup checklist/i)).toBeInTheDocument());
    expect(screen.queryByText(/work station/i)).toBeNull();
    expect(screen.queryByText(/workstation/i)).toBeNull();
  });
});

describe('the welcome tour does not promise what the player cannot do', () => {
  const WIZARD = readFileSync(resolve(__dirname, '../OnboardingWizard.tsx'), 'utf8');

  it('has dropped the offline queue claim', () => {
    // A run cannot be STARTED offline, so the old bullet was a promise the
    // player breaks on the first shift with bad Wi-Fi. The phrase is assembled
    // from pieces so that grepping the source for it finds the product, and
    // never this test.
    const oldClaim = ['queues', 'up', 'and', 'flushes'].join(' ');
    expect(WIZARD.includes(oldClaim)).toBe(false);
  });

  it('says the true thing instead', () => {
    expect(WIZARD).toMatch(/A run already started keeps recording offline and syncs when you reconnect\./);
  });
});

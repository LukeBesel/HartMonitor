import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

// ─── Four groups, and every old link still lands ──────────────────────────────
//
// Settings had thirteen tabs. Thirteen labelled tabs are wider than a 1440px
// screen, so the row overflowed and the last of them could only be reached by
// dragging the whole page sideways. They are now four groups, each a page of
// titled sections.
//
// The rule that makes that split safe is the one this file pins: every `?tab=`
// id Settings has ever answered to — including `?tab=facility`, which the
// product printed for itself but was never a tab, so it silently landed on My
// Account — resolves to exactly one group and one section, and that section is
// the one scrolled into view. One assertion per id, so a future rename cannot
// quietly break a link that is sitting in somebody's bookmarks or in a
// screen's empty state.
//
// The leaf sections are stubbed: each is unchanged code moved into its own
// file, and their own behaviour is covered where it always was. What is new,
// and what is tested here, is the shell — the routing, the role gate and the
// four tabs.

let role = 'manager';
const isAtLeast = (r: string) => {
  const levels: Record<string, number> = { developer: 5, manager: 4, supervisor: 3, operator: 2, viewer: 1 };
  return (levels[role] ?? 0) >= (levels[r] ?? 99);
};

vi.mock('../../context/AuthContext', () => ({
  useAuth: () => ({
    user: { id: 'u-1', email: 'a@b.c', display_name: 'Ana Diaz', role },
    isAtLeast, canEdit: true, loading: false,
  }),
  useAuthUserId: () => 'u-1',
}));

// Every leaf section, stubbed to a nameplate. The shell's job is to put the
// right one in front of the reader, not to re-test them.
vi.mock('../settings/AccountTab', () => ({ AccountTab: () => <div>account panel</div> }));
vi.mock('../settings/ThemeTab', () => ({ ThemeTab: () => <div>theme panel</div> }));
vi.mock('../settings/CompanyTab', () => ({ CompanyTab: () => <div>company panel</div> }));
vi.mock('../settings/PlanTab', () => ({ PlanTab: () => <div>plan panel</div> }));
vi.mock('../settings/ModulesTab', () => ({ ModulesTab: () => <div>modules panel</div> }));
vi.mock('../settings/NavigationTab', () => ({ NavigationTab: () => <div>navigation panel</div> }));
vi.mock('../settings/SitesTab', () => ({ SitesTab: () => <div>sites panel</div> }));
vi.mock('../settings/NotificationsTab', () => ({ NotificationsTab: () => <div>notifications panel</div> }));
vi.mock('../settings/ApiTab', () => ({ ApiTab: () => <div>api panel</div> }));
vi.mock('../settings/ExportTab', () => ({ ExportTab: () => <div>export panel</div> }));
vi.mock('../settings/HelpTab', () => ({ HelpTab: () => <div>help panel</div> }));
vi.mock('../settings/UsersTab', () => ({
  UsersTab: () => <div>users panel</div>,
  PermissionsTab: () => <div>permissions panel</div>,
}));
vi.mock('../../components/shared/PendingResetsPanel', () => ({
  default: () => <div>pending resets panel</div>,
}));

import SettingsPage from '../Settings';
import { OLD_TAB_TARGETS, GROUPS } from '../settings/groups';

/** Section ids the shell asked the browser to scroll to, in order. */
const scrolled: string[] = [];
Element.prototype.scrollIntoView = function (this: Element) { scrolled.push(this.id); };

function open(search: string) {
  return render(
    <MemoryRouter initialEntries={[`/settings${search}`]}>
      <SettingsPage />
    </MemoryRouter>,
  );
}

function shell() {
  return screen.getByTestId('settings-group');
}

function tabButtons() {
  return within(screen.getByRole('navigation', { name: 'Settings groups' })).getAllByRole('button');
}

beforeEach(() => {
  role = 'manager';
  scrolled.length = 0;
  cleanup();
});

describe('the tab strip is four tabs, not thirteen', () => {
  it('shows exactly four groups', () => {
    open('?tab=account');
    expect(tabButtons()).toHaveLength(4);
  });

  it('names them My Account, Company, Facility and Integrations', () => {
    open('?tab=account');
    expect(tabButtons().map(b => b.textContent)).toEqual(
      ['My Account', 'Company', 'Facility', 'Integrations'],
    );
    expect(GROUPS).toHaveLength(4);
  });

  it('offers an operator only the groups they may open', () => {
    // Which workspaces the plant shows is plant configuration now, so it sits
    // behind the manager gate with the rest of the company's settings.
    role = 'operator';
    open('?tab=account');
    expect(tabButtons().map(b => b.textContent)).toEqual(['My Account', 'Integrations']);
  });

  it('lands an operator following a manager-only link somewhere real', () => {
    role = 'operator';
    open('?tab=company');
    expect(shell()).toHaveAttribute('data-group', 'account');
    expect(screen.getByText('account panel')).toBeInTheDocument();
  });
});

describe('every link Settings has ever answered to still lands', () => {
  // One case per old tab id — the id, the group it belongs to now, and the
  // section that must be in view when you arrive.
  const CASES: [string, string, string][] = [
    ['account',       'account',      'account'],
    ['theme',         'account',      'theme'],
    ['company',       'company',      'company'],
    ['users',         'company',      'users'],
    ['plan',          'company',      'plan'],
    ['modules',       'company',      'modules'],
    ['sidebar',       'company',      'sidebar'],
    ['sites',         'facility',     'sites'],
    ['facility',      'facility',     'sites'],
    ['notifications', 'facility',     'notifications'],
    ['developer',     'integrations', 'api'],
    ['export',        'integrations', 'export'],
    ['help',          'integrations', 'help'],
  ];

  it('covers every id the shell claims to know', () => {
    expect(CASES.map(c => c[0]).sort()).toEqual(Object.keys(OLD_TAB_TARGETS).sort());
  });

  for (const [tab, group, section] of CASES) {
    it(`?tab=${tab} opens the ${group} group with ${section} in view`, () => {
      open(`?tab=${tab}`);

      const el = shell();
      expect(el).toHaveAttribute('data-group', group);
      expect(el).toHaveAttribute('data-section', section);

      // The section is really on the page, and really the one scrolled to.
      const anchor = document.getElementById(`settings-section-${section}`);
      expect(anchor).not.toBeNull();
      expect(anchor).toHaveAttribute('data-section', section);
      expect(scrolled).toContain(`settings-section-${section}`);
    });
  }
});

describe('a group addresses its own sections', () => {
  it('honours ?tab=<group>&section=<id>', () => {
    open('?tab=integrations&section=help');
    expect(shell()).toHaveAttribute('data-group', 'integrations');
    expect(shell()).toHaveAttribute('data-section', 'help');
    expect(scrolled).toContain('settings-section-help');
  });

  it('ignores a section that is not in the group it was asked for', () => {
    open('?tab=integrations&section=plan');
    expect(shell()).toHaveAttribute('data-group', 'integrations');
    expect(shell()).toHaveAttribute('data-section', 'api');
  });

  it('opens a group with no tab at all on its first section', () => {
    open('?tab=facility');
    expect(shell()).toHaveAttribute('data-section', 'sites');
  });

  it('sends an unknown tab to My Account rather than a blank screen', () => {
    open('?tab=nonsense-from-2019');
    expect(shell()).toHaveAttribute('data-group', 'account');
    expect(screen.getByText('account panel')).toBeInTheDocument();
  });

  it('opens My Account when nothing is asked for', () => {
    open('');
    expect(shell()).toHaveAttribute('data-group', 'account');
  });
});

describe('each group renders all of its sections', () => {
  it('stacks the company sections behind one tab', () => {
    open('?tab=company');
    for (const id of ['company', 'users', 'plan', 'modules', 'sidebar']) {
      expect(document.getElementById(`settings-section-${id}`)).not.toBeNull();
    }
  });

  it('keeps API keys out of an operator\'s Integrations page', () => {
    role = 'operator';
    open('?tab=integrations');
    expect(document.getElementById('settings-section-api')).toBeNull();
    expect(document.getElementById('settings-section-export')).not.toBeNull();
    expect(document.getElementById('settings-section-help')).not.toBeNull();
  });

  it('scrolls wide content inside the section, never the page', () => {
    open('?tab=facility');
    const section = document.getElementById('settings-section-sites')!;
    expect(section.querySelector('.overflow-x-auto')).not.toBeNull();
  });
});

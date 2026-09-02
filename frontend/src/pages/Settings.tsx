// ─── Settings ────────────────────────────────────────────────────────────────
//
// This file used to be four thousand three hundred lines and thirteen tabs.
// Thirteen labelled tabs are wider than a 1440px screen, so the row overflowed
// and the last of them could only be reached by dragging the page sideways —
// and one of the thirteen, "Developer", was a panel of deployment instructions
// addressed to whoever hosts the software rather than to the plant that bought
// it.
//
// It is now a shell over four groups, each a page of titled sections:
//
//   My Account     me: my login, my theme
//   Company        us: the company, its people, its plan, its modules, its nav
//   Facility       the plant: sites, departments, stations, shifts, alerts
//   Integrations   data in and out: API keys, webhooks, export, guides
//
// The sections themselves are unchanged code, moved into pages/settings/*. Every
// old `?tab=` link still lands on exactly the section it always did (see
// settings/groups.ts) — including `?tab=facility`, which was printed by the
// product but never existed as a tab, and used to land silently on My Account.

import { useEffect, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Settings, Key, Building2, Network, Plug } from 'lucide-react';
import TabBar from '../components/shared/TabBar';
import { useAuth } from '../context/AuthContext';
import { GROUPS, resolveTarget, type GroupId } from './settings/groups';
import AccountSettings from './settings/AccountSettings';
import CompanySettings from './settings/CompanySettings';
import FacilitySettings from './settings/FacilitySettings';
import IntegrationSettings from './settings/IntegrationSettings';

const GROUP_ICONS: Record<GroupId, React.ReactNode> = {
  account:      <Key size={15} />,
  company:      <Building2 size={15} />,
  facility:     <Network size={15} />,
  integrations: <Plug size={15} />,
};

const GROUP_BLURBS: Record<GroupId, string> = {
  account:      'Your login and how the product looks on this screen.',
  company:      'The company, its people, its plan and what they see.',
  facility:     'Sites, departments, work stations, shifts and alerts.',
  integrations: 'API keys, webhooks, data export and the guides.',
};

export default function SettingsPage() {
  const { isAtLeast } = useAuth();
  const [params, setParams] = useSearchParams();

  // Only the groups this person may actually open. A role that cannot open a
  // group is not shown a tab that answers 403.
  const tabs = useMemo(
    () => GROUPS.filter(g => !g.minRole || isAtLeast(g.minRole)),
    [isAtLeast],
  );

  const requested = resolveTarget(params.get('tab'), params.get('section'));
  // Deep-linking into a group this role cannot open falls back to the first one
  // it can — never to a blank screen.
  const allowed = tabs.some(t => t.id === requested.group);
  const target = allowed
    ? requested
    : resolveTarget(tabs[0]?.id ?? 'account', null);

  // Put the addressed section in front of the reader. Groups render all their
  // sections stacked, so the deep link is an anchor rather than a second tab
  // strip. jsdom has no layout, so guard the call rather than assume it.
  useEffect(() => {
    const el = document.getElementById(`settings-section-${target.section}`);
    if (el && typeof el.scrollIntoView === 'function') {
      el.scrollIntoView({ block: 'start', behavior: 'auto' });
    }
  }, [target.group, target.section]);

  const selectGroup = (id: GroupId) => {
    const next = new URLSearchParams(params);
    next.set('tab', id);
    next.delete('section');
    setParams(next, { replace: false });
  };

  return (
    <div className="p-6 bg-[#f8fafc] min-h-full overflow-x-hidden">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <div
          className="w-9 h-9 rounded-xl flex items-center justify-center shadow-sm shrink-0"
          style={{ backgroundColor: 'var(--accent-light)', color: 'var(--accent)' }}
        >
          <Settings size={18} />
        </div>
        <div className="min-w-0">
          <h1 className="text-xl font-bold text-gray-900 tracking-tight">Settings</h1>
          <p className="text-xs text-gray-500 mt-0.5 truncate">{GROUP_BLURBS[target.group]}</p>
        </div>
      </div>

      <TabBar
        items={tabs.map(tab => ({ key: tab.id, label: tab.label, icon: GROUP_ICONS[tab.id] }))}
        active={target.group}
        onSelect={selectGroup}
        variant="pill"
        ariaLabel="Settings groups"
        className="mb-6"
      />

      <div data-testid="settings-group" data-group={target.group} data-section={target.section}>
        {target.group === 'account'      && <AccountSettings />}
        {target.group === 'company'      && <CompanySettings />}
        {target.group === 'facility'     && <FacilitySettings />}
        {target.group === 'integrations' && <IntegrationSettings />}
      </div>
    </div>
  );
}

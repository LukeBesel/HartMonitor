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
//   My Account     me: my login, my theme, my own sidebar
//   Company        us: the company, its people, its plan, its modules, its nav
//   Facility       the plant: sites, departments, stations, shifts, alerts
//   Integrations   data in and out: API keys, webhooks, export, guides
//
// The sections themselves are unchanged code, moved into pages/settings/*. Every
// old `?tab=` link still lands on exactly the section it always did (see
// settings/groups.ts) — including `?tab=facility`, which was printed by the
// product but never existed as a tab, and used to land silently on My Account.

import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Settings, Key, Building2, Network, Plug } from 'lucide-react';
import TabBar from '../components/shared/TabBar';
import { useAuth } from '../context/AuthContext';
import { GROUPS, groupById, resolveTarget, type GroupId } from './settings/groups';
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
  account:      'Your login, how the product looks, and your own sidebar.',
  company:      'The company, its people, its plan and what they see.',
  facility:     'Sites, departments, stations, shifts and alerts.',
  integrations: 'API keys, webhooks, data export and the guides.',
};

/** Stop nudging a section into view once it has held still this long. */
const SETTLED_MS = 300;
/** And stop regardless after this, however restless the page is. */
const GIVE_UP_MS = 3000;

export default function SettingsPage() {
  const { isAtLeast } = useAuth();
  const [params, setParams] = useSearchParams();
  const groupRef = useRef<HTMLDivElement>(null);

  const canOpen = useCallback(
    (id: GroupId) => {
      const def = GROUPS.find(g => g.id === id);
      return !!def && (!def.minRole || isAtLeast(def.minRole));
    },
    [isAtLeast],
  );

  // Only the groups this person may actually open. A role that cannot open a
  // group is not shown a tab that answers 403.
  const tabs = useMemo(() => GROUPS.filter(g => canOpen(g.id)), [canOpen]);

  const target = resolveTarget(params.get('tab'), params.get('section'), canOpen);

  // A page can only scroll as far as it is tall. The last section of a group —
  // Notifications, say — sat two thirds down the screen however hard we aimed
  // at it, because there was nothing below it to scroll into. A deep link to
  // anything but a group's first section gets a viewport of empty room at the
  // end so its target can actually come up to the top; a plain tab click, which
  // is already at the top, does not pay for it.
  const needsRoom = target.section !== groupById(target.group).sections[0];

  // ── Put the addressed section in front of the reader, and keep it there ────
  //
  // Groups render their sections stacked, so a deep link is an anchor rather
  // than a second tab strip. Scrolling to it once on mount was not enough: the
  // sections above the target fetch their own data and grow as it lands, which
  // pushed the target back down the page — ?tab=users used to settle halfway
  // through the company form, and ?tab=plan inside the permissions matrix.
  // So we re-aim while the target keeps moving, and stop as soon as it holds
  // still, gives up, or the reader takes over by scrolling themselves.
  useEffect(() => {
    const anchorId = `settings-section-${target.section}`;
    const el = () => document.getElementById(anchorId);
    const first = el();
    if (!first || typeof first.scrollIntoView !== 'function') return;

    let done = false;
    let lastTop = -1;
    let settle: ReturnType<typeof setTimeout> | null = null;
    let giveUp: ReturnType<typeof setTimeout> | null = null;
    let observer: ResizeObserver | null = null;

    const stop = () => {
      if (done) return;
      done = true;
      if (settle) clearTimeout(settle);
      if (giveUp) clearTimeout(giveUp);
      observer?.disconnect();
      for (const evt of ['wheel', 'touchstart', 'keydown'] as const) {
        window.removeEventListener(evt, stop);
      }
    };

    const aim = () => {
      if (done) return;
      const node = el();
      if (!node) return;
      if (node.offsetTop === lastTop) return;   // nothing moved; leave it alone
      lastTop = node.offsetTop;
      node.scrollIntoView({ block: 'start', behavior: 'auto' });
      if (settle) clearTimeout(settle);
      settle = setTimeout(stop, SETTLED_MS);
    };

    aim();
    // The reader's own scroll wins immediately — nothing is more annoying than
    // a page that pulls itself back while you are reading it.
    for (const evt of ['wheel', 'touchstart', 'keydown'] as const) {
      window.addEventListener(evt, stop, { passive: true });
    }
    if (typeof ResizeObserver === 'function' && groupRef.current) {
      observer = new ResizeObserver(aim);
      observer.observe(groupRef.current);
    }
    giveUp = setTimeout(stop, GIVE_UP_MS);
    return stop;
  }, [target.group, target.section]);

  const selectGroup = (id: GroupId) => {
    // Built from the address bar rather than from the router's copy: PlanTab
    // strips ?checkout after showing "Payment successful", and a stale copy
    // held here would put it back and fire the toast again on the next click.
    const next = new URLSearchParams(window.location.search);
    next.set('tab', id);
    next.delete('section');
    next.delete('checkout');
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

      <div ref={groupRef} data-testid="settings-group" data-group={target.group} data-section={target.section}>
        {target.group === 'account'      && <AccountSettings />}
        {target.group === 'company'      && <CompanySettings />}
        {target.group === 'facility'     && <FacilitySettings />}
        {target.group === 'integrations' && <IntegrationSettings />}
      </div>
      {needsRoom && <div aria-hidden className="h-screen" />}
    </div>
  );
}

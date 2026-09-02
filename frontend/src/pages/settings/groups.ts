// ─── The four groups, and every link that used to point into the thirteen ────
//
// Settings had thirteen tabs. Thirteen tabs do not fit on a 1440px screen, so
// the row overflowed and the last few were unreachable without dragging the
// page sideways. They are now four groups, each a scrollable page of titled
// sections.
//
// Nothing that ever worked may stop working: every old `?tab=` id still names
// exactly one section, and OLD_TAB_TARGETS is the whole mapping — it is what
// the shell resolves against and what the tests assert one id at a time.
// `?tab=facility` is in here too; it was a link the product printed for itself
// and it was never a tab id, so it used to land silently on My Account.

export type GroupId = 'account' | 'company' | 'facility' | 'integrations';

export interface GroupDef {
  id: GroupId;
  label: string;
  /** Section ids in the order the group renders them; the first is its default. */
  sections: string[];
  /** Lowest role that may open the group at all. */
  minRole?: 'manager';
}

export const GROUPS: GroupDef[] = [
  { id: 'account',      label: 'My Account',   sections: ['account', 'theme', 'my-nav'] },
  { id: 'company',      label: 'Company',      sections: ['company', 'users', 'plan', 'modules', 'sidebar'], minRole: 'manager' },
  { id: 'facility',     label: 'Facility',     sections: ['sites', 'notifications'], minRole: 'manager' },
  { id: 'integrations', label: 'Integrations', sections: ['api', 'export', 'help'] },
];

export interface TabTarget { group: GroupId; section: string }

interface OldTab extends TabTarget {
  /** Where this link goes for somebody the first answer is closed to. */
  fallback?: TabTarget;
}

/** Every tab id Settings has ever answered to → where it lives now. */
export const OLD_TAB_TARGETS: Record<string, OldTab> = {
  account:       { group: 'account',      section: 'account' },
  theme:         { group: 'account',      section: 'theme' },
  company:       { group: 'company',      section: 'company' },
  users:         { group: 'company',      section: 'users' },
  plan:          { group: 'company',      section: 'plan' },
  modules:       { group: 'company',      section: 'modules' },
  // The old Navigation tab did two different jobs under one heading: it chose
  // which workspaces the WHOLE COMPANY sees, and it let the person reading it
  // hide individual items on THEIR OWN device. The first is plant
  // configuration and is now manager-only; the second was open to everybody
  // and stays open to everybody, in My Account. So this link has two honest
  // destinations, and which one you get depends on which half you may use.
  sidebar:       { group: 'company',      section: 'sidebar', fallback: { group: 'account', section: 'my-nav' } },
  sites:         { group: 'facility',     section: 'sites' },
  facility:      { group: 'facility',     section: 'sites' },
  notifications: { group: 'facility',     section: 'notifications' },
  developer:     { group: 'integrations', section: 'api' },
  export:        { group: 'integrations', section: 'export' },
  help:          { group: 'integrations', section: 'help' },
};

export function groupById(id: GroupId): GroupDef {
  return GROUPS.find(g => g.id === id) ?? GROUPS[0];
}

/**
 * Resolve `?tab=` (+ optional `?section=`) to a group and a section.
 *
 * Accepts an old tab id, a group id, or nothing. An unknown value lands on My
 * Account rather than on a blank screen. `canOpen` says which groups this role
 * may see: a link into a group they may not open falls back to the same link's
 * own second destination when it has one, and otherwise to the first group
 * they can open.
 */
export function resolveTarget(
  tab: string | null,
  section: string | null,
  canOpen: (group: GroupId) => boolean = () => true,
): TabTarget {
  const byOldId = tab ? OLD_TAB_TARGETS[tab] : undefined;
  const asGroup = GROUPS.find(g => g.id === tab)?.id;
  let group: GroupId = byOldId ? byOldId.group : (asGroup ?? 'account');
  let wanted = byOldId?.section;

  if (!canOpen(group)) {
    const fallback = byOldId?.fallback;
    if (fallback && canOpen(fallback.group)) {
      group = fallback.group;
      wanted = fallback.section;
      section = null;
    } else {
      group = GROUPS.find(g => canOpen(g.id))?.id ?? 'account';
      wanted = undefined;
      section = null;
    }
  }

  const def = groupById(group);
  // An explicit ?section= wins when the group actually has that section — it is
  // how a group's own links address one of its parts.
  if (section && def.sections.includes(section)) return { group, section };
  return { group, section: wanted ?? def.sections[0] };
}

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
  { id: 'account',      label: 'My Account',   sections: ['account', 'theme'] },
  { id: 'company',      label: 'Company',      sections: ['company', 'users', 'plan', 'modules', 'sidebar'], minRole: 'manager' },
  { id: 'facility',     label: 'Facility',     sections: ['sites', 'notifications'], minRole: 'manager' },
  { id: 'integrations', label: 'Integrations', sections: ['api', 'export', 'help'] },
];

export interface TabTarget { group: GroupId; section: string }

/** Every tab id Settings has ever answered to → where it lives now. */
export const OLD_TAB_TARGETS: Record<string, TabTarget> = {
  account:       { group: 'account',      section: 'account' },
  theme:         { group: 'account',      section: 'theme' },
  company:       { group: 'company',      section: 'company' },
  users:         { group: 'company',      section: 'users' },
  plan:          { group: 'company',      section: 'plan' },
  modules:       { group: 'company',      section: 'modules' },
  sidebar:       { group: 'company',      section: 'sidebar' },
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
 * Account rather than on a blank screen.
 */
export function resolveTarget(tab: string | null, section: string | null): TabTarget {
  const byOldId = tab ? OLD_TAB_TARGETS[tab] : undefined;
  const group = byOldId
    ? byOldId.group
    : (GROUPS.find(g => g.id === tab)?.id ?? 'account');
  const def = groupById(group);
  // An explicit ?section= wins when the group actually has that section — it is
  // how a group's own links address one of its parts.
  if (section && def.sections.includes(section)) return { group, section };
  return { group, section: byOldId?.section ?? def.sections[0] };
}

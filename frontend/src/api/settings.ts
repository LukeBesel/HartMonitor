// ─── Plant configuration that follows the company, not the device ────────────
//
// Which workspaces the sidebar shows, and whether the setup checklist has been
// put away, are decisions about how this plant runs. They used to live in each
// browser's localStorage: the manager who tidied the sidebar was the only
// person who saw the tidy sidebar, and the same person on a second tablet met
// the old one again. Both now live in `org_settings`, keyed by company, behind
// the config router that already serves every other company setting.
//
//   nav_hidden_sections        JSON array of hidden sidebar section ids
//   setup_checklist_dismissed  '1' / '0', or an ISO stamp of when it was put away
//
// Reads are open to any signed-in member (the sidebar has to render for an
// operator too); writes go through PUT /api/config, which requires manager or
// above — an operator cannot change what the plant's floor screens show.
//
// The visual theme is deliberately NOT here: a dark theme is a preference of
// the person and the screen in front of them, not a fact about the plant.

import { request } from './client';

export const NAV_HIDDEN_SECTIONS_KEY = 'nav_hidden_sections';
export const SETUP_CHECKLIST_DISMISSED_KEY = 'setup_checklist_dismissed';

/** Every org setting, as the config router stores them: strings, keyed by name. */
export type OrgSettings = Record<string, string>;

export function getOrgSettings(): Promise<OrgSettings> {
  return request<OrgSettings>('/config');
}

export function putOrgSettings(patch: Record<string, string>): Promise<OrgSettings> {
  return request<OrgSettings>('/config', { method: 'PUT', body: JSON.stringify(patch) });
}

/** A stored value is a JSON array of ids, or nothing we can use. */
export function parseHiddenSections(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : [];
  } catch {
    return [];
  }
}

/** '1', an ISO stamp — anything but an explicit "no" — means put away. */
export function parseDismissed(raw: string | null | undefined): boolean {
  if (raw === null || raw === undefined || raw === '') return false;
  return raw !== '0' && raw !== 'false';
}

/** The stored hidden sections, or `null` when the company has never set them
 *  (the caller then knows it may import a value left in this device's storage). */
export async function fetchNavHiddenSections(): Promise<string[] | null> {
  const settings = await getOrgSettings();
  const raw = settings[NAV_HIDDEN_SECTIONS_KEY];
  return raw === undefined ? null : parseHiddenSections(raw);
}

export function saveNavHiddenSections(ids: string[]): Promise<OrgSettings> {
  return putOrgSettings({ [NAV_HIDDEN_SECTIONS_KEY]: JSON.stringify([...ids]) });
}

/** `null` when the company has never answered either way. */
export async function fetchSetupChecklistDismissed(): Promise<boolean | null> {
  const settings = await getOrgSettings();
  const raw = settings[SETUP_CHECKLIST_DISMISSED_KEY];
  return raw === undefined ? null : parseDismissed(raw);
}

export function saveSetupChecklistDismissed(dismissed: boolean): Promise<OrgSettings> {
  // An ISO stamp answers "when did we put this away?" as well as "did we?" —
  // and reads as true through parseDismissed either way.
  return putOrgSettings({
    [SETUP_CHECKLIST_DISMISSED_KEY]: dismissed ? new Date().toISOString() : '0',
  });
}

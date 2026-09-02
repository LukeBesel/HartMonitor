// ─── Group 3: Facility ───────────────────────────────────────────────────────
// The shape of the plant itself — sites, the departments inside them, the
// stations inside those, and the shifts they run — plus who gets told when
// something on that floor needs attention.
//
// `?tab=facility` used to be a link that went nowhere: it was never a tab id,
// so it silently landed on My Account. It is this group.

import { SettingsSection } from './shared';
import { SitesTab } from './SitesTab';
import { NotificationsTab } from './NotificationsTab';

export default function FacilitySettings() {
  return (
    <div>
      <SettingsSection
        id="sites"
        title="Sites, Departments & Stations"
        description="Build the plant: sites, the departments in them, the stations in those, and the shifts they run."
      >
        <SitesTab />
      </SettingsSection>

      <SettingsSection id="notifications" title="Notifications" description="Who hears about what, and how.">
        <NotificationsTab />
      </SettingsSection>
    </div>
  );
}

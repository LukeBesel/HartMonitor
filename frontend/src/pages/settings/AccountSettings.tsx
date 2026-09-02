// ─── Group 1: My Account ─────────────────────────────────────────────────────
// The two settings that belong to the person reading them rather than to the
// company: their own login, and how the product looks on the screen in front of
// them. Nothing here changes anything for anybody else.

import { SettingsSection } from './shared';
import { AccountTab } from './AccountTab';
import { ThemeTab } from './ThemeTab';

export default function AccountSettings() {
  return (
    <div>
      <SettingsSection id="account" title="My Account" description="Your profile and password.">
        <AccountTab />
      </SettingsSection>
      <SettingsSection
        id="theme"
        title="Visual Theme"
        description="How HartMonitor looks on this screen. Saved for you, on this device."
      >
        <ThemeTab />
      </SettingsSection>
    </div>
  );
}

// ─── Group 1: My Account ─────────────────────────────────────────────────────
// The settings that belong to the person reading them rather than to the
// company: their own login, how the product looks on the screen in front of
// them, and which items their own sidebar shows. Nothing here changes anything
// for anybody else, so nothing here is gated by role.

import { SettingsSection } from './shared';
import { AccountTab } from './AccountTab';
import { ThemeTab } from './ThemeTab';
import { MyNavigationTab } from './NavigationTab';

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
      <SettingsSection
        id="my-nav"
        title="My Sidebar"
        description="Hide the individual items you don't use. Saved on this device only — everyone else keeps theirs."
      >
        <MyNavigationTab />
      </SettingsSection>
    </div>
  );
}

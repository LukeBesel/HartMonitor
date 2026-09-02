// ─── Group 2: Company ────────────────────────────────────────────────────────
// Everything that is true of the whole company: who it is, who works here and
// what they may do, what it pays for, which modules it runs, and which
// workspaces its people see in the sidebar. Manager and above — the tab strip
// does not offer this group to anyone else.

import { useAuth } from '../../context/AuthContext';
import PendingResetsPanel from '../../components/shared/PendingResetsPanel';
import { SettingsSection } from './shared';
import { CompanyTab } from './CompanyTab';
import { UsersTab, PermissionsTab } from './UsersTab';
import { PlanTab } from './PlanTab';
import { ModulesTab } from './ModulesTab';
import { NavigationTab } from './NavigationTab';

export default function CompanySettings() {
  const { isAtLeast } = useAuth();

  return (
    <div>
      <SettingsSection id="company" title="Company" description="Name, branding, contact details and the clock the plant's day runs on.">
        <CompanyTab />
      </SettingsSection>

      <SettingsSection id="users" title="Users & Access" description="Who works here, what each role may open, and floor PINs.">
        <UsersTab />
        <div className="mt-8"><PermissionsTab /></div>
        {/* Self-hosted password recovery. GET /api/admin/pending-resets is
            behind the 'developer' role, so only offer it to someone who
            will actually get an answer rather than a 403. */}
        {isAtLeast('developer') && <PendingResetsPanel />}
      </SettingsSection>

      <SettingsSection id="plan" title="Plan & Billing" description="Your plan, capacity and billing history.">
        <PlanTab />
      </SettingsSection>

      <SettingsSection id="modules" title="Modules" description="Turn whole areas of the product on and off for this company.">
        <ModulesTab />
      </SettingsSection>

      <SettingsSection
        id="sidebar"
        title="Navigation"
        description="Which sections this company's sidebar shows. Saved for everyone here."
      >
        <NavigationTab />
      </SettingsSection>
    </div>
  );
}

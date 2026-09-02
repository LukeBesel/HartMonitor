// ─── Group 4: Integrations & Data ────────────────────────────────────────────
// Getting data in and out: API keys, outbound webhooks, the full export, and
// the guides for the rest of the product.
//
// This is where the old "Developer" tab's useful half landed. Its other half —
// a panel naming the payment provider's secret-key environment variables and
// telling the customer to set them in their host and redeploy, plus a demo-only
// preview toggle — was addressed to whoever runs the servers, not to the plant
// that bought the software, and is gone. Deployment configuration belongs to
// HartMonitor's own staff console, and the server now only answers with it
// there.

import { useAuth } from '../../context/AuthContext';
import { SettingsSection } from './shared';
import { ApiTab } from './ApiTab';
import { ExportTab } from './ExportTab';
import { HelpTab } from './HelpTab';

export default function IntegrationSettings() {
  const { isAtLeast } = useAuth();

  return (
    <div>
      {/* API keys and webhooks were manager-only as the Developer tab, and stay
          manager-only here. Export and Help are for everybody. */}
      {isAtLeast('manager') && (
        <SettingsSection
          id="api"
          title="API & Webhooks"
          description="Keys for the read-only REST API, and webhooks that push events to your other systems."
        >
          <ApiTab />
        </SettingsSection>
      )}

      <SettingsSection id="export" title="Data Export" description="Take your data out, whenever you want it.">
        <ExportTab />
      </SettingsSection>

      <SettingsSection id="help" title="Help & Guides" description="What each part of HartMonitor is for, and how to use it.">
        <HelpTab />
      </SettingsSection>
    </div>
  );
}

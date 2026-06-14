import LegalShell, { Section, P, List } from '../marketing/LegalShell';

export default function Privacy() {
  return (
    <LegalShell title="Privacy Policy" updated="June 14, 2026">
      <P>
        This Privacy Policy explains how HartMonitor ("we," "us") collects, uses, and protects
        information when you use our manufacturing execution platform (the "Service"). We are
        committed to handling your data responsibly and transparently.
      </P>

      <Section heading="1. Information We Collect">
        <List items={[
          'Account information: name, email address, organization name, and role.',
          'Authentication data: hashed passwords and session tokens. We never store passwords in plain text.',
          'Customer Data: the production, scheduling, inventory, quality, and operational records you enter into the Service.',
          'Usage data: log records such as IP address, browser type, pages accessed, and timestamps.',
          'Payment data: if you purchase a paid plan, billing details are processed by our payment provider (Stripe). We do not store full card numbers.',
        ]} />
      </Section>

      <Section heading="2. How We Use Information">
        <List items={[
          'To provide, maintain, and improve the Service.',
          'To authenticate users and secure accounts.',
          'To process payments and manage subscriptions.',
          'To send service-related communications and, where enabled, operational alerts.',
          'To detect, prevent, and respond to security incidents and abuse.',
          'To comply with legal obligations.',
        ]} />
      </Section>

      <Section heading="3. Legal Bases (EEA/UK)">
        <P>
          Where applicable, we process personal data on the bases of performance of a contract,
          our legitimate interests in operating and securing the Service, your consent (where
          required), and compliance with legal obligations.
        </P>
      </Section>

      <Section heading="4. Sharing & Subprocessors">
        <P>
          We do not sell personal data. We share data only with service providers who help us
          operate the Service, under appropriate contractual protections. These may include:
        </P>
        <List items={[
          'Cloud hosting and database infrastructure providers.',
          'Stripe, for payment processing (only when you use paid plans).',
          'Email and SMS delivery providers, only when you enable notifications.',
          'Identity providers (Google, Microsoft), only when you choose SSO.',
        ]} />
        <P>We may also disclose data if required by law or to protect rights and safety.</P>
      </Section>

      <Section heading="5. Data Retention">
        <P>
          We retain Customer Data for as long as your account is active and as needed to provide the
          Service. After account termination, we may retain data for a limited period to comply with
          legal obligations and then delete or anonymize it.
        </P>
      </Section>

      <Section heading="6. Security">
        <P>
          We use technical and organizational measures designed to protect your data, including
          encryption of passwords, scoped multi-tenant data isolation, access controls,
          rate limiting, and automated backups. No method of transmission or storage is completely
          secure, but we work to protect your information and to respond promptly to incidents.
        </P>
      </Section>

      <Section heading="7. Your Rights">
        <P>
          Depending on your location, you may have rights to access, correct, export, or delete your
          personal data, and to object to or restrict certain processing. You can exercise many of
          these directly in the app (for example, data export), or by contacting us.
        </P>
      </Section>

      <Section heading="8. Cookies & Local Storage">
        <P>
          We use cookies and browser local storage to keep you signed in and remember preferences.
          These are essential to the operation of the Service.
        </P>
      </Section>

      <Section heading="9. International Transfers">
        <P>
          Your data may be processed in countries other than your own. Where required, we use
          appropriate safeguards for such transfers.
        </P>
      </Section>

      <Section heading="10. Children">
        <P>
          The Service is intended for business use and is not directed to individuals under 16. We
          do not knowingly collect personal data from children.
        </P>
      </Section>

      <Section heading="11. Changes to This Policy">
        <P>
          We may update this Policy from time to time. Material changes will be communicated through
          the Service or by email.
        </P>
      </Section>

      <Section heading="12. Contact">
        <P>
          For privacy questions or requests, contact us at{' '}
          <a href="mailto:privacy@hartmonitor.io" className="text-blue-400 hover:text-blue-300">privacy@hartmonitor.io</a>.
        </P>
      </Section>
    </LegalShell>
  );
}

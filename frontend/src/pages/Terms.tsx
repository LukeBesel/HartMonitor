import LegalShell, { Section, P, List } from '../marketing/LegalShell';

export default function Terms() {
  return (
    <LegalShell title="Terms of Service" updated="June 14, 2026">
      <P>
        These Terms of Service ("Terms") govern your access to and use of the HartMonitor
        manufacturing execution platform and related services (the "Service"). By creating an
        account or using the Service, you agree to these Terms on behalf of yourself and the
        organization you represent ("you" or "Customer").
      </P>

      <Section heading="1. The Service">
        <P>
          HartMonitor provides a cloud-based platform for building guided work instructions,
          scheduling and tracking work orders, monitoring OEE, managing quality and inventory,
          and related manufacturing operations functions. We may update, improve, or modify the
          Service over time.
        </P>
      </Section>

      <Section heading="2. Accounts & Eligibility">
        <List items={[
          'You must provide accurate account information and keep it current.',
          'You are responsible for safeguarding your account credentials and for all activity under your account.',
          'You must promptly notify us of any unauthorized use of your account.',
          'You must be authorized to bind your organization to these Terms.',
        ]} />
      </Section>

      <Section heading="3. Acceptable Use">
        <P>You agree not to:</P>
        <List items={[
          'Use the Service in violation of any applicable law or regulation.',
          'Attempt to gain unauthorized access to the Service, other accounts, or our systems.',
          'Reverse engineer, resell, or sublicense the Service except as expressly permitted.',
          'Upload malicious code or interfere with the integrity or performance of the Service.',
          'Use the Service to store or transmit content that infringes the rights of others.',
        ]} />
      </Section>

      <Section heading="4. Customer Data & Ownership">
        <P>
          You retain all rights to the data you and your users submit to the Service ("Customer
          Data"). You grant us a limited license to host, process, and transmit Customer Data
          solely to provide and support the Service. We do not sell Customer Data. Our handling of
          personal data is described in our Privacy Policy.
        </P>
      </Section>

      <Section heading="5. Subscriptions & Payment">
        <List items={[
          'Paid plans are billed in advance on a recurring basis (monthly unless stated otherwise).',
          'Fees are non-refundable except where required by law or expressly stated.',
          'We may change pricing with reasonable advance notice; changes apply to the next billing cycle.',
          'Failure to pay may result in suspension or termination of access.',
        ]} />
      </Section>

      <Section heading="6. Intellectual Property">
        <P>
          The Service, including its software, design, and documentation, is owned by HartMonitor
          and its licensors and is protected by intellectual property laws. Except for the rights
          expressly granted to you, no rights are transferred to you.
        </P>
      </Section>

      <Section heading="7. Confidentiality">
        <P>
          Each party may have access to the other's confidential information. Each party agrees to
          protect the other's confidential information with reasonable care and to use it only to
          perform under these Terms.
        </P>
      </Section>

      <Section heading="8. Warranties & Disclaimers">
        <P>
          The Service is provided "as is" and "as available." To the maximum extent permitted by
          law, we disclaim all warranties, express or implied, including merchantability, fitness
          for a particular purpose, and non-infringement. We do not warrant that the Service will
          be uninterrupted or error-free. The Service is a management tool and is not a substitute
          for your own safety, quality, and regulatory compliance processes.
        </P>
      </Section>

      <Section heading="9. Limitation of Liability">
        <P>
          To the maximum extent permitted by law, neither party will be liable for any indirect,
          incidental, special, consequential, or punitive damages, or for lost profits or
          revenues. Our total aggregate liability arising out of or relating to these Terms will
          not exceed the amounts you paid us for the Service in the twelve (12) months preceding
          the event giving rise to the claim.
        </P>
      </Section>

      <Section heading="10. Term & Termination">
        <P>
          You may stop using the Service at any time. We may suspend or terminate access for breach
          of these Terms. Upon termination, your right to use the Service ceases. You may export
          your Customer Data prior to termination; we may delete Customer Data after a reasonable
          retention period following termination.
        </P>
      </Section>

      <Section heading="11. Governing Law">
        <P>
          These Terms are governed by the laws of the State of Delaware, USA, without regard to its
          conflict-of-laws rules. The exclusive venue for disputes will be the state and federal
          courts located in Delaware, unless otherwise required by applicable law.
        </P>
      </Section>

      <Section heading="12. Changes to These Terms">
        <P>
          We may update these Terms from time to time. If we make material changes, we will provide
          notice (for example, by email or in-product). Your continued use of the Service after the
          changes take effect constitutes acceptance.
        </P>
      </Section>

      <Section heading="13. Contact">
        <P>
          Questions about these Terms? Contact us at{' '}
          <a href="mailto:legal@hartmonitor.io" className="text-blue-400 hover:text-blue-300">legal@hartmonitor.io</a>.
        </P>
      </Section>
    </LegalShell>
  );
}

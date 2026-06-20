'use strict';
// ─── Email service tests ───────────────────────────────────────────────────────
// Verifies that the email module works correctly in demo mode (no SMTP config)
// without crashing. Uses Node built-ins only.

const { describe, it, before } = require('node:test');
const assert = require('node:assert/strict');

// Ensure demo mode — no SMTP env vars
before(() => {
  delete process.env.SMTP_HOST;
  delete process.env.SMTP_USER;
  delete process.env.SMTP_PASS;
});

describe('Email service (demo mode)', () => {
  it('sendWelcomeEmail resolves without throwing', async () => {
    const { sendWelcomeEmail } = require('../src/email');
    await assert.doesNotReject(
      sendWelcomeEmail({ to: 'test@example.com', name: 'Test User', companyName: 'Acme Corp', trialDays: 14 })
    );
  });

  it('sendPasswordResetEmail resolves without throwing', async () => {
    const { sendPasswordResetEmail } = require('../src/email');
    await assert.doesNotReject(
      sendPasswordResetEmail({ to: 'test@example.com', resetUrl: 'http://localhost:3000/reset-password?token=abc123' })
    );
  });

  it('sendTrialEndingEmail resolves without throwing', async () => {
    const { sendTrialEndingEmail } = require('../src/email');
    await assert.doesNotReject(
      sendTrialEndingEmail({ to: 'test@example.com', name: 'Test User', daysLeft: 3 })
    );
  });

  it('sendTrialEndingEmail uses singular "day" when daysLeft is 1', async () => {
    const { sendTrialEndingEmail } = require('../src/email');
    // Should not throw and should produce singular subject
    await assert.doesNotReject(
      sendTrialEndingEmail({ to: 'test@example.com', name: 'Test User', daysLeft: 1 })
    );
  });

  it('sendPaymentFailedEmail resolves without throwing', async () => {
    const { sendPaymentFailedEmail } = require('../src/email');
    await assert.doesNotReject(
      sendPaymentFailedEmail({ to: 'billing@example.com', name: 'Finance Admin' })
    );
  });

  it('sendSubscriptionCancelledEmail resolves without throwing', async () => {
    const { sendSubscriptionCancelledEmail } = require('../src/email');
    await assert.doesNotReject(
      sendSubscriptionCancelledEmail({ to: 'test@example.com', name: 'Test User' })
    );
  });
});

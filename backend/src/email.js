'use strict';
const nodemailer = require('nodemailer');

// In dev/test or when SMTP not configured: log emails to console
const isDemoMode = !process.env.SMTP_HOST || !process.env.SMTP_USER;

let transporter;
if (!isDemoMode) {
  transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT || '587'),
    secure: process.env.SMTP_SECURE === 'true',
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });
}

const FROM = process.env.SMTP_FROM || 'HartMonitor <noreply@hartmonitor.io>';
const APP_URL = process.env.APP_URL || 'http://localhost:3000';
const APP_NAME = 'HartMonitor';

async function sendEmail({ to, subject, html, text }) {
  if (isDemoMode) {
    console.log(`[email:demo] To: ${to} | Subject: ${subject}`);
    return;
  }
  try {
    await transporter.sendMail({ from: FROM, to, subject, html, text });
  } catch (err) {
    console.error('[email] Send failed:', err.message);
    // Don't throw — email failures should not break the main flow
  }
}

// ── Templates ─────────────────────────────────────────────────────────────────

function baseTemplate(content) {
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><style>
body{font-family:system-ui,-apple-system,sans-serif;background:#0f172a;color:#e2e8f0;margin:0;padding:0}
.container{max-width:560px;margin:40px auto;background:#1e293b;border-radius:12px;overflow:hidden}
.header{background:#1d4ed8;padding:32px;text-align:center}
.header h1{color:#fff;margin:0;font-size:24px}
.body{padding:32px}
.btn{display:inline-block;background:#2563eb;color:#fff;padding:14px 28px;border-radius:8px;text-decoration:none;font-weight:600;margin:16px 0}
.footer{padding:24px 32px;border-top:1px solid #334155;color:#94a3b8;font-size:13px}
</style></head>
<body><div class="container">
<div class="header"><h1>${APP_NAME}</h1></div>
<div class="body">${content}</div>
<div class="footer">&copy; ${new Date().getFullYear()} ${APP_NAME}. Manufacturing intelligence, simplified.</div>
</div></body></html>`;
}

async function sendWelcomeEmail({ to, name, companyName, trialDays = 14 }) {
  const html = baseTemplate(`
    <h2>Welcome to ${APP_NAME}, ${name}!</h2>
    <p>Your account for <strong>${companyName}</strong> is ready. You have a <strong>${trialDays}-day free trial</strong> &mdash; no credit card required to get started.</p>
    <p>Here's what you can do right now:</p>
    <ul>
      <li>Set up your departments and production stations</li>
      <li>Invite your team members</li>
      <li>Start tracking work orders and quality</li>
      <li>Explore Andon, CAPA, Kaizen, and Maintenance modules</li>
    </ul>
    <a href="${APP_URL}/dashboard" class="btn">Open Your Dashboard &rarr;</a>
    <p>Questions? Reply to this email &mdash; we read every one.</p>
  `);
  await sendEmail({
    to,
    subject: `Welcome to ${APP_NAME} — your trial has started`,
    html,
    text: `Welcome to ${APP_NAME}! Your ${trialDays}-day trial for ${companyName} has started. Visit ${APP_URL}/dashboard to get started.`,
  });
}

async function sendTrialEndingEmail({ to, name, daysLeft }) {
  const html = baseTemplate(`
    <h2>Your trial ends in ${daysLeft} day${daysLeft !== 1 ? 's' : ''}</h2>
    <p>Hi ${name},</p>
    <p>Your ${APP_NAME} trial is ending soon. Upgrade now to keep access to all your data and modules without interruption.</p>
    <a href="${APP_URL}/settings?tab=plan" class="btn">Upgrade Now &rarr;</a>
    <p>Your data is safe &mdash; if you don't upgrade before the trial ends, your account will be paused and you can reactivate anytime within 30 days.</p>
  `);
  await sendEmail({
    to,
    subject: `Your ${APP_NAME} trial ends in ${daysLeft} day${daysLeft !== 1 ? 's' : ''}`,
    html,
    text: `Hi ${name}, your trial ends in ${daysLeft} days. Upgrade at ${APP_URL}/settings?tab=plan`,
  });
}

async function sendPaymentFailedEmail({ to, name }) {
  const html = baseTemplate(`
    <h2>Payment failed &mdash; action required</h2>
    <p>Hi ${name},</p>
    <p>We couldn't process your payment for ${APP_NAME}. This can happen when a card expires or has insufficient funds.</p>
    <a href="${APP_URL}/settings?tab=plan" class="btn">Update Payment Method &rarr;</a>
    <p>We'll retry the charge automatically. If payment isn't resolved, your account will enter a grace period and then be paused.</p>
  `);
  await sendEmail({
    to,
    subject: `${APP_NAME}: Payment failed — please update your card`,
    html,
    text: `Hi ${name}, your payment for ${APP_NAME} failed. Update your payment method at ${APP_URL}/settings?tab=plan`,
  });
}

async function sendPasswordResetEmail({ to, resetUrl }) {
  const html = baseTemplate(`
    <h2>Reset your password</h2>
    <p>Click the button below to reset your ${APP_NAME} password. This link expires in 1 hour.</p>
    <a href="${resetUrl}" class="btn">Reset Password &rarr;</a>
    <p>If you didn't request this, you can safely ignore this email.</p>
  `);
  await sendEmail({
    to,
    subject: `${APP_NAME}: Reset your password`,
    html,
    text: `Reset your password: ${resetUrl} (expires in 1 hour)`,
  });
}

async function sendSubscriptionCancelledEmail({ to, name }) {
  const html = baseTemplate(`
    <h2>Subscription cancelled</h2>
    <p>Hi ${name},</p>
    <p>Your ${APP_NAME} subscription has been cancelled. Your data will be retained for 30 days in case you'd like to reactivate.</p>
    <a href="${APP_URL}/settings?tab=plan" class="btn">Reactivate &rarr;</a>
    <p>Thank you for using ${APP_NAME}.</p>
  `);
  await sendEmail({
    to,
    subject: `${APP_NAME}: Your subscription has been cancelled`,
    html,
    text: `Your ${APP_NAME} subscription was cancelled. Reactivate at ${APP_URL}/settings?tab=plan`,
  });
}

module.exports = {
  sendWelcomeEmail,
  sendTrialEndingEmail,
  sendPaymentFailedEmail,
  sendPasswordResetEmail,
  sendSubscriptionCancelledEmail,
};

'use strict';
const nodemailer = require('nodemailer');

// Delivery backends, in priority order:
//   1. Resend HTTP API — set RESEND_API_KEY (simplest; no SMTP setup)
//   2. Any SMTP provider — set SMTP_HOST / SMTP_USER / SMTP_PASS
//   3. Demo mode — logs to console (dev, tests, or nothing configured)
const RESEND_KEY = process.env.RESEND_API_KEY || '';
const hasSmtp = !!(process.env.SMTP_HOST && process.env.SMTP_USER);
const isDemoMode = !RESEND_KEY && !hasSmtp;

let transporter;
if (!RESEND_KEY && hasSmtp) {
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

const FROM = process.env.EMAIL_FROM || process.env.SMTP_FROM || 'HartMonitor <noreply@hartmonitorapp.com>';
const APP_URL = process.env.APP_URL || 'http://localhost:3000';
const APP_NAME = 'HartMonitor';

// A stalled provider must never pin a request open until the runtime's default
// socket timeout — /api/auth/forgot-password awaits this call.
const SEND_TIMEOUT_MS = 10_000;

/**
 * Sends one transactional email. Never throws (email failures must not break
 * signup/reset flows). Returns { ok, provider, id } — `id` is the provider's
 * message id, which is what makes delivery auditable after the fact
 * (Resend: GET /emails/{id}).
 */
async function sendEmail({ to, subject, html, text }) {
  if (isDemoMode) {
    console.log(`[email:demo] To: ${to} | Subject: ${subject}`);
    return { ok: true, provider: 'demo', id: null };
  }
  try {
    if (RESEND_KEY) {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${RESEND_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: FROM, to: [to], subject, html, text }),
        signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
      });
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        console.error(`[email] Resend rejected (${res.status}):`, body.slice(0, 300));
        return { ok: false, provider: 'resend', id: null };
      }
      const payload = await res.json().catch(() => ({}));
      const id = payload && payload.id ? String(payload.id) : null;
      console.log(`[email] sent via resend id=${id || 'unknown'} to=${to} subject="${subject}"`);
      return { ok: true, provider: 'resend', id };
    }
    const info = await transporter.sendMail({ from: FROM, to, subject, html, text });
    const id = info && info.messageId ? String(info.messageId) : null;
    console.log(`[email] sent via smtp id=${id || 'unknown'} to=${to} subject="${subject}"`);
    return { ok: true, provider: 'smtp', id };
  } catch (err) {
    console.error('[email] Send failed:', err.message);
    // Don't throw — email failures should not break the main flow
    return { ok: false, provider: RESEND_KEY ? 'resend' : 'smtp', id: null };
  }
}

// ── Templates ─────────────────────────────────────────────────────────────────
// Email clients are not browsers. The rules this markup follows, and why:
//   • Layout is <table>-based — Outlook (Word engine) ignores max-width, flex
//     and border-radius on <div>s, so a div-only layout runs full-bleed there.
//   • Every colour/spacing rule is an INLINE style, and every background is
//     ALSO a bgcolor attribute. Gmail (non-Google accounts), Yahoo and several
//     mobile clients drop <style> blocks entirely; with a dark <style>-only
//     design that turns light text on a stripped white background — invisible.
//     bgcolor survives every sanitizer, so the dark ground always paints.
//   • The <style> block is kept for progressive enhancement ONLY (mobile
//     stacking); nothing readable depends on it.
//   • The CTA is a table cell, not a padded <a> — Outlook collapses the latter.

const INK        = '#e2e8f0';   // body text on dark
const INK_MUTED  = '#94a3b8';
const PANEL      = '#1e293b';
const PAGE       = '#0f172a';
const BRAND      = '#1d4ed8';
const BTN        = '#2563eb';
const FONT       = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

const S = {
  h2:   `margin:0 0 16px;font-family:${FONT};font-size:20px;line-height:28px;font-weight:700;color:#ffffff;`,
  p:    `margin:0 0 14px;font-family:${FONT};font-size:15px;line-height:23px;color:${INK};`,
  ul:   `margin:0 0 14px;padding-left:20px;font-family:${FONT};font-size:15px;line-height:23px;color:${INK};`,
  li:   `margin:0 0 6px;color:${INK};`,
  link: `color:#93c5fd;text-decoration:underline;`,
};

/** Bulletproof CTA: a one-cell table so Outlook renders the padded block. */
function button(href, label) {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 20px;">
      <tr><td bgcolor="${BTN}" style="background-color:${BTN};border-radius:8px;">
        <a href="${href}" style="display:inline-block;padding:14px 28px;font-family:${FONT};font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;">${label}</a>
      </td></tr>
    </table>`;
}

function baseTemplate(content, preheader = '') {
  return `<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
<html xmlns="http://www.w3.org/1999/xhtml">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<meta name="color-scheme" content="dark light" />
<meta name="supported-color-schemes" content="dark light" />
<title>${APP_NAME}</title>
<style>
  /* Progressive enhancement only — nothing readable depends on this block. */
  @media only screen and (max-width:600px){
    .hm-pad{padding:24px !important}
    .hm-shell{width:100% !important}
  }
</style>
</head>
<body bgcolor="${PAGE}" style="margin:0;padding:0;background-color:${PAGE};">
${preheader ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${preheader}</div>` : ''}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${PAGE}" style="background-color:${PAGE};">
  <tr><td align="center" style="padding:32px 12px;">
    <table role="presentation" class="hm-shell" width="560" cellpadding="0" cellspacing="0" border="0" bgcolor="${PANEL}" style="width:560px;max-width:560px;background-color:${PANEL};border-radius:12px;">
      <tr><td align="center" bgcolor="${BRAND}" style="background-color:${BRAND};padding:28px;border-radius:12px 12px 0 0;">
        <span style="font-family:${FONT};font-size:24px;font-weight:700;color:#ffffff;letter-spacing:-0.3px;">${APP_NAME}</span>
      </td></tr>
      <tr><td class="hm-pad" style="padding:32px;">${content}</td></tr>
      <tr><td class="hm-pad" style="padding:20px 32px 24px;border-top:1px solid #334155;font-family:${FONT};font-size:13px;line-height:19px;color:${INK_MUTED};">
        &copy; ${new Date().getFullYear()} ${APP_NAME}. Manufacturing intelligence, simplified.<br />
        <a href="${APP_URL}" style="color:${INK_MUTED};text-decoration:underline;">${APP_URL.replace(/^https?:\/\//, '')}</a>
      </td></tr>
    </table>
  </td></tr>
</table>
</body></html>`;
}

async function sendWelcomeEmail({ to, name, companyName, trialDays = 14 }) {
  const html = baseTemplate(`
    <h2 style="${S.h2}">Welcome to ${APP_NAME}, ${name}!</h2>
    <p style="${S.p}">Your account for <strong style="color:#ffffff;">${companyName}</strong> is ready. You have a <strong style="color:#ffffff;">${trialDays}-day free trial</strong> &mdash; no credit card required to get started.</p>
    <p style="${S.p}">Here's what you can do right now:</p>
    <ul style="${S.ul}">
      <li style="${S.li}">Set up your departments and production stations</li>
      <li style="${S.li}">Invite your team members</li>
      <li style="${S.li}">Start tracking work orders and quality</li>
      <li style="${S.li}">Explore Andon, CAPA, Kaizen, and Maintenance modules</li>
    </ul>
    ${button(`${APP_URL}/dashboard`, 'Open Your Dashboard &rarr;')}
    <p style="${S.p}">Questions? Reply to this email &mdash; we read every one.</p>
  `, `Your ${APP_NAME} workspace for ${companyName} is ready.`);
  return sendEmail({
    to,
    subject: `Welcome to ${APP_NAME} — your trial has started`,
    html,
    text: `Welcome to ${APP_NAME}! Your ${trialDays}-day trial for ${companyName} has started. Visit ${APP_URL}/dashboard to get started.`,
  });
}

async function sendTrialEndingEmail({ to, name, daysLeft }) {
  const html = baseTemplate(`
    <h2 style="${S.h2}">Your trial ends in ${daysLeft} day${daysLeft !== 1 ? 's' : ''}</h2>
    <p style="${S.p}">Hi ${name},</p>
    <p style="${S.p}">Your ${APP_NAME} trial is ending soon. Upgrade now to keep access to all your data and modules without interruption.</p>
    ${button(`${APP_URL}/settings?tab=plan`, 'Upgrade Now &rarr;')}
    <p style="${S.p}">Your data is safe &mdash; if you don't upgrade before the trial ends, your account will be paused and you can reactivate anytime within 30 days.</p>
  `, `Only ${daysLeft} day${daysLeft !== 1 ? 's' : ''} left on your ${APP_NAME} trial.`);
  return sendEmail({
    to,
    subject: `Your ${APP_NAME} trial ends in ${daysLeft} day${daysLeft !== 1 ? 's' : ''}`,
    html,
    text: `Hi ${name}, your trial ends in ${daysLeft} days. Upgrade at ${APP_URL}/settings?tab=plan`,
  });
}

async function sendPaymentFailedEmail({ to, name }) {
  const html = baseTemplate(`
    <h2 style="${S.h2}">Payment failed &mdash; action required</h2>
    <p style="${S.p}">Hi ${name},</p>
    <p style="${S.p}">We couldn't process your payment for ${APP_NAME}. This can happen when a card expires or has insufficient funds.</p>
    ${button(`${APP_URL}/settings?tab=plan`, 'Update Payment Method &rarr;')}
    <p style="${S.p}">We'll retry the charge automatically. If payment isn't resolved, your account will enter a grace period and then be paused.</p>
  `, `We couldn't process your ${APP_NAME} payment.`);
  return sendEmail({
    to,
    subject: `${APP_NAME}: Payment failed — please update your card`,
    html,
    text: `Hi ${name}, your payment for ${APP_NAME} failed. Update your payment method at ${APP_URL}/settings?tab=plan`,
  });
}

async function sendPasswordResetEmail({ to, resetUrl }) {
  const html = baseTemplate(`
    <h2 style="${S.h2}">Reset your password</h2>
    <p style="${S.p}">Click the button below to reset your ${APP_NAME} password. This link expires in 1 hour.</p>
    ${button(resetUrl, 'Reset Password &rarr;')}
    <p style="${S.p}">If the button doesn't work, copy this link into your browser:<br />
      <a href="${resetUrl}" style="${S.link}word-break:break-all;">${resetUrl}</a>
    </p>
    <p style="${S.p}">If you didn't request this, you can safely ignore this email &mdash; your password stays unchanged.</p>
  `, `Reset your ${APP_NAME} password (link expires in 1 hour).`);
  return sendEmail({
    to,
    subject: `${APP_NAME}: Reset your password`,
    html,
    text: `Reset your password: ${resetUrl} (expires in 1 hour)`,
  });
}

async function sendSubscriptionCancelledEmail({ to, name }) {
  const html = baseTemplate(`
    <h2 style="${S.h2}">Subscription cancelled</h2>
    <p style="${S.p}">Hi ${name},</p>
    <p style="${S.p}">Your ${APP_NAME} subscription has been cancelled. Your data will be retained for 30 days in case you'd like to reactivate.</p>
    ${button(`${APP_URL}/settings?tab=plan`, 'Reactivate &rarr;')}
    <p style="${S.p}">Thank you for using ${APP_NAME}.</p>
  `, `Your ${APP_NAME} subscription has been cancelled.`);
  return sendEmail({
    to,
    subject: `${APP_NAME}: Your subscription has been cancelled`,
    html,
    text: `Your ${APP_NAME} subscription was cancelled. Reactivate at ${APP_URL}/settings?tab=plan`,
  });
}

// Someone on the floor needs this person. Everything they need to decide
// whether to walk over is above the fold: who was alerted, what was said, and
// exactly where it came from.
async function sendAndonAlertEmail({ to, name, who, title, context, note, raisedBy, priority }) {
  const urgent = priority === 'critical' || priority === 'high';
  const html = baseTemplate(`
    <h2>${who} needed${urgent ? ` &mdash; ${priority}` : ''}</h2>
    <p>${name ? `Hi ${name}, s` : 'S'}omeone on the floor has asked for ${who}.</p>
    <p style="font-size:17px;font-weight:600;color:#f8fafc;margin:16px 0 4px">${title}</p>
    ${context ? `<p style="color:#94a3b8;margin:0 0 12px">${context}</p>` : ''}
    ${note ? `<p style="background:#0f172a;border-left:3px solid #2563eb;padding:12px 16px;border-radius:6px">${note}</p>` : ''}
    ${raisedBy ? `<p style="color:#94a3b8;font-size:13px">Raised by ${raisedBy}</p>` : ''}
    <a href="${APP_URL}/andon" class="btn">Open the Andon Board &rarr;</a>
    <p style="color:#94a3b8;font-size:13px">Tap &ldquo;On my way&rdquo; there so the operator knows help is coming.</p>
  `);
  await sendEmail({
    to,
    subject: `${APP_NAME}: ${who} needed — ${title}`,
    html,
    text: [
      `${who} has been alerted${raisedBy ? ` by ${raisedBy}` : ''}.`,
      title,
      context,
      note && `Note: ${note}`,
      `Open the Andon Board: ${APP_URL}/andon`,
    ].filter(Boolean).join('\n'),
  });
}

module.exports = {
  sendEmail,
  baseTemplate,
  sendWelcomeEmail,
  sendTrialEndingEmail,
  sendPaymentFailedEmail,
  sendPasswordResetEmail,
  sendSubscriptionCancelledEmail,
  sendAndonAlertEmail,
};

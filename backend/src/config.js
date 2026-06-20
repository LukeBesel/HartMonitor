// ─── Centralized environment configuration & startup validation ───────────────
// Single source of truth for every environment variable the backend reads.
// Reading them here (instead of scattered process.env lookups) lets us validate
// on boot, log a clear "what's live vs demo" banner, and fail fast on dangerous
// misconfiguration in production.

const path = require('path');

const NODE_ENV = process.env.NODE_ENV || 'development';
const IS_PROD  = NODE_ENV === 'production';

// In development we want the demo company + sample login accounts. In production
// that would ship publicly-known admin credentials, so it must be opt-in only.
const SEED_DEMO_DATA = process.env.SEED_DEMO_DATA === 'true';

const config = {
  nodeEnv: NODE_ENV,
  isProd: IS_PROD,
  port: Number(process.env.PORT) || 3001,

  // Public base URL of the deployed app (used for OAuth + Stripe redirects).
  appUrl: process.env.APP_URL ? process.env.APP_URL.replace(/\/$/, '') : '',

  // Comma-separated list of allowed browser origins for CORS. When empty in
  // production we fall back to APP_URL (same-origin). In development we allow all.
  allowedOrigins: (process.env.ALLOWED_ORIGINS || '')
    .split(',').map(s => s.trim()).filter(Boolean),

  // Where the SQLite database lives. On hosts with a persistent volume, point
  // this at the mounted path (e.g. /data/mes.db) so data survives redeploys.
  databasePath: process.env.DATABASE_PATH || path.join(__dirname, '..', 'mes.db'),

  // Automated backups of the SQLite file.
  backup: {
    dir: process.env.BACKUP_DIR || '',                       // empty = disabled
    intervalHours: Number(process.env.BACKUP_INTERVAL_HOURS) || 6,
    keep: Number(process.env.BACKUP_KEEP) || 14,
  },

  seedDemoData: SEED_DEMO_DATA,

  // Integration credentials — presence of these flips a feature from demo mode
  // (logs/simulates) to live.
  stripe:  { configured: !!(process.env.STRIPE_SECRET_KEY && process.env.STRIPE_WEBHOOK_SECRET) },
  smtp:    { configured: !!(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS) },
  twilio:  { configured: !!(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_FROM_NUMBER) },
  google:  { configured: !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) },
  microsoft:{ configured: !!(process.env.MICROSOFT_CLIENT_ID && process.env.MICROSOFT_CLIENT_SECRET) },
};

// ─── Boot-time validation ─────────────────────────────────────────────────────
// Returns { warnings, errors }. Errors are fatal in production.

function validate() {
  const warnings = [];
  const errors = [];

  if (IS_PROD) {
    // Hard stop: these secrets must be explicitly set in production. Running
    // with the default or an empty value would be a critical security hole.
    const REQUIRED_SECRETS = ['JWT_SECRET', 'SESSION_SECRET'];
    const missing = REQUIRED_SECRETS.filter(k => !process.env[k] || process.env[k].includes('change-this'));
    if (missing.length) {
      console.error(`FATAL: Missing required env vars: ${missing.join(', ')}`);
      console.error('Generate values with: node -e "console.log(require(\'crypto\').randomBytes(64).toString(\'hex\'))"');
      process.exit(1);
    }

    if (SEED_DEMO_DATA) {
      warnings.push(
        'SEED_DEMO_DATA=true — demo accounts (admin@hartmonitor.demo / Admin123!) are active. ' +
        'Remove this flag before launching a live customer environment.'
      );
    }
    if (!config.appUrl) {
      warnings.push('APP_URL is not set. OAuth/Stripe redirects fall back to the request host, which is fragile behind proxies. Set APP_URL to your public URL.');
    }
    if (config.allowedOrigins.length === 0 && !config.appUrl) {
      warnings.push('Neither ALLOWED_ORIGINS nor APP_URL is set — CORS will only allow same-origin requests.');
    }
    if (!config.backup.dir) {
      warnings.push('BACKUP_DIR is not set — automated database backups are disabled. Point it at a persistent path (e.g. /data/backups).');
    }
    const onDefaultDbPath = config.databasePath.endsWith(path.join('backend', 'mes.db')) || config.databasePath === path.join(__dirname, '..', 'mes.db');
    if (onDefaultDbPath) {
      warnings.push('DATABASE_PATH is not set — using the in-repo default. On most hosts this is ephemeral and your data will be LOST on redeploy. Point it at a persistent volume (e.g. /data/mes.db).');
    }
  }

  return { warnings, errors };
}

// ─── Human-readable startup banner ────────────────────────────────────────────

function banner() {
  const mode = c => (c ? 'LIVE' : 'demo');
  return [
    '',
    '  HartMonitor — starting up',
    `  ├─ environment   : ${NODE_ENV}`,
    `  ├─ database      : ${config.databasePath}`,
    `  ├─ demo seeding  : ${SEED_DEMO_DATA ? 'ON (development data + sample accounts)' : 'off'}`,
    `  ├─ backups       : ${config.backup.dir ? `every ${config.backup.intervalHours}h → ${config.backup.dir}` : 'disabled'}`,
    `  ├─ payments      : ${mode(config.stripe.configured)} (Stripe)`,
    `  ├─ email alerts  : ${mode(config.smtp.configured)} (SMTP)`,
    `  ├─ sms alerts    : ${mode(config.twilio.configured)} (Twilio)`,
    `  └─ SSO           : Google ${mode(config.google.configured)}, Microsoft ${mode(config.microsoft.configured)}`,
    '',
  ].join('\n');
}

module.exports = { config, validate, banner };

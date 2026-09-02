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

  // How many reverse proxies sit in front of this process. Everything read out
  // of X-Forwarded-For — including the client IP the rate limiter counts
  // anonymous traffic against — is only as trustworthy as this number: allow
  // one hop more than really exists and a caller can prepend a hop of its own
  // invention to mint a fresh rate-limit bucket on every request. One is right
  // for a single platform proxy (Railway, Render, Fly, nginx), which overwrites
  // the last entry with the address it actually saw. Set TRUST_PROXY=0 when the
  // process is exposed directly, so only the socket address is ever believed.
  trustProxy: process.env.TRUST_PROXY !== undefined
    ? (Number(process.env.TRUST_PROXY) || 0)
    : (IS_PROD ? 1 : 0),

  // What a caller may spend on /api in a fifteen-minute window.
  //
  // authenticatedMax is a budget for one signed-in person, not for a building.
  // Opening a screen costs about a dozen API calls and the operational boards
  // poll on a 30-60 second timer, so the heaviest real stretch of work we can
  // construct — a supervisor opening a new screen every five seconds with a
  // couple of dashboards refreshing in other tabs — comes to something under
  // 2,500 calls in a window. 5,000 keeps a clear factor of two above that while
  // staying far below what this limit actually exists to catch: a client stuck
  // in a render loop, or somebody walking the whole API with a script.
  //
  // anonymousMax is still counted per IP, which for a customer means per
  // factory, because an IP is the only handle we have on a request that carries
  // no identity — and IP keying is what keeps credential stuffing off the login
  // form. Little is exposed to it: without a session the only things reachable
  // under /api are the public pricing catalog, the game endpoints, and the auth
  // routes, which carry their own far stricter throttle.
  //
  // Both are overridable so a deployment with unusual traffic can tune them
  // without a code change.
  rateLimit: {
    authenticatedMax: Number(process.env.API_RATE_LIMIT_MAX) || 5000,
    anonymousMax: Number(process.env.API_RATE_LIMIT_ANON_MAX) || 1000,

    // ── Credential endpoints ──────────────────────────────────────────────
    // Two ceilings, because two different things are being defended, and one
    // number cannot do both.
    //
    // accountMax is the one that stops a password being guessed. It is counted
    // per ACCOUNT, so it does not care how many addresses the guessing comes
    // from: 10 failures per quarter hour is 960 guesses a day against one
    // login, which will not find anything that is not already in the first page
    // of a wordlist — and a real person who has mistyped their password ten
    // times in fifteen minutes has forgotten it and needs the reset link, not
    // an eleventh try.
    //
    // ipMax is the site-level abuse ceiling, and it is the number that was
    // wrong. The old limiter allowed 20 attempts per IP, which for a customer
    // is 20 attempts for the whole factory: twenty people signing in at 6am
    // through one NAT gateway, a couple of them fat-fingering a password on a
    // tablet, locked the plant out of its own MES for fifteen minutes. 100
    // failures leaves a large site several times the headroom it needs on a bad
    // morning while still cutting off a script walking a list of accounts.
    //
    // Both count FAILURES only — a successful sign-in is not an attempt at
    // anything — so a shift starting together is invisible to both.
    credentialAccountMax: Number(process.env.AUTH_RATE_LIMIT_ACCOUNT_MAX) || 10,
    credentialIpMax: Number(process.env.AUTH_RATE_LIMIT_IP_MAX) || 100,

    // Creating organizations and demo sandboxes is write-heavy and nothing about
    // it happens in bursts from a real customer, so it keeps the strict per-IP
    // ceiling the credential routes used to share.
    accountCreationMax: Number(process.env.AUTH_RATE_LIMIT_SIGNUP_MAX) || 20,
  },

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

  // Early-access mode: while true (the default for launch), every plan gate is
  // open — all modules, no app/dashboard limits, no billing prompts. Flip off
  // later with EARLY_ACCESS=false to enforce paid tiers.
  earlyAccess: process.env.EARLY_ACCESS !== 'false',

  // Integration credentials — presence of these flips a feature from demo mode
  // (logs/simulates) to live.
  stripe:  { configured: !!(process.env.STRIPE_SECRET_KEY && process.env.STRIPE_WEBHOOK_SECRET) },
  smtp:    { configured: !!(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS) },
  resend:  { configured: !!process.env.RESEND_API_KEY },
  twilio:  { configured: !!(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_FROM_NUMBER) },
  google:  { configured: !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) },
  microsoft:{ configured: !!(process.env.MICROSOFT_CLIENT_ID && process.env.MICROSOFT_CLIENT_SECRET) },
};

// ─── The one fail-open default, said out loud ─────────────────────────────────
// `earlyAccess` defaults to TRUE and production depends on that default: nothing
// is set in the deploy environment, and flipping it would start charging gates
// at customers who were promised everything. So the default stays — but a gate
// that is open because nobody set a variable must never be a silent condition.
// Printed at require time, before the banner, so it is the first thing in the
// log. The gate itself lives in backend/src/middleware/plan.js.
if (config.earlyAccess && IS_PROD) {
  console.warn('[plan] EARLY_ACCESS is on — every tier gate is open (no plan is enforced for any company). Set EARLY_ACCESS=false to enforce paid tiers.');
}

// ─── Boot-time validation ─────────────────────────────────────────────────────
// Returns { warnings, errors }. Errors are fatal in production.

function validate() {
  const warnings = [];
  const errors = [];

  if (IS_PROD) {
    // Session/JWT secrets: prefer explicit env vars. When missing, generate
    // once and persist next to the database (the volume) so the app always
    // boots and the values survive redeploys — a solo founder should never be
    // locked out of their own deploy over a missing env var. Explicit env vars
    // still win when present.
    const REQUIRED_SECRETS = ['JWT_SECRET', 'SESSION_SECRET'];
    const missing = REQUIRED_SECRETS.filter(k => !process.env[k] || process.env[k].includes('change-this'));
    if (missing.length) {
      const fs = require('fs');
      const crypto = require('crypto');
      const secretsPath = path.join(path.dirname(config.databasePath), '.hm-secrets.json');
      let stored = {};
      try { stored = JSON.parse(fs.readFileSync(secretsPath, 'utf8')); } catch { /* first boot */ }
      let dirty = false;
      for (const key of missing) {
        if (!stored[key]) { stored[key] = crypto.randomBytes(64).toString('hex'); dirty = true; }
        process.env[key] = stored[key];
      }
      if (dirty) {
        try {
          fs.mkdirSync(path.dirname(secretsPath), { recursive: true });
          fs.writeFileSync(secretsPath, JSON.stringify(stored), { mode: 0o600 });
          warnings.push(`${missing.join(' + ')} not set — generated and saved to ${secretsPath}. Set them as env vars to manage them explicitly.`);
        } catch (err) {
          warnings.push(`${missing.join(' + ')} not set and could not persist generated values (${err.message}) — using in-memory secrets; sessions will reset on redeploy.`);
        }
      }
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
    `  ├─ email alerts  : ${config.resend.configured ? 'LIVE (Resend)' : `${mode(config.smtp.configured)} (SMTP)`}`,
    `  ├─ sms alerts    : ${mode(config.twilio.configured)} (Twilio)`,
    `  └─ SSO           : Google ${mode(config.google.configured)}, Microsoft ${mode(config.microsoft.configured)}`,
    '',
  ].join('\n');
}

module.exports = { config, validate, banner };

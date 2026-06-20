const express = require('express');
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const db = require('../db');
const { config } = require('../config');
const { hashPassword, verifyPassword, generateToken, requireAuth } = require('../middleware/auth');
const { PROVIDERS, isConfigured } = require('../sso');
const { sendWelcomeEmail, sendPasswordResetEmail } = require('../email');

const router = express.Router();

const MIN_PASSWORD_LEN = 8;

// SSO OAuth state persisted to DB so multi-process deployments work.
// Cleanup expired states every 5 minutes.
setInterval(() => db.prepare("DELETE FROM sso_state WHERE expires_at < datetime('now')").run(), 5 * 60 * 1000);

// Base URL for OAuth redirects — prefers APP_URL, then the forwarded host.
function appUrl(req) {
  if (process.env.APP_URL) return process.env.APP_URL.replace(/\/$/, '');
  const proto = req.headers['x-forwarded-proto'] || req.protocol || 'http';
  return `${proto}://${req.get('host')}`;
}

// ─── POST /login ──────────────────────────────────────────────────────────────

router.post('/login', (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'email and password required' });

  const user = db.prepare('SELECT * FROM users WHERE email = ? AND is_active = 1').get(email.toLowerCase().trim());
  if (!user || !verifyPassword(password, user.password_hash)) {
    return res.status(401).json({ error: 'Invalid email or password' });
  }

  const raw = generateToken();
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(); // 30 days
  db.prepare(`INSERT INTO sessions (id, user_id, token, expires_at) VALUES (?, ?, ?, ?)`)
    .run(uuidv4(), user.id, raw, expiresAt);
  db.prepare(`UPDATE users SET last_login = datetime('now'), updated_at = datetime('now') WHERE id = ?`).run(user.id);

  res.cookie('hm_token', raw, {
    httpOnly: true,
    secure: config.isProd,
    sameSite: 'lax',
    maxAge: 30 * 24 * 60 * 60 * 1000,
    path: '/',
  });

  res.json({
    token: raw,
    user: { id: user.id, email: user.email, display_name: user.display_name, role: user.role },
  });
});

// ─── POST /signup — create a new organization + first user (public) ──────────

router.post('/signup', (req, res) => {
  const { company_name, email, password, display_name } = req.body;
  if (!company_name || !email || !password || !display_name) {
    return res.status(400).json({ error: 'company_name, email, password, and display_name required' });
  }
  if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });

  const normalizedEmail = email.toLowerCase().trim();
  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(normalizedEmail);
  if (existing) return res.status(409).json({ error: 'A user with that email already exists' });

  const orgId  = uuidv4();
  const userId = uuidv4();
  const raw  = generateToken();
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(); // 30 days

  let slug = company_name.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'org';
  if (db.prepare('SELECT id FROM organizations WHERE slug = ?').get(slug)) {
    slug = `${slug}-${orgId.slice(0, 8)}`;
  }

  const signup = db.transaction(() => {
    db.prepare(`INSERT INTO organizations (id, name, slug) VALUES (?, ?, ?)`)
      .run(orgId, company_name.trim(), slug);
    db.prepare(`INSERT INTO users (id, email, display_name, password_hash, role, company_id) VALUES (?, ?, ?, ?, 'developer', ?)`)
      .run(userId, normalizedEmail, display_name.trim(), hashPassword(password), orgId);
    db.prepare(`INSERT INTO plan (tier, app_limit, dashboard_limit, company_id) VALUES ('free', 5, 2, ?)`)
      .run(orgId);
    db.prepare(`INSERT INTO sites (id, company_id, name, code, is_primary) VALUES (?, ?, 'Main Site', 'MAIN', 1)`)
      .run(uuidv4(), orgId);

    const defaults = [
      ['company_name', company_name.trim()],
      ['timezone',     'America/New_York'],
      ['date_format',  'MM/DD/YYYY'],
      ['currency',     'USD'],
    ];
    const insSetting = db.prepare(`INSERT OR IGNORE INTO org_settings (company_id, key, value) VALUES (?, ?, ?)`);
    for (const [k, v] of defaults) insSetting.run(orgId, k, v);

    db.prepare(`INSERT INTO sessions (id, user_id, token, expires_at) VALUES (?, ?, ?, ?)`)
      .run(uuidv4(), userId, raw, expiresAt);
    db.prepare(`UPDATE users SET last_login = datetime('now'), updated_at = datetime('now') WHERE id = ?`).run(userId);
  });
  signup();

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);

  res.cookie('hm_token', raw, {
    httpOnly: true,
    secure: config.isProd,
    sameSite: 'lax',
    maxAge: 30 * 24 * 60 * 60 * 1000,
    path: '/',
  });

  // Fire-and-forget welcome email — never blocks the response
  sendWelcomeEmail({
    to: normalizedEmail,
    name: display_name.trim() || normalizedEmail.split('@')[0],
    companyName: company_name.trim() || 'Your Company',
    trialDays: 14,
  }).catch(err => console.error('[email] welcome email failed:', err.message));

  res.status(201).json({
    token: raw,
    user: { id: user.id, email: user.email, display_name: user.display_name, role: user.role },
  });
});

// ─── POST /logout ─────────────────────────────────────────────────────────────

router.post('/logout', requireAuth, (req, res) => {
  db.prepare('DELETE FROM sessions WHERE id = ?').run(req.user.session_id);
  res.clearCookie('hm_token', { path: '/' });
  res.json({ success: true });
});

// ─── GET /me ──────────────────────────────────────────────────────────────────

router.get('/me', requireAuth, (req, res) => {
  const user = db.prepare('SELECT id, email, display_name, role, company_id, last_login, created_at FROM users WHERE id = ?').get(req.user.id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  const company = db.prepare("SELECT value FROM org_settings WHERE company_id = ? AND key = 'company_name'").get(req.companyId);
  res.json({ ...user, company_name: company?.value || 'HartMonitor' });
});

// ─── PUT /change-password ─────────────────────────────────────────────────────

router.put('/change-password', requireAuth, (req, res) => {
  const { current_password, new_password } = req.body;
  if (!current_password || !new_password) return res.status(400).json({ error: 'current_password and new_password required' });
  if (new_password.length < MIN_PASSWORD_LEN) return res.status(400).json({ error: `Password must be at least ${MIN_PASSWORD_LEN} characters` });

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  if (!verifyPassword(current_password, user.password_hash)) {
    return res.status(401).json({ error: 'Current password is incorrect' });
  }
  db.prepare("UPDATE users SET password_hash = ?, updated_at = datetime('now') WHERE id = ?")
    .run(hashPassword(new_password), req.user.id);

  // Invalidate all other sessions
  db.prepare('DELETE FROM sessions WHERE user_id = ? AND id != ?').run(req.user.id, req.user.session_id);
  res.json({ success: true });
});

// ─── Password reset ─────────────────────────────────────────────────────────────

function sha256(s) {
  return crypto.createHash('sha256').update(s).digest('hex');
}

// POST /forgot-password — request a reset link (public). Always responds 200 with
// { ok: true } so the endpoint can't be used to enumerate which emails exist. When
// SMTP is not configured we include dev_reset_url (and log it) so self-hosted
// installs can still complete the flow.
router.post('/forgot-password', async (req, res) => {
  const email = (req.body?.email || '').toLowerCase().trim();
  if (!email) return res.status(400).json({ error: 'email required' });

  const user = db.prepare('SELECT * FROM users WHERE email = ? AND is_active = 1').get(email);
  if (!user) return res.json({ ok: true }); // don't reveal non-existence

  // Clear any prior tokens for this user, then mint a fresh single-use token.
  db.prepare('DELETE FROM password_reset_tokens WHERE user_id = ?').run(user.id);
  const raw = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString(); // 1 hour
  db.prepare('INSERT INTO password_reset_tokens (id, user_id, token_hash, expires_at) VALUES (?, ?, ?, ?)')
    .run(uuidv4(), user.id, sha256(raw), expiresAt);

  const resetUrl = `${appUrl(req)}/reset-password?token=${raw}`;

  // In demo mode (no SMTP) sendPasswordResetEmail just logs — return dev link.
  const isDemoMode = !process.env.SMTP_HOST || !process.env.SMTP_USER;
  await sendPasswordResetEmail({ to: user.email, resetUrl });

  if (isDemoMode) {
    console.log('[auth] password reset link for', email, '->', resetUrl);
    return res.json({ ok: true, dev_reset_url: resetUrl });
  }
  res.json({ ok: true });
});

// POST /reset-password — consume a token and set a new password (public).
router.post('/reset-password', (req, res) => {
  const { token, new_password } = req.body || {};
  if (!token || !new_password) return res.status(400).json({ error: 'token and new_password required' });
  if (new_password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });

  const row = db.prepare(
    "SELECT * FROM password_reset_tokens WHERE token_hash = ? AND used_at IS NULL AND expires_at > datetime('now')"
  ).get(sha256(token));
  if (!row) return res.status(400).json({ error: 'Invalid or expired reset link' });

  const reset = db.transaction(() => {
    db.prepare("UPDATE users SET password_hash = ?, updated_at = datetime('now') WHERE id = ?")
      .run(hashPassword(new_password), row.user_id);
    db.prepare("UPDATE password_reset_tokens SET used_at = datetime('now') WHERE id = ?").run(row.id);
    db.prepare('DELETE FROM password_reset_tokens WHERE user_id = ? AND id != ?').run(row.user_id, row.id);
    // Force a fresh login everywhere after a reset.
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(row.user_id);
  });
  reset();

  res.json({ ok: true });
});

// ─── SSO ───────────────────────────────────────────────────────────────────────

// GET /sso/providers — only return providers with real credentials configured.
router.get('/sso/providers', (req, res) => {
  res.json(
    Object.keys(PROVIDERS)
      .filter(id => isConfigured(id))
      .map(id => ({ id, name: PROVIDERS[id].name }))
  );
});

// GET /sso/:provider/start — kick off the OAuth redirect (or demo login).
router.get('/sso/:provider/start', (req, res) => {
  const provider = req.params.provider;
  const p = PROVIDERS[provider];
  if (!p) return res.status(404).json({ error: 'Unknown provider' });
  const base = appUrl(req);

  if (!isConfigured(provider)) {
    // Demo mode — sign into the shared demo account so the flow can be explored.
    const demoUser = db.prepare("SELECT * FROM users WHERE email = 'demo@hartmonitor.demo' AND is_active = 1").get();
    if (!demoUser) return res.redirect(`${base}/login?sso_error=demo_unavailable`);
    const demoToken = generateToken();
    const demoExpiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
    db.prepare(`INSERT INTO sessions (id, user_id, token, expires_at) VALUES (?, ?, ?, ?)`).run(uuidv4(), demoUser.id, demoToken, demoExpiresAt);
    db.prepare(`UPDATE users SET last_login = datetime('now') WHERE id = ?`).run(demoUser.id);
    res.cookie('hm_token', demoToken, {
      httpOnly: true,
      secure: config.isProd,
      sameSite: 'lax',
      maxAge: 30 * 24 * 60 * 60 * 1000,
      path: '/',
    });
    return res.redirect(`${base}/sso/callback?token=${demoToken}&demo=1&provider=${provider}`);
  }

  const state = crypto.randomBytes(16).toString('hex');
  const stateExpiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
  db.prepare(`INSERT INTO sso_state (id, state, provider, expires_at) VALUES (?, ?, ?, ?)`)
    .run(uuidv4(), state, provider, stateExpiresAt);
  const redirectUri = `${base}/api/auth/sso/${provider}/callback`;
  const params = new URLSearchParams({
    client_id: process.env[p.clientIdEnv],
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: p.scope,
    state,
  });
  res.redirect(`${p.authUrl}?${params.toString()}`);
});

// GET /sso/:provider/callback — exchange the code for a session and hand off to the SPA.
router.get('/sso/:provider/callback', async (req, res) => {
  const provider = req.params.provider;
  const p = PROVIDERS[provider];
  if (!p) return res.status(404).json({ error: 'Unknown provider' });
  const base = appUrl(req);
  const { code, state, error } = req.query;
  if (error) return res.redirect(`${base}/login?sso_error=${encodeURIComponent(String(error))}`);

  const stateEntry = db.prepare("SELECT * FROM sso_state WHERE state = ? AND expires_at > datetime('now')").get(state);
  if (!stateEntry || stateEntry.provider !== provider) {
    return res.redirect(`${base}/login?sso_error=invalid_state`);
  }
  db.prepare('DELETE FROM sso_state WHERE state = ?').run(state);

  try {
    const redirectUri = `${base}/api/auth/sso/${provider}/callback`;
    const tokenRes = await fetch(p.tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: process.env[p.clientIdEnv],
        client_secret: process.env[p.clientSecretEnv],
        code: String(code || ''),
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
      }),
      signal: AbortSignal.timeout(8000),
    });
    const tokenData = await tokenRes.json();
    if (!tokenRes.ok || !tokenData.access_token) throw new Error(tokenData.error_description || 'Token exchange failed');

    const profileRes = await fetch(p.userInfoUrl, {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
      signal: AbortSignal.timeout(8000),
    });
    const profile = await profileRes.json();
    const email = (profile.email || '').toLowerCase().trim();
    const name = profile.name || profile.given_name || (email ? email.split('@')[0] : 'New User');
    if (!email) throw new Error('Provider did not return an email address');

    let user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
    if (user) {
      if (!user.is_active) throw new Error('This account is deactivated');
      if (!user.sso_provider) db.prepare('UPDATE users SET sso_provider = ? WHERE id = ?').run(provider, user.id);
    } else {
      // Provision a new organization for this user, mirroring /signup.
      const orgId = uuidv4();
      const userId = uuidv4();
      const orgName = `${name}'s Organization`;
      let slug = (email.split('@')[1] || 'org').split('.')[0].toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'org';
      if (db.prepare('SELECT id FROM organizations WHERE slug = ?').get(slug)) slug = `${slug}-${orgId.slice(0, 8)}`;

      const provision = db.transaction(() => {
        db.prepare('INSERT INTO organizations (id, name, slug) VALUES (?, ?, ?)').run(orgId, orgName, slug);
        db.prepare(`INSERT INTO users (id, email, display_name, password_hash, role, company_id, sso_provider) VALUES (?, ?, ?, ?, 'developer', ?, ?)`)
          .run(userId, email, name, hashPassword(crypto.randomBytes(32).toString('hex')), orgId, provider);
        db.prepare(`INSERT INTO plan (tier, app_limit, dashboard_limit, company_id) VALUES ('free', 5, 2, ?)`).run(orgId);
        db.prepare(`INSERT INTO sites (id, company_id, name, code, is_primary) VALUES (?, ?, 'Main Site', 'MAIN', 1)`).run(uuidv4(), orgId);
        const insSetting = db.prepare(`INSERT OR IGNORE INTO org_settings (company_id, key, value) VALUES (?, ?, ?)`);
        for (const [k, v] of [['company_name', orgName], ['timezone', 'America/New_York'], ['date_format', 'MM/DD/YYYY'], ['currency', 'USD']]) {
          insSetting.run(orgId, k, v);
        }
      });
      provision();
      user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
    }

    const ssoToken = generateToken();
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
    db.prepare(`INSERT INTO sessions (id, user_id, token, expires_at) VALUES (?, ?, ?, ?)`).run(uuidv4(), user.id, ssoToken, expiresAt);
    db.prepare(`UPDATE users SET last_login = datetime('now') WHERE id = ?`).run(user.id);

    res.cookie('hm_token', ssoToken, {
      httpOnly: true,
      secure: config.isProd,
      sameSite: 'lax',
      maxAge: 30 * 24 * 60 * 60 * 1000,
      path: '/',
    });
    res.redirect(`${base}/sso/callback?token=${ssoToken}`);
  } catch (e) {
    console.error('[sso] callback error:', e.message);
    res.redirect(`${base}/login?sso_error=${encodeURIComponent(e.message)}`);
  }
});

module.exports = router;

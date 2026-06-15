// ─── Launch-feature tests ─────────────────────────────────────────────────────
// Exercises the password-reset flow and operator PIN/badge identity end to end
// against the real server. Node built-ins only (node:test + global fetch).

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const PORT = 3198;
const BASE = `http://localhost:${PORT}`;
const DB_PATH = path.join(os.tmpdir(), `mes-launch-${Date.now()}.db`);

let server;

function startServer() {
  return new Promise((resolve, reject) => {
    server = spawn('node', [path.join(__dirname, '..', 'src', 'index.js')], {
      env: {
        ...process.env,
        NODE_ENV: 'test',
        PORT: String(PORT),
        DATABASE_PATH: DB_PATH,
        SEED_DEMO_DATA: 'false',
        BACKUP_DIR: '',
        APP_URL: BASE,
        // Ensure no SMTP so forgot-password returns a dev_reset_url we can use.
        SMTP_HOST: '', SMTP_USER: '', SMTP_PASS: '',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    server.stderr.on('data', d => process.stderr.write(`[server] ${d}`));
    const deadline = Date.now() + 15000;
    (async function poll() {
      try { const r = await fetch(`${BASE}/api/health`); if (r.ok) return resolve(); } catch { /* not up */ }
      if (Date.now() > deadline) return reject(new Error('server did not start in time'));
      setTimeout(poll, 200);
    })();
  });
}

async function api(method, pathname, { token, body } = {}) {
  const res = await fetch(`${BASE}${pathname}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  let json = null;
  try { json = await res.json(); } catch { /* no body */ }
  return { status: res.status, json };
}

before(async () => { await startServer(); });
after(() => {
  if (server) server.kill('SIGTERM');
  for (const ext of ['', '-shm', '-wal']) { try { fs.unlinkSync(DB_PATH + ext); } catch { /* ignore */ } }
});

test('password reset: request → reset → login with new password; token is single-use', async () => {
  const email = 'reset@reset.test';
  const signup = await api('POST', '/api/auth/signup', {
    body: { company_name: 'Reset Co', email, password: 'originalpass1', display_name: 'Reset Owner' },
  });
  assert.equal(signup.status, 201);

  // Unknown email still returns 200 (no enumeration).
  const unknown = await api('POST', '/api/auth/forgot-password', { body: { email: 'nobody@nowhere.test' } });
  assert.equal(unknown.status, 200);
  assert.equal(unknown.json.ok, true);

  // Real email: with no SMTP configured we get a dev_reset_url back.
  const forgot = await api('POST', '/api/auth/forgot-password', { body: { email } });
  assert.equal(forgot.status, 200);
  assert.ok(forgot.json.dev_reset_url, 'dev_reset_url returned when SMTP is off');
  const token = forgot.json.dev_reset_url.split('token=')[1];
  assert.ok(token && token.length > 20, 'reset token present');

  // Reset to a new password.
  const reset = await api('POST', '/api/auth/reset-password', { body: { token, new_password: 'brandnewpass2' } });
  assert.equal(reset.status, 200);
  assert.equal(reset.json.ok, true);

  // Old password no longer works; new one does.
  const oldLogin = await api('POST', '/api/auth/login', { body: { email, password: 'originalpass1' } });
  assert.equal(oldLogin.status, 401);
  const newLogin = await api('POST', '/api/auth/login', { body: { email, password: 'brandnewpass2' } });
  assert.equal(newLogin.status, 200);
  assert.ok(newLogin.json.token);

  // The reset token cannot be reused.
  const reuse = await api('POST', '/api/auth/reset-password', { body: { token, new_password: 'thirdpass33' } });
  assert.equal(reuse.status, 400);

  // Too-short passwords are rejected.
  const forgot2 = await api('POST', '/api/auth/forgot-password', { body: { email } });
  const token2 = forgot2.json.dev_reset_url.split('token=')[1];
  const weak = await api('POST', '/api/auth/reset-password', { body: { token: token2, new_password: 'short' } });
  assert.equal(weak.status, 400);
});

test('operator identity: set PIN/badge, then verify by PIN and by badge', async () => {
  const owner = await api('POST', '/api/auth/signup', {
    body: { company_name: 'Floor Co', email: 'floor@floor.test', password: 'ownerpass123', display_name: 'Floor Owner' },
  });
  const token = owner.json.token;

  // Create an operator.
  const created = await api('POST', '/api/users', {
    token,
    body: { email: 'op1@floor.test', display_name: 'Olivia Operator', password: 'operatorpass', role: 'operator' },
  });
  assert.equal(created.status, 201);
  const opId = created.json.id;

  // Set a PIN + badge.
  const setPin = await api('PUT', `/api/users/${opId}/pin`, { token, body: { pin: '4321', badge_code: 'CARD-99' } });
  assert.equal(setPin.status, 200);
  assert.equal(setPin.json.has_pin, true);
  assert.equal(setPin.json.has_badge, true);

  // Roster reflects the operator with a PIN set.
  const roster = await api('GET', '/api/operators/roster', { token });
  assert.equal(roster.status, 200);
  const entry = roster.json.find(r => r.id === opId);
  assert.ok(entry && entry.has_pin === 1 && entry.has_badge === 1);

  // Verify by correct PIN.
  const ok = await api('POST', '/api/operators/verify', { token, body: { user_id: opId, pin: '4321' } });
  assert.equal(ok.status, 200);
  assert.equal(ok.json.display_name, 'Olivia Operator');

  // Wrong PIN is rejected.
  const wrong = await api('POST', '/api/operators/verify', { token, body: { user_id: opId, pin: '0000' } });
  assert.equal(wrong.status, 401);

  // Verify by badge.
  const byBadge = await api('POST', '/api/operators/verify', { token, body: { badge_code: 'CARD-99' } });
  assert.equal(byBadge.status, 200);
  assert.equal(byBadge.json.id, opId);

  // Invalid PIN format is rejected on set.
  const badFmt = await api('PUT', `/api/users/${opId}/pin`, { token, body: { pin: '12' } });
  assert.equal(badFmt.status, 400);

  // Clearing credentials works.
  const clear = await api('PUT', `/api/users/${opId}/pin`, { token, body: { pin: null, badge_code: null } });
  assert.equal(clear.status, 200);
  assert.equal(clear.json.has_pin, false);
  assert.equal(clear.json.has_badge, false);
});

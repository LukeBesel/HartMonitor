// ─── Auth flow truth tests ───────────────────────────────────────────────────
// Locks the behaviour the auth audit (M4) verified end-to-end, with the
// emphasis on promises the UI makes to users:
//
//   • POST /auth/claim-sandbox — the demo banner's "Keep my work — create a
//     free account". The sandbox ORGANISATION must be promoted in place: same
//     company_id, every seeded and visitor-created row still present, sweeper
//     disarmed, throwaway visitor login destroyed. Anything less makes the
//     button a lie.
//   • password reset kills every pre-existing session and the old password,
//   • change-password kills OTHER sessions but keeps the current one,
//   • logout kills exactly one session.
//
// NOTE: credential endpoints are rate-limited to 20 requests / 15 min per IP,
// so this file spends its budget deliberately.
//
// Uses only Node built-ins (node:test + global fetch). Run with: npm test

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const PORT = 3183; // unique per test file — 3184-3199 are taken by other suites
const BASE = `http://localhost:${PORT}`;
const DB_PATH = path.join(os.tmpdir(), `mes-auth-flows-test-${Date.now()}.db`);

// The expiry test needs src/db in THIS process against the same file the server
// child uses (WAL makes multi-process access safe). config.js reads env on load.
process.env.DATABASE_PATH = DB_PATH;
process.env.SEED_DEMO_DATA = 'false';

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
        APP_URL: 'https://hartmonitorapp.com',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    server.stderr.on('data', d => process.stderr.write(`[server] ${d}`));
    const deadline = Date.now() + 15000;
    (async function poll() {
      try {
        const r = await fetch(`${BASE}/api/health`);
        if (r.ok) return resolve();
      } catch { /* not up yet */ }
      if (Date.now() > deadline) return reject(new Error('server did not start in time'));
      setTimeout(poll, 200);
    })();
  });
}

async function api(method, pathname, { token, body, cookie } = {}) {
  const res = await fetch(`${BASE}${pathname}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(cookie ? { Cookie: cookie } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  let json = null;
  try { json = await res.json(); } catch { /* no body */ }
  const setCookie = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
  return { status: res.status, json, setCookie };
}

function hmCookie(setCookie) {
  for (const c of setCookie) {
    const m = c.match(/^hm_token=([^;]*)/);
    if (m) return { raw: `hm_token=${m[1]}`, value: m[1], full: c };
  }
  return null;
}

const stamp = Date.now();

before(async () => { await startServer(); });

after(() => {
  if (server) server.kill();
  try { fs.unlinkSync(DB_PATH); } catch { /* already gone */ }
  for (const suffix of ['-wal', '-shm']) {
    try { fs.unlinkSync(DB_PATH + suffix); } catch { /* fine */ }
  }
});

// ─── "Keep my work — create a free account" ──────────────────────────────────

test('claiming a sandbox keeps the workspace instead of starting an empty one', async () => {
  const demo = await api('POST', '/api/auth/demo');
  assert.equal(demo.status, 201);
  assert.equal(demo.json.sandbox, true);
  const demoCookie = hmCookie(demo.setCookie);
  const demoToken = demo.json.token;
  const visitorId = demo.json.user.id;

  // Snapshot the workspace the visitor is looking at.
  const before = {
    company: (await api('GET', '/api/auth/me', { token: demoToken })).json,
    apps: (await api('GET', '/api/apps', { token: demoToken })).json,
    workOrders: (await api('GET', '/api/work-orders', { token: demoToken })).json,
    items: (await api('GET', '/api/inventory/items', { token: demoToken })).json,
  };
  assert.ok(before.apps.length > 0, 'the demo has apps to keep');
  assert.ok(before.workOrders.length > 0, 'the demo has work orders to keep');

  // …and something the VISITOR made, which is the part they actually care about.
  const mine = await api('POST', '/api/apps', { token: demoToken, body: { name: `My Own App ${stamp}` } });
  assert.equal(mine.status, 201);

  const email = `claimer-${stamp}@hartmonitor-qa.test`;
  const claim = await api('POST', '/api/auth/claim-sandbox', {
    token: demoToken,
    body: { company_name: `Hart Machining ${stamp}`, display_name: 'Claim Tester', email, password: 'claim-pass-123' },
  });
  assert.equal(claim.status, 201, JSON.stringify(claim.json));
  assert.equal(claim.json.claimed, true);
  assert.equal(claim.json.user.email, email);
  assert.equal(claim.json.user.role, 'developer', 'the claimer owns the account');

  const owner = claim.json.token;
  const me = await api('GET', '/api/auth/me', { token: owner });
  assert.equal(me.status, 200);
  // The STORED role stays 'developer' — it is the permission level every role
  // check and the users-table CHECK are written against — while the API hands
  // the screens the name they print for it. A plant manager who created the
  // account is the Owner; "developer" is a word no plant calls a person, and
  // Settings used to print it straight out of the database.
  assert.equal(me.json.role, 'developer', 'the stored role is untouched');
  assert.equal(me.json.display_role, 'Owner', 'and it is shown as Owner');
  assert.equal(me.json.company_id, before.company.company_id, 'SAME workspace — not a new organisation');
  assert.equal(me.json.company_name, `Hart Machining ${stamp}`, 'renamed to the claimer’s company');

  // Every row is still there, plus the app the visitor built.
  const apps = (await api('GET', '/api/apps', { token: owner })).json;
  assert.equal(apps.length, before.apps.length + 1, 'seeded apps AND the visitor’s app survived');
  assert.ok(apps.some(a => a.name === `My Own App ${stamp}`), 'the visitor’s own work is kept');
  assert.equal((await api('GET', '/api/work-orders', { token: owner })).json.length, before.workOrders.length);
  assert.equal((await api('GET', '/api/inventory/items', { token: owner })).json.length, before.items.length);

  // The 24-hour sweeper is disarmed: is_sandbox is cleared. cleanupExpiredSandboxes
  // only touches rows with is_sandbox = 1, so a claimed org can never be swept.
  const { cleanupExpiredSandboxes } = require('../src/sandbox');
  cleanupExpiredSandboxes();
  assert.equal((await api('GET', '/api/auth/me', { token: owner })).status, 200,
    'the claimed workspace survives a sandbox sweep');

  // The throwaway demo identity is gone — its cookie and bearer token are dead.
  assert.equal((await api('GET', '/api/auth/me', { token: demoToken })).status, 401, 'demo bearer token revoked');
  assert.equal((await api('GET', '/api/auth/me', { cookie: demoCookie.raw })).status, 401, 'demo cookie revoked');

  // The claim promises a FREE account — the demo ran on Pro.
  const plan = (await api('GET', '/api/config/plan', { token: owner })).json;
  assert.equal(plan.tier, 'free');

  // And the new owner can actually sign in with the password they chose.
  const login = await api('POST', '/api/auth/login', { body: { email, password: 'claim-pass-123' } });
  assert.equal(login.status, 200);

  assert.ok(visitorId, 'sanity: the visitor user existed');
});

test('claim-sandbox refuses anything that is not a live sandbox claim', async () => {
  const demo = await api('POST', '/api/auth/demo');
  assert.equal(demo.status, 201);
  const demoToken = demo.json.token;

  // Weak password / missing fields are refused before anything is written.
  const short = await api('POST', '/api/auth/claim-sandbox', {
    token: demoToken,
    body: { company_name: 'X', display_name: 'Y', email: `short-${stamp}@qa.test`, password: 'abc' },
  });
  assert.equal(short.status, 400);

  const missing = await api('POST', '/api/auth/claim-sandbox', {
    token: demoToken, body: { company_name: 'X' },
  });
  assert.equal(missing.status, 400);

  // A taken email cannot be claimed (the first test's owner).
  const taken = await api('POST', '/api/auth/claim-sandbox', {
    token: demoToken,
    body: { company_name: 'X', display_name: 'Y', email: `claimer-${stamp}@hartmonitor-qa.test`, password: 'claim-pass-123' },
  });
  assert.equal(taken.status, 409);

  // The sandbox is still intact and still a sandbox after every refusal.
  assert.equal((await api('GET', '/api/auth/me', { token: demoToken })).status, 200);

  // A real account cannot re-claim itself into a second free workspace.
  const owner = await api('POST', '/api/auth/login', {
    body: { email: `claimer-${stamp}@hartmonitor-qa.test`, password: 'claim-pass-123' },
  });
  assert.equal(owner.status, 200);
  const notSandbox = await api('POST', '/api/auth/claim-sandbox', {
    token: owner.json.token,
    body: { company_name: 'Again', display_name: 'Y', email: `again-${stamp}@qa.test`, password: 'claim-pass-123' },
  });
  assert.equal(notSandbox.status, 400);
  assert.equal(notSandbox.json.error, 'not_a_sandbox');

  // Anonymous callers get nowhere.
  const anon = await api('POST', '/api/auth/claim-sandbox', {
    body: { company_name: 'X', display_name: 'Y', email: `anon-${stamp}@qa.test`, password: 'claim-pass-123' },
  });
  assert.equal(anon.status, 401);
});

// ─── Session invalidation truths ─────────────────────────────────────────────

test('password reset kills every existing session and the old password', async () => {
  const email = `reset-${stamp}@hartmonitor-qa.test`;
  const signup = await api('POST', '/api/auth/signup', {
    body: { company_name: `Reset Co ${stamp}`, email, password: 'first-password-1', display_name: 'Reset Tester' },
  });
  assert.equal(signup.status, 201);
  const sessionA = signup.json.token;

  const forgot = await api('POST', '/api/auth/forgot-password', { body: { email } });
  assert.equal(forgot.status, 200);
  assert.equal(forgot.json.ok, true);
  // The token must NEVER come back to the (unauthenticated) caller — returning
  // it was an account-takeover hole. Self-hosted recovery goes through the
  // admin-only pending-resets endpoint, read here with the still-valid session.
  assert.equal(forgot.json.dev_reset_url, undefined, 'forgot-password must not leak the reset token');
  const pending = await api('GET', '/api/admin/pending-resets', { token: sessionA });
  assert.equal(pending.status, 200);
  const entry = pending.json.find(p => p.user_email === email);
  assert.ok(entry, 'the reset is listed for an admin of the same company');
  assert.ok(entry.reset_url.startsWith('https://hartmonitorapp.com/reset-password?token='),
    `reset link must point at APP_URL, got ${entry.reset_url}`);

  const token = new URL(entry.reset_url).searchParams.get('token');
  const reset = await api('POST', '/api/auth/reset-password', { body: { token, new_password: 'second-password-2' } });
  assert.equal(reset.status, 200);

  assert.equal((await api('GET', '/api/auth/me', { token: sessionA })).status, 401,
    'sessions opened before the reset are dead');
  assert.equal((await api('POST', '/api/auth/reset-password', { body: { token, new_password: 'third-password-3' } })).status, 400,
    'a reset token is single-use');

  const oldPw = await api('POST', '/api/auth/login', { body: { email, password: 'first-password-1' } });
  assert.equal(oldPw.status, 401, 'the old password is rejected');
  const newPw = await api('POST', '/api/auth/login', { body: { email, password: 'second-password-2' } });
  assert.equal(newPw.status, 200, 'the reset password works');
});

test('change-password ends other sessions but not the one making the change', async () => {
  const email = `change-${stamp}@hartmonitor-qa.test`;
  const signup = await api('POST', '/api/auth/signup', {
    body: { company_name: `Change Co ${stamp}`, email, password: 'first-password-1', display_name: 'Change Tester' },
  });
  assert.equal(signup.status, 201);
  const sessionA = signup.json.token;

  const second = await api('POST', '/api/auth/login', { body: { email, password: 'first-password-1' } });
  assert.equal(second.status, 200);
  const sessionB = second.json.token;

  const changed = await api('PUT', '/api/auth/change-password', {
    token: sessionB, body: { current_password: 'first-password-1', new_password: 'second-password-2' },
  });
  assert.equal(changed.status, 200);

  assert.equal((await api('GET', '/api/auth/me', { token: sessionA })).status, 401, 'the other session is signed out');
  assert.equal((await api('GET', '/api/auth/me', { token: sessionB })).status, 200, 'the changing session stays in');

  // Logout ends exactly one session, not the account.
  assert.equal((await api('POST', '/api/auth/logout', { token: sessionB })).status, 200);
  assert.equal((await api('GET', '/api/auth/me', { token: sessionB })).status, 401);
});

test('an expired session stops working', async () => {
  const email = `expiry-${stamp}@hartmonitor-qa.test`;
  const signup = await api('POST', '/api/auth/signup', {
    body: { company_name: `Expiry Co ${stamp}`, email, password: 'first-password-1', display_name: 'Expiry Tester' },
  });
  assert.equal(signup.status, 201);
  const token = signup.json.token;
  assert.equal((await api('GET', '/api/auth/me', { token })).status, 200, 'valid while fresh');

  // Backdate the session's expiry the way 30 days of wall clock would.
  const db = require('../src/db');
  const changed = db.prepare("UPDATE sessions SET expires_at = datetime('now', '-1 hour') WHERE token = ?").run(token);
  assert.equal(changed.changes, 1, 'the session row was found');

  assert.equal((await api('GET', '/api/auth/me', { token })).status, 401, 'an expired session is refused');
  assert.equal((await api('GET', '/api/apps', { token })).status, 401, 'and it unlocks nothing else either');
});

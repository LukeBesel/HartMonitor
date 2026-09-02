'use strict';
// ─── Settings belong to the customer, not to whoever hosts the software ───────
//
// Settings had thirteen tabs, and one of them — "Developer" — told the plant
// that bought an MES to "set STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET in
// your host and redeploy". The server was shipping those names to every
// manager's browser, and a failed checkout handed back Stripe's own error text,
// which names price ids, account ids and key prefixes. Neither is a customer's
// business, and neither helps them do anything.
//
// Meanwhile two decisions that ARE the plant's — which workspaces its sidebar
// shows, and whether the setup checklist has been put away — lived in each
// browser's localStorage, so the manager who tidied the sidebar was the only
// person who ever saw it tidy.
//
// This file pins all four:
//   1. A customer manager's /integrations response names no host env var.
//   2. A failed checkout returns our sentence, never the provider's.
//   3. Nav visibility and checklist dismissal round-trip through org_settings,
//      scoped to one company and invisible to another.
//   4. An operator cannot change them.
//
// Uses Node built-ins only (node:test + global fetch). Run with:
//   node --test test/settings-groups.test.js

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const PORT = 3405; // unique per test file — a collision silently cancels a suite
const BASE = `http://localhost:${PORT}`;
const DB_PATH = path.join(os.tmpdir(), `mes-settings-groups-${Date.now()}.db`);

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
        // Checkout is short-circuited during early access, and this suite is
        // about what a FAILED checkout says.
        EARLY_ACCESS: 'false',
        // A key shaped like Stripe's but belonging to nobody: the SDK builds a
        // client, the call to Stripe fails, and the catch block is what we are
        // here to read. Deliberately not a real credential.
        STRIPE_SECRET_KEY: 'sk_test_forced_failure_this_key_is_not_real',
        STRIPE_WEBHOOK_SECRET: 'whsec_forced_failure_not_real',
        // Nobody in this suite is HartMonitor staff.
        PLATFORM_STAFF_EMAILS: '',
        BACKUP_DIR: '',
        APP_URL: BASE,
        SMTP_HOST: '', SMTP_USER: '', SMTP_PASS: '',
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

async function api(method, pathname, { token, body } = {}) {
  const res = await fetch(`${BASE}${pathname}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  let json = null;
  try { json = await res.json(); } catch { /* no body */ }
  return { status: res.status, json };
}

before(async () => { await startServer(); });
after(() => {
  if (server) server.kill('SIGTERM');
  for (const ext of ['', '-shm', '-wal']) {
    try { fs.unlinkSync(DB_PATH + ext); } catch { /* ignore */ }
  }
});

describe('settings that fit', () => {
  let ownerToken, managerToken, operatorToken, otherToken;

  before(async () => {
    const signup = await api('POST', '/api/auth/signup', {
      body: { company_name: 'Fitted Co', email: 'owner@fitted.test', password: 'SecretPass1', display_name: 'Owner' },
    });
    assert.equal(signup.status, 201, `signup: ${JSON.stringify(signup.json)}`);
    ownerToken = signup.json.token;

    for (const [email, role] of [['manager@fitted.test', 'manager'], ['operator@fitted.test', 'operator']]) {
      const made = await api('POST', '/api/users', {
        token: ownerToken,
        body: { email, display_name: role, password: 'SecretPass1', role },
      });
      assert.equal(made.status, 201, `creating ${role}: ${JSON.stringify(made.json)}`);
      const login = await api('POST', '/api/auth/login', { body: { email, password: 'SecretPass1' } });
      assert.equal(login.status, 200, `login ${role}: ${JSON.stringify(login.json)}`);
      if (role === 'manager') managerToken = login.json.token;
      else operatorToken = login.json.token;
    }

    // A second company, to prove one plant's settings are not another's.
    const other = await api('POST', '/api/auth/signup', {
      body: { company_name: 'Next Door Co', email: 'owner@nextdoor.test', password: 'SecretPass1', display_name: 'Owner Two' },
    });
    assert.equal(other.status, 201, `second signup: ${JSON.stringify(other.json)}`);
    otherToken = other.json.token;
  });

  // ── 1. Nothing addressed to the host ───────────────────────────────────────

  it('never names the host\'s environment variables to a customer manager', async () => {
    const res = await api('GET', '/api/config/integrations', { token: managerToken });
    assert.equal(res.status, 200, JSON.stringify(res.json));

    const body = JSON.stringify(res.json);
    assert.ok(!body.includes('STRIPE_SECRET_KEY'), `host env var leaked to a customer: ${body}`);
    assert.ok(!body.includes('STRIPE_WEBHOOK_SECRET'), `host env var leaked to a customer: ${body}`);
    assert.ok(!body.includes('env_vars'), `host configuration leaked to a customer: ${body}`);
    assert.ok(!body.includes('webhook_url'), `host configuration leaked to a customer: ${body}`);

    // What is left is a fact about their own account, which they may have.
    assert.equal(typeof res.json.payments.configured, 'boolean');
    assert.ok(Array.isArray(res.json.sso));
  });

  // ── 2. A failed checkout says something a customer can act on ──────────────

  it('answers a failed checkout with our sentence, never the provider\'s', async () => {
    const res = await api('POST', '/api/config/plan/checkout', {
      token: managerToken,
      body: { tier: 'pro' },
    });
    assert.equal(res.status, 502, `expected a 502 from a broken checkout: ${JSON.stringify(res.json)}`);
    assert.equal(res.json.error, 'checkout_failed');
    assert.equal(res.json.message, 'We could not start the upgrade. Try again or contact support.');

    const said = JSON.stringify(res.json).toLowerCase();
    for (const leak of ['stripe', 'sk_', 'price_', 'acct_']) {
      assert.ok(!said.includes(leak), `the provider's internals reached the browser: ${said}`);
    }
  });

  // ── 3. Plant configuration follows the company ─────────────────────────────

  it('round-trips nav visibility and checklist dismissal through org_settings', async () => {
    const saved = await api('PUT', '/api/config', {
      token: managerToken,
      body: { nav_hidden_sections: ['quality', 'inventory'], setup_checklist_dismissed: '1' },
    });
    assert.equal(saved.status, 200, JSON.stringify(saved.json));
    assert.deepEqual(JSON.parse(saved.json.nav_hidden_sections), ['quality', 'inventory']);

    // Anyone signed in to the same company reads the same answer — that is the
    // whole point of moving it off one browser's localStorage.
    const asOperator = await api('GET', '/api/config', { token: operatorToken });
    assert.equal(asOperator.status, 200);
    assert.deepEqual(JSON.parse(asOperator.json.nav_hidden_sections), ['quality', 'inventory']);
    assert.equal(asOperator.json.setup_checklist_dismissed, '1');

    // Including the owner, on any other device.
    const asOwner = await api('GET', '/api/config', { token: ownerToken });
    assert.deepEqual(JSON.parse(asOwner.json.nav_hidden_sections), ['quality', 'inventory']);
  });

  it('keeps one company\'s settings out of another company\'s answer', async () => {
    const next = await api('GET', '/api/config', { token: otherToken });
    assert.equal(next.status, 200);
    assert.equal(next.json.nav_hidden_sections, undefined, 'a neighbour must not see this plant\'s navigation');
    assert.equal(next.json.setup_checklist_dismissed, undefined);
  });

  it('accepts an ISO stamp for the checklist as readily as a flag', async () => {
    const stamp = new Date().toISOString();
    const saved = await api('PUT', '/api/config', {
      token: managerToken,
      body: { setup_checklist_dismissed: stamp },
    });
    assert.equal(saved.status, 200);
    assert.equal(saved.json.setup_checklist_dismissed, stamp);
  });

  it('refuses a value the sidebar could never read back', async () => {
    const bad = await api('PUT', '/api/config', {
      token: managerToken,
      body: { nav_hidden_sections: 'quality' },
    });
    assert.equal(bad.status, 400, JSON.stringify(bad.json));
    // The stored value is untouched.
    const still = await api('GET', '/api/config', { token: managerToken });
    assert.deepEqual(JSON.parse(still.json.nav_hidden_sections), ['quality', 'inventory']);
  });

  // ── 4. An operator does not decide what the plant's screens show ───────────

  it('refuses an operator changing what the whole plant sees', async () => {
    const refused = await api('PUT', '/api/config', {
      token: operatorToken,
      body: { nav_hidden_sections: [] },
    });
    assert.equal(refused.status, 403, `an operator must not rewrite plant navigation: ${JSON.stringify(refused.json)}`);

    const unchanged = await api('GET', '/api/config', { token: managerToken });
    assert.deepEqual(JSON.parse(unchanged.json.nav_hidden_sections), ['quality', 'inventory']);
  });
});

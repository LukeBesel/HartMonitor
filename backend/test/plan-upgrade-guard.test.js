// ─── Plan upgrade requires checkout when billing is live ─────────────────────
// A security review found that with EARLY_ACCESS off a manager could PUT
// tier:'enterprise' and unlock unlimited capacity for free, bypassing checkout.
// When real billing is configured, Stripe must be the source of truth for paid
// upgrades: a PUT may only downgrade; an upgrade returns 402 (use checkout). We
// configure DUMMY Stripe env so isConfigured() is true without any network call
// — the guard returns before Stripe is ever contacted. Run with: npm test

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const PORT = 3171;
const BASE = `http://localhost:${PORT}`;
const DB_PATH = path.join(os.tmpdir(), `mes-plan-guard-${Date.now()}.db`);

let server;

function startServer() {
  return new Promise((resolve, reject) => {
    server = spawn('node', [path.join(__dirname, '..', 'src', 'index.js')], {
      env: {
        ...process.env, NODE_ENV: 'test', PORT: String(PORT), DATABASE_PATH: DB_PATH,
        SEED_DEMO_DATA: 'false', BACKUP_DIR: '',
        // Billing LIVE for this suite: early access off + Stripe "configured".
        EARLY_ACCESS: 'false',
        STRIPE_SECRET_KEY: 'sk_test_dummy_for_isConfigured_only',
        STRIPE_WEBHOOK_SECRET: 'whsec_dummy',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    server.stderr.on('data', d => process.stderr.write(`[server] ${d}`));
    const deadline = Date.now() + 15000;
    (async function poll() {
      try { const r = await fetch(`${BASE}/api/health`); if (r.ok) return resolve(); } catch { /* not up */ }
      if (Date.now() > deadline) return reject(new Error('server did not start'));
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

let token;

before(async () => {
  await startServer();
  const s = await api('POST', '/api/auth/signup', {
    body: { company_name: 'Billing Co', email: 'admin@billing.test', password: 'SecretPass1', display_name: 'Admin' },
  });
  assert.equal(s.status, 201);
  token = s.json.token;
});

after(() => {
  if (server) server.kill('SIGTERM');
  for (const ext of ['', '-shm', '-wal']) { try { fs.unlinkSync(DB_PATH + ext); } catch { /* ignore */ } }
});

test('a free company cannot self-upgrade to a paid tier without checkout', async () => {
  const r = await api('PUT', '/api/config/plan', { token, body: { tier: 'enterprise' } });
  assert.equal(r.status, 402, `expected 402 checkout_required, got ${r.status}: ${JSON.stringify(r.json)}`);
  assert.equal(r.json.error, 'checkout_required');
  // And the tier did NOT change.
  const plan = await api('GET', '/api/config/plan', { token });
  assert.notEqual(plan.json.tier, 'enterprise', 'the tier was upgraded despite the guard');
});

test('paid add-on slots also require checkout when billing is live', async () => {
  const r = await api('POST', '/api/config/plan/purchase', { token, body: { type: 'app_slot', quantity: 5 } });
  assert.equal(r.status, 402, `expected 402, got ${r.status}: ${JSON.stringify(r.json)}`);
});

test('a downgrade is still allowed (a customer can reduce their plan)', async () => {
  // 'free' is the cheapest tier; downgrading to it must not be blocked.
  const r = await api('PUT', '/api/config/plan', { token, body: { tier: 'free' } });
  assert.ok(r.status === 200, `downgrade should be allowed, got ${r.status}: ${JSON.stringify(r.json)}`);
});

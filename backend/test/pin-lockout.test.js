// ─── PIN brute-force lockout + authorizer role gate ──────────────────────────
// The PIN endpoints check a submitted PIN against every active user's hash, so
// a 4-digit space is exhaustible without a limiter. After a burst of failures
// from one source the endpoint locks (429); a real PIN clears the counter. And
// only a floor role (operator+) may attempt the supervisor authorizer check.
// Node built-ins only. Run with: npm test

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const PORT = 3172;
const BASE = `http://localhost:${PORT}`;
const DB_PATH = path.join(os.tmpdir(), `mes-pin-lockout-${Date.now()}.db`);

let server;

function startServer() {
  return new Promise((resolve, reject) => {
    server = spawn('node', [path.join(__dirname, '..', 'src', 'index.js')], {
      env: { ...process.env, NODE_ENV: 'test', PORT: String(PORT), DATABASE_PATH: DB_PATH, SEED_DEMO_DATA: 'false', EARLY_ACCESS: 'true', BACKUP_DIR: '' },
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

async function freshCompany(tag) {
  const s = await api('POST', '/api/auth/signup', {
    body: { company_name: `Lockout ${tag}`, email: `admin-${tag}@lockout.test`, password: 'SecretPass1', display_name: 'Admin' },
  });
  assert.equal(s.status, 201, `signup ${tag} failed`);
  return s.json.token;
}

before(async () => { await startServer(); });
after(() => {
  if (server) server.kill('SIGTERM');
  for (const ext of ['', '-shm', '-wal']) { try { fs.unlinkSync(DB_PATH + ext); } catch { /* ignore */ } }
});

test('verify-authorizer locks out after a burst of wrong PINs', async () => {
  const token = await freshCompany('vauth');
  // 10 wrong PINs → all 403 (no supervisor PIN set on this fresh company anyway).
  let sawLimit = false;
  for (let i = 0; i < 14; i++) {
    const r = await api('POST', '/api/operators/verify-authorizer', { token, body: { pin: String(1000 + i) } });
    if (r.status === 429) { sawLimit = true; break; }
    assert.equal(r.status, 403, `attempt ${i} should be 403 until the lockout, got ${r.status}`);
  }
  assert.ok(sawLimit, 'the endpoint never locked out after repeated failures');
});

test('badge-login PIN path locks out after a burst of wrong PINs', async () => {
  const token = await freshCompany('badge');
  let sawLimit = false;
  for (let i = 0; i < 14; i++) {
    const r = await api('POST', '/api/operators/badge-login', { token, body: { pin: String(2000 + i) } });
    if (r.status === 429) { sawLimit = true; break; }
    assert.equal(r.status, 401, `attempt ${i} should be 401 until the lockout, got ${r.status}`);
  }
  assert.ok(sawLimit, 'badge-login never locked out');
});

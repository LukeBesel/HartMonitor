// ─── Webhook SSRF guard ──────────────────────────────────────────────────────
// A webhook URL is customer-supplied and fetched server-side. Without a guard a
// tenant could register an internal target (127.0.0.1, an RFC-1918 host, the
// cloud metadata service) and read the response back through the delivery log —
// server-side request forgery. Registration and update must reject any URL that
// is, or resolves to, a private/reserved address; a public https URL is allowed.
// Node built-ins only. Run with: npm test

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const PORT = 3174;
const BASE = `http://localhost:${PORT}`;
const DB_PATH = path.join(os.tmpdir(), `mes-webhook-ssrf-${Date.now()}.db`);

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

let token;

before(async () => {
  await startServer();
  const signup = await api('POST', '/api/auth/signup', {
    body: { company_name: 'Hook Co', email: 'admin@hook.test', password: 'SecretPass1', display_name: 'Admin' },
  });
  assert.equal(signup.status, 201, `signup failed: ${JSON.stringify(signup.json)}`);
  token = signup.json.token;
});

after(() => {
  if (server) server.kill('SIGTERM');
  for (const ext of ['', '-shm', '-wal']) { try { fs.unlinkSync(DB_PATH + ext); } catch { /* ignore */ } }
});

const BLOCKED = [
  'http://127.0.0.1/x',
  'http://169.254.169.254/latest/meta-data/',
  'http://10.0.0.5/hook',
  'http://192.168.1.10/hook',
  'http://172.16.5.5/hook',
  'http://localhost:3000/hook',
  'http://[::1]/hook',
  'ftp://example.com/hook',
];

test('registration rejects every internal / reserved target', async () => {
  for (const url of BLOCKED) {
    const r = await api('POST', '/api/developer/webhooks', { token, body: { url, events: ['completion.created'] } });
    assert.equal(r.status, 400, `expected ${url} to be rejected, got ${r.status}: ${JSON.stringify(r.json)}`);
  }
});

test('registration accepts a public https URL', async () => {
  const r = await api('POST', '/api/developer/webhooks', { token, body: { url: 'https://example.com/hook', events: ['completion.created'] } });
  assert.equal(r.status, 201, `a public URL should be accepted: ${JSON.stringify(r.json)}`);
  assert.equal(r.json.url, 'https://example.com/hook');
});

test('update cannot swap a public URL for an internal one', async () => {
  const created = await api('POST', '/api/developer/webhooks', { token, body: { url: 'https://example.org/hook', events: [] } });
  assert.equal(created.status, 201);
  const swap = await api('PUT', `/api/developer/webhooks/${created.json.id}`, { token, body: { url: 'http://169.254.169.254/' } });
  assert.equal(swap.status, 400, `update to an internal URL must be rejected, got ${swap.status}`);
});

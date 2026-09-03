'use strict';
// ─── The app routes speak the plant's words for a role, not the database's ────
// 'developer', 'manager', 'supervisor' are a permission level and a CHECK
// constraint. They are not job titles — one of them is a word no plant has ever
// used for a person — and src/roles.js exists so exactly one name is printed for
// each. `requireRole` already routes its refusal through it ("Requires Owner
// role or higher"); routes/apps.js wrote its own three by hand and shipped the
// stored token straight to the screen.
//
// Uses Node built-ins only (node:test + global fetch).
// Run with: node --test test/app-role-words.test.js

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const PORT = 3419; // reserved for this workstream in MIGRATIONS.md — a shared port silently cancels a suite
const BASE = `http://localhost:${PORT}`;
const DB_PATH = path.join(os.tmpdir(), `mes-app-role-words-${Date.now()}.db`);

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
        EARLY_ACCESS: 'true',
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

async function create(token, pathname, body) {
  const r = await api('POST', pathname, { token, body });
  assert.ok(r.status === 200 || r.status === 201, `POST ${pathname} → ${r.status} ${JSON.stringify(r.json)}`);
  return r.json;
}

/** Every stored role value, as the database spells it. */
const STORED_ROLES = /\b(developer|manager|supervisor|operator|viewer)\b/;

/** A message on its way to a person carries no stored role token. */
function assertNoStoredRole(message, why) {
  assert.equal(typeof message, 'string', `${why}: there should be a message at all`);
  const hit = message.match(STORED_ROLES);
  assert.equal(hit, null,
    `${why}: "${message}" prints the stored role "${hit && hit[0]}" — roles reach a person through roles.js displayRole()`);
}

before(async () => { await startServer(); });
after(() => {
  if (server) server.kill('SIGTERM');
  for (const ext of ['', '-shm', '-wal']) {
    try { fs.unlinkSync(DB_PATH + ext); } catch { /* ignore */ }
  }
});

describe('app routes name a role the way a plant does', () => {
  const T = {};

  async function tokenFor(email, password) {
    const r = await api('POST', '/api/auth/login', { body: { email, password } });
    assert.equal(r.status, 200, `login ${email} → ${r.status} ${JSON.stringify(r.json)}`);
    return r.json.token;
  }

  before(async () => {
    const signup = await api('POST', '/api/auth/signup', {
      body: { company_name: 'Words Co', email: 'owner@wordsco.test', password: 'SecretPass1', display_name: 'Owner' },
    });
    assert.equal(signup.status, 201);
    T.owner = signup.json.token;

    T.app = await create(T.owner, '/api/apps', { name: 'Weld Check', status: 'published' });

    for (const [role, email] of [['operator', 'op@wordsco.test'], ['supervisor', 'sup@wordsco.test']]) {
      const u = await create(T.owner, '/api/users', {
        email, display_name: `${role} person`, password: 'SecretPass1', role,
      });
      T[`${role}Id`] = u.id;
      T[role] = await tokenFor(email, 'SecretPass1');
    }
  });

  it('refuses an operator the builder draft without naming the stored role', async () => {
    const r = await api('GET', `/api/apps/${T.app.id}?draft=1`, { token: T.operator });
    assert.equal(r.status, 403);
    assertNoStoredRole(r.json.error, 'the draft refusal');
    assert.equal(r.json.error, 'Requires Supervisor role or higher');
  });

  it('refuses a supervisor the approval switch without naming the stored role', async () => {
    // Whether an app needs a second signature is a manager's decision.
    const r = await api('PUT', `/api/apps/${T.app.id}`, {
      token: T.supervisor, body: { requires_approval: true },
    });
    assert.equal(r.status, 403);
    assertNoStoredRole(r.json.error, 'the approval-policy refusal');
    assert.equal(r.json.error, 'Requires Manager role or higher');
  });

  it('rejects too junior an approver without naming the stored role', async () => {
    const ok = await api('PUT', `/api/apps/${T.app.id}`, {
      token: T.owner, body: { requires_approval: true },
    });
    assert.equal(ok.status, 200, `turning approval on failed: ${JSON.stringify(ok.json)}`);

    const r = await api('POST', `/api/apps/${T.app.id}/publish`, {
      token: T.owner, body: { change_note: 'Tightened the torque check', approved_by_user_id: T.operatorId },
    });
    assert.equal(r.status, 400, JSON.stringify(r.json));
    assertNoStoredRole(r.json.error, 'the approver refusal');
    assert.equal(r.json.error, 'An approver must be a Supervisor or above');
  });
});

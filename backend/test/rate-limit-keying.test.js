// ─── Rate-limit keying ────────────────────────────────────────────────────────
// A factory leaves the building through one NAT gateway, so an IP-keyed budget
// for /api is a budget for the whole site: the first few people to open a
// dashboard spend it for everyone else, and the next operator to start a job
// gets a 429 on POST /api/completions. These tests pin down the rule that
// replaced it — a signed-in request is counted against the person, an anonymous
// one against the IP — and, just as importantly, that nothing a caller is free
// to make up (a bearer token, an X-Forwarded-For hop) can mint a fresh bucket.
//
// The ceilings are set tiny through the env overrides so the limits can be
// reached in a few dozen requests instead of a few thousand.

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const PORT = 3251;   // unique per test file — every other suite's port is taken
const BASE = `http://localhost:${PORT}`;
const DB_PATH = path.join(os.tmpdir(), `mes-ratelimit-${Date.now()}.db`);

const AUTHED_MAX = 25;
const ANON_MAX   = 60;

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
        EARLY_ACCESS: 'false',
        BACKUP_DIR: '',
        API_RATE_LIMIT_MAX: String(AUTHED_MAX),
        API_RATE_LIMIT_ANON_MAX: String(ANON_MAX),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    server.stderr.on('data', d => process.stderr.write(`[server] ${d}`));
    const deadline = Date.now() + 15000;
    (async function poll() {
      try {
        const r = await fetch(`${BASE}/api/health`);   // /api/health is mounted above the limiter
        if (r.ok) return resolve();
      } catch { /* not up yet */ }
      if (Date.now() > deadline) return reject(new Error('server did not start in time'));
      setTimeout(poll, 200);
    })();
  });
}

async function call(pathname, { token, headers = {}, method = 'GET', body } = {}) {
  const res = await fetch(`${BASE}${pathname}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  let json = null;
  try { json = await res.json(); } catch { /* no body */ }
  return {
    status: res.status,
    json,
    policy: res.headers.get('RateLimit-Policy'),
    remaining: Number(res.headers.get('RateLimit-Remaining')),
    retryAfter: res.headers.get('Retry-After'),
  };
}

const signup = (email, company) => call('/api/auth/signup', {
  method: 'POST',
  body: { company_name: company, email, password: 'supersecret1', display_name: company },
});

let tokenA = null;
let tokenB = null;

before(async () => {
  await startServer();
  const a = await signup('a@rate.test', 'Rate Co A');
  const b = await signup('b@rate.test', 'Rate Co B');
  assert.equal(a.status, 201);
  assert.equal(b.status, 201);
  tokenA = a.json.token;
  tokenB = b.json.token;
});

after(() => {
  if (server) server.kill('SIGTERM');
  for (const ext of ['', '-shm', '-wal']) { try { fs.unlinkSync(DB_PATH + ext); } catch { /* ignore */ } }
});

test('a session gets its own budget, and a bigger one than an anonymous caller', async () => {
  const authed = await call('/api/apps', { token: tokenA });
  assert.equal(authed.status, 200);
  assert.match(authed.policy, new RegExp(`^${AUTHED_MAX};`), 'signed-in ceiling is the authenticated one');

  const anon = await call('/api/apps');
  assert.equal(anon.status, 401, 'still unauthenticated as far as the route is concerned');
  assert.match(anon.policy, new RegExp(`^${ANON_MAX};`), 'anonymous ceiling is the IP one');
});

test('one user burning their budget does not touch another user on the same IP', async () => {
  // Both sessions come from the same source address — which is the whole point:
  // in a factory every tablet does.
  let last = null;
  for (let i = 0; i < AUTHED_MAX + 5; i++) last = await call('/api/apps', { token: tokenA });

  assert.equal(last.status, 429, 'the heavy user eventually hits their own ceiling');
  assert.equal(last.json.code, 'API_RATE_LIMITED');
  assert.ok(last.retryAfter, 'a rejected caller is told when to come back');

  const b = await call('/api/apps', { token: tokenB });
  assert.equal(b.status, 200, 'the second user is untouched by the first one');
  assert.ok(b.remaining > 0);
});

test('the credential throttle is counted per ACCOUNT, so one login cannot lock out a site', async () => {
  // Guessing a password is an attack on one account, and the ceiling that stops
  // it is counted per account. The old limiter counted per IP, which for a
  // customer is per FACTORY — twenty people signing in at 6am through one NAT
  // gateway, a couple of them mistyping, locked the plant out of its own MES for
  // fifteen minutes.
  let rejected = null;
  for (let i = 0; i < 30 && !rejected; i++) {
    const r = await call('/api/auth/login', {
      method: 'POST',
      body: { email: 'a@rate.test', password: 'wrong-password' },
    });
    if (r.status === 429) rejected = r;
  }
  assert.ok(rejected, 'repeated failed logins against one account are cut off');
  assert.equal(rejected.json.code, 'RATE_LIMITED', 'the credential limiter, not the general one');

  // Holding a valid session does not buy a way past it.
  const withSession = await call('/api/auth/login', {
    method: 'POST',
    token: tokenB,
    body: { email: 'a@rate.test', password: 'wrong-password' },
  });
  assert.equal(withSession.status, 429);
  assert.equal(withSession.json.code, 'RATE_LIMITED');

  // Nor does dressing the same address up differently — the account is the key,
  // not the spelling of the address.
  const cased = await call('/api/auth/login', {
    method: 'POST',
    body: { email: '  A@Rate.TEST ', password: 'wrong-password' },
  });
  assert.equal(cased.status, 429, 'a@rate.test and A@Rate.TEST are one account, not two budgets');

  // …and the colleague at the next bench, on the same IP, is untouched. This is
  // the failure the whole change exists to prevent: a locked-out account must
  // not be a locked-out site.
  const colleague = await call('/api/auth/login', {
    method: 'POST',
    body: { email: 'b@rate.test', password: 'wrong-password' },
  });
  assert.equal(colleague.status, 401,
    'a different account from the same address still gets to try');

  // And a correct password is not an "attempt" at anything, so a whole shift
  // signing in together never spends the budget at all.
  const real = await call('/api/auth/login', {
    method: 'POST',
    body: { email: 'b@rate.test', password: 'supersecret1' },
  });
  assert.equal(real.status, 200, 'the right password still works on a busy morning');
});

test('nothing a caller can invent buys a fresh bucket', async () => {
  // Spend the anonymous budget for this IP.
  let exhausted = null;
  for (let i = 0; i < ANON_MAX + 10 && !exhausted; i++) {
    const r = await call('/api/apps');
    if (r.status === 429) exhausted = r;
  }
  assert.ok(exhausted, 'the anonymous ceiling is reached');
  assert.equal(exhausted.json.code, 'API_RATE_LIMITED');

  // A made-up bearer token resolves to no session, so it falls back to the IP
  // bucket rather than opening a new one. A fresh random token every time would
  // otherwise be unlimited requests for free.
  for (const token of ['deadbeef', 'not-a-real-token', 'a'.repeat(64)]) {
    const forged = await call('/api/apps', { token });
    assert.equal(forged.status, 429, `invented token ${token.slice(0, 12)} got its own budget`);
    assert.equal(forged.json.code, 'API_RATE_LIMITED');
  }

  // Nor does claiming to be a different client through the proxy header. With
  // no reverse proxy in front (TRUST_PROXY defaults to 0 outside production)
  // X-Forwarded-For is exactly the kind of thing a caller makes up.
  const spoofed = await call('/api/apps', { headers: { 'X-Forwarded-For': '203.0.113.7' } });
  assert.equal(spoofed.status, 429);

  // Meanwhile a real session on that same exhausted IP keeps working — which is
  // the failure this whole change exists to prevent.
  const b = await call('/api/apps', { token: tokenB });
  assert.equal(b.status, 200);
});

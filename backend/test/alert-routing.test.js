// ─── Alert routing (M6 extension): who actually gets pinged ──────────────────
// Department membership turns "Quality was alerted" into "Priya was alerted".
// This suite spawns the real server and exercises:
//   • membership CRUD + role gating (operators cannot edit the roster),
//   • the routing cascade: the alert's DEPARTMENT first, then anyone with that
//     role COMPANY-WIDE, then the company's alert email so nothing is dropped,
//   • notify_email / notify_in_app honoured independently per person,
//   • one targeted `messages` row per in-app recipient (that IS the in-app
//     ping — it toasts and badges through the existing MessagesContext),
//   • de-duplication when one person matches on two memberships,
//   • tenant isolation on membership AND on routing (company B's quality team
//     never hears company A's alerts).
// Run with: npm test — Node built-ins only.

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Database = require('better-sqlite3');

const PORT = 3182; // unique per test file — 3183 and 3185-3199 are taken
const BASE = `http://localhost:${PORT}`;
const DB_PATH = path.join(os.tmpdir(), `mes-alert-routing-test-${Date.now()}.db`);

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
        // Email must stay in demo mode: no key, no SMTP, nothing leaves the box.
        RESEND_API_KEY: '',
        SMTP_HOST: '',
        SMTP_USER: '',
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

// The in-app ping is a targeted `messages` row; read them straight from the DB
// (the API only ever shows the CURRENT user their own).
function messagesFor(userId) {
  const conn = new Database(DB_PATH, { readonly: true });
  try {
    return conn.prepare('SELECT * FROM messages WHERE recipient_id = ? ORDER BY created_at').all(userId);
  } finally {
    conn.close();
  }
}

function emailLogFor(recipient) {
  const conn = new Database(DB_PATH, { readonly: true });
  try {
    return conn.prepare("SELECT * FROM notification_log WHERE recipient = ? AND event = 'andon.alert'").all(recipient);
  } finally {
    conn.close();
  }
}

let tokenA, tokenB, operatorTokenA;
let assemblyId, packagingId, stationId;
let priya, bob, sam, mara;      // company A people
let foreignQualityUserId;       // company B quality person

before(async () => {
  await startServer();

  const a = await api('POST', '/api/auth/signup', {
    body: { company_name: 'Widget Co', email: 'owner@widget-ar.test', password: 'supersecret1', display_name: 'Wanda Owner' },
  });
  assert.equal(a.status, 201);
  tokenA = a.json.token;

  const b = await api('POST', '/api/auth/signup', {
    body: { company_name: 'Gadget Co', email: 'owner@gadget-ar.test', password: 'supersecret1', display_name: 'Gary Owner' },
  });
  assert.equal(b.status, 201);
  tokenB = b.json.token;

  const mkUser = async (token, email, name, role) => {
    const r = await api('POST', '/api/users', { token, body: { email, display_name: name, password: 'supersecret1', role } });
    assert.equal(r.status, 201, `created ${name}`);
    return r.json.id;
  };

  priya = await mkUser(tokenA, 'priya@widget-ar.test', 'Priya Shah', 'supervisor');       // Assembly quality
  bob   = await mkUser(tokenA, 'bob@widget-ar.test', 'Bob Reyes', 'operator');            // Assembly maintenance
  sam   = await mkUser(tokenA, 'sam@widget-ar.test', 'Sam Cole', 'supervisor');           // company-wide materials
  mara  = await mkUser(tokenA, 'mara@widget-ar.test', 'Mara Lin', 'operator');            // on two departments
  foreignQualityUserId = await mkUser(tokenB, 'q@gadget-ar.test', 'Their Quality', 'supervisor');

  const login = await api('POST', '/api/auth/login', { body: { email: 'bob@widget-ar.test', password: 'supersecret1' } });
  assert.equal(login.status, 200);
  operatorTokenA = login.json.token;

  const assembly = await api('POST', '/api/departments', { token: tokenA, body: { name: 'Assembly' } });
  assert.equal(assembly.status, 201);
  assemblyId = assembly.json.id;

  const packaging = await api('POST', '/api/departments', { token: tokenA, body: { name: 'Packaging' } });
  assert.equal(packaging.status, 201);
  packagingId = packaging.json.id;

  const station = await api('POST', '/api/stations', { token: tokenA, body: { name: 'Station 3', department_id: assemblyId } });
  assert.equal(station.status, 201);
  stationId = station.json.id;
});

after(() => {
  if (server) server.kill('SIGTERM');
  for (const ext of ['', '-shm', '-wal']) { try { fs.unlinkSync(DB_PATH + ext); } catch { /* ignore */ } }
});

// ─── Membership CRUD + gating ────────────────────────────────────────────────

test('membership CRUD is supervisor-gated and tenant-scoped', async () => {
  // Operators can read the roster but not change it.
  assert.equal((await api('GET', `/api/departments/${assemblyId}/members`, { token: operatorTokenA })).status, 200);
  const denied = await api('POST', `/api/departments/${assemblyId}/members`, {
    token: operatorTokenA, body: { user_id: priya, team_role: 'quality' },
  });
  assert.equal(denied.status, 403, 'an operator cannot edit the roster');

  const added = await api('POST', `/api/departments/${assemblyId}/members`, {
    token: tokenA, body: { user_id: priya, team_role: 'quality' },
  });
  assert.equal(added.status, 201);
  assert.equal(added.json.display_name, 'Priya Shah');
  assert.equal(added.json.email, 'priya@widget-ar.test');
  assert.equal(added.json.team_role, 'quality');
  assert.equal(added.json.notify_email, true, 'both channels default on');
  assert.equal(added.json.notify_in_app, true);

  // The same person twice on one department is a conflict, not a duplicate row.
  const dup = await api('POST', `/api/departments/${assemblyId}/members`, {
    token: tokenA, body: { user_id: priya, team_role: 'lead' },
  });
  assert.equal(dup.status, 409);

  // Unknown roles are rejected rather than silently stored.
  const badRole = await api('POST', `/api/departments/${assemblyId}/members`, {
    token: tokenA, body: { user_id: bob, team_role: 'wizard' },
  });
  assert.equal(badRole.status, 400);

  // A person from another company cannot join this company's department.
  const foreign = await api('POST', `/api/departments/${assemblyId}/members`, {
    token: tokenA, body: { user_id: foreignQualityUserId, team_role: 'quality' },
  });
  assert.equal(foreign.status, 400, 'cross-tenant membership refused');

  // Update: role + preferences.
  const updated = await api('PUT', `/api/departments/members/${added.json.id}`, {
    token: tokenA, body: { notify_in_app: false },
  });
  assert.equal(updated.status, 200);
  assert.equal(updated.json.notify_in_app, false);
  assert.equal(updated.json.notify_email, true, 'the other channel is untouched');
  assert.equal(updated.json.team_role, 'quality');

  // Put it back and add the rest of the roster.
  await api('PUT', `/api/departments/members/${added.json.id}`, { token: tokenA, body: { notify_in_app: true } });
  assert.equal((await api('POST', `/api/departments/${assemblyId}/members`, {
    token: tokenA, body: { user_id: bob, team_role: 'maintenance' },
  })).status, 201);

  const roster = await api('GET', `/api/departments/${assemblyId}/members`, { token: tokenA });
  assert.equal(roster.json.length, 2);

  // Company B cannot see or touch it.
  assert.equal((await api('GET', `/api/departments/${assemblyId}/members`, { token: tokenB })).status, 404);
  assert.equal((await api('PUT', `/api/departments/members/${added.json.id}`, {
    token: tokenB, body: { team_role: 'lead' },
  })).status, 404);
  assert.equal((await api('DELETE', `/api/departments/members/${added.json.id}`, { token: tokenB })).status, 404);
});

test('company-wide lookup finds everyone holding a role', async () => {
  // Sam covers materials for the whole shop, from Packaging.
  assert.equal((await api('POST', `/api/departments/${packagingId}/members`, {
    token: tokenA, body: { user_id: sam, team_role: 'materials' },
  })).status, 201);

  const quality = await api('GET', '/api/departments/members?team_role=quality', { token: tokenA });
  assert.equal(quality.status, 200);
  assert.deepEqual(quality.json.map(m => m.display_name), ['Priya Shah']);
  assert.equal(quality.json[0].department_name, 'Assembly');

  const materials = await api('GET', '/api/departments/members?team_role=materials', { token: tokenA });
  assert.deepEqual(materials.json.map(m => m.display_name), ['Sam Cole']);

  // Company B's roster is its own — and empty.
  assert.equal((await api('GET', '/api/departments/members?team_role=quality', { token: tokenB })).json.length, 0);
});

// ─── The routing cascade ─────────────────────────────────────────────────────

test('an alert routes to the department first, and pings each person', async () => {
  const before = messagesFor(priya).length;
  const raised = await api('POST', '/api/andon', {
    token: tokenA,
    body: { team: 'quality', station_id: stationId, department_id: assemblyId, note: 'Torque out of spec', operator_name: 'Ana Operator' },
  });
  assert.equal(raised.status, 201);
  assert.equal(raised.json.notify_scope, 'department', 'the department roster wins');
  assert.deepEqual(raised.json.notified.map(n => n.display_name), ['Priya Shah']);
  assert.deepEqual(raised.json.notified.map(n => n.team_role), ['quality']);

  // In-app: exactly one targeted message for exactly that person.
  const mine = messagesFor(priya);
  assert.equal(mine.length, before + 1, 'one in-app ping');
  const ping = mine[mine.length - 1];
  assert.equal(ping.sender_name, 'Quality needed');
  assert.equal(ping.sender_role, 'system');
  assert.equal(ping.severity, 'info', 'normal priority maps to info');
  assert.match(ping.body, /Quality needed at Station 3/);
  assert.match(ping.body, /Torque out of spec/);
  // The place is named once, not twice — the title already carries it.
  assert.equal((ping.body.match(/Station 3/g) || []).length, 1);

  // Nobody else on the department was pinged — Bob is maintenance, not quality.
  assert.equal(messagesFor(bob).length, 0);

  // Email: logged for the person, with who-is-needed in the subject.
  const logged = emailLogFor('priya@widget-ar.test');
  assert.equal(logged.length, 1);
  assert.match(logged[0].subject, /^Quality alerted — /);
  assert.match(logged[0].body, /Torque out of spec/);
});

test('a critical alert raises the in-app severity', async () => {
  const before = messagesFor(bob).length;
  const raised = await api('POST', '/api/andon', {
    token: tokenA,
    body: { team: 'maintenance', station_id: stationId, department_id: assemblyId, priority: 'critical', note: 'Belt snapped' },
  });
  assert.equal(raised.status, 201);
  assert.deepEqual(raised.json.notified.map(n => n.display_name), ['Bob Reyes']);
  const pings = messagesFor(bob);
  assert.equal(pings.length, before + 1);
  assert.equal(pings[pings.length - 1].severity, 'urgent', 'critical → urgent');
});

test('with nobody on the department, routing widens to the whole company', async () => {
  const before = messagesFor(sam).length;
  // Materials, raised from Assembly — where no materials person sits.
  const raised = await api('POST', '/api/andon', {
    token: tokenA,
    body: { team: 'materials', station_id: stationId, department_id: assemblyId, note: 'Bin 4 empty' },
  });
  assert.equal(raised.status, 201);
  assert.equal(raised.json.notify_scope, 'company', 'falls back company-wide');
  assert.deepEqual(raised.json.notified.map(n => n.display_name), ['Sam Cole']);
  assert.equal(messagesFor(sam).length, before + 1);
});

test('with nobody anywhere, the company alert email still hears about it', async () => {
  // Supervisor: nobody holds that role in this company at all.
  let raised = await api('POST', '/api/andon', { token: tokenA, body: { team: 'supervisor', note: 'Need a decision' } });
  assert.equal(raised.status, 201);
  assert.equal(raised.json.notify_scope, 'none', 'no roster and no address configured');
  assert.deepEqual(raised.json.notified, []);

  // Configure the company alert address — the same alert now lands somewhere.
  const prefs = await api('PUT', '/api/notifications', {
    token: tokenA, body: { email_enabled: true, email_to: 'floor@widget-ar.test', events: [] },
  });
  assert.equal(prefs.status, 200);

  raised = await api('POST', '/api/andon', { token: tokenA, body: { team: 'supervisor', note: 'Need a decision' } });
  assert.equal(raised.status, 201);
  assert.equal(raised.json.notify_scope, 'fallback', 'never silently dropped');
  assert.deepEqual(raised.json.notified, [], 'the fallback is an address, not a person');
  assert.equal(emailLogFor('floor@widget-ar.test').length, 1);
});

// ─── Preferences and de-duplication ──────────────────────────────────────────

test('notify_email and notify_in_app are honoured independently', async () => {
  const roster = await api('GET', `/api/departments/${assemblyId}/members`, { token: tokenA });
  const priyaMember = roster.json.find(m => m.user_id === priya);

  // Email only.
  await api('PUT', `/api/departments/members/${priyaMember.id}`, { token: tokenA, body: { notify_in_app: false } });
  let inApp = messagesFor(priya).length;
  let emails = emailLogFor('priya@widget-ar.test').length;
  assert.equal((await api('POST', '/api/andon', {
    token: tokenA, body: { team: 'quality', department_id: assemblyId, note: 'email only' },
  })).status, 201);
  assert.equal(messagesFor(priya).length, inApp, 'in-app suppressed');
  assert.equal(emailLogFor('priya@widget-ar.test').length, emails + 1, 'email still sent');

  // In-app only.
  await api('PUT', `/api/departments/members/${priyaMember.id}`, {
    token: tokenA, body: { notify_in_app: true, notify_email: false },
  });
  inApp = messagesFor(priya).length;
  emails = emailLogFor('priya@widget-ar.test').length;
  assert.equal((await api('POST', '/api/andon', {
    token: tokenA, body: { team: 'quality', department_id: assemblyId, note: 'in-app only' },
  })).status, 201);
  assert.equal(messagesFor(priya).length, inApp + 1, 'in-app sent');
  assert.equal(emailLogFor('priya@widget-ar.test').length, emails, 'email suppressed');

  // Both off: still routed to (so the cascade stops here) but silent for them.
  await api('PUT', `/api/departments/members/${priyaMember.id}`, {
    token: tokenA, body: { notify_in_app: false, notify_email: false },
  });
  inApp = messagesFor(priya).length;
  emails = emailLogFor('priya@widget-ar.test').length;
  assert.equal((await api('POST', '/api/andon', {
    token: tokenA, body: { team: 'quality', department_id: assemblyId, note: 'silent' },
  })).status, 201);
  assert.equal(messagesFor(priya).length, inApp);
  assert.equal(emailLogFor('priya@widget-ar.test').length, emails);

  // Restore.
  await api('PUT', `/api/departments/members/${priyaMember.id}`, {
    token: tokenA, body: { notify_in_app: true, notify_email: true },
  });
});

test('someone on two departments is pinged once, not twice', async () => {
  // Mara is the materials person on BOTH Assembly and Packaging.
  for (const deptId of [assemblyId, packagingId]) {
    assert.equal((await api('POST', `/api/departments/${deptId}/members`, {
      token: tokenA, body: { user_id: mara, team_role: 'lead' },
    })).status, 201);
  }
  // A department alert pulls the matching role AND the leads — Mara is a lead on
  // Assembly, so she must appear exactly once even though she is a lead twice.
  const before = messagesFor(mara).length;
  const raised = await api('POST', '/api/andon', {
    token: tokenA,
    body: { target_type: 'department', department_id: assemblyId, team: 'quality', note: 'need a hand' },
  });
  assert.equal(raised.status, 201);
  assert.equal(raised.json.target_label, 'Assembly');
  const names = raised.json.notified.map(n => n.display_name);
  assert.equal(names.filter(n => n === 'Mara Lin').length, 1, 'de-duplicated');
  assert.ok(names.includes('Priya Shah'), 'the department quality person is included too');
  assert.equal(messagesFor(mara).length, before + 1, 'exactly one in-app ping');
});

// ─── Tenant isolation on routing ─────────────────────────────────────────────

test("company B's team never receives company A's alerts", async () => {
  // Give company B a quality person on its own department.
  const theirDept = await api('POST', '/api/departments', { token: tokenB, body: { name: 'Their Line' } });
  assert.equal(theirDept.status, 201);
  assert.equal((await api('POST', `/api/departments/${theirDept.json.id}/members`, {
    token: tokenB, body: { user_id: foreignQualityUserId, team_role: 'quality' },
  })).status, 201);

  const before = messagesFor(foreignQualityUserId).length;
  const beforeEmails = emailLogFor('q@gadget-ar.test').length;

  const raised = await api('POST', '/api/andon', {
    token: tokenA, body: { team: 'quality', department_id: assemblyId, note: 'ours only' },
  });
  assert.equal(raised.status, 201);
  assert.ok(!raised.json.notified.some(n => n.user_id === foreignQualityUserId));
  assert.equal(messagesFor(foreignQualityUserId).length, before, 'no in-app ping across tenants');
  assert.equal(emailLogFor('q@gadget-ar.test').length, beforeEmails, 'no email across tenants');

  // And the reverse: company B's alert reaches only its own person.
  const theirs = await api('POST', '/api/andon', {
    token: tokenB, body: { team: 'quality', department_id: theirDept.json.id, note: 'theirs only' },
  });
  assert.equal(theirs.status, 201);
  assert.deepEqual(theirs.json.notified.map(n => n.display_name), ['Their Quality']);
  assert.equal(messagesFor(foreignQualityUserId).length, before + 1);
});

test('removing someone from a department stops their alerts', async () => {
  const roster = await api('GET', `/api/departments/${assemblyId}/members`, { token: tokenA });
  const priyaMember = roster.json.find(m => m.user_id === priya);
  assert.equal((await api('DELETE', `/api/departments/members/${priyaMember.id}`, { token: tokenA })).status, 200);

  const before = messagesFor(priya).length;
  const raised = await api('POST', '/api/andon', {
    token: tokenA, body: { team: 'quality', department_id: assemblyId, note: 'after removal' },
  });
  assert.equal(raised.status, 201);
  assert.ok(!raised.json.notified.some(n => n.user_id === priya), 'no longer on the quality rota');
  assert.equal(messagesFor(priya).length, before, 'and no longer pinged');
});

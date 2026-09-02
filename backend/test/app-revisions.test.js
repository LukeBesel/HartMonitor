'use strict';
// ─── A published app is a numbered revision ──────────────────────────────────
// The hole this suite closes: publishing was `UPDATE apps SET
// status='published'`, so editing a published app silently changed what every
// historical run had been measured against, and nothing recorded which
// instructions an operator actually saw. HartMonitor ships a demo CAPA about an
// SOP revised without change control — the engine had the same defect.
//
// What must hold, and is pinned here:
//   1. Publishing twice cuts revisions 1 and 2, and revision 1's snapshot stays
//      BYTE-IDENTICAL to what was published first.
//   2. A run started between the two publishes carries revision 1's id, and
//      re-publishing does not move it.
//   3. Editing a published app leaves the latest revision row byte-identical.
//   4. A change note is mandatory; on an approval app an approver is mandatory
//      and cannot be the publisher.
//   5. Revisions are tenant-isolated, and a client cannot choose the revision
//      its run is stamped with.
//
// Uses Node built-ins only (node:test + global fetch). Run with:
//   node --test test/app-revisions.test.js

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const PORT = 3410; // reserved: app-revisions-and-approval (MIGRATIONS.md)
const BASE = `http://localhost:${PORT}`;
const DB_PATH = path.join(os.tmpdir(), `mes-app-revisions-${Date.now()}.db`);

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

/** Two steps with stable ids — a rename has to read as a rename, not as an add
 *  plus a remove, which is only possible because the builder keeps step ids. */
function stepsV1() {
  return [
    { id: 'step-a', name: 'Torque the bracket', order: 0, widgets: [
      { id: 'w-a', type: 'number-input', label: 'Torque (Nm)', config: { variableName: 'torque' } },
    ] },
    { id: 'step-b', name: 'Visual check', order: 1, widgets: [] },
  ];
}

let server_started = false;
before(async () => { await startServer(); server_started = true; });
after(() => {
  if (server) server.kill('SIGTERM');
  for (const ext of ['', '-shm', '-wal']) {
    try { fs.unlinkSync(DB_PATH + ext); } catch { /* ignore */ }
  }
});

describe('Publishing cuts an immutable numbered revision', () => {
  let token, userId, appId, rev1Snapshot, runBetween;

  before(async () => {
    assert.ok(server_started);
    const signup = await api('POST', '/api/auth/signup', {
      body: { company_name: 'Revision Co', email: 'admin@revision.test', password: 'SecretPass1', display_name: 'Dana Publisher' },
    });
    assert.equal(signup.status, 201, `signup: ${JSON.stringify(signup.json)}`);
    token = signup.json.token;
    userId = signup.json.user.id;

    const created = await api('POST', '/api/apps', { token, body: { name: 'Final QC Inspection' } });
    assert.equal(created.status, 201, JSON.stringify(created.json));
    appId = created.json.id;

    const saved = await api('PUT', `/api/apps/${appId}`, {
      token, body: { steps: stepsV1(), schema_version: 2, variables: [], step_groups: [] },
    });
    assert.equal(saved.status, 200, JSON.stringify(saved.json));
  });

  it('refuses to publish without a change note', async () => {
    const bare = await api('POST', `/api/apps/${appId}/publish`, { token });
    assert.equal(bare.status, 400, `expected 400, got ${bare.status}: ${JSON.stringify(bare.json)}`);
    assert.equal(bare.json.error, 'A change note is required');

    const blank = await api('POST', `/api/apps/${appId}/publish`, { token, body: { change_note: '   ' } });
    assert.equal(blank.status, 400, 'whitespace is not a change note');
    assert.equal(blank.json.error, 'A change note is required');

    const app = await api('GET', `/api/apps/${appId}`, { token });
    assert.equal(app.json.current_revision, 0, 'a refused publish must not cut a revision');
  });

  it('cuts revision 1 with the note, the publisher and the definition', async () => {
    const pub = await api('POST', `/api/apps/${appId}/publish`, {
      token, body: { change_note: 'added torque check' },
    });
    assert.equal(pub.status, 200, JSON.stringify(pub.json));
    assert.equal(pub.json.revision, 1);
    assert.equal(pub.json.diff, null, 'the first publish has nothing to diff against');
    assert.equal(pub.json.status, 'published');

    const list = await api('GET', `/api/apps/${appId}/revisions`, { token });
    assert.equal(list.status, 200);
    assert.equal(list.json.current_revision, 1);
    assert.equal(list.json.revisions.length, 1);
    assert.equal(list.json.revisions[0].change_note, 'added torque check');
    assert.equal(list.json.revisions[0].published_by_name, 'Dana Publisher');
    assert.equal(list.json.revisions[0].run_count, 0);

    const snap = await api('GET', `/api/apps/${appId}/revisions/1`, { token });
    assert.equal(snap.status, 200);
    assert.deepEqual(snap.json.steps, stepsV1(), 'the snapshot is what was published');
    rev1Snapshot = JSON.stringify(snap.json.steps);
  });

  it('stamps a run with the revision that was live when it started', async () => {
    const run = await api('POST', '/api/completions', {
      token, body: { app_id: appId, operator_name: 'Ada' },
    });
    assert.equal(run.status, 201, JSON.stringify(run.json));
    runBetween = run.json.id;

    const detail = await api('GET', `/api/completions/${runBetween}`, { token });
    assert.equal(detail.status, 200);
    assert.ok(detail.json.app_revision_id, 'the run must carry a revision id');
    assert.equal(detail.json.app_revision.revision, 1);
    assert.equal(detail.json.app_revision.published_by_name, 'Dana Publisher');
  });

  it('ignores a client-supplied app_revision_id on run start', async () => {
    // A client that names its own revision could claim a run followed
    // instructions it never saw. The server decides, always.
    const forged = await api('POST', '/api/completions', {
      token, body: { app_id: appId, operator_name: 'Mallory', app_revision_id: 'forged-revision-id' },
    });
    assert.equal(forged.status, 201, JSON.stringify(forged.json));
    const detail = await api('GET', `/api/completions/${forged.json.id}`, { token });
    assert.notEqual(detail.json.app_revision_id, 'forged-revision-id');
    assert.equal(detail.json.app_revision.revision, 1, 'the server stamps the live revision');
  });

  it('leaves the published revision byte-identical when the app is edited', async () => {
    const edited = stepsV1();
    edited[0].name = 'Torque the bracket to 14 Nm';
    const saved = await api('PUT', `/api/apps/${appId}`, { token, body: { steps: edited } });
    assert.equal(saved.status, 200, JSON.stringify(saved.json));
    assert.equal(saved.json.current_revision, 1, 'editing does not publish');
    assert.equal(saved.json.has_unpublished_changes, true, 'the draft has drifted from Rev 1');

    const snap = await api('GET', `/api/apps/${appId}/revisions/1`, { token });
    assert.equal(JSON.stringify(snap.json.steps), rev1Snapshot,
      'editing a published app must not touch the revision it was published as');

    const run = await api('GET', `/api/completions/${runBetween}`, { token });
    assert.equal(run.json.app_revision.revision, 1, 'a past run still points at Rev 1');
  });

  it('cuts revision 2 on the next publish, and says what changed', async () => {
    const pub = await api('POST', `/api/apps/${appId}/publish`, {
      token, body: { change_note: 'spelled out the torque value' },
    });
    assert.equal(pub.status, 200, JSON.stringify(pub.json));
    assert.equal(pub.json.revision, 2);
    assert.deepEqual(pub.json.diff.renamed, [
      { from: 'Torque the bracket', to: 'Torque the bracket to 14 Nm' },
    ]);
    assert.deepEqual(pub.json.diff.added, []);
    assert.deepEqual(pub.json.diff.removed, []);
    assert.equal(pub.json.has_unpublished_changes, false);
  });

  it('does not move a run that already ran, and keeps Rev 1 intact', async () => {
    const run = await api('GET', `/api/completions/${runBetween}`, { token });
    assert.equal(run.json.app_revision.revision, 1,
      're-publishing must never re-measure a finished run against new instructions');

    const snap = await api('GET', `/api/apps/${appId}/revisions/1`, { token });
    assert.equal(JSON.stringify(snap.json.steps), rev1Snapshot, 'Rev 1 is frozen forever');

    const list = await api('GET', `/api/apps/${appId}/revisions`, { token });
    assert.equal(list.json.revisions.length, 2);
    assert.deepEqual(list.json.revisions.map(r => r.revision), [2, 1], 'newest first');
    assert.equal(list.json.revisions.find(r => r.revision === 1).run_count, 2,
      'Rev 1 measured the two runs started while it was live');
  });

  it('stamps the new revision on runs started after it', async () => {
    const run = await api('POST', '/api/completions', { token, body: { app_id: appId, operator_name: 'Ada' } });
    const detail = await api('GET', `/api/completions/${run.json.id}`, { token });
    assert.equal(detail.json.app_revision.revision, 2);
  });

  it('adds a step and reports it as added', async () => {
    const steps = stepsV1();
    steps[0].name = 'Torque the bracket to 14 Nm';
    steps.push({ id: 'step-c', name: 'Torque audit', order: 2, widgets: [] });
    await api('PUT', `/api/apps/${appId}`, { token, body: { steps } });
    const pub = await api('POST', `/api/apps/${appId}/publish`, { token, body: { change_note: 'added the audit step' } });
    assert.equal(pub.json.revision, 3);
    assert.deepEqual(pub.json.diff.added, ['Torque audit']);
    assert.deepEqual(pub.json.diff.renamed, []);
  });
});

describe('An app that requires approval needs a second pair of hands', () => {
  let token, publisherId, approverId, appId;

  before(async () => {
    const signup = await api('POST', '/api/auth/signup', {
      body: { company_name: 'Approval Co', email: 'boss@approval.test', password: 'SecretPass1', display_name: 'Boss' },
    });
    assert.equal(signup.status, 201, JSON.stringify(signup.json));
    token = signup.json.token;
    publisherId = signup.json.user.id;

    const approver = await api('POST', '/api/users', {
      token,
      body: { email: 'quality@approval.test', display_name: 'Quality Lead', password: 'SecretPass1', role: 'manager' },
    });
    assert.equal(approver.status, 201, JSON.stringify(approver.json));
    approverId = approver.json.id;

    const created = await api('POST', '/api/apps', { token, body: { name: 'Controlled SOP' } });
    appId = created.json.id;
    const on = await api('PUT', `/api/apps/${appId}`, { token, body: { requires_approval: true, steps: stepsV1() } });
    assert.equal(on.status, 200, JSON.stringify(on.json));
    assert.equal(on.json.requires_approval, 1, 'the toggle must actually store');
  });

  it('refuses to publish with no approver named', async () => {
    const pub = await api('POST', `/api/apps/${appId}/publish`, { token, body: { change_note: 'first issue' } });
    assert.equal(pub.status, 400, JSON.stringify(pub.json));
    assert.equal(pub.json.code, 'APPROVER_REQUIRED');
  });

  it('refuses to let the publisher approve their own work, and says why', async () => {
    const pub = await api('POST', `/api/apps/${appId}/publish`, {
      token, body: { change_note: 'first issue', approved_by_user_id: publisherId },
    });
    assert.equal(pub.status, 400, JSON.stringify(pub.json));
    assert.match(pub.json.error, /an approver must be someone other than the author/);
  });

  it('publishes with a named approver from the same company', async () => {
    const pub = await api('POST', `/api/apps/${appId}/publish`, {
      token, body: { change_note: 'first issue', approved_by_user_id: approverId },
    });
    assert.equal(pub.status, 200, JSON.stringify(pub.json));
    assert.equal(pub.json.revision, 1);
    const list = await api('GET', `/api/apps/${appId}/revisions`, { token });
    assert.equal(list.json.revisions[0].approved_by_name, 'Quality Lead');
    assert.equal(list.json.revisions[0].published_by_name, 'Boss');
  });

  it('keeps requiring approval on the next publish', async () => {
    const pub = await api('POST', `/api/apps/${appId}/publish`, { token, body: { change_note: 'second issue' } });
    assert.equal(pub.status, 400);
    assert.equal(pub.json.code, 'APPROVER_REQUIRED');
  });
});

describe('Revisions are one company\'s business only', () => {
  let tokenA, appA, approverA, tokenB, appB;

  before(async () => {
    const a = await api('POST', '/api/auth/signup', {
      body: { company_name: 'Tenant A', email: 'a@tenants.test', password: 'SecretPass1', display_name: 'Alice' },
    });
    assert.equal(a.status, 201, JSON.stringify(a.json));
    tokenA = a.json.token;
    const aUser = await api('POST', '/api/users', {
      token: tokenA, body: { email: 'a2@tenants.test', display_name: 'Alice Two', password: 'SecretPass1', role: 'manager' },
    });
    approverA = aUser.json.id;

    const b = await api('POST', '/api/auth/signup', {
      body: { company_name: 'Tenant B', email: 'b@tenants.test', password: 'SecretPass1', display_name: 'Bob' },
    });
    assert.equal(b.status, 201, JSON.stringify(b.json));
    tokenB = b.json.token;

    appA = (await api('POST', '/api/apps', { token: tokenA, body: { name: 'A Instructions' } })).json.id;
    await api('PUT', `/api/apps/${appA}`, { token: tokenA, body: { steps: stepsV1() } });
    const pub = await api('POST', `/api/apps/${appA}/publish`, { token: tokenA, body: { change_note: 'A rev 1' } });
    assert.equal(pub.status, 200, JSON.stringify(pub.json));

    appB = (await api('POST', '/api/apps', { token: tokenB, body: { name: 'B Instructions' } })).json.id;
    await api('PUT', `/api/apps/${appB}`, { token: tokenB, body: { requires_approval: true, steps: stepsV1() } });
  });

  it('hides one company\'s revision list and snapshots from another', async () => {
    const list = await api('GET', `/api/apps/${appA}/revisions`, { token: tokenB });
    assert.equal(list.status, 404, `company B read A's revision list: ${JSON.stringify(list.json)}`);
    const snap = await api('GET', `/api/apps/${appA}/revisions/1`, { token: tokenB });
    assert.equal(snap.status, 404, `company B read A's snapshot: ${JSON.stringify(snap.json)}`);
  });

  it('refuses another company\'s user as an approver', async () => {
    const pub = await api('POST', `/api/apps/${appB}/publish`, {
      token: tokenB, body: { change_note: 'B rev 1', approved_by_user_id: approverA },
    });
    assert.equal(pub.status, 400, `A's user signed off B's app: ${JSON.stringify(pub.json)}`);
    assert.equal(pub.json.code, 'APPROVER_NOT_FOUND');
    const list = await api('GET', `/api/apps/${appB}/revisions`, { token: tokenB });
    assert.equal(list.json.revisions.length, 0, 'the refused publish cut nothing');
  });

  it('refuses to publish an app that belongs to another company', async () => {
    const pub = await api('POST', `/api/apps/${appA}/publish`, { token: tokenB, body: { change_note: 'not yours' } });
    assert.equal(pub.status, 404);
  });
});

describe('An app with runs but no revision starts at Rev 1, and nothing is backdated', () => {
  let token, appId, oldRun;

  before(async () => {
    const signup = await api('POST', '/api/auth/signup', {
      body: { company_name: 'Upgrade Co', email: 'admin@upgrade.test', password: 'SecretPass1', display_name: 'Existing Customer' },
    });
    token = signup.json.token;
    appId = (await api('POST', '/api/apps', { token, body: { name: 'Legacy App' } })).json.id;
    await api('PUT', `/api/apps/${appId}`, { token, body: { steps: stepsV1(), status: 'published' } });
    // A run from before change control existed: no revision was live.
    oldRun = (await api('POST', '/api/completions', { token, body: { app_id: appId, operator_name: 'Ada' } })).json.id;
  });

  it('records no revision on a run that predates one', async () => {
    const detail = await api('GET', `/api/completions/${oldRun}`, { token });
    assert.equal(detail.json.app_revision_id, null);
    assert.equal(detail.json.app_revision, null,
      'a run nobody can attribute must say so, not be given a revision it never saw');
  });

  it('cuts revision 1 from what is published now, leaving the old run unattributed', async () => {
    const pub = await api('POST', `/api/apps/${appId}/publish`, { token, body: { change_note: 'brought under change control' } });
    assert.equal(pub.status, 200, JSON.stringify(pub.json));
    assert.equal(pub.json.revision, 1);

    const detail = await api('GET', `/api/completions/${oldRun}`, { token });
    assert.equal(detail.json.app_revision_id, null, 'history is never backdated onto a new revision');

    const list = await api('GET', `/api/apps/${appId}/revisions`, { token });
    assert.equal(list.json.revisions[0].run_count, 0, 'Rev 1 measured no run that predates it');
  });
});

describe('The 010 migration is additive and idempotent', () => {
  it('records itself once and adds the columns the feature needs', async () => {
    const Database = require('better-sqlite3');
    const copy = path.join(os.tmpdir(), `mes-app-revisions-peek-${Date.now()}.db`);
    fs.copyFileSync(DB_PATH, copy);
    const d = new Database(copy, { readonly: true });
    try {
      const rows = d.prepare("SELECT filename FROM _schema_migrations WHERE filename = '010_app_revisions.sql'").all();
      assert.equal(rows.length, 1, 'the migration must be recorded exactly once');
      const appCols = d.prepare('PRAGMA table_info(apps)').all().map(c => c.name);
      assert.ok(appCols.includes('current_revision'));
      assert.ok(appCols.includes('requires_approval'));
      const compCols = d.prepare('PRAGMA table_info(completions)').all().map(c => c.name);
      assert.ok(compCols.includes('app_revision_id'));
      const revCols = d.prepare('PRAGMA table_info(app_revisions)').all().map(c => c.name);
      for (const col of ['id', 'company_id', 'app_id', 'revision', 'steps', 'variables',
        'step_groups', 'schema_version', 'change_note', 'published_by_user_id',
        'approved_by_user_id', 'effective_at', 'created_at']) {
        assert.ok(revCols.includes(col), `app_revisions is missing ${col}`);
      }
    } finally {
      d.close();
      for (const ext of ['', '-shm', '-wal']) { try { fs.unlinkSync(copy + ext); } catch { /* ignore */ } }
    }
  });
});

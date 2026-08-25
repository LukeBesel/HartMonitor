'use strict';
// ─── CI Projects ──────────────────────────────────────────────────────────────
// Covers the whole /api/ci-projects surface against a real server:
//   • CRUD for projects and their tasks;
//   • tenant isolation — company A can never read, update or delete company B's
//     project or task, and cannot smuggle B's department or Kaizen idea onto one;
//   • CIP numbering climbing NUMERICALLY past 999 (a lexical max re-mints 1000);
//   • a status round-trip for EVERY status the Projects screen can pick, in both
//     vocabularies — the page offering a word the CHECK constraint forbids is
//     the bug this file exists to prevent;
//   • progress being null (not 0) until there are tasks to roll up.
//
// Node built-ins + better-sqlite3 only. Run with: npm test

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const { spawn } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Database = require('better-sqlite3');

// Unique to this suite — a port collision silently cancels another suite.
const PORT = 3241;
const BASE = `http://localhost:${PORT}`;
const DB_PATH = path.join(os.tmpdir(), `mes-ci-projects-${Date.now()}.db`);

// Exactly the CHECK constraints in db.js, and exactly what the UI offers.
const PROJECT_STATUSES = ['planning', 'active', 'on_hold', 'complete', 'cancelled'];
const TASK_STATUSES = ['not_started', 'in_progress', 'blocked', 'done'];

let server, db2;
let tokenA, tokenB;

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

async function signup(companyName, email) {
  const r = await api('POST', '/api/auth/signup', {
    body: { company_name: companyName, email, password: 'SecretPass1', display_name: 'Admin' },
  });
  assert.equal(r.status, 201, `signup failed: ${JSON.stringify(r.json)}`);
  return r.json.token;
}

/** Create a project and assert it worked, returning the row. */
async function makeProject(token, body = {}) {
  const r = await api('POST', '/api/ci-projects', { token, body: { name: 'Probe project', ...body } });
  assert.equal(r.status, 201, `create failed: ${JSON.stringify(r.json)}`);
  return r.json;
}

async function makeTask(token, projectId, body = {}) {
  const r = await api('POST', `/api/ci-projects/${projectId}/tasks`, { token, body: { name: 'Probe task', ...body } });
  assert.equal(r.status, 201, `task create failed: ${JSON.stringify(r.json)}`);
  return r.json;
}

before(async () => {
  await startServer();
  tokenA = await signup('CI Alpha Co', 'admin@ci-alpha.test');
  tokenB = await signup('CI Bravo Co', 'admin@ci-bravo.test');
  db2 = new Database(DB_PATH);
  db2.pragma('foreign_keys = ON');
});

after(() => {
  if (db2) { try { db2.close(); } catch { /* ignore */ } }
  if (server) server.kill('SIGTERM');
  for (const ext of ['', '-shm', '-wal']) {
    try { fs.unlinkSync(DB_PATH + ext); } catch { /* ignore */ }
  }
});

// ─── CRUD ─────────────────────────────────────────────────────────────────────

describe('CI project CRUD', () => {
  it('creates a project with a CIP-YYYY-NNN number and no invented progress', async () => {
    const p = await makeProject(tokenA, {
      name: 'Cut changeover time',
      description: 'SMED on Line 2',
      owner_name: 'Dana',
      start_date: '2026-03-02',
      target_date: '2026-04-30',
      estimated_savings: 12000,
    });
    assert.match(p.number, /^CIP-\d{4}-\d{3,}$/, `unexpected number ${p.number}`);
    assert.equal(p.name, 'Cut changeover time');
    assert.equal(p.status, 'planning');
    assert.equal(p.task_count, 0);
    // The bug this guards: a project with no tasks reporting 0% complete, which
    // reads as "started and got nowhere" rather than "nothing planned yet".
    assert.strictEqual(p.progress, null, 'a project with no tasks must report progress: null, not 0');
    assert.deepEqual(p.tasks, []);
  });

  it('rejects a project with no name', async () => {
    const r = await api('POST', '/api/ci-projects', { token: tokenA, body: { description: 'nameless' } });
    assert.equal(r.status, 400);
  });

  it('lists, reads, updates and deletes a project', async () => {
    const p = await makeProject(tokenA, { name: 'Lifecycle probe' });

    const list = await api('GET', '/api/ci-projects', { token: tokenA });
    assert.equal(list.status, 200);
    assert.ok(list.json.some(r => r.id === p.id), 'created project missing from the list');

    const read = await api('GET', `/api/ci-projects/${p.id}`, { token: tokenA });
    assert.equal(read.status, 200);
    assert.equal(read.json.name, 'Lifecycle probe');

    const upd = await api('PUT', `/api/ci-projects/${p.id}`, {
      token: tokenA, body: { name: 'Renamed', owner_name: 'Alex', estimated_savings: 500 },
    });
    assert.equal(upd.status, 200, JSON.stringify(upd.json));
    assert.equal(upd.json.name, 'Renamed');
    assert.equal(upd.json.owner_name, 'Alex');

    const del = await api('DELETE', `/api/ci-projects/${p.id}`, { token: tokenA });
    assert.equal(del.status, 200);
    const gone = await api('GET', `/api/ci-projects/${p.id}`, { token: tokenA });
    assert.equal(gone.status, 404);
  });

  it('clears a field the client explicitly empties instead of restoring the old value', async () => {
    const p = await makeProject(tokenA, { name: 'Blankable', owner_name: 'Sam', target_date: '2026-06-01' });
    const upd = await api('PUT', `/api/ci-projects/${p.id}`, { token: tokenA, body: { owner_name: '', target_date: '' } });
    assert.equal(upd.status, 200);
    assert.equal(upd.json.owner_name, null);
    assert.equal(upd.json.target_date, null);
  });

  it('stamps completed_at on complete and clears it when the project reopens', async () => {
    const p = await makeProject(tokenA, { name: 'Completion stamp' });
    const done = await api('PUT', `/api/ci-projects/${p.id}`, { token: tokenA, body: { status: 'complete' } });
    assert.equal(done.status, 200);
    assert.ok(done.json.completed_at, 'completing a project must stamp completed_at');
    const reopened = await api('PUT', `/api/ci-projects/${p.id}`, { token: tokenA, body: { status: 'active' } });
    assert.equal(reopened.json.completed_at, null, 'a reopened project must not still read as finished');
  });

  it('deleting a project takes its tasks with it', async () => {
    const p = await makeProject(tokenA, { name: 'Cascade probe' });
    const t = await makeTask(tokenA, p.id, { name: 'Doomed task' });
    await api('DELETE', `/api/ci-projects/${p.id}`, { token: tokenA });
    const orphan = db2.prepare('SELECT COUNT(*) AS n FROM ci_project_tasks WHERE id = ?').get(t.id).n;
    assert.equal(orphan, 0, 'tasks must not outlive their project');
  });
});

// ─── Tasks ────────────────────────────────────────────────────────────────────

describe('CI project tasks', () => {
  it('creates, lists, updates and deletes a task, and rolls progress up', async () => {
    const p = await makeProject(tokenA, { name: 'Task rollup', start_date: '2026-03-01', target_date: '2026-03-31' });

    const t1 = await makeTask(tokenA, p.id, { name: 'Time study', start_date: '2026-03-02', end_date: '2026-03-06', progress: 100, status: 'done' });
    const t2 = await makeTask(tokenA, p.id, { name: 'Trial run', start_date: '2026-03-09', end_date: '2026-03-13', progress: 50, status: 'in_progress' });

    const list = await api('GET', `/api/ci-projects/${p.id}/tasks`, { token: tokenA });
    assert.equal(list.status, 200);
    assert.equal(list.json.length, 2);
    // sort_order is assigned on insert, so the list comes back in creation order.
    assert.deepEqual(list.json.map(t => t.name), ['Time study', 'Trial run']);

    const read = await api('GET', `/api/ci-projects/${p.id}`, { token: tokenA });
    assert.equal(read.json.task_count, 2);
    assert.equal(read.json.done_count, 1);
    assert.equal(read.json.progress, 75, 'progress must be the average of the task progresses');

    const upd = await api('PUT', `/api/ci-projects/${p.id}/tasks/${t2.id}`, { token: tokenA, body: { progress: 80, assignee_name: 'Ravi' } });
    assert.equal(upd.status, 200);
    assert.equal(upd.json.progress, 80);
    assert.equal(upd.json.assignee_name, 'Ravi');

    const del = await api('DELETE', `/api/ci-projects/${p.id}/tasks/${t1.id}`, { token: tokenA });
    assert.equal(del.status, 200);
    const after = await api('GET', `/api/ci-projects/${p.id}`, { token: tokenA });
    assert.equal(after.json.task_count, 1);
    assert.equal(after.json.progress, 80);
  });

  it('marking a task done without touching progress finishes it at 100%', async () => {
    const p = await makeProject(tokenA, { name: 'Done implies 100' });
    const t = await makeTask(tokenA, p.id, { name: 'Half done', progress: 40, status: 'in_progress' });
    const upd = await api('PUT', `/api/ci-projects/${p.id}/tasks/${t.id}`, { token: tokenA, body: { status: 'done' } });
    assert.equal(upd.json.status, 'done');
    assert.equal(upd.json.progress, 100);
  });

  it('accepts a finish-to-start dependency inside the project and drops it when the predecessor goes', async () => {
    const p = await makeProject(tokenA, { name: 'Dependency probe' });
    const first = await makeTask(tokenA, p.id, { name: 'First', start_date: '2026-03-02', end_date: '2026-03-04' });
    const second = await makeTask(tokenA, p.id, { name: 'Second', start_date: '2026-03-05', end_date: '2026-03-08', depends_on: first.id });
    assert.equal(second.depends_on, first.id);

    const list = await api('GET', `/api/ci-projects/${p.id}/tasks`, { token: tokenA });
    const shown = list.json.find(t => t.id === second.id);
    assert.equal(shown.depends_on_name, 'First', 'the predecessor name must come back for the Gantt label');

    await api('DELETE', `/api/ci-projects/${p.id}/tasks/${first.id}`, { token: tokenA });
    const after = await api('GET', `/api/ci-projects/${p.id}/tasks`, { token: tokenA });
    assert.equal(after.json.find(t => t.id === second.id).depends_on, null,
      'a dependency must not point at a task that no longer exists');
  });

  it('refuses a self-dependency and a dependency on another project', async () => {
    const p1 = await makeProject(tokenA, { name: 'Dep guard 1' });
    const p2 = await makeProject(tokenA, { name: 'Dep guard 2' });
    const t1 = await makeTask(tokenA, p1.id, { name: 'T1' });
    const t2 = await makeTask(tokenA, p2.id, { name: 'T2' });

    const cross = await api('POST', `/api/ci-projects/${p1.id}/tasks`, { token: tokenA, body: { name: 'Cross', depends_on: t2.id } });
    assert.equal(cross.status, 400, 'a dependency must stay inside its own project');

    const self = await api('PUT', `/api/ci-projects/${p1.id}/tasks/${t1.id}`, { token: tokenA, body: { depends_on: t1.id } });
    assert.equal(self.status, 400, 'a task cannot depend on itself');
  });

  it('refuses an out-of-range progress instead of storing it', async () => {
    const p = await makeProject(tokenA, { name: 'Progress guard' });
    const bad = await api('POST', `/api/ci-projects/${p.id}/tasks`, { token: tokenA, body: { name: 'Over', progress: 140 } });
    assert.equal(bad.status, 400);
  });
});

// ─── Status vocabulary ────────────────────────────────────────────────────────

describe('the page vocabulary equals the stored vocabulary', () => {
  it('round-trips EVERY project status the Projects screen can pick', async () => {
    for (const status of PROJECT_STATUSES) {
      const created = await api('POST', '/api/ci-projects', { token: tokenA, body: { name: `Status ${status}`, status } });
      assert.equal(created.status, 201, `POST with status '${status}' failed: ${JSON.stringify(created.json)}`);
      assert.equal(created.json.status, status, `POST stored '${created.json.status}' for '${status}'`);

      const moved = await api('PUT', `/api/ci-projects/${created.json.id}`, { token: tokenA, body: { status } });
      assert.equal(moved.status, 200, `PUT to status '${status}' failed: ${JSON.stringify(moved.json)}`);
      assert.equal(moved.json.status, status);

      const read = await api('GET', `/api/ci-projects/${created.json.id}`, { token: tokenA });
      assert.equal(read.json.status, status, `re-reading '${status}' returned '${read.json.status}'`);

      // …and it is findable under the filter the chips use.
      const filtered = await api('GET', `/api/ci-projects?status=${status}`, { token: tokenA });
      assert.equal(filtered.status, 200);
      assert.ok(filtered.json.some(r => r.id === created.json.id), `status filter '${status}' cannot find its own row`);
    }
  });

  it('round-trips EVERY task status the Gantt can pick', async () => {
    const p = await makeProject(tokenA, { name: 'Task status probe' });
    for (const status of TASK_STATUSES) {
      const created = await api('POST', `/api/ci-projects/${p.id}/tasks`, { token: tokenA, body: { name: `Task ${status}`, status } });
      assert.equal(created.status, 201, `POST task status '${status}' failed: ${JSON.stringify(created.json)}`);
      assert.equal(created.json.status, status);

      const moved = await api('PUT', `/api/ci-projects/${p.id}/tasks/${created.json.id}`, { token: tokenA, body: { status, progress: 25 } });
      assert.equal(moved.status, 200, `PUT task status '${status}' failed: ${JSON.stringify(moved.json)}`);
      assert.equal(moved.json.status, status);
      assert.equal(moved.json.progress, 25, 'an explicit progress must survive a status change');
    }
  });

  it('rejects a status the column would refuse, with a 400 rather than a 500', async () => {
    const bad = await api('POST', '/api/ci-projects', { token: tokenA, body: { name: 'Bad status', status: 'in-progress' } });
    assert.equal(bad.status, 400, `expected 400, got ${bad.status}: ${JSON.stringify(bad.json)}`);

    const p = await makeProject(tokenA, { name: 'Bad task status host' });
    const badTask = await api('POST', `/api/ci-projects/${p.id}/tasks`, { token: tokenA, body: { name: 'x', status: 'started' } });
    assert.equal(badTask.status, 400, `expected 400, got ${badTask.status}: ${JSON.stringify(badTask.json)}`);
  });
});

// ─── Tenant isolation ─────────────────────────────────────────────────────────

describe('tenant isolation', () => {
  it('company B cannot read, update or delete company A\'s project', async () => {
    const a = await makeProject(tokenA, { name: 'Alpha only' });

    assert.equal((await api('GET', `/api/ci-projects/${a.id}`, { token: tokenB })).status, 404);
    assert.equal((await api('PUT', `/api/ci-projects/${a.id}`, { token: tokenB, body: { name: 'hijacked' } })).status, 404);
    assert.equal((await api('DELETE', `/api/ci-projects/${a.id}`, { token: tokenB })).status, 404);

    // …and the row is untouched.
    const still = await api('GET', `/api/ci-projects/${a.id}`, { token: tokenA });
    assert.equal(still.status, 200);
    assert.equal(still.json.name, 'Alpha only');
  });

  it('company B never sees company A\'s projects in a list', async () => {
    await makeProject(tokenA, { name: 'Invisible to B' });
    const list = await api('GET', '/api/ci-projects', { token: tokenB });
    assert.equal(list.status, 200);
    assert.ok(!list.json.some(p => p.name === 'Invisible to B'), 'cross-tenant row leaked into the list');
  });

  it('company B cannot read, add to, update or delete tasks on company A\'s project', async () => {
    const a = await makeProject(tokenA, { name: 'Alpha tasks' });
    const t = await makeTask(tokenA, a.id, { name: 'Alpha task', progress: 10 });

    assert.equal((await api('GET', `/api/ci-projects/${a.id}/tasks`, { token: tokenB })).status, 404);
    assert.equal((await api('POST', `/api/ci-projects/${a.id}/tasks`, { token: tokenB, body: { name: 'sneak' } })).status, 404);
    assert.equal((await api('PUT', `/api/ci-projects/${a.id}/tasks/${t.id}`, { token: tokenB, body: { progress: 99 } })).status, 404);
    assert.equal((await api('DELETE', `/api/ci-projects/${a.id}/tasks/${t.id}`, { token: tokenB })).status, 404);

    const still = await api('GET', `/api/ci-projects/${a.id}/tasks`, { token: tokenA });
    assert.equal(still.json.length, 1);
    assert.equal(still.json[0].progress, 10, 'a cross-tenant write must not have landed');
  });

  it('a task id from another tenant cannot be reached through B\'s own project', async () => {
    const a = await makeProject(tokenA, { name: 'Alpha host' });
    const alphaTask = await makeTask(tokenA, a.id, { name: 'Alpha task' });
    const b = await makeProject(tokenB, { name: 'Bravo host' });

    const r = await api('PUT', `/api/ci-projects/${b.id}/tasks/${alphaTask.id}`, { token: tokenB, body: { name: 'stolen' } });
    assert.equal(r.status, 404);
    assert.equal(db2.prepare('SELECT name FROM ci_project_tasks WHERE id = ?').get(alphaTask.id).name, 'Alpha task');
  });

  it('a foreign department or Kaizen idea cannot be attached to a project', async () => {
    const deptB = await api('POST', '/api/departments', { token: tokenB, body: { name: 'Bravo Assembly' } });
    assert.ok(deptB.status === 200 || deptB.status === 201, `department create failed: ${JSON.stringify(deptB.json)}`);
    const ideaB = await api('POST', '/api/kaizen', { token: tokenB, body: { title: 'Bravo idea', category: 'cost' } });
    assert.equal(ideaB.status, 201);

    const withDept = await api('POST', '/api/ci-projects', { token: tokenA, body: { name: 'Cross dept', department_id: deptB.json.id } });
    assert.equal(withDept.status, 400, 'a department from another tenant must be refused');

    const withIdea = await api('POST', '/api/ci-projects', { token: tokenA, body: { name: 'Cross idea', kaizen_idea_id: ideaB.json.id } });
    assert.equal(withIdea.status, 400, 'a Kaizen idea from another tenant must be refused');
  });

  it('the summary counts only the caller\'s own projects', async () => {
    const before = await api('GET', '/api/ci-projects/summary', { token: tokenB });
    await makeProject(tokenA, { name: 'Not B\'s', status: 'active' });
    const after = await api('GET', '/api/ci-projects/summary', { token: tokenB });
    assert.equal(after.json.total, before.json.total, 'another tenant\'s project moved B\'s total');
  });
});

// ─── Ideas → projects ─────────────────────────────────────────────────────────

describe('a project started from a Kaizen idea', () => {
  it('carries the link and reports it from both directions', async () => {
    const idea = await api('POST', '/api/kaizen', {
      token: tokenA,
      body: { title: 'Shorten the walk to the tool crib', category: 'delivery', estimated_savings: 4000 },
    });
    assert.equal(idea.status, 201);

    const project = await makeProject(tokenA, {
      name: idea.json.title,
      kaizen_idea_id: idea.json.id,
      estimated_savings: idea.json.estimated_savings,
    });
    assert.equal(project.kaizen_idea_id, idea.json.id);
    assert.equal(project.kaizen_idea_number, idea.json.idea_number, 'the idea number must come back for the badge');
    assert.equal(project.kaizen_idea_title, idea.json.title);

    const byIdea = await api('GET', `/api/ci-projects?kaizen_idea_id=${idea.json.id}`, { token: tokenA });
    assert.equal(byIdea.status, 200);
    assert.deepEqual(byIdea.json.map(p => p.id), [project.id]);

    const summary = await api('GET', '/api/ci-projects/summary', { token: tokenA });
    assert.ok(summary.json.from_ideas >= 1, 'the summary must count projects started from ideas');
  });
});

// ─── Numbering past 999 ───────────────────────────────────────────────────────

describe('CIP numbers climb numerically past 999', () => {
  it('reaches CIP-YYYY-1000 then CIP-YYYY-1001 without colliding', async () => {
    // A fresh company so the sequence starts at 001 and nothing else interferes.
    const token = await signup('CI Numbering Co', 'admin@ci-numbering.test');

    const first = await makeProject(token, { name: 'Sequence probe' });
    const prefix = first.number.slice(0, first.number.lastIndexOf('-') + 1);
    assert.equal(first.number, `${prefix}001`);

    const base = db2.prepare('SELECT * FROM ci_projects WHERE id = ?').get(first.id);
    assert.ok(base, 'could not read the template row back');

    // Fill 002..999 by copying the template row, so the set straddles the
    // lexical cliff the moment …-1000 lands.
    const cols = Object.keys(base);
    const insert = db2.prepare(`INSERT INTO ci_projects (${cols.join(', ')}) VALUES (${cols.map(c => '@' + c).join(', ')})`);
    db2.transaction(() => {
      for (let seq = 2; seq <= 999; seq++) {
        insert.run({ ...base, id: randomUUID(), number: `${prefix}${String(seq).padStart(3, '0')}` });
      }
    })();

    const n1000 = await makeProject(token, { name: 'Sequence probe' });
    assert.equal(n1000.number, `${prefix}1000`);

    // With 001..1000 present a LEXICAL max picks "…-999" and re-mints …-1000.
    const n1001 = await makeProject(token, { name: 'Sequence probe' });
    assert.equal(n1001.number, `${prefix}1001`, `id must climb numerically past 1000, got ${n1001.number}`);

    const dupes = db2.prepare('SELECT COUNT(*) AS n FROM ci_projects WHERE company_id = ? AND number = ?')
      .get(base.company_id, `${prefix}1001`).n;
    assert.equal(dupes, 1, `${prefix}1001 should exist exactly once, found ${dupes}`);
  });
});

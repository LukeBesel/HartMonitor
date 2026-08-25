'use strict';
// ─── Migrations against a database that predates a column ─────────────────────
// `CREATE TABLE IF NOT EXISTS` does NOTHING to a table that already exists. So a
// column added by editing a CREATE statement reaches new databases only —
// production, which was created earlier, never gets it. Selecting that column is
// then a hard SQL error, not an empty result, and the screen returns 500.
//
// This file builds a database shaped the way an OLD deployment's is, boots the
// real db.js against it in a child process (db.js runs its migrations at require
// time and caches, so it has to be a separate process), and checks that the
// column exists afterwards AND that existing rows were backfilled — an added
// column full of NULLs is still invisible to every tenant-filtered query.
//
// Spawns no server, so it holds no port.

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const DB_PATH = path.join(os.tmpdir(), `mes-legacy-schema-${Date.now()}.db`);
const DB_MODULE = path.join(__dirname, '..', 'src', 'db.js');
const BETTER_SQLITE = require.resolve('better-sqlite3');

/** Run a snippet in a child process with db.js already migrated against DB_PATH. */
function inMigratedDb(snippet) {
  const script = `
    require(${JSON.stringify(DB_MODULE)});
    const Database = require(${JSON.stringify(BETTER_SQLITE)});
    const db = new Database(${JSON.stringify(DB_PATH)});
    ${snippet}
  `;
  const out = execFileSync(process.execPath, ['-e', script], {
    env: { ...process.env, NODE_ENV: 'test', DATABASE_PATH: DB_PATH, SEED_DEMO_DATA: 'false', BACKUP_DIR: '' },
    encoding: 'utf8',
  });
  // db.js prints a startup banner; the snippet's own output is the last line.
  return out.trim().split('\n').pop();
}

before(() => {
  const Database = require('better-sqlite3');
  const db = new Database(DB_PATH);
  // routing_steps as it was before it carried a company_id.
  db.exec(`
    CREATE TABLE organizations (id TEXT PRIMARY KEY, name TEXT);
    CREATE TABLE product_routings (id TEXT PRIMARY KEY, company_id TEXT, name TEXT, description TEXT);
    CREATE TABLE routing_steps (
      id TEXT PRIMARY KEY, routing_id TEXT, step_number INTEGER, name TEXT,
      description TEXT, app_id TEXT, department_id TEXT, estimated_cycle_seconds REAL, created_at TEXT
    );
    INSERT INTO organizations VALUES ('co-legacy', 'Legacy Co');
    INSERT INTO product_routings VALUES ('r-legacy', 'co-legacy', 'Old Routing', '');
    INSERT INTO routing_steps (id, routing_id, step_number, name) VALUES ('s-legacy', 'r-legacy', 1, 'Old Step');
  `);
  db.close();
});

after(() => {
  for (const ext of ['', '-shm', '-wal']) {
    try { fs.unlinkSync(DB_PATH + ext); } catch { /* ignore */ }
  }
});

describe('an old database gets the columns added since it was created', () => {
  it('adds routing_steps.company_id, which the department filter selects', () => {
    const cols = inMigratedDb(
      `console.log(db.prepare('PRAGMA table_info(routing_steps)').all().map(r => r.name).join(','))`,
    );
    assert.ok(
      cols.split(',').includes('company_id'),
      `routing_steps must gain company_id on an old database — got: ${cols}`,
    );
  });

  it('backfills the existing step from its routing, not with NULL', () => {
    // A column added full of NULLs passes a "does the column exist" check and
    // still hides every legacy row from every tenant-filtered query.
    const owner = inMigratedDb(
      `console.log(String(db.prepare("SELECT company_id FROM routing_steps WHERE id = 's-legacy'").get().company_id))`,
    );
    assert.equal(owner, 'co-legacy', 'the legacy step should inherit its routing\'s company');
  });

  it('runs clean a second time', () => {
    // Migrations run on every boot. A backfill that is not idempotent, or an
    // ALTER without its guard, throws on the next restart.
    const owner = inMigratedDb(
      `console.log(String(db.prepare("SELECT company_id FROM routing_steps WHERE id = 's-legacy'").get().company_id))`,
    );
    assert.equal(owner, 'co-legacy');
  });
});

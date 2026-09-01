'use strict';
// ─── A migration applies wholly, or not at all ────────────────────────────────
// The runner used to execute a file statement by statement, remember that
// something had failed, finish the remaining statements anyway, and only then
// throw. A file that created a table and then hit a bad statement left that
// table behind on a database whose `_schema_migrations` says the file never
// ran — so the next deploy re-runs it, hits "table already exists", and the
// schema is now whatever the two half-runs happened to leave.
//
// Seven streams are about to add schema through this runner. What has to hold:
//
//   • a file that fails leaves NOTHING — no table, no bookkeeping row — and the
//     runner throws, so the server refuses to boot on a bad file;
//   • a file that succeeds is recorded and never runs again;
//   • the five shipped migrations still apply cleanly and are no-ops on a
//     database that already has them;
//   • db.js runs them itself, before its seed, so a consumer that only requires
//     db.js (no server) sees the migrated schema.
//
// Spawns no server, so it holds no port. (Port 3401 is reserved for this stream
// in MIGRATIONS.md should one ever be needed.)
//
// Uses Node built-ins only (node:test). Run with:
//   node --test test/migration-discipline.test.js

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Database = require('better-sqlite3');

const { runMigrations } = require('../src/db/runMigrations');
const vocab = require('../src/vocab');

const REAL_MIGRATIONS_DIR = path.join(__dirname, '..', 'src', 'db', 'migrations');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'mes-migration-discipline-'));

/** A database shaped like db.js has just finished creating its tables. */
function freshDb(name) {
  const db = new Database(path.join(TMP, name));
  db.exec(`
    CREATE TABLE plan (company_id TEXT PRIMARY KEY, tier TEXT, app_limit INTEGER);
    CREATE TABLE sessions (id TEXT PRIMARY KEY, user_id TEXT, expires_at TEXT);
  `);
  return db;
}

function migrationsDirWith(files, label) {
  const dir = path.join(TMP, `dir-${label}`);
  fs.mkdirSync(dir, { recursive: true });
  for (const [name, sql] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), sql);
  return dir;
}

function appliedFiles(db) {
  return db.prepare('SELECT filename FROM _schema_migrations ORDER BY filename').all().map(r => r.filename);
}

function tableExists(db, name) {
  return !!db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name = ?").get(name);
}

/** Run something with the runner's console noise silenced. */
function quietly(fn) {
  const log = console.log, error = console.error;
  console.log = () => {}; console.error = () => {};
  try { return fn(); } finally { console.log = log; console.error = error; }
}

after(() => { try { fs.rmSync(TMP, { recursive: true, force: true }); } catch { /* best effort */ } });

describe('a failed migration leaves nothing behind', () => {
  it('throws, records no filename, and rolls back the table it had already created', () => {
    const db = freshDb('failure.db');
    const dir = migrationsDirWith({
      // First statement succeeds, second is not SQL at all. The table from the
      // first statement must not survive.
      '900_half_applied.sql': [
        'CREATE TABLE half_applied_probe (id TEXT PRIMARY KEY);',
        'CREATE INDEX idx_probe ON half_applied_probe(id);',
        'THIS IS NOT SQL AT ALL;',
      ].join('\n'),
    }, 'failure');

    assert.throws(
      () => quietly(() => runMigrations(db, dir)),
      /Migration failed: 900_half_applied\.sql/,
      'the runner must throw so the server refuses to boot'
    );

    assert.deepStrictEqual(appliedFiles(db), [], 'no bookkeeping row for a file that failed');
    assert.strictEqual(tableExists(db, 'half_applied_probe'), false,
      'the table created before the failure must be rolled back, not left behind');
    assert.strictEqual(
      db.prepare("SELECT count(*) n FROM sqlite_master WHERE name = 'idx_probe'").get().n, 0,
      'the index created before the failure must be rolled back too');
    db.close();
  });

  it('a later good file still applies once the bad one is fixed', () => {
    const db = freshDb('recovery.db');
    const dir = migrationsDirWith({
      '900_bad.sql': 'CREATE TABLE probe_a (id TEXT);\nNOT SQL;',
    }, 'recovery');

    assert.throws(() => quietly(() => runMigrations(db, dir)), /Migration failed/);
    assert.strictEqual(tableExists(db, 'probe_a'), false);

    fs.writeFileSync(path.join(dir, '900_bad.sql'), 'CREATE TABLE probe_a (id TEXT);');
    quietly(() => runMigrations(db, dir));
    assert.deepStrictEqual(appliedFiles(db), ['900_bad.sql']);
    assert.strictEqual(tableExists(db, 'probe_a'), true);
    db.close();
  });
});

describe('a good migration applies exactly once', () => {
  it('records the filename and never runs the file again', () => {
    const db = freshDb('once.db');
    const dir = migrationsDirWith({
      '901_good.sql': [
        '-- a comment; with a semicolon in it',
        "CREATE TABLE once_probe (id TEXT PRIMARY KEY, label TEXT DEFAULT 'a;b');",
        'CREATE INDEX IF NOT EXISTS idx_once_probe ON once_probe(label);',
      ].join('\n'),
    }, 'once');

    quietly(() => runMigrations(db, dir));
    assert.deepStrictEqual(appliedFiles(db), ['901_good.sql']);
    assert.strictEqual(tableExists(db, 'once_probe'), true);

    // A semicolon inside a comment or a string literal must not split a
    // statement — if it had, the CREATE TABLE above would have been truncated.
    const cols = db.prepare('PRAGMA table_info(once_probe)').all().map(c => c.name);
    assert.deepStrictEqual(cols, ['id', 'label']);

    // Replace the file's contents with something that would blow up if it ran.
    // A second pass must skip it purely on the recorded filename.
    fs.writeFileSync(path.join(dir, '901_good.sql'), 'THIS WOULD THROW IF IT RAN;');
    quietly(() => runMigrations(db, dir));
    assert.deepStrictEqual(appliedFiles(db), ['901_good.sql'], 'still exactly one row');
    db.close();
  });

  it('tolerates re-adding a column that db.js already created', () => {
    const db = freshDb('tolerant.db');
    const dir = migrationsDirWith({
      '902_dupes.sql': [
        'ALTER TABLE plan ADD COLUMN tier TEXT;',          // duplicate column name
        'CREATE TABLE plan (company_id TEXT);',            // table already exists
        'ALTER TABLE plan ADD COLUMN genuinely_new TEXT;', // must still land
      ].join('\n'),
    }, 'tolerant');

    quietly(() => runMigrations(db, dir));
    assert.deepStrictEqual(appliedFiles(db), ['902_dupes.sql']);
    const cols = db.prepare('PRAGMA table_info(plan)').all().map(c => c.name);
    assert.ok(cols.includes('genuinely_new'), 'the new column applies despite the two tolerated errors');
    db.close();
  });
});

describe('the five shipped migrations', () => {
  it('apply cleanly to a fresh database and are no-ops on a migrated one', () => {
    const db = freshDb('shipped.db');

    quietly(() => runMigrations(db, REAL_MIGRATIONS_DIR));
    const first = appliedFiles(db);
    assert.deepStrictEqual(first, [
      '001_baseline.sql',
      '002_plan_billing_columns.sql',
      '003_activity_log.sql',
      '004_sessions_cleanup_index.sql',
      '005_company_modules.sql',
    ]);
    assert.strictEqual(tableExists(db, 'company_modules'), true, '005 created its table');
    assert.ok(db.prepare('PRAGMA table_info(plan)').all().map(c => c.name).includes('trial_ends_at'),
      '002 added its columns');

    const stamps = db.prepare('SELECT filename, id, applied_at FROM _schema_migrations ORDER BY id').all();
    quietly(() => runMigrations(db, REAL_MIGRATIONS_DIR));
    assert.deepStrictEqual(appliedFiles(db), first, 'second pass adds nothing');
    assert.deepStrictEqual(
      db.prepare('SELECT filename, id, applied_at FROM _schema_migrations ORDER BY id').all(),
      stamps,
      'second pass rewrites nothing — the files were skipped, not re-applied'
    );
    db.close();
  });
});

describe('db.js runs the migrations itself', () => {
  const DB_PATH = path.join(TMP, 'via-db-js.db');

  before(() => {
    // db.js applies migrations at require time, before its demo seed, so a
    // consumer that never starts a server still sees the migrated schema.
    execFileSync(process.execPath, ['-e', `require(${JSON.stringify(path.join(__dirname, '..', 'src', 'db.js'))})`], {
      env: { ...process.env, NODE_ENV: 'test', DATABASE_PATH: DB_PATH, SEED_DEMO_DATA: 'false', BACKUP_DIR: '' },
      encoding: 'utf8',
      stdio: 'pipe',
    });
  });

  it('leaves _schema_migrations holding 001-005 after a bare require of db.js', () => {
    const db = new Database(DB_PATH, { readonly: true });
    assert.deepStrictEqual(appliedFiles(db), [
      '001_baseline.sql',
      '002_plan_billing_columns.sql',
      '003_activity_log.sql',
      '004_sessions_cleanup_index.sql',
      '005_company_modules.sql',
    ]);
    assert.strictEqual(tableExists(db, 'company_modules'), true);
    db.close();
  });
});

describe('one vocabulary for CHECK constraints and validators', () => {
  it('freezes every list', () => {
    for (const name of Object.keys(vocab.VOCABULARIES)) {
      assert.ok(Object.isFrozen(vocab.values(name)), `${name} must be frozen`);
    }
  });

  it('renders a CHECK fragment SQLite actually accepts', () => {
    assert.strictEqual(
      vocab.checkList('OPERATION_STATUS'),
      "CHECK(status IN ('queued','ready','running','complete','skipped','on_hold'))"
    );
    assert.strictEqual(
      vocab.checkList('REASON_KIND', 'reason_kind'),
      "CHECK(reason_kind IN ('scrap','rework','downtime'))"
    );

    // The fragment has to survive a real CREATE TABLE, and the constraint has to
    // reject exactly what isValid() rejects.
    const db = new Database(path.join(TMP, 'vocab.db'));
    db.exec(`CREATE TABLE op (id TEXT PRIMARY KEY, status TEXT NOT NULL ${vocab.checkList('OPERATION_STATUS')})`);
    db.prepare('INSERT INTO op VALUES (?, ?)').run('a', 'running');
    assert.ok(vocab.isValid('OPERATION_STATUS', 'running'));
    assert.throws(() => db.prepare('INSERT INTO op VALUES (?, ?)').run('b', 'paused'), /CHECK constraint failed/);
    assert.strictEqual(vocab.isValid('OPERATION_STATUS', 'paused'), false);
    db.close();
  });

  it('throws on an unknown vocabulary rather than rendering an empty list', () => {
    assert.throws(() => vocab.checkList('NOT_A_VOCABULARY'), /Unknown vocabulary/);
    assert.throws(() => vocab.values('NOT_A_VOCABULARY'), /Unknown vocabulary/);
    assert.throws(() => vocab.isValid('NOT_A_VOCABULARY', 'x'), /Unknown vocabulary/);
  });
});

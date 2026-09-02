'use strict';
const fs = require('fs');
const path = require('path');

// ─── Numbered SQLite migrations ───────────────────────────────────────────────
// Applies every .sql file in backend/src/db/migrations/ in filename order,
// exactly once each, recording what it applied in `_schema_migrations`.
//
// The two rules that make this safe to run on a live database:
//
//   1. A file applies WHOLLY OR NOT AT ALL. Every statement in a file — and the
//      `_schema_migrations` row that records it — runs inside one transaction.
//      SQLite DDL is transactional in better-sqlite3, so a CREATE TABLE that
//      succeeded before a later statement failed is rolled back with everything
//      else: no half-applied schema, and no bookkeeping row claiming the file
//      is done. The failure then throws, so the server refuses to boot rather
//      than serving a database it does not understand.
//
//   2. Migrations only ADD. "duplicate column name" / "already exists" are the
//      expected result of re-adding something db.js already created, so those
//      are tolerated per-statement (inside the transaction) and the file keeps
//      going. Every other error aborts the file.
//
// This module deliberately requires nothing from the app (no db.js) so it can
// be called from db.js itself without a circular require.
//
// See MIGRATIONS.md for the reserved migration numbers and the rules a new file
// has to follow. Two of those rules are enforced here rather than trusted: a
// file may not contain BEGIN/COMMIT/PRAGMA/END (the runner owns the transaction,
// and SQLite ignores a schema PRAGMA inside one, so such a file would be
// recorded as applied having changed nothing), and the splitter below is
// statement-level, not a SQL parser, so a BEGIN…END trigger body is rejected
// rather than mangled.

const DEFAULT_MIGRATIONS_DIR = path.join(__dirname, 'migrations');

// Statements the runner will not execute. The runner owns the transaction, so a
// BEGIN/COMMIT inside a file would fight it; a schema PRAGMA inside a
// transaction is silently ignored by SQLite, which is worse — the file would be
// recorded as applied having done nothing. END catches a BEGIN…END trigger body,
// which the statement splitter cannot represent. See MIGRATIONS.md rule 5.
const FORBIDDEN_STATEMENT = /^(PRAGMA|BEGIN|COMMIT|END)\b/i;

/** Errors that mean "this additive change is already present" — safe to skip. */
function isAlreadyPresent(err) {
  const m = String(err && err.message || '');
  return m.includes('duplicate column name') || m.includes('already exists');
}

/**
 * Split a migration file into individual statements on `;`, ignoring semicolons
 * that sit inside string literals or comments. (The previous runner stripped
 * whole `--` comment lines before splitting; this handles those plus trailing
 * comments and /* *\/ blocks, so files 001-005 split exactly as before.)
 */
function splitStatements(sql) {
  const statements = [];
  let current = '';
  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i];
    const next = sql[i + 1];

    // Line comment — drop to end of line.
    if (ch === '-' && next === '-') {
      while (i < sql.length && sql[i] !== '\n') i++;
      current += '\n';
      continue;
    }
    // Block comment — drop to the closing marker.
    if (ch === '/' && next === '*') {
      i += 2;
      while (i < sql.length && !(sql[i] === '*' && sql[i + 1] === '/')) i++;
      i++; // land on '/', loop's i++ steps past it
      current += ' ';
      continue;
    }
    // String or quoted identifier — copy verbatim, semicolons and all. SQLite
    // accepts four quotings: 'string', "ident", `ident` and [ident]. A doubled
    // quote inside closes then immediately reopens, which tracks correctly.
    if (ch === "'" || ch === '"' || ch === '`' || ch === '[') {
      const close = ch === '[' ? ']' : ch;
      current += ch;
      i++;
      while (i < sql.length) {
        current += sql[i];
        if (sql[i] === close) break;
        i++;
      }
      continue;
    }
    if (ch === ';') {
      statements.push(current);
      current = '';
      continue;
    }
    current += ch;
  }
  statements.push(current);
  return statements.map(s => s.trim()).filter(s => s.length > 0);
}

/**
 * Apply pending migrations.
 *
 * @param {import('better-sqlite3').Database} db  open database handle
 * @param {string} [migrationsDir]  directory of numbered .sql files. Defaults to
 *   $MIGRATIONS_DIR when set, else backend/src/db/migrations. Tests point it at
 *   a temp directory — either by argument, or via MIGRATIONS_DIR when the runner
 *   is reached indirectly (db.js requires it and passes no argument).
 */
function runMigrations(db, migrationsDir = process.env.MIGRATIONS_DIR || DEFAULT_MIGRATIONS_DIR) {
  // Tracking table
  db.exec(`
    CREATE TABLE IF NOT EXISTS _schema_migrations (
      id        INTEGER PRIMARY KEY AUTOINCREMENT,
      filename  TEXT UNIQUE NOT NULL,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  if (!fs.existsSync(migrationsDir)) return;

  const files = fs.readdirSync(migrationsDir)
    .filter(f => f.endsWith('.sql'))
    .sort();

  const applied = new Set(
    db.prepare('SELECT filename FROM _schema_migrations').all().map(r => r.filename)
  );

  for (const file of files) {
    if (applied.has(file)) continue;

    const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
    const statements = splitStatements(sql);

    // One transaction per file: every statement plus the row that records the
    // file. Throwing out of this function rolls the whole thing back.
    const applyFile = db.transaction(() => {
      for (const stmt of statements) {
        const forbidden = stmt.match(FORBIDDEN_STATEMENT);
        if (forbidden) {
          const word = forbidden[1].toUpperCase();
          console.error(`[migrations] Error in ${file}: ${word} is not allowed inside a migration file.`);
          throw new Error(
            `${word} is not allowed inside a migration file — the runner owns the transaction, ` +
            `and SQLite silently ignores a schema PRAGMA inside one. See MIGRATIONS.md rule 5.`
          );
        }
        try {
          db.exec(stmt + ';');
        } catch (err) {
          if (isAlreadyPresent(err)) continue; // column/table already present
          console.error(`[migrations] Error in ${file}:`, err.message, '\nStatement:', stmt);
          throw err;
        }
      }
      db.prepare('INSERT OR IGNORE INTO _schema_migrations (filename) VALUES (?)').run(file);
    });

    try {
      applyFile();
    } catch (err) {
      console.error(`[migrations] FAILED on ${file} — rolled back, server will not start`);
      throw new Error(`Migration failed: ${file}: ${err.message}`);
    }

    console.log(`[migrations] Applied: ${file} (${statements.length} statement${statements.length === 1 ? '' : 's'})`);
  }
}

module.exports = { runMigrations, splitStatements, DEFAULT_MIGRATIONS_DIR };

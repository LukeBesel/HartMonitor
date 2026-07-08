'use strict';
const fs = require('fs');
const path = require('path');

/**
 * Runs any pending .sql migrations in backend/src/db/migrations/
 * in filename order. Each file runs exactly once.
 * SAFE: migrations should only ADD tables/columns, never drop.
 */
function runMigrations(db) {
  // Create tracking table
  db.exec(`
    CREATE TABLE IF NOT EXISTS _schema_migrations (
      id        INTEGER PRIMARY KEY AUTOINCREMENT,
      filename  TEXT UNIQUE NOT NULL,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  const migrationsDir = path.join(__dirname, 'migrations');
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

    // Strip comment lines first to avoid semicolons inside comments breaking the split
    const cleanedSql = sql
      .split('\n')
      .filter(line => !line.trim().startsWith('--'))
      .join('\n');

    // Execute each statement individually so one "duplicate column" doesn't block the rest
    const statements = cleanedSql
      .split(';')
      .map(s => s.trim())
      .filter(s => s.length > 0);

    let hadError = false;
    for (const stmt of statements) {
      try {
        db.exec(stmt + ';');
      } catch (err) {
        if (err.message.includes('duplicate column name') || err.message.includes('already exists')) {
          // Safe to ignore — column/table already present
        } else {
          console.error(`[migrations] Error in ${file}:`, err.message, '\nStatement:', stmt);
          hadError = true;
        }
      }
    }

    if (!hadError) {
      db.prepare('INSERT OR IGNORE INTO _schema_migrations (filename) VALUES (?)').run(file);
      console.log(`[migrations] Applied: ${file}`);
    } else {
      console.error(`[migrations] FAILED on ${file} — server will not start`);
      throw new Error(`Migration failed: ${file}`);
    }
  }
}

module.exports = { runMigrations };

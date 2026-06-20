// Run with: node src/db/migrate.js
// Applies all pending .sql migrations in backend/prisma/migrations/ in order.
// Tracks applied migrations in a _migrations table so each file runs only once.

const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

async function migrate() {
  if (!process.env.DATABASE_URL) {
    console.error('ERROR: DATABASE_URL environment variable is not set.');
    process.exit(1);
  }

  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  console.log('Connected to database.');

  // Create migrations tracking table
  await client.query(`
    CREATE TABLE IF NOT EXISTS _migrations (
      id          SERIAL PRIMARY KEY,
      filename    TEXT UNIQUE NOT NULL,
      applied_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  const migrationsDir = path.join(__dirname, '../../prisma/migrations');
  const files = fs.readdirSync(migrationsDir)
    .filter(f => f.endsWith('.sql'))
    .sort();

  if (files.length === 0) {
    console.log('No migration files found.');
    await client.end();
    return;
  }

  let applied = 0;
  let skipped = 0;

  for (const file of files) {
    const { rows } = await client.query(
      'SELECT id FROM _migrations WHERE filename = $1',
      [file]
    );

    if (rows.length > 0) {
      console.log(`Skipping ${file} (already applied)`);
      skipped++;
      continue;
    }

    console.log(`Applying ${file}...`);
    const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');

    try {
      await client.query(sql);
      await client.query(
        'INSERT INTO _migrations (filename) VALUES ($1)',
        [file]
      );
      console.log(`  ${file} applied successfully.`);
      applied++;
    } catch (err) {
      console.error(`  ERROR applying ${file}:`, err.message);
      await client.end();
      process.exit(1);
    }
  }

  await client.end();
  console.log(`\nDone. ${applied} migration(s) applied, ${skipped} skipped.`);
}

migrate().catch(err => {
  console.error('Migration runner error:', err);
  process.exit(1);
});

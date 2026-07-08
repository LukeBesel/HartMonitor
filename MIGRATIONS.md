# Database Migration Guide

## Current state

The app uses SQLite (better-sqlite3) with the schema defined in `backend/src/db.js`.
All tables are created with `CREATE TABLE IF NOT EXISTS` on startup, and additive column
changes are applied via `ALTER TABLE` guards (checked with `PRAGMA table_info`).

The Prisma schema in `backend/prisma/schema.prisma` and the SQL migrations in
`backend/prisma/migrations/` represent the target Postgres/Supabase state.

---

## Migrating to Postgres (Supabase)

### Step 1: Set up Supabase

Follow the guide in `supabase/README.md`:

1. Create a new Supabase project
2. Copy the connection URI
3. Set `DATABASE_URL` in your environment

### Step 2: Export existing SQLite data

```bash
# Export all data from the running SQLite database
node backend/src/db/export-sqlite.js > backup.json
```

> Note: `export-sqlite.js` is a future helper script. For now, use the Supabase Table Editor
> or a tool like `sqlite3 data.db .dump > dump.sql` to manually export.

### Step 3: Run Postgres migrations

```bash
DATABASE_URL=postgresql://... node backend/src/db/migrate.js
```

This runs all files in `backend/prisma/migrations/` in order:
- `001_initial_schema.sql` — creates all tables and indexes
- `002_row_level_security.sql` — adds RLS policies for tenant isolation

### Step 4: Import data

```bash
DATABASE_URL=postgresql://... node backend/src/db/import-sqlite.js backup.json
```

> Note: `import-sqlite.js` is a future helper script. For now, use `psql` COPY commands
> or write a one-off import script using the Prisma client.

### Step 5: Switch DATABASE_URL in production

Update the `DATABASE_URL` environment variable on your hosting platform to point to Postgres.
The backend will use Postgres automatically when `DATABASE_URL` starts with `postgresql://`.

---

## Adding a new migration

1. Create a new file in `backend/prisma/migrations/` named `NNN_description.sql`
   (e.g. `003_add_customer_portal.sql`)
2. Write idempotent SQL — always use `IF NOT EXISTS` / `IF EXISTS` guards
3. Test on staging first: `DATABASE_URL=staging-url node backend/src/db/migrate.js`
4. Commit and deploy — the migration runner tracks which files have been applied in the
   `_migrations` table and will skip already-applied files

### Also update the Prisma schema

After writing the SQL migration, update `backend/prisma/schema.prisma` to match.
This keeps the schema file as the authoritative human-readable record of the full schema.

---

## Never do this

- Never `DROP TABLE` without a verified backup
- Never `ALTER COLUMN` in a way that truncates or loses data
- Never run raw schema changes directly on production without testing on staging
- Never commit the production `DATABASE_URL` to the repo
- Never run `supabase/seed.sql` on a production database

---

## Migration runner internals

`backend/src/db/migrate.js` connects to Postgres via `DATABASE_URL`, creates a
`_migrations` table if it doesn't exist, then iterates all `.sql` files in
`backend/prisma/migrations/` in alphabetical order. Files already recorded in
`_migrations` are skipped; new files are executed and recorded.

The migration SQL files are wrapped in `BEGIN; ... COMMIT;` transactions so a failed
migration rolls back cleanly without leaving partial state.

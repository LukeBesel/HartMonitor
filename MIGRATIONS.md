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

---

## SQLite numbered migrations (backend/src/db/migrations)

This is the live system. Postgres/Prisma above is the future; today every deploy
runs `backend/src/db/runMigrations.js`, which applies each `NNN_name.sql` file in
`backend/src/db/migrations/` exactly once and records it in `_schema_migrations`.
It is called from `backend/src/db.js` (at require time, before any seed or
backfill) and again from `backend/src/index.js` (a no-op second pass).

A file applies **wholly or not at all**: every statement plus its
`_schema_migrations` row runs inside one `db.transaction()`. SQLite DDL is
transactional in better-sqlite3, so a failed file leaves no table, no column and
no bookkeeping row behind — and the runner throws, so the server refuses to boot
rather than serve a schema it half-understands.

### Reserved migration numbers

One number per workstream. Claim yours here before you write the file; two agents
picking `006` in parallel worktrees is a merge conflict that only shows up at boot.

| Number | File prefix | Workstream key | Adds |
|---|---|---|---|
| 001 | `001_baseline.sql` | (shipped) | baseline marker |
| 002 | `002_plan_billing_columns.sql` | (shipped) | plan billing columns |
| 003 | `003_activity_log.sql` | (shipped) | activity_log |
| 004 | `004_sessions_cleanup_index.sql` | (shipped) | session cleanup indexes |
| 005 | `005_company_modules.sql` | (shipped) | per-company module toggles |
| 006 | `006_*.sql` | erp-door | ERP import/export door |
| 007 | `007_*.sql` | calls-escalate-and-pm-raises-jobs | andon calls + reason_codes |
| 008 | `008_*.sql` | calls-escalate-and-pm-raises-jobs | preventive maintenance (PM) |
| 009 | `009_*.sql` | work-orders-carry-operations | operations on work orders |
| 010 | `010_*.sql` | app-revisions-and-approval | app revisions + approval |
| 011 | `011_*.sql` | run-start-gated-and-one-tap | qualification gate on run start |
| 012 | `012_*.sql` | scrap-rework-and-coded-downtime | scrap/rework + coded downtime |

### Reserved test ports

A test that spawns a server holds a fixed port. Two suites on one port silently
cancel each other, so every stream gets its own block and uses only its own.

| Port | Workstream key |
|---|---|
| 3401 | migration-discipline |
| 3402 | one-definition-of-today |
| 3403 | one-guide |
| 3404 | honest-numbers-one-formatter |
| 3405 | settings-that-fit |
| 3406 | erp-door |
| 3407 | andon |
| 3408 | pm |
| 3409 | operations |
| 3410 | revisions |
| 3411 | qualification |
| 3412 | scrap |
| 3413 | downtime |
| 3414 | dispatch |
| 3415 | demo-seed |

Already in use elsewhere, do not reuse: existing tests hold **3171–3199**,
**3231–3258**, **3306** and **3308**; production runs on **3321**.

### Rules for a new .sql file

1. **Additive only.** No `DROP`, no `ALTER COLUMN`, no `DELETE`. A migration runs
   against a customer's live database on the next deploy; there is no down step.
2. **`IF NOT EXISTS` / `ADD COLUMN` only.** `CREATE TABLE IF NOT EXISTS`,
   `CREATE INDEX IF NOT EXISTS`, `ALTER TABLE … ADD COLUMN`. Re-adding something
   `db.js` already made raises "duplicate column name" / "already exists", which
   the runner tolerates per-statement; anything else aborts and rolls back the
   whole file.
3. **Vocabulary comes from `backend/src/vocab.js`.** Write a `CHECK` with
   `checkList('OPERATION_STATUS')` and validate the same column with
   `isValid('OPERATION_STATUS', v)`, so the constraint and the API cannot
   disagree. Those lists are frozen on first ship — SQLite cannot alter a CHECK
   in place, so changing one later means rebuilding the table on live data.
   Decide the whole vocabulary before the migration lands.
4. **Read the live schema first, not `db.js`.** The `CREATE TABLE` blocks in
   `db.js` are stale — columns were added by later `ALTER` guards, so the CREATE
   text no longer describes any real database. Check what is actually there:

   ```bash
   cp backend/mes.db /tmp/schema-peek.db          # never open the live file
   node -e "const D=require('better-sqlite3');const d=new D('/tmp/schema-peek.db',{readonly:true});
     console.log(d.prepare('PRAGMA table_info(work_orders)').all())"
   ```
5. **No `BEGIN`/`COMMIT` and no `PRAGMA` inside a file** — the runner owns the
   transaction, and a PRAGMA inside one is ignored. No `BEGIN…END` trigger
   bodies either: the runner splits on `;` (string- and comment-aware, but not a
   full SQL parser).
6. **Never renumber or edit a shipped file.** `_schema_migrations` keys on the
   filename; an edited file is never re-run, and a renamed one runs twice.

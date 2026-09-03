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
It is called from the **very end of `backend/src/db.js`** — after every
`CREATE TABLE` and guarded `ALTER` in that file, because db.js keeps creating
tables (andon_calls, pm_schedules, assets, routing_steps, completion_sessions
and two dozen more) long past its seed block, and a migration that ALTERs one of
them would pass on an existing database and throw "no such table" on a fresh
one. `backend/src/index.js` calls it again at boot; that is a no-op second pass.

Because that call sits in `db.js`, **migrations apply at `require('./db.js')`
time — before `index.js` validates configuration and before it can exit on a
fatal config error.** A process that dies on bad config has therefore already
written the schema; that is harmless (migrations are additive and idempotent),
but it is why a config error is not a way to stop a migration from landing.

Point the runner at a different directory with the `MIGRATIONS_DIR` environment
variable, or by passing a path as its second argument. Tests use both; nothing
in production sets it.

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
| 006 | `006_work_order_import_fields.sql` | erp-door | ERP import/export door |
| 007 | `007_andon_escalation_and_reason_codes.sql` | calls-escalate-and-pm-raises-jobs | andon calls + reason_codes (see note) |
| 008 | `008_pm_auto_raise.sql` | calls-escalate-and-pm-raises-jobs | preventive maintenance (PM) |
| 009 | `009_work_order_operations.sql` | work-orders-carry-operations | work_order_operations + release/hold columns on work_orders (see note) |
| 010 | `010_app_revisions.sql` | app-revisions-and-approval | app_revisions snapshots + `apps.current_revision` / `apps.requires_approval` / `completions.app_revision_id` |
| 011 | `011_qualification_overrides.sql` | run-start-gated-and-one-tap | qualification_overrides + completions.qualification_state (see note) |
| 012 | `012_scrap_rework_and_downtime_codes.sql` | scrap-rework-and-coded-downtime | `completions.quantity_good` / `quantity_scrap` / `quantity_rework` / `scrap_reason_code_id` / `work_order_operation_id` + `machine_events.reason_code_id` (see note) |

**Note on 012's six columns.** Every one of them is **nullable and carries no
default**, which is the whole point of the file. `NULL` means *nobody counted*;
`0` means *somebody counted, and the answer was zero*. Those are different facts,
and defaulting the counts to zero would have silently rewritten every run that
ever finished into a measurement that never happened — first-pass yield would
then be computed over a denominator the plant never provided. A run that records
nothing still books one unit against its work order, exactly as before.

The two `*_reason_code_id` columns point at `reason_codes(id)` from 007 but are
**not declared foreign keys**, because SQLite only accepts a key inside a
`CREATE TABLE` and both tables predate this file by years. Ownership is checked
in the routes that write them, which is where the tenant check has to live in
any case: `machine_events` has no `company_id` column at all, so a stop's reason
code is resolved through `stations.company_id`.

**Note on 011's `completions.qualification_state`.** It carries a value from
`vocab.QUALIFICATION_STATE` or `''`, and it has **no CHECK constraint** — the
only column in this schema that quotes a vocabulary without one. Two reasons,
both deliberate. `''` means *not measured* (the company has enforcement off, or
the app asks for no certification), which is a real answer and not a vocabulary
value; and unlike a status word this list is expected to grow, while a CHECK
could never be altered afterwards without rebuilding `completions` on live
customer data. `backend/src/qualification.js` validates the value in JS at the
one place that writes it. The enforcement mode itself is not a column at all:
it is an `org_settings` row, key `training_enforcement`, absent meaning `off`.

**Note on 007's `reason_codes.loss_bucket`.** Its CHECK list is `''` followed by
`vocab.LOSS_BUCKET`, in that order. The empty string is not a vocabulary value
and is deliberately absent from `vocab.js`: it means **"no OEE loss bucket"** —
the honest answer for every scrap and rework reason, which explain a defect
rather than a stoppage. Only a downtime reason rolls into one of the six losses.
The column is `NOT NULL DEFAULT ''`, so "unbucketed" is a stated value and never
a NULL to be interpreted. `backend/test/andon-escalation.test.js` asserts the
file's list equals `['', ...vocab.LOSS_BUCKET]`, so the two cannot drift — and
the CHECK cannot be altered later without rebuilding the table.

**Note on 009's `work_order_operations.status`.** Its CHECK list is
`vocab.OPERATION_STATUS`, quoted verbatim and in order.
`backend/test/wo-operations.test.js` compares the file's list to the array, so
the two cannot drift — and, as with every CHECK, it cannot be changed later
without rebuilding the table on live data. Note what is **not** in that list:
there is no `hold` status. A job on hold keeps whatever operation status it had
and carries `work_orders.hold_reason`, because a status word cannot say *why* —
and `work_orders.status` has its own frozen CHECK that could not have taken a
new word in any case.

Both foreign keys — `work_order_id REFERENCES work_orders(id) ON DELETE
CASCADE` and `company_id REFERENCES organizations(id)` — are in the CREATE
TABLE and had to be: SQLite has no `ALTER TABLE ADD CONSTRAINT`, so a foreign
key missing on first ship stays missing until somebody rebuilds the table on
live data. `DELETE /api/work-orders/:id` also deletes the operations by hand,
because the cascade only fires while `PRAGMA foreign_keys` is ON and a database
opened by another tool has it OFF.

The file also adds `quantity_rework` alongside `quantity_scrapped`.
`workOrderOperations.advance()` accepts `{ good, scrap, rework }` today and
stores all three; wave 4's coded scrap/rework screens write them. A count with
nowhere to be stored is a count that gets folded into "good".

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
| 3416 | demo-dead-ends (post-audit demo fixes) |
| 3417 | guards-words (wave 6: the daily brief's scope guard) |
| 3418 | guards-words (wave 6: the department board's takt in seconds) |
| 3419 | guards-words (wave 6: role words on the app screens) |
| 3420 | seed-search (wave 6: the demo's race, and search by part name) |

Already in use elsewhere, do not reuse: existing tests hold **3171–3199**,
**3231–3258**, **3306** and **3308**. The app's default port is **3001**
(`Dockerfile`, `DEPLOYMENT.md`); on a hosted deploy the platform sets `PORT`.

**This table supersedes the port registry in `OPUS_PLAN.md` §2.4.** That section
told new suites to take 3175 downward and agent scratch servers 3201 upward;
suites now claim a port here, and scratch servers use **3501 upward**.
`OPUS_PLAN.md` has been updated to point back at this table — one registry, not
two.

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
5. **No `BEGIN`, `COMMIT`, `PRAGMA` or `END` statements** — the runner rejects
   them and the file fails to apply. The runner owns the transaction, so a
   `BEGIN`/`COMMIT` would fight it; a schema `PRAGMA` inside a transaction is
   *silently ignored* by SQLite, so a file that relied on one would be recorded
   as applied having changed nothing. `END` is refused because a `BEGIN…END`
   trigger body cannot survive the splitter, which cuts on `;` outside strings
   and comments. Quoting is understood for `'string'`, `"ident"`, `` `ident` ``
   and `[ident]`, so a semicolon inside any of those is safe.
6. **Never renumber or edit a shipped file.** `_schema_migrations` keys on the
   filename; an edited file is never re-run, and a renamed one runs twice.

# Safe Schema Upgrades

## Rule #1: Never destroy data

All database changes MUST be additive. Never in a migration:
- DROP TABLE
- DROP COLUMN
- ALTER COLUMN type
- RENAME COLUMN
- RENAME TABLE

## How to add a new column

1. Create a new migration file in `backend/src/db/migrations/`
2. Name it `NNN_description.sql` where NNN is the next sequential number
3. Write only `ALTER TABLE tablename ADD COLUMN columnname type DEFAULT value;`
4. The migration runs automatically on next server startup

## How to add a new table

```sql
CREATE TABLE IF NOT EXISTS new_table (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  company_id TEXT NOT NULL,
  -- ... other columns
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_new_table_company ON new_table(company_id);
```

## Renaming a column (safe pattern)

1. Add a new column with the new name (migration)
2. In the backend code, read from both old and new column (handle both)
3. On next deployment, copy data: `UPDATE table SET new_name = old_name WHERE new_name IS NULL`
4. Eventually deprecate reading the old column (in a future release)
5. Never remove the old column (unless you are 100% sure it is empty)

## How the migration runner works

- Migration files live in `backend/src/db/migrations/` and are sorted by filename
- Each file runs exactly once; completions are tracked in `_schema_migrations`
- Statements are executed one at a time so a "duplicate column" on one line does not block the rest
- "already exists" and "duplicate column name" errors are silently ignored (idempotent)
- Any other error crashes the server — safer than running with a broken schema

## Testing migrations

Run locally:

```bash
NODE_ENV=development node backend/src/index.js
```

Then verify all migrations applied:

```bash
sqlite3 <path-to-db> "SELECT filename, applied_at FROM _schema_migrations ORDER BY id;"
```

## Checklist before deploying a schema change

- [ ] Migration file is named `NNN_description.sql` with the next sequential number
- [ ] Migration only uses `ALTER TABLE ... ADD COLUMN`, `CREATE TABLE IF NOT EXISTS`, or `CREATE INDEX IF NOT EXISTS`
- [ ] No DROP, RENAME, or type-change statements
- [ ] Tested locally — server starts and `_schema_migrations` shows the new file applied
- [ ] New columns have sensible DEFAULT values so existing rows are valid immediately

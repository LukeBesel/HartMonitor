# Supabase Setup for HartMonitor MES

## 1. Create project

1. Go to https://supabase.com and sign in
2. Click **New Project**
3. Name: `hartmonitor-production` (or `hartmonitor-staging` for staging)
4. Database password: generate a strong random password and save it in your password manager
5. Region: pick the region closest to your users
6. Click **Create new project** and wait ~2 minutes for provisioning

## 2. Get connection string

1. Go to **Settings** → **Database** → **Connection string**
2. Select **URI** mode
3. Copy the connection string (it looks like `postgresql://postgres:[password]@[host]:5432/postgres`)
4. Add it to your environment:
   ```
   DATABASE_URL=postgresql://postgres:[password]@[host]:5432/postgres
   ```

## 3. Run migrations

From the repo root:

```bash
DATABASE_URL=postgresql://... node backend/src/db/migrate.js
```

This will create all tables and indexes by running:
- `001_initial_schema.sql` — full schema
- `002_row_level_security.sql` — RLS policies for multi-tenant isolation

## 4. Verify

1. Go to **Table Editor** in Supabase — you should see all tables
2. Go to **Authentication** → **Users** — should be empty (HartMonitor uses its own auth, not Supabase Auth)

## 5. Configure your app

Update your backend `.env` or deployment environment variables:

```env
DATABASE_URL=postgresql://postgres:[password]@[host]:5432/postgres
NODE_ENV=production
```

The backend will automatically use Postgres when `DATABASE_URL` starts with `postgresql://`.

## Environment variables

| Variable       | Description                                  |
|----------------|----------------------------------------------|
| `DATABASE_URL` | Full Postgres connection URI from Supabase   |
| `NODE_ENV`     | Set to `production` in prod                  |

## Connection pooling (production)

For production traffic, use Supabase's connection pooler instead of the direct connection:

1. **Settings** → **Database** → **Connection string** → select **Transaction** mode (port 6543)
2. Use this URI as `DATABASE_URL` in production for better connection handling under load

## Troubleshooting

- **"relation does not exist"**: migrations haven't been run — execute `node backend/src/db/migrate.js`
- **RLS errors**: make sure the backend sets `SET LOCAL app.company_id = '...'` before queries, or use the service role key to bypass RLS for admin operations
- **SSL errors**: add `?sslmode=require` to the connection string if connecting from outside Supabase's network

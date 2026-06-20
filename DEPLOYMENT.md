# HartMonitor MES — Deployment Runbook

## Environments

| Environment | URL | Branch | Auto-deploy |
|---|---|---|---|
| Production | https://app.hartmonitor.io | main | Yes, after CI passes |
| Staging | https://staging.hartmonitor.io | staging | Yes, after CI passes |

## Deploy Procedure

### Normal deploy (recommended)
1. Create a feature branch: `git checkout -b feature/your-feature`
2. Make changes, push, open PR to `staging`
3. CI runs automatically — must pass before merge
4. Merge to `staging` → auto-deploys to staging
5. Verify on staging: check `/api/health`, test the feature
6. Open PR from `staging` to `main`
7. Merge to `main` → auto-deploys to production
8. Monitor Sentry and Better Uptime for 30 minutes post-deploy

### Hotfix procedure (skip staging for critical fixes)
1. Create `hotfix/description` branch from `main`
2. Make fix, push, open PR directly to `main`
3. Requires 2 approvals + CI pass
4. Merge to `main` → deploys to production
5. Cherry-pick the commit to `staging`: `git cherry-pick <sha>`

## Rollback

### Automatic (preferred)
1. Go to GitHub → Actions → "Rollback Production" workflow
2. Click "Run workflow"
3. Enter the commit SHA you want to roll back to
4. Click "Run workflow"
5. Monitor `/api/health` until it returns `{"status":"ok"}`

### Manual via Render dashboard
1. Go to https://dashboard.render.com
2. Select the service (hartmonitor-production)
3. Click "Deploys" tab
4. Find the last successful deploy
5. Click "..." → "Redeploy"

## Database Backup & Restore

### Check backup status
```
GET https://app.hartmonitor.io/api/health
# Check the "last_backup" field
```

### Restore from backup
```bash
# 1. SSH into the Render instance (or use Render Shell)
# 2. Find the encrypted backup
ls /data/backups/

# 3. Decrypt and restore
node backend/src/restore.js /data/backups/mes-2024-01-15T06-00-00.db.enc /tmp/restore.db

# 4. Stop the app (put in maintenance mode first)
# 5. Replace the database file
cp /data/mes.db /data/mes.db.pre-restore
cp /tmp/restore.db /data/mes.db

# 6. Restart the service from the Render dashboard
```

## Environment Variables

All secrets are set in the Render dashboard under "Environment" for each service.
Never commit secrets to the repository.

Required for production:
- `NODE_ENV=production`
- `DATABASE_PATH=/data/mes.db`
- `APP_URL=https://app.hartmonitor.io`
- `STRIPE_SECRET_KEY` (from Stripe Dashboard)
- `STRIPE_WEBHOOK_SECRET` (from Stripe Dashboard → Webhooks)
- `SMTP_HOST`, `SMTP_USER`, `SMTP_PASS` (SendGrid)
- `BACKUP_ENCRYPTION_KEY` (64 hex chars, generate with: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`)

## Adding a New User (Admin)
1. Go to `https://app.hartmonitor.io/login`
2. Sign up with the company's email
3. The first user in a company is automatically `manager` role
4. Promote to `developer` if needed via `PUT /api/users/:id` with `{ "role": "developer" }`

## Monitoring
- Uptime: https://status.hartmonitor.io
- Errors: https://sentry.io (project: hartmonitor-mes)
- Logs: Render Dashboard → Logs tab

// Load local .env if present (production platforms inject env vars directly).
try { require('dotenv').config(); } catch { /* dotenv optional */ }

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const path = require('path');
const http = require('http');

const { config, validate, banner } = require('./config');
const { stripeWebhook } = require('./webhook');
const { initWebSocketServer } = require('./ws');
const { startBackups } = require('./backup');
const { PRICING } = require('./pricing');

const appsRouter        = require('./routes/apps');
const completionsRouter = require('./routes/completions');
const tablesRouter      = require('./routes/tables');
const stationsRouter    = require('./routes/stations');
const analyticsRouter   = require('./routes/analytics');
const { router: workOrdersRouter } = require('./routes/workorders');
const departmentsRouter  = require('./routes/departments');
const productTypesRouter = require('./routes/product-types');
const oeeRouter          = require('./routes/oee');
const dashboardsRouter   = require('./routes/dashboards');
const inventoryRouter    = require('./routes/inventory');
const purchasingRouter   = require('./routes/purchasing');
const qualityRouter      = require('./routes/quality');
const configRouter       = require('./routes/config');
const exportRouter       = require('./routes/export');
const authRouter         = require('./routes/auth');
const usersRouter        = require('./routes/users');
const leaderboardRouter  = require('./routes/leaderboard');
const activityRouter     = require('./routes/activity');
const messagesRouter     = require('./routes/messages');
const sitesRouter        = require('./routes/sites');
const permissionsRouter  = require('./routes/permissions');
const developerRouter    = require('./routes/developer');
const notificationsRouter = require('./routes/notifications');
const v1Router           = require('./routes/v1');
const gameRouter         = require('./routes/game');
const { requireAuth }    = require('./middleware/auth');
const { requirePlan }    = require('./middleware/plan');
const { apiKeyAuth }     = require('./middleware/apiKeyAuth');

// ─── Startup validation ───────────────────────────────────────────────────────
const { warnings, errors } = validate();
console.log(banner());
for (const w of warnings) console.warn(`  ⚠  ${w}`);
if (errors.length) {
  for (const e of errors) console.error(`  ✖  ${e}`);
  console.error('\nRefusing to start with the above configuration errors.\n');
  process.exit(1);
}

const app  = express();
const PORT = config.port;

// Behind a single platform proxy (Railway/Render/nginx) — needed so rate
// limiting and logging see the real client IP, not the proxy's.
app.set('trust proxy', 1);

// Security headers. CSP is left off because the SPA relies heavily on inline
// styles; the other protections (HSTS, no-sniff, frameguard, etc.) still apply.
app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));

// ─── CORS ─────────────────────────────────────────────────────────────────────
// The frontend is served from the same origin as the API, so cross-origin access
// is only needed for external integrations. Locked to an allowlist in production,
// but genuine same-origin requests (the bundled SPA calling its own API) are
// ALWAYS allowed — even if APP_URL wasn't configured — so the app works out of
// the box on any single-service host.
function corsDelegate(req, cb) {
  if (!config.isProd) return cb(null, { origin: true, credentials: true });

  const reqOrigin = req.headers.origin;
  // No Origin header (server-to-server, curl, health probes) → allow.
  if (!reqOrigin) return cb(null, { origin: true, credentials: true });

  const allow = new Set(config.allowedOrigins);
  if (config.appUrl) allow.add(config.appUrl);

  // Same-origin: the request's Origin host matches the host it was sent to.
  let sameOrigin = false;
  try { sameOrigin = new URL(reqOrigin).host === req.headers.host; } catch { /* malformed origin */ }

  cb(null, { origin: sameOrigin || allow.has(reqOrigin), credentials: true });
}
app.use(cors(corsDelegate));

// ─── Lightweight request logging ──────────────────────────────────────────────
app.use((req, res, next) => {
  if (!req.path.startsWith('/api')) return next();   // skip static asset noise
  const start = Date.now();
  res.on('finish', () => {
    console.log(`${req.method} ${req.originalUrl} ${res.statusCode} ${Date.now() - start}ms`);
  });
  next();
});

// ─── Rate limiting ────────────────────────────────────────────────────────────
const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 1000,                       // generous; protects against runaway clients
  standardHeaders: true,
  legacyHeaders: false,
});
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,                         // brute-force protection on credentials
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many attempts. Please wait a few minutes and try again.', code: 'RATE_LIMITED' },
});

// ─── Health check (for platform probes / uptime monitors) ─────────────────────
app.get('/api/health', (_req, res) => {
  let dbOk = true;
  try { require('./db').prepare('SELECT 1').get(); } catch { dbOk = false; }
  res.status(dbOk ? 200 : 503).json({
    status: dbOk ? 'ok' : 'degraded',
    uptime: Math.round(process.uptime()),
    timestamp: new Date().toISOString(),
  });
});

// Stripe webhook needs the raw body for signature verification, so it must be
// registered before the JSON parser and outside requireAuth.
app.post('/api/webhooks/stripe', express.raw({ type: 'application/json' }), stripeWebhook);

app.use(express.json({ limit: '10mb' }));

// Throttle credential endpoints specifically, then everything under /api.
app.use('/api/auth/login',           authLimiter);
app.use('/api/auth/signup',          authLimiter);
app.use('/api/auth/change-password', authLimiter);
app.use('/api', generalLimiter);

// Method-aware role gate: reads (GET) stay open to any authenticated member,
// but writes (POST/PUT/PATCH/DELETE) require at least the given role. Keeps
// read-only "viewer" accounts from mutating data and reserves config changes
// for supervisors and up, without per-route boilerplate.
const { requireRole } = require('./middleware/auth');
function writeRole(minRole) {
  const guard = requireRole(minRole);
  return (req, res, next) => (req.method === 'GET' ? next() : guard(req, res, next));
}

app.use('/api/auth',          authRouter);  // public
app.use('/api/game',          gameRouter);  // public — no auth required

// Public pricing catalog — powers the marketing site without authentication.
app.get('/api/public/pricing', (_req, res) => res.json(PRICING));

// Enterprise API v1 — authenticated with a long-lived API key, not a session.
app.use('/api/v1', apiKeyAuth, v1Router);

app.use('/api',               requireAuth); // protect everything below
app.use('/api/apps',          writeRole('supervisor'), appsRouter);
app.use('/api/completions',   writeRole('operator'),   completionsRouter);
app.use('/api/tables',        writeRole('supervisor'), tablesRouter);
app.use('/api/stations',      writeRole('supervisor'), stationsRouter);
app.use('/api/analytics',     analyticsRouter);
app.use('/api/work-orders',   writeRole('supervisor'), workOrdersRouter);
app.use('/api/departments',   writeRole('supervisor'), departmentsRouter);
app.use('/api/product-types', writeRole('supervisor'), productTypesRouter);
app.use('/api/oee',           oeeRouter);
app.use('/api/dashboards',    writeRole('supervisor'), dashboardsRouter);
// Pro-tier features — enforced at the API layer, not just hidden in the UI.
// Operators can file NCRs from the floor; resolving/deleting them needs supervisor (guarded inside).
app.use('/api/inventory',     requirePlan('pro'), writeRole('supervisor'), inventoryRouter);
app.use('/api/purchasing',    requirePlan('pro'), writeRole('supervisor'), purchasingRouter);
app.use('/api/quality',       requirePlan('pro'), writeRole('operator'),   qualityRouter);
app.use('/api/config',        configRouter);
app.use('/api/export',        exportRouter);
app.use('/api/users',         usersRouter);
app.use('/api/leaderboard',   leaderboardRouter);
app.use('/api/activity',      activityRouter);
app.use('/api/messages',      messagesRouter);
app.use('/api/sites',         sitesRouter);
app.use('/api/permissions',   permissionsRouter);
app.use('/api/developer',     developerRouter);
app.use('/api/notifications', notificationsRouter);

// Unknown API routes return JSON 404 (not the SPA shell).
app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found', code: 'NOT_FOUND' }));

// ─── Static frontend + SPA fallback ───────────────────────────────────────────
const frontendDist = path.join(__dirname, '..', '..', 'frontend', 'dist');
app.use(express.static(frontendDist));
app.get('*', (_req, res) => {
  res.sendFile(path.join(frontendDist, 'index.html'));
});

// ─── Central error handler ────────────────────────────────────────────────────
// Catches thrown/async errors so the process never crashes and stack traces are
// never leaked to clients in production.
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, _next) => {
  console.error('[error]', req.method, req.originalUrl, '-', err.message);
  if (res.headersSent) return;
  const status = err.status || 500;
  res.status(status).json({
    error: config.isProd ? 'Internal server error' : err.message,
    code: err.code || 'INTERNAL_ERROR',
  });
});

const server = http.createServer(app);
initWebSocketServer(server);

server.listen(PORT, () => {
  console.log(`HartMonitor backend running on http://localhost:${PORT}`);
  startBackups();
});

// ─── Resilience: never let an unhandled error take the process down silently ──
process.on('unhandledRejection', (reason) => console.error('[unhandledRejection]', reason));
process.on('uncaughtException',  (err)    => console.error('[uncaughtException]', err));

// ─── Graceful shutdown ────────────────────────────────────────────────────────
function shutdown(signal) {
  console.log(`\n${signal} received — shutting down gracefully…`);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 10_000).unref();   // force-exit safety net
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT',  () => shutdown('SIGINT'));

module.exports = app;

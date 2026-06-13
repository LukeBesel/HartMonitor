// Load local .env if present (production platforms inject env vars directly).
try { require('dotenv').config(); } catch { /* dotenv optional */ }

const express = require('express');
const cors = require('cors');
const path = require('path');
const { stripeWebhook } = require('./webhook');

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
const { requireAuth }    = require('./middleware/auth');

const app  = express();
const PORT = process.env.PORT || 3001;

app.use(cors());

// Stripe webhook needs the raw body for signature verification, so it must be
// registered before the JSON parser and outside requireAuth.
app.post('/api/webhooks/stripe', express.raw({ type: 'application/json' }), stripeWebhook);

app.use(express.json({ limit: '10mb' }));

app.use('/api/auth',          authRouter);  // public
app.use('/api',               requireAuth); // protect everything below
app.use('/api/apps',          appsRouter);
app.use('/api/completions',   completionsRouter);
app.use('/api/tables',        tablesRouter);
app.use('/api/stations',      stationsRouter);
app.use('/api/analytics',     analyticsRouter);
app.use('/api/work-orders',   workOrdersRouter);
app.use('/api/departments',   departmentsRouter);
app.use('/api/product-types', productTypesRouter);
app.use('/api/oee',           oeeRouter);
app.use('/api/dashboards',    dashboardsRouter);
app.use('/api/inventory',     inventoryRouter);
app.use('/api/purchasing',    purchasingRouter);
app.use('/api/quality',       qualityRouter);
app.use('/api/config',        configRouter);
app.use('/api/export',        exportRouter);
app.use('/api/users',         usersRouter);
app.use('/api/leaderboard',   leaderboardRouter);

const frontendDist = path.join(__dirname, '..', '..', 'frontend', 'dist');
app.use(express.static(frontendDist));
app.get('*', (req, res) => {
  res.sendFile(path.join(frontendDist, 'index.html'));
});

app.listen(PORT, () => {
  console.log(`HartMonitor backend running on http://localhost:${PORT}`);
});

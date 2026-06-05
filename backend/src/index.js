const express = require('express');
const cors = require('cors');
const path = require('path');

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

const app  = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json({ limit: '10mb' }));

app.use('/api/apps',          appsRouter);
app.use('/api/completions',   completionsRouter);
app.use('/api/tables',        tablesRouter);
app.use('/api/stations',      stationsRouter);
app.use('/api/analytics',     analyticsRouter);
app.use('/api/work-orders',   workOrdersRouter);
app.use('/api/departments',   departmentsRouter);
app.use('/api/product-types', productTypesRouter);
app.use('/api/oee',          oeeRouter);
app.use('/api/dashboards',   dashboardsRouter);

const frontendDist = path.join(__dirname, '..', '..', 'frontend', 'dist');
app.use(express.static(frontendDist));
app.get('*', (req, res) => {
  res.sendFile(path.join(frontendDist, 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Claude MES backend running on http://localhost:${PORT}`);
});

const router = require('express').Router();
const db = require('../db');
const { version } = require('../../package.json');

router.get('/', (req, res) => {
  let dbOk = true;
  try {
    db.prepare('SELECT 1').get();
  } catch {
    dbOk = false;
  }

  const response = {
    status: dbOk ? 'ok' : 'degraded',
    version,
    timestamp: new Date().toISOString(),
    uptime: Math.floor(process.uptime()),
    nodeVersion: process.version,
    memoryMB: Math.round(process.memoryUsage().rss / 1024 / 1024),
    db: dbOk ? 'connected' : 'disconnected',
  };

  if (process.env.DATABASE_PATH) {
    try {
      const { statSync } = require('fs');
      const bytes = statSync(process.env.DATABASE_PATH).size;
      response.dbSizeMB = Math.round((bytes / 1024 / 1024) * 10) / 10;
    } catch { /* file not yet created — omit the field */ }
  }

  res.status(dbOk ? 200 : 503).json(response);
});

module.exports = router;

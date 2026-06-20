const router = require('express').Router();
const db = require('../db');
const { version } = require('../../package.json');

router.get('/', (req, res) => {
  try {
    // Quick DB ping
    db.prepare('SELECT 1').get();
    res.json({
      status: 'ok',
      version,
      timestamp: new Date().toISOString(),
      uptime: Math.floor(process.uptime()),
      db: 'connected',
    });
  } catch (err) {
    res.status(503).json({ status: 'degraded', db: 'disconnected', error: err.message });
  }
});

module.exports = router;

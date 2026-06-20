const pino = require('pino');
const { config } = require('./config');
const logger = pino({
  level: config.isProd ? 'info' : 'debug',
  transport: config.isProd ? undefined : { target: 'pino-pretty', options: { colorize: true } },
});
module.exports = logger;

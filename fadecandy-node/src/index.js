import winston from 'winston';
import FadeCandyManager from './fadecandy/FadeCandyManager.js';
import HomeAssistantBridge from './ha/HomeAssistantBridge.js';
import MonitorServer from './server/MonitorServer.js';
import { logFadecandyStatus } from './usbUtils.js';

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'debug',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.printf(({ level, message, timestamp }) => `${timestamp} [${level}] ${message}`),
  ),
  transports: [new winston.transports.Console()],
});

// Default to 7890 to match add-on port mapping in config.yaml
const PORT = Number(process.env.PORT || 7890);
let manager;

// Log exit/crash reasons to understand restarts under HA Supervisor
process.on('exit', (code) => logger.warn(`Process exiting with code ${code}`));
process.on('uncaughtException', (err) => {
  logger.error(`Uncaught exception: ${err.stack || err.message || err}`);
  setTimeout(() => process.exit(1), 50); // allow log flush then crash so supervisor can restart
});

process.on('unhandledRejection', (reason) => {
  logger.error(`Unhandled rejection: ${reason && reason.stack ? reason.stack : reason}`);
  setTimeout(() => process.exit(1), 50);
});

['SIGTERM', 'SIGINT'].forEach((sig) =>
  process.on(sig, () => {
    logger.warn(`Received ${sig}, shutting down`);
    manager?.stopAnimation();
    manager?.clear();
    process.exit(0);
  }),
);

async function main() {
  logger.info('Starting Fadecandy Node add-on service');

  manager = new FadeCandyManager({ logger });
  const haBridge = new HomeAssistantBridge({ manager, logger });
  const monitor = new MonitorServer({ port: PORT, manager, haBridge, logger });

  logFadecandyStatus(logger);
  setInterval(() => logFadecandyStatus(logger), 30000);

  try {
    await monitor.start();
  } catch (err) {
    logger.error(`Unable to start monitor server: ${err.message}`);
    setTimeout(() => process.exit(1), 50);
  }

  try {
    await manager.waitUntilReady(8000);
  } catch (err) {
    logger.warn(`Fadecandy not ready yet: ${err.message}`);
  }
}

main();

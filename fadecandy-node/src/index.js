import usb from 'usb';
import express from 'express';
import winston from 'winston';
import FadeCandy from "./fa/FadeCandy.js"

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.printf(({ level, message, timestamp }) => `${timestamp} [${level}] ${message}`)
  ),
  transports: [new winston.transports.Console()]
});

const FADECANDY_VENDOR_ID = 0x1d50;
const FADECANDY_PRODUCT_ID = 0x607a;

const app = express();
// Default to 7890 to match add-on port mapping in config.yaml
const PORT = Number(process.env.PORT || 7890);

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
    process.exit(0);
  })
);



let fadeCandyReady = false;

let fadeCandy = new FadeCandy();

fadeCandy.on(FadeCandy.events.READY, (fc) => {

  logger.info('Fadecandy is ready');
    fc.config.set(FadeCandy.Configuration.schema.DISABLE_KEYFRAME_INTERPOLATION, 0);
    fc.clut.create();
  });
  
fadeCandy.on(FadeCandy.events.COLOR_LUT_READY, (fc) => {
   logger.info('Color LUT ready');
    fadeCandyReady = true;
  });


app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.get('/usb', (_req, res) => {
  res.json({ devices: listUsb() });
});

app.get('/on', (_req, res) => {

  if(fadeCandyReady)
  {
    fadeCandy.send([250,250,250,250,250,250,250,250,250,250,250,250,250,250,250])
    res.json({ status: "ok" });
  }else
  {
    res.json({ status: "not ready" });
  }
});

app.get('/off', (_req, res) => {

  if(fadeCandyReady)
  {
    fadeCandy.send([0,0,0,0,0,0,0,0,0,0,0,0,0,0,0])
    res.json({ status: "ok" });
  }else
  {
    res.json({ status: "not ready" });
  }
});


function listUsb() {
  return usb.getDeviceList().map((device) => {
    const { idVendor, idProduct } = device.deviceDescriptor || {};
    return {
      vendorId: idVendor,
      productId: idProduct,
      fadecandy: idVendor === FADECANDY_VENDOR_ID && idProduct === FADECANDY_PRODUCT_ID
    };
  });
}

function logFadecandyStatus() {
  const matches = listUsb().filter((d) => d.fadecandy);
  if (matches.length === 0) {
    logger.warn('Fadecandy not detected on USB bus');
  } else {
    matches.forEach((device, idx) => {
      logger.info(`Fadecandy detected (index ${idx}) VID:PID ${device.vendorId.toString(16)}:${device.productId.toString(16)}`);
    });
  }
}

function main() {
  logger.info('Starting Fadecandy Node add-on service');
  logFadecandyStatus();
  setInterval(logFadecandyStatus, 30000);

  const server = app.listen(PORT, () => logger.info(`Health/USB endpoint listening on ${PORT}`));
  server.on('error', (err) => {
    logger.error(`Server error on listen: ${err.code || err.message}`, err);
    setTimeout(() => process.exit(1), 50);
  });
}

main();

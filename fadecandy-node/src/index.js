import usb from 'usb';
import express from 'express';
import winston from 'winston';

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
const PORT = process.env.PORT || 7890;

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.get('/usb', (_req, res) => {
  res.json({ devices: listUsb() });
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

  app.listen(PORT, () => logger.info(`Health/USB endpoint listening on :${PORT}`));
}

main();

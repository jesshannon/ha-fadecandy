import usb from 'usb';

export const FADECANDY_VENDOR_ID = 0x1d50;
export const FADECANDY_PRODUCT_ID = 0x607a;

export function listUsb() {
  return usb.getDeviceList().map((device) => {
    const { idVendor, idProduct } = device.deviceDescriptor || {};
    return {
      vendorId: idVendor,
      productId: idProduct,
      fadecandy: idVendor === FADECANDY_VENDOR_ID && idProduct === FADECANDY_PRODUCT_ID,
    };
  });
}

export function logFadecandyStatus(logger) {
  const matches = listUsb().filter((d) => d.fadecandy);
  if (matches.length === 0) {
    logger?.warn?.('Fadecandy not detected on USB bus');
  } else {
    matches.forEach((device, idx) => {
      logger?.info?.(
        `Fadecandy detected (index ${idx}) VID:PID ${device.vendorId.toString(16)}:${device.productId.toString(16)}`,
      );
    });
  }
}

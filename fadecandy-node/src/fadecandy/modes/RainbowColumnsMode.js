const DEFAULT_FRAME_RATE_MS = 50;

function hsvToRgb(h, s, v) {
  const c = v * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = v - c;
  let [r1, g1, b1] = [0, 0, 0];

  if (h >= 0 && h < 60) [r1, g1, b1] = [c, x, 0];
  else if (h < 120) [r1, g1, b1] = [x, c, 0];
  else if (h < 180) [r1, g1, b1] = [0, c, x];
  else if (h < 240) [r1, g1, b1] = [0, x, c];
  else if (h < 300) [r1, g1, b1] = [x, 0, c];
  else [r1, g1, b1] = [c, 0, x];

  return {
    r: Math.round((r1 + m) * 255),
    g: Math.round((g1 + m) * 255),
    b: Math.round((b1 + m) * 255),
  };
}

export default class RainbowColumnsMode {
  constructor(manager) {
    this.manager = manager;
    this.id = 'rainbowColumns';
    this.name = 'Rainbow Columns';
  }

  start({ speed = 120 } = {}) {
    let hue = 0;
    const columnCount = this.manager.mapping.length;
    const shelvesPerColumn = this.manager.mapping[0]?.length || 0;
    const timer = setInterval(() => {
      for (let col = 0; col < columnCount; col += 1) {
        const offsetHue = (hue + col * 40) % 360;
        const rgb = hsvToRgb(offsetHue, 1, 1);
        for (let shelf = 0; shelf < shelvesPerColumn; shelf += 1) {
          this.manager.setShelfColor(col, shelf, rgb, { flush: false });
        }
      }
      hue = (hue + speed / 10) % 360;
    }, DEFAULT_FRAME_RATE_MS);

    return () => clearInterval(timer);
  }
}

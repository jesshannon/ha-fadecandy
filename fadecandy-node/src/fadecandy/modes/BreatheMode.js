const DEFAULT_FRAME_RATE_MS = 50;

export default class BreatheMode {
  constructor(manager) {
    this.manager = manager;
    this.id = 'breathe';
    this.name = 'Breathe';
  }

  start({ color = { r: 140, g: 190, b: 255 }, durationMs = 2400 } = {}) {
    let t = 0;
    const timer = setInterval(() => {
      const phase = (Math.sin((2 * Math.PI * t / 2.5) / durationMs) + 1) / 2;
      const next = {
        r: Math.round(color.r * phase),
        g: Math.round(color.g * phase),
        b: Math.round(color.b * phase),
      };
      this.manager.setAllShelves(next);
      t += DEFAULT_FRAME_RATE_MS;
    }, DEFAULT_FRAME_RATE_MS);

    return () => clearInterval(timer);
  }
}

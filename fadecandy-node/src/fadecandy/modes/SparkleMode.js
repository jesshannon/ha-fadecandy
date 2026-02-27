const DEFAULT_FRAME_RATE_MS = 300;

export default class SparkleMode {
  constructor(manager) {
    this.manager = manager;
    this.id = 'sparkle';
    this.name = 'Sparkle';
  }

  start({ density = 0.08, base = { r: 5, g: 5, b: 5 } } = {}) {
    const timer = setInterval(() => {
      this.manager.frame.fill(0);
      this.manager.setAllShelves(base, { flush: false, notify: false });
      const pixelTotal = this.manager.pixelCount;
      const sparkles = Math.max(1, Math.floor(pixelTotal * density));
      for (let i = 0; i < sparkles; i += 1) {
        const idx = Math.floor(Math.random() * pixelTotal);
        const baseIndex = idx * 3;
        this.manager.frame[baseIndex] = 255;
        this.manager.frame[baseIndex + 1] = 255;
        this.manager.frame[baseIndex + 2] = 255;
      }
    }, DEFAULT_FRAME_RATE_MS);

    return () => clearInterval(timer);
  }
}

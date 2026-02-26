import { EventEmitter } from 'events';
import FadeCandy from '../fa/FadeCandy.js';
import { BOOKSHELF_MAP, getShelfRanges, listShelves, maxPixelIndex } from '../config/bookshelfMap.js';

const DEFAULT_FRAME_RATE_MS = 50; // 20 FPS for testing/animation

function clampColor(value) {
  const v = Number.isFinite(value) ? value : 0;
  return Math.max(0, Math.min(255, Math.round(v)));
}

function normalizeColor(input) {
  if (Array.isArray(input)) {
    const [r = 0, g = 0, b = 0] = input;
    return { r: clampColor(r), g: clampColor(g), b: clampColor(b) };
  }
  if (typeof input === 'object' && input !== null) {
    const { r = 0, g = 0, b = 0 } = input;
    return { r: clampColor(r), g: clampColor(g), b: clampColor(b) };
  }
  return { r: 0, g: 0, b: 0 };
}

export default class FadeCandyManager extends EventEmitter {
  constructor({ logger, mapping = BOOKSHELF_MAP, pixelCount } = {}) {
    super();
    this.logger = logger;
    this.mapping = mapping;
    const inferredPixels = maxPixelIndex(mapping) + 1;
    this.pixelCount = pixelCount || Math.max(512, inferredPixels);

    this.frame = new Uint8Array(this.pixelCount * 3);
    this.shelfState = listShelves(mapping).reduce((acc, { columnIndex, shelfIndex, ranges }) => {
      acc[`${columnIndex}:${shelfIndex}`] = {
        sides: ranges.map(() => ({ r: 0, g: 0, b: 0 })),
      };
      return acc;
    }, {});

    this.fadeCandy = new FadeCandy();
    this.ready = false;
    this.currentAnimation = null;
    this.animations = this.#buildDefaultAnimations();
    this.stopAnimation = this.stopAnimation.bind(this);

    this.fadeCandy.on(FadeCandy.events.READY, (fc) => {
      this.logger?.info?.('Fadecandy interface ready');
      fc.config.set(FadeCandy.Configuration.schema.DISABLE_KEYFRAME_INTERPOLATION, 0);
      fc.clut.create();
    });

    this.fadeCandy.on(FadeCandy.events.COLOR_LUT_READY, () => {
      this.ready = true;
      this.emit('ready');
      this.logger?.info?.('Fadecandy Color LUT ready; device can accept frames');
    });
  }

  async waitUntilReady(timeoutMs = 8000) {
    if (this.ready) return;
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Fadecandy not ready in time')), timeoutMs);
      this.once('ready', () => {
        clearTimeout(timer);
        resolve();
      });
    });
  }

  listAnimations() {
    return Object.keys(this.animations);
  }

  listShelves() {
    return listShelves(this.mapping).map((entry) =>
      this.#buildShelfSnapshot(entry.columnIndex, entry.shelfIndex),
    );
  }

  clear({ skipSend = false } = {}) {
    this.frame.fill(0);
    Object.keys(this.shelfState).forEach((key) => {
      const sides = this.shelfState[key]?.sides || [];
      this.shelfState[key] = { sides: sides.map(() => ({ r: 0, g: 0, b: 0 })) };
    });
    if (!skipSend) this.pushFrame();
    this.emit('state:update', this.listShelves());
  }

  setShelfColor(columnIndex, shelfIndex, color, { flush = true, notify = true } = {}) {
    const rgb = normalizeColor(color);
    const ranges = getShelfRanges(columnIndex, shelfIndex, this.mapping);
    if (!ranges.length) throw new Error(`No shelf mapping for column ${columnIndex} shelf ${shelfIndex}`);

    ranges.forEach(([start, end]) => this.#setRangeColor(start, end, rgb));
    const state = this.shelfState[`${columnIndex}:${shelfIndex}`];
    if (state?.sides) state.sides = state.sides.map(() => rgb);
    if (flush) this.pushFrame();
    if (notify) this.#emitShelfUpdate(columnIndex, shelfIndex);
  }

  setShelfSideColor(columnIndex, shelfIndex, sideIndex, color, { flush = true } = {}) {
    const rgb = normalizeColor(color);
    const ranges = getShelfRanges(columnIndex, shelfIndex, this.mapping);
    const targetRange = ranges[sideIndex];
    if (!targetRange) throw new Error(`No side ${sideIndex} for column ${columnIndex} shelf ${shelfIndex}`);

    const [start, end] = targetRange;
    this.#setRangeColor(start, end, rgb);
    const state = this.shelfState[`${columnIndex}:${shelfIndex}`];
    if (state?.sides?.[sideIndex]) state.sides[sideIndex] = rgb;
    if (flush) this.pushFrame();
    this.#emitShelfUpdate(columnIndex, shelfIndex);
  }

  setAllShelves(color, { flush = true, notify = true } = {}) {
    const rgb = normalizeColor(color);
    listShelves(this.mapping).forEach(({ columnIndex, shelfIndex }) => {
      this.setShelfColor(columnIndex, shelfIndex, rgb, { flush: false, notify: false });
    });
    if (flush) this.pushFrame();
    if (notify) this.emit('state:update', this.listShelves());
  }

  pushFrame() {
    if (!this.ready) {
      this.logger?.debug?.('Skipping pushFrame: device not ready');
      return false;
    }
    this.fadeCandy.send(this.frame);
    return true;
  }

  #setRangeColor(startIndex, endIndex, { r, g, b }) {
    for (let idx = startIndex; idx <= endIndex; idx += 1) {
      const base = idx * 3;
      this.frame[base] = r;
      this.frame[base + 1] = g;
      this.frame[base + 2] = b;
    }
  }

  stopAnimation() {
    if (this.animationStop) {
      this.animationStop();
      this.animationStop = undefined;
      this.logger?.info?.('Stopped running animation');
    }
  }

  runAnimation(name, options = {}) {
    const animation = this.animations[name];
    if (!animation) throw new Error(`Unknown animation "${name}"`);
    this.stopAnimation();
    this.animationStop = animation(options);
    this.logger?.info?.(`Started animation "${name}"`);
    return name;
  }

  #buildDefaultAnimations() {
    const withFrameRate = (fn, interval = DEFAULT_FRAME_RATE_MS) => {
      const timer = setInterval(fn, interval);
      return () => clearInterval(timer);
    };

    return {
      breathe: ({ color = { r: 40, g: 120, b: 255 }, durationMs = 2400 } = {}) => {
        let t = 0;
        return withFrameRate(() => {
          const phase = (Math.sin((2 * Math.PI * t) / durationMs) + 1) / 2;
          const next = {
            r: Math.round(color.r * phase),
            g: Math.round(color.g * phase),
            b: Math.round(color.b * phase),
          };
          this.setAllShelves(next);
          t += DEFAULT_FRAME_RATE_MS;
        });
      },
      rainbowColumns: ({ speed = 120 } = {}) => {
        let hue = 0;
        const columnCount = this.mapping.length;
        const shelvesPerColumn = this.mapping[0]?.length || 0;
        return withFrameRate(() => {
          for (let col = 0; col < columnCount; col += 1) {
            const offsetHue = (hue + col * 40) % 360;
            const rgb = hsvToRgb(offsetHue, 1, 1);
            for (let shelf = 0; shelf < shelvesPerColumn; shelf += 1) {
              this.setShelfColor(col, shelf, rgb, { flush: false });
            }
          }
          this.pushFrame();
          hue = (hue + speed / 10) % 360;
        }, DEFAULT_FRAME_RATE_MS);
      },
      sparkle: ({ density = 0.08, base = { r: 5, g: 5, b: 5 } } = {}) => {
        return withFrameRate(() => {
          // Start from a dim base
          this.frame.fill(0);
          this.setAllShelves(base, { flush: false, notify: false });
          const pixelTotal = this.pixelCount;
          const sparkles = Math.max(1, Math.floor(pixelTotal * density));
          for (let i = 0; i < sparkles; i += 1) {
            const idx = Math.floor(Math.random() * pixelTotal);
            this.#setRangeColor(idx, idx, { r: 255, g: 255, b: 255 });
          }
          this.pushFrame();
        }, 80);
      },
    };
  }

  #buildShelfSnapshot(columnIndex, shelfIndex) {
    const key = `${columnIndex}:${shelfIndex}`;
    const state = this.shelfState[key] || { sides: [] };
    const ranges = getShelfRanges(columnIndex, shelfIndex, this.mapping);
    const color = this.#combineSideColors(state.sides);
    return {
      columnIndex,
      shelfIndex,
      ranges,
      color,
      sides: state.sides,
    };
  }

  #emitShelfUpdate(columnIndex, shelfIndex) {
    const shelf = this.#buildShelfSnapshot(columnIndex, shelfIndex);
    this.emit('shelf:update', shelf);
  }

  #combineSideColors(sides = []) {
    if (!sides.length) return { r: 0, g: 0, b: 0 };
    const totals = sides.reduce(
      (acc, c) => ({ r: acc.r + c.r, g: acc.g + c.g, b: acc.b + c.b }),
      { r: 0, g: 0, b: 0 },
    );
    return {
      r: Math.round(totals.r / sides.length),
      g: Math.round(totals.g / sides.length),
      b: Math.round(totals.b / sides.length),
    };
  }
}

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

import { EventEmitter } from "events";
import FadeCandy from "../fa/FadeCandy.js";
import {
  BOOKSHELF_MAP,
  getShelfRanges,
  listShelves,
  maxPixelIndex,
} from "../config/bookshelfMap.js";
import buildModes from "./modes/index.js";

function clampColor(value) {
  const v = Number.isFinite(value) ? value : 0;
  return Math.max(0, Math.min(255, Math.round(v)));
}

function normalizeColor(input) {
  if (Array.isArray(input)) {
    const [r = 0, g = 0, b = 0] = input;
    return { r: clampColor(r), g: clampColor(g), b: clampColor(b) };
  }
  if (typeof input === "object" && input !== null) {
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
    this.shelfState = listShelves(mapping).reduce(
      (acc, { columnIndex, shelfIndex, ranges }) => {
        acc[`${columnIndex}:${shelfIndex}`] = {
          sides: ranges.map(() => ({ r: 0, g: 0, b: 0 })),
        };
        return acc;
      },
      {},
    );

    this.fadeCandy = new FadeCandy();
    this.ready = false;
    this.currentMode = null;
    this.modes = buildModes(this);
    this.stopMode = this.stopMode.bind(this);

    this.fadeCandy.on(FadeCandy.events.READY, (fc) => {
      this.logger?.info?.("Fadecandy interface ready");
      fc.config.set(
        FadeCandy.Configuration.schema.DISABLE_KEYFRAME_INTERPOLATION,
        0,
      );
      fc.clut.create();
    });

    this.fadeCandy.on(FadeCandy.events.COLOR_LUT_READY, () => {
      this.ready = true;
      this.emit("ready");

      this.startPushingFrames();

      this.logger?.info?.(
        "Fadecandy Color LUT ready; device can accept frames",
      );
    });
  }

  startPushingFrames() {
    if(this.frameInterval)
      clearInterval(this.frameInterval);
    this.frameInterval = setInterval(()=>this.pushFrame(), 100);
  }

  async waitUntilReady(timeoutMs = 8000) {
    if (this.ready) return;
    await new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error("Fadecandy not ready in time")),
        timeoutMs,
      );
      this.once("ready", () => {
        clearTimeout(timer);
        resolve();
      });
    });
  }

  listModes() {
    return Object.values(this.modes).map(({ id, name }) => ({ id, name }));
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
    this.emit("state:update", this.listShelves());
  }

  setShelfColor(
    columnIndex,
    shelfIndex,
    color,
    { flush = true, notify = true } = {},
  ) {
    const rgb = normalizeColor(color);
    const ranges = getShelfRanges(columnIndex, shelfIndex, this.mapping);
    if (!ranges.length)
      throw new Error(
        `No shelf mapping for column ${columnIndex} shelf ${shelfIndex}`,
      );

    ranges.forEach(([start, end]) => this.#setRangeColor(start, end, rgb));
    const state = this.shelfState[`${columnIndex}:${shelfIndex}`];
    if (state?.sides) state.sides = state.sides.map(() => rgb);
    if (notify) this.#emitShelfUpdate(columnIndex, shelfIndex);
  }

  setShelfSideColor(
    columnIndex,
    shelfIndex,
    sideIndex,
    color,
    { flush = true } = {},
  ) {
    const rgb = normalizeColor(color);
    const ranges = getShelfRanges(columnIndex, shelfIndex, this.mapping);
    const targetRange = ranges[sideIndex];
    if (!targetRange)
      throw new Error(
        `No side ${sideIndex} for column ${columnIndex} shelf ${shelfIndex}`,
      );

    const [start, end] = targetRange;
    this.#setRangeColor(start, end, rgb);
    const state = this.shelfState[`${columnIndex}:${shelfIndex}`];
    if (state?.sides?.[sideIndex]) state.sides[sideIndex] = rgb;
    this.#emitShelfUpdate(columnIndex, shelfIndex);
  }

  /**
   * Light a fraction of a shelf's LEDs from one end.
   *   +fraction → lights from the high-index end downward (physically top of shelf)
   *   -fraction → lights from the low-index end upward  (physically bottom of shelf)
   * magnitude=0 → nothing lit; magnitude=1 → full shelf (same as setShelfColor).
   * Backwards-compatible: other code can keep using setShelfColor for full shelves.
   */
  setShelfColorFraction(columnIndex, shelfIndex, color, fraction, { notify = true } = {}) {
    const rgb = normalizeColor(color);
    const ranges = getShelfRanges(columnIndex, shelfIndex, this.mapping);
    if (!ranges.length)
      throw new Error(
        `No shelf mapping for column ${columnIndex} shelf ${shelfIndex}`,
      );

    const fromTop = fraction >= 0;
    const magnitude = Math.min(1, Math.abs(fraction));
    for (const [start, end] of ranges) {
      const n = end - start + 1;
      // ceil so even a tiny fraction lights at least 1 LED (when magnitude > 0)
      const litCount = magnitude > 0 ? Math.ceil(n * magnitude) : 0;
      const litStart = fromTop ? end - litCount + 1 : start;
      const litEnd   = fromTop ? end                : start + litCount - 1;
      for (let idx = start; idx <= end; idx++) {
        const base = idx * 3;
        if (litCount > 0 && idx >= litStart && idx <= litEnd) {
          this.frame[base]     = rgb.r;
          this.frame[base + 1] = rgb.g;
          this.frame[base + 2] = rgb.b;
        } else {
          this.frame[base]     = 0;
          this.frame[base + 1] = 0;
          this.frame[base + 2] = 0;
        }
      }
    }

    const state = this.shelfState[`${columnIndex}:${shelfIndex}`];
    if (state?.sides) state.sides = state.sides.map(() => rgb);
    if (notify) this.#emitShelfUpdate(columnIndex, shelfIndex);
  }

  setAllShelves(color, { flush = true, notify = true } = {}) {
    const rgb = normalizeColor(color);
    listShelves(this.mapping).forEach(({ columnIndex, shelfIndex }) => {
      this.setShelfColor(columnIndex, shelfIndex, rgb, {
        flush: false,
        notify: false,
      });
    });
    if (notify) this.emit("state:update", this.listShelves());
  }

  pushFrame() {
    if (!this.ready) {
      this.logger?.debug?.("Skipping pushFrame: device not ready");
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

  stopMode() {
    const hadStopper = typeof this.modeStop === "function";
    if (hadStopper) this.modeStop();
    this.modeStop = undefined;
    const wasRunning = this.currentMode;
    this.currentMode = null;
    this.clear();
    if (hadStopper || wasRunning) {
      this.logger?.info?.("Stopped running mode");
      this.emit("mode:stop", null);
    }
  }

  runMode(name, options = {}) {
    const mode = this.modes[name];
    if (!mode) throw new Error(`Unknown mode "${name}"`);
    if (this.currentMode != null) this.stopMode();
    else this.clear();

    const maybeStop = mode.start(options);
    this.modeStop = typeof maybeStop === "function" ? maybeStop : undefined;
    this.currentMode = name;
    this.logger?.info?.(`Started mode "${name}"`);
    this.emit("mode:start", name);
    return name;
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
    this.emit("shelf:update", shelf);
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

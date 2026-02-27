const DEFAULT_FRAME_MS = 100;
const DEFAULT_FADE_MS = 1800;
const DEFAULT_CYCLE_MS = 3500;
const MAXLENGTH = 4;

export default class FadeQueueMode {
  constructor(manager) {
    this.manager = manager;
    this.id = 'fadeQueue';
    this.name = 'Fade Queue';
  }

  start({
    color = { r: 255, g: 200, b: 120 },
    fadeDurationMs = DEFAULT_FADE_MS,
    cycleMs = DEFAULT_CYCLE_MS,
    frameMs = DEFAULT_FRAME_MS,
  } = {}) {
    const allShelves = this.manager
      .listShelves()
      .map(({ columnIndex, shelfIndex }) => ({ columnIndex, shelfIndex }));

    const active = [];
    let lastAdd = 0;

    const keyFor = (entry) => `${entry.columnIndex}:${entry.shelfIndex}`;

    const pickAvailableShelf = () => {
      const occupied = new Set(active.map((entry) => keyFor(entry)));
      const available = allShelves.filter(
        (entry) => !occupied.has(keyFor(entry)),
      );
      if (!available.length) return null;
      return available[Math.floor(Math.random() * available.length)];
    };

    const scaledColor = (intensity) => ({
      r: Math.max(0, Math.min(255, Math.round(color.r * intensity))),
      g: Math.max(0, Math.min(255, Math.round(color.g * intensity))),
      b: Math.max(0, Math.min(255, Math.round(color.b * intensity))),
    });

    const tick = () => {
      const now = Date.now();

      const visibleCount = active.length;
      const hasFadingIn = active.some((entry) => entry.state === 'fadingIn');

      if (!hasFadingIn && visibleCount <= MAXLENGTH-1 && now - lastAdd >= cycleMs) {
        const next = pickAvailableShelf();
        if (next) {
          active.push({ ...next, state: 'fadingIn', startedAt: now });
          lastAdd = now;
        }
      }

      for (let i = active.length - 1; i >= 0; i -= 1) {
        const entry = active[i];
        let intensity = 1;

        if (entry.state === 'fadingIn') {
          const progress = (now - entry.startedAt) / fadeDurationMs;
          intensity = Math.min(1, progress);
          if (progress >= 1) {
            entry.state = 'steady';
            entry.startedAt = now;
            intensity = 1;
          }
        } else if (entry.state === 'fadingOut') {
          const progress = (now - entry.startedAt) / fadeDurationMs;
          intensity = Math.max(0, 1 - progress);
          if (progress >= 1) {
            this.manager.setShelfColor(entry.columnIndex, entry.shelfIndex, {
              r: 0,
              g: 0,
              b: 0,
            });
            active.splice(i, 1);
            continue;
          }
        }

        this.manager.setShelfColor(
          entry.columnIndex,
          entry.shelfIndex,
          scaledColor(intensity),
          { flush: false },
        );
      }

      const hasFadingOut = active.some((entry) => entry.state === 'fadingOut');
      const stillFadingIn = active.some((entry) => entry.state === 'fadingIn');

      if (active.length === MAXLENGTH && !hasFadingOut && !stillFadingIn) {
        let oldestIndex = 0;
        for (let i = 1; i < active.length; i += 1) {
          if (active[i].startedAt < active[oldestIndex].startedAt) {
            oldestIndex = i;
          }
        }
        active[oldestIndex].state = 'fadingOut';
        active[oldestIndex].startedAt = now;
      }
    };

    const timer = setInterval(tick, frameMs);
    tick();

    return () => clearInterval(timer);
  }
}

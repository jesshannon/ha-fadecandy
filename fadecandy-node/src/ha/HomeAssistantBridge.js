import express from 'express';

/**
 * Lightweight bridge to surface friendly endpoints for Home Assistant.
 * The HA add-on can expose these as RESTful commands or through webhooks.
 */
export default class HomeAssistantBridge {
  constructor({ manager, logger }) {
    this.manager = manager;
    this.logger = logger;
    this.router = express.Router();
    this.#registerRoutes();
  }

  attach(app, prefix = '/ha') {
    app.use(prefix, this.router);
  }

  #registerRoutes() {
    this.router.get('/entities', (_req, res) => {
      res.json(this.#buildEntityModel());
    });

    this.router.post('/shelves/:column/:shelf', (req, res) => {
      const column = Number(req.params.column);
      const shelf = Number(req.params.shelf);
      const { r, g, b } = req.body || {};
      try {
        this.manager.stopAnimation();
        this.manager.setShelfColor(column, shelf, { r, g, b });
        res.json({ ok: true, column, shelf, color: { r, g, b } });
      } catch (err) {
        this.logger?.warn?.(`HA shelf set failed: ${err.message}`);
        res.status(400).json({ ok: false, error: err.message });
      }
    });

    this.router.post('/animations/:name', (req, res) => {
      const { name } = req.params;
      try {
        this.manager.runAnimation(name, req.body || {});
        res.json({ ok: true, animation: name });
      } catch (err) {
        res.status(400).json({ ok: false, error: err.message });
      }
    });

    this.router.post('/animations/:name/stop', (_req, res) => {
      this.manager.stopAnimation();
      res.json({ ok: true, animation: null });
    });

    this.router.post('/off', (_req, res) => {
      this.manager.stopAnimation();
      this.manager.clear();
      res.json({ ok: true });
    });
  }

  #buildEntityModel() {
    const shelves = this.manager.listShelves().map(({ columnIndex, shelfIndex, color }) => ({
      id: `shelf_${columnIndex}_${shelfIndex}`,
      name: `Bookshelf ${columnIndex + 1} / Shelf ${shelfIndex + 1}`,
      column: columnIndex,
      shelf: shelfIndex,
      color,
      type: 'light',
    }));

    const animations = this.manager.listAnimations().map((name) => ({
      id: `animation_${name}`,
      name: `Animation ${name}`,
      type: 'select',
      options: [],
      value: name,
    }));

    return { shelves, animations };
  }
}

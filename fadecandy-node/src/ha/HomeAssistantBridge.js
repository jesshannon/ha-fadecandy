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
        if(this.manager.currentMode != null) this.stopMode();
        this.manager.setShelfColor(column, shelf, { r, g, b });

        this.logger?.debug?.(`Setting shelf ${column} : ${shelf} to r=${r} g=${g} b=${b}`);

        res.json({ ok: true, column, shelf, color: { r, g, b } });
      } catch (err) {
        this.logger?.warn?.(`HA shelf set failed: ${err.message}`);
        res.status(400).json({ ok: false, error: err.message });
      }
    });

    this.router.post('/modes/start/:name', (req, res) => {
      const { name } = req.params;
      try {
        this.manager.runMode(name, req.body || {});
        res.json({ ok: true, mode: name });
      } catch (err) {
        res.status(400).json({ ok: false, error: err.message });
      }
    });

    this.router.post('/modes/stop', (_req, res) => {
      this.manager.stopMode();
      res.json({ ok: true, mode: null });
    });

    this.router.post('/off', (_req, res) => {
      this.manager.stopMode();
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
      color: this.manager.currentMode == null ? color : { r:0, g:0, b:0 },
      type: 'light',
    }));

    const modes = this.manager.listModes();
    const options = modes.map(mode => ({ id: mode.id, name: mode.name }));
    const mode = {
      id: 'mode_select',
      name: 'Mode',
      type: 'select',
      options,
      value: this.manager.currentMode || null,
    };

    return { shelves, mode };
  }
}

import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { listUsb } from '../usbUtils.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default class MonitorServer {
  constructor({ port = 7890, manager, haBridge, logger }) {
    this.port = port;
    this.manager = manager;
    this.logger = logger;
    this.app = express();
    this.server = null;

    this.app.use(express.json());
    this.#registerApiRoutes();
    if (haBridge) haBridge.attach(this.app);

    const publicDir = path.join(__dirname, 'public');
    this.app.use(express.static(publicDir));
  }

  start() {
    return new Promise((resolve, reject) => {
      this.server = this.app
        .listen(this.port, () => {
          this.logger?.info?.(`Monitor server listening on ${this.port}`);
          resolve(this.server);
        })
        .on('error', (err) => {
          this.logger?.error?.(`Server error on listen: ${err.code || err.message}`, err);
          reject(err);
        });
    });
  }

  stop() {
    if (!this.server) return Promise.resolve();
    return new Promise((resolve) => this.server.close(resolve));
  }

  #registerApiRoutes() {
    this.app.get('/health', (_req, res) => {
      res.json({ status: 'ok', timestamp: new Date().toISOString() });
    });

    this.app.get('/api/usb', (_req, res) => {
      res.json({ devices: listUsb() });
    });

    this.app.get('/api/state', (_req, res) => {
      res.json({
        ready: this.manager.ready,
        shelves: this.manager.listShelves(),
        animations: this.manager.listAnimations(),
      });
    });

    this.app.post('/api/shelves/:column/:shelf/color', (req, res) => {
      const column = Number(req.params.column);
      const shelf = Number(req.params.shelf);
      const { r, g, b } = req.body || {};
      try {
        this.manager.stopAnimation();
        this.manager.setShelfColor(column, shelf, { r, g, b });
        res.json({ ok: true, column, shelf, color: { r, g, b } });
      } catch (err) {
        res.status(400).json({ ok: false, error: err.message });
      }
    });

    this.app.post('/api/animation', (req, res) => {
      const { name, options = {} } = req.body || {};
      try {
        this.manager.runAnimation(name, options);
        res.json({ ok: true, animation: name });
      } catch (err) {
        res.status(400).json({ ok: false, error: err.message });
      }
    });

    this.app.post('/api/animation/stop', (_req, res) => {
      this.manager.stopAnimation();
      res.json({ ok: true });
    });

    this.app.post('/api/off', (_req, res) => {
      this.manager.stopAnimation();
      this.manager.clear();
      res.json({ ok: true });
    });
  }
}

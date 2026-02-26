import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { WebSocketServer } from 'ws';
import { listUsb } from '../usbUtils.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default class MonitorServer {
  constructor({ port = 7890, manager, haBridge, logger }) {
    this.port = port;
    this.manager = manager;
    this.logger = logger;
    this.app = express();
    this.server = null;
    this.wss = null;

    this.app.use(express.json());
    this.#registerApiRoutes();
    this.#registerManagerEvents();
    if (haBridge) haBridge.attach(this.app);

    const publicDir = path.join(__dirname, 'public');
    this.app.use(express.static(publicDir));
  }

  start() {
    return new Promise((resolve, reject) => {
      this.server = this.app
        .listen(this.port, () => {
          this.logger?.info?.(`Monitor server listening on ${this.port}`);
          this.#attachWebsocket();
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
      res.json(this.#buildState());
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

    this.app.post('/api/shelves/:column/:shelf/side/:side/color', (req, res) => {
      const column = Number(req.params.column);
      const shelf = Number(req.params.shelf);
      const sideRaw = req.params.side;
      const side = sideRaw === 'left' ? 0 : sideRaw === 'right' ? 1 : Number(sideRaw);
      const { r, g, b } = req.body || {};
      try {
        this.manager.stopAnimation();
        this.manager.setShelfSideColor(column, shelf, side, { r, g, b });
        res.json({ ok: true, column, shelf, side, color: { r, g, b } });
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

  #attachWebsocket() {
    this.wss = new WebSocketServer({ server: this.server, path: '/ws' });
    this.wss.on('connection', (socket) => {
      socket.send(JSON.stringify({ type: 'state', data: this.#buildState() }));
    });
  }

  #registerManagerEvents() {
    if (!this.manager) return;
    this.manager.on('shelf:update', (shelf) => this.#broadcast({ type: 'shelf', shelf }));
    this.manager.on('state:update', () => this.#broadcast({ type: 'state', data: this.#buildState() }));
    this.manager.on('animation:start', (name) =>
      this.#broadcast({ type: 'animation', running: true, name }),
    );
    this.manager.on('animation:stop', () =>
      this.#broadcast({ type: 'animation', running: false, name: null }),
    );
    this.manager.on('ready', () => this.#broadcast({ type: 'ready', ready: true }));
  }

  #broadcast(payload) {
    if (!this.wss) return;
    const data = JSON.stringify(payload);
    this.wss.clients.forEach((client) => {
      if (client.readyState === 1) client.send(data);
    });
  }

  #buildState() {
    return {
      ready: this.manager.ready,
      currentAnimation: this.manager.currentAnimation || null,
      shelves: this.manager.listShelves(),
      animations: this.manager.listAnimations(),
    };
  }
}

import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Mounts game HTTP routes onto an existing Express app and forwards
 * game events to connected WebSocket clients.
 *
 * Usage (in MonitorServer):
 *   gameServer.attach(this.app)        // call in constructor
 *   gameServer.attachWebSocket(wss)    // call after wss is created
 */
export default class GameServer {
  constructor({ logger } = {}) {
    this.logger = logger;
    this.games = new Map();
    this._wss = null;
  }

  registerGame(id, game) {
    this.games.set(id, game);
    game.on('game:event', (payload) => this._broadcast(payload));
  }

  /**
   * Register routes on the Express app.
   * Call this during MonitorServer construction (before listen).
   */
  attach(app) {
    const publicDir = path.join(__dirname, 'public');

    // Serve game pages at their friendly URL
    app.get('/blocks', (_req, res) =>
      res.sendFile(path.join(publicDir, 'blocks', 'index.html')),
    );

    app.post('/api/game/:gameId/start', (req, res) => {
      const game = this.games.get(req.params.gameId);
      if (!game) return res.status(404).json({ ok: false, error: 'Unknown game' });
      try {
        game.start();
        res.json({ ok: true });
      } catch (err) {
        this.logger?.warn?.(`Game start failed: ${err.message}`);
        res.status(500).json({ ok: false, error: err.message });
      }
    });

    app.post('/api/game/:gameId/stop', (req, res) => {
      const game = this.games.get(req.params.gameId);
      if (!game) return res.status(404).json({ ok: false, error: 'Unknown game' });
      game.stop();
      res.json({ ok: true });
    });

    app.post('/api/game/:gameId/action', (req, res) => {
      const game = this.games.get(req.params.gameId);
      if (!game) return res.status(404).json({ ok: false, error: 'Unknown game' });
      const { action } = req.body || {};
      game.handleAction(action);
      res.json({ ok: true });
    });

    app.get('/api/game/:gameId/state', (req, res) => {
      const game = this.games.get(req.params.gameId);
      if (!game) return res.status(404).json({ ok: false, error: 'Unknown game' });
      res.json({ ok: true, data: game.getState() });
    });
  }

  /**
   * Call after the WebSocket server is created so game events can
   * be forwarded to browser clients.
   */
  attachWebSocket(wss) {
    this._wss = wss;

    // Send current game state to each new connection
    wss.on('connection', (socket) => {
      for (const [id, game] of this.games) {
        const payload = { type: 'game:state', gameId: id, data: game.getState() };
        socket.send(JSON.stringify(payload));
      }
    });
  }

  _broadcast(payload) {
    if (!this._wss) return;
    const data = JSON.stringify(payload);
    this._wss.clients.forEach((client) => {
      if (client.readyState === 1) client.send(data);
    });
  }
}

import { EventEmitter } from 'events';

/**
 * Base class for bookshelf games.
 *
 * Subclasses must implement:
 *   start()             – begin the game, call this.manager.stopMode() first
 *   stop()              – end the game cleanly, call this.manager.clear()
 *   handleAction(action) – respond to player input ('left'|'right'|'down'|...)
 *   getState()          – return plain-object snapshot for WS clients
 *
 * Emit { type: 'game:state', gameId, data } via this.emit('game:event', payload)
 * to push state to connected WebSocket clients (GameServer forwards it).
 */
export default class GameBase extends EventEmitter {
  constructor(manager, logger) {
    super();
    this.manager = manager;
    this.logger = logger;
    this.active = false;
  }

  start() { throw new Error(`${this.constructor.name}.start() not implemented`); }
  stop()  { throw new Error(`${this.constructor.name}.stop() not implemented`); }
  handleAction(_action) {}
  getState() { return {}; }
}

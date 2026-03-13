import GameBase from '../GameBase.js';

const COLS = 3;
const ROWS = 6;
const TICK_MS = 50;          // game loop interval
const NORMAL_DROP = 0.04;    // shelves per tick  →  0.8 shelves/sec
const FAST_DROP   = 0.20;    // shelves per tick  →  4   shelves/sec
const FLASH_PHASES = 6;      // alternating white/black × 3 blinks
const FLASH_PHASE_MS = 150;

const COLORS = [
  { r: 255, g: 50,  b: 50  },  // red
  { r: 50,  g: 200, b: 255 },  // cyan
  { r: 255, g: 215, b: 0   },  // yellow
  { r: 50,  g: 220, b: 80  },  // green
  { r: 200, g: 50,  b: 255 },  // purple
  { r: 255, g: 140, b: 0   },  // orange
];

function scaleColor(color, t) {
  return {
    r: Math.round(color.r * t),
    g: Math.round(color.g * t),
    b: Math.round(color.b * t),
  };
}

function emptyRow() {
  return Array(COLS).fill(null);
}

export default class BlocksGame extends GameBase {
  constructor(manager, logger) {
    super(manager, logger);
    this.id = 'blocks';
    this.board = null;        // ROWS × COLS; null | { color }
    this.activePiece = null;  // { column, y, color }
    this.score = 0;
    this.gameOver = false;
    this.clearing = null;     // { rows, phase, timer } during flash animation
    this.fastDrop = false;
    this._timer = null;
  }

  // ── lifecycle ────────────────────────────────────────────────────────────

  start() {
    this.manager.stopMode();
    this.board = Array.from({ length: ROWS }, emptyRow);
    this.activePiece = null;
    this.score = 0;
    this.gameOver = false;
    this.clearing = null;
    this.fastDrop = false;
    this.active = true;

    this._spawnPiece();
    this._renderFrame();
    this._timer = setInterval(() => this._tick(), TICK_MS);
    this.logger?.info?.('Blocks game started');
    this._broadcastState();
  }

  stop() {
    this.active = false;
    if (this._timer) { clearInterval(this._timer); this._timer = null; }
    if (this.clearing?.timer) clearTimeout(this.clearing.timer);
    this.clearing = null;
    this.manager.clear();
    this.logger?.info?.('Blocks game stopped');
    this._broadcastState();
  }

  handleAction(action) {
    if (!this.active || this.gameOver || !this.activePiece || this.clearing) return;

    if (action === 'left') {
      const newCol = this.activePiece.column - 1;
      if (newCol >= 0) this.activePiece.column = newCol;
    } else if (action === 'right') {
      const newCol = this.activePiece.column + 1;
      if (newCol < COLS) this.activePiece.column = newCol;
    } else if (action === 'down') {
      this.fastDrop = true;
    }

    this._renderFrame();
    this._broadcastState();
  }

  getState() {
    return {
      board: this.board,
      activePiece: this.activePiece,
      score: this.score,
      gameOver: this.gameOver,
      running: this.active,
      clearing: this.clearing?.rows ?? null,
    };
  }

  // ── game loop ─────────────────────────────────────────────────────────────

  _tick() {
    if (!this.active || this.gameOver || this.clearing || !this.activePiece) return;

    const piece    = this.activePiece;
    const delta    = this.fastDrop ? FAST_DROP : NORMAL_DROP;
    const newY     = piece.y + delta;
    const oldFloor = Math.floor(piece.y);
    const newFloor = Math.floor(newY);

    // Crossing into a new shelf — check it's free
    if (newFloor > oldFloor) {
      if (newFloor >= ROWS || this.board[newFloor][piece.column] !== null) {
        // Snap to a whole shelf before locking to avoid a brightness pop
        piece.y = oldFloor;
        this._lockPiece(oldFloor);
        return;
      }
    }

    piece.y = newY;

    // Prevent blending into a blocked shelf — snap and lock now rather
    // than later when frac would be high and cause a large visual jump
    const currentFloor = Math.floor(piece.y);
    const frac = piece.y - currentFloor;
    if (frac > 0.01) {
      const nextShelf = currentFloor + 1;
      if (nextShelf >= ROWS || this.board[nextShelf][piece.column] !== null) {
        piece.y = currentFloor;
        this._lockPiece(currentFloor);
        return;
      }
    }

    this._renderFrame();
    this._broadcastState();
  }

  // ── piece lifecycle ───────────────────────────────────────────────────────

  _spawnPiece() {
    const freeCols = [];
    for (let col = 0; col < COLS; col++) {
      if (this.board[0][col] === null) freeCols.push(col);
    }
    if (freeCols.length === 0) {
      this._endGame();
      return;
    }
    const col   = freeCols[Math.floor(Math.random() * freeCols.length)];
    const color = COLORS[Math.floor(Math.random() * COLORS.length)];
    this.activePiece = { column: col, y: 0, color };
    this.fastDrop = false;
  }

  _lockPiece(row) {
    const { column, color } = this.activePiece;
    this.activePiece = null;
    this.fastDrop = false;

    if (row < 0 || row >= ROWS) { this._endGame(); return; }

    this.board[row][column] = { color };

    const clearRows = this._findClearRows();
    if (clearRows.length > 0) {
      this.score += clearRows.length * 100;
      this._startClearAnimation(clearRows);
    } else {
      this._spawnPiece();
    }

    this._renderFrame();
    this._broadcastState();
  }

  _findClearRows() {
    const clears = [];
    for (let row = 0; row < ROWS; row++) {
      const cells = this.board[row];
      if (!cells.every(c => c !== null)) continue;
      const { r, g, b } = cells[0].color;
      if (cells.every(c => c.color.r === r && c.color.g === g && c.color.b === b)) {
        clears.push(row);
      }
    }
    return clears;
  }

  // ── clear animation ───────────────────────────────────────────────────────

  _startClearAnimation(rows) {
    this.clearing = { rows, phase: 0, timer: null };
    this._doFlashPhase();
  }

  _doFlashPhase() {
    if (!this.clearing) return;
    const { rows, phase } = this.clearing;

    if (phase >= FLASH_PHASES) {
      // Remove cleared rows (highest index first to keep indices valid)
      for (const row of [...rows].sort((a, b) => b - a)) {
        this.board.splice(row, 1);
        this.board.unshift(emptyRow());
      }
      this.clearing = null;
      this._spawnPiece();
      this._renderFrame();
      this._broadcastState();
      return;
    }

    // Alternate white / black for flash effect
    const flashColor = phase % 2 === 0 ? { r: 255, g: 255, b: 255 } : { r: 0, g: 0, b: 0 };
    for (const row of rows) {
      for (let col = 0; col < COLS; col++) {
        this.manager.setShelfColor(col, row, flashColor, { notify: false });
      }
    }

    this.clearing.phase++;
    this.clearing.timer = setTimeout(() => this._doFlashPhase(), FLASH_PHASE_MS);
    this._broadcastState();
  }

  _endGame() {
    this.gameOver = true;
    this.active = false;
    clearInterval(this._timer);
    this._timer = null;
    this.logger?.info?.(`Blocks game over. Score: ${this.score}`);
    this._renderFrame();
    this._broadcastState();
  }

  // ── rendering ─────────────────────────────────────────────────────────────

  /**
   * Writes the full game state to the LED frame buffer.
   * The manager's push interval picks it up from there.
   */
  _renderFrame() {
    // Locked cells (or black for empty)
    for (let row = 0; row < ROWS; row++) {
      for (let col = 0; col < COLS; col++) {
        const cell = this.board[row][col];
        this.manager.setShelfColor(col, row, cell ? cell.color : { r: 0, g: 0, b: 0 }, { notify: false });
      }
    }

    // Active piece: smooth blend between two shelves when in transit
    if (this.activePiece) {
      const { column, y, color } = this.activePiece;
      const frac = y - Math.floor(y);
      const row0 = Math.floor(y);

      if (frac < 0.02) {
        this.manager.setShelfColor(column, row0, color, { notify: false });
      } else {
        this.manager.setShelfColor(column, row0, scaleColor(color, 1 - frac), { notify: false });
        const row1 = row0 + 1;
        if (row1 < ROWS) {
          this.manager.setShelfColor(column, row1, scaleColor(color, frac), { notify: false });
        }
      }
    }
  }

  _broadcastState() {
    this.emit('game:event', {
      type: 'game:state',
      gameId: this.id,
      data: this.getState(),
    });
  }
}

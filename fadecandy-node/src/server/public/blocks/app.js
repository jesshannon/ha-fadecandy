const GAME_ID = 'blocks';
const COLS = 3;
const ROWS = 6;

const wsUrl = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`;

// ── DOM refs ──────────────────────────────────────────────────────────────────
const gameGrid    = document.getElementById('game-grid');
const overlay     = document.getElementById('game-overlay');
const overlayMsg  = document.getElementById('overlay-message');
const scoreEl     = document.getElementById('score-display');
const btnStart    = document.getElementById('btn-start');
const btnStop     = document.getElementById('btn-stop');
const btnLeft     = document.getElementById('btn-left');
const btnDown     = document.getElementById('btn-down');
const btnRight    = document.getElementById('btn-right');
const toastEl     = document.getElementById('toast');

// ── build grid cells ──────────────────────────────────────────────────────────
// Cells are stored as cells[row][col], DOM order is row-major (left→right, top→bottom)
const cells = [];
for (let row = 0; row < ROWS; row++) {
  cells[row] = [];
  for (let col = 0; col < COLS; col++) {
    const div = document.createElement('div');
    div.className = 'game-cell';
    gameGrid.appendChild(div);
    cells[row][col] = div;
  }
}

// ── game state ────────────────────────────────────────────────────────────────
let gameRunning = false;
let gameOver    = false;

// ── helpers ───────────────────────────────────────────────────────────────────
function rgbToHex({ r, g, b }) {
  return `#${[r, g, b].map(v => Math.max(0, Math.min(255, v)).toString(16).padStart(2, '0')).join('')}`;
}

function scaleColor({ r, g, b }, t) {
  return { r: Math.round(r * t), g: Math.round(g * t), b: Math.round(b * t) };
}

function showToast(msg, ms = 2000) {
  toastEl.textContent = msg;
  toastEl.classList.remove('hidden');
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => toastEl.classList.add('hidden'), ms);
}

// ── render ────────────────────────────────────────────────────────────────────
function renderState(state) {
  if (!state) return;

  gameRunning = state.running;
  gameOver    = state.gameOver;

  // Score
  scoreEl.textContent = state.score ?? 0;

  // Build display grid (what to show in each cell)
  const display = (state.board || []).map(row => [...row]);

  // Overlay active piece with smooth blend between shelves
  if (state.activePiece) {
    const { column, y, color } = state.activePiece;
    const frac = y - Math.floor(y);
    const row0 = Math.floor(y);
    const row1 = row0 + 1;

    if (frac < 0.02) {
      if (row0 < ROWS) display[row0][column] = { color };
    } else {
      if (row0 < ROWS) display[row0][column] = { color: scaleColor(color, 1 - frac) };
      if (row1 < ROWS) display[row1][column] = { color: scaleColor(color, frac) };
    }
  }

  // Flash clearing rows white
  if (state.clearing) {
    for (const row of state.clearing) {
      for (let col = 0; col < COLS; col++) {
        display[row][col] = { color: { r: 255, g: 255, b: 255 } };
      }
    }
  }

  // Update DOM
  for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col < COLS; col++) {
      const cell  = cells[row][col];
      const entry = display[row]?.[col];
      if (entry?.color) {
        const hex = rgbToHex(entry.color);
        cell.style.backgroundColor = hex;
        cell.style.boxShadow = `0 0 14px ${hex}55`;
        cell.classList.add('lit');
      } else {
        cell.style.backgroundColor = '';
        cell.style.boxShadow = '';
        cell.classList.remove('lit');
      }
    }
  }

  // Overlay visibility
  if (state.running) {
    overlayMsg.textContent = '';
    overlay.classList.add('hidden');
  } else if (state.gameOver) {
    overlayMsg.textContent = `Game Over — ${state.score ?? 0} pts`;
    overlay.classList.remove('hidden');
    btnStart.textContent = 'Play Again';
  } else {
    overlayMsg.textContent = '';
    overlay.classList.remove('hidden');
    btnStart.textContent = 'Start Game';
  }
}

// ── API calls ─────────────────────────────────────────────────────────────────
async function apiPost(path, body) {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

async function startGame() {
  try {
    await apiPost(`/api/game/${GAME_ID}/start`);
  } catch (err) {
    showToast(`Start failed: ${err.message}`);
  }
}

async function stopGame() {
  try {
    await apiPost(`/api/game/${GAME_ID}/stop`);
    overlay.classList.remove('hidden');
    overlayMsg.textContent = '';
    btnStart.textContent = 'Start Game';
  } catch (err) {
    showToast(`Stop failed: ${err.message}`);
  }
}

async function sendAction(action) {
  try {
    await apiPost(`/api/game/${GAME_ID}/action`, { action });
  } catch (_) { /* ignore mid-game request failures */ }
}

// ── controls ──────────────────────────────────────────────────────────────────
btnStart.addEventListener('click', startGame);
btnStop.addEventListener('click', stopGame);

// Touch controls — send on touchstart for instant response
function ctrlBtn(el, action) {
  el.addEventListener('touchstart', (e) => { e.preventDefault(); sendAction(action); }, { passive: false });
  el.addEventListener('click', () => sendAction(action));
}
ctrlBtn(btnLeft,  'left');
ctrlBtn(btnDown,  'down');
ctrlBtn(btnRight, 'right');

// Keyboard
document.addEventListener('keydown', (e) => {
  if (e.repeat) return;
  switch (e.key) {
    case 'ArrowLeft':  e.preventDefault(); sendAction('left');  break;
    case 'ArrowRight': e.preventDefault(); sendAction('right'); break;
    case 'ArrowDown':  e.preventDefault(); sendAction('down');  break;
    case 'Enter':
    case ' ':
      e.preventDefault();
      if (!gameRunning) startGame();
      break;
  }
});

// ── WebSocket ─────────────────────────────────────────────────────────────────
let socket;

function connectSocket() {
  socket = new WebSocket(wsUrl);

  socket.addEventListener('message', (event) => {
    try {
      const msg = JSON.parse(event.data);
      if (msg.type === 'game:state' && msg.gameId === GAME_ID) {
        renderState(msg.data);
      }
    } catch (_) {}
  });

  socket.addEventListener('close', () => setTimeout(connectSocket, 1200));
  socket.addEventListener('error', () => socket.close());
}

// ── init ──────────────────────────────────────────────────────────────────────
async function init() {
  try {
    const res = await fetch(`/api/game/${GAME_ID}/state`);
    const json = await res.json();
    renderState(json.data);
  } catch (_) {}
  connectSocket();
}

init();

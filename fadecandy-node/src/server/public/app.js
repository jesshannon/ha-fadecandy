const stateUrl = '/api/state';
const wsUrl = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`;

const modeSelect = document.getElementById('mode-select');
const runModeBtn = document.getElementById('run-mode');
const stopModeBtn = document.getElementById('stop-mode');
const allOffBtn = document.getElementById('all-off');
const refreshBtn = document.getElementById('refresh-state');
const statusPill = document.getElementById('status-pill');
const lastSync = document.getElementById('last-sync');
const toastEl = document.getElementById('toast');
const canvas = document.getElementById('shelf-canvas');
const ctx = canvas.getContext('2d');
const colorPicker = document.getElementById('color-picker');
const brushPreview = document.getElementById('brush-preview');
const recentColoursElement = document.getElementById('recent-colors');


const clientState = {
  ready: false,
  modes: [],
  shelves: [],
  currentMode: null,
};

let socket;
let brushColor = { r: 70, g: 194, b: 166 };
let painting = false;
let shelfRects = [];
let lastPaint = { key: null, hex: null };

let recentColours = ["#000000","#ffffff","#ff0000","#0000ff","#f200ff"];

async function fetchJson(url, options) {
  const res = await fetch(url, options);
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

function rgbToHex({ r = 0, g = 0, b = 0 } = {}) {
  return `#${[r, g, b]
    .map((v) => {
      const clamped = Math.max(0, Math.min(255, v));
      return clamped.toString(16).padStart(2, '0');
    })
    .join('')}`;
}

function hexToRgb(hex) {
  const clean = hex.replace('#', '');
  if (clean.length !== 6) return { r: 0, g: 0, b: 0 };
  return {
    r: parseInt(clean.slice(0, 2), 16),
    g: parseInt(clean.slice(2, 4), 16),
    b: parseInt(clean.slice(4, 6), 16),
  };
}

function roundedRectPath(context, x, y, w, h, radius = 8) {
  const r = Math.min(radius, w / 2, h / 2);
  context.beginPath();
  context.moveTo(x + r, y);
  context.lineTo(x + w - r, y);
  context.quadraticCurveTo(x + w, y, x + w, y + r);
  context.lineTo(x + w, y + h - r);
  context.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  context.lineTo(x + r, y + h);
  context.quadraticCurveTo(x, y + h, x, y + h - r);
  context.lineTo(x, y + r);
  context.quadraticCurveTo(x, y, x + r, y);
  context.closePath();
}

function updateStatus(ready) {
  clientState.ready = !!ready;
  statusPill.textContent = ready ? 'Fadecandy Ready' : 'Waiting for Fadecandy';
  statusPill.classList.toggle('ready', !!ready);
}

function updateLastSync(text = '') {
  const stamp = text || `Last sync ${new Date().toLocaleTimeString()}`;
  lastSync.textContent = stamp;
}

function renderModes(modes) {
  const existingOptions = Array.from(modeSelect.options);
  const existingMap = new Map();
  existingOptions.forEach((opt) => existingMap.set(opt.value, opt));

  modes.forEach(({ id, name }) => {
    let opt = existingMap.get(id);
    if (!opt) {
      opt = document.createElement('option');
      opt.value = id;
      opt.textContent = name || id;
      modeSelect.appendChild(opt);
    }
    opt.selected = id === clientState.currentMode;
    existingMap.delete(id);
  });

  existingMap.forEach((opt) => modeSelect.removeChild(opt));
  modeSelect.disabled = modes.length === 0;
}

function drawShelvesCanvas(shelves) {
  if (!shelves || !shelves.length) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    shelfRects = [];
    return;
  }
  const dpr = window.devicePixelRatio || 1;
  const width = canvas.clientWidth || 960;
  const columns = Math.max(...shelves.map((s) => s.columnIndex)) + 1 || 1;
  const rows = Math.max(...shelves.map((s) => s.shelfIndex)) + 1 || 1;

  const padding = 15;
  const gutter = 4;
  const shelfGap = 10;
  const shelfHeight = 45;
  const innerWidth = width - padding * 2 - gutter * (columns - 1);
  const colWidth = innerWidth / columns;
  const height = rows * (shelfHeight + shelfGap) + padding * 2;

  canvas.width = width * dpr;
  canvas.height = height * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);

  ctx.fillStyle = '#0b1221';
  roundedRectPath(
    ctx,
    padding - 12,
    padding - 16,
    width - padding * 2 + 24,
    height - padding * 2 + 32,
    2,
  );
  ctx.fill();

  const rects = [];
  shelves.forEach((shelf) => {
    const x = padding + shelf.columnIndex * (colWidth + gutter);
    const y = padding + shelf.shelfIndex * (shelfHeight + shelfGap);
    const sides = shelf.sides?.length ? shelf.sides : [shelf.color];
    const sideWidth = colWidth - 10;

    sides.forEach((sideColor, idx) => {
      const gradient = ctx.createLinearGradient(x, 0, x + sideWidth, 0);
      gradient.addColorStop(idx % 2 ? 0.9 : 0, rgbToHex(sideColor));
      gradient.addColorStop(idx % 2 ? 0 : 0.9, 'transparent');
      ctx.fillStyle = gradient;
      roundedRectPath(ctx, x, y, sideWidth, shelfHeight, 0);
      ctx.fill();

      rects.push({
        columnIndex: shelf.columnIndex,
        shelfIndex: shelf.shelfIndex,
        side: idx,
        x: x + (sideWidth * idx / 2),
        y,
        width: sideWidth/2,
        height: shelfHeight,
      });

    });
  });
  shelfRects = rects;
}

function applyState(next) {
  if (!next) return;
  if (Array.isArray(next.modes)) {
    clientState.modes = next.modes;
    renderModes(next.modes);
  }
  if (Array.isArray(next.shelves)) {
    clientState.shelves = next.shelves;
    drawShelvesCanvas(next.shelves);
  }
  if ('ready' in next) updateStatus(next.ready);
  if ('currentMode' in next) clientState.currentMode = next.currentMode;
  updateLastSync();
}

function upsertShelf(shelf) {
  const idx = clientState.shelves.findIndex(
    (s) => s.columnIndex === shelf.columnIndex && s.shelfIndex === shelf.shelfIndex,
  );
  if (idx >= 0) clientState.shelves[idx] = { ...clientState.shelves[idx], ...shelf };
  else clientState.shelves.push(shelf);
  drawShelvesCanvas(clientState.shelves);
}

async function refreshState() {
  try {
    const state = await fetchJson(stateUrl);
    applyState(state);
    updateLastSync();
  } catch (err) {
    showToast(`State refresh failed: ${err.message}`);
  }
}

async function runMode() {
  const name = modeSelect.value;
  if (!name) return;
  try {
    await fetchJson('/api/mode', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    });
    clientState.currentMode = name;
    showToast(`Mode ${name} running`);
  } catch (err) {
    showToast(`Failed to run: ${err.message}`);
  }
}

async function stopMode() {
  try {
    await fetchJson('/api/mode/stop', { method: 'POST' });
    clientState.currentMode = null;
    showToast('Mode stopped');
  } catch (err) {
    showToast(`Stop failed: ${err.message}`);
  }
}

async function allOff() {
  try {
    await fetchJson('/api/off', { method: 'POST' });
    showToast('All shelves off');
  } catch (err) {
    showToast(`Off failed: ${err.message}`);
  }
}

function connectSocket() {
  socket = new WebSocket(wsUrl);

  socket.addEventListener('open', () => updateLastSync('Live via WebSocket'));

  socket.addEventListener('message', (event) => {
    try {
      const msg = JSON.parse(event.data);
      if (msg.type === 'state' && msg.data)
        applyState(msg.data);
      if (msg.type === 'shelf' && msg.shelf) {
        upsertShelf(msg.shelf);
        updateLastSync('Live via WebSocket');      }
      if (msg.type === 'mode') {
        clientState.currentMode = msg.name || null;
        if (modeSelect) modeSelect.value = clientState.currentMode || '';
      }
      if (msg.type === 'ready' && 'ready' in msg) 
        updateStatus(msg.ready);
    } catch (err) {
      console.warn('WS message parse failed', err);
    }
  });

  socket.addEventListener('close', () => {
    updateLastSync('WebSocket disconnected…retrying');
    setTimeout(connectSocket, 1200);
  });

  socket.addEventListener('error', () => socket.close());
}

function showToast(message, duration = 2200) {
  toastEl.textContent = message;
  toastEl.classList.remove('hidden');
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => toastEl.classList.add('hidden'), duration);
}

function updateBrushUI(hex) {
  if (!hex) return;
  brushPreview.style.background = hex;

  if(recentColours.indexOf(hex)>-0)
    return;

  recentColours.unshift(hex);
  if(recentColours.length > 10) recentColours.length = 10;
  recentColoursElement.innerHTML = '';  
  recentColours.forEach(c => {
    var d = document.createElement('div');
    d.classList.add('recent-colour');
    d.style.backgroundColor = c;
    d.addEventListener('click',()=>setBrushColor(c));
    recentColoursElement.appendChild(d);
  });
}

function setBrushColor(hex) {
  brushColor = hexToRgb(hex);
  updateBrushUI(hex);
  lastPaint = { key: null, hex: null };
}

function setBrushFromPicker() {
  const hex = colorPicker.value || '#46c2a6';
  setBrushColor(hex);
}

function shelfAtPoint(clientX, clientY) {
  if (!shelfRects.length) return null;
  const bounds = canvas.getBoundingClientRect();
  const x = clientX - bounds.left;
  const y = clientY - bounds.top;
  return shelfRects.find(
    (rect) =>
      x >= rect.x &&
      x <= rect.x + rect.width &&
      y >= rect.y &&
      y <= rect.y + rect.height,
  );
}

async function paintShelfAtEvent(evt) {
  const point = 'touches' in evt ? evt.touches[0] : evt;
  const shelfRect = shelfAtPoint(point.clientX, point.clientY);
  if (!shelfRect) return;

  const brushHex = colorPicker.value || '#46c2a6';
  const key = `${shelfRect.columnIndex}:${shelfRect.shelfIndex}:${shelfRect.side}`;
  if (lastPaint.key === key && lastPaint.hex === brushHex) return;

  try {
    if (clientState.currentMode) await stopMode();
    await fetchJson(`/api/shelves/${shelfRect.columnIndex}/${shelfRect.shelfIndex}/side/${shelfRect.side==0?'left':'right'}/color`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(brushColor),
    });

    const existing = clientState.shelves.find(
      (s) => s.columnIndex === shelfRect.columnIndex && s.shelfIndex === shelfRect.shelfIndex,
    );
    // const sides = existing?.sides?.length ? existing.sides.map(() => brushColor) : undefined;
    // upsertShelf({
    //   columnIndex: shelfRect.columnIndex,
    //   shelfIndex: shelfRect.shelfIndex,
    //   color: brushColor,
    //   ...(sides ? { sides } : {}),
    // });
    lastPaint = { key, hex: brushHex };
  } catch (err) {
    showToast(`Paint failed: ${err.message}`);
  }
}

function handleMouseDown(evt) {
  painting = true;
  paintShelfAtEvent(evt);
}

function handleMouseMove(evt) {
  if (!painting) return;
  paintShelfAtEvent(evt);
}

function stopPainting() {
  painting = false;
}

runModeBtn.addEventListener('click', runMode);
stopModeBtn.addEventListener('click', stopMode);
allOffBtn.addEventListener('click', allOff);
refreshBtn.addEventListener('click', refreshState);

if (colorPicker) {
  colorPicker.addEventListener('change', setBrushFromPicker);
  setBrushFromPicker();
}

canvas.addEventListener('mousedown', handleMouseDown);
canvas.addEventListener('mousemove', handleMouseMove);
canvas.addEventListener('mouseup', stopPainting);
canvas.addEventListener('mouseleave', stopPainting);

canvas.addEventListener(
  'touchstart',
  (evt) => {
    evt.preventDefault();
    painting = true;
    paintShelfAtEvent(evt);
  },
  { passive: false },
);

canvas.addEventListener(
  'touchmove',
  (evt) => {
    evt.preventDefault();
    handleMouseMove(evt);
  },
  { passive: false },
);

canvas.addEventListener('touchend', stopPainting, { passive: false });

refreshState();
connectSocket();

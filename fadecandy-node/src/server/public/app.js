const stateUrl = '/api/state';
const wsUrl = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`;

const animationSelect = document.getElementById('animation-select');
const runAnimationBtn = document.getElementById('run-animation');
const stopAnimationBtn = document.getElementById('stop-animation');
const allOffBtn = document.getElementById('all-off');
const refreshBtn = document.getElementById('refresh-state');
const statusPill = document.getElementById('status-pill');
const lastSync = document.getElementById('last-sync');
const toastEl = document.getElementById('toast');
const canvas = document.getElementById('shelf-canvas');
const ctx = canvas.getContext('2d');

const clientState = {
  ready: false,
  animations: [],
  shelves: [],
  currentAnimation: null,
};

let socket;

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

function renderAnimations(animations) {
  const existingOptions = Array.from(animationSelect.options);
  const existingMap = new Map();
  existingOptions.forEach(opt => {
    existingMap.set(opt.value, opt);
  });
  const incomingSet = new Set(animations);
  animations.forEach(name => {
    let opt = existingMap.get(name);
    if (!opt) {
      // Create new option if it doesn't exist
      opt = document.createElement('option');
      opt.value = name;
      opt.textContent = name;
      animationSelect.appendChild(opt);
    }
    opt.selected = name === clientState.currentAnimation;
    existingMap.delete(name);
  });
  existingMap.forEach(opt => {
    animationSelect.removeChild(opt);
  });
  animationSelect.disabled = animations.length === 0;
}


function drawShelvesCanvas(shelves) {
  if (!shelves || !shelves.length) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
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
  roundedRectPath(ctx, padding - 12, padding - 16, width - padding * 2 + 24, height - padding * 2 + 32, 2);
  ctx.fill();

  shelves.forEach((shelf) => {
    const x = padding + shelf.columnIndex * (colWidth + gutter);
    const y = padding + shelf.shelfIndex * (shelfHeight + shelfGap);
    const sides = shelf.sides?.length ? shelf.sides : [shelf.color];
    const sideWidth = (colWidth - 10);

    sides.forEach((sideColor, idx) => {

      const gradient = ctx.createLinearGradient(x, 0, x + sideWidth, 0);    
       
      gradient.addColorStop(idx%2 ? 0 : 0.9,rgbToHex(sideColor));
      gradient.addColorStop(idx%2 ? 0.9 : 0,"transparent");

      ctx.fillStyle = gradient;

      roundedRectPath(ctx, 
          x,
          y,
          sideWidth,
          shelfHeight,
          0);
      ctx.fill();
    });
  });
}

function applyState(next) {
  if (!next) return;
  if (Array.isArray(next.animations)) {
    clientState.animations = next.animations;
    renderAnimations(next.animations);
  }
  if (Array.isArray(next.shelves)) {
    clientState.shelves = next.shelves;
    drawShelvesCanvas(next.shelves);
  }
  if ('ready' in next) updateStatus(next.ready);
  if ('currentAnimation' in next) clientState.currentAnimation = next.currentAnimation;
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

async function runAnimation() {
  const name = animationSelect.value;
  if (!name) return;
  try {
    await fetchJson('/api/animation', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    });
    clientState.currentAnimation = name;
    showToast(`Running ${name}`);
  } catch (err) {
    showToast(`Failed to run: ${err.message}`);
  }
}

async function stopAnimation() {
  try {
    await fetchJson('/api/animation/stop', { method: 'POST' });
    clientState.currentAnimation = null;
    showToast('Animation stopped');
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
        updateLastSync('Live via WebSocket');
      }
      if (msg.type === 'animation') {
        clientState.currentAnimation = msg.name || null;
      }
      if (msg.type === 'ready' && 'ready' in msg) updateStatus(msg.ready);
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

runAnimationBtn.addEventListener('click', runAnimation);
stopAnimationBtn.addEventListener('click', stopAnimation);
allOffBtn.addEventListener('click', allOff);
refreshBtn.addEventListener('click', refreshState);

refreshState();
connectSocket();

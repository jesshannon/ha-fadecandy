const stateUrl = '/api/state';

const gridEl = document.getElementById('shelf-grid');
const animationSelect = document.getElementById('animation-select');
const runAnimationBtn = document.getElementById('run-animation');
const stopAnimationBtn = document.getElementById('stop-animation');
const allOffBtn = document.getElementById('all-off');
const refreshBtn = document.getElementById('refresh-state');
const statusPill = document.getElementById('status-pill');
const usbReadout = document.getElementById('usb-readout');
const lastSync = document.getElementById('last-sync');
const toastEl = document.getElementById('toast');

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

function renderAnimations(animations) {
  animationSelect.innerHTML = '';
  animations.forEach((name) => {
    const opt = document.createElement('option');
    opt.value = name;
    opt.textContent = name;
    animationSelect.appendChild(opt);
  });
}

function renderShelves(shelves) {
  const byColumn = shelves.reduce((map, shelf) => {
    const key = shelf.columnIndex;
    if (!map[key]) map[key] = [];
    map[key].push(shelf);
    return map;
  }, {});

  const columnKeys = Object.keys(byColumn)
    .map(Number)
    .sort((a, b) => a - b);

  gridEl.style.gridTemplateColumns = `repeat(${columnKeys.length || 1}, minmax(180px, 1fr))`;

  const seenColumns = new Set();
  const seenShelves = new Set();

  columnKeys.forEach((colIndex) => {
    const shelvesInCol = byColumn[colIndex].sort((a, b) => a.shelfIndex - b.shelfIndex);
    const colKey = `col-${colIndex}`;
    let colEl = gridEl.querySelector(`[data-column="${colKey}"]`);
    if (!colEl) {
      colEl = document.createElement('div');
      colEl.className = 'shelf-column';
      colEl.dataset.column = colKey;
      const header = document.createElement('header');
      const title = document.createElement('h3');
      title.textContent = `Column ${colIndex + 1}`;
      const muted = document.createElement('span');
      muted.className = 'muted';
      header.appendChild(title);
      header.appendChild(muted);
      colEl.appendChild(header);
      gridEl.appendChild(colEl);
    }
    // update header count
    const muted = colEl.querySelector('.muted');
    if (muted) muted.textContent = `${shelvesInCol.length} shelves`;

    seenColumns.add(colKey);

    shelvesInCol.forEach(({ shelfIndex, columnIndex, color }) => {
      const shelfKey = `shelf-${columnIndex}-${shelfIndex}`;
      let card = colEl.querySelector(`[data-shelf="${shelfKey}"]`);
      if (!card) {
        card = document.createElement('div');
        card.className = 'shelf-card';
        card.dataset.shelf = shelfKey;
        card.style.position = 'relative';

        const top = document.createElement('div');
        top.className = 'shelf-id';
        const h4 = document.createElement('h4');
        h4.textContent = `${shelfIndex + 1}`;
        top.appendChild(h4);

        const swatch = document.createElement('div');
        swatch.className = 'swatch';

        const picker = document.createElement('input');
        picker.type = 'color';
        picker.className = 'hidden-picker';
        picker.ariaLabel = 'Pick shelf color';
        picker.dataset.role = 'picker';

        picker.addEventListener('change', async () => {
          const target = hexToRgb(picker.value);
          try {
            await fetchJson(`/api/shelves/${columnIndex}/${shelfIndex}/color`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(target),
            });
            swatch.style.background = picker.value;
            showToast(`Updated C${columnIndex + 1} S${shelfIndex + 1}`);
            refreshState(); // sync after change
          } catch (err) {
            showToast(`Failed: ${err.message}`);
          }
        });

        card.addEventListener('click', () => picker.click());

        swatch.appendChild(top);
        card.appendChild(swatch);
        card.appendChild(picker);
        colEl.appendChild(card);
      }

      const swatch = card.querySelector('.swatch');
      const picker = card.querySelector('[data-role="picker"]');
      const hex = rgbToHex(color);
      if (swatch) swatch.style.background = hex;
      if (picker && document.activeElement !== picker) picker.value = hex;

      seenShelves.add(shelfKey);
    });

    // remove stale shelves in this column
    colEl.querySelectorAll('[data-shelf]').forEach((node) => {
      if (!seenShelves.has(node.dataset.shelf)) node.remove();
    });
  });

  // remove stale columns
  gridEl.querySelectorAll('[data-column]').forEach((node) => {
    if (!seenColumns.has(node.dataset.column)) node.remove();
  });
}

async function refreshState() {
  //try {
    const state = await fetchJson(stateUrl);
    renderAnimations(state.animations || []);
    renderShelves(state.shelves || []);
    const stamp = new Date().toLocaleTimeString();
    lastSync.textContent = `Last sync ${stamp}`;
    statusPill.textContent = state.ready ? 'Fadecandy Ready' : 'Waiting for Fadecandy';
    statusPill.classList.toggle('ready', !!state.ready);
  // } catch (err) {
  //   showToast(`State refresh failed: ${err.message}`);
  // }
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
    showToast(`Running ${name}`);
  } catch (err) {
    showToast(`Failed to run: ${err.message}`);
  }
}

async function stopAnimation() {
  try {
    await fetchJson('/api/animation/stop', { method: 'POST' });
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
setInterval(refreshState, 1200);

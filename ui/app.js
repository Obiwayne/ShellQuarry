// ShellQuarry UI: the terminal on the left, the browser panel on the right.
// The panel itself is a separate native webview; this page only reserves its
// space (#browser-slot) and tells Rust where to put it.

const { invoke } = window.__TAURI__.core;
const { listen } = window.__TAURI__.event;

const $ = (id) => document.getElementById(id);
const globe = $('globe');
const pane = $('browser-pane');
const divider = $('divider');
const slot = $('browser-slot');
const urlInput = $('url');
const spinner = $('spinner');
const chip = $('agent-chip');

const store = {
  get(key) { try { return localStorage.getItem(key); } catch { return null; } },
  set(key, value) { try { localStorage.setItem(key, value); } catch { /* storage unavailable */ } },
};

// ---- Terminal ----------------------------------------------------------

const term = new Terminal({
  fontFamily: '"Cascadia Mono", "Cascadia Code", Consolas, monospace',
  fontSize: 13,
  cursorBlink: true,
  scrollback: 5000,
  theme: {
    background: '#0d0f14', foreground: '#e6e9ef', cursor: '#6aa8ff',
    selectionBackground: '#2b3a55',
  },
});
const fit = new FitAddon.FitAddon();
term.loadAddon(fit);
term.open($('term'));
fit.fit();

let running = false;

async function startShell() {
  try {
    await invoke('pty_start', { cols: term.cols, rows: term.rows });
    running = true;
  } catch (err) {
    term.write(`\r\n\x1b[31mCould not start the shell: ${err}\x1b[0m\r\n`);
  }
}

term.onData((data) => {
  if (!running) {
    if (data === '\r') { term.reset(); startShell(); }
    return;
  }
  invoke('pty_write', { data }).catch(() => {});
});

listen('pty-data', (e) => term.write(e.payload));
listen('pty-exit', () => {
  running = false;
  term.write('\r\n\x1b[90m[shell exited — press Enter to start a new one]\x1b[0m\r\n');
});

new ResizeObserver(() => {
  fit.fit();
  if (running) invoke('pty_resize', { cols: term.cols, rows: term.rows }).catch(() => {});
}).observe($('term-pane'));

startShell();
term.focus();

// ---- Browser panel -----------------------------------------------------

let open = false;

function placeBrowser() {
  if (!open) return invoke('browser_layout', { visible: false, x: 0, y: 0, width: 0, height: 0 });
  const r = slot.getBoundingClientRect();
  return invoke('browser_layout', { visible: true, x: r.left, y: r.top, width: r.width, height: r.height });
}

function setPanel(next) {
  open = next;
  pane.hidden = !open;
  divider.hidden = !open;
  globe.setAttribute('aria-pressed', String(open));
  store.set('panelOpen', open ? '1' : '0');
  // Wait a frame so the slot has its final size before placing the webview.
  requestAnimationFrame(() => { placeBrowser(); fit.fit(); });
  if (!open) term.focus();
}

new ResizeObserver(() => placeBrowser()).observe(slot);
window.addEventListener('resize', () => placeBrowser());

globe.addEventListener('click', () => setPanel(!open));
$('close-panel').addEventListener('click', () => setPanel(false));
document.addEventListener('keydown', (e) => {
  if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'b') { e.preventDefault(); setPanel(!open); }
});

$('address').addEventListener('submit', (e) => {
  e.preventDefault();
  const url = urlInput.value.trim();
  if (url) invoke('browser_navigate', { url }).catch((err) => { urlInput.value = String(err); });
});

for (const btn of document.querySelectorAll('[data-history]')) {
  btn.addEventListener('click', () => invoke('browser_history', { action: btn.dataset.history }).catch(() => {}));
}

listen('browser-page', (e) => {
  const { url, loading } = e.payload;
  spinner.hidden = !loading;
  if (document.activeElement !== urlInput) urlInput.value = url.startsWith('data:') || url === 'about:blank' ? '' : url;
});

// Drag the divider to resize the panel; the width is remembered.
const savedWidth = Number(store.get('panelWidth'));
if (savedWidth > 0) pane.style.width = `${savedWidth}px`;

divider.addEventListener('pointerdown', (e) => {
  divider.setPointerCapture(e.pointerId);
  divider.classList.add('dragging');
  const total = $('split').getBoundingClientRect().width;
  const move = (ev) => {
    const width = Math.min(Math.max(total - ev.clientX, 320), total - 360);
    pane.style.width = `${width}px`;
  };
  const up = () => {
    divider.classList.remove('dragging');
    divider.removeEventListener('pointermove', move);
    store.set('panelWidth', String(Math.round(pane.getBoundingClientRect().width)));
  };
  divider.addEventListener('pointermove', move);
  divider.addEventListener('pointerup', up, { once: true });
});

// ---- Agent hooks -------------------------------------------------------
// mcp/server.mjs calls these over the DevTools port so an agent can open the
// panel and show that it is working.

let agentTimer;
window.shellquarry = {
  openPanel() { if (!open) setPanel(true); return true; },
  closePanel() { if (open) setPanel(false); return true; },
  isOpen: () => open,
  agentActivity(label) {
    chip.classList.add('active');
    $('agent-label').textContent = label || 'Agent is browsing';
    clearTimeout(agentTimer);
    agentTimer = setTimeout(() => {
      chip.classList.remove('active');
      $('agent-label').textContent = 'Agent browser ready';
    }, 4000);
    return true;
  },
};

if (store.get('panelOpen') === '1') setPanel(true);

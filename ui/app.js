// ShellQuarry UI, laid out like the Claude Code desktop app: Herdr's
// workspaces and agents in the sidebar, the terminal in the middle, and the
// browser as a side panel. Browser tabs are native webviews owned by Rust;
// this page renders their tabs and address bar and reports where the panel's
// slot is.

const { invoke } = window.__TAURI__.core;
const { listen } = window.__TAURI__.event;

const $ = (id) => document.getElementById(id);
const els = {
  globe: $('globe'), mode: $('mode'), agent: $('agent'), agentState: $('agent-state'),
  termPane: $('term-pane'), browserPane: $('browser-pane'), gutter: $('gutter'),
  tabs: $('tabs'), newTab: $('new-tab'), url: $('url'), loading: $('loading'), notice: $('notice'), slot: $('slot'),
  titleMain: $('title-main'), titleSub: $('title-sub'),
  workspaces: $('workspaces'), agents: $('agents'), agentsEmpty: $('agents-empty'),
  palette: $('palette'), paletteBtn: $('palette-btn'), paletteList: $('palette-list'), paletteName: $('palette-name'),
};

const store = {
  get(key) { try { return localStorage.getItem(key); } catch { return null; } },
  set(key, value) { try { localStorage.setItem(key, value); } catch { /* storage unavailable */ } },
};

let info = {};
let state = { tabs: [], active: null, open: false, lite: false, max_tabs: 8 };
let herdrConfig = {};
let paletteChoice = store.get('palette') || 'herdr';
let palette;

// ---- Terminal ------------------------------------------------------------------

const term = new Terminal({
  fontFamily: '"Cascadia Mono", "Cascadia Code", "JetBrains Mono", Consolas, monospace',
  fontSize: 13,
  lineHeight: 1.15,
  cursorBlink: true,
  scrollback: 5000,
  allowProposedApi: true,
});
const fit = new FitAddon.FitAddon();
term.loadAddon(fit);

let running = false;

async function startShell() {
  try {
    await invoke('pty_start', { cols: term.cols, rows: term.rows });
    running = true;
  } catch (err) {
    term.write(`\r\n\x1b[31mCould not start ${info.shell || 'the shell'}: ${err}\x1b[0m\r\n`);
  }
}

term.onData((data) => {
  if (!running) {
    if (data === '\r') { term.reset(); startShell(); }
    return;
  }
  invoke('pty_write', { data }).catch(() => {});
});

// Keep the app's shortcuts away from the terminal.
const appShortcut = (e) => e.ctrlKey && e.shiftKey && ['b', 's'].includes(e.key.toLowerCase());
term.attachCustomKeyEventHandler((e) => !appShortcut(e));

listen('pty-data', (e) => term.write(e.payload));
listen('pty-exit', () => {
  running = false;
  term.write(`\r\n\x1b[90m[${info.shell || 'shell'} exited — press Enter to start it again]\x1b[0m\r\n`);
});

function refit() {
  if (document.body.classList.contains('browser-only')) return;
  fit.fit();
  if (running) invoke('pty_resize', { cols: term.cols, rows: term.rows }).catch(() => {});
}
new ResizeObserver(refit).observe(els.termPane);

// ---- Colours ---------------------------------------------------------------------

function applyTheme() {
  palette = ShellQuarryTheme.resolve(paletteChoice, herdrConfig);
  ShellQuarryTheme.apply(palette);
  term.options.theme = ShellQuarryTheme.xterm(palette);
  els.paletteName.textContent = palette.label;
  invoke('set_page_colors', { bg: palette.card, text: palette.text, muted: palette.muted }).catch(() => {});
  if (!els.palette.hidden) renderPalette();
}

function renderPalette() {
  els.paletteList.replaceChildren();
  let group;
  for (const choice of ShellQuarryTheme.choices(herdrConfig)) {
    if (choice.group && choice.group !== group) {
      group = choice.group;
      const h = document.createElement('p');
      h.className = 'palette-group';
      h.textContent = group;
      els.paletteList.append(h);
    }
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'palette-item';
    item.setAttribute('role', 'menuitemradio');
    item.setAttribute('aria-checked', String(choice.id === paletteChoice));
    item.innerHTML = '<span class="dots"></span><span class="label"></span><span class="tick">✓</span>';
    for (const color of choice.dots) {
      const dot = document.createElement('i');
      dot.style.background = color;
      item.querySelector('.dots').append(dot);
    }
    item.querySelector('.label').textContent = choice.label;
    item.addEventListener('click', () => {
      paletteChoice = choice.id;
      store.set('palette', paletteChoice);
      applyTheme();
    });
    els.paletteList.append(item);
  }
}

function setPaletteOpen(open) {
  els.palette.hidden = !open;
  els.paletteBtn.setAttribute('aria-expanded', String(open));
  if (open) {
    renderPalette();
    els.paletteList.querySelector('[aria-checked="true"]')?.scrollIntoView({ block: 'nearest' });
  }
  // The browser webview draws above the page, so get it out of the way while the picker is open.
  reportRect();
}

els.paletteBtn.addEventListener('click', (e) => { e.stopPropagation(); setPaletteOpen(els.palette.hidden); });
document.addEventListener('click', (e) => {
  if (!els.palette.hidden && !els.palette.contains(e.target)) setPaletteOpen(false);
});

// Pick up theme changes made in Herdr when the window regains focus.
async function refreshHerdrTheme() {
  herdrConfig = await invoke('herdr_theme').catch(() => herdrConfig);
  applyTheme();
}
window.addEventListener('focus', refreshHerdrTheme);
window.matchMedia('(prefers-color-scheme: light)').addEventListener('change', refreshHerdrTheme);

// ---- Sidebar: Herdr workspaces and agents ------------------------------------------

function setSidebar(open) {
  document.body.classList.toggle('sidebar-hidden', !open);
  $('toggle-sidebar').setAttribute('aria-expanded', String(open));
  store.set('sidebar', open ? '1' : '0');
  requestAnimationFrame(() => { refit(); reportRect(); });
}
$('toggle-sidebar').addEventListener('click', () => setSidebar(document.body.classList.contains('sidebar-hidden')));

const STATUS = { working: 'Working', blocked: 'Needs you', done: 'Done', idle: 'Idle', unknown: '' };

function row({ name, meta, status, num, current, onClick }) {
  const li = document.createElement('li');
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = `row${current ? ' current' : ''}`;
  btn.innerHTML = '<span class="dot"></span><span class="text"><span class="name"></span><span class="meta"></span></span>';
  if (num != null) {
    const n = document.createElement('span');
    n.className = 'num';
    n.textContent = num;
    btn.prepend(n);
  }
  btn.querySelector('.dot').classList.add(status || 'unknown');
  btn.querySelector('.name').textContent = name;
  const m = btn.querySelector('.meta');
  if (meta) m.textContent = meta; else m.remove();
  btn.addEventListener('click', onClick);
  li.append(btn);
  return li;
}

async function focusInHerdr(kind, id) {
  try { await invoke('herdr_focus', { kind, id }); } catch (err) { flash(String(err)); }
  term.focus();
}

let overviewKey = '';
async function refreshOverview() {
  if (document.body.classList.contains('browser-only') || document.visibilityState === 'hidden') return;
  const o = await invoke('herdr_overview').catch(() => null);
  if (!o) return;
  const key = JSON.stringify(o);
  if (key === overviewKey) return;
  overviewKey = key;

  els.workspaces.replaceChildren(...o.workspaces.map((w) => row({
    name: w.label || `Workspace ${w.number}`,
    meta: `${w.tab_count} tab${w.tab_count === 1 ? '' : 's'} · ${w.pane_count} pane${w.pane_count === 1 ? '' : 's'}`,
    status: w.agent_status, num: w.number, current: w.focused,
    onClick: () => focusInHerdr('workspace', w.workspace_id),
  })));

  els.agents.replaceChildren(...o.agents.map((a) => {
    const name = a.name || a.display_agent || a.agent || 'Agent';
    const where = o.workspaces.find((w) => w.workspace_id === a.workspace_id)?.label;
    const meta = [STATUS[a.agent_status], a.title || a.terminal_title_stripped, where].filter(Boolean).join(' · ');
    return row({ name, meta, status: a.agent_status, onClick: () => focusInHerdr('agent', a.terminal_id) });
  }));
  els.agentsEmpty.hidden = o.agents.length > 0;
  if (!o.installed) els.agentsEmpty.textContent = 'Herdr is not installed. Get it from herdr.dev to see your agents here.';

  const focused = o.workspaces.find((w) => w.focused);
  if (info.shell === 'herdr') {
    els.titleMain.textContent = focused ? focused.label : 'Herdr';
    const working = o.agents.filter((a) => a.agent_status === 'working').length;
    els.titleSub.textContent = o.agents.length
      ? `${o.agents.length} agent${o.agents.length === 1 ? '' : 's'}${working ? ` · ${working} working` : ''}`
      : 'Herdr';
  }
}
setInterval(refreshOverview, 2500);
document.addEventListener('visibilitychange', refreshOverview);

$('connect').addEventListener('click', async () => {
  try {
    await invoke('herdr_open_setup');
    term.focus();
  } catch (err) {
    flash(`Couldn't open the setup in Herdr: ${err}`);
  }
});

let flashTimer;
function flash(message) {
  const before = els.titleSub.textContent;
  els.titleSub.textContent = message;
  clearTimeout(flashTimer);
  flashTimer = setTimeout(() => { els.titleSub.textContent = before; overviewKey = ''; refreshOverview(); }, 4000);
}

// ---- Browser panel -----------------------------------------------------------------

let lastRect = '';

function reportRect() {
  const visible = state.open && !els.browserPane.hidden && els.palette.hidden;
  let rect = null;
  if (visible) {
    const r = els.slot.getBoundingClientRect();
    if (r.width > 0 && r.height > 0) rect = [r.left, r.top, r.width, r.height];
  }
  const key = JSON.stringify(rect);
  if (key === lastRect) return;
  lastRect = key;
  invoke('browser_layout', { rect }).catch(showError);
}

new ResizeObserver(() => reportRect()).observe(els.slot);
window.addEventListener('resize', () => reportRect());

function hostOf(url) {
  try { return new URL(url).host.replace(/^www\./, ''); } catch { return url; }
}

function renderTabs() {
  els.tabs.replaceChildren();
  for (const tab of state.tabs) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `tab${tab.id === state.active ? ' active' : ''}`;
    btn.title = tab.url || 'New tab';
    btn.setAttribute('aria-current', tab.id === state.active ? 'page' : 'false');
    const label = tab.title && tab.title !== 'New tab' ? tab.title : (tab.url ? hostOf(tab.url) : 'New tab');
    btn.innerHTML = '<span class="status"></span><span class="title"></span><span class="x" role="button" aria-label="Close tab">×</span>';
    btn.querySelector('.title').textContent = label;
    const status = btn.querySelector('.status');
    if (tab.loading) status.className = 'busy';
    else if (!tab.alive && state.lite && tab.id !== state.active) { status.className = 'asleep'; status.title = 'Unloaded to save memory'; }
    else status.remove();
    btn.addEventListener('click', (e) => {
      if (e.target.classList.contains('x')) invoke('browser_close_tab', { id: tab.id }).catch(showError);
      else invoke('browser_select_tab', { id: tab.id }).catch(showError);
    });
    btn.addEventListener('auxclick', (e) => { if (e.button === 1) invoke('browser_close_tab', { id: tab.id }).catch(showError); });
    els.tabs.append(btn);
  }
  els.newTab.disabled = state.tabs.length >= state.max_tabs;
  els.newTab.title = els.newTab.disabled ? `${state.max_tabs} tabs is the limit in ${state.lite ? 'lite' : 'full'} mode` : 'New tab';
}

function render() {
  const wasHidden = els.browserPane.hidden;
  els.browserPane.hidden = !state.open;
  els.gutter.hidden = !state.open;
  els.globe.setAttribute('aria-pressed', String(state.open));
  renderTabs();

  const tab = state.tabs.find((t) => t.id === state.active);
  if (document.activeElement !== els.url) els.url.value = tab?.url || '';
  els.loading.hidden = !tab?.loading;

  els.mode.textContent = state.lite ? 'Lite' : 'Full';
  const gb = info.memory_gb ? `${Math.round(info.memory_gb)} GB memory. ` : '';
  els.mode.title = state.lite
    ? `${gb}Lite mode: only the open tab stays loaded, up to ${state.max_tabs} tabs. Click for full mode.`
    : `${gb}Full mode: every tab stays loaded, up to ${state.max_tabs} tabs. Click for lite mode.`;

  if (wasHidden !== els.browserPane.hidden) {
    requestAnimationFrame(() => { refit(); reportRect(); });
    if (!state.open) term.focus();
  } else {
    reportRect();
  }
}

listen('browser-state', (e) => { state = e.payload; render(); });
listen('browser-error', (e) => showError(e.payload));

let noticeTimer;
function showError(err) {
  if (els.browserPane.hidden) { flash(String(err)); return; }
  els.notice.textContent = String(err);
  els.notice.hidden = false;
  clearTimeout(noticeTimer);
  noticeTimer = setTimeout(() => { els.notice.hidden = true; reportRect(); }, 4000);
  requestAnimationFrame(reportRect);
}

const setOpen = (open) => invoke('browser_set_open', { open }).catch(showError);

els.globe.addEventListener('click', () => setOpen(!state.open));
$('close-panel').addEventListener('click', () => setOpen(false));
els.newTab.addEventListener('click', () => invoke('browser_new_tab', { url: null }).catch(showError));
els.mode.addEventListener('click', () => invoke('browser_set_lite', { lite: !state.lite }).catch(showError));
document.addEventListener('keydown', (e) => {
  if (!appShortcut(e)) {
    if (e.key === 'Escape' && !els.palette.hidden) setPaletteOpen(false);
    return;
  }
  e.preventDefault();
  if (e.key.toLowerCase() === 'b') setOpen(!state.open);
  else setSidebar(document.body.classList.contains('sidebar-hidden'));
});

$('address').addEventListener('submit', (e) => {
  e.preventDefault();
  const url = els.url.value.trim();
  if (url) invoke('browser_navigate', { url }).then(() => els.url.blur()).catch(showError);
});
els.url.addEventListener('keydown', (e) => { if (e.key === 'Escape') { els.url.blur(); render(); } });
els.url.addEventListener('focus', () => els.url.select());

for (const btn of document.querySelectorAll('[data-history]')) {
  btn.addEventListener('click', () => invoke('browser_history', { action: btn.dataset.history }).catch(showError));
}

// Drag the gutter to resize the panel; the width is remembered.
const savedWidth = Number(store.get('panelWidth'));
if (savedWidth > 0) els.browserPane.style.width = `${savedWidth}px`;

els.gutter.addEventListener('pointerdown', (e) => {
  els.gutter.setPointerCapture(e.pointerId);
  els.gutter.classList.add('dragging');
  const body = $('body').getBoundingClientRect();
  const move = (ev) => {
    const width = Math.min(Math.max(body.right - 10 - ev.clientX, 360), body.width - 420);
    els.browserPane.style.width = `${width}px`;
  };
  const up = () => {
    els.gutter.classList.remove('dragging');
    els.gutter.removeEventListener('pointermove', move);
    store.set('panelWidth', String(Math.round(els.browserPane.getBoundingClientRect().width)));
  };
  els.gutter.addEventListener('pointermove', move);
  els.gutter.addEventListener('pointerup', up, { once: true });
});

// ---- Agent activity (sent by the MCP server through the control API) -----------------

let agentTimer;
listen('agent-activity', (e) => {
  els.agent.hidden = false;
  const label = String(e.payload || 'browsing');
  els.agentState.textContent = `Agent is ${label}`;
  clearTimeout(agentTimer);
  agentTimer = setTimeout(() => { els.agent.hidden = true; }, 4000);
});

// ---- Start ---------------------------------------------------------------------------

(async () => {
  info = await invoke('app_info');
  herdrConfig = info.theme || {};
  applyTheme();
  state = info.browser;
  if (store.get('sidebar') === '0') document.body.classList.add('sidebar-hidden');
  if (info.browser_only) {
    document.body.classList.add('browser-only');
    document.title = 'ShellQuarry browser';
    els.titleMain.textContent = 'Browser';
    els.titleSub.textContent = 'for Herdr';
    $('toggle-sidebar').hidden = true;
  } else {
    els.titleMain.textContent = info.shell === 'herdr' ? 'Herdr' : info.shell;
    term.open($('term'));
    fit.fit();
    startShell();
    term.focus();
    refreshOverview();
  }
  render();
})();

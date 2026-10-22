// Herdr's features as a Claude Code-style interface: the agents, workspaces
// and machines in the sidebar, a "New agent" dialog, a message box that talks
// to the selected agent, right-click menus, Herdr's tabs and splits above the
// terminal, alerts when an agent needs you, a command palette and a short tour.
// Everything runs through the Herdr CLI (src-tauri/src/herdr.rs).

(function () {
  const { invoke, $, store, term, toast, setOverlay } = window.SQ;

  const els = {
    agents: $('agents'), agentsEmpty: $('agents-empty'), agentsCount: $('agents-count'),
    workspaces: $('workspaces'), machines: $('machines'),
    herdrTabs: $('herdr-tabs'), titleMain: $('title-main'), titleSub: $('title-sub'),
    composer: $('composer'), message: $('message'), send: $('send'), stop: $('stop'),
    target: $('target'), targetName: $('target-name'), targetDot: $('target-dot'),
    menu: $('menu'), scrim: $('scrim'), dialogTitle: $('dialog-title'), dialogBody: $('dialog-body'),
    dialogError: $('dialog-error'), dialogOk: $('dialog-ok'), dialogCancel: $('dialog-cancel'),
    commands: $('commands'), commandInput: $('command-input'), commandList: $('command-list'),
  };

  const STATUS = { working: 'Working', blocked: 'Needs you', done: 'Done', idle: 'Idle', unknown: '' };

  let local = { installed: false, running: false, workspaces: [], agents: [], tabs: [] };
  let machines = [];
  let kinds = [];
  /** The agent the message box talks to: { machine, target, name }. */
  let selected = JSON.parse(store.get('selectedAgent') || 'null');
  const seen = new Map();
  /** Agents the New agent dialog already told the user about, so the alert isn't repeated. */
  const announced = new Set();

  const herdr = (args, machine = null) => invoke('herdr_cmd', { machine, args });
  /** The first pane_id anywhere in a Herdr result. */
  const findPaneId = (v) => {
    if (!v || typeof v !== 'object') return null;
    if (typeof v.pane_id === 'string') return v.pane_id;
    for (const x of Object.values(v)) { const id = findPaneId(x); if (id) return id; }
    return null;
  };
  const targetOf = (a) => a.name || a.pane_id;
  const nameOf = (a) => a.name || a.display_agent || a.agent || 'Agent';
  const kindLabel = (k) => kinds.find((x) => x.kind === k)?.label || k;

  /** Every agent, here and on other machines, as { agent, machine, machineLabel }. */
  function allAgents() {
    const list = local.agents.map((a) => ({ agent: a, machine: null, machineLabel: 'This PC' }));
    for (const m of machines) for (const a of m.agents || []) list.push({ agent: a, machine: m.id, machineLabel: m.label });
    return list;
  }

  function findSelected() {
    if (!selected) return null;
    return allAgents().find((x) => x.machine === selected.machine && targetOf(x.agent) === selected.target) || null;
  }

  function select(entry) {
    selected = entry ? { machine: entry.machine, target: targetOf(entry.agent), name: nameOf(entry.agent) } : null;
    store.set('selectedAgent', JSON.stringify(selected));
    renderAgents();
    renderComposer();
  }

  async function run(promise, okMessage) {
    try {
      const result = await promise;
      if (okMessage) toast(okMessage, { kind: 'good' });
      refresh();
      return result;
    } catch (err) {
      toast(String(err), { kind: 'error', timeout: 7000 });
      return undefined;
    }
  }

  // ---- Sidebar ------------------------------------------------------------------

  function row({ name, meta, status, num, current, selectedRow, badge, dim, onClick, onMenu }) {
    const li = document.createElement('li');
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `row${current ? ' current' : ''}${selectedRow ? ' selected' : ''}${dim ? ' dim' : ''}`;
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
    if (badge) {
      const b = document.createElement('span');
      b.className = `badge${badge === 'Done' ? ' done' : ''}`;
      b.textContent = badge;
      btn.append(b);
    }
    btn.addEventListener('click', onClick);
    if (onMenu) {
      btn.addEventListener('contextmenu', (e) => { e.preventDefault(); onMenu(e.clientX, e.clientY); });
    }
    li.append(btn);
    return li;
  }

  function agentRow(entry) {
    const { agent: a, machine, machineLabel } = entry;
    const where = machine
      ? machineLabel
      : local.workspaces.find((w) => w.workspace_id === a.workspace_id)?.label;
    const meta = [STATUS[a.agent_status], a.agent && a.name ? kindLabel(a.agent) : null, where].filter(Boolean).join(' · ');
    const isSel = selected && selected.machine === machine && selected.target === targetOf(a);
    return row({
      name: nameOf(a), meta, status: a.agent_status, current: !machine && a.focused, selectedRow: isSel,
      badge: a.agent_status === 'blocked' ? 'Needs you' : null,
      onClick: () => { select(entry); if (!machine) focusAgent(entry); },
      onMenu: (x, y) => agentMenu(entry, x, y),
    });
  }

  function renderAgents() {
    const list = allAgents();
    els.agents.replaceChildren(...list.map(agentRow));
    els.agentsCount.textContent = list.length ? String(list.length) : '';
    els.agentsEmpty.hidden = list.length > 0;
    if (!local.installed) {
      els.agentsEmpty.textContent = 'Herdr is not installed. Install it from herdr.dev to run agents here.';
    }
  }

  function renderWorkspaces() {
    els.workspaces.replaceChildren(...local.workspaces.map((w) => row({
      name: w.label || `Workspace ${w.number}`,
      meta: `${w.tab_count} tab${w.tab_count === 1 ? '' : 's'} · ${w.pane_count} pane${w.pane_count === 1 ? '' : 's'}`,
      status: w.agent_status, num: w.number, current: w.focused,
      onClick: () => run(herdr(['workspace', 'focus', w.workspace_id])).then(() => term.focus()),
      onMenu: (x, y) => workspaceMenu(w, x, y),
    })));
  }

  function renderMachines() {
    const items = [row({
      name: 'This PC', meta: local.running ? `${local.workspaces.length} workspace${local.workspaces.length === 1 ? '' : 's'}` : 'Herdr not running',
      status: local.running ? 'done' : 'unknown',
      onClick: () => term.focus(),
    })];
    for (const m of machines) {
      items.push(row({
        name: m.label,
        meta: !m.enabled ? 'Turned off' : m.online
          ? `${m.workspaces.length} workspace${m.workspaces.length === 1 ? '' : 's'} · ${m.agents.length} agent${m.agents.length === 1 ? '' : 's'}`
          : (m.error ? 'Offline' : 'Connecting…'),
        status: m.online ? 'done' : m.enabled ? 'blocked' : 'unknown', dim: !m.enabled,
        onClick: (e) => machineMenu(m, ...menuPointFor(e)),
        onMenu: (x, y) => machineMenu(m, x, y),
      }));
    }
    els.machines.replaceChildren(...items);
  }

  const menuPointFor = (e) => {
    const r = e?.currentTarget?.getBoundingClientRect?.() || { left: 40, bottom: 200 };
    return [r.left + 20, r.bottom];
  };

  function renderHerdrTabs() {
    els.herdrTabs.replaceChildren(...local.tabs.map((t) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = `herdr-tab${t.focused ? ' active' : ''}`;
      // Say what's in the tab: its agents' names, or "Terminal". A name the user gave the tab wins.
      const inTab = (local.agents || []).filter((a) => a.tab_id === t.tab_id).map(nameOf);
      const named = t.label && t.label !== String(t.number) && !inTab.includes(t.label);
      b.textContent = named ? t.label : inTab.length ? inTab.join(' + ') : 'Terminal';
      b.title = `Tab ${t.number}${inTab.length ? `: ${inTab.join(', ')}` : ': a terminal'} (right-click to rename)`;
      if (t.agent_status === 'working' || t.agent_status === 'blocked') {
        const d = document.createElement('span');
        d.className = `dot ${t.agent_status}`;
        b.append(d);
      }
      if (local.tabs.length > 1) {
        const x = document.createElement('span');
        x.className = 'tab-close';
        x.textContent = '×';
        x.title = 'Close tab';
        x.setAttribute('role', 'button');
        x.addEventListener('click', (e) => { e.stopPropagation(); closeTab(t); });
        b.append(x);
      }
      b.addEventListener('click', () => run(herdr(['tab', 'focus', t.tab_id])).then(() => term.focus()));
      b.addEventListener('auxclick', (e) => { if (e.button === 1 && local.tabs.length > 1) closeTab(t); });
      b.addEventListener('contextmenu', (e) => { e.preventDefault(); tabMenu(t, e.clientX, e.clientY); });
      return b;
    }));
    const add = document.createElement('button');
    add.type = 'button';
    add.className = 'herdr-tab';
    add.textContent = '+';
    add.title = 'New tab: a terminal or an agent';
    add.addEventListener('click', (e) => newTabMenu(...menuPointFor(e)));
    if (local.running) els.herdrTabs.append(add);
  }

  function renderTitle() {
    if (window.SQ.info.shell !== 'herdr') return;
    const focused = local.workspaces.find((w) => w.focused);
    els.titleMain.textContent = focused ? focused.label : 'Herdr';
    const all = allAgents();
    const working = all.filter((x) => x.agent.agent_status === 'working').length;
    const blocked = all.filter((x) => x.agent.agent_status === 'blocked').length;
    els.titleSub.textContent = [
      all.length ? `${all.length} agent${all.length === 1 ? '' : 's'}` : 'Herdr',
      working ? `${working} working` : null,
      blocked ? `${blocked} need${blocked === 1 ? 's' : ''} you` : null,
    ].filter(Boolean).join(' · ');
  }

  // ---- Alerts: tell the user when an agent needs them or finishes ------------------

  function alertChanges() {
    sendPendingHandoffs();
    for (const { agent: a, machine, machineLabel } of allAgents()) {
      const key = `${machine || ''}|${a.pane_id}`;
      const before = seen.get(key);
      seen.set(key, { status: a.agent_status, done: a.completion_seq });
      if (!before) continue;
      const entry = { agent: a, machine, machineLabel };
      const where = machine ? ` on ${machineLabel}` : '';
      if (before.status === 'working' && a.agent_status !== 'working') checkUsage(entry);
      if (a.agent_status === 'blocked' && announced.delete(`${machine || ''}|${a.name}`)) continue;
      if (a.agent_status === 'blocked' && before.status !== 'blocked') {
        toast(`${nameOf(a)}${where} needs you`, { kind: 'error', action: 'Show', onAction: () => { select(entry); focusAgent(entry); }, timeout: 10000 });
      } else if (a.completion_seq && a.completion_seq !== before.done && a.agent_status !== 'working') {
        toast(`${nameOf(a)}${where} finished`, { kind: 'good', action: 'Show', onAction: () => { select(entry); focusAgent(entry); } });
      }
    }
  }

  // ---- Refresh ------------------------------------------------------------------------

  let refreshing = false;
  let lastKey = '';
  async function refresh() {
    if (refreshing || document.visibilityState === 'hidden') return;
    refreshing = true;
    try {
      local = await invoke('herdr_overview');
      const key = JSON.stringify([local, machines]);
      if (key !== lastKey) {
        lastKey = key;
        alertChanges();
        renderAgents();
        renderWorkspaces();
        renderMachines();
        renderHerdrTabs();
        renderTitle();
        renderComposer();
      }
    } catch { /* Herdr not reachable right now */ }
    refreshing = false;
    // Usage changes slowly; check it every 30 s, and as soon as the agents are known.
    if (Date.now() - usageCheckedAt > 30000) {
      usageCheckedAt = Date.now();
      refreshUsage();
    }
  }
  let usageCheckedAt = 0;

  async function refreshMachines() {
    if (document.visibilityState === 'hidden') return;
    machines = await invoke('herdr_machines').catch(() => machines);
    lastKey = '';
    refresh();
  }

  // ---- Message box ------------------------------------------------------------------------

  function renderComposer() {
    const entry = findSelected() || (local.agents.find((a) => a.focused) && {
      agent: local.agents.find((a) => a.focused), machine: null, machineLabel: 'This PC',
    }) || null;
    const a = entry?.agent;
    els.targetName.textContent = a ? `${nameOf(a)}${entry.machine ? ` · ${entry.machineLabel}` : ''}` : (allAgents().length ? 'Pick an agent' : 'No agent');
    els.targetDot.className = `dot ${a?.agent_status || ''}`;
    els.message.placeholder = a
      ? (a.agent_status === 'blocked' ? `${nameOf(a)} needs you — answer it in the terminal` : `Message ${nameOf(a)}…`)
      : 'Start an agent with New agent, then message it here';
    els.stop.hidden = a?.agent_status !== 'working';
    els.send.disabled = !a || !els.message.value.trim();
    els.composer.dataset.machine = entry?.machine || '';
    els.composer.dataset.target = a ? targetOf(a) : '';
  }

  function autosize() {
    els.message.style.height = 'auto';
    els.message.style.height = `${Math.min(els.message.scrollHeight, 160)}px`;
    els.send.disabled = !els.composer.dataset.target || !els.message.value.trim();
  }
  els.message.addEventListener('input', autosize);
  els.message.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); els.composer.requestSubmit(); }
  });

  els.composer.addEventListener('submit', async (e) => {
    e.preventDefault();
    const text = els.message.value.trim();
    const target = els.composer.dataset.target;
    if (!text || !target) return;
    const machine = els.composer.dataset.machine || null;
    els.send.disabled = true;
    const ok = await run(herdr(['agent', 'prompt', target, text], machine));
    if (ok !== undefined) {
      els.message.value = '';
      autosize();
    }
  });

  els.stop.addEventListener('click', () => {
    const target = els.composer.dataset.target;
    if (target) run(herdr(['agent', 'send-keys', target, 'esc'], els.composer.dataset.machine || null), 'Asked the agent to stop');
  });

  els.target.addEventListener('click', (e) => {
    e.stopPropagation();
    const r = els.target.getBoundingClientRect();
    const items = allAgents().map((entry) => ({
      label: `${nameOf(entry.agent)}${entry.machine ? ` · ${entry.machineLabel}` : ''}`,
      dot: entry.agent.agent_status,
      run: () => { select(entry); els.message.focus(); },
    }));
    if (!items.length) items.push({ label: 'New agent…', run: newAgentDialog });
    openMenu(r.left, r.top, items, { above: true });
  });

  // ---- Actions ------------------------------------------------------------------------------

  function focusAgent(entry) {
    run(herdr(['agent', 'focus', targetOf(entry.agent)], entry.machine)).then(() => term.focus());
  }

  async function newHerdrTab() {
    const ws = local.workspaces.find((w) => w.focused);
    await run(herdr(['tab', 'create', ...(ws ? ['--workspace', ws.workspace_id] : []), '--focus']));
    term.focus();
  }

  /** Closing a tab stops what runs in it, so ask first when an agent is there. */
  function closeTab(t) {
    const close = () => herdr(['tab', 'close', t.tab_id]);
    if (t.agent_status && t.agent_status !== 'none') {
      confirmDialog(`Close ${t.label && t.label !== String(t.number) ? t.label : `Tab ${t.number}`}?`, 'The agent in it stops.', 'Close', close);
    } else {
      run(close());
    }
  }

  /** "+" asks what the new tab is for: a plain terminal, or one of the installed agents. */
  async function newTabMenu(x, y) {
    if (!kinds.length) kinds = await invoke('herdr_agent_kinds').catch(() => []);
    openMenu(x, y, [
      { heading: 'New tab' },
      { label: 'Terminal', run: newHerdrTab },
      ...kinds.filter((k) => k.installed).map((k) => ({ label: k.label, run: () => agentTab(k.kind) })),
      '-',
      { label: 'Other agent…', run: () => newAgentDialog() },
    ]);
  }

  /** A new tab in the current workspace with an agent already started in it. */
  async function agentTab(kind) {
    const ws = local.workspaces.find((w) => w.focused);
    const name = uniqueName(kind);
    try {
      const paneId = findPaneId(await herdr(['tab', 'create', ...(ws ? ['--workspace', ws.workspace_id] : []), '--label', name, '--focus']));
      if (!paneId) throw new Error('Herdr did not say which pane to use');
      toast(`Starting ${kindLabel(kind)}…`);
      const waiting = await invoke('herdr_start_agent', { machine: null, name, kind, pane: paneId });
      selected = { machine: null, target: name, name };
      store.set('selectedAgent', JSON.stringify(selected));
      await refresh();
      if (waiting) {
        announced.add(`|${name}`);
        toast(`${name} is asking a question in the terminal. Answer it there to get started.`, { timeout: 9000 });
      } else {
        toast(`${name} is ready`, { kind: 'good' });
      }
      term.focus();
    } catch (err) {
      toast(String(err?.message || err), { kind: 'error', timeout: 7000 });
    }
  }

  const split = (direction) => run(herdr(['pane', 'split', '--current', '--direction', direction, '--focus'])).then(() => term.focus());
  const zoom = () => run(herdr(['pane', 'zoom'])).then(() => term.focus());
  /** The bytes a terminal sends for a Herdr key such as "ctrl+b" or "prefix+b". */
  function keyBytes(spec, prefix) {
    const one = (k) => {
      const parts = k.toLowerCase().split('+');
      const key = parts.pop();
      const ch = key === 'space' ? ' ' : key === 'minus' ? '-' : key.length === 1 ? key : null;
      if (ch == null) return null;
      let out = ch;
      if (parts.includes('ctrl')) out = ch === ' ' ? '\x00' : /[a-z]/.test(ch) ? String.fromCharCode(ch.charCodeAt(0) - 96) : null;
      if (out != null && parts.includes('alt')) out = `\x1b${out}`;
      return out;
    };
    if (spec.startsWith('prefix+')) {
      const p = one(prefix);
      const rest = one(spec.slice(7));
      return p != null && rest != null ? p + rest : null;
    }
    return one(spec);
  }

  const toggleHerdrSidebar = () => {
    const keys = window.SQ.info.herdr_keys || {};
    const first = (v) => (Array.isArray(v) ? v[0] : v);
    const prefix = first(keys.prefix) || 'ctrl+b';
    const spec = first(keys.toggle_sidebar) || 'prefix+b';
    const bytes = keyBytes(spec, prefix);
    if (!bytes) { toast(`Can't send ${spec} for you; press it in the terminal.`, { kind: 'error' }); return; }
    invoke('pty_write', { data: bytes }).catch(() => {});
    term.focus();
  };
  $('herdr-sidebar').addEventListener('click', toggleHerdrSidebar);

  const toggleHerdrChrome = () => {
    const on = !window.SQ.info.herdr_chrome;
    invoke('set_herdr_chrome', { on })
      .then(() => {
        window.SQ.info.herdr_chrome = on;
        toast(`Herdr's own tab row and rail ${on ? 'come back' : 'hide'} next time you open ShellQuarry.`);
      })
      .catch((err) => toast(String(err), { kind: 'error' }));
  };
  $('split-right').addEventListener('click', () => split('right'));
  $('split-down').addEventListener('click', () => split('down'));
  $('zoom').addEventListener('click', zoom);

  // ---- Menus ----------------------------------------------------------------------------------

  function openMenu(x, y, items, { above = false } = {}) {
    els.menu.replaceChildren();
    for (const item of items) {
      if (item === '-') { els.menu.append(document.createElement('hr')); continue; }
      if (item.heading) {
        const h = document.createElement('div');
        h.className = 'menu-label';
        h.textContent = item.heading;
        els.menu.append(h);
        continue;
      }
      const b = document.createElement('button');
      b.type = 'button';
      b.setAttribute('role', 'menuitem');
      if (item.danger) b.className = 'danger';
      if (item.dot !== undefined) {
        const d = document.createElement('span');
        d.className = `dot ${item.dot || ''}`;
        b.append(d);
      }
      b.append(item.label);
      b.addEventListener('click', () => { closeMenu(); item.run(); });
      els.menu.append(b);
    }
    els.menu.hidden = false;
    setOverlay('menu', true);
    const r = els.menu.getBoundingClientRect();
    const left = Math.min(x, innerWidth - r.width - 8);
    const top = above ? Math.max(8, y - r.height - 6) : Math.min(y, innerHeight - r.height - 8);
    els.menu.style.left = `${left}px`;
    els.menu.style.top = `${top}px`;
    els.menu.querySelector('button')?.focus();
  }

  function closeMenu() {
    if (els.menu.hidden) return;
    els.menu.hidden = true;
    setOverlay('menu', false);
  }
  document.addEventListener('click', (e) => { if (!els.menu.contains(e.target)) closeMenu(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeMenu(); });
  window.addEventListener('blur', closeMenu);

  function agentMenu(entry, x, y) {
    const { agent: a, machine } = entry;
    const target = targetOf(a);
    openMenu(x, y, [
      { heading: nameOf(a) },
      { label: 'Message', run: () => { select(entry); els.message.focus(); } },
      ...(machine ? [] : [{ label: 'Show in terminal', run: () => focusAgent(entry) }]),
      ...(a.agent_status === 'working' ? [{ label: 'Stop', run: () => run(herdr(['agent', 'send-keys', target, 'esc'], machine), 'Asked the agent to stop') }] : []),
      ...(a.workspace_id ? [{ label: 'Continue in another agent…', run: () => switchAgentDialog(entry) }] : []),
      { label: 'Rename…', run: () => promptDialog('Rename agent', 'Name', a.name || '', (name) => herdr(['agent', 'rename', target, name], machine), 'a-z, 0-9, - and _') },
      '-',
      { label: 'Close agent', danger: true, run: () => confirmDialog(`Close ${nameOf(a)}?`, 'This closes its pane and stops the agent.', 'Close', () => herdr(['pane', 'close', a.pane_id], machine)) },
    ]);
  }

  function workspaceMenu(w, x, y) {
    openMenu(x, y, [
      { heading: w.label },
      { label: 'Open', run: () => run(herdr(['workspace', 'focus', w.workspace_id])).then(() => term.focus()) },
      { label: 'New tab', run: () => run(herdr(['tab', 'create', '--workspace', w.workspace_id, '--focus'])).then(() => term.focus()) },
      { label: 'Start an agent here…', run: () => newAgentDialog({ inWorkspace: w }) },
      { label: 'Rename…', run: () => promptDialog('Rename workspace', 'Name', w.label, (label) => herdr(['workspace', 'rename', w.workspace_id, label])) },
      '-',
      { label: 'Close workspace', danger: true, run: () => confirmDialog(`Close ${w.label}?`, 'Its tabs, shells and agents stop.', 'Close', () => herdr(['workspace', 'close', w.workspace_id])) },
    ]);
  }

  function tabMenu(t, x, y) {
    openMenu(x, y, [
      { label: 'Rename…', run: () => promptDialog('Rename tab', 'Name', t.label, (label) => herdr(['tab', 'rename', t.tab_id, label])) },
      { label: 'Close tab', danger: true, run: () => closeTab(t) },
    ]);
  }

  function machineMenu(m, x, y) {
    openMenu(x, y, [
      { heading: m.label },
      ...(m.agents || []).map((a) => ({ label: `Message ${nameOf(a)}`, dot: a.agent_status, run: () => { select({ agent: a, machine: m.id, machineLabel: m.label }); els.message.focus(); } })),
      ...(m.agents?.length ? ['-'] : []),
      { label: 'Start an agent there…', run: () => newAgentDialog({ machine: m.id }) },
      m.enabled
        ? { label: 'Turn off', run: () => run(herdr(['machine', 'disable', m.id]).then(refreshMachines)) }
        : { label: 'Turn on', run: () => run(herdr(['machine', 'enable', m.id]).then(refreshMachines)) },
      '-',
      { label: 'Remove machine', danger: true, run: () => confirmDialog(`Remove ${m.label}?`, 'Its agents keep running there; this PC just stops showing them.', 'Remove', () => herdr(['machine', 'remove', m.id]).then(refreshMachines)) },
    ]);
  }

  // ---- Dialogs ----------------------------------------------------------------------------------

  let dialogSubmit = null;
  function openDialog({ title, body, ok = 'OK', submit, cancel = 'Cancel', extra }) {
    els.dialogTitle.textContent = title;
    els.dialogBody.replaceChildren(body);
    els.dialogOk.textContent = ok;
    els.dialogOk.disabled = false;
    els.dialogCancel.textContent = cancel;
    els.dialogCancel.hidden = cancel === null;
    els.dialogError.hidden = true;
    const actions = els.dialogOk.parentElement;
    actions.querySelector('.tour-dots')?.remove();
    if (extra) actions.prepend(extra);
    dialogSubmit = submit;
    els.scrim.hidden = false;
    setOverlay('dialog', true);
    requestAnimationFrame(() => (els.dialogBody.querySelector('input, select') || els.dialogOk).focus());
  }

  function closeDialog() {
    els.scrim.hidden = true;
    dialogSubmit = null;
    setOverlay('dialog', false);
  }

  async function submitDialog() {
    if (!dialogSubmit) return;
    els.dialogOk.disabled = true;
    els.dialogError.hidden = true;
    try {
      const keepOpen = await dialogSubmit();
      if (keepOpen !== true) closeDialog();
      refresh();
    } catch (err) {
      els.dialogError.textContent = err?.message || String(err);
      els.dialogError.hidden = false;
    }
    els.dialogOk.disabled = false;
  }

  els.dialogOk.addEventListener('click', submitDialog);
  els.dialogCancel.addEventListener('click', closeDialog);
  els.scrim.addEventListener('click', (e) => { if (e.target === els.scrim) closeDialog(); });
  els.scrim.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeDialog();
    if (e.key === 'Enter' && e.target.tagName === 'INPUT') { e.preventDefault(); submitDialog(); }
  });

  function field(label, input, hint) {
    const wrap = document.createElement('label');
    wrap.className = 'field';
    const span = document.createElement('span');
    span.textContent = label;
    wrap.append(span, input);
    if (hint) {
      const h = document.createElement('span');
      h.className = 'hint';
      h.textContent = hint;
      wrap.append(h);
    }
    return wrap;
  }

  function input(value = '', placeholder = '') {
    const i = document.createElement('input');
    i.type = 'text';
    i.value = value;
    i.placeholder = placeholder;
    i.spellcheck = false;
    return i;
  }

  function promptDialog(title, label, value, apply, hint) {
    const i = input(value);
    openDialog({ title, body: field(label, i, hint), ok: 'Save', submit: () => apply(i.value.trim()) });
    requestAnimationFrame(() => i.select());
  }

  function confirmDialog(title, text, ok, apply) {
    const p = document.createElement('p');
    p.textContent = text;
    openDialog({ title, body: p, ok, submit: apply });
  }

  function uniqueName(kind) {
    const base = kind.replace(/[^a-z0-9_-]/g, '') || 'agent';
    const taken = new Set(allAgents().map((x) => x.agent.name).filter(Boolean));
    for (let n = 1; ; n++) if (!taken.has(`${base}-${n}`)) return `${base}-${n}`;
  }

  /** A drop-down of agent kinds, the ones installed on this PC first. */
  function kindPicker(value) {
    const kind = document.createElement('select');
    const group = (label, list) => {
      if (!list.length) return;
      const g = document.createElement('optgroup');
      g.label = label;
      for (const k of list) {
        const o = document.createElement('option');
        o.value = k.kind;
        o.textContent = k.label;
        g.append(o);
      }
      kind.append(g);
    };
    group('Installed on this PC', kinds.filter((k) => k.installed));
    group('Not installed on this PC', kinds.filter((k) => !k.installed));
    kind.value = value;
    return kind;
  }

  // ---- Continue in another agent ---------------------------------------------------
  // Like T3 Code's provider switch: the new agent starts in the same folder and gets the
  // conversation so far (from the old agent's saved transcript), so the work carries on.

  /** Handoffs waiting for their agent to finish a first-run question: key -> message. */
  const pendingHandoffs = new Map();

  async function switchAgentDialog(entry) {
    if (!kinds.length) kinds = await invoke('herdr_agent_kinds').catch(() => []);
    const { agent: a, machine } = entry;
    const installed = kinds.filter((k) => k.installed && k.kind !== a.agent).map((k) => k.kind);
    const preferred = a.agent === 'codex' ? 'claude' : 'codex';
    const kind = kindPicker(installed.includes(preferred) ? preferred : installed[0] || preferred);
    const name = input(uniqueName(kind.value));
    let nameTouched = false;
    name.addEventListener('input', () => { nameTouched = true; });
    kind.addEventListener('change', () => { if (!nameTouched) name.value = uniqueName(kind.value); });
    const request = document.createElement('textarea');
    request.rows = 2;
    request.placeholder = 'Anything to add? (optional)';

    const from = nameOf(a);
    const body = document.createElement('div');
    const p = document.createElement('p');
    p.textContent = `Starts it in a new tab in ${a.cwd || 'the same folder'} with ${from}'s conversation so far, so it carries on where ${from} stopped. ${from} keeps running.`;
    body.append(p, field('Continue in', kind), field('Name', name, 'Lowercase letters, numbers, - and _.'), field('Message', request));

    openDialog({
      title: `Continue ${from}'s work`,
      body,
      ok: 'Continue',
      submit: async () => {
        if (!machine && kinds.length && !kinds.find((k) => k.kind === kind.value)?.installed) {
          throw new Error(`${kindLabel(kind.value)} isn't installed on this PC. Install it first, then try again.`);
        }
        els.dialogOk.textContent = `Starting ${kindLabel(kind.value)}…`;
        let started;
        try {
          started = await invoke('herdr_switch_agent', {
            machine, from: targetOf(a), fromKind: a.agent || '', workspace: a.workspace_id, cwd: a.cwd || '',
            kind: kind.value, name: name.value.trim(), request: request.value.trim() || null,
          });
        } finally {
          els.dialogOk.textContent = 'Continue';
        }
        const agentName = name.value.trim();
        selected = { machine, target: agentName, name: agentName };
        store.set('selectedAgent', JSON.stringify(selected));
        await refresh();
        const what = started.source === 'conversation' ? 'conversation' : 'terminal';
        if (started.waiting) {
          pendingHandoffs.set(`${machine || ''}|${agentName}`, started.prompt);
          announced.add(`${machine || ''}|${agentName}`);
          toast(`${agentName} is asking a question first. Answer it in the terminal and ShellQuarry hands over the ${what} straight after.`, { timeout: 10000 });
          if (!machine) run(herdr(['agent', 'focus', agentName])).then(() => term.focus());
        } else {
          toast(`${agentName} has ${from}'s ${what} and is carrying on`, { kind: 'good' });
        }
      },
    });
  }

  /** Sends a waiting handoff once its agent is past its first-run question. */
  function sendPendingHandoffs() {
    for (const { agent: a, machine } of allAgents()) {
      const key = `${machine || ''}|${a.name}`;
      const prompt = pendingHandoffs.get(key);
      if (!prompt || a.agent_status !== 'idle') continue;
      pendingHandoffs.delete(key);
      run(herdr(['agent', 'prompt', a.name, prompt], machine), `Handed the work to ${a.name}`);
    }
  }

  // ---- Plan usage: 5-hour and weekly limits for Claude Code and Codex -----------------

  const USAGE_NAMES = { claude: 'Claude Code', codex: 'Codex' };
  const offeredNearLimit = new Set();

  function untilText(resetsAt) {
    if (!resetsAt) return '';
    const mins = Math.max(0, Math.round((resetsAt * 1000 - Date.now()) / 60000));
    if (mins < 60) return `resets in ${mins} min`;
    if (mins < 48 * 60) return `resets in ${Math.round(mins / 60)} h`;
    return `resets in ${Math.round(mins / 1440)} days`;
  }

  function meter(label, w) {
    const span = document.createElement('span');
    span.className = 'usage-meter';
    const used = Math.round(w.used);
    span.innerHTML = `<span></span><span class="usage-bar${used >= 90 ? ' high' : used >= 70 ? ' warn' : ''}"><i></i></span><b></b>`;
    span.children[0].textContent = label;
    span.querySelector('i').style.width = `${used}%`;
    span.querySelector('b').textContent = `${used}%`;
    return span;
  }

  async function refreshUsage() {
    const list = await invoke('usage_snapshot').catch(() => []);
    const running = new Set(allAgents().map(({ agent }) => agent.agent));
    // A window that has reset since the numbers were saved is back to 0%; numbers more than a
    // day old aren't shown at all, so the strip never shows stale figures.
    const now = Date.now() / 1000;
    const fresh = (w) => (w && w.resets_at && w.resets_at < now ? { ...w, used: 0, resets_at: null } : w);
    const shown = list
      .filter((u) => running.has(u.kind) && (!u.saved_at || now - u.saved_at < 86400))
      .map((u) => ({ ...u, five_hour: fresh(u.five_hour), weekly: fresh(u.weekly) }))
      .filter((u) => u.five_hour || u.weekly);
    $('usage').replaceChildren(...shown.map((u) => {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'usage-chip';
      const name = document.createElement('span');
      name.textContent = USAGE_NAMES[u.kind] || u.kind;
      chip.append(name);
      if (u.five_hour) chip.append(meter('5h', u.five_hour));
      if (u.weekly) chip.append(meter('Week', u.weekly));
      chip.title = [
        u.five_hour && `5-hour limit: ${Math.round(u.five_hour.used)}% used, ${untilText(u.five_hour.resets_at)}`,
        u.weekly && `Weekly limit: ${Math.round(u.weekly.used)}% used, ${untilText(u.weekly.resets_at)}`,
        'Click to move this agent\'s work to another agent',
      ].filter(Boolean).join('\n');
      chip.addEventListener('click', () => {
        const entry = allAgents().find((e) => e.agent.agent === u.kind && !e.machine && targetOf(e.agent) === selected?.target)
          || allAgents().find((e) => e.agent.agent === u.kind && !e.machine);
        if (entry) switchAgentDialog(entry);
      });
      return chip;
    }));
    // Nearly out: offer to carry on in the other agent before the limit stops the work.
    for (const u of shown) {
      if (!u.five_hour || u.five_hour.used < 90 || offeredNearLimit.has(u.kind)) continue;
      const entry = allAgents().find((e) => e.agent.agent === u.kind && !e.machine && e.agent.agent_status === 'working');
      if (!entry) continue;
      offeredNearLimit.add(u.kind);
      const other = u.kind === 'codex' ? 'Claude Code' : 'Codex';
      toast(`${USAGE_NAMES[u.kind]} has used ${Math.round(u.five_hour.used)}% of its 5-hour limit`, { action: `Continue in ${other}…`, onAction: () => switchAgentDialog(entry), timeout: 30000 });
    }
  }

  /** Agents already offered a switch because they ran out of usage. */
  const offeredSwitch = new Set();

  async function checkUsage(entry) {
    const { agent: a, machine } = entry;
    const key = `${machine || ''}|${a.pane_id}`;
    if (offeredSwitch.has(key)) return;
    if (!(await invoke('herdr_out_of_usage', { machine, target: targetOf(a) }).catch(() => false))) return;
    offeredSwitch.add(key);
    const other = a.agent === 'codex' ? 'Claude Code' : 'Codex';
    toast(`${nameOf(a)} has run out of usage`, { kind: 'error', action: `Continue in ${other}…`, onAction: () => switchAgentDialog(entry), timeout: 30000 });
  }

  async function newAgentDialog({ machine = null, inWorkspace = null } = {}) {
    if (!kinds.length) kinds = await invoke('herdr_agent_kinds').catch(() => []);
    const body = document.createElement('div');

    const kind = kindPicker(store.get('lastKind') || kinds.find((k) => k.installed)?.kind || 'claude');

    const where = document.createElement('select');
    const here = document.createElement('option');
    here.value = '';
    here.textContent = 'This PC';
    where.append(here);
    for (const m of machines.filter((m) => m.enabled)) {
      const o = document.createElement('option');
      o.value = m.id;
      o.textContent = m.label + (m.online ? '' : ' (offline)');
      where.append(o);
    }
    where.value = machine || '';

    const folder = input(store.get('lastFolder') || '', 'C:\\Users\\you\\project');
    const browse = document.createElement('button');
    browse.type = 'button';
    browse.className = 'ghost-btn';
    browse.textContent = 'Browse…';
    browse.addEventListener('click', async () => {
      const picked = await window.__TAURI__.dialog.open({ directory: true, defaultPath: folder.value || undefined }).catch(() => null);
      if (picked) folder.value = picked;
    });
    const folderRow = document.createElement('div');
    folderRow.className = 'field-row';
    folderRow.append(folder, browse);

    const name = input(uniqueName(kind.value));
    let nameTouched = false;
    name.addEventListener('input', () => { nameTouched = true; });
    kind.addEventListener('change', () => { if (!nameTouched) name.value = uniqueName(kind.value); });

    const worktree = document.createElement('input');
    worktree.type = 'checkbox';
    const check = document.createElement('label');
    check.className = 'check';
    check.append(worktree, 'Work on a new git branch (its own worktree)');
    const branch = input('', 'Branch name (optional)');
    const branchField = field('Branch', branch);
    branchField.hidden = true;
    worktree.addEventListener('change', () => { branchField.hidden = !worktree.checked; });

    where.addEventListener('change', () => { browse.disabled = !!where.value; });
    browse.disabled = !!where.value;

    body.append(field('Agent', kind));
    if (machines.length) body.append(field('Where', where));
    if (inWorkspace) {
      const p = document.createElement('p');
      p.textContent = `Starts in a new pane in ${inWorkspace.label}.`;
      body.append(p);
    } else {
      body.append(field('Project folder', folderRow, 'The agent works in this folder.'), check, branchField);
    }
    body.append(field('Name', name, 'Used to message the agent. Lowercase letters, numbers, - and _.'));

    openDialog({
      title: 'New agent',
      body,
      ok: 'Start agent',
      submit: async () => {
        const m = where.value || null;
        // Another machine may have it; here we know, so say so instead of waiting for Herdr to time out.
        if (!m && kinds.length && !kinds.find((k) => k.kind === kind.value)?.installed) {
          throw new Error(`${kindLabel(kind.value)} isn't installed on this PC. Install it first (see its own website), then try again.`);
        }
        store.set('lastKind', kind.value);
        els.dialogOk.textContent = `Starting ${kindLabel(kind.value)}…`;
        let waiting = false;
        try {
          if (inWorkspace) {
            await herdr(['workspace', 'focus', inWorkspace.workspace_id]);
            const paneId = findPaneId(await herdr(['pane', 'split', '--current', '--direction', 'right', '--focus']));
            if (!paneId) throw new Error('Herdr did not say which pane to use');
            waiting = await invoke('herdr_start_agent', { machine: m, name: name.value.trim(), kind: kind.value, pane: paneId });
          } else {
            if (!folder.value.trim()) throw new Error('Pick a project folder.');
            store.set('lastFolder', folder.value.trim());
            const started = await invoke('herdr_new_agent', {
              machine: m, kind: kind.value, name: name.value.trim(), cwd: folder.value.trim(),
              worktree: worktree.checked, branch: branch.value.trim() || null,
            });
            waiting = !!started?.waiting;
          }
        } finally {
          els.dialogOk.textContent = 'Start agent';
        }
        const agentName = name.value.trim();
        selected = { machine: m, target: agentName, name: agentName };
        store.set('selectedAgent', JSON.stringify(selected));
        await refresh();
        if (waiting) {
          announced.add(`${m || ''}|${agentName}`);
          // Usually a first-run question such as "Do you trust this folder?".
          toast(`${agentName} is asking a question in the terminal. Answer it there to get started.`, { timeout: 9000 });
          if (!m) run(herdr(['agent', 'focus', agentName])).then(() => term.focus());
        } else {
          toast(`${agentName} is ready`, { kind: 'good' });
          els.message.focus();
        }
      },
    });
  }

  function newWorkspaceDialog() {
    const folder = input(store.get('lastFolder') || '', 'C:\\Users\\you\\project');
    const browse = document.createElement('button');
    browse.type = 'button';
    browse.className = 'ghost-btn';
    browse.textContent = 'Browse…';
    browse.addEventListener('click', async () => {
      const picked = await window.__TAURI__.dialog.open({ directory: true }).catch(() => null);
      if (picked) { folder.value = picked; if (!label.value) label.value = picked.split(/[\\/]/).filter(Boolean).pop() || ''; }
    });
    const rowEl = document.createElement('div');
    rowEl.className = 'field-row';
    rowEl.append(folder, browse);
    const label = input('', 'Name (optional)');
    const body = document.createElement('div');
    body.append(field('Folder', rowEl), field('Name', label));
    openDialog({
      title: 'New workspace', body, ok: 'Create',
      submit: async () => {
        const args = ['workspace', 'create', '--focus'];
        if (folder.value.trim()) args.push('--cwd', folder.value.trim());
        if (label.value.trim()) args.push('--label', label.value.trim());
        await herdr(args);
        term.focus();
      },
    });
  }

  function addMachineDialog() {
    const target = input('', 'workbox, you@server or ssh://you@server:2222');
    const label = input('', 'Name (optional)');
    const body = document.createElement('div');
    const p = document.createElement('p');
    p.textContent = 'Herdr connects over SSH and can install itself on the other machine. A terminal window opens to ask before it installs anything.';
    body.append(p, field('SSH host', target, 'Check that "ssh <host>" works in a terminal first.'), field('Name', label));
    openDialog({
      title: 'Add a machine', body, ok: 'Connect',
      submit: async () => {
        await invoke('herdr_add_machine', { target: target.value.trim(), label: label.value.trim() || null });
        toast('Finish the setup in the window that opened. The machine appears here when it connects.');
        setTimeout(refreshMachines, 8000);
      },
    });
  }

  // ---- Tour ---------------------------------------------------------------------------------------

  const TOUR = [
    ['Welcome to ShellQuarry', 'ShellQuarry puts buttons on Herdr. Herdr runs your coding agents in the terminal in the middle; everything you see around it controls Herdr for you.'],
    ['Start an agent', 'Click New agent, pick Claude Code, Codex or another agent and a project folder. Each agent gets its own workspace in the sidebar, with its status: working, needs you, or done.'],
    ['Talk to it', 'Type in the message box at the bottom to message the selected agent, like in Claude Code. When an agent needs an answer, you get an alert and can reply in the terminal.'],
    ['Give it a browser', 'Click the globe for a browser your agents can drive. Use "Connect agents to the browser" in the sidebar once, and agents can open pages, click and type while you watch.'],
    ['Other machines', 'Add a machine (Machines +) to see and message agents running on your other computers over SSH. Press Ctrl+K any time for every command.'],
  ];

  function tour(step = 0) {
    const [title, text] = TOUR[step];
    const p = document.createElement('p');
    p.textContent = text;
    const dots = document.createElement('div');
    dots.className = 'tour-dots';
    TOUR.forEach((_, i) => { const d = document.createElement('i'); if (i === step) d.className = 'on'; dots.append(d); });
    const last = step === TOUR.length - 1;
    openDialog({
      title, body: p, ok: last ? 'Get started' : 'Next', cancel: last ? null : 'Skip', extra: dots,
      submit: () => {
        store.set('toured', '1');
        if (!last) { setTimeout(() => tour(step + 1)); return true; }
        return undefined;
      },
    });
    els.dialogCancel.onclick = () => { store.set('toured', '1'); };
  }

  // ---- Command palette (Ctrl+K) -------------------------------------------------------------------

  function commands() {
    const SQ = window.SQ;
    const list = [
      { label: 'New agent…', group: 'Herdr', run: () => newAgentDialog() },
      { label: 'New workspace…', group: 'Herdr', run: newWorkspaceDialog },
      { label: 'New tab', group: 'Herdr', run: newHerdrTab },
      ...kinds.filter((k) => k.installed).map((k) => ({ label: `New tab with ${k.label}`, group: 'Herdr', run: () => agentTab(k.kind) })),
      { label: 'Split right', group: 'Herdr', run: () => split('right') },
      { label: 'Split down', group: 'Herdr', run: () => split('down') },
      { label: 'Zoom pane', group: 'Herdr', run: zoom },
      { label: "Show or hide Herdr's sidebar", group: 'Herdr', run: toggleHerdrSidebar },
      { label: SQ.info.herdr_chrome ? "Hide Herdr's own tab row and rail" : "Show Herdr's own tab row and rail", group: 'Herdr', run: toggleHerdrChrome },
      { label: 'Add a machine…', group: 'Machines', run: addMachineDialog },
      { label: 'Refresh machines', group: 'Machines', run: refreshMachines },
      { label: SQ.browser.open ? 'Close browser' : 'Open browser', group: 'Browser', run: SQ.toggleBrowser },
      { label: 'New browser tab', group: 'Browser', run: () => SQ.newBrowserTab() },
      { label: 'Connect agents to the browser', group: 'Browser', run: () => $('connect').click() },
      { label: SQ.browser.lite ? 'Switch to full mode' : 'Switch to lite mode', group: 'Browser', run: SQ.toggleLite },
      { label: 'Toggle sidebar', group: 'View', run: SQ.toggleSidebar },
      { label: 'Colours…', group: 'View', run: SQ.openColours },
      ...ShellQuarryTheme.choices({}).map((c) => ({ label: `Colours: ${c.label}`, group: 'View', run: () => SQ.setPalette(c.id) })),
      { label: 'Show the tour', group: 'Help', run: () => tour(0) },
    ];
    for (const entry of allAgents()) {
      const label = `${nameOf(entry.agent)}${entry.machine ? ` · ${entry.machineLabel}` : ''}`;
      list.unshift({ label: `Message ${label}`, group: 'Agents', run: () => { select(entry); els.message.focus(); } });
      if (!entry.machine) list.unshift({ label: `Show ${label}`, group: 'Agents', run: () => { select(entry); focusAgent(entry); } });
    }
    for (const w of local.workspaces) {
      list.push({ label: `Open workspace ${w.label}`, group: 'Workspaces', run: () => run(herdr(['workspace', 'focus', w.workspace_id])).then(() => term.focus()) });
    }
    return list;
  }

  let commandItems = [];
  let commandIndex = 0;
  function renderCommands() {
    const q = els.commandInput.value.trim().toLowerCase();
    const words = q.split(/\s+/).filter(Boolean);
    commandItems = commands().filter((c) => words.every((w) => `${c.label} ${c.group}`.toLowerCase().includes(w))).slice(0, 60);
    commandIndex = Math.min(commandIndex, Math.max(commandItems.length - 1, 0));
    els.commandList.replaceChildren(...commandItems.map((c, i) => {
      const li = document.createElement('li');
      li.setAttribute('role', 'option');
      if (i === commandIndex) li.className = 'active';
      li.innerHTML = '<span class="label"></span><span class="group"></span>';
      li.querySelector('.label').textContent = c.label;
      li.querySelector('.group').textContent = c.group;
      li.addEventListener('click', () => runCommand(i));
      li.addEventListener('mousemove', () => { if (commandIndex !== i) { commandIndex = i; renderCommands(); } });
      return li;
    }));
    if (!commandItems.length) {
      const li = document.createElement('li');
      li.className = 'none';
      li.textContent = 'No matching commands';
      els.commandList.append(li);
    }
  }

  function openCommands() {
    els.commands.hidden = false;
    setOverlay('commands', true);
    els.commandInput.value = '';
    commandIndex = 0;
    renderCommands();
    els.commandInput.focus();
  }
  function closeCommands() {
    els.commands.hidden = true;
    setOverlay('commands', false);
  }
  function runCommand(i) {
    const c = commandItems[i];
    closeCommands();
    c?.run();
  }

  els.commandInput.addEventListener('input', () => { commandIndex = 0; renderCommands(); });
  els.commandInput.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); commandIndex = Math.min(commandIndex + 1, commandItems.length - 1); renderCommands(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); commandIndex = Math.max(commandIndex - 1, 0); renderCommands(); }
    else if (e.key === 'Enter') { e.preventDefault(); runCommand(commandIndex); }
    else if (e.key === 'Escape') { e.preventDefault(); closeCommands(); term.focus(); }
  });
  els.commands.addEventListener('click', (e) => { if (e.target === els.commands) closeCommands(); });
  $('open-palette').addEventListener('click', openCommands);

  // ---- Wiring ---------------------------------------------------------------------------------------

  $('new-agent').addEventListener('click', () => newAgentDialog());
  $('new-workspace').addEventListener('click', newWorkspaceDialog);
  $('add-machine').addEventListener('click', addMachineDialog);
  $('connect').addEventListener('click', async () => {
    try {
      await invoke('herdr_open_setup');
      term.focus();
    } catch (err) {
      const busy = /already open|ui_busy/i.test(String(err));
      toast(busy
        ? 'The connect-agents popup is already open in Herdr. Finish or close it there first.'
        : `Couldn't open the setup in Herdr: ${err}`, { kind: 'error', timeout: 8000 });
    }
  });

  Object.assign(window.SQ, {
    openCommands,
    start() {
      invoke('herdr_agent_kinds').then((k) => { kinds = k; }).catch(() => {});
      refresh();
      refreshMachines();
      setInterval(refresh, 2500);
      setInterval(refreshMachines, 20000);
      document.addEventListener('visibilitychange', refresh);
      if (!store.get('toured')) setTimeout(() => tour(0), 600);
    },
  });
})();

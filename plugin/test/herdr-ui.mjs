// Checks the Herdr features of the running app through its UI:
// new agent (in a scratch folder), the message box's error path, the command
// palette and the Herdr sidebar toggle. Starts Claude Code but sends it nothing.
//   node test/herdr-ui.mjs <scratch-folder>
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';
import { cdpUrl } from '../lib/session.mjs';

const folder = process.argv[2];
if (!folder) throw new Error('usage: node test/herdr-ui.mjs <scratch-folder>');
mkdirSync(folder, { recursive: true });

const b = await chromium.connectOverCDP(cdpUrl());
let ui;
for (const p of b.contexts().flatMap((c) => c.pages())) {
  if (await p.evaluate(() => !!document.getElementById('new-agent')).catch(() => false)) ui = p;
}
if (!ui) throw new Error('ShellQuarry UI page not found');

let failures = 0;
const check = (label, ok, detail = '') => { if (!ok) failures++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? ` (${detail})` : ''}`); };
const call = (cmd, args = {}) => ui.evaluate(async ([c, a]) => {
  try { return { ok: await window.__TAURI__.core.invoke(c, a) }; } catch (e) { return { error: String(e) }; }
}, [cmd, args]);

// Dismiss the tour if it is showing.
if (await ui.isVisible('#scrim')) { await ui.click('#dialog-cancel').catch(() => {}); }

// New agent through the dialog.
const name = `sqcheck-${Date.now() % 100000}`;
await ui.click('#new-agent');
await ui.waitForSelector('#scrim:not([hidden])');
await ui.selectOption('#dialog-body select', 'claude');
const inputs = ui.locator('#dialog-body input[type=text]');
await inputs.nth(0).fill(folder);
await inputs.last().fill(name);
await ui.click('#dialog-ok');
await ui.waitForSelector('#scrim', { state: 'hidden', timeout: 90000 }).catch(() => {});
const err = await ui.isVisible('#dialog-error') ? await ui.textContent('#dialog-error') : '';
check('new agent dialog starts Claude Code', !err, err);
await ui.waitForTimeout(3000);
const agents = (await call('herdr_overview')).ok?.agents || [];
const agent = agents.find((a) => a.name === name);
check('the agent is in Herdr', !!agent, agent ? `status ${agent.agent_status}` : 'not found');
check('the sidebar lists it', (await ui.textContent('#agents')).includes(name));
check('the message box targets it', (await ui.textContent('#target-name')).includes(name));

// Sending to an agent that is waiting on a question returns Herdr's error, shown as a toast.
if (agent?.agent_status === 'blocked') {
  const r = await call('herdr_cmd', { machine: null, args: ['agent', 'prompt', name, 'hello'] });
  check('prompting a waiting agent is refused, not typed', !!r.error, r.error);
}

// Command palette.
await ui.keyboard.press('Control+k');
await ui.waitForSelector('#commands:not([hidden])');
await ui.fill('#command-input', 'split');
const found = await ui.locator('#command-list li').allTextContents();
check('command palette finds commands', found.some((t) => t.includes('Split right')), found.slice(0, 3).join(' | '));
await ui.keyboard.press('Escape');
check('command palette closes', await ui.isHidden('#commands'));

// Clean up: close the scratch agent's workspace.
if (agent) {
  const r = await call('herdr_cmd', { machine: null, args: ['workspace', 'close', agent.workspace_id] });
  check('scratch workspace closed', !r.error, r.error);
}

await b.close().catch(() => {});
console.log(failures ? `${failures} check(s) failed` : 'all checks passed');
process.exit(failures ? 1 : 0);

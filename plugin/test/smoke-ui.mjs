// UI smoke test against the running app: the globe toggle and lite mode.
// Run from the plugin folder with ShellQuarry open: node test/smoke-ui.mjs
import { chromium } from 'playwright-core';
import { cdpUrl, control } from '../lib/session.mjs';

const b = await chromium.connectOverCDP(cdpUrl());
let ui;
for (const p of b.contexts().flatMap((c) => c.pages())) {
  if (await p.evaluate(() => !!document.getElementById('globe')).catch(() => false)) ui = p;
}
if (!ui) throw new Error('ShellQuarry UI page not found');

let failures = 0;
const check = (label, ok, detail = '') => { if (!ok) failures++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? ` (${detail})` : ''}`); };
const status = async () => (await control('GET', '/status')).browser;
const alive = (s) => s.tabs.filter((t) => t.alive).length;

const before = await status();
await ui.click('#globe'); await ui.waitForTimeout(400);
check('globe closes the panel', !(await status()).open && await ui.evaluate(() => document.getElementById('browser-pane').hidden));
await ui.click('#globe'); await ui.waitForTimeout(600);
check('globe reopens the panel', (await status()).open);

const wasLite = before.lite;
if (wasLite) { await ui.click('#mode'); await ui.waitForTimeout(800); }
const full = await status();
check('full mode keeps every tab loaded', alive(full) === full.tabs.length, `${alive(full)}/${full.tabs.length} loaded`);

await ui.click('#mode'); await ui.waitForTimeout(800);
const lite = await status();
check('lite mode keeps only the open tab loaded', lite.lite && alive(lite) === 1, `${alive(lite)}/${lite.tabs.length} loaded`);
check('mode button says lite', (await ui.textContent('#mode')).trim().toLowerCase() === 'lite');

await ui.click('#globe'); await ui.waitForTimeout(600);
check('lite mode unloads everything when the panel closes', alive(await status()) === 0);
await ui.click('#globe'); await ui.waitForTimeout(800);
check('reopening reloads the open tab', alive(await status()) === 1);

if (!wasLite) { await ui.click('#mode'); await ui.waitForTimeout(800); }
check('mode restored', (await status()).lite === wasLite);

await b.close().catch(() => {});
console.log(failures ? `${failures} check(s) failed` : 'all checks passed');
process.exit(failures ? 1 : 0);

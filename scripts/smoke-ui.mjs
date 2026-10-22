// UI smoke test against the running app: globe toggle and a terminal round trip.
import { chromium } from 'playwright-core';
const b = await chromium.connectOverCDP('http://127.0.0.1:9333');
const pages = b.contexts().flatMap((c) => c.pages());
let ui;
for (const p of pages) if (await p.evaluate(() => !!window.shellquarry).catch(() => false)) ui = p;
const state = () => ui.evaluate(() => ({ pressed: document.getElementById('globe').getAttribute('aria-pressed'), paneHidden: document.getElementById('browser-pane').hidden }));
console.log('start', await state());
await ui.click('#globe'); await ui.waitForTimeout(300); console.log('after globe click', await state());
await ui.click('#globe'); await ui.waitForTimeout(300); console.log('after second click', await state());
await ui.click('#term');
await ui.keyboard.type('echo "hello from ShellQuarry"; $PSVersionTable.PSVersion.Major\r', { delay: 5 });
await ui.waitForTimeout(1500);
console.log(await ui.evaluate(() => document.querySelector('.xterm-rows').innerText.split('\n').filter(Boolean).slice(-4).join('\n')));
await b.close();

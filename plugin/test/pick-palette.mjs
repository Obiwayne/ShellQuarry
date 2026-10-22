// Picks a palette through the UI's colour picker, e.g.
//   node test/pick-palette.mjs "Claude dark"
import { chromium } from 'playwright-core';
import { cdpUrl } from '../lib/session.mjs';

const label = process.argv[2] || 'Claude dark';
const b = await chromium.connectOverCDP(cdpUrl());
let ui;
for (const p of b.contexts().flatMap((c) => c.pages())) {
  if (await p.evaluate(() => !!document.getElementById('palette-btn')).catch(() => false)) ui = p;
}
if (!ui) throw new Error('ShellQuarry UI page not found');
await ui.click('#palette-btn');
await ui.locator('.palette-item', { hasText: label }).first().click();
await ui.keyboard.press('Escape');
await ui.waitForTimeout(500);
console.log('palette:', await ui.textContent('#palette-name'));
process.exit(0);

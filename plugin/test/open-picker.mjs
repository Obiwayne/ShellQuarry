// Opens (or with "close", closes) the colour picker, for screenshots.
import { chromium } from 'playwright-core';
import { cdpUrl } from '../lib/session.mjs';
const b = await chromium.connectOverCDP(cdpUrl());
for (const p of b.contexts().flatMap((c) => c.pages())) {
  if (await p.evaluate(() => !!document.getElementById('palette-btn')).catch(() => false)) {
    if (process.argv[2] === 'close') await p.keyboard.press('Escape');
    else await p.click('#palette-btn');
  }
}
process.exit(0);

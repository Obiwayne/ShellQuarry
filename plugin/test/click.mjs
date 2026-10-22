// Clicks an element in the app's UI by CSS selector: node test/click.mjs '#herdr-sidebar'
import { chromium } from 'playwright-core';
import { cdpUrl } from '../lib/session.mjs';
const b = await chromium.connectOverCDP(cdpUrl());
for (const p of b.contexts().flatMap((c) => c.pages())) {
  if (await p.evaluate(() => !!document.getElementById('new-agent')).catch(() => false)) await p.click(process.argv[2]);
}
process.exit(0);

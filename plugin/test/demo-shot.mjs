// Sets up a screenshot: opens a page in the browser panel and parks the agent
// cursor on a link, with "Agent is …" showing in the title bar.
//   node test/demo-shot.mjs <url> <link text> [activity label]
import { chromium } from 'playwright-core';
import { cdpUrl, control } from '../lib/session.mjs';

const [url, linkText, label = 'browsing'] = process.argv.slice(2);
const state = await control('POST', '/open', { url });
await new Promise((r) => setTimeout(r, 2500));
const b = await chromium.connectOverCDP(cdpUrl());
let page;
for (const p of b.contexts().flatMap((c) => c.pages())) {
  if ((await p.evaluate(() => window.__shellquarryTab ?? null).catch(() => null)) === state.active) page = p;
}
if (!page) throw new Error('tab not found');
await page.waitForLoadState('domcontentloaded');
const el = page.getByText(linkText, { exact: false }).first();
await el.scrollIntoViewIfNeeded().catch(() => {});
const box = await el.boundingBox();
if (box) {
  await page.evaluate(({ x, y }) => {
    const c = document.createElement('div');
    c.id = '__shellquarry_cursor';
    c.innerHTML = '<svg width="22" height="22" viewBox="0 0 24 24"><path d="M4 2l15 11l-6.5 1.2l3.6 6.8l-2.9 1.5l-3.6-6.8L4 20z" fill="#89b4fa" stroke="#1e1e2e" stroke-width="1.5" stroke-linejoin="round"/></svg>';
    Object.assign(c.style, { position: 'fixed', left: `${x}px`, top: `${y}px`, zIndex: 2147483647, pointerEvents: 'none', filter: 'drop-shadow(0 2px 3px rgba(0,0,0,.35))' });
    document.documentElement.appendChild(c);
  }, { x: box.x + box.width / 2, y: box.y + box.height / 2 });
}
await control('POST', '/activity', { label });
console.log(box ? 'cursor placed' : 'link not found');
process.exit(0);

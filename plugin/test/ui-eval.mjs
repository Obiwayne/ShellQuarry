// Runs a JavaScript expression in the app's UI page, for tests and screenshots:
//   node test/ui-eval.mjs "localStorage.getItem('palette')"
import { chromium } from 'playwright-core';
import { cdpUrl } from '../lib/session.mjs';
const b = await chromium.connectOverCDP(cdpUrl());
for (const p of b.contexts().flatMap((c) => c.pages())) {
  if (await p.evaluate(() => !!document.getElementById('new-agent')).catch(() => false)) {
    console.log(JSON.stringify(await p.evaluate(process.argv[2])));
  }
}
process.exit(0);

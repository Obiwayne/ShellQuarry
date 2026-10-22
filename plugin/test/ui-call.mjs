// Runs a Tauri command from the app's UI page, for testing:
//   node test/ui-call.mjs <command> '<json args>'
import { chromium } from 'playwright-core';
import { cdpUrl } from '../lib/session.mjs';
const [cmd, json = '{}'] = process.argv.slice(2);
const b = await chromium.connectOverCDP(cdpUrl());
for (const p of b.contexts().flatMap((c) => c.pages())) {
  if (await p.evaluate(() => !!document.getElementById('new-agent')).catch(() => false)) {
    const out = await p.evaluate(async ([c, a]) => {
      try { return { ok: await window.__TAURI__.core.invoke(c, JSON.parse(a)) }; } catch (e) { return { error: String(e) }; }
    }, [cmd, json]);
    console.log(JSON.stringify(out, null, 1).slice(0, 3000));
  }
}
process.exit(0);

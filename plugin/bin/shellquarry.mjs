#!/usr/bin/env node
// Herdr plugin actions.
//   open        open the browser panel (starts ShellQuarry as a browser window if it isn't running)
//   open-link   open the Ctrl+clicked link (HERDR_PLUGIN_CLICKED_URL) in the panel
//   close       close the panel

import { control, ensureRunning } from '../lib/session.mjs';

const [action] = process.argv.slice(2);

function clickedUrl() {
  if (process.env.HERDR_PLUGIN_CLICKED_URL) return process.env.HERDR_PLUGIN_CLICKED_URL;
  try { return JSON.parse(process.env.HERDR_PLUGIN_CONTEXT_JSON || '{}').clicked_url || null; } catch { return null; }
}

try {
  switch (action) {
    case 'open': {
      // Started from Herdr, ShellQuarry opens as just the browser beside your terminal.
      await ensureRunning(['--browser-only']);
      await control('POST', '/open', {});
      console.log('ShellQuarry browser is open.');
      break;
    }
    case 'open-link': {
      const url = clickedUrl();
      if (!url) throw new Error('No link was clicked.');
      const started = await ensureRunning(['--browser-only', '--open', url]);
      if (!started) await control('POST', '/open', { url, new_tab: true });
      console.log(`Opened ${url} in the ShellQuarry browser.`);
      break;
    }
    case 'close': {
      await control('POST', '/close', {});
      console.log('ShellQuarry browser is closed.');
      break;
    }
    default:
      console.error('usage: shellquarry.mjs open | open-link | close');
      process.exit(2);
  }
} catch (err) {
  console.error(err.message);
  process.exit(1);
}

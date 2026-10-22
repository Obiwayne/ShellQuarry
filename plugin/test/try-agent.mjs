// Acts as an agent: starts the MCP server over stdio and drives the browser
// through a short scripted session (tabs, navigation, typing, screenshots).
// Run from the plugin folder with ShellQuarry open:
//   node test/try-agent.mjs [out-dir]
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const out = process.argv[2] || 'try-agent-output';
mkdirSync(out, { recursive: true });
const server = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'mcp', 'server.mjs');

const client = new Client({ name: 'try-agent', version: '0.2.0' });
await client.connect(new StdioClientTransport({ command: process.execPath, args: [server] }));

const { tools } = await client.listTools();
console.log('tools:', tools.map((t) => t.name).join(', '));

let failures = 0;
async function call(name, args = {}) {
  const res = await client.callTool({ name, arguments: args });
  const first = res.content?.[0];
  if (res.isError) failures++;
  if (first?.type === 'image') {
    const file = join(out, `${name}-${Date.now()}.png`);
    writeFileSync(file, Buffer.from(first.data, 'base64'));
    console.log(`\n## ${name} -> ${file}`);
  } else {
    console.log(`\n## ${name}${res.isError ? ' (ERROR)' : ''}\n${(first?.text ?? '').slice(0, 500)}`);
  }
  return res;
}

await call('browser_open_panel');
await call('browser_navigate', { url: 'https://html.duckduckgo.com/html/', new_tab: true });
const snap = await call('browser_snapshot');
const field = /\[(e\d+)\] input\[text\]/.exec(snap.content[0].text)?.[1];
if (field) await call('browser_type', { ref: field, text: 'herdr terminal agents', submit: true });
else failures++;
await call('browser_screenshot');
await call('browser_new_tab', { url: 'https://en.wikipedia.org/wiki/Terminal_emulator' });
await call('browser_scroll', { direction: 'down' });
const tabs = await call('browser_tabs');
const first = /tab (\d+) \(#1\)/.exec(tabs.content[0].text)?.[1];
if (first) await call('browser_select_tab', { tab: Number(first) });
await call('browser_screenshot');

await client.close();
console.log(`\n${failures ? `${failures} step(s) failed` : 'all steps passed'}`);
process.exit(failures ? 1 : 0);

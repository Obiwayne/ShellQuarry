// Acts as an agent: starts the MCP server over stdio and drives the browser
// panel through a short scripted session. Run with the app open:
//   node scripts/try-agent.mjs [out-dir]
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const out = process.argv[2] || 'try-agent-output';
mkdirSync(out, { recursive: true });

const client = new Client({ name: 'try-agent', version: '0.1.0' });
await client.connect(new StdioClientTransport({ command: process.execPath, args: ['mcp/server.mjs'] }));

const { tools } = await client.listTools();
console.log('tools:', tools.map((t) => t.name).join(', '));

async function call(name, args = {}) {
  const res = await client.callTool({ name, arguments: args });
  const first = res.content?.[0];
  if (first?.type === 'image') {
    const file = join(out, `${name}-${Date.now()}.png`);
    writeFileSync(file, Buffer.from(first.data, 'base64'));
    console.log(`\n## ${name} -> ${file}`);
  } else {
    console.log(`\n## ${name}${res.isError ? ' (error)' : ''}\n${(first?.text ?? '').slice(0, 900)}`);
  }
  return res;
}

const snap = await call('browser_navigate', { url: 'https://en.wikipedia.org/wiki/Terminal_emulator' });
const search = /\[(e\d+)\] (?:input\[search\]|input\[text\]|searchbox)[^\n]*search/i.exec(snap.content[0].text);
if (search) await call('browser_type', { ref: search[1], text: 'Tauri (software framework)', submit: true });
await call('browser_screenshot');
await call('browser_scroll', { direction: 'down' });
await call('browser_screenshot');

await client.close();

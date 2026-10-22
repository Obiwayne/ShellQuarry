// Types into a search box without submitting, so the agent cursor stays on screen.
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
const client = new Client({ name: 'try-cursor', version: '0.1.0' });
await client.connect(new StdioClientTransport({ command: process.execPath, args: ['mcp/server.mjs'] }));
const nav = await client.callTool({ name: 'browser_navigate', arguments: { url: 'https://html.duckduckgo.com/html/' } });
const text = nav.content[0].text;
const ref = /\[(e\d+)\] input\[text\]/.exec(text)?.[1];
console.log(text.slice(0, 500), '\nsearch ref:', ref);
if (ref) console.log((await client.callTool({ name: 'browser_type', arguments: { ref, text: 'tauri xterm.js portable-pty' } })).content[0].text.slice(0, 120));
await client.close();

#!/usr/bin/env node
// The "connect agents" popup inside Herdr: shows whether ShellQuarry is
// running and offers to add the ShellQuarry MCP server to Claude Code and
// Codex. Nothing changes without a yes.

import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { fileURLToPath } from 'node:url';
import { findExe, isRunning } from '../lib/session.mjs';

const server = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'mcp', 'server.mjs');
const c = (code) => (s) => `\x1b[${code}m${s}\x1b[0m`;
const [bold, dim, green, yellow, blue] = [c(1), c(90), c(32), c(33), c(34)];

function has(cmd) {
  const r = spawnSync(process.platform === 'win32' ? 'where' : 'which', [cmd], { encoding: 'utf8' });
  return r.status === 0;
}

function run(cmd, args) {
  const r = spawnSync(cmd, args, { encoding: 'utf8', shell: process.platform === 'win32' });
  return { ok: r.status === 0, out: `${r.stdout || ''}${r.stderr || ''}`.trim() };
}

function listed(cmd) {
  const r = run(cmd, ['mcp', 'list']);
  return r.ok && /shellquarry/i.test(r.out);
}

const rl = createInterface({ input: process.stdin, output: process.stdout });
const ask = async (q) => /^y(es)?$/i.test((await rl.question(`${q} ${dim('[y/N]')} `)).trim());

console.log(`\n ${blue('❯')} ${bold('shellquarry')} ${dim('· connect agents to the browser')}\n`);
const running = await isRunning();
const exe = findExe();
console.log(`  app        ${running ? green('running') : exe ? yellow('installed, not running') : yellow('not found')}`);
console.log(`  mcp server ${dim(server)}\n`);

const agents = [
  { name: 'Claude Code', cmd: 'claude', add: ['mcp', 'add', '--scope', 'user', 'shellquarry', '--', 'node', server] },
  { name: 'Codex', cmd: 'codex', add: ['mcp', 'add', 'shellquarry', '--', 'node', server] },
];

for (const agent of agents) {
  if (!has(agent.cmd)) {
    console.log(`  ${agent.name.padEnd(11)} ${dim('not installed')}`);
    continue;
  }
  if (listed(agent.cmd)) {
    console.log(`  ${agent.name.padEnd(11)} ${green('connected')}`);
    continue;
  }
  if (await ask(`  ${agent.name.padEnd(11)} not connected. Add the ShellQuarry browser to ${agent.name}?`)) {
    const r = run(agent.cmd, agent.add);
    console.log(r.ok ? `  ${' '.repeat(11)} ${green('connected')}` : `  ${' '.repeat(11)} ${yellow('failed:')} ${r.out}`);
  }
}

console.log(`\n  ${bold('other agents')} ${dim('add an MCP server that runs:')}`);
console.log(`  node "${server}"\n`);
console.log(`  ${bold('keybinding')} ${dim('add to %APPDATA%\\herdr\\config.toml, then reload:')}`);
console.log(dim('  [[keys.command]]\n  key = "prefix+o"\n  type = "plugin_action"\n  command = "shellquarry.browser.open"\n  description = "open agent browser"\n'));
await rl.question(dim('  press enter to close '));
rl.close();

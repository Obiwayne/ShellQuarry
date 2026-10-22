// Finds the running ShellQuarry app (session.json) and talks to its control API.
// Shared by the Herdr plugin actions and the MCP server.

import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const IDENTIFIER = 'dev.repoquarry.shellquarry';
const here = dirname(fileURLToPath(import.meta.url));

/** The app's local data folder (Tauri's app_local_data_dir). */
export function dataDir() {
  if (process.platform === 'win32') return join(process.env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local'), IDENTIFIER);
  if (process.platform === 'darwin') return join(homedir(), 'Library', 'Application Support', IDENTIFIER);
  return join(process.env.XDG_DATA_HOME || join(homedir(), '.local', 'share'), IDENTIFIER);
}

function readJson(path) {
  try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return null; }
}

export class ShellQuarryError extends Error {}

/** Calls the control API. Throws ShellQuarryError when the app is not running. */
export async function control(method, path, body) {
  const s = readJson(join(dataDir(), 'session.json'));
  if (!s?.control_url || !s?.token) throw new ShellQuarryError('ShellQuarry is not running.');
  let res;
  try {
    res = await fetch(`${s.control_url}${path}`, {
      method,
      headers: { Authorization: `Bearer ${s.token}`, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(15000),
    });
  } catch {
    throw new ShellQuarryError('ShellQuarry is not running.');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `ShellQuarry answered ${res.status}`);
  return data;
}

/** The DevTools address of the running app, for driving its tabs. */
export function cdpUrl() {
  const s = readJson(join(dataDir(), 'session.json'));
  if (!s?.cdp_url) throw new ShellQuarryError('ShellQuarry is not running.');
  return s.cdp_url;
}

export async function isRunning() {
  try { await control('GET', '/status'); return true; } catch { return false; }
}

/** Where the app is: SHELLQUARRY_EXE, the last run, the default install folder, or a local build. */
export function findExe() {
  const candidates = [
    process.env.SHELLQUARRY_EXE,
    readJson(join(dataDir(), 'install.json'))?.exe,
    process.platform === 'win32' && process.env.LOCALAPPDATA && join(process.env.LOCALAPPDATA, 'ShellQuarry', 'shellquarry.exe'),
    resolve(here, '..', '..', 'src-tauri', 'target', 'release', process.platform === 'win32' ? 'shellquarry.exe' : 'shellquarry'),
    resolve(here, '..', '..', 'src-tauri', 'target', 'debug', process.platform === 'win32' ? 'shellquarry.exe' : 'shellquarry'),
  ];
  return candidates.find((p) => p && existsSync(p)) || null;
}

/** Starts the app (if needed) and waits until its control API answers. */
export async function ensureRunning(args = []) {
  if (await isRunning()) return false;
  const exe = findExe();
  if (!exe) {
    throw new ShellQuarryError('ShellQuarry is not installed. Get it from https://github.com/Obiwayne/ShellQuarry/releases');
  }
  // Clear Herdr's pane variables so the app starts clean.
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('HERDR_')));
  spawn(exe, args, { detached: true, stdio: 'ignore', env, windowsHide: false }).unref();
  for (let i = 0; i < 75; i++) {
    await new Promise((r) => setTimeout(r, 200));
    if (await isRunning()) return true;
  }
  throw new ShellQuarryError('ShellQuarry did not start within 15 seconds.');
}

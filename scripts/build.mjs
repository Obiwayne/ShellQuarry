// Builds the release app and installer with this machine's folder paths
// (your user folder, Cargo's registry, this checkout) stripped from the
// binary, so a published installer doesn't reveal who built it or where.
//   node scripts/build.mjs [extra tauri build args]
import { spawnSync } from 'node:child_process';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(import.meta.url), '..', '..');
const cargoHome = process.env.CARGO_HOME || join(homedir(), '.cargo');
const rustupHome = process.env.RUSTUP_HOME || join(homedir(), '.rustup');
const remap = [
  [cargoHome, '/cargo'],
  [rustupHome, '/rustup'],
  [root, '/shellquarry'],
  [homedir(), '/home'],
].map(([from, to]) => `--remap-path-prefix=${from}=${to}`);

const env = { ...process.env, RUSTFLAGS: [process.env.RUSTFLAGS, ...remap].filter(Boolean).join(' ') };
// One command string through the shell, so Windows finds npx.cmd.
const run = (line) => {
  const r = spawnSync(line, { cwd: root, env, stdio: 'inherit', shell: true });
  if (r.status !== 0) process.exit(r.status ?? 1);
};

run('node scripts/vendor.mjs');
run(['npx tauri build', ...process.argv.slice(2)].join(' '));

// Copies xterm.js into ui/vendor so the app loads it from disk (no CDN, works offline).
import { cpSync, mkdirSync } from 'node:fs';

const files = {
  'node_modules/@xterm/xterm/lib/xterm.js': 'ui/vendor/xterm.js',
  'node_modules/@xterm/xterm/css/xterm.css': 'ui/vendor/xterm.css',
  'node_modules/@xterm/addon-fit/lib/addon-fit.js': 'ui/vendor/addon-fit.js',
  'node_modules/@xterm/addon-webgl/lib/addon-webgl.js': 'ui/vendor/addon-webgl.js',
};
mkdirSync('ui/vendor', { recursive: true });
for (const [from, to] of Object.entries(files)) cpSync(from, to);
console.log('vendored xterm.js into ui/vendor');

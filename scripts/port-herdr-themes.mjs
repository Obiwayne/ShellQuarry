// Regenerates ui/themes.js from Herdr's source so ShellQuarry can match the user's Herdr theme.
//   node scripts/port-herdr-themes.mjs <path-to-herdr>/src/app/state.rs
import { readFileSync, writeFileSync } from 'node:fs';

const src = readFileSync(process.argv[2], 'utf8').replace(/\r\n/g, '\n');
const names = {
  catppuccin: 'catppuccin', catppuccin_latte: 'catppuccin-latte', terminal: 'terminal',
  tokyo_night: 'tokyo-night', tokyo_night_day: 'tokyo-night-day', dracula: 'dracula', nord: 'nord',
  gruvbox: 'gruvbox', gruvbox_light: 'gruvbox-light', one_dark: 'one-dark', one_light: 'one-light',
  solarized: 'solarized', solarized_light: 'solarized-light', kanagawa: 'kanagawa',
  kanagawa_lotus: 'kanagawa-lotus', rose_pine: 'rose-pine', rose_pine_dawn: 'rose-pine-dawn', vesper: 'vesper',
};
const hex = (n) => Number(n).toString(16).padStart(2, '0');
const themes = {};
for (const [fn, name] of Object.entries(names)) {
  const body = new RegExp(`pub fn ${fn}\\(\\) -> Self \\{([\\s\\S]*?)\\n {4}\\}`).exec(src)?.[1];
  if (!body) throw new Error(`theme ${fn} not found`);
  const theme = {};
  for (const m of body.matchAll(/(\w+): Color::(?:Rgb\((\d+), (\d+), (\d+)\)|(\w+))/g)) {
    theme[m[1]] = m[2] ? `#${hex(m[2])}${hex(m[3])}${hex(m[4])}` : m[5].toLowerCase();
  }
  themes[name] = theme;
}
writeFileSync('ui/themes.js',
  '// Theme palettes ported from Herdr (src/app/state.rs, Apache-2.0, https://github.com/herdrdev/herdr)\n' +
  '// so ShellQuarry matches the Herdr theme you use. Regenerate with scripts/port-herdr-themes.mjs.\n' +
  '// "reset" means "use the terminal\'s own colour".\n' +
  `window.HERDR_THEMES = ${JSON.stringify(themes, null, 1)};\n`);
console.log(`${Object.keys(themes).length} themes`);

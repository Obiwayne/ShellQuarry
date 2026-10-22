// Renders the launch cover (1600x900), the social card (1600x1000) and the
// RepoQuarry builds card (800x320) from docs/screenshots/hero.png, and makes
// WebP copies of the screenshots for the blog post.
//   node scripts/cover.mjs [out-dir]
import { spawnSync } from 'node:child_process';
import { mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright-core';

const out = resolve(process.argv[2] || 'docs/blog');
mkdirSync(out, { recursive: true });
const f = (p) => pathToFileURL(resolve(p)).href;

const css = (w, h) => `
html,body{margin:0}
body{width:${w}px;height:${h}px;overflow:hidden;position:relative;color:#faf9f5;
font-family:"Segoe UI Variable Display","Segoe UI",system-ui,sans-serif;
background:radial-gradient(800px 600px at 80% 15%,rgba(217,119,87,.30),transparent 60%),
radial-gradient(700px 500px at 100% 100%,rgba(137,180,250,.18),transparent 60%),
radial-gradient(600px 500px at 0% 0%,rgba(203,166,247,.12),transparent 60%),#141413}
.brand{display:flex;align-items:center;gap:14px;font-weight:650;font-size:30px}
.brand img{width:52px;height:52px}
.kick{color:#d97757;font-weight:600;letter-spacing:.14em;font-size:20px}
h1{font-weight:760;line-height:1;letter-spacing:-.025em;margin:0}
.lede{font-weight:600;line-height:1.2}
ul{list-style:none;padding:0;margin:0;color:#c2c0b6;line-height:1.75}
ul li::before{content:"";display:inline-block;width:9px;height:9px;border-radius:50%;background:#d97757;margin:0 14px 3px 0}
.shot{position:absolute;border-radius:14px;overflow:hidden;box-shadow:0 0 0 1px rgba(255,255,255,.12),0 40px 120px rgba(0,0,0,.6)}
.shot img{display:block;width:100%}
.foot{position:absolute;left:0;right:0;bottom:0;height:90px;background:#141413;display:flex;align-items:center;
justify-content:space-between;padding:0 72px;font-size:26px;border-top:1px solid rgba(255,255,255,.08)}
.foot b{color:#d97757;font-weight:600}`;

const copy = (top) => `
<div style="position:absolute;left:72px;top:${top}px;width:560px">
  <div class="brand"><img src="${f('assets/icon.png')}">ShellQuarry</div>
  <div class="kick" style="margin-top:48px">FREE · OPEN SOURCE · FOR HERDR</div>
  <h1 style="font-size:80px;margin-top:16px">Give your agents a browser.</h1>
  <div class="lede" style="font-size:34px;margin-top:22px">Herdr, with buttons, in a window like Claude Code.</div>
  <ul style="font-size:23px;margin-top:28px">
    <li>Start Claude Code, Codex and 22 more</li>
    <li>A browser your agents drive over MCP</li>
    <li>Message box, alerts, other machines</li>
  </ul>
</div>`;

const pages = {
  cover: [1600, 900, `${copy(110)}<div class="shot" style="left:700px;top:120px;width:1100px">
    <img src="${f('docs/screenshots/hero.png')}"></div>`],
  social: [1600, 1000, `${copy(96)}<div class="shot" style="left:700px;top:110px;width:1100px">
    <img src="${f('docs/screenshots/hero.png')}"></div>
    <div class="foot"><span>MIT licence · Tauri + Rust · Windows</span><b>github.com/Obiwayne/ShellQuarry</b></div>`],
  'builds-card': [800, 320, `<div class="shot" style="left:-60px;top:-34px;width:900px;border-radius:0">
    <img src="${f('docs/screenshots/hero.png')}"></div>`],
};

const browser = await chromium.launch({ channel: 'msedge' });
for (const [name, [w, h, body]] of Object.entries(pages)) {
  const page = await browser.newPage({ viewport: { width: w, height: h } });
  const tmp = resolve(out, `_${name}.html`);
  writeFileSync(tmp, `<!doctype html><html><head><meta charset="utf-8"><style>${css(w, h)}</style></head><body>${body}</body></html>`);
  await page.goto(f(tmp));
  await page.waitForTimeout(400);
  await page.screenshot({ path: resolve(out, `${name}.png`) });
  rmSync(tmp);
}
await browser.close();

// WebP copies for the web: the cover, the builds card and every screenshot.
const webp = (src, dest) => spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', src, '-c:v', 'libwebp', '-quality', '86', dest], { stdio: 'inherit' });
webp(resolve(out, 'cover.png'), resolve(out, 'cover.webp'));
webp(resolve(out, 'builds-card.png'), resolve(out, 'builds-card.webp'));
for (const file of readdirSync('docs/screenshots').filter((n) => n.endsWith('.png'))) {
  webp(resolve('docs/screenshots', file), resolve(out, `${basename(file, '.png')}.webp`));
}
console.log(`images written to ${out}`);

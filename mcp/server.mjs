#!/usr/bin/env node
// ShellQuarry browser MCP server.
//
// An agent (Claude Code, Codex, ...) starts this over stdio. It connects to the
// running ShellQuarry app through WebView2's DevTools port and drives ONLY the
// browser panel; the app's own UI page is used just to open the panel and show
// agent activity. Before each click a visible cursor glides to the target.
//
//   claude mcp add shellquarry -- node F:/ShellQuarry/mcp/server.mjs
//
// From WSL, point it at the Windows side: SHELLQUARRY_CDP=http://<windows-host>:9333

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { chromium } from 'playwright-core';
import { z } from 'zod';

const CDP = process.env.SHELLQUARRY_CDP || `http://127.0.0.1:${process.env.SHELLQUARRY_CDP_PORT || 9333}`;
const UI_ORIGIN = /^https?:\/\/tauri\.localhost/;
const TEXT_LIMIT = 6000;

let browser;

async function connect() {
  if (browser?.isConnected()) return browser;
  try {
    browser = await chromium.connectOverCDP(CDP, { timeout: 5000 });
  } catch {
    throw new Error(`ShellQuarry is not running (no browser at ${CDP}). Start the app, then try again.`);
  }
  browser.on('disconnected', () => { browser = undefined; });
  return browser;
}

async function pages() {
  const b = await connect();
  const all = b.contexts().flatMap((c) => c.pages()).filter((p) => !p.url().startsWith('devtools://'));
  // The app's UI exposes window.shellquarry; it is served from tauri.localhost in
  // release builds and from a local dev server under `tauri dev`.
  const isUi = async (p) => UI_ORIGIN.test(p.url()) || (await p.evaluate(() => !!window.shellquarry).catch(() => false));
  let ui;
  for (const p of all) if (await isUi(p)) { ui = p; break; }
  const panel = all.find((p) => p !== ui);
  if (!panel) throw new Error('The browser panel was not found in ShellQuarry.');
  return { ui, panel };
}

/** Opens the panel in the app and shows the agent's activity in the top bar. */
async function show(label) {
  const { ui, panel } = await pages();
  if (ui) {
    await ui.evaluate((text) => {
      window.shellquarry?.openPanel();
      window.shellquarry?.agentActivity(text);
    }, label).catch(() => {});
  }
  return panel;
}

// Runs in the page: draws the agent cursor (once) and glides it to x, y.
const CURSOR_SCRIPT = ({ x, y, click }) => {
  const id = '__shellquarry_cursor';
  let el = document.getElementById(id);
  if (!el) {
    el = document.createElement('div');
    el.id = id;
    el.setAttribute('aria-hidden', 'true');
    el.innerHTML =
      '<svg width="22" height="22" viewBox="0 0 24 24"><path d="M4 2l15 11l-6.5 1.2l3.6 6.8l-2.9 1.5l-3.6-6.8L4 20z" ' +
      'fill="#6aa8ff" stroke="#fff" stroke-width="1.5" stroke-linejoin="round"/></svg>' +
      '<span style="position:absolute;left:-14px;top:-14px;width:28px;height:28px;border-radius:50%;' +
      'border:2px solid #6aa8ff;opacity:0;transform:scale(.4);transition:all .35s ease-out"></span>';
    Object.assign(el.style, {
      position: 'fixed', left: `${innerWidth / 2}px`, top: `${innerHeight / 2}px`, zIndex: '2147483647',
      pointerEvents: 'none', transition: 'left .45s cubic-bezier(.3,.7,.3,1), top .45s cubic-bezier(.3,.7,.3,1)',
      filter: 'drop-shadow(0 2px 3px rgba(0,0,0,.35))',
    });
    document.documentElement.appendChild(el);
  }
  el.style.left = `${x}px`;
  el.style.top = `${y}px`;
  if (click) {
    const ring = el.querySelector('span');
    setTimeout(() => {
      ring.style.transition = 'none'; ring.style.opacity = '1'; ring.style.transform = 'scale(.4)';
      requestAnimationFrame(() => { ring.style.transition = 'all .35s ease-out'; ring.style.opacity = '0'; ring.style.transform = 'scale(1.4)'; });
    }, 460);
  }
};

async function glideTo(page, x, y, click = false) {
  await page.evaluate(CURSOR_SCRIPT, { x, y, click }).catch(() => {});
  await page.waitForTimeout(480);
}

// Runs in the page: labels visible interactive elements with refs and returns a text snapshot.
const SNAPSHOT_SCRIPT = (limit) => {
  const selector = 'a[href], button, input, textarea, select, summary, [role=button], [role=link], [role=tab], ' +
    '[role=checkbox], [role=menuitem], [role=option], [contenteditable=""], [contenteditable=true], [onclick]';
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    const s = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none';
  };
  const nameOf = (el) =>
    (el.getAttribute('aria-label') || el.innerText || el.value || el.getAttribute('placeholder') ||
      el.getAttribute('title') || el.getAttribute('alt') || el.querySelector('img[alt]')?.alt ||
      el.getAttribute('name') || '')
      .replace(/\s+/g, ' ').trim().slice(0, 80);
  const lines = [];
  let n = 0;
  for (const el of document.querySelectorAll(selector)) {
    if (el.closest('#__shellquarry_cursor') || !visible(el)) continue;
    const ref = `e${++n}`;
    el.setAttribute('data-sq-ref', ref);
    const role = el.getAttribute('role') || el.tagName.toLowerCase();
    const type = el.tagName === 'INPUT' ? `[${el.type}]` : '';
    const where = el.getBoundingClientRect().top > innerHeight ? ' (below the fold)' : '';
    lines.push(`[${ref}] ${role}${type} "${nameOf(el)}"${where}`);
    if (n >= 200) break;
  }
  const text = (document.body?.innerText || '').replace(/\n{3,}/g, '\n\n').trim();
  return {
    title: document.title,
    url: location.href,
    elements: lines.join('\n'),
    text: text.length > limit ? `${text.slice(0, limit)}\n… (${text.length - limit} more characters)` : text,
  };
};

async function snapshot(page) {
  await page.waitForLoadState('domcontentloaded').catch(() => {});
  const s = await page.evaluate(SNAPSHOT_SCRIPT, TEXT_LIMIT);
  return `Page: ${s.title || '(no title)'}\nURL: ${s.url}\n\nInteractive elements (use the ref with browser_click / browser_type):\n${s.elements || '(none)'}\n\nPage text:\n${s.text}`;
}

async function target(page, ref) {
  const el = page.locator(`[data-sq-ref="${ref}"]`).first();
  if (!(await el.count())) throw new Error(`No element ${ref} on the page. Take a new browser_snapshot; refs change after navigation.`);
  await el.scrollIntoViewIfNeeded().catch(() => {});
  const box = await el.boundingBox();
  if (!box) throw new Error(`Element ${ref} is not visible.`);
  return { el, x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

const text = (t) => ({ content: [{ type: 'text', text: t }] });
const fail = (err) => ({ content: [{ type: 'text', text: String(err?.message || err) }], isError: true });
const tool = (fn) => async (args) => { try { return await fn(args ?? {}); } catch (err) { return fail(err); } };

const server = new McpServer({ name: 'shellquarry', version: '0.1.0' });

server.registerTool('browser_open_panel', {
  description: 'Open the ShellQuarry browser side panel so the user can watch.',
  inputSchema: {},
}, tool(async () => { await show('Agent opened the browser'); return text('Browser panel is open.'); }));

server.registerTool('browser_navigate', {
  description: 'Open a web address in the ShellQuarry browser panel and return a snapshot of the page.',
  inputSchema: { url: z.string().describe('Address to open, e.g. https://example.com') },
}, tool(async ({ url }) => {
  const page = await show('Agent is browsing');
  const address = /^[a-z]+:/i.test(url) ? url : `https://${url}`;
  await page.goto(address, { waitUntil: 'domcontentloaded', timeout: 30000 });
  return text(await snapshot(page));
}));

server.registerTool('browser_snapshot', {
  description: 'Read the current page: title, address, clickable elements with refs, and visible text.',
  inputSchema: {},
}, tool(async () => text(await snapshot(await show('Agent is reading the page')))));

server.registerTool('browser_click', {
  description: 'Click an element by its ref from the latest snapshot. A visible cursor moves to it first.',
  inputSchema: { ref: z.string().describe('Element ref, e.g. e12') },
}, tool(async ({ ref }) => {
  const page = await show('Agent is clicking');
  const { x, y } = await target(page, ref);
  await glideTo(page, x, y, true);
  await page.mouse.click(x, y);
  await page.waitForLoadState('domcontentloaded', { timeout: 10000 }).catch(() => {});
  await page.waitForTimeout(300);
  return text(`Clicked ${ref}.\n\n${await snapshot(page)}`);
}));

server.registerTool('browser_type', {
  description: 'Type text into a field by its ref. Replaces what is there; set submit to press Enter afterwards.',
  inputSchema: {
    ref: z.string().describe('Element ref, e.g. e3'),
    text: z.string(),
    submit: z.boolean().optional().describe('Press Enter after typing'),
  },
}, tool(async ({ ref, text: value, submit }) => {
  const page = await show('Agent is typing');
  const { el, x, y } = await target(page, ref);
  await glideTo(page, x, y, true);
  await el.click();
  await el.fill('');
  await el.pressSequentially(value, { delay: 25 });
  if (submit) {
    await el.press('Enter');
    await page.waitForLoadState('domcontentloaded', { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(500);
  }
  return text(`Typed into ${ref}${submit ? ' and pressed Enter' : ''}.\n\n${await snapshot(page)}`);
}));

server.registerTool('browser_press_key', {
  description: 'Press a key in the browser panel, e.g. Enter, Escape, Tab, ArrowDown, Control+A.',
  inputSchema: { key: z.string() },
}, tool(async ({ key }) => {
  const page = await show('Agent is typing');
  await page.keyboard.press(key);
  return text(`Pressed ${key}.`);
}));

server.registerTool('browser_scroll', {
  description: 'Scroll the page up or down by about one screen (or the given number of pixels).',
  inputSchema: { direction: z.enum(['up', 'down']), pixels: z.number().int().positive().optional() },
}, tool(async ({ direction, pixels }) => {
  const page = await show('Agent is scrolling');
  const dy = (pixels ?? Math.round((page.viewportSize()?.height ?? 700) * 0.8)) * (direction === 'up' ? -1 : 1);
  await page.mouse.wheel(0, dy);
  await page.waitForTimeout(400);
  return text(`Scrolled ${direction}.\n\n${await snapshot(page)}`);
}));

server.registerTool('browser_back', {
  description: 'Go back to the previous page in the browser panel.',
  inputSchema: {},
}, tool(async () => {
  const page = await show('Agent is browsing');
  await page.goBack({ waitUntil: 'domcontentloaded' }).catch(() => {});
  return text(await snapshot(page));
}));

server.registerTool('browser_screenshot', {
  description: 'Take a screenshot of what the browser panel shows.',
  inputSchema: {},
}, tool(async () => {
  const page = await show('Agent took a screenshot');
  const png = await page.screenshot({ type: 'png' });
  return { content: [{ type: 'image', data: png.toString('base64'), mimeType: 'image/png' }] };
}));

server.registerTool('browser_close_panel', {
  description: 'Hide the ShellQuarry browser panel. The page stays loaded.',
  inputSchema: {},
}, tool(async () => {
  const { ui } = await pages();
  await ui?.evaluate(() => window.shellquarry?.closePanel());
  return text('Browser panel closed.');
}));

await server.connect(new StdioServerTransport());
console.error(`shellquarry MCP server ready (browser at ${CDP})`);

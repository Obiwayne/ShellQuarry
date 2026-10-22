#!/usr/bin/env node
// ShellQuarry browser MCP server.
//
// An agent (Claude Code, Codex, ...) starts this over stdio. It finds the
// running ShellQuarry app through its session file, controls the panel and
// tabs through the app's token-protected control API, and drives the page in
// a tab over WebView2's DevTools port. It never touches the app's own UI.
// Before each click a visible cursor glides to the target.
//
//   claude mcp add --scope user shellquarry -- node <this file>

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { chromium } from 'playwright-core';
import { z } from 'zod';
import { cdpUrl, control, ensureRunning } from '../lib/session.mjs';

const TEXT_LIMIT = 6000;

let browser;
let browserFor;

async function connect() {
  const url = cdpUrl();
  // A restarted app has a new DevTools port.
  if (browser?.isConnected() && browserFor === url) return browser;
  await browser?.close().catch(() => {});
  browser = await chromium.connectOverCDP(url, { timeout: 8000 });
  browserFor = url;
  browser.on('disconnected', () => { browser = undefined; });
  return browser;
}

const tabIdOf = (page) => page.evaluate(() => window.__shellquarryTab ?? null).catch(() => null);

/** The Playwright page for a ShellQuarry tab, waiting for a new tab's webview to appear. */
async function pageFor(tab) {
  const b = await connect();
  for (let i = 0; i < 50; i++) {
    for (const page of b.contexts().flatMap((c) => c.pages())) {
      if ((await tabIdOf(page)) === tab) return page;
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`Tab ${tab} is not loaded.`);
}

async function activity(label) {
  await control('POST', '/activity', { label }).catch(() => {});
}

/** Opens the panel (starting the app if needed) and returns the target tab's page. */
async function target(tab, label) {
  await ensureRunning(['--browser-only']);
  const open = tab ? await control('POST', '/tabs/select', { tab }) : await control('POST', '/open', {});
  const id = tab ?? open.active;
  if (!id) throw new Error('No tab is open.');
  await activity(label);
  return { page: await pageFor(id), id };
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
      'fill="#89b4fa" stroke="#1e1e2e" stroke-width="1.5" stroke-linejoin="round"/></svg>' +
      '<span style="position:absolute;left:-14px;top:-14px;width:28px;height:28px;border-radius:50%;' +
      'border:2px solid #89b4fa;opacity:0;transform:scale(.4);transition:all .35s ease-out"></span>';
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
    '[role=checkbox], [role=menuitem], [role=option], [role=searchbox], [role=textbox], [contenteditable=""], ' +
    '[contenteditable=true], [onclick]';
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
  for (const old of document.querySelectorAll('[data-sq-ref]')) old.removeAttribute('data-sq-ref');
  const lines = [];
  let n = 0;
  for (const el of document.querySelectorAll(selector)) {
    if (el.closest('#__shellquarry_cursor') || !visible(el)) continue;
    const ref = `e${++n}`;
    el.setAttribute('data-sq-ref', ref);
    const role = el.getAttribute('role') || el.tagName.toLowerCase();
    const type = el.tagName === 'INPUT' ? `[${el.type}]` : '';
    const top = el.getBoundingClientRect().top;
    const where = top > innerHeight ? ' (below)' : top < 0 ? ' (above)' : '';
    lines.push(`[${ref}] ${role}${type} "${nameOf(el)}"${where}`);
    if (n >= 200) break;
  }
  const text = (document.body?.innerText || '').replace(/\n{3,}/g, '\n\n').trim();
  return {
    title: document.title,
    url: location.href.startsWith('data:') ? '(new tab)' : location.href,
    elements: lines.join('\n'),
    text: text.length > limit ? `${text.slice(0, limit)}\n… (${text.length - limit} more characters)` : text,
  };
};

async function snapshot(page, id) {
  await page.waitForLoadState('domcontentloaded').catch(() => {});
  const s = await page.evaluate(SNAPSHOT_SCRIPT, TEXT_LIMIT);
  return `Tab ${id}: ${s.title || '(no title)'}\nURL: ${s.url}\n\n` +
    `Interactive elements (pass the ref to browser_click / browser_type):\n${s.elements || '(none)'}\n\nPage text:\n${s.text}`;
}

async function element(page, ref) {
  const el = page.locator(`[data-sq-ref="${ref}"]`).first();
  if (!(await el.count())) throw new Error(`No element ${ref} on the page. Take a new browser_snapshot; refs change when the page changes.`);
  await el.scrollIntoViewIfNeeded().catch(() => {});
  const box = await el.boundingBox();
  if (!box) throw new Error(`Element ${ref} is not visible.`);
  return { el, x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

function tabsText(state) {
  if (!state.tabs.length) return 'No tabs are open.';
  return state.tabs
    .map((t, i) => `${t.id === state.active ? '*' : ' '} tab ${t.id} (#${i + 1}): ${t.title || 'New tab'} — ${t.url || '(new tab)'}`)
    .join('\n') + `\n\n${state.lite ? 'Lite' : 'Full'} mode, up to ${state.max_tabs} tabs. * = active.`;
}

const text = (t) => ({ content: [{ type: 'text', text: t }] });
const fail = (err) => ({ content: [{ type: 'text', text: String(err?.message || err) }], isError: true });
const tool = (fn) => async (args) => { try { return await fn(args ?? {}); } catch (err) { return fail(err); } };
const tabArg = z.number().int().positive().optional().describe('Tab id from browser_tabs; the active tab when omitted');

const server = new McpServer({ name: 'shellquarry', version: '0.3.0' });

server.registerTool('browser_open_panel', {
  description: 'Open the ShellQuarry browser panel so the user can watch. Starts ShellQuarry if it is not running.',
  inputSchema: {},
}, tool(async () => {
  await ensureRunning(['--browser-only']);
  const state = await control('POST', '/open', {});
  await activity('opened the browser');
  return text(`Browser panel is open.\n\n${tabsText(state)}`);
}));

server.registerTool('browser_navigate', {
  description: 'Open a web address in the ShellQuarry browser (the active tab, or new_tab) and return a snapshot of the page.',
  inputSchema: {
    url: z.string().describe('Address to open, e.g. https://example.com'),
    new_tab: z.boolean().optional().describe('Open in a new tab instead of the active one'),
    tab: tabArg,
  },
}, tool(async ({ url, new_tab, tab }) => {
  const address = /^[a-z]+:/i.test(url) ? url : `https://${url}`;
  let id = tab;
  if (new_tab) {
    await ensureRunning(['--browser-only']);
    id = (await control('POST', '/tabs/new', {})).tab;
  }
  const { page, id: tabId } = await target(id, 'browsing');
  await page.goto(address, { waitUntil: 'domcontentloaded', timeout: 30000 });
  return text(await snapshot(page, tabId));
}));

server.registerTool('browser_snapshot', {
  description: 'Read a page: title, address, clickable elements with refs, and visible text.',
  inputSchema: { tab: tabArg },
}, tool(async ({ tab }) => {
  const { page, id } = await target(tab, 'reading the page');
  return text(await snapshot(page, id));
}));

server.registerTool('browser_click', {
  description: 'Click an element by its ref from the latest snapshot. A visible cursor moves to it first.',
  inputSchema: { ref: z.string().describe('Element ref, e.g. e12'), tab: tabArg },
}, tool(async ({ ref, tab }) => {
  const { page, id } = await target(tab, 'clicking');
  const { x, y } = await element(page, ref);
  await glideTo(page, x, y, true);
  await page.mouse.click(x, y);
  await page.waitForLoadState('domcontentloaded', { timeout: 10000 }).catch(() => {});
  await page.waitForTimeout(300);
  return text(`Clicked ${ref}.\n\n${await snapshot(page, id)}`);
}));

server.registerTool('browser_type', {
  description: 'Type text into a field by its ref. Replaces what is there; set submit to press Enter afterwards.',
  inputSchema: {
    ref: z.string().describe('Element ref, e.g. e3'),
    text: z.string(),
    submit: z.boolean().optional().describe('Press Enter after typing'),
    tab: tabArg,
  },
}, tool(async ({ ref, text: value, submit, tab }) => {
  const { page, id } = await target(tab, 'typing');
  const { el, x, y } = await element(page, ref);
  await glideTo(page, x, y, true);
  await el.click();
  await el.fill('');
  await el.pressSequentially(value, { delay: 25 });
  if (submit) {
    await el.press('Enter');
    await page.waitForLoadState('domcontentloaded', { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(500);
  }
  return text(`Typed into ${ref}${submit ? ' and pressed Enter' : ''}.\n\n${await snapshot(page, id)}`);
}));

server.registerTool('browser_press_key', {
  description: 'Press a key in the browser, e.g. Enter, Escape, Tab, ArrowDown, Control+A.',
  inputSchema: { key: z.string(), tab: tabArg },
}, tool(async ({ key, tab }) => {
  const { page } = await target(tab, 'typing');
  await page.keyboard.press(key);
  return text(`Pressed ${key}.`);
}));

server.registerTool('browser_scroll', {
  description: 'Scroll the page up or down by about one screen (or the given number of pixels).',
  inputSchema: { direction: z.enum(['up', 'down']), pixels: z.number().int().positive().optional(), tab: tabArg },
}, tool(async ({ direction, pixels, tab }) => {
  const { page, id } = await target(tab, 'scrolling');
  const height = await page.evaluate(() => innerHeight).catch(() => 700);
  await page.mouse.wheel(0, (pixels ?? Math.round(height * 0.8)) * (direction === 'up' ? -1 : 1));
  await page.waitForTimeout(400);
  return text(`Scrolled ${direction}.\n\n${await snapshot(page, id)}`);
}));

server.registerTool('browser_back', {
  description: 'Go back to the previous page.',
  inputSchema: { tab: tabArg },
}, tool(async ({ tab }) => {
  const { page, id } = await target(tab, 'browsing');
  await page.goBack({ waitUntil: 'domcontentloaded' }).catch(() => {});
  return text(await snapshot(page, id));
}));

server.registerTool('browser_screenshot', {
  description: 'Take a screenshot of what a tab shows.',
  inputSchema: { tab: tabArg },
}, tool(async ({ tab }) => {
  const { page } = await target(tab, 'took a screenshot');
  const png = await page.screenshot({ type: 'png' });
  return { content: [{ type: 'image', data: png.toString('base64'), mimeType: 'image/png' }] };
}));

server.registerTool('browser_tabs', {
  description: 'List the open tabs with their ids, titles and addresses.',
  inputSchema: {},
}, tool(async () => text(tabsText((await control('GET', '/status')).browser))));

server.registerTool('browser_new_tab', {
  description: 'Open a new tab (optionally at an address) and make it active.',
  inputSchema: { url: z.string().optional() },
}, tool(async ({ url }) => {
  await ensureRunning(['--browser-only']);
  const res = await control('POST', '/tabs/new', url ? { url } : {});
  await activity('opened a tab');
  return text(`Opened tab ${res.tab}.\n\n${tabsText(res.browser)}`);
}));

server.registerTool('browser_select_tab', {
  description: 'Switch the panel to another tab.',
  inputSchema: { tab: z.number().int().positive() },
}, tool(async ({ tab }) => text(tabsText(await control('POST', '/tabs/select', { tab })))));

server.registerTool('browser_close_tab', {
  description: 'Close a tab.',
  inputSchema: { tab: z.number().int().positive() },
}, tool(async ({ tab }) => text(tabsText(await control('POST', '/tabs/close', { tab })))));

server.registerTool('browser_close_panel', {
  description: 'Hide the browser panel. Tabs stay open (in lite mode they unload until reopened).',
  inputSchema: {},
}, tool(async () => {
  await control('POST', '/close', {});
  return text('Browser panel closed.');
}));

await server.connect(new StdioServerTransport());
console.error('shellquarry MCP server ready');

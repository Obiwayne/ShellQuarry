# ShellQuarry (prototype)

A desktop shell for terminal agent tools such as [Herdr](https://herdr.dev), with a browser side panel that your
agents can drive, like the globe browser in the Claude Code desktop app.

- **Left:** a real terminal (xterm.js on a pseudoterminal from portable-pty). Run Herdr, Claude Code, Codex or anything else in it.
- **Top right:** the globe button (or Ctrl+Shift+B) opens and closes the browser panel.
- **Right:** the browser panel, a separate WebView2 webview with its own address bar. Agents control it over MCP, and a
  blue cursor glides to each thing they click or type into, so you can follow along.

Built with Tauri 2 (MIT/Apache-2.0), xterm.js (MIT), portable-pty (MIT), Playwright's library (Apache-2.0) and the MCP
TypeScript SDK (MIT).

## Run it

Needs Windows 10/11, Node.js 20+, Rust, and the Microsoft C++ Build Tools (see the
[Tauri prerequisites](https://v2.tauri.app/start/prerequisites/)).

```
npm install
npm run dev
```

The terminal starts PowerShell. To start something else, set `SHELLQUARRY_SHELL` before launching, for example
`SHELLQUARRY_SHELL=wsl.exe` to open WSL, where Herdr runs.

## Connect an agent

The agent starts the MCP server itself. For Claude Code:

```
claude mcp add shellquarry -- node F:/ShellQuarry/mcp/server.mjs
```

Other MCP clients use the same command (`node <path>/mcp/server.mjs`, stdio). The app must be open.

Tools: `browser_open_panel`, `browser_navigate`, `browser_snapshot`, `browser_click`, `browser_type`,
`browser_press_key`, `browser_scroll`, `browser_back`, `browser_screenshot`, `browser_close_panel`.

Snapshots list the page's clickable elements with refs (`[e12] button "Sign in"`); agents pass a ref to
`browser_click` or `browser_type`.

### Agents running in WSL (Herdr)

The panel lives on the Windows side. An agent inside WSL can reach it if WSL uses
[mirrored networking](https://learn.microsoft.com/en-us/windows/wsl/networking); then the same command works with
Node installed in WSL. Otherwise set `SHELLQUARRY_CDP=http://<windows-host-ip>:9333`. Not tested yet.

## How it works

```
ShellQuarry window (Tauri)
├── "ui" webview: top bar + terminal  ──IPC──► Rust: pty_start / pty_write / browser_layout ...
└── "browser" webview: the side panel ◄──DevTools port 127.0.0.1:9333──┐
                                                                        │
agent (Claude Code, Codex...) ──stdio──► mcp/server.mjs (Playwright) ───┘
```

The MCP server only acts on the browser panel. It touches the app's own UI page just to open the panel and show
"Agent is browsing" in the top bar.

## Try it without an agent

With the app open:

```
node scripts/try-agent.mjs     # opens Wikipedia, reads, scrolls, saves screenshots to try-agent-output/
node scripts/try-cursor.mjs    # types into a search box so you can see the agent cursor
node scripts/smoke-ui.mjs      # globe toggle and a terminal round trip
```

## Prototype limits

- **Security:** the DevTools port is bound to 127.0.0.1, but any program on this PC can use it to control the panel
  while the app is open. A release should use a random port with a token, or a named pipe.
- The panel shares one profile, so logins in it persist between runs. One tab only.
- Windows only so far. Tauri supports macOS and Linux, but the agent bridge relies on WebView2's DevTools port.
- The icons are borrowed from DiskQuarry for now.

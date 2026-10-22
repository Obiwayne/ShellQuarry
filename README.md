# ShellQuarry: the browser shell for Herdr

A desktop app for [Herdr](https://herdr.dev) that gives your coding agents a browser you can watch, laid out like
the Claude Code desktop app: your Herdr agents in the sidebar, Herdr in the middle, and a browser side panel that
opens from the globe button. Agents drive the browser over MCP, and a cursor glides to everything they click or
type into, so you can follow along.

It comes in two parts:

- **The app** (Windows): Herdr runs unchanged in its terminal. ShellQuarry adds the window, the sidebar and the browser.
- **A Herdr plugin**: "Open agent browser" from inside Herdr, Ctrl+click links into the agent browser, and a popup
  that connects Claude Code and Codex. Works whether you run Herdr inside ShellQuarry or in Windows Terminal.

ShellQuarry is an independent project. It is not made by or affiliated with Herdr.

## What's in the window

ShellQuarry puts buttons on Herdr, so you don't need to learn its keyboard shortcuts. Everything still runs in
Herdr, and every Herdr feature is still there in the terminal.

- **New agent:** pick Claude Code, Codex, Gemini, Cursor, Copilot, OpenCode or any of the 24 agents Herdr supports,
  a project folder and, optionally, a new git branch (worktree). It starts in its own workspace. Agents that ask a
  first-run question, like Claude Code's "trust this folder?", are flagged so you can answer in the terminal.
- **Sidebar:** your agents with live status (working, needs you, done, idle), workspaces and machines. Click an
  agent to jump to it; right-click for Message, Stop, Rename and Close. Right-click a workspace to rename it, add a
  tab, start an agent there or close it.
- **Message box:** type to the selected agent at the bottom, like in Claude Code. Enter sends, Shift+Enter adds a
  line, the square button stops a working agent. Messages to an agent that is waiting on a question are refused
  rather than typed into it.
- **Alerts:** a notice when an agent needs you or finishes, with a button to jump to it.
- **Toolbar above the terminal:** Herdr's tabs, a new-tab button, split right/down, zoom, and a button that hides
  Herdr's own sidebar (it sends your Herdr `toggle_sidebar` keys) so only ShellQuarry's shows.
- **Command palette (Ctrl+K):** every action, plus each agent and workspace, searchable.
- **Browser panel:** tabs, back/forward/reload and an address bar. Opens with the globe button or **Ctrl+Shift+B**.
  **Ctrl+Shift+S** hides the sidebar. Links that open a new window become a new tab.
- **A short tour** the first time you open it (Ctrl+K → "Show the tour" to see it again).

### Other machines

Herdr runs agents on your other computers over SSH. Click **+** next to Machines and enter an SSH host (anything
`ssh <host>` accepts). A terminal window opens for `herdr machine add`, which can install Herdr there after asking.
Each machine then appears in the sidebar with its workspaces and agents, and you can message its agents and start
new ones there from ShellQuarry. Machines can be turned off or removed from their right-click menu; their agents
keep running. Showing a remote agent's screen in the terminal still happens in Herdr itself (select the machine in
Herdr's sidebar).

### Colours

Pick from the colour button at the bottom of the sidebar:

- **Follow Herdr** (default): uses the theme in `%APPDATA%\herdr\config.toml`, including custom colours and
  light/dark auto-switching.
- **Claude dark / Claude light**: Claude Code's palette, with a sans-serif interface.
- **Any of Herdr's built-in themes**: Catppuccin, Tokyo Night, Dracula, Nord, Gruvbox, One Dark, Solarized,
  Kanagawa, Rosé Pine, Vesper and their light versions.

Herdr draws its own screens in its own theme. To make Herdr match a Claude palette too, set its theme to
`terminal` so it uses ShellQuarry's terminal colours:

```toml
[theme]
name = "terminal"
```

### Memory: full and lite mode

| | Full | Lite |
|---|---|---|
| Tabs | up to 8 | up to 4 |
| Background tabs | stay loaded | unloaded, reloaded when you open them |
| Closing the panel | pages stay loaded | everything is unloaded |

Machines with less than 12 GB of memory start in lite mode; click the Full/Lite chip to switch. **16 GB is
recommended**; 8 GB works in lite mode with one or two agents.

## Install

1. Install [Herdr](https://herdr.dev) (`powershell -ExecutionPolicy Bypass -c "irm https://herdr.dev/install.ps1 | iex"`).
2. Run the ShellQuarry installer (`ShellQuarry_0.3.0_x64-setup.exe` from Releases, or `npm run build`).
3. Install the plugin (needs Node.js 20+):

   ```
   herdr plugin install Obiwayne/ShellQuarry/plugin
   ```

4. Connect your agents: click **Connect agents** in ShellQuarry's sidebar, or open the plugin's *connect agents*
   popup in Herdr. It offers to add the browser to Claude Code and Codex. To do it by hand:

   ```
   claude mcp add --scope user shellquarry -- node "<plugin folder>/mcp/server.mjs"
   ```

5. Optional keybinding: add to `%APPDATA%\herdr\config.toml`, then `herdr server reload-config`:

   ```toml
   [[keys.command]]
   key = "prefix+o"
   type = "plugin_action"
   command = "shellquarry.browser.open"
   description = "open agent browser"
   ```

## Agent tools

`browser_open_panel`, `browser_navigate`, `browser_snapshot`, `browser_click`, `browser_type`, `browser_press_key`,
`browser_scroll`, `browser_back`, `browser_screenshot`, `browser_tabs`, `browser_new_tab`, `browser_select_tab`,
`browser_close_tab`, `browser_close_panel`.

Snapshots list each page's clickable elements with refs (`[e12] button "Sign in"`); agents pass a ref to
`browser_click` or `browser_type`. Tools act on the active tab unless given a `tab` id. If ShellQuarry isn't running,
the first tool call starts it as a browser window.

## How it works

```
ShellQuarry window (Tauri)
├── "ui" webview: sidebar, title bar, terminal (xterm.js ⇄ portable-pty ⇄ herdr.exe)
└── "tab-N" webviews: one per browser tab, placed over the panel
        ▲ DevTools port (random, 127.0.0.1)          ▲ control API (random port + token, 127.0.0.1)
        │                                            │
   mcp/server.mjs (Playwright) ──────────────────────┤
        ▲ stdio                                      │
   your agent (Claude Code, Codex...)        Herdr plugin actions
```

- On start the app picks two random loopback ports and a random token and writes them to
  `%LOCALAPPDATA%\dev.repoquarry.shellquarry\session.json`, which is removed on exit.
- The control API refuses requests without the token, requests from web pages (an `Origin` header) and requests
  with a foreign `Host` header.
- The MCP server drives only the browser tabs, never the app's own interface.
- A second launch hands its request (for example a link to open) to the running app.

## Develop

Needs Windows 10/11, Node.js 20+, Rust and the Microsoft C++ Build Tools (see the
[Tauri prerequisites](https://v2.tauri.app/start/prerequisites/)).

```
npm install
npm run dev          # run the app
npm run build        # app + installer in src-tauri/target/release/bundle/nsis (local paths stripped)
npm run icons        # re-render the icon from assets/icon.svg
cd plugin && npm install
herdr plugin link .  # use your working copy as the Herdr plugin
```

`SHELLQUARRY_SHELL` overrides what the terminal runs, for example `SHELLQUARRY_SHELL=pwsh`.

With the app open, from `plugin/`:

```
node test/try-agent.mjs      # an agent session over MCP: tabs, search, scrolling, screenshots
node test/smoke-ui.mjs       # globe toggle and lite mode
node test/herdr-ui.mjs <scratch-folder>   # New agent, message box, command palette (starts Claude Code, sends nothing)
node test/pick-palette.mjs "Claude dark"
```

## Limits

- **Windows only for now.** The agent bridge uses WebView2's DevTools port. Tauri and Herdr also run on macOS and
  Linux, so a port is possible.
- **Any program running as you can still reach the browser** through its DevTools port while the app is open; the
  random port only makes it harder to find. The control API is token-protected. Programs running as you can already
  read your files, so this matches the usual desktop trust model, but don't run untrusted software alongside it.
- The browser keeps one profile, so sign-ins persist between runs.
- **Lite mode saves less than hoped.** WebView2 shares page processes between tabs, so unloading background tabs
  freed little memory in testing (about 300 MB for five tabs either way). The tab limit still caps growth.
- The Herdr plugin needs Node.js, and agents need it to run the MCP server.
- Agent screens are still drawn by each agent in the terminal; ShellQuarry adds controls around them rather than
  redrawing conversations as chat bubbles.
- Other machines are built on Herdr's documented `machine` and `--machine` commands but haven't been tested against a
  real remote machine yet.

## Built with RepoQuarry

ShellQuarry was put together with [RepoQuarry](https://repoquarry.dev), a catalogue of open-source projects with a
source and a date for every fact. Its building blocks were picked from RepoQuarry and are listed there under
[Building blocks](https://repoquarry.dev/tags/building-blocks):

| Piece | Project | Licence |
|---|---|---|
| App window | [Tauri](https://repoquarry.dev/projects/tauri) | MIT or Apache-2.0 |
| Terminal screen | [xterm.js](https://repoquarry.dev/projects/xterm-js) | MIT |
| Terminal process | [portable-pty](https://repoquarry.dev/projects/portable-pty) | MIT |
| Browser control | Playwright's library (`playwright-core`), from the team behind [Playwright MCP](https://repoquarry.dev/projects/playwright-mcp) | Apache-2.0 |
| Agent connection | MCP TypeScript SDK | MIT |

Herdr's theme palettes in `ui/themes.js` are ported from [Herdr](https://github.com/herdrdev/herdr) (Apache-2.0).

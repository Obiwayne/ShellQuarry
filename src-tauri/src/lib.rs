//! ShellQuarry: the browser shell for Herdr.
//!
//! One window. The "ui" webview draws the top bar and the terminal (Herdr, or
//! a shell); browser tabs are separate webviews placed over the UI's panel
//! slot (browser.rs). Agents drive the tabs over WebView2's DevTools port, and
//! the Herdr plugin and MCP server control the panel through a token-protected
//! local API (control.rs).
//!
//! Command-line options (used by the Herdr plugin):
//!   --browser-only   no terminal; just the browser panel
//!   --open <url>     open the panel at this address

mod browser;
mod control;
mod pty;
mod sys;

use std::net::TcpListener;

use serde_json::{json, Value};
use tauri::webview::WebviewBuilder;
use tauri::{AppHandle, LogicalPosition, LogicalSize, Manager, RunEvent, WebviewUrl};

pub const UI: &str = "ui";

struct Launch {
    browser_only: bool,
    open: Option<String>,
}

fn parse_args(argv: impl IntoIterator<Item = String>) -> Launch {
    let mut launch = Launch { browser_only: false, open: None };
    let mut args = argv.into_iter().skip(1);
    while let Some(arg) = args.next() {
        match arg.as_str() {
            "--browser-only" => launch.browser_only = true,
            "--open" => launch.open = args.next(),
            _ => {}
        }
    }
    launch
}

#[tauri::command]
fn app_info(app: AppHandle, launch: tauri::State<Launch>) -> Value {
    let (_, shell) = pty::shell_line();
    json!({
        "version": env!("CARGO_PKG_VERSION"),
        "browser_only": launch.browser_only,
        "shell": shell,
        "herdr_installed": pty::find_herdr().is_some(),
        "memory_gb": sys::total_memory_gb(),
        "lite_below_gb": sys::LITE_BELOW_GB,
        "theme": sys::herdr_theme(),
        "browser": browser::snapshot(&app),
    })
}

#[tauri::command]
fn herdr_theme() -> Value {
    sys::herdr_theme()
}

/// Herdr workspaces and agents for the sidebar.
#[tauri::command]
async fn herdr_overview() -> Value {
    sys::herdr_overview()
}

/// Focuses a Herdr agent or workspace in the terminal.
#[tauri::command]
async fn herdr_focus(kind: String, id: String) -> Result<(), String> {
    let noun = match kind.as_str() {
        "agent" => "agent",
        "workspace" => "workspace",
        _ => return Err(format!("unknown kind {kind}")),
    };
    sys::herdr(&[noun, "focus", &id]).map(|_| ())
}

/// Opens the plugin's "connect agents" popup inside Herdr.
#[tauri::command]
async fn herdr_open_setup() -> Result<(), String> {
    sys::herdr(&["plugin", "pane", "open", "--plugin", "shellquarry.browser", "--entrypoint", "setup", "--focus"]).map(|_| ())
}

#[tauri::command]
fn pty_start(app: AppHandle, cols: u16, rows: u16) -> Result<(), String> {
    pty::start(&app, cols, rows)
}

#[tauri::command]
fn pty_write(app: AppHandle, data: String) -> Result<(), String> {
    pty::write(&app, &data)
}

#[tauri::command]
fn pty_resize(app: AppHandle, cols: u16, rows: u16) -> Result<(), String> {
    pty::resize(&app, cols, rows)
}

// Browser commands are async so they run off the main thread: creating and
// placing webviews waits on the main thread.

#[tauri::command]
async fn browser_set_open(app: AppHandle, open: bool) -> Result<(), String> {
    browser::set_open(&app, open)
}

/// Where the panel slot is, in logical pixels; null when it is not on screen.
#[tauri::command]
async fn browser_layout(app: AppHandle, rect: Option<(f64, f64, f64, f64)>) -> Result<(), String> {
    browser::set_rect(&app, rect)
}

#[tauri::command]
async fn browser_new_tab(app: AppHandle, url: Option<String>) -> Result<u32, String> {
    browser::new_tab(&app, url, true)
}

#[tauri::command]
async fn browser_select_tab(app: AppHandle, id: u32) -> Result<(), String> {
    browser::select_tab(&app, id)
}

#[tauri::command]
async fn browser_close_tab(app: AppHandle, id: u32) -> Result<(), String> {
    browser::close_tab(&app, id)
}

#[tauri::command]
async fn browser_navigate(app: AppHandle, url: String) -> Result<u32, String> {
    browser::navigate(&app, &url, None)
}

#[tauri::command]
async fn browser_history(app: AppHandle, action: String) -> Result<(), String> {
    browser::history(&app, &action)
}

#[tauri::command]
async fn browser_set_lite(app: AppHandle, lite: bool) -> Result<(), String> {
    browser::set_lite(&app, lite)
}

#[tauri::command]
fn browser_state(app: AppHandle) -> browser::Snapshot {
    browser::snapshot(&app)
}

/// The UI's theme colours, so new-tab pages match.
#[tauri::command]
fn set_page_colors(bg: String, text: String, muted: String) {
    sys::set_start_page_colors(bg, text, muted);
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let launch = parse_args(std::env::args());
    let cdp_port = control::free_port();
    let control_listener = TcpListener::bind("127.0.0.1:0").expect("control port");
    let session = control::Session {
        control_port: control_listener.local_addr().map(|a| a.port()).unwrap_or(0),
        cdp_port,
        token: control::random_token(),
    };
    // Every webview shares one WebView2 environment, so all get the same arguments.
    // The disable-features list is wry's default, which setting our own arguments replaces.
    let _ = browser::BROWSER_ARGS.set(format!(
        "--remote-debugging-port={cdp_port} --disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection"
    ));

    let app = tauri::Builder::default()
        // A second launch (say, the Herdr plugin opening a link) hands its
        // request to the running app and exits.
        .plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            let request = parse_args(argv);
            let app = app.clone();
            std::thread::spawn(move || {
                let _ = browser::set_open(&app, true);
                if let Some(url) = request.open {
                    let _ = browser::new_tab(&app, Some(url), true);
                }
                if let Some(w) = app.get_window("main") {
                    let _ = w.unminimize();
                    let _ = w.set_focus();
                }
            });
        }))
        .manage(pty::PtyState::default())
        .manage(browser::BrowserState(Default::default()))
        .invoke_handler(tauri::generate_handler![
            app_info,
            herdr_theme,
            herdr_overview,
            herdr_focus,
            herdr_open_setup,
            pty_start,
            pty_write,
            pty_resize,
            browser_set_open,
            browser_layout,
            browser_new_tab,
            browser_select_tab,
            browser_close_tab,
            browser_navigate,
            browser_history,
            browser_set_lite,
            browser_state,
            set_page_colors
        ])
        .setup(move |app| {
            let handle = app.handle().clone();
            browser::init(&handle, sys::default_lite(&handle));

            let (width, height) = if launch.browser_only { (960.0, 860.0) } else { (1400.0, 880.0) };
            let window = tauri::window::WindowBuilder::new(app, "main")
                .title(if launch.browser_only { "ShellQuarry browser" } else { "ShellQuarry" })
                .inner_size(width, height)
                .min_inner_size(if launch.browser_only { 480.0 } else { 900.0 }, 560.0)
                .center()
                .build()?;
            window.add_child(
                WebviewBuilder::new(UI, WebviewUrl::App("index.html".into()))
                    .additional_browser_args(browser::BROWSER_ARGS.get().unwrap())
                    .auto_resize(),
                LogicalPosition::new(0.0, 0.0),
                LogicalSize::new(width, height),
            )?;

            control::start(handle.clone(), control_listener.try_clone()?, session.token.clone());
            if let Err(e) = control::write_session(&handle, &session) {
                eprintln!("could not write session file: {e}");
            }

            if launch.browser_only || launch.open.is_some() {
                let url = launch.open.clone();
                let h = handle.clone();
                std::thread::spawn(move || {
                    let _ = browser::set_open(&h, true);
                    if let Some(url) = url {
                        let _ = browser::navigate(&h, &url, None);
                    }
                });
            }
            app.manage(launch);
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building ShellQuarry");

    app.run(|handle, event| {
        if let RunEvent::Exit = event {
            control::remove_session(handle);
        }
    });
}

//! ShellQuarry: one window with two webviews. "ui" draws the top bar and the
//! terminal; "browser" is the side panel agents drive over MCP. The terminal is
//! a real shell behind a pseudoterminal (portable-pty).
//!
//! Agents reach the browser panel through WebView2's DevTools port on
//! 127.0.0.1 (see mcp/server.mjs), so the app itself needs no MCP code.

use std::io::{Read, Write};
use std::sync::Mutex;

use portable_pty::{native_pty_system, Child, CommandBuilder, MasterPty, PtySize};
use serde::Serialize;
use tauri::webview::{PageLoadEvent, WebviewBuilder};
use tauri::{
    AppHandle, Emitter, EventTarget, LogicalPosition, LogicalSize, Manager, Rect, State, Url,
    WebviewUrl,
};

/// DevTools port for the browser panel. Chromium binds it to loopback only.
pub const CDP_PORT: u16 = 9333;

const UI: &str = "ui";
const BROWSER: &str = "browser";

struct Pty {
    writer: Box<dyn Write + Send>,
    master: Box<dyn MasterPty + Send>,
    _child: Box<dyn Child + Send + Sync>,
}

#[derive(Default)]
struct AppState {
    pty: Mutex<Option<Pty>>,
}

#[derive(Clone, Serialize)]
struct BrowserPage {
    url: String,
    loading: bool,
}

/// The shell to start: SHELLQUARRY_SHELL if set (e.g. "wsl.exe" to run Herdr),
/// otherwise PowerShell on Windows and $SHELL elsewhere.
fn shell_command() -> CommandBuilder {
    let line = std::env::var("SHELLQUARRY_SHELL").ok().filter(|s| !s.trim().is_empty());
    let line = line.unwrap_or_else(|| {
        if cfg!(windows) {
            "powershell.exe -NoLogo".into()
        } else {
            std::env::var("SHELL").unwrap_or_else(|_| "/bin/sh".into())
        }
    });
    let mut parts = line.split_whitespace();
    let mut cmd = CommandBuilder::new(parts.next().unwrap_or("powershell.exe"));
    cmd.args(parts);
    if let Some(home) = std::env::var_os("USERPROFILE").or_else(|| std::env::var_os("HOME")) {
        cmd.cwd(home);
    }
    cmd.env("TERM", "xterm-256color");
    cmd.env("COLORTERM", "truecolor");
    cmd.env("SHELLQUARRY_CDP_PORT", CDP_PORT.to_string());
    cmd
}

#[tauri::command]
fn pty_start(app: AppHandle, state: State<AppState>, cols: u16, rows: u16) -> Result<(), String> {
    let mut slot = state.pty.lock().unwrap();
    if slot.is_some() {
        return Ok(());
    }
    let pair = native_pty_system()
        .openpty(PtySize { rows, cols, pixel_width: 0, pixel_height: 0 })
        .map_err(|e| e.to_string())?;
    let child = pair.slave.spawn_command(shell_command()).map_err(|e| e.to_string())?;
    drop(pair.slave);
    let mut reader = pair.master.try_clone_reader().map_err(|e| e.to_string())?;
    let writer = pair.master.take_writer().map_err(|e| e.to_string())?;

    std::thread::spawn(move || {
        let mut buf = [0u8; 16 * 1024];
        // Bytes of a UTF-8 character split across two reads.
        let mut carry: Vec<u8> = Vec::new();
        loop {
            match reader.read(&mut buf) {
                Ok(0) | Err(_) => break,
                Ok(n) => {
                    carry.extend_from_slice(&buf[..n]);
                    let (text, rest) = match std::str::from_utf8(&carry) {
                        Ok(s) => (s.to_string(), Vec::new()),
                        Err(e) if e.error_len().is_none() => {
                            let cut = e.valid_up_to();
                            (String::from_utf8_lossy(&carry[..cut]).into_owned(), carry[cut..].to_vec())
                        }
                        Err(_) => (String::from_utf8_lossy(&carry).into_owned(), Vec::new()),
                    };
                    carry = rest;
                    if !text.is_empty() {
                        let _ = app.emit_to(EventTarget::webview(UI), "pty-data", text);
                    }
                }
            }
        }
        let _ = app.emit_to(EventTarget::webview(UI), "pty-exit", ());
        if let Some(state) = app.try_state::<AppState>() {
            state.pty.lock().unwrap().take();
        }
    });

    *slot = Some(Pty { writer, master: pair.master, _child: child });
    Ok(())
}

#[tauri::command]
fn pty_write(state: State<AppState>, data: String) -> Result<(), String> {
    match state.pty.lock().unwrap().as_mut() {
        Some(pty) => pty.writer.write_all(data.as_bytes()).map_err(|e| e.to_string()),
        None => Err("terminal is not running".into()),
    }
}

#[tauri::command]
fn pty_resize(state: State<AppState>, cols: u16, rows: u16) -> Result<(), String> {
    if let Some(pty) = state.pty.lock().unwrap().as_ref() {
        pty.master
            .resize(PtySize { rows, cols, pixel_width: 0, pixel_height: 0 })
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Places the browser panel over the UI's empty slot (logical pixels), or hides it.
#[tauri::command]
fn browser_layout(app: AppHandle, visible: bool, x: f64, y: f64, width: f64, height: f64) -> Result<(), String> {
    let webview = app.get_webview(BROWSER).ok_or("browser panel missing")?;
    if !visible || width < 1.0 || height < 1.0 {
        return webview.hide().map_err(|e| e.to_string());
    }
    webview
        .set_bounds(Rect {
            position: LogicalPosition::new(x, y).into(),
            size: LogicalSize::new(width, height).into(),
        })
        .map_err(|e| e.to_string())?;
    webview.show().map_err(|e| e.to_string())
}

#[tauri::command]
fn browser_navigate(app: AppHandle, url: String) -> Result<(), String> {
    let url = url.trim();
    let url = if url.contains("://") || url.starts_with("about:") { url.to_string() } else { format!("https://{url}") };
    let parsed: Url = url.parse().map_err(|_| format!("not a valid address: {url}"))?;
    app.get_webview(BROWSER).ok_or("browser panel missing")?.navigate(parsed).map_err(|e| e.to_string())
}

/// Back, forward or reload in the browser panel.
#[tauri::command]
fn browser_history(app: AppHandle, action: String) -> Result<(), String> {
    let script = match action.as_str() {
        "back" => "history.back()",
        "forward" => "history.forward()",
        "reload" => "location.reload()",
        _ => return Err(format!("unknown action {action}")),
    };
    app.get_webview(BROWSER).ok_or("browser panel missing")?.eval(script).map_err(|e| e.to_string())
}

/// What the browser panel shows before anyone navigates.
fn start_page() -> Url {
    const HTML: &str = "<!doctype html><title>New tab</title><body style=\"margin:0;height:100vh;display:grid;\
place-items:center;background:#0d0f14;color:#8b93a5;font:14px 'Segoe UI',system-ui,sans-serif\">\
<div style=\"text-align:center\"><div style=\"font-size:15px;color:#e6e9ef;margin-bottom:6px\">Agent browser</div>\
Type an address above, or ask your agent to open a page.</div></body>";
    let encoded: String = HTML
        .bytes()
        .map(|b| match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'.' | b'_' | b'~' => (b as char).to_string(),
            _ => format!("%{b:02X}"),
        })
        .collect();
    format!("data:text/html;charset=utf-8,{encoded}").parse().expect("start page URL")
}

#[tauri::command]
fn cdp_port() -> u16 {
    CDP_PORT
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Both webviews share one WebView2 environment, so they must get the same arguments.
    // The disable-features list is wry's default, which setting our own arguments replaces.
    let browser_args = format!(
        "--remote-debugging-port={CDP_PORT} --disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection"
    );

    tauri::Builder::default()
        .manage(AppState::default())
        .invoke_handler(tauri::generate_handler![
            pty_start,
            pty_write,
            pty_resize,
            browser_layout,
            browser_navigate,
            browser_history,
            cdp_port
        ])
        .setup(move |app| {
            let (width, height) = (1360.0, 860.0);
            let window = tauri::window::WindowBuilder::new(app, "main")
                .title("ShellQuarry")
                .inner_size(width, height)
                .min_inner_size(960.0, 600.0)
                .theme(Some(tauri::Theme::Dark))
                .center()
                .build()?;

            window.add_child(
                WebviewBuilder::new(UI, WebviewUrl::App("index.html".into()))
                    .additional_browser_args(&browser_args)
                    .auto_resize(),
                LogicalPosition::new(0.0, 0.0),
                LogicalSize::new(width, height),
            )?;

            let handle = app.handle().clone();
            let browser = window.add_child(
                WebviewBuilder::new(BROWSER, WebviewUrl::External(start_page()))
                    .additional_browser_args(&browser_args)
                    .on_page_load(move |_webview, payload| {
                        let page = BrowserPage {
                            url: payload.url().to_string(),
                            loading: matches!(payload.event(), PageLoadEvent::Started),
                        };
                        let _ = handle.emit_to(EventTarget::webview(UI), "browser-page", page);
                    }),
                LogicalPosition::new(width, 0.0),
                LogicalSize::new(1.0, 1.0),
            )?;
            browser.hide()?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running ShellQuarry");
}

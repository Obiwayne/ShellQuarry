//! Local control API for the Herdr plugin and the MCP server.
//!
//! A tiny HTTP server on 127.0.0.1 at a random port. Every request needs the
//! session token; requests from web pages (an Origin header) and with a foreign
//! Host header are refused. The port, token and DevTools port are written to
//! session.json in the app's local data folder, which only this Windows user
//! can read, and the file is removed when the app exits.

use std::io::{BufRead, BufReader, Read, Write};
use std::net::{TcpListener, TcpStream};
use std::path::PathBuf;

use serde::Serialize;
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, EventTarget, Manager};

use crate::browser;

pub struct Session {
    pub control_port: u16,
    pub cdp_port: u16,
    pub token: String,
}

#[derive(Serialize)]
struct SessionFile<'a> {
    pid: u32,
    version: &'a str,
    control_url: String,
    cdp_url: String,
    token: &'a str,
    exe: String,
}

pub fn random_token() -> String {
    let mut bytes = [0u8; 32];
    getrandom::fill(&mut bytes).expect("system random number generator");
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

/// A free loopback port, picked by binding port 0 and releasing it.
pub fn free_port() -> u16 {
    TcpListener::bind("127.0.0.1:0").and_then(|l| l.local_addr()).map(|a| a.port()).unwrap_or(9333)
}

pub fn data_dir(app: &AppHandle) -> PathBuf {
    app.path().app_local_data_dir().unwrap_or_else(|_| std::env::temp_dir().join("ShellQuarry"))
}

pub fn session_path(app: &AppHandle) -> PathBuf {
    data_dir(app).join("session.json")
}

pub fn write_session(app: &AppHandle, s: &Session) -> std::io::Result<()> {
    let dir = data_dir(app);
    std::fs::create_dir_all(&dir)?;
    let exe = std::env::current_exe().map(|p| p.display().to_string()).unwrap_or_default();
    let file = SessionFile {
        pid: std::process::id(),
        version: env!("CARGO_PKG_VERSION"),
        control_url: format!("http://127.0.0.1:{}", s.control_port),
        cdp_url: format!("http://127.0.0.1:{}", s.cdp_port),
        token: &s.token,
        exe: exe.clone(),
    };
    std::fs::write(session_path(app), serde_json::to_vec_pretty(&file).unwrap())?;
    // Kept after exit so the Herdr plugin can find the app to start it.
    std::fs::write(dir.join("install.json"), serde_json::to_vec_pretty(&json!({ "exe": exe })).unwrap())
}

/// Removes session.json, but only if this process wrote it.
pub fn remove_session(app: &AppHandle) {
    let path = session_path(app);
    let ours = std::fs::read(&path)
        .ok()
        .and_then(|b| serde_json::from_slice::<Value>(&b).ok())
        .and_then(|v| v.get("pid").and_then(Value::as_u64))
        == Some(std::process::id() as u64);
    if ours {
        let _ = std::fs::remove_file(path);
    }
}

pub fn start(app: AppHandle, listener: TcpListener, token: String) {
    let port = listener.local_addr().map(|a| a.port()).unwrap_or(0);
    std::thread::spawn(move || {
        for stream in listener.incoming().flatten() {
            let app = app.clone();
            let token = token.clone();
            std::thread::spawn(move || {
                let _ = handle(&app, stream, &token, port);
            });
        }
    });
}

fn respond(stream: &mut TcpStream, status: u16, body: &Value) -> std::io::Result<()> {
    let text = body.to_string();
    let reason = match status { 200 => "OK", 400 => "Bad Request", 401 => "Unauthorized", 403 => "Forbidden", 404 => "Not Found", _ => "Error" };
    write!(
        stream,
        "HTTP/1.1 {status} {reason}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{text}",
        text.len()
    )
}

/// Compares without stopping at the first difference.
fn same(a: &str, b: &str) -> bool {
    a.len() == b.len() && a.bytes().zip(b.bytes()).fold(0u8, |acc, (x, y)| acc | (x ^ y)) == 0
}

fn handle(app: &AppHandle, mut stream: TcpStream, token: &str, port: u16) -> std::io::Result<()> {
    stream.set_read_timeout(Some(std::time::Duration::from_secs(5)))?;
    let mut reader = BufReader::new(stream.try_clone()?);
    let mut line = String::new();
    reader.read_line(&mut line)?;
    let mut parts = line.split_whitespace();
    let method = parts.next().unwrap_or("").to_string();
    let path = parts.next().unwrap_or("").to_string();

    let (mut length, mut auth, mut host, mut origin) = (0usize, String::new(), String::new(), false);
    loop {
        let mut header = String::new();
        if reader.read_line(&mut header)? == 0 || header == "\r\n" || header == "\n" {
            break;
        }
        let (name, value) = header.split_once(':').unwrap_or((&header, ""));
        let value = value.trim();
        match name.trim().to_ascii_lowercase().as_str() {
            "content-length" => length = value.parse().unwrap_or(0).min(64 * 1024),
            "authorization" => auth = value.to_string(),
            "host" => host = value.to_string(),
            "origin" => origin = true,
            _ => {}
        }
    }
    let mut body = vec![0u8; length];
    reader.read_exact(&mut body)?;

    if origin || !(host == format!("127.0.0.1:{port}") || host == format!("localhost:{port}")) {
        return respond(&mut stream, 403, &json!({ "error": "forbidden" }));
    }
    if !same(auth.strip_prefix("Bearer ").unwrap_or(""), token) {
        return respond(&mut stream, 401, &json!({ "error": "bad token" }));
    }
    let args: Value = if body.is_empty() { json!({}) } else { serde_json::from_slice(&body).unwrap_or(json!({})) };

    let result = route(app, &method, &path, &args);
    match result {
        Ok(value) => respond(&mut stream, 200, &value),
        Err((status, message)) => respond(&mut stream, status, &json!({ "error": message })),
    }
}

fn tab_arg(args: &Value) -> Option<u32> {
    args.get("tab").and_then(Value::as_u64).map(|t| t as u32)
}

fn focus(app: &AppHandle) {
    if let Some(w) = app.get_window("main") {
        let _ = w.unminimize();
        let _ = w.show();
        let _ = w.set_focus();
    }
}

fn route(app: &AppHandle, method: &str, path: &str, args: &Value) -> Result<Value, (u16, String)> {
    let bad = |e: String| (400, e);
    let url = args.get("url").and_then(Value::as_str).map(str::to_string);
    let state = || serde_json::to_value(browser::snapshot(app)).unwrap();
    match (method, path) {
        ("GET", "/status") => Ok(json!({ "app": "shellquarry", "version": env!("CARGO_PKG_VERSION"), "browser": state() })),
        // Opens the panel (and the address, if given) and brings the window forward.
        ("POST", "/open") => {
            browser::set_open(app, true).map_err(bad)?;
            if let Some(url) = url {
                if args.get("new_tab").and_then(Value::as_bool).unwrap_or(false) {
                    browser::new_tab(app, Some(url), true).map_err(bad)?;
                } else {
                    browser::navigate(app, &url, tab_arg(args)).map_err(bad)?;
                }
            }
            focus(app);
            Ok(state())
        }
        ("POST", "/close") => {
            browser::set_open(app, false).map_err(bad)?;
            Ok(state())
        }
        ("POST", "/navigate") => {
            let url = url.ok_or((400, "url is required".to_string()))?;
            let id = browser::navigate(app, &url, tab_arg(args)).map_err(bad)?;
            Ok(json!({ "tab": id, "browser": state() }))
        }
        ("POST", "/tabs/new") => {
            browser::set_open(app, true).map_err(bad)?;
            let id = browser::new_tab(app, url, true).map_err(bad)?;
            Ok(json!({ "tab": id, "browser": state() }))
        }
        ("POST", "/tabs/select") => {
            let id = tab_arg(args).ok_or((400, "tab is required".to_string()))?;
            browser::set_open(app, true).map_err(bad)?;
            browser::select_tab(app, id).map_err(bad)?;
            Ok(state())
        }
        ("POST", "/tabs/close") => {
            let id = tab_arg(args).ok_or((400, "tab is required".to_string()))?;
            browser::close_tab(app, id).map_err(bad)?;
            Ok(state())
        }
        // Shows what an agent is doing in the top bar.
        ("POST", "/activity") => {
            let label = args.get("label").and_then(Value::as_str).unwrap_or("browsing").to_string();
            let _ = app.emit_to(EventTarget::webview(crate::UI), "agent-activity", label);
            Ok(json!({ "ok": true }))
        }
        ("POST", "/focus") => {
            focus(app);
            Ok(json!({ "ok": true }))
        }
        _ => Err((404, format!("no route {method} {path}"))),
    }
}

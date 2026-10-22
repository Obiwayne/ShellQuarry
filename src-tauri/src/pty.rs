//! The terminal: a shell behind a pseudoterminal, streamed to xterm.js.
//! Starts Herdr when it is installed, otherwise PowerShell.

use std::io::{Read, Write};
use std::path::PathBuf;
use std::sync::Mutex;

use portable_pty::{native_pty_system, ChildKiller, CommandBuilder, MasterPty, PtySize};
use tauri::{AppHandle, Emitter, EventTarget, Manager};

pub struct Pty {
    writer: Box<dyn Write + Send>,
    master: Box<dyn MasterPty + Send>,
    _killer: Box<dyn ChildKiller + Send + Sync>,
}

#[derive(Default)]
pub struct PtyState(pub Mutex<Option<Pty>>);

/// Herdr on PATH, or where its Windows installer puts it.
pub fn find_herdr() -> Option<PathBuf> {
    let exe = if cfg!(windows) { "herdr.exe" } else { "herdr" };
    if let Some(path) = std::env::var_os("PATH") {
        for dir in std::env::split_paths(&path) {
            let candidate = dir.join(exe);
            if candidate.is_file() {
                return Some(candidate);
            }
        }
    }
    let local = std::env::var_os("LOCALAPPDATA")?;
    let candidate = PathBuf::from(local).join("Programs").join("Herdr").join("bin").join(exe);
    candidate.is_file().then_some(candidate)
}

/// The command line to run: SHELLQUARRY_SHELL if set, then Herdr, then the default shell.
pub fn shell_line() -> (String, String) {
    if let Some(line) = std::env::var("SHELLQUARRY_SHELL").ok().filter(|s| !s.trim().is_empty()) {
        let name = line.split_whitespace().next().unwrap_or("shell").to_string();
        return (line, name);
    }
    if let Some(herdr) = find_herdr() {
        return (format!("\"{}\"", herdr.display()), "herdr".into());
    }
    if cfg!(windows) {
        ("powershell.exe -NoLogo".into(), "powershell".into())
    } else {
        let sh = std::env::var("SHELL").unwrap_or_else(|_| "/bin/sh".into());
        (sh.clone(), sh)
    }
}

fn command(line: &str, herdr_config: Option<PathBuf>) -> CommandBuilder {
    // A quoted first word is a path with spaces.
    let (program, rest) = if let Some(stripped) = line.strip_prefix('"') {
        let end = stripped.find('"').unwrap_or(stripped.len());
        (stripped[..end].to_string(), stripped[(end + 1).min(stripped.len())..].to_string())
    } else {
        let mut it = line.splitn(2, char::is_whitespace);
        (it.next().unwrap_or("").to_string(), it.next().unwrap_or("").to_string())
    };
    let mut cmd = CommandBuilder::new(program);
    cmd.args(rest.split_whitespace());
    if let Some(home) = std::env::var_os("USERPROFILE").or_else(|| std::env::var_os("HOME")) {
        cmd.cwd(home);
    }
    // If this app was started from inside Herdr (by the plugin), drop Herdr's
    // pane variables so the terminal can start its own Herdr client.
    for (key, _) in std::env::vars_os() {
        if key.to_string_lossy().starts_with("HERDR_") {
            cmd.env_remove(key);
        }
    }
    if let Some(path) = herdr_config {
        cmd.env("HERDR_CONFIG_PATH", path);
    }
    cmd.env("TERM", "xterm-256color");
    cmd.env("COLORTERM", "truecolor");
    cmd.env("TERM_PROGRAM", "ShellQuarry");
    cmd
}

pub fn start(app: &AppHandle, cols: u16, rows: u16) -> Result<(), String> {
    let st = app.state::<PtyState>();
    let mut slot = st.0.lock().unwrap();
    if slot.is_some() {
        return Ok(());
    }
    let pair = native_pty_system()
        .openpty(PtySize { rows, cols, pixel_width: 0, pixel_height: 0 })
        .map_err(|e| e.to_string())?;
    let (line, shell) = shell_line();
    let herdr_config = (shell == "herdr").then(|| crate::sys::herdr_client_config(app)).flatten();
    let mut child = pair.slave.spawn_command(command(&line, herdr_config)).map_err(|e| format!("{line}: {e}"))?;
    drop(pair.slave);
    let mut reader = pair.master.try_clone_reader().map_err(|e| e.to_string())?;
    let writer = pair.master.take_writer().map_err(|e| e.to_string())?;

    let reader_app = app.clone();
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
                        let _ = reader_app.emit_to(EventTarget::webview(crate::UI), "pty-data", text);
                    }
                }
            }
        }
    });

    // ConPTY keeps the output pipe open after the shell exits, so watch the
    // process itself. Dropping the Pty closes the pseudoterminal and the reader.
    let killer = child.clone_killer();
    let app = app.clone();
    std::thread::spawn(move || {
        let _ = child.wait();
        app.state::<PtyState>().0.lock().unwrap().take();
        let _ = app.emit_to(EventTarget::webview(crate::UI), "pty-exit", ());
    });

    *slot = Some(Pty { writer, master: pair.master, _killer: killer });
    Ok(())
}

pub fn write(app: &AppHandle, data: &str) -> Result<(), String> {
    match app.state::<PtyState>().0.lock().unwrap().as_mut() {
        Some(pty) => pty.writer.write_all(data.as_bytes()).map_err(|e| e.to_string()),
        None => Err("terminal is not running".into()),
    }
}

pub fn resize(app: &AppHandle, cols: u16, rows: u16) -> Result<(), String> {
    if let Some(pty) = app.state::<PtyState>().0.lock().unwrap().as_ref() {
        pty.master
            .resize(PtySize { rows, cols, pixel_width: 0, pixel_height: 0 })
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

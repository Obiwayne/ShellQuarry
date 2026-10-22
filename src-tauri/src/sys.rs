//! Machine and user settings: installed memory (for lite mode), the Herdr
//! theme config, and ShellQuarry's own saved settings.

use std::path::PathBuf;
use std::sync::Mutex;

use serde_json::{json, Value};
use tauri::AppHandle;

/// Machines below this much memory start in lite mode.
pub const LITE_BELOW_GB: f64 = 12.0;

/// Background, text and muted colours for the new-tab page, set by the UI's theme.
static START_COLORS: Mutex<(String, String, String)> = Mutex::new((String::new(), String::new(), String::new()));

pub fn set_start_page_colors(bg: String, text: String, muted: String) {
    *START_COLORS.lock().unwrap() = (bg, text, muted);
}

pub fn start_page_colors() -> (String, String, String) {
    let c = START_COLORS.lock().unwrap().clone();
    if c.0.is_empty() {
        ("#1e1e2e".into(), "#cdd6f4".into(), "#6c7086".into())
    } else {
        c
    }
}

/// Installed memory in GB, or None when unknown.
#[cfg(windows)]
pub fn total_memory_gb() -> Option<f64> {
    use windows_sys::Win32::System::SystemInformation::{GlobalMemoryStatusEx, MEMORYSTATUSEX};
    let mut status: MEMORYSTATUSEX = unsafe { std::mem::zeroed() };
    status.dwLength = std::mem::size_of::<MEMORYSTATUSEX>() as u32;
    let ok = unsafe { GlobalMemoryStatusEx(&mut status) };
    (ok != 0).then(|| status.ullTotalPhys as f64 / (1024.0 * 1024.0 * 1024.0))
}

#[cfg(not(windows))]
pub fn total_memory_gb() -> Option<f64> {
    None
}

/// Herdr's config.toml: %APPDATA%\herdr on Windows, ~/.config/herdr elsewhere.
fn herdr_config_path() -> Option<PathBuf> {
    if cfg!(windows) {
        std::env::var_os("APPDATA").map(|d| PathBuf::from(d).join("herdr").join("config.toml"))
    } else {
        std::env::var_os("XDG_CONFIG_HOME")
            .map(PathBuf::from)
            .or_else(|| std::env::var_os("HOME").map(|h| PathBuf::from(h).join(".config")))
            .map(|d| d.join("herdr").join("config.toml"))
    }
}

/// The [theme] table from Herdr's config, as JSON (empty when there is none).
pub fn herdr_theme() -> Value {
    let Some(text) = herdr_config_path().and_then(|p| std::fs::read_to_string(p).ok()) else {
        return json!({});
    };
    let Ok(config) = text.parse::<toml::Table>() else {
        return json!({});
    };
    config
        .get("theme")
        .and_then(|t| serde_json::to_value(t).ok())
        .unwrap_or_else(|| json!({}))
}

/// Runs the Herdr CLI and returns its JSON "result", without flashing a console window.
pub fn herdr(args: &[&str]) -> Result<Value, String> {
    let exe = crate::pty::find_herdr().ok_or("Herdr is not installed")?;
    let mut cmd = std::process::Command::new(exe);
    cmd.args(args);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    let out = cmd.output().map_err(|e| e.to_string())?;
    let value: Value = serde_json::from_slice(&out.stdout)
        .map_err(|_| String::from_utf8_lossy(&out.stderr).trim().to_string())?;
    match value.get("error") {
        Some(err) => Err(err.get("message").and_then(Value::as_str).unwrap_or("Herdr error").to_string()),
        None => Ok(value.get("result").cloned().unwrap_or(Value::Null)),
    }
}

/// Workspaces and agents for the sidebar; empty lists when Herdr isn't running.
pub fn herdr_overview() -> Value {
    let list = |args: &[&str], key: &str| {
        herdr(args).ok().and_then(|r| r.get(key).cloned()).unwrap_or_else(|| json!([]))
    };
    json!({
        "installed": crate::pty::find_herdr().is_some(),
        "workspaces": list(&["workspace", "list"], "workspaces"),
        "agents": list(&["agent", "list"], "agents"),
    })
}

fn settings_path(app: &AppHandle) -> PathBuf {
    crate::control::data_dir(app).join("settings.json")
}

/// Saved lite-mode choice, if the user has made one.
pub fn saved_lite(app: &AppHandle) -> Option<bool> {
    let text = std::fs::read_to_string(settings_path(app)).ok()?;
    serde_json::from_str::<Value>(&text).ok()?.get("lite")?.as_bool()
}

pub fn save_settings(app: &AppHandle, lite: bool) {
    let path = settings_path(app);
    if let Some(dir) = path.parent() {
        let _ = std::fs::create_dir_all(dir);
    }
    let _ = std::fs::write(path, serde_json::to_vec_pretty(&json!({ "lite": lite })).unwrap());
}

/// Lite mode when the user chose it, or by default on machines with little memory.
pub fn default_lite(app: &AppHandle) -> bool {
    saved_lite(app).unwrap_or_else(|| total_memory_gb().is_some_and(|gb| gb < LITE_BELOW_GB))
}

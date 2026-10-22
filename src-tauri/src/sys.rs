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

/// A table from Herdr's config ("theme", "keys"), as JSON (empty when there is none).
pub fn herdr_config_table(name: &str) -> Value {
    let Some(text) = herdr_config_path().and_then(|p| std::fs::read_to_string(p).ok()) else {
        return json!({});
    };
    let Ok(config) = text.parse::<toml::Table>() else {
        return json!({});
    };
    config
        .get(name)
        .and_then(|t| serde_json::to_value(t).ok())
        .unwrap_or_else(|| json!({}))
}

pub fn herdr_theme() -> Value {
    herdr_config_table("theme")
}

fn settings_path(app: &AppHandle) -> PathBuf {
    crate::control::data_dir(app).join("settings.json")
}

fn settings(app: &AppHandle) -> Value {
    std::fs::read_to_string(settings_path(app))
        .ok()
        .and_then(|text| serde_json::from_str::<Value>(&text).ok())
        .filter(Value::is_object)
        .unwrap_or_else(|| json!({}))
}

/// Saves one setting, keeping the others.
pub fn save_setting(app: &AppHandle, key: &str, value: Value) {
    let path = settings_path(app);
    if let Some(dir) = path.parent() {
        let _ = std::fs::create_dir_all(dir);
    }
    let mut all = settings(app);
    all[key] = value;
    let _ = std::fs::write(path, serde_json::to_vec_pretty(&all).unwrap());
}

/// Saved lite-mode choice, if the user has made one.
pub fn saved_lite(app: &AppHandle) -> Option<bool> {
    settings(app).get("lite")?.as_bool()
}

/// Whether Herdr draws its own sidebar rail and single-tab row inside the
/// terminal. Off by default: ShellQuarry's sidebar and toolbar show the same things.
pub fn herdr_chrome(app: &AppHandle) -> bool {
    settings(app).get("herdr_chrome").and_then(Value::as_bool).unwrap_or(false)
}

/// Herdr settings that hide what ShellQuarry already shows around the terminal.
/// The tab row is always drawn on the top line so the UI can clip it away (see app.js);
/// Herdr has no setting to hide it once there are two tabs.
const CLEAN_UI: [(&str, bool); 3] = [
    ("sidebar_start_collapsed", true),
    ("hide_tab_bar_when_single_tab", false),
    ("pane_outer_borders", false),
];

/// A copy of the user's Herdr config with the duplicate chrome turned off, for
/// the Herdr client in ShellQuarry's terminal (passed as HERDR_CONFIG_PATH).
/// Herdr in other terminals keeps using the user's own file.
pub fn herdr_client_config(app: &AppHandle) -> Option<PathBuf> {
    if herdr_chrome(app) {
        return None;
    }
    let user = herdr_config_path()
        .and_then(|p| std::fs::read_to_string(p).ok())
        .unwrap_or_default();
    let mut config = user.parse::<toml::Table>().ok()?;
    let path = crate::control::data_dir(app).join("herdr-config.toml");
    // Herdr writes onboarding = false once its first-run screen is done; keep that.
    let previous = std::fs::read_to_string(&path).ok().and_then(|t| t.parse::<toml::Table>().ok());
    if let Some(done) = previous.as_ref().and_then(|t| t.get("onboarding")) {
        config.entry("onboarding").or_insert(done.clone());
    }
    let ui = config.entry("ui").or_insert_with(|| toml::Value::Table(Default::default()));
    let ui = ui.as_table_mut()?;
    for (key, value) in CLEAN_UI {
        ui.insert(key.into(), toml::Value::Boolean(value));
    }
    ui.insert("sidebar_collapsed_mode".into(), toml::Value::String("hidden".into()));
    ui.insert("tab_bar_position".into(), toml::Value::String("top".into()));
    // The narrow single-column layout has no tab row on top to clip.
    ui.insert("mobile_width_threshold".into(), toml::Value::Integer(0));
    std::fs::create_dir_all(path.parent()?).ok()?;
    std::fs::write(&path, toml::to_string(&config).ok()?).ok()?;
    Some(path)
}

/// Lite mode when the user chose it, or by default on machines with little memory.
pub fn default_lite(app: &AppHandle) -> bool {
    saved_lite(app).unwrap_or_else(|| total_memory_gb().is_some_and(|gb| gb < LITE_BELOW_GB))
}

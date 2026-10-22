//! Plan usage for the agents you run: how much of the 5-hour and weekly limits is used.
//!
//! Codex saves its limits in each session file (~/.codex/sessions/**/rollout-*.jsonl,
//! "rate_limits"). Claude Code doesn't save them, but hands them to its status line, so
//! agents started from ShellQuarry get a status line that is ShellQuarry itself
//! (`shellquarry.exe --statusline`): it saves the numbers, then runs your own status
//! line, if you have one, and prints what it prints.

use std::io::{Read, Write};
use std::path::{Path, PathBuf};

use serde_json::{json, Value};

fn home() -> Option<PathBuf> {
    std::env::var_os("USERPROFILE").or_else(|| std::env::var_os("HOME")).map(PathBuf::from)
}

const CLAUDE_FILE: &str = "usage-claude.json";

/// The app's data folder for `id`, found without Tauri (the status line runs on its own).
fn data_dir_for(id: &str) -> Option<PathBuf> {
    let base = if cfg!(windows) {
        std::env::var_os("LOCALAPPDATA").map(PathBuf::from)?
    } else {
        home()?.join(".local").join("share")
    };
    Some(base.join(id))
}

/// Settings for a Claude Code agent started from ShellQuarry: the status line above.
pub fn claude_settings(data_dir: &Path) -> Option<PathBuf> {
    let exe = std::env::current_exe().ok()?;
    let id = data_dir.file_name()?.to_string_lossy().into_owned();
    let settings = json!({
        "statusLine": { "type": "command", "command": format!("\"{}\" --statusline {id}", exe.display()), "padding": 0 }
    });
    let path = data_dir.join("agent-settings.json");
    std::fs::create_dir_all(data_dir).ok()?;
    std::fs::write(&path, settings.to_string()).ok()?;
    Some(path)
}

/// `shellquarry.exe --statusline <app id>`: run by Claude Code with the status JSON on stdin.
pub fn statusline(app_id: Option<&str>) {
    let mut input = String::new();
    let _ = std::io::stdin().read_to_string(&mut input);
    let file = data_dir_for(app_id.unwrap_or("dev.repoquarry.shellquarry")).map(|d| d.join(CLAUDE_FILE));
    if let (Ok(status), Some(file)) = (serde_json::from_str::<Value>(&input), file) {
        if let Some(limits) = status.get("rate_limits").filter(|l| !l.is_null()) {
            let saved = json!({ "rate_limits": limits, "saved_at": now() });
            if let Some(dir) = file.parent() {
                let _ = std::fs::create_dir_all(dir);
            }
            let _ = std::fs::write(&file, saved.to_string());
        }
    }
    let own = own_statusline(&input);
    let line = own.unwrap_or_else(|| default_line(&input));
    let _ = std::io::stdout().write_all(line.as_bytes());
}

fn now() -> u64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0)
}

/// The user's own status line from ~/.claude/settings.json, run with the same input.
fn own_statusline(input: &str) -> Option<String> {
    let settings: Value = serde_json::from_str(&std::fs::read_to_string(home()?.join(".claude").join("settings.json")).ok()?).ok()?;
    let command = settings.pointer("/statusLine/command")?.as_str()?.to_string();
    let mut cmd = if cfg!(windows) {
        let mut c = std::process::Command::new("cmd.exe");
        c.args(["/d", "/s", "/c", &command]);
        c
    } else {
        let mut c = std::process::Command::new("sh");
        c.args(["-c", &command]);
        c
    };
    let mut child = cmd.stdin(std::process::Stdio::piped()).stdout(std::process::Stdio::piped()).spawn().ok()?;
    child.stdin.take()?.write_all(input.as_bytes()).ok()?;
    let out = child.wait_with_output().ok()?;
    Some(String::from_utf8_lossy(&out.stdout).into_owned())
}

/// Without a status line of your own: the model and folder, as Claude Code shows by default.
fn default_line(input: &str) -> String {
    let v: Value = serde_json::from_str(input).unwrap_or_default();
    let model = v.pointer("/model/display_name").and_then(Value::as_str).unwrap_or("");
    let dir = v.pointer("/workspace/current_dir").and_then(Value::as_str).unwrap_or("");
    [model, dir].iter().filter(|s| !s.is_empty()).cloned().collect::<Vec<_>>().join(" · ")
}

/// One limit window, as the UI shows it.
fn window(used: Option<f64>, resets_at: Option<u64>) -> Value {
    match used {
        Some(u) => json!({ "used": u.clamp(0.0, 100.0), "resets_at": resets_at }),
        None => Value::Null,
    }
}

fn claude(data_dir: &Path) -> Option<Value> {
    let saved: Value = serde_json::from_str(&std::fs::read_to_string(data_dir.join(CLAUDE_FILE)).ok()?).ok()?;
    let limits = saved.get("rate_limits")?;
    let pick = |name: &str| {
        let w = limits.get(name)?;
        let used = w.get("used_percentage").or_else(|| w.get("used_percent")).and_then(Value::as_f64);
        let resets = w.get("resets_at").and_then(|r| r.as_u64().or_else(|| r.as_str().and_then(parse_time)));
        Some(window(used, resets))
    };
    Some(json!({
        "kind": "claude",
        "five_hour": pick("five_hour").unwrap_or(Value::Null),
        "weekly": pick("seven_day").unwrap_or(Value::Null),
        "saved_at": saved.get("saved_at"),
    }))
}

/// ISO-8601 times ("2026-10-22T18:00:00Z") as seconds since 1970, for the few formats seen.
fn parse_time(s: &str) -> Option<u64> {
    let s = s.trim_end_matches('Z');
    let (date, time) = s.split_once('T')?;
    let mut d = date.split('-').map(|p| p.parse::<i64>().ok());
    let (y, m, day) = (d.next()??, d.next()??, d.next()??);
    let time = time.split(['+', '.']).next()?;
    let mut t = time.split(':').map(|p| p.parse::<i64>().ok());
    let (h, min, sec) = (t.next()??, t.next()??, t.next().flatten().unwrap_or(0));
    // Days from civil date (Howard Hinnant's algorithm).
    let y2 = if m <= 2 { y - 1 } else { y };
    let era = y2.div_euclid(400);
    let yoe = y2 - era * 400;
    let doy = (153 * (m + if m > 2 { -3 } else { 9 }) + 2) / 5 + day - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    let days = era * 146_097 + doe - 719_468;
    u64::try_from(days * 86_400 + h * 3600 + min * 60 + sec).ok()
}

fn codex_files(dir: &Path, out: &mut Vec<PathBuf>) {
    for entry in std::fs::read_dir(dir).into_iter().flatten().flatten() {
        let path = entry.path();
        if path.is_dir() {
            codex_files(&path, out);
        } else if path.extension().is_some_and(|e| e == "jsonl") {
            out.push(path);
        }
    }
}

fn codex() -> Option<Value> {
    let mut files = Vec::new();
    codex_files(&home()?.join(".codex").join("sessions"), &mut files);
    let newest = files
        .into_iter()
        .filter_map(|p| Some((std::fs::metadata(&p).ok()?.modified().ok()?, p)))
        .max_by_key(|(t, _)| *t)?
        .1;
    let text = std::fs::read_to_string(newest).ok()?;
    let line = text.lines().rev().find(|l| l.contains("\"rate_limits\""))?;
    let v: Value = serde_json::from_str(line).ok()?;
    let limits = find_key(&v, "rate_limits")?;
    let pick = |name: &str| {
        let w = limits.get(name)?;
        Some(window(w.get("used_percent").and_then(Value::as_f64), w.get("resets_at").and_then(Value::as_u64)))
    };
    Some(json!({
        "kind": "codex",
        "five_hour": pick("primary").unwrap_or(Value::Null),
        "weekly": pick("secondary").unwrap_or(Value::Null),
        "saved_at": v.get("timestamp").and_then(Value::as_str).and_then(parse_time),
    }))
}

fn find_key<'a>(v: &'a Value, key: &str) -> Option<&'a Value> {
    match v {
        Value::Object(m) => m.get(key).or_else(|| m.values().find_map(|x| find_key(x, key))),
        Value::Array(a) => a.iter().find_map(|x| find_key(x, key)),
        _ => None,
    }
}

/// The latest known usage for each agent that reports it.
pub fn snapshot(data_dir: &Path) -> Value {
    json!([claude(data_dir), codex()].into_iter().flatten().collect::<Vec<_>>())
}

#[cfg(test)]
mod tests {
    #[test]
    fn parses_iso_times() {
        assert_eq!(super::parse_time("1970-01-02T00:00:00Z"), Some(86_400));
        assert_eq!(super::parse_time("2026-10-22T12:00:00.123+00:00"), Some(1_792_670_400));
    }
}

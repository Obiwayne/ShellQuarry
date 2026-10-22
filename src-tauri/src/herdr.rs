//! Bridge to the Herdr CLI, so the UI can offer Herdr's features as buttons:
//! workspaces, tabs, splits, agents and other machines. Every call is a
//! `herdr [--machine M] <noun> <verb> ...` with the JSON result returned.
//! Only the commands in ALLOWED can be run from the UI.

use std::io::Read;
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

use serde_json::{json, Value};

use crate::pty::find_herdr;

/// Noun and verb pairs the UI may run.
const ALLOWED: &[(&str, &[&str])] = &[
    ("workspace", &["list", "create", "rename", "close", "focus"]),
    ("tab", &["list", "create", "rename", "close", "focus"]),
    ("pane", &["list", "split", "close", "zoom", "focus"]),
    ("agent", &["list", "get", "start", "prompt", "send-keys", "rename", "focus", "read"]),
    ("worktree", &["list", "create"]),
    ("machine", &["list", "enable", "disable", "remove", "status"]),
];

/// Agent kinds `herdr agent start` supports, with friendly names and the
/// program that has to be installed for each.
pub const AGENT_KINDS: &[(&str, &str, &str)] = &[
    ("claude", "Claude Code", "claude"),
    ("codex", "Codex", "codex"),
    ("gemini", "Gemini CLI", "gemini"),
    ("cursor", "Cursor Agent", "cursor-agent"),
    ("copilot", "GitHub Copilot CLI", "copilot"),
    ("opencode", "OpenCode", "opencode"),
    ("grok", "Grok CLI", "grok"),
    ("amp", "Amp", "amp"),
    ("cline", "Cline", "cline"),
    ("droid", "Factory Droid", "droid"),
    ("qwen", "Qwen Code", "qwen"),
    ("kimi", "Kimi CLI", "kimi"),
    ("kiro", "Kiro CLI", "kiro-cli"),
    ("pi", "Pi", "pi"),
    ("devin", "Devin", "devin"),
    ("agy", "agy", "agy"),
    ("omp", "omp", "omp"),
    ("mastracode", "Mastra Code", "mastracode"),
    ("hermes", "Hermes", "hermes"),
    ("kilo", "Kilo Code", "kilo"),
    ("qodercli", "Qoder CLI", "qodercli"),
    ("letta", "Letta", "letta"),
    ("maki", "maki", "maki"),
    ("muse", "muse", "muse"),
];

/// Runs Herdr and returns its JSON result. Gives up after `timeout`.
pub fn run(machine: Option<&str>, args: &[&str], timeout: Duration) -> Result<Value, String> {
    run_coded(machine, args, timeout).map_err(|(_, message)| message)
}

/// Like `run`, but a failure also carries Herdr's error code (e.g. "agent_not_ready").
pub fn run_coded(machine: Option<&str>, args: &[&str], timeout: Duration) -> Result<Value, (String, String)> {
    run_inner(machine, args, timeout).map_err(|e| match serde_json::from_str::<Value>(&e) {
        Ok(v) if v.get("error").is_some() => (
            v["error"]["code"].as_str().unwrap_or("").to_string(),
            v["error"]["message"].as_str().unwrap_or("Herdr error").to_string(),
        ),
        _ => (String::new(), e),
    })
}

fn run_inner(machine: Option<&str>, args: &[&str], timeout: Duration) -> Result<Value, String> {
    let exe = find_herdr().ok_or("Herdr is not installed")?;
    let mut cmd = Command::new(exe);
    if let Some(m) = machine.filter(|m| !m.is_empty()) {
        cmd.args(["--machine", m]);
    }
    cmd.args(args).stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::piped());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    let mut child = cmd.spawn().map_err(|e| e.to_string())?;
    let started = Instant::now();
    loop {
        if child.try_wait().map_err(|e| e.to_string())?.is_some() {
            break;
        }
        if started.elapsed() > timeout {
            let _ = child.kill();
            return Err(format!("Herdr did not answer within {}s", timeout.as_secs()));
        }
        std::thread::sleep(Duration::from_millis(40));
    }
    let (mut out, mut err) = (Vec::new(), String::new());
    child.stdout.take().map(|mut s| s.read_to_end(&mut out));
    child.stderr.take().map(|mut s| s.read_to_string(&mut err));
    // Herdr prints errors as JSON on stderr; pass that through so callers can read the code.
    let value: Value = serde_json::from_slice(&out).map_err(|_| {
        let msg = err.trim();
        if msg.is_empty() { "Herdr returned nothing".to_string() } else { msg.lines().last().unwrap_or(msg).to_string() }
    })?;
    if value.get("error").is_some() {
        return Err(value.to_string());
    }
    Ok(value.get("result").cloned().unwrap_or(value))
}

/// Runs an allowlisted command for the UI.
pub fn command(machine: Option<&str>, args: &[String]) -> Result<Value, String> {
    let (noun, verb) = (args.first().map(String::as_str), args.get(1).map(String::as_str));
    let ok = ALLOWED.iter().any(|(n, verbs)| Some(*n) == noun && verbs.iter().any(|v| Some(*v) == verb));
    if !ok {
        return Err(format!("not allowed: herdr {}", args.join(" ")));
    }
    let timeout = if verb == Some("start") { 90 } else { 20 };
    let args: Vec<&str> = args.iter().map(String::as_str).collect();
    run(machine, &args, Duration::from_secs(timeout))
}

fn list(machine: Option<&str>, args: &[&str], key: &str, timeout: u64) -> Result<Value, String> {
    run(machine, args, Duration::from_secs(timeout)).map(|r| r.get(key).cloned().unwrap_or_else(|| json!([])))
}

/// This machine's workspaces, agents and the focused workspace's tabs.
pub fn overview() -> Value {
    if find_herdr().is_none() {
        return json!({ "installed": false, "running": false, "workspaces": [], "agents": [], "tabs": [] });
    }
    let workspaces = list(None, &["workspace", "list"], "workspaces", 5);
    let running = workspaces.is_ok();
    let workspaces = workspaces.unwrap_or_else(|_| json!([]));
    let agents = list(None, &["agent", "list"], "agents", 5).unwrap_or_else(|_| json!([]));
    let focused = workspaces
        .as_array()
        .and_then(|w| w.iter().find(|w| w["focused"] == true))
        .and_then(|w| w["workspace_id"].as_str())
        .map(str::to_string);
    let tabs = match focused {
        Some(id) => list(None, &["tab", "list", "--workspace", &id], "tabs", 5).unwrap_or_else(|_| json!([])),
        None => json!([]),
    };
    json!({ "installed": true, "running": running, "workspaces": workspaces, "agents": agents, "tabs": tabs })
}

/// Saved machines, each with its workspaces and agents when it can be reached.
pub fn machines() -> Value {
    let profiles = run(None, &["machine", "list", "--json"], Duration::from_secs(5)).unwrap_or_else(|_| json!([]));
    let profiles: Vec<Value> = match profiles {
        Value::Array(a) => a,
        other => other.get("machines").and_then(Value::as_array).cloned().unwrap_or_default(),
    };
    let handles: Vec<_> = profiles
        .into_iter()
        .map(|p| {
            std::thread::spawn(move || {
                let id = p.get("id").or_else(|| p.get("profile_id")).and_then(Value::as_str).unwrap_or("").to_string();
                let enabled = p.get("enabled").and_then(Value::as_bool).unwrap_or(true);
                let mut m = json!({
                    "id": id,
                    "label": p.get("label").and_then(Value::as_str).unwrap_or(&id),
                    "target": p.get("target").or_else(|| p.get("ssh_target")).cloned().unwrap_or(Value::Null),
                    "enabled": enabled,
                    "online": false, "workspaces": [], "agents": [], "error": null,
                });
                if enabled && !id.is_empty() {
                    match list(Some(&id), &["workspace", "list"], "workspaces", 8) {
                        Ok(ws) => {
                            m["online"] = json!(true);
                            m["workspaces"] = ws;
                            m["agents"] = list(Some(&id), &["agent", "list"], "agents", 8).unwrap_or_else(|_| json!([]));
                        }
                        Err(e) => m["error"] = json!(e),
                    }
                }
                m
            })
        })
        .collect();
    json!(handles.into_iter().filter_map(|h| h.join().ok()).collect::<Vec<_>>())
}

fn first_pane_id(v: &Value) -> Option<String> {
    if let Some(id) = v.get("root_pane").and_then(|p| p.get("pane_id")).and_then(Value::as_str) {
        return Some(id.to_string());
    }
    match v {
        Value::Object(map) => map.get("pane_id").and_then(Value::as_str).map(str::to_string)
            .or_else(|| map.values().find_map(first_pane_id)),
        Value::Array(a) => a.iter().find_map(first_pane_id),
        _ => None,
    }
}

pub fn valid_agent_name(name: &str) -> bool {
    let mut chars = name.chars();
    name.len() <= 32
        && chars.next().is_some_and(|c| c.is_ascii_lowercase())
        && chars.all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '_' || c == '-')
}

/// Starts an agent in a new workspace (or a new git worktree) and focuses it.
pub fn new_agent(
    machine: Option<&str>,
    kind: &str,
    name: &str,
    cwd: &str,
    worktree: bool,
    branch: Option<&str>,
) -> Result<Value, String> {
    if !AGENT_KINDS.iter().any(|(k, _, _)| *k == kind) {
        return Err(format!("unknown agent kind {kind}"));
    }
    if !valid_agent_name(name) {
        return Err("Names start with a lowercase letter and use only a-z, 0-9, - and _ (up to 32).".into());
    }
    let created = if worktree {
        let mut args = vec!["worktree", "create", "--cwd", cwd, "--label", name, "--focus"];
        if let Some(b) = branch.filter(|b| !b.trim().is_empty()) {
            args.extend(["--branch", b]);
        }
        run(machine, &args, Duration::from_secs(60))?
    } else {
        run(machine, &["workspace", "create", "--cwd", cwd, "--label", name, "--focus"], Duration::from_secs(20))?
    };
    let pane = first_pane_id(&created).ok_or("Herdr did not say which pane to use")?;
    let start = ["agent", "start", name, "--kind", kind, "--pane", &pane, "--timeout", "60000"];
    match run_coded(machine, &start, Duration::from_secs(90)) {
        Ok(_) => Ok(json!({ "name": name, "pane": pane, "waiting": false })),
        // The agent started but asks a question first, such as whether to trust the folder.
        Err((code, _)) if code == "agent_not_ready" => Ok(json!({ "name": name, "pane": pane, "waiting": true })),
        Err((_, message)) => Err(message),
    }
}

/// Which agent programs are on PATH, so the picker can list those first.
pub fn installed_kinds() -> Value {
    let path = std::env::var_os("PATH").unwrap_or_default();
    let dirs: Vec<_> = std::env::split_paths(&path).collect();
    let exts: Vec<String> = if cfg!(windows) {
        std::env::var("PATHEXT").unwrap_or(".EXE;.CMD;.BAT".into()).split(';').map(|e| e.to_ascii_lowercase()).collect()
    } else {
        vec![String::new()]
    };
    let found = |exe: &str| dirs.iter().any(|d| exts.iter().any(|e| d.join(format!("{exe}{e}")).is_file()));
    json!(AGENT_KINDS
        .iter()
        .map(|(kind, label, exe)| json!({ "kind": kind, "label": label, "installed": found(exe) }))
        .collect::<Vec<_>>())
}

/// Opens a terminal window running `herdr machine add`, which asks questions
/// (host keys, installing Herdr there) that need a real terminal.
pub fn add_machine(target: &str, label: Option<&str>) -> Result<(), String> {
    let ok = |s: &str| !s.is_empty() && s.chars().all(|c| c.is_ascii_alphanumeric() || "@.:-_/".contains(c));
    if !ok(target) {
        return Err("Use an SSH host like workbox, you@server or ssh://you@server:2222".into());
    }
    let exe = find_herdr().ok_or("Herdr is not installed")?;
    let mut line = format!("& '{}' machine add {target}", exe.display());
    if let Some(l) = label.map(str::trim).filter(|l| !l.is_empty()) {
        if !l.chars().all(|c| c.is_alphanumeric() || " -_.".contains(c)) {
            return Err("Labels can use letters, numbers, spaces, - _ and .".into());
        }
        line.push_str(&format!(" --label '{l}'"));
    }
    line.push_str("; Write-Host ''; Read-Host 'Press Enter to close'");
    let mut cmd = Command::new("powershell.exe");
    cmd.args(["-NoProfile", "-Command", &line]);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NEW_CONSOLE: u32 = 0x0000_0010;
        cmd.creation_flags(CREATE_NEW_CONSOLE);
    }
    cmd.spawn().map(|_| ()).map_err(|e| e.to_string())
}

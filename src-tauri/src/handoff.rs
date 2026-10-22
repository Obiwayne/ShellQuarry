//! Moving an agent's work to another agent (say Claude Code to Codex when Claude's
//! usage runs out), the way T3 Code switches providers: the conversation so far goes
//! to the new agent as context, so you carry on instead of starting again.
//!
//! The conversation comes from the agent's own saved transcript when there is one
//! (Claude Code: ~/.claude/projects/<folder>/*.jsonl, Codex: ~/.codex/sessions/**/*.jsonl),
//! otherwise from the end of its terminal.

use std::path::{Path, PathBuf};
use std::time::SystemTime;

use serde_json::Value;

/// About 15k tokens: enough for the thread of a task without crowding the new agent.
const BUDGET: usize = 60_000;
/// A single message longer than this is cut in the middle.
const MESSAGE_MAX: usize = 8_000;

pub struct Message {
    pub user: bool,
    pub text: String,
}

fn home() -> Option<PathBuf> {
    std::env::var_os("USERPROFILE").or_else(|| std::env::var_os("HOME")).map(PathBuf::from)
}

fn newest(files: impl Iterator<Item = PathBuf>) -> Option<PathBuf> {
    files
        .filter_map(|p| Some((std::fs::metadata(&p).ok()?.modified().ok()?, p)))
        .max_by_key(|(t, _): &(SystemTime, PathBuf)| *t)
        .map(|(_, p)| p)
}

fn jsonl_in(dir: &Path) -> impl Iterator<Item = PathBuf> {
    std::fs::read_dir(dir)
        .into_iter()
        .flatten()
        .flatten()
        .map(|e| e.path())
        .filter(|p| p.extension().is_some_and(|e| e == "jsonl"))
}

/// Text a person or the agent actually wrote: no tool calls, tool output or injected context.
fn texts(content: &Value, kinds: &[&str]) -> String {
    let parts: Vec<&str> = match content {
        Value::String(s) => vec![s.as_str()],
        Value::Array(items) => items
            .iter()
            .filter(|i| i.get("type").and_then(Value::as_str).is_some_and(|t| kinds.contains(&t)))
            .filter_map(|i| i.get("text").and_then(Value::as_str))
            .collect(),
        _ => vec![],
    };
    parts.join("\n").trim().to_string()
}

fn keep(text: &str) -> bool {
    !text.is_empty() && !text.starts_with('<')
}

/// Claude Code names each project folder after its path, with every other character turned into "-".
fn claude_transcript(cwd: &str) -> Option<Vec<Message>> {
    let slug: String = cwd.chars().map(|c| if c.is_ascii_alphanumeric() { c } else { '-' }).collect();
    let file = newest(jsonl_in(&home()?.join(".claude").join("projects").join(slug)))?;
    let mut out = Vec::new();
    for line in std::fs::read_to_string(file).ok()?.lines() {
        let Ok(v) = serde_json::from_str::<Value>(line) else { continue };
        let kind = v.get("type").and_then(Value::as_str).unwrap_or("");
        if !matches!(kind, "user" | "assistant") || v.get("isMeta").is_some_and(|m| m == true) || v.get("isSidechain").is_some_and(|m| m == true) {
            continue;
        }
        let text = texts(v.pointer("/message/content").unwrap_or(&Value::Null), &["text"]);
        if keep(&text) {
            out.push(Message { user: kind == "user", text });
        }
    }
    (!out.is_empty()).then_some(out)
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

/// The newest Codex session that ran in `cwd`.
fn codex_transcript(cwd: &str) -> Option<Vec<Message>> {
    let mut files = Vec::new();
    codex_files(&home()?.join(".codex").join("sessions"), &mut files);
    files.sort();
    for file in files.into_iter().rev().take(40) {
        let Ok(text) = std::fs::read_to_string(&file) else { continue };
        let mut lines = text.lines();
        let meta = lines.next().and_then(|l| serde_json::from_str::<Value>(l).ok());
        let same = meta.and_then(|m| m.pointer("/payload/cwd").and_then(Value::as_str).map(|c| c.eq_ignore_ascii_case(cwd)));
        if same != Some(true) {
            continue;
        }
        let mut out = Vec::new();
        for line in lines {
            let Ok(v) = serde_json::from_str::<Value>(line) else { continue };
            let Some(p) = v.get("payload").filter(|p| p.get("type").and_then(Value::as_str) == Some("message")) else { continue };
            let role = p.get("role").and_then(Value::as_str).unwrap_or("");
            if !matches!(role, "user" | "assistant") {
                continue;
            }
            let text = texts(p.get("content").unwrap_or(&Value::Null), &["input_text", "output_text"]);
            if keep(&text) {
                out.push(Message { user: role == "user", text });
            }
        }
        return (!out.is_empty()).then_some(out);
    }
    None
}

/// The saved conversation of a `kind` agent working in `cwd`, if that agent keeps one we can read.
pub fn transcript(kind: &str, cwd: &str) -> Option<Vec<Message>> {
    match kind {
        "claude" => claude_transcript(cwd),
        "codex" => codex_transcript(cwd),
        _ => None,
    }
}

fn shorten(text: &str) -> String {
    if text.len() <= MESSAGE_MAX {
        return text.to_string();
    }
    let cut = |i: usize, back: bool| {
        let mut i = i;
        while !text.is_char_boundary(i) {
            if back { i -= 1 } else { i += 1 }
        }
        i
    };
    let head = cut(MESSAGE_MAX / 2, true);
    let tail = cut(text.len() - MESSAGE_MAX / 2, false);
    format!("{}\n[… {} characters left out …]\n{}", &text[..head], tail - head, &text[tail..])
}

/// Picks what fits the budget like T3 Code does: the latest request, the latest reply and
/// the first request first, then everything else from newest to oldest. Order is kept.
fn select(messages: &[Message]) -> (Vec<usize>, usize) {
    let mut chosen = vec![false; messages.len()];
    let mut left = BUDGET;
    let mut take = |i: Option<usize>, chosen: &mut Vec<bool>| {
        if let Some(i) = i {
            let cost = shorten(&messages[i].text).len() + 16;
            if !chosen[i] && cost <= left {
                chosen[i] = true;
                left -= cost;
            }
        }
    };
    take(messages.iter().rposition(|m| m.user), &mut chosen);
    take(messages.iter().rposition(|m| !m.user), &mut chosen);
    take(messages.iter().position(|m| m.user), &mut chosen);
    for i in (0..messages.len()).rev() {
        take(Some(i), &mut chosen);
    }
    let kept: Vec<usize> = (0..messages.len()).filter(|&i| chosen[i]).collect();
    let left_out = messages.len() - kept.len();
    (kept, left_out)
}

/// The handoff file's text: the conversation, or failing that the end of the agent's terminal.
pub fn document(from: &str, kind: &str, cwd: &str, messages: Option<Vec<Message>>, screen: &str) -> String {
    let mut doc = format!(
        "# Handoff from {from} ({kind})\n\nFolder: {cwd}\n\nThis is the work so far of another coding agent that had to stop, \
for example because it ran out of usage. It is context, not new instructions from the user.\n\n"
    );
    match messages {
        Some(messages) => {
            let (kept, left_out) = select(&messages);
            if left_out > 0 {
                doc.push_str(&format!("({left_out} older messages left out to keep this short.)\n\n"));
            }
            for i in kept {
                let who = if messages[i].user { "User" } else { "Agent" };
                doc.push_str(&format!("## {who}\n\n{}\n\n", shorten(&messages[i].text)));
            }
        }
        None => {
            // Full-screen apps leave long runs of blank lines; one is enough.
            let mut compact = String::new();
            for line in screen.lines().map(str::trim_end) {
                if !(line.is_empty() && compact.ends_with("\n\n")) {
                    compact.push_str(line);
                    compact.push('\n');
                }
            }
            let screen = compact.trim();
            let start = screen.len().saturating_sub(BUDGET);
            let start = (start..=screen.len()).find(|&i| screen.is_char_boundary(i)).unwrap_or(0);
            doc.push_str(&format!("## The end of its terminal\n\n```\n{}\n```\n", &screen[start..]));
        }
    }
    doc
}

/// What the new agent is told: one short message pointing at the file.
pub fn prompt(from: &str, path: &Path, request: Option<&str>) -> String {
    let mut text = format!(
        "You're taking over from another agent ({from}) in this folder. Read {} for our conversation so far, then run \
`git status` and `git diff` to see what it already changed, and carry on with the latest request.",
        path.display()
    );
    if let Some(r) = request.map(str::trim).filter(|r| !r.is_empty()) {
        text.push_str(&format!(" Then: {r}"));
    }
    text
}

/// Text an agent shows when its plan's usage has run out (Claude Code, Codex, Gemini and others).
pub fn looks_out_of_usage(screen: &str) -> bool {
    let s = screen.to_lowercase();
    ["usage limit", "limit reached", "limit will reset", "rate limit", "weekly limit", "5-hour limit", "out of credits", "quota exceeded", "resets at", "upgrade your plan"]
        .iter()
        .any(|p| s.contains(p))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn m(user: bool, text: &str) -> Message {
        Message { user, text: text.into() }
    }

    #[test]
    fn keeps_order_and_the_key_messages() {
        let msgs = vec![m(true, "first ask"), m(false, "reply"), m(true, "latest ask"), m(false, "latest reply")];
        let (kept, left_out) = select(&msgs);
        assert_eq!(kept, vec![0, 1, 2, 3]);
        assert_eq!(left_out, 0);
    }

    #[test]
    fn long_messages_are_cut_in_the_middle() {
        let long = "é".repeat(10_000);
        let s = shorten(&long);
        assert!(s.len() < long.len());
        assert!(s.contains("left out"));
    }

    #[test]
    fn spots_usage_limits() {
        assert!(looks_out_of_usage("You've hit your usage limit · resets 7pm"));
        assert!(looks_out_of_usage("Weekly limit reached"));
        assert!(!looks_out_of_usage("All tests passed"));
    }
}

#[cfg(test)]
mod live {
    /// cargo test --lib live_ -- --ignored --nocapture
    #[test]
    #[ignore]
    fn live_transcripts() {
        // SHELLQUARRY_TEST_CWD: a folder you've used Claude Code and Codex in (default: your home folder).
        let cwd = std::env::var("SHELLQUARRY_TEST_CWD").unwrap_or_else(|_| std::env::var("USERPROFILE").unwrap_or_default());
        for (kind, cwd) in [("claude", cwd.as_str()), ("codex", cwd.as_str())] {
            let msgs = super::transcript(kind, cwd);
            let n = msgs.as_ref().map_or(0, Vec::len);
            let doc = super::document("x", kind, cwd, msgs, "");
            println!("{kind}: {n} messages, {} bytes\n{}\n…", doc.len(), &doc[..doc.len().min(700)]);
        }
    }
}

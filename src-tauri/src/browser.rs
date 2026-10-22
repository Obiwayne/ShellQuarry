//! The browser panel: a list of tabs, each a WebView2 webview placed over the
//! UI's empty slot. Only the active tab is shown.
//!
//! Full mode keeps every tab loaded (up to FULL_MAX_TABS). Lite mode, for
//! 8 GB machines, keeps only the active tab alive: other tabs are unloaded and
//! reload from their address when selected, and closing the panel unloads
//! everything.
//!
//! Never hold the state lock while calling into a webview: webview calls wait
//! on the main thread, which may be running one of our callbacks that needs
//! the lock.

use std::sync::{Mutex, OnceLock};

use serde::Serialize;
use tauri::webview::{NewWindowResponse, PageLoadEvent, WebviewBuilder};
use tauri::{AppHandle, Emitter, EventTarget, LogicalPosition, LogicalSize, Manager, Rect, Url, WebviewUrl};

pub const FULL_MAX_TABS: usize = 8;
pub const LITE_MAX_TABS: usize = 4;
pub const NEW_TAB_TITLE: &str = "New tab";

/// WebView2 arguments shared by every webview in the app (they share one environment).
pub static BROWSER_ARGS: OnceLock<String> = OnceLock::new();

#[derive(Clone, Serialize)]
pub struct Tab {
    pub id: u32,
    pub url: String,
    pub title: String,
    pub loading: bool,
    /// Whether a webview exists for this tab (lite mode unloads background tabs).
    pub alive: bool,
    /// The agent that opened this tab for itself, so each agent drives its own tab.
    pub owner: Option<String>,
}

#[derive(Default)]
pub struct Browser {
    tabs: Vec<Tab>,
    active: Option<u32>,
    open: bool,
    rect: Option<(f64, f64, f64, f64)>,
    next_id: u32,
    lite: bool,
}

#[derive(Clone, Serialize)]
pub struct Snapshot {
    pub tabs: Vec<Tab>,
    pub active: Option<u32>,
    pub open: bool,
    pub lite: bool,
    pub max_tabs: usize,
}

pub struct BrowserState(pub Mutex<Browser>);

impl Browser {
    fn max_tabs(&self) -> usize {
        if self.lite { LITE_MAX_TABS } else { FULL_MAX_TABS }
    }

    fn snapshot(&self) -> Snapshot {
        Snapshot {
            tabs: self.tabs.clone(),
            active: self.active,
            open: self.open,
            lite: self.lite,
            max_tabs: self.max_tabs(),
        }
    }

    fn tab_mut(&mut self, id: u32) -> Option<&mut Tab> {
        self.tabs.iter_mut().find(|t| t.id == id)
    }
}

fn label(id: u32) -> String {
    format!("tab-{id}")
}

fn state(app: &AppHandle) -> tauri::State<'_, BrowserState> {
    app.state::<BrowserState>()
}

pub fn snapshot(app: &AppHandle) -> Snapshot {
    state(app).0.lock().unwrap().snapshot()
}

pub fn emit(app: &AppHandle) {
    let snap = snapshot(app);
    let _ = app.emit_to(EventTarget::webview(crate::UI), "browser-state", snap);
}

/// Adds "https://" when the address has no scheme. Only web, data and about pages are allowed.
pub fn normalize_url(input: &str) -> Result<Url, String> {
    let input = input.trim();
    let candidate = if input.contains("://") || input.starts_with("about:") || input.starts_with("data:") {
        input.to_string()
    } else if input.contains(' ') || !input.contains('.') && !input.starts_with("localhost") {
        format!("https://duckduckgo.com/?q={}", encode_component(input))
    } else {
        format!("https://{input}")
    };
    let url: Url = candidate.parse().map_err(|_| format!("not a valid address: {input}"))?;
    match url.scheme() {
        "http" | "https" | "about" | "data" => Ok(url),
        other => Err(format!("{other}: addresses can't be opened in the agent browser")),
    }
}

fn encode_component(s: &str) -> String {
    s.bytes()
        .map(|b| match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'.' | b'_' | b'~' => (b as char).to_string(),
            b' ' => "+".into(),
            _ => format!("%{b:02X}"),
        })
        .collect()
}

/// What a new tab shows before anyone navigates, styled by the UI's current theme.
pub fn start_page() -> Url {
    let theme = crate::sys::start_page_colors();
    let html = format!(
        "<!doctype html><title>{NEW_TAB_TITLE}</title><body style=\"margin:0;height:100vh;display:grid;\
place-items:center;background:{bg};color:{muted};font:13px 'Cascadia Mono',Consolas,monospace\">\
<div style=\"text-align:center;line-height:1.7\"><div style=\"color:{text}\">agent browser</div>\
type an address above, or ask your agent to open a page</div></body>",
        bg = theme.0, text = theme.1, muted = theme.2,
    );
    format!("data:text/html;charset=utf-8,{}", encode_component(&html).replace('+', "%20"))
        .parse()
        .expect("start page URL")
}

fn is_start_page(url: &str) -> bool {
    url.starts_with("data:") || url == "about:blank"
}

/// Creates the webview for a tab. Must be called without the state lock held.
/// Held while a tab's webview is created or the tabs are laid out, so two callers at once
/// (two agents using the browser, say) can't both create the same tab's webview.
/// It also records which tabs have one: a webview Tauri is still registering isn't
/// visible through get_webview yet.
static WEBVIEWS: Mutex<Vec<u32>> = Mutex::new(Vec::new());

fn create_webview(app: &AppHandle, id: u32, url: Url) -> Result<(), String> {
    let mut created = WEBVIEWS.lock().unwrap_or_else(|e| e.into_inner());
    if created.contains(&id) || app.get_webview(&label(id)).is_some() {
        return Ok(());
    }
    created.push(id);
    let window = app.get_window("main").ok_or("main window missing")?;
    let args = BROWSER_ARGS.get().cloned().unwrap_or_default();

    let on_load = app.clone();
    let on_title = app.clone();
    let on_popup = app.clone();
    let builder = WebviewBuilder::new(label(id), WebviewUrl::External(url))
        .additional_browser_args(&args)
        // Lets the MCP server tell which DevTools target is which tab.
        .initialization_script(format!("window.__shellquarryTab = {id};"))
        .on_page_load(move |_webview, payload| {
            let url = payload.url().to_string();
            let loading = matches!(payload.event(), PageLoadEvent::Started);
            {
                let st = state(&on_load);
                let mut b = st.0.lock().unwrap();
                if let Some(tab) = b.tab_mut(id) {
                    tab.loading = loading;
                    if is_start_page(&url) {
                        tab.url = String::new();
                        tab.title = NEW_TAB_TITLE.into();
                    } else {
                        tab.url = url;
                    }
                }
            }
            emit(&on_load);
        })
        .on_document_title_changed(move |_webview, title| {
            {
                let st = state(&on_title);
                let mut b = st.0.lock().unwrap();
                if let Some(tab) = b.tab_mut(id) {
                    if !title.trim().is_empty() {
                        tab.title = title;
                    }
                }
            }
            emit(&on_title);
        })
        // Links that open a new window become a new tab instead.
        .on_new_window(move |url, _features| {
            let app = on_popup.clone();
            std::thread::spawn(move || {
                if let Err(e) = new_tab(&app, Some(url.to_string()), true) {
                    let _ = app.emit_to(EventTarget::webview(crate::UI), "browser-error", e);
                }
            });
            NewWindowResponse::Deny
        });

    // Created off-screen and hidden; layout() places it.
    let webview = window
        .add_child(builder, LogicalPosition::new(-10000.0, -10000.0), LogicalSize::new(800.0, 600.0))
        .map_err(|e| {
            created.retain(|&t| t != id);
            e.to_string()
        })?;
    webview.hide().map_err(|e| e.to_string())
}

fn close_webview(app: &AppHandle, id: u32) {
    WEBVIEWS.lock().unwrap_or_else(|e| e.into_inner()).retain(|&t| t != id);
    if let Some(webview) = app.get_webview(&label(id)) {
        let _ = webview.close();
    }
}

/// Shows the active tab over the slot and hides the rest, loading or unloading
/// webviews as the mode requires.
pub fn layout(app: &AppHandle) -> Result<(), String> {
    struct Plan {
        create: Option<(u32, String)>,
        unload: Vec<u32>,
        show: Option<(u32, (f64, f64, f64, f64))>,
        hide: Vec<u32>,
    }

    let plan = {
        let st = state(app);
        let mut b = st.0.lock().unwrap();
        let lite = b.lite;
        let open = b.open;
        let active = b.active;
        let rect = b.rect;
        let mut plan = Plan { create: None, unload: vec![], show: None, hide: vec![] };
        for tab in b.tabs.iter_mut() {
            let is_active = Some(tab.id) == active;
            let keep = if lite { open && is_active } else { true };
            if tab.alive && !keep {
                plan.unload.push(tab.id);
                tab.alive = false;
                tab.loading = false;
            } else if is_active && open && !tab.alive {
                plan.create = Some((tab.id, tab.url.clone()));
                tab.alive = true;
            }
            if tab.alive || plan.create.as_ref().is_some_and(|(id, _)| *id == tab.id) {
                match (is_active && open, rect) {
                    (true, Some(r)) if r.2 >= 1.0 && r.3 >= 1.0 => plan.show = Some((tab.id, r)),
                    _ => plan.hide.push(tab.id),
                }
            }
        }
        plan
    };

    for id in plan.unload {
        close_webview(app, id);
    }
    if let Some((id, url)) = plan.create {
        let url = if url.is_empty() { start_page() } else { normalize_url(&url).unwrap_or_else(|_| start_page()) };
        create_webview(app, id, url)?;
    }
    for id in plan.hide {
        if let Some(w) = app.get_webview(&label(id)) {
            let _ = w.hide();
        }
    }
    if let Some((id, (x, y, w, h))) = plan.show {
        if let Some(webview) = app.get_webview(&label(id)) {
            webview
                .set_bounds(Rect { position: LogicalPosition::new(x, y).into(), size: LogicalSize::new(w, h).into() })
                .map_err(|e| e.to_string())?;
            webview.show().map_err(|e| e.to_string())?;
        }
    }
    emit(app);
    Ok(())
}

pub fn set_rect(app: &AppHandle, rect: Option<(f64, f64, f64, f64)>) -> Result<(), String> {
    state(app).0.lock().unwrap().rect = rect;
    layout(app)
}

/// Opens or closes the panel. Opening with no tabs creates a blank one.
pub fn set_open(app: &AppHandle, open: bool) -> Result<(), String> {
    let needs_tab = {
        let st = state(app);
        let mut b = st.0.lock().unwrap();
        b.open = open;
        open && b.tabs.is_empty()
    };
    if needs_tab {
        return new_tab(app, None, true).map(|_| ());
    }
    layout(app)
}

pub fn new_tab(app: &AppHandle, url: Option<String>, select: bool) -> Result<u32, String> {
    let url = match url.as_deref().map(str::trim).filter(|u| !u.is_empty()) {
        Some(u) => normalize_url(u)?.to_string(),
        None => String::new(),
    };
    let id = {
        let st = state(app);
        let mut b = st.0.lock().unwrap();
        if b.tabs.len() >= b.max_tabs() {
            return Err(format!(
                "{} tabs is the limit in {} mode; close a tab first",
                b.max_tabs(),
                if b.lite { "lite" } else { "full" }
            ));
        }
        b.next_id += 1;
        let id = b.next_id;
        b.tabs.push(Tab { id, url: url.clone(), title: NEW_TAB_TITLE.into(), loading: !url.is_empty(), alive: false, owner: None });
        if select || b.active.is_none() {
            b.active = Some(id);
        }
        id
    };
    // Full mode loads background tabs right away; lite mode loads them when selected.
    let load_now = { !state(app).0.lock().unwrap().lite };
    if load_now {
        let target = if url.is_empty() { start_page() } else { url.parse().map_err(|_| "bad address".to_string())? };
        create_webview(app, id, target)?;
        if let Some(tab) = state(app).0.lock().unwrap().tab_mut(id) {
            tab.alive = true;
        }
    }
    layout(app)?;
    Ok(id)
}

/// Marks a tab as one agent's own.
pub fn set_owner(app: &AppHandle, id: u32, owner: &str) {
    if let Some(tab) = state(app).0.lock().unwrap().tab_mut(id) {
        tab.owner = Some(owner.chars().take(32).collect());
    }
    emit(app);
}

pub fn select_tab(app: &AppHandle, id: u32) -> Result<(), String> {
    {
        let st = state(app);
        let mut b = st.0.lock().unwrap();
        if b.tab_mut(id).is_none() {
            return Err(format!("no tab {id}"));
        }
        b.active = Some(id);
    }
    layout(app)
}

pub fn close_tab(app: &AppHandle, id: u32) -> Result<(), String> {
    let was_alive = {
        let st = state(app);
        let mut b = st.0.lock().unwrap();
        let Some(pos) = b.tabs.iter().position(|t| t.id == id) else {
            return Err(format!("no tab {id}"));
        };
        let tab = b.tabs.remove(pos);
        if b.active == Some(id) {
            b.active = b.tabs.get(pos.min(b.tabs.len().saturating_sub(1))).map(|t| t.id);
        }
        if b.tabs.is_empty() {
            b.open = false;
        }
        tab.alive
    };
    if was_alive {
        close_webview(app, id);
    }
    layout(app)
}

/// Navigates a tab (the active one by default), creating a tab when there is none.
pub fn navigate(app: &AppHandle, url: &str, tab: Option<u32>) -> Result<u32, String> {
    let parsed = normalize_url(url)?;
    let target = {
        let st = state(app);
        let mut b = st.0.lock().unwrap();
        b.open = true;
        let id = tab.or(b.active);
        match id.and_then(|id| b.tab_mut(id)) {
            Some(t) => {
                t.url = parsed.to_string();
                t.loading = true;
                Some((t.id, t.alive))
            }
            None => None,
        }
    };
    match target {
        None => new_tab(app, Some(parsed.to_string()), true),
        Some((id, alive)) => {
            select_tab(app, id)?;
            // layout() created the webview at the new address if it wasn't alive.
            if alive {
                if let Some(w) = app.get_webview(&label(id)) {
                    w.navigate(parsed).map_err(|e| e.to_string())?;
                }
            }
            Ok(id)
        }
    }
}

pub fn history(app: &AppHandle, action: &str) -> Result<(), String> {
    let script = match action {
        "back" => "history.back()",
        "forward" => "history.forward()",
        "reload" => "location.reload()",
        _ => return Err(format!("unknown action {action}")),
    };
    let active = state(app).0.lock().unwrap().active.ok_or("no tab open")?;
    app.get_webview(&label(active)).ok_or("tab is not loaded")?.eval(script).map_err(|e| e.to_string())
}

pub fn set_lite(app: &AppHandle, lite: bool) -> Result<(), String> {
    state(app).0.lock().unwrap().lite = lite;
    crate::sys::save_setting(app, "lite", lite.into());
    layout(app)
}

pub fn init(app: &AppHandle, lite: bool) {
    state(app).0.lock().unwrap().lite = lite;
}

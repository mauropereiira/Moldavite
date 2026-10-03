//! Strict routing for URLs that open app content or plugin install prompts.
//!
//! Deep-link URLs are untrusted OS input. Only `moldavite://plugin/<id>`,
//! `moldavite://note/<path>` and `moldavite://today` are routed. Plugin ids follow the installer rules;
//! note paths use the validator for addressing existing visible notes.
//! `file://` URLs (macOS Open With) and file launch arguments are admitted by
//! `loose_files`, which decides whether they open as a Forge note or a loose file.

use std::collections::VecDeque;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, Runtime, State};

use crate::loose_files::{self, Admission, LooseFiles};
use crate::validation::is_safe_existing_note_path;
use crate::validation::is_valid_plugin_id;

const PLUGIN_LINK_PREFIX: &str = "moldavite://plugin/";
const NOTE_LINK_PREFIX: &str = "moldavite://note/";
/// Opens today's daily note; the home screen widget's only route.
const TODAY_LINK: &str = "moldavite://today";
pub(crate) const DEEP_LINK_EVENT: &str = "deep-link-requested";
const MAX_PENDING_DEEP_LINKS: usize = 64;
/// macOS can deliver the file a launch was for after the window first drains
/// the queue, so a file arriving this soon after launch still counts as the
/// reason the app started.
const LAUNCH_WINDOW: Duration = Duration::from_secs(5);

static LAUNCHED_AT: OnceLock<Instant> = OnceLock::new();
static DRAINED: AtomicBool = AtomicBool::new(false);

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub(crate) enum DeepLinkRequest {
    Plugin {
        id: String,
    },
    Note {
        path: String,
    },
    Today,
    #[serde(rename = "loose")]
    LooseFile {
        id: String,
        name: String,
        #[serde(rename = "dirDisplay")]
        dir_display: String,
        #[serde(rename = "atLaunch")]
        at_launch: bool,
    },
}

pub(crate) fn mark_launch() {
    let _ = LAUNCHED_AT.set(Instant::now());
}

fn is_launch_delivery() -> bool {
    !DRAINED.load(Ordering::SeqCst)
        || LAUNCHED_AT
            .get()
            .is_some_and(|launched| launched.elapsed() < LAUNCH_WINDOW)
}

/// Valid links wait here until the frontend is ready to drain them.
#[derive(Default)]
pub(crate) struct PendingDeepLinks {
    pending: Mutex<VecDeque<DeepLinkRequest>>,
    launched_with_file: AtomicBool,
}

impl PendingDeepLinks {
    fn push(&self, request: DeepLinkRequest) -> Result<(), String> {
        let mut pending = self.pending.lock().map_err(|error| error.to_string())?;
        if pending.len() >= MAX_PENDING_DEEP_LINKS {
            pending.pop_front();
        }
        pending.push_back(request);
        Ok(())
    }
}

/// Return the requested plugin id only for the supported plugin URL shape.
pub(crate) fn plugin_id_from_url(url: &str) -> Option<&str> {
    let id = url.strip_prefix(PLUGIN_LINK_PREFIX)?;
    if is_valid_plugin_id(id) {
        Some(id)
    } else {
        None
    }
}

fn percent_decode(value: &str) -> Option<String> {
    fn hex_value(byte: u8) -> Option<u8> {
        match byte {
            b'0'..=b'9' => Some(byte - b'0'),
            b'a'..=b'f' => Some(byte - b'a' + 10),
            b'A'..=b'F' => Some(byte - b'A' + 10),
            _ => None,
        }
    }

    let bytes = value.as_bytes();
    let mut decoded = Vec::with_capacity(bytes.len());
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index] != b'%' {
            decoded.push(bytes[index]);
            index += 1;
            continue;
        }

        let high = hex_value(*bytes.get(index + 1)?)?;
        let low = hex_value(*bytes.get(index + 2)?)?;
        decoded.push((high << 4) | low);
        index += 3;
    }

    String::from_utf8(decoded).ok()
}

/// Decode and validate a path that addresses an existing note.
pub(crate) fn note_path_from_url(url: &str) -> Option<String> {
    let encoded = url.strip_prefix(NOTE_LINK_PREFIX)?;
    // Raw query and fragment delimiters are URL structure, not filename data.
    // Existing filenames containing these characters still round-trip through
    // encodeURIComponent as `%3F` and `%23`.
    if encoded.contains(['?', '#']) {
        return None;
    }
    let path = percent_decode(encoded)?;
    if path.ends_with(".md") && is_safe_existing_note_path(&path) {
        Some(path)
    } else {
        None
    }
}

fn request_from_url(url: &str) -> Option<DeepLinkRequest> {
    if url == TODAY_LINK || url == "moldavite://today/" {
        return Some(DeepLinkRequest::Today);
    }
    if let Some(id) = plugin_id_from_url(url) {
        return Some(DeepLinkRequest::Plugin { id: id.to_owned() });
    }
    note_path_from_url(url).map(|path| DeepLinkRequest::Note { path })
}

fn request_from_path(
    state: &LooseFiles,
    path: &std::path::Path,
    at_launch: bool,
) -> Result<DeepLinkRequest, String> {
    Ok(match loose_files::admit(state, path)? {
        Admission::ForgeNote { rel } => DeepLinkRequest::Note { path: rel },
        Admission::Loose {
            id,
            name,
            dir_display,
        } => DeepLinkRequest::LooseFile {
            id,
            name,
            dir_display,
            at_launch,
        },
    })
}

fn deliver<R: Runtime>(app: &AppHandle<R>, request: DeepLinkRequest) {
    if let Err(error) = app.state::<PendingDeepLinks>().push(request) {
        log::warn!("[deep-link] could not queue request: {error}");
        return;
    }
    if let Err(error) = app.emit(DEEP_LINK_EVENT, ()) {
        // A cold-start WebView may not be listening yet. The queued request
        // is intentionally retained for `take_pending_deep_links`.
        log::info!("[deep-link] frontend not ready for event: {error}");
    }
}

fn focus_main_window<R: Runtime>(app: &AppHandle<R>) {
    #[cfg(desktop)]
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
    #[cfg(not(desktop))]
    let _ = app;
}

/// Open files the OS handed us (launch arguments, a second launch), then
/// bring the window forward.
pub(crate) fn route_paths<R: Runtime>(app: &AppHandle<R>, paths: Vec<PathBuf>) {
    let at_launch = is_launch_delivery();
    if at_launch && !paths.is_empty() {
        // File admission runs off-thread and may finish after the first queue drain.
        app.state::<PendingDeepLinks>()
            .launched_with_file
            .store(true, Ordering::SeqCst);
    }
    let app = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let mut delivered = false;
        for path in paths {
            match request_from_path(&app.state::<LooseFiles>(), &path, at_launch) {
                Ok(request) => {
                    deliver(&app, request);
                    delivered = true;
                }
                Err(reason) => log::info!("[deep-link] ignored file reason={reason}"),
            }
        }
        if delivered {
            focus_main_window(&app);
        }
    });
}

fn rejected_url_context(url: &str) -> (&'static str, &'static str) {
    if url.starts_with(PLUGIN_LINK_PREFIX) {
        ("plugin", "invalid plugin id or URL shape")
    } else if url.starts_with(NOTE_LINK_PREFIX) {
        ("note", "invalid note path or URL shape")
    } else if url.starts_with("moldavite://") {
        ("unknown", "unsupported Moldavite route")
    } else {
        ("external", "unsupported URL scheme")
    }
}

/// Validate OS-delivered URLs, queue supported requests, and wake a live UI.
pub(crate) fn route_urls<R, I, S>(app: &AppHandle<R>, urls: I)
where
    R: Runtime,
    I: IntoIterator<Item = S>,
    S: AsRef<str>,
{
    let mut paths = Vec::new();
    for url in urls {
        let url = url.as_ref();

        // The WordPress.com callback is handled entirely in Rust and is never
        // queued: it carries an authorization code, and nothing that can be
        // exchanged for an account token belongs in the webview. It is also
        // checked against the state this process generated, because any local
        // process can ask the OS to open a `moldavite://` URL.
        if crate::wordpress::oauth::parse_callback(url).is_some() {
            crate::wordpress::handle_callback(app, url.to_owned());
            continue;
        }

        if let Some(path) = loose_files::file_url_path(url) {
            paths.push(path);
            continue;
        }

        let Some(request) = request_from_url(url) else {
            let (route, reason) = rejected_url_context(url);
            log::info!("[deep-link] ignored URL route={route} reason={reason}");
            continue;
        };

        deliver(app, request);
    }
    if !paths.is_empty() {
        route_paths(app, paths);
    }
}

#[tauri::command]
pub(crate) fn was_launched_with_file(state: State<'_, PendingDeepLinks>) -> bool {
    state.launched_with_file.load(Ordering::SeqCst)
}

/// Atomically hand all validated requests to the initialized frontend.
#[tauri::command]
pub(crate) fn take_pending_deep_links(state: State<'_, PendingDeepLinks>) -> Vec<DeepLinkRequest> {
    DRAINED.store(true, Ordering::SeqCst);
    match state.pending.lock() {
        Ok(mut pending) => pending.drain(..).collect(),
        Err(error) => {
            log::warn!("[deep-link] could not drain requests: {error}");
            Vec::new()
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{
        note_path_from_url, plugin_id_from_url, request_from_url, DeepLinkRequest,
        PendingDeepLinks, MAX_PENDING_DEEP_LINKS,
    };

    #[test]
    fn routes_only_the_plugin_install_shape() {
        assert_eq!(
            plugin_id_from_url("moldavite://plugin/publish-wordpress"),
            Some("publish-wordpress")
        );
        assert_eq!(plugin_id_from_url("moldavite://plugin/a"), Some("a"));
    }

    #[test]
    fn routes_today_exactly_and_nothing_that_looks_like_it() {
        assert_eq!(
            request_from_url("moldavite://today"),
            Some(DeepLinkRequest::Today)
        );
        assert_eq!(
            request_from_url("moldavite://today/"),
            Some(DeepLinkRequest::Today)
        );
        for url in [
            "moldavite://today?x=1",
            "moldavite://todays",
            "moldavite://Today",
            "moldavite://today/extra",
        ] {
            assert_eq!(request_from_url(url), None, "unexpected route for {url}");
        }
    }

    #[test]
    fn routes_root_and_foldered_note_paths() {
        assert_eq!(
            request_from_url("moldavite://note/valid-id.md"),
            Some(DeepLinkRequest::Note {
                path: "valid-id.md".to_string(),
            })
        );
        assert_eq!(
            note_path_from_url("moldavite://note/Root%20note.md"),
            Some("Root note.md".to_string())
        );
        assert_eq!(
            note_path_from_url("moldavite://note/Projects%2FRoadmap.md"),
            Some("Projects/Roadmap.md".to_string())
        );
    }

    #[test]
    fn decodes_percent_encoded_unicode_names() {
        assert_eq!(
            note_path_from_url("moldavite://note/Projects%2Fcaf%C3%A9%20notes.md"),
            Some("Projects/café notes.md".to_string())
        );
    }

    #[test]
    fn rejects_unsafe_note_paths() {
        for url in [
            "moldavite://note/../evil.md",
            "moldavite://note/Projects%2F..%2Fevil.md",
            "moldavite://note/%2Fabsolute.md",
            "moldavite://note/C%3A%2Fevil.md",
            "moldavite://note/C:/evil.md",
            "moldavite://note/Projects%5Cevil.md",
            "moldavite://note/.trash%2Fevil.md",
        ] {
            assert_eq!(note_path_from_url(url), None, "unexpected route for {url}");
        }
    }

    #[test]
    fn rejects_malformed_or_unsupported_note_urls() {
        for url in [
            "moldavite://note/",
            "moldavite://note/no-extension",
            "moldavite://note/bad%2",
            "moldavite://note/bad%GG.md",
            "moldavite://note/valid.md?query=true",
            "moldavite://note/valid.md#fragment",
            "https://note/valid.md",
            "MOLDAVITE://note/valid.md",
        ] {
            assert_eq!(note_path_from_url(url), None, "unexpected route for {url}");
        }
    }

    #[test]
    fn rejects_other_routes_and_invalid_plugin_ids() {
        for url in [
            "moldavite://plugin/",
            "moldavite://plugin/-leading-hyphen",
            "moldavite://plugin/Uppercase",
            "moldavite://plugin/has space",
            "moldavite://plugin/valid-id/extra",
            "moldavite://plugin/valid-id?confirm=true",
            "moldavite://plugin/valid-id#fragment",
            "moldavite://plugins/valid-id",
            "moldavite://note/valid-id.md",
            "https://plugin/valid-id",
            "MOLDAVITE://plugin/valid-id",
        ] {
            assert_eq!(plugin_id_from_url(url), None, "unexpected route for {url}");
        }
    }

    #[test]
    fn security_regression_pending_deep_link_queue_is_bounded() {
        let pending = PendingDeepLinks::default();
        for index in 0..=MAX_PENDING_DEEP_LINKS {
            pending
                .push(DeepLinkRequest::Plugin {
                    id: format!("plugin-{index}"),
                })
                .unwrap();
        }

        assert_eq!(
            pending.pending.lock().unwrap().len(),
            MAX_PENDING_DEEP_LINKS
        );
    }

    #[test]
    #[cfg(not(windows))]
    fn a_file_url_queues_a_loose_file_and_refuses_what_admission_refuses() {
        use tauri::Manager;

        let app = tauri::test::mock_app();
        app.manage(PendingDeepLinks::default());
        app.manage(crate::loose_files::LooseFiles::default());
        let dir = std::env::temp_dir().join(format!(
            "moldavite-deep-link-file-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir_all(&dir).unwrap();
        let note = dir.join("Read me.md");
        std::fs::write(&note, "# Hello").unwrap();
        std::fs::write(dir.join("notes.txt"), "plain").unwrap();
        std::fs::write(dir.join("secret.md"), "private").unwrap();
        let url = |name: &str| {
            tauri::Url::from_file_path(dir.join(name))
                .unwrap()
                .to_string()
        };

        let secret_url = url("secret.md");
        assert!(!super::was_launched_with_file(app.state()));
        super::route_urls(
            app.handle(),
            [
                secret_url.replacen("file:", "moldavite:", 1),
                secret_url.replacen("file://", "moldavite://localhost", 1),
                url("Read me.md"),
                url("notes.txt"),
            ],
        );
        assert!(super::was_launched_with_file(app.state()));

        let pending = app.state::<PendingDeepLinks>();
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(2);
        while pending.pending.lock().unwrap().is_empty() {
            assert!(
                std::time::Instant::now() < deadline,
                "File admission was never delivered"
            );
            std::thread::sleep(std::time::Duration::from_millis(10));
        }
        let queued: Vec<_> = pending.pending.lock().unwrap().drain(..).collect();
        std::fs::remove_dir_all(&dir).ok();
        assert_eq!(queued.len(), 1, "{queued:?}");
        assert_eq!(
            app.state::<crate::loose_files::LooseFiles>()
                .list_open(None)
                .len(),
            1
        );
        match &queued[0] {
            DeepLinkRequest::LooseFile { id, name, .. } => {
                assert_eq!(name, "Read me.md");
                assert_eq!(id.len(), 32);
            }
            other => panic!("expected a loose file, got {other:?}"),
        }
    }

    #[test]
    #[cfg(not(windows))]
    fn file_urls_are_delivered_in_reported_order() {
        use tauri::Manager;

        let app = tauri::test::mock_app();
        app.manage(PendingDeepLinks::default());
        app.manage(crate::loose_files::LooseFiles::default());
        let dir = std::env::temp_dir().join(format!(
            "moldavite-url-order-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir_all(&dir).unwrap();
        let names = ["First.md", "Second.md", "Third.md"];
        for (index, name) in names.iter().enumerate() {
            std::fs::write(
                dir.join(name),
                if index == 0 {
                    "a".repeat(9_000_000)
                } else {
                    "small".to_string()
                },
            )
            .unwrap();
        }
        super::route_urls(
            app.handle(),
            names.map(|name| {
                tauri::Url::from_file_path(dir.join(name))
                    .unwrap()
                    .to_string()
            }),
        );
        let pending = app.state::<PendingDeepLinks>();
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(5);
        while pending.pending.lock().unwrap().len() < names.len() {
            assert!(
                std::time::Instant::now() < deadline,
                "File admission was never delivered"
            );
            std::thread::sleep(std::time::Duration::from_millis(10));
        }
        let queued: Vec<_> = pending
            .pending
            .lock()
            .unwrap()
            .drain(..)
            .map(|request| match request {
                DeepLinkRequest::LooseFile { name, .. } => name,
                other => panic!("expected a loose file, got {other:?}"),
            })
            .collect();
        std::fs::remove_dir_all(&dir).ok();
        assert_eq!(queued, names);
    }

    #[test]
    fn security_regression_rejected_deep_link_log_omits_raw_url() {
        let source = include_str!("deep_link.rs");
        let unsafe_pattern = ["ignored unsupported", " URL: {url}"].concat();
        assert!(!source.contains(&unsafe_pattern));
    }
}

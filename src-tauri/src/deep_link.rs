//! Strict routing for URLs that open app content or plugin install prompts.
//!
//! Deep-link URLs are untrusted OS input. Only `moldavite://plugin/<id>` and
//! `moldavite://note/<path>` are routed. Plugin ids follow the installer rules;
//! note paths use the validator for addressing existing visible notes.

use std::collections::VecDeque;
use std::sync::Mutex;

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, Runtime, State};

use crate::commands::plugins::is_valid_plugin_id;
use crate::validation::is_safe_existing_note_path;

const PLUGIN_LINK_PREFIX: &str = "moldavite://plugin/";
const NOTE_LINK_PREFIX: &str = "moldavite://note/";
pub(crate) const DEEP_LINK_EVENT: &str = "deep-link-requested";

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub(crate) enum DeepLinkRequest {
    Plugin { id: String },
    Note { path: String },
}

/// Valid links wait here until the frontend is ready to drain them.
#[derive(Default)]
pub(crate) struct PendingDeepLinks(Mutex<VecDeque<DeepLinkRequest>>);

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
    if let Some(id) = plugin_id_from_url(url) {
        return Some(DeepLinkRequest::Plugin { id: id.to_owned() });
    }
    note_path_from_url(url).map(|path| DeepLinkRequest::Note { path })
}

/// Validate OS-delivered URLs, queue supported requests, and wake a live UI.
pub(crate) fn route_urls<R, I, S>(app: &AppHandle<R>, urls: I)
where
    R: Runtime,
    I: IntoIterator<Item = S>,
    S: AsRef<str>,
{
    let state = app.state::<PendingDeepLinks>();
    for url in urls {
        let url = url.as_ref();
        let Some(request) = request_from_url(url) else {
            log::info!("[deep-link] ignored unsupported URL: {url}");
            continue;
        };

        match state.0.lock() {
            Ok(mut pending) => pending.push_back(request),
            Err(error) => {
                log::warn!("[deep-link] could not queue request: {error}");
                continue;
            }
        }

        if let Err(error) = app.emit(DEEP_LINK_EVENT, ()) {
            // A cold-start WebView may not be listening yet. The queued request
            // is intentionally retained for `take_pending_deep_links`.
            log::info!("[deep-link] frontend not ready for event: {error}");
        }
    }
}

/// Atomically hand all validated requests to the initialized frontend.
#[tauri::command]
pub(crate) fn take_pending_deep_links(state: State<'_, PendingDeepLinks>) -> Vec<DeepLinkRequest> {
    match state.0.lock() {
        Ok(mut pending) => pending.drain(..).collect(),
        Err(error) => {
            log::warn!("[deep-link] could not drain requests: {error}");
            Vec::new()
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{note_path_from_url, plugin_id_from_url, request_from_url, DeepLinkRequest};

    #[test]
    fn routes_only_the_plugin_install_shape() {
        assert_eq!(
            plugin_id_from_url("moldavite://plugin/publish-wordpress"),
            Some("publish-wordpress")
        );
        assert_eq!(plugin_id_from_url("moldavite://plugin/a"), Some("a"));
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
}

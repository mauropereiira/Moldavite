//! Strict routing for website-initiated community-plugin install links.
//!
//! Deep-link URLs are untrusted OS input. Only `moldavite://plugin/<id>` is
//! routed, and the final segment must satisfy the same id rules as plugin
//! folders and install commands.

use std::collections::VecDeque;
use std::sync::Mutex;

use tauri::{AppHandle, Emitter, Manager, Runtime, State};

use crate::commands::plugins::is_valid_plugin_id;

const PLUGIN_LINK_PREFIX: &str = "moldavite://plugin/";
pub(crate) const PLUGIN_INSTALL_EVENT: &str = "plugin-install-requested";

/// Valid links wait here until the frontend is ready to drain them.
#[derive(Default)]
pub(crate) struct PendingPluginInstallLinks(Mutex<VecDeque<String>>);

/// Return the requested plugin id only for the one supported URL shape.
pub(crate) fn plugin_id_from_url(url: &str) -> Option<&str> {
    let id = url.strip_prefix(PLUGIN_LINK_PREFIX)?;
    if is_valid_plugin_id(id) {
        Some(id)
    } else {
        None
    }
}

/// Validate OS-delivered URLs, queue supported requests, and wake a live UI.
pub(crate) fn route_urls<R, I, S>(app: &AppHandle<R>, urls: I)
where
    R: Runtime,
    I: IntoIterator<Item = S>,
    S: AsRef<str>,
{
    let state = app.state::<PendingPluginInstallLinks>();
    for url in urls {
        let url = url.as_ref();
        let Some(id) = plugin_id_from_url(url) else {
            log::info!("[deep-link] ignored unsupported URL: {url}");
            continue;
        };

        match state.0.lock() {
            Ok(mut pending) => pending.push_back(id.to_owned()),
            Err(error) => {
                log::warn!("[deep-link] could not queue plugin request: {error}");
                continue;
            }
        }

        if let Err(error) = app.emit(PLUGIN_INSTALL_EVENT, ()) {
            // A cold-start WebView may not be listening yet. The queued id is
            // intentionally retained for `take_pending_plugin_install_links`.
            log::info!("[deep-link] frontend not ready for event: {error}");
        }
    }
}

/// Atomically hand all validated requests to the initialized frontend.
#[tauri::command]
pub(crate) fn take_pending_plugin_install_links(
    state: State<'_, PendingPluginInstallLinks>,
) -> Vec<String> {
    match state.0.lock() {
        Ok(mut pending) => pending.drain(..).collect(),
        Err(error) => {
            log::warn!("[deep-link] could not drain plugin requests: {error}");
            Vec::new()
        }
    }
}

#[cfg(test)]
mod tests {
    use super::plugin_id_from_url;

    #[test]
    fn routes_only_the_plugin_install_shape() {
        assert_eq!(
            plugin_id_from_url("moldavite://plugin/publish-wordpress"),
            Some("publish-wordpress")
        );
        assert_eq!(plugin_id_from_url("moldavite://plugin/a"), Some("a"));
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
            "moldavite://note/valid-id",
            "https://plugin/valid-id",
            "MOLDAVITE://plugin/valid-id",
        ] {
            assert_eq!(plugin_id_from_url(url), None, "unexpected route for {url}");
        }
    }
}

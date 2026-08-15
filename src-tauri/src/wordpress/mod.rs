//! Publish a note to WordPress.com.
//!
//! The account is connected once, in the system browser, and the token lives
//! in the OS credential store. Nothing here asks the user to create or paste a
//! credential — that was the whole problem with the Application Password path,
//! which remains available as a plugin for self-hosted sites that have no
//! WordPress.com account.

pub(crate) mod api;
pub(crate) mod oauth;

use tauri::{AppHandle, Manager, Runtime};
use tauri_plugin_shell::ShellExt;

pub(crate) use oauth::PendingAuth;

use api::{PublishedPost, WordPressSite};

/// What Settings needs to draw the WordPress section without guessing.
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct WordPressStatus {
    /// False in a build without credentials, so the UI can say so plainly
    /// rather than offering a button that cannot work.
    available: bool,
    connected: bool,
    error: Option<String>,
}

#[tauri::command]
pub(crate) fn wordpress_status() -> WordPressStatus {
    if !oauth::is_configured() {
        return WordPressStatus {
            available: false,
            connected: false,
            error: Some(oauth::not_configured_message()),
        };
    }
    match oauth::stored_token() {
        Ok(token) => WordPressStatus {
            available: true,
            connected: token.is_some(),
            error: None,
        },
        Err(error) => WordPressStatus {
            available: true,
            connected: false,
            error: Some(error),
        },
    }
}

/// Open WordPress.com in the system browser. Completion arrives later, over
/// the `moldavite://` callback, and is reported on the `wordpress:auth` event.
#[tauri::command]
pub(crate) async fn wordpress_connect<R: Runtime>(app: AppHandle<R>) -> Result<(), String> {
    let url = oauth::begin(&app)?;

    // `Shell::open` is deprecated in favour of tauri-plugin-opener; kept for
    // the same reason `calendar::oauth` keeps it — the shell plugin is already
    // a dependency and the opener plugin would add one for a single call site.
    //
    // Residual exposure, and it is sharper here than for Google. This shells
    // out to `/usr/bin/open <url>` on macOS, so the authorization URL — `state`
    // included — is briefly readable in the process argument list by any
    // process running as the same user. Google's flow answers on a loopback
    // port an attacker would also have to win a race for; this one answers on
    // a custom scheme *any* local process may invoke. So a same-user attacker
    // who reads the state during that window could complete consent against
    // their own WordPress.com account and leave the app connected to it.
    //
    // The state check still does its job against everything else: an
    // unsolicited callback, a replayed one, or one for an abandoned attempt.
    // Closing this last gap means launching the browser without a child
    // process — NSWorkspace through the existing Swift bridge is the route.
    #[allow(deprecated)]
    app.shell()
        .open(url, None)
        .map_err(|e| format!("Could not open the browser: {e}"))
}

#[tauri::command]
pub(crate) fn wordpress_disconnect() -> Result<(), String> {
    oauth::forget_token()
}

fn require_token() -> Result<String, String> {
    oauth::stored_token()?
        .ok_or_else(|| "Connect a WordPress.com account in Settings first.".to_string())
}

#[tauri::command]
pub(crate) async fn wordpress_sites() -> Result<Vec<WordPressSite>, String> {
    api::list_sites(&require_token()?).await
}

#[tauri::command]
pub(crate) async fn wordpress_publish(
    site_id: u64,
    title: String,
    content: String,
    existing_post_id: Option<u64>,
) -> Result<PublishedPost, String> {
    api::publish(
        &require_token()?,
        site_id,
        &title,
        &content,
        existing_post_id,
    )
    .await
}

/// Called from the deep-link router for a callback URL. Runs the exchange off
/// the caller's thread; the result reaches the UI as an event.
pub(crate) fn handle_callback<R: Runtime>(app: &AppHandle<R>, url: String) {
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        oauth::complete(app, url).await;
    });
}

/// Register the one piece of state the flow needs.
pub(crate) fn init<R: Runtime>(app: &AppHandle<R>) {
    app.manage(PendingAuth::default());
}

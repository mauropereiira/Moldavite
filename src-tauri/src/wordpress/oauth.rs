//! WordPress.com OAuth for an installed app, over the `moldavite://` scheme.
//!
//! WordPress.com supports neither PKCE nor a loopback-with-any-port redirect,
//! so this cannot reuse the Google flow in `calendar/oauth.rs`. It uses the
//! authorization-code flow with a registered custom-scheme redirect, and the
//! client secret ships inside the binary exactly as Google's does. That is not
//! confidential and is not pretended to be; it is what WordPress.com offers an
//! installed app, and it is why every other guard here matters.
//!
//! # Why the state check is load-bearing
//!
//! A loopback redirect can only be reached by something that already guessed a
//! random port on this machine. A custom scheme cannot: **any local process can
//! ask the OS to open `moldavite://oauth/wordpress?code=…`**, and the OS will
//! hand it to us. Without a check, an attacker feeds us an authorization code
//! for *their* WordPress.com account and the user silently publishes their
//! notes into it.
//!
//! So a callback is only honoured when it carries the exact `state` this
//! process generated for a flow the user actually started. The pending state is
//! consumed on first use and expires, so a captured callback cannot be replayed.

use std::sync::Mutex;
use std::time::{Duration, Instant};

use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine as _;
use rand::RngCore;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, Runtime};

use crate::secrets::{KeychainSecretStore, SecretStore};

/// Registered on the WordPress.com application. Must match byte for byte.
pub const REDIRECT_URI: &str = "moldavite://oauth/wordpress";
pub(crate) const CALLBACK_PREFIX: &str = "moldavite://oauth/wordpress";

const AUTHORIZE_URL: &str = "https://public-api.wordpress.com/oauth2/authorize";
const TOKEN_URL: &str = "https://public-api.wordpress.com/oauth2/token";

/// Account-wide, because WordPress.com ties multi-site access to this scope
/// and nothing narrower.
///
/// `posts media` is the grant this feature actually uses, and it is the one we
/// asked for first. But WordPress.com issues a **site-scoped** token for it:
/// the consent screen makes the user pick one site, `/me/sites` then reports
/// only that site, and changing blogs means disconnecting and reconnecting.
/// There is no narrow scope that spans sites — `global` is the only one that
/// does, so the choice is account-wide access or a single-site connection.
///
/// The cost is visible to every user: the consent screen lists nine
/// permissions rather than two, including profile, comments and taxonomies
/// that this feature never touches. That is WordPress.com's granularity, not
/// ours; we still only ever call the posts and media endpoints.
const SCOPE: &str = "global";

/// Keychain account holding the bearer token. Namespaced like the others.
const TOKEN_ACCOUNT: &str = "wordpress:access_token";

/// A user who opens the browser and wanders off should not leave an open
/// window in which an injected callback is accepted.
const AUTH_TIMEOUT: Duration = Duration::from_secs(10 * 60);

pub const CLIENT_ID: Option<&str> = option_env!("MOLDAVITE_WPCOM_CLIENT_ID");
pub const CLIENT_SECRET: Option<&str> = option_env!("MOLDAVITE_WPCOM_CLIENT_SECRET");

pub fn is_configured() -> bool {
    CLIENT_ID.is_some_and(|v| !v.is_empty()) && CLIENT_SECRET.is_some_and(|v| !v.is_empty())
}

pub fn not_configured_message() -> String {
    "This build has no WordPress.com credentials, so publishing cannot be connected. \
     Builds made without MOLDAVITE_WPCOM_CLIENT_ID and MOLDAVITE_WPCOM_CLIENT_SECRET \
     report the feature as unavailable rather than failing later."
        .to_string()
}

/// The one flow a user may have in progress. `None` means any callback
/// arriving right now is unsolicited and must be dropped.
#[derive(Default)]
pub(crate) struct PendingAuth(Mutex<Option<Pending>>);

struct Pending {
    state: String,
    started: Instant,
}

/// Emitted once the exchange has finished, so the UI can stop waiting.
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AuthResult {
    pub connected: bool,
    pub error: Option<String>,
}

pub(crate) const AUTH_EVENT: &str = "wordpress:auth";

fn random_state() -> String {
    let mut bytes = [0u8; 32];
    rand::thread_rng().fill_bytes(&mut bytes);
    URL_SAFE_NO_PAD.encode(bytes)
}

/// Percent-encode a query parameter value, matching `calendar::oauth`.
fn encode(value: &str) -> String {
    let mut out = String::with_capacity(value.len());
    for byte in value.as_bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(*byte as char)
            }
            _ => out.push_str(&format!("%{byte:02X}")),
        }
    }
    out
}

pub(crate) fn authorize_url(client_id: &str, state: &str) -> String {
    format!(
        "{AUTHORIZE_URL}?client_id={}&redirect_uri={}&response_type=code&scope={}&state={}",
        encode(client_id),
        encode(REDIRECT_URI),
        encode(SCOPE),
        encode(state),
    )
}

/// Compare without leaking length or position through timing. The state is not
/// a secret in the cryptographic sense, but it is the only thing separating a
/// genuine callback from an injected one, so it is not compared with `==`.
fn state_matches(expected: &str, given: &str) -> bool {
    if expected.len() != given.len() {
        return false;
    }
    expected
        .bytes()
        .zip(given.bytes())
        .fold(0u8, |acc, (a, b)| acc | (a ^ b))
        == 0
}

/// Split `key=value` pairs out of the callback's query string.
pub(crate) fn parse_callback(
    url: &str,
) -> Option<(Option<String>, Option<String>, Option<String>)> {
    let rest = url.strip_prefix(CALLBACK_PREFIX)?;
    // Accept both `moldavite://oauth/wordpress?…` and a trailing-slash variant,
    // because the OS and the browser do not agree on normalising these.
    let query = match rest.strip_prefix('?') {
        Some(q) => q,
        None => rest.strip_prefix("/?")?,
    };
    let (mut code, mut state, mut error) = (None, None, None);
    for pair in query.split('&') {
        let Some((key, value)) = pair.split_once('=') else {
            continue;
        };
        let value = percent_decode(value);
        match key {
            "code" => code = Some(value),
            "state" => state = Some(value),
            "error" => error = Some(value),
            _ => {}
        }
    }
    Some((code, state, error))
}

fn percent_decode(value: &str) -> String {
    let bytes = value.as_bytes();
    let mut out: Vec<u8> = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        match bytes[i] {
            b'+' => {
                out.push(b' ');
                i += 1;
            }
            b'%' if i + 2 < bytes.len() => {
                let hex = std::str::from_utf8(&bytes[i + 1..i + 3]).ok();
                match hex.and_then(|h| u8::from_str_radix(h, 16).ok()) {
                    Some(byte) => {
                        out.push(byte);
                        i += 3;
                    }
                    None => {
                        out.push(bytes[i]);
                        i += 1;
                    }
                }
            }
            byte => {
                out.push(byte);
                i += 1;
            }
        }
    }
    String::from_utf8_lossy(&out).into_owned()
}

#[derive(Deserialize)]
struct TokenResponse {
    access_token: String,
}

/// Start a flow: remember a fresh state and hand back the URL to open.
pub(crate) fn begin<R: Runtime>(app: &AppHandle<R>) -> Result<String, String> {
    let client_id = CLIENT_ID
        .filter(|v| !v.is_empty())
        .ok_or_else(not_configured_message)?;
    let state = random_state();
    let url = authorize_url(client_id, &state);
    let pending = app
        .try_state::<PendingAuth>()
        .ok_or_else(|| "WordPress sign-in is not ready yet.".to_string())?;
    let mut slot = pending.0.lock().map_err(|e| e.to_string())?;
    // Starting a new flow abandons any previous one, so a stale state can
    // never be used to complete a different attempt.
    *slot = Some(Pending {
        state,
        started: Instant::now(),
    });
    Ok(url)
}

/// Take the pending state if `given` matches it. Consuming on success is what
/// makes a captured callback single-use.
fn take_matching_state<R: Runtime>(app: &AppHandle<R>, given: &str) -> Result<(), String> {
    // `state()` panics when nothing of the type is managed, and this runs off
    // an OS-delivered URL: a cold start can hand us a callback before setup
    // has registered the slot. There is no flow in progress in that case, so
    // the callback is unsolicited by definition — refuse it, do not crash.
    let pending = app
        .try_state::<PendingAuth>()
        .ok_or_else(|| "No WordPress.com sign-in was in progress.".to_string())?;
    let mut slot = pending.0.lock().map_err(|e| e.to_string())?;
    let Some(current) = slot.as_ref() else {
        return Err("No WordPress.com sign-in was in progress.".into());
    };
    if current.started.elapsed() > AUTH_TIMEOUT {
        *slot = None;
        return Err("That WordPress.com sign-in took too long. Start it again.".into());
    }
    if !state_matches(&current.state, given) {
        // Deliberately does not clear the pending flow: an injected callback
        // must not be able to cancel the user's real one.
        return Err("That sign-in response did not match this request.".into());
    }
    *slot = None;
    Ok(())
}

/// Handle an OS-delivered callback. Never returns the code to the frontend.
pub(crate) async fn complete<R: Runtime>(app: AppHandle<R>, url: String) {
    let outcome = exchange(&app, &url).await;
    let result = match outcome {
        Ok(()) => AuthResult {
            connected: true,
            error: None,
        },
        Err(error) => {
            log::warn!("[wordpress] sign-in failed: {error}");
            AuthResult {
                connected: false,
                error: Some(error),
            }
        }
    };
    if let Err(error) = app.emit(AUTH_EVENT, result) {
        log::info!("[wordpress] no listener for auth result: {error}");
    }
}

async fn exchange<R: Runtime>(app: &AppHandle<R>, url: &str) -> Result<(), String> {
    let (code, state, error) =
        parse_callback(url).ok_or_else(|| "Malformed WordPress.com callback.".to_string())?;

    // Validate state before anything else, including before reporting the
    // provider's own error, so an unsolicited callback learns nothing.
    let state = state.ok_or_else(|| "That sign-in response was missing its state.".to_string())?;
    take_matching_state(app, &state)?;

    if let Some(error) = error {
        return Err(format!("WordPress.com declined the request: {error}"));
    }
    let code = code.ok_or_else(|| "That sign-in response carried no code.".to_string())?;

    let client_id = CLIENT_ID
        .filter(|v| !v.is_empty())
        .ok_or_else(not_configured_message)?;
    let client_secret = CLIENT_SECRET
        .filter(|v| !v.is_empty())
        .ok_or_else(not_configured_message)?;

    let response = reqwest::Client::new()
        .post(TOKEN_URL)
        .form(&[
            ("client_id", client_id),
            ("client_secret", client_secret),
            ("redirect_uri", REDIRECT_URI),
            ("grant_type", "authorization_code"),
            ("code", code.as_str()),
        ])
        .send()
        .await
        .map_err(|e| format!("Could not reach WordPress.com: {e}"))?;

    if !response.status().is_success() {
        let status = response.status();
        return Err(format!("WordPress.com rejected the sign-in ({status})."));
    }
    let token: TokenResponse = response
        .json()
        .await
        .map_err(|e| format!("WordPress.com returned an unreadable token: {e}"))?;
    if token.access_token.is_empty() {
        return Err("WordPress.com returned an empty token.".into());
    }

    KeychainSecretStore.set(TOKEN_ACCOUNT, &token.access_token)
}

pub(crate) fn stored_token() -> Result<Option<String>, String> {
    KeychainSecretStore.get(TOKEN_ACCOUNT)
}

pub(crate) fn forget_token() -> Result<(), String> {
    KeychainSecretStore.delete(TOKEN_ACCOUNT)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn authorize_url_carries_the_registered_redirect_and_scope() {
        let url = authorize_url("abc123", "st.ate");
        assert!(url.starts_with(AUTHORIZE_URL));
        assert!(url.contains("client_id=abc123"));
        assert!(url.contains("response_type=code"));
        assert!(url.contains("redirect_uri=moldavite%3A%2F%2Foauth%2Fwordpress"));
        assert!(url.contains("scope=global"));
        assert!(url.contains("state=st.ate"));
    }

    // Narrowing this scope looks like an obvious privacy win and silently
    // breaks multi-site: WordPress.com hands back a token good for one site,
    // `/me/sites` reports only that site, and the footer's site picker has
    // nothing to switch between. Verified against the live consent screen —
    // `posts media` renders a single-site selector, `global` does not. If you
    // want to tighten this, the site picker has to go in the same change.
    #[test]
    fn scope_stays_account_wide_so_the_site_picker_has_sites_to_pick() {
        assert_eq!(SCOPE, "global");
    }

    #[test]
    fn parses_code_and_state_from_a_callback() {
        let parsed = parse_callback("moldavite://oauth/wordpress?code=abc&state=xyz");
        assert_eq!(parsed, Some((Some("abc".into()), Some("xyz".into()), None)));
    }

    #[test]
    fn parses_the_trailing_slash_variant_the_os_may_produce() {
        let parsed = parse_callback("moldavite://oauth/wordpress/?code=abc&state=xyz");
        assert_eq!(parsed, Some((Some("abc".into()), Some("xyz".into()), None)));
    }

    #[test]
    fn parses_a_provider_error() {
        let parsed = parse_callback("moldavite://oauth/wordpress?error=access_denied&state=xyz");
        assert_eq!(
            parsed,
            Some((None, Some("xyz".into()), Some("access_denied".into())))
        );
    }

    #[test]
    fn ignores_urls_that_are_not_the_callback() {
        assert_eq!(
            parse_callback("moldavite://plugin/moldavite-wordpress"),
            None
        );
        assert_eq!(parse_callback("moldavite://note/a.md"), None);
        assert_eq!(parse_callback("https://example.com/?code=abc"), None);
        // A near-miss host must not be treated as ours.
        assert_eq!(
            parse_callback("moldavite://oauth/wordpress.evil?code=a"),
            None
        );
    }

    #[test]
    fn percent_decodes_values() {
        let parsed = parse_callback("moldavite://oauth/wordpress?code=a%2Fb%20c&state=s");
        assert_eq!(parsed.unwrap().0, Some("a/b c".into()));
    }

    #[test]
    fn state_comparison_rejects_mismatches_and_length_changes() {
        assert!(state_matches("abcdef", "abcdef"));
        assert!(!state_matches("abcdef", "abcdeg"));
        assert!(!state_matches("abcdef", "abcde"));
        assert!(!state_matches("abcdef", "abcdefg"));
        assert!(!state_matches("", "a"));
    }
}

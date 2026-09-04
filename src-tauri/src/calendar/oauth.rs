//! Google OAuth for an installed app: PKCE plus a loopback redirect.
//!
//! The whole flow lives in Rust on purpose. No token ever reaches the webview,
//! so the CSP in `tauri.conf.json` needs no `accounts.google.com` exception and
//! a compromised plugin cannot read the calendar credentials.
//!
//! The client secret Google issues for a "Desktop app" client is not
//! confidential — it ships inside every copy of the binary, which is why PKCE
//! carries the actual security here. It is still read from the environment at
//! build time rather than committed, so it stays out of a public repository.

use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine as _;
use rand::RngCore;
use serde::Deserialize;
use sha2::{Digest, Sha256};
use std::io::{BufRead, BufReader, Write};
use std::net::TcpListener;
use std::time::{Duration, Instant};
use tauri_plugin_shell::ShellExt;

use crate::secrets::{KeychainSecretStore, SecretStore};

const AUTH_ENDPOINT: &str = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_ENDPOINT: &str = "https://oauth2.googleapis.com/token";
const SCOPE: &str = "https://www.googleapis.com/auth/calendar.readonly";
const REFRESH_TOKEN_ACCOUNT: &str = "calendar:google:refresh_token";

/// How long to wait for the user to finish consent before giving up, so an
/// abandoned browser tab cannot block a thread for the life of the process.
const CALLBACK_TIMEOUT: Duration = Duration::from_secs(300);

/// Refresh slightly before real expiry; a token that dies mid-request costs a
/// round trip and an error the user would see.
const EXPIRY_MARGIN: Duration = Duration::from_secs(60);

/// How often the non-blocking accept loop re-checks for a connection. Short
/// enough that consent feels instant, long enough not to spin a core.
const ACCEPT_POLL_INTERVAL: Duration = Duration::from_millis(100);

pub const CLIENT_ID: Option<&str> = option_env!("MOLDAVITE_GOOGLE_CLIENT_ID");
pub const CLIENT_SECRET: Option<&str> = option_env!("MOLDAVITE_GOOGLE_CLIENT_SECRET");

/// Whether this build carries Google credentials at all. A local build without
/// them must still compile and run — the source simply reports unavailable.
pub fn is_configured() -> bool {
    CLIENT_ID.is_some_and(|v| !v.is_empty()) && CLIENT_SECRET.is_some_and(|v| !v.is_empty())
}

pub fn not_configured_message() -> String {
    "Google Calendar is not configured in this build.".to_string()
}

#[derive(Debug, Clone)]
pub struct AccessToken {
    pub value: String,
    pub expires_at: Instant,
}

impl AccessToken {
    /// Treat a token inside the margin as already expired.
    pub fn is_usable(&self, now: Instant) -> bool {
        self.expires_at
            .checked_duration_since(now)
            .map(|left| left > EXPIRY_MARGIN)
            .unwrap_or(false)
    }
}

#[derive(Debug, Deserialize)]
pub struct TokenResponse {
    pub access_token: String,
    pub expires_in: u64,
    #[serde(default)]
    pub refresh_token: Option<String>,
}

impl TokenResponse {
    pub fn into_access_token(self, now: Instant) -> Result<(AccessToken, Option<String>), String> {
        let expires_at = now
            .checked_add(Duration::from_secs(self.expires_in))
            .ok_or_else(|| "Google returned an invalid token expiry.".to_string())?;
        Ok((
            AccessToken {
                value: self.access_token,
                expires_at,
            },
            self.refresh_token,
        ))
    }
}

/// A PKCE verifier and its S256 challenge.
pub struct Pkce {
    pub verifier: String,
    pub challenge: String,
}

pub fn generate_pkce() -> Pkce {
    let mut bytes = [0u8; 32];
    rand::thread_rng().fill_bytes(&mut bytes);
    let verifier = URL_SAFE_NO_PAD.encode(bytes);
    Pkce {
        challenge: challenge_for(&verifier),
        verifier,
    }
}

/// S256: base64url(sha256(verifier)), unpadded.
pub fn challenge_for(verifier: &str) -> String {
    let digest = Sha256::digest(verifier.as_bytes());
    URL_SAFE_NO_PAD.encode(digest)
}

fn random_state() -> String {
    let mut bytes = [0u8; 16];
    rand::thread_rng().fill_bytes(&mut bytes);
    URL_SAFE_NO_PAD.encode(bytes)
}

/// Percent-encode a query parameter value. Small by hand rather than pulling in
/// a URL crate for six call sites.
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

pub fn authorize_url(client_id: &str, redirect_uri: &str, challenge: &str, state: &str) -> String {
    format!(
        "{AUTH_ENDPOINT}?client_id={}&redirect_uri={}&response_type=code&scope={}\
         &access_type=offline&prompt=consent&code_challenge={}&code_challenge_method=S256&state={}",
        encode(client_id),
        encode(redirect_uri),
        encode(SCOPE),
        encode(challenge),
        encode(state),
    )
}

/// The `code` / `error` / `state` triple carried on the redirect.
#[derive(Debug, Default, PartialEq)]
pub struct Callback {
    pub code: Option<String>,
    pub state: Option<String>,
    pub error: Option<String>,
}

/// Parse the query out of an HTTP request line such as
/// `GET /?code=abc&state=xyz HTTP/1.1`.
pub fn parse_callback(request_line: &str) -> Callback {
    let mut callback = Callback::default();
    let Some(target) = request_line.split_whitespace().nth(1) else {
        return callback;
    };
    let Some((_, query)) = target.split_once('?') else {
        return callback;
    };
    for pair in query.split('&') {
        let Some((key, value)) = pair.split_once('=') else {
            continue;
        };
        let value = percent_decode(value);
        match key {
            "code" => callback.code = Some(value),
            "state" => callback.state = Some(value),
            "error" => callback.error = Some(value),
            _ => {}
        }
    }
    callback
}

fn percent_decode(value: &str) -> String {
    let bytes = value.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        match bytes[i] {
            b'+' => {
                out.push(b' ');
                i += 1;
            }
            b'%' if i + 2 < bytes.len() => {
                let hex = std::str::from_utf8(&bytes[i + 1..i + 3]).unwrap_or("");
                match u8::from_str_radix(hex, 16) {
                    Ok(byte) => {
                        out.push(byte);
                        i += 3;
                    }
                    Err(_) => {
                        out.push(bytes[i]);
                        i += 1;
                    }
                }
            }
            other => {
                out.push(other);
                i += 1;
            }
        }
    }
    String::from_utf8_lossy(&out).into_owned()
}

const CALLBACK_PAGE: &str = "<!doctype html><meta charset=\"utf-8\"><title>Moldavite</title>\
<body style=\"font-family:system-ui;padding:3rem;text-align:center\">\
<h1>Moldavite is connected</h1><p>You can close this tab and return to the app.</p>";

/// Bind a loopback listener and wait for Google to redirect the browser to it.
/// Returns the parsed callback, or an error on timeout.
///
/// Anything on the machine can connect to a loopback port, so a request is only
/// treated as our redirect when it carries the `state` we generated. Without
/// that check any local process could end the flow early by sending a bare
/// `?error=`, and the user would see a failure they did not cause. Google
/// echoes `state` on success and on error alike, so requiring it costs nothing.
///
/// The accept loop is non-blocking because a blocking `accept()` would park
/// here forever when the user abandons the consent tab — the deadline below is
/// only enforceable if we get to re-check it.
fn await_callback(listener: TcpListener, expected_state: &str) -> Result<Callback, String> {
    listener
        .set_nonblocking(true)
        .map_err(|e| format!("could not configure callback listener: {e}"))?;

    let deadline = Instant::now() + CALLBACK_TIMEOUT;
    // A browser may open speculative connections that send nothing. Keep
    // accepting until one actually carries the redirect or the deadline passes.
    loop {
        if Instant::now() >= deadline {
            return Err("Timed out waiting for Google to redirect back.".into());
        }

        let (mut stream, _) = match listener.accept() {
            Ok(pair) => pair,
            Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                std::thread::sleep(ACCEPT_POLL_INTERVAL);
                continue;
            }
            Err(e) => return Err(format!("callback connection failed: {e}")),
        };
        // The accepted socket can inherit the listener's non-blocking flag, and
        // the read below expects to block until the request line arrives.
        stream.set_nonblocking(false).ok();
        stream.set_read_timeout(Some(Duration::from_secs(10))).ok();

        let mut line = String::new();
        if BufReader::new(
            stream
                .try_clone()
                .map_err(|e| format!("callback connection failed: {e}"))?,
        )
        .read_line(&mut line)
        .is_err()
        {
            continue;
        }

        let callback = parse_callback(&line);
        if callback.state.as_deref() != Some(expected_state) {
            continue;
        }
        if callback.code.is_none() && callback.error.is_none() {
            continue;
        }

        let _ = write!(
            stream,
            "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
            CALLBACK_PAGE.len(),
            CALLBACK_PAGE
        );
        let _ = stream.flush();
        return Ok(callback);
    }
}

#[derive(Deserialize)]
struct OAuthErrorResponse {
    error: String,
}

fn allowlisted_oauth_error(code: &str) -> (&'static str, &'static str) {
    match code {
        "access_denied" => ("access_denied", "access was denied"),
        "invalid_client" => ("invalid_client", "the OAuth client was rejected"),
        "invalid_grant" => (
            "invalid_grant",
            "the authorization grant is invalid or expired",
        ),
        "invalid_request" => ("invalid_request", "the OAuth request was invalid"),
        "invalid_scope" => ("invalid_scope", "the requested scope was rejected"),
        "server_error" => ("server_error", "the OAuth service failed"),
        "temporarily_unavailable" => (
            "temporarily_unavailable",
            "the OAuth service is temporarily unavailable",
        ),
        "unauthorized_client" => ("unauthorized_client", "the OAuth client is not authorized"),
        "unsupported_grant_type" => (
            "unsupported_grant_type",
            "the OAuth grant type is unsupported",
        ),
        _ => ("oauth_error", "the OAuth request was rejected"),
    }
}

fn safe_oauth_error(status: reqwest::StatusCode, body: &str) -> String {
    let code = serde_json::from_str::<OAuthErrorResponse>(body)
        .ok()
        .map(|error| error.error)
        .unwrap_or_default();
    let (code, description) = allowlisted_oauth_error(&code);
    format!("Google rejected the token request ({status}): {code} ({description}).")
}

async fn post_token(params: &[(&str, &str)]) -> Result<TokenResponse, String> {
    let response = super::http_client()
        .post(TOKEN_ENDPOINT)
        .form(params)
        .send()
        .await
        .map_err(|e| format!("could not reach Google: {e}"))?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        return Err(safe_oauth_error(status, &body));
    }

    response
        .json::<TokenResponse>()
        .await
        .map_err(|e| format!("could not read Google's token response: {e}"))
}

/// Run the full consent flow and persist the resulting refresh token.
pub async fn connect(app: &tauri::AppHandle) -> Result<AccessToken, String> {
    let (Some(client_id), Some(client_secret)) = (CLIENT_ID, CLIENT_SECRET) else {
        return Err(not_configured_message());
    };

    let listener = TcpListener::bind("127.0.0.1:0")
        .map_err(|e| format!("could not open a local callback port: {e}"))?;
    let port = listener
        .local_addr()
        .map_err(|e| format!("could not read the callback port: {e}"))?
        .port();
    let redirect_uri = format!("http://127.0.0.1:{port}");

    let pkce = generate_pkce();
    let state = random_state();
    let url = authorize_url(client_id, &redirect_uri, &pkce.challenge, &state);

    // `Shell::open` is deprecated in favour of tauri-plugin-opener, but the
    // shell plugin is already a dependency and the opener plugin would add one
    // plus a capability entry for a single call site. Revisit if the app adopts
    // the opener plugin for other reasons.
    //
    // Known residual exposure: this shells out to `/usr/bin/open <url>` on
    // macOS, so the authorization URL — including `state` and `code_challenge`
    // — is briefly visible in the process argument list to any process running
    // as the same user. An attacker who already has same-user code execution
    // could race that window and complete consent against their own Google
    // account, leaving this app connected to it. The payoff is arbitrary text
    // in the timeline (the account address is shown in Settings, event links
    // are Google-generated, and nothing of the user's is exposed), and such an
    // attacker can already write directly into the vault. Closing it properly
    // means launching the browser without a child process — NSWorkspace via
    // the existing Swift bridge is the likely route.
    #[allow(deprecated)]
    app.shell()
        .open(&url, None)
        .map_err(|e| format!("could not open your browser: {e}"))?;

    // Accept on a worker thread so the async runtime stays free.
    let expected_state = state.clone();
    let callback =
        tauri::async_runtime::spawn_blocking(move || await_callback(listener, &expected_state))
            .await
            .map_err(|e| format!("callback task failed: {e}"))??;

    if let Some(error) = callback.error {
        return Err(if error == "access_denied" {
            "Connection cancelled.".to_string()
        } else {
            let (code, description) = allowlisted_oauth_error(&error);
            format!("Google returned an error: {code} ({description}).")
        });
    }
    // A mismatched state means the redirect did not come from the request we
    // started; refusing it is the whole point of sending one.
    if callback.state.as_deref() != Some(state.as_str()) {
        return Err("The Google redirect did not match this request.".into());
    }
    let code = callback
        .code
        .ok_or_else(|| "Google did not return an authorization code.".to_string())?;

    let response = post_token(&[
        ("client_id", client_id),
        ("client_secret", client_secret),
        ("code", &code),
        ("code_verifier", &pkce.verifier),
        ("grant_type", "authorization_code"),
        ("redirect_uri", &redirect_uri),
    ])
    .await?;

    let (token, refresh) = response.into_access_token(Instant::now())?;
    let refresh = refresh.ok_or_else(|| {
        "Google did not return a refresh token. Remove Moldavite from your Google account \
         permissions and connect again."
            .to_string()
    })?;
    KeychainSecretStore.set(REFRESH_TOKEN_ACCOUNT, &refresh)?;

    Ok(token)
}

/// Exchange the stored refresh token for a fresh access token.
pub async fn refresh() -> Result<AccessToken, String> {
    let (Some(client_id), Some(client_secret)) = (CLIENT_ID, CLIENT_SECRET) else {
        return Err(not_configured_message());
    };
    let refresh_token = KeychainSecretStore
        .get(REFRESH_TOKEN_ACCOUNT)?
        .ok_or_else(|| "No Google account is connected.".to_string())?;

    let response = post_token(&[
        ("client_id", client_id),
        ("client_secret", client_secret),
        ("refresh_token", &refresh_token),
        ("grant_type", "refresh_token"),
    ])
    .await?;

    Ok(response.into_access_token(Instant::now())?.0)
}

pub fn has_stored_refresh_token() -> bool {
    KeychainSecretStore
        .get(REFRESH_TOKEN_ACCOUNT)
        .ok()
        .flatten()
        .is_some()
}

pub fn forget_refresh_token() -> Result<(), String> {
    KeychainSecretStore.delete(REFRESH_TOKEN_ACCOUNT)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn s256_challenge_matches_the_rfc7636_example() {
        // RFC 7636 appendix B.
        let verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
        assert_eq!(
            challenge_for(verifier),
            "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM"
        );
    }

    #[test]
    fn generated_verifier_and_challenge_agree() {
        let pkce = generate_pkce();
        assert_eq!(challenge_for(&pkce.verifier), pkce.challenge);
        // RFC 7636 requires 43-128 characters.
        assert!((43..=128).contains(&pkce.verifier.len()));
    }

    #[test]
    fn parses_a_successful_callback() {
        let cb = parse_callback("GET /?code=abc123&state=xyz&scope=https%3A%2F%2Fx HTTP/1.1");
        assert_eq!(cb.code.as_deref(), Some("abc123"));
        assert_eq!(cb.state.as_deref(), Some("xyz"));
        assert!(cb.error.is_none());
    }

    #[test]
    fn parses_a_denied_callback() {
        let cb = parse_callback("GET /?error=access_denied&state=xyz HTTP/1.1");
        assert_eq!(cb.error.as_deref(), Some("access_denied"));
        assert!(cb.code.is_none());
    }

    #[test]
    fn ignores_a_request_with_no_query() {
        assert_eq!(parse_callback("GET / HTTP/1.1"), Callback::default());
        assert_eq!(parse_callback("garbage"), Callback::default());
    }

    /// The accept loop only acts on a request whose `state` matches the one we
    /// generated. Anything on the machine can reach a loopback port, so without
    /// this a stray `?error=` would abort a flow the user did not cancel.
    #[test]
    fn a_foreign_request_is_not_mistaken_for_our_redirect() {
        let ours = "expected-state";

        let forged_error = parse_callback("GET /?error=access_denied HTTP/1.1");
        assert_ne!(forged_error.state.as_deref(), Some(ours));

        let forged_code = parse_callback("GET /?code=attacker&state=wrong HTTP/1.1");
        assert_ne!(forged_code.state.as_deref(), Some(ours));

        let real = parse_callback("GET /?code=ours&state=expected-state HTTP/1.1");
        assert_eq!(real.state.as_deref(), Some(ours));
        assert_eq!(real.code.as_deref(), Some("ours"));
    }

    #[test]
    fn a_cancelled_consent_still_carries_our_state() {
        // Google echoes `state` on the error redirect too, which is what makes
        // requiring it safe rather than a way to miss a real cancellation.
        let cb = parse_callback("GET /?error=access_denied&state=expected-state HTTP/1.1");
        assert_eq!(cb.state.as_deref(), Some("expected-state"));
        assert_eq!(cb.error.as_deref(), Some("access_denied"));
    }

    #[test]
    fn authorize_url_encodes_and_pins_the_scope() {
        let url = authorize_url(
            "id.apps.googleusercontent.com",
            "http://127.0.0.1:5000",
            "chal",
            "st",
        );
        assert!(url.contains("code_challenge=chal"));
        assert!(url.contains("code_challenge_method=S256"));
        assert!(url.contains("access_type=offline"));
        assert!(url.contains("redirect_uri=http%3A%2F%2F127.0.0.1%3A5000"));
        assert!(url.contains("calendar.readonly"));
        assert!(url.contains("state=st"));
    }

    #[test]
    fn token_is_unusable_once_inside_the_refresh_margin() {
        let now = Instant::now();
        let fresh = AccessToken {
            value: "t".into(),
            expires_at: now + Duration::from_secs(3600),
        };
        assert!(fresh.is_usable(now));

        let nearly_done = AccessToken {
            value: "t".into(),
            expires_at: now + Duration::from_secs(30),
        };
        assert!(!nearly_done.is_usable(now));

        let expired = AccessToken {
            value: "t".into(),
            expires_at: now,
        };
        assert!(!expired.is_usable(now));
    }

    #[test]
    fn token_response_carries_the_refresh_token_through() {
        let parsed: TokenResponse = serde_json::from_str(
            r#"{"access_token":"at","expires_in":3599,"refresh_token":"rt","token_type":"Bearer"}"#,
        )
        .unwrap();
        let (token, refresh) = parsed.into_access_token(Instant::now()).unwrap();
        assert_eq!(token.value, "at");
        assert_eq!(refresh.as_deref(), Some("rt"));
    }

    #[test]
    fn a_refresh_response_without_a_new_refresh_token_is_fine() {
        let parsed: TokenResponse =
            serde_json::from_str(r#"{"access_token":"at2","expires_in":3599}"#).unwrap();
        let (_, refresh) = parsed.into_access_token(Instant::now()).unwrap();
        assert!(refresh.is_none());
    }

    #[test]
    fn an_untrusted_expiry_cannot_overflow_instant() {
        let parsed: TokenResponse = serde_json::from_str(&format!(
            r#"{{"access_token":"at","expires_in":{}}}"#,
            u64::MAX
        ))
        .unwrap();

        let conversion = std::panic::catch_unwind(|| parsed.into_access_token(Instant::now()));
        assert!(conversion.is_ok(), "token conversion must not panic");
        assert!(conversion.unwrap().is_err());
    }

    #[test]
    fn token_endpoint_errors_do_not_interpolate_the_raw_body() {
        let leaked = "access-token-that-must-stay-private";
        let body = format!(
            r#"{{"error":"invalid_grant","error_description":"grant contains {leaked}","access_token":"{leaked}"}}"#
        );
        let message = safe_oauth_error(reqwest::StatusCode::BAD_REQUEST, &body);

        assert!(message.contains("invalid_grant"));
        assert!(message.contains("authorization grant is invalid or expired"));
        assert!(!message.contains(leaked));
        assert!(message.len() < 200);
    }

    #[test]
    fn an_unknown_oauth_body_gets_a_bounded_generic_error() {
        let body = format!(r#"{{"error":"{}"}}"#, "x".repeat(10_000));
        let message = safe_oauth_error(reqwest::StatusCode::BAD_REQUEST, &body);

        assert!(message.contains("oauth_error"));
        assert!(!message.contains(&"x".repeat(100)));
        assert!(message.len() < 200);
    }
}

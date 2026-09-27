//! Google OAuth for an installed app: PKCE, then a redirect back to the app.
//!
//! The whole flow lives in Rust on purpose. No token ever reaches the webview,
//! so the CSP in `tauri.conf.json` needs no `accounts.google.com` exception and
//! a compromised plugin cannot read the calendar credentials.
//!
//! Desktop uses a "Desktop app" client and a loopback redirect. Its client
//! secret is not confidential — it ships inside every copy of the binary, which
//! is why PKCE carries the actual security here. It is still read from the
//! environment at build time rather than committed, so it stays out of a public
//! repository.
//!
//! A phone app cannot listen on a loopback port, so iOS uses Google's "iOS"
//! client type: consent runs in `ASWebAuthenticationSession` and redirects to a
//! custom scheme. That client type has no secret, so its token requests carry none.

use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine as _;
use rand::RngCore;
use serde::Deserialize;
use sha2::{Digest, Sha256};
#[cfg(not(target_os = "ios"))]
use std::io::{BufRead, BufReader, Write};
#[cfg(not(target_os = "ios"))]
use std::net::TcpListener;
use std::time::{Duration, Instant};
#[cfg(not(target_os = "ios"))]
use tauri_plugin_shell::ShellExt;

use crate::secrets::{KeychainSecretStore, SecretStore};

const AUTH_ENDPOINT: &str = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_ENDPOINT: &str = "https://oauth2.googleapis.com/token";
const SCOPE: &str = "https://www.googleapis.com/auth/calendar.readonly";
const REFRESH_TOKEN_ACCOUNT: &str = "calendar:google:refresh_token";

/// How long to wait for the user to finish consent before giving up, so an
/// abandoned browser tab cannot block a thread for the life of the process.
#[cfg(not(target_os = "ios"))]
const CALLBACK_TIMEOUT: Duration = Duration::from_secs(300);

/// Refresh slightly before real expiry; a token that dies mid-request costs a
/// round trip and an error the user would see.
const EXPIRY_MARGIN: Duration = Duration::from_secs(60);

/// How often the non-blocking accept loop re-checks for a connection. Short
/// enough that consent feels instant, long enough not to spin a core.
#[cfg(not(target_os = "ios"))]
const ACCEPT_POLL_INTERVAL: Duration = Duration::from_millis(100);

#[cfg(not(target_os = "ios"))]
pub const CLIENT_ID: Option<&str> = option_env!("MOLDAVITE_GOOGLE_CLIENT_ID");
#[cfg(not(target_os = "ios"))]
pub const CLIENT_SECRET: Option<&str> = option_env!("MOLDAVITE_GOOGLE_CLIENT_SECRET");

/// A public id with no secret behind it (Google's iOS SDK keeps it in Info.plist),
/// committed because iOS builds on a developer's Mac, where a forgotten variable
/// would quietly ship without Google. `MOLDAVITE_GOOGLE_IOS_CLIENT_ID` overrides it.
#[cfg(any(target_os = "ios", test))]
const IOS_DEFAULT_CLIENT_ID: &str =
    "724022062223-4vom8okssbq2bq6nd21rt4u37lk0vtrr.apps.googleusercontent.com";

#[cfg(target_os = "ios")]
const IOS_CLIENT_ID: &str = match option_env!("MOLDAVITE_GOOGLE_IOS_CLIENT_ID") {
    Some(id) if !id.is_empty() => id,
    _ => IOS_DEFAULT_CLIENT_ID,
};

struct OAuthClient {
    id: &'static str,
    secret: Option<&'static str>,
}

#[cfg(not(target_os = "ios"))]
fn client() -> Option<OAuthClient> {
    Some(OAuthClient {
        id: CLIENT_ID.filter(|v| !v.is_empty())?,
        secret: Some(CLIENT_SECRET.filter(|v| !v.is_empty())?),
    })
}

#[cfg(target_os = "ios")]
fn client() -> Option<OAuthClient> {
    ios_redirect(IOS_CLIENT_ID)?;
    Some(OAuthClient {
        id: IOS_CLIENT_ID,
        secret: None,
    })
}

/// Whether this build carries Google credentials at all. A local build without
/// them must still compile and run — the source simply reports unavailable.
pub fn is_configured() -> bool {
    client().is_some()
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
#[cfg(not(target_os = "ios"))]
pub fn parse_callback(request_line: &str) -> Callback {
    let Some(target) = request_line.split_whitespace().nth(1) else {
        return Callback::default();
    };
    let Some((_, query)) = target.split_once('?') else {
        return Callback::default();
    };
    parse_query(query)
}

/// Google's iOS redirect for `<n>.apps.googleusercontent.com` is
/// `com.googleusercontent.apps.<n>:/oauth2redirect`. Returns (scheme, redirect
/// URI), or `None` for an id not shaped like one Google issues.
#[cfg(any(target_os = "ios", test))]
fn ios_redirect(client_id: &str) -> Option<(String, String)> {
    let prefix = client_id.strip_suffix(".apps.googleusercontent.com")?;
    if prefix.is_empty()
        || !prefix
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-')
    {
        return None;
    }
    let scheme = format!("com.googleusercontent.apps.{prefix}");
    let redirect_uri = format!("{scheme}:/oauth2redirect");
    Some((scheme, redirect_uri))
}

/// Anything not on our exact redirect URI parses as empty, which the state
/// check then refuses.
#[cfg(any(target_os = "ios", test))]
fn parse_redirect_url(url: &str, redirect_uri: &str) -> Callback {
    let url = url.split('#').next().unwrap_or_default();
    let (target, query) = url.split_once('?').unwrap_or((url, ""));
    if target != redirect_uri {
        return Callback::default();
    }
    parse_query(query)
}

fn parse_query(query: &str) -> Callback {
    let mut callback = Callback::default();
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

/// Cap on the request line a loopback client can make us buffer. Google's
/// redirect is a few hundred bytes; anything on this machine can also connect,
/// and an unbounded `read_line` would grow a `String` for as long as such a
/// caller keeps sending bytes without a newline.
#[cfg(not(target_os = "ios"))]
const MAX_REQUEST_LINE_BYTES: u64 = 8 * 1024;

/// Read the HTTP request line, never retaining more than the cap. `None` means
/// the connection produced nothing usable, which the caller treats as "not our
/// redirect" and moves on to the next connection.
#[cfg(not(target_os = "ios"))]
fn read_request_line(stream: impl std::io::Read) -> Option<String> {
    let mut line = String::new();
    BufReader::new(stream.take(MAX_REQUEST_LINE_BYTES))
        .read_line(&mut line)
        .ok()?;
    Some(line)
}

#[cfg(not(target_os = "ios"))]
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
#[cfg(not(target_os = "ios"))]
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

        let Some(line) = read_request_line(
            stream
                .try_clone()
                .map_err(|e| format!("callback connection failed: {e}"))?,
        ) else {
            continue;
        };

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

fn token_request<'a>(
    client: &OAuthClient,
    grant: &[(&'static str, &'a str)],
) -> Vec<(&'static str, &'a str)> {
    let mut params = vec![("client_id", client.id)];
    params.extend(client.secret.map(|secret| ("client_secret", secret)));
    params.extend_from_slice(grant);
    params
}

fn authorization_code(callback: Callback, expected_state: &str) -> Result<String, String> {
    // A mismatched state means the redirect did not come from the request we
    // started; refusing it is the whole point of sending one.
    if callback.state.as_deref() != Some(expected_state) {
        return Err("The Google redirect did not match this request.".into());
    }
    if let Some(error) = callback.error {
        return Err(if error == "access_denied" {
            "Connection cancelled.".to_string()
        } else {
            let (code, description) = allowlisted_oauth_error(&error);
            format!("Google returned an error: {code} ({description}).")
        });
    }
    callback
        .code
        .ok_or_else(|| "Google did not return an authorization code.".to_string())
}

/// Run the full consent flow and persist the resulting refresh token.
pub async fn connect(app: &tauri::AppHandle) -> Result<AccessToken, String> {
    let client = client().ok_or_else(not_configured_message)?;
    let pkce = generate_pkce();
    let state = random_state();

    let (callback, redirect_uri) = authorize(app, client.id, &pkce.challenge, &state).await?;
    let code = authorization_code(callback, &state)?;

    let response = post_token(&token_request(
        &client,
        &[
            ("code", &code),
            ("code_verifier", &pkce.verifier),
            ("grant_type", "authorization_code"),
            ("redirect_uri", &redirect_uri),
        ],
    ))
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

/// Returns the consent redirect and the redirect URI the token exchange must repeat.
#[cfg(target_os = "ios")]
async fn authorize(
    app: &tauri::AppHandle,
    client_id: &str,
    challenge: &str,
    state: &str,
) -> Result<(Callback, String), String> {
    use tauri_plugin_calendar::CalendarExt;

    let (scheme, redirect_uri) = ios_redirect(client_id).ok_or_else(not_configured_message)?;
    let url = authorize_url(client_id, &redirect_uri, challenge, state);
    let returned = app
        .calendar()
        .authenticate(&url, &scheme)
        .await?
        .ok_or_else(|| "Connection cancelled.".to_string())?;
    Ok((parse_redirect_url(&returned, &redirect_uri), redirect_uri))
}

/// Returns the consent redirect and the redirect URI the token exchange must repeat.
#[cfg(not(target_os = "ios"))]
async fn authorize(
    app: &tauri::AppHandle,
    client_id: &str,
    challenge: &str,
    state: &str,
) -> Result<(Callback, String), String> {
    let listener = TcpListener::bind("127.0.0.1:0")
        .map_err(|e| format!("could not open a local callback port: {e}"))?;
    let port = listener
        .local_addr()
        .map_err(|e| format!("could not read the callback port: {e}"))?
        .port();
    let redirect_uri = format!("http://127.0.0.1:{port}");

    let url = authorize_url(client_id, &redirect_uri, challenge, state);

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
    let expected_state = state.to_string();
    let callback =
        tauri::async_runtime::spawn_blocking(move || await_callback(listener, &expected_state))
            .await
            .map_err(|e| format!("callback task failed: {e}"))??;
    Ok((callback, redirect_uri))
}

/// Exchange the stored refresh token for a fresh access token.
pub async fn refresh() -> Result<AccessToken, String> {
    let client = client().ok_or_else(not_configured_message)?;
    let refresh_token = KeychainSecretStore
        .get(REFRESH_TOKEN_ACCOUNT)?
        .ok_or_else(|| "No Google account is connected.".to_string())?;

    let response = post_token(&token_request(
        &client,
        &[
            ("refresh_token", &refresh_token),
            ("grant_type", "refresh_token"),
        ],
    ))
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

    /// Any local process can connect to the loopback port. One that sends
    /// bytes without ever sending a newline must not be able to grow the
    /// buffer we keep for it.
    #[test]
    fn a_request_line_that_never_ends_is_capped_not_buffered_whole() {
        let flood = vec![b'x'; (MAX_REQUEST_LINE_BYTES as usize) * 4];
        let line = read_request_line(std::io::Cursor::new(flood)).unwrap();

        assert_eq!(line.len(), MAX_REQUEST_LINE_BYTES as usize);
        assert_eq!(parse_callback(&line), Callback::default());
    }

    /// The cap is far above a real redirect, so the flow itself is unchanged.
    #[test]
    fn a_real_redirect_line_still_reads_whole() {
        let request = "GET /?code=abc123&state=xyz HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n";
        let line = read_request_line(std::io::Cursor::new(request.as_bytes())).unwrap();

        assert_eq!(line, "GET /?code=abc123&state=xyz HTTP/1.1\r\n");
        assert_eq!(parse_callback(&line).code.as_deref(), Some("abc123"));
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

    const IOS_SCHEME: &str =
        "com.googleusercontent.apps.724022062223-4vom8okssbq2bq6nd21rt4u37lk0vtrr";
    const IOS_REDIRECT: &str =
        "com.googleusercontent.apps.724022062223-4vom8okssbq2bq6nd21rt4u37lk0vtrr:/oauth2redirect";

    #[test]
    fn the_ios_redirect_is_the_client_id_reversed() {
        let (scheme, redirect_uri) = ios_redirect(IOS_DEFAULT_CLIENT_ID).unwrap();
        assert_eq!(scheme, IOS_SCHEME);
        assert_eq!(redirect_uri, IOS_REDIRECT);

        let url = authorize_url(IOS_DEFAULT_CLIENT_ID, &redirect_uri, "chal", "st");
        assert!(url.contains(
            "redirect_uri=com.googleusercontent.apps.724022062223-4vom8okssbq2bq6nd21rt4u37lk0vtrr%3A%2Foauth2redirect"
        ));
        assert!(url.contains("code_challenge_method=S256"));
    }

    #[test]
    fn a_malformed_ios_client_id_has_no_redirect() {
        assert!(ios_redirect("").is_none());
        assert!(ios_redirect("123-abc").is_none());
        assert!(ios_redirect(".apps.googleusercontent.com").is_none());
        assert!(ios_redirect("a/b:c.apps.googleusercontent.com").is_none());
        assert!(ios_redirect("123-abc.apps.googleusercontent.com.evil").is_none());
    }

    #[test]
    fn parses_the_redirect_the_sign_in_sheet_returns() {
        let cb = parse_redirect_url(
            &format!("{IOS_REDIRECT}?state=st&code=4%2F0Ab&scope=https%3A%2F%2Fx"),
            IOS_REDIRECT,
        );
        assert_eq!(cb.code.as_deref(), Some("4/0Ab"));
        assert_eq!(cb.state.as_deref(), Some("st"));
        assert!(cb.error.is_none());

        let denied = parse_redirect_url(
            &format!("{IOS_REDIRECT}?error=access_denied&state=st"),
            IOS_REDIRECT,
        );
        assert_eq!(denied.error.as_deref(), Some("access_denied"));

        let with_fragment =
            parse_redirect_url(&format!("{IOS_REDIRECT}?code=c&state=st#"), IOS_REDIRECT);
        assert_eq!(with_fragment.state.as_deref(), Some("st"));
    }

    #[test]
    fn a_redirect_to_any_other_address_parses_as_empty() {
        for url in [
            format!("{IOS_SCHEME}:/elsewhere?code=c&state=st"),
            "com.googleusercontent.apps.other:/oauth2redirect?code=c&state=st".to_string(),
            "https://example.com/?code=c&state=st".to_string(),
            IOS_REDIRECT.to_string(),
        ] {
            assert_eq!(
                parse_redirect_url(&url, IOS_REDIRECT),
                Callback::default(),
                "{url}"
            );
        }
    }

    #[test]
    fn a_redirect_without_our_state_is_refused_even_with_a_code() {
        let foreign = Callback {
            code: Some("attacker".into()),
            state: Some("wrong".into()),
            error: None,
        };
        assert!(authorization_code(foreign, "ours")
            .unwrap_err()
            .contains("did not match"));

        let stateless = Callback {
            code: Some("c".into()),
            ..Callback::default()
        };
        assert!(authorization_code(stateless, "ours").is_err());

        let forged_cancel = Callback {
            error: Some("access_denied".into()),
            ..Callback::default()
        };
        assert!(authorization_code(forged_cancel, "ours")
            .unwrap_err()
            .contains("did not match"));
    }

    #[test]
    fn our_redirect_yields_its_code_or_a_readable_refusal() {
        let ok = Callback {
            code: Some("c".into()),
            state: Some("ours".into()),
            error: None,
        };
        assert_eq!(authorization_code(ok, "ours").unwrap(), "c");

        let cancelled = Callback {
            state: Some("ours".into()),
            error: Some("access_denied".into()),
            ..Callback::default()
        };
        assert_eq!(
            authorization_code(cancelled, "ours").unwrap_err(),
            "Connection cancelled."
        );

        let odd = Callback {
            state: Some("ours".into()),
            error: Some("<script>".into()),
            ..Callback::default()
        };
        let message = authorization_code(odd, "ours").unwrap_err();
        assert!(message.contains("oauth_error"));
        assert!(!message.contains("<script>"));

        let empty = Callback {
            state: Some("ours".into()),
            ..Callback::default()
        };
        assert!(authorization_code(empty, "ours").is_err());
    }

    fn keys(params: &[(&str, &str)]) -> Vec<String> {
        params.iter().map(|(key, _)| key.to_string()).collect()
    }

    #[test]
    fn the_ios_client_sends_no_secret_in_either_token_request() {
        let ios = OAuthClient {
            id: IOS_DEFAULT_CLIENT_ID,
            secret: None,
        };

        let exchange = token_request(
            &ios,
            &[
                ("code", "c"),
                ("code_verifier", "v"),
                ("grant_type", "authorization_code"),
                ("redirect_uri", IOS_REDIRECT),
            ],
        );
        assert_eq!(
            keys(&exchange),
            [
                "client_id",
                "code",
                "code_verifier",
                "grant_type",
                "redirect_uri"
            ]
        );
        assert_eq!(exchange[0].1, IOS_DEFAULT_CLIENT_ID);

        let refresh = token_request(
            &ios,
            &[("refresh_token", "r"), ("grant_type", "refresh_token")],
        );
        assert_eq!(keys(&refresh), ["client_id", "refresh_token", "grant_type"]);
    }

    #[test]
    fn the_desktop_client_still_sends_its_secret() {
        let desktop = OAuthClient {
            id: "desktop.apps.googleusercontent.com",
            secret: Some("s"),
        };
        let refresh = token_request(
            &desktop,
            &[("refresh_token", "r"), ("grant_type", "refresh_token")],
        );
        assert_eq!(
            refresh,
            [
                ("client_id", "desktop.apps.googleusercontent.com"),
                ("client_secret", "s"),
                ("refresh_token", "r"),
                ("grant_type", "refresh_token"),
            ]
        );
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

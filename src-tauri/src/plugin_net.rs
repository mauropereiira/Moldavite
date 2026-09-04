//! Host-side network execution for the plugin `net.fetch` API.
//!
//! The webview CSP's `connect-src` is fixed at build time (self plus a few
//! GitHub hosts for the registry), so a plugin's request to any other host
//! never reaches this code if it goes through the page's `fetch()` — WebKit
//! blocks it before Moldavite's own allowlist logic ever runs. Routing the
//! request through this command instead means it leaves from the Rust
//! process, which the CSP does not govern.
//!
//! `src/lib/plugins/api.ts` (`pluginFetch`) is the primary trust boundary:
//! plugin workers have no IPC access, so every call here is already validated
//! there first. But this command is reachable from the frontend like any
//! other, so every rule is re-checked here too — never rely on one side
//! alone. Redirects are followed manually (`redirect::Policy::none()`) so
//! each hop gets the same validation as the initial URL, and the effective
//! `allowed_hosts` list is a snapshot taken by the caller when the call
//! started: a runtime host revocation applies to the next `net.fetch` call,
//! not to one already in flight (the union is out of this process's reach —
//! it lives in a Zustand store on the frontend).

use std::collections::HashMap;
use std::time::{Duration, Instant};

use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
use reqwest::header::{
    HeaderMap, HeaderName, HeaderValue, ACCEPT, ACCEPT_LANGUAGE, CONTENT_LENGTH, CONTENT_TYPE,
    LOCATION,
};
use reqwest::{Method, Url};
use serde::Serialize;

/// Total wall-clock budget for the request plus every redirect hop combined,
/// mirroring the single `AbortController` the frontend used to own.
const FETCH_TIMEOUT: Duration = Duration::from_secs(30);
const MAX_REDIRECTS: u32 = 5;
const MAX_RESPONSE_BYTES: usize = 10 * 1024 * 1024;
/// Not a rule the page's `fetch()` ever needed (the browser just streamed the
/// body to the network); now that this process opens the socket itself, an
/// unbounded plugin-supplied body is a resource a plugin could abuse.
const MAX_REQUEST_BODY_BYTES: usize = 10 * 1024 * 1024;

const REDIRECT_STATUSES: [u16; 5] = [301, 302, 303, 307, 308];

const SAFE_RESPONSE_HEADERS: [&str; 8] = [
    "content-type",
    "content-length",
    "etag",
    "last-modified",
    "link",
    "retry-after",
    "x-wp-total",
    "x-wp-totalpages",
];

/// Request headers a plugin may never set directly. A browser's `fetch()`
/// silently drops "forbidden" header names (`Host`, `Content-Length`,
/// `Cookie`, ...) before a request ever reaches the network; `reqwest` has no
/// such enforcement, so this closes the gap ourselves now that this process
/// does the sending. `host`/`content-length`/`connection`/
/// `transfer-encoding`/`upgrade` could desync the request from the URL or
/// body Moldavite already validated; `cookie` is ambient-credential territory
/// the plugin sandbox must never touch.
const BLOCKED_REQUEST_HEADERS: [&str; 6] = [
    "host",
    "content-length",
    "connection",
    "transfer-encoding",
    "upgrade",
    "cookie",
];

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PluginFetchResponse {
    status: u16,
    headers: HashMap<String, String>,
    body_text: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    body_base64: Option<String>,
}

// ---------------------------------------------------------------------------
// Pure validation (no network) — unit tested directly at the bottom of this
// file.
// ---------------------------------------------------------------------------

/// `URL.host` in JS is hostname, plus `:port` only when the port is explicit
/// and not the scheme's default (the WHATWG URL parser normalizes the default
/// away). `url::Url` does the same normalization, so this mirrors it exactly.
fn host_with_port(url: &Url) -> String {
    let host = url.host_str().unwrap_or("");
    match url.port() {
        Some(port) => format!("{host}:{port}"),
        None => host.to_string(),
    }
}

fn validate_parsed_url(url: &Url, allowed_hosts: &[String]) -> Result<(), String> {
    if url.scheme() != "https" {
        return Err("net.fetch: only https URLs are allowed".to_string());
    }
    if !url.username().is_empty() || url.password().is_some() {
        return Err("net.fetch: URL credentials are not allowed".to_string());
    }
    let host = host_with_port(url);
    if !allowed_hosts.iter().any(|allowed| allowed == &host) {
        return Err(format!(
            "net.fetch: host \"{host}\" is not in this plugin's allowedHosts"
        ));
    }
    Ok(())
}

fn validate_url(raw: &str, allowed_hosts: &[String]) -> Result<Url, String> {
    let url = Url::parse(raw).map_err(|_| "net.fetch: url must be an absolute URL".to_string())?;
    validate_parsed_url(&url, allowed_hosts)?;
    Ok(url)
}

/// Resolve a redirect's `Location` against the current URL and re-validate it
/// with the same rules as the initial request — the per-hop check that keeps
/// a redirect from walking the request somewhere the allowlist never approved.
fn resolve_redirect_target(
    location: &str,
    base: &Url,
    allowed_hosts: &[String],
) -> Result<Url, String> {
    let next = base
        .join(location)
        .map_err(|_| "net.fetch: redirect target is not a valid URL".to_string())?;
    validate_parsed_url(&next, allowed_hosts)?;
    Ok(next)
}

fn normalize_method(method: &str) -> Result<Method, String> {
    if method.is_empty() || !method.chars().all(|c| c.is_ascii_alphabetic()) {
        return Err("net.fetch: method must contain letters only".to_string());
    }
    let upper = method.to_ascii_uppercase();
    if matches!(upper.as_str(), "CONNECT" | "TRACE" | "TRACK") {
        return Err(format!("net.fetch: method {upper} is not allowed"));
    }
    Method::from_bytes(upper.as_bytes())
        .map_err(|_| "net.fetch: method must contain letters only".to_string())
}

fn build_header_map(headers: &HashMap<String, String>) -> Result<HeaderMap, String> {
    let mut map = HeaderMap::new();
    for (name, value) in headers {
        let header_name = HeaderName::from_bytes(name.as_bytes())
            .map_err(|_| format!("net.fetch: invalid header name \"{name}\""))?;
        if BLOCKED_REQUEST_HEADERS.contains(&header_name.as_str()) {
            return Err(format!("net.fetch: header \"{name}\" is not allowed"));
        }
        let header_value = HeaderValue::from_str(value)
            .map_err(|_| format!("net.fetch: invalid value for header \"{name}\""))?;
        map.insert(header_name, header_value);
    }
    Ok(map)
}

fn is_text_content_type(content_type: &str) -> bool {
    let lower = content_type.to_ascii_lowercase();
    lower.starts_with("text/")
        || lower.contains("json")
        || lower.contains("xml")
        || lower.contains("javascript")
        || lower.contains("x-www-form-urlencoded")
}

fn filter_response_headers(headers: &HeaderMap) -> HashMap<String, String> {
    let mut out = HashMap::new();
    for (name, value) in headers.iter() {
        let lower = name.as_str().to_ascii_lowercase();
        if SAFE_RESPONSE_HEADERS.contains(&lower.as_str()) {
            if let Ok(v) = value.to_str() {
                out.insert(lower, v.to_string());
            }
        }
    }
    out
}

fn origins_match(a: &Url, b: &Url) -> bool {
    a.scheme() == b.scheme()
        && a.host_str() == b.host_str()
        && a.port_or_known_default() == b.port_or_known_default()
}

fn should_downgrade_to_get(status: u16, method: &Method) -> bool {
    status == 303 || ((status == 301 || status == 302) && *method == Method::POST)
}

/// Cross-origin redirects keep only `Accept`/`Accept-Language`, plus
/// `Content-Type` when a request body survives the hop — the same minimal
/// set the frontend used to carry across origins, so `Authorization` and any
/// other sensitive header never follows a redirect off-host.
fn cross_origin_safe_headers(headers: &HeaderMap, keep_content_type: bool) -> HeaderMap {
    let mut out = HeaderMap::new();
    for name in [ACCEPT, ACCEPT_LANGUAGE] {
        if let Some(value) = headers.get(&name) {
            out.insert(name, value.clone());
        }
    }
    if keep_content_type {
        if let Some(value) = headers.get(CONTENT_TYPE) {
            out.insert(CONTENT_TYPE, value.clone());
        }
    }
    out
}

fn check_declared_length(headers: &HeaderMap, cap: usize) -> Result<(), String> {
    if let Some(len) = headers
        .get(CONTENT_LENGTH)
        .and_then(|v| v.to_str().ok())
        .and_then(|s| s.parse::<usize>().ok())
    {
        if len > cap {
            return Err("net.fetch: response exceeds the 10 MB limit".to_string());
        }
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// Network
// ---------------------------------------------------------------------------

/// One shared client so keep-alive and the TLS session cache carry across
/// plugin requests instead of paying a fresh handshake every call.
fn http_client() -> reqwest::Client {
    static CLIENT: std::sync::OnceLock<reqwest::Client> = std::sync::OnceLock::new();
    CLIENT
        .get_or_init(|| {
            reqwest::Client::builder()
                // Every hop is validated and re-issued by hand below, so the
                // client itself must never follow a redirect on its own.
                .redirect(reqwest::redirect::Policy::none())
                .build()
                .unwrap_or_default()
        })
        .clone()
}

#[tauri::command]
pub(crate) async fn plugin_fetch(
    url: String,
    method: String,
    headers: HashMap<String, String>,
    body: Option<String>,
    allowed_hosts: Vec<String>,
) -> Result<PluginFetchResponse, String> {
    if let Some(b) = &body {
        if b.len() > MAX_REQUEST_BODY_BYTES {
            return Err("net.fetch: request body exceeds the 10 MB limit".to_string());
        }
    }

    let mut current_method = normalize_method(&method)?;
    let mut current_url = validate_url(&url, &allowed_hosts)?;
    let mut current_headers = build_header_map(&headers)?;
    let mut current_body = body;

    let client = http_client();
    let deadline = Instant::now() + FETCH_TIMEOUT;
    let mut redirects = 0u32;

    loop {
        let remaining = deadline.saturating_duration_since(Instant::now());
        if remaining.is_zero() {
            return Err("net.fetch: request timed out after 30 seconds".to_string());
        }

        let mut builder = client
            .request(current_method.clone(), current_url.clone())
            .headers(current_headers.clone())
            .timeout(remaining);
        if let Some(b) = current_body.clone() {
            builder = builder.body(b);
        }

        let response = builder.send().await.map_err(|e| {
            if e.is_timeout() {
                "net.fetch: request timed out after 30 seconds".to_string()
            } else {
                format!("net.fetch: request failed: {e}")
            }
        })?;

        let status = response.status().as_u16();
        if !REDIRECT_STATUSES.contains(&status) {
            return serialize_response(response, deadline).await;
        }
        if redirects >= MAX_REDIRECTS {
            return Err("net.fetch: too many redirects".to_string());
        }
        redirects += 1;

        let location = response
            .headers()
            .get(LOCATION)
            .and_then(|v| v.to_str().ok())
            .ok_or_else(|| {
                "net.fetch: redirect response did not expose a Location header".to_string()
            })?
            .to_string();
        let next_url = resolve_redirect_target(&location, &current_url, &allowed_hosts)?;

        if should_downgrade_to_get(status, &current_method) {
            current_method = Method::GET;
            current_body = None;
            current_headers.remove(CONTENT_TYPE);
            current_headers.remove(CONTENT_LENGTH);
        }
        if !origins_match(&current_url, &next_url) {
            current_headers = cross_origin_safe_headers(&current_headers, current_body.is_some());
        }
        current_url = next_url;
    }
}

async fn serialize_response(
    mut response: reqwest::Response,
    deadline: Instant,
) -> Result<PluginFetchResponse, String> {
    let status = response.status().as_u16();
    check_declared_length(response.headers(), MAX_RESPONSE_BYTES)?;
    let safe_headers = filter_response_headers(response.headers());
    let content_type = response
        .headers()
        .get(CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_string();

    let mut bytes: Vec<u8> = Vec::new();
    loop {
        if Instant::now() >= deadline {
            return Err("net.fetch: request timed out after 30 seconds".to_string());
        }
        let chunk = response.chunk().await.map_err(|e| {
            if e.is_timeout() {
                "net.fetch: request timed out after 30 seconds".to_string()
            } else {
                format!("net.fetch: {e}")
            }
        })?;
        let Some(chunk) = chunk else { break };
        bytes.extend_from_slice(&chunk);
        if bytes.len() > MAX_RESPONSE_BYTES {
            return Err("net.fetch: response exceeds the 10 MB limit".to_string());
        }
    }

    let body_text = String::from_utf8_lossy(&bytes).into_owned();
    let body_base64 = if is_text_content_type(&content_type) {
        None
    } else {
        Some(BASE64.encode(&bytes))
    };

    Ok(PluginFetchResponse {
        status,
        headers: safe_headers,
        body_text,
        body_base64,
    })
}

// ---------------------------------------------------------------------------
// Tests — pure validation only, no network.
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    fn hosts(list: &[&str]) -> Vec<String> {
        list.iter().map(|s| s.to_string()).collect()
    }

    // ---- validate_url / validate_parsed_url ----

    #[test]
    fn validate_url_accepts_https_on_allowlist() {
        let allowed = hosts(&["api.example.com"]);
        assert!(validate_url("https://api.example.com/x", &allowed).is_ok());
    }

    #[test]
    fn validate_url_rejects_non_https() {
        let allowed = hosts(&["api.example.com"]);
        let err = validate_url("http://api.example.com/x", &allowed).unwrap_err();
        assert!(err.contains("https"), "unexpected error: {err}");
    }

    #[test]
    fn validate_url_rejects_userinfo() {
        let allowed = hosts(&["api.example.com"]);
        let err = validate_url("https://user:pass@api.example.com/x", &allowed).unwrap_err();
        assert!(err.contains("credentials"), "unexpected error: {err}");
    }

    #[test]
    fn validate_url_rejects_host_not_on_allowlist() {
        let allowed = hosts(&["api.example.com"]);
        let err = validate_url("https://evil.example.com/x", &allowed).unwrap_err();
        assert!(err.contains("allowedHosts"), "unexpected error: {err}");
    }

    #[test]
    fn validate_url_rejects_malformed_url() {
        let allowed = hosts(&["api.example.com"]);
        assert!(validate_url("not-a-url", &allowed).is_err());
    }

    #[test]
    fn validate_url_normalizes_away_the_default_port() {
        // allowedHosts entries never carry a port; a URL that spells out the
        // scheme's default port must still match the bare hostname.
        let allowed = hosts(&["api.example.com"]);
        assert!(validate_url("https://api.example.com:443/x", &allowed).is_ok());
    }

    #[test]
    fn validate_url_rejects_explicit_non_default_port() {
        let allowed = hosts(&["api.example.com"]);
        let err = validate_url("https://api.example.com:8443/x", &allowed).unwrap_err();
        assert!(err.contains("allowedHosts"), "unexpected error: {err}");
    }

    // ---- resolve_redirect_target ----

    #[test]
    fn resolve_redirect_target_follows_allowlisted_relative_location() {
        let allowed = hosts(&["api.example.com"]);
        let base = Url::parse("https://api.example.com/start").unwrap();
        let next = resolve_redirect_target("/next", &base, &allowed).unwrap();
        assert_eq!(next.as_str(), "https://api.example.com/next");
    }

    #[test]
    fn resolve_redirect_target_rejects_off_allowlist_target() {
        let allowed = hosts(&["api.example.com"]);
        let base = Url::parse("https://api.example.com/start").unwrap();
        let err =
            resolve_redirect_target("https://evil.example.com/steal", &base, &allowed).unwrap_err();
        assert!(err.contains("allowedHosts"), "unexpected error: {err}");
    }

    #[test]
    fn resolve_redirect_target_rejects_downgrade_to_http() {
        let allowed = hosts(&["api.example.com"]);
        let base = Url::parse("https://api.example.com/start").unwrap();
        let err =
            resolve_redirect_target("http://api.example.com/next", &base, &allowed).unwrap_err();
        assert!(err.contains("https"), "unexpected error: {err}");
    }

    // ---- normalize_method ----

    #[test]
    fn normalize_method_uppercases_and_accepts_letters_only() {
        assert_eq!(normalize_method("get").unwrap(), Method::GET);
        assert_eq!(normalize_method("POST").unwrap(), Method::POST);
    }

    #[test]
    fn normalize_method_rejects_non_letters() {
        assert!(normalize_method("G3T").is_err());
        assert!(normalize_method("").is_err());
    }

    #[test]
    fn normalize_method_blocks_connect_trace_track_case_insensitively() {
        assert!(normalize_method("connect").is_err());
        assert!(normalize_method("Trace").is_err());
        assert!(normalize_method("TRACK").is_err());
    }

    // ---- build_header_map ----

    #[test]
    fn build_header_map_accepts_ordinary_headers() {
        let mut headers = HashMap::new();
        headers.insert("content-type".to_string(), "application/json".to_string());
        headers.insert("authorization".to_string(), "Bearer secret".to_string());
        let map = build_header_map(&headers).unwrap();
        assert_eq!(map.get(CONTENT_TYPE).unwrap(), "application/json");
    }

    #[test]
    fn build_header_map_rejects_blocked_headers_case_insensitively() {
        for blocked in [
            "Host",
            "COOKIE",
            "Content-Length",
            "Connection",
            "Transfer-Encoding",
            "Upgrade",
        ] {
            let mut headers = HashMap::new();
            headers.insert(blocked.to_string(), "x".to_string());
            assert!(
                build_header_map(&headers).is_err(),
                "expected {blocked} to be rejected"
            );
        }
    }

    #[test]
    fn build_header_map_rejects_invalid_header_name() {
        let mut headers = HashMap::new();
        headers.insert("bad header".to_string(), "x".to_string());
        assert!(build_header_map(&headers).is_err());
    }

    #[test]
    fn build_header_map_rejects_header_value_with_crlf() {
        let mut headers = HashMap::new();
        headers.insert("x-custom".to_string(), "value\r\nInjected: yes".to_string());
        assert!(build_header_map(&headers).is_err());
    }

    // ---- should_downgrade_to_get ----

    #[test]
    fn should_downgrade_to_get_matches_fetch_spec_redirect_rules() {
        assert!(should_downgrade_to_get(303, &Method::POST));
        assert!(should_downgrade_to_get(303, &Method::GET));
        assert!(should_downgrade_to_get(301, &Method::POST));
        assert!(should_downgrade_to_get(302, &Method::POST));
        assert!(!should_downgrade_to_get(301, &Method::GET));
        assert!(!should_downgrade_to_get(307, &Method::POST));
        assert!(!should_downgrade_to_get(308, &Method::POST));
    }

    // ---- origins_match ----

    #[test]
    fn origins_match_treats_default_port_as_equal() {
        let a = Url::parse("https://api.example.com/a").unwrap();
        let b = Url::parse("https://api.example.com:443/b").unwrap();
        assert!(origins_match(&a, &b));
    }

    #[test]
    fn origins_match_rejects_different_host_or_scheme() {
        let a = Url::parse("https://api.example.com/a").unwrap();
        let b = Url::parse("https://other.example.com/a").unwrap();
        assert!(!origins_match(&a, &b));
    }

    // ---- cross_origin_safe_headers ----

    #[test]
    fn cross_origin_safe_headers_keeps_only_the_minimal_set() {
        let mut headers = HeaderMap::new();
        headers.insert(ACCEPT, HeaderValue::from_static("application/json"));
        headers.insert(ACCEPT_LANGUAGE, HeaderValue::from_static("en-US"));
        headers.insert(CONTENT_TYPE, HeaderValue::from_static("application/json"));
        headers.insert(
            HeaderName::from_static("authorization"),
            HeaderValue::from_static("Bearer secret"),
        );
        headers.insert(
            HeaderName::from_static("x-custom"),
            HeaderValue::from_static("drop-me"),
        );

        let with_body = cross_origin_safe_headers(&headers, true);
        assert_eq!(with_body.len(), 3);
        assert_eq!(with_body.get(CONTENT_TYPE).unwrap(), "application/json");

        let without_body = cross_origin_safe_headers(&headers, false);
        assert_eq!(without_body.len(), 2);
        assert!(without_body.get(CONTENT_TYPE).is_none());
        assert!(without_body.get("authorization").is_none());
    }

    // ---- filter_response_headers ----

    #[test]
    fn filter_response_headers_keeps_only_the_allowlist() {
        let mut headers = HeaderMap::new();
        headers.insert(CONTENT_TYPE, HeaderValue::from_static("application/json"));
        headers.insert(
            HeaderName::from_static("etag"),
            HeaderValue::from_static("abc"),
        );
        headers.insert(
            HeaderName::from_static("set-cookie"),
            HeaderValue::from_static("secret=1"),
        );
        let filtered = filter_response_headers(&headers);
        assert_eq!(filtered.len(), 2);
        assert_eq!(filtered.get("content-type").unwrap(), "application/json");
        assert_eq!(filtered.get("etag").unwrap(), "abc");
        assert!(!filtered.contains_key("set-cookie"));
    }

    // ---- is_text_content_type ----

    #[test]
    fn is_text_content_type_classifies_common_types() {
        assert!(is_text_content_type("text/plain"));
        assert!(is_text_content_type("application/json; charset=utf-8"));
        assert!(is_text_content_type("application/xml"));
        assert!(is_text_content_type("text/javascript"));
        assert!(is_text_content_type("application/x-www-form-urlencoded"));
        assert!(!is_text_content_type("image/png"));
        assert!(!is_text_content_type("application/octet-stream"));
        assert!(!is_text_content_type(""));
    }

    // ---- check_declared_length ----

    #[test]
    fn check_declared_length_rejects_over_cap() {
        let mut headers = HeaderMap::new();
        headers.insert(CONTENT_LENGTH, HeaderValue::from_static("999999999"));
        assert!(check_declared_length(&headers, MAX_RESPONSE_BYTES).is_err());
    }

    #[test]
    fn check_declared_length_accepts_within_cap_or_missing() {
        let mut headers = HeaderMap::new();
        headers.insert(CONTENT_LENGTH, HeaderValue::from_static("10"));
        assert!(check_declared_length(&headers, MAX_RESPONSE_BYTES).is_ok());
        assert!(check_declared_length(&HeaderMap::new(), MAX_RESPONSE_BYTES).is_ok());
    }
}

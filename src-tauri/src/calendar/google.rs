//! Google Calendar v3, read-only.
//!
//! Recurrence is expanded server-side via `singleEvents=true`, which is why
//! there is no RRULE or VTIMEZONE handling anywhere in this file — Google
//! returns concrete instances with resolved offsets and we map them straight
//! across.
//!
//! Access tokens are cached in memory for the process lifetime; only the
//! refresh token is persisted, and that lives in the OS keychain.

use serde::Deserialize;
use std::sync::Mutex;
use std::time::Instant;

use super::oauth::{self, AccessToken};

const CALENDAR_LIST_URL: &str = "https://www.googleapis.com/calendar/v3/users/me/calendarList";
const EVENTS_BASE: &str = "https://www.googleapis.com/calendar/v3/calendars";
const PAGE_SIZE: u32 = 250;

/// Distinguishes "the token expired, retry" from "the user must reconnect", so
/// the UI can prompt for consent instead of showing a dead-end error.
#[derive(Debug)]
pub enum GoogleError {
    NeedsReauth(String),
    Other(String),
}

impl GoogleError {
    pub fn message(self) -> String {
        match self {
            GoogleError::NeedsReauth(m) | GoogleError::Other(m) => m,
        }
    }
}

impl std::fmt::Display for GoogleError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            GoogleError::NeedsReauth(m) | GoogleError::Other(m) => write!(f, "{m}"),
        }
    }
}

static ACCESS_TOKEN: Mutex<Option<AccessToken>> = Mutex::new(None);

pub fn cache_token(token: AccessToken) {
    if let Ok(mut guard) = ACCESS_TOKEN.lock() {
        *guard = Some(token);
    }
}

pub fn clear_token() {
    if let Ok(mut guard) = ACCESS_TOKEN.lock() {
        *guard = None;
    }
}

/// Return a usable access token, refreshing when the cached one is missing or
/// close enough to expiry that it would likely die mid-request.
async fn token() -> Result<String, GoogleError> {
    let cached = ACCESS_TOKEN
        .lock()
        .ok()
        .and_then(|guard| guard.clone())
        .filter(|t| t.is_usable(Instant::now()));

    if let Some(token) = cached {
        return Ok(token.value);
    }

    let refreshed = oauth::refresh().await.map_err(GoogleError::NeedsReauth)?;
    let value = refreshed.value.clone();
    cache_token(refreshed);
    Ok(value)
}

async fn get_json(url: &str) -> Result<serde_json::Value, GoogleError> {
    let client = reqwest::Client::new();

    for attempt in 0..2 {
        let bearer = token().await?;
        let response = client
            .get(url)
            .bearer_auth(&bearer)
            .send()
            .await
            .map_err(|e| GoogleError::Other(format!("could not reach Google Calendar: {e}")))?;

        if response.status() == reqwest::StatusCode::UNAUTHORIZED {
            // First 401: the cached token is stale despite the expiry check
            // (revoked, password change). Drop it and let the retry refresh.
            clear_token();
            if attempt == 0 {
                continue;
            }
            return Err(GoogleError::NeedsReauth(
                "Google access expired. Reconnect your account in Settings → Calendar.".into(),
            ));
        }

        if !response.status().is_success() {
            let status = response.status();
            let body = response.text().await.unwrap_or_default();
            return Err(GoogleError::Other(format!(
                "Google Calendar returned {status}: {body}"
            )));
        }

        return response
            .json::<serde_json::Value>()
            .await
            .map_err(|e| GoogleError::Other(format!("could not read Google's response: {e}")));
    }

    Err(GoogleError::NeedsReauth(
        "Google access expired. Reconnect your account in Settings → Calendar.".into(),
    ))
}

#[derive(Debug, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct GoogleCalendar {
    pub id: String,
    #[serde(default)]
    pub summary: String,
    #[serde(default)]
    pub background_color: String,
    #[serde(default)]
    pub access_role: String,
    #[serde(default)]
    pub primary: bool,
}

impl GoogleCalendar {
    pub fn allows_modify(&self) -> bool {
        self.access_role == "owner" || self.access_role == "writer"
    }
}

pub fn parse_calendar_list(value: &serde_json::Value) -> Vec<GoogleCalendar> {
    value
        .get("items")
        .and_then(|items| items.as_array())
        .map(|items| {
            items
                .iter()
                .filter_map(|item| serde_json::from_value::<GoogleCalendar>(item.clone()).ok())
                .collect()
        })
        .unwrap_or_default()
}

pub async fn list_calendars() -> Result<Vec<GoogleCalendar>, GoogleError> {
    let body = get_json(CALENDAR_LIST_URL).await?;
    Ok(parse_calendar_list(&body))
}

/// The connected account's own address, which doubles as the id of the primary
/// calendar. Avoids asking for a profile scope just to label the UI.
pub async fn account_email() -> Result<Option<String>, GoogleError> {
    Ok(list_calendars()
        .await?
        .into_iter()
        .find(|c| c.primary)
        .map(|c| c.id))
}

/// One event as it arrives from Google, before mapping to the shared shape.
#[derive(Debug, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct GoogleEvent {
    #[serde(default)]
    pub id: String,
    #[serde(default)]
    pub summary: Option<String>,
    #[serde(default)]
    pub status: String,
    #[serde(default)]
    pub location: Option<String>,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub html_link: Option<String>,
    pub start: Option<GoogleEventTime>,
    pub end: Option<GoogleEventTime>,
}

#[derive(Debug, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct GoogleEventTime {
    /// Present for all-day events.
    #[serde(default)]
    pub date: Option<String>,
    /// Present for timed events.
    #[serde(default)]
    pub date_time: Option<String>,
}

impl GoogleEventTime {
    fn value(&self) -> Option<&str> {
        self.date_time.as_deref().or(self.date.as_deref())
    }
}

impl GoogleEvent {
    pub fn is_all_day(&self) -> bool {
        self.start
            .as_ref()
            .map(|s| s.date_time.is_none() && s.date.is_some())
            .unwrap_or(false)
    }

    pub fn is_cancelled(&self) -> bool {
        self.status == "cancelled"
    }

    pub fn start_value(&self) -> Option<&str> {
        self.start.as_ref().and_then(|s| s.value())
    }

    pub fn end_value(&self) -> Option<&str> {
        self.end.as_ref().and_then(|e| e.value())
    }
}

pub fn parse_events_page(value: &serde_json::Value) -> (Vec<GoogleEvent>, Option<String>) {
    let events = value
        .get("items")
        .and_then(|items| items.as_array())
        .map(|items| {
            items
                .iter()
                .filter_map(|item| serde_json::from_value::<GoogleEvent>(item.clone()).ok())
                .filter(|e: &GoogleEvent| !e.is_cancelled())
                .collect()
        })
        .unwrap_or_default();

    let next = value
        .get("nextPageToken")
        .and_then(|t| t.as_str())
        .map(str::to_string);

    (events, next)
}

/// Percent-encode a path segment. Calendar ids are email addresses, so `@` and
/// `.` have to survive as data rather than path structure.
fn encode_segment(value: &str) -> String {
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

/// Fetch every event in `[time_min, time_max]` for one calendar, following
/// pagination to the end.
pub async fn list_events(
    calendar_id: &str,
    time_min: &str,
    time_max: &str,
) -> Result<Vec<GoogleEvent>, GoogleError> {
    let mut all = Vec::new();
    let mut page_token: Option<String> = None;

    loop {
        let mut url = format!(
            "{EVENTS_BASE}/{}/events?timeMin={}&timeMax={}&singleEvents=true&orderBy=startTime&maxResults={PAGE_SIZE}",
            encode_segment(calendar_id),
            encode_segment(time_min),
            encode_segment(time_max),
        );
        if let Some(token) = &page_token {
            url.push_str(&format!("&pageToken={}", encode_segment(token)));
        }

        let body = get_json(&url).await?;
        let (events, next) = parse_events_page(&body);
        all.extend(events);

        match next {
            Some(token) => page_token = Some(token),
            None => break,
        }
    }

    Ok(all)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn maps_calendar_list_and_finds_the_primary() {
        let body = serde_json::json!({
            "items": [
                {"id": "work@example.com", "summary": "Work", "backgroundColor": "#123456",
                 "accessRole": "reader"},
                {"id": "me@example.com", "summary": "Me", "backgroundColor": "#abcdef",
                 "accessRole": "owner", "primary": true}
            ]
        });
        let calendars = parse_calendar_list(&body);
        assert_eq!(calendars.len(), 2);
        assert!(!calendars[0].allows_modify());
        assert!(calendars[1].allows_modify());
        assert_eq!(
            calendars.iter().find(|c| c.primary).map(|c| c.id.as_str()),
            Some("me@example.com")
        );
    }

    #[test]
    fn distinguishes_all_day_from_timed_events() {
        let body = serde_json::json!({
            "items": [
                {"id": "a", "summary": "Timed", "status": "confirmed",
                 "start": {"dateTime": "2026-08-07T09:00:00+01:00"},
                 "end": {"dateTime": "2026-08-07T10:00:00+01:00"}},
                {"id": "b", "summary": "Holiday", "status": "confirmed",
                 "start": {"date": "2026-08-07"}, "end": {"date": "2026-08-08"}}
            ]
        });
        let (events, next) = parse_events_page(&body);
        assert!(next.is_none());
        assert_eq!(events.len(), 2);
        assert!(!events[0].is_all_day());
        assert_eq!(events[0].start_value(), Some("2026-08-07T09:00:00+01:00"));
        assert!(events[1].is_all_day());
        assert_eq!(events[1].start_value(), Some("2026-08-07"));
    }

    #[test]
    fn drops_cancelled_events() {
        let body = serde_json::json!({
            "items": [
                {"id": "a", "status": "cancelled", "start": {"date": "2026-08-07"}},
                {"id": "b", "status": "confirmed", "start": {"date": "2026-08-07"}}
            ]
        });
        let (events, _) = parse_events_page(&body);
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].id, "b");
    }

    #[test]
    fn surfaces_the_page_token_so_pagination_can_continue() {
        let body = serde_json::json!({ "items": [], "nextPageToken": "tok2" });
        let (_, next) = parse_events_page(&body);
        assert_eq!(next.as_deref(), Some("tok2"));
    }

    #[test]
    fn tolerates_an_event_with_no_title_or_times() {
        let body = serde_json::json!({ "items": [{"id": "a", "status": "confirmed"}] });
        let (events, _) = parse_events_page(&body);
        assert_eq!(events.len(), 1);
        assert!(events[0].summary.is_none());
        assert!(events[0].start_value().is_none());
    }

    #[test]
    fn encodes_an_email_calendar_id_for_the_path() {
        assert_eq!(encode_segment("me@example.com"), "me%40example.com");
        assert_eq!(
            encode_segment("2026-08-07T00:00:00+01:00"),
            "2026-08-07T00%3A00%3A00%2B01%3A00"
        );
    }
}

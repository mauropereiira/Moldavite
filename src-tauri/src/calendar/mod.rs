//! Calendar events from more than one source, behind one shape.
//!
//! Apple (EventKit, macOS only) and Google (REST, everywhere) have nothing in
//! common structurally: one is a local FFI call with an OS permission, the
//! other a remote API with an OAuth connection. This module owns what the rest
//! of the app sees — a merged event list, per-source status, and per-source
//! failures that never take the whole fetch down with them.
//!
//! Ids from the two sources can collide, so every event and calendar id is
//! prefixed with its source here and split back apart here. Nothing above this
//! boundary should ever parse an id.

#[cfg(target_os = "macos")]
pub mod apple;
pub mod google;
pub mod oauth;

use chrono::{Local, NaiveDate, TimeZone};
use serde::{Deserialize, Serialize};

#[cfg(target_os = "macos")]
pub use apple::CalendarPermission;

/// Non-macOS builds still need the type so `CalendarSourceStatus` keeps one
/// shape across platforms, but nothing off macOS ever constructs a variant —
/// `permission` is always `None` there. The variants exist to keep the wire
/// format identical for the frontend's `CalendarPermission` union, so
/// `dead_code` is expected rather than a sign of something unused.
#[cfg(not(target_os = "macos"))]
#[allow(dead_code)]
#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
pub enum CalendarPermission {
    NotDetermined,
    Restricted,
    Denied,
    Authorized,
    FullAccess,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum CalendarSource {
    Apple,
    Google,
}

impl CalendarSource {
    fn prefix(&self) -> &'static str {
        match self {
            CalendarSource::Apple => "apple",
            CalendarSource::Google => "google",
        }
    }

    fn from_prefix(value: &str) -> Option<Self> {
        match value {
            "apple" => Some(CalendarSource::Apple),
            "google" => Some(CalendarSource::Google),
            _ => None,
        }
    }
}

/// `apple:<uid>` / `google:<id>`.
pub fn namespace_id(source: CalendarSource, id: &str) -> String {
    format!("{}:{}", source.prefix(), id)
}

/// Split a namespaced id back into its source and native id. Returns `None`
/// for anything without a known prefix, so a malformed id from the frontend
/// cannot be silently treated as belonging to some source.
pub fn split_id(namespaced: &str) -> Option<(CalendarSource, &str)> {
    let (prefix, rest) = namespaced.split_once(':')?;
    if rest.is_empty() {
        return None;
    }
    CalendarSource::from_prefix(prefix).map(|source| (source, rest))
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CalendarInfo {
    pub id: String,
    pub source: CalendarSource,
    pub title: String,
    pub color: String,
    pub is_subscribed: bool,
    pub allows_modify: bool,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CalendarEvent {
    pub id: String,
    pub source: CalendarSource,
    pub title: String,
    pub start: String,
    pub end: String,
    pub is_all_day: bool,
    pub location: String,
    pub notes: String,
    pub calendar_id: String,
    pub calendar_title: String,
    pub calendar_color: String,
    pub url: String,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CalendarSourceStatus {
    pub source: CalendarSource,
    pub available: bool,
    pub connected: bool,
    pub account: Option<String>,
    pub permission: Option<CalendarPermission>,
    pub error: Option<String>,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CalendarSourceError {
    pub source: CalendarSource,
    pub message: String,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CalendarFetchResult {
    pub events: Vec<CalendarEvent>,
    pub errors: Vec<CalendarSourceError>,
}

const NO_TITLE: &str = "(No title)";

/// One shared HTTP client for every Google call.
///
/// `reqwest::Client` owns the connection pool, so building one per request —
/// which a paginated fetch across several calendars does a lot of — throws away
/// keep-alive and pays a fresh TLS handshake every time. A request timeout
/// belongs here too: without one a stalled connection hangs the fetch forever.
fn http_client() -> reqwest::Client {
    static CLIENT: std::sync::OnceLock<reqwest::Client> = std::sync::OnceLock::new();
    CLIENT
        .get_or_init(|| {
            reqwest::Client::builder()
                .timeout(std::time::Duration::from_secs(30))
                .build()
                .unwrap_or_default()
        })
        .clone()
}

// ---------------------------------------------------------------- Apple

#[cfg(target_os = "macos")]
fn apple_status() -> CalendarSourceStatus {
    let permission = apple::get_permission_status();
    CalendarSourceStatus {
        source: CalendarSource::Apple,
        available: true,
        connected: apple::is_authorized(),
        account: None,
        permission: Some(permission),
        error: None,
    }
}

#[cfg(not(target_os = "macos"))]
fn apple_status() -> CalendarSourceStatus {
    CalendarSourceStatus {
        source: CalendarSource::Apple,
        available: false,
        connected: false,
        account: None,
        permission: None,
        error: Some("Apple Calendar is only available on macOS.".into()),
    }
}

#[cfg(target_os = "macos")]
fn apple_calendars() -> Result<Vec<CalendarInfo>, String> {
    Ok(apple::get_calendars()?
        .into_iter()
        .map(|c| CalendarInfo {
            id: namespace_id(CalendarSource::Apple, &c.id),
            source: CalendarSource::Apple,
            title: c.title,
            color: c.color,
            is_subscribed: c.is_subscribed,
            allows_modify: c.allows_modify,
        })
        .collect())
}

#[cfg(not(target_os = "macos"))]
fn apple_calendars() -> Result<Vec<CalendarInfo>, String> {
    Ok(Vec::new())
}

#[cfg(target_os = "macos")]
fn apple_events(
    start_date: &str,
    end_date: &str,
    calendar_ids: &[String],
) -> Result<Vec<CalendarEvent>, String> {
    // EventKit filters by at most one calendar, so a multi-calendar selection
    // is fetched whole and narrowed here. Selecting nothing means everything.
    let wanted: Vec<&str> = calendar_ids
        .iter()
        .filter_map(|id| match split_id(id) {
            Some((CalendarSource::Apple, native)) => Some(native),
            _ => None,
        })
        .collect();

    // "Nothing selected" and "nothing of ours selected" are different answers.
    // Keying the everything-case off `wanted` conflated them, so ticking only a
    // Google calendar still returned every Apple calendar. Match the rule
    // `google_events` uses: an empty selection means all, a selection that
    // excludes this source means none.
    if !calendar_ids.is_empty() && wanted.is_empty() {
        return Ok(Vec::new());
    }

    let single = if wanted.len() == 1 { Some(wanted[0]) } else { None };
    let raw = apple::get_events(start_date, end_date, single)?;

    Ok(raw
        .into_iter()
        .filter(|e| calendar_ids.is_empty() || wanted.contains(&e.calendar_id.as_str()))
        .map(|e| CalendarEvent {
            id: namespace_id(CalendarSource::Apple, &e.id),
            source: CalendarSource::Apple,
            title: e.title,
            start: e.start,
            end: e.end,
            is_all_day: e.is_all_day,
            location: e.location,
            notes: e.notes,
            calendar_id: namespace_id(CalendarSource::Apple, &e.calendar_id),
            calendar_title: e.calendar_title,
            calendar_color: e.calendar_color,
            url: e.url,
        })
        .collect())
}

#[cfg(not(target_os = "macos"))]
fn apple_events(
    _start_date: &str,
    _end_date: &str,
    _calendar_ids: &[String],
) -> Result<Vec<CalendarEvent>, String> {
    Ok(Vec::new())
}

// --------------------------------------------------------------- Google

fn google_status() -> CalendarSourceStatus {
    if !oauth::is_configured() {
        return CalendarSourceStatus {
            source: CalendarSource::Google,
            available: false,
            connected: false,
            account: None,
            permission: None,
            error: Some(oauth::not_configured_message()),
        };
    }
    CalendarSourceStatus {
        source: CalendarSource::Google,
        available: true,
        connected: oauth::has_stored_refresh_token(),
        account: None,
        permission: None,
        error: None,
    }
}

async fn google_calendars() -> Result<Vec<CalendarInfo>, String> {
    if !oauth::is_configured() || !oauth::has_stored_refresh_token() {
        return Ok(Vec::new());
    }
    let calendars = google::list_calendars().await.map_err(|e| e.message())?;
    Ok(calendars
        .into_iter()
        .map(|c| CalendarInfo {
            id: namespace_id(CalendarSource::Google, &c.id),
            source: CalendarSource::Google,
            title: if c.summary.is_empty() {
                c.id.clone()
            } else {
                c.summary.clone()
            },
            color: c.background_color.clone(),
            is_subscribed: !c.primary,
            allows_modify: c.allows_modify(),
        })
        .collect())
}

/// Google wants RFC3339 bounds; the app speaks `yyyy-MM-dd`. Widen to the whole
/// local day on both ends so the range matches what the Swift bridge does.
fn local_day_bounds(start_date: &str, end_date: &str) -> Result<(String, String), String> {
    let parse = |value: &str| {
        NaiveDate::parse_from_str(value, "%Y-%m-%d")
            .map_err(|e| format!("Invalid date {value}: {e}"))
    };
    let start = parse(start_date)?;
    let end = parse(end_date)?;

    // Local midnight does not exist on a spring-forward that lands at 00:00 —
    // Santiago, Asunción, Beirut, Tehran and Havana all do this. Erroring there
    // would cost the user every Google event for that day, so walk forward to
    // the first hour that does exist. The Swift bridge already rolls forward
    // the same way, so the two sources stay aligned.
    let start_dt = (0..=3)
        .find_map(|hour| {
            start
                .and_hms_opt(hour, 0, 0)
                .and_then(|naive| Local.from_local_datetime(&naive).earliest())
        })
        .ok_or_else(|| format!("Invalid local start time for {start_date}"))?;
    let end_dt = (0..=3)
        .find_map(|back| {
            end.and_hms_opt(23 - back, 59, 59)
                .and_then(|naive| Local.from_local_datetime(&naive).latest())
        })
        .ok_or_else(|| format!("Invalid local end time for {end_date}"))?;

    Ok((start_dt.to_rfc3339(), end_dt.to_rfc3339()))
}

async fn google_events(
    start_date: &str,
    end_date: &str,
    calendar_ids: &[String],
) -> Result<Vec<CalendarEvent>, String> {
    if !oauth::is_configured() || !oauth::has_stored_refresh_token() {
        return Ok(Vec::new());
    }

    let (time_min, time_max) = local_day_bounds(start_date, end_date)?;

    let all = google::list_calendars().await.map_err(|e| e.message())?;
    let wanted: Vec<&str> = calendar_ids
        .iter()
        .filter_map(|id| match split_id(id) {
            Some((CalendarSource::Google, native)) => Some(native),
            _ => None,
        })
        .collect();

    // An empty selection means every calendar; a selection with no Google
    // entries means the user deliberately excluded Google.
    let selected: Vec<&google::GoogleCalendar> = if calendar_ids.is_empty() {
        all.iter().collect()
    } else {
        all.iter().filter(|c| wanted.contains(&c.id.as_str())).collect()
    };

    let mut events = Vec::new();
    let mut failures: Vec<String> = Vec::new();
    for calendar in selected {
        // One calendar that 404s or 403s — a shared calendar the owner deleted,
        // a subscription that lost access — must not cost the user every other
        // Google calendar. Collect and carry on, the same way a failing source
        // does not take the other source down.
        let page = match google::list_events(&calendar.id, &time_min, &time_max).await {
            Ok(page) => page,
            Err(e) => {
                let name = if calendar.summary.is_empty() {
                    calendar.id.clone()
                } else {
                    calendar.summary.clone()
                };
                failures.push(format!("{name}: {}", e.message()));
                continue;
            }
        };
        for e in page {
            let (Some(start), Some(end)) = (e.start_value(), e.end_value()) else {
                continue;
            };
            events.push(CalendarEvent {
                id: namespace_id(CalendarSource::Google, &e.id),
                source: CalendarSource::Google,
                title: e
                    .summary
                    .clone()
                    .filter(|s| !s.is_empty())
                    .unwrap_or_else(|| NO_TITLE.to_string()),
                start: start.to_string(),
                end: end.to_string(),
                is_all_day: e.is_all_day(),
                location: e.location.clone().unwrap_or_default(),
                notes: e.description.clone().unwrap_or_default(),
                calendar_id: namespace_id(CalendarSource::Google, &calendar.id),
                calendar_title: if calendar.summary.is_empty() {
                    calendar.id.clone()
                } else {
                    calendar.summary.clone()
                },
                calendar_color: calendar.background_color.clone(),
                url: e.html_link.clone().unwrap_or_default(),
            });
        }
    }

    // Every calendar failed and none produced events: report it rather than
    // pretending the account is simply empty.
    if events.is_empty() && !failures.is_empty() {
        return Err(failures.join("; "));
    }

    Ok(events)
}

// ------------------------------------------------------------- Dispatch

pub async fn list_sources() -> Vec<CalendarSourceStatus> {
    let mut google = google_status();
    // Only ask Google who the user is when there is something to ask about;
    // a failure here is a label problem, not a connection problem.
    if google.connected {
        match google::account_email().await {
            Ok(email) => google.account = email,
            Err(e) => google.error = Some(e.message()),
        }
    }
    vec![apple_status(), google]
}

/// Absolute instant for ordering, across the formats the two sources use:
/// RFC3339 with any offset, or a bare `yyyy-MM-dd` for an all-day event.
/// Anything unparseable sorts last rather than panicking.
fn event_instant(start: &str) -> i64 {
    if let Ok(dt) = chrono::DateTime::parse_from_rfc3339(start) {
        return dt.timestamp();
    }
    NaiveDate::parse_from_str(start, "%Y-%m-%d")
        .ok()
        .and_then(|d| d.and_hms_opt(0, 0, 0))
        .and_then(|naive| Local.from_local_datetime(&naive).earliest())
        .map(|dt| dt.timestamp())
        .unwrap_or(i64::MAX)
}

/// Merge the calendar lists. A source that fails is left out rather than
/// failing the call: propagating meant one transient Google error emptied the
/// whole list, and on a fresh launch that hides the calendar picker entirely.
pub async fn list_all_calendars() -> Result<Vec<CalendarInfo>, String> {
    let mut calendars = apple_calendars().unwrap_or_default();
    if let Ok(google) = google_calendars().await {
        calendars.extend(google);
    }
    Ok(calendars)
}

/// Fetch across every source. A source that fails contributes an entry to
/// `errors` and nothing to `events`; it never aborts the other source.
pub async fn fetch_events(
    start_date: &str,
    end_date: &str,
    calendar_ids: &[String],
) -> CalendarFetchResult {
    let mut events = Vec::new();
    let mut errors = Vec::new();

    match apple_events(start_date, end_date, calendar_ids) {
        Ok(mut e) => events.append(&mut e),
        Err(message) => errors.push(CalendarSourceError {
            source: CalendarSource::Apple,
            message,
        }),
    }

    match google_events(start_date, end_date, calendar_ids).await {
        Ok(mut e) => events.append(&mut e),
        Err(message) => errors.push(CalendarSourceError {
            source: CalendarSource::Google,
            message,
        }),
    }

    // Sort on the instant, not the text. Apple emits UTC (`…Z`) and Google
    // emits the calendar's own offset, so comparing the strings puts an 09:00
    // event in +03:00 after a 07:00Z event even though it happens two hours
    // earlier. All-day values are bare dates, which parse as local midnight.
    events.sort_by_key(|e| event_instant(&e.start));
    CalendarFetchResult { events, errors }
}

pub async fn connect_google(app: &tauri::AppHandle) -> Result<CalendarSourceStatus, String> {
    let token = oauth::connect(app).await?;
    google::cache_token(token);
    let mut status = google_status();
    if status.connected {
        status.account = google::account_email().await.ok().flatten();
    }
    Ok(status)
}

pub fn disconnect_google() -> Result<(), String> {
    google::clear_token();
    oauth::forget_refresh_token()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn namespaced_ids_round_trip() {
        let id = namespace_id(CalendarSource::Google, "me@example.com");
        assert_eq!(id, "google:me@example.com");
        assert_eq!(
            split_id(&id),
            Some((CalendarSource::Google, "me@example.com"))
        );

        let apple = namespace_id(CalendarSource::Apple, "ABC-123");
        assert_eq!(split_id(&apple), Some((CalendarSource::Apple, "ABC-123")));
    }

    #[test]
    fn rejects_ids_without_a_known_source() {
        assert!(split_id("outlook:abc").is_none());
        assert!(split_id("no-prefix").is_none());
        assert!(split_id("apple:").is_none());
        assert!(split_id("").is_none());
    }

    #[test]
    fn an_id_containing_colons_keeps_everything_after_the_first() {
        // Google ids are addresses, but a calendar id with a colon in it must
        // not be truncated.
        assert_eq!(
            split_id("google:a:b:c"),
            Some((CalendarSource::Google, "a:b:c"))
        );
    }

    #[test]
    fn day_bounds_cover_the_whole_local_range() {
        let (min, max) = local_day_bounds("2026-08-07", "2026-08-08").unwrap();
        assert!(min.starts_with("2026-08-07T00:00:00"));
        assert!(max.starts_with("2026-08-08T23:59:59"));
    }

    #[test]
    fn orders_across_the_two_time_formats_by_instant() {
        // Apple emits UTC, Google emits the calendar's own offset. Compared as
        // text the +03:00 event looks later; it is actually two hours earlier.
        let apple = event_instant("2026-08-07T07:00:00Z");
        let google = event_instant("2026-08-07T09:00:00+03:00");
        assert!(google < apple, "instant ordering should ignore the offset text");
        assert!("2026-08-07T07:00:00Z" < "2026-08-07T09:00:00+03:00");
    }

    #[test]
    fn an_all_day_value_orders_as_local_midnight() {
        let all_day = event_instant("2026-08-07");
        let same_day_morning = event_instant(
            &Local
                .from_local_datetime(
                    &NaiveDate::from_ymd_opt(2026, 8, 7)
                        .unwrap()
                        .and_hms_opt(9, 0, 0)
                        .unwrap(),
                )
                .earliest()
                .unwrap()
                .to_rfc3339(),
        );
        assert!(all_day < same_day_morning);
    }

    #[test]
    fn an_unparseable_start_sorts_last_instead_of_panicking() {
        assert_eq!(event_instant("not a date"), i64::MAX);
    }

    #[test]
    fn day_bounds_reject_a_malformed_date() {
        assert!(local_day_bounds("not-a-date", "2026-08-08").is_err());
        assert!(local_day_bounds("2026-08-07", "07/08/2026").is_err());
    }

    #[test]
    fn source_serialises_lowercase_for_the_frontend() {
        assert_eq!(
            serde_json::to_string(&CalendarSource::Google).unwrap(),
            "\"google\""
        );
        assert_eq!(
            serde_json::to_string(&CalendarSource::Apple).unwrap(),
            "\"apple\""
        );
    }
}

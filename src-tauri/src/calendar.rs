use serde::{Deserialize, Serialize};
use std::ffi::{CStr, CString};
use std::os::raw::c_char;

// Link to Swift functions
extern "C" {
    fn check_calendar_permission() -> i32;
    fn request_calendar_permission() -> bool;
    fn fetch_calendars() -> *mut c_char;
    fn fetch_events(
        start_date: *const c_char,
        end_date: *const c_char,
        calendar_id: *const c_char,
    ) -> *mut c_char;
    fn free_string(ptr: *mut c_char);
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
pub enum CalendarPermission {
    NotDetermined,
    Restricted,
    Denied,
    Authorized,
    FullAccess,
}

impl From<i32> for CalendarPermission {
    fn from(value: i32) -> Self {
        match value {
            0 => CalendarPermission::NotDetermined,
            1 => CalendarPermission::Restricted,
            2 => CalendarPermission::Denied,
            3 => CalendarPermission::Authorized,
            4 => CalendarPermission::FullAccess,
            _ => CalendarPermission::NotDetermined,
        }
    }
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CalendarInfo {
    pub id: String,
    pub title: String,
    pub color: String,
    #[serde(default)]
    pub is_subscribed: bool,
    #[serde(default)]
    pub allows_modify: bool,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CalendarEvent {
    pub id: String,
    pub title: String,
    pub start: String,
    pub end: String,
    pub is_all_day: bool,
    #[serde(default)]
    pub location: String,
    #[serde(default)]
    pub notes: String,
    pub calendar_id: String,
    pub calendar_title: String,
    pub calendar_color: String,
    #[serde(default)]
    pub url: String,
}

/// Get current calendar permission status
pub fn get_permission_status() -> CalendarPermission {
    let status = unsafe { check_calendar_permission() };
    CalendarPermission::from(status)
}

/// Request calendar access permission
/// Returns true if permission was granted
pub fn request_permission() -> bool {
    unsafe { request_calendar_permission() }
}

/// Check if calendar access is authorized
pub fn is_authorized() -> bool {
    matches!(
        get_permission_status(),
        CalendarPermission::Authorized | CalendarPermission::FullAccess
    )
}

/// Fetch all available calendars
pub fn get_calendars() -> Result<Vec<CalendarInfo>, String> {
    let json_ptr = unsafe { fetch_calendars() };
    if json_ptr.is_null() {
        return Err("Failed to fetch calendars".to_string());
    }

    let json_str = unsafe {
        let c_str = CStr::from_ptr(json_ptr);
        let result = c_str.to_string_lossy().to_string();
        free_string(json_ptr);
        result
    };

    // Check for error response
    if json_str.contains("\"error\"") {
        return Err(json_str);
    }

    serde_json::from_str(&json_str).map_err(|e| format!("Failed to parse calendars: {}", e))
}

/// Fetch events for a date range
pub fn get_events(
    start_date: &str,
    end_date: &str,
    calendar_id: Option<&str>,
) -> Result<Vec<CalendarEvent>, String> {
    let start_cstring =
        CString::new(start_date).map_err(|e| format!("Invalid start date: {}", e))?;
    let end_cstring = CString::new(end_date).map_err(|e| format!("Invalid end date: {}", e))?;

    let calendar_id_cstring = calendar_id
        .map(|id| CString::new(id).ok())
        .flatten();

    let calendar_id_ptr = calendar_id_cstring
        .as_ref()
        .map(|cs| cs.as_ptr())
        .unwrap_or(std::ptr::null());

    let json_ptr = unsafe {
        fetch_events(
            start_cstring.as_ptr(),
            end_cstring.as_ptr(),
            calendar_id_ptr,
        )
    };

    if json_ptr.is_null() {
        return Err("Failed to fetch events".to_string());
    }

    let json_str = unsafe {
        let c_str = CStr::from_ptr(json_ptr);
        let result = c_str.to_string_lossy().to_string();
        free_string(json_ptr);
        result
    };

    // Check for error response
    if json_str.contains("\"error\"") {
        return Err(json_str);
    }

    serde_json::from_str(&json_str).map_err(|e| format!("Failed to parse events: {}", e))
}

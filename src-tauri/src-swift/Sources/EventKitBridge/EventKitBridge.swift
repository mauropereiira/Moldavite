import EventKit
import Foundation

// Shared event store instance
private let eventStore = EKEventStore()

// MARK: - Permission Functions

/// Check calendar authorization status
/// Returns: 0 = NotDetermined, 1 = Restricted, 2 = Denied, 3 = Authorized, 4 = FullAccess (macOS 14+)
@_cdecl("check_calendar_permission")
public func checkCalendarPermission() -> Int32 {
    if #available(macOS 14.0, *) {
        let status = EKEventStore.authorizationStatus(for: .event)
        return Int32(status.rawValue)
    } else {
        let status = EKEventStore.authorizationStatus(for: .event)
        return Int32(status.rawValue)
    }
}

/// Request calendar access permission
/// Returns: true if granted, false otherwise
@_cdecl("request_calendar_permission")
public func requestCalendarPermission() -> Bool {
    var granted = false
    let semaphore = DispatchSemaphore(value: 0)

    if #available(macOS 14.0, *) {
        eventStore.requestFullAccessToEvents { success, error in
            granted = success
            if let error = error {
                print("EventKit permission error: \(error.localizedDescription)")
            }
            semaphore.signal()
        }
    } else {
        eventStore.requestAccess(to: .event) { success, error in
            granted = success
            if let error = error {
                print("EventKit permission error: \(error.localizedDescription)")
            }
            semaphore.signal()
        }
    }

    semaphore.wait()
    return granted
}

// MARK: - Calendar Functions

/// Fetch all calendars
/// Returns: JSON string with calendar array
@_cdecl("fetch_calendars")
public func fetchCalendars() -> UnsafeMutablePointer<CChar>? {
    let calendars = eventStore.calendars(for: .event)

    var calendarData: [[String: Any]] = []

    for calendar in calendars {
        let calDict: [String: Any] = [
            "id": calendar.calendarIdentifier,
            "title": calendar.title,
            "color": hexString(from: calendar.cgColor),
            "isSubscribed": calendar.isSubscribed,
            "allowsModify": calendar.allowsContentModifications
        ]
        calendarData.append(calDict)
    }

    return jsonToPointer(calendarData)
}

// MARK: - Event Functions

/// Fetch events for a date range
/// Parameters:
///   - startDate: ISO 8601 date string (YYYY-MM-DD)
///   - endDate: ISO 8601 date string (YYYY-MM-DD)
///   - calendarId: Optional calendar identifier (nil for all calendars)
/// Returns: JSON string with events array
@_cdecl("fetch_events")
public func fetchEvents(
    startDate: UnsafePointer<CChar>,
    endDate: UnsafePointer<CChar>,
    calendarId: UnsafePointer<CChar>?
) -> UnsafeMutablePointer<CChar>? {
    let startStr = String(cString: startDate)
    let endStr = String(cString: endDate)

    let dateFormatter = DateFormatter()
    dateFormatter.dateFormat = "yyyy-MM-dd"
    dateFormatter.timeZone = TimeZone.current

    guard let start = dateFormatter.date(from: startStr),
          let end = dateFormatter.date(from: endStr) else {
        return jsonToPointer(["error": "Invalid date format"])
    }

    // Set time to start and end of day
    let calendar = Calendar.current
    let startOfDay = calendar.startOfDay(for: start)
    guard let endOfDay = calendar.date(bySettingHour: 23, minute: 59, second: 59, of: end) else {
        return jsonToPointer(["error": "Failed to set end of day"])
    }

    // Get calendars to search
    var calendarsToSearch: [EKCalendar]? = nil
    if let calIdPtr = calendarId {
        let calId = String(cString: calIdPtr)
        if !calId.isEmpty, let calendar = eventStore.calendar(withIdentifier: calId) {
            calendarsToSearch = [calendar]
        }
    }

    // Create predicate and fetch events
    let predicate = eventStore.predicateForEvents(
        withStart: startOfDay,
        end: endOfDay,
        calendars: calendarsToSearch
    )

    let events = eventStore.events(matching: predicate)

    var eventData: [[String: Any]] = []

    for event in events {
        let eventDict: [String: Any] = [
            "id": event.eventIdentifier ?? UUID().uuidString,
            "title": event.title ?? "(No title)",
            "start": isoString(from: event.startDate),
            "end": isoString(from: event.endDate),
            "isAllDay": event.isAllDay,
            "location": event.location ?? "",
            "notes": event.notes ?? "",
            "calendarId": event.calendar.calendarIdentifier,
            "calendarTitle": event.calendar.title,
            "calendarColor": hexString(from: event.calendar.cgColor),
            "url": event.url?.absoluteString ?? ""
        ]
        eventData.append(eventDict)
    }

    // Sort by start time
    eventData.sort {
        ($0["start"] as? String ?? "") < ($1["start"] as? String ?? "")
    }

    return jsonToPointer(eventData)
}

// MARK: - Helper Functions

/// Convert any value to JSON string pointer
private func jsonToPointer(_ value: Any) -> UnsafeMutablePointer<CChar>? {
    do {
        let data = try JSONSerialization.data(withJSONObject: value, options: [])
        guard let jsonString = String(data: data, encoding: .utf8) else {
            return strdup("{\"error\": \"Failed to encode JSON\"}")
        }
        return strdup(jsonString)
    } catch {
        return strdup("{\"error\": \"JSON serialization failed: \(error.localizedDescription)\"}")
    }
}

/// Convert CGColor to hex string
private func hexString(from cgColor: CGColor?) -> String {
    guard let color = cgColor,
          let components = color.components,
          components.count >= 3 else {
        return "#000000"
    }

    let r = Int(components[0] * 255)
    let g = Int(components[1] * 255)
    let b = Int(components[2] * 255)

    return String(format: "#%02X%02X%02X", r, g, b)
}

/// Convert Date to ISO 8601 string
private func isoString(from date: Date) -> String {
    let formatter = ISO8601DateFormatter()
    formatter.formatOptions = [.withInternetDateTime]
    return formatter.string(from: date)
}

/// Free a string pointer allocated by this library
@_cdecl("free_string")
public func freeString(ptr: UnsafeMutablePointer<CChar>?) {
    if let ptr = ptr {
        free(ptr)
    }
}

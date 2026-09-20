import EventKit
import Foundation

private let eventStore = EKEventStore()

/// The same binary serves two stdout-framed protocols (`--mcp` and the browser
/// native-messaging host), so nothing in this process may write diagnostics to
/// stdout. Keep every message on stderr.
private func logError(_ message: String) {
    FileHandle.standardError.write(Data((message + "\n").utf8))
}

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

@_cdecl("request_calendar_permission")
public func requestCalendarPermission() -> Bool {
    var granted = false
    let semaphore = DispatchSemaphore(value: 0)

    // Request on a background queue to avoid blocking main thread
    // The system will still show the dialog on the main thread automatically
    if #available(macOS 14.0, *) {
        eventStore.requestFullAccessToEvents { success, error in
            granted = success
            if let error = error {
                logError("EventKit permission error: \(error.localizedDescription)")
            }
            semaphore.signal()
        }
    } else {
        eventStore.requestAccess(to: .event) { success, error in
            granted = success
            if let error = error {
                logError("EventKit permission error: \(error.localizedDescription)")
            }
            semaphore.signal()
        }
    }

    // Wait with a 60-second timeout to give user time to respond
    let result = semaphore.wait(timeout: .now() + 60)
    if result == .timedOut {
        logError("EventKit permission request timed out")
        return false
    }
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

    // EventKit's predicate uses an exclusive upper bound. Advancing from the
    // next local midnight retains the final fractional second and follows DST.
    let calendar = Calendar.current
    let startOfDay = calendar.startOfDay(for: start)
    guard let endExclusive = calendar.date(
        byAdding: .day,
        value: 1,
        to: calendar.startOfDay(for: end)
    ) else {
        return jsonToPointer(["error": "Failed to advance past end day"])
    }

    var calendarsToSearch: [EKCalendar]? = nil
    if let calIdPtr = calendarId {
        let calId = String(cString: calIdPtr)
        if !calId.isEmpty, let calendar = eventStore.calendar(withIdentifier: calId) {
            calendarsToSearch = [calendar]
        }
    }

    let predicate = eventStore.predicateForEvents(
        withStart: startOfDay,
        end: endExclusive,
        calendars: calendarsToSearch
    )

    // Sort EventKit Dates before serialization. Serialized strings are not a
    // safe ordering key once providers use different offsets.
    let events = eventStore.events(matching: predicate).sorted {
        if $0.startDate == $1.startDate {
            return $0.endDate > $1.endDate
        }
        return $0.startDate < $1.startDate
    }

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

    return jsonToPointer(eventData)
}

// MARK: - Helper Functions

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

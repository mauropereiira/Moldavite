// Launch Services' default handler for Markdown, for the Rust side in
// `src/commands/default_app.rs`. macOS only: this package is also linked
// into the iOS build, which has no default apps.
#if os(macOS)
import AppKit
import CoreServices
import UniformTypeIdentifiers

private let markdownContentType = "net.daringfireball.markdown"

private func logDefaultAppError(_ message: String) {
    FileHandle.standardError.write(Data((message + "\n").utf8))
}

@available(macOS 11.0, *)
private func markdownType() -> UTType? {
    UTType(markdownContentType) ?? UTType(filenameExtension: "md")
}

private func sameApp(_ a: URL, _ b: URL) -> Bool {
    a.resolvingSymlinksInPath().standardizedFileURL == b.resolvingSymlinksInPath().standardizedFileURL
}

@_cdecl("is_default_markdown_handler")
public func isDefaultMarkdownHandler() -> Bool {
    if #available(macOS 12.0, *) {
        guard let type = markdownType(),
              let handler = NSWorkspace.shared.urlForApplication(toOpen: type) else {
            return false
        }
        return sameApp(handler, Bundle.main.bundleURL)
    }
    guard let bundleID = Bundle.main.bundleIdentifier,
          let handler = LSCopyDefaultRoleHandlerForContentType(markdownContentType as CFString, .all)?
            .takeRetainedValue() else {
        return false
    }
    return (handler as String).caseInsensitiveCompare(bundleID) == .orderedSame
}

/// Blocks until Launch Services answers, so the caller must be off the main
/// thread: the completion handler may be delivered there.
@_cdecl("set_default_markdown_handler")
public func setDefaultMarkdownHandler() -> Bool {
    if Thread.isMainThread {
        logDefaultAppError("set_default_markdown_handler called on the main thread")
        return false
    }
    // `tauri dev` runs the bare binary, whose bundle URL is its build folder.
    guard Bundle.main.bundleURL.pathExtension == "app" else {
        logDefaultAppError("Not running from an app bundle; leaving the Markdown default alone")
        return false
    }
    if #available(macOS 12.0, *) {
        guard let type = markdownType() else { return false }
        let done = DispatchSemaphore(value: 0)
        NSWorkspace.shared.setDefaultApplication(at: Bundle.main.bundleURL, toOpen: type) { error in
            if let error = error {
                logDefaultAppError("Could not set the Markdown default: \(error.localizedDescription)")
            }
            done.signal()
        }
        if done.wait(timeout: .now() + 30) != .success {
            logDefaultAppError("Timed out setting the Markdown default")
        }
        return isDefaultMarkdownHandler()
    }
    guard let bundleID = Bundle.main.bundleIdentifier else { return false }
    return LSSetDefaultRoleHandlerForContentType(
        markdownContentType as CFString, .all, bundleID as CFString
    ) == noErr
}
#endif

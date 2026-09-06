import Foundation

/// The callback borrows its path/error C strings for this call only. It must
/// finish before returning; it may not unwind across the Swift boundary.
public typealias FileAccessor = @convention(c) (
    UnsafeMutableRawPointer?, UnsafePointer<CChar>?, UnsafePointer<CChar>?
) -> Void

/// A synchronous transaction boundary for Rust's existing file operations.
/// Call from a worker thread. The callback receives the coordinator's URL,
/// which may differ from the original if a file presenter moved the file.
@_cdecl("moldavite_coordinate_file")
public func coordinateFile(
    _ path: UnsafePointer<CChar>?,
    _ writing: Bool,
    _ context: UnsafeMutableRawPointer?,
    _ accessor: FileAccessor
) {
    func fail(_ message: String) {
        message.withCString { accessor(context, nil, $0) }
    }
    guard !Thread.isMainThread else {
        fail("Coordinated file access must run on a worker thread.")
        return
    }
    guard let path = path, let value = String(validatingUTF8: path), value.hasPrefix("/") else {
        fail("Coordinated file access requires an absolute UTF-8 path.")
        return
    }
    let coordinator = NSFileCoordinator(filePresenter: nil)
    let url = URL(fileURLWithPath: value)
    var error: NSError?
    var accessed = false
    let perform: (URL) -> Void = { coordinatedURL in
        accessed = true
        coordinatedURL.path.withCString { accessor(context, $0, nil) }
    }
    if writing {
        coordinator.coordinate(writingItemAt: url, options: .forReplacing,
                               error: &error, byAccessor: perform)
    } else {
        // Do not silently wait for a remote file to download. The caller must
        // check download readiness inside the accessor before reading bytes.
        coordinator.coordinate(readingItemAt: url, options: .immediatelyAvailableMetadataOnly,
                               error: &error, byAccessor: perform)
    }
    if !accessed {
        fail(error?.localizedDescription ?? "The file coordinator did not grant access.")
    }
}

/// The local-Forge path stays direct. Ubiquitous files (including legacy
/// placeholders) hold coordination across Rust's complete hash/check/save.
/// Metadata-query reconciliation must additionally guard a remote-only name
/// that Foundation has not materialized yet; inspection cannot prove absence.
@_cdecl("moldavite_access_file")
public func accessFile(
    _ path: UnsafePointer<CChar>?,
    _ writing: Bool,
    _ context: UnsafeMutableRawPointer?,
    _ accessor: FileAccessor
) {
    func fail(_ message: String) {
        message.withCString { accessor(context, nil, $0) }
    }
    guard let path = path, let value = String(validatingUTF8: path), value.hasPrefix("/") else {
        fail("File access requires an absolute UTF-8 path.")
        return
    }
    let url = URL(fileURLWithPath: value)
    do {
        let item = try CloudDocuments.inspect(url: url, path: value)
        guard item.downloadState.hasLocalContents || item.downloadState == .missing else {
            try? FileManager.default.startDownloadingUbiquitousItem(at: url)
            fail(item.error ?? "This note is waiting for iCloud to download. Try again when it is available.")
            return
        }
        // A new note inherits the enclosing cloud directory's coordination.
        // Do not force NSFileCoordinator onto ordinary desktop or phone files.
        var ancestor = url
        var ubiquitous = item.downloadState != .local && item.downloadState != .missing
        while !ubiquitous && ancestor.path != "/" {
            ubiquitous = (try? ancestor.resourceValues(forKeys: [.isUbiquitousItemKey]))?.isUbiquitousItem == true
            ancestor.deleteLastPathComponent()
        }
        if !ubiquitous {
            accessor(context, path, nil)
            return
        }
        var checked = CheckedAccess(context: context, accessor: accessor)
        withUnsafeMutablePointer(to: &checked) { storage in
            coordinateFile(path, writing, UnsafeMutableRawPointer(storage), checkedFileAccessor)
        }
    } catch { fail(error.localizedDescription) }
}

private struct CheckedAccess {
    let context: UnsafeMutableRawPointer?
    let accessor: FileAccessor
}

private func checkedFileAccessor(
    _ raw: UnsafeMutableRawPointer?, _ path: UnsafePointer<CChar>?, _ error: UnsafePointer<CChar>?
) {
    guard let raw = raw else { return }
    let state = raw.assumingMemoryBound(to: CheckedAccess.self).pointee
    if let error = error {
        state.accessor(state.context, nil, error)
        return
    }
    do {
        guard let path = path, let value = String(validatingUTF8: path) else { throw CloudError.invalidPath }
        let url = URL(fileURLWithPath: value)
        let item = try CloudDocuments.inspect(url: url, path: value)
        guard item.downloadState.hasLocalContents || item.downloadState == .missing else {
            try? FileManager.default.startDownloadingUbiquitousItem(at: url)
            throw NSError(domain: "MoldaviteCloud", code: 1,
                          userInfo: [NSLocalizedDescriptionKey: "This note is waiting for iCloud to download. Try again when it is available."])
        }
        state.accessor(state.context, path, nil)
    } catch {
        error.localizedDescription.withCString { state.accessor(state.context, nil, $0) }
    }
}

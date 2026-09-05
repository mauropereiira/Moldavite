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

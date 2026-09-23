import Foundation

/// Hands Rust the note and each unresolved iCloud conflict version of it, inside a
/// coordinated write of the note. Only when Rust has kept every version as a copy
/// are the versions removed and marked resolved; otherwise iCloud keeps them.
/// The accessor receives a JSON array: the note's path, then each version's path.
@_cdecl("moldavite_resolve_conflicts")
public func resolveConflicts(_ path: UnsafePointer<CChar>?, _ context: UnsafeMutableRawPointer?,
                             _ accessor: TransactionAccessor) {
    func fail(_ error: Error) {
        _ = error.localizedDescription.withCString { accessor(context, nil, $0) }
    }
    guard !Thread.isMainThread else { fail(CloudError.preparing); return }
    guard let path = path, let value = String(validatingUTF8: path), value.hasPrefix("/") else {
        fail(CloudError.invalidPath)
        return
    }
    var coordinationError: NSError?
    var accessed = false
    NSFileCoordinator(filePresenter: nil).coordinate(
        writingItemAt: URL(fileURLWithPath: value), options: [], error: &coordinationError
    ) { url in
        accessed = true
        do {
            try CloudSession.shared.validateAccess(to: url)
            let versions = NSFileVersion.unresolvedConflictVersionsOfItem(at: url) ?? []
            let paths = [url.path] + versions.map { $0.url.path }
            guard let json = String(data: try JSONEncoder().encode(paths), encoding: .utf8) else {
                throw CloudError.invalidPath
            }
            guard json.withCString({ accessor(context, $0, nil) }), !versions.isEmpty else { return }
            // Rust has kept the copies and recorded its result. Reporting a
            // failure now would replace that result and duplicate the copies
            // on the next attempt, so a failure here is only logged.
            do {
                try NSFileVersion.removeOtherVersionsOfItem(at: url)
                for version in versions { version.isResolved = true }
            } catch {
                NSLog("[icloud] conflict versions kept after copying: %@", error.localizedDescription)
            }
        } catch { fail(error) }
    }
    if !accessed { fail(coordinationError ?? CloudError.unavailable) }
}
